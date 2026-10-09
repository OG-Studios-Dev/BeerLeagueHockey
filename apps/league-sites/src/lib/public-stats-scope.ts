import { NextRequest, NextResponse } from 'next/server';

import { isHistoricalCareerBaselineSeasonName } from '@/lib/all-time-stats';
import { getLeagueBySlug, hasPlatformSubscription } from '@/lib/data';
import {
  getImportedAggregateGoalieSeeds,
  getImportedAggregateSkaterSeeds,
  isImportedAggregateSeasonId,
} from '@/lib/imported-aggregate-season-overrides';
import {
  aggregatePublicSeasonStats,
  assertRequiredPrivilegedMetricConfig,
  getPublicStatsTenantHost,
  PUBLIC_METRIC_SOURCES,
  PublicMetricLimitError,
  readPublicStatMetricRows,
  type MetricScope,
  type PublicGoalieMetricGroup,
  type PublicMetricSource,
  type PublicMetricState,
  type PublicSeasonMetricPlayer,
  type PublicStatMetric,
} from '@/lib/public-stat-metrics';
import { pickOperationalSeason } from '@/lib/seasons/operational';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export const PUBLIC_STATS_SCOPE_SCHEMA_VERSION = 1 as const;
export const MAX_PUBLIC_STATS_SCOPE_SEASONS = 32;
export const MAX_PUBLIC_STATS_SCOPE_PLAYERS = 2_000;
export const MAX_PUBLIC_STATS_SCOPE_RESPONSE_BYTES = 256 * 1024;
export const MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS = 50_000;

const MAX_SEASON_CATALOG_ROWS = 100;
const MAX_BADGE_ROWS = 20_000;
const MAX_BASELINE_ROWS = 2_000;
const MAX_SUPPORT_ROWS = 20_000;
const PAGE_SIZE = 1_000;
const IN_BATCH_SIZE = 200;
const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const MAX_TEXT_LENGTH = 200;
const MAX_SHORT_TEXT_LENGTH = 40;
const MAX_MEDIA_TEXT_LENGTH = 2_048;
const MAX_METRIC_VALUE = 10_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const METRIC_STATE_ORDER: PublicMetricState[] = ['verified', 'recorded', 'reported', 'estimated', 'unknown', 'conflicted'];
const SCOPE_METRIC_SOURCES = new Set<ScopeMetricSource>([...PUBLIC_METRIC_SOURCES, 'player_badges']);

export type PublicStatsScopeKind = 'current' | 'single' | 'multiple' | 'all';

export type StatsScopeSeason = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
};

export type StatsScopeLeague = {
  id: string;
  slug: string;
  status: string;
  custom_domain?: string | null;
  custom_domain_verified?: boolean | null;
};

export type StatsScopeDivision = { id: string; league_id: string };
export type StatsScopeProfileRow = { id: string; full_name: string | null; avatar_url: string | null; photo_url: string | null };
export type StatsScopeTeamRow = { id: string; league_id: string; name: string; logo_url: string | null; division_id: string | null };
export type StatsScopeBadgeRow = { id: string; player_id: string | null; season_id: string | null };
export type StatsScopeBaselineRow = {
  id: string;
  player_id: string | null;
  is_goalie: boolean;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  goals_against: number;
  moosehead_cup_wins: number;
};
type ImportedRosterRow = {
  id: string;
  player_id: string;
  team_id: string;
  position: string | null;
  is_goalie: boolean | null;
};
type IdentityProofRow = { id: string; player_id: string | null };

export type StatsScopeSeasonPayload = {
  presentationSeason: { id: string; name: string; league_id: string; status: string | null };
  players: PublicSeasonMetricPlayer[];
  sourceRowCount: number;
};

type ScopeMetricSource = PublicMetricSource | 'player_badges';
export type StatsScopeMetric = Omit<PublicStatMetric, 'sources'> & { sources: ScopeMetricSource[] };
export type StatsScopePlayer = {
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  displayTeam: { id: string; name: string; logoUrl: string | null } | null;
  skater: {
    gamesPlayed: StatsScopeMetric;
    goals: StatsScopeMetric;
    assists: StatsScopeMetric;
    points: StatsScopeMetric;
    championships: StatsScopeMetric;
  } | null;
  goalie: {
    gamesPlayed: StatsScopeMetric;
    goalsAgainst: StatsScopeMetric;
    goalsAgainstAverage: StatsScopeMetric;
    championships: StatsScopeMetric;
  } | null;
};

type CompleteQueryResult<T> = { data: T[] | null; count: number | null; error: unknown };
export type CompleteQuery<T> = { range(from: number, to: number): PromiseLike<CompleteQueryResult<T>> };

export class PublicStatsScopeDataError extends Error {}
export class PublicStatsScopeLimitError extends Error {}

export async function readCompleteStatsScopeRows<T>(
  build: () => CompleteQuery<T>,
  label: string,
  maxRows: number,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
    throw new PublicStatsScopeDataError('invalid complete-read bound');
  }
  if (maxRows === 0) throw new PublicStatsScopeLimitError(`${label} row limit exceeded`);
  const first = await build().range(0, Math.min(pageSize, maxRows) - 1);
  if (first.error) throw new PublicStatsScopeDataError(`${label} read failed`);
  if (!Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) {
    throw new PublicStatsScopeDataError(`${label} count missing`);
  }
  const expectedCount = first.count as number;
  if (expectedCount > maxRows) throw new PublicStatsScopeLimitError(`${label} row limit exceeded`);
  const rows = [...(first.data ?? [])];
  for (let offset = pageSize; offset < expectedCount; offset += pageSize) {
    const page = await build().range(offset, Math.min(offset + pageSize - 1, expectedCount - 1));
    if (page.error) throw new PublicStatsScopeDataError(`${label} later page failed`);
    if (page.count !== expectedCount) throw new PublicStatsScopeDataError(`${label} count changed`);
    rows.push(...(page.data ?? []));
  }
  if (rows.length !== expectedCount) throw new PublicStatsScopeDataError(`${label} read incomplete`);
  return rows;
}

function safeNonnegative(value: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new PublicStatsScopeDataError(`invalid ${label}`);
  }
  return value;
}

function validateText(value: string, label: string, maxLength = MAX_TEXT_LENGTH): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new PublicStatsScopeDataError(`invalid ${label}`);
  }
}

function validateNullableText(value: string | null, label: string, maxLength: number): void {
  if (value !== null) validateText(value, label, maxLength);
}

function validateSourceTextLength(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): void {
  if (value !== null && value !== undefined && value.length > maxLength) {
    throw new PublicStatsScopeDataError(`invalid ${label}`);
  }
}

function validateProfileSource(profile: StatsScopeProfileRow): void {
  validateSourceTextLength(profile.full_name, 'profile name', MAX_TEXT_LENGTH);
  validateSourceTextLength(profile.avatar_url, 'profile avatar', MAX_MEDIA_TEXT_LENGTH);
  validateSourceTextLength(profile.photo_url, 'profile photo', MAX_MEDIA_TEXT_LENGTH);
}

function validateMetricSources(sources: readonly ScopeMetricSource[], label: string): void {
  if (sources.length > SCOPE_METRIC_SOURCES.size
    || new Set(sources).size !== sources.length
    || sources.some((source) => !SCOPE_METRIC_SOURCES.has(source))) {
    throw new PublicStatsScopeDataError(`invalid ${label} sources`);
  }
}

function metric(value: number, state: PublicMetricState, sources: ScopeMetricSource[]): StatsScopeMetric {
  const validated = safeNonnegative(value, 'metric value');
  if (validated > MAX_METRIC_VALUE) throw new PublicStatsScopeDataError('invalid metric value');
  return { value: validated, state, sources: [...new Set(sources)].sort() };
}

function unknownMetric(sources: ScopeMetricSource[] = [], conflicted = false): StatsScopeMetric {
  return { value: null, state: conflicted ? 'conflicted' : 'unknown', sources: [...new Set(sources)].sort() };
}

function importedMetric(value: number): PublicStatMetric {
  const validated = safeNonnegative(value, 'imported metric', true);
  if (validated > MAX_METRIC_VALUE) throw new PublicStatsScopeDataError('invalid imported metric');
  return { value: validated, state: 'reported', sources: ['imported'] };
}

function importedRateMetric(value: number): PublicStatMetric {
  const validated = safeNonnegative(value, 'imported rate');
  if (validated > MAX_METRIC_VALUE) throw new PublicStatsScopeDataError('invalid imported rate');
  return { value: validated, state: 'reported', sources: ['imported'] };
}

function unknownPublicMetric(sources: PublicMetricSource[] = []): PublicStatMetric {
  return { value: null, state: 'unknown', sources: [...new Set(sources)].sort() };
}

function combineMetrics(values: readonly PublicStatMetric[]): StatsScopeMetric {
  const sources = [...new Set(values.flatMap((value) => value.sources))].sort() as ScopeMetricSource[];
  if (values.length === 0) return unknownMetric();
  if (values.some((value) => value.state === 'conflicted')) return unknownMetric(sources, true);
  if (values.some((value) => value.state === 'unknown' || value.value === null)) return unknownMetric(sources);
  const state = values.reduce<PublicMetricState>((weakest, value) => (
    METRIC_STATE_ORDER.indexOf(value.state) > METRIC_STATE_ORDER.indexOf(weakest) ? value.state : weakest
  ), 'verified');
  return metric(values.reduce((sum, value) => sum + (value.value ?? 0), 0), state, sources);
}

function rateMetric(numerator: StatsScopeMetric, denominator: StatsScopeMetric): StatsScopeMetric {
  const sources = [...new Set([...numerator.sources, ...denominator.sources])].sort();
  if (numerator.state === 'conflicted' || denominator.state === 'conflicted') return unknownMetric(sources, true);
  if (numerator.value === null || denominator.value === null || denominator.value === 0) return unknownMetric(sources);
  const state = METRIC_STATE_ORDER.indexOf(numerator.state) > METRIC_STATE_ORDER.indexOf(denominator.state)
    ? numerator.state
    : denominator.state;
  return metric(numerator.value / denominator.value, state, sources);
}

export function resolvePublicStatsAvatar(
  avatarUrl: string | null | undefined,
  photoUrl: string | null | undefined,
  contractAvatarUrl: string | null | undefined,
): string | null {
  return avatarUrl?.trim() || photoUrl?.trim() || contractAvatarUrl?.trim() || null;
}

export function supportsPublicStatsScopeDivision(kind: PublicStatsScopeKind, divisionId: string | null): boolean {
  return kind !== 'all' || divisionId === null;
}

type AggregatePlayer = {
  playerId: string;
  contractName: string;
  contractAvatar: string | null;
  displayTeam: { id: string; name: string } | null;
  skater: PublicSeasonMetricPlayer['metrics'][];
  goalie: PublicGoalieMetricGroup[];
  baselineSkater: StatsScopeBaselineRow[];
  baselineGoalie: StatsScopeBaselineRow[];
};

export function aggregatePublicStatsScope(input: {
  payloads: readonly StatsScopeSeasonPayload[];
  profiles: ReadonlyMap<string, StatsScopeProfileRow>;
  teams: ReadonlyMap<string, StatsScopeTeamRow>;
  badges: readonly StatsScopeBadgeRow[];
  baselines: readonly StatsScopeBaselineRow[];
  includeBaselines: boolean;
}): StatsScopePlayer[] {
  const aggregateById = new Map<string, AggregatePlayer>();
  const getAggregate = (playerId: string, name: string, avatar: string | null) => {
    const existing = aggregateById.get(playerId);
    if (existing) return existing;
    const created: AggregatePlayer = {
      playerId,
      contractName: name,
      contractAvatar: avatar,
      displayTeam: null,
      skater: [],
      goalie: [],
      baselineSkater: [],
      baselineGoalie: [],
    };
    aggregateById.set(playerId, created);
    return created;
  };

  for (const payload of input.payloads) {
    const seen = new Set<string>();
    for (const player of payload.players) {
      if (!UUID_PATTERN.test(player.playerId) || seen.has(player.playerId)) {
        throw new PublicStatsScopeDataError('invalid or duplicate season player identity');
      }
      seen.add(player.playerId);
      const aggregate = getAggregate(player.playerId, player.playerName, player.avatarUrl);
      if (!aggregate.contractAvatar && player.avatarUrl?.trim()) aggregate.contractAvatar = player.avatarUrl.trim();
      if (!aggregate.displayTeam && player.displayTeam) aggregate.displayTeam = player.displayTeam;
      if (player.roles.includes('skater')) aggregate.skater.push(player.metrics);
      if (player.goalie) aggregate.goalie.push(player.goalie);
    }
  }

  if (input.includeBaselines) {
    for (const baseline of input.baselines) {
      if (!baseline.player_id) throw new PublicStatsScopeDataError('unmatched imported baseline identity');
      const aggregate = getAggregate(baseline.player_id, 'Unknown Player', null);
      (baseline.is_goalie ? aggregate.baselineGoalie : aggregate.baselineSkater).push(baseline);
    }
  }

  const badgeCounts = new Map<string, number>();
  for (const badge of input.badges) {
    if (!badge.player_id) throw new PublicStatsScopeDataError('unmatched championship identity');
    badgeCounts.set(badge.player_id, (badgeCounts.get(badge.player_id) ?? 0) + 1);
  }

  if (aggregateById.size > MAX_PUBLIC_STATS_SCOPE_PLAYERS) throw new PublicStatsScopeLimitError('player limit exceeded');
  return [...aggregateById.values()].map((aggregate): StatsScopePlayer => {
    const profile = input.profiles.get(aggregate.playerId);
    if (!profile) throw new PublicStatsScopeDataError('player profile identity disappeared');
    const importedChampionships = [...aggregate.baselineSkater, ...aggregate.baselineGoalie]
      .reduce((sum, row) => sum + safeNonnegative(row.moosehead_cup_wins, 'imported championships', true), 0);
    const nativeChampionships = badgeCounts.get(aggregate.playerId) ?? 0;
    const championshipMetric = metric(
      nativeChampionships + importedChampionships,
      importedChampionships > 0 ? 'reported' : 'verified',
      ['player_badges', ...(importedChampionships > 0 ? ['imported' as const] : [])],
    );
    const baselineMetric = (rows: StatsScopeBaselineRow[], field: 'games_played' | 'goals' | 'assists' | 'points' | 'goals_against') =>
      rows.map((row) => importedMetric(row[field]));
    const gamesPlayed = combineMetrics([
      ...aggregate.skater.map((row) => row.gamesPlayed),
      ...baselineMetric(aggregate.baselineSkater, 'games_played'),
    ]);
    const goals = combineMetrics([
      ...aggregate.skater.map((row) => row.goals),
      ...baselineMetric(aggregate.baselineSkater, 'goals'),
    ]);
    const assists = combineMetrics([
      ...aggregate.skater.map((row) => row.assists),
      ...baselineMetric(aggregate.baselineSkater, 'assists'),
    ]);
    const points = combineMetrics([
      ...aggregate.skater.map((row) => row.points),
      ...baselineMetric(aggregate.baselineSkater, 'points'),
    ]);
    if (goals.value !== null && assists.value !== null && points.value !== goals.value + assists.value) {
      throw new PublicStatsScopeDataError('aggregate points do not reconcile');
    }
    const goalieGames = combineMetrics([
      ...aggregate.goalie.map((row) => row.gamesPlayed),
      ...baselineMetric(aggregate.baselineGoalie, 'games_played'),
    ]);
    const goalieGoalsAgainst = combineMetrics([
      ...aggregate.goalie.map((row) => row.goalsAgainst),
      ...baselineMetric(aggregate.baselineGoalie, 'goals_against'),
    ]);
    const displayTeam = aggregate.displayTeam ? input.teams.get(aggregate.displayTeam.id) : null;
    if (aggregate.displayTeam && (!displayTeam || displayTeam.league_id.length === 0)) {
      throw new PublicStatsScopeDataError('display team identity disappeared');
    }
    return {
      playerId: aggregate.playerId,
      playerName: profile.full_name?.trim() || aggregate.contractName.trim() || 'Unknown Player',
      avatarUrl: resolvePublicStatsAvatar(profile.avatar_url, profile.photo_url, aggregate.contractAvatar),
      displayTeam: aggregate.displayTeam && displayTeam
        ? { id: displayTeam.id, name: displayTeam.name, logoUrl: displayTeam.logo_url?.trim() || null }
        : null,
      skater: aggregate.skater.length > 0 || aggregate.baselineSkater.length > 0
        ? { gamesPlayed, goals, assists, points, championships: championshipMetric }
        : null,
      goalie: aggregate.goalie.length > 0 || aggregate.baselineGoalie.length > 0
        ? {
            gamesPlayed: goalieGames,
            goalsAgainst: goalieGoalsAgainst,
            goalsAgainstAverage: rateMetric(goalieGoalsAgainst, goalieGames),
            championships: championshipMetric,
          }
        : null,
    };
  }).sort((left, right) => left.playerName.localeCompare(right.playerName, 'en') || left.playerId.localeCompare(right.playerId, 'en'));
}

export interface PublicStatsScopeDependencies {
  getLeagueBySlug(slug: string): Promise<StatsScopeLeague | null>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
  requirePrivilegedAccess(): void;
  readPublicSeasonCatalog(leagueId: string, maxRows: number): Promise<StatsScopeSeason[]>;
  readSeasonCatalog(leagueId: string, maxRows: number): Promise<StatsScopeSeason[]>;
  readPublicDivision(leagueId: string, divisionId: string, maxRows: number): Promise<StatsScopeDivision | null>;
  readDivision(leagueId: string, divisionId: string, maxRows: number): Promise<StatsScopeDivision | null>;
  loadNativeSeason(season: StatsScopeSeason, divisionId: string | null, maxRows: number): Promise<StatsScopeSeasonPayload>;
  loadImportedAggregateSeason(season: StatsScopeSeason, divisionId: string | null, maxRows: number): Promise<StatsScopeSeasonPayload>;
  readBadges(leagueId: string, seasonIds: string[], maxRows: number): Promise<StatsScopeBadgeRow[]>;
  readBaselines(leagueId: string, maxRows: number): Promise<StatsScopeBaselineRow[]>;
  readProfiles(playerIds: string[], maxRows: number): Promise<StatsScopeProfileRow[]>;
  readTeams(leagueId: string, teamIds: string[], maxRows: number): Promise<StatsScopeTeamRow[]>;
}

function serviceQuery<T>(query: unknown): CompleteQuery<T> {
  return query as CompleteQuery<T>;
}

async function readBatchedRows<T>(
  values: string[],
  label: string,
  maxRows: number,
  build: (batch: string[]) => CompleteQuery<T>,
): Promise<T[]> {
  const uniqueValues = [...new Set(values)];
  const rows: T[] = [];
  for (let offset = 0; offset < uniqueValues.length; offset += IN_BATCH_SIZE) {
    const remaining = maxRows - rows.length;
    if (remaining < 0) throw new PublicStatsScopeLimitError(`${label} row limit exceeded`);
    rows.push(...await readCompleteStatsScopeRows(
      () => build(uniqueValues.slice(offset, offset + IN_BATCH_SIZE)),
      label,
      remaining,
    ));
  }
  return rows;
}

async function readPublicSeasonCatalog(leagueId: string, maxRows: number): Promise<StatsScopeSeason[]> {
  const client = await createClient();
  return readCompleteStatsScopeRows(
    () => serviceQuery<StatsScopeSeason>(client.from('seasons')
      .select('id, league_id, name, status, start_date, end_date, created_at', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })),
    'public season catalog',
    Math.min(MAX_SEASON_CATALOG_ROWS, maxRows),
  );
}

async function readSeasonCatalog(leagueId: string, maxRows: number): Promise<StatsScopeSeason[]> {
  const client = createServiceRoleClient();
  return readCompleteStatsScopeRows(
    () => serviceQuery<StatsScopeSeason>(client.from('seasons')
      .select('id, league_id, name, status, start_date, end_date, created_at', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })),
    'season catalog',
    Math.min(MAX_SEASON_CATALOG_ROWS, maxRows),
  );
}

async function readPublicDivision(
  leagueId: string,
  divisionId: string,
  maxRows: number,
): Promise<StatsScopeDivision | null> {
  if (maxRows < 1) throw new PublicStatsScopeLimitError('public division row limit exceeded');
  const client = await createClient();
  const result = await client.from('divisions').select('id, league_id').eq('league_id', leagueId).eq('id', divisionId).maybeSingle();
  if (result.error) throw new PublicStatsScopeDataError('public division read failed');
  return result.data as StatsScopeDivision | null;
}

async function readDivision(leagueId: string, divisionId: string, maxRows: number): Promise<StatsScopeDivision | null> {
  if (maxRows < 1) throw new PublicStatsScopeLimitError('division row limit exceeded');
  const client = createServiceRoleClient();
  const result = await client.from('divisions').select('id, league_id').eq('league_id', leagueId).eq('id', divisionId).maybeSingle();
  if (result.error) throw new PublicStatsScopeDataError('division read failed');
  return result.data as StatsScopeDivision | null;
}

async function loadNativeSeason(
  season: StatsScopeSeason,
  divisionId: string | null,
  maxRows: number,
): Promise<StatsScopeSeasonPayload> {
  const scope: MetricScope = { leagueId: season.league_id, seasonId: season.id, divisionId };
  const rows = await readPublicStatMetricRows(scope, { maxTotalRows: maxRows });
  const sourceRowCount = Object.values(rows).reduce((sum, collection) => sum + collection.length, 0);
  const aggregate = aggregatePublicSeasonStats(rows, scope);
  return {
    presentationSeason: { id: season.id, name: season.name, league_id: season.league_id, status: season.status },
    players: aggregate.players,
    sourceRowCount,
  };
}

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function remainingRows(limit: number, used: number, label: string): number {
  const remaining = limit - used;
  if (remaining < 1) throw new PublicStatsScopeLimitError(`${label} row limit exceeded`);
  return remaining;
}

async function readProfilesByIds(playerIds: string[], maxRows: number): Promise<StatsScopeProfileRow[]> {
  if (playerIds.length === 0) return [];
  const client = createServiceRoleClient();
  return readBatchedRows(playerIds, 'profiles', Math.min(MAX_SUPPORT_ROWS, maxRows), (batch) => serviceQuery<StatsScopeProfileRow>(client.from('profiles')
    .select('id, full_name, avatar_url, photo_url', { count: 'exact' })
    .in('id', batch)
    .order('id', { ascending: true })));
}

async function readProfilesByNames(names: string[], maxRows: number): Promise<StatsScopeProfileRow[]> {
  if (names.length === 0) return [];
  const client = createServiceRoleClient();
  return readBatchedRows(names, 'named profiles', Math.min(MAX_SUPPORT_ROWS, maxRows), (batch) => serviceQuery<StatsScopeProfileRow>(client.from('profiles')
    .select('id, full_name, avatar_url, photo_url', { count: 'exact' })
    .in('full_name', batch)
    .order('id', { ascending: true })));
}

async function readImportedAggregateIdentities(
  leagueId: string,
  seasonId: string,
  seedNames: string[],
  maxRows: number,
) {
  const client = createServiceRoleClient();
  let sourceRowCount = 0;
  const rosterRows = await readCompleteStatsScopeRows(
    () => serviceQuery<ImportedRosterRow>(client.from('team_rosters')
      .select('id, player_id, team_id, position, is_goalie', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('id', { ascending: true })),
    'imported aggregate rosters',
    Math.min(MAX_SUPPORT_ROWS, remainingRows(maxRows, sourceRowCount, 'imported aggregate')),
  );
  sourceRowCount += rosterRows.length;
  const rosterProfiles = await readProfilesByIds(
    rosterRows.map((row) => row.player_id),
    remainingRows(maxRows, sourceRowCount, 'imported aggregate'),
  );
  sourceRowCount += rosterProfiles.length;
  const byName = new Map<string, StatsScopeProfileRow[]>();
  for (const profile of rosterProfiles) {
    const key = normalizeName(profile.full_name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), profile]);
  }
  const missingNames = seedNames.filter((name) => !byName.has(normalizeName(name)));
  const namedProfiles = missingNames.length > 0
    ? await readProfilesByNames(missingNames, remainingRows(maxRows, sourceRowCount, 'imported aggregate'))
    : [];
  sourceRowCount += namedProfiles.length;
  if (namedProfiles.length > 0) {
    const candidateIds = namedProfiles.map((profile) => profile.id);
    const rosterProofs = await readBatchedRows(
      candidateIds,
      'imported aggregate roster proofs',
      Math.min(MAX_SUPPORT_ROWS, remainingRows(maxRows, sourceRowCount, 'imported aggregate')),
      (batch) => serviceQuery<IdentityProofRow>(client.from('team_rosters')
      .select('id, player_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .in('player_id', batch)
      .order('id', { ascending: true })),
    );
    sourceRowCount += rosterProofs.length;
    const baselineProofs = await readBatchedRows(
      candidateIds,
      'imported aggregate baseline proofs',
      Math.min(MAX_BASELINE_ROWS, remainingRows(maxRows, sourceRowCount, 'imported aggregate')),
      (batch) => serviceQuery<IdentityProofRow>(client.from('player_career_baselines')
      .select('id, player_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .in('player_id', batch)
      .order('id', { ascending: true })),
    );
    sourceRowCount += baselineProofs.length;
    const proven = new Set([...rosterProofs, ...baselineProofs].flatMap((row) => row.player_id ? [row.player_id] : []));
    for (const profile of namedProfiles) {
      if (!proven.has(profile.id)) continue;
      const key = normalizeName(profile.full_name);
      if (key) byName.set(key, [...(byName.get(key) ?? []), profile]);
    }
  }
  for (const name of seedNames) {
    const candidates = byName.get(normalizeName(name)) ?? [];
    if (candidates.length !== 1) throw new PublicStatsScopeDataError('imported aggregate player identity is missing or ambiguous');
  }
  return {
    byName,
    sourceRowCount,
  };
}

async function readAllLeagueTeams(leagueId: string, maxRows: number): Promise<StatsScopeTeamRow[]> {
  const client = createServiceRoleClient();
  return readCompleteStatsScopeRows(
    () => serviceQuery<StatsScopeTeamRow>(client.from('teams')
      .select('id, league_id, name, logo_url, division_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('id', { ascending: true })),
    'imported aggregate teams',
    Math.min(MAX_SUPPORT_ROWS, maxRows),
  );
}

async function loadImportedAggregateSeason(
  season: StatsScopeSeason,
  divisionId: string | null,
  maxRows: number,
): Promise<StatsScopeSeasonPayload> {
  if (!isImportedAggregateSeasonId(season.id)) throw new PublicStatsScopeDataError('season is not an imported aggregate');
  const skaterSeeds = getImportedAggregateSkaterSeeds(season.id);
  const goalieSeeds = getImportedAggregateGoalieSeeds(season.id);
  const seedNames = [...new Set([...skaterSeeds, ...goalieSeeds].map((seed) => seed.playerName))];
  const { byName, sourceRowCount } = await readImportedAggregateIdentities(
    season.league_id,
    season.id,
    seedNames,
    maxRows,
  );
  const teams = await readAllLeagueTeams(
    season.league_id,
    remainingRows(maxRows, sourceRowCount, 'imported aggregate'),
  );
  const teamsByName = new Map<string, StatsScopeTeamRow[]>();
  for (const team of teams) {
    const key = normalizeName(team.name);
    if (key) teamsByName.set(key, [...(teamsByName.get(key) ?? []), team]);
  }
  const resolveTeam = (name: string | null) => {
    if (!name) return null;
    const candidates = teamsByName.get(normalizeName(name)) ?? [];
    if (candidates.length !== 1) throw new PublicStatsScopeDataError('imported aggregate team identity is missing or ambiguous');
    return candidates[0];
  };
  const players = new Map<string, PublicSeasonMetricPlayer>();
  const basePlayer = (name: string): PublicSeasonMetricPlayer => {
    const profile = (byName.get(normalizeName(name)) ?? [])[0];
    if (!profile) throw new PublicStatsScopeDataError('imported aggregate profile disappeared');
    validateProfileSource(profile);
    const existing = players.get(profile.id);
    if (existing) return existing;
    const created: PublicSeasonMetricPlayer = {
      playerId: profile.id,
      playerName: profile.full_name?.trim() || name,
      avatarUrl: resolvePublicStatsAvatar(profile.avatar_url, profile.photo_url, null),
      displayTeam: null,
      teams: [],
      roles: [],
      metrics: {
        gamesPlayed: unknownPublicMetric(['imported']),
        goals: unknownPublicMetric(['imported']),
        assists: unknownPublicMetric(['imported']),
        points: unknownPublicMetric(['imported']),
        penaltyMinutes: unknownPublicMetric(['imported']),
      },
      goalie: null,
    };
    players.set(profile.id, created);
    return created;
  };
  for (const seed of skaterSeeds) {
    const team = resolveTeam(seed.teamName);
    if (divisionId && team?.division_id !== divisionId) continue;
    const player = basePlayer(seed.playerName);
    player.roles.push('skater');
    player.metrics = {
      gamesPlayed: importedMetric(seed.gamesPlayed),
      goals: importedMetric(seed.goals),
      assists: importedMetric(seed.assists),
      points: importedMetric(seed.goals + seed.assists),
      penaltyMinutes: unknownPublicMetric(['imported']),
    };
    if (team) {
      player.displayTeam = { id: team.id, name: team.name };
      player.teams = [{ id: team.id, name: team.name }];
    }
  }
  for (const seed of goalieSeeds) {
    const team = resolveTeam(seed.teamName);
    if (divisionId && team?.division_id !== divisionId) continue;
    const player = basePlayer(seed.playerName);
    if (!player.roles.includes('goalie')) player.roles.push('goalie');
    const gamesPlayed = importedMetric(seed.gamesPlayed);
    const saves = importedMetric(seed.saves);
    const goalsAgainst = importedMetric(seed.goalsAgainst);
    const attempts = seed.saves + seed.goalsAgainst;
    player.goalie = {
      gamesPlayed,
      wins: importedMetric(seed.wins),
      losses: importedMetric(seed.losses),
      saves,
      goalsAgainst,
      savePercentage: attempts > 0 ? importedRateMetric(seed.saves / attempts) : unknownPublicMetric(['imported']),
      goalsAgainstAverage: seed.gamesPlayed > 0 ? importedRateMetric(seed.goalsAgainst / seed.gamesPlayed) : unknownPublicMetric(['imported']),
      shutouts: importedMetric(seed.shutouts),
    };
    if (!player.displayTeam && team) {
      player.displayTeam = { id: team.id, name: team.name };
      player.teams = [{ id: team.id, name: team.name }];
    }
  }
  return {
    presentationSeason: { id: season.id, name: season.name, league_id: season.league_id, status: season.status },
    players: [...players.values()],
    sourceRowCount: sourceRowCount + teams.length,
  };
}

async function readBadges(
  leagueId: string,
  seasonIds: string[],
  maxRows: number,
): Promise<StatsScopeBadgeRow[]> {
  const client = createServiceRoleClient();
  const build = () => serviceQuery<StatsScopeBadgeRow>(client.from('player_badges')
      .select('id, player_id, season_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('badge_type', 'championship')
      .in('season_id', seasonIds)
      .order('id', { ascending: true }));
  return readCompleteStatsScopeRows(build, 'championship badges', Math.min(MAX_BADGE_ROWS, maxRows));
}

async function readBaselines(leagueId: string, maxRows: number): Promise<StatsScopeBaselineRow[]> {
  const client = createServiceRoleClient();
  return readCompleteStatsScopeRows(
    () => serviceQuery<StatsScopeBaselineRow>(client.from('player_career_baselines')
      .select('id, player_id, is_goalie, games_played, goals, assists, points, goals_against, moosehead_cup_wins', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('id', { ascending: true })),
    'career baselines',
    Math.min(MAX_BASELINE_ROWS, maxRows),
  );
}

async function readTeams(leagueId: string, teamIds: string[], maxRows: number): Promise<StatsScopeTeamRow[]> {
  if (teamIds.length === 0) return [];
  const client = createServiceRoleClient();
  return readBatchedRows(teamIds, 'team assets', Math.min(MAX_SUPPORT_ROWS, maxRows), (batch) => serviceQuery<StatsScopeTeamRow>(client.from('teams')
    .select('id, league_id, name, logo_url, division_id', { count: 'exact' })
    .eq('league_id', leagueId)
    .in('id', batch)
    .order('id', { ascending: true })));
}

const defaultDependencies: PublicStatsScopeDependencies = {
  getLeagueBySlug,
  hasPlatformSubscription,
  requirePrivilegedAccess: assertRequiredPrivilegedMetricConfig,
  readPublicSeasonCatalog,
  readSeasonCatalog,
  readPublicDivision,
  readDivision,
  loadNativeSeason,
  loadImportedAggregateSeason,
  readBadges,
  readBaselines,
  readProfiles: readProfilesByIds,
  readTeams,
};

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': ERROR_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' } },
  );
}

export function assertPublicStatsScopeResponseBytes(body: string): void {
  if (new TextEncoder().encode(body).byteLength > MAX_PUBLIC_STATS_SCOPE_RESPONSE_BYTES) {
    throw new PublicStatsScopeLimitError('serialized response limit exceeded');
  }
}

function jsonSuccess(payload: unknown): NextResponse {
  const body = JSON.stringify(payload);
  assertPublicStatsScopeResponseBytes(body);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': SUCCESS_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function validateExactQuery(request: NextRequest): NextResponse | null {
  const allowed = new Set(['leagueSlug', 'scope', 'seasonId', 'divisionId']);
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!allowed.has(key)) return jsonError(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
  }
  for (const key of ['leagueSlug', 'scope']) {
    if (request.nextUrl.searchParams.getAll(key).length !== 1) {
      return jsonError(400, 'INVALID_QUERY', `Query parameter ${key} must appear once.`);
    }
  }
  if (request.nextUrl.searchParams.getAll('divisionId').length > 1) {
    return jsonError(400, 'INVALID_QUERY', 'Query parameter divisionId must appear once.');
  }
  if (request.nextUrl.searchParams.getAll('seasonId').length > MAX_PUBLIC_STATS_SCOPE_SEASONS) {
    return jsonError(413, 'SCOPE_LIMIT_EXCEEDED', 'Too many seasons were requested.');
  }
  return null;
}

function orderedVisibleSeasons(seasons: StatsScopeSeason[]): { current: StatsScopeSeason; ordered: StatsScopeSeason[] } | null {
  const visible = seasons.filter((season) => !isHistoricalCareerBaselineSeasonName(season.name));
  const current = pickOperationalSeason(visible);
  if (!current) return null;
  const timestamp = (season: StatsScopeSeason) => {
    const parsed = new Date(season.start_date ?? season.end_date ?? season.created_at ?? '').getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const remaining = visible.filter((season) => season.id !== current.id)
    .sort((left, right) => timestamp(right) - timestamp(left) || left.id.localeCompare(right.id, 'en'));
  return { current, ordered: [current, ...remaining] };
}

function validateCatalog(rows: StatsScopeSeason[], leagueId: string): void {
  const ids = new Set<string>();
  for (const season of rows) {
    if (!UUID_PATTERN.test(season.id) || season.league_id !== leagueId || ids.has(season.id)) {
      throw new PublicStatsScopeDataError('invalid season catalog identity');
    }
    validateText(season.name, 'season name');
    validateNullableText(season.status, 'season status', MAX_SHORT_TEXT_LENGTH);
    validateNullableText(season.start_date, 'season start date', MAX_SHORT_TEXT_LENGTH);
    ids.add(season.id);
  }
}

function validatePrivilegedCatalogEnrichment(
  publicCatalog: readonly StatsScopeSeason[],
  privilegedCatalog: readonly StatsScopeSeason[],
): void {
  const privilegedById = new Map(privilegedCatalog.map((season) => [season.id, season]));
  for (const publicSeason of publicCatalog) {
    const privilegedSeason = privilegedById.get(publicSeason.id);
    if (!privilegedSeason
      || privilegedSeason.league_id !== publicSeason.league_id
      || privilegedSeason.name !== publicSeason.name
      || privilegedSeason.status !== publicSeason.status
      || privilegedSeason.start_date !== publicSeason.start_date) {
      throw new PublicStatsScopeDataError('public season catalog enrichment mismatch');
    }
  }
}

function validateProducerMetric(value: PublicStatMetric, label: string): void {
  if (!METRIC_STATE_ORDER.includes(value.state) || !Array.isArray(value.sources)) {
    throw new PublicStatsScopeDataError(`invalid ${label} truth state`);
  }
  validateMetricSources(value.sources, label);
  if (value.value !== null) {
    safeNonnegative(value.value, label);
    if (value.value > MAX_METRIC_VALUE) throw new PublicStatsScopeDataError(`invalid ${label} value`);
  }
  if ((value.state === 'unknown' || value.state === 'conflicted') && value.value !== null) {
    throw new PublicStatsScopeDataError(`invalid ${label} unknown value`);
  }
  if (value.state !== 'unknown' && value.state !== 'conflicted' && value.value === null) {
    throw new PublicStatsScopeDataError(`invalid ${label} known value`);
  }
  if (value.candidates !== undefined) {
    const entries = Object.entries(value.candidates);
    if (entries.length === 0 || entries.some(([key, candidate]) =>
      !['confirmed', 'recorded', 'estimated'].includes(key)
      || typeof candidate !== 'number'
      || !Number.isInteger(candidate)
      || candidate < 0
      || candidate > MAX_METRIC_VALUE)) {
      throw new PublicStatsScopeDataError(`invalid ${label} candidates`);
    }
  }
}

function validateSeasonPayload(payload: StatsScopeSeasonPayload): void {
  if (payload.players.length > MAX_PUBLIC_STATS_SCOPE_PLAYERS) throw new PublicStatsScopeLimitError('season player limit exceeded');
  const playerIds = new Set<string>();
  for (const player of payload.players) {
    if (!UUID_PATTERN.test(player.playerId) || playerIds.has(player.playerId) || !player.playerName.trim()) {
      throw new PublicStatsScopeDataError('invalid or duplicate season player');
    }
    validateText(player.playerName, 'season player name');
    validateNullableText(player.avatarUrl, 'season player avatar', MAX_MEDIA_TEXT_LENGTH);
    playerIds.add(player.playerId);
    if (player.displayTeam && (!UUID_PATTERN.test(player.displayTeam.id) || !player.displayTeam.name.trim())) {
      throw new PublicStatsScopeDataError('invalid season display team');
    }
    if (player.displayTeam) validateText(player.displayTeam.name, 'season display team name');
    if (player.roles.length === 0 || player.roles.length > 2 || new Set(player.roles).size !== player.roles.length
      || player.roles.some((role) => role !== 'skater' && role !== 'goalie')) {
      throw new PublicStatsScopeDataError('invalid season player roles');
    }
    for (const [label, value] of Object.entries(player.metrics)) validateProducerMetric(value, `skater ${label}`);
    const { goals, assists, points } = player.metrics;
    if (goals.value !== null && assists.value !== null && points.value !== goals.value + assists.value) {
      throw new PublicStatsScopeDataError('season points do not reconcile');
    }
    if (player.goalie) {
      for (const [label, value] of Object.entries(player.goalie)) validateProducerMetric(value, `goalie ${label}`);
      const { gamesPlayed, goalsAgainst, goalsAgainstAverage } = player.goalie;
      if (gamesPlayed.value !== null && goalsAgainst.value !== null) {
        const expected = gamesPlayed.value > 0 ? goalsAgainst.value / gamesPlayed.value : null;
        if (expected === null ? goalsAgainstAverage.value !== null
          : goalsAgainstAverage.value === null || Math.abs(goalsAgainstAverage.value - expected) > 0.0001) {
          throw new PublicStatsScopeDataError('season goalie GAA does not reconcile');
        }
      }
    }
  }
}

function validateFinalPlayers(players: readonly StatsScopePlayer[]): void {
  for (const player of players) {
    validateText(player.playerName, 'player name');
    validateNullableText(player.avatarUrl, 'player avatar', MAX_MEDIA_TEXT_LENGTH);
    if (player.displayTeam) {
      validateText(player.displayTeam.name, 'display team name');
      validateNullableText(player.displayTeam.logoUrl, 'display team logo', MAX_MEDIA_TEXT_LENGTH);
    }
    for (const group of [player.skater, player.goalie]) {
      if (!group) continue;
      for (const metricValue of Object.values(group)) {
        validateMetricSources(metricValue.sources, 'response metric');
        if (metricValue.value !== null) {
          safeNonnegative(metricValue.value, 'response metric');
          if (metricValue.value > MAX_METRIC_VALUE) {
            throw new PublicStatsScopeDataError('invalid response metric value');
          }
        }
      }
    }
  }
}

function validateBaselines(rows: StatsScopeBaselineRow[]): void {
  const ids = new Set<string>();
  const playerIds = new Set<string>();
  for (const row of rows) {
    if (!UUID_PATTERN.test(row.id) || ids.has(row.id) || !row.player_id || !UUID_PATTERN.test(row.player_id) || playerIds.has(row.player_id)) {
      throw new PublicStatsScopeDataError('invalid or duplicate imported baseline');
    }
    if (typeof row.is_goalie !== 'boolean') throw new PublicStatsScopeDataError('invalid imported baseline role');
    ids.add(row.id);
    playerIds.add(row.player_id);
    for (const [field, value] of Object.entries({
      games_played: row.games_played,
      goals: row.goals,
      assists: row.assists,
      points: row.points,
      goals_against: row.goals_against,
      moosehead_cup_wins: row.moosehead_cup_wins,
    })) safeNonnegative(value, `baseline ${field}`, true);
    if (row.points !== row.goals + row.assists) throw new PublicStatsScopeDataError('imported baseline points do not reconcile');
  }
}

function validateBadges(
  rows: StatsScopeBadgeRow[],
  publicCatalog: StatsScopeSeason[],
  selectedSeasonIds: ReadonlySet<string>,
): void {
  const ids = new Set<string>();
  const playerSeasonKeys = new Set<string>();
  const publicCatalogById = new Map(publicCatalog.map((season) => [season.id, season]));
  for (const row of rows) {
    if (!UUID_PATTERN.test(row.id) || ids.has(row.id) || !row.player_id || !UUID_PATTERN.test(row.player_id)
      || !row.season_id || !UUID_PATTERN.test(row.season_id)) {
      throw new PublicStatsScopeDataError('invalid championship badge identity');
    }
    ids.add(row.id);
    const season = publicCatalogById.get(row.season_id);
    if (!season) throw new PublicStatsScopeDataError('championship badge references a foreign season');
    if (isHistoricalCareerBaselineSeasonName(season.name)) {
      throw new PublicStatsScopeDataError('native and imported championships overlap');
    }
    if (!selectedSeasonIds.has(row.season_id)) {
      throw new PublicStatsScopeDataError('championship badge is outside the selected seasons');
    }
    const key = `${row.player_id}\u0000${row.season_id}`;
    if (playerSeasonKeys.has(key)) throw new PublicStatsScopeDataError('duplicate championship badge');
    playerSeasonKeys.add(key);
  }
}

function scopeLabel(kind: PublicStatsScopeKind, selected: StatsScopeSeason[]): string {
  if (kind === 'current') return 'Current season';
  if (kind === 'all') return 'All time';
  if (kind === 'single') return selected[0].name;
  return `${selected.length} seasons`;
}

export async function handlePublicStatsScopeRequest(
  request: NextRequest,
  deps: PublicStatsScopeDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const queryError = validateExactQuery(request);
  if (queryError) return queryError;
  const slug = request.nextUrl.searchParams.get('leagueSlug');
  const kind = request.nextUrl.searchParams.get('scope') as PublicStatsScopeKind | null;
  const divisionId = request.nextUrl.searchParams.get('divisionId');
  const requestedSeasonIds: string[] = request.nextUrl.searchParams.getAll('seasonId');
  if (!slug || slug.length > 63 || !SLUG_PATTERN.test(slug)) {
    return jsonError(400, 'INVALID_LEAGUE_SLUG', 'leagueSlug must be a lowercase ASCII host slug.');
  }
  if (!kind || !['current', 'single', 'multiple', 'all'].includes(kind)) {
    return jsonError(400, 'INVALID_SCOPE', 'A valid stats scope is required.');
  }
  if (divisionId !== null && !UUID_PATTERN.test(divisionId)) {
    return jsonError(400, 'INVALID_DIVISION_ID', 'divisionId must be a UUID.');
  }
  if (requestedSeasonIds.some((id) => !UUID_PATTERN.test(id)) || new Set(requestedSeasonIds).size !== requestedSeasonIds.length) {
    return jsonError(400, 'INVALID_SEASON_ID', 'seasonId values must be unique UUIDs.');
  }
  if ((kind === 'single' && requestedSeasonIds.length !== 1)
    || (kind === 'multiple' && requestedSeasonIds.length < 1)
    || ((kind === 'current' || kind === 'all') && requestedSeasonIds.length !== 0)) {
    return jsonError(400, 'INVALID_SCOPE', 'The selected seasons do not match the stats scope.');
  }
  if (!supportsPublicStatsScopeDivision(kind, divisionId)) {
    return jsonError(422, 'SCOPE_UNAVAILABLE', 'All-time historical aggregates are league-wide and cannot be filtered by division.');
  }
  const tenant = getPublicStatsTenantHost(request);
  if (tenant.kind === 'slug' && tenant.slug !== slug) {
    return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
  }

  try {
    deps.requirePrivilegedAccess();
    const league = await deps.getLeagueBySlug(slug);
    if (!league || league.status !== 'active' || !(await deps.hasPlatformSubscription(league.id))) {
      return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    }
    if (tenant.kind === 'custom') {
      const verifiedDomain = league.custom_domain_verified
        ? league.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') ?? null
        : null;
      if (verifiedDomain !== tenant.hostname) {
        return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
      }
    }
    let sourceRows = 0;
    const publicCatalogBudget = remainingRows(
      MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS,
      sourceRows,
      'scope source',
    );
    const publicCatalog = await deps.readPublicSeasonCatalog(league.id, publicCatalogBudget);
    if (publicCatalog.length > publicCatalogBudget) throw new PublicStatsScopeLimitError('scope source row limit exceeded');
    sourceRows += publicCatalog.length;
    validateCatalog(publicCatalog, league.id);
    const orderedCatalog = orderedVisibleSeasons(publicCatalog);
    if (!orderedCatalog) return jsonError(404, 'NO_SEASON', 'No operational season is available.');

    const requested = new Set(requestedSeasonIds);
    const selected = kind === 'current'
      ? [orderedCatalog.current]
      : kind === 'all'
        ? orderedCatalog.ordered
        : orderedCatalog.ordered.filter((season) => requested.has(season.id));
    const expectedSelectedCount = kind === 'current' ? 1 : kind === 'all' ? orderedCatalog.ordered.length : requestedSeasonIds.length;
    if (selected.length !== expectedSelectedCount) {
      return jsonError(409, 'SEASON_MISMATCH', 'One or more selected seasons do not belong to this league.');
    }
    if (selected.length > MAX_PUBLIC_STATS_SCOPE_SEASONS) {
      return jsonError(413, 'SCOPE_LIMIT_EXCEEDED', 'The selected timeline exceeds the season work limit.');
    }

    let publicDivision: StatsScopeDivision | null = null;
    if (divisionId) {
      const publicDivisionBudget = remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source');
      publicDivision = await deps.readPublicDivision(league.id, divisionId, publicDivisionBudget);
      if (!publicDivision || publicDivision.id !== divisionId || publicDivision.league_id !== league.id) {
        return jsonError(400, 'DIVISION_NOT_IN_LEAGUE', 'divisionId does not belong to this league.');
      }
      sourceRows += 1;
    }

    const privilegedCatalogBudget = remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source');
    const catalog = await deps.readSeasonCatalog(league.id, privilegedCatalogBudget);
    if (catalog.length > privilegedCatalogBudget) throw new PublicStatsScopeLimitError('scope source row limit exceeded');
    sourceRows += catalog.length;
    validateCatalog(catalog, league.id);
    validatePrivilegedCatalogEnrichment(publicCatalog, catalog);

    if (divisionId && publicDivision) {
      const divisionBudget = remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source');
      const division = await deps.readDivision(league.id, divisionId, divisionBudget);
      if (!division || division.id !== divisionId || division.league_id !== league.id) {
        return jsonError(400, 'DIVISION_NOT_IN_LEAGUE', 'divisionId does not belong to this league.');
      }
      sourceRows += 1;
    }

    const payloads: StatsScopeSeasonPayload[] = [];
    for (const season of selected) {
      const seasonBudget = remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source');
      const payload = isImportedAggregateSeasonId(season.id)
        ? await deps.loadImportedAggregateSeason(season, divisionId, seasonBudget)
        : await deps.loadNativeSeason(season, divisionId, seasonBudget);
      if (payload.presentationSeason.id !== season.id
        || payload.presentationSeason.league_id !== league.id
        || payload.presentationSeason.name !== season.name
        || payload.presentationSeason.status !== season.status) {
        throw new PublicStatsScopeDataError('season producer identity mismatch');
      }
      validateSeasonPayload(payload);
      const producedRows = safeNonnegative(payload.sourceRowCount, 'season source row count', true);
      if (producedRows > seasonBudget) throw new PublicStatsScopeLimitError('scope source row limit exceeded');
      sourceRows += producedRows;
      payloads.push(payload);
    }

    const baselines = kind === 'all'
      ? await deps.readBaselines(
          league.id,
          remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source'),
        )
      : [];
    validateBaselines(baselines);
    sourceRows += baselines.length;
    const selectedSeasonIds = selected.map((season) => season.id);
    const badgeBudget = remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source');
    const badges = await deps.readBadges(
      league.id,
      selectedSeasonIds,
      badgeBudget,
    );
    if (badges.length > badgeBudget) throw new PublicStatsScopeLimitError('scope support row limit exceeded');
    validateBadges(badges, publicCatalog, new Set(selectedSeasonIds));
    sourceRows += badges.length;

    const playerIds = [...new Set([
      ...payloads.flatMap((payload) => payload.players.map((player) => player.playerId)),
      ...baselines.flatMap((baseline) => baseline.player_id ? [baseline.player_id] : []),
    ])];
    if (playerIds.length > MAX_PUBLIC_STATS_SCOPE_PLAYERS) throw new PublicStatsScopeLimitError('player limit exceeded');
    const profiles = playerIds.length > 0
      ? await deps.readProfiles(
          playerIds,
          remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source'),
        )
      : [];
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    if (profiles.length !== playerIds.length || profileMap.size !== playerIds.length || playerIds.some((id) => !profileMap.has(id))) {
      throw new PublicStatsScopeDataError('profile read incomplete');
    }
    if (profiles.some((profile) => !UUID_PATTERN.test(profile.id))) throw new PublicStatsScopeDataError('invalid profile identity');
    profiles.forEach(validateProfileSource);
    const teamIds = [...new Set(payloads.flatMap((payload) => payload.players.flatMap((player) =>
      player.displayTeam ? [player.displayTeam.id] : [])))];
    sourceRows += profiles.length;
    const teams = teamIds.length > 0
      ? await deps.readTeams(
          league.id,
          teamIds,
          remainingRows(MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS, sourceRows, 'scope source'),
        )
      : [];
    const teamMap = new Map(teams.map((team) => [team.id, team]));
    if (teams.length !== teamIds.length || teamMap.size !== teamIds.length
      || teamIds.some((id) => !teamMap.has(id))
      || teams.some((team) => !UUID_PATTERN.test(team.id) || team.league_id !== league.id || !team.name.trim())) {
      throw new PublicStatsScopeDataError('team asset read incomplete');
    }
    for (const team of teams) {
      validateText(team.name, 'team name');
      validateSourceTextLength(team.logo_url, 'team logo', MAX_MEDIA_TEXT_LENGTH);
    }
    sourceRows += teams.length;
    const players = aggregatePublicStatsScope({
      payloads,
      profiles: profileMap,
      teams: teamMap,
      badges,
      baselines,
      includeBaselines: kind === 'all',
    });
    const label = scopeLabel(kind, selected);
    validateText(label, 'scope label');
    validateFinalPlayers(players);
    return jsonSuccess({
      schemaVersion: PUBLIC_STATS_SCOPE_SCHEMA_VERSION,
      leagueId: league.id,
      leagueSlug: league.slug,
      divisionId,
      scope: {
        kind,
        label,
        seasonIds: selected.map((season) => season.id),
        currentSeasonId: orderedCatalog.current.id,
      },
      seasons: orderedCatalog.ordered.map((season) => ({
        id: season.id,
        name: season.name,
        status: season.status,
        startDate: season.start_date,
      })),
      players,
    });
  } catch (caught) {
    console.error('[public-stats-scope] public read failed', {
      leagueSlug: slug,
      errorType: caught instanceof Error ? caught.name : 'unknown',
    });
    const limit = caught instanceof PublicStatsScopeLimitError || caught instanceof PublicMetricLimitError;
    return jsonError(
      limit ? 413 : 503,
      limit ? 'SCOPE_LIMIT_EXCEEDED' : 'STATS_SCOPE_UNAVAILABLE',
      limit
        ? 'The complete stats scope is too large to return safely.'
        : 'Complete authoritative statistics are temporarily unavailable for this timeline.',
    );
  }
}
