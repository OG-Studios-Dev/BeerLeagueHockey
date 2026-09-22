# Account and privacy lifecycle

**Implementation reviewed:** 2026-09-22
**Mobile path:** immediate authenticated deletion through `delete-account`

This is a source-level implementation description, not production-deployment or
legal certification. The exact field contract is
`docs/account-deletion-retention-matrix.md`.

## Logout

Authenticated logout calls `clear_current_push_destination()` with no user ID.
The `SECURITY DEFINER` RPC uses `auth.uid()`, accepts only an active profile,
clears `profiles.push_token`, and raises unless exactly one row was updated.
Local sign-out happens only after that proof. Missing/stale sessions, an account
switch, RLS/RPC failure, or zero-row cleanup returns safe retry feedback.

After server deletion, local sign-out failure is handled differently: the app
purges its stored Supabase credential and clears in-memory state so credentials
for the deleted profile are not reused.

## Immediate and scheduled deletion state machine

The Edge Function validates the bearer token with Supabase and derives the
target UUID only from that verified user. It never accepts a target user ID,
provider token, refresh token, Apple client secret, bucket, or object path from
the request.

Durable state records these idempotent boundaries:

1. Apple authorization revoked (when Apple-linked).
2. Owned profile-image storage cleanup completed.
3. Database and auth deletion committed.
4. Stripe customer cleanup completed and its customer ID erased.
5. Completion email sent and its destination erased.
6. Overall completion, allowed only after steps 3-5.

The scheduled processor resumes incomplete steps. Stripe `resource_missing` is
idempotent success, and completion email uses a stable provider idempotency key.
A first-attempt failure leaves only that step's minimum retry payload and never
marks overall completion. Immediate mobile deletion creates the same state and
can therefore be finished by the scheduled processor.

Organization and league ownership are checked under the profile lock. Constraint
triggers also prevent a deleting user from acquiring either ownership path until
the state reaches completion, closing the precheck/mutation race.

## Sign in with Apple

For a verified Apple-linked user, the native app performs deletion-time Apple
reauthentication and sends only the one-time authorization code. The Edge
Function mints an ES256 Apple client secret using server configuration,
exchanges the code, and revokes the returned refresh/access token. It records a
durable revocation marker before storage or DB mutation. Provider failure stops
deletion; a later DB failure can retry without another Apple grant.

Required server-only secrets are `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_CLIENT_ID`, and `APPLE_PRIVATE_KEY_P8`. Apple prerequisites are an active
Sign in with Apple `.p8` key with the matching Team/Key IDs and an enabled client
identifier matching the native authorization-code grant. Values do not belong
in source, the mobile bundle, logs, or client requests. WebCrypto provides the
ES256 signing implementation without adding a JWT library.

## Storage

New uploads map validated MIME types to canonical extensions:
`image/jpeg -> jpg`, `image/png -> png`, and `image/webp -> webp`. User filename
extensions are ignored.

Deletion lists only fixed server-side contracts with bounded pagination:

- `avatars/{user_id}/avatar.{jpg|jpeg|png|webp}`;
- `player-avatars/{user_id}-{timestamp}.{jpg|jpeg|png|webp}`; and
- `player-photos/{user_id}/{timestamp}.{jpg|jpeg|png|webp}`.

Foreign UUIDs, arbitrary buckets, malformed paths, slashes/backslashes, encoded
traversal, and unknown extensions are filtered before removal. Missing objects
are idempotent success; a partial removal failure stops before database deletion.
Optional historical relation shape is validated before any storage mutation.

## Database cleanup and retention

The forward migration removes the `profiles.id -> auth.users` cascade and adds
a deferred invariant: an active profile must have an auth row, while a deleted
historical profile may remain after auth deletion. Database cleanup is one
transaction and requires exactly one auth user deletion.

Deleted or cleared data includes direct profile/contact data, login/recovery/
reset records, sessions, push destinations, notifications, preferences,
consents, current memberships/leadership, pending join/approval workflows,
diagnostic bug reports, contact submissions linked by exact normalized email,
future availability, unpaid/unsigned registration workflows, provider payment
identifiers, metadata, idempotency keys, reminder state, and authored free text.

Historical hockey facts remain: an anonymized profile UUID/name, completed-game
stats and appearances, inactive historical roster team/season/jersey/position,
badges, completed attendance categories, accepted substitution facts, and
filled goalie-marketplace facts. These rows confer no current membership,
leadership, or authorization.

Signed waivers retain signature/name, signing IP, acceptance timestamps,
document version/hash, and linkage needed as evidence. They are legally
retained and are **not anonymous**. Financial rows retain minimum amount,
currency, status, method/type, and timestamps needed for audit/tax purposes.
They remain linked to the anonymized historical UUID and are **not anonymous**.
The retention matrix identifies every classified table and cleared field.

## Privilege boundary

Privileged helpers are `SECURITY DEFINER`, owned by `postgres`, and use an empty
`search_path`. Anonymous/authenticated execution is revoked, including inherited
or pre-existing grants; a catalog pass removes unknown grantees. Only
`clear_current_push_destination()` is granted to `authenticated`; it derives
`auth.uid()` internally. Default public function execution is revoked for future
Postgres-owned functions in `public`.

## Rollout and stop conditions

Apply prior lane migrations first, then
`20260922120000_account_deletion_review_corrections.sql`; deploy server functions
before the matching mobile client. Configure Apple secrets and external provider
keys before allowing Apple deletion. Run the disposable SQL/live matrix and
external-provider failure/retry cases before release.

Stop if the migration/catalog checks fail, optional relation shape is
incompatible, an unauthorized role can execute a privileged function, Apple
revocation cannot be established, foreign/traversal storage paths reach remove,
an organization owner can race deletion, DB cleanup loses historical facts, or
overall completion occurs before Stripe and email steps. Applied migrations are
forward-only; rollback requires another migration. Completed provider revocation,
storage removal, and deletion are intentionally irreversible.
