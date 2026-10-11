# Membership release validation checklist

This checklist is for the feature branch and Preview environment only. It does not authorize production changes or database migrations.

## Current environment facts
- Preview deployment is built from `feature/membership-integration`.
- Membership prices already exist in Stripe: A$12.80 monthly and A$99.80 annually.
- Supabase membership tables exist; member count was last checked as zero.
- The discount-code migration `202610100001_member_discount_codes.sql` is committed but has not been applied.
- Stripe webhook signing secret has not been configured.
- No live checkout or real-card transaction has been run as part of development.

## Required checks before a launch decision
- [ ] Confirm the admin email exists in Supabase Auth and email OTP delivery works.
- [ ] Confirm the OTP endpoint does not unintentionally allow account creation; if first-time enrollment is needed, provision the admin explicitly.
- [ ] Verify the admin email allowlist is present only in intended environments.
- [ ] Verify the admin CSV endpoint rejects missing, expired, malformed, and non-admin access tokens.
- [ ] Review and explicitly approve the discount-code migration before applying it.
- [ ] Test code generation uniqueness and subscription-status transitions in a non-production database.
- [ ] Configure a Stripe test-mode secret for Preview; do not put a live secret in Preview for routine testing.
- [ ] Implement and verify Checkout using existing monthly and annual Price IDs.
- [ ] Implement webhook signature verification, event idempotency, and subscription state updates.
- [ ] Ensure Checkout success redirects do not themselves activate membership; only verified server-side payment/subscription events may do so.
- [ ] Test checkout cancellation, payment failure, renewal, cancellation, and duplicate webhook delivery in Stripe test mode.
- [ ] Verify no member PII or secret keys appear in browser responses or logs.
- [ ] Verify Eventbrite upcoming-show integration remains separate from member free-open-mic content and that member free events are sourced from Eventbrite only.
- [ ] Review accessibility, responsive layout, and language switching.
- [ ] Obtain explicit approval before merging the PR, applying schema changes, or deploying to production.

## Known incomplete items
The current member login page is still a placeholder. Stripe Checkout, webhook-driven membership activation, billing management, and the full member dashboard have not been verified end-to-end. A successful Vercel build confirms compilation/deployment only, not business-flow correctness.
