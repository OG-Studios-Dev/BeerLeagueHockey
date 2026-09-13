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
const TEAM_A = '70000000-0000-4000-8000-000000000007';
const TEAM_B = '71000000-0000-4000-8000-000000000007';
const MATT = '40000000-0000-4000-8000-000000000004';
const ALEX = '41000000-0000-4000-8000-000000000004';
const GOALIE = '42000000-0000-4000-8000-000000000004';

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
      candidates: { confirmed: 8, recorded: 1, estimated: 2 },
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
    expect(goalie.goalie?.saves).toEqual({ value: 20, state: 'verified', sources: ['goalie_stats', 'goalie_assignment', 'capture_confirmation'] });
    expect(goalie.goalie?.gamesPlayed.value).toBe(1);

    const unmeasured = rows({ games: completedGames.slice(1, 2), checkins: [], playerStats: [], goalieStats: [] });
    const estimated = aggregatePublicSeasonStats(unmeasured, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });
    const rosterGoalie = estimated.players.find((player) => player.playerId === GOALIE)!;
    expect(rosterGoalie.goalie?.gamesPlayed.state).toBe('estimated');
    expect(rosterGoalie.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('labels accepted substitutes as estimates rather than confirmed appearances', () => {
    const fixture = rows({
      games: completedGames.slice(0, 1), rosters: [], checkins: [], playerStats: [], goalieStats: [],
      acceptedSubs: [{ id: 'd0000000-0000-4000-8000-000000000001', game_id: completedGames[0].id,
        invited_player_id: ALEX, team_id: TEAM_A, status: 'accepted' }],
    });
    const player = aggregatePublicSeasonStats(fixture, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0];
    expect(player.metrics.gamesPlayed).toEqual({ value: 1, state: 'estimated', sources: ['accepted_sub'] });
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
