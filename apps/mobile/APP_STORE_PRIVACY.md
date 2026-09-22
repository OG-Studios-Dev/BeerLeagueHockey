# App Store privacy and account-deletion notes

**Reviewed against source:** 2026-09-21

These notes describe repository behavior, not confirmed production deployment.
App Store Connect answers must be rechecked against the shipped build and live
backend.

## Data used by the mobile app

- Supabase authentication identifiers and provider metadata.
- Player profile data, including name, email, optional phone/location,
  emergency/medical fields used elsewhere in the platform, hockey attributes,
  and optional profile image URLs.
- Team/league memberships and user-authored operational content such as team
  messages, sub invitations, goalie requests/notes, ratings/private notes, and
  check-in notes.
- An Expo push token stored on `profiles.push_token` when notification
  permission is granted.
- Optional location access for nearby league discovery.
- Optional calendar access for adding games.
- Optional photo-library access for profile images.
- Contact-form name, email, subject, and message. The form can be used as a
  guest and does not store an authenticated user UUID.

No PostHog behavior is represented by the current mobile source; do not reuse
privacy answers from the old PostHog shell.

## Logout

Logout clears the current account's persisted profile push token before local
session termination. A cleanup failure blocks logout and shows safe retry
feedback. This prevents the normal successful account-switch path from leaving
the same device token attached to the prior account.

## In-app deletion

Profile includes a two-confirmation permanent Delete Account action. For a
non-Apple user who does not own an organization, the privileged server path:

- removes exact allowlisted, caller-owned profile image objects;
- deletes operational account-facing rows and every repository-proven push
  destination;
- anonymizes profile PII, retained free text on historical substitution/goalie/
  check-in facts, and retained deletion-log PII;
- preserves anonymized historical hockey facts; and
- deletes the Supabase auth user atomically with the DB cleanup.

Contact submissions are not automatically deleted because the schema has no
authenticated-user key; email matching is not safe proof of ownership. They
require a separate verified privacy request.

## Known external prerequisite: Apple revocation

The current repository has neither stored Apple refresh-token/authorization
grant data nor the complete server-side Apple signing credential workflow
needed for token revocation. Apple-linked deletion is explicitly blocked with
`apple_revocation_unavailable` before any mutation; the UI must not report
success. Apple login remains available.

Shipping Apple-linked self-service deletion requires a reviewed server flow to
obtain/store the revocable grant securely, mint the Apple client secret with
business-owned credentials, revoke the token with retry/idempotency semantics,
and only then run account deletion.

## Retention disclosed by behavior

An anonymized profile UUID and non-identifying hockey attributes remain so
games, scores, stats, badges, and attendance history retain integrity. Optional
audit/payment tables retain typed facts only after direct identifiers and
metadata are anonymized as defined by the migration. Processing deletion logs
retain status/timestamps and a pseudonymous UUID but clear direct email, reason,
and payment-customer identifiers.

The source and static tests do not prove that migrations/functions are deployed,
that Apple business credentials exist, or that live data matches checked-in
types. Complete the post-apply live matrix before submission.
