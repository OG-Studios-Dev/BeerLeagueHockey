import { NextRequest } from 'next/server';

import { handlePublicPlayerCareerRequest, type PublicNativeStatsDependencies } from '@/lib/public-native-stats';
import type { PublicStatMetricRows } from '@/lib/public-stat-metrics';
import { HLHL_WINTER_2026_SEASON_ID } from '@/lib/imported-aggregate-season-overrides';

const LEAGUE = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000002';
const PLAYER = '40000000-0000-4000-8000-000000000004';
const TEAM = '70000000-0000-4000-8000-000000000007';
const GAME = '80000000-0000-4000-8000-000000000008';

const request = () => new NextRequest(
  `https://hockey-life.beerleaguehockey.ca/api/public/player-career?leagueSlug=hockey-life&playerId=${PLAYER}&contractVersion=2`,
  { headers: { host: 'hockey-life.beerleaguehockey.ca' } },
);

function timeline(overrides: Record<string, unknown> = {}) {
  return {
    season_id: SEASON, season_name: 'Fall 2026', sort_date: '2026-09-01', team_id: TEAM, team_name: 'Owls', position: 'C',
    games_played: 1, team_games: 1, attendance_pct: 100, goals: 1, assists: 2, points: 3,
    goals_per_game: 1, points_per_game: 3, wins: 0, losses: 0, ties: 0, saves: 0, goals_against: 0,
    save_percentage: null, goals_against_average: null, shutouts: 0, ...overrides,
  };
}

function rows(player = true): PublicStatMetricRows {
  return {
    games: [{ id: GAME, league_id: LEAGUE, season_id: SEASON, status: 'completed', home_team_id: TEAM,
      away_team_id: '71000000-0000-4000-8000-000000000007', home_score: 2, away_score: 1,
      scheduled_at: '2026-09-01T20:00:00Z', penalty_capture_status: null, goalie_capture_status: null, skater_capture_status: null }],
    teams: [{ id: TEAM, league_id: LEAGUE, season_id: SEASON, division_id: null, name: 'Owls' }],
    profiles: player ? [{ id: PLAYER, full_name: 'Player', avatar_url: null, photo_url: null }] : [],
    rosters: [], checkins: [], acceptedSubs: [], goalieStats: [], goalieAppearances: [],
    playerStats: player ? [{ id: 'a0000000-0000-4000-8000-000000000001', game_id: GAME, player_id: PLAYER, team_id: TEAM,
      league_id: LEAGUE, season_id: SEASON, goals: 1, assists: 2, penalty_minutes: 4, scorekeeping_provenance: null }] : [],
  };
}

function deps(): jest.Mocked<PublicNativeStatsDependencies> {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE, slug: 'hockey-life', status: 'active' }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    readPresentationSeason: jest.fn().mockResolvedValue(null), getDivisions: jest.fn().mockResolvedValue([]),
    getPlayerProfile: jest.fn().mockResolvedValue({ player_id: PLAYER, position: 'C', is_goalie: false, profile: { full_name: 'Player', avatar_url: null } }),
    readPublicProfileIdentity: jest.fn().mockResolvedValue(null),
    getPlayerCareerStatsTimeline: jest.fn().mockResolvedValue([]), filterVisiblePlayerCareerTimelineRows: jest.fn((value) => value),
    getUnifiedGoalieStatsRows: jest.fn().mockResolvedValue([]), readGoalieStatsSourceCount: jest.fn().mockResolvedValue(0),
    readCareerScope: jest.fn().mockResolvedValue({ isEligible: true, isGoalie: false, seasonCatalog: [{ id: SEASON, name: 'Fall 2026' }],
      canonicalSeasonIds: [SEASON], penaltyRows: [], canonicalSourceRowCount: 1 }),
    readMetricSeason: jest.fn(), requirePrivilegedAccess: jest.fn(), loadMetricRows: jest.fn().mockResolvedValue(rows()),
    readCareerMetricSeasonIds: jest.fn().mockResolvedValue([SEASON]),
  } as jest.Mocked<PublicNativeStatsDependencies>;
}

describe('review findings: canonical career v2', () => {
  it('drives canonical seasons without the legacy timeline, targets the player, and never falls back when absent', async () => {
    const dependencies = deps();
    const response = await handlePublicPlayerCareerRequest(request(), dependencies);
    expect(response.status).toBe(200);
    expect((await response.json()).seasons[0].metrics.points.value).toBe(3);
    expect(dependencies.loadMetricRows).toHaveBeenCalledWith({ leagueId: LEAGUE, seasonId: SEASON, playerId: PLAYER });

    dependencies.loadMetricRows.mockResolvedValue(rows(false));
    dependencies.getPlayerCareerStatsTimeline.mockResolvedValue([timeline({ goals: 99 })]);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const absent = await handlePublicPlayerCareerRequest(request(), dependencies);
    log.mockRestore();
    expect(absent.status).toBe(503);
  });

  it('deduplicates identical imported team repeats and preserves supplied imported PIM', async () => {
    const dependencies = deps();
    const imported = timeline({ season_id: HLHL_WINTER_2026_SEASON_ID, season_name: 'Winter 2026', games_played: 10,
      goals: 12, assists: 7, points: 19, penalty_minutes: 6 });
    dependencies.getPlayerCareerStatsTimeline.mockResolvedValue([imported, { ...imported, team_id: '71000000-0000-4000-8000-000000000007', team_name: 'Foxes' }]);
    dependencies.readCareerScope.mockResolvedValue({ isEligible: true, isGoalie: false,
      seasonCatalog: [{ id: HLHL_WINTER_2026_SEASON_ID, name: 'Winter 2026' }], canonicalSeasonIds: [], penaltyRows: [], canonicalSourceRowCount: 2 });
    const response = await handlePublicPlayerCareerRequest(request(), dependencies);
    const payload = await response.json();
    expect(payload.seasons[0].metrics.gamesPlayed.value).toBe(10);
    expect(payload.seasons[0].metrics.points.value).toBe(19);
    expect(payload.seasons[0].metrics.penaltyMinutes).toEqual({ value: 6, state: 'reported', sources: ['imported'] });
    expect(payload.totals.metrics.points.value).toBe(19);
  });

  it('emits a strict-parser-valid goalie group for an imported goalie baseline', async () => {
    const dependencies = deps();
    dependencies.getPlayerCareerStatsTimeline.mockResolvedValue([]);
    dependencies.readCareerScope.mockResolvedValue({
      isEligible: true, isGoalie: true, seasonCatalog: [], canonicalSeasonIds: [], penaltyRows: [], canonicalSourceRowCount: 0,
      historicalBaselineSourceRowCount: 1,
      careerBaseline: { id: '90000000-0000-4000-8000-000000000009', is_goalie: true, games_played: 10, goals: 0,
        assists: 0, points: 0, wins: 6, ties: 1, saves: 180, goals_against: 20, shutouts: 2 },
    });
    const response = await handlePublicPlayerCareerRequest(request(), dependencies);
    const payload = await response.json();
    expect(payload.seasons[0].roles).toEqual(['goalie']);
    expect(payload.seasons[0].goalie).toEqual(expect.objectContaining({
      gamesPlayed: { value: 10, state: 'reported', sources: ['imported'] },
      wins: { value: 6, state: 'reported', sources: ['imported'] },
      losses: { value: 3, state: 'reported', sources: ['imported'] },
      saves: { value: 180, state: 'reported', sources: ['imported'] },
    }));
    expect(payload.totals.goalie).not.toBeNull();
    expect((payload.totals.goalie !== null)).toBe(payload.totals.roles.includes('goalie'));
  });

  it('enforces a global canonical-season work bound before starting metric loads', async () => {
    const dependencies = deps();
    dependencies.readCareerScope.mockResolvedValue({ isEligible: true, isGoalie: false,
      seasonCatalog: Array.from({ length: 33 }, (_, index) => ({ id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, name: `S${index}` })),
      canonicalSeasonIds: Array.from({ length: 33 }, (_, index) => `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`),
      penaltyRows: [], canonicalSourceRowCount: 33 });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handlePublicPlayerCareerRequest(request(), dependencies);
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(dependencies.loadMetricRows).not.toHaveBeenCalled();
  });
});
