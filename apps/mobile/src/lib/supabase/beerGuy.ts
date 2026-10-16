import { publicSupabase, supabase } from './client';

export type BeerGuyAssignment = {
  id: string;
  version: number;
  player_id: string | null;
  status: 'pending';
  player_name: string | null;
  player_avatar_url: string | null;
};

type AssignedBeerGuyAssignment = BeerGuyAssignment & { player_id: string };

export type BeerGuyClaimMutation = {
  game_id: string;
  team_id: string;
  outcome: 'assigned_to_self' | 'taken' | 'claimed';
  assignment: AssignedBeerGuyAssignment;
};

export type BeerGuyCaptainMutation = {
  game_id: string;
  team_id: string;
  outcome: 'conflict' | 'already_clear' | 'cleared' | 'unchanged' | 'assigned' | 'reassigned';
  assignment: BeerGuyAssignment | null;
};

export type BeerGuyMutation = BeerGuyClaimMutation | BeerGuyCaptainMutation;

export type BeerGuyGameState = {
  game_id: string;
  team_id: string;
  caller_eligible: boolean;
  assignment: BeerGuyAssignment | null;
};

export type BeerGuyRosterPlayer = {
  player_id: string;
  full_name: string | null;
  avatar_url: string | null;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean;
};

export type BeerGuyUpcomingGame = {
  game_id: string;
  scheduled_at: string;
  assignment: BeerGuyAssignment | null;
};

export type BeerGuyHistoryEntry = {
  assignment_id: string;
  game_id: string;
  player_id: string;
  player_name: string;
  player_deleted: boolean;
  game_date: string;
};

export type BeerGuyTracker = {
  team_id: string;
  season_id: string;
  timezone: string;
  roster: BeerGuyRosterPlayer[];
  upcoming_games: BeerGuyUpcomingGame[];
  history: BeerGuyHistoryEntry[];
};

export type PublicBeerGuyAssignment = {
  game_id: string;
  team_id: string;
  player_id: string;
};

type RpcError = { message: string } | null;
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
};
type BeerGuyResult<T> = { data: T | null; error: string | null };

// PostgreSQL's uuid type accepts canonical UUIDs independently of RFC version
// bits. Do not reject UUIDv7 or imported UUIDs merely because they are not v1-v5.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSafeVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isAssignment(value: unknown): value is BeerGuyAssignment {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'version', 'player_id', 'status', 'player_name', 'player_avatar_url',
  ])) return false;
  return isUuid(value.id)
    && isSafeVersion(value.version)
    && (value.player_id === null || isUuid(value.player_id))
    && value.status === 'pending'
    && isNullableString(value.player_name)
    && isNullableString(value.player_avatar_url)
    && (value.player_id !== null
      || (value.player_name === null && value.player_avatar_url === null));
}

function isNullableAssignment(value: unknown): value is BeerGuyAssignment | null {
  return value === null || isAssignment(value);
}

function hasMutationShape(
  value: unknown,
  requestedGameId: string,
  requestedTeamId: string,
): value is Record<'game_id' | 'team_id' | 'outcome' | 'assignment', unknown> {
  return isRecord(value)
    && hasExactKeys(value, ['game_id', 'team_id', 'outcome', 'assignment'])
    && value.game_id === requestedGameId
    && value.team_id === requestedTeamId
    && isUuid(value.game_id)
    && isUuid(value.team_id);
}

function isPendingAssigned(value: unknown): value is AssignedBeerGuyAssignment {
  return isAssignment(value) && value.player_id !== null;
}

function isSelfClaimMutation(
  value: unknown,
  requestedGameId: string,
  requestedTeamId: string,
): value is BeerGuyClaimMutation {
  return hasMutationShape(value, requestedGameId, requestedTeamId)
    && (value.outcome === 'assigned_to_self' || value.outcome === 'taken' || value.outcome === 'claimed')
    && isPendingAssigned(value.assignment);
}

function isObservedAssignment(
  assignment: BeerGuyAssignment,
  expectedAssignmentId: string,
): boolean {
  return assignment.id === expectedAssignmentId;
}

function isCaptainMutation(
  value: unknown,
  requestedGameId: string,
  requestedTeamId: string,
  requestedPlayerId: string | null,
  expectedAssignmentId: string | null,
  expectedVersion: number | null,
): value is BeerGuyCaptainMutation {
  if (!hasMutationShape(value, requestedGameId, requestedTeamId) || typeof value.outcome !== 'string') return false;

  if (value.outcome === 'conflict') {
    if (!isNullableAssignment(value.assignment)) return false;
    if (value.assignment === null) return expectedAssignmentId !== null;
    if (expectedAssignmentId === null) return true;
    return value.assignment.id !== expectedAssignmentId || value.assignment.version !== expectedVersion;
  }

  if (requestedPlayerId === null) {
    if (value.outcome === 'already_clear') {
      if (expectedAssignmentId === null) return value.assignment === null;
      return isAssignment(value.assignment)
        && value.assignment.player_id === null
        && isObservedAssignment(value.assignment, expectedAssignmentId)
        && value.assignment.version === expectedVersion;
    }
    return value.outcome === 'cleared'
      && expectedAssignmentId !== null
      && expectedVersion !== null
      && isAssignment(value.assignment)
      && value.assignment.player_id === null
      && isObservedAssignment(value.assignment, expectedAssignmentId)
      && value.assignment.version > expectedVersion;
  }

  if (!isPendingAssigned(value.assignment) || value.assignment.player_id !== requestedPlayerId) return false;
  if (value.outcome === 'assigned') {
    if (expectedAssignmentId === null) return value.assignment.version === 1;
    return expectedVersion !== null
      && isObservedAssignment(value.assignment, expectedAssignmentId)
      && value.assignment.version > expectedVersion;
  }
  if (value.outcome === 'unchanged') {
    return expectedAssignmentId !== null
      && expectedVersion !== null
      && isObservedAssignment(value.assignment, expectedAssignmentId)
      && value.assignment.version >= expectedVersion;
  }
  return value.outcome === 'reassigned'
    && expectedAssignmentId !== null
    && expectedVersion !== null
    && isObservedAssignment(value.assignment, expectedAssignmentId)
    && value.assignment.version > expectedVersion;
}

function isGameState(value: unknown, requestedGameId: string, requestedTeamId: string): value is BeerGuyGameState {
  return isRecord(value)
    && hasExactKeys(value, ['game_id', 'team_id', 'caller_eligible', 'assignment'])
    && value.game_id === requestedGameId
    && value.team_id === requestedTeamId
    && isUuid(value.game_id)
    && isUuid(value.team_id)
    && typeof value.caller_eligible === 'boolean'
    && isNullableAssignment(value.assignment);
}

function isRosterPlayer(value: unknown): value is BeerGuyRosterPlayer {
  if (!isRecord(value) || !hasExactKeys(value, [
    'player_id', 'full_name', 'avatar_url', 'jersey_number', 'position', 'is_goalie',
  ])) return false;
  return isUuid(value.player_id)
    && isNullableString(value.full_name)
    && isNullableString(value.avatar_url)
    && (value.jersey_number === null || (typeof value.jersey_number === 'number' && Number.isSafeInteger(value.jersey_number)))
    && isNullableString(value.position)
    && typeof value.is_goalie === 'boolean';
}

function isUpcomingGame(value: unknown): value is BeerGuyUpcomingGame {
  return isRecord(value)
    && hasExactKeys(value, ['game_id', 'scheduled_at', 'assignment'])
    && isUuid(value.game_id)
    && typeof value.scheduled_at === 'string'
    && Number.isFinite(Date.parse(value.scheduled_at))
    && isNullableAssignment(value.assignment);
}

function isHistoryEntry(value: unknown): value is BeerGuyHistoryEntry {
  return isRecord(value)
    && hasExactKeys(value, [
      'assignment_id', 'game_id', 'player_id', 'player_name', 'player_deleted', 'game_date',
    ])
    && isUuid(value.assignment_id)
    && isUuid(value.game_id)
    && isUuid(value.player_id)
    && typeof value.player_name === 'string'
    && typeof value.player_deleted === 'boolean'
    && typeof value.game_date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value.game_date);
}

function isTracker(value: unknown, requestedTeamId: string): value is BeerGuyTracker {
  return isRecord(value)
    && hasExactKeys(value, [
      'team_id', 'season_id', 'timezone', 'roster', 'upcoming_games', 'history',
    ])
    && value.team_id === requestedTeamId
    && isUuid(value.team_id)
    && isUuid(value.season_id)
    && typeof value.timezone === 'string'
    && Array.isArray(value.roster)
    && value.roster.every(isRosterPlayer)
    && Array.isArray(value.upcoming_games)
    && value.upcoming_games.every(isUpcomingGame)
    && Array.isArray(value.history)
    && value.history.every(isHistoryEntry);
}

function isPublicAssignment(
  value: unknown,
  requestedGameId: string,
  requestedTeamId: string,
): value is PublicBeerGuyAssignment {
  return isRecord(value)
    && hasExactKeys(value, ['game_id', 'team_id', 'player_id'])
    && value.game_id === requestedGameId
    && isUuid(value.game_id)
    && value.team_id === requestedTeamId
    && isUuid(value.team_id)
    && isUuid(value.player_id);
}

async function runRpc<T>(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
  validate: (value: unknown) => value is T,
  allowNull = false,
): Promise<BeerGuyResult<T>> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) return { data: null, error: error.message };
    if (data === null && allowNull) return { data: null, error: null };
    if (!validate(data)) return { data: null, error: 'Invalid Beer Guy response' };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Beer Guy request failed' };
  }
}

const authenticatedRpc = supabase as unknown as RpcClient;
const publicRpc = publicSupabase as unknown as RpcClient;

export function claimBeerGuy(gameId: string, teamId: string): Promise<BeerGuyResult<BeerGuyClaimMutation>> {
  return runRpc(authenticatedRpc, 'beer_guy_claim', {
    p_game_id: gameId,
    p_team_id: teamId,
  }, (value): value is BeerGuyClaimMutation => isSelfClaimMutation(value, gameId, teamId));
}

export function manageBeerGuyAsCaptain(
  gameId: string,
  teamId: string,
  playerId: string | null,
  expectedAssignmentId: string | null,
  expectedVersion: number | null,
): Promise<BeerGuyResult<BeerGuyCaptainMutation>> {
  const hasObservedAssignment = expectedAssignmentId !== null;
  if (hasObservedAssignment !== (expectedVersion !== null)
      || (hasObservedAssignment && (!isUuid(expectedAssignmentId) || !isSafeVersion(expectedVersion)))) {
    return Promise.resolve({ data: null, error: 'Invalid Beer Guy assignment version' });
  }
  return runRpc(authenticatedRpc, 'beer_guy_captain_manage', {
    p_game_id: gameId,
    p_team_id: teamId,
    p_player_id: playerId,
    p_expected_assignment_id: expectedAssignmentId,
    p_expected_version: expectedVersion,
  }, (value): value is BeerGuyCaptainMutation => isCaptainMutation(
    value,
    gameId,
    teamId,
    playerId,
    expectedAssignmentId,
    expectedVersion,
  ));
}

export function getBeerGuyGameState(gameId: string, teamId: string): Promise<BeerGuyResult<BeerGuyGameState>> {
  return runRpc(authenticatedRpc, 'beer_guy_get_game_state', {
    p_game_id: gameId,
    p_team_id: teamId,
  }, (value): value is BeerGuyGameState => isGameState(value, gameId, teamId));
}

export function getBeerGuyTracker(teamId: string): Promise<BeerGuyResult<BeerGuyTracker>> {
  return runRpc(
    authenticatedRpc,
    'beer_guy_get_tracker',
    { p_team_id: teamId },
    (value): value is BeerGuyTracker => isTracker(value, teamId),
  );
}

export function getPublicNextBeerGuyAssignment(
  gameId: string,
  teamId: string,
): Promise<BeerGuyResult<PublicBeerGuyAssignment>> {
  return runRpc(
    publicRpc,
    'beer_guy_get_public_next_assignment',
    { p_team_id: teamId },
    (value): value is PublicBeerGuyAssignment => isPublicAssignment(value, gameId, teamId),
    true,
  );
}
