import {
  getPlayerCareerStatsTimeline,
  getPlayerGameLog,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { createMobileProfileFactsClient } from '@/lib/mobile-profile-facts-client';
import { getLeagueDateKey } from '@/lib/league-timezone';
import {
  aggregatePublicSeasonStats,
  PublicMetricDataError,
  PublicMetricLimitError,
  type PublicMetricAcceptedSubRow,
  type PublicMetricAvailabilityRow,
  type PublicMetricCheckinRow,
  type PublicMetricGameRow,
  type PublicMetricGoalieAppearanceRow,
  type PublicMetricGoalieStatRow,
  type PublicMetricPlayerStatRow,
  type PublicMetricProfileRow,
  type PublicMetricRosterRow,
  type PublicMetricTeamRow,
  type PublicSeasonMetricPlayer,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';
import { createStrictServiceRoleClient } from '@/lib/supabase/strict-service-role';
import type { PlayerGameLogEntry } from '@/lib/types';

export const MOBILE_PROFILE_RPC_NAME = 'mobile_profile_phase_facts_v1';
export const MOBILE_PROFILE_RPC_SCHEMA_VERSION = 'mobile_profile_phase_facts_v1';
export const MOBILE_PROFILE_RPC_SOURCE_CAP = 5_000;
export const MOBILE_PROFILE_RPC_TOTAL_CAP = 5_000;
export const MOBILE_PROFILE_RPC_MAX_SERIALIZED_BYTES = 8 * 1024 * 1024;

export type MobileProfileFactPhase = 'selected_stats' | 'timeline' | 'game_log';

type FactSeason = { id: string; league_id: string; name: string; start_date: string | null };
type FactGame = PublicMetricGameRow & { location?: string | null };
type FactTeam = PublicMetricTeamRow & { slug?: string | null };
type FactPlayerStat = PublicMetricPlayerStatRow & { created_at?: string | null };
type FactGoalieStat = Omit<PublicMetricGoalieStatRow, 'game_id' | 'team_id'> & {
  game_id: string | null;
  team_id: string | null;
  game_result: string | null;
};
type FactBaseline = {
  league_id: string;
  player_id: string;
  source_system: string;
  source_batch_id: string;
  games_played: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
  wins: number | null;
  ties: number | null;
  saves: number | null;
  goals_against: number | null;
  shutouts: number | null;
  save_percentage: number | null;
  goals_against_average: number | null;
};
type TeamSignal = { id: string; game_id: string; team_id: string; season_id: string };

export type MobileProfileSelectedStatsFacts = PublicStatMetricRows;
export type MobileProfileTimelineFacts = {
  seasons: FactSeason[];
  games: FactGame[];
  teams: FactTeam[];
  profiles: PublicMetricProfileRow[];
  rosters: PublicMetricRosterRow[];
  checkins: PublicMetricCheckinRow[];
  availabilities: PublicMetricAvailabilityRow[];
  acceptedSubs: PublicMetricAcceptedSubRow[];
  playerStats: FactPlayerStat[];
  goalieStats: FactGoalieStat[];
  goalieAppearances: PublicMetricGoalieAppearanceRow[];
  baselines: FactBaseline[];
  teamPlayerSignals: TeamSignal[];
  teamGoalieSignals: TeamSignal[];
};
export type MobileProfileGameLogFacts = MobileProfileTimelineFacts;

type PhaseFacts = {
  selected_stats: MobileProfileSelectedStatsFacts;
  timeline: MobileProfileTimelineFacts;
  game_log: MobileProfileGameLogFacts;
};
type Scope = { leagueId: string; playerId: string; seasonId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECTED_SOURCES = [
  'games', 'teams', 'profiles', 'rosters', 'checkins', 'availabilities', 'acceptedSubs',
  'playerStats', 'goalieStats', 'goalieAppearances',
] as const;
const COMMON_SOURCES = [
  'seasons', ...SELECTED_SOURCES, 'baselines', 'teamPlayerSignals', 'teamGoalieSignals',
] as const;

const KEYS = {
  seasons: ['id', 'league_id', 'name', 'start_date'],
  games: ['id', 'league_id', 'season_id', 'status', 'home_team_id', 'away_team_id', 'home_score', 'away_score', 'scheduled_at', 'location', 'penalty_capture_status', 'goalie_capture_status', 'skater_capture_status'],
  teams: ['id', 'league_id', 'division_id', 'name', 'slug'],
  profiles: ['id', 'full_name', 'avatar_url', 'photo_url'],
  rosters: ['id', 'player_id', 'team_id', 'league_id', 'season_id', 'start_date', 'end_date', 'is_goalie', 'position', 'status', 'player_type', 'historical_retained', 'games_played_override'],
  checkins: ['id', 'game_id', 'player_id', 'team_id', 'status'],
  availabilities: ['id', 'game_id', 'player_id', 'team_id', 'season_id', 'status'],
  acceptedSubs: ['id', 'game_id', 'invited_player_id', 'team_id', 'status'],
  playerStats: ['id', 'game_id', 'player_id', 'team_id', 'league_id', 'season_id', 'goals', 'assists', 'penalty_minutes', 'scorekeeping_provenance', 'created_at'],
  goalieStats: ['id', 'game_id', 'player_id', 'team_id', 'league_id', 'season_id', 'game_result', 'saves', 'shots_against', 'goals_against', 'shutout', 'scorekeeping_provenance'],
  goalieAppearances: ['game_id', 'player_id', 'team_id', 'team_type'],
  baselines: ['league_id', 'player_id', 'source_system', 'source_batch_id', 'games_played', 'goals', 'assists', 'points', 'wins', 'ties', 'saves', 'goals_against', 'shutouts', 'save_percentage', 'goals_against_average'],
  teamPlayerSignals: ['id', 'game_id', 'team_id', 'season_id'],
  teamGoalieSignals: ['id', 'game_id', 'team_id', 'season_id'],
} as const;

function fail(message: string): never {
  throw new PublicMetricDataError(`mobile profile RPC ${message}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((row, index) => object(row, `${label}[${index}]`));
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}
function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}
function id(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!UUID.test(parsed)) fail(`${label} must be a UUID`);
  return parsed;
}
function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : id(value, label);
}
function number(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}
function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== 'boolean') fail(`${label} must be boolean or null`);
  return value;
}
function provenance(value: unknown, label: string): 'event_derived' | null {
  if (value !== null && value !== 'event_derived') fail(`${label} must be event_derived or null`);
  return value as 'event_derived' | null;
}
function onlyKeys(row: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(row).find((key) => !allowed.includes(key));
  if (extra) fail(`${label} contains unexpected field ${extra}`);
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
}

function parseEnvelope<Phase extends MobileProfileFactPhase>(
  raw: unknown,
  expected: { phase: Phase } & Scope,
): PhaseFacts[Phase] {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    fail('bundle is not serializable');
  }
  if (new TextEncoder().encode(serialized!).byteLength > MOBILE_PROFILE_RPC_MAX_SERIALIZED_BYTES) {
    throw new PublicMetricLimitError('mobile profile RPC bundle byte limit exceeded');
  }
  const envelope = object(raw, 'bundle');
  onlyKeys(envelope, ['schema_version', 'phase', 'scope', 'limits', 'counts', 'facts'], 'bundle');
  if (envelope.schema_version !== MOBILE_PROFILE_RPC_SCHEMA_VERSION) fail('schema version mismatch');
  if (envelope.phase !== expected.phase) fail('phase mismatch');
  const scope = object(envelope.scope, 'scope');
  onlyKeys(scope, ['league_id', 'player_id', 'season_id'], 'scope');
  if (scope.league_id !== expected.leagueId || scope.player_id !== expected.playerId || scope.season_id !== expected.seasonId) fail('scope mismatch');
  const limits = object(envelope.limits, 'limits');
  onlyKeys(limits, ['source_cap', 'total_cap'], 'limits');
  if (limits.source_cap !== MOBILE_PROFILE_RPC_SOURCE_CAP || limits.total_cap !== MOBILE_PROFILE_RPC_TOTAL_CAP) fail('cap metadata mismatch');

  const facts = object(envelope.facts, 'facts');
  const sourceNames = expected.phase === 'selected_stats' ? SELECTED_SOURCES : COMMON_SOURCES;
  if (JSON.stringify(Object.keys(facts).sort()) !== JSON.stringify([...sourceNames].sort())) fail('source schema mismatch');
  const counts = object(envelope.counts, 'counts');
  onlyKeys(counts, [...sourceNames, 'total'], 'counts');
  let total = 0;
  for (const source of sourceNames) {
    const sourceRows = rows(facts[source], `facts.${source}`);
    if (counts[source] !== sourceRows.length) fail(`${source} count mismatch`);
    if (sourceRows.length > MOBILE_PROFILE_RPC_SOURCE_CAP) throw new PublicMetricLimitError(`mobile profile RPC ${source} source row limit exceeded`);
    total += sourceRows.length;
  }
  if (counts.total !== total) fail('total count mismatch');
  if (total > MOBILE_PROFILE_RPC_TOTAL_CAP) throw new PublicMetricLimitError('mobile profile RPC total row limit exceeded');
  return facts as PhaseFacts[Phase];
}

function validateFacts(
  facts: MobileProfileTimelineFacts,
  scope: Scope,
  options: { allowOtherEvidencePlayers?: boolean; allowOtherGoaliePlayers?: boolean } = {},
): void {
  const raw = facts as unknown as Record<keyof typeof KEYS, Record<string, unknown>[]>;
  for (const source of Object.keys(KEYS) as Array<keyof typeof KEYS>) {
    for (const row of raw[source]) onlyKeys(row, KEYS[source], String(source));
  }

  for (const row of raw.seasons) {
    id(row.id, 'season.id');
    if (id(row.league_id, 'season.league_id') !== scope.leagueId) fail('cross-league season row');
    text(row.name, 'season.name');
    nullableText(row.start_date, 'season.start_date');
  }
  unique(raw.seasons.map((row) => String(row.id)), 'season id');
  const seasonIds = new Set(raw.seasons.map((row) => String(row.id)));
  if (scope.seasonId && !seasonIds.has(scope.seasonId)) fail('selected season missing');

  for (const row of raw.teams) {
    id(row.id, 'team.id');
    if (id(row.league_id, 'team.league_id') !== scope.leagueId) fail('cross-league team row');
    nullableId(row.division_id, 'team.division_id');
    text(row.name, 'team.name');
    nullableText(row.slug, 'team.slug');
  }
  unique(raw.teams.map((row) => String(row.id)), 'team id');
  const teamIds = new Set(raw.teams.map((row) => String(row.id)));

  for (const row of raw.games) {
    id(row.id, 'game.id');
    if (id(row.league_id, 'game.league_id') !== scope.leagueId || !seasonIds.has(id(row.season_id, 'game.season_id'))) fail('game scope mismatch');
    text(row.status, 'game.status');
    if (!teamIds.has(id(row.home_team_id, 'game.home_team_id')) || !teamIds.has(id(row.away_team_id, 'game.away_team_id'))) fail('game team missing');
    number(row.home_score, 'game.home_score');
    number(row.away_score, 'game.away_score');
    text(row.scheduled_at, 'game.scheduled_at');
    nullableText(row.location, 'game.location');
    nullableText(row.penalty_capture_status, 'game.penalty_capture_status');
    nullableText(row.goalie_capture_status, 'game.goalie_capture_status');
    nullableText(row.skater_capture_status, 'game.skater_capture_status');
  }
  unique(raw.games.map((row) => String(row.id)), 'game id');
  const games = new Map(raw.games.map((row) => [String(row.id), row]));

  for (const row of raw.profiles) {
    if (id(row.id, 'profile.id') !== scope.playerId) fail('cross-player profile row');
    nullableText(row.full_name, 'profile.full_name');
    nullableText(row.avatar_url, 'profile.avatar_url');
    nullableText(row.photo_url, 'profile.photo_url');
  }
  unique(raw.profiles.map((row) => String(row.id)), 'profile id');
  if (raw.profiles.length !== 1) fail('profile identity missing');

  for (const row of raw.rosters) {
    id(row.id, 'roster.id');
    const rosterPlayerId = id(row.player_id, 'roster.player_id');
    if ((!options.allowOtherEvidencePlayers && rosterPlayerId !== scope.playerId)
      || id(row.league_id, 'roster.league_id') !== scope.leagueId
      || !seasonIds.has(id(row.season_id, 'roster.season_id'))
      || !teamIds.has(id(row.team_id, 'roster.team_id'))) fail('roster composite mismatch');
    nullableText(row.start_date, 'roster.start_date');
    nullableText(row.end_date, 'roster.end_date');
    nullableBoolean(row.is_goalie, 'roster.is_goalie');
    nullableText(row.position, 'roster.position');
    text(row.status, 'roster.status');
    text(row.player_type, 'roster.player_type');
    nullableBoolean(row.historical_retained, 'roster.historical_retained');
    number(row.games_played_override, 'roster.games_played_override');
  }
  unique(raw.rosters.map((row) => String(row.id)), 'roster id');

  const gameTeamPlayer = (
    row: Record<string, unknown>,
    label: string,
    playerColumn = 'player_id',
    allowOtherPlayer = false,
  ) => {
    const game = games.get(id(row.game_id, `${label}.game_id`));
    const teamId = id(row.team_id, `${label}.team_id`);
    if (!game || (game.home_team_id !== teamId && game.away_team_id !== teamId)) fail(`${label} game/team composite mismatch`);
    if (!allowOtherPlayer && id(row[playerColumn], `${label}.${playerColumn}`) !== scope.playerId) fail(`${label} player mismatch`);
    if (allowOtherPlayer) id(row[playerColumn], `${label}.${playerColumn}`);
    return game;
  };

  const acceptedSubKeys = new Set<string>();
  for (const row of raw.acceptedSubs) {
    id(row.id, 'acceptedSub.id');
    gameTeamPlayer(row, 'accepted sub', 'invited_player_id', options.allowOtherEvidencePlayers);
    if (text(row.status, 'acceptedSub.status') !== 'accepted') fail('accepted sub status mismatch');
    acceptedSubKeys.add(`${row.game_id}:${row.team_id}:${row.invited_player_id}`);
  }
  unique(raw.acceptedSubs.map((row) => String(row.id)), 'accepted sub id');
  unique(raw.acceptedSubs.map((row) => `${row.game_id}:${row.invited_player_id}`), 'accepted sub game/player composite');

  const playerTeamAuthorized = (
    game: Record<string, unknown>,
    playerId: string,
    teamId: string,
  ): boolean => {
    if (acceptedSubKeys.has(`${game.id}:${teamId}:${playerId}`)) return true;
    const gameDate = getLeagueDateKey(String(game.scheduled_at));
    if (!gameDate) return false;
    return raw.rosters.some((roster) => roster.player_id === playerId
      && roster.team_id === teamId
      && roster.league_id === scope.leagueId
      && roster.season_id === game.season_id
      && roster.status === 'active'
      && roster.player_type === 'regular'
      && typeof roster.start_date === 'string'
      && roster.start_date.slice(0, 10) <= gameDate
      && (roster.end_date === null
        || (typeof roster.end_date === 'string' && roster.end_date.slice(0, 10) >= gameDate)));
  };

  const requirePlayerTeamAuthorization = (
    game: Record<string, unknown>,
    playerId: string,
    teamId: string,
    label: string,
  ): void => {
    if (!playerTeamAuthorized(game, playerId, teamId)) fail(`${label} player/team authorization missing`);
  };

  for (const row of raw.checkins) {
    id(row.id, 'checkin.id');
    const game = gameTeamPlayer(row, 'checkin', 'player_id', options.allowOtherEvidencePlayers);
    requirePlayerTeamAuthorization(game, String(row.player_id), String(row.team_id), 'checkin');
    text(row.status, 'checkin.status');
  }
  unique(raw.checkins.map((row) => String(row.id)), 'checkin id');
  unique(raw.checkins.map((row) => `${row.game_id}:${row.player_id}`), 'checkin game/player composite');

  for (const row of raw.availabilities) {
    id(row.id, 'availability.id');
    const game = gameTeamPlayer(row, 'availability', 'player_id', options.allowOtherEvidencePlayers);
    if (row.season_id !== game.season_id) fail('availability season/game composite mismatch');
    requirePlayerTeamAuthorization(game, String(row.player_id), String(row.team_id), 'availability');
    if (text(row.status, 'availability.status') !== 'out') fail('availability status mismatch');
  }
  unique(raw.availabilities.map((row) => String(row.id)), 'availability id');
  unique(raw.availabilities.map((row) => `${row.game_id}:${row.player_id}`), 'availability game/player composite');

  for (const row of raw.playerStats) {
    id(row.id, 'playerStat.id');
    const game = gameTeamPlayer(row, 'player stat');
    if (row.league_id !== scope.leagueId || row.season_id !== game.season_id) fail('player stat scope mismatch');
    requirePlayerTeamAuthorization(game, String(row.player_id), String(row.team_id), 'player stat');
    number(row.goals, 'playerStat.goals');
    number(row.assists, 'playerStat.assists');
    number(row.penalty_minutes, 'playerStat.penalty_minutes');
    provenance(row.scorekeeping_provenance, 'playerStat.scorekeeping_provenance');
    nullableText(row.created_at, 'playerStat.created_at');
  }
  unique(raw.playerStats.map((row) => String(row.id)), 'player stat id');
  unique(raw.playerStats.map((row) => `${row.game_id}:${row.player_id}`), 'player stat game/player composite');

  for (const row of raw.goalieStats) {
    id(row.id, 'goalieStat.id');
    const goaliePlayerId = id(row.player_id, 'goalieStat.player_id');
    if ((!options.allowOtherGoaliePlayers && goaliePlayerId !== scope.playerId) || row.league_id !== scope.leagueId
      || !seasonIds.has(id(row.season_id, 'goalieStat.season_id'))) fail('goalie stat scope mismatch');
    const gameId = nullableId(row.game_id, 'goalieStat.game_id');
    const teamId = nullableId(row.team_id, 'goalieStat.team_id');
    if (teamId && !teamIds.has(teamId)) fail('goalie stat team scope mismatch');
    nullableText(row.game_result, 'goalieStat.game_result');
    if (gameId) {
      const game = games.get(gameId);
      if (!game || row.season_id !== game.season_id || (teamId !== game.home_team_id && teamId !== game.away_team_id)) fail('goalie stat game/team composite mismatch');
      if (!teamId) fail('goalie stat game/team composite mismatch');
      requirePlayerTeamAuthorization(game, goaliePlayerId, teamId, 'goalie stat');
    }
    number(row.saves, 'goalieStat.saves');
    number(row.shots_against, 'goalieStat.shots_against');
    number(row.goals_against, 'goalieStat.goals_against');
    nullableBoolean(row.shutout, 'goalieStat.shutout');
    provenance(row.scorekeeping_provenance, 'goalieStat.scorekeeping_provenance');
  }
  unique(raw.goalieStats.map((row) => String(row.id)), 'goalie stat id');
  unique(raw.goalieStats.map((row) => `${row.game_id}:${row.player_id}`), 'goalie stat game/player composite');

  for (const row of raw.goalieAppearances) {
    const game = games.get(id(row.game_id, 'goalie appearance.game_id'));
    const goaliePlayerId = id(row.player_id, 'goalie appearance.player_id');
    const teamId = id(row.team_id, 'goalie appearance.team_id');
    if (!game || (game.home_team_id !== teamId && game.away_team_id !== teamId)) fail('goalie appearance game/team composite mismatch');
    if (!options.allowOtherGoaliePlayers && goaliePlayerId !== scope.playerId) fail('goalie appearance player mismatch');
    const side = text(row.team_type, 'goalieAppearance.team_type');
    if ((side !== 'home' && side !== 'away') || row.team_id !== (side === 'home' ? game.home_team_id : game.away_team_id)) fail('goalie appearance team conflict');
    requirePlayerTeamAuthorization(game, goaliePlayerId, teamId, 'goalie appearance');
  }
  unique(raw.goalieAppearances.map((row) => `${row.game_id}:${row.player_id}`), 'goalie appearance composite');

  for (const row of raw.baselines) {
    if (id(row.league_id, 'baseline.league_id') !== scope.leagueId || id(row.player_id, 'baseline.player_id') !== scope.playerId) fail('baseline scope mismatch');
    text(row.source_system, 'baseline.source_system');
    text(row.source_batch_id, 'baseline.source_batch_id');
    for (const key of KEYS.baselines.slice(4)) number(row[key], `baseline.${key}`);
  }
  if (raw.baselines.length > 1) fail('duplicate baseline row');

  for (const source of ['teamPlayerSignals', 'teamGoalieSignals'] as const) {
    for (const row of raw[source]) {
      id(row.id, `${source}.id`);
      const game = games.get(id(row.game_id, `${source}.game_id`));
      const teamId = id(row.team_id, `${source}.team_id`);
      if (!game || row.season_id !== game.season_id || (teamId !== game.home_team_id && teamId !== game.away_team_id)) fail(`${source} composite mismatch`);
      requirePlayerTeamAuthorization(game, scope.playerId, teamId, source);
    }
    unique(raw[source].map((row) => String(row.id)), `${source} id`);
  }
}

function validateSelectedFacts(facts: MobileProfileSelectedStatsFacts, scope: Scope): void {
  validateFacts({
    seasons: [{ id: scope.seasonId!, league_id: scope.leagueId, name: 'selected', start_date: null }],
    ...facts,
    baselines: [],
    teamPlayerSignals: [],
    teamGoalieSignals: [],
  } as MobileProfileTimelineFacts, scope, {
    allowOtherEvidencePlayers: true,
    allowOtherGoaliePlayers: true,
  });
  for (const goalie of facts.goalieStats) if (!goalie.game_id || !goalie.team_id) fail('selected goalie stat missing game/team identity');

  const evidencePlayerIds = new Set([scope.playerId]);
  for (const roster of facts.rosters) {
    const isGoalie = roster.is_goalie === true
      || ['g', 'goalie'].includes(String(roster.position ?? '').trim().toLowerCase());
    if (isGoalie) evidencePlayerIds.add(roster.player_id);
    else if (roster.player_id !== scope.playerId) fail('rosters contains a non-goalie cross-player row');
  }
  for (const row of facts.goalieStats) evidencePlayerIds.add(row.player_id);
  for (const row of facts.goalieAppearances) evidencePlayerIds.add(row.player_id);
  for (const row of facts.checkins) {
    if (!evidencePlayerIds.has(row.player_id)) fail('checkins contains unrelated cross-player evidence');
  }
  for (const row of facts.availabilities) {
    if (!evidencePlayerIds.has(row.player_id)) fail('availabilities contains unrelated cross-player evidence');
  }
  for (const row of facts.acceptedSubs) {
    if (!evidencePlayerIds.has(row.invited_player_id)) fail('acceptedSubs contains unrelated cross-player evidence');
  }
}

export async function readMobileProfilePhaseFacts<Phase extends MobileProfileFactPhase>(
  phase: Phase,
  leagueId: string,
  playerId: string,
  seasonId: string | null,
): Promise<PhaseFacts[Phase]> {
  const client = createStrictServiceRoleClient();
  const { data, error } = await client.rpc(MOBILE_PROFILE_RPC_NAME, {
    p_phase: phase,
    p_league_id: leagueId,
    p_player_id: playerId,
    p_season_id: seasonId,
  });
  if (error) throw error;
  const facts = parseEnvelope(data, { phase, leagueId, playerId, seasonId });
  if (phase === 'selected_stats') validateSelectedFacts(facts as MobileProfileSelectedStatsFacts, { leagueId, playerId, seasonId });
  else validateFacts(facts as MobileProfileTimelineFacts, { leagueId, playerId, seasonId });
  return facts;
}

export async function getMobileProfileSelectedSeasonPlayer(
  leagueId: string,
  seasonId: string,
  playerId: string,
): Promise<PublicSeasonMetricPlayer | null> {
  const facts = await readMobileProfilePhaseFacts('selected_stats', leagueId, playerId, seasonId);
  return aggregatePublicSeasonStats(facts, { leagueId, seasonId, playerId })
    .players.find((player) => player.playerId === playerId) ?? null;
}

export async function getMobileProfileTimeline(
  leagueId: string,
  playerId: string,
  isGoalie: boolean,
  includeHistoricalBaseline: boolean,
): Promise<PlayerCareerSeasonRow[]> {
  const facts = await readMobileProfilePhaseFacts('timeline', leagueId, playerId, null);
  const preloadedClient = createMobileProfileFactsClient(facts as unknown as Parameters<typeof createMobileProfileFactsClient>[0]);
  return getPlayerCareerStatsTimeline(leagueId, playerId, isGoalie, {
    includeHistoricalBaseline,
    strict: true,
    profileSafeStrictAppearanceHydration: true,
    profileSafeStrictAppearanceBatchConcurrency: 1,
    preloadedClient,
    preloadedServiceClient: preloadedClient,
  });
}

export async function getMobileProfileGameLog(
  leagueId: string,
  playerId: string,
  seasonId: string,
): Promise<PlayerGameLogEntry[]> {
  const facts = await readMobileProfilePhaseFacts('game_log', leagueId, playerId, seasonId);
  return getPlayerGameLog(playerId, seasonId, 20, {
    strict: true,
    strictBatchConcurrency: 1,
    strictEvidenceBatchConcurrency: 1,
    preloadedClient: createMobileProfileFactsClient(facts as unknown as Parameters<typeof createMobileProfileFactsClient>[0]),
  });
}
