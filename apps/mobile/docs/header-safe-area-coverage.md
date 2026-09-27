# Header safe-area coverage

The app has one root `SafeAreaProvider` in `App.tsx`. Standard stack routes render the shared `CutIceTitle`; that masthead owns the device top inset and keeps its original 62-point content area below it. `CutIceScreenBoundary` then supplies `top: 0` only to the titled route's screen content, preventing the screen's own `SafeAreaView edges={['top']}` from applying the inset a second time.

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
- Titled route content receives a zero top inset from `CutIceScreenBoundary`.
- Custom/headerless routes bypass that boundary and retain the provider's top inset.
- Bottom, left, and right insets are preserved for every route.

The contract test exercises `CutIceTitle` itself at top insets 0 (landscape/no unsafe top), 20 (flat-status-bar device), 47 (notched device), and 59 (Dynamic Island device), plus root, pushed, and headerless screen-boundary behavior.
