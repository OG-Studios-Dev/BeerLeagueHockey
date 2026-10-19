import {
  aggregatePublicSeasonStats,
  PublicMetricDataError,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';
import type { createClient } from '@/lib/supabase/server';

type FactRecord = Record<string, unknown>;
type FactsInput = {
  seasons: FactRecord[];
  games: FactRecord[];
  teams: FactRecord[];
  profiles: FactRecord[];
  rosters: FactRecord[];
  checkins: FactRecord[];
  availabilities: FactRecord[];
  acceptedSubs: FactRecord[];
  playerStats: FactRecord[];
  goalieStats: FactRecord[];
  goalieAppearances: FactRecord[];
  baselines: FactRecord[];
  teamPlayerSignals: FactRecord[];
  teamGoalieSignals: FactRecord[];
};

type QueryFilter =
  | { method: 'eq' | 'is'; column: string; value: unknown }
  | { method: 'in'; column: string; value: unknown[] }
  | { method: 'or'; expression: string };

function getPath(row: FactRecord, column: string): unknown {
  return column.split('.').reduce<unknown>((value, segment) => (
    value && typeof value === 'object' ? (value as FactRecord)[segment] : undefined
  ), row);
}

function splitOr(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') depth += 1;
    if (expression[index] === ')') depth -= 1;
    if (expression[index] === ',' && depth === 0) {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts.filter(Boolean);
}

function matchesOr(row: FactRecord, expression: string): boolean {
  return splitOr(expression).some((condition) => {
    const inMatch = /^([a-z0-9_.]+)\.in\.\((.*)\)$/i.exec(condition);
    if (inMatch) return inMatch[2].split(',').includes(String(getPath(row, inMatch[1])));
    const eqMatch = /^([a-z0-9_.]+)\.eq\.(.*)$/i.exec(condition);
    if (eqMatch) return String(getPath(row, eqMatch[1])) === eqMatch[2];
    throw new PublicMetricDataError(`unsupported mobile profile fact filter: ${condition}`);
  });
}

function metricValue(value: { value: number | null }): number {
  return typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : 0;
}

function deriveSeasonStats(facts: FactsInput): FactRecord[] {
  const gamesById = new Map(facts.games.map((game) => [String(game.id), game]));
  const teamsById = new Map(facts.teams.map((team) => [String(team.id), team]));
  const result: FactRecord[] = [];
  for (const season of facts.seasons) {
    const seasonId = String(season.id);
    const leagueId = String(season.league_id);
    const seasonGames = facts.games.filter((game) => game.season_id === seasonId && game.status === 'completed');
    const seasonGameIds = new Set(seasonGames.map((game) => String(game.id)));
    const teamIds = new Set<string>();
    for (const roster of facts.rosters) if (roster.season_id === seasonId) teamIds.add(String(roster.team_id));
    for (const stat of [...facts.playerStats, ...facts.goalieStats]) {
      if (stat.season_id === seasonId && stat.team_id) teamIds.add(String(stat.team_id));
    }
    for (const checkin of facts.checkins) {
      const game = gamesById.get(String(checkin.game_id));
      if (game?.season_id === seasonId) teamIds.add(String(checkin.team_id));
    }
    for (const sub of facts.acceptedSubs) {
      if (seasonGameIds.has(String(sub.game_id))) teamIds.add(String(sub.team_id));
    }

    for (const teamId of teamIds) {
      const goalieStats = facts.goalieStats.filter((row) => (
        row.season_id === seasonId && row.team_id === teamId && typeof row.game_id === 'string'
      ));
      const rows: PublicStatMetricRows = {
        games: seasonGames as PublicStatMetricRows['games'],
        teams: facts.teams as PublicStatMetricRows['teams'],
        profiles: facts.profiles as PublicStatMetricRows['profiles'],
        rosters: facts.rosters.filter((row) => row.season_id === seasonId) as PublicStatMetricRows['rosters'],
        checkins: facts.checkins.filter((row) => seasonGameIds.has(String(row.game_id))) as PublicStatMetricRows['checkins'],
        availabilities: facts.availabilities.filter((row) => row.season_id === seasonId) as PublicStatMetricRows['availabilities'],
        acceptedSubs: facts.acceptedSubs.filter((row) => seasonGameIds.has(String(row.game_id))) as PublicStatMetricRows['acceptedSubs'],
        playerStats: facts.playerStats.filter((row) => row.season_id === seasonId) as PublicStatMetricRows['playerStats'],
        goalieStats: goalieStats as PublicStatMetricRows['goalieStats'],
        goalieAppearances: facts.goalieAppearances.filter((row) => seasonGameIds.has(String(row.game_id))) as PublicStatMetricRows['goalieAppearances'],
      };
      const player = aggregatePublicSeasonStats(rows, { leagueId, seasonId, teamId }).players[0];
      if (!player) continue;
      const roster = facts.rosters.find((row) => row.season_id === seasonId && row.team_id === teamId);
      result.push({
        player_id: player.playerId,
        season_id: seasonId,
        team_id: teamId,
        team_name: teamsById.get(teamId)?.name ?? player.displayTeam?.name ?? null,
        position: roster?.position ?? null,
        games_played: metricValue(player.metrics.gamesPlayed),
        goals: metricValue(player.metrics.goals),
        assists: metricValue(player.metrics.assists),
        points: metricValue(player.metrics.points),
      });
    }
  }
  return result;
}

function hydrateRows(table: string, facts: FactsInput, seasonStats: FactRecord[]): FactRecord[] {
  const games = new Map(facts.games.map((game) => [String(game.id), game]));
  const teams = new Map(facts.teams.map((team) => [String(team.id), team]));
  const game = (id: unknown) => {
    const source = games.get(String(id));
    if (!source) return null;
    return {
      ...source,
      home_team: teams.get(String(source.home_team_id)) ?? null,
      away_team: teams.get(String(source.away_team_id)) ?? null,
    };
  };

  if (table === 'seasons') return facts.seasons;
  if (table === 'games') return facts.games.map((row) => game(row.id) as FactRecord);
  if (table === 'teams') return facts.teams;
  if (table === 'profiles') return facts.profiles;
  if (table === 'team_rosters') return facts.rosters.map((row) => ({ ...row, team: teams.get(String(row.team_id)) ?? null }));
  if (table === 'game_checkins') return facts.checkins.map((row) => ({ ...row, game: game(row.game_id) }));
  if (table === 'player_availability') return facts.availabilities.map((row) => ({ ...row, game: game(row.game_id) }));
  if (table === 'sub_invitations') return facts.acceptedSubs.map((row) => ({ ...row, game: game(row.game_id) }));
  if (table === 'player_stats') {
    const selected: FactRecord[] = facts.playerStats.map((row) => ({ ...row, game: game(row.game_id) }));
    const selectedIds = new Set(selected.map((row) => row.id));
    return [
      ...selected,
      ...facts.teamPlayerSignals.filter((row) => !selectedIds.has(row.id)).map((row) => ({ ...row, game: game(row.game_id) })),
    ];
  }
  if (table === 'goalie_stats') {
    const selected: FactRecord[] = facts.goalieStats.map((row) => ({ ...row, game: game(row.game_id) }));
    const selectedIds = new Set(selected.map((row) => row.id));
    return [
      ...selected,
      ...facts.teamGoalieSignals.filter((row) => !selectedIds.has(row.id)).map((row) => ({ ...row, game: game(row.game_id) })),
    ];
  }
  if (table === 'game_goalie_appearances') return facts.goalieAppearances;
  if (table === 'player_career_baselines') return facts.baselines;
  if (table === 'player_season_stats') return seasonStats;
  throw new PublicMetricDataError(`unsupported mobile profile fact table: ${table}`);
}

export function createMobileProfileFactsClient(input: FactsInput): Awaited<ReturnType<typeof createClient>> {
  const facts: FactsInput = Object.fromEntries(Object.entries(input).map(([name, rows]) => (
    [name, rows.map((row) => ({ ...row }))]
  ))) as FactsInput;
  let seasonStats: FactRecord[] | null = null;
  const client = {
    from(table: string) {
      let selectOptions: { count?: string; head?: boolean } | undefined;
      const filters: QueryFilter[] = [];
      const orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = [];
      let rowLimit: number | null = null;
      const query: Record<string, unknown> = {};
      query.select = (_columns: string, options?: { count?: string; head?: boolean }) => {
        selectOptions = options;
        return query;
      };
      query.eq = (column: string, value: unknown) => { filters.push({ method: 'eq', column, value }); return query; };
      query.is = (column: string, value: unknown) => { filters.push({ method: 'is', column, value }); return query; };
      query.in = (column: string, value: unknown[]) => { filters.push({ method: 'in', column, value }); return query; };
      query.or = (expression: string) => { filters.push({ method: 'or', expression }); return query; };
      query.order = (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        orders.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst });
        return query;
      };
      query.limit = (value: number) => { rowLimit = value; return query; };

      const execute = async (kind: 'many' | 'single' | 'maybeSingle', range?: [number, number]) => {
        const derivedSeasonStats = table === 'player_season_stats'
          ? seasonStats ??= deriveSeasonStats(facts)
          : [];
        let rows = hydrateRows(table, facts, derivedSeasonStats).filter((row) => filters.every((filter) => {
          if (filter.method === 'or') return matchesOr(row, filter.expression);
          const actual = getPath(row, filter.column);
          if (filter.method === 'in') return filter.value.includes(actual);
          return actual === filter.value;
        }));
        for (const order of [...orders].reverse()) {
          rows.sort((left, right) => {
            const a = getPath(left, order.column);
            const b = getPath(right, order.column);
            if (a === b) return 0;
            if (a === null || a === undefined) return order.nullsFirst ? -1 : 1;
            if (b === null || b === undefined) return order.nullsFirst ? 1 : -1;
            const comparison = String(a).localeCompare(String(b), 'en');
            return order.ascending ? comparison : -comparison;
          });
        }
        const count = rows.length;
        if (rowLimit !== null) rows = rows.slice(0, rowLimit);
        if (range) rows = rows.slice(range[0], range[1] + 1);
        if (selectOptions?.head) return { data: null, error: null, count };
        if (kind === 'single' || kind === 'maybeSingle') {
          if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' }, count };
          if (kind === 'single' && rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'no rows' }, count };
          return { data: rows[0] ?? null, error: null, count: selectOptions?.count === 'exact' ? count : null };
        }
        return { data: rows, error: null, count: selectOptions?.count === 'exact' ? count : null };
      };
      query.range = (from: number, to: number) => execute('many', [from, to]);
      query.single = () => execute('single');
      query.maybeSingle = () => execute('maybeSingle');
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute('many').then(resolve, reject);
      return query;
    },
  };
  return client as unknown as Awaited<ReturnType<typeof createClient>>;
}
