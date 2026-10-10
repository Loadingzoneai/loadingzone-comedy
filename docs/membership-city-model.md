# City-specific Membership Design

## Product rule
- Melbourne, Sydney, and Brisbane use the same membership products and Stripe prices.
- A member has one account and one subscription, with a preferred city stored on their member profile.
- Members can switch their preferred city without creating another account or changing their Stripe subscription.
- The member portal displays city-specific merchant benefits and free open-mic events for the selected city.
- General membership benefits remain available regardless of the selected city, subject to each event's terms.

## Existing Stripe prices (do not recreate)
- Monthly: A$12.80
- Annual: A$99.80

## Data model
- `members.city`: nullable until city is selected; allowed values are `melbourne`, `sydney`, and `brisbane`.
- `member_partners`: one row per city-specific merchant benefit. Use `city`, `is_active`, and `display_order` to control visibility.
- `member_events`: city-tagged member events. `event_type = free_open_mic` identifies free open-mic events. Other types include commercial and professional shows. `source` supports manual entries and Eventbrite-imported entries; `external_event_id` supports deduplication.
- Stripe subscription/customer IDs and subscription status remain on the existing `members` table.

## Access and safety
- Row-level security is enabled on both new public content tables.
- Anonymous/authenticated clients may read active partner/event rows only.
- No client-side write policies are added. Management writes must be done through a trusted server-side/admin path using a server secret; never expose the Supabase secret key in browser code.
- Membership-only booking actions must verify an authenticated member and current subscription status server-side, not trust UI state.

## Front-end behaviour
1. Ask the member to select Melbourne, Sydney, or Brisbane during onboarding.
2. Show a city switcher in the member dashboard.
3. On city change, fetch only active benefits and events for the selected city.
4. Display separate sections for merchant benefits and free open mics.
5. For limited-capacity open mics, show booking availability and enforce capacity on the server.
6. Preserve Eventbrite as the source for imported public shows; manually entered shows remain supported.
7. Do not use past-show gallery photos as default images for upcoming-event cards.

## Implementation status
- Database migration applied: `members.city`, `member_partners`, `member_events`, indexes, checks, and read-only active-content RLS policies. City constraints allow Melbourne, Sydney, and Brisbane.
- Not yet implemented: city selector UI, real member login, authenticated booking, admin CRUD, Eventbrite sync into the new event table, Stripe webhook secret/configuration verification, and end-to-end testing.
- Production website has not been changed by these migrations.
