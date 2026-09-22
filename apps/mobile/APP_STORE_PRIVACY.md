# Hockey Life mobile privacy inventory

This is the source-level inventory for the current `apps/mobile` candidate. It
does not indicate completion or approval of App Store Connect privacy metadata.

## Data handled by the app

- **Authentication:** email address, password-based session data, and Apple or
  Google sign-in identifiers are processed through Supabase authentication.
- **Player profile:** name, avatar URL or uploaded profile photo, position,
  self-assessed skill, team membership, jersey number, ratings, badges, and game
  statistics are read or updated for signed-in players.
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

The mobile source contains no advertising SDK and no PostHog or equivalent
analytics integration. Team bulletin/chat and arbitrary captain notes are not
reachable in this minimum-v1 route surface.

## Device permissions and local storage

- **Calendar (user initiated):** requested only when a user chooses Add to
  Calendar. Hockey Life creates a game event in an available writable calendar.
- **Photo library (user initiated):** requested only when a signed-in user
  chooses a profile photo. The selected image is uploaded as the player's avatar.
  Camera and microphone access are disabled for this flow.
- **Push notifications (user initiated or after sign-in):** used for game
  reminders and push-notification setup. Users can change notification
  preferences in the app and operating-system settings.
- **Secure/local storage:** Supabase stores authentication session material;
  Expo SecureStore stores the active Hockey Life selection; notification
  preferences and offline/cache helpers may store app state on device.

The reachable Hockey Life app does not request location, camera, microphone, or
broad Android external-storage permission.

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
3. privacy-policy disclosures, retention periods, deletion handling, and any
   legally required record retention;
4. whether push tokens are stored server-side in the release backend and how
   they are removed on logout or account deletion;
5. account-deletion function deployment and end-to-end deletion behavior;
6. age rating, audience, regional availability, and any children-related answer;
7. final permission prompts on a release-signed physical iOS device.

Do not infer App Store Connect answers from this file alone. The final answers
remain business-owned and must be reconciled against production operations and
the public privacy policy immediately before submission.
