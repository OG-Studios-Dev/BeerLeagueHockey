# Mobile UI Rebuild Design Brief

## Status and source

This is a provisional native interpretation for `apps/mobile`, not an exact mobile approval. The source inspiration is Matt's approved **ExecSuite × Bold Beer-League Hybrid** web concept in `league-sites-home/05-execsuite-bold-hybrid/`, plus the approved league-sites `globals.css` and `FloatingDock.tsx`. A separate mobile/Figma specification has not been supplied, so spacing, information grouping, gesture behavior, and responsive breakpoints remain review decisions.

The approved web reference is preserved in this branch as [approved-web-reference.png](mobile-ui-rebuild/approved-web-reference.png). Its SHA-256 is `e463a0e0cca249c1dec1b103bba8a207d269048e9971ff1e30eec32c9ebfcb31`. This is a web inspiration image, not a signed-off mobile mockup. The web source reference is pinned to [`e213a56b`](https://github.com/OG-Studios-Dev/BeerLeagueHockey/tree/e213a56b0f8332db34276fe6267ff8e9aa019250/apps/league-sites).

The existing Expo 54 / React Native 0.81.5 app stays native. The unrelated sample-data SwiftUI target in `apps/ios` is outside scope.

## Visual direction

- Use a midnight/navy arena canvas with persistent, restrained rink lines, grid texture, and cool light geometry. The atmosphere belongs behind the whole route, not inside a single hero.
- Let scroll content use translucent slate panels so the shared atmosphere remains visible. Use fine cool borders, soft shadows, and restrained blue/cyan glow.
- Keep cards generally within an 18–24 radius range; controls may use tighter 12-ish radii and status pills may be fully rounded.
- Use heavy system type and short, operational labels. Scores, times, availability, team identity, and the next required action win over decoration.
- Electric blue is the primary action color; cyan/sky is a supporting highlight. Keep white primary type and slate secondary text at accessible contrast.
- Preserve dynamic league/team branding as an accent layer. It must not replace the stable navy foundation or reduce contrast.
- Retain beer-league personality in concise microcopy, rivalry moments, team marks, and energetic hierarchy. Avoid turning operational screens into novelty posters.
- Navigation may take polish cues from the approved web floating dock, but React Navigation route names, gates, and reachability are contractual.

## Interaction and state rules

Every screen review must cover loading, empty, error, and relevant role states—not only populated member data. Guest mode is visibly read-only wherever writes exist. Captain controls are displayed only after the existing captain/alternate permission check. Disabled, saving, success, and failure feedback must be distinguishable without relying only on color.

Touch targets should be at least 44×44 points where practical. Dynamic Type, screen-reader labels/order, reduced motion, safe areas, keyboard avoidance, and contrast require native-device validation. A browser preview can review composition and copy, but cannot approve these native behaviors.

## Phases and evidence gates

1. Foundation: shared atmosphere/tokens, navigation, auth, and Home.
2. Core: schedule, game, team, stats, discovery, and profile surfaces.
3. Operations: captain tools, messaging, notifications, and profile editing.
4. Validation: state matrix, accessibility, small/large devices, and physical iOS acceptance.

The manifest records three independent facts per screen:

- `sourceImplemented`: the intended source pass exists.
- `browserReviewed`: layout was reviewed in Expo web, with web limitations noted.
- `iosDeviceAccepted`: native behavior was accepted on a named physical iOS device/build.

`pending` is the default. `review` requires browser-review evidence. `accepted` requires iOS-device evidence; a global theme or shared navigation change cannot promote untouched screens.

## Contracts that do not change

Preserve bundle/EAS/signing identifiers, Supabase auth/data behavior, payments and backend contracts, route names/params, league selection, guest/member/captain gates, and all currently reachable routes. This UI pass does not authorize API writes, schema/infrastructure changes, deployments, credentials access, or edits to `apps/ios`.

## Separate release backlog

These are preexisting gaps and are not evidence against completion of this native UI first pass: Apple-login/guest-mode rejection resolution; in-app account deletion and recovery/retention; push-token lifecycle and delivery; destructive-action recovery; privileged captain mutation authorization/retry; and UGC report/block/moderation/retention for team messages. They remain release work before public submission.
