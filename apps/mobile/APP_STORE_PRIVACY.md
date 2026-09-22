# App Store privacy and account-deletion notes

**Reviewed against source:** 2026-09-22

These notes describe repository behavior, not confirmed production deployment.
App Store Connect answers must be rechecked against the shipped build and live
backend.

## Data used by the mobile app

- Supabase authentication identifiers and provider metadata.
- Player profile data, including name, email, optional phone/location,
  emergency/medical fields, hockey attributes, and optional profile images.
- Team/league memberships and user-authored operational content.
- An Expo push destination when notification permission is granted.
- Optional location, calendar, and photo-library access for the related user
  features.
- Contact-form name, email, subject, and message. Guest submissions do not have
  an authenticated user UUID.

No PostHog behavior is represented by the current mobile source.

## Logout

Logout calls an authenticated RPC that derives `auth.uid()`, requires exactly
one active profile row, and clears its push destination before local sign-out.
Missing/stale sessions, RLS denial, and zero-row cleanup fail closed. After a
completed account deletion, a local sign-out failure triggers a direct local
credential purge so the deleted profile cannot continue making server writes.

## In-app deletion

Profile includes a two-confirmation permanent deletion action. The server
derives the user only from the verified bearer JWT. For Apple-linked accounts,
the app first asks Apple for a fresh authorization code; the server exchanges
and revokes it before storage or database mutation. Provider failure blocks
deletion. A durable `apple_revoked_at` marker makes a database-failure retry
independent of a second Apple grant.

The deletion path:

- deletes fixed-bucket, server-listed profile/registration images under
  validated ownership prefixes;
- deletes contact/profile, security, messaging, notification, current-access,
  and unfinished workflow data;
- inactivates roster rows, removes leadership/current authorization, and keeps
  jersey/position and completed-game appearance/stat history linked to an
  anonymized historical profile;
- retains signed waivers with their minimum evidentiary fields; these records
  are legally retained and are **not anonymous**;
- retains minimum payment/audit/tax facts while clearing Stripe handles,
  metadata, idempotency material, reminders, and free text; these retained
  records are **not anonymous**; and
- deletes the Supabase auth user transactionally with database cleanup.

The field-level contract is in
`docs/account-deletion-retention-matrix.md`. An exact normalized account-email
match is used to delete linked contact submissions. Unmatched guest/shared-email
submissions follow their separate verified privacy process.

Stripe customer cleanup and the completion email are explicit, idempotent
post-database steps. Their minimum retry values are retained only until each
step succeeds. The overall deletion log is not completed early.

## Apple server prerequisites

The Edge Function requires these server-only secret names; never ship them in
the client or accept them in a request:

- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_CLIENT_ID`
- `APPLE_PRIVATE_KEY_P8`

The Apple Developer account must provide a Sign in with Apple key (`.p8`) whose
Key ID and Team ID match those secrets. `APPLE_CLIENT_ID` must be the client ID
used by the native authorization-code grant and enabled for Sign in with Apple.
The key must remain active and authorized for that identifier. The server uses
WebCrypto ES256 directly; no additional JWT dependency is required.

Deployment, Apple business credentials, live migration state, and live data
shape remain external release prerequisites and are not proven by source tests.
