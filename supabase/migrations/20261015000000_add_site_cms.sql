-- Preview-first CMS schema for Loading Zone Comedy.
-- Apply only to the intended development/preview database after review.
create table if not exists public.site_content (
  content_key text primary key,
  content_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.site_content enable row level security;
-- No public/client policies: all reads and writes go through the server-side admin API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;
