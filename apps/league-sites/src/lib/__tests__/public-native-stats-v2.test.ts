import { NextRequest } from 'next/server';

import {
  handlePublicGoaliesRequest,
  handlePublicPlayerCareerRequest,
  type PublicNativeStatsDependencies,
} from '@/lib/public-native-stats';
import type { PublicStatMetricRows } from '@/lib/public-stat-metrics';
import { HLHL_WINTER_2026_SEASON_ID } from '@/lib/imported-aggregate-season-overrides';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const PLAYER_ID = '40000000-0000-4000-8000-000000000004';
const TEAM_ID = '70000000-0000-4000-8000-000000000007';
const GAME_ID = '80000000-0000-4000-8000-000000000008';
const CHECKIN_ID = '90000000-0000-4000-8000-000000000009';
const STAT_ID = 'a0000000-0000-4000-8000-000000000001';
const GOALIE_STAT_ID = 'b0000000-0000-4000-8000-000000000001';

function metricRows(): PublicStatMetricRows {
  return {
    games: [{ id: GAME_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID,
      away_team_id: '71000000-0000-4000-8000-000000000007', home_score: 2, away_score: 1,
      scheduled_at: '2026-09-01T20:00:00Z', penalty_capture_status: null, goalie_capture_status: 'complete' }],
    teams: [{ id: TEAM_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, name: 'Ice Owls' }],
    profiles: [{ id: PLAYER_ID, full_name: 'Matt', avatar_url: null, photo_url: null }],
    rosters: [],
    checkins: [{ id: CHECKIN_ID, game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, status: 'out' }],
    acceptedSubs: [],
    playerStats: [{ id: STAT_ID, game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, league_id: LEAGUE_ID,
      season_id: SEASON_ID, goals: 15, assists: 10, penalty_minutes: 0, scorekeeping_provenance: null }],
    goalieStats: [{ id: GOALIE_STAT_ID, game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, league_id: LEAGUE_ID,
      season_id: SEASON_ID, wins: 1, losses: 0, saves: 20, shots_against: 21, goals_against: 1, shutout: false,
      scorekeeping_provenance: 'event_derived' }],
    goalieAppearances: [{ game_id: GAME_ID, player_id: PLAYER_ID, team_id: TEAM_ID, team_type: 'home' }],
  };
}

function dependencies(): jest.Mocked<PublicNativeStatsDependencies> {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE_ID, slug: 'hockey-life', status: 'active' }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    readPresentationSeason: jest.fn().mockResolvedValue({ id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', status: 'active' }),
    getDivisions: jest.fn().mockResolvedValue([]),
    getPlayerProfile: jest.fn().mockResolvedValue({ player_id: PLAYER_ID, position: 'C', is_goalie: false,
      profile: { full_name: 'Matt', avatar_url: null } }),
    readPublicProfileIdentity: jest.fn().mockResolvedValue(null),
    getPlayerCareerStatsTimeline: jest.fn().mockResolvedValue([{
      season_id: SEASON_ID, season_name: 'Fall 2026', sort_date: '2026-09-01', team_id: TEAM_ID, team_name: 'Ice Owls',
      position: 'C', games_played: 1, team_games: 1, attendance_pct: 100, goals: 15, assists: 10, points: 25,
      goals_per_game: 15, points_per_game: 25, wins: 1, losses: 0, ties: 0, saves: 20, goals_against: 1,
      save_percentage: 95.2, goals_against_average: 1, shutouts: 0,
    }]),
    filterVisiblePlayerCareerTimelineRows: jest.fn((value) => value),
    getUnifiedGoalieStatsRows: jest.fn().mockResolvedValue([]),
    readCareerScope: jest.fn().mockResolvedValue({ isEligible: true, isGoalie: false,
      seasonCatalog: [{ id: SEASON_ID, name: 'Fall 2026' }], penaltyRows: [], canonicalSourceRowCount: 1 }),
    readGoalieStatsSourceCount: jest.fn().mockResolvedValue(1),
    readMetricSeason: jest.fn().mockResolvedValue({ id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', status: 'active' }),
    requirePrivilegedAccess: jest.fn(),
    readCareerMetricSeasonIds: jest.fn().mockResolvedValue([SEASON_ID]),
    loadMetricRows: jest.fn().mockResolvedValue(metricRows()),
  } as jest.Mocked<PublicNativeStatsDependencies>;
}

function request(path: 'goalies' | 'player-career', query: string) {
  return new NextRequest(`https://hockey-life.beerleaguehockey.ca/api/public/${path}?${query}`, {
    headers: { host: 'hockey-life.beerleaguehockey.ca' },
  });
}

describe('public Goalies/Career v2 mobile DTOs', () => {
  it('projects exact per-field goalie metrics from the shared aggregator', async () => {
    const deps = dependencies();
    const response = await handlePublicGoaliesRequest(request('goalies', `leagueSlug=hockey-life&seasonId=${SEASON_ID}&contractVersion=2`), deps);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['coverage', 'divisionId', 'goalies', 'leagueId', 'leagueSlug', 'presentationSeason', 'schemaVersion'].sort());
    expect(payload.schemaVersion).toBe(2);
    expect(payload.goalies).toEqual([{
      playerId: PLAYER_ID,
      playerName: 'Matt',
      avatarUrl: null,
      displayTeam: { id: TEAM_ID, name: 'Ice Owls' },
      teams: [{ id: TEAM_ID, name: 'Ice Owls' }],
      metrics: expect.objectContaining({
        gamesPlayed: expect.objectContaining({ value: null, state: 'conflicted' }),
        saves: { value: 20, state: 'verified', sources: ['goalie_stats', 'goalie_assignment', 'capture_confirmation'] },
      }),
    }]);
    expect(payload.coverage).toEqual({ goalies: ['verified', 'conflicted'] });
    expect(JSON.stringify(payload)).not.toMatch(/game_id|checkin|scheduled_at|goalie_capture_status/);
    expect(deps.readPresentationSeason).not.toHaveBeenCalled();
  });

  it('projects exact dual-role Career v2 rows while retaining scoring through conflicted GP', async () => {
    const deps = dependencies();
    const response = await handlePublicPlayerCareerRequest(request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}&contractVersion=2`), deps);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['leagueId', 'leagueSlug', 'player', 'schemaVersion', 'seasons', 'totals'].sort());
    expect(payload.player).toEqual({ id: PLAYER_ID, name: 'Matt', avatarUrl: null });
    expect(payload.seasons).toEqual([expect.objectContaining({
      seasonId: SEASON_ID,
      sourceId: null,
      seasonName: 'Fall 2026',
      sortDate: '2026-09-01',
      teams: [{ id: TEAM_ID, name: 'Ice Owls' }],
      roles: ['skater', 'goalie'],
      metrics: expect.objectContaining({
        gamesPlayed: expect.objectContaining({ value: null, state: 'conflicted' }),
        goals: { value: 15, state: 'recorded', sources: ['skater_stats'] },
        assists: { value: 10, state: 'recorded', sources: ['skater_stats'] },
        points: { value: 25, state: 'recorded', sources: ['skater_stats'] },
      }),
      goalie: expect.any(Object),
    })]);
    expect(payload.totals.roles).toEqual(['skater', 'goalie']);
    expect(payload.totals.metrics.gamesPlayed.state).toBe('conflicted');
    expect(payload.totals.metrics.points.value).toBe(25);
  });

  it('preserves imported Career G/A/PTS with reported imported provenance', async () => {
    const deps = dependencies();
    const baseTimeline = await deps.getPlayerCareerStatsTimeline(LEAGUE_ID, PLAYER_ID, false, { includeHistoricalBaseline: true });
    const imported = { ...baseTimeline[0], season_id: HLHL_WINTER_2026_SEASON_ID,
      season_name: 'Winter 2026', games_played: 10, goals: 12, assists: 7, points: 19 };
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([imported]);
    deps.readCareerScope.mockResolvedValue({ isEligible: true, isGoalie: false,
      seasonCatalog: [{ id: HLHL_WINTER_2026_SEASON_ID, name: 'Winter 2026' }], penaltyRows: [], canonicalSourceRowCount: 1 });
    deps.readCareerMetricSeasonIds.mockResolvedValue([]);
    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}&contractVersion=2`), deps,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.seasons[0].metrics).toEqual(expect.objectContaining({
      gamesPlayed: { value: 10, state: 'reported', sources: ['imported'] },
      goals: { value: 12, state: 'reported', sources: ['imported'] },
      assists: { value: 7, state: 'reported', sources: ['imported'] },
      points: { value: 19, state: 'reported', sources: ['imported'] },
    }));
    expect(deps.loadMetricRows).not.toHaveBeenCalled();
  });

  it('keeps unversioned and explicit v1 responses deeply compatible', async () => {
    const goalieRows = [{
      player_id: PLAYER_ID, player_name: 'Matt', team_id: TEAM_ID, team_name: 'Ice Owls', avatar_url: null,
      games_played: 1, wins: 1, losses: 0, saves: 20, goals_against: 1, save_percentage: 95.2,
      goals_against_average: 1, shutouts: 0, division_name: null, position: 'Goalie', championships: 0,
    }];
    const unversionedDeps = dependencies();
    unversionedDeps.getUnifiedGoalieStatsRows.mockResolvedValue(goalieRows);
    const explicitDeps = dependencies();
    explicitDeps.getUnifiedGoalieStatsRows.mockResolvedValue(goalieRows);
    const unversioned = await handlePublicGoaliesRequest(request('goalies', `leagueSlug=hockey-life&seasonId=${SEASON_ID}`), unversionedDeps);
    const explicit = await handlePublicGoaliesRequest(request('goalies', `leagueSlug=hockey-life&seasonId=${SEASON_ID}&contractVersion=1`), explicitDeps);
    expect(explicit.status).toBe(200);
    expect(await explicit.json()).toEqual(await unversioned.json());

    const careerUnversioned = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), dependencies(),
    );
    const careerExplicit = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}&contractVersion=1`), dependencies(),
    );
    expect(careerExplicit.status).toBe(200);
    expect(await careerExplicit.json()).toEqual(await careerUnversioned.json());
  });
});
