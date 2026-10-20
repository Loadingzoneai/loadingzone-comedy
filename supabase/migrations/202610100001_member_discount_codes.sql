-- Membership-specific ticket discount codes.
-- Review and apply through the project's migration workflow; this file is not auto-applied by Vercel.
create table if not exists public.member_discount_codes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete cascade,
  code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_exported_at timestamptz
);

create table if not exists public.member_discount_code_setups (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.member_discount_codes(id) on delete cascade,
  event_id uuid references public.member_events(id) on delete set null,
  platform text not null,
  external_event_id text,
  setup_status text not null default 'pending'
    check (setup_status in ('pending', 'configured', 'disabled', 'failed')),
  notes text,
  configured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discount_code_id, platform, external_event_id)
);

create index if not exists member_discount_codes_status_idx
  on public.member_discount_codes(status);
create index if not exists member_discount_code_setups_event_idx
  on public.member_discount_code_setups(event_id, setup_status);

alter table public.member_discount_codes enable row level security;
alter table public.member_discount_code_setups enable row level security;
-- Intentionally no client-facing policies: access only through a trusted server
-- endpoint after real administrator authentication has been implemented.

create or replace function public.generate_member_discount_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_code text;
begin
  if not exists (
    select 1 from public.member_discount_codes c where c.member_id = new.id
  ) then
    loop
      generated_code := 'LZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      exit when not exists (
        select 1 from public.member_discount_codes c where c.code = generated_code
      );
    end loop;

    insert into public.member_discount_codes (member_id, code, status)
    values (
      new.id,
      generated_code,
      case when new.subscription_status = 'active' then 'active' else 'pending' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists members_create_discount_code on public.members;
create trigger members_create_discount_code
after insert on public.members
for each row execute function public.generate_member_discount_code();

create or replace function public.sync_member_discount_code_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.member_discount_codes
  set status = case
        when new.subscription_status = 'active' then 'active'
        else 'revoked'
      end,
      updated_at = now()
  where member_id = new.id
    and status is distinct from case
      when new.subscription_status = 'active' then 'active'
      else 'revoked'
    end;
  return new;
end;
$$;

drop trigger if exists members_sync_discount_code_status on public.members;
create trigger members_sync_discount_code_status
after update of subscription_status on public.members
for each row execute function public.sync_member_discount_code_status();

-- Backfill members already present when this migration is applied.
insert into public.member_discount_codes (member_id, code, status)
select m.id,
       'LZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
       case when m.subscription_status = 'active' then 'active' else 'pending' end
from public.members m
where not exists (
  select 1 from public.member_discount_codes c where c.member_id = m.id
)
on conflict (member_id) do nothing;
