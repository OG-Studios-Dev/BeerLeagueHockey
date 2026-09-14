import { unstable_noStore as noStore } from 'next/cache';
import { createClient, createServiceRoleClient } from './supabase/server';
import type {
  League,
  LeagueTheme,
  Season,
  Division,
  Team,
  TeamStanding,
  Game,
  Player,
  PlayerStats,
  PlayerStatsWithAvatar,
  HomepageSeasonLeader,
  LeagueStats,
  UpcomingGame,
  RecentGame,
  TickerGame,
  ScheduleGame,
  GamePreview,
  SeasonSeriesGame,
  TeamSeasonStats,
  PlayerStat,
  GoalieStats,
  GoalieStatsWithDivision,
  UnifiedGoalieStatsRow,
  UnifiedStatsRowBase,
  UnifiedSkaterStatsRow,
  PlayerGameLogEntry,
  SpecialTeamsLeader,
  Suspension,
  NewsArticle,
  LeagueEvent,
  GalleryAlbum,
  GalleryPhoto,
  StaffMember,
  LeagueSponsor,
  LeagueAward,
  ThemePreset,
  GameSheetData,
  GameSheetGoal,
  GameSheetPenalty,
  GameSheetGoalie,
  GamePlayerStats,
  PlayerBadge,
  ArticleLinkContext,
} from './types';
import {
  buildHistoricalBaselineGoalieRows,
  buildHistoricalBaselineSkaterRows,
  collectHistoricalCareerBaselineSeasonIds,
  filterVisibleSiteSeasons,
  IMPORTED_ALL_TIME_TEAM_LABEL,
  isHistoricalCareerBaselineSeasonName,
  mergeAllTimeGoalieRows,
  mergeAllTimeSkaterRows,
  normalizeImportedCareerBaselineRows,
  type ImportedCareerBaselineRow,
} from './all-time-stats';
import {
  buildTeamsDirectoryBumpChartData,
  type TeamCommitmentSnapshot,
  type TeamScoringDepthSnapshot,
  type TeamsDirectoryBumpChartData,
} from './teams-directory-bump-chart';
import {
  applyImportedAggregateGoalieOverride,
  applyImportedAggregateSkaterOverride,
  getImportedAggregateGoalieSeed,
  getImportedAggregateGoalieSeeds,
  getImportedAggregateGoalieOverride,
  getImportedAggregateSkaterSeed,
  getImportedAggregateSkaterSeeds,
  getImportedAggregateSkaterGamesPlayed,
  HLHL_WINTER_2026_SEASON_ID,
  isAggregateOnlySeasonView,
  isImportedAggregateSeasonId,
} from './imported-aggregate-season-overrides';
import { getBalancedLeagueColors } from './theme-palette';
import { getLeagueDateKey, getLeagueWeekDateRange, resolveLeagueTimezone } from './league-timezone';
import { pickOperationalSeason } from './seasons/operational';
import { resolveSeasonParticipationTeamIds } from './season-team-participation';
import { filterPublicStandings, filterPublicTeams, isPublicFacingTeam } from './publicSiteVisibility';
import { resolvePlayerPhotoUrl } from './player-photo';

// Default brand colors – platinum/silver fallback instead of gold
const DEFAULT_PRIMARY = '#C0C0C0';
const DEFAULT_SECONDARY = '#1a1a1a';
const DEFAULT_ACCENT = '#C0C0C0';
const DEFAULT_FONT_FAMILY = '"Rajdhani", "Sora", "Inter", system-ui, -apple-system, sans-serif';
const LEGACY_ALL_TIME_LEAGUE_SLUGS = new Set(['hockey-life', 'hockeylifehl', 'hockeylifehl-original', 'pilot']);
const AGGREGATE_STATS_GAME_LOCATION_PREFIX = '[aggregate-only]';
const FREE_AGENT_DISPLAY_TEAM_NAME = 'Free Agent';
const FREE_AGENT_DISPLAY_TEAM_LOGO_URL = '/sponsors/beer-league-hockey.png';
const ASSUMED_GOALIE_SHOTS_AGAINST = 20;
const IMPORTED_CAREER_BASELINE_TABLE_CANDIDATES = [
  'league_player_career_baselines',
  'player_career_baselines',
  'career_stat_baselines',
  'league_career_stat_baselines',
  'imported_career_baselines',
  'imported_career_stat_baselines',
];

export type CanonicalReadOptions = { strict?: boolean };

function throwCanonicalReadError(error: unknown, context: string): never {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const code = typeof record?.code === 'string' && record.code.trim() ? record.code.trim() : null;
  const message = typeof record?.message === 'string' && record.message.trim()
    ? record.message.trim()
    : error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'unknown provider error';
  const cause = error instanceof Error ? error : new Error(code ? `${code}: ${message}` : message);
  throw new Error(`Canonical read failed: ${context}`, { cause });
}

type LegacyPlayerRow = {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string | null;
  is_goalie: boolean | null;
  games_played: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
  wins: number | null;
  ties: number | null;
  goals_against: number | null;
  goals_against_average: number | null;
  saves: number | null;
  shutouts: number | null;
  save_percentage: number | null;
  matched_to_profile_id: string | null;
  imported_from: string | null;
};

export type PlayerCareerSeasonRow = {
  season_id: string;
  season_name: string;
  sort_date: string | null;
  team_id: string | null;
  team_name: string | null;
  position: string | null;
  games_played: number;
  team_games: number;
  attendance_pct: number;
  goals: number;
  assists: number;
  points: number;
  goals_per_game: number;
  points_per_game: number;
  wins: number;
  losses: number;
  ties: number;
  saves: number;
  goals_against: number;
  save_percentage: number | null;
  goals_against_average: number | null;
  shutouts: number;
};

export function filterVisiblePlayerCareerTimelineRows(
  rows: PlayerCareerSeasonRow[],
  options: { includeHistoricalBaseline?: boolean } = {},
): PlayerCareerSeasonRow[] {
  const { includeHistoricalBaseline = false } = options;

  return rows.filter((row) => {
    const seasonName = row.season_name?.trim();
    if (!seasonName || seasonName === 'Unknown Season') {
      return false;
    }

    return includeHistoricalBaseline || !isHistoricalCareerBaselineSeasonName(seasonName);
  });
}

function roundCareerMetric(value: number, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function supportsLegacyAllTimeStats(leagueSlug?: string): boolean {
  return Boolean(leagueSlug && LEGACY_ALL_TIME_LEAGUE_SLUGS.has(leagueSlug.toLowerCase()));
}

function compareLegacySkaters(left: PlayerStats, right: PlayerStats, statType: 'points' | 'goals' | 'assists') {
  const primary = right[statType] - left[statType];
  if (primary !== 0) return primary;

  const pointDiff = right.points - left.points;
  if (pointDiff !== 0) return pointDiff;

  const goalDiff = right.goals - left.goals;
  if (goalDiff !== 0) return goalDiff;

  const assistDiff = right.assists - left.assists;
  if (assistDiff !== 0) return assistDiff;

  const gpDiff = right.games_played - left.games_played;
  if (gpDiff !== 0) return gpDiff;

  return left.player_name.localeCompare(right.player_name);
}

function compareLegacyGoalies(
  left: GoalieStats,
  right: GoalieStats,
  sortBy: 'wins' | 'save_percentage' | 'goals_against_average' | 'shutouts',
) {
  switch (sortBy) {
    case 'save_percentage': {
      const svDiff = right.save_percentage - left.save_percentage;
      if (svDiff !== 0) return svDiff;
      break;
    }
    case 'goals_against_average': {
      const gaaDiff = left.goals_against_average - right.goals_against_average;
      if (gaaDiff !== 0) return gaaDiff;
      break;
    }
    case 'shutouts': {
      const shutoutDiff = right.shutouts - left.shutouts;
      if (shutoutDiff !== 0) return shutoutDiff;
      break;
    }
    case 'wins':
    default: {
      const winDiff = right.wins - left.wins;
      if (winDiff !== 0) return winDiff;
      break;
    }
  }

  const winDiff = right.wins - left.wins;
  if (winDiff !== 0) return winDiff;

  const shutoutDiff = right.shutouts - left.shutouts;
  if (shutoutDiff !== 0) return shutoutDiff;

  const svDiff = right.save_percentage - left.save_percentage;
  if (svDiff !== 0) return svDiff;

  const gaaDiff = left.goals_against_average - right.goals_against_average;
  if (gaaDiff !== 0) return gaaDiff;

  const gpDiff = right.games_played - left.games_played;
  if (gpDiff !== 0) return gpDiff;

  return left.player_name.localeCompare(right.player_name);
}

async function getLegacyAllTimePlayers(options: CanonicalReadOptions = {}): Promise<LegacyPlayerRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('legacy_players')
    .select(
      'id, first_name, last_name, full_name, is_goalie, games_played, goals, assists, points, wins, ties, goals_against, goals_against_average, saves, shutouts, save_percentage, matched_to_profile_id, imported_from'
    )
    .order('full_name', { ascending: true });

  if (error || !data) {
    if (error && options.strict) throwCanonicalReadError(error, 'legacy_players');
    return [];
  }

  return data as LegacyPlayerRow[];
}

function isMissingRelationError(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const code = typeof record?.code === 'string' ? record.code.toUpperCase() : null;
  if (code) return code === '42P01' || code === 'PGRST205';
  const message = typeof record?.message === 'string' ? record.message : error instanceof Error ? error.message : '';
  return /^Could not find the table '[^']+' in the schema cache\.?$/i.test(message.trim());
}

function isMissingOptionalCapabilityError(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const code = typeof record?.code === 'string' ? record.code.toUpperCase() : null;
  if (code) return code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202';
  const message = typeof record?.message === 'string' ? record.message : error instanceof Error ? error.message : '';
  return isMissingRelationError(error)
    || /^Could not find the function '[^']+' in the schema cache\.?$/i.test(message.trim());
}

const CANONICAL_ID_BATCH_SIZE = 100;
const CANONICAL_PAGE_SIZE = 1000;
const CANONICAL_BATCH_CONCURRENCY = 4;
type CanonicalBatchQuery = {
  range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown }>;
};

function chunkCanonicalValues<T>(values: T[], size = CANONICAL_ID_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

async function readCanonicalBatchedRows<T>(
  values: string[],
  context: string,
  buildQuery: (batch: string[]) => CanonicalBatchQuery,
  options: CanonicalReadOptions = {},
): Promise<T[] | null> {
  const batches = chunkCanonicalValues(values);
  const results: Array<T[] | null> = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const rows: T[] = [];
      for (let offset = 0; ; offset += CANONICAL_PAGE_SIZE) {
        const { data, error } = await buildQuery(batches[index]).range(offset, offset + CANONICAL_PAGE_SIZE - 1);
        if (error) {
          if (options.strict) throwCanonicalReadError(error, `${context} batch ${index + 1} page ${offset}`);
          results[index] = null;
          break;
        }
        const page = (data || []) as T[];
        rows.push(...page);
        if (page.length < CANONICAL_PAGE_SIZE) {
          results[index] = rows;
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CANONICAL_BATCH_CONCURRENCY, batches.length) }, worker));
  return results.some((result) => result === null) ? null : results.flatMap((result) => result || []);
}

function isLikelyUuid(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

async function hydrateBaselineAvatarUrls(rows: ImportedCareerBaselineRow[], options: CanonicalReadOptions = {}): Promise<ImportedCareerBaselineRow[]> {
  const profileIds = [...new Set(
    rows
      .map((row) => options.strict
        ? row.profile_id_league_verified ? row.profile_id : null
        : row.profile_id ?? (isLikelyUuid(row.player_id) ? row.player_id : null))
      .filter((profileId): profileId is string => Boolean(profileId)),
  )];

  if (profileIds.length === 0) {
    return rows;
  }

  const supabase = createServiceRoleClient();
  const profiles = await readCanonicalBatchedRows<{ id: string; avatar_url: string | null; photo_url?: string | null }>(
    profileIds,
    'baseline profiles',
    (batch) => supabase.from('profiles').select('id, avatar_url, photo_url').in('id', batch),
    options,
  );

  const avatarMap = new Map<string, string | null>(
    (profiles || []).map((profile) => [profile.id, resolvePlayerPhotoUrl(profile)]),
  );

  return rows.map((row) => ({
    ...row,
    avatar_url: row.avatar_url || avatarMap.get(row.profile_id || row.player_id) || null,
  }));
}

async function verifyBaselineProfileIdentities(
  rows: ImportedCareerBaselineRow[],
  leagueId: string,
  options: CanonicalReadOptions = {},
): Promise<ImportedCareerBaselineRow[]> {
  if (!options.strict) return rows;
  const candidateIds = [...new Set(rows
    .filter((row) => !row.profile_id_league_verified && isLikelyUuid(row.profile_id))
    .map((row) => row.profile_id!))];
  if (candidateIds.length === 0) return rows;
  const supabase = createServiceRoleClient();
  const proofs = await readCanonicalBatchedRows<{ player_id: string }>(
    candidateIds,
    'baseline profile league proofs',
    (batch) => supabase.from('team_rosters').select('player_id').eq('league_id', leagueId).in('player_id', batch),
    options,
  );
  const provenIds = new Set((proofs || []).map((row) => row.player_id));
  return rows.map((row) => ({
    ...row,
    profile_id_league_verified: Boolean(row.profile_id_league_verified || row.profile_id && provenIds.has(row.profile_id)),
  }));
}

async function fetchImportedCareerBaselineRowsFromCandidates(
  leagueId: string,
  leagueSlug?: string,
  options: CanonicalReadOptions = {},
): Promise<ImportedCareerBaselineRow[]> {
  const supabase = createServiceRoleClient();

  for (const tableName of IMPORTED_CAREER_BASELINE_TABLE_CANDIDATES) {
    const data: Record<string, unknown>[] = [];
    let error: unknown = null;
    for (let offset = 0; ; offset += CANONICAL_PAGE_SIZE) {
      const page = await (supabase as any).from(tableName).select('*').range(offset, offset + CANONICAL_PAGE_SIZE - 1);
      if (page.error) { error = page.error; break; }
      const pageRows = (page.data || []) as Record<string, unknown>[];
      data.push(...pageRows);
      if (pageRows.length < CANONICAL_PAGE_SIZE) break;
    }

    if (error) {
      if (isMissingRelationError(error)) {
        continue;
      }
      if (options.strict) throwCanonicalReadError(error, tableName);
      continue;
    }

    const normalized = normalizeImportedCareerBaselineRows(data, {
      sourceTable: tableName,
      leagueId,
      leagueSlug,
      defaultTeamName: IMPORTED_ALL_TIME_TEAM_LABEL,
    });

    if (normalized.length > 0) {
      return hydrateBaselineAvatarUrls(await verifyBaselineProfileIdentities(normalized, leagueId, options), options);
    }
  }

  return [];
}

async function getImportedCareerBaselineRows(
  leagueId: string,
  leagueSlug?: string,
  options: CanonicalReadOptions = {},
): Promise<ImportedCareerBaselineRow[]> {
  const baselineRows = await fetchImportedCareerBaselineRowsFromCandidates(leagueId, leagueSlug, options);
  if (baselineRows.length > 0) {
    return baselineRows;
  }

  if (!supportsLegacyAllTimeStats(leagueSlug)) {
    return [];
  }

  const legacyRows = await getLegacyAllTimePlayers(options);
  const normalized = normalizeImportedCareerBaselineRows(legacyRows as unknown as Record<string, unknown>[], {
    sourceTable: 'legacy_players',
    defaultTeamName: IMPORTED_ALL_TIME_TEAM_LABEL,
  });

  return hydrateBaselineAvatarUrls(await verifyBaselineProfileIdentities(normalized, leagueId, options), options);
}

function getThemePreset(league: League): ThemePreset {
  const preset = (league.settings?.website as { themePreset?: string } | undefined)?.themePreset;

  if (preset === 'light' || preset === 'custom') {
    return preset;
  }

  return 'dark';
}

/**
 * Helper to transform team data from DB columns to expected format
 * Maps: logo_url -> logo, primary_color+secondary_color -> colors
 */
function transformTeamData(team: any): any {
  if (!team) return null;
  const rawTeam = Array.isArray(team) ? team[0] : team;
  if (!rawTeam) return null;

  // Map logo_url to logo, combine colors
  const colors = [rawTeam.primary_color, rawTeam.secondary_color].filter(Boolean).join(',') || null;
  return {
    id: rawTeam.id,
    name: rawTeam.name,
    slug: rawTeam.slug,
    logo: rawTeam.logo_url || null,
    logo_url: rawTeam.logo_url || null,
    colors,
    primary_color: rawTeam.primary_color || null,
    secondary_color: rawTeam.secondary_color || null,
    division_id: rawTeam.division_id,
    division: rawTeam.division || (Array.isArray(rawTeam.divisions) ? rawTeam.divisions[0] : rawTeam.divisions) || null,
  };
}

function roundStatValue(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function toRecencyTimestamp(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

function unwrapJoinedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

function getJoinedDivisionName(value: { name?: string | null } | { name?: string | null }[] | null | undefined) {
  const division = unwrapJoinedRecord(value);
  return division?.name || null;
}

function isGoaliePosition(position?: string | null) {
  const normalized = position?.trim().toLowerCase();
  return normalized === 'g' || normalized === 'goalie';
}

function resolveGoalieGameResult(
  storedResult: string | null | undefined,
  game: {
    home_team_id?: string | null;
    away_team_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  } | null,
  teamId: string,
) {
  const normalized = storedResult?.trim().toUpperCase();
  if (normalized) {
    return normalized;
  }

  if (!game || game.home_score == null || game.away_score == null) {
    return null;
  }

  const isHome = game.home_team_id === teamId;
  const myScore = isHome ? game.home_score : game.away_score;
  const opponentScore = isHome ? game.away_score : game.home_score;

  if (myScore > opponentScore) {
    return 'W';
  }

  if (myScore < opponentScore) {
    return 'L';
  }

  return 'T';
}

function matchesDivisionFilter(
  game: {
    division_id?: string | null;
    division?: { id?: string | null } | null;
    home_team?: any;
    away_team?: any;
  },
  divisionId: string,
): boolean {
  const candidates = [
    game.division_id,
    game.division?.id ?? null,
    game.home_team?.division_id ?? null,
    game.home_team?.division?.id ?? null,
    game.away_team?.division_id ?? null,
    game.away_team?.division?.id ?? null,
  ];

  return candidates.some((id) => id === divisionId);
}

/**
 * Fetch league by slug for public display
 */
export async function getLeagueBySlug(slug: string): Promise<League | null> {
  noStore();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return null;
  }

  return data as League;
}

/**
 * Get league theme (colors, logo, banner)
 */
export function getLeagueTheme(league: League): LeagueTheme {
  const templateVariant = getThemePreset(league);
  const colors = getBalancedLeagueColors({
    primaryColor: league.primary_color || DEFAULT_PRIMARY,
    secondaryColor: league.secondary_color || DEFAULT_SECONDARY,
    accentColor: league.accent_color || league.primary_color || DEFAULT_ACCENT,
    themePreset: templateVariant,
  });

  return {
    primaryColor: colors.primaryColor,
    secondaryColor: colors.secondaryColor,
    accentColor: colors.accentColor,
    primaryStrong: colors.primaryStrong,
    primarySoft: colors.primarySoft,
    primaryBorder: colors.primaryBorder,
    primaryMuted: colors.primaryMuted,
    secondarySafe: colors.secondarySafe,
    onPrimary: colors.onPrimary,
    onSecondary: colors.onSecondary,
    surfaceTint: colors.surfaceTint,
    surfaceTintStrong: colors.surfaceTintStrong,
    logoUrl: league.logo_url,
    bannerUrl: league.banner_url,
    fontFamily: league.settings?.website?.themePreset === 'light'
      ? '"Sora", "Inter", system-ui, -apple-system, sans-serif'
      : league.font_family || DEFAULT_FONT_FAMILY,
    templateVariant,
  };
}

/**
 * Fetch the current operational season for a league.
 *
 * Prefers active/playoff/registration/draft seasons before falling back to
 * older completed seasons so public league-sites stay aligned with the next
 * live season setup.
 */
export async function getCurrentSeason(leagueId: string, options: CanonicalReadOptions = {}): Promise<Season | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) {
    if (error && options.strict) throwCanonicalReadError(error, 'current season');
    return null;
  }

  return (pickOperationalSeason(data as Season[]) as Season | null) ?? null;
}

/**
 * Fetch all divisions for a league
 */
export async function getDivisions(leagueId: string): Promise<Division[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('divisions')
    .select('*')
    .eq('league_id', leagueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as Division[];
}

/**
 * Fetch all seasons for a league
 */
export async function getSeasons(leagueId: string): Promise<Season[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false });

  if (error || !data) {
    return [];
  }

  return filterVisibleSiteSeasons(data as Season[]);
}

async function getHistoricalCareerBaselineSeasonIdsForLeague(
  supabase: any,
  leagueId: string,
  seasonIds: Array<string | null | undefined>,
  options: CanonicalReadOptions = {},
): Promise<Set<string>> {
  const normalizedSeasonIds = [...new Set(seasonIds.filter((seasonId): seasonId is string => Boolean(seasonId)))];

  if (normalizedSeasonIds.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('league_id', leagueId)
    .in('id', normalizedSeasonIds);

  if (error || !data) {
    if (error && options.strict) throwCanonicalReadError(error, 'historical baseline seasons');
    return new Set();
  }

  return collectHistoricalCareerBaselineSeasonIds(data as Array<{ id: string; name?: string | null }>);
}

/**
 * Fetch all teams for a league
 */
async function getSeasonParticipationTeamIds(
  leagueId: string,
  seasonId: string
): Promise<string[]> {
  const supabase = await createClient();

  const [
    seasonPreferenceResult,
    rosterResult,
    registrationResult,
    gameResult,
  ] = await Promise.all([
    supabase
      .from('team_schedule_preferences')
      .select('team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId),
    supabase
      .from('team_rosters')
      .select('team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'active'),
    supabase
      .from('registration_submissions')
      .select('team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .not('team_id', 'is', null)
      .not('submitted_at', 'is', null)
      .in('status', ['pending', 'approved', 'waitlisted']),
    supabase
      .from('games')
      .select('home_team_id, away_team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId),
  ]);

  return resolveSeasonParticipationTeamIds({
    seasonPreferenceTeamIds: (seasonPreferenceResult.data ?? []).map((row) => row.team_id),
    rosterTeamIds: (rosterResult.data ?? []).map((row) => row.team_id),
    registrationTeamIds: (registrationResult.data ?? []).map((row) => row.team_id),
    gameTeamIds: (gameResult.data ?? []).flatMap((row) => [row.home_team_id, row.away_team_id]),
  });
}

export async function getTeams(leagueId: string, seasonId?: string): Promise<Team[]> {
  const supabase = await createClient();

  // If seasonId provided, filter to the teams actually participating in that
  // season, falling back to season-specific schedule prefs only when there are
  // no harder participation markers yet.
  if (seasonId) {
    const teamIds = await getSeasonParticipationTeamIds(leagueId, seasonId);

    if (teamIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from('teams')
      .select(`*, division:divisions(*)`)
      .eq('league_id', leagueId)
      .in('id', teamIds)
      .order('name', { ascending: true });

    if (error || !data) return [];
    return filterPublicTeams(data as Team[]);
  }

  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      division:divisions(*)
    `)
    .eq('league_id', leagueId)
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  return filterPublicTeams(data as Team[]);
}

/**
 * Fetch team by slug
 */
export async function getTeamBySlug(
  leagueId: string,
  teamSlug: string
): Promise<Team | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      division:divisions(*)
    `)
    .eq('league_id', leagueId)
    .eq('slug', teamSlug)
    .single();

  if (error || !data) {
    return null;
  }

  const [team] = filterPublicTeams([data as Team]);
  return team ?? null;
}

/**
 * Fetch team roster
 */
type TeamRosterProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  photo_url?: string | null;
  position?: string | null;
  phone?: string | null;
};

function normalizeRosterPosition(
  position: string | null | undefined,
  isGoalieHint: boolean,
): Player['position'] {
  if (isGoalieHint) return 'Goalie';
  const value = (position || '').trim().toUpperCase();

  if (value === 'C' || value === 'LW' || value === 'RW' || value === 'D' || value === 'G') {
    return value as Player['position'];
  }
  if (value === 'FORWARD' || value === 'DEFENSE' || value === 'GOALIE') {
    return value.charAt(0) + value.slice(1).toLowerCase() as Player['position'];
  }

  return null;
}

export async function getTeamRoster(teamId: string, seasonId?: string): Promise<Player[]> {
  const supabase = await createClient();

  let rosterQuery = supabase
    .from('team_rosters')
    .select(`
      *,
      profile:profiles(id, full_name, avatar_url, photo_url, position, phone)
    `)
    .eq('team_id', teamId);

  let skaterStatsQuery = supabase
    .from('player_stats')
    .select('player_id')
    .eq('team_id', teamId);

  let goalieStatsQuery = supabase
    .from('goalie_stats')
    .select('player_id')
    .eq('team_id', teamId);

  if (seasonId) {
    rosterQuery = rosterQuery.eq('season_id', seasonId);
    skaterStatsQuery = skaterStatsQuery.eq('season_id', seasonId);
    goalieStatsQuery = goalieStatsQuery.eq('season_id', seasonId);
  }

  const [{ data: rosterRows, error: rosterError }, { data: skaterRows }, { data: goalieRows }] = await Promise.all([
    rosterQuery,
    skaterStatsQuery,
    goalieStatsQuery,
  ]);

  if (rosterError) {
    return [];
  }

  const playersById = new Map<string, Player>();
  const goalieIds = new Set((goalieRows || []).map((row) => row.player_id));

  for (const row of rosterRows || []) {
    const profileRow = (Array.isArray(row.profile) ? row.profile[0] : row.profile) as TeamRosterProfileRow | null;
    const isGoalie = Boolean(row.is_goalie || goalieIds.has(row.player_id));
    const position = normalizeRosterPosition(row.position ?? profileRow?.position, isGoalie);

    playersById.set(row.player_id, {
      ...(row as Player),
      position,
      is_goalie: isGoalie,
      profile: profileRow
        ? {
            id: profileRow.id,
            full_name: profileRow.full_name,
            avatar_url: resolvePlayerPhotoUrl(profileRow),
            photo_url: profileRow.photo_url ?? null,
            phone: profileRow.phone ?? null,
          }
        : undefined,
    });
  }

  const statsPlayerIds = new Set<string>([
    ...(skaterRows || []).map((row) => row.player_id),
    ...(goalieRows || []).map((row) => row.player_id),
  ]);
  const missingPlayerIds = Array.from(statsPlayerIds).filter((playerId) => !playersById.has(playerId));

  if (missingPlayerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, photo_url, position')
      .in('id', missingPlayerIds);

    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));

    for (const playerId of missingPlayerIds) {
      const profile = profileById.get(playerId);
      const isGoalie = goalieIds.has(playerId);
      const position = normalizeRosterPosition(profile?.position, isGoalie);

      playersById.set(playerId, {
        id: `synthetic-${teamId}-${playerId}`,
        player_id: playerId,
        team_id: teamId,
        jersey_number: null,
        position,
        leadership_role: null,
        is_goalie: isGoalie,
        profile: profile
          ? {
              id: profile.id,
              full_name: profile.full_name,
              avatar_url: resolvePlayerPhotoUrl(profile),
              photo_url: profile.photo_url ?? null,
            }
          : undefined,
      });
    }
  }

  return Array.from(playersById.values()).sort((a, b) => {
    const aNumber = a.jersey_number ?? Number.MAX_SAFE_INTEGER;
    const bNumber = b.jersey_number ?? Number.MAX_SAFE_INTEGER;
    if (aNumber !== bNumber) return aNumber - bNumber;

    const aName = a.profile?.full_name || '';
    const bName = b.profile?.full_name || '';
    return aName.localeCompare(bName);
  });
}

export interface AcceptedGameSubstitution {
  id: string;
  subPlayerId: string;
  subPlayerName: string;
  replacedPlayerId: string | null;
  replacedPlayerName: string | null;
}

interface RawAcceptedGameSubstitutionRow {
  id: string;
  invited_player_id: string | null;
  replaced_player_id: string | null;
  invited_player_profile: { full_name: string | null } | Array<{ full_name: string | null }> | null;
  replaced_player_profile: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

export async function getAcceptedGameSubstitutions(
  gameId: string | null | undefined,
  teamId: string,
): Promise<AcceptedGameSubstitution[]> {
  if (!gameId) return [];

  const supabase = createServiceRoleClient();
  const { data, error } = await (supabase.from('sub_invitations') as any)
    .select(`
      id,
      invited_player_id,
      replaced_player_id,
      invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(full_name),
      replaced_player_profile:profiles!sub_invitations_replaced_player_id_fkey(full_name)
    `)
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .eq('status', 'accepted')
    .order('responded_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load accepted game substitutions:', error);
    return [];
  }

  const rows = (data || []) as RawAcceptedGameSubstitutionRow[];

  return rows
    .map((row): AcceptedGameSubstitution | null => {
      const invitedProfile = Array.isArray(row.invited_player_profile)
        ? row.invited_player_profile[0]
        : row.invited_player_profile;
      const replacedProfile = Array.isArray(row.replaced_player_profile)
        ? row.replaced_player_profile[0]
        : row.replaced_player_profile;

      if (!row.invited_player_id) return null;

      return {
        id: row.id,
        subPlayerId: row.invited_player_id,
        subPlayerName: invitedProfile?.full_name || 'Sub',
        replacedPlayerId: row.replaced_player_id ?? null,
        replacedPlayerName: replacedProfile?.full_name || null,
      };
    })
    .filter((row: AcceptedGameSubstitution | null): row is AcceptedGameSubstitution => Boolean(row));
}

type RosterStatsAccumulator = {
  skater_game_ids: Set<string>;
  goalie_game_ids: Set<string>;
  confirmed_checkin_game_ids: Set<string>;
  goals: number;
  assists: number;
  penalty_minutes: number;
  wins: number;
  losses: number;
  saves: number;
  shots_against: number;
  goals_against: number;
  shutouts: number;
  is_goalie: boolean;
};

export type TeamRosterStatsByPlayer = Record<string, {
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  penalty_minutes: number;
  wins: number;
  losses: number;
  save_percentage: number | null;
  goals_against_average: number | null;
  shutouts: number;
  is_goalie: boolean;
}>;

const PLAYED_GAME_STATUSES = ['in_progress', 'pending_verification', 'completed'] as const;
const COMPLETED_GAME_STATUSES = ['completed'] as const;

type ConfirmedCheckinAppearanceRow = {
  player_id: string;
  team_id: string;
  game_id: string;
  game?: {
    id?: string | null;
    season_id?: string | null;
    scheduled_at?: string | null;
    status?: string | null;
    home_team_id?: string | null;
    away_team_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  } | {
    id?: string | null;
    season_id?: string | null;
    scheduled_at?: string | null;
    status?: string | null;
    home_team_id?: string | null;
    away_team_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  }[] | null;
};

async function getConfirmedCheckinAppearanceRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options: {
    leagueId?: string;
    seasonId?: string;
    teamId?: string;
    teamIds?: string[];
    playerIds?: string[];
    gameStatuses?: readonly string[];
  },
): Promise<ConfirmedCheckinAppearanceRow[]> {
  const gameStatuses = options.gameStatuses ?? PLAYED_GAME_STATUSES;

  let query = supabase
    .from('game_checkins')
    .select('player_id, team_id, game_id, game:games!inner(id, season_id, scheduled_at, league_id, status, home_team_id, away_team_id, home_score, away_score)')
    .eq('status', 'confirmed')
    .in('game.status', [...gameStatuses]);

  if (options.leagueId) {
    query = query.eq('game.league_id', options.leagueId);
  }

  if (options.seasonId) {
    query = query.eq('game.season_id', options.seasonId);
  }

  if (options.teamId) {
    query = query.eq('team_id', options.teamId);
  } else if (options.teamIds && options.teamIds.length > 0) {
    query = query.in('team_id', options.teamIds);
  }

  if (options.playerIds && options.playerIds.length > 0) {
    query = query.in('player_id', options.playerIds);
  }

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  return data as unknown as ConfirmedCheckinAppearanceRow[];
}

async function getFallbackRosterAppearanceRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options: {
    seasonId?: string;
    teamId?: string;
    teamIds?: string[];
    playerIds?: string[];
    gameStatuses?: readonly string[];
  },
): Promise<ConfirmedCheckinAppearanceRow[]> {
  if (!options.seasonId) {
    return [];
  }

  const gameStatuses = options.gameStatuses ?? PLAYED_GAME_STATUSES;

  let rosterQuery = supabase
    .from('team_rosters')
    .select('player_id, team_id, season_id, joined_at, end_date')
    .eq('season_id', options.seasonId)
    .eq('status', 'active');

  if (options.teamId) {
    rosterQuery = rosterQuery.eq('team_id', options.teamId);
  } else if (options.teamIds && options.teamIds.length > 0) {
    rosterQuery = rosterQuery.in('team_id', options.teamIds);
  }

  if (options.playerIds && options.playerIds.length > 0) {
    rosterQuery = rosterQuery.in('player_id', options.playerIds);
  }

  const { data: rosterRows, error: rosterError } = await rosterQuery;
  if (rosterError || !rosterRows || rosterRows.length === 0) {
    return [];
  }

  const teamIds = [...new Set(rosterRows.map((row) => row.team_id).filter(Boolean))];
  if (teamIds.length === 0) {
    return [];
  }

  const teamFilter = teamIds
    .map((teamId) => `home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .join(',');

  const [{ data: gameRows, error: gamesError }, { data: outCheckinRows }, { data: outAvailabilityRows }, { data: skaterRows }, { data: goalieRows }] = await Promise.all([
    supabase
      .from('games')
      .select('id, season_id, scheduled_at, status, home_team_id, away_team_id, home_score, away_score')
      .eq('season_id', options.seasonId)
      .in('status', [...gameStatuses])
      .or(teamFilter),
    supabase
      .from('game_checkins')
      .select('game_id, team_id, player_id')
      .eq('status', 'out')
      .in('team_id', teamIds),
    supabase
      .from('player_availability')
      .select('game_id, team_id, player_id')
      .eq('season_id', options.seasonId)
      .eq('status', 'out')
      .in('team_id', teamIds),
    supabase
      .from('player_stats')
      .select('game_id, team_id')
      .eq('season_id', options.seasonId)
      .in('team_id', teamIds),
    supabase
      .from('goalie_stats')
      .select('game_id, team_id')
      .eq('season_id', options.seasonId)
      .in('team_id', teamIds),
  ]);

  if (gamesError || !gameRows || gameRows.length === 0) {
    return [];
  }

  const explicitOutSignals = new Set<string>();
  for (const row of outCheckinRows || []) {
    if (row.game_id && row.team_id && row.player_id) {
      explicitOutSignals.add(`${row.player_id}:${row.team_id}:${row.game_id}`);
    }
  }
  for (const row of outAvailabilityRows || []) {
    if (row.game_id && row.team_id && row.player_id) {
      explicitOutSignals.add(`${row.player_id}:${row.team_id}:${row.game_id}`);
    }
  }

  const statSignals = new Set<string>();
  for (const row of skaterRows || []) {
    if (row.game_id && row.team_id) {
      statSignals.add(`${row.game_id}:${row.team_id}`);
    }
  }
  for (const row of goalieRows || []) {
    if (row.game_id && row.team_id) {
      statSignals.add(`${row.game_id}:${row.team_id}`);
    }
  }

  const appearanceRows: ConfirmedCheckinAppearanceRow[] = [];
  const seen = new Set<string>();

  for (const rosterRow of rosterRows) {
    for (const gameRow of gameRows) {
      const teamParticipates = gameRow.home_team_id === rosterRow.team_id || gameRow.away_team_id === rosterRow.team_id;
      if (!teamParticipates || !gameRow.id || !rosterRow.player_id || !rosterRow.team_id) {
        continue;
      }

      const appearanceKey = `${rosterRow.player_id}:${rosterRow.team_id}:${gameRow.id}`;
      if (explicitOutSignals.has(appearanceKey)) {
        continue;
      }

      const attendanceKey = `${gameRow.id}:${rosterRow.team_id}`;
      const hasScore = gameRow.home_score != null || gameRow.away_score != null;
      const hasStats = statSignals.has(attendanceKey);
      if (!hasScore && !hasStats) {
        continue;
      }

      if (rosterRow.joined_at && gameRow.scheduled_at && new Date(gameRow.scheduled_at).getTime() < new Date(rosterRow.joined_at).getTime()) {
        continue;
      }

      if (rosterRow.end_date && gameRow.scheduled_at && new Date(gameRow.scheduled_at).getTime() > new Date(rosterRow.end_date).getTime()) {
        continue;
      }

      if (seen.has(appearanceKey)) {
        continue;
      }
      seen.add(appearanceKey);

      appearanceRows.push({
        player_id: rosterRow.player_id,
        team_id: rosterRow.team_id,
        game_id: gameRow.id,
        game: gameRow,
      });
    }
  }

  return appearanceRows;
}

/**
 * Fetch aggregated roster stats for a team.
 * Combines skater stats and goalie stats for the provided season.
 */
export async function getTeamRosterStats(
  teamId: string,
  seasonId?: string,
): Promise<TeamRosterStatsByPlayer> {
  const supabase = await createClient();

  let skaterQuery = supabase
    .from('player_stats')
    .select('player_id, game_id, goals, assists, penalty_minutes')
    .eq('team_id', teamId);

  let goalieQuery = supabase
    .from('goalie_stats')
    .select('player_id, game_id, saves, shots_against, goals_against, shutout, game_result')
    .eq('team_id', teamId);

  if (seasonId) {
    skaterQuery = skaterQuery.eq('season_id', seasonId);
    goalieQuery = goalieQuery.eq('season_id', seasonId);
  }

  const [{ data: skaterRows }, { data: goalieRows }, confirmedCheckins, fallbackAppearances] = await Promise.all([
    skaterQuery,
    goalieQuery,
    getConfirmedCheckinAppearanceRows(supabase, {
      teamId,
      seasonId,
      gameStatuses: COMPLETED_GAME_STATUSES,
    }),
    getFallbackRosterAppearanceRows(supabase, {
      teamId,
      seasonId,
      gameStatuses: COMPLETED_GAME_STATUSES,
    }),
  ]);

  const accumulator: Record<string, RosterStatsAccumulator> = {};

  const ensure = (playerId: string): RosterStatsAccumulator => {
    if (!accumulator[playerId]) {
      accumulator[playerId] = {
        skater_game_ids: new Set<string>(),
        goalie_game_ids: new Set<string>(),
        confirmed_checkin_game_ids: new Set<string>(),
        goals: 0,
        assists: 0,
        penalty_minutes: 0,
        wins: 0,
        losses: 0,
        saves: 0,
        shots_against: 0,
        goals_against: 0,
        shutouts: 0,
        is_goalie: false,
      };
    }
    return accumulator[playerId];
  };

  for (const row of skaterRows || []) {
    const entry = ensure(row.player_id);
    if (row.game_id) {
      entry.skater_game_ids.add(row.game_id);
    }
    entry.goals += row.goals || 0;
    entry.assists += row.assists || 0;
    entry.penalty_minutes += row.penalty_minutes || 0;
  }

  for (const row of goalieRows || []) {
    const entry = ensure(row.player_id);
    if (row.game_id) {
      entry.goalie_game_ids.add(row.game_id);
    }
    entry.is_goalie = true;
    entry.saves += row.saves || 0;
    entry.shots_against += row.shots_against || 0;
    entry.goals_against += row.goals_against || 0;
    if (row.shutout) entry.shutouts += 1;

    const result = (row.game_result || '').toUpperCase();
    if (result === 'W' || result === 'WIN') {
      entry.wins += 1;
    } else if (result === 'L' || result === 'LOSS' || result === 'OTL' || result === 'SOL') {
      entry.losses += 1;
    }
  }

  for (const row of confirmedCheckins) {
    const entry = ensure(row.player_id);
    entry.confirmed_checkin_game_ids.add(row.game_id);
  }

  for (const row of fallbackAppearances) {
    const entry = ensure(row.player_id);
    entry.confirmed_checkin_game_ids.add(row.game_id);
  }

  const output: TeamRosterStatsByPlayer = {};
  for (const [playerId, entry] of Object.entries(accumulator)) {
    const gamesPlayed = Math.max(
      entry.skater_game_ids.size,
      entry.goalie_game_ids.size,
      entry.confirmed_checkin_game_ids.size,
    );
    const savePct = entry.shots_against > 0 ? entry.saves / entry.shots_against : null;
    const gaa = entry.goalie_game_ids.size > 0 ? entry.goals_against / entry.goalie_game_ids.size : null;

    output[playerId] = {
      games_played: gamesPlayed,
      goals: entry.goals,
      assists: entry.assists,
      points: entry.goals + entry.assists,
      penalty_minutes: entry.penalty_minutes,
      wins: entry.wins,
      losses: entry.losses,
      save_percentage: savePct,
      goals_against_average: gaa,
      shutouts: entry.shutouts,
      is_goalie: entry.is_goalie,
    };
  }

  return output;
}

/**
 * Fetch team with captain info
 */
export async function getTeamWithCaptain(
  leagueId: string,
  teamSlug: string
): Promise<(Team & { captain?: { id: string; full_name: string; avatar_url: string | null; email?: string } }) | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      division:divisions(*),
      captain:profiles!teams_captain_id_fkey(id, full_name, avatar_url, photo_url)
    `)
    .eq('league_id', leagueId)
    .eq('slug', teamSlug)
    .single();

  if (error || !data) {
    return null;
  }

  return data as any;
}

/**
 * Fetch team stats from standings
 */
export async function getTeamStats(teamId: string, leagueId: string): Promise<TeamStanding | null> {
  const standings = await getStandings(leagueId);
  return standings.find(s => s.team_id === teamId) || null;
}

/**
 * Fetch team schedule (upcoming and recent games)
 */
export async function getTeamSchedule(
  teamId: string,
  options?: { seasonId?: string | null }
): Promise<ScheduleGame[]> {
  const supabase = await createClient();

  let query = supabase
    .from('games')
    .select(`
      id,
      scheduled_at,
      status,
      location,
      home_score,
      away_score,
      division_id,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color),
      division:divisions(id, name)
    `)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('scheduled_at', { ascending: true });

  if (options?.seasonId) {
    query = query.eq('season_id', options.seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map((game: any) => ({
    id: game.id,
    scheduled_at: game.scheduled_at,
    status: game.status,
    home_score: game.home_score,
    away_score: game.away_score,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
    venue: game.location || null,
    division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
  })) as ScheduleGame[];
}

/**
 * Fetch team rivals (teams they've played with head-to-head record)
 */
export async function getTeamRivals(teamId: string, limit = 3, seasonId?: string): Promise<{
  team: { id: string; name: string; slug: string; logo: string | null; primaryColor: string | null };
  wins: number;
  losses: number;
  ties: number;
  games_played: number;
}[]> {
  const supabase = await createClient();

  // Get completed games for this team, optionally scoped to a season
  let query = supabase
    .from('games')
    .select(`
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, team_type),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, team_type)
    `)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'completed');

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data: games, error } = await query;

  if (error || !games || games.length === 0) {
    return [];
  }

  // Calculate record against each opponent
  const opponents = new Map<string, {
    team: { id: string; name: string; slug: string; logo: string | null; primaryColor: string | null };
    wins: number;
    losses: number;
    ties: number;
  }>();

  for (const game of games) {
    const isHome = game.home_team_id === teamId;
    const opponentData = isHome ? game.away_team : game.home_team;
    const opponent = Array.isArray(opponentData) ? opponentData[0] : opponentData;
    if (!opponent) continue;

    if (!isPublicFacingTeam({ name: opponent.name, team_type: opponent.team_type ?? null })) {
      continue;
    }

    const opponentId = opponent.id;
    const myScore = isHome ? game.home_score : game.away_score;
    const theirScore = isHome ? game.away_score : game.home_score;

    if (!opponents.has(opponentId)) {
      opponents.set(opponentId, {
        team: {
          id: opponent.id,
          name: opponent.name,
          slug: opponent.slug,
          logo: opponent.logo_url,
          primaryColor: opponent.primary_color || null,
        },
        wins: 0,
        losses: 0,
        ties: 0,
      });
    }

    const record = opponents.get(opponentId)!;
    if (myScore > theirScore) record.wins++;
    else if (myScore < theirScore) record.losses++;
    else record.ties++;
  }

  // Sort by most games played and return top rivals
  return Array.from(opponents.values())
    .map(r => ({ ...r, games_played: r.wins + r.losses + r.ties }))
    .sort((a, b) => b.games_played - a.games_played)
    .slice(0, limit);
}

/**
 * Fetch standings for a league/season
 * Uses RPC function for calculated standings or builds from games
 */
export async function getStandings(
  leagueId: string,
  seasonId?: string,
  options: CanonicalReadOptions = {},
): Promise<TeamStanding[]> {
  const supabase = await createClient();

  // Get teams with names, logos, and divisions for enrichment
  // If seasonId provided, filter to only teams participating in that season
  let teamsQuery = supabase
    .from('teams')
    .select('id, name, logo_url, division_id, team_type, divisions(id, name)')
    .eq('league_id', leagueId);

  if (seasonId) {
    const { data: rosterTeams, error: rosterTeamsError } = await supabase
      .from('team_rosters')
      .select('team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'active');

    if (rosterTeamsError && options.strict) throwCanonicalReadError(rosterTeamsError, 'standings team_rosters');

    if (rosterTeams && rosterTeams.length > 0) {
      const teamIds = [...new Set(rosterTeams.map(r => r.team_id))];
      teamsQuery = teamsQuery.in('id', teamIds);
    }
  }

  const { data: teams, error: teamsError } = await teamsQuery;
  if (teamsError && options.strict) throwCanonicalReadError(teamsError, 'standings teams');

  const teamInfoMap = new Map(
    teams?.map((t) => {
      const div = Array.isArray(t.divisions) ? t.divisions[0] : t.divisions;
      return [t.id, {
        name: t.name,
        logo_url: t.logo_url,
        division_id: div?.id || t.division_id,
        division_name: div?.name,
        team_type: t.team_type ?? 'standard',
      }];
    }) || []
  );

  const sortStandings = (left: TeamStanding, right: TeamStanding) => {
    if (right.points !== left.points) return right.points - left.points;
    if (right.wins !== left.wins) return right.wins - left.wins;
    if (right.goal_differential !== left.goal_differential) return right.goal_differential - left.goal_differential;
    if (right.goals_for !== left.goals_for) return right.goals_for - left.goals_for;
    return left.team_name.localeCompare(right.team_name);
  };

  const buildSeededImportedAggregateStandings = async () => {
    if (!seasonId || !isImportedAggregateSeasonId(seasonId)) {
      return null;
    }

    const { data: completedGames, error: completedGamesError } = await supabase
      .from('games')
      .select('home_team_id, away_team_id, home_score, away_score, location, game_type')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'completed');

    if (completedGamesError || !completedGames) {
      if (completedGamesError && options.strict) throwCanonicalReadError(completedGamesError, 'standings completed games');
      return null;
    }

    const standingsMap = new Map<string, TeamStanding>();

    for (const [teamId, teamInfo] of teamInfoMap.entries()) {
      standingsMap.set(teamId, {
        team_id: teamId,
        team_name: teamInfo.name || 'Unknown Team',
        team_logo: teamInfo.logo_url || null,
        division_id: teamInfo.division_id || null,
        division_name: teamInfo.division_name || null,
        team_type: teamInfo.team_type || 'standard',
        games_played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        overtime_losses: 0,
        points: 0,
        goals_for: 0,
        goals_against: 0,
        goal_differential: 0,
        streak: null,
        last_10: null,
      });
    }

    for (const game of completedGames) {
      if ((game.location ?? '').startsWith(AGGREGATE_STATS_GAME_LOCATION_PREFIX)) {
        continue;
      }

      if (game.game_type && game.game_type !== 'regular') {
        continue;
      }

      const homeStanding = standingsMap.get(game.home_team_id);
      const awayStanding = standingsMap.get(game.away_team_id);
      if (!homeStanding || !awayStanding) {
        continue;
      }

      const homeScore = Number(game.home_score) || 0;
      const awayScore = Number(game.away_score) || 0;

      homeStanding.games_played += 1;
      awayStanding.games_played += 1;
      homeStanding.goals_for += homeScore;
      homeStanding.goals_against += awayScore;
      awayStanding.goals_for += awayScore;
      awayStanding.goals_against += homeScore;

      if (homeScore > awayScore) {
        homeStanding.wins += 1;
        awayStanding.losses += 1;
        homeStanding.points += 2;
      } else if (awayScore > homeScore) {
        awayStanding.wins += 1;
        homeStanding.losses += 1;
        awayStanding.points += 2;
      } else {
        homeStanding.ties += 1;
        awayStanding.ties += 1;
        homeStanding.points += 1;
        awayStanding.points += 1;
      }
    }

    const seededStandings = Array.from(standingsMap.values())
      .map((standing) => ({
        ...standing,
        goal_differential: standing.goals_for - standing.goals_against,
      }))
      .filter((standing) => standing.games_played > 0)
      .sort(sortStandings);

    return filterPublicStandings(seededStandings);
  };

  const importedAggregateStandings = await buildSeededImportedAggregateStandings();
  if (importedAggregateStandings) {
    return importedAggregateStandings;
  }

  // Try to use standings RPC if available (actual function name: get_team_standings)
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'get_team_standings',
    {
      check_league_id: leagueId,
      check_season_id: seasonId || null,
    }
  );

  if (rpcError && options.strict && !isMissingOptionalCapabilityError(rpcError)) {
    throwCanonicalReadError(rpcError, 'get_team_standings');
  }

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    // Enrich RPC data with team names and logos, filtering out teams with 0 games
    const enrichedStandings = rpcData.filter((s: any) => Number(s.games_played) > 0).map((s: any) => {
      const teamInfo = teamInfoMap.get(s.team_id);
      return {
        team_id: s.team_id,
        team_name: teamInfo?.name || 'Unknown Team',
        team_logo: teamInfo?.logo_url || null,
        division_id: teamInfo?.division_id || null,
        division_name: teamInfo?.division_name || null,
        team_type: teamInfo?.team_type || 'standard',
        games_played: Number(s.games_played) || 0,
        wins: Number(s.wins) || 0,
        losses: Number(s.losses) || 0,
        ties: Number(s.ties) || 0,
        overtime_losses: 0,
        points: Number(s.points) || 0,
        goals_for: Number(s.goals_for) || 0,
        goals_against: Number(s.goals_against) || 0,
        goal_differential: Number(s.goal_differential) || 0,
        streak: null,
        last_10: null,
      };
    }) as TeamStanding[];

    return filterPublicStandings(enrichedStandings.sort(sortStandings));
  }

  // Fallback: Query team_standings table directly
  let standingsQuery = supabase
    .from('team_standings')
    .select('*')
    .order('points', { ascending: false });

  if (seasonId) {
    standingsQuery = standingsQuery.eq('season_id', seasonId);
  }

  const { data: standings, error } = await standingsQuery;

  if (error || !standings) {
    if (error && options.strict && !isMissingRelationError(error)) throwCanonicalReadError(error, 'team_standings');
    return [];
  }

  return filterPublicStandings(standings.map((s) => {
    const teamInfo = teamInfoMap.get(s.team_id);
    return {
      team_id: s.team_id,
      team_name: teamInfo?.name || s.name || 'Unknown Team',
      team_logo: teamInfo?.logo_url || s.logo_url || null,
      division_id: teamInfo?.division_id || null,
      division_name: teamInfo?.division_name || null,
      team_type: teamInfo?.team_type || 'standard',
      games_played: Number(s.games_played) || 0,
      wins: Number(s.wins) || 0,
      losses: Number(s.losses) || 0,
      ties: Number(s.ties) || 0,
      overtime_losses: 0,
      points: Number(s.points) || 0,
      goals_for: Number(s.goals_for) || 0,
      goals_against: Number(s.goals_against) || 0,
      goal_differential: (Number(s.goals_for) || 0) - (Number(s.goals_against) || 0),
      streak: null,
      last_10: null,
    };
  }).sort(sortStandings)) as TeamStanding[];
}

/**
 * Fetch upcoming games for a league
 */
export async function getUpcomingGames(
  leagueId: string,
  limit = 10,
  divisionId?: string,
  seasonId?: string | null,
): Promise<UpcomingGame[]> {
  const supabase = await createClient();

  let query = supabase
    .from('games')
    .select(`
      *,
      division:divisions(id, name),
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id)
    `)
    .eq('league_id', leagueId)
    .in('status', ['scheduled', 'in_progress'])
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(divisionId ? limit * 3 : limit);

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Transform team data from DB columns to expected format
  let result = data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
  })) as UpcomingGame[];

  if (divisionId) {
    result = result.filter((game) => matchesDivisionFilter(game, divisionId)).slice(0, limit);
  }

  return result;
}

/**
 * Fetch games from the current league week for the homepage module.
 * Includes completed results and upcoming games, then filters the broader
 * query window down using league-local date keys so the week boundaries stay
 * aligned to the league timezone.
 */
export async function getHomepageWeeklyGames(
  leagueId: string,
  options?: {
    divisionId?: string;
    seasonId?: string | null;
    timezone?: string | null;
  },
): Promise<ScheduleGame[]> {
  const supabase = await createClient();
  const leagueTimezone = resolveLeagueTimezone(options?.timezone);
  const weekRange = getLeagueWeekDateRange(new Date(), leagueTimezone);

  if (!weekRange) {
    return [];
  }

  const now = Date.now();
  const queryWindowStart = new Date(now - 8 * 24 * 60 * 60 * 1000);
  const queryWindowEnd = new Date(now + 8 * 24 * 60 * 60 * 1000);

  let query = supabase
    .from('games')
    .select(`
      id,
      league_id,
      season_id,
      scheduled_at,
      location,
      home_score,
      away_score,
      status,
      game_type,
      division_id,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      division:divisions(id, name)
    `)
    .eq('league_id', leagueId)
    .in('status', ['scheduled', 'in_progress', 'completed', 'pending_verification', 'postponed', 'cancelled'])
    .gte('scheduled_at', queryWindowStart.toISOString())
    .lte('scheduled_at', queryWindowEnd.toISOString())
    .order('scheduled_at', { ascending: true });

  if (options?.seasonId) {
    query = query.eq('season_id', options.seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  let result = data
    .map((game) => ({
      ...game,
      venue: (game as any).location || null,
      home_team: transformTeamData(game.home_team),
      away_team: transformTeamData(game.away_team),
      division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
    }))
    .filter((game) => {
      const dateKey = getLeagueDateKey(game.scheduled_at, leagueTimezone);
      return Boolean(dateKey && dateKey >= weekRange.weekStartKey && dateKey <= weekRange.weekEndKey);
    }) as ScheduleGame[];

  if (options?.divisionId) {
    result = result.filter((game) => matchesDivisionFilter(game, options.divisionId!));
  }

  return result;
}

/**
 * Fetch recent games (completed)
 */
export async function getRecentGames(
  leagueId: string,
  limit = 10,
  divisionId?: string,
  seasonId?: string | null,
): Promise<RecentGame[]> {
  const supabase = await createClient();

  let query = supabase
    .from('games')
    .select(`
      *,
      division:divisions(id, name),
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id)
    `)
    .eq('league_id', leagueId)
    .in('status', ['completed'])
    .order('scheduled_at', { ascending: false })
    .limit(divisionId ? limit * 3 : limit);

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Transform team data from DB columns to expected format
  let result = data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
  })) as RecentGame[];

  if (divisionId) {
    result = result.filter((game) => matchesDivisionFilter(game, divisionId)).slice(0, limit);
  }

  return result;
}

/**
 * Fetch games for score ticker (mix of recent and upcoming)
 */
export async function getTickerGames(
  leagueId: string,
  limit = 10,
  seasonId?: string | null,
): Promise<TickerGame[]> {
  const supabase = createServiceRoleClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const recentWindowStart = new Date(now);
  recentWindowStart.setDate(recentWindowStart.getDate() - 7);
  const liveWindowStart = new Date(now);
  liveWindowStart.setHours(liveWindowStart.getHours() - 6);

  const tickerSelect = `
    id,
    scheduled_at,
    location,
    home_score,
    away_score,
    status,
    game_type,
    home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(name)),
    away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(name))
  `;

  const recentCompletedCap = Math.min(Math.max(2, Math.floor(limit / 3)), 4, limit);

  let liveGamesQuery = supabase
      .from('games')
      .select(tickerSelect)
      .eq('league_id', leagueId)
      .eq('status', 'in_progress')
      .gte('scheduled_at', liveWindowStart.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);

  let upcomingGamesQuery = supabase
      .from('games')
      .select(tickerSelect)
      .eq('league_id', leagueId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', todayStart.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);

  let recentCompletedQuery = supabase
      .from('games')
      .select(tickerSelect)
      .eq('league_id', leagueId)
      .eq('status', 'completed')
      .gte('scheduled_at', recentWindowStart.toISOString())
      .lt('scheduled_at', now.toISOString())
      .order('scheduled_at', { ascending: false })
      .limit(recentCompletedCap);

  if (seasonId) {
    liveGamesQuery = liveGamesQuery.eq('season_id', seasonId);
    upcomingGamesQuery = upcomingGamesQuery.eq('season_id', seasonId);
    recentCompletedQuery = recentCompletedQuery.eq('season_id', seasonId);
  }

  const [liveGamesResult, upcomingGamesResult, recentCompletedResult] = await Promise.all([
    liveGamesQuery,
    upcomingGamesQuery,
    recentCompletedQuery,
  ]);

  const transformTickerGames = (games: any[] | null | undefined): TickerGame[] =>
    (games ?? []).map((game) => ({
      ...game,
      venue: (game as any).location || null,
      home_team: transformTeamData(game.home_team),
      away_team: transformTeamData(game.away_team),
    })) as TickerGame[];

  if (liveGamesResult.error) {
    console.error('[ScoreTicker] Failed to fetch live games', liveGamesResult.error);
  }

  if (upcomingGamesResult.error) {
    console.error('[ScoreTicker] Failed to fetch upcoming games', upcomingGamesResult.error);
  }

  if (recentCompletedResult.error) {
    console.error('[ScoreTicker] Failed to fetch recent completed games', recentCompletedResult.error);
  }

  const liveGames = transformTickerGames(liveGamesResult.data);
  const upcomingGames = transformTickerGames(upcomingGamesResult.data);
  const recentCompletedGames = transformTickerGames(recentCompletedResult.data);

  const seen = new Set<string>();
  const dedupe = (games: TickerGame[]) =>
    games.filter((game) => {
      if (seen.has(game.id)) return false;
      seen.add(game.id);
      return true;
    });

  const primaryGames = dedupe([...liveGames, ...upcomingGames]);

  // If there are no active or upcoming games for the operational season,
  // hide the ticker instead of backfilling it with stale finals.
  if (primaryGames.length === 0) {
    return [];
  }

  if (primaryGames.length >= limit && recentCompletedGames.length > 0) {
    return dedupe([
      ...primaryGames.slice(0, Math.max(limit - recentCompletedGames.length, 1)),
      ...recentCompletedGames.slice(0, recentCompletedCap),
    ]).slice(0, limit);
  }

  const mergedGames = dedupe([...primaryGames, ...recentCompletedGames]).slice(0, limit);

  if (mergedGames.length > 0) {
    return mergedGames;
  }

  return [];
}

/**
 * Fetch games for a specific week with optional filters
 */
export async function getWeekGames(
  leagueId: string,
  weekStart: Date,
  filters?: {
    day?: string;
    seasonId?: string;
    divisionId?: string;
    teamId?: string;
    type?: string;
    venue?: string;
    timezone?: string;
    status?: string;
  }
): Promise<ScheduleGame[]> {
  const supabase = await createClient();

  // Calculate week end (7 days from start)
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  let query = supabase
    .from('games')
    .select(`
      id,
      league_id,
      season_id,
      scheduled_at,
      location,
      home_score,
      away_score,
      status,
      game_type,
      division_id,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      division:divisions(id, name)
    `)
    .eq('league_id', leagueId)
    .gte('scheduled_at', weekStart.toISOString())
    .lt('scheduled_at', weekEnd.toISOString())
    .order('scheduled_at', { ascending: true });

  // Apply optional filters
  if (filters?.day) {
    // Convert the day filter (in league timezone) to UTC range
    const timeZone = filters?.timezone || 'America/Toronto';

    // Create Date objects for start and end of day in Toronto timezone
    // We'll use the offset to convert to UTC
    const testDate = new Date(filters.day + 'T12:00:00Z');
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    });

    // Calculate UTC offset for Toronto timezone on this date (handles DST)
    const parts = formatter.formatToParts(testDate);
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'EST';
    const offset = tzName === 'EDT' ? -4 : -5; // EDT = UTC-4, EST = UTC-5

    // Create day boundaries in UTC
    const dayStart = new Date(`${filters.day}T00:00:00`);
    dayStart.setHours(dayStart.getHours() - offset); // Convert to UTC
    const dayEnd = new Date(`${filters.day}T23:59:59.999`);
    dayEnd.setHours(dayEnd.getHours() - offset); // Convert to UTC

    query = query.gte('scheduled_at', dayStart.toISOString()).lte('scheduled_at', dayEnd.toISOString());
  }

  if (filters?.seasonId) {
    query = query.eq('season_id', filters.seasonId);
  }

  if (filters?.type) {
    query = query.eq('game_type', filters.type);
  }

  if (filters?.venue) {
    query = query.eq('location', filters.venue);
  }

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Transform team data from DB columns to expected format
  const normalizedGames = data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
    division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
  })) as ScheduleGame[];

  let result = normalizedGames;

  if (filters?.divisionId) {
    result = result.filter((game) => matchesDivisionFilter(game, filters.divisionId!));
  }

  if (filters?.teamId) {
    result = result.filter((game) => game.home_team?.id === filters.teamId || game.away_team?.id === filters.teamId);
  }

  return result;
}

/**
 * Get ALL games for a season (for the full-season table below weekly view).
 */
export async function getSeasonGames(
  leagueId: string,
  seasonId: string,
): Promise<ScheduleGame[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('games')
    .select(`
      id,
      league_id,
      season_id,
      scheduled_at,
      location,
      home_score,
      away_score,
      status,
      game_type,
      division_id,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      division:divisions(id, name)
    `)
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .order('scheduled_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
    division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
  })) as ScheduleGame[];
}

/**
 * Get game counts per day for a week (for the week picker badges)
 */
export async function getWeekGameCounts(
  leagueId: string,
  weekStart: Date,
  filters?: {
    seasonId?: string;
    divisionId?: string;
    teamId?: string;
    type?: string;
    venue?: string;
    status?: string;
    timezone?: string;
  },
): Promise<Record<string, number>> {
  const supabase = await createClient();

  // Calculate week end (7 days from start)
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const { data, error } = await supabase
    .from('games')
    .select(`
      scheduled_at,
      season_id,
      game_type,
      location,
      status,
      division_id,
      division:divisions(id, name),
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name))
    `)
    .eq('league_id', leagueId)
    .gte('scheduled_at', weekStart.toISOString())
    .lt('scheduled_at', weekEnd.toISOString())
    .order('scheduled_at', { ascending: true });

  if (error || !data) {
    return {};
  }

  const filteredGames = data
    .filter((game: any) => !filters?.seasonId || game.season_id === filters.seasonId)
    .filter((game: any) => !filters?.type || game.game_type === filters.type)
    .filter((game: any) => !filters?.venue || game.location === filters.venue)
    .filter((game: any) => !filters?.status || game.status === filters.status)
    .filter((game: any) => {
      if (!filters?.divisionId) return true;

      const normalizedGame = {
        division_id: game.division_id ?? null,
        division: Array.isArray(game.division) ? game.division[0] ?? null : game.division,
        home_team: transformTeamData(game.home_team),
        away_team: transformTeamData(game.away_team),
      };

      return matchesDivisionFilter(normalizedGame, filters.divisionId);
    })
    .filter((game: any) => {
      if (!filters?.teamId) return true;
      const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
      const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
      return homeTeam?.id === filters.teamId || awayTeam?.id === filters.teamId;
    });

  // Count games per day (convert UTC to league timezone)
  const counts: Record<string, number> = {};
  const timeZone = filters?.timezone || 'America/Toronto';

  filteredGames.forEach((game: { scheduled_at: string }) => {
    const date = new Date(game.scheduled_at);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const dateStr = `${year}-${month}-${day}`;

    counts[dateStr] = (counts[dateStr] || 0) + 1;
  });

  return counts;
}

/**
 * Fetch all games for schedule page
 */
export async function getSchedule(
  leagueId: string,
  seasonId?: string
): Promise<Game[]> {
  const supabase = await createClient();

  let query = supabase
    .from('games')
    .select(`
      *,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name))
    `)
    .eq('league_id', leagueId)
    .order('scheduled_at', { ascending: true });

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Transform team data from DB columns to expected format
  return data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
  })) as Game[];
}

/**
 * Dedup player stats for players on multiple teams (combine stats, keep team with most GP)
 */
function deduplicatePlayerStats(stats: PlayerStats[]): PlayerStats[] {
  const map = new Map<string, PlayerStats>();
  const maxGp = new Map<string, number>(); // track best team's GP for team_name selection
  for (const s of stats) {
    const existing = map.get(s.player_id);
    if (!existing) {
      map.set(s.player_id, { ...s });
      maxGp.set(s.player_id, s.games_played);
    } else {
      existing.goals += s.goals;
      existing.assists += s.assists;
      existing.points += s.points;
      existing.games_played += s.games_played;
      existing.penalty_minutes += s.penalty_minutes;
      existing.plus_minus += s.plus_minus;
      // Keep team_name from entry with more games played
      if (s.games_played > (maxGp.get(s.player_id) || 0)) {
        existing.team_name = s.team_name;
        existing.team_id = s.team_id;
        maxGp.set(s.player_id, s.games_played);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Dedup goalie stats for goalies on multiple teams (combine stats, recompute averages)
 */
function deduplicateGoalieStats(stats: GoalieStats[]): GoalieStats[] {
  const map = new Map<string, GoalieStats>();
  const maxGp = new Map<string, number>();
  for (const s of stats) {
    const existing = map.get(s.player_id);
    if (!existing) {
      map.set(s.player_id, { ...s });
      maxGp.set(s.player_id, s.games_played);
    } else {
      const totalSaves = (existing.saves || 0) + (s.saves || 0);
      const totalGA = (existing.goals_against || 0) + (s.goals_against || 0);
      existing.games_played += s.games_played;
      existing.wins += s.wins;
      existing.losses += s.losses;
      existing.shutouts += s.shutouts;
      existing.saves = totalSaves;
      existing.goals_against = totalGA;
      // Recompute save percentage and GAA from combined totals
      const totalShots = totalSaves + totalGA;
      existing.save_percentage = totalShots > 0 ? totalSaves / totalShots : 0;
      existing.goals_against_average = existing.games_played > 0
        ? totalGA / existing.games_played
        : 0;
      // Keep team_name from entry with more games played
      if (s.games_played > (maxGp.get(s.player_id) || 0)) {
        existing.team_name = s.team_name;
        existing.team_id = s.team_id;
        maxGp.set(s.player_id, s.games_played);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Dedup special teams leaders for players on multiple teams
 */
function deduplicateSpecialTeamsLeaders(stats: SpecialTeamsLeader[]): SpecialTeamsLeader[] {
  const map = new Map<string, SpecialTeamsLeader>();
  const maxGp = new Map<string, number>();
  for (const s of stats) {
    const existing = map.get(s.player_id);
    if (!existing) {
      map.set(s.player_id, { ...s });
      maxGp.set(s.player_id, 1); // no GP field, use first-seen priority
    } else {
      existing.pp_goals += s.pp_goals;
      existing.pp_assists += s.pp_assists;
      existing.pp_points += s.pp_points;
      existing.sh_goals += s.sh_goals;
      existing.sh_assists += s.sh_assists;
      existing.gwg += s.gwg;
      existing.eng += s.eng;
    }
  }
  return Array.from(map.values());
}

/**
 * Fetch stats leaders
 */
export async function getStatsLeaders(
  leagueId: string,
  statType: 'points' | 'goals' | 'assists' | 'saves' = 'points',
  limit = 10,
  divisionId?: string,
  seasonId?: string | null, // null = all-time career stats
  leagueSlug?: string,
): Promise<PlayerStats[]> {
  const supabase = await createClient();

  // If seasonId is explicitly null, fetch all-time career stats
  if (seasonId === null) {
    const { rows, profileIdsByPlayerId } = await buildAllTimeSkaterRows(leagueId, divisionId, leagueSlug);

    return rows
      .map((row) => ({
        player_id: row.player_id,
        profile_id: profileIdsByPlayerId.has(row.player_id)
          ? profileIdsByPlayerId.get(row.player_id) ?? null
          : row.player_id,
        player_name: row.player_name,
        team_name: row.team_name,
        team_id: row.team_id,
        position: row.position,
        games_played: row.games_played,
        goals: row.goals,
        assists: row.assists,
        points: row.points,
        penalty_minutes: row.penalty_minutes,
        plus_minus: row.plus_minus,
      }))
      .sort((left, right) => compareLegacySkaters(left, right, statType === 'saves' ? 'points' : statType))
      .slice(0, limit) as PlayerStats[];
  }

  // Try to use stats RPC only when no explicit season was requested.
  // The RPC is league-scoped, not season-scoped, so using it for a named season
  // can return the wrong leaderboard with the right label.
  if (seasonId === undefined) {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_stats_leaders',
      {
        p_league_id: leagueId,
        p_stat_type: statType,
        p_limit: limit,
        p_division_id: divisionId || null,
      }
    );

    if (!rpcError && rpcData && rpcData.length > 0) {
      return deduplicatePlayerStats(rpcData as PlayerStats[]).slice(0, limit);
    }
  }

  // Fallback: Query player_season_stats view for specific or current season
  const season = seasonId ? { id: seasonId } : await getCurrentSeason(leagueId);
  if (!season) return [];

  if (isImportedAggregateSeasonId(season.id)) {
    const rows = await buildImportedAggregateSkaterRows(leagueId, season.id, divisionId);
    return rows
      .map((row) => ({
        player_id: row.player_id,
        player_name: row.player_name,
        team_name: row.team_name,
        team_id: row.team_id,
        position: row.position,
        games_played: row.games_played,
        goals: row.goals,
        assists: row.assists,
        points: row.points,
        penalty_minutes: row.penalty_minutes,
        plus_minus: row.plus_minus,
      }))
      .sort((left, right) => compareLegacySkaters(left, right, statType === 'saves' ? 'points' : statType))
      .slice(0, limit) as PlayerStats[];
  }

  const orderColumn = statType === 'saves' ? 'games_played' : statType;

  let query = supabase
    .from('player_season_stats')
    .select('*')
    .eq('season_id', season.id);

  if (divisionId) {
    query = query.eq('division_id', divisionId);
  }

  const { data: stats, error } = await query
    .order(orderColumn, { ascending: false })
    .limit(limit);

  if (error || !stats) {
    return [];
  }

  const mapped = stats.map((s) => {
    const playerName = s.full_name || 'Unknown';
    const overriddenGamesPlayed = isImportedAggregateSeasonId(season.id)
      ? getImportedAggregateSkaterGamesPlayed(season.id, playerName)
      : null;

    return {
      player_id: s.player_id,
      player_name: playerName,
      team_name: s.team_name || 'Unknown',
      team_id: s.team_id || '',
      position: s.position || null,
      games_played: overriddenGamesPlayed ?? (Number(s.games_played) || 0),
      goals: Number(s.goals) || 0,
      assists: Number(s.assists) || 0,
      points: Number(s.points) || 0,
      penalty_minutes: 0,
      plus_minus: 0,
    };
  }) as PlayerStats[];

  return deduplicatePlayerStats(mapped).slice(0, limit);
}

/**
 * Fetch stats leaders enriched with avatar URLs from profiles
 */
export async function getStatsLeadersWithAvatars(
  leagueId: string,
  statType: 'points' | 'goals' | 'assists' = 'points',
  limit = 5,
  divisionId?: string,
  seasonId?: string | null,
  leagueSlug?: string,
): Promise<PlayerStatsWithAvatar[]> {
  const leaders = await getStatsLeaders(leagueId, statType, limit, divisionId, seasonId, leagueSlug);
  if (leaders.length === 0) return [];

  const supabase = await createClient();
  const playerIds = leaders.map((l) => l.player_id);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, avatar_url, photo_url')
    .in('id', playerIds);

  const avatarMap = new Map(
    (profiles || []).map((p) => [p.id, resolvePlayerPhotoUrl(p)])
  );

  return leaders.map((leader) => ({
    ...leader,
    avatar_url: avatarMap.get(leader.player_id) || null,
  }));
}

async function getTeamDivisionNameMap(teamIds: string[]): Promise<Map<string, string | null>> {
  if (teamIds.length === 0) {
    return new Map();
  }

  const supabase = await createClient();
  const { data: teams } = await supabase
    .from('teams')
    .select('id, divisions(name)')
    .in('id', teamIds);

  const divisionMap = new Map<string, string | null>();
  for (const team of teams || []) {
    const divisionData = Array.isArray((team as any).divisions)
      ? (team as any).divisions[0]
      : (team as any).divisions;
    divisionMap.set(team.id, divisionData?.name || null);
  }

  return divisionMap;
}

export async function getPointsLeadersWithDivision(
  leagueId: string,
  seasonId?: string | null,
  limit = 5,
  divisionId?: string
): Promise<HomepageSeasonLeader[]> {
  const leaders = await getStatsLeadersWithAvatars(leagueId, 'points', limit, divisionId, seasonId);
  if (leaders.length === 0) {
    return [];
  }

  const teamIds = [...new Set(leaders.map((leader) => leader.team_id).filter(Boolean))];
  const divisionMap = await getTeamDivisionNameMap(teamIds);

  return leaders.map((leader) => ({
    ...leader,
    division_name: divisionMap.get(leader.team_id) || null,
  }));
}

export async function getSeasonPointsLeadersWithDivision(
  leagueId: string,
  seasonId: string,
  limit = 3,
): Promise<HomepageSeasonLeader[]> {
  return getPointsLeadersWithDivision(leagueId, seasonId, limit);
}

export async function getGoalieLeadersWithDivision(
  leagueId: string,
  seasonId?: string | null,
  sortBy: 'wins' | 'save_percentage' | 'goals_against_average' | 'shutouts' = 'wins',
  limit = 20,
  divisionId?: string
): Promise<GoalieStatsWithDivision[]> {
  const leaders = await getGoalieLeaders(leagueId, seasonId, sortBy, limit, divisionId);
  if (leaders.length === 0) {
    return [];
  }

  const teamIds = [...new Set(leaders.map((leader) => leader.team_id).filter(Boolean))];
  const divisionMap = await getTeamDivisionNameMap(teamIds);

  return leaders.map((leader) => ({
    ...leader,
    division_name: divisionMap.get(leader.team_id) || null,
  }));
}

type RawSkaterStatsRow = {
  player_id: string;
  team_id: string;
  season_id: string;
  game_id: string;
  goals: number | null;
  assists: number | null;
  shots?: number | null;
  penalty_minutes?: number | null;
  plus_minus?: number | null;
  power_play_goals?: number | null;
  power_play_assists?: number | null;
  short_handed_goals?: number | null;
  short_handed_assists?: number | null;
  empty_net_goals?: number | null;
  game_winning_goals?: number | null;
  player?: { full_name?: string | null; avatar_url?: string | null; photo_url?: string | null } | { full_name?: string | null; avatar_url?: string | null; photo_url?: string | null }[] | null;
  team?: {
    name?: string | null;
    divisions?: { name?: string | null } | { name?: string | null }[] | null;
  } | {
    name?: string | null;
    divisions?: { name?: string | null } | { name?: string | null }[] | null;
  }[] | null;
};

type RawGoalieStatsRow = {
  player_id: string;
  team_id: string;
  season_id: string;
  game_id: string;
  saves?: number | null;
  shots_against?: number | null;
  goals_against?: number | null;
  shutout?: boolean | null;
  game_result?: string | null;
  player?: { full_name?: string | null; avatar_url?: string | null; photo_url?: string | null } | { full_name?: string | null; avatar_url?: string | null; photo_url?: string | null }[] | null;
  team?: {
    name?: string | null;
    divisions?: { name?: string | null } | { name?: string | null }[] | null;
  } | {
    name?: string | null;
    divisions?: { name?: string | null } | { name?: string | null }[] | null;
  }[] | null;
  game?: {
    home_team_id?: string | null;
    away_team_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  } | {
    home_team_id?: string | null;
    away_team_id?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  }[] | null;
};

type RosterDisplayRow = {
  player_id: string;
  team_id: string;
  season_id: string | null;
  position: string | null;
  is_goalie: boolean | null;
  jersey_number: number | null;
};

type CurrentSeasonRosterDisplayRow = {
  player_id: string;
  joined_at: string | null;
  start_date: string | null;
  team?: {
    name?: string | null;
    logo_url?: string | null;
  } | {
    name?: string | null;
    logo_url?: string | null;
  }[] | null;
};

type SkaterStatsAccumulator = {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  jersey_number: string | null;
  team_id: string;
  team_name: string;
  division_name: string | null;
  position: string | null;
  is_goalie: boolean;
  game_ids: Set<string>;
  goals: number;
  assists: number;
  penalty_minutes: number;
  plus_minus: number;
  power_play_goals: number;
  power_play_assists: number;
  short_handed_goals: number;
  short_handed_assists: number;
  game_winning_goals: number;
  empty_net_goals: number;
  shots: number;
  best_team_games: number;
  team_games: Map<string, Set<string>>;
};

type GoalieStatsAccumulator = {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  jersey_number: string | null;
  team_id: string;
  team_name: string;
  division_name: string | null;
  game_ids: Set<string>;
  wins: number;
  losses: number;
  saves: number;
  goals_against: number;
  shots_against: number;
  shutouts: number;
  best_team_games: number;
  team_games: Map<string, Set<string>>;
};

export function aggregateNativeGoalieStatsRows(
  rows: RawGoalieStatsRow[],
  rosterRows: Array<Pick<RosterDisplayRow, 'player_id' | 'team_id' | 'season_id' | 'jersey_number'>>,
  seasonId?: string | null,
): UnifiedGoalieStatsRow[] {
  if (rows.length === 0) {
    return [];
  }

  const rosterMap = new Map<string, Pick<RosterDisplayRow, 'player_id' | 'team_id' | 'season_id' | 'jersey_number'>>();
  for (const row of rosterRows) {
    rosterMap.set(`${row.player_id}:${row.team_id}:${row.season_id ?? 'any'}`, row);
  }

  const goalieMap = new Map<string, GoalieStatsAccumulator>();
  for (const row of rows) {
    const playerData = unwrapJoinedRecord(row.player);
    const teamData = unwrapJoinedRecord(row.team);
    const gameData = unwrapJoinedRecord(row.game);
    const roster = rosterMap.get(`${row.player_id}:${row.team_id}:${row.season_id ?? 'any'}`);

    const existing = goalieMap.get(row.player_id);
    const entry = existing ?? {
      player_id: row.player_id,
      player_name: playerData?.full_name || 'Unknown Goalie',
      avatar_url: resolvePlayerPhotoUrl(playerData),
      jersey_number: roster?.jersey_number != null ? String(roster.jersey_number) : null,
      team_id: row.team_id,
      team_name: teamData?.name || 'Unknown Team',
      division_name: getJoinedDivisionName(teamData?.divisions),
      game_ids: new Set<string>(),
      wins: 0,
      losses: 0,
      saves: 0,
      goals_against: 0,
      shots_against: 0,
      shutouts: 0,
      best_team_games: 0,
      team_games: new Map<string, Set<string>>(),
    };

    if (row.game_id) {
      entry.game_ids.add(row.game_id);
    }
    entry.saves += row.saves || 0;
    entry.goals_against += row.goals_against || 0;
    entry.shots_against += row.shots_against || (row.saves || 0) + (row.goals_against || 0);
    entry.shutouts += row.shutout ? 1 : 0;

    const result = resolveGoalieGameResult(row.game_result, gameData, row.team_id);
    if (result === 'W' || result === 'WIN') {
      entry.wins += 1;
    } else if (result === 'L' || result === 'LOSS' || result === 'OTL' || result === 'SOL') {
      entry.losses += 1;
    }

    const teamKey = `${row.team_id}:${row.season_id ?? 'any'}`;
    const teamGameIds = entry.team_games.get(teamKey) || new Set<string>();
    if (row.game_id) {
      teamGameIds.add(row.game_id);
    }
    entry.team_games.set(teamKey, teamGameIds);
    const teamGames = teamGameIds.size;
    if (teamGames > entry.best_team_games) {
      entry.best_team_games = teamGames;
      entry.team_id = row.team_id;
      entry.team_name = teamData?.name || 'Unknown Team';
      entry.division_name = getJoinedDivisionName(teamData?.divisions);
      entry.jersey_number = roster?.jersey_number != null ? String(roster.jersey_number) : entry.jersey_number;
    }

    if (!existing) {
      goalieMap.set(row.player_id, entry);
    }
  }

  return Array.from(goalieMap.values()).map((entry) =>
    applyImportedAggregateGoalieOverride(
      {
        player_id: entry.player_id,
        player_name: entry.player_name,
        avatar_url: entry.avatar_url,
        jersey_number: entry.jersey_number,
        team_id: entry.team_id,
        team_name: entry.team_name,
        division_name: entry.division_name,
        position: 'Goalie',
        championships: 0,
        games_played: entry.game_ids.size,
        wins: entry.wins,
        losses: entry.losses,
        saves: entry.saves,
        goals_against: entry.goals_against,
        save_percentage: entry.shots_against > 0 ? roundStatValue((entry.saves / entry.shots_against) * 100, 1) : null,
        goals_against_average: entry.game_ids.size > 0 ? roundStatValue(entry.goals_against / entry.game_ids.size) : null,
        shutouts: entry.shutouts,
      },
      seasonId,
    ),
  );
}

type FallbackCurrentSeasonGoalieRosterRow = Pick<
  RosterDisplayRow,
  'player_id' | 'team_id' | 'season_id' | 'jersey_number' | 'is_goalie' | 'position'
> & {
  profiles?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  teams?: {
    name?: string | null;
    divisions?: { name?: string | null } | Array<{ name?: string | null }> | null;
  } | null;
};

type FallbackCurrentSeasonGameRow = Pick<
  Game,
  'season_id' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score'
>;

async function buildFallbackCurrentSeasonGoalieRows(
  leagueId: string,
  seasonId: string,
  filteredTeamIds?: string[] | null,
): Promise<UnifiedGoalieStatsRow[]> {
  const supabase = await createClient();

  let rosterQuery = supabase
    .from('team_rosters')
    .select(`
      player_id,
      team_id,
      season_id,
      jersey_number,
      is_goalie,
      position,
      profiles:profiles!team_rosters_player_id_fkey(full_name, avatar_url, photo_url),
      teams:teams!team_rosters_team_id_fkey(name, divisions(name))
    `)
    .eq('season_id', seasonId)
    .is('end_date', null);

  if (filteredTeamIds && filteredTeamIds.length > 0) {
    rosterQuery = rosterQuery.in('team_id', filteredTeamIds);
  }

  const { data: rosterData, error: rosterError } = await rosterQuery;
  if (rosterError || !rosterData || rosterData.length === 0) {
    return [];
  }

  const goaliesByTeam = new Map<string, FallbackCurrentSeasonGoalieRosterRow[]>();
  for (const rawRow of rosterData as unknown as FallbackCurrentSeasonGoalieRosterRow[]) {
    const isGoalie = rawRow.is_goalie === true || rawRow.position === 'Goalie';
    if (!isGoalie || !rawRow.team_id || !rawRow.player_id) {
      continue;
    }

    const rowsForTeam = goaliesByTeam.get(rawRow.team_id) || [];
    rowsForTeam.push(rawRow);
    goaliesByTeam.set(rawRow.team_id, rowsForTeam);
  }

  const singleGoalieTeams = new Map<string, FallbackCurrentSeasonGoalieRosterRow>();
  for (const [teamId, goalieRows] of goaliesByTeam.entries()) {
    if (goalieRows.length === 1) {
      singleGoalieTeams.set(teamId, goalieRows[0]);
    }
  }

  if (singleGoalieTeams.size === 0) {
    return [];
  }

  const { data: gamesData, error: gamesError } = await supabase
    .from('games')
    .select('season_id, home_team_id, away_team_id, home_score, away_score')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('status', 'completed');

  if (gamesError || !gamesData || gamesData.length === 0) {
    return [];
  }

  const goalieMap = new Map<string, UnifiedGoalieStatsRow>();

  const ensureEntry = (goalie: FallbackCurrentSeasonGoalieRosterRow) => {
    const existing = goalieMap.get(goalie.player_id);
    if (existing) {
      return existing;
    }

    const entry: UnifiedGoalieStatsRow = {
      player_id: goalie.player_id,
      player_name: goalie.profiles?.full_name || 'Unknown Goalie',
      avatar_url: resolvePlayerPhotoUrl(goalie.profiles),
      jersey_number: goalie.jersey_number != null ? String(goalie.jersey_number) : null,
      team_id: goalie.team_id,
      team_name: goalie.teams?.name || 'Unknown Team',
      division_name: getJoinedDivisionName(goalie.teams?.divisions),
      position: 'Goalie',
      championships: 0,
      games_played: 0,
      wins: 0,
      losses: 0,
      saves: 0,
      goals_against: 0,
      save_percentage: null,
      goals_against_average: null,
      shutouts: 0,
    };

    goalieMap.set(goalie.player_id, entry);
    return entry;
  };

  const addGameToGoalie = (
    goalie: FallbackCurrentSeasonGoalieRosterRow | undefined,
    goalsFor: number,
    goalsAgainst: number,
  ) => {
    if (!goalie) {
      return;
    }

    const entry = ensureEntry(goalie);
    const saves = Math.max(0, ASSUMED_GOALIE_SHOTS_AGAINST - goalsAgainst);
    entry.games_played += 1;
    entry.saves += saves;
    entry.goals_against += goalsAgainst;
    entry.save_percentage = entry.games_played > 0
      ? roundStatValue((entry.saves / (entry.games_played * ASSUMED_GOALIE_SHOTS_AGAINST)) * 100, 1)
      : null;

    if (goalsFor > goalsAgainst) {
      entry.wins += 1;
    } else if (goalsFor < goalsAgainst) {
      entry.losses += 1;
    }

    if (goalsAgainst === 0) {
      entry.shutouts += 1;
    }

    entry.goals_against_average =
      entry.games_played > 0 ? roundStatValue(entry.goals_against / entry.games_played) : null;
  };

  for (const rawGame of gamesData as FallbackCurrentSeasonGameRow[]) {
    const homeScore = Number(rawGame.home_score ?? 0);
    const awayScore = Number(rawGame.away_score ?? 0);

    addGameToGoalie(singleGoalieTeams.get(rawGame.home_team_id || ''), homeScore, awayScore);
    addGameToGoalie(singleGoalieTeams.get(rawGame.away_team_id || ''), awayScore, homeScore);
  }

  return Array.from(goalieMap.values()).map((row) => applyImportedAggregateGoalieOverride(row, seasonId));
}

type ImportedAggregateProfileMetadata = {
  playerId: string;
  avatarUrl: string | null;
  position: string | null;
};

function enrichUnifiedStatsRowsWithCurrentDisplayTeam<T extends UnifiedStatsRowBase>(
  rows: T[],
  currentSeasonRosters: CurrentSeasonRosterDisplayRow[],
  fallbackLogoUrl: string = FREE_AGENT_DISPLAY_TEAM_LOGO_URL,
): T[] {
  if (rows.length === 0) {
    return rows;
  }

  const currentTeamByPlayerId = new Map<string, {
    display_team_logo_url: string | null;
    display_team_name: string | null;
    display_team_is_free_agent: boolean;
    sort_value: number;
  }>();

  for (const roster of currentSeasonRosters) {
    const team = unwrapJoinedRecord(roster.team);
    const sortValue = toRecencyTimestamp(roster.joined_at, roster.start_date);
    const existing = currentTeamByPlayerId.get(roster.player_id);

    if (!existing || sortValue > existing.sort_value) {
      currentTeamByPlayerId.set(roster.player_id, {
        display_team_logo_url: team?.logo_url || null,
        display_team_name: team?.name || null,
        display_team_is_free_agent: false,
        sort_value: sortValue,
      });
    }
  }

  return rows.map((row) => {
    const displayTeam = currentTeamByPlayerId.get(row.player_id);

    if (!displayTeam) {
      return {
        ...row,
        display_team_logo_url: fallbackLogoUrl,
        display_team_name: FREE_AGENT_DISPLAY_TEAM_NAME,
        display_team_is_free_agent: true,
      };
    }

    return {
      ...row,
      display_team_logo_url: displayTeam.display_team_logo_url,
      display_team_name: displayTeam.display_team_name,
      display_team_is_free_agent: displayTeam.display_team_is_free_agent,
    };
  });
}

async function appendCurrentDisplayTeamMetadata<T extends UnifiedStatsRowBase>(
  leagueId: string,
  rows: T[],
  options: CanonicalReadOptions = {},
): Promise<T[]> {
  if (rows.length === 0) {
    return rows;
  }

  const playerIds = [...new Set(rows.map((row) => row.player_id).filter(Boolean))];
  if (playerIds.length === 0) {
    return rows;
  }

  const supabase = await createClient();

  // Fetch the league logo to use as fallback for non-rostered players
  const { data: leagueRow, error: leagueError } = await supabase
    .from('leagues')
    .select('logo_url')
    .eq('id', leagueId)
    .single();
  if (leagueError && options.strict) throwCanonicalReadError(leagueError, 'display league');
  const fallbackLogoUrl = leagueRow?.logo_url || FREE_AGENT_DISPLAY_TEAM_LOGO_URL;

  const currentSeason = await getCurrentSeason(leagueId, options);
  if (!currentSeason) {
    return enrichUnifiedStatsRowsWithCurrentDisplayTeam(rows, [], fallbackLogoUrl);
  }

  // Fetch ALL active rosters for the current season (not filtered by player_id)
  // to avoid PostgREST URL length limits when all-time stats have hundreds of players
  const { data: currentSeasonRosters, error } = await supabase
    .from('team_rosters')
    .select(`
      player_id,
      joined_at,
      start_date,
      team:teams(name, logo_url)
    `)
    .eq('league_id', leagueId)
    .eq('season_id', currentSeason.id)
    .eq('status', 'active')
    .is('end_date', null);

  if (error || !currentSeasonRosters) {
    if (error && options.strict) throwCanonicalReadError(error, 'current display rosters');
    return enrichUnifiedStatsRowsWithCurrentDisplayTeam(rows, [], fallbackLogoUrl);
  }

  return enrichUnifiedStatsRowsWithCurrentDisplayTeam(
    rows,
    currentSeasonRosters as unknown as CurrentSeasonRosterDisplayRow[],
    fallbackLogoUrl,
  );
}

type ImportedAggregateTeamMetadata = {
  teamId: string;
  divisionId: string | null;
  divisionName: string | null;
};

function normalizeImportedAggregateKey(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

async function getImportedAggregateProfileMap(leagueId: string, seasonId: string, playerNames: string[], options: CanonicalReadOptions = {}) {
  const supabase = createServiceRoleClient() as any;
  const profileMap = new Map<string, ImportedAggregateProfileMetadata>();

  const { data: rosterRows, error: rosterError } = await supabase
    .from('team_rosters')
    .select(`
      player_id,
      position,
      profile:profiles(id, full_name, avatar_url, photo_url, position)
    `)
    .eq('league_id', leagueId)
    .eq('season_id', seasonId);
  if (rosterError && options.strict) throwCanonicalReadError(rosterError, 'imported aggregate rosters');

  for (const row of rosterRows || []) {
    const profile = unwrapJoinedRecord(row.profile) as {
      id?: string | null;
      full_name?: string | null;
      avatar_url?: string | null;
      photo_url?: string | null;
      position?: string | null;
    } | null;
    const key = normalizeImportedAggregateKey(profile?.full_name);
    if (!key || !row.player_id || profileMap.has(key)) {
      continue;
    }

    profileMap.set(key, {
      playerId: row.player_id,
      avatarUrl: resolvePlayerPhotoUrl(profile),
      position: row.position || profile?.position || null,
    });
  }

  const missingNames = [...new Set(
    playerNames.filter((name) => !profileMap.has(normalizeImportedAggregateKey(name))),
  )];

  if (missingNames.length > 0) {
    const profiles = await readCanonicalBatchedRows<{
      id: string; full_name: string | null; avatar_url: string | null; photo_url?: string | null; position?: string | null;
    }>(missingNames, 'imported aggregate profiles', (batch) => supabase
      .from('profiles')
      .select('id, full_name, avatar_url, photo_url, position')
      .in('full_name', batch), options);
    const candidateIds = [...new Set((profiles || []).map((profile) => profile.id).filter(Boolean))];
    const [historicalRosters, baselineProofs] = await Promise.all([
      readCanonicalBatchedRows<{ player_id: string }>(candidateIds, 'imported aggregate historical rosters', (batch) => supabase
        .from('team_rosters').select('player_id').eq('league_id', leagueId).in('player_id', batch), options),
      readCanonicalBatchedRows<{ player_id: string }>(candidateIds, 'imported aggregate baseline identities', (batch) => supabase
        .from('player_career_baselines').select('player_id').eq('league_id', leagueId).in('player_id', batch), options),
    ]);
    const provenIds = new Set([...(historicalRosters || []), ...(baselineProofs || [])].map((row) => row.player_id));
    const candidatesByName = new Map<string, NonNullable<typeof profiles>>();
    for (const profile of profiles || []) {
      const key = normalizeImportedAggregateKey(profile.full_name);
      if (!key || !profile.id || !provenIds.has(profile.id)) continue;
      const candidates = candidatesByName.get(key) || [];
      candidates.push(profile);
      candidatesByName.set(key, candidates);
    }
    for (const [key, candidates] of candidatesByName) {
      if (profileMap.has(key) || candidates.length !== 1) continue;
      const profile = candidates[0];
      profileMap.set(key, { playerId: profile.id, avatarUrl: resolvePlayerPhotoUrl(profile), position: profile.position || null });
    }
  }

  return profileMap;
}

async function getImportedAggregateTeamMap(leagueId: string, options: CanonicalReadOptions = {}) {
  const supabase = createServiceRoleClient() as any;
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, name, division_id, divisions(name)')
    .eq('league_id', leagueId);
  if (error && options.strict) throwCanonicalReadError(error, 'imported aggregate teams');

  const teamMap = new Map<string, ImportedAggregateTeamMetadata>();
  for (const team of teams || []) {
    const key = normalizeImportedAggregateKey(team.name);
    if (!key || !team.id) {
      continue;
    }

    teamMap.set(key, {
      teamId: team.id,
      divisionId: team.division_id || null,
      divisionName: getJoinedDivisionName(team.divisions),
    });
  }

  return teamMap;
}

async function buildImportedAggregateSkaterRows(
  leagueId: string,
  seasonId: string,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedSkaterStatsRow[]> {
  const seeds = getImportedAggregateSkaterSeeds(seasonId);
  if (seeds.length === 0) {
    return [];
  }

  const [profileMap, teamMap] = await Promise.all([
    getImportedAggregateProfileMap(leagueId, seasonId, seeds.map((seed) => seed.playerName), options),
    getImportedAggregateTeamMap(leagueId, options),
  ]);

  const rows: UnifiedSkaterStatsRow[] = [];
  for (const seed of seeds) {
    const profile = profileMap.get(normalizeImportedAggregateKey(seed.playerName));
    if (!profile) {
      continue;
    }

    const team = seed.teamName ? teamMap.get(normalizeImportedAggregateKey(seed.teamName)) ?? null : null;
    if (divisionId && (!team || team.divisionId !== divisionId)) {
      continue;
    }

    const points = seed.goals + seed.assists;
    rows.push({
      player_id: profile.playerId,
      profile_id: profile.playerId,
      profile_id_league_verified: true,
      player_name: seed.playerName,
      avatar_url: profile.avatarUrl,
      team_id: team?.teamId ?? '',
      team_name: seed.teamName ?? 'Free Agent',
      division_name: team?.divisionName ?? null,
      position: isGoaliePosition(profile.position) ? null : profile.position,
      championships: 0,
      games_played: seed.gamesPlayed,
      goals: seed.goals,
      assists: seed.assists,
      points,
      points_per_game: seed.gamesPlayed > 0 ? roundStatValue(points / seed.gamesPlayed) : 0,
      goals_per_game: seed.gamesPlayed > 0 ? roundStatValue(seed.goals / seed.gamesPlayed) : 0,
      assists_per_game: seed.gamesPlayed > 0 ? roundStatValue(seed.assists / seed.gamesPlayed) : 0,
      penalty_minutes: 0,
      plus_minus: 0,
      power_play_goals: 0,
      power_play_assists: 0,
      power_play_points: 0,
      short_handed_goals: 0,
      short_handed_assists: 0,
      game_winning_goals: 0,
      empty_net_goals: 0,
      shots: 0,
      shots_per_game: 0,
    });
  }

  return rows;
}

async function buildImportedAggregateGoalieRows(
  leagueId: string,
  seasonId: string,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedGoalieStatsRow[]> {
  const seeds = getImportedAggregateGoalieSeeds(seasonId);
  if (seeds.length === 0) {
    return [];
  }

  const [profileMap, teamMap] = await Promise.all([
    getImportedAggregateProfileMap(leagueId, seasonId, seeds.map((seed) => seed.playerName), options),
    getImportedAggregateTeamMap(leagueId, options),
  ]);

  const rows: UnifiedGoalieStatsRow[] = [];
  for (const seed of seeds) {
    const profile = profileMap.get(normalizeImportedAggregateKey(seed.playerName));
    if (!profile) {
      continue;
    }

    const team = seed.teamName ? teamMap.get(normalizeImportedAggregateKey(seed.teamName)) ?? null : null;
    if (divisionId && (!team || team.divisionId !== divisionId)) {
      continue;
    }

    const totalShotsAgainst = seed.saves + seed.goalsAgainst;
    rows.push({
      player_id: profile.playerId,
      profile_id: profile.playerId,
      profile_id_league_verified: true,
      player_name: seed.playerName,
      avatar_url: profile.avatarUrl,
      team_id: team?.teamId ?? '',
      team_name: seed.teamName ?? 'Free Agent',
      division_name: team?.divisionName ?? null,
      position: 'Goalie',
      championships: 0,
      games_played: seed.gamesPlayed,
      wins: seed.wins,
      losses: seed.losses,
      saves: seed.saves,
      goals_against: seed.goalsAgainst,
      save_percentage: totalShotsAgainst > 0 ? roundStatValue((seed.saves / totalShotsAgainst) * 100, 1) : null,
      goals_against_average: seed.gamesPlayed > 0 ? roundStatValue(seed.goalsAgainst / seed.gamesPlayed) : null,
      shutouts: seed.shutouts,
    });
  }

  return rows;
}

async function getFilteredTeamIds(leagueId: string, divisionId?: string, options: CanonicalReadOptions = {}) {
  if (!divisionId) {
    return null;
  }

  const supabase = await createClient();
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('division_id', divisionId);
  if (error && options.strict) throwCanonicalReadError(error, 'division teams');

  return (teams || []).map((team) => team.id);
}

async function appendNativeChampionshipCounts<T extends { player_id: string; championships: number }>(
  leagueId: string,
  rows: T[],
  seasonId?: string | null,
  options: CanonicalReadOptions = {},
): Promise<T[]> {
  if (rows.length === 0) {
    return rows;
  }

  const playerIds = [...new Set(rows.map((row) => row.player_id).filter(Boolean))];
  if (playerIds.length === 0) {
    return rows;
  }

  const supabase = await createClient();
  const data = await readCanonicalBatchedRows<{ player_id: string | null }>(
    playerIds,
    'player championship badges',
    (batch) => {
      let query = supabase
        .from('player_badges')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('badge_type', 'championship')
        .in('player_id', batch);
      if (seasonId) query = query.eq('season_id', seasonId);
      return query;
    },
    options,
  );
  if (!data) {
    return rows;
  }

  const counts = new Map<string, number>();
  for (const badge of data) {
    if (!badge.player_id) {
      continue;
    }
    counts.set(badge.player_id, (counts.get(badge.player_id) || 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    championships: row.championships + (counts.get(row.player_id) || 0),
  }));
}

type AllTimeSkaterRowsResult = {
  rows: UnifiedSkaterStatsRow[];
  profileIdsByPlayerId: Map<string, string | null>;
};

type AllTimeGoalieRowsResult = {
  rows: UnifiedGoalieStatsRow[];
  profileIdsByPlayerId: Map<string, string | null>;
};

const IMPORTED_AGGREGATE_ALL_TIME_SEASON_IDS = [HLHL_WINTER_2026_SEASON_ID] as const;

async function getImportedAggregateAllTimeSkaterRows(
  leagueId: string,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedSkaterStatsRow[]> {
  const rows = await Promise.all(
    IMPORTED_AGGREGATE_ALL_TIME_SEASON_IDS.map((seasonId) =>
      buildImportedAggregateSkaterRows(leagueId, seasonId, divisionId, options),
    ),
  );

  return rows.flat();
}

async function getImportedAggregateAllTimeGoalieRows(
  leagueId: string,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedGoalieStatsRow[]> {
  const rows = await Promise.all(
    IMPORTED_AGGREGATE_ALL_TIME_SEASON_IDS.map((seasonId) =>
      buildImportedAggregateGoalieRows(leagueId, seasonId, divisionId, options),
    ),
  );

  return rows.flat();
}

function alignBaselineRowsToImportedAggregateProfiles(
  baselineRows: ImportedCareerBaselineRow[],
  importedAggregateRows: Array<{ player_id: string; player_name: string }>,
): ImportedCareerBaselineRow[] {
  const importedProfileIdsByName = new Map(
    importedAggregateRows.map((row) => [normalizeImportedAggregateKey(row.player_name), row.player_id]),
  );

  return baselineRows.map((row) => {
    const importedProfileId = importedProfileIdsByName.get(normalizeImportedAggregateKey(row.player_name));
    if (!importedProfileId || importedProfileId === row.player_id) {
      return row;
    }

    return {
      ...row,
      player_id: importedProfileId,
      profile_id: importedProfileId,
      profile_id_league_verified: true,
    };
  });
}

async function getNativeUnifiedSkaterStatsRows(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedSkaterStatsRow[]> {
  const filteredTeamIds = await getFilteredTeamIds(leagueId, divisionId, options);
  if (divisionId && filteredTeamIds && filteredTeamIds.length === 0) {
    return [];
  }

  // All-time public stats are rendered server-side and must include every completed
  // Hockey Life game, including the active/current season. Use the service client for
  // all-time native aggregation so the lower stats table stays aligned with player
  // profile career totals.
  const supabase = seasonId == null ? createServiceRoleClient() : await createClient();
  const buildStatsQuery = () => {
    let query = supabase
      .from('player_stats')
      .select(`
        player_id,
        team_id,
        season_id,
        game_id,
        goals,
        assists,
        shots,
        penalty_minutes,
        plus_minus,
        power_play_goals,
        power_play_assists,
        short_handed_goals,
        short_handed_assists,
        empty_net_goals,
        game_winning_goals,
        game:games!inner(league_id, season_id, status, home_captain_verified, away_captain_verified),
        player:profiles!player_stats_player_id_fkey(full_name, avatar_url, photo_url),
        team:teams!player_stats_team_id_fkey(name, divisions(name))
      `)
      .eq('game.league_id', leagueId)
      .eq('game.status', 'completed');

    if (seasonId) {
      query = query.eq('game.season_id', seasonId);
    }

    if (filteredTeamIds) {
      query = query.in('team_id', filteredTeamIds);
    }

    return query;
  };

  const pageSize = 1000;
  const allStatsRows: unknown[] = [];
  let error: unknown = null;
  for (let offset = 0; ; offset += pageSize) {
    const { data: pageData, error: pageError } = await buildStatsQuery().range(offset, offset + pageSize - 1);
    if (pageError) {
      if (options.strict) throwCanonicalReadError(pageError, `player_stats page ${offset}`);
      error = pageError;
      break;
    }
    if (!pageData || pageData.length === 0) {
      break;
    }
    allStatsRows.push(...pageData);
    if (pageData.length < pageSize) {
      break;
    }
  }

  const data = allStatsRows as RawSkaterStatsRow[];
  const hasStatData = !error && data.length > 0;

  let visibleRows: RawSkaterStatsRow[] = [];
  if (hasStatData) {
    const rows = data as unknown as RawSkaterStatsRow[];
    const hiddenSeasonIds =
      seasonId == null
        ? await getHistoricalCareerBaselineSeasonIdsForLeague(supabase, leagueId, rows.map((row) => row.season_id), options)
        : new Set<string>();
    visibleRows = hiddenSeasonIds.size > 0
      ? rows.filter((row) => !hiddenSeasonIds.has(row.season_id ?? ''))
      : rows;
  }

  if (visibleRows.length === 0 && !seasonId) {
    return [];
  }

  const rosterMap = new Map<string, RosterDisplayRow>();
  if (visibleRows.length > 0) {
    const playerIds = [...new Set(visibleRows.map((row) => row.player_id))];
    const teamIds = [...new Set(visibleRows.map((row) => row.team_id).filter(Boolean))];
    const seasonIds = [...new Set(visibleRows.map((row) => row.season_id).filter(Boolean))];

    const rosterRows = await readCanonicalBatchedRows<RosterDisplayRow>(
      playerIds,
      'player_stats rosters',
      (batch) => {
        let query = supabase
          .from('team_rosters')
          .select('player_id, team_id, season_id, position, is_goalie, jersey_number')
          .in('player_id', batch)
          .in('team_id', teamIds);
        if (seasonIds.length > 0) query = query.in('season_id', seasonIds);
        return query;
      },
      options,
    );
    for (const row of (rosterRows || []) as unknown as RosterDisplayRow[]) {
      rosterMap.set(`${row.player_id}:${row.team_id}:${row.season_id ?? 'any'}`, row);
    }
  }

  const [confirmedCheckins, fallbackRosterAppearances] = seasonId
    ? await Promise.all([
        getConfirmedCheckinAppearanceRows(createServiceRoleClient(), {
          leagueId,
          seasonId,
          teamIds: filteredTeamIds ?? undefined,
        }),
        getFallbackRosterAppearanceRows(createServiceRoleClient(), {
          seasonId,
          teamIds: filteredTeamIds ?? undefined,
        }),
      ])
    : [[], []];

  const playerMap = new Map<string, SkaterStatsAccumulator>();
  for (const row of visibleRows) {
    const playerData = unwrapJoinedRecord(row.player);
    const teamData = unwrapJoinedRecord(row.team);
    const rosterKey = `${row.player_id}:${row.team_id}:${row.season_id ?? 'any'}`;
    const roster = rosterMap.get(rosterKey);

    const existing = playerMap.get(row.player_id);
    const entry = existing ?? {
      player_id: row.player_id,
      player_name: playerData?.full_name || 'Unknown Player',
      avatar_url: resolvePlayerPhotoUrl(playerData),
      jersey_number: roster?.jersey_number != null ? String(roster.jersey_number) : null,
      team_id: row.team_id,
      team_name: teamData?.name || 'Unknown Team',
      division_name: getJoinedDivisionName(teamData?.divisions),
      position: roster?.position || null,
      is_goalie: Boolean(roster?.is_goalie),
      game_ids: new Set<string>(),
      goals: 0,
      assists: 0,
      penalty_minutes: 0,
      plus_minus: 0,
      power_play_goals: 0,
      power_play_assists: 0,
      short_handed_goals: 0,
      short_handed_assists: 0,
      game_winning_goals: 0,
      empty_net_goals: 0,
      shots: 0,
      best_team_games: 0,
      team_games: new Map<string, Set<string>>(),
    };

    if (row.game_id) {
      entry.game_ids.add(row.game_id);
    }
    entry.goals += row.goals || 0;
    entry.assists += row.assists || 0;
    entry.penalty_minutes += row.penalty_minutes || 0;
    entry.plus_minus += row.plus_minus || 0;
    entry.power_play_goals += row.power_play_goals || 0;
    entry.power_play_assists += row.power_play_assists || 0;
    entry.short_handed_goals += row.short_handed_goals || 0;
    entry.short_handed_assists += row.short_handed_assists || 0;
    entry.game_winning_goals += row.game_winning_goals || 0;
    entry.empty_net_goals += row.empty_net_goals || 0;
    entry.shots += row.shots || 0;

    const teamKey = `${row.team_id}:${row.season_id ?? 'any'}`;
    const teamGameIds = entry.team_games.get(teamKey) || new Set<string>();
    if (row.game_id) {
      teamGameIds.add(row.game_id);
    }
    entry.team_games.set(teamKey, teamGameIds);
    const teamGames = teamGameIds.size;
    if (teamGames > entry.best_team_games) {
      entry.best_team_games = teamGames;
      entry.team_id = row.team_id;
      entry.team_name = teamData?.name || 'Unknown Team';
      entry.division_name = getJoinedDivisionName(teamData?.divisions);
      entry.position = roster?.position || null;
      entry.is_goalie = Boolean(roster?.is_goalie);
      entry.jersey_number = roster?.jersey_number != null ? String(roster.jersey_number) : null;
    }

    if (!existing) {
      playerMap.set(row.player_id, entry);
    }
  }

  // Augment with rostered skaters who have zero stats (native seasons only)
  if (seasonId) {
    const rosterAugmentQuery = supabase
      .from('team_rosters')
      .select(`
        player_id,
        team_id,
        season_id,
        jersey_number,
        is_goalie,
        position,
        profiles:profiles!team_rosters_player_id_fkey(full_name, avatar_url, photo_url),
        teams:teams!team_rosters_team_id_fkey(name, divisions(name))
      `)
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .is('end_date', null);

    if (filteredTeamIds) {
      rosterAugmentQuery.in('team_id', filteredTeamIds);
    }

    const { data: allRoster } = await rosterAugmentQuery;
    if (allRoster) {
      for (const rawRow of allRoster as unknown as FallbackCurrentSeasonGoalieRosterRow[]) {
        if (!rawRow.player_id || !rawRow.team_id) continue;
        if (rawRow.is_goalie === true || isGoaliePosition(rawRow.position)) continue;
        if (playerMap.has(rawRow.player_id)) continue;

        const profileData = unwrapJoinedRecord(rawRow.profiles);
        const teamData = unwrapJoinedRecord(rawRow.teams);
        playerMap.set(rawRow.player_id, {
          player_id: rawRow.player_id,
          player_name: profileData?.full_name || 'Unknown Player',
          avatar_url: resolvePlayerPhotoUrl(profileData),
          jersey_number: rawRow.jersey_number != null ? String(rawRow.jersey_number) : null,
          team_id: rawRow.team_id,
          team_name: teamData?.name || 'Unknown Team',
          division_name: getJoinedDivisionName(teamData?.divisions),
          position: rawRow.position || null,
          is_goalie: false,
          game_ids: new Set<string>(),
          goals: 0,
          assists: 0,
          penalty_minutes: 0,
          plus_minus: 0,
          power_play_goals: 0,
          power_play_assists: 0,
          short_handed_goals: 0,
          short_handed_assists: 0,
          game_winning_goals: 0,
          empty_net_goals: 0,
          shots: 0,
          best_team_games: 0,
          team_games: new Map<string, Set<string>>(),
        });
      }
    }
  }

  for (const row of [...confirmedCheckins, ...fallbackRosterAppearances]) {
    const entry = playerMap.get(row.player_id);
    if (!entry) {
      continue;
    }

    entry.game_ids.add(row.game_id);
    const gameData = unwrapJoinedRecord(row.game);
    const teamKey = `${row.team_id}:${gameData?.season_id ?? 'any'}`;
    const teamGameIds = entry.team_games.get(teamKey) || new Set<string>();
    teamGameIds.add(row.game_id);
    entry.team_games.set(teamKey, teamGameIds);

    const teamGames = teamGameIds.size;
    if (teamGames > entry.best_team_games) {
      entry.best_team_games = teamGames;
      entry.team_id = row.team_id;
    }
  }

  return Array.from(playerMap.values())
    .filter((entry) => !entry.is_goalie && !isGoaliePosition(entry.position))
    .map((entry) => {
      const points = entry.goals + entry.assists;
      return applyImportedAggregateSkaterOverride(
        {
          player_id: entry.player_id,
          player_name: entry.player_name,
          avatar_url: entry.avatar_url,
          jersey_number: entry.jersey_number,
          team_id: entry.team_id,
          team_name: entry.team_name,
          division_name: entry.division_name,
          position: entry.position,
          championships: 0,
          games_played: entry.game_ids.size,
          goals: entry.goals,
          assists: entry.assists,
          points,
          points_per_game: entry.game_ids.size > 0 ? roundStatValue(points / entry.game_ids.size) : 0,
          goals_per_game: entry.game_ids.size > 0 ? roundStatValue(entry.goals / entry.game_ids.size) : 0,
          assists_per_game: entry.game_ids.size > 0 ? roundStatValue(entry.assists / entry.game_ids.size) : 0,
          penalty_minutes: entry.penalty_minutes,
          plus_minus: entry.plus_minus,
          power_play_goals: entry.power_play_goals,
          power_play_assists: entry.power_play_assists,
          power_play_points: entry.power_play_goals + entry.power_play_assists,
          short_handed_goals: entry.short_handed_goals,
          short_handed_assists: entry.short_handed_assists,
          game_winning_goals: entry.game_winning_goals,
          empty_net_goals: entry.empty_net_goals,
          shots: entry.shots,
          shots_per_game: entry.game_ids.size > 0 ? roundStatValue(entry.shots / entry.game_ids.size) : 0,
        },
        seasonId,
      );
    });
}

async function buildAllTimeSkaterRows(
  leagueId: string,
  divisionId?: string,
  leagueSlug?: string,
  options: CanonicalReadOptions = {},
): Promise<AllTimeSkaterRowsResult> {
  const [baselineRows, nativeRows, importedAggregateRows] = await Promise.all([
    getImportedCareerBaselineRows(leagueId, leagueSlug, options),
    getNativeUnifiedSkaterStatsRows(leagueId, undefined, divisionId, options),
    getImportedAggregateAllTimeSkaterRows(leagueId, divisionId, options),
  ]);
  const alignedBaselineRows = alignBaselineRowsToImportedAggregateProfiles(baselineRows, importedAggregateRows);

  const profileIdsByPlayerId = new Map<string, string | null>();
  const verifiedProfilePlayerIds = new Set<string>([...nativeRows, ...importedAggregateRows]
    .filter((row) => row.profile_id_league_verified !== false)
    .map((row) => row.player_id));
  for (const row of alignedBaselineRows) {
    profileIdsByPlayerId.set(row.player_id, row.profile_id);
    if (row.profile_id_league_verified) verifiedProfilePlayerIds.add(row.player_id);
  }

  return {
    rows: mergeAllTimeSkaterRows(alignedBaselineRows, [...nativeRows, ...importedAggregateRows]).map((row) => ({
      ...row,
      profile_id: profileIdsByPlayerId.has(row.player_id)
        ? profileIdsByPlayerId.get(row.player_id) ?? null
        : row.player_id,
      profile_id_league_verified: verifiedProfilePlayerIds.has(row.player_id),
    })),
    profileIdsByPlayerId,
  };
}

export async function getUnifiedSkaterStatsRows(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string,
  leagueSlug?: string,
  seasonName?: string | null,
  options: CanonicalReadOptions = {},
): Promise<UnifiedSkaterStatsRow[]> {
  let rows: UnifiedSkaterStatsRow[];

  if (seasonId === null) {
    const allTimeRows = await buildAllTimeSkaterRows(leagueId, divisionId, leagueSlug, options);
    rows = await appendNativeChampionshipCounts(leagueId, allTimeRows.rows, null, options);
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  if (seasonId && isImportedAggregateSeasonId(seasonId)) {
    rows = await appendNativeChampionshipCounts(
      leagueId,
      await buildImportedAggregateSkaterRows(leagueId, seasonId, divisionId, options),
      seasonId,
      options,
    );
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  if (isHistoricalCareerBaselineSeasonName(seasonName)) {
    const baselineRows = await getImportedCareerBaselineRows(leagueId, leagueSlug, options);
    rows = buildHistoricalBaselineSkaterRows(baselineRows);
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  rows = await appendNativeChampionshipCounts(
    leagueId,
    await getNativeUnifiedSkaterStatsRows(leagueId, seasonId, divisionId, options),
    seasonId,
    options,
  );
  return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
}

async function getNativeUnifiedGoalieStatsRows(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string,
  options: CanonicalReadOptions = {},
): Promise<UnifiedGoalieStatsRow[]> {
  const filteredTeamIds = await getFilteredTeamIds(leagueId, divisionId, options);
  if (divisionId && filteredTeamIds && filteredTeamIds.length === 0) {
    return [];
  }

  const supabase = seasonId == null ? createServiceRoleClient() : await createClient();
  const buildStatsQuery = () => {
    let query = supabase
      .from('goalie_stats')
      .select(`
        player_id,
        team_id,
        season_id,
        game_id,
        saves,
        shots_against,
        goals_against,
        shutout,
        game_result,
        game:games!inner(league_id, season_id, status, home_captain_verified, away_captain_verified, home_team_id, away_team_id, home_score, away_score),
        player:profiles!goalie_stats_player_id_fkey(full_name, avatar_url, photo_url),
        team:teams!goalie_stats_team_id_fkey(name, divisions(name))
      `)
      .eq('game.league_id', leagueId)
      .eq('game.status', 'completed');

    if (seasonId) {
      query = query.eq('game.season_id', seasonId);
    }

    if (filteredTeamIds) {
      query = query.in('team_id', filteredTeamIds);
    }

    return query;
  };

  const pageSize = 1000;
  const allStatsRows: unknown[] = [];
  let error: unknown = null;
  for (let offset = 0; ; offset += pageSize) {
    const { data: pageData, error: pageError } = await buildStatsQuery().range(offset, offset + pageSize - 1);
    if (pageError) {
      if (options.strict) throwCanonicalReadError(pageError, `goalie_stats page ${offset}`);
      error = pageError;
      break;
    }
    if (!pageData || pageData.length === 0) {
      break;
    }
    allStatsRows.push(...pageData);
    if (pageData.length < pageSize) {
      break;
    }
  }

  if (error) {
    return [];
  }

  const data = allStatsRows as RawGoalieStatsRow[];
  if (data.length === 0) {
    return seasonId
      ? buildFallbackCurrentSeasonGoalieRows(leagueId, seasonId, filteredTeamIds)
      : [];
  }

  const rows = data as unknown as RawGoalieStatsRow[];
  const hiddenSeasonIds =
    seasonId == null
      ? await getHistoricalCareerBaselineSeasonIdsForLeague(supabase, leagueId, rows.map((row) => row.season_id), options)
      : new Set<string>();
  const visibleRows = hiddenSeasonIds.size > 0
    ? rows.filter((row) => !hiddenSeasonIds.has(row.season_id ?? ''))
    : rows;

  if (visibleRows.length === 0) {
    return seasonId
      ? buildFallbackCurrentSeasonGoalieRows(leagueId, seasonId, filteredTeamIds)
      : [];
  }

  const playerIds = [...new Set(visibleRows.map((row) => row.player_id))];
  const teamIds = [...new Set(visibleRows.map((row) => row.team_id).filter(Boolean))];
  const seasonIds = [...new Set(visibleRows.map((row) => row.season_id).filter(Boolean))];

  const rosterRows = await readCanonicalBatchedRows<Pick<RosterDisplayRow, 'player_id' | 'team_id' | 'season_id' | 'jersey_number'>>(
    playerIds,
    'goalie_stats rosters',
    (batch) => {
      let query = supabase
        .from('team_rosters')
        .select('player_id, team_id, season_id, jersey_number')
        .in('player_id', batch)
        .in('team_id', teamIds);
      if (seasonIds.length > 0) query = query.in('season_id', seasonIds);
      return query;
    },
    options,
  );

  const aggregated = aggregateNativeGoalieStatsRows(
    visibleRows,
    rosterRows || [],
    seasonId,
  );

  // Augment with rostered goalies who have zero stats (native seasons only)
  if (seasonId) {
    const existingPlayerIds = new Set(aggregated.map((row) => row.player_id));

    const rosterAugmentQuery = supabase
      .from('team_rosters')
      .select(`
        player_id,
        team_id,
        season_id,
        jersey_number,
        is_goalie,
        position,
        profiles:profiles!team_rosters_player_id_fkey(full_name, avatar_url, photo_url),
        teams:teams!team_rosters_team_id_fkey(name, divisions(name))
      `)
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .is('end_date', null);

    if (filteredTeamIds) {
      rosterAugmentQuery.in('team_id', filteredTeamIds);
    }

    const { data: allRoster } = await rosterAugmentQuery;
    if (allRoster) {
      for (const rawRow of allRoster as unknown as FallbackCurrentSeasonGoalieRosterRow[]) {
        if (!rawRow.player_id || !rawRow.team_id) continue;
        if (rawRow.is_goalie !== true && !isGoaliePosition(rawRow.position)) continue;
        if (existingPlayerIds.has(rawRow.player_id)) continue;

        const profileData = unwrapJoinedRecord(rawRow.profiles);
        const teamData = unwrapJoinedRecord(rawRow.teams);
        aggregated.push({
          player_id: rawRow.player_id,
          player_name: profileData?.full_name || 'Unknown Goalie',
          avatar_url: resolvePlayerPhotoUrl(profileData),
          jersey_number: rawRow.jersey_number != null ? String(rawRow.jersey_number) : null,
          team_id: rawRow.team_id,
          team_name: teamData?.name || 'Unknown Team',
          division_name: getJoinedDivisionName(teamData?.divisions),
          position: 'Goalie',
          championships: 0,
          games_played: 0,
          wins: 0,
          losses: 0,
          saves: 0,
          goals_against: 0,
          save_percentage: null,
          goals_against_average: null,
          shutouts: 0,
        });
        existingPlayerIds.add(rawRow.player_id);
      }
    }
  }

  return aggregated;
}

async function buildAllTimeGoalieRows(
  leagueId: string,
  divisionId?: string,
  leagueSlug?: string,
  options: CanonicalReadOptions = {},
): Promise<AllTimeGoalieRowsResult> {
  const [baselineRows, nativeRows, importedAggregateRows] = await Promise.all([
    getImportedCareerBaselineRows(leagueId, leagueSlug, options),
    getNativeUnifiedGoalieStatsRows(leagueId, undefined, divisionId, options),
    getImportedAggregateAllTimeGoalieRows(leagueId, divisionId, options),
  ]);
  const alignedBaselineRows = alignBaselineRowsToImportedAggregateProfiles(baselineRows, importedAggregateRows);

  const profileIdsByPlayerId = new Map<string, string | null>();
  const verifiedProfilePlayerIds = new Set<string>([...nativeRows, ...importedAggregateRows]
    .filter((row) => row.profile_id_league_verified !== false)
    .map((row) => row.player_id));
  for (const row of alignedBaselineRows) {
    profileIdsByPlayerId.set(row.player_id, row.profile_id);
    if (row.profile_id_league_verified) verifiedProfilePlayerIds.add(row.player_id);
  }

  return {
    rows: mergeAllTimeGoalieRows(alignedBaselineRows, [...nativeRows, ...importedAggregateRows]).map(({ shots_against: _shotsAgainst, ...row }) => ({
      ...row,
      profile_id: profileIdsByPlayerId.has(row.player_id)
        ? profileIdsByPlayerId.get(row.player_id) ?? null
        : row.player_id,
      profile_id_league_verified: verifiedProfilePlayerIds.has(row.player_id),
    })),
    profileIdsByPlayerId,
  };
}

export async function getUnifiedGoalieStatsRows(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string,
  leagueSlug?: string,
  seasonName?: string | null,
  options: CanonicalReadOptions = {},
): Promise<UnifiedGoalieStatsRow[]> {
  let rows: UnifiedGoalieStatsRow[];

  if (seasonId === null) {
    const allTimeRows = await buildAllTimeGoalieRows(leagueId, divisionId, leagueSlug, options);
    rows = await appendNativeChampionshipCounts(leagueId, allTimeRows.rows, null, options);
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  if (seasonId && isImportedAggregateSeasonId(seasonId)) {
    rows = await appendNativeChampionshipCounts(
      leagueId,
      await buildImportedAggregateGoalieRows(leagueId, seasonId, divisionId, options),
      seasonId,
      options,
    );
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  if (isHistoricalCareerBaselineSeasonName(seasonName)) {
    const baselineRows = await getImportedCareerBaselineRows(leagueId, leagueSlug, options);
    rows = buildHistoricalBaselineGoalieRows(baselineRows);
    return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
  }

  rows = await appendNativeChampionshipCounts(
    leagueId,
    await getNativeUnifiedGoalieStatsRows(leagueId, seasonId, divisionId, options),
    seasonId,
    options,
  );
  return appendCurrentDisplayTeamMetadata(leagueId, rows, options);
}

/**
 * Fetch league stats summary
 */
export async function getLeagueStats(leagueId: string, seasonId?: string | null): Promise<LeagueStats> {
  const supabase = await createClient();

  let playerCount = 0;
  let teamCount = 0;

  if (seasonId) {
    const { data: seasonRosters } = await supabase
      .from('team_rosters')
      .select('team_id, player_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'active');

    if (seasonRosters && seasonRosters.length > 0) {
      playerCount = new Set(seasonRosters.map((row) => row.player_id).filter(Boolean)).size;
      teamCount = new Set(seasonRosters.map((row) => row.team_id).filter(Boolean)).size;
    }
  }

  if (teamCount === 0) {
    const { count } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', leagueId);
    teamCount = count || 0;
  }

  if (!seasonId) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId);

    if (teams && teams.length > 0) {
      const teamIds = teams.map((team) => team.id);
      const { count } = await supabase
        .from('team_rosters')
        .select('*', { count: 'exact', head: true })
        .in('team_id', teamIds);
      playerCount = count || 0;
    }
  }

  let totalGamesQuery = supabase
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId);

  let gamesPlayedQuery = supabase
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .in('status', ['completed']);

  let upcomingGamesQuery = supabase
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .in('status', ['scheduled', 'in_progress']);

  if (seasonId) {
    totalGamesQuery = totalGamesQuery.eq('season_id', seasonId);
    gamesPlayedQuery = gamesPlayedQuery.eq('season_id', seasonId);
    upcomingGamesQuery = upcomingGamesQuery.eq('season_id', seasonId);
  }

  const [
    { count: totalGames },
    { count: gamesPlayed },
    { count: upcomingGames },
  ] = await Promise.all([totalGamesQuery, gamesPlayedQuery, upcomingGamesQuery]);

  return {
    totalTeams: teamCount || 0,
    totalPlayers: playerCount,
    totalGames: totalGames || 0,
    gamesPlayed: gamesPlayed || 0,
    upcomingGames: upcomingGames || 0,
  };
}

/**
 * Fetch all active league slugs for static generation
 * Used by generateStaticParams
 */
export async function getAllLeagueSlugs(): Promise<string[]> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('leagues')
    .select('slug')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100); // Top 100 leagues for static generation

  if (error || !data) {
    return [];
  }

  return data.map((league: { slug: string }) => league.slug);
}

/**
 * Fetch all team slugs for a league (for static generation)
 * Uses service role client to avoid cookies() call during build
 */
export function getTeamSlugs(leagueId: string): Promise<string[]> {
  const supabase = createServiceRoleClient();

  return supabase
    .from('teams')
    .select('slug')
    .eq('league_id', leagueId)
    .then(({ data, error }: { data: { slug: string }[] | null; error: unknown }) => {
      if (error || !data) {
        return [];
      }
      return data.map((team) => team.slug);
    });
}

/**
 * Fetch game details for preview page
 */
export async function getGamePreview(gameId: string): Promise<GamePreview | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('games')
    .select(`
      *,
      home_team:teams!games_home_team_id_fkey(
        id, name, slug, logo_url, primary_color, secondary_color,
        division:divisions(id, name)
      ),
      away_team:teams!games_away_team_id_fkey(
        id, name, slug, logo_url, primary_color, secondary_color,
        division:divisions(id, name)
      )
    `)
    .eq('id', gameId)
    .single();

  if (error || !data) return null;

  // Transform team data to expected format
  const transformTeam = (team: any) => {
    if (!team) return null;
    const rawTeam = Array.isArray(team) ? team[0] : team;
    if (!rawTeam) return null;
    const colors = [rawTeam.primary_color, rawTeam.secondary_color].filter(Boolean).join(',') || null;
    return {
      id: rawTeam.id,
      name: rawTeam.name,
      slug: rawTeam.slug,
      logo: rawTeam.logo_url || null,
      colors,
      division: Array.isArray(rawTeam.division) ? rawTeam.division[0] : rawTeam.division,
    };
  };

  return {
    ...data,
    venue: (data as any).location || null,
    period: (data as any).current_period ?? data.period ?? null,
    period_time: formatLivePeriodTime(data as any),
    home_team: transformTeam(data.home_team),
    away_team: transformTeam(data.away_team),
  } as GamePreview;
}

/**
 * Fetch season series between two teams
 */
export async function getSeasonSeries(
  teamAId: string,
  teamBId: string,
  seasonId: string
): Promise<SeasonSeriesGame[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('games')
    .select(`
      id,
      scheduled_at,
      home_score,
      away_score,
      status,
      home_team_id,
      away_team_id
    `)
    .eq('season_id', seasonId)
    .in('status', ['completed'])
    .or(`and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`)
    .order('scheduled_at', { ascending: false });

  if (error || !data) return [];
  return data as SeasonSeriesGame[];
}

/**
 * Fetch future scheduled games between two teams
 */
export async function getFutureMatchups(
  teamAId: string,
  teamBId: string,
  seasonId: string
): Promise<SeasonSeriesGame[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('games')
    .select(`
      id,
      scheduled_at,
      home_score,
      away_score,
      status,
      home_team_id,
      away_team_id
    `)
    .eq('season_id', seasonId)
    .eq('status', 'scheduled')
    .or(`and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`)
    .order('scheduled_at', { ascending: true });

  if (error || !data) return [];
  return data as SeasonSeriesGame[];
}

/**
 * Fetch team season stats
 */
export async function getTeamSeasonStats(
  teamId: string,
  seasonId: string
): Promise<TeamSeasonStats | null> {
  const supabase = await createClient();

  // Try RPC first for calculated stats
  const { data, error } = await supabase.rpc('get_team_season_stats', {
    p_team_id: teamId,
    p_season_id: seasonId,
  });

  if (!error && data) return data as TeamSeasonStats;

  // Fallback: return null (stats not available)
  return null;
}

/**
 * Fetch player stat leaders for a team
 */
export async function getPlayerLeaders(
  teamId: string,
  seasonId: string,
  statType: 'points' | 'goals' | 'assists'
): Promise<PlayerStat[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_team_player_leaders', {
    p_team_id: teamId,
    p_season_id: seasonId,
    p_stat_type: statType,
    p_limit: 3,
  });

  if (!error && data) return data as PlayerStat[];
  return [];
}

/**
 * Fetch goalie stats for a specific team in a season
 * Queries goalie_stats table directly with team_id filter
 */
export async function getTeamGoalies(
  teamId: string,
  seasonId: string
): Promise<GoalieStats[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('goalie_stats')
    .select(`
      player_id,
      team_id,
      goals_against,
      saves,
      shutout,
      game_result,
      player:profiles!goalie_stats_player_id_fkey(full_name, avatar_url, photo_url, jersey_number)
    `)
    .eq('team_id', teamId)
    .eq('season_id', seasonId);

  if (error || !data) return [];

  // Aggregate per-game stats into season totals per goalie
  const goalieMap = new Map<string, {
    player_id: string;
    player_name: string;
    jersey_number: string | null;
    avatar_url: string | null;
    team_id: string;
    games_played: number;
    wins: number;
    losses: number;
    saves: number;
    goals_against: number;
    shutouts: number;
  }>();

  for (const row of data as any[]) {
    const pid = row.player_id;
    const existing = goalieMap.get(pid);

    const playerData = row.player || {};
    const isWin = row.game_result === 'W';
    const isShutout = row.shutout === true;

    if (existing) {
      existing.games_played += 1;
      existing.wins += isWin ? 1 : 0;
      existing.losses += row.game_result === 'L' ? 1 : 0;
      existing.saves += row.saves || 0;
      existing.goals_against += row.goals_against || 0;
      existing.shutouts += isShutout ? 1 : 0;
    } else {
      goalieMap.set(pid, {
        player_id: pid,
        player_name: playerData.full_name || 'Unknown',
        jersey_number: playerData.jersey_number?.toString() || null,
        avatar_url: playerData.avatar_url || null,
        team_id: teamId,
        games_played: 1,
        wins: isWin ? 1 : 0,
        losses: row.game_result === 'L' ? 1 : 0,
        saves: row.saves || 0,
        goals_against: row.goals_against || 0,
        shutouts: isShutout ? 1 : 0,
      });
    }
  }

  return Array.from(goalieMap.values())
    .map((g) => ({
      player_id: g.player_id,
      player_name: g.player_name,
      jersey_number: g.jersey_number,
      avatar_url: g.avatar_url,
      team_id: g.team_id,
      games_played: g.games_played,
      wins: g.wins,
      losses: g.losses,
      save_percentage: g.saves + g.goals_against > 0
        ? Math.round((g.saves / (g.saves + g.goals_against)) * 1000) / 10
        : 0,
      goals_against_average: g.games_played > 0
        ? Math.round((g.goals_against / g.games_played) * 100) / 100
        : 0,
      shutouts: g.shutouts,
      saves: g.saves,
      goals_against: g.goals_against,
    }))
    .sort((a, b) => b.games_played - a.games_played) as GoalieStats[];
}

/**
 * Fetch recent scores for the Scores page
 * Gets completed games from the last N days, grouped by date
 */
export async function getScores(
  leagueId: string,
  options?: {
    daysBack?: number;
    seasonId?: string;
    divisionId?: string;
    teamId?: string;
    status?: 'completed' | 'in_progress' | 'all';
  }
): Promise<RecentGame[]> {
  const supabase = await createClient();

  const daysBack = options?.daysBack || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  let query = supabase
    .from('games')
    .select(`
      *,
      division:divisions(id, name),
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name)),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division_id, divisions(id, name))
    `)
    .eq('league_id', leagueId)
    .gte('scheduled_at', cutoffDate.toISOString())
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: false });

  // Apply status filter
  if (options?.status === 'completed') {
    query = query.eq('status', 'completed');
  } else if (options?.status === 'in_progress') {
    query = query.eq('status', 'in_progress');
  } else if (options?.status === 'all') {
    query = query.in('status', ['completed', 'in_progress']);
  } else {
    // Default: show completed games
    query = query.eq('status', 'completed');
  }

  if (options?.seasonId) {
    query = query.eq('season_id', options.seasonId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Transform team data from DB columns to expected format
  const normalizedGames = data.map((game) => ({
    ...game,
    venue: (game as any).location || null,
    home_team: transformTeamData(game.home_team),
    away_team: transformTeamData(game.away_team),
  })) as RecentGame[];

  let result = normalizedGames;

  if (options?.divisionId) {
    result = result.filter((game) => matchesDivisionFilter(game, options.divisionId!));
  }

  if (options?.teamId) {
    result = result.filter((game) => game.home_team_id === options.teamId || game.away_team_id === options.teamId);
  }

  if (result !== normalizedGames) {
    return result;
  }

  return normalizedGames;
}

/**
 * Fetch venue objects from the venues table (includes full address data)
 */
export async function getVenueObjects(leagueId: string): Promise<{
  name: string;
  address: string | null;
  city: string | null;
  state_province: string | null;
  country: string | null;
  postal_code: string | null;
}[]> {
  // venues table requires service role — anon RLS policy may not be applied
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('venues')
    .select('name, address, city, state_province, country, postal_code')
    .eq('league_id', leagueId)
    .order('name', { ascending: true });

  if (error || !data) return [];
  return data as any[];
}

/**
 * Fetch venues for a league (for venue filter)
 */
export async function getVenues(leagueId: string): Promise<string[]> {
  const venueObjects = await getVenueObjects(leagueId);
  return venueObjects
    .map((venue) => venue.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch player profile for player detail page
 */
export async function getPlayerProfile(playerId: string): Promise<Player | null> {
  const supabase = await createClient();

  const selectQuery = `
      *,
      profile:profiles(id, full_name, avatar_url, photo_url),
      team:teams(id, name, slug, logo_url, primary_color, secondary_color, league_id)
    `;

  // First try by team_rosters.id (from player grid links)
  // eslint-disable-next-line prefer-const -- data is reassigned below, must use let for destructuring
  let { data, error } = await supabase
    .from('team_rosters')
    .select(selectQuery)
    .eq('id', playerId)
    .single();

  // Fallback: try by player_id/profile ID (from stats links)
  if (error || !data) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('team_rosters')
      .select(selectQuery)
      .eq('player_id', playerId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .single();

    if (fallbackError || !fallbackData) {
      return null;
    }
    data = fallbackData;
  }

  // Transform the data to map logo_url to logo and colors
  const rawTeam = Array.isArray(data.team) ? data.team[0] : data.team;
  const transformedData = {
    ...data,
    profile: Array.isArray(data.profile) ? data.profile[0] : data.profile,
    team: rawTeam ? {
      ...rawTeam,
      logo: rawTeam.logo_url || null,
      colors: rawTeam.primary_color && rawTeam.secondary_color
        ? `${rawTeam.primary_color},${rawTeam.secondary_color}`
        : rawTeam.primary_color || null,
    } : null,
  };

  return transformedData as Player;
}

/**
 * Fetch player career stats
 * Uses player_stats table which has per-game stats with proper columns
 */
type PlayerCareerTotalsRow = {
  game_id?: string | null;
  goals: number | null;
  assists: number | null;
  penalty_minutes?: number | null;
};

export function summarizePlayerCareerTotals(
  playerId: string,
  rows: PlayerCareerTotalsRow[],
  seasonSummary?: {
    games_played?: number | null;
    goals?: number | null;
    assists?: number | null;
    points?: number | null;
    team_name?: string | null;
    position?: string | null;
    wins?: number | null;
    losses?: number | null;
    ties?: number | null;
    saves?: number | null;
    goals_against?: number | null;
    save_percentage?: number | null;
    goals_against_average?: number | null;
    shutouts?: number | null;
  } | null,
): PlayerStats | null {
  if ((!rows || rows.length === 0) && !seasonSummary) {
    return null;
  }

  const totals = (rows || []).reduce<{ goals: number; assists: number; penalty_minutes: number }>(
    (acc, stat) => ({
      goals: acc.goals + (stat.goals || 0),
      assists: acc.assists + (stat.assists || 0),
      penalty_minutes: acc.penalty_minutes + (stat.penalty_minutes || 0),
    }),
    { goals: 0, assists: 0, penalty_minutes: 0 },
  );

  const goals = seasonSummary?.goals ?? totals.goals;
  const assists = seasonSummary?.assists ?? totals.assists;
  const points = seasonSummary?.points ?? (goals + assists);
  const distinctGameCount = new Set(rows.map((row) => row.game_id).filter(Boolean)).size;
  const gamesPlayed = seasonSummary?.games_played ?? (distinctGameCount || rows.length);

  return {
    player_id: playerId,
    player_name: '',
    team_name: seasonSummary?.team_name || '',
    team_id: '',
    position: seasonSummary?.position || null,
    games_played: gamesPlayed,
    goals,
    assists,
    points,
    penalty_minutes: totals.penalty_minutes,
    plus_minus: 0,
    wins: seasonSummary?.wins ?? undefined,
    losses: seasonSummary?.losses ?? undefined,
    ties: seasonSummary?.ties ?? undefined,
    saves: seasonSummary?.saves ?? undefined,
    goals_against: seasonSummary?.goals_against ?? undefined,
    save_percentage: seasonSummary?.save_percentage ?? undefined,
    goals_against_average: seasonSummary?.goals_against_average ?? undefined,
    shutouts: seasonSummary?.shutouts ?? undefined,
  } as PlayerStats;
}

export function summarizePlayerCareerTotalsFromTimeline(
  playerId: string,
  rows: PlayerCareerSeasonRow[],
  isGoalie = false,
): PlayerStats | null {
  if (!rows || rows.length === 0) {
    return null;
  }

  const totals = rows.reduce(
    (acc, row) => ({
      games_played: acc.games_played + (row.games_played || 0),
      goals: acc.goals + (row.goals || 0),
      assists: acc.assists + (row.assists || 0),
      points: acc.points + (row.points || 0),
      wins: acc.wins + (row.wins || 0),
      losses: acc.losses + (row.losses || 0),
      ties: acc.ties + (row.ties || 0),
      saves: acc.saves + (row.saves || 0),
      goals_against: acc.goals_against + (row.goals_against || 0),
      shutouts: acc.shutouts + (row.shutouts || 0),
    }),
    {
      games_played: 0,
      goals: 0,
      assists: 0,
      points: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      saves: 0,
      goals_against: 0,
      shutouts: 0,
    },
  );
  const latest = rows[rows.length - 1];
  const shotsAgainst = totals.saves + totals.goals_against;

  return {
    player_id: playerId,
    player_name: '',
    team_name: latest?.team_name || 'Career',
    team_id: latest?.team_id || '',
    position: latest?.position || null,
    games_played: totals.games_played,
    goals: totals.goals,
    assists: totals.assists,
    points: totals.points,
    penalty_minutes: 0,
    plus_minus: 0,
    ...(isGoalie
      ? {
          wins: totals.wins,
          losses: totals.losses,
          ties: totals.ties,
          saves: totals.saves,
          goals_against: totals.goals_against,
          shutouts: totals.shutouts,
          save_percentage: shotsAgainst > 0 ? roundStatValue(totals.saves / shotsAgainst, 3) : 0,
          goals_against_average: totals.games_played > 0 ? roundStatValue(totals.goals_against / totals.games_played) : 0,
        }
      : {}),
  } as PlayerStats;
}

function emojiForHotFact(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes('milestone') || normalized.includes('pace') || normalized.includes('tracking')) return '🔥';
  if (normalized.includes('league') || normalized.includes('team')) return '👀';
  if (normalized.includes('bounce') || normalized.includes('jump') || normalized.includes('surge')) return '📈';
  if (normalized.includes('wall') || normalized.includes('save') || normalized.includes('shutout')) return '🧱';
  return '🌶️';
}

function buildDeterministicPlayerCareerHotFact(input: {
  playerName: string;
  seasons: PlayerCareerSeasonRow[];
  careerTotalsSeasons?: PlayerCareerSeasonRow[];
  isGoalie: boolean;
}) {
  const { playerName, seasons, careerTotalsSeasons, isGoalie } = input;
  const totalsSource = careerTotalsSeasons && careerTotalsSeasons.length > 0 ? careerTotalsSeasons : seasons;

  if (totalsSource.length === 0) {
    return `🌶️ ${playerName} is still waiting for the stat sheet to catch up.`;
  }

  const latest = seasons[seasons.length - 1] ?? totalsSource[totalsSource.length - 1];
  const previous = seasons.length > 1 ? seasons[seasons.length - 2] : null;

  if (isGoalie) {
    const careerWins = totalsSource.reduce((sum, season) => sum + season.wins, 0);
    const careerSaves = totalsSource.reduce((sum, season) => sum + season.saves, 0);

    if (careerWins > 0 && careerWins % 5 === 0) {
      return `🔥 ${playerName} just hit ${careerWins} career wins, which is a pretty loud way to keep the crease.`;
    }

    if (previous && latest.save_percentage != null && previous.save_percentage != null) {
      const swing = roundCareerMetric(latest.save_percentage - previous.save_percentage, 1);
      if (Math.abs(swing) >= 2) {
        return swing > 0
          ? `📈 ${playerName} bumped the save rate by ${swing} points from ${previous.season_name} to ${latest.season_name}, and shooters definitely noticed.`
          : `🥶 ${playerName}'s save rate slipped ${Math.abs(swing)} points from ${previous.season_name} to ${latest.season_name}, so next season has a revenge arc baked in.`;
      }
    }

    if (careerSaves >= 100 && careerSaves % 100 <= 15) {
      return `🧱 ${playerName} is sitting on ${careerSaves} career saves, basically one busy night away from another round number.`;
    }

    if (latest.shutouts > 0) {
      return `👀 ${playerName} posted ${latest.shutouts} shutout${latest.shutouts === 1 ? '' : 's'} in ${latest.season_name}, which is a rude amount of silence for shooters.`;
    }

    return `🌶️ ${playerName} has stacked ${careerWins} wins and ${careerSaves} saves so far, which is a decent way to make life miserable in net.`;
  }

  const careerPoints = totalsSource.reduce((sum, season) => sum + season.points, 0);
  const careerGoals = totalsSource.reduce((sum, season) => sum + season.goals, 0);

  if (careerPoints >= 10 && careerPoints % 25 <= 3) {
    return `🔥 ${playerName} is already at ${careerPoints} career points, and the next milestone is basically on the doorstep.`;
  }

  if (previous) {
    const pointJump = latest.points - previous.points;
    if (Math.abs(pointJump) >= 5) {
      return pointJump > 0
        ? `📈 ${playerName} popped for ${pointJump} more points in ${latest.season_name} than ${previous.season_name}, which is not exactly subtle.`
        : `🌶️ ${playerName} cooled off by ${Math.abs(pointJump)} points in ${latest.season_name}, so the bounce-back watch is officially on.`;
    }

    const attendanceSwing = roundCareerMetric(latest.attendance_pct - previous.attendance_pct, 1);
    if (Math.abs(attendanceSwing) >= 15) {
      return attendanceSwing > 0
        ? `👏 ${playerName} showed up way more in ${latest.season_name}, with attendance up ${attendanceSwing} points from the year before.`
        : `👀 ${playerName}'s attendance dipped ${Math.abs(attendanceSwing)} points in ${latest.season_name}, which definitely hit the box score rhythm.`;
    }
  }

  if (careerGoals >= 10 && careerGoals % 10 <= 2) {
    return `🥅 ${playerName} has ${careerGoals} career goals and is sniffing another clean milestone already.`;
  }

  const seasonCount = seasons.length > 0 ? seasons.length : totalsSource.length;
  return `🌶️ ${playerName} has piled up ${careerPoints} points in ${seasonCount} season${seasonCount === 1 ? '' : 's'}, which travels pretty well.`;
}

export async function generatePlayerCareerHotFacts(input: {
  playerName: string;
  seasons: PlayerCareerSeasonRow[];
  careerTotalsSeasons?: PlayerCareerSeasonRow[];
  isGoalie: boolean;
}): Promise<string[]> {
  const { playerName, seasons, careerTotalsSeasons, isGoalie } = input;
  const ordered = [...seasons].sort((left, right) => {
    const leftTime = left.sort_date ? new Date(left.sort_date).getTime() : 0;
    const rightTime = right.sort_date ? new Date(right.sort_date).getTime() : 0;
    return leftTime - rightTime;
  });

  const orderedTotals = [...(careerTotalsSeasons && careerTotalsSeasons.length > 0 ? careerTotalsSeasons : seasons)].sort(
    (left, right) => {
      const leftTime = left.sort_date ? new Date(left.sort_date).getTime() : 0;
      const rightTime = right.sort_date ? new Date(right.sort_date).getTime() : 0;
      return leftTime - rightTime;
    },
  );

  if (ordered.length === 0 && orderedTotals.length === 0) {
    return [];
  }

  const comparisonSeasons = ordered.length > 0 ? ordered : orderedTotals;
  const totalsSource = orderedTotals.length > 0 ? orderedTotals : comparisonSeasons;

  const facts: string[] = [];
  const pushFact = (fact?: string | null) => {
    const trimmed = fact?.trim();
    if (!trimmed || facts.includes(trimmed) || facts.length >= 5) return;
    facts.push(trimmed);
  };

  pushFact(buildDeterministicPlayerCareerHotFact({
    playerName,
    seasons: comparisonSeasons,
    careerTotalsSeasons: totalsSource,
    isGoalie,
  }));

  const latest = comparisonSeasons[comparisonSeasons.length - 1];
  const previous = comparisonSeasons.length > 1 ? comparisonSeasons[comparisonSeasons.length - 2] : null;

  if (isGoalie) {
    const careerWins = totalsSource.reduce((sum, season) => sum + season.wins, 0);
    const careerShutouts = totalsSource.reduce((sum, season) => sum + season.shutouts, 0);

    if (latest.wins >= 10) {
      pushFact(`🥅 ${playerName} stacked ${latest.wins} wins in ${latest.season_name}, which is starter behavior all the way down.`);
    }
    if (latest.save_percentage != null && latest.save_percentage >= 90) {
      pushFact(`🧱 ${playerName} posted a ${roundCareerMetric(latest.save_percentage, 1)}% save rate in ${latest.season_name}, and shooters probably still hate it.`);
    }
    if (previous) {
      const winJump = latest.wins - previous.wins;
      if (Math.abs(winJump) >= 3) {
        pushFact(
          winJump > 0
            ? `📈 ${playerName} banked ${winJump} more wins in ${latest.season_name} than ${previous.season_name}, which is a real year-over-year jump.`
            : `👀 ${playerName} came back to earth by ${Math.abs(winJump)} wins in ${latest.season_name}, so the rebound story is right there.`
        );
      }
    }
    if (careerWins >= 10) {
      pushFact(`🏁 ${playerName} is up to ${careerWins} career wins, and the next round-number checkpoint is already in the windshield.`);
    }
    if (careerShutouts > 0) {
      pushFact(`🚫 ${playerName} has ${careerShutouts} career shutout${careerShutouts === 1 ? '' : 's'}, which always plays.`);
    }
  } else {
    const careerGoals = totalsSource.reduce((sum, season) => sum + season.goals, 0);
    const careerAssists = totalsSource.reduce((sum, season) => sum + season.assists, 0);
    const careerPoints = totalsSource.reduce((sum, season) => sum + season.points, 0);

    if (latest.points >= 20) {
      pushFact(`🔥 ${playerName} put up ${latest.points} points in ${latest.season_name}, which is the kind of season that travels in every rink.`);
    }
    if (latest.goals >= 10) {
      pushFact(`🥅 ${playerName} buried ${latest.goals} goals in ${latest.season_name}, so goalies definitely knew the scouting report.`);
    }
    if (previous) {
      const pointJump = latest.points - previous.points;
      if (Math.abs(pointJump) >= 5) {
        pushFact(
          pointJump > 0
            ? `📈 ${playerName} popped for ${pointJump} more points in ${latest.season_name} than ${previous.season_name}, not exactly a quiet leap.`
            : `🌶️ ${playerName} dropped ${Math.abs(pointJump)} points from ${previous.season_name} to ${latest.season_name}, so the bounce-back angle writes itself.`
        );
      }

      const attendanceSwing = roundCareerMetric(latest.attendance_pct - previous.attendance_pct, 1);
      if (Math.abs(attendanceSwing) >= 15) {
        pushFact(
          attendanceSwing > 0
            ? `👏 ${playerName} showed up way more in ${latest.season_name}, with attendance up ${attendanceSwing} points from the year before.`
            : `🗓️ ${playerName}'s attendance slid ${Math.abs(attendanceSwing)} points in ${latest.season_name}, and that changes the rhythm in a hurry.`
        );
      }
    }
    if (careerPoints >= 25) {
      pushFact(`🏒 ${playerName} is sitting on ${careerPoints} career points, with ${careerGoals} goals and ${careerAssists} assists baked into the tab.`);
    }
    if (careerGoals >= 10 && careerGoals % 10 <= 2) {
      pushFact(`🎯 ${playerName} has ${careerGoals} career goals and is hovering right around another clean milestone.`);
    }
  }

  return facts.slice(0, 5);
}

async function loadTeamNameMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamIds: Array<string | null | undefined>,
) {
  const ids = [...new Set(teamIds.filter((teamId): teamId is string => Boolean(teamId)))];
  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const { data } = await supabase.from('teams').select('id, name').in('id', ids);
  return new Map((data || []).map((team) => [team.id, team.name]));
}

async function loadTeamGameCountsBySeasonTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  seasonIds: string[],
  teamIds: Array<string | null | undefined>,
) {
  const normalizedTeamIds = [...new Set(teamIds.filter((teamId): teamId is string => Boolean(teamId)))];
  if (seasonIds.length === 0 || normalizedTeamIds.length === 0) {
    return new Map<string, number>();
  }

  const { data } = await supabase
    .from('games')
    .select('id, season_id, home_team_id, away_team_id')
    .eq('league_id', leagueId)
    .in('season_id', seasonIds)
    .in('status', [...PLAYED_GAME_STATUSES])
    .or(`home_team_id.in.(${normalizedTeamIds.join(',')}),away_team_id.in.(${normalizedTeamIds.join(',')})`);

  const counts = new Map<string, Set<string>>();
  for (const game of data || []) {
    const season = game.season_id;
    if (!season || !game.id) continue;
    for (const teamId of [game.home_team_id, game.away_team_id]) {
      if (!teamId || !normalizedTeamIds.includes(teamId)) continue;
      const key = `${season}:${teamId}`;
      const games = counts.get(key) || new Set<string>();
      games.add(game.id);
      counts.set(key, games);
    }
  }

  return new Map([...counts.entries()].map(([key, games]) => [key, games.size]));
}

export async function getTeamsDirectoryBumpChartData(
  leagueId: string,
  seasonId: string | null,
  teams: Team[],
): Promise<TeamsDirectoryBumpChartData | null> {
  if (!seasonId || teams.length === 0) {
    return null;
  }

  const supabase = await createClient();
  const standings = await getStandings(leagueId, seasonId);
  const publicTeamIds = new Set(teams.map((team) => team.id));
  const chartStandings = standings.filter((standing) => publicTeamIds.has(standing.team_id));
  const teamIds = teams.map((team) => team.id);

  const [confirmedAppearances, fallbackAppearances, teamGameCounts, rosterRows, gamesResult, scoringDepthResult] = await Promise.all([
    getConfirmedCheckinAppearanceRows(supabase, { leagueId, seasonId, teamIds }),
    getFallbackRosterAppearanceRows(supabase, { seasonId, teamIds }),
    loadTeamGameCountsBySeasonTeam(supabase, leagueId, [seasonId], teamIds),
    supabase
      .from('team_rosters')
      .select('team_id, player_id, joined_at, end_date, player_type')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .in('team_id', teamIds),
    supabase
      .from('games')
      .select('id, season_id, scheduled_at, home_team_id, away_team_id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .in('status', [...PLAYED_GAME_STATUSES])
      .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`),
    supabase
      .from('player_stats')
      .select('team_id, player_id, goals')
      .eq('season_id', seasonId)
      .in('team_id', teamIds),
  ]);

  const regularRosterRows = (rosterRows.data || []).filter((row) => row.team_id && row.player_id && row.player_type === 'regular');
  const rosterByTeam = new Map<string, Array<typeof regularRosterRows[number]>>();
  for (const row of regularRosterRows) {
    const rows = rosterByTeam.get(row.team_id) || [];
    rows.push(row);
    rosterByTeam.set(row.team_id, rows);
  }

  type TeamDirectoryGameRow = {
    id: string;
    season_id: string | null;
    scheduled_at: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
  };

  const gameRows = (gamesResult.data || []) as TeamDirectoryGameRow[];
  const gamesById = new Map(gameRows.filter((game) => game.id).map((game) => [game.id, game]));
  const teamGameRows = new Map<string, TeamDirectoryGameRow[]>();
  for (const game of gameRows) {
    for (const teamId of [game.home_team_id, game.away_team_id]) {
      if (!teamId || !teamIds.includes(teamId)) continue;
      const rows = teamGameRows.get(teamId) || [];
      rows.push(game);
      teamGameRows.set(teamId, rows);
    }
  }

  const isRosterEntryEligibleForGame = (
    rosterEntry: { player_id: string; joined_at: string | null; end_date: string | null },
    gameDate: string | null | undefined,
  ) => {
    if (!gameDate) return true;
    const gameTime = new Date(gameDate).getTime();
    if (Number.isNaN(gameTime)) return true;
    if (rosterEntry.joined_at && gameTime < new Date(rosterEntry.joined_at).getTime()) {
      return false;
    }
    if (rosterEntry.end_date && gameTime > new Date(rosterEntry.end_date).getTime()) {
      return false;
    }
    return true;
  };

  const possibleAppearancesByTeam = new Map<string, number>();
  for (const teamId of teamIds) {
    const rows = rosterByTeam.get(teamId) || [];
    const games = teamGameRows.get(teamId) || [];
    let possibleAppearances = 0;
    for (const rosterEntry of rows) {
      for (const game of games) {
        if (isRosterEntryEligibleForGame(rosterEntry, game.scheduled_at)) {
          possibleAppearances += 1;
        }
      }
    }
    possibleAppearancesByTeam.set(teamId, possibleAppearances);
  }

  const confirmedCounts = new Map<string, Set<string>>();
  for (const row of confirmedAppearances) {
    if (!row.team_id || !row.player_id || !row.game_id) continue;
    const rosterEntries = rosterByTeam.get(row.team_id) || [];
    const rosterEntry = rosterEntries.find((entry) => entry.player_id === row.player_id);
    const game = gamesById.get(row.game_id);
    if (!rosterEntry || !isRosterEntryEligibleForGame(rosterEntry, game?.scheduled_at)) continue;
    const keys = confirmedCounts.get(row.team_id) || new Set<string>();
    keys.add(`${row.player_id}:${row.game_id}`);
    confirmedCounts.set(row.team_id, keys);
  }

  const fallbackCounts = new Map<string, Set<string>>();
  for (const row of fallbackAppearances) {
    if (!row.team_id || !row.player_id || !row.game_id) continue;
    const rosterEntries = rosterByTeam.get(row.team_id) || [];
    const rosterEntry = rosterEntries.find((entry) => entry.player_id === row.player_id);
    const game = gamesById.get(row.game_id);
    if (!rosterEntry || !isRosterEntryEligibleForGame(rosterEntry, game?.scheduled_at)) continue;
    const keys = fallbackCounts.get(row.team_id) || new Set<string>();
    keys.add(`${row.player_id}:${row.game_id}`);
    fallbackCounts.set(row.team_id, keys);
  }

  const commitment: TeamCommitmentSnapshot[] = teamIds.map((teamId) => {
    const confirmed = confirmedCounts.get(teamId)?.size || 0;
    const fallback = fallbackCounts.get(teamId)?.size || 0;
    const possibleAppearances = possibleAppearancesByTeam.get(teamId) || 0;
    const appearances = confirmed + fallback;
    const attendancePct = possibleAppearances > 0 ? roundCareerMetric((appearances / possibleAppearances) * 100, 1) : 0;

    return {
      teamId,
      attendancePct,
      appearances,
      possibleAppearances,
      confirmedAppearances: confirmed,
      fallbackAppearances: fallback,
      gamesPlayed: teamGameCounts.get(`${seasonId}:${teamId}`) || 0,
    };
  });

  const goalsByTeamPlayer = new Map<string, number>();
  for (const row of scoringDepthResult.data || []) {
    const teamId = row.team_id;
    const playerId = row.player_id;
    if (!teamId || !playerId) continue;
    const key = `${teamId}:${playerId}`;
    goalsByTeamPlayer.set(key, (goalsByTeamPlayer.get(key) || 0) + (Number(row.goals) || 0));
  }

  const scoringDepth: TeamScoringDepthSnapshot[] = teamIds.map((teamId) => {
    const standing = chartStandings.find((entry) => entry.team_id === teamId);
    const totalGoals = Math.max(0, standing?.goals_for || 0);
    const playerGoalTotals = [...goalsByTeamPlayer.entries()]
      .filter(([key]) => key.startsWith(`${teamId}:`))
      .map(([, goals]) => goals)
      .sort((left, right) => right - left);
    const topThreeGoals = playerGoalTotals.slice(0, 3).reduce((sum, goals) => sum + goals, 0);
    const remainingGoals = Math.max(0, totalGoals - topThreeGoals);

    return {
      teamId,
      remainingGoals,
      totalGoals,
      topThreeGoals,
    };
  });

  return buildTeamsDirectoryBumpChartData({
    seasonId,
    teams,
    standings: chartStandings,
    commitment,
    scoringDepth,
  });
}

export async function getPlayerCareerStatsTimeline(
  leagueId: string,
  playerId: string,
  isGoalie: boolean,
  options: {
    includeHistoricalBaseline?: boolean;
  } = {},
): Promise<PlayerCareerSeasonRow[]> {
  const { includeHistoricalBaseline = false } = options;
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const { data: seasonRecords } = await supabase
    .from('seasons')
    .select('id, name, start_date')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false });
  const seasons = (seasonRecords || []) as Array<{ id: string; name: string; start_date: string | null }>;
  const seasonNameById = new Map(seasons.map((season) => [season.id, season.name]));
  const seasonSortById = new Map(seasons.map((season) => [season.id, season.start_date ?? null]));
  const historicalBaselineSeason = seasons.find((season) => isHistoricalCareerBaselineSeasonName(season.name));

  if (isGoalie) {
    const { data: rawRows, error } = await supabase
      .from('goalie_stats')
      .select('season_id, team_id, saves, goals_against, game_result, shutout')
      .eq('player_id', playerId);

    if (error) {
      return [];
    }

    const rows = (rawRows || []) as Array<{
      season_id: string | null;
      team_id: string | null;
      saves: number | null;
      goals_against: number | null;
      game_result: string | null;
      shutout: boolean | null;
    }>;

    const activeSeasonIds = [...new Set(rows.map((row) => row.season_id).filter((seasonId): seasonId is string => Boolean(seasonId)))];
    const [confirmedBuckets, fallbackBuckets] = await Promise.all([
      Promise.all(activeSeasonIds.map((seasonId) => getConfirmedCheckinAppearanceRows(supabase, { seasonId, playerIds: [playerId] }))),
      Promise.all(activeSeasonIds.map((seasonId) => getFallbackRosterAppearanceRows(supabase, { seasonId, playerIds: [playerId] }))),
    ]);
    const confirmedCheckins = confirmedBuckets.flat();
    const fallbackAppearances = fallbackBuckets.flat();

    const teamNames = await loadTeamNameMap(supabase, rows.map((row) => row.team_id));
    const teamGameCountBySeasonTeam = await loadTeamGameCountsBySeasonTeam(supabase, leagueId, activeSeasonIds, [
      ...rows.map((row) => row.team_id),
      ...confirmedCheckins.map((row) => row.team_id),
      ...fallbackAppearances.map((row) => row.team_id),
    ]);

    const appearancesBySeasonTeam = new Map<string, Set<string>>();
    for (const row of [...confirmedCheckins, ...fallbackAppearances]) {
      const game = Array.isArray(row.game) ? row.game[0] : row.game;
      if (!row.game_id || !row.team_id || !game?.season_id) continue;
      const key = `${game.season_id}:${row.team_id}`;
      const games = appearancesBySeasonTeam.get(key) || new Set<string>();
      games.add(row.game_id);
      appearancesBySeasonTeam.set(key, games);
    }

    const seasonMap = new Map<string, PlayerCareerSeasonRow>();
    for (const row of rows) {
      if (!row.season_id) continue;
      const key = `${row.season_id}:${row.team_id || 'unknown'}`;
      const existing = seasonMap.get(key) || {
        season_id: row.season_id,
        season_name: seasonNameById.get(row.season_id) || 'Unknown Season',
        sort_date: seasonSortById.get(row.season_id) || null,
        team_id: row.team_id,
        team_name: row.team_id ? (teamNames.get(row.team_id) || null) : null,
        position: 'Goalie',
        games_played: 0,
        team_games: 0,
        attendance_pct: 0,
        goals: 0,
        assists: 0,
        points: 0,
        goals_per_game: 0,
        points_per_game: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        saves: 0,
        goals_against: 0,
        save_percentage: null,
        goals_against_average: null,
        shutouts: 0,
      };

      existing.games_played += 1;
      existing.saves += row.saves || 0;
      existing.goals_against += row.goals_against || 0;
      existing.shutouts += row.shutout ? 1 : 0;
      if (row.game_result === 'W') existing.wins += 1;
      else if (row.game_result === 'L') existing.losses += 1;
      else if (row.game_result === 'T') existing.ties += 1;
      seasonMap.set(key, existing);
    }

    if (historicalBaselineSeason) {
      const { data: baselineStats } = await serviceSupabase
        .from('player_career_baselines')
        .select('games_played, wins, losses, ties, saves, goals_against, shutouts, save_percentage, goals_against_average')
        .eq('player_id', playerId)
        .maybeSingle();

      if (baselineStats) {
        const baselineGames = Number(baselineStats.games_played || 0);
        const baselineSaves = Number(baselineStats.saves || 0);
        const baselineGoalsAgainst = Number(baselineStats.goals_against || 0);
        const shotsAgainst = baselineSaves + baselineGoalsAgainst;

        seasonMap.set(`${historicalBaselineSeason.id}:baseline`, {
          season_id: historicalBaselineSeason.id,
          season_name: historicalBaselineSeason.name,
          sort_date: historicalBaselineSeason.start_date ?? null,
          team_id: null,
          team_name: null,
          position: 'Goalie',
          games_played: baselineGames,
          team_games: baselineGames,
          attendance_pct: baselineGames > 0 ? 100 : 0,
          goals: 0,
          assists: 0,
          points: 0,
          goals_per_game: 0,
          points_per_game: 0,
          wins: Number(baselineStats.wins || 0),
          losses: Number(baselineStats.losses || 0),
          ties: Number(baselineStats.ties || 0),
          saves: baselineSaves,
          goals_against: baselineGoalsAgainst,
          save_percentage: baselineStats.save_percentage != null
            ? roundCareerMetric(Number(baselineStats.save_percentage), 1)
            : shotsAgainst > 0
              ? roundCareerMetric((baselineSaves / shotsAgainst) * 100, 1)
              : null,
          goals_against_average: baselineStats.goals_against_average != null
            ? roundCareerMetric(Number(baselineStats.goals_against_average), 2)
            : baselineGames > 0
              ? roundCareerMetric(baselineGoalsAgainst / baselineGames, 2)
              : null,
          shutouts: Number(baselineStats.shutouts || 0),
        });
      }
    }

    return [...seasonMap.values()]
      .filter((season) => includeHistoricalBaseline || season.season_id !== historicalBaselineSeason?.id)
      .map((season) => {
        const key = `${season.season_id}:${season.team_id || 'unknown'}`;
        const appearanceGames = appearancesBySeasonTeam.get(key)?.size || 0;
        const gamesPlayed = Math.max(season.games_played, appearanceGames);
        const teamGames = season.team_id ? (teamGameCountBySeasonTeam.get(key) || gamesPlayed) : gamesPlayed;
        const shotsAgainst = season.saves + season.goals_against;
        return {
          ...season,
          games_played: gamesPlayed,
          team_games: teamGames,
          attendance_pct: teamGames > 0 ? roundCareerMetric((gamesPlayed / teamGames) * 100, 1) : 0,
          save_percentage: shotsAgainst > 0 ? roundCareerMetric((season.saves / shotsAgainst) * 100, 1) : null,
          goals_against_average: gamesPlayed > 0 ? roundCareerMetric(season.goals_against / gamesPlayed, 2) : null,
        };
      })
      .sort((left, right) => new Date(left.sort_date || 0).getTime() - new Date(right.sort_date || 0).getTime());
  }

  const { data: seasonRows, error } = await supabase
    .from('player_season_stats')
    .select('season_id, team_id, team_name, position, games_played, goals, assists, points')
    .eq('player_id', playerId);

  if (error) {
    return [];
  }

  const rows = (seasonRows || []) as Array<{
    season_id: string | null;
    team_id: string | null;
    team_name: string | null;
    position: string | null;
    games_played: number | null;
    goals: number | null;
    assists: number | null;
    points: number | null;
  }>;

  const activeSeasonIds = [...new Set(rows.map((row) => row.season_id).filter((seasonId): seasonId is string => Boolean(seasonId)))];
  const [confirmedBuckets, fallbackBuckets] = await Promise.all([
    Promise.all(activeSeasonIds.map((seasonId) => getConfirmedCheckinAppearanceRows(supabase, { seasonId, playerIds: [playerId] }))),
    Promise.all(activeSeasonIds.map((seasonId) => getFallbackRosterAppearanceRows(supabase, { seasonId, playerIds: [playerId] }))),
  ]);
  const confirmedCheckins = confirmedBuckets.flat();
  const fallbackAppearances = fallbackBuckets.flat();

  const teamNames = await loadTeamNameMap(supabase, rows.map((row) => row.team_id));
  const teamGameCountBySeasonTeam = await loadTeamGameCountsBySeasonTeam(supabase, leagueId, activeSeasonIds, [
    ...rows.map((row) => row.team_id),
    ...confirmedCheckins.map((row) => row.team_id),
    ...fallbackAppearances.map((row) => row.team_id),
  ]);

  const appearancesBySeasonTeam = new Map<string, Set<string>>();
  for (const row of [...confirmedCheckins, ...fallbackAppearances]) {
    const game = Array.isArray(row.game) ? row.game[0] : row.game;
    if (!row.game_id || !row.team_id || !game?.season_id) continue;
    const key = `${game.season_id}:${row.team_id}`;
    const games = appearancesBySeasonTeam.get(key) || new Set<string>();
    games.add(row.game_id);
    appearancesBySeasonTeam.set(key, games);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', playerId)
    .maybeSingle();

  const importedSeed = getImportedAggregateSkaterSeed(HLHL_WINTER_2026_SEASON_ID, profile?.full_name);

  const timelineRows = rows
    .filter((row) => Boolean(row.season_id))
    .map((row) => {
      const season = row.season_id as string;
      const key = `${season}:${row.team_id || 'unknown'}`;
      const importedGamesPlayed = season === HLHL_WINTER_2026_SEASON_ID ? importedSeed?.gamesPlayed ?? null : null;
      const goals = season === HLHL_WINTER_2026_SEASON_ID && importedSeed ? importedSeed.goals : (row.goals || 0);
      const assists = season === HLHL_WINTER_2026_SEASON_ID && importedSeed ? importedSeed.assists : (row.assists || 0);
      const points = season === HLHL_WINTER_2026_SEASON_ID && importedSeed
        ? importedSeed.goals + importedSeed.assists
        : (row.points ?? ((row.goals || 0) + (row.assists || 0)));
      const gamesPlayed = Math.max(row.games_played || 0, appearancesBySeasonTeam.get(key)?.size || 0, importedGamesPlayed || 0);
      const teamGames = row.team_id ? (teamGameCountBySeasonTeam.get(key) || gamesPlayed) : gamesPlayed;
      return {
        season_id: season,
        season_name: seasonNameById.get(season) || 'Unknown Season',
        sort_date: seasonSortById.get(season) || null,
        team_id: row.team_id,
        team_name: importedSeed?.teamName && season === HLHL_WINTER_2026_SEASON_ID
          ? importedSeed.teamName
          : (row.team_name || (row.team_id ? teamNames.get(row.team_id) || null : null)),
        position: row.position,
        games_played: gamesPlayed,
        team_games: teamGames,
        attendance_pct: teamGames > 0 ? roundCareerMetric((gamesPlayed / teamGames) * 100, 1) : 0,
        goals,
        assists,
        points,
        goals_per_game: gamesPlayed > 0 ? roundCareerMetric(goals / gamesPlayed, 2) : 0,
        points_per_game: gamesPlayed > 0 ? roundCareerMetric(points / gamesPlayed, 2) : 0,
        wins: 0,
        losses: 0,
        ties: 0,
        saves: 0,
        goals_against: 0,
        save_percentage: null,
        goals_against_average: null,
        shutouts: 0,
      };
    });

  if (importedSeed && !timelineRows.some((row) => row.season_id === HLHL_WINTER_2026_SEASON_ID)) {
    const gamesPlayed = importedSeed.gamesPlayed;
    const goals = importedSeed.goals;
    const assists = importedSeed.assists;
    const points = goals + assists;
    timelineRows.push({
      season_id: HLHL_WINTER_2026_SEASON_ID,
      season_name: seasonNameById.get(HLHL_WINTER_2026_SEASON_ID) || 'Winter 2026',
      sort_date: seasonSortById.get(HLHL_WINTER_2026_SEASON_ID) || null,
      team_id: null,
      team_name: importedSeed.teamName,
      position: null,
      games_played: gamesPlayed,
      team_games: gamesPlayed,
      attendance_pct: gamesPlayed > 0 ? 100 : 0,
      goals,
      assists,
      points,
      goals_per_game: gamesPlayed > 0 ? roundCareerMetric(goals / gamesPlayed, 2) : 0,
      points_per_game: gamesPlayed > 0 ? roundCareerMetric(points / gamesPlayed, 2) : 0,
      wins: 0,
      losses: 0,
      ties: 0,
      saves: 0,
      goals_against: 0,
      save_percentage: null,
      goals_against_average: null,
      shutouts: 0,
    });
  }

  return timelineRows
    .filter((row) => includeHistoricalBaseline || row.season_id !== historicalBaselineSeason?.id)
    .filter((row) => row.games_played > 0 || row.points > 0 || row.wins > 0 || row.saves > 0)
    .sort((left, right) => new Date(left.sort_date || 0).getTime() - new Date(right.sort_date || 0).getTime());
}

export async function getPlayerCareerStats(
  playerId: string,
  seasonId?: string | null,
  options: { leagueId?: string; isGoalie?: boolean } = {},
): Promise<PlayerStats | null> {
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const { leagueId, isGoalie = false } = options;

  if (seasonId === null) {
    if (!leagueId) {
      return null;
    }

    const careerRows = filterVisiblePlayerCareerTimelineRows(
      await getPlayerCareerStatsTimeline(leagueId, playerId, isGoalie, { includeHistoricalBaseline: true }),
      { includeHistoricalBaseline: true },
    );

    return summarizePlayerCareerTotalsFromTimeline(playerId, careerRows, isGoalie);
  }

  let seasonSummary: {
    games_played?: number | null;
    goals?: number | null;
    assists?: number | null;
    points?: number | null;
    team_name?: string | null;
    position?: string | null;
    wins?: number | null;
    losses?: number | null;
    ties?: number | null;
    saves?: number | null;
    goals_against?: number | null;
    save_percentage?: number | null;
    goals_against_average?: number | null;
    shutouts?: number | null;
  } | null = null;
  let seasonName: string | null = null;

  if (seasonId) {
    const { data: seasonRecord } = await supabase
      .from('seasons')
      .select('name')
      .eq('id', seasonId)
      .maybeSingle();

    seasonName = seasonRecord?.name ?? null;

    if (isImportedAggregateSeasonId(seasonId)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', playerId)
        .maybeSingle();

      const importedSkater = getImportedAggregateSkaterSeed(seasonId, profile?.full_name);
      if (importedSkater) {
        return {
          player_id: playerId,
          player_name: profile?.full_name || '',
          team_name: importedSkater.teamName || 'Free Agent',
          team_id: '',
          position: null,
          games_played: importedSkater.gamesPlayed,
          goals: importedSkater.goals,
          assists: importedSkater.assists,
          points: importedSkater.goals + importedSkater.assists,
          penalty_minutes: 0,
          plus_minus: 0,
        };
      }

      const importedGoalie = getImportedAggregateGoalieSeed(seasonId, profile?.full_name);
      if (importedGoalie) {
        const shotsAgainst = importedGoalie.saves + importedGoalie.goalsAgainst;
        return {
          player_id: playerId,
          player_name: profile?.full_name || '',
          team_name: importedGoalie.teamName || 'Free Agent',
          team_id: '',
          position: 'Goalie',
          games_played: importedGoalie.gamesPlayed,
          goals: 0,
          assists: 0,
          points: 0,
          penalty_minutes: 0,
          plus_minus: 0,
          wins: importedGoalie.wins,
          losses: importedGoalie.losses,
          saves: importedGoalie.saves,
          goals_against: importedGoalie.goalsAgainst,
          save_percentage: shotsAgainst > 0 ? roundStatValue((importedGoalie.saves / shotsAgainst) * 100, 1) : 0,
          goals_against_average:
            importedGoalie.gamesPlayed > 0 ? roundStatValue(importedGoalie.goalsAgainst / importedGoalie.gamesPlayed) : 0,
        };
      }
    }

    const { data: seasonStats } = await supabase
      .from('player_season_stats')
      .select('games_played, goals, assists, points, team_name, position')
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .maybeSingle();

    seasonSummary = seasonStats;

    if (isHistoricalCareerBaselineSeasonName(seasonName)) {
      const { data: baselineStats } = await serviceSupabase
        .from('player_career_baselines')
        .select('games_played, goals, assists, points')
        .eq('player_id', playerId)
        .maybeSingle();

      if (baselineStats) {
        seasonSummary = {
          ...seasonSummary,
          games_played: baselineStats.games_played,
          goals: baselineStats.goals,
          assists: baselineStats.assists,
          points: baselineStats.points,
        };
      }
    }

    if (isImportedAggregateSeasonId(seasonId)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', playerId)
        .maybeSingle();

      const gamesPlayedOverride = getImportedAggregateSkaterGamesPlayed(seasonId, profile?.full_name);
      if (gamesPlayedOverride != null) {
        seasonSummary = {
          ...seasonSummary,
          games_played: gamesPlayedOverride,
        };
      }
    }
  }

  // Query player_stats rows for fields not exposed by player_season_stats (for example
  // penalty minutes), but repair GP from distinct appearances plus confirmed check-ins.
  let query = supabase
    .from('player_stats')
    .select('game_id, goals, assists, penalty_minutes')
    .eq('player_id', playerId);

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;

  if (error) return null;

  const statGameIds = new Set((data || []).map((row) => row.game_id).filter(Boolean));

  if (seasonId) {
    const [confirmedCheckins, fallbackRosterAppearances, rosterSummaryResult, goalieStatsResult] = await Promise.all([
      getConfirmedCheckinAppearanceRows(supabase, {
        seasonId,
        playerIds: [playerId],
      }),
      getFallbackRosterAppearanceRows(supabase, {
        seasonId,
        playerIds: [playerId],
      }),
      (!seasonSummary?.team_name || !seasonSummary?.position)
        ? supabase
            .from('team_rosters')
            .select('position, team:teams!team_rosters_team_id_fkey(name)')
            .eq('player_id', playerId)
            .eq('season_id', seasonId)
            .eq('status', 'active')
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('goalie_stats')
        .select(`
          game_id,
          team_id,
          saves,
          shots_against,
          goals_against,
          shutout,
          game_result,
          game:games(id, status, home_team_id, away_team_id, home_score, away_score)
        `)
        .eq('player_id', playerId)
        .eq('season_id', seasonId),
    ]);

    for (const row of [...confirmedCheckins, ...fallbackRosterAppearances]) {
      if (row.game_id) {
        statGameIds.add(row.game_id);
      }
    }

    const rosterTeam = Array.isArray(rosterSummaryResult.data?.team)
      ? rosterSummaryResult.data?.team[0]
      : rosterSummaryResult.data?.team;

    seasonSummary = {
      ...seasonSummary,
      team_name: seasonSummary?.team_name || rosterTeam?.name || undefined,
      position: seasonSummary?.position || rosterSummaryResult.data?.position || undefined,
      games_played: Math.max(seasonSummary?.games_played ?? 0, statGameIds.size),
    };

    const normalizedPosition = seasonSummary.position?.trim().toLowerCase();
    const isGoalieSeason =
      normalizedPosition === 'g' ||
      normalizedPosition === 'goalie' ||
      normalizedPosition === 'goaltender';

    if (isGoalieSeason) {
      const goalieGameIds = new Set<string>();
      const goalieTotals = {
        wins: 0,
        losses: 0,
        ties: 0,
        saves: 0,
        shotsAgainst: 0,
        goalsAgainst: 0,
        shutouts: 0,
      };

      for (const row of (goalieStatsResult.data || []) as Array<{
        game_id: string | null;
        team_id: string | null;
        saves: number | null;
        shots_against: number | null;
        goals_against: number | null;
        shutout: boolean | null;
        game_result: string | null;
      }>) {
        if (row.game_id) goalieGameIds.add(row.game_id);
        goalieTotals.saves += Number(row.saves || 0);
        goalieTotals.goalsAgainst += Number(row.goals_against || 0);
        goalieTotals.shotsAgainst += Number(row.shots_against || 0);
        if (row.shutout) goalieTotals.shutouts += 1;

        const result = row.game_result?.trim().toUpperCase();
        if (result === 'W' || result === 'WIN') goalieTotals.wins += 1;
        else if (result === 'L' || result === 'LOSS' || result === 'OTL' || result === 'SOL') goalieTotals.losses += 1;
        else if (result === 'T' || result === 'TIE') goalieTotals.ties += 1;
      }

      for (const appearance of [...confirmedCheckins, ...fallbackRosterAppearances]) {
        if (!appearance.game_id || goalieGameIds.has(appearance.game_id)) {
          continue;
        }

        const game = Array.isArray(appearance.game) ? appearance.game[0] : appearance.game;
        if (!game || game.status !== 'completed' || game.home_score == null || game.away_score == null) {
          continue;
        }

        const isHome = game.home_team_id === appearance.team_id;
        const isAway = game.away_team_id === appearance.team_id;
        if (!isHome && !isAway) {
          continue;
        }

        const goalsFor = Number(isHome ? game.home_score : game.away_score);
        const goalsAgainst = Number(isHome ? game.away_score : game.home_score);
        if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) {
          continue;
        }

        goalieGameIds.add(appearance.game_id);
        goalieTotals.shotsAgainst += ASSUMED_GOALIE_SHOTS_AGAINST;
        goalieTotals.saves += Math.max(0, ASSUMED_GOALIE_SHOTS_AGAINST - goalsAgainst);
        goalieTotals.goalsAgainst += goalsAgainst;
        if (goalsAgainst === 0) goalieTotals.shutouts += 1;
        if (goalsFor > goalsAgainst) goalieTotals.wins += 1;
        else if (goalsFor < goalsAgainst) goalieTotals.losses += 1;
        else goalieTotals.ties += 1;
      }

      if (goalieGameIds.size > 0) {
        seasonSummary = {
          ...seasonSummary,
          games_played: Math.max(seasonSummary.games_played ?? 0, goalieGameIds.size),
          goals: 0,
          assists: 0,
          points: 0,
          wins: goalieTotals.wins,
          losses: goalieTotals.losses,
          ties: goalieTotals.ties,
          saves: goalieTotals.saves,
          goals_against: goalieTotals.goalsAgainst,
          save_percentage: goalieTotals.shotsAgainst > 0 ? goalieTotals.saves / goalieTotals.shotsAgainst : null,
          goals_against_average: goalieTotals.goalsAgainst / goalieGameIds.size,
          shutouts: goalieTotals.shutouts,
        };
      }
    }
  }

  return summarizePlayerCareerTotals(playerId, data || [], seasonSummary);
}

export async function getImportedPlayerCareerAchievements(
  playerId: string,
): Promise<{ championships: number }> {
  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from('player_career_baselines')
    .select('moosehead_cup_wins')
    .eq('player_id', playerId);

  if (error || !data) {
    return { championships: 0 };
  }

  return {
    championships: (data as Array<{ moosehead_cup_wins: number | null }>).reduce((total: number, row) => {
      const value = typeof row.moosehead_cup_wins === 'number' ? row.moosehead_cup_wins : 0;
      return total + Math.max(0, Math.trunc(value));
    }, 0),
  };
}

/**
 * Fetch player game log
 * Queries player_stats table with game details
 */
export async function getPlayerGameLog(
  playerId: string,
  seasonId?: string,
  limit = 20
): Promise<PlayerGameLogEntry[]> {
  const supabase = await createClient();

  if (seasonId) {
    const { data: seasonRecord } = await supabase
      .from('seasons')
      .select('name')
      .eq('id', seasonId)
      .maybeSingle();

    if (isAggregateOnlySeasonView(seasonId, seasonRecord?.name ?? null)) {
      return [];
    }
  }

  // Build query for player stats with game details
  let query = supabase
    .from('player_stats')
    .select(`
      id,
      goals,
      assists,
      penalty_minutes,
      game_id,
      team_id,
      game:games(
        id,
        scheduled_at,
        home_score,
        away_score,
        status,
        home_team:teams!games_home_team_id_fkey(id, name, slug),
        away_team:teams!games_away_team_id_fkey(id, name, slug)
      )
    `)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;

  if (error || !data) return [];

  const rows = [...data];

  if (seasonId) {
    const fallbackRosterAppearances = await getFallbackRosterAppearanceRows(supabase, {
      seasonId,
      playerIds: [playerId],
    });

    const existingGameIds = new Set(rows.map((row: any) => row.game_id).filter(Boolean));
    const missingAppearanceRows = fallbackRosterAppearances.filter((row) => row.game_id && !existingGameIds.has(row.game_id));

    if (missingAppearanceRows.length > 0) {
      const { data: fallbackGames } = await supabase
        .from('games')
        .select(`
          id,
          scheduled_at,
          home_score,
          away_score,
          status,
          home_team:teams!games_home_team_id_fkey(id, name, slug),
          away_team:teams!games_away_team_id_fkey(id, name, slug)
        `)
        .in('id', missingAppearanceRows.map((row) => row.game_id));

      const gameMap = new Map((fallbackGames || []).map((game: any) => [game.id, game]));

      for (const row of missingAppearanceRows) {
        rows.push({
          id: `fallback-${row.game_id}-${row.team_id}`,
          goals: 0,
          assists: 0,
          penalty_minutes: 0,
          game_id: row.game_id,
          team_id: row.team_id,
          game: gameMap.get(row.game_id) || row.game || null,
        });
      }
    }
  }

  const transformed = rows.map((stat: any) => {
    const game = Array.isArray(stat.game) ? stat.game[0] : stat.game;
    const homeTeam = Array.isArray(game?.home_team) ? game?.home_team[0] : game?.home_team;
    const awayTeam = Array.isArray(game?.away_team) ? game?.away_team[0] : game?.away_team;
    const isHome = homeTeam?.id === stat.team_id;
    const opponentTeam = isHome ? awayTeam : homeTeam;
    const myScore = isHome ? game?.home_score : game?.away_score;
    const theirScore = isHome ? game?.away_score : game?.home_score;
    let result = '-';
    if ((game?.status === 'completed' || game?.status === 'pending_verification') && myScore != null && theirScore != null) {
      result = myScore > theirScore ? 'W' : myScore < theirScore ? 'L' : 'T';
    }
    return {
      game_id: game?.id || stat.game_id || '',
      date: game?.scheduled_at || '',
      opponent: opponentTeam?.name || '',
      opponent_name: opponentTeam?.name || '',
      opponent_slug: opponentTeam?.slug || '',
      result,
      goals: stat.goals || 0,
      assists: stat.assists || 0,
      points: (stat.goals || 0) + (stat.assists || 0),
      plus_minus: 0,
      pim: stat.penalty_minutes || 0,
    };
  }) as PlayerGameLogEntry[];

  return transformed
    .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())
    .slice(0, limit);
}

/**
 * Fetch goalie stats leaders
 * Uses get_goalie_season_stats RPC with correct parameter names
 */
export async function getGoalieLeaders(
  leagueId: string,
  seasonId?: string | null, // null = all-time career stats
  sortBy: 'wins' | 'save_percentage' | 'goals_against_average' | 'shutouts' = 'wins',
  limit = 20,
  divisionId?: string,
  leagueSlug?: string,
): Promise<GoalieStats[]> {
  const supabase = await createClient();
  const hydrateGoalieProfiles = async <T extends {
    player_id: string;
    player_name: string;
    avatar_url: string | null;
  }>(rows: T[]) => {
    const playerIds = [...new Set(rows.map((row) => row.player_id).filter(Boolean))];
    if (playerIds.length === 0) {
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, photo_url')
      .in('id', playerIds);

    const profileMap = new Map(
      (profiles || []).map((profile) => [
        profile.id,
        {
          full_name: profile.full_name,
          avatar_url: resolvePlayerPhotoUrl(profile),
        },
      ]),
    );

    for (const row of rows) {
      const profile = profileMap.get(row.player_id);
      if (profile?.full_name) {
        row.player_name = profile.full_name;
      }
      if (profile?.avatar_url) {
        row.avatar_url = profile.avatar_url;
      }
    }
  };

  // If seasonId is explicitly null, fetch all-time career stats
  if (seasonId === null) {
    const { rows, profileIdsByPlayerId } = await buildAllTimeGoalieRows(leagueId, divisionId, leagueSlug);

    return rows
      .map((row) => ({
        player_id: row.player_id,
        profile_id: profileIdsByPlayerId.has(row.player_id)
          ? profileIdsByPlayerId.get(row.player_id) ?? null
          : row.player_id,
        player_name: row.player_name,
        jersey_number: null,
        avatar_url: row.avatar_url,
        team_id: row.team_id,
        team_name: row.team_name,
        team_logo: null,
        games_played: row.games_played,
        wins: row.wins,
        losses: row.losses,
        ties: 0,
        save_percentage: row.save_percentage ?? 0,
        goals_against_average: row.goals_against_average ?? 0,
        shutouts: row.shutouts,
        saves: row.saves,
        goals_against: row.goals_against,
      }))
      .sort((left, right) => compareLegacyGoalies(left, right, sortBy))
      .slice(0, limit) as GoalieStats[];
  }

  if (seasonId && isImportedAggregateSeasonId(seasonId)) {
    const rows = await buildImportedAggregateGoalieRows(leagueId, seasonId, divisionId);

    return rows
      .map((row) => ({
        player_id: row.player_id,
        player_name: row.player_name,
        jersey_number: null,
        avatar_url: row.avatar_url,
        team_id: row.team_id,
        team_name: row.team_name,
        team_logo: null,
        games_played: row.games_played,
        wins: row.wins,
        losses: row.losses,
        ties: 0,
        save_percentage: row.save_percentage ?? 0,
        goals_against_average: row.goals_against_average ?? 0,
        shutouts: row.shutouts,
        saves: row.saves,
        goals_against: row.goals_against,
      }))
      .sort((left, right) => compareLegacyGoalies(left, right, sortBy))
      .slice(0, limit) as GoalieStats[];
  }

  // Use the actual RPC function name with correct parameters
  const { data, error } = await supabase.rpc('get_goalie_season_stats', {
    check_league_id: leagueId,
    check_season_id: seasonId || null,
    check_division_id: divisionId || null,
  });

  if (error || !data) return [];

  // Transform RPC response to expected format and apply client-side sorting/limiting
  const results = (data as any[]).map((row) => {
    const playerName = row.full_name || 'Unknown';
    const importedAggregateOverride = getImportedAggregateGoalieOverride(seasonId, playerName);

    return {
      player_id: row.player_id,
      player_name: playerName,
      team_id: row.team_id || '',
      team_name: row.team_name || '',
      games_played: importedAggregateOverride?.games_played ?? (row.games_played || 0),
      wins: importedAggregateOverride?.wins ?? (row.wins || 0),
      losses: importedAggregateOverride?.losses ?? (row.losses || 0),
      save_percentage: row.save_percentage || 0,
      goals_against_average: importedAggregateOverride && (row.total_goals_against || 0) >= 0
        ? Number(((row.total_goals_against || 0) / Math.max(importedAggregateOverride.games_played, 1)).toFixed(2))
        : row.goals_against_average || 0,
      shutouts: row.shutouts || 0,
      saves: row.total_saves || 0,
      goals_against: row.total_goals_against || 0,
      avatar_url: row.avatar_url || null,
    };
  });

  await hydrateGoalieProfiles(results);

  // Deduplicate goalies on multiple teams
  const dedupedResults = deduplicateGoalieStats(results as GoalieStats[]);

  // Sort by requested stat
  dedupedResults.sort((a, b) => {
    switch (sortBy) {
      case 'save_percentage':
        return b.save_percentage - a.save_percentage;
      case 'goals_against_average':
        return a.goals_against_average - b.goals_against_average; // Lower is better
      case 'shutouts':
        return b.shutouts - a.shutouts;
      case 'wins':
      default:
        return b.wins - a.wins;
    }
  });

  return dedupedResults.slice(0, limit);
}

// ========== NEWS ==========
export async function getNewsArticles(leagueId: string, limit = 20): Promise<NewsArticle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)')
    .eq('league_id', leagueId)
    .eq('type', 'news')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as unknown as NewsArticle[];
}

export async function getNewsArticleBySlug(leagueId: string, slug: string): Promise<NewsArticle | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)')
    .eq('league_id', leagueId)
    .eq('slug', slug)
    .eq('published', true)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return data as unknown as NewsArticle;
  }

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
  if (!uuidLike) return null;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('articles')
    .select('*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)')
    .eq('league_id', leagueId)
    .eq('id', slug)
    .eq('published', true)
    .maybeSingle();

  if (fallbackError || !fallbackData) return null;
  return fallbackData as unknown as NewsArticle;
}

export async function getArticleLinkContext(
  articleId: string,
  leagueId: string,
  relatedGameId?: string | null,
): Promise<ArticleLinkContext> {
  const supabase = createServiceRoleClient();

  const [playerTagsResult, teamTagsResult, gameTagsResult, relatedGame] = await Promise.all([
    supabase
      .from('article_player_tags')
      .select('player_id, player:profiles!article_player_tags_player_id_fkey(id, full_name)')
      .eq('article_id', articleId),
    supabase
      .from('article_team_tags')
      .select('team_id, team:teams!article_team_tags_team_id_fkey(id, name, slug)')
      .eq('article_id', articleId),
    supabase
      .from('article_game_tags')
      .select('game_id, is_primary')
      .eq('article_id', articleId)
      .order('is_primary', { ascending: false }),
    relatedGameId ? getGamePreview(relatedGameId) : Promise.resolve(null),
  ]);

  const players = (playerTagsResult.data || [])
    .map((row: any) => {
      const player = Array.isArray(row.player) ? row.player[0] : row.player;
      if (!player?.id || !player.full_name) return null;
      return {
        id: player.id,
        fullName: player.full_name as string,
      };
    })
    .filter(Boolean) as ArticleLinkContext['players'];

  const explicitTeams = (teamTagsResult.data || [])
    .map((row: any) => {
      const team = Array.isArray(row.team) ? row.team[0] : row.team;
      if (!team?.id || !team.name || !team.slug) return null;
      return {
        id: team.id,
        name: team.name as string,
        slug: team.slug as string,
      };
    })
    .filter(Boolean) as ArticleLinkContext['teams'];

  const explicitGameIds = [...new Set((gameTagsResult.data || []).map((row: any) => row.game_id).filter(Boolean))] as string[];
  const fallbackGameIds = relatedGameId && !explicitGameIds.includes(relatedGameId) ? [relatedGameId] : [];
  const gameIds = [...explicitGameIds, ...fallbackGameIds];

  const games = await Promise.all(gameIds.map((gameId) => getGamePreview(gameId)));
  const linkableGames = games
    .filter(Boolean)
    .map((game) => ({
      id: game!.id,
      homeTeamName: game!.home_team?.name || 'Home',
      awayTeamName: game!.away_team?.name || 'Away',
    })) as ArticleLinkContext['games'];

  const primaryExplicitGameId =
    (gameTagsResult.data || []).find((row: any) => row.is_primary)?.game_id ||
    relatedGameId ||
    null;

  const primaryGame =
    linkableGames.find((game) => game.id === primaryExplicitGameId) ||
    null;

  const fallbackTeams =
    explicitTeams.length === 0 && relatedGame?.home_team && relatedGame?.away_team
      ? [
          relatedGame.home_team.slug
            ? {
                id: relatedGame.home_team.id,
                name: relatedGame.home_team.name,
                slug: relatedGame.home_team.slug,
              }
            : null,
          relatedGame.away_team.slug
            ? {
                id: relatedGame.away_team.id,
                name: relatedGame.away_team.name,
                slug: relatedGame.away_team.slug,
              }
            : null,
        ].filter(Boolean) as ArticleLinkContext['teams']
      : [];

  return {
    players,
    teams: explicitTeams.length > 0 ? explicitTeams : fallbackTeams,
    games: linkableGames,
    primaryGame,
  };
}

/**
 * Get tagged players attached to an article
 */
export async function getArticlePlayerTags(articleId: string): Promise<Array<{
  id: string;
  mention_type: string;
  player: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
}>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('article_player_tags')
    .select(`
      id,
      mention_type,
      player:profiles!article_player_tags_player_id_fkey(
        id,
        full_name,
        avatar_url
      )
    `)
    .eq('article_id', articleId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data
    .map((row: any) => {
      const player = Array.isArray(row.player) ? row.player[0] : row.player;
      if (!player?.id || !player.full_name) {
        return null;
      }

      return {
        id: row.id,
        mention_type: row.mention_type || 'mention',
        player: {
          id: player.id,
          full_name: player.full_name,
          avatar_url: player.avatar_url || null,
        },
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      mention_type: string;
      player: {
        id: string;
        full_name: string;
        avatar_url: string | null;
      } | null;
    }>;
}

/**
 * Check if a league has an active AI News addon
 */
export async function hasAiNewsAddon(leagueId: string): Promise<boolean> {
  const supabase = await createClient();

  // Get league's organization
  const { data: league } = await supabase
    .from('leagues')
    .select('organization_id')
    .eq('id', leagueId)
    .single();

  if (!league?.organization_id) return false;

  const { data: addon } = await supabase
    .from('organization_addons')
    .select('id')
    .eq('organization_id', league.organization_id)
    .eq('addon_type', 'ai_news')
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  return !!addon;
}

export async function hasAdvancedStatsAddon(leagueId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from('leagues')
    .select('organization_id')
    .eq('id', leagueId)
    .single();

  if (!league?.organization_id) return false;

  const { data: addon } = await supabase
    .from('organization_addons')
    .select('id')
    .eq('organization_id', league.organization_id)
    .eq('addon_type', 'advanced_stats')
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  return !!addon;
}

export async function hasPlatformSubscription(leagueId: string): Promise<boolean> {
  const hasServiceRoleKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
  );

  // Local dev and E2E environments often run public league pages without a
  // service-role key wired into the app runtime. Failing closed there blocks
  // validation of live game, scorekeeper, and registration flows even though
  // production uses the strict org-level subscription gate.
  if (!hasServiceRoleKey && process.env.NODE_ENV !== 'production') {
    return true;
  }

  // Use service role to bypass RLS — organizations table is not readable by anon users
  const serviceSupabase = createServiceRoleClient();

  const { data: league } = await serviceSupabase
    .from('leagues')
    .select('organization_id')
    .eq('id', leagueId)
    .single();

  if (!league?.organization_id) return false;

  // Check bypass flag first — set on demo/pitch orgs, clear once they subscribe
  const { data: org } = await (serviceSupabase as any)
    .from('organizations')
    .select('bypass_subscription_gate')
    .eq('id', league.organization_id)
    .maybeSingle();

  if (org?.bypass_subscription_gate) return true;

  const { data: addon } = await serviceSupabase
    .from('organization_addons')
    .select('id')
    .eq('organization_id', league.organization_id)
    .eq('addon_type', 'platform_subscription')
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  return !!addon;
}

/**
 * Get the latest published announcement for a league
 */
export async function getLatestAnnouncement(leagueId: string, seasonId?: string | null): Promise<{
  id: string;
  title: string;
  excerpt: string | null;
  content: string;
  publishedAt: string;
  slug: string | null;
} | null> {
  const supabase = await createClient();

  let query = supabase
    .from('articles')
    .select('id, title, excerpt, content, published_at, slug')
    .eq('league_id', leagueId)
    .eq('type', 'announcement')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(1);

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query.single();

  if (error || !data) return null;

  return {
    id: data.id,
    title: data.title,
    excerpt: data.excerpt,
    content: data.content,
    publishedAt: data.published_at || '',
    slug: data.slug,
  };
}

/**
 * Get all published public-facing articles for a league.
 * Public homepage/news surfaces should always be allowed to show published
 * news, game recaps, and weekly wrap stories without depending on addon-gate
 * lookups at render time.
 */
export async function getAllArticles(leagueId: string, limit = 20): Promise<NewsArticle[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('articles')
    .select('*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)')
    .eq('league_id', leagueId)
    .eq('published', true)
    .in('type', ['news', 'game_recap', 'weekly_wrap'])
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as unknown as NewsArticle[];
}

/**
 * Get game recap article for a specific game
 */
export async function getGameRecap(gameId: string): Promise<NewsArticle | null> {
  const supabase = await createClient();
  const articleSelect = '*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)';

  const { data, error } = await supabase
    .from('articles')
    .select(articleSelect)
    .eq('game_id', gameId)
    .eq('type', 'game_recap')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return data as unknown as NewsArticle;
  }

  const { data: taggedRows, error: taggedError } = await supabase
    .from('article_game_tags')
    .select('article_id')
    .eq('game_id', gameId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  const taggedArticleIds = [
    ...new Set(
      (taggedRows || [])
        .map((row: { article_id: string | null }) => row.article_id)
        .filter(Boolean),
    ),
  ] as string[];

  if (taggedError || taggedArticleIds.length === 0) return null;

  const { data: taggedArticles, error: articleError } = await supabase
    .from('articles')
    .select(articleSelect)
    .in('id', taggedArticleIds)
    .eq('type', 'game_recap')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(1);

  if (articleError || !taggedArticles?.[0]) return null;
  return taggedArticles[0] as unknown as NewsArticle;
}

/**
 * Get articles that tag a specific player
 */
export async function getPlayerArticles(playerId: string, limit = 10): Promise<NewsArticle[]> {
  const supabase = await createClient();

  // Get article IDs from player tags
  const { data: tags, error: tagsError } = await supabase
    .from('article_player_tags')
    .select('article_id')
    .eq('player_id', playerId)
    .limit(limit);

  if (tagsError || !tags || tags.length === 0) return [];

  const articleIds = tags.map(t => t.article_id);

  // Get the articles
  const { data: articles, error } = await supabase
    .from('articles')
    .select('*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)')
    .in('id', articleIds)
    .eq('published', true)
    .order('published_at', { ascending: false });

  if (error || !articles) return [];
  return articles as unknown as NewsArticle[];
}

export async function getTeamArticles(leagueId: string, teamId: string, limit = 6): Promise<NewsArticle[]> {
  const supabase = createServiceRoleClient();

  const [{ data: tagRows }, { data: teamGames }] = await Promise.all([
    supabase
      .from('article_team_tags')
      .select('article_id')
      .eq('team_id', teamId)
      .limit(Math.max(limit * 3, 12)),
    supabase
      .from('games')
      .select('id, scheduled_at')
      .eq('league_id', leagueId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order('scheduled_at', { ascending: false })
      .limit(60),
  ]);

  const taggedArticleIds = [...new Set((tagRows || []).map((row: any) => row.article_id).filter(Boolean))] as string[];
  const teamGameIds = [...new Set((teamGames || []).map((game: any) => game.id).filter(Boolean))] as string[];

  if (taggedArticleIds.length === 0 && teamGameIds.length === 0) {
    return [];
  }

  const articleSelect = '*, author:profiles!articles_author_id_fkey(full_name, avatar_url, photo_url)';
  const allowedTypes = ['news', 'game_recap', 'weekly_wrap'];

  const [taggedArticlesResult, gameArticlesResult] = await Promise.all([
    taggedArticleIds.length > 0
      ? supabase
          .from('articles')
          .select(articleSelect)
          .eq('league_id', leagueId)
          .eq('published', true)
          .in('type', allowedTypes)
          .in('id', taggedArticleIds)
      : Promise.resolve({ data: [] as any[] }),
    teamGameIds.length > 0
      ? supabase
          .from('articles')
          .select(articleSelect)
          .eq('league_id', leagueId)
          .eq('published', true)
          .in('type', allowedTypes)
          .in('game_id', teamGameIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const mergedById = new Map<string, NewsArticle>();

  for (const article of [...(taggedArticlesResult.data || []), ...(gameArticlesResult.data || [])] as NewsArticle[]) {
    if (!article?.id) continue;
    mergedById.set(article.id, article);
  }

  return [...mergedById.values()]
    .sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
}

// ========== EVENTS ==========
export async function getLeagueEvents(leagueId: string): Promise<LeagueEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('league_events')
    .select('*')
    .eq('league_id', leagueId)
    .eq('is_published', true)
    .order('start_time', { ascending: true });
  if (error || !data) return [];
  return data as LeagueEvent[];
}

// ========== GALLERY ==========
export async function getGalleryAlbums(leagueId: string): Promise<GalleryAlbum[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('league_gallery')
    .select('*, gallery_photos(count)')
    .eq('league_id', leagueId)
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((album: any) => ({
    ...album,
    photo_count: album.gallery_photos?.[0]?.count || 0,
  })) as GalleryAlbum[];
}

export async function getRecentPhotosForReel(
  leagueId: string,
  limit = 12,
): Promise<import('./types').ReelPhoto[]> {
  const supabase = await createClient();

  // Fetch recent individual photos joined with their album title
  const { data, error } = await supabase
    .from('gallery_photos')
    .select('id, url, caption, gallery_id, league_gallery!inner(id, title, league_id, is_published)')
    .eq('league_gallery.league_id', leagueId)
    .eq('league_gallery.is_published', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    url: row.url,
    caption: row.caption,
    album_id: row.gallery_id,
    album_title: row.league_gallery?.title ?? '',
    album_href: '', // filled by caller with leagueSlug context
  }));
}

export async function getAlbumWithPhotos(albumId: string): Promise<{ album: GalleryAlbum; photos: GalleryPhoto[] } | null> {
  const supabase = await createClient();
  const { data: album, error: albumError } = await supabase
    .from('league_gallery')
    .select('*')
    .eq('id', albumId)
    .eq('is_published', true)
    .single();
  if (albumError || !album) return null;

  const { data: photos } = await supabase
    .from('gallery_photos')
    .select('*')
    .eq('gallery_id', albumId)
    .order('display_order', { ascending: true });

  return { album: album as GalleryAlbum, photos: (photos || []) as GalleryPhoto[] };
}

// ========== STAFF ==========
export async function getLeagueStaff(leagueId: string): Promise<StaffMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('league_staff')
    .select('*')
    .eq('league_id', leagueId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error || !data) return [];
  return data as StaffMember[];
}

// ========== SPONSORS ==========
export async function getLeagueSponsors(leagueId: string): Promise<LeagueSponsor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('league_sponsors')
    .select('*')
    .eq('league_id', leagueId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error || !data) return [];
  return data as LeagueSponsor[];
}

// ========== AWARDS ==========
export async function getLeagueAwards(leagueId: string, seasonId?: string): Promise<LeagueAward[]> {
  const supabase = await createClient();
  let query = supabase
    .from('league_awards')
    .select('*, player:profiles(full_name, avatar_url, photo_url), team:teams(name, logo_url, division:divisions(name)), season:seasons(name)')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query;
  if (error || !data) return [];

  const awards = (data as unknown as LeagueAward[]).map((award) => ({
    ...award,
    player: award.player
      ? {
          ...award.player,
          avatar_url: resolvePlayerPhotoUrl(award.player),
        }
      : award.player,
  }));
  const playerIds = [...new Set(awards.map((award) => award.player_id).filter(Boolean))] as string[];
  const seasonIds = [...new Set(awards.map((award) => award.season_id).filter(Boolean))] as string[];

  if (playerIds.length === 0) {
    return awards.map((award) => ({
      ...award,
      division_name: award.team?.division?.name || null,
    }));
  }

  let rosterQuery = supabase
    .from('team_rosters')
    .select(`
      player_id,
      team_id,
      season_id,
      position,
      jersey_number,
      is_goalie,
      team:teams(name, logo_url, division:divisions(name))
    `)
    .in('player_id', playerIds);

  if (seasonIds.length > 0) {
    rosterQuery = rosterQuery.in('season_id', seasonIds);
  }

  type AwardRosterRow = {
    player_id: string;
    team_id: string;
    season_id: string | null;
    position: string | null;
    jersey_number: number | null;
    is_goalie?: boolean | null;
    team?: {
      name?: string | null;
      logo_url?: string | null;
      division?: { name?: string | null } | { name?: string | null }[] | null;
    } | {
      name?: string | null;
      logo_url?: string | null;
      division?: { name?: string | null } | { name?: string | null }[] | null;
    }[] | null;
  };

  const { data: rosterRows } = await rosterQuery;
  const rosterMap = new Map<string, AwardRosterRow[]>();

  for (const row of (rosterRows || []) as unknown as AwardRosterRow[]) {
    const key = `${row.player_id}:${row.season_id ?? 'any'}`;
    const existing = rosterMap.get(key) || [];
    existing.push(row);
    rosterMap.set(key, existing);
  }

  return awards.map((award) => {
    const candidates = award.player_id
      ? rosterMap.get(`${award.player_id}:${award.season_id ?? 'any'}`) || rosterMap.get(`${award.player_id}:any`) || []
      : [];
    const matchedRoster =
      candidates.find((row) => !award.team_id || row.team_id === award.team_id) ||
      candidates[0] ||
      null;
    const rosterTeam = unwrapJoinedRecord(matchedRoster?.team);
    const divisionName =
      award.team?.division?.name ||
      getJoinedDivisionName(rosterTeam?.division) ||
      null;

    return {
      ...award,
      team: award.team || (rosterTeam
        ? {
            name: rosterTeam.name || 'Unknown Team',
            logo_url: rosterTeam.logo_url || null,
            division: divisionName ? { name: divisionName } : null,
          }
        : null),
      roster_position: matchedRoster?.position || (matchedRoster?.is_goalie ? 'Goalie' : null),
      roster_jersey_number: matchedRoster?.jersey_number ?? null,
      division_name: divisionName,
    };
  });
}

// ========== SPECIAL TEAMS STATS ==========
export async function getSpecialTeamsLeaders(leagueId: string, seasonId?: string, divisionId?: string): Promise<SpecialTeamsLeader[]> {
  const supabase = await createClient();
  let query = supabase
    .from('special_teams_leaders')
    .select('*')
    .eq('league_id', leagueId);
  if (seasonId) query = query.eq('season_id', seasonId);

  // Filter by division via team_id
  if (divisionId) {
    const { data: divTeams } = await supabase
      .from('teams')
      .select('id')
      .eq('division_id', divisionId);
    if (divTeams && divTeams.length > 0) {
      query = query.in('team_id', divTeams.map((t) => t.id));
    } else {
      return [];
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return deduplicateSpecialTeamsLeaders(data as SpecialTeamsLeader[]);
}

// ========== SUSPENSIONS ==========
export async function getSuspensions(leagueId: string, seasonId?: string): Promise<Suspension[]> {
  const supabase = await createClient();
  let query = supabase
    .from('suspensions')
    .select('*, player:profiles(full_name, avatar_url, photo_url), team:teams(name, logo_url)')
    .eq('league_id', leagueId)
    .in('status', ['active', 'appealed', 'served'])
    .order('created_at', { ascending: false });
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Suspension[]).map((suspension) => ({
    ...suspension,
    player: suspension.player
      ? {
          ...suspension.player,
          avatar_url: resolvePlayerPhotoUrl(suspension.player),
        }
      : suspension.player,
  }));
}

// ========== GAME SHEET ==========

/**
 * Format seconds into MM:SS display string
 */
function formatGameTime(seconds: number | null): string | null {
  if (seconds == null) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatLivePeriodTime(game: {
  status?: string | null;
  timer_elapsed_seconds?: number | null;
  period_length_minutes?: number | null;
  period_time?: string | null;
}): string | null {
  if (game.status !== 'in_progress') {
    return game.period_time ?? null;
  }

  if (typeof game.timer_elapsed_seconds === 'number' && typeof game.period_length_minutes === 'number') {
    const remainingSeconds = Math.max(0, game.period_length_minutes * 60 - game.timer_elapsed_seconds);
    return formatGameTime(remainingSeconds);
  }

  return game.period_time ?? null;
}

/**
 * Fetch full game sheet data for a completed game.
 * Includes game details, scoring summary, penalties, and goalie stats.
 */
export async function getGameSheet(gameId: string): Promise<GameSheetData | null> {
  const supabase = await createClient();

  // Fetch game with teams
  const { data: gameData, error: gameError } = await supabase
    .from('games')
    .select(`
      *,
      home_team:teams!games_home_team_id_fkey(
        id, name, slug, logo_url, primary_color, secondary_color,
        division:divisions(id, name)
      ),
      away_team:teams!games_away_team_id_fkey(
        id, name, slug, logo_url, primary_color, secondary_color,
        division:divisions(id, name)
      )
    `)
    .eq('id', gameId)
    .single();

  if (gameError || !gameData) return null;

  // Transform team data
  const transformTeam = (team: any) => {
    if (!team) return null;
    const rawTeam = Array.isArray(team) ? team[0] : team;
    if (!rawTeam) return null;
    const colors = [rawTeam.primary_color, rawTeam.secondary_color].filter(Boolean).join(',') || null;
    return {
      id: rawTeam.id,
      name: rawTeam.name,
      slug: rawTeam.slug,
      logo: rawTeam.logo_url || null,
      colors,
      division: Array.isArray(rawTeam.division) ? rawTeam.division[0] : rawTeam.division,
    };
  };

  const homeTeam = transformTeam(gameData.home_team);
  const awayTeam = transformTeam(gameData.away_team);

  if (!homeTeam || !awayTeam) return null;

  const game = {
    ...gameData,
    venue: (gameData as any).location || null,
    home_team: homeTeam,
    away_team: awayTeam,
    scorekeeper_notes: gameData.scorekeeper_notes || null,
    period_count: gameData.period_count || null,
  } as GameSheetData['game'];

  // Build team name lookup
  const teamNameMap: Record<string, string> = {
    [homeTeam.id]: homeTeam.name,
    [awayTeam.id]: awayTeam.name,
  };

  // Fetch game events (goals and penalties) with player names
  const { data: events } = await supabase
    .from('game_events')
    .select(`
      id,
      event_type,
      period,
      game_time_seconds,
      team_id,
      player_id,
      penalty_minutes,
      penalty_type,
      assist1_player_id,
      assist2_player_id,
      is_power_play,
      is_short_handed,
      is_empty_net
    `)
    .eq('game_id', gameId)
    .is('deleted_at', null)
    .in('event_type', ['goal', 'penalty'])
    .order('period', { ascending: true })
    .order('game_time_seconds', { ascending: true });

  // Collect all player IDs for name lookup
  const playerIds = new Set<string>();
  for (const event of events || []) {
    playerIds.add(event.player_id);
    if (event.assist1_player_id) playerIds.add(event.assist1_player_id);
    if (event.assist2_player_id) playerIds.add(event.assist2_player_id);
  }

  // Fetch player names
  const playerNameMap: Record<string, string> = {};
  if (playerIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(playerIds));

    for (const p of profiles || []) {
      playerNameMap[p.id] = p.full_name || 'Unknown';
    }
  }

  const getPlayer = (id: string) => ({
    id,
    name: playerNameMap[id] || 'Unknown',
  });

  // Build goals and penalties arrays
  const goals: GameSheetGoal[] = [];
  const penalties: GameSheetPenalty[] = [];

  for (const event of events || []) {
    if (event.event_type === 'goal') {
      goals.push({
        period: event.period,
        time: formatGameTime(event.game_time_seconds),
        scorer: getPlayer(event.player_id),
        assist1: event.assist1_player_id ? getPlayer(event.assist1_player_id) : null,
        assist2: event.assist2_player_id ? getPlayer(event.assist2_player_id) : null,
        team_id: event.team_id,
        team_name: teamNameMap[event.team_id] || 'Unknown',
        is_power_play: event.is_power_play || false,
        is_short_handed: event.is_short_handed || false,
        is_empty_net: event.is_empty_net || false,
      });
    } else if (event.event_type === 'penalty') {
      penalties.push({
        period: event.period,
        time: formatGameTime(event.game_time_seconds),
        player: getPlayer(event.player_id),
        team_id: event.team_id,
        team_name: teamNameMap[event.team_id] || 'Unknown',
        infraction: event.penalty_type || 'Minor',
        minutes: event.penalty_minutes || 2,
      });
    }
  }

  // Fetch goalie stats for this game
  const { data: goalieRows } = await supabase
    .from('goalie_stats')
    .select(`
      player_id,
      team_id,
      saves,
      goals_against,
      shots_against,
      player:profiles!goalie_stats_player_id_fkey(full_name)
    `)
    .eq('game_id', gameId);

  const goalies: GameSheetGoalie[] = (goalieRows || []).map((row: any) => {
    const playerData = Array.isArray(row.player) ? row.player[0] : row.player;
    const saves = row.saves || 0;
    const goalsAgainst = row.goals_against || 0;
    const shotsAgainst = row.shots_against || saves + goalsAgainst;
    return {
      player_id: row.player_id,
      player_name: playerData?.full_name || 'Unknown',
      team_id: row.team_id,
      team_name: teamNameMap[row.team_id] || 'Unknown',
      saves,
      goals_against: goalsAgainst,
      shots_against: shotsAgainst,
      save_percentage: shotsAgainst > 0
        ? Math.round((saves / shotsAgainst) * 1000) / 10
        : 0,
    };
  });

  // Fetch scoresheet photos for this game (most recent first)
  const { data: scoresheetRows } = await supabase
    .from('game_scoresheets' as any)
    .select('image_url')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(8);

  const scoresheetImageUrls: string[] = (scoresheetRows || [])
    .map((row: any) => (typeof row?.image_url === 'string' ? row.image_url : null))
    .filter((url: string | null): url is string => !!url);
  const scoresheetImageUrl: string | null = scoresheetImageUrls[0] ?? null;

  return { game, goals, penalties, goalies, scoresheetImageUrl, scoresheetImageUrls };
}

// ========== GAME PLAYER STATS (BOX SCORE) ==========
export async function getGamePlayerStats(gameId: string): Promise<GamePlayerStats[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('player_stats')
    .select(`
      game:games!player_stats_game_id_fkey(season_id),
      player_id,
      team_id,
      goals,
      assists,
      shots,
      penalty_minutes,
      plus_minus,
      power_play_goals,
      power_play_assists,
      short_handed_goals,
      short_handed_assists,
      empty_net_goals,
      game_winning_goals,
      player:profiles!player_stats_player_id_fkey(full_name, avatar_url, photo_url),
      team:teams!player_stats_team_id_fkey(name)
    `)
    .eq('game_id', gameId);

  if (error || !data) return [];

  // Also get jersey numbers from team_rosters
  const playerIds = data.map((row: any) => row.player_id);
  const teamIds = [...new Set(data.map((row: any) => row.team_id))];
  const seasonIds = [...new Set(data.map((row: any) => row.game?.season_id).filter(Boolean))];

  let rosterQuery = supabase
    .from('team_rosters')
    .select('player_id, jersey_number, position, season_id')
    .in('player_id', playerIds)
    .in('team_id', teamIds);

  if (seasonIds.length > 0) {
    rosterQuery = rosterQuery.in('season_id', seasonIds);
  }

  const { data: rosterRows } = await rosterQuery;

  const rosterMap: Record<string, { jersey_number: string | null; position: string | null }> = {};
  for (const r of rosterRows || []) {
    rosterMap[`${r.player_id}:${r.season_id ?? 'any'}`] = {
      jersey_number: r.jersey_number != null ? String(r.jersey_number) : null,
      position: r.position || null,
    };
  }

  return data.map((row: any) => {
    const playerData = Array.isArray(row.player) ? row.player[0] : row.player;
    const teamData = Array.isArray(row.team) ? row.team[0] : row.team;
    const roster = rosterMap[`${row.player_id}:${row.game?.season_id ?? 'any'}`] || rosterMap[`${row.player_id}:any`];
    const goals = row.goals || 0;
    const assists = row.assists || 0;
    return {
      player_id: row.player_id,
      player_name: playerData?.full_name || 'Unknown',
      avatar_url: resolvePlayerPhotoUrl(playerData),
      team_id: row.team_id,
      team_name: teamData?.name || 'Unknown',
      jersey_number: roster?.jersey_number || null,
      position: roster?.position || null,
      goals,
      assists,
      points: goals + assists,
      shots: row.shots || 0,
      penalty_minutes: row.penalty_minutes || 0,
      plus_minus: row.plus_minus || 0,
      power_play_goals: row.power_play_goals || 0,
      power_play_assists: row.power_play_assists || 0,
      short_handed_goals: row.short_handed_goals || 0,
      short_handed_assists: row.short_handed_assists || 0,
      empty_net_goals: row.empty_net_goals || 0,
      game_winning_goals: row.game_winning_goals || 0,
    };
  });
}

// ========== PLAYER BADGES ==========
export async function getPlayerBadges(playerId: string): Promise<PlayerBadge[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('player_badges')
    .select('*, season:seasons(name), team:teams(name, logo_url, slug)')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as PlayerBadge[];
}

export async function getPlayerBadgesByIds(playerIds: string[]): Promise<Record<string, PlayerBadge[]>> {
  if (playerIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('player_badges')
    .select('*, season:seasons(name), team:teams(name, logo_url, slug)')
    .in('player_id', playerIds);
  if (error || !data) return {};
  const result: Record<string, PlayerBadge[]> = {};
  for (const badge of data as unknown as PlayerBadge[]) {
    if (!result[badge.player_id]) result[badge.player_id] = [];
    result[badge.player_id].push(badge);
  }
  return result;
}

export async function getSeasonBadges(leagueId: string, seasonId: string): Promise<PlayerBadge[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('player_badges')
    .select('*, season:seasons(name), team:teams(name, logo_url, slug)')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .order('badge_type', { ascending: true });
  if (error || !data) return [];
  return data as unknown as PlayerBadge[];
}

// ========== PLAYER vs GOALIE MATCHUPS ==========

export async function getPlayerGoalieMatchups(
  playerId: string,
  seasonId?: string
): Promise<{
  goalieId: string;
  goalieName: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  shootingPct: number | null;
}[]> {
  const supabase = await createClient();

  let query = supabase
    .from('player_goalie_matchups')
    .select('*, goalie:profiles!player_goalie_matchups_goalie_id_fkey(id, full_name)')
    .eq('player_id', playerId)
    .order('points', { ascending: false });

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row: any) => {
    const goalie = Array.isArray(row.goalie) ? row.goalie[0] : row.goalie;
    return {
      goalieId: row.goalie_id,
      goalieName: goalie?.full_name || 'Unknown Goalie',
      gamesPlayed: row.games_played,
      goals: row.goals,
      assists: row.assists,
      points: row.points,
      shots: row.shots,
      shootingPct: row.shooting_percentage,
    };
  });
}

// ========== CHAMPIONSHIP DETAILS ==========

export async function getChampionshipRoster(
  teamId: string,
  seasonId: string
): Promise<{ playerId: string; fullName: string; jerseyNumber: number | null; position: string | null; leadershipRole: string | null }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('team_rosters')
    .select('player_id, jersey_number, position, leadership_role, profile:profiles!team_rosters_player_id_fkey(full_name)')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .in('status', ['active', 'injured'])
    .order('jersey_number', { ascending: true });

  if (error || !data) return [];

  return data.map((row: any) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    return {
      playerId: row.player_id,
      fullName: profile?.full_name || 'Unknown Player',
      jerseyNumber: row.jersey_number,
      position: row.position,
      leadershipRole: row.leadership_role,
    };
  });
}

export async function getChampionshipGame(
  seasonId: string,
  championTeamId: string
): Promise<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; date: string } | null> {
  const supabase = await createClient();

  // Get the last completed game of the season involving the champion
  const { data, error } = await supabase
    .from('games')
    .select(`
      home_score,
      away_score,
      scheduled_at,
      home_team:teams!games_home_team_id_fkey(name),
      away_team:teams!games_away_team_id_fkey(name)
    `)
    .eq('season_id', seasonId)
    .eq('status', 'completed')
    .or(`home_team_id.eq.${championTeamId},away_team_id.eq.${championTeamId}`)
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  const homeTeam = Array.isArray(data.home_team) ? data.home_team[0] : data.home_team;
  const awayTeam = Array.isArray(data.away_team) ? data.away_team[0] : data.away_team;

  return {
    homeTeam: (homeTeam as any)?.name || 'Unknown',
    awayTeam: (awayTeam as any)?.name || 'Unknown',
    homeScore: data.home_score ?? 0,
    awayScore: data.away_score ?? 0,
    date: data.scheduled_at,
  };
}

// ========== LEGACY CHAMPION PHOTOS ==========

const LEGACY_CHAMPIONS: Record<string, { year: string; photo: string; teamName?: string }[]> = {
  woha: [
    { year: '1986-87', photo: '/leagues/woha/history/86_87.jpg' },
    { year: '1988-92', photo: '/leagues/woha/history/88_92.jpg' },
    { year: '1994-95', photo: '/leagues/woha/history/94_95.jpg' },
    { year: '1996-97', photo: '/leagues/woha/history/96_97.jpg' },
    { year: '1999-00', photo: '/leagues/woha/history/99_00.jpg' },
    { year: '2016-17', photo: '/leagues/woha/history/16_17.jpg' },
    { year: '2024-25', photo: '/leagues/woha/history/2025_champs_universal.jpg', teamName: 'Universal' },
  ],
};

export function getLegacyChampions(leagueSlug: string) {
  return LEGACY_CHAMPIONS[leagueSlug] || [];
}

export async function getGoaliePlayerMatchups(
  goalieId: string,
  seasonId?: string
): Promise<{
  playerId: string;
  playerName: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  shootingPct: number | null;
}[]> {
  const supabase = await createClient();

  let query = supabase
    .from('player_goalie_matchups')
    .select('*, player:profiles!player_goalie_matchups_player_id_fkey(id, full_name)')
    .eq('goalie_id', goalieId)
    .order('goals', { ascending: false });

  if (seasonId) {
    query = query.eq('season_id', seasonId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row: any) => {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    return {
      playerId: row.player_id,
      playerName: player?.full_name || 'Unknown Player',
      gamesPlayed: row.games_played,
      goals: row.goals,
      assists: row.assists,
      points: row.points,
      shots: row.shots,
      shootingPct: row.shooting_percentage,
    };
  });
}

// ============================================================================
// Custom Pages
// ============================================================================

export async function getCustomPage(leagueId: string, slug: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('custom_pages')
    .select('*')
    .eq('league_id', leagueId)
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (error || !data) return null;
  return data;
}

export async function getCustomPages(leagueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('custom_pages')
    .select('*')
    .eq('league_id', leagueId)
    .eq('is_published', true)
    .order('sort_order', { ascending: true });

  if (error) return [];
  return data ?? [];
}
