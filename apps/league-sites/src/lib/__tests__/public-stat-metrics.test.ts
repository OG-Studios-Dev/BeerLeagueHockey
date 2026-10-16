import { NextRequest } from 'next/server';

import {
  aggregatePublicSeasonStats,
  handlePublicSeasonStatsRequest,
  loadPublicStatMetricRows,
  type PublicStatMetricRows,
  type PublicStatMetricsDependencies,
} from '@/lib/public-stat-metrics';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const OTHER_DIVISION_ID = '31000000-0000-4000-8000-000000000003';
const TEAM_A = '70000000-0000-4000-8000-000000000007';
const TEAM_B = '71000000-0000-4000-8000-000000000007';
const TEAM_C = '72000000-0000-4000-8000-000000000007';
const MATT = '40000000-0000-4000-8000-000000000004';
const ALEX = '41000000-0000-4000-8000-000000000004';
const GOALIE = '42000000-0000-4000-8000-000000000004';
const CASEY = '43000000-0000-4000-8000-000000000004';

const completedGames = Array.from({ length: 11 }, (_, index) => ({
  id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  league_id: LEAGUE_ID,
  season_id: SEASON_ID,
  status: 'completed',
  home_team_id: TEAM_A,
  away_team_id: TEAM_B,
  home_score: 3,
  away_score: 2,
  scheduled_at: `2026-09-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
  penalty_capture_status: index === 0 ? 'complete' as const : null,
  goalie_capture_status: index === 0 ? 'complete' as const : null,
}));

function rows(overrides: Partial<PublicStatMetricRows> = {}): PublicStatMetricRows {
  return {
    games: completedGames,
    teams: [
      { id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, name: 'Alpha' },
      { id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, name: 'Beta' },
    ],
    profiles: [
      { id: MATT, full_name: 'Matt', avatar_url: null, photo_url: null },
      { id: ALEX, full_name: 'Alex', avatar_url: null, photo_url: null },
      { id: GOALIE, full_name: 'Goal E.', avatar_url: null, photo_url: null },
    ],
    rosters: [
      { id: '90000000-0000-4000-8000-000000000001', player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-01-01', end_date: null, is_goalie: false, position: 'C' },
      { id: '90000000-0000-4000-8000-000000000002', player_id: GOALIE, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-01-01', end_date: null, is_goalie: true, position: 'Goalie' },
    ],
    checkins: completedGames.slice(0, 8).map((game, index) => ({
      id: `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      game_id: game.id, player_id: MATT, team_id: TEAM_A, status: 'confirmed',
    })),
    acceptedSubs: [],
    playerStats: [{
      id: 'b0000000-0000-4000-8000-000000000001', game_id: completedGames[8].id,
      player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID,
      goals: 15, assists: 10, penalty_minutes: 0,
    }],
    goalieStats: [],
    goalieAppearances: [],
    ...overrides,
  };
}

describe('aggregatePublicSeasonStats', () => {
  it('publishes Matt-shaped conflict without losing G/A/PTS or private attendance detail', () => {
    const source = rows();
    source.checkins.push({
      id: 'a0000000-0000-4000-8000-000000000099', game_id: completedGames[8].id,
      player_id: MATT, team_id: TEAM_A, status: 'out',
    });
    const payload = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    const matt = payload.players.find((player) => player.playerId === MATT)!;

    expect(matt.metrics.gamesPlayed).toEqual({
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'skater_stats', 'roster_window'],
      candidates: { confirmed: 8, recorded: 1 },
    });
    expect(matt.metrics.goals.value).toBe(15);
    expect(matt.metrics.assists.value).toBe(10);
    expect(matt.metrics.points.value).toBe(25);
    expect(JSON.stringify(payload)).not.toMatch(/checkin|scheduled_at|notes|actor|a0000000/);
  });

  it('excludes non-completed games and keeps unknown PIM distinct from verified zero', () => {
    const scheduled = { ...completedGames[0], id: '80000000-0000-4000-8000-999999999999', status: 'scheduled' };
    const source = rows({
      games: [completedGames[0], scheduled],
      rosters: [],
      checkins: [],
      playerStats: [
        { id: 'b0000000-0000-4000-8000-000000000001', game_id: completedGames[0].id, player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 0, assists: 0, penalty_minutes: 0, scorekeeping_provenance: 'event_derived' },
        { id: 'b0000000-0000-4000-8000-000000000002', game_id: scheduled.id, player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 99, assists: 99, penalty_minutes: 99 },
      ],
    });
    const complete = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    expect(complete.players[0].metrics.points.value).toBe(0);
    expect(complete.players[0].metrics.penaltyMinutes).toEqual({ value: 0, state: 'verified', sources: ['skater_stats', 'capture_confirmation'] });

    source.games[0] = { ...source.games[0], penalty_capture_status: null };
    const unknown = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    expect(unknown.players[0].metrics.penaltyMinutes).toEqual({ value: null, state: 'unknown', sources: ['skater_stats'] });
  });

  it('aggregates transfers before ranking and scopes team totals before aggregation', () => {
    const fixture = rows({
      games: completedGames.slice(0, 2), rosters: [], checkins: [], goalieStats: [],
      playerStats: [
        { id: 'b0000000-0000-4000-8000-000000000001', game_id: completedGames[0].id, player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 10, assists: 0, penalty_minutes: 0 },
        { id: 'b0000000-0000-4000-8000-000000000002', game_id: completedGames[1].id, player_id: MATT, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 9, assists: 0, penalty_minutes: 0 },
        { id: 'b0000000-0000-4000-8000-000000000003', game_id: completedGames[0].id, player_id: ALEX, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 15, assists: 0, penalty_minutes: 0 },
      ],
    });
    const league = aggregatePublicSeasonStats(fixture, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    expect(league.players.find((player) => player.playerId === MATT)?.metrics.points.value).toBe(19);
    expect(league.players).toHaveLength(2);

    const team = aggregatePublicSeasonStats(fixture, { leagueId: LEAGUE_ID, seasonId: SEASON_ID, teamId: TEAM_A });
    expect(team.players.find((player) => player.playerId === MATT)?.metrics.points.value).toBe(10);
    expect(team.players.every((player) => player.teams.length === 1 && player.teams[0].id === TEAM_A)).toBe(true);
  });

  it('keeps mixed goalie provenance per field and unions role-switch GP', () => {
    const fixture = rows({
      games: completedGames.slice(0, 2), checkins: [],
      rosters: [
        { id: '90000000-0000-4000-8000-000000000001', player_id: GOALIE, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: '2026-01-01', end_date: null, is_goalie: false, position: 'C' },
      ],
      playerStats: [{ id: 'b0000000-0000-4000-8000-000000000001', game_id: completedGames[1].id, player_id: GOALIE, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, goals: 1, assists: 0, penalty_minutes: 0 }],
      goalieStats: [{ id: 'c0000000-0000-4000-8000-000000000001', game_id: completedGames[0].id, player_id: GOALIE, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID, wins: 1, losses: 0, saves: 20, shots_against: 22, goals_against: 2, shutout: false, scorekeeping_provenance: 'event_derived' }],
      goalieAppearances: [{ game_id: completedGames[0].id, player_id: GOALIE, team_id: TEAM_B, team_type: 'away' }],
    });
    const payload = aggregatePublicSeasonStats(fixture, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    const goalie = payload.players.find((player) => player.playerId === GOALIE)!;
    expect(goalie.roles).toEqual(['skater', 'goalie']);
    expect(goalie.metrics.gamesPlayed.value).toBe(2);
    expect(goalie.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie.goalie?.gamesPlayed.value).toBe(1);

    const unmeasured = rows({ games: completedGames.slice(1, 2), checkins: [], playerStats: [], goalieStats: [] });
    const policyDetermined = aggregatePublicSeasonStats(unmeasured, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    const rosterGoalie = policyDetermined.players.find((player) => player.playerId === GOALIE)!;
    expect(rosterGoalie.goalie?.gamesPlayed.state).toBe('reported');
    expect(rosterGoalie.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('labels accepted substitutes as policy-determined appearances', () => {
    const fixture = rows({
      games: completedGames.slice(0, 1), rosters: [], checkins: [], playerStats: [], goalieStats: [],
      acceptedSubs: [{ id: 'd0000000-0000-4000-8000-000000000001', game_id: completedGames[0].id,
        invited_player_id: ALEX, team_id: TEAM_A, status: 'accepted' }],
    });
    const player = aggregatePublicSeasonStats(fixture, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0];
    expect(player.metrics.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['accepted_sub'] });
  });
});

describe('GET /api/public/season-stats v2', () => {
  function deps(): jest.Mocked<PublicStatMetricsDependencies> {
    return {
      getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE_ID, slug: 'hockey-life', status: 'active' }),
      hasPlatformSubscription: jest.fn().mockResolvedValue(true),
      readSeason: jest.fn().mockResolvedValue({ id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', status: 'active' }),
      getDivisions: jest.fn().mockResolvedValue([{ id: DIVISION_ID, league_id: LEAGUE_ID }]),
      readTeam: jest.fn().mockResolvedValue({ id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, name: 'Alpha' }),
      requirePrivilegedAccess: jest.fn(),
      loadRows: jest.fn().mockResolvedValue(rows()),
    };
  }

  const request = (query: string, host = 'hockey-life.beerleaguehockey.ca') => new NextRequest(
    `https://${host}/api/public/season-stats?${query}`,
    { headers: { host } },
  );

  it('serves the strict mobile DTO and validates tenant, season, division, and team before loading rows', async () => {
    const dependencies = deps();
    const response = await handlePublicSeasonStatsRequest(request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&divisionId=${DIVISION_ID}&teamId=${TEAM_A}&contractVersion=2`), dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      schemaVersion: 2, leagueId: LEAGUE_ID, leagueSlug: 'hockey-life', divisionId: DIVISION_ID,
      presentationSeason: { id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', status: 'active' },
    }));
    expect(dependencies.loadRows).toHaveBeenCalledWith({ leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: TEAM_A });

    const mismatchDeps = deps();
    const mismatch = await handlePublicSeasonStatsRequest(request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&contractVersion=2`, 'other.beerleaguehockey.ca'), mismatchDeps);
    expect(mismatch.status).toBe(400);
    expect(mismatchDeps.loadRows).not.toHaveBeenCalled();
  });

  it('fails closed on read errors and rejects v1/unversioned access', async () => {
    const dependencies = deps();
    dependencies.loadRows.mockRejectedValue(new Error('private provider detail'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await handlePublicSeasonStatsRequest(request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&contractVersion=2`), dependencies);
    log.mockRestore();
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('private provider detail');

    const unversioned = await handlePublicSeasonStatsRequest(request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}`), deps());
    expect(unversioned.status).toBe(400);

    const emptyDeps = deps();
    emptyDeps.loadRows.mockResolvedValue(rows({ games: [], rosters: [], checkins: [], acceptedSubs: [], playerStats: [], goalieStats: [] }));
    const empty = await handlePublicSeasonStatsRequest(request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&contractVersion=2`), emptyDeps);
    expect(empty.status).toBe(200);
    expect((await empty.json()).players).toEqual([]);
  });
});

describe('bounded metric loader', () => {
  function memoryClient(source: PublicStatMetricRows) {
    const tableRows = {
      games: source.games,
      teams: source.teams,
      team_rosters: source.rosters,
      game_checkins: source.checkins,
      sub_invitations: source.acceptedSubs,
      player_stats: source.playerStats,
      goalie_stats: source.goalieStats,
      game_goalie_appearances: source.goalieAppearances,
      profiles: source.profiles,
    } as Record<string, Array<Record<string, unknown>>>;
    const games = new Map(source.games.map((game) => [game.id, game]));
    const calls: Array<{ table: string; method: 'eq' | 'in'; column: string; value: unknown }> = [];
    const valueFor = (row: Record<string, unknown>, column: string) => {
      if (!column.startsWith('game.')) return row[column];
      const game = games.get(String(row.game_id));
      return game?.[column.slice('game.'.length) as keyof typeof game];
    };
    const client = {
      from(table: string) {
        return {
          select() {
            let filtered = [...(tableRows[table] ?? [])];
            const query = {
              eq(column: string, value: unknown) {
                calls.push({ table, method: 'eq' as const, column, value });
                filtered = filtered.filter((row) => valueFor(row, column) === value);
                return query;
              },
              in(column: string, values: unknown[]) {
                calls.push({ table, method: 'in' as const, column, value: values });
                filtered = filtered.filter((row) => values.includes(valueFor(row, column)));
                return query;
              },
              order() { return query; },
              async range(from: number, to: number) {
                return { data: filtered.slice(from, to + 1), count: filtered.length, error: null };
              },
            };
            return query;
          },
        };
      },
    };
    return { client, calls };
  }

  const goalieRoster = (id: string, playerId: string, teamId = TEAM_A) => ({
    id,
    player_id: playerId,
    team_id: teamId,
    league_id: LEAGUE_ID,
    season_id: SEASON_ID,
    start_date: '2026-01-01',
    end_date: null,
    is_goalie: true,
    position: 'Goalie',
    status: 'active',
    player_type: 'regular',
  });

  async function loadPlayerScope(source: PublicStatMetricRows, playerId: string) {
    const { client, calls } = memoryClient(source);
    const scope = { leagueId: LEAGUE_ID, seasonId: SEASON_ID, playerId };
    const loaded = await loadPublicStatMetricRows(client as never, scope);
    return { loaded, calls, payload: aggregatePublicSeasonStats(loaded, scope) };
  }

  it('bounds division-scoped rosters to the teams returned by the scoped team query', async () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      teams: [
        { id: TEAM_A, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Alpha' },
        { id: TEAM_B, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Beta' },
        { id: TEAM_C, league_id: LEAGUE_ID, division_id: OTHER_DIVISION_ID, name: 'Gamma' },
      ],
      profiles: [
        { id: MATT, full_name: 'Matt', avatar_url: null, photo_url: null },
        { id: CASEY, full_name: 'Casey', avatar_url: null, photo_url: null },
      ],
      rosters: [
        {
          id: '90000000-0000-4000-8000-000000000021', player_id: MATT, team_id: TEAM_A,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
        {
          id: '90000000-0000-4000-8000-000000000022', player_id: CASEY, team_id: TEAM_C,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
      ],
      checkins: [],
      acceptedSubs: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [],
    });
    const { client, calls } = memoryClient(source);
    const scope = { leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID };

    const loaded = await loadPublicStatMetricRows(client as never, scope);

    expect(() => aggregatePublicSeasonStats(loaded, scope)).not.toThrow();
    expect(loaded.teams.map((team) => team.id)).toEqual([TEAM_A, TEAM_B]);
    expect(loaded.rosters.map((roster) => roster.team_id)).toEqual([TEAM_A]);
    expect(calls).toContainEqual({
      table: 'team_rosters', method: 'in', column: 'team_id', value: [TEAM_A, TEAM_B],
    });
  });

  it('skips the roster source when a division has no scoped teams', async () => {
    const source = rows({
      games: [],
      teams: [
        { id: TEAM_C, league_id: LEAGUE_ID, division_id: OTHER_DIVISION_ID, name: 'Gamma' },
      ],
      profiles: [{ id: CASEY, full_name: 'Casey', avatar_url: null, photo_url: null }],
      rosters: [{
        id: '90000000-0000-4000-8000-000000000023', player_id: CASEY, team_id: TEAM_C,
        league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
        is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
      }],
      checkins: [],
      acceptedSubs: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [],
    });
    const { client, calls } = memoryClient(source);
    const scope = { leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID };

    const loaded = await loadPublicStatMetricRows(client as never, scope);

    expect(loaded.teams).toEqual([]);
    expect(loaded.rosters).toEqual([]);
    expect(calls.some((call) => call.table === 'team_rosters')).toBe(false);
    expect(aggregatePublicSeasonStats(loaded, scope).players).toEqual([]);
  });

  it('preserves the exact-team roster filter without adding a division team-list filter', async () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      teams: [
        { id: TEAM_A, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Alpha' },
        { id: TEAM_B, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Beta' },
        { id: TEAM_C, league_id: LEAGUE_ID, division_id: OTHER_DIVISION_ID, name: 'Gamma' },
      ],
      rosters: [
        {
          id: '90000000-0000-4000-8000-000000000024', player_id: MATT, team_id: TEAM_A,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
        {
          id: '90000000-0000-4000-8000-000000000025', player_id: CASEY, team_id: TEAM_C,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
      ],
      checkins: [],
      acceptedSubs: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [],
    });
    const { client, calls } = memoryClient(source);
    const scope = {
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: TEAM_A,
    };

    const loaded = await loadPublicStatMetricRows(client as never, scope);

    expect(() => aggregatePublicSeasonStats(loaded, scope)).not.toThrow();
    expect(loaded.teams.map((team) => team.id)).toEqual([TEAM_A]);
    expect(loaded.rosters.map((roster) => roster.team_id)).toEqual([TEAM_A]);
    expect(calls).toContainEqual({
      table: 'team_rosters', method: 'eq', column: 'team_id', value: TEAM_A,
    });
    expect(calls).not.toContainEqual(expect.objectContaining({
      table: 'team_rosters', method: 'in', column: 'team_id',
    }));
  });

  it('keeps an explicit rosters-only table selection independent of the teams source', async () => {
    const source = rows({
      teams: [
        { id: TEAM_A, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Alpha' },
        { id: TEAM_C, league_id: LEAGUE_ID, division_id: OTHER_DIVISION_ID, name: 'Gamma' },
      ],
      rosters: [
        {
          id: '90000000-0000-4000-8000-000000000026', player_id: MATT, team_id: TEAM_A,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
        {
          id: '90000000-0000-4000-8000-000000000027', player_id: CASEY, team_id: TEAM_C,
          league_id: LEAGUE_ID, season_id: SEASON_ID, start_date: null, end_date: null,
          is_goalie: false, position: 'C', status: 'active', player_type: 'regular',
        },
      ],
    });
    const { client, calls } = memoryClient(source);

    const loaded = await loadPublicStatMetricRows(
      client as never,
      { leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID },
      { tables: ['rosters'] },
    );

    expect(loaded.teams).toEqual([]);
    expect(loaded.rosters.map((roster) => roster.team_id)).toEqual([TEAM_A, TEAM_C]);
    expect(calls.some((call) => call.table === 'teams')).toBe(false);
    expect(calls).not.toContainEqual(expect.objectContaining({
      table: 'team_rosters', method: 'in', column: 'team_id',
    }));
  });

  it('preserves same-team goalie ambiguity for a player-scoped profile read', async () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      profiles: [
        { id: GOALIE, full_name: 'Target Goalie', avatar_url: null, photo_url: null },
        { id: ALEX, full_name: 'Other Goalie', avatar_url: null, photo_url: null },
      ],
      rosters: [
        goalieRoster('90000000-0000-4000-8000-000000000011', GOALIE),
        goalieRoster('90000000-0000-4000-8000-000000000012', ALEX),
      ],
      checkins: [],
      playerStats: [],
      goalieStats: [],
    });

    const { loaded, calls, payload } = await loadPlayerScope(source, GOALIE);
    const target = payload.players[0];

    expect(loaded.rosters.map((row) => row.player_id)).toEqual([GOALIE, ALEX]);
    expect(loaded.profiles.map((row) => row.id)).toEqual([GOALIE]);
    expect(payload.players.map((player) => player.playerId)).toEqual([GOALIE]);
    expect(target.goalie?.gamesPlayed).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
    expect(target.goalie?.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
    expect(target.goalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
    for (const table of ['team_rosters', 'game_checkins', 'game_goalie_appearances']) {
      expect(calls).not.toContainEqual({ table, method: 'eq', column: 'player_id', value: GOALIE });
    }
    for (const table of ['player_stats', 'goalie_stats']) {
      expect(calls).toContainEqual({ table, method: 'eq', column: 'player_id', value: GOALIE });
    }
    expect(calls).toContainEqual({ table: 'profiles', method: 'in', column: 'id', value: [GOALIE] });
  });

  it('preserves an explicit substitute assignment that suppresses the scoped regular goalie', async () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      profiles: [
        { id: GOALIE, full_name: 'Target Goalie', avatar_url: null, photo_url: null },
        { id: ALEX, full_name: 'Assigned Substitute', avatar_url: null, photo_url: null },
      ],
      rosters: [goalieRoster('90000000-0000-4000-8000-000000000013', GOALIE)],
      checkins: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [{
        game_id: completedGames[0].id,
        player_id: ALEX,
        team_id: TEAM_A,
        team_type: 'home',
      }],
    });

    const { loaded, payload } = await loadPlayerScope(source, GOALIE);
    const target = payload.players[0];

    expect(loaded.goalieAppearances.map((row) => row.player_id)).toEqual([ALEX]);
    expect(payload.players.map((player) => player.playerId)).toEqual([GOALIE]);
    expect(target.goalie?.gamesPlayed).toEqual({
      value: null,
      state: 'unknown',
      sources: ['goalie_assignment', 'roster_window'],
    });
    expect(target.goalie?.goalsAgainst).toEqual({
      value: null,
      state: 'unknown',
      sources: ['goalie_assignment', 'roster_window'],
    });
  });

  it('emits only the requested skater and their own scoring rows from full aggregation context', () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      rosters: [],
      checkins: [],
      goalieStats: [],
      playerStats: [
        {
          id: 'b0000000-0000-4000-8000-000000000011', game_id: completedGames[0].id,
          player_id: MATT, team_id: TEAM_A, league_id: LEAGUE_ID, season_id: SEASON_ID,
          goals: 2, assists: 1, penalty_minutes: 0,
        },
        {
          id: 'b0000000-0000-4000-8000-000000000012', game_id: completedGames[0].id,
          player_id: ALEX, team_id: TEAM_B, league_id: LEAGUE_ID, season_id: SEASON_ID,
          goals: 50, assists: 50, penalty_minutes: 0,
        },
      ],
    });

    const payload = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      playerId: MATT,
    });

    expect(payload.players.map((player) => player.playerId)).toEqual([MATT]);
    expect(payload.players[0].metrics).toMatchObject({
      goals: { value: 2 },
      assists: { value: 1 },
      points: { value: 3 },
    });
  });

  it('keeps full goalie context isolated by team for a player-scoped profile read', async () => {
    const source = rows({
      games: completedGames.slice(0, 1),
      profiles: [
        { id: GOALIE, full_name: 'Target Goalie', avatar_url: null, photo_url: null },
        { id: ALEX, full_name: 'Away Goalie', avatar_url: null, photo_url: null },
      ],
      rosters: [
        goalieRoster('90000000-0000-4000-8000-000000000014', GOALIE, TEAM_A),
        goalieRoster('90000000-0000-4000-8000-000000000015', ALEX, TEAM_B),
      ],
      checkins: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [{
        game_id: completedGames[0].id,
        player_id: ALEX,
        team_id: TEAM_B,
        team_type: 'away',
      }],
    });

    const { payload } = await loadPlayerScope(source, GOALIE);

    expect(payload.players.map((player) => player.playerId)).toEqual([GOALIE]);
    expect(payload.players[0].goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['roster_window'],
    });
    expect(payload.players[0].goalie?.goalsAgainst).toEqual({
      value: 2,
      state: 'reported',
      sources: ['roster_window'],
    });
  });

  it('loads league-scoped teams without assuming a nonexistent season_id column', async () => {
    const client = {
      from(table: string) {
        return {
          select(columns: string) {
            let invalidTeamSeasonReference = table === 'teams' && columns.split(',').map((column) => column.trim()).includes('season_id');
            const query = {
              eq(column: string) {
                if (table === 'teams' && column === 'season_id') invalidTeamSeasonReference = true;
                return this;
              },
              in() { return this; },
              order() { return this; },
              async range() {
                return invalidTeamSeasonReference
                  ? { data: null, count: null, error: new Error('column teams.season_id does not exist') }
                  : { data: [], count: 0, error: null };
              },
            };
            return query;
          },
        };
      },
    };

    await expect(loadPublicStatMetricRows(client as never, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })).resolves.toEqual(expect.objectContaining({ teams: [] }));
  });

  it('paginates exact-count source reads and distinguishes failure from empty', async () => {
    const page = (data: unknown[], count: number | null, error: unknown = null) => ({ data, count, error });
    const range = jest.fn()
      .mockResolvedValueOnce(page([{ id: '1' }], 2))
      .mockResolvedValueOnce(page([{ id: '2' }], 2));
    const query = { range };
    const client = { from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(query) }) };
    await expect(loadPublicStatMetricRows(client as never, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }, { pageSize: 1, tables: ['profiles'] })).resolves.toEqual(expect.objectContaining({ profiles: [{ id: '1' }, { id: '2' }] }));
    expect(range).toHaveBeenCalledTimes(2);

    range.mockReset().mockResolvedValue(page([], null, new Error('offline')));
    await expect(loadPublicStatMetricRows(client as never, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }, { pageSize: 1, tables: ['profiles'] })).rejects.toThrow('profiles source read failed');
  });

  it('applies league, season, completed-game, division, and team scope before production aggregation', async () => {
    const filters: Array<[string, string, unknown]> = [];
    const tables: string[] = [];
    const query = {
      eq(column: string, value: unknown) { filters.push(['eq', column, value]); return this; },
      in(column: string, value: unknown) { filters.push(['in', column, value]); return this; },
      order() { return this; },
      async range() { return { data: [], count: 0, error: null }; },
    };
    const client = {
      from(table: string) {
        tables.push(table);
        return { select: () => query };
      },
    };
    await loadPublicStatMetricRows(client as never, {
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: TEAM_A,
    });
    expect(tables).toEqual(expect.arrayContaining(['games', 'teams', 'team_rosters', 'game_checkins', 'sub_invitations', 'player_stats', 'goalie_stats']));
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'league_id', LEAGUE_ID],
      ['eq', 'season_id', SEASON_ID],
      ['eq', 'status', 'completed'],
      ['eq', 'division_id', DIVISION_ID],
      ['eq', 'team_id', TEAM_A],
    ]));
  });
});
