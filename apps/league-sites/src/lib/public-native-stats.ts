import { NextRequest, NextResponse } from 'next/server';

import {
  filterVisiblePlayerCareerTimelineRows,
  getDivisions,
  getLeagueBySlug,
  getPlayerCareerStatsTimeline,
  getPlayerProfile,
  getUnifiedGoalieStatsRows,
  hasPlatformSubscription,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { isHistoricalCareerBaselineSeasonName } from '@/lib/all-time-stats';
import { isImportedAggregateSeasonId } from '@/lib/imported-aggregate-season-overrides';
import { pickOperationalSeason } from '@/lib/seasons/operational';
import {
  aggregatePublicSeasonStats,
  assertRequiredPrivilegedMetricConfig,
  readMetricSeason,
  readPublicStatMetricRows,
  type PublicGoalieMetricGroup,
  type PublicMetricSource,
  type PublicMetricState,
  type PublicSeasonMetricPlayer,
  type PublicStatMetric,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { UnifiedGoalieStatsRow } from '@/lib/types';

export const PUBLIC_NATIVE_STATS_SCHEMA_VERSION = 1 as const;
export const MAX_CAREER_ROWS = 500;
export const MAX_GOALIE_ROWS = 200;
export const MAX_PUBLIC_STATS_RESPONSE_BYTES = 256 * 1024;
export const MAX_CAREER_METRIC_SEASONS = 32;
export const MAX_CAREER_METRIC_SOURCE_ROWS = 50_000;
const MAX_CAREER_SCOPE_ROWS_PER_SOURCE = 8_000;

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_DOMAIN = 'beerleaguehockey.ca';
const DEV_DOMAINS = ['localhost', '127.0.0.1', '.local'];
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'builder', 'auth', 'cdn', 'static', 'assets',
]);
const SUPPORT_PAGE_SIZE = 1000;
const MAX_SUPPORT_STAT_ROWS = 50_000;

type PublicLeague = {
  id: string;
  slug: string;
  status: string;
  custom_domain?: string | null;
  custom_domain_verified?: boolean | null;
};

type PublicSeason = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
};

type PublicDivision = {
  id: string;
  league_id: string;
};

type PublicPlayer = {
  player_id: string;
  position: string | null;
  is_goalie?: boolean;
  profile?: {
    full_name: string | null;
    avatar_url: string | null;
    photo_url?: string | null;
  };
};

type PublicProfileIdentity = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  photo_url?: string | null;
};

type PublicCareerBaseline = {
  id: string;
  is_goalie: boolean;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  wins?: number; ties?: number; saves?: number; goals_against?: number; shutouts?: number;
  goals_against_average?: number; save_percentage?: number;
};

export type CareerPenaltyRow = {
  id: string;
  season_id: string;
  team_id: string;
  penalty_minutes: number | null;
};

export type CareerScope = {
  isEligible: boolean;
  isGoalie: boolean;
  seasonCatalog: Array<{ id: string; name: string }>;
  canonicalSeasonIds?: string[];
  penaltyRows: CareerPenaltyRow[];
  canonicalSourceRowCount: number;
  historicalBaselineSourceRowCount?: number;
  careerBaseline?: PublicCareerBaseline;
};

export interface PublicNativeStatsDependencies {
  getLeagueBySlug(slug: string): Promise<PublicLeague | null>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
  readPresentationSeason(leagueId: string): Promise<PublicSeason | null>;
  getDivisions(leagueId: string): Promise<PublicDivision[]>;
  getPlayerProfile(playerId: string): Promise<PublicPlayer | null>;
  readPublicProfileIdentity(playerId: string): Promise<PublicProfileIdentity | null>;
  getPlayerCareerStatsTimeline(
    leagueId: string,
    playerId: string,
    isGoalie: boolean,
    options: { includeHistoricalBaseline?: boolean },
  ): Promise<PlayerCareerSeasonRow[]>;
  filterVisiblePlayerCareerTimelineRows(
    rows: PlayerCareerSeasonRow[],
    options: { includeHistoricalBaseline?: boolean },
  ): PlayerCareerSeasonRow[];
  getUnifiedGoalieStatsRows(
    leagueId: string,
    seasonId?: string | null,
    divisionId?: string,
    leagueSlug?: string,
    seasonName?: string | null,
  ): Promise<UnifiedGoalieStatsRow[]>;
  readCareerScope(leagueId: string, playerId: string): Promise<CareerScope>;
  readGoalieStatsSourceCount(leagueId: string, seasonId: string, divisionId?: string): Promise<number>;
  readMetricSeason?(leagueId: string, seasonId: string): Promise<PublicSeason | null>;
  requirePrivilegedAccess(): void;
  readCareerMetricSeasonIds(leagueId: string, playerId: string): Promise<string[]>;
  loadMetricRows?(scope: { leagueId: string; seasonId: string; divisionId?: string | null; teamId?: string | null; playerId?: string }): Promise<PublicStatMetricRows>;
}

class PayloadLimitError extends Error {}
class DataIntegrityError extends Error {}

function jsonError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ...details } },
    {
      status,
      headers: {
        'Cache-Control': ERROR_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function jsonSuccess(payload: unknown) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_PUBLIC_STATS_RESPONSE_BYTES) {
    throw new PayloadLimitError('serialized response limit exceeded');
  }
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': SUCCESS_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function finiteNumber(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataIntegrityError('nonfinite canonical number');
  }
  return value;
}

function nonnegativeNumber(value: number): number {
  const checked = finiteNumber(value);
  if (checked < 0) throw new DataIntegrityError('negative canonical number');
  return checked;
}

function nullableNonnegativeNumber(value: number | null): number | null {
  return value === null ? null : nonnegativeNumber(value);
}

function validateSlug(slug: string | null): string | NextResponse {
  if (slug === null) return jsonError(400, 'INVALID_QUERY', 'leagueSlug is required.');
  if (slug.length > 63 || !SLUG_PATTERN.test(slug)) {
    return jsonError(400, 'INVALID_LEAGUE_SLUG', 'leagueSlug must be a lowercase ASCII host slug.');
  }
  return slug;
}

function validateExactQueryKeys(request: NextRequest, allowed: Set<string>): NextResponse | null {
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!allowed.has(key)) {
      return jsonError(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
    }
  }
  for (const key of allowed) {
    if (request.nextUrl.searchParams.getAll(key).length > 1) {
      return jsonError(400, 'INVALID_QUERY', `Query parameter ${key} must appear once.`);
    }
  }
  return null;
}

type TenantHost =
  | { kind: 'slug'; slug: string }
  | { kind: 'custom'; hostname: string }
  | { kind: 'unbound' };

function getTenantHost(hostHeader: string | null): TenantHost {
  if (!hostHeader) return { kind: 'unbound' };
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  const isDevHost = DEV_DOMAINS.some((dev) => host === dev || host.endsWith(dev));
  if (isDevHost) {
    const parts = host.split('.');
    const candidate = parts.length > 1 && parts[0] !== 'www' ? parts[0] : null;
    return candidate && SLUG_PATTERN.test(candidate)
      ? { kind: 'slug', slug: candidate }
      : { kind: 'unbound' };
  }
  if (host !== PRODUCTION_DOMAIN && !host.endsWith(`.${PRODUCTION_DOMAIN}`)) {
    return { kind: 'custom', hostname: host.replace(/^www\./, '') };
  }
  if (host === PRODUCTION_DOMAIN) return { kind: 'unbound' };
  let candidate = host.slice(0, -`.${PRODUCTION_DOMAIN}`.length);
  if (candidate.endsWith('.sites')) candidate = candidate.slice(0, -'.sites'.length);
  if (candidate.includes('.') || RESERVED_SUBDOMAINS.has(candidate)) return { kind: 'unbound' };
  return SLUG_PATTERN.test(candidate) ? { kind: 'slug', slug: candidate } : { kind: 'unbound' };
}

function tenantMismatchBeforeLookup(request: NextRequest, leagueSlug: string): NextResponse | TenantHost {
  const tenantHost = getTenantHost(request.headers.get('host'));
  if (tenantHost.kind === 'slug' && tenantHost.slug !== leagueSlug) {
    return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
  }
  return tenantHost;
}

function validateResolvedCustomDomain(league: PublicLeague, tenantHost: TenantHost): NextResponse | null {
  if (tenantHost.kind !== 'custom') return null;
  const verifiedDomain = league.custom_domain_verified
    ? league.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') ?? null
    : null;
  return verifiedDomain === tenantHost.hostname
    ? null
    : jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
}

async function requirePublicLeague(
  leagueSlug: string,
  tenantHost: TenantHost,
  deps: PublicNativeStatsDependencies,
): Promise<PublicLeague | NextResponse> {
  const league = await deps.getLeagueBySlug(leagueSlug);
  if (!league || league.status !== 'active') {
    return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
  }
  const customMismatch = validateResolvedCustomDomain(league, tenantHost);
  if (customMismatch) return customMismatch;
  if (!(await deps.hasPlatformSubscription(league.id))) {
    return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
  }
  return league;
}

export async function readAllPenaltyRows(leagueId: string, playerId: string): Promise<{
  rows: CareerPenaltyRow[];
  count: number;
}> {
  const supabase = await createClient();
  const buildQuery = () => supabase
    .from('player_stats')
    .select('id, season_id, team_id, penalty_minutes, game:games!inner(id)', { count: 'exact' })
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .eq('game.status', 'completed')
    .order('id', { ascending: true });

  const first = await buildQuery().range(0, SUPPORT_PAGE_SIZE - 1);
  if (first.error) throw new DataIntegrityError('player stats source read failed');
  if (!Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) {
    throw new DataIntegrityError('player stats source count missing');
  }
  const total = first.count as number;
  if (total > MAX_SUPPORT_STAT_ROWS) throw new PayloadLimitError('support stat row limit exceeded');
  const rows = [...(first.data ?? [])] as CareerPenaltyRow[];
  for (let offset = SUPPORT_PAGE_SIZE; offset < total; offset += SUPPORT_PAGE_SIZE) {
    const page = await buildQuery().range(offset, offset + SUPPORT_PAGE_SIZE - 1);
    if (page.error) throw new DataIntegrityError('player stats source page failed');
    if (page.count !== total) throw new DataIntegrityError('player stats source count changed');
    rows.push(...((page.data ?? []) as CareerPenaltyRow[]));
  }
  if (rows.length !== total) throw new DataIntegrityError('incomplete player stats source read');
  const ids = new Set<string>();
  for (const row of rows) {
    if (!UUID_PATTERN.test(row.id)) throw new DataIntegrityError('invalid player stats source id');
    if (ids.has(row.id)) throw new DataIntegrityError('duplicate player stats source id');
    ids.add(row.id);
  }
  return { rows, count: total };
}

export async function readPresentationSeason(leagueId: string): Promise<PublicSeason | null> {
  const supabase = await createClient();
  const result = await supabase
    .from('seasons')
    .select('*')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (result.error || !result.data) throw new DataIntegrityError('current season read failed');
  return pickOperationalSeason(result.data as PublicSeason[]);
}

export async function readPublicProfileIdentity(playerId: string): Promise<PublicProfileIdentity | null> {
  const supabase = await createClient();
  const result = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, photo_url')
    .eq('id', playerId)
    .maybeSingle();
  if (result.error) throw new DataIntegrityError('public profile identity read failed');
  return result.data as PublicProfileIdentity | null;
}

export async function readCareerScope(
  leagueId: string,
  playerId: string,
): Promise<CareerScope> {
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const [seasonResult, membershipResult, penaltyResult, goalieSourceResult, baselineResult] = await Promise.all([
    supabase.from('seasons').select('id, name').eq('league_id', leagueId).limit(MAX_CAREER_ROWS + 1),
    supabase
      .from('team_rosters')
      .select('id, position, is_goalie, joined_at', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .order('joined_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(1),
    readAllPenaltyRows(leagueId, playerId),
    supabase
      .from('goalie_stats')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('player_id', playerId),
    serviceSupabase
      .from('player_career_baselines')
      .select('id, is_goalie, games_played, goals, assists, points, wins, ties, saves, goals_against, shutouts, goals_against_average, save_percentage', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .limit(2),
  ]);

  if (
    seasonResult.error
    || membershipResult.error
    || membershipResult.count === null
    || goalieSourceResult.error
    || goalieSourceResult.count === null
    || baselineResult.error
    || baselineResult.count === null
  ) {
    throw new DataIntegrityError('career scope read failed');
  }
  for (const count of [membershipResult.count, goalieSourceResult.count, baselineResult.count]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new DataIntegrityError('career scope source count invalid');
    }
  }
  if ((seasonResult.data?.length ?? 0) > MAX_CAREER_ROWS) {
    throw new PayloadLimitError('season catalog limit exceeded');
  }
  const seasonCatalog = (seasonResult.data ?? []) as Array<{ id: string; name: string }>;
  const rosterRows = (membershipResult.data ?? []) as Array<{
    position: string | null;
    is_goalie: boolean | null;
  }>;
  if (membershipResult.count > 0 && rosterRows.length !== 1) {
    throw new DataIntegrityError('latest career roster role missing');
  }
  const baselineRows = (baselineResult.data ?? []) as PublicCareerBaseline[];
  if (baselineResult.count > 1 || baselineRows.length !== baselineResult.count) {
    throw new DataIntegrityError('ambiguous career baseline records');
  }
  const careerBaseline = baselineRows[0];
  const rosterRole = rosterRows[0];
  const rosterPosition = rosterRole?.position?.trim().toLowerCase() || null;
  const hasRosterRole = Boolean(rosterRole && (rosterRole.is_goalie !== null || rosterPosition));
  const normalizedPosition = hasRosterRole
    ? rosterPosition
    : null;
  const isGoalie = hasRosterRole
    ? rosterRole?.is_goalie === true || normalizedPosition === 'g' || normalizedPosition === 'goalie'
    : careerBaseline?.is_goalie === true;
  const historicalBaselineSourceRowCount = baselineResult.count;
  const recordedSourceRowCount = penaltyResult.count + goalieSourceResult.count;
  return {
    isEligible: membershipResult.count > 0 || recordedSourceRowCount > 0 || historicalBaselineSourceRowCount > 0,
    isGoalie,
    seasonCatalog,
    penaltyRows: penaltyResult.rows,
    canonicalSourceRowCount: isGoalie ? goalieSourceResult.count : penaltyResult.count,
    historicalBaselineSourceRowCount,
    ...(careerBaseline ? { careerBaseline } : {}),
  };
}

export async function readGoalieStatsSourceCount(
  leagueId: string,
  seasonId: string,
  divisionId?: string,
): Promise<number> {
  const supabase = await createClient();
  let teamIds: string[] | null = null;
  if (divisionId) {
    const teamResult = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .eq('division_id', divisionId);
    if (teamResult.error) throw new DataIntegrityError('goalie team scope read failed');
    teamIds = (teamResult.data ?? []).map((team) => team.id);
    if (teamIds.length === 0) return 0;
  }

  let query = supabase
    .from('goalie_stats')
    .select('id, game:games!inner(id)', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('game.status', 'completed');
  if (teamIds) query = query.in('team_id', teamIds);
  const result = await query;
  if (result.error || result.count === null) {
    throw new DataIntegrityError('goalie stats source read failed');
  }
  let rosterQuery = supabase
    .from('team_rosters')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .is('end_date', null);
  if (teamIds) rosterQuery = rosterQuery.in('team_id', teamIds);
  const rosterHealth = await rosterQuery;
  if (rosterHealth.error || rosterHealth.count === null) {
    throw new DataIntegrityError('goalie roster source health read failed');
  }
  if (result.count === 0) {
    const gameHealth = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'completed');
    if (gameHealth.error || gameHealth.count === null) {
      throw new DataIntegrityError('goalie fallback source health read failed');
    }
  }
  return result.count;
}

export async function readCareerMetricSeasonIds(leagueId: string, playerId: string): Promise<string[]> {
  assertRequiredPrivilegedMetricConfig();
  const client = createServiceRoleClient();
  const resultSets = await Promise.all([
    client.from('team_rosters').select('season_id', { count: 'exact' }).eq('league_id', leagueId).eq('player_id', playerId).eq('status', 'active').eq('player_type', 'regular').order('season_id').limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
    client.from('player_stats').select('season_id', { count: 'exact' }).eq('league_id', leagueId).eq('player_id', playerId).order('season_id').limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
    client.from('goalie_stats').select('season_id', { count: 'exact' }).eq('league_id', leagueId).eq('player_id', playerId).order('season_id').limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
    client.from('game_goalie_appearances').select('game:games!inner(season_id)', { count: 'exact' }).eq('player_id', playerId).eq('game.league_id', leagueId).limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
    client.from('game_checkins').select('game:games!inner(season_id)', { count: 'exact' }).eq('player_id', playerId).eq('game.league_id', leagueId).eq('game.status', 'completed').limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
    client.from('sub_invitations').select('game:games!inner(season_id)', { count: 'exact' }).eq('invited_player_id', playerId).eq('status', 'accepted').eq('game.league_id', leagueId).eq('game.status', 'completed').limit(MAX_CAREER_SCOPE_ROWS_PER_SOURCE),
  ]);
  let sourceRows = 0;
  for (const result of resultSets) {
    if (result.error || !Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) {
      throw new DataIntegrityError('career metric source scope read failed');
    }
    if ((result.count as number) > MAX_CAREER_SCOPE_ROWS_PER_SOURCE) throw new PayloadLimitError('career metric source scope per-source limit exceeded');
    sourceRows += result.count as number;
  }
  if (sourceRows > MAX_CAREER_METRIC_SOURCE_ROWS) throw new PayloadLimitError('career metric source scope work limit exceeded');
  const seasonIds = resultSets.flatMap((result, index) => ((result.data ?? []) as unknown[]).flatMap((row: unknown) => {
    if (index < 3) return [(row as { season_id?: string }).season_id];
    const game = (row as { game?: { season_id?: string } | Array<{ season_id?: string }> }).game;
    return Array.isArray(game) ? game.map((value) => value.season_id) : [game?.season_id];
  })).filter((seasonId): seasonId is string => typeof seasonId === 'string');
  return [...new Set(seasonIds)];
}

const defaultDependencies: PublicNativeStatsDependencies = {
  getLeagueBySlug,
  hasPlatformSubscription,
  readPresentationSeason,
  getDivisions,
  getPlayerProfile,
  readPublicProfileIdentity,
  getPlayerCareerStatsTimeline,
  filterVisiblePlayerCareerTimelineRows,
  getUnifiedGoalieStatsRows,
  readCareerScope,
  readGoalieStatsSourceCount,
  readMetricSeason,
  requirePrivilegedAccess: assertRequiredPrivilegedMetricConfig,
  readCareerMetricSeasonIds,
  loadMetricRows: readPublicStatMetricRows,
};

function careerError(error: unknown, leagueSlug: string) {
  if (error instanceof PayloadLimitError) {
    return jsonError(503, 'PAYLOAD_LIMIT_EXCEEDED', 'Player career data exceeds the complete response limit.');
  }
  console.error('[public-player-career] public read failed', {
    leagueSlug,
    errorType: error instanceof Error ? error.name : 'unknown',
  });
  return jsonError(503, 'CAREER_DATA_UNAVAILABLE', 'Player career data is temporarily unavailable.');
}

function goalieError(error: unknown, leagueSlug: string) {
  if (error instanceof PayloadLimitError) {
    return jsonError(503, 'PAYLOAD_LIMIT_EXCEEDED', 'Goalie data exceeds the complete response limit.');
  }
  console.error('[public-goalies] public read failed', {
    leagueSlug,
    errorType: error instanceof Error ? error.name : 'unknown',
  });
  return jsonError(503, 'GOALIE_DATA_UNAVAILABLE', 'Goalie data is temporarily unavailable.');
}

function readContractVersion(request: NextRequest): 1 | 2 | NextResponse {
  const value = request.nextUrl.searchParams.get('contractVersion');
  if (value === null || value === '1') return 1;
  if (value === '2') return 2;
  return jsonError(400, 'UNSUPPORTED_CONTRACT_VERSION', 'contractVersion must be 1 or 2.');
}

function importedMetric(value: number): PublicStatMetric {
  return { value: nonnegativeNumber(value), state: 'reported', sources: ['imported'] };
}

function unknownMetric(sources: PublicMetricSource[] = []): PublicStatMetric {
  return { value: null, state: 'unknown', sources };
}

function timelineGoalieMetrics(row: PlayerCareerSeasonRow, imported: boolean): PublicGoalieMetricGroup {
  const metric = imported ? importedMetric : (value: number) => ({
    value: nonnegativeNumber(value), state: 'recorded' as const, sources: ['goalie_stats'] as PublicMetricSource[],
  });
  const saves = nonnegativeNumber(row.saves);
  const goalsAgainst = nonnegativeNumber(row.goals_against);
  const attempts = saves + goalsAgainst;
  return {
    gamesPlayed: metric(row.games_played),
    wins: metric(row.wins),
    losses: metric(row.losses),
    saves: metric(saves),
    goalsAgainst: metric(goalsAgainst),
    savePercentage: attempts > 0 ? metric(saves / attempts) : unknownMetric(imported ? ['imported'] : ['goalie_stats']),
    goalsAgainstAverage: row.games_played > 0 ? metric(goalsAgainst / row.games_played) : unknownMetric(imported ? ['imported'] : ['goalie_stats']),
    shutouts: metric(row.shutouts),
  };
}

function combinePublicMetrics(metrics: PublicStatMetric[]): PublicStatMetric {
  if (metrics.length === 0) return unknownMetric();
  const metricSources = [...new Set(metrics.flatMap((metric) => metric.sources))];
  if (metrics.some((metric) => metric.state === 'conflicted')) return { value: null, state: 'conflicted', sources: metricSources };
  if (metrics.some((metric) => metric.state === 'unknown' || metric.value === null)) return { value: null, state: 'unknown', sources: metricSources };
  const certainty: PublicMetricState[] = ['verified', 'recorded', 'reported', 'estimated'];
  const state = metrics.reduce((weakest, metric) =>
    certainty.indexOf(metric.state) > certainty.indexOf(weakest) ? metric.state : weakest, 'verified' as PublicMetricState);
  return { value: metrics.reduce((sum, metric) => sum + (metric.value ?? 0), 0), state, sources: metricSources };
}

function combineGoalieGroups(groups: PublicGoalieMetricGroup[]): PublicGoalieMetricGroup | null {
  if (groups.length === 0) return null;
  const gamesPlayed = combinePublicMetrics(groups.map((group) => group.gamesPlayed));
  const wins = combinePublicMetrics(groups.map((group) => group.wins));
  const losses = combinePublicMetrics(groups.map((group) => group.losses));
  const saves = combinePublicMetrics(groups.map((group) => group.saves));
  const goalsAgainst = combinePublicMetrics(groups.map((group) => group.goalsAgainst));
  const shutouts = combinePublicMetrics(groups.map((group) => group.shutouts));
  const rateSources = [...new Set([...saves.sources, ...goalsAgainst.sources, ...gamesPlayed.sources])];
  const rateState = combinePublicMetrics([
    { ...saves, value: saves.value === null ? null : 0 },
    { ...goalsAgainst, value: goalsAgainst.value === null ? null : 0 },
  ]).state;
  const saveAttempts = saves.value === null || goalsAgainst.value === null ? null : saves.value + goalsAgainst.value;
  return {
    gamesPlayed, wins, losses, saves, goalsAgainst,
    savePercentage: saveAttempts && saves.value !== null
      ? { value: saves.value / saveAttempts, state: rateState, sources: rateSources }
      : unknownMetric(rateSources),
    goalsAgainstAverage: gamesPlayed.value && goalsAgainst.value !== null
      ? { value: goalsAgainst.value / gamesPlayed.value, state: combinePublicMetrics([
          { ...gamesPlayed, value: 0 }, { ...goalsAgainst, value: 0 },
        ]).state, sources: rateSources }
      : unknownMetric(rateSources),
    shutouts,
  };
}

async function buildCareerV2(
  league: PublicLeague,
  profileId: string,
  profile: { full_name: string | null; avatar_url: string | null; photo_url?: string | null } | undefined,
  scope: CareerScope,
  deps: PublicNativeStatsDependencies,
) {
  if (!deps.loadMetricRows) throw new DataIntegrityError('v2 metric loader unavailable');
  const timeline = deps.filterVisiblePlayerCareerTimelineRows(await deps.getPlayerCareerStatsTimeline(
    league.id, profileId, scope.isGoalie, { includeHistoricalBaseline: true },
  ), { includeHistoricalBaseline: true });
  const seasonCatalog = new Map(scope.seasonCatalog.map((season) => [season.id, season]));
  const exactRows = timeline.filter((row) => seasonCatalog.has(row.season_id));
  const importedRowsBySeason = new Map<string, PlayerCareerSeasonRow[]>();
  for (const row of exactRows) {
    if (!isHistoricalCareerBaselineSeasonName(row.season_name) && !isImportedAggregateSeasonId(row.season_id)) continue;
    importedRowsBySeason.set(row.season_id, [...(importedRowsBySeason.get(row.season_id) ?? []), row]);
  }
  const sourceSeasonIds = scope.canonicalSeasonIds ?? await deps.readCareerMetricSeasonIds(league.id, profileId);
  const canonicalSeasonIds = [...new Set(sourceSeasonIds)]
    .filter((seasonId) => !importedRowsBySeason.has(seasonId)
      && !isImportedAggregateSeasonId(seasonId)
      && !isHistoricalCareerBaselineSeasonName(seasonCatalog.get(seasonId)?.name ?? ''));
  if (canonicalSeasonIds.length > MAX_CAREER_METRIC_SEASONS) throw new PayloadLimitError('career metric season work limit exceeded');
  for (const seasonId of canonicalSeasonIds) {
    if (!UUID_PATTERN.test(seasonId) || !seasonCatalog.has(seasonId)) throw new DataIntegrityError('canonical career season is outside league scope');
  }
  const seasons: Array<{
    seasonId: string | null; sourceId: string | null; seasonName: string; sortDate: string | null;
    teams: Array<{ id: string; name: string }>; roles: Array<'skater' | 'goalie'>;
    metrics: PublicSeasonMetricPlayer['metrics']; goalie: PublicGoalieMetricGroup | null;
  }> = [];

  for (const [seasonId, seasonRows] of importedRowsBySeason) {
    const first = seasonRows[0];
    const aggregateFields = ['games_played', 'goals', 'assists', 'points', 'wins', 'losses', 'saves', 'goals_against', 'shutouts'] as const;
    for (const field of aggregateFields) {
      const values = new Set(seasonRows.map((row) => nonnegativeNumber(row[field])));
      if (values.size !== 1) throw new DataIntegrityError(`inconsistent imported ${field}`);
    }
    const goals = nonnegativeNumber(first.goals);
    const assists = nonnegativeNumber(first.assists);
    if (nonnegativeNumber(first.points) !== goals + assists) throw new DataIntegrityError('inconsistent imported points');
    const importedPimValues = new Set(seasonRows.map((row) => (row as PlayerCareerSeasonRow & { penalty_minutes?: number | null }).penalty_minutes)
      .filter((value): value is number => value !== null && value !== undefined)
      .map(nonnegativeNumber));
    if (importedPimValues.size > 1) throw new DataIntegrityError('inconsistent imported penalty minutes');
    const hasExplicitRole = seasonRows.some((row) => Boolean(row.position?.trim()));
    const goalieRole = seasonRows.some((row) => ['g', 'goalie'].includes(row.position?.trim().toLowerCase() ?? ''))
      || (!hasExplicitRole && scope.isGoalie);
    const roles: Array<'skater' | 'goalie'> = [goalieRole ? 'goalie' : 'skater'];
    const teams = [...new Map(seasonRows
      .filter((row) => row.team_id)
      .map((row) => [row.team_id as string, { id: row.team_id as string, name: row.team_name || 'Unknown team' }])).values()];
    seasons.push({
      seasonId,
      sourceId: null,
      seasonName: first.season_name,
      sortDate: first.sort_date,
      teams,
      roles,
      metrics: {
        gamesPlayed: importedMetric(first.games_played),
        goals: importedMetric(goals),
        assists: importedMetric(assists),
        points: importedMetric(goals + assists),
        penaltyMinutes: importedPimValues.size === 1 ? importedMetric([...importedPimValues][0]) : unknownMetric(['imported']),
      },
      goalie: goalieRole ? timelineGoalieMetrics(first, true) : null,
    });
  }

  let careerSourceRows = 0;
  for (const seasonId of canonicalSeasonIds) {
    const raw = await deps.loadMetricRows({ leagueId: league.id, seasonId, playerId: profileId });
    careerSourceRows += Object.values(raw).reduce((sum, collection) => sum + collection.length, 0);
    if (careerSourceRows > MAX_CAREER_METRIC_SOURCE_ROWS) throw new PayloadLimitError('career metric source work limit exceeded');
    const canonical = aggregatePublicSeasonStats(raw, { leagueId: league.id, seasonId, playerId: profileId }).players
      .find((player) => player.playerId === profileId);
    if (!canonical) throw new DataIntegrityError('canonical career player season disappeared');
    const metadata = exactRows.find((row) => row.season_id === seasonId);
    seasons.push({
      seasonId,
      sourceId: null,
      seasonName: seasonCatalog.get(seasonId)?.name ?? metadata?.season_name ?? 'Unknown season',
      sortDate: metadata?.sort_date ?? null,
      teams: canonical.teams,
      roles: canonical.roles,
      metrics: canonical.metrics,
      goalie: canonical.goalie,
    });
  }

  if (scope.canonicalSourceRowCount > 0 && seasons.length === 0 && !scope.careerBaseline) {
    throw new DataIntegrityError('canonical source rows disappeared');
  }

  if (scope.careerBaseline && !seasons.some((season) => isHistoricalCareerBaselineSeasonName(season.seasonName))) {
    const baselineSeason = scope.seasonCatalog.find((season) => isHistoricalCareerBaselineSeasonName(season.name));
    const baseline = scope.careerBaseline;
    if (nonnegativeNumber(baseline.points) !== nonnegativeNumber(baseline.goals) + nonnegativeNumber(baseline.assists)) {
      throw new DataIntegrityError('inconsistent imported baseline points');
    }
    const roles: Array<'skater' | 'goalie'> = [baseline.is_goalie ? 'goalie' : 'skater'];
    const metrics = {
      gamesPlayed: importedMetric(baseline.games_played), goals: importedMetric(baseline.goals),
      assists: importedMetric(baseline.assists), points: importedMetric(baseline.goals + baseline.assists),
      penaltyMinutes: unknownMetric(['imported']),
    };
    const baselineGoalie = baseline.is_goalie ? (() => {
      const wins = nonnegativeNumber(baseline.wins ?? 0);
      const ties = nonnegativeNumber(baseline.ties ?? 0);
      const losses = Math.max(0, nonnegativeNumber(baseline.games_played) - wins - ties);
      const saves = nonnegativeNumber(baseline.saves ?? 0);
      const goalsAgainst = nonnegativeNumber(baseline.goals_against ?? 0);
      const attempts = saves + goalsAgainst;
      return {
        gamesPlayed: importedMetric(baseline.games_played), wins: importedMetric(wins), losses: importedMetric(losses),
        saves: importedMetric(saves), goalsAgainst: importedMetric(goalsAgainst),
        savePercentage: attempts > 0 ? importedMetric(saves / attempts) : unknownMetric(['imported']),
        goalsAgainstAverage: baseline.games_played > 0 ? importedMetric(goalsAgainst / baseline.games_played) : unknownMetric(['imported']),
        shutouts: importedMetric(baseline.shutouts ?? 0),
      };
    })() : null;
    seasons.push({
      seasonId: baselineSeason?.id ?? null,
      sourceId: baselineSeason ? null : baseline.id,
      seasonName: baselineSeason?.name ?? 'Imported career history', sortDate: null, teams: [], roles, metrics,
      goalie: baselineGoalie,
    });
  }
  if (seasons.length > MAX_CAREER_ROWS) throw new PayloadLimitError('career row limit exceeded');
  seasons.sort((left, right) => (right.sortDate ?? '').localeCompare(left.sortDate ?? '') || left.seasonName.localeCompare(right.seasonName, 'en'));
  const metricKeys = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes'] as const;
  const totalsMetrics = Object.fromEntries(metricKeys.map((key) => [key, combinePublicMetrics(seasons.map((season) => season.metrics[key]))])) as PublicSeasonMetricPlayer['metrics'];
  const totalRoles = [...new Set(seasons.flatMap((season) => season.roles))] as Array<'skater' | 'goalie'>;
  if (totalRoles.length === 0) totalRoles.push(scope.isGoalie ? 'goalie' : 'skater');
  return {
    schemaVersion: 2 as const,
    leagueId: league.id,
    leagueSlug: league.slug,
    player: { id: profileId, name: profile?.full_name || 'Unknown Player', avatarUrl: profile?.avatar_url ?? profile?.photo_url ?? null },
    totals: { roles: totalRoles, metrics: totalsMetrics, goalie: combineGoalieGroups(seasons.flatMap((season) => season.goalie ? [season.goalie] : [])) },
    seasons,
  };
}

export async function handlePublicPlayerCareerRequest(
  request: NextRequest,
  deps: PublicNativeStatsDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const queryError = validateExactQueryKeys(request, new Set(['leagueSlug', 'playerId', 'contractVersion']));
  if (queryError) return queryError;
  const contractVersion = readContractVersion(request);
  if (contractVersion instanceof NextResponse) return contractVersion;
  const slug = validateSlug(request.nextUrl.searchParams.get('leagueSlug'));
  if (slug instanceof NextResponse) return slug;
  const playerId = request.nextUrl.searchParams.get('playerId');
  if (playerId === null) return jsonError(400, 'INVALID_QUERY', 'playerId is required.');
  if (!UUID_PATTERN.test(playerId)) return jsonError(400, 'INVALID_PLAYER_ID', 'playerId must be a UUID.');
  const tenantHost = tenantMismatchBeforeLookup(request, slug);
  if (tenantHost instanceof NextResponse) return tenantHost;

  try {
    if (contractVersion === 2) deps.requirePrivilegedAccess();
    const league = await requirePublicLeague(slug, tenantHost, deps);
    if (league instanceof NextResponse) return league;
    const player = await deps.getPlayerProfile(playerId);
    const directProfile = player ? null : await deps.readPublicProfileIdentity(playerId);
    if (!player && !directProfile) return jsonError(404, 'PLAYER_NOT_FOUND', 'Player not found.');
    const profileId = player?.player_id ?? directProfile?.id;
    if (!profileId) throw new DataIntegrityError('canonical player identity missing');
    if (!UUID_PATTERN.test(profileId)) throw new DataIntegrityError('invalid canonical player id');
    let scope = await deps.readCareerScope(league.id, profileId);
    if (contractVersion === 2 && scope.canonicalSeasonIds === undefined) {
      const canonicalSeasonIds = await deps.readCareerMetricSeasonIds(league.id, profileId);
      scope = { ...scope, canonicalSeasonIds, isEligible: scope.isEligible || canonicalSeasonIds.length > 0 };
    }
    if (!scope.isEligible) return jsonError(404, 'PLAYER_NOT_FOUND', 'Player not found.');
    const baselineCount = scope.historicalBaselineSourceRowCount ?? 0;
    if (baselineCount > 1) throw new DataIntegrityError('ambiguous career baseline records');
    const isGoalie = scope.isGoalie;

    if (contractVersion === 2) {
      const profile = player?.profile ?? directProfile ?? undefined;
      return jsonSuccess(await buildCareerV2(league, profileId, profile, scope, deps));
    }

    const timeline = await deps.getPlayerCareerStatsTimeline(
      league.id,
      profileId,
      isGoalie,
      { includeHistoricalBaseline: true },
    );
    const visible = deps.filterVisiblePlayerCareerTimelineRows(timeline, {
      includeHistoricalBaseline: true,
    });
    const seasonIds = new Set(scope.seasonCatalog.map((season) => season.id));
    const canonicalBaselineSeason = scope.seasonCatalog.find((season) =>
      isHistoricalCareerBaselineSeasonName(season.name));
    const exactLeagueRows = visible.filter((row) =>
      seasonIds.has(row.season_id)
      && (!isHistoricalCareerBaselineSeasonName(row.season_name) || baselineCount > 0));
    if (exactLeagueRows.length > MAX_CAREER_ROWS) throw new PayloadLimitError('career row limit exceeded');
    if (scope.canonicalSourceRowCount > 0 && exactLeagueRows.length === 0) {
      throw new DataIntegrityError('canonical source rows disappeared');
    }
    if (baselineCount > 0 && canonicalBaselineSeason && !scope.careerBaseline
      && !exactLeagueRows.some((row) => isHistoricalCareerBaselineSeasonName(row.season_name))) {
      throw new DataIntegrityError('canonical baseline row disappeared');
    }

    const seen = new Set<string>();
    const penaltyByKey = new Map<string, number>();
    const penaltyKeys = new Set<string>();
    for (const row of scope.penaltyRows) {
      const key = `${row.season_id}\u0000${row.team_id}`;
      penaltyKeys.add(key);
      const penalty = row.penalty_minutes === null ? 0 : nonnegativeNumber(row.penalty_minutes);
      penaltyByKey.set(key, finiteNumber((penaltyByKey.get(key) ?? 0) + penalty));
    }

    const seasons: Array<{
      season_id: string | null; source_id?: string; season_name: string; team_id: string | null; team_name: string | null;
      sort_date: string | null; games_played: number; goals: number; assists: number; points: number;
      penalty_minutes: number | null; source: 'imported' | 'recorded';
    }> = [];
    const importedBySeason = new Map<string, (typeof seasons)[number]>();
    for (const row of exactLeagueRows) {
      if (!UUID_PATTERN.test(row.season_id)) throw new DataIntegrityError('invalid canonical season id');
      if (row.team_id !== null && !UUID_PATTERN.test(row.team_id)) throw new DataIntegrityError('invalid canonical team id');
      const key = `${row.season_id}\u0000${row.team_id ?? ''}`;
      const imported = isHistoricalCareerBaselineSeasonName(row.season_name)
        || isImportedAggregateSeasonId(row.season_id);
      const penaltyMinutes = !imported && penaltyKeys.has(key) ? penaltyByKey.get(key) ?? 0 : null;
      const statSource = isHistoricalCareerBaselineSeasonName(row.season_name) && scope.careerBaseline
        ? scope.careerBaseline : row;
      const mapped = {
        season_id: row.season_id,
        season_name: row.season_name,
        team_id: row.team_id,
        team_name: row.team_name,
        sort_date: row.sort_date,
        games_played: nonnegativeNumber(statSource.games_played),
        goals: nonnegativeNumber(statSource.goals),
        assists: nonnegativeNumber(statSource.assists),
        points: nonnegativeNumber(statSource.points),
        penalty_minutes: penaltyMinutes,
        source: imported ? 'imported' as const : 'recorded' as const,
      };
      if (imported) {
        const existing = importedBySeason.get(row.season_id);
        if (existing) {
          const identityAndValuesMatch = existing.season_name === mapped.season_name
            && existing.sort_date === mapped.sort_date
            && existing.games_played === mapped.games_played
            && existing.goals === mapped.goals
            && existing.assists === mapped.assists
            && existing.points === mapped.points;
          if (!identityAndValuesMatch) throw new DataIntegrityError('inconsistent imported aggregate rows');
          existing.team_id = null;
          existing.team_name = null;
          continue;
        }
        importedBySeason.set(row.season_id, mapped);
      } else {
        if (seen.has(key)) throw new DataIntegrityError('duplicate career row key');
        seen.add(key);
      }
      seasons.push(mapped);
    }
    if (scope.careerBaseline && !seasons.some((row) => isHistoricalCareerBaselineSeasonName(row.season_name))) {
      if (!UUID_PATTERN.test(scope.careerBaseline.id)) {
        throw new DataIntegrityError('invalid career baseline source id');
      }
      seasons.push({
        season_id: canonicalBaselineSeason?.id ?? null,
        source_id: scope.careerBaseline.id,
        season_name: canonicalBaselineSeason?.name ?? 'Imported career history',
        team_id: null,
        team_name: null,
        sort_date: null,
        games_played: nonnegativeNumber(scope.careerBaseline.games_played),
        goals: nonnegativeNumber(scope.careerBaseline.goals),
        assists: nonnegativeNumber(scope.careerBaseline.assists),
        points: nonnegativeNumber(scope.careerBaseline.points),
        penalty_minutes: null,
        source: 'imported',
      });
    }
    if (seasons.length > MAX_CAREER_ROWS) throw new PayloadLimitError('career row limit exceeded');
    const totals = seasons.reduce(
      (sum, row) => ({
        games_played: finiteNumber(sum.games_played + row.games_played),
        goals: finiteNumber(sum.goals + row.goals),
        assists: finiteNumber(sum.assists + row.assists),
        points: finiteNumber(sum.points + row.points),
      }),
      { games_played: 0, goals: 0, assists: 0, points: 0 },
    );
    const penaltyMinutes = seasons.length > 0 && seasons.every((row) => row.penalty_minutes !== null)
      ? finiteNumber(seasons.reduce((sum, row) => sum + (row.penalty_minutes ?? 0), 0))
      : null;
    const profile = player?.profile ?? directProfile;
    const avatarUrl = profile?.avatar_url ?? profile?.photo_url ?? null;
    return jsonSuccess({
      schemaVersion: PUBLIC_NATIVE_STATS_SCHEMA_VERSION,
      leagueId: league.id,
      leagueSlug: league.slug,
      player: { id: profileId, name: profile?.full_name || 'Unknown Player', avatar_url: avatarUrl },
      totals: { ...totals, penalty_minutes: penaltyMinutes },
      seasons,
    });
  } catch (error) {
    return careerError(error, slug);
  }
}

function mapGoalie(row: UnifiedGoalieStatsRow, estimated: boolean) {
  if (!UUID_PATTERN.test(row.player_id)) throw new DataIntegrityError('invalid canonical goalie player id');
  const teamId = row.team_id || null;
  if (teamId !== null && !UUID_PATTERN.test(teamId)) throw new DataIntegrityError('invalid canonical goalie team id');
  const savePercentage = nullableNonnegativeNumber(row.save_percentage);
  if (savePercentage !== null && savePercentage > 100) {
    throw new DataIntegrityError('save percentage is not web percent scale');
  }
  return {
    player_id: row.player_id,
    player_name: row.player_name,
    team_id: teamId,
    team_name: row.team_name,
    avatar_url: row.avatar_url ?? null,
    games_played: nonnegativeNumber(row.games_played),
    wins: nonnegativeNumber(row.wins),
    losses: nonnegativeNumber(row.losses),
    save_percentage: savePercentage,
    goals_against_average: nullableNonnegativeNumber(row.goals_against_average),
    shutouts: nonnegativeNumber(row.shutouts),
    saves: estimated ? nullableNonnegativeNumber(row.saves) : nonnegativeNumber(row.saves),
    goals_against: nonnegativeNumber(row.goals_against),
    estimated,
  };
}

export async function handlePublicGoaliesRequest(
  request: NextRequest,
  deps: PublicNativeStatsDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const queryError = validateExactQueryKeys(request, new Set(['leagueSlug', 'seasonId', 'divisionId', 'contractVersion']));
  if (queryError) return queryError;
  const contractVersion = readContractVersion(request);
  if (contractVersion instanceof NextResponse) return contractVersion;
  const slug = validateSlug(request.nextUrl.searchParams.get('leagueSlug'));
  if (slug instanceof NextResponse) return slug;
  const expectedSeasonId = request.nextUrl.searchParams.get('seasonId') ?? undefined;
  if (expectedSeasonId !== undefined && !UUID_PATTERN.test(expectedSeasonId)) {
    return jsonError(400, 'INVALID_SEASON_ID', 'seasonId must be a UUID.');
  }
  if (contractVersion === 2 && expectedSeasonId === undefined) {
    return jsonError(400, 'INVALID_SEASON_ID', 'seasonId is required for contractVersion=2.');
  }
  const divisionId = request.nextUrl.searchParams.get('divisionId') ?? undefined;
  if (divisionId !== undefined && !UUID_PATTERN.test(divisionId)) {
    return jsonError(400, 'INVALID_DIVISION_ID', 'divisionId must be a UUID.');
  }
  const tenantHost = tenantMismatchBeforeLookup(request, slug);
  if (tenantHost instanceof NextResponse) return tenantHost;

  try {
    if (contractVersion === 2) deps.requirePrivilegedAccess();
    const league = await requirePublicLeague(slug, tenantHost, deps);
    if (league instanceof NextResponse) return league;
    const [presentationSeason, divisions] = await Promise.all([
      contractVersion === 2 && expectedSeasonId
        ? deps.readMetricSeason?.(league.id, expectedSeasonId) ?? Promise.reject(new DataIntegrityError('v2 season reader unavailable'))
        : deps.readPresentationSeason(league.id),
      deps.getDivisions(league.id),
    ]);
    if (divisionId && !divisions.some((division) => division.id === divisionId && division.league_id === league.id)) {
      return jsonError(400, 'DIVISION_NOT_IN_LEAGUE', 'divisionId does not belong to this league.');
    }
    if (expectedSeasonId && presentationSeason?.id !== expectedSeasonId) {
      return jsonError(409, 'SEASON_MISMATCH', 'The presentation season changed; refresh goalie data.', {
        presentationSeasonId: presentationSeason?.id ?? null,
      });
    }

    if (contractVersion === 2) {
      if (!presentationSeason || !deps.loadMetricRows) throw new DataIntegrityError('v2 metric scope unavailable');
      if (presentationSeason.league_id !== league.id) throw new DataIntegrityError('cross-league current season');
      const metricRows = await deps.loadMetricRows({ leagueId: league.id, seasonId: presentationSeason.id, divisionId });
      const aggregate = aggregatePublicSeasonStats(metricRows, { leagueId: league.id, seasonId: presentationSeason.id, divisionId });
      const goalies = aggregate.players
        .filter((player) => player.goalie !== null)
        .map((player) => ({
          playerId: player.playerId,
          playerName: player.playerName,
          avatarUrl: player.avatarUrl,
          displayTeam: player.displayTeam,
          teams: player.teams,
          metrics: player.goalie as PublicGoalieMetricGroup,
        }))
        .sort((left, right) =>
          (right.metrics.wins.value ?? -1) - (left.metrics.wins.value ?? -1)
          || left.playerName.localeCompare(right.playerName, 'en')
          || left.playerId.localeCompare(right.playerId, 'en'));
      if (goalies.length > MAX_GOALIE_ROWS) throw new PayloadLimitError('goalie row limit exceeded');
      return jsonSuccess({
        schemaVersion: 2,
        leagueId: league.id,
        leagueSlug: league.slug,
        presentationSeason: {
          id: presentationSeason.id,
          name: presentationSeason.name,
          league_id: presentationSeason.league_id,
          status: presentationSeason.status ?? null,
        },
        divisionId: divisionId ?? null,
        goalies,
        coverage: { goalies: aggregate.coverage.goalies },
      });
    }

    let source: 'recorded' | 'estimated' | 'empty' = 'empty';
    let goalies: ReturnType<typeof mapGoalie>[] = [];
    if (presentationSeason) {
      if (presentationSeason.league_id !== league.id) throw new DataIntegrityError('cross-league current season');
      const sourceCount = await deps.readGoalieStatsSourceCount(league.id, presentationSeason.id, divisionId);
      if (!Number.isSafeInteger(sourceCount) || sourceCount < 0) throw new DataIntegrityError('invalid source count');
      const canonicalRows = await deps.getUnifiedGoalieStatsRows(
        league.id,
        presentationSeason.id,
        divisionId,
        league.slug,
        presentationSeason.name,
      );
      if (canonicalRows.length > MAX_GOALIE_ROWS) throw new PayloadLimitError('goalie row limit exceeded');
      if (sourceCount > 0 && canonicalRows.length === 0) throw new DataIntegrityError('canonical goalie rows disappeared');
      const canonicalImportedSeason = isImportedAggregateSeasonId(presentationSeason.id)
        || isHistoricalCareerBaselineSeasonName(presentationSeason.name);
      source = canonicalRows.length > 0 && (canonicalImportedSeason || sourceCount === 0)
        ? 'estimated'
        : sourceCount > 0
          ? 'recorded'
          : 'empty';
      const goalieKeys = new Set<string>();
      goalies = canonicalRows
        .map((row) => {
          const mapped = mapGoalie(row, source === 'estimated');
          const key = `${mapped.player_id}\u0000${mapped.team_id ?? ''}`;
          if (goalieKeys.has(key)) throw new DataIntegrityError('duplicate goalie row key');
          goalieKeys.add(key);
          return mapped;
        })
        .sort((left, right) => {
          const winDelta = right.wins - left.wins;
          if (winDelta !== 0) return winDelta;
          const nameDelta = left.player_name.localeCompare(right.player_name, 'en');
          return nameDelta !== 0 ? nameDelta : left.player_id.localeCompare(right.player_id, 'en');
        });
    }

    return jsonSuccess({
      schemaVersion: PUBLIC_NATIVE_STATS_SCHEMA_VERSION,
      leagueId: league.id,
      leagueSlug: league.slug,
      presentationSeason: presentationSeason
        ? {
            id: presentationSeason.id,
            name: presentationSeason.name,
            league_id: presentationSeason.league_id,
            status: presentationSeason.status ?? null,
          }
        : null,
      divisionId: divisionId ?? null,
      source,
      goalies,
    });
  } catch (error) {
    return goalieError(error, slug);
  }
}
