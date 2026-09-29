# League Builder dashboard route manifest

Purpose: define the current dashboard route inventory and the canonical links the rebuilt IA should use. Compatibility redirects can stay in place, but navigation, command palette entries, and new links should point to the canonical targets below.

## Coverage snapshot

- Inventory source of truth: `src/lib/dashboard/route-inventory.ts`
- Dashboard page routes classified: 93 / 93
- Coverage is enforced by `src/lib/dashboard/__tests__/route-inventory.test.ts`

## Menu and tab ownership

### Organization menu

| Menu home | Owns | Notes |
| --- | --- | --- |
| `/dashboard` | org overview | Default landing page |
| `/dashboard/leagues` | league index, create-league discovery | Main org workflow |
| `/dashboard/staff` | org-level staff pool, staffing availability redirects | `/dashboard/staffing/*` stays compatibility-only |
| `/dashboard/settings` | org settings, domains, members, billing, branding, privacy, notifications, subscription | Stop linking to `/dashboard/company` |

### League menu

| Menu home | Owns | Notes |
| --- | --- | --- |
| `/dashboard/leagues/[id]` | league overview | League workspace root |
| `/dashboard/leagues/[id]/seasons` | season list and season creation | Primary way into season workflows |
| `/dashboard/leagues/[id]/finance` | league finance workspace | Payments can link here as supporting context |
| `/dashboard/leagues/[id]/settings` | league settings family | Divisions and staff stay discoverable from league nav groups |

### Season tabs and tools

| Menu/tab home | Owns | Notes |
| --- | --- | --- |
| `/dashboard/leagues/[id]/seasons/[seasonId]` | season overview | Season workspace root |
| `/dashboard/leagues/[id]/seasons/[seasonId]/registrations` | registration workflow | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/teams` | teams, players, rosters | `players` and `rosters` stay as views under Teams |
| `/dashboard/leagues/[id]/seasons/[seasonId]/schedule` | schedule workflow | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/games` | game ops | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/standings` | standings | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/playoffs` | playoffs | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/draft` | draft workflow | Canonical season path |
| `/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule` | scorekeeper workflow | Season tool, not league home |
| `/dashboard/leagues/[id]/seasons/[seasonId]/ratings` | ratings | Season tool |
| `/dashboard/leagues/[id]/seasons/[seasonId]/eligibility` | eligibility | Season tool |
| `/dashboard/leagues/[id]/seasons/[seasonId]/edit` | season settings/edit | Season tool |

## Explicit redirect map

| Legacy / duplicate path | Canonical path | Menu/tab owner | Notes |
| --- | --- | --- | --- |
| `/dashboard/company` | `/dashboard/settings` | Organization Settings | Keep redirect compatibility, stop linking to `/company` |
| `/dashboard/staffing/*` | `/dashboard/staff` | Staff Pool | Legacy staffing family only |
| `/dashboard/leagues/[id]/draft` | `/dashboard/leagues/[id]/seasons/[seasonId]/draft` | Season tab: Draft | Collapse draft discovery into season workspace |
| `/dashboard/leagues/[id]/games` | `/dashboard/leagues/[id]/seasons/[seasonId]/games` | Season tab: Games | Collapse league-level selector route |
| `/dashboard/leagues/[id]/ratings` | `/dashboard/leagues/[id]/seasons/[seasonId]/ratings` | Season tool: Ratings | Season-scoped |
| `/dashboard/leagues/[id]/registrations` | `/dashboard/leagues/[id]/seasons/[seasonId]/registrations` | Season tab: Registrations | Season-scoped |
| `/dashboard/leagues/[id]/schedule` | `/dashboard/leagues/[id]/seasons/[seasonId]/schedule` | Season tab: Schedule | Season-scoped |
| `/dashboard/leagues/[id]/scorekeepers` | `/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule` | Season tool: Scorekeeper Schedule | Duplicate family |
| `/dashboard/leagues/[id]/scorekeepers/schedule` | `/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule` | Season tool: Scorekeeper Schedule | Duplicate family |
| `/dashboard/leagues/[id]/teams` | `/dashboard/leagues/[id]/seasons/[seasonId]/teams` | Season tab: Teams | Teams workflow starts from season workspace |
| `/dashboard/leagues/[id]/seasons/[seasonId]/players` | `/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=players` | Season tab: Teams | Players is a teams view |
| `/dashboard/leagues/[id]/seasons/[seasonId]/rosters` | `/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=rosters` | Season tab: Teams | Rosters is a teams view |
| `/dashboard/seasons/[seasonId]/eligibility` | `/dashboard/leagues/[id]/seasons/[seasonId]/eligibility` | Season tool: Eligibility | Legacy short path |
| `/dashboard/seasons/[seasonId]/schedule` | `/dashboard/leagues/[id]/seasons/[seasonId]/schedule` | Season tab: Schedule | Legacy short path |
| `/dashboard/seasons/[seasonId]/standings` | `/dashboard/leagues/[id]/seasons/[seasonId]/standings` | Season tab: Standings | Legacy short path |

## Secondary but supported routes

These stay reachable, but they are not the primary path for core workflows:

- League support and ops: `/billing`, `/website`, `/integrations`, `/news`, `/pages`, `/sponsors`, `/gallery`, `/events`, `/awards`, `/staff`, `/contact-inbox`, `/bugs`, `/migration-center`, `/spares`
- Admin support: `/dashboard/admin`, `/dashboard/admin/migrations`, `/dashboard/admin/player-merge`, `/dashboard/admin/owner-view`
- Detail routes: captain, team detail, division detail, gallery album, game detail, article detail, registration detail, and similar drill-in pages

## Rebuild rule of thumb

If a destination depends on the active season, link directly into the season workspace route, not the older league-scoped selector route.
