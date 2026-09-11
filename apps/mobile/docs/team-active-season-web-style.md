# Team active-season and web-style delivery

## Data contract

The native Team surfaces resolve one operational-current season before loading any membership, roster, record, statistics, or schedule data. The reviewed Team-only rule is explicit: prefer `status = 'active'`, otherwise use `status = 'playoffs'` so the same ongoing season remains visible after automatic playoff advancement. Within one status, select newest non-null `start_date`, then newest non-null `created_at`, then stable ascending ID. They do not call the shared `getCurrentSeason` / `getActiveSeason` fallback behavior and never fall back to upcoming, completed, draft, archived, undated, arbitrary, or unscoped seasons.

`src/lib/supabase/team.ts` is a Team-only read boundary for the Team tab:

- selected-league assignment: player + league + operational-current season + active roster status + `end_date IS NULL`;
- selected roster: team + league + operational-current season + active roster status + `end_date IS NULL`;
- global My Teams: each current roster row is validated against its own league's selected operational-current season;
- duplicate current memberships are collapsed deterministically and jersey ordering preserves `#0`;
- season lookup failures remain errors, while a successful lookup with no active row is an explicit empty state.

TeamDetail reuses the Team-only operational-current resolver, validates the route team against the route league, and applies that same season to `team_rosters`, `team_standings`, `games`, and `player_season_stats`. Current roster reads also require `end_date IS NULL`; an ended membership therefore cannot grant Team Chat through the rendered roster. The generated schema was inspected before selecting fields: `team_standings` has `season_id` but no `league_id`; `player_season_stats` has `season_id` and `team_id` but no `league_id`. Team-to-league validation makes those available view filters coherent. No shared Supabase defaults were changed.

## Pinned web translation

The visual source is the public Team page in the read-only web checkout at commit `e213a56b0f8332db34276fe6267ff8e9aa019250`, especially:

- `apps/league-sites/src/app/[leagueSlug]/teams/[teamSlug]/page.tsx` for the logo-first hero, prominent W-L-T record, compact stat pills, next game, schedule, and roster hierarchy;
- `apps/league-sites/src/components/team/TeamRosterToggle.tsx` for player identity and roster-stat emphasis;
- `apps/league-sites/src/components/schedule/TeamScheduleList.tsx` for schedule density and venue prominence;
- `apps/league-sites/src/app/globals.css` for the midnight background, public `rgba(10, 22, 40, 0.30)` glass, and `rgba(125, 190, 255, 0.22)` border.

The native adaptation keeps names and venues wrapping at phone widths and replaces the desktop table with vertical player cards containing avatar, jersey, position, C/A role, GP/G/A/PTS, and the existing player-card destination. TeamDetail schedule cards opt into GameCard's existing `homeEditorial` presentation so team and venue text remain content-sized, while shared GameCard defaults stay unchanged. Public Team panels use `.30` glass; captain controls and modals remain stronger surfaces. Reduce Transparency switches public panels to `#0C1B31` with `#41607F` borders, and Reduce Motion disables Team modal fades. No blur/font dependency was added.

## Preserved behavior and limits

Back, game, league-site, player-card, reminder, sub, goalie, lineup availability, bulletin, and alert flows remain wired to their existing helpers and routes. Team Chat is shown only when the authenticated viewer appears on the exact operational-current roster. Guests retain public game/player navigation but do not receive member chat or captain controls. A team/league identity change clears public team data, captain results, all dialog visibility and drafts, candidate caches, loading/saving IDs, and captain errors. Each asynchronous captain action captures its starting generation and original team/game/league parameters; results after any await boundary are ignored when the route has changed, without retrying or retargeting the issued operation.

Roster availability counts intersect check-ins with the displayed active roster, preventing game-specific substitutes from inflating roster IN/MAYBE/OUT totals. The shared captain authorization and team-message helpers remain unchanged; any broader season authorization policy in those shared services is outside this Team-only delivery.

Tests use synthetic `.invalid` identities and in-memory Supabase query doubles only. They do not prove live RLS/data availability, production correctness, native-device rendering, signed builds, TestFlight, or release acceptance.
