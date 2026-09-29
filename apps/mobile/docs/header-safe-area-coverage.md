# Header safe-area coverage

The app has one root `SafeAreaProvider` in `App.tsx`. Standard stack routes render the shared `CutIceTitle`; that masthead owns the device top inset and keeps its original 62-point content area below it. Their screen frames use the centralized `cutIceContentEdges` policy to turn off only the native top edge. `CutIceScreenBoundary` no longer rewrites safe-area context, so the physical JavaScript inset remains available to the shared header and full-screen modal content.

## Registered route inventory

| Navigator | Route registrations | Title treatment |
| --- | --- | --- |
| Auth | Splash, Login, ForgotPassword, SignUp | Shared `CutIceTitle` |
| Root tabs | Home | Custom in-screen `HomeLeagueHero`; screen retains its own top safe area |
| Standings | ScheduleList, GamePreview, GameRecap | Shared `CutIceTitle` (`Standings`, `Game Preview`, `Game Recap`) |
| Schedule | ScheduleList, GamePreview, GameRecap | Shared `CutIceTitle` (`Schedule`, `Game Preview`, `Game Recap`) |
| Stats | StatsMain, Leaderboards, CareerStats | Shared `CutIceTitle` |
| Team | TeamList, PlayerCard | Shared `CutIceTitle` |
| Team | TeamDetail | Header hidden; custom team hero retains its own top safe area |
| Captain | CaptainDashboard, GameAvailability | Shared `CutIceTitle` |
| Profile | ProfileMain, EditProfile, NotificationsFeed, NotificationSettings, PlayerCard, CareerStats | Shared `CutIceTitle` |
| League pages | TeamsDirectory, PlayersDirectory, PlayoffsDirectory, NewsFeed, NewsArticle, LeagueHistory, GalleryAlbums, GalleryAlbum, Events, Contact, LeaguePlayerCard, LeagueGamePreview | Shared `CutIceTitle` |
| League pages | LeagueTeamDetail | Header hidden; reuses the custom TeamDetail hero and its top safe area |

This covers all 38 native stack/tab registrations in `App.tsx` and `src/navigation/index.tsx`: 35 shared mastheads and 3 intentional custom/headerless surfaces.

## Non-route overlays and dormant screens

- `LeagueMarketplace` is an in-screen sheet/modal. It selects its own safe-area edges based on presentation and is not wrapped in the shared stack masthead.
- `LeagueSelectScreen` is presented as auth flow content/overlay and owns its top safe area; it is not a registered `CutIceTitle` stack route.
- `TeamChatScreen`, `LineupNotesScreen`, `LeagueDiscoveryScreen`, and `LeagueDetailScreen` exist in source but are not registered in the current app navigators. Their local safe-area behavior is unchanged.

## Geometry contract

- Shared masthead total height: `62 + topInset`.
- Shared masthead top padding: `topInset`.
- Titled route screen frames omit `top` through `cutIceContentEdges`, causing the installed native safe-area consumer to emit `top: 'off'`.
- Custom/headerless routes bypass that boundary and retain the provider's top inset.
- Bottom, left, and right insets are preserved for every route.
- Full-screen modal roots continue to use the physical safe-area provider rather than the titled-content policy.

The contract test exercises `CutIceTitle` itself at top insets 0 (landscape/no unsafe top), 20 (flat-status-bar device), 47 (notched device), and 59 (Dynamic Island device). It also compiles the installed native `SafeAreaView` wrapper to verify `top: 'off'` for root and pushed titled routes, `top: 'additive'` for headerless exclusions, and preservation of the physical JavaScript inset.
