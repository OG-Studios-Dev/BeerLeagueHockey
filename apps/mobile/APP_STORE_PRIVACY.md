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
  current session to the configured Supabase function and then signs out locally.
- **Push notifications:** notification permission and an Expo push token may be
  requested after sign-in. The current client obtains the token locally; verify
  server-side token storage, association, retention, and deletion before release.
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
- **Push notifications (user initiated or after sign-in):** used for game
  reminders and push-notification setup. Users can change notification
  preferences in the app and operating-system settings.
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
4. whether push tokens are stored server-side in the release backend and how
   they are removed on logout or account deletion;
5. account-deletion function deployment and end-to-end deletion behavior;
6. age rating, audience, regional availability, and any children-related answer;
7. final permission prompts on a release-signed physical iOS device.

Do not infer App Store Connect answers from this file alone. The final answers
remain business-owned and must be reconciled against production operations and
the public privacy policy immediately before submission.
