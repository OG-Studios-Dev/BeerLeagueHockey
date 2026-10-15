import { NextRequest } from 'next/server';

import {
  aggregatePublicSeasonStats,
  assertRequiredPrivilegedMetricConfig,
  handlePublicSeasonStatsRequest,
  loadPublicStatMetricRows,
  type PublicStatMetricRows,
  type PublicStatMetricsDependencies,
} from '@/lib/public-stat-metrics';

const LEAGUE = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000002';
const DIVISION = '30000000-0000-4000-8000-000000000003';
const PLAYER = '40000000-0000-4000-8000-000000000004';
const GOALIE = '41000000-0000-4000-8000-000000000004';
const TEAM_A = '70000000-0000-4000-8000-000000000007';
const TEAM_B = '71000000-0000-4000-8000-000000000007';
const GAME = '80000000-0000-4000-8000-000000000008';

function fixture(overrides: Partial<PublicStatMetricRows> = {}): PublicStatMetricRows {
  return {
    games: [{
      id: GAME, league_id: LEAGUE, season_id: SEASON, status: 'completed', home_team_id: TEAM_A,
      away_team_id: TEAM_B, home_score: 2, away_score: 1, scheduled_at: '2026-09-01T20:00:00Z',
      penalty_capture_status: 'complete', goalie_capture_status: 'complete', skater_capture_status: 'complete',
    }],
    teams: [
      { id: TEAM_A, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Alpha' },
      { id: TEAM_B, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Beta' },
    ],
    profiles: [
      { id: PLAYER, full_name: 'Player', avatar_url: null, photo_url: null },
      { id: GOALIE, full_name: 'Goalie', avatar_url: null, photo_url: null },
    ],
    rosters: [], checkins: [], acceptedSubs: [], playerStats: [], goalieStats: [], goalieAppearances: [],
    ...overrides,
  };
}

describe('review findings: canonical season aggregation', () => {
  it('keeps nullable skater fields unknown and only verifies event-derived complete fields', () => {
    const rows = fixture({
      checkins: [{ id: '90000000-0000-4000-8000-000000000001', game_id: GAME, player_id: PLAYER, team_id: TEAM_A, status: 'confirmed' }],
      playerStats: [{
        id: 'a0000000-0000-4000-8000-000000000001', game_id: GAME, player_id: PLAYER, team_id: TEAM_A,
        league_id: LEAGUE, season_id: SEASON, goals: null, assists: 2, penalty_minutes: null,
        scorekeeping_provenance: 'event_derived',
      }],
    });
    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];
    expect(player.metrics.goals).toEqual({ value: null, state: 'unknown', sources: ['skater_stats', 'capture_confirmation'] });
    expect(player.metrics.assists).toEqual({ value: 2, state: 'verified', sources: ['skater_stats', 'capture_confirmation'] });
    expect(player.metrics.points).toEqual({ value: null, state: 'unknown', sources: ['skater_stats', 'capture_confirmation'] });
    expect(player.metrics.penaltyMinutes).toEqual({ value: null, state: 'unknown', sources: ['skater_stats', 'capture_confirmation'] });
  });

  it('uses private goalie appearances, propagates attendance conflicts, nullable fields, and the full result vocabulary', () => {
    const rows = fixture({
      checkins: [{ id: '90000000-0000-4000-8000-000000000002', game_id: GAME, player_id: GOALIE, team_id: TEAM_B, status: 'out' }],
      goalieAppearances: [{ game_id: GAME, player_id: GOALIE, team_id: TEAM_B, team_type: 'away' }],
      goalieStats: [{
        id: 'b0000000-0000-4000-8000-000000000001', game_id: GAME, player_id: GOALIE, team_id: TEAM_B,
        league_id: LEAGUE, season_id: SEASON, wins: null, losses: null, game_result: 'WIN', saves: 20,
        shots_against: 21, goals_against: 1, shutout: null, scorekeeping_provenance: 'event_derived',
      }],
    });
    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];
    expect(goalie.metrics.gamesPlayed.state).toBe('conflicted');
    expect(goalie.goalie?.gamesPlayed.state).toBe('conflicted');
    expect(goalie.goalie?.wins.value).toBe(1);
    expect(goalie.goalie?.losses.value).toBe(0);
    expect(goalie.goalie?.shutouts.value).toBeNull();

    rows.checkins = [];
    rows.goalieStats[0] = { ...rows.goalieStats[0], game_result: 'SOL', shutout: false };
    const shootoutLoss = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];
    expect(shootoutLoss.goalie?.wins.value).toBe(0);
    expect(shootoutLoss.goalie?.losses.value).toBe(1);
  });

  it('includes assigned zero-save goalies and does not verify legacy rows from the game flag alone', () => {
    const assigned = fixture({
      goalieAppearances: [{ game_id: GAME, player_id: GOALIE, team_id: TEAM_B, team_type: 'away' }],
    });
    const zero = aggregatePublicSeasonStats(assigned, { leagueId: LEAGUE, seasonId: SEASON }).players[0];
    expect(zero.roles).toEqual(['goalie']);
    expect(zero.goalie?.gamesPlayed).toEqual({ value: 1, state: 'verified', sources: ['goalie_assignment', 'capture_confirmation'] });
    expect(zero.goalie?.saves.value).toBeNull();

    assigned.goalieStats = [{
      id: 'b0000000-0000-4000-8000-000000000002', game_id: GAME, player_id: GOALIE, team_id: TEAM_B,
      league_id: LEAGUE, season_id: SEASON, game_result: 'LOSS', saves: 0, shots_against: 0,
      goals_against: 0, shutout: false, scorekeeping_provenance: null,
    }];
    expect(aggregatePublicSeasonStats(assigned, { leagueId: LEAGUE, seasonId: SEASON }).players[0].goalie?.saves.state).toBe('recorded');
  });

  it('excludes ineligible/non-regular rosters and preserves a valid games-played override', () => {
    const base = {
      player_id: PLAYER, team_id: TEAM_A, league_id: LEAGUE, season_id: SEASON,
      start_date: '2026-01-01', end_date: null, is_goalie: false, position: 'C', player_type: 'regular',
    };
    const rows = fixture({ rosters: [
      { ...base, id: 'c0000000-0000-4000-8000-000000000001', status: 'injured', games_played_override: null },
      { ...base, id: 'c0000000-0000-4000-8000-000000000002', player_id: GOALIE, status: 'active', player_type: 'sub', games_played_override: null },
    ] });
    expect(aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players).toEqual([]);

    rows.rosters = [{ ...base, id: 'c0000000-0000-4000-8000-000000000003', status: 'active', games_played_override: 7 }];
    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];
    expect(player.metrics.gamesPlayed).toEqual({ value: 7, state: 'reported', sources: ['override'] });
  });
});

describe('review findings: privileged loader and route', () => {
  const request = (host: string) => new NextRequest(
    `https://${host}/api/public/season-stats?leagueSlug=hockey-life&seasonId=${SEASON}&contractVersion=2`,
    { headers: { host } },
  );

  function deps(): jest.Mocked<PublicStatMetricsDependencies> {
    return {
      getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE, slug: 'hockey-life', status: 'active' }),
      hasPlatformSubscription: jest.fn().mockResolvedValue(true),
      readSeason: jest.fn().mockResolvedValue({ id: SEASON, league_id: LEAGUE, name: 'Fall 2026', status: 'active' }),
      getDivisions: jest.fn().mockResolvedValue([]),
      readTeam: jest.fn().mockResolvedValue(null),
      requirePrivilegedAccess: jest.fn(),
      loadRows: jest.fn().mockResolvedValue(fixture()),
    };
  }

  it('requires server-only privileged configuration and turns missing config into 503/no-store', async () => {
    const saved = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      role: process.env.SUPABASE_SERVICE_ROLE_KEY,
      secret: process.env.SUPABASE_SECRET_KEY,
    };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => assertRequiredPrivilegedMetricConfig()).toThrow('privileged metric source is not configured');
    Object.assign(process.env, {
      ...(saved.url ? { NEXT_PUBLIC_SUPABASE_URL: saved.url } : {}),
      ...(saved.role ? { SUPABASE_SERVICE_ROLE_KEY: saved.role } : {}),
      ...(saved.secret ? { SUPABASE_SECRET_KEY: saved.secret } : {}),
    });

    const dependencies = deps();
    dependencies.requirePrivilegedAccess.mockImplementation(() => { throw new Error('missing'); });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handlePublicSeasonStatsRequest(request('api.beerleaguehockey.ca'), dependencies);
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(dependencies.loadRows).not.toHaveBeenCalled();
  });

  it('accepts the generic api gateway and projects every private/provenance/eligibility column', async () => {
    const dependencies = deps();
    expect((await handlePublicSeasonStatsRequest(request('api.beerleaguehockey.ca'), dependencies)).status).toBe(200);

    const selections: Record<string, string> = {};
    const filters: Array<[string, unknown]> = [];
    const query = {
      eq(column: string, value: unknown) { filters.push([column, value]); return this; }, in() { return this; }, order() { return this; },
      async range() { return { data: [], count: 0, error: null }; },
    };
    await loadPublicStatMetricRows({ from(table: string) { return { select(columns: string) { selections[table] = columns; return query; } }; } } as never,
      { leagueId: LEAGUE, seasonId: SEASON, playerId: PLAYER });
    expect(selections.game_goalie_appearances).toContain('team_type');
    expect(selections.player_stats).toContain('scorekeeping_provenance');
    expect(selections.goalie_stats).toContain('scorekeeping_provenance');
    expect(selections.team_rosters).toEqual(expect.stringContaining('games_played_override'));
    expect(selections.team_rosters).toEqual(expect.stringContaining('player_type'));
    expect(selections.team_rosters).toEqual(expect.stringContaining('status'));
    expect(filters).toEqual(expect.arrayContaining([
      ['player_id', PLAYER],
      ['invited_player_id', PLAYER],
    ]));
  });
});
