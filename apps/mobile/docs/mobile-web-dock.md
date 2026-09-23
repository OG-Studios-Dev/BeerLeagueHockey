# Mobile web-style dock and team artwork

## Reference truth

This native slice is based on the locally pinned league-sites commit `e213a56b0f8332db34276fe6267ff8e9aa019250` and the read-only public Hockey Life capture stored outside the repository at `/Users/tonysoprano/workspaces/tony/artifacts/blh-native-web-dock-20260911/reference`. The capture records the visible-page settings, dock screenshots, source response, and exact public logo payloads. It is reference evidence, not a backend write or live-account acceptance result.

The native dock exposes exactly five controls, in the web layout order: Standings, Schedule, Team, Stats, and More. Home remains the initial route and is reachable from More. Existing hidden roots and their stack contracts remain registered so established cross-stack navigation continues to work.

## Destination mapping

| Control or More item | Destination |
| --- | --- |
| Standings | Native `Standings` tab and standalone standings wrapper; when no league is selected it shows a league chooser before mounting `ScheduleScreen`. |
| Schedule | Existing native `Schedule/ScheduleList`; its default Upcoming/Scores/Standings behavior is unchanged. |
| Team crest | Current signed-in user's newest active, non-ended assignment for the selected league and operational season; otherwise the safe Team list fallback. |
| Stats | Existing native `Stats/StatsMain`. |
| Home | Existing native `Home` root. |
| Discover Leagues | Existing native `Discover/DiscoverMain`. |
| My Page, Account, Notifications, Settings | Existing native Profile stack routes, gated by the existing user state where applicable. |
| Captain Dashboard | Existing native Captain stack, shown only for the current assignment's captain or alternate role. |
| Teams, Players, Playoffs, News, Suspensions, History, Gallery, Events, Venues, About, Contact | Selected tenant's HTTPS website, filtered by its runtime page visibility and season phase. |
| Register | Selected tenant's `/goalies/register`, shown only when registration is open and visible. |
| Goalie requests | Structured native request controls on Team Detail; no external captain Goalies destination is exposed in minimum v1. |
| Custom navigation | Validated HTTPS external URL or tenant-relative page; malformed schemes, credentials, traversal, and malformed metadata are rejected. |

Tenant links require a validated league slug. Loading or failed website metadata never publishes stale tenant destinations; Home, Discover, and Account remain safe native fallbacks.

## Exact bundled team logos

| Team | Team ID | Asset | SHA-256 |
| --- | --- | --- | --- |
| First General London | `453d62d9-80b4-4f26-a2ee-861f0c063402` | `assets/team-logos/first-general-london.png` | `34ed7d2155fb47d788791de414c051f44ca7350bd6c1b24a7002e6985e0e2515` |
| FitzRays Flyers | `e4be829d-952c-4531-8376-215907fab3b7` | `assets/team-logos/fitzrays-flyers.png` | `dadbec3aa4457bf36dcd91160ede3bfe87c14286600eee59875bed9371dd15f0` |
| FitzRays Premier | `346833e0-2780-492d-86db-94df0b0cb3e1` | `assets/team-logos/fitzrays-premier.png` | `8b4851d2f92725e00ea55daadd2178510a14d5c80111be4876d7845fd01c52ab` |
| London Eco Metal | `093f611c-0cdc-4509-afde-9c661b5833c9` | `assets/team-logos/london-eco-metal.png` | `3de073cd6427d4c87445a89ff514631f48d498cc390397d44b0610ffba138d11` |

The four decoded browser render hashes matched these exact public originals. Other teams retain the remote/default/initials fallback chain. Decorative crest layers ignore pointer events so adjacent dock targets remain reachable.

## TDD and verification

The implementation was developed with behavioral red/green coverage for dock contract and layout, destination routing, current-season team selection, metadata safety, logo fallback, keyboard takeover, preventable tab presses, modal lifecycle, standalone standings, and the exact four-logo registry. The seven review fixes each retain separate RED and GREEN logs in the external artifact directory.

Final frozen-source evidence records 172 passing UI tests, 27 screens and 41 registrations verified, 7 rebuild tests, 8 readiness tests, mobile typecheck success, and a forced 9-task workspace typecheck. ESLint exits zero: all 58 production warnings across nine pre-existing screens match the base-commit warning baseline, with zero introduced production messages; 28 remaining warnings are in tests. Offline browser QA records 311 assertions across 14 viewport cases, 23 More destinations, no assertion or harness errors, and no unexpected external requests. Independent iOS and web JavaScript exports exited zero and are hash-pinned externally.

## Limitations and rollback

This evidence covers reviewed source, offline React Native Web composition, and JavaScript export only. It does not claim a native build, signed archive, simulator or physical-device acceptance, live-user/auth acceptance, backend acceptance, upload, TestFlight, or App Store release. Keyboard geometry, native animation quality, Apple sign-in, push, signing, and distribution remain separate release-owner gates.

The pre-change source is `736218dd13a8bda5f4db4b3312c1be603d537421`, preserved by branch `backup/pre-mobile-web-dock-20260911`, tag `pre-mobile-web-dock-20260911`, and the external `team-baseline.bundle`. Final delivery evidence adds a verified commit bundle, format patch, and binary diff. Roll back by reverting the final delivery commit, or restore the base from the preserved branch/tag/bundle after preserving any later work. Do not replace local app identity or release-counter decisions during rollback.
