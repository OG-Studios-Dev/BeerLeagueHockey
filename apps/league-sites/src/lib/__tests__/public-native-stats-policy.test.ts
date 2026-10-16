import { NextRequest } from 'next/server';

import { handlePublicGoaliesRequest, type PublicNativeStatsDependencies } from '@/lib/public-native-stats';

const LEAGUE = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000002';
const PLAYER = '40000000-0000-4000-8000-000000000004';
const SYNTHETIC_PLAYER = '41000000-0000-4000-8000-000000000004';
const TEAM = '70000000-0000-4000-8000-000000000007';

function dependencies(): jest.Mocked<PublicNativeStatsDependencies> {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE, slug: 'hockey-life', status: 'active' }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    readPresentationSeason: jest.fn().mockResolvedValue({
      id: SEASON,
      league_id: LEAGUE,
      name: 'Fall 2026',
      status: 'active',
    }),
    getDivisions: jest.fn().mockResolvedValue([]),
    getPlayerProfile: jest.fn(),
    readPublicProfileIdentity: jest.fn(),
    getPlayerCareerStatsTimeline: jest.fn(),
    filterVisiblePlayerCareerTimelineRows: jest.fn(),
    getUnifiedGoalieStatsRows: jest.fn().mockResolvedValue([{
      player_id: PLAYER,
      player_name: 'Goalie',
      team_id: TEAM,
      team_name: 'Home',
      avatar_url: null,
      games_played: 2,
      wins: 1,
      losses: 1,
      save_percentage: 87.5,
      goals_against_average: 2.5,
      shutouts: 0,
      saves: 35,
      goals_against: 5,
      division_name: null,
      position: 'Goalie',
      championships: 0,
    }]),
    readCareerScope: jest.fn(),
    readGoalieStatsSourceCount: jest.fn().mockResolvedValue(0),
    requirePrivilegedAccess: jest.fn(),
    readCareerMetricSeasonIds: jest.fn(),
  } as unknown as jest.Mocked<PublicNativeStatsDependencies>;
}

describe('approved legacy public goalie policy', () => {
  it('returns empty data instead of synthetic team-level goalie estimates', async () => {
    const deps = dependencies();
    const request = new NextRequest(
      `https://hockey-life.beerleaguehockey.ca/api/public/goalies?leagueSlug=hockey-life&seasonId=${SEASON}`,
      { headers: { host: 'hockey-life.beerleaguehockey.ca' } },
    );

    const response = await handlePublicGoaliesRequest(request, deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      source: 'empty',
      goalies: [],
    }));
    expect(deps.getUnifiedGoalieStatsRows).not.toHaveBeenCalled();
  });

  it('publishes only appearance-backed rows when the legacy source mixes real and roster-only goalies', async () => {
    const deps = dependencies();
    deps.readGoalieStatsSourceCount.mockResolvedValue(1);
    deps.getUnifiedGoalieStatsRows.mockResolvedValue([
      ...(await dependencies().getUnifiedGoalieStatsRows()),
      {
        player_id: SYNTHETIC_PLAYER,
        player_name: 'Roster Only',
        team_id: TEAM,
        team_name: 'Home',
        avatar_url: null,
        games_played: 0,
        wins: 0,
        losses: 0,
        save_percentage: null,
        goals_against_average: null,
        shutouts: 0,
        saves: 0,
        goals_against: 0,
        division_name: null,
        position: 'Goalie',
        championships: 0,
      },
    ]);
    const request = new NextRequest(
      `https://hockey-life.beerleaguehockey.ca/api/public/goalies?leagueSlug=hockey-life&seasonId=${SEASON}`,
      { headers: { host: 'hockey-life.beerleaguehockey.ca' } },
    );

    const response = await handlePublicGoaliesRequest(request, deps);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe('recorded');
    expect(payload.goalies).toEqual([
      expect.objectContaining({
        player_id: PLAYER,
        games_played: 2,
        saves: null,
        save_percentage: null,
        estimated: false,
      }),
    ]);
  });
});
