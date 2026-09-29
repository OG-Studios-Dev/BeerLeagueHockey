export type DashboardRouteClassification =
  | 'canonical-workspace'
  | 'canonical-settings'
  | 'detail-route'
  | 'public-supporting'
  | 'redirect-shim'
  | 'candidate-delete';

export type DashboardRouteInventoryEntry = {
  route: string;
  classification: DashboardRouteClassification;
  canonicalPath: string;
};

export type DashboardRouteRedirectMapEntry = {
  from: string;
  to: string;
  owner: string;
  notes: string;
};

export const DASHBOARD_ROUTE_INVENTORY = [
  { route: '/', classification: 'canonical-workspace', canonicalPath: '/dashboard' },
  { route: '/admin', classification: 'public-supporting', canonicalPath: '/dashboard/admin' },
  { route: '/admin/migrations', classification: 'public-supporting', canonicalPath: '/dashboard/admin/migrations' },
  { route: '/admin/player-merge', classification: 'public-supporting', canonicalPath: '/dashboard/admin/player-merge' },
  { route: '/analytics', classification: 'redirect-shim', canonicalPath: '/dashboard' },
  { route: '/captain/[teamId]', classification: 'detail-route', canonicalPath: '/dashboard/captain/[teamId]' },
  { route: '/company', classification: 'redirect-shim', canonicalPath: '/dashboard/settings' },
  { route: '/leagues', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues' },
  { route: '/leagues/new', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/new' },
  { route: '/leagues/[id]', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]' },
  { route: '/leagues/[id]/awards', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/awards' },
  { route: '/leagues/[id]/billing', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/billing' },
  { route: '/leagues/[id]/bugs', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/bugs' },
  { route: '/leagues/[id]/contact-inbox', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/contact-inbox' },
  { route: '/leagues/[id]/divisions', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/divisions' },
  { route: '/leagues/[id]/divisions/[divisionId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/divisions/[divisionId]' },
  { route: '/leagues/[id]/domains', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/domains' },
  { route: '/leagues/[id]/draft', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/draft' },
  { route: '/leagues/[id]/events', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/events' },
  { route: '/leagues/[id]/finance', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/finance' },
  { route: '/leagues/[id]/gallery', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/gallery' },
  { route: '/leagues/[id]/gallery/[albumId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/gallery/[albumId]' },
  { route: '/leagues/[id]/games', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/games' },
  { route: '/leagues/[id]/games/[gameId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/games/[gameId]' },
  { route: '/leagues/[id]/games/[gameId]/print-sheet', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/games/[gameId]/print-sheet' },
  { route: '/leagues/[id]/integrations', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/integrations' },
  { route: '/leagues/[id]/migration-center', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/migration-center' },
  { route: '/leagues/[id]/news', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/news' },
  { route: '/leagues/[id]/news/[articleId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/news/[articleId]' },
  { route: '/leagues/[id]/news/new', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/news/new' },
  { route: '/leagues/[id]/pages', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/pages' },
  { route: '/leagues/[id]/pages/[pageId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/pages/[pageId]' },
  { route: '/leagues/[id]/payments', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/payments' },
  { route: '/leagues/[id]/ratings', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/ratings' },
  { route: '/leagues/[id]/registrations', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/registrations' },
  { route: '/leagues/[id]/registrations/[registrationId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/registrations/[registrationId]' },
  { route: '/leagues/[id]/schedule', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/schedule' },
  { route: '/leagues/[id]/scorekeepers', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule' },
  { route: '/leagues/[id]/scorekeepers/schedule', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule' },
  { route: '/leagues/[id]/seasons', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons' },
  { route: '/leagues/[id]/seasons/new', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/new' },
  { route: '/leagues/[id]/seasons/[seasonId]', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]' },
  { route: '/leagues/[id]/seasons/[seasonId]/draft', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/draft' },
  { route: '/leagues/[id]/seasons/[seasonId]/edit', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/edit' },
  { route: '/leagues/[id]/seasons/[seasonId]/eligibility', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/eligibility' },
  { route: '/leagues/[id]/seasons/[seasonId]/games', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/games' },
  { route: '/leagues/[id]/seasons/[seasonId]/games/[gameId]', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/games/[gameId]' },
  { route: '/leagues/[id]/seasons/[seasonId]/players', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=players' },
  { route: '/leagues/[id]/seasons/[seasonId]/playoffs', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/playoffs' },
  { route: '/leagues/[id]/seasons/[seasonId]/ratings', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/ratings' },
  { route: '/leagues/[id]/seasons/[seasonId]/registrations', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/registrations' },
  { route: '/leagues/[id]/seasons/[seasonId]/rosters', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=rosters' },
  { route: '/leagues/[id]/seasons/[seasonId]/schedule', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/schedule' },
  { route: '/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule' },
  { route: '/leagues/[id]/seasons/[seasonId]/standings', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/standings' },
  { route: '/leagues/[id]/seasons/[seasonId]/teams', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/teams' },
  { route: '/leagues/[id]/settings', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings' },
  { route: '/leagues/[id]/settings/email-domain', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/email-domain' },
  { route: '/leagues/[id]/settings/game-rules', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/game-rules' },
  { route: '/leagues/[id]/settings/general', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/general' },
  { route: '/leagues/[id]/settings/goalie-pool', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/goalie-pool' },
  { route: '/leagues/[id]/settings/referees', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/referees' },
  { route: '/leagues/[id]/settings/registration', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/registration' },
  { route: '/leagues/[id]/settings/scorekeepers', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/scorekeepers' },
  { route: '/leagues/[id]/settings/venues', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/venues' },
  { route: '/leagues/[id]/settings/waiver', classification: 'canonical-settings', canonicalPath: '/dashboard/leagues/[id]/settings/waiver' },
  { route: '/leagues/[id]/social', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/social' },
  { route: '/leagues/[id]/spares', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/spares' },
  { route: '/leagues/[id]/sponsors', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/sponsors' },
  { route: '/leagues/[id]/staff', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/staff' },
  { route: '/leagues/[id]/teams', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/teams' },
  { route: '/leagues/[id]/teams/new', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/teams/new' },
  { route: '/leagues/[id]/teams/register', classification: 'detail-route', canonicalPath: '/dashboard/leagues/[id]/teams/register' },
  { route: '/leagues/[id]/teams-divisions', classification: 'canonical-workspace', canonicalPath: '/dashboard/leagues/[id]/teams-divisions' },
  { route: '/leagues/[id]/website', classification: 'public-supporting', canonicalPath: '/dashboard/leagues/[id]/website' },
  { route: '/seasons/[seasonId]/eligibility', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/eligibility' },
  { route: '/seasons/[seasonId]/schedule', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/schedule' },
  { route: '/seasons/[seasonId]/standings', classification: 'redirect-shim', canonicalPath: '/dashboard/leagues/[id]/seasons/[seasonId]/standings' },
  { route: '/settings', classification: 'canonical-settings', canonicalPath: '/dashboard/settings' },
  { route: '/settings/billing', classification: 'public-supporting', canonicalPath: '/dashboard/settings/billing' },
  { route: '/settings/billing/cancel', classification: 'public-supporting', canonicalPath: '/dashboard/settings/billing/cancel' },
  { route: '/settings/billing/success', classification: 'public-supporting', canonicalPath: '/dashboard/settings/billing/success' },
  { route: '/settings/branding', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/branding' },
  { route: '/settings/domains', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/domains' },
  { route: '/settings/members', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/members' },
  { route: '/settings/notifications', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/notifications' },
  { route: '/settings/privacy', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/privacy' },
  { route: '/settings/subscription', classification: 'canonical-settings', canonicalPath: '/dashboard/settings/subscription' },
  { route: '/staff', classification: 'canonical-workspace', canonicalPath: '/dashboard/staff' },
  { route: '/staffing/availability', classification: 'public-supporting', canonicalPath: '/dashboard/staffing/availability' },
  { route: '/teams', classification: 'public-supporting', canonicalPath: '/dashboard/teams' },
  { route: '/teams/[teamId]', classification: 'detail-route', canonicalPath: '/dashboard/teams/[teamId]' },
  { route: '/teams/[teamId]/settings', classification: 'detail-route', canonicalPath: '/dashboard/teams/[teamId]/settings' },
] as const satisfies readonly DashboardRouteInventoryEntry[];

export const DASHBOARD_ROUTE_CLASSIFICATIONS = Object.fromEntries(
  DASHBOARD_ROUTE_INVENTORY.map((entry) => [entry.route, entry])
) as Record<string, DashboardRouteInventoryEntry>;



export const DASHBOARD_REDIRECT_MAP = [
  {
    from: '/dashboard/analytics',
    to: '/dashboard',
    owner: 'dashboard landing and league/season entry router',
    notes: 'Legacy analytics page is no longer a standalone workspace. Send traffic back through the canonical dashboard entry flow.',
  },
  {
    from: '/dashboard/company',
    to: '/dashboard/settings',
    owner: 'organization sidebar settings entry',
    notes: 'Legacy org settings alias. Keep redirect compatibility, stop linking here.',
  },
  {
    from: '/dashboard/staffing/*',
    to: '/dashboard/staff',
    owner: 'organization sidebar staff entry',
    notes: 'Legacy staffing family is a compatibility entry point only.',
  },
  {
    from: '/dashboard/leagues/[id]/draft',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/draft',
    owner: 'season tabs, Draft',
    notes: 'Draft lives in the active season workspace.',
  },
  {
    from: '/dashboard/leagues/[id]/games',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/games',
    owner: 'season tabs, Games',
    notes: 'Game ops should be reachable from season tabs, not a league-level selector route.',
  },
  {
    from: '/dashboard/leagues/[id]/ratings',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/ratings',
    owner: 'season tools, Ratings',
    notes: 'Ratings are season-scoped.',
  },
  {
    from: '/dashboard/leagues/[id]/registrations',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/registrations',
    owner: 'season tabs, Registrations',
    notes: 'Registration management belongs to the active season workspace.',
  },
  {
    from: '/dashboard/leagues/[id]/schedule',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/schedule',
    owner: 'season tabs, Schedule',
    notes: 'Scheduling depends on active season context.',
  },
  {
    from: '/dashboard/leagues/[id]/scorekeepers',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule',
    owner: 'season tools, Scorekeeper Schedule',
    notes: 'Collapse scorekeeper entry points into the season schedule tool.',
  },
  {
    from: '/dashboard/leagues/[id]/scorekeepers/schedule',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/scorekeeper-schedule',
    owner: 'season tools, Scorekeeper Schedule',
    notes: 'Duplicate scorekeeper route family redirected to canonical season path.',
  },
  {
    from: '/dashboard/leagues/[id]/teams',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/teams',
    owner: 'season tabs, Teams',
    notes: 'Teams and roster workflows should start from the season workspace.',
  },
  {
    from: '/dashboard/leagues/[id]/seasons/[seasonId]/players',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=players',
    owner: 'season tabs, Teams',
    notes: 'Players is a view inside the Teams workspace, not a separate primary route.',
  },
  {
    from: '/dashboard/leagues/[id]/seasons/[seasonId]/rosters',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/teams?tab=rosters',
    owner: 'season tabs, Teams',
    notes: 'Rosters stays reachable, but its menu home is Teams.',
  },
  {
    from: '/dashboard/seasons/[seasonId]/eligibility',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/eligibility',
    owner: 'season tools, Eligibility',
    notes: 'Legacy short route keeps compatibility only.',
  },
  {
    from: '/dashboard/seasons/[seasonId]/schedule',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/schedule',
    owner: 'season tabs, Schedule',
    notes: 'Legacy short route keeps compatibility only.',
  },
  {
    from: '/dashboard/seasons/[seasonId]/standings',
    to: '/dashboard/leagues/[id]/seasons/[seasonId]/standings',
    owner: 'season tabs, Standings',
    notes: 'Legacy short route keeps compatibility only.',
  },
] as const satisfies readonly DashboardRouteRedirectMapEntry[];

export const DASHBOARD_LEGACY_ROUTE_FAMILIES = [
  '/dashboard/analytics',
  '/dashboard/company',
  '/dashboard/staffing',
  '/dashboard/seasons/',
  '/dashboard/leagues/[id]/draft',
  '/dashboard/leagues/[id]/games',
  '/dashboard/leagues/[id]/ratings',
  '/dashboard/leagues/[id]/registrations',
  '/dashboard/leagues/[id]/schedule',
  '/dashboard/leagues/[id]/scorekeepers',
  '/dashboard/leagues/[id]/teams',
] as const;

export const DASHBOARD_ROUTE_CLASSIFICATION_COUNTS = DASHBOARD_ROUTE_INVENTORY.reduce<Record<DashboardRouteClassification, number>>(
  (counts, entry) => {
    counts[entry.classification] += 1;
    return counts;
  },
  {
    'canonical-workspace': 0,
    'canonical-settings': 0,
    'detail-route': 0,
    'public-supporting': 0,
    'redirect-shim': 0,
    'candidate-delete': 0,
  }
);
