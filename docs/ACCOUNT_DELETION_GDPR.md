# Account and privacy lifecycle

**Implementation reviewed:** 2026-09-21
**Mobile path:** immediate authenticated deletion through `delete-account`

This document describes current repository behavior. It is not a certification
of production deployment or a legal conclusion.

## Mobile logout

Authenticated logout first updates only the current profile and sets
`profiles.push_token` to null. Local Supabase sign-out runs only after that
write succeeds. If token cleanup fails, the session remains active and the app
shows a generic retry message so a device token is not knowingly left assigned
to an account while another account signs in.

The Expo device token itself is not deleted from the device or Expo. The server
association is removed. Local scheduled game reminders are controlled
separately by notification settings.

## Immediate mobile account deletion

The app requires two destructive confirmations, then calls the authenticated
`delete-account` Edge Function without accepting a user ID from the client.
The function validates the bearer token and derives the target UUID from the
verified user.

Before database/auth deletion, the function:

1. blocks Apple-linked users as described below;
2. checks organization ownership;
3. reads `avatar_url` and `photo_url` from the authenticated user's profile;
4. extracts only exact repository-proven, user-owned Storage paths; and
5. removes those objects with the service-role client.

Recognized image contracts are:

- `avatars/{user_id}/avatar.jpg` (current native mobile upload);
- `player-avatars/{user_id}-{timestamp}.{jpg|jpeg|png|webp}` (league-site
  profile upload); and
- `player-photos/{user_id}/{timestamp}.{jpg|jpeg|png|webp}` (registration
  upload when the resulting URL becomes the profile photo).

Bucket and ownership are derived from stored profile URLs, not request input.
Foreign UUIDs, arbitrary buckets, malformed URLs, backslashes, encoded
traversal, and nonconforming filenames are ignored. A proven object that is
absent/already missing does not block deletion. Any other Storage removal error
stops before the database RPC and auth deletion.

Storage and Postgres cannot share a transaction. Therefore a later database
failure can leave an otherwise valid account without its profile image. The
organization precheck avoids the normal known business-rule failure before
Storage mutation, but a concurrent ownership/profile change remains a rollout
test and monitoring concern.

## Transactional database cleanup

Migration `20260921170000_complete_account_lifecycle_cleanup.sql` replaces the
privileged RPC in a forward-only migration. Database work runs in one Postgres
transaction. Any error, including failure to delete exactly one auth user,
rolls back all DB changes.

Deleted account-facing data:

- team messages authored by the account;
- web push subscriptions, notifications, notification preferences, consents,
  application sessions, team rosters, and league memberships;
- optional legacy `push_device_tokens` rows when that known table exists;
- non-accepted sub invitations authored by, addressed to, or replacing the
  account;
- non-filled goalie marketplace requests authored by the account; and
- goalie request notification/delivery-token rows for every authored request.

Anonymized data:

- profile direct identifiers, security/admin state, payment customer ID,
  avatar/photo URLs, and `push_token`;
- a check-in's optional free-text note, while its status is retained as a
  hockey/attendance fact;
- messages on accepted sub invitations, while the accepted substitution remains;
- notes/compensation text on filled goalie requests, while the filled request
  and payment/status facts remain;
- private notes on goalie ratings, while the rating score/tags remain;
- optional audit-log and payment-history direct identifiers when those known
  retention tables exist; and
- direct identifiers in every retained deletion log for the account. Its email becomes
  a random unlinkable `deleted_...@deleted.local` value; deletion reason and
  Stripe customer ID are cleared.

Intentionally retained:

- the anonymized profile UUID needed by historical references;
- non-identifying hockey attributes on that profile;
- games, events, scores, player/goalie statistics, badges, accepted
  substitutions, filled goalie requests, rating facts, and other historical
  hockey facts; and
- typed financial/audit facts that the optional retention helpers preserve
  after removing direct identifiers.

The RPC is `SECURITY DEFINER`, has an empty `search_path`, schema-qualifies its
objects, and is executable by `service_role` only. Organization owners are
rejected before DB mutation and must transfer ownership first.

## Contact submissions

The current mobile contact form writes name, email, subject, message, league ID,
and read status. `contact_submissions` has no authenticated-user key and accepts
guest submissions. A signed-in submission therefore cannot be safely proven to
belong to that auth UUID, and matching by email could delete a guest's or shared
address's message. Automatic account deletion does not delete these rows.
A separate verified privacy request and league/support retention process is
required for contact-form erasure.

## Sign in with Apple blocker

Native Apple sign-in obtains an identity token and one-time authorization code,
then passes them to Supabase sign-in. The repository does not persist an Apple
refresh token or authorization grant for later revocation. It also does not
contain the server-side Apple team ID, key ID, private signing key, and correct
client/service ID workflow required to mint a client secret and call Apple's
token revocation endpoint.

Deleting only the local/auth row would falsely imply Apple access was revoked.
Accordingly, the Edge Function detects Apple in verified Supabase provider data
(`app_metadata.provider`, `app_metadata.providers`, or identities) and returns
HTTP 409 `apple_revocation_unavailable` before Storage or database mutation.

To remove this blocker, a separate reviewed change must securely retain or
freshly obtain the Apple authorization grant, exchange it server-side, provide
the business-owned Apple signing credentials outside source control, revoke the
Apple token successfully (with defined idempotent retry behavior), and only
then continue account deletion. Apple login remains enabled.

## Legacy scheduled processor

The older web flow and `process-account-deletions` implement a deferred path.
Its direct RPC benefits from the corrected transactional DB cleanup, but that
processor does not execute the mobile Edge Function's Storage allowlist or
Apple revocation guard. It is not evidence that iOS in-app deletion passed.
Release acceptance for this lane uses the immediate mobile path and the live
matrix in `docs/testing/account-deletion-live-test-matrix.md`.

## Rollout and rollback

Apply `20260921160000` first if absent, then `20260921170000`. Deploy the Edge
Function and mobile client only after the migration and role-matrix checks pass.
Run all disposable cases in the live matrix before accepting the release.

Do not edit or reverse an applied migration. If rollout fails before any user
deletion, roll back application traffic to the prior client/function and ship a
new forward migration that restores the prior RPC definition. A completed
deletion, anonymization, or Storage removal is intentionally irreversible and
cannot be restored by SQL rollback; recovery would require an approved backup
process and must not recreate revoked access silently.
