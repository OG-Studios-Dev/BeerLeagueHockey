# Hockey Life mobile privacy inventory

This is the source-level inventory for the current `apps/mobile` candidate. It
does not indicate completion or approval of App Store Connect privacy metadata.

## Data handled by the app

- **Authentication:** email address, password-based session data, and Apple or
  Google sign-in identifiers are processed through Supabase authentication.
- **Player profile:** public name and avatar URL are read but cannot be changed by
  players in the mobile app. Position and self-assessed skill preferences can be
  updated; team membership, jersey number, ratings, badges, and game statistics
  are read for signed-in players.
- **League activity:** schedule, standings, team roster, game availability,
  captain role, sub invitations, and structured goalie requests are read or
  updated as required by the signed-in user's role.
- **Account deletion:** the authenticated delete-account operation sends the
  current session to the configured Supabase function only after the client has
  cleared `profiles.push_token`, cancelled this device's scheduled reminders,
  and removed its local notification preference. The backend deletion repeats
  the profile-token clear, deletes push subscriptions and notification data, and
  removes authentication access; the app then signs out locally without another
  server profile lookup.
- **Push notifications:** notification permission and an Expo push token may be
  requested only when a signed-in user enables Game Reminders. After permission
  is granted, the Expo push token is stored by Supabase in
  `profiles.push_token`, linked to the authenticated profile, and replaced when
  that device registers again. Disabling Game Reminders, logout, and account
  deletion clear the stored profile token. Those same actions cancel local
  scheduled reminders and clear the local notification preference. Logout stops
  and reports an error instead of completing if revocation cannot be confirmed.
- **Public content:** signed-out guests read Hockey Life schedule, standings,
  stats, teams, news, gallery, events, and contact content without membership.
- **Contact submissions:** guests and signed-in members can submit name, email,
  subject, and message for the purpose of responding to a league or support
  inquiry. The row is associated with the selected league but is not linked by
  an authenticated user UUID, even when submitted by a signed-in member. Hockey
  Life league administrators can access the league inbox; Supabase stores and
  processes the row as the backend processor. The repository proves no automatic
  retention schedule, so a submission is retained until a Hockey Life league
  administrator deletes it under the business retention policy. A sender can
  make a manual erasure request through Support, subject to identity verification
  using the submitted contact details. Because the row has no user UUID, it is
  not automatically deleted by authenticated account deletion.

The mobile source contains no advertising SDK and no PostHog or equivalent
analytics integration. Team bulletin/chat and arbitrary captain notes are not
reachable in this minimum-v1 route surface.

## Device permissions and local storage

- **Calendar (user initiated):** requested only when a user chooses Add to
  Calendar. Hockey Life creates a game event in an available writable calendar.
- **Push notifications (user initiated):** permission is requested when a
  signed-in user enables Game Reminders. The app stores the resulting Expo token
  on that user's Supabase profile and schedules local alerts only for games
  involving that player's active Hockey Life team assignments in the current
  active or playoff season. If no such team membership can be verified, Game
  Reminders remain off. Users can disable the setting in the app or change
  notification permission in operating-system settings.
- **Secure/local storage:** Supabase stores authentication session material;
  Expo SecureStore stores the active Hockey Life selection; notification
  preferences and offline/cache helpers may store app state on device.

The reachable Hockey Life app does not request photo-library, location, camera,
microphone, or broad Android external-storage permission.

## Public player identity boundary

Minimum v1 does not collect a public player name during mobile account creation
and provides no mobile control for changing `profiles.full_name`, `avatar_url`,
or `photo_url`. Existing values are preserved and displayed read-only; Hockey
Life league administrators remain responsible for approved identity changes.
The inherited web and league-admin applications are outside this mobile release
surface and may still expose administrator-managed profile operations. Their
authorization, moderation, and public-display behavior must be reviewed in the
separate web/admin release lane; this mobile constraint does not claim to change
those surfaces or existing backend policies.

## Public policy and support destinations

- Privacy: https://beerleaguehockey.ca/privacy
- Terms: https://beerleaguehockey.ca/terms
- Hockey Life support/contact: https://hockey-life.beerleaguehockey.ca/contact

These links are reachable from signed-out authentication screens and from the
in-app More menu for guest and authenticated users. Link-opening failures are
shown to the user.

## Remaining business-owned App Store Connect answers

The business owner must verify and enter the final App Store Connect answers for:

1. each collected-data category, purpose, user linkage, and tracking declaration;
2. Supabase, Expo push, Apple sign-in, and Google sign-in processor practices;
3. privacy-policy disclosures, the business retention period applied by league
   administrators, and any legally required record retention;
4. Expo push processor practices, operational token-delivery behavior, and the
   production retention policy beyond the source-enforced disable, logout, and
   account-deletion clears;
5. account-deletion function deployment and end-to-end deletion behavior;
6. age rating, audience, regional availability, and any children-related answer;
7. final permission prompts on a release-signed physical iOS device.

Do not infer App Store Connect answers from this file alone. The final answers
remain business-owned and must be reconciled against production operations and
the public privacy policy immediately before submission.

## Logout security contract

Logout calls an authenticated RPC that derives `auth.uid()`, requires exactly
one active profile row, and clears its push destination before local sign-out.
Missing/stale sessions, RLS denial, and zero-row cleanup fail closed. The mobile
notification unregister step then cancels this device's scheduled reminders and
clears its local notification preference without repeating the server cleanup.
After a completed account deletion, a local sign-out failure triggers a direct
local credential purge so the deleted profile cannot continue making server
writes.

## In-app deletion and retention contract

Profile includes a two-confirmation permanent deletion action. The client first
revokes its notification destination and local reminder state. The server
derives the user only from the verified bearer JWT. The app first asks the
server whether Apple reauthentication is required and does not decide from
client provider metadata. For an Apple-linked account, it then asks Apple for a
fresh authorization code; the server exchanges it and verifies the
Apple-signed subject against the account's server-side Apple identity, durably
stages the server-returned revocation token, and then revokes it before storage
or database mutation. Provider/network and marker failures retain server-only
retry state. The client never sends a refresh/access/provider token or Apple
secret.

The deletion path:

- deletes fixed-bucket, server-listed profile/registration images under
  validated ownership prefixes;
- deletes contact/profile, security, messaging, notification, current-access,
  and unfinished workflow data;
- deletes or deactivates open/future check-ins, availability, invitations,
  spare/draft pools, opt-ins, duties, assignments, scorekeeper/referee swaps,
  referee bearer sessions, season-return outreach, duty-rotation entries and
  lineup selections;
- removes leadership/current authorization and keeps only roster rows tied to
  completed-game history, with jersey/position and completed stats linked to an
  anonymized historical profile;
- retains only minimized completed-game referee role/payment facts and terminal
  team-return status facts; referee names/contact/tokens/devices and return
  captain identity/contact/tokens/notes are removed;
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
