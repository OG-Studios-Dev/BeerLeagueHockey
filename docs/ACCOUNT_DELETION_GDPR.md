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

Organization and league ownership preflight and every organization/league
ownership writer acquire the same per-user advisory transaction lock. The
preflight rechecks ownership after locking and inserts deletion state before the
lock is released. Writer triggers reject deleting, deleted, and authless
profiles, closing the precheck/mutation race for `owner_user_id`, `owner_id`,
the authorization-bearing `created_by` path, organization memberships, and
explicit league-ownership rows. Promotions/updates on those rows recheck the
same invariant after taking the lock.

## Sign in with Apple

The native app first invokes deletion without deciding provider linkage from
client metadata. If server-derived `auth.identities` state requires Apple, the
server requests deletion-time reauthentication and the app retries with only
the one-time authorization code. The Edge Function mints an ES256 Apple client
secret using server configuration and
exchanges the code. It verifies the Apple-signed identity token (`iss`, `aud`,
expiry, signature, and subject) and requires that subject to equal the Apple
identity read server-side from `auth.identities`. Before calling revocation, it
stores the server-returned refresh/access token in a client-inaccessible retry
table. Provider/network failure leaves that token retryable. Only provider
success records `apple_revoked_at` and removes the token in the same database
transaction; a marker failure therefore remains retryable without another
client code or client-supplied token. The marker also stores the exact revoked
subject. Execution rechecks that the current server identity has exactly that
subject; a changed binding invalidates the marker and requires fresh
reauthorization. If the identity is unlinked after a server-verified token is
staged, that durable token still must be revoked and cleared; database deletion
cannot bypass a remaining provider secret.

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

Historical hockey facts remain only under completed-state predicates: an
anonymized profile UUID/name, completed-game stats and appearances, inactive
rosters whose interval covers a completed game, badges, completed attendance,
accepted completed-game substitutions, and filled completed-game goalie facts.
Open/future check-ins, availability, substitutions, captain/player invitations,
spare/draft pools, opt-ins, duties, scorekeeper assignments, and lineup JSON are
deleted, deactivated, or stripped of the UUID. Organization/league access rows,
scorekeeper swaps, and duty-rotation selection arrays are also removed. Paid or
waiver-backed registrations are forced to `cancelled` and lose team/jersey
assignments; non-terminal suspensions are deleted, while only minimized
`served`/`denied` discipline facts may remain.

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
`20260922120000_account_deletion_review_corrections.sql` and
`20260922170000_account_deletion_correction_pass_2.sql`; deploy server functions
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
