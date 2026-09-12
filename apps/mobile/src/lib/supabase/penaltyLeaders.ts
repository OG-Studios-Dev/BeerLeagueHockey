import { supabase } from './client';
import type { PlayerStatRow } from './data';
import { getTeamActiveSeason } from './team';

const PAGE_SIZE = 1000;
const PLAYER_STATS_SELECT = `
  id, player_id, team_id, game_id, league_id, season_id,
  goals, assists, penalty_minutes,
  player:profiles!player_stats_player_id_fkey(id, full_name, avatar_url),
  team:teams!player_stats_team_id_fkey(id, name, short_name),
  game:games!inner(id, league_id, season_id, status)
`;

type SourceRelation = Record<string, unknown>;
type SourceRow = {
  id: string;
  player_id: string;
  team_id: string;
  game_id: string;
  league_id: string;
  season_id: string;
  goals: number | null;
  assists: number | null;
  penalty_minutes: number | null;
  player: SourceRelation;
  team: SourceRelation;
  game: SourceRelation;
};

export type PenaltyLeaderRow = PlayerStatRow & {
  avatar_url: string | null;
  penalty_minutes: number;
};

export type PenaltyLeadersResult = {
  status: 'ready' | 'empty' | 'unavailable' | 'no-season';
  leaders: PenaltyLeaderRow[];
  unavailablePlayerCount: number;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label} in PIM stats`);
  return value;
}

function relation(value: unknown, label: string): SourceRelation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} relation in PIM stats`);
  return value as SourceRelation;
}

function sourceNumber(value: unknown, label: string): number {
  if (value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label} in PIM stats`);
  return value;
}

function nullablePim(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid penalty minutes in PIM stats');
  }
  return value;
}

async function readAllRows(leagueId: string, seasonId: string): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  let expectedCount: number | null = null;
  let offset = 0;
  let previousId: string | null = null;

  while (expectedCount === null || offset < expectedCount) {
    const { data, error, count } = await supabase
      .from('player_stats')
      .select(PLAYER_STATS_SELECT, { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('game.league_id', leagueId)
      .eq('game.season_id', seasonId)
      .eq('game.status', 'completed')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!Number.isSafeInteger(count) || (count ?? -1) < 0) throw new Error('PIM stats read did not return an exact count');
    const exactCount = count as number;
    if (expectedCount !== null && exactCount !== expectedCount) throw new Error('PIM stats changed while loading');
    expectedCount = exactCount;

    const page = (data ?? []) as unknown as SourceRow[];
    if (page.length === 0 && offset < exactCount) throw new Error('PIM stats pagination ended early');
    for (const row of page) {
      const id = requiredText(row.id, 'stat ID');
      if (previousId !== null && id.localeCompare(previousId) <= 0) throw new Error('PIM stats pagination was not stable');
      previousId = id;
      rows.push(row);
    }
    offset += page.length;
  }

  return rows;
}

export async function getPenaltyLeaders(leagueId: string, limit = 50): Promise<PenaltyLeadersResult> {
  const selected = await getTeamActiveSeason(leagueId);
  if (selected.error) throw new Error(selected.error);
  const season = selected.season;
  if (!season) return { status: 'no-season', leaders: [], unavailablePlayerCount: 0 };

  const sourceRows = await readAllRows(leagueId, season.id);
  if (sourceRows.length === 0) return { status: 'empty', leaders: [], unavailablePlayerCount: 0 };

  type TeamChoice = { id: string; name: string; shortName: string; appearances: number };
  type Aggregate = {
    playerId: string; playerName: string; avatarUrl: string | null; goals: number; assists: number;
    penaltyMinutes: number; pimAvailable: boolean; gameIds: Set<string>; teams: Map<string, TeamChoice>;
  };
  const aggregates = new Map<string, Aggregate>();
  const seenRecords = new Set<string>();

  for (const row of sourceRows) {
    const playerId = requiredText(row.player_id, 'player ID');
    const teamId = requiredText(row.team_id, 'team ID');
    const gameId = requiredText(row.game_id, 'game ID');
    if (row.league_id !== leagueId || row.season_id !== season.id) throw new Error('Mismatched PIM stat scope');

    const player = relation(row.player, 'player');
    const team = relation(row.team, 'team');
    const game = relation(row.game, 'game');
    if (player.id !== playerId || team.id !== teamId || game.id !== gameId
      || game.league_id !== leagueId || game.season_id !== season.id || game.status !== 'completed') {
      throw new Error('Mismatched PIM stat identity');
    }

    const recordKey = `${playerId}\u0000${gameId}\u0000${teamId}`;
    if (seenRecords.has(recordKey)) continue;
    seenRecords.add(recordKey);

    const playerName = requiredText(player.full_name, 'player name');
    const teamName = requiredText(team.name, 'team name');
    const shortName = typeof team.short_name === 'string' && team.short_name.length > 0 ? team.short_name : teamName;
    const avatarUrl = typeof player.avatar_url === 'string' ? player.avatar_url : null;
    const aggregate = aggregates.get(playerId) ?? {
      playerId, playerName, avatarUrl, goals: 0, assists: 0, penaltyMinutes: 0,
      pimAvailable: true, gameIds: new Set<string>(), teams: new Map<string, TeamChoice>(),
    };
    if (aggregate.playerName !== playerName) throw new Error('Conflicting player identity in PIM stats');
    aggregate.goals += sourceNumber(row.goals, 'goals');
    aggregate.assists += sourceNumber(row.assists, 'assists');
    const pim = nullablePim(row.penalty_minutes);
    if (pim === null) aggregate.pimAvailable = false;
    else aggregate.penaltyMinutes += pim;
    aggregate.gameIds.add(gameId);
    const teamChoice = aggregate.teams.get(teamId) ?? { id: teamId, name: teamName, shortName, appearances: 0 };
    teamChoice.appearances += 1;
    aggregate.teams.set(teamId, teamChoice);
    aggregates.set(playerId, aggregate);
  }

  const unavailablePlayerCount = [...aggregates.values()].filter((entry) => !entry.pimAvailable).length;
  const leaders = [...aggregates.values()]
    .filter((entry) => entry.pimAvailable)
    .map((entry): PenaltyLeaderRow => {
      const team = [...entry.teams.values()].sort((left, right) =>
        right.appearances - left.appearances || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))[0];
      if (!team) throw new Error('Missing team identity in PIM stats');
      return {
        player_id: entry.playerId, player_name: entry.playerName, avatar_url: entry.avatarUrl,
        team_id: team.id, team_name: team.name, team_short_name: team.shortName,
        position: null, is_goalie: false, jersey_number: null,
        goals: entry.goals, assists: entry.assists, points: entry.goals + entry.assists,
        plus_minus: 0, games_played: entry.gameIds.size, penalty_minutes: entry.penaltyMinutes,
      };
    })
    .sort((left, right) => right.penalty_minutes - left.penalty_minutes
      || left.player_name.localeCompare(right.player_name) || left.player_id.localeCompare(right.player_id))
    .slice(0, Math.max(0, limit));

  return { status: leaders.length > 0 ? 'ready' : 'unavailable', leaders, unavailablePlayerCount };
}
