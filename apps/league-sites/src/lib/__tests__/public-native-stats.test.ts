import { NextRequest } from 'next/server';

import {
  handlePublicGoaliesRequest,
  handlePublicPlayerCareerRequest,
  readAllPenaltyRows,
  readCareerScope,
  readPublicProfileIdentity,
  readPresentationSeason,
  type PublicNativeStatsDependencies,
} from '@/lib/public-native-stats';
import { HLHL_WINTER_2026_SEASON_ID } from '@/lib/imported-aggregate-season-overrides';
import type { PlayerCareerSeasonRow } from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));

const mockedCreateClient = jest.mocked(createClient);
const mockedCreateServiceRoleClient = jest.mocked(createServiceRoleClient);

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const PLAYER_ID = '40000000-0000-4000-8000-000000000004';
const PLAYER_ID_2 = '41000000-0000-4000-8000-000000000004';
const TEAM_ID = '70000000-0000-4000-8000-000000000007';
const TEAM_ID_2 = '71000000-0000-4000-8000-000000000007';
const BASELINE_ID = '50000000-0000-4000-8000-000000000005';
const FOREIGN_SEASON_ID = '60000000-0000-4000-8000-000000000006';

function request(path: 'player-career' | 'goalies', query: string, host = 'hockey-life.beerleaguehockey.ca', method = 'GET') {
  return new NextRequest(`https://${host}/api/public/${path}?${query}`, {
    method,
    headers: { host },
  });
}

function careerRow(overrides: Partial<PlayerCareerSeasonRow>): PlayerCareerSeasonRow {
  return {
    season_id: SEASON_ID,
    season_name: 'Fall 2026',
    sort_date: '2026-09-01',
    team_id: '70000000-0000-4000-8000-000000000007',
    team_name: 'Ice Owls',
    position: 'C',
    games_played: 3,
    team_games: 3,
    attendance_pct: 100,
    goals: 2,
    assists: 4,
    points: 6,
    goals_per_game: 0.67,
    points_per_game: 2,
    wins: 0,
    losses: 0,
    ties: 0,
    saves: 0,
    goals_against: 0,
    save_percentage: null,
    goals_against_average: null,
    shutouts: 0,
    ...overrides,
  };
}

function dependencies(): jest.Mocked<PublicNativeStatsDependencies> {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({
      id: LEAGUE_ID,
      slug: 'hockey-life',
      status: 'active',
      custom_domain: null,
      custom_domain_verified: false,
    }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    readPresentationSeason: jest.fn().mockResolvedValue({
      id: SEASON_ID,
      league_id: LEAGUE_ID,
      name: 'Fall 2026',
      status: 'active',
    }),
    getDivisions: jest.fn().mockResolvedValue([
      { id: DIVISION_ID, league_id: LEAGUE_ID, name: 'A Division' },
    ]),
    getPlayerProfile: jest.fn().mockResolvedValue({
      id: 'roster-id',
      player_id: PLAYER_ID,
      position: 'C',
      profile: {
        id: PLAYER_ID,
        full_name: 'Alex Alpha',
        avatar_url: 'https://images.example/alex.png',
        phone: 'private',
      },
    }),
    readPublicProfileIdentity: jest.fn().mockResolvedValue({
      id: PLAYER_ID,
      full_name: 'Alex Alpha',
      avatar_url: 'https://images.example/alex.png',
      photo_url: null,
    }),
    getPlayerCareerStatsTimeline: jest.fn().mockResolvedValue([]),
    filterVisiblePlayerCareerTimelineRows: jest.fn((rows) => rows),
    getUnifiedGoalieStatsRows: jest.fn().mockResolvedValue([]),
    readCareerScope: jest.fn().mockResolvedValue({
      isEligible: true,
      isGoalie: false,
      seasonCatalog: [
        { id: BASELINE_ID, name: 'Historical Career Baseline - Imported' },
        { id: HLHL_WINTER_2026_SEASON_ID, name: 'Winter 2026' },
        { id: SEASON_ID, name: 'Fall 2026' },
      ],
      penaltyRows: [{ season_id: SEASON_ID, team_id: '70000000-0000-4000-8000-000000000007', penalty_minutes: 2 }],
      canonicalSourceRowCount: 1,
      historicalBaselineSourceRowCount: 1,
    }),
    readGoalieStatsSourceCount: jest.fn().mockResolvedValue(1),
    requirePrivilegedAccess: jest.fn(),
    readCareerMetricSeasonIds: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<PublicNativeStatsDependencies>;
}

describe('GET /api/public/player-career', () => {
  it('uses the league-scoped baseline facts when canonical history is missing or stale', async () => {
    for (const timeline of [[], [careerRow({ season_id: BASELINE_ID, season_name: 'Historical Career Baseline - Imported', games_played: 1, goals: 1, assists: 0, points: 1 })]]) {
      const deps = dependencies();
      deps.readCareerScope.mockResolvedValue({
        isEligible: true, isGoalie: false,
        seasonCatalog: [{ id: BASELINE_ID, name: 'Historical Career Baseline - Imported' }],
        penaltyRows: [], canonicalSourceRowCount: 0, historicalBaselineSourceRowCount: 1,
        careerBaseline: { id: 'a0000000-0000-4000-8000-000000000011', is_goalie: false, games_played: 10, goals: 8, assists: 9, points: 17 },
      });
      deps.getPlayerCareerStatsTimeline.mockResolvedValue(timeline);
      const response = await handlePublicPlayerCareerRequest(request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), deps);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.totals).toEqual({ games_played: 10, goals: 8, assists: 9, points: 17, penalty_minutes: null });
      expect(payload.seasons).toHaveLength(1);
      expect(payload.seasons[0].season_id).toBe(BASELINE_ID);
    }
  });
  it('returns exact league rows, canonical imported/native totals, nullable historical PIM, and no private fields', async () => {
    const deps = dependencies();
    const rows = [
      careerRow({
        season_id: BASELINE_ID,
        season_name: 'Historical Career Baseline - Imported',
        team_id: null,
        team_name: null,
        games_played: 10,
        goals: 8,
        assists: 9,
        points: 17,
      }),
      careerRow({
        season_id: HLHL_WINTER_2026_SEASON_ID,
        season_name: 'Winter 2026',
        team_id: null,
        team_name: 'Imported Team',
        games_played: 8,
        goals: 6,
        assists: 5,
        points: 11,
      }),
      careerRow({}),
      careerRow({ season_id: FOREIGN_SEASON_ID, season_name: 'Other League', games_played: 99 }),
    ];
    deps.getPlayerCareerStatsTimeline.mockResolvedValue(rows);

    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`),
      deps,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(payload).toEqual({
      schemaVersion: 1,
      leagueId: LEAGUE_ID,
      leagueSlug: 'hockey-life',
      player: { id: PLAYER_ID, name: 'Alex Alpha', avatar_url: 'https://images.example/alex.png' },
      totals: { games_played: 21, goals: 16, assists: 18, points: 34, penalty_minutes: null },
      seasons: [
        expect.objectContaining({ season_id: BASELINE_ID, penalty_minutes: null, source: 'imported' }),
        expect.objectContaining({ season_id: HLHL_WINTER_2026_SEASON_ID, penalty_minutes: null, source: 'imported' }),
        expect.objectContaining({ season_id: SEASON_ID, penalty_minutes: 2, source: 'recorded' }),
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/phone|email|private|profile|membership/);
    expect(deps.getPlayerCareerStatsTimeline).toHaveBeenCalledWith(
      LEAGUE_ID,
      PLAYER_ID,
      false,
      { includeHistoricalBaseline: true },
    );
    expect(deps.filterVisiblePlayerCareerTimelineRows).toHaveBeenCalledWith(rows, {
      includeHistoricalBaseline: true,
    });
    expect(deps.readCareerScope).toHaveBeenCalledWith(LEAGUE_ID, PLAYER_ID);
  });

  it('derives the career role from the requested league roster, not the global profile roster', async () => {
    const deps = dependencies();
    deps.getPlayerProfile.mockResolvedValue({
      player_id: PLAYER_ID,
      position: 'Goalie',
      is_goalie: true,
      profile: { full_name: 'Alex Alpha', avatar_url: null },
    });
    deps.readCareerScope.mockResolvedValue({
      isEligible: true,
      isGoalie: false,
      seasonCatalog: [{ id: SEASON_ID, name: 'Fall 2026' }],
      penaltyRows: [],
      canonicalSourceRowCount: 1,
    });
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([careerRow({})]);

    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.readCareerScope).toHaveBeenCalledWith(LEAGUE_ID, PLAYER_ID);
    expect(deps.getPlayerCareerStatsTimeline).toHaveBeenCalledWith(
      LEAGUE_ID,
      PLAYER_ID,
      false,
      { includeHistoricalBaseline: true },
    );
  });

  it('keeps a real imported-only athlete visible through direct profile fallback and a provenance-safe virtual row', async () => {
    const deps = dependencies();
    deps.getPlayerProfile.mockResolvedValue(null);
    deps.readCareerScope.mockResolvedValue({
      isEligible: true,
      isGoalie: true,
      seasonCatalog: [{ id: SEASON_ID, name: 'Fall 2026' }],
      penaltyRows: [],
      canonicalSourceRowCount: 0,
      careerBaseline: {
        id: BASELINE_ID,
        is_goalie: true,
        games_played: 12,
        goals: 1,
        assists: 3,
        points: 4,
      },
    });
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([]);

    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`),
      deps,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deps.readPublicProfileIdentity).toHaveBeenCalledWith(PLAYER_ID);
    expect(deps.getPlayerCareerStatsTimeline).toHaveBeenCalledWith(
      LEAGUE_ID,
      PLAYER_ID,
      true,
      { includeHistoricalBaseline: true },
    );
    expect(payload.player).toEqual({
      id: PLAYER_ID,
      name: 'Alex Alpha',
      avatar_url: 'https://images.example/alex.png',
    });
    expect(payload.totals).toEqual({
      games_played: 12,
      goals: 1,
      assists: 3,
      points: 4,
      penalty_minutes: null,
    });
    expect(payload.seasons).toEqual([{
      season_id: null,
      source_id: BASELINE_ID,
      season_name: 'Imported career history',
      team_id: null,
      team_name: null,
      sort_date: null,
      games_played: 12,
      goals: 1,
      assists: 3,
      points: 4,
      penalty_minutes: null,
      source: 'imported',
    }]);
  });

  it('does not append a virtual baseline when the canonical baseline season row exists', async () => {
    const deps = dependencies();
    deps.readCareerScope.mockResolvedValue({
      isEligible: true,
      isGoalie: false,
      seasonCatalog: [{ id: BASELINE_ID, name: 'Historical Career Baseline - Imported' }],
      penaltyRows: [],
      canonicalSourceRowCount: 0,
      historicalBaselineSourceRowCount: 1,
      careerBaseline: {
        id: BASELINE_ID,
        is_goalie: false,
        games_played: 10,
        goals: 8,
        assists: 9,
        points: 17,
      },
    });
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([careerRow({
      season_id: BASELINE_ID,
      season_name: 'Historical Career Baseline - Imported',
      team_id: null,
      team_name: null,
      games_played: 10,
      goals: 8,
      assists: 9,
      points: 17,
    })]);

    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), deps,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.seasons).toHaveLength(1);
    expect(payload.seasons[0]).toEqual(expect.objectContaining({ season_id: BASELINE_ID }));
    expect(payload.seasons[0]).not.toHaveProperty('source_id');
  });

  it('collapses repeated imported player aggregates across teams without guessing a team', async () => {
    const deps = dependencies();
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([
      careerRow({
        season_id: HLHL_WINTER_2026_SEASON_ID,
        season_name: 'Winter 2026',
        team_id: '70000000-0000-4000-8000-000000000007',
        team_name: 'Owls', games_played: 8, goals: 6, assists: 5, points: 11,
      }),
      careerRow({
        season_id: HLHL_WINTER_2026_SEASON_ID,
        season_name: 'Winter 2026',
        team_id: '80000000-0000-4000-8000-000000000008',
        team_name: 'Bears', games_played: 8, goals: 6, assists: 5, points: 11,
      }),
      careerRow({
        season_id: BASELINE_ID,
        season_name: 'Historical Career Baseline - Imported',
        team_id: null, team_name: null, games_played: 10, goals: 8, assists: 9, points: 17,
      }),
      careerRow({
        season_id: BASELINE_ID,
        season_name: 'Historical Career Baseline - Imported',
        team_id: '90000000-0000-4000-8000-000000000009',
        team_name: 'Legacy', games_played: 10, goals: 8, assists: 9, points: 17,
      }),
    ]);

    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), deps,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totals).toEqual({ games_played: 18, goals: 14, assists: 14, points: 28, penalty_minutes: null });
    expect(payload.seasons).toHaveLength(2);
    expect(payload.seasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ season_id: HLHL_WINTER_2026_SEASON_ID, team_id: null, team_name: null }),
      expect.objectContaining({ season_id: BASELINE_ID, team_id: null, team_name: null }),
    ]));
  });

  it('fails closed when repeated imported aggregate values disagree', async () => {
    const deps = dependencies();
    deps.getPlayerCareerStatsTimeline.mockResolvedValue([
      careerRow({ season_id: HLHL_WINTER_2026_SEASON_ID, season_name: 'Winter 2026', team_id: '70000000-0000-4000-8000-000000000007' }),
      careerRow({ season_id: HLHL_WINTER_2026_SEASON_ID, season_name: 'Winter 2026', team_id: '80000000-0000-4000-8000-000000000008', goals: 99 }),
    ]);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), deps,
    );
    log.mockRestore();
    expect(response.status).toBe(503);
  });

  it.each([
    ['', 'INVALID_QUERY'],
    [`leagueSlug=hockey-life`, 'INVALID_QUERY'],
    [`leagueSlug=hockey-life&playerId=nope`, 'INVALID_PLAYER_ID'],
    [`leagueSlug=hockey-life&playerId=${PLAYER_ID}&wat=1`, 'INVALID_QUERY'],
    [`leagueSlug=hockey-life&playerId=${PLAYER_ID}&playerId=${PLAYER_ID}`, 'INVALID_QUERY'],
  ])('rejects malformed query before reads: %s', async (query, code) => {
    const deps = dependencies();
    const response = await handlePublicPlayerCareerRequest(request('player-career', query), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(deps.getLeagueBySlug).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant hosts and cross-league players without stat reads', async () => {
    const hostDeps = dependencies();
    const hostResponse = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`, 'other.beerleaguehockey.ca'),
      hostDeps,
    );
    expect(hostResponse.status).toBe(400);
    expect(hostDeps.getPlayerCareerStatsTimeline).not.toHaveBeenCalled();

    const memberDeps = dependencies();
    memberDeps.readCareerScope.mockResolvedValue({
      isEligible: false,
      isGoalie: false,
      seasonCatalog: [],
      penaltyRows: [],
      canonicalSourceRowCount: 0,
    });
    const memberResponse = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`),
      memberDeps,
    );
    expect(memberResponse.status).toBe(404);
    expect(memberDeps.getPlayerCareerStatsTimeline).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate keys, swallowed-source evidence, nonfinite values, and row overflow', async () => {
    for (const configure of [
      (deps: jest.Mocked<PublicNativeStatsDependencies>) => deps.getPlayerCareerStatsTimeline.mockResolvedValue([careerRow({}), careerRow({})]),
      (deps: jest.Mocked<PublicNativeStatsDependencies>) => {
        deps.readCareerScope.mockResolvedValue({ isEligible: true, isGoalie: false, seasonCatalog: [{ id: SEASON_ID, name: 'Fall 2026' }], penaltyRows: [], canonicalSourceRowCount: 1 });
        deps.getPlayerCareerStatsTimeline.mockResolvedValue([]);
      },
      (deps: jest.Mocked<PublicNativeStatsDependencies>) => deps.getPlayerCareerStatsTimeline.mockResolvedValue([careerRow({ points: Number.NaN })]),
      (deps: jest.Mocked<PublicNativeStatsDependencies>) => deps.getPlayerCareerStatsTimeline.mockResolvedValue(Array.from({ length: 501 }, (_, index) => careerRow({ team_id: `team-${index}` }))),
    ]) {
      const deps = dependencies();
      configure(deps);
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      const response = await handlePublicPlayerCareerRequest(
        request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`),
        deps,
      );
      log.mockRestore();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('GET /api/public/goalies', () => {
  it('uses only the explicit current season, keeps web percent scale, and sorts deterministically', async () => {
    const deps = dependencies();
    deps.getUnifiedGoalieStatsRows.mockResolvedValue([
      {
        player_id: PLAYER_ID_2, player_name: 'Zed', team_id: TEAM_ID_2, team_name: 'B', avatar_url: null,
        games_played: 4, wins: 3, losses: 1, save_percentage: 91.2, goals_against_average: 2,
        shutouts: 1, saves: 73, goals_against: 7, division_name: null, position: 'Goalie', championships: 0,
      },
      {
        player_id: PLAYER_ID, player_name: 'Amy', team_id: TEAM_ID, team_name: 'A', avatar_url: null,
        games_played: 4, wins: 3, losses: 1, save_percentage: null, goals_against_average: null,
        shutouts: 0, saves: 0, goals_against: 0, division_name: null, position: 'Goalie', championships: 0,
      },
    ]);

    const response = await handlePublicGoaliesRequest(
      request('goalies', `leagueSlug=hockey-life&seasonId=${SEASON_ID}&divisionId=${DIVISION_ID}`),
      deps,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe('recorded');
    expect(payload.goalies.map((row: { player_id: string }) => row.player_id)).toEqual([PLAYER_ID, PLAYER_ID_2]);
    expect(payload.goalies[1].save_percentage).toBe(91.2);
    // eslint-disable-next-line supabase-test-quality/no-mock-echo -- estimated is adapter-derived and absent from producer rows
    expect(payload.goalies.every((row: { estimated: boolean }) => row.estimated === false)).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/championships|division_name|position|jersey|email/);
    expect(deps.getUnifiedGoalieStatsRows).toHaveBeenCalledWith(
      LEAGUE_ID,
      SEASON_ID,
      DIVISION_ID,
      'hockey-life',
      'Fall 2026',
    );
    expect(deps.readGoalieStatsSourceCount).toHaveBeenCalledWith(LEAGUE_ID, SEASON_ID, DIVISION_ID);
  });

  it('marks the canonical 20-shots fallback as estimated without converting its web percentage', async () => {
    const deps = dependencies();
    deps.readGoalieStatsSourceCount.mockResolvedValue(0);
    deps.getUnifiedGoalieStatsRows.mockResolvedValue([{
      player_id: PLAYER_ID, player_name: 'Goal E.', team_id: TEAM_ID, team_name: 'Team', avatar_url: null,
      games_played: 2, wins: 1, losses: 1, save_percentage: 87.5, goals_against_average: 2.5,
      shutouts: 0, saves: 35, goals_against: 5, division_name: null, position: 'Goalie', championships: 0,
    }]);
    const response = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), deps);
    const payload = await response.json();
    expect(payload.source).toBe('estimated');
    expect(payload.goalies[0]).toEqual(expect.objectContaining({ estimated: true, saves: 35, save_percentage: 87.5 }));
  });

  it('returns factual empty data without invoking all-time when there is no current season', async () => {
    const deps = dependencies();
    deps.readPresentationSeason.mockResolvedValue(null);
    const response = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      leagueId: LEAGUE_ID,
      leagueSlug: 'hockey-life',
      presentationSeason: null,
      divisionId: null,
      source: 'empty',
      goalies: [],
    });
    expect(deps.getUnifiedGoalieStatsRows).not.toHaveBeenCalled();
    expect(deps.readGoalieStatsSourceCount).not.toHaveBeenCalled();
  });

  it('marks imported Winter goalie saves estimated even when recorded source rows exist and permits null team provenance', async () => {
    const deps = dependencies();
    deps.readPresentationSeason.mockResolvedValue({
      id: HLHL_WINTER_2026_SEASON_ID, league_id: LEAGUE_ID, name: 'Winter 2026', status: 'completed',
    });
    deps.readGoalieStatsSourceCount.mockResolvedValue(3);
    deps.getUnifiedGoalieStatsRows.mockResolvedValue([{
      player_id: PLAYER_ID, player_name: 'Goal E.', team_id: '', team_name: 'Imported Team', avatar_url: null,
      games_played: 2, wins: 1, losses: 1, save_percentage: 87.5, goals_against_average: 2.5,
      shutouts: 0, saves: 35, goals_against: 5, division_name: null, position: 'Goalie', championships: 0,
    }]);
    const response = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      source: 'estimated',
      goalies: [expect.objectContaining({ player_id: PLAYER_ID, team_id: null, estimated: true })],
    }));
  });

  it('rejects invalid player/team IDs and duplicate goalie DTO keys', async () => {
    for (const rows of [
      [{ player_id: 'bad', team_id: null }],
      [{ player_id: PLAYER_ID, team_id: 'bad' }],
      [{ player_id: PLAYER_ID, team_id: null }, { player_id: PLAYER_ID, team_id: null }],
    ]) {
      const deps = dependencies();
      deps.getUnifiedGoalieStatsRows.mockResolvedValue(rows.map((ids) => ({
        ...ids, player_name: 'G', team_name: 'T', avatar_url: null, games_played: 1, wins: 1, losses: 0,
        save_percentage: 90, goals_against_average: 2, shutouts: 0, saves: 18, goals_against: 2,
        division_name: null, position: 'Goalie', championships: 0,
      })) as never);
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      const response = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), deps);
      log.mockRestore();
      expect(response.status).toBe(503);
    }
  });

  it('rejects season mismatch and foreign division before goalie reads', async () => {
    const deps = dependencies();
    const mismatch = await handlePublicGoaliesRequest(
      request('goalies', 'leagueSlug=hockey-life&seasonId=99999999-0000-4000-8000-000000000009'),
      deps,
    );
    expect(mismatch.status).toBe(409);
    expect(deps.getUnifiedGoalieStatsRows).not.toHaveBeenCalled();

    const divisionDeps = dependencies();
    const foreign = await handlePublicGoaliesRequest(
      request('goalies', 'leagueSlug=hockey-life&divisionId=99999999-0000-4000-8000-000000000009'),
      divisionDeps,
    );
    expect(foreign.status).toBe(400);
    expect(divisionDeps.getUnifiedGoalieStatsRows).not.toHaveBeenCalled();
  });

  it.each([
    ['leagueSlug=hockey-life&seasonId=', 'INVALID_SEASON_ID'],
    ['leagueSlug=hockey-life&divisionId=', 'INVALID_DIVISION_ID'],
    ['leagueSlug=hockey-life&wat=1', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&seasonId=x&seasonId=x', 'INVALID_QUERY'],
  ])('rejects malformed goalie query before reads: %s', async (query, code) => {
    const deps = dependencies();
    const response = await handlePublicGoaliesRequest(request('goalies', query), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(deps.getLeagueBySlug).not.toHaveBeenCalled();
  });

  it('does not treat source errors as empty and rejects nonfinite/range-invalid or overflowing output', async () => {
    const sourceDeps = dependencies();
    sourceDeps.readGoalieStatsSourceCount.mockRejectedValue(new Error('provider secret'));
    const sourceLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const sourceResponse = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), sourceDeps);
    sourceLog.mockRestore();
    expect(sourceResponse.status).toBe(503);
    expect(JSON.stringify(await sourceResponse.json())).not.toContain('provider secret');

    for (const value of [Number.POSITIVE_INFINITY, 101]) {
      const deps = dependencies();
      deps.getUnifiedGoalieStatsRows.mockResolvedValue([{
        player_id: PLAYER_ID, player_name: 'G', team_id: TEAM_ID, team_name: 'T', avatar_url: null,
        games_played: 1, wins: 1, losses: 0, save_percentage: value, goals_against_average: 0,
        shutouts: 1, saves: 20, goals_against: 0, division_name: null, position: 'Goalie', championships: 0,
      }]);
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      const response = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), deps);
      log.mockRestore();
      expect(response.status).toBe(503);
    }

    const overflowDeps = dependencies();
    overflowDeps.getUnifiedGoalieStatsRows.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({
      player_id: `p-${index}`, player_name: `G ${index}`, team_id: `t-${index}`, team_name: 'T', avatar_url: null,
      games_played: 1, wins: 0, losses: 1, save_percentage: 90, goals_against_average: 2,
      shutouts: 0, saves: 18, goals_against: 2, division_name: null, position: 'Goalie', championships: 0,
    })));
    const overflow = await handlePublicGoaliesRequest(request('goalies', 'leagueSlug=hockey-life'), overflowDeps);
    expect(overflow.status).toBe(503);
  });
});

describe('strict support reads', () => {
  afterEach(() => {
    mockedCreateClient.mockReset();
    mockedCreateServiceRoleClient.mockReset();
  });

  it('reads a direct public profile with only allowlisted identity fields and propagates errors', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: PLAYER_ID, full_name: 'Alex Alpha', avatar_url: null, photo_url: 'photo' },
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    mockedCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue({ select }) } as never);

    await expect(readPublicProfileIdentity(PLAYER_ID)).resolves.toEqual({
      id: PLAYER_ID,
      full_name: 'Alex Alpha',
      avatar_url: null,
      photo_url: 'photo',
    });
    expect(select).toHaveBeenCalledWith('id, full_name, avatar_url, photo_url');
    expect(eq).toHaveBeenCalledWith('id', PLAYER_ID);

    maybeSingle.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(readPublicProfileIdentity(PLAYER_ID)).rejects.toThrow('public profile identity read failed');
  });

  it('uses scoped baseline eligibility and its is_goalie flag from the deployed schema when there is no roster', async () => {
    const seasonLimit = jest.fn().mockResolvedValue({ data: [], error: null });
    const seasonEq = jest.fn().mockReturnValue({ limit: seasonLimit });

    const rosterLimit = jest.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const rosterOrderId = jest.fn().mockReturnValue({ limit: rosterLimit });
    const rosterOrderJoined = jest.fn().mockReturnValue({ order: rosterOrderId });
    const rosterEqPlayer = jest.fn().mockReturnValue({ order: rosterOrderJoined });
    const rosterEqLeague = jest.fn().mockReturnValue({ eq: rosterEqPlayer });

    const penaltyRange = jest.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const penaltyOrder = jest.fn().mockReturnValue({ range: penaltyRange });
    const penaltyEqGame = jest.fn().mockReturnValue({ order: penaltyOrder });
    const penaltyEqPlayer = jest.fn().mockReturnValue({ eq: penaltyEqGame });
    const penaltyEqLeague = jest.fn().mockReturnValue({ eq: penaltyEqPlayer });

    const goalieEqPlayer = jest.fn().mockResolvedValue({ data: null, count: 0, error: null });
    const goalieEqLeague = jest.fn().mockReturnValue({ eq: goalieEqPlayer });

    mockedCreateClient.mockResolvedValue({
      from: jest.fn((table: string) => ({
        select: table === 'seasons'
          ? jest.fn().mockReturnValue({ eq: seasonEq })
          : table === 'team_rosters'
            ? jest.fn().mockReturnValue({ eq: rosterEqLeague })
            : table === 'goalie_stats'
              ? jest.fn().mockReturnValue({ eq: goalieEqLeague })
              : jest.fn().mockReturnValue({ eq: penaltyEqLeague }),
      })),
    } as never);

    const baselineLimit = jest.fn().mockResolvedValue({
      data: [{ id: BASELINE_ID, is_goalie: true, games_played: 12, goals: 1, assists: 3, points: 4 }],
      count: 1,
      error: null,
    });
    const baselineEqPlayer = jest.fn().mockReturnValue({ limit: baselineLimit });
    const baselineEqLeague = jest.fn().mockReturnValue({ eq: baselineEqPlayer });
    const baselineSelect = jest.fn().mockReturnValue({ eq: baselineEqLeague });
    mockedCreateServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: baselineSelect }),
    } as never);

    await expect(readCareerScope(LEAGUE_ID, PLAYER_ID)).resolves.toEqual({
      isEligible: true,
      isGoalie: true,
      seasonCatalog: [],
      penaltyRows: [],
      canonicalSourceRowCount: 0,
      historicalBaselineSourceRowCount: 1,
      careerBaseline: {
        id: BASELINE_ID,
        is_goalie: true,
        games_played: 12,
        goals: 1,
        assists: 3,
        points: 4,
      },
    });
    expect(baselineSelect).toHaveBeenCalledWith(
      'id, is_goalie, games_played, goals, assists, points, wins, ties, saves, goals_against, shutouts, goals_against_average, save_percentage',
      { count: 'exact' },
    );
    expect(rosterOrderJoined).toHaveBeenCalledWith('joined_at', { ascending: false, nullsFirst: false });
    expect(rosterOrderId).toHaveBeenCalledWith('id', { ascending: false });
    expect(rosterLimit).toHaveBeenCalledWith(1);
    expect(baselineEqLeague).toHaveBeenCalledWith('league_id', LEAGUE_ID);
    expect(baselineEqPlayer).toHaveBeenCalledWith('player_id', PLAYER_ID);
    expect(baselineLimit).toHaveBeenCalledWith(2);
  });

  it('rejects ambiguous scoped baseline records', async () => {
    const deps = dependencies();
    deps.readCareerScope.mockResolvedValue({
      isEligible: true,
      isGoalie: false,
      seasonCatalog: [],
      penaltyRows: [],
      canonicalSourceRowCount: 0,
      historicalBaselineSourceRowCount: 2,
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handlePublicPlayerCareerRequest(
      request('player-career', `leagueSlug=hockey-life&playerId=${PLAYER_ID}`), deps,
    );
    log.mockRestore();
    expect(response.status).toBe(503);
  });

  it('propagates a seasons query failure from the actual default presentation-season reader', async () => {
    const secondOrder = jest.fn().mockResolvedValue({ data: null, error: new Error('offline') });
    const firstOrder = jest.fn().mockReturnValue({ order: secondOrder });
    const eq = jest.fn().mockReturnValue({ order: firstOrder });
    const select = jest.fn().mockReturnValue({ eq });
    mockedCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue({ select }) } as never);

    await expect(readPresentationSeason(LEAGUE_ID)).rejects.toThrow('current season read failed');
  });

  it('requires exact PIM counts, orders pages by id, and rejects duplicate returned IDs', async () => {
    const order = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({
        data: [
          { id: 'a0000000-0000-4000-8000-000000000001', season_id: SEASON_ID, team_id: '70000000-0000-4000-8000-000000000007', penalty_minutes: 1 },
          { id: 'a0000000-0000-4000-8000-000000000001', season_id: SEASON_ID, team_id: '70000000-0000-4000-8000-000000000007', penalty_minutes: 2 },
        ],
        count: 2,
        error: null,
      }),
    });
    const eq3 = jest.fn().mockReturnValue({ order });
    const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const select = jest.fn().mockReturnValue({ eq: eq1 });
    mockedCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue({ select }) } as never);

    await expect(readAllPenaltyRows(LEAGUE_ID, PLAYER_ID)).rejects.toThrow('duplicate player stats source id');
    expect(order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('rejects a missing exact PIM count header', async () => {
    const order = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({ data: [], count: null, error: null }),
    });
    const eq3 = jest.fn().mockReturnValue({ order });
    const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    mockedCreateClient.mockResolvedValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: eq1 }) }),
    } as never);

    await expect(readAllPenaltyRows(LEAGUE_ID, PLAYER_ID)).rejects.toThrow('player stats source count missing');
  });
});
