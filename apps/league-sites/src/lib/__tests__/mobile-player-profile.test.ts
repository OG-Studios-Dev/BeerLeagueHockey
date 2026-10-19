import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import {
  HOCKEY_LIFE_ID,
  handleMobilePlayerProfileRequest,
  mobilePlayerProfileDependencies,
  type MobilePlayerProfileDependencies,
} from '@/lib/mobile-player-profile';
import {
  getConfirmedCheckinAppearanceRows,
  getFallbackRosterAppearanceRows,
  classifyStrictGoalieCareerSources,
  classifyStrictSkaterCareerSources,
  getPlayerBadges,
  getPlayerCareerStats,
  getPlayerCareerStatsTimeline,
  getPlayerGameLog,
  getPlayerGoalieMatchups,
  getSeasons,
  generatePlayerCareerHotFacts,
  loadTeamGameCountsBySeasonTeam,
  summarizePlayerCareerTotalsFromTimeline,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  aggregatePublicSeasonStats,
  type PublicSeasonMetricPlayer,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';
import * as dataModule from '@/lib/data';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }));
const mockedCreateClient = jest.mocked(createClient);
const mockedCreateServiceRoleClient = jest.mocked(createServiceRoleClient);

const PROFILE_ID = 'add94b26-b344-459f-9727-8cddae9783de';
const ROSTER_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '145ac7ee-99fb-4a50-a0b5-37f24e9991f3';
const TEAM_ID = '093f611c-0cdc-4509-afde-9c661b5833c9';
const WINTER_2026_ID = '30ee2c0b-5981-4df4-b0cc-d7cae05b9e37';
const OTHER_SEASON_ID = '20000000-0000-4000-8000-000000000002';
const OTHER_LEAGUE_ID = '30000000-0000-4000-8000-000000000003';
const HISTORICAL_BASELINE_ID = 'e813368a-6389-4678-b596-294e70e89a9a';

function req(query: string) {
  return new NextRequest(`https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?${query}`);
}

function canonicalPlayer(gamesPlayed = 0): PublicSeasonMetricPlayer {
  const unknown = { value: null, state: 'unknown' as const, sources: [] };
  return {
    playerId: PROFILE_ID,
    playerName: 'Matt Grossi',
    avatarUrl: null,
    displayTeam: null,
    teams: [],
    roles: ['skater'],
    metrics: {
      gamesPlayed: { value: gamesPlayed, state: 'reported', sources: ['roster_window'] },
      goals: unknown,
      assists: unknown,
      points: unknown,
      penaltyMinutes: unknown,
    },
    goalie: null,
  };
}

function deps(): jest.Mocked<MobilePlayerProfileDependencies> {
  const timeline = [{
    season_id: SEASON_ID, season_name: 'Fall 2026', sort_date: '2026-09-01', team_id: TEAM_ID,
    team_name: 'Bad Bunny', position: 'C', games_played: 0, team_games: 0, attendance_pct: 0,
    goals: 0, assists: 0, points: 0, goals_per_game: 0, points_per_game: 0,
    wins: 0, losses: 0, ties: 0, saves: 0, goals_against: 0, save_percentage: null,
    goals_against_average: null, shutouts: 0,
  }];
  return {
    getLeague: jest.fn().mockResolvedValue({ id: HOCKEY_LIFE_ID, slug: 'hockey-life', status: 'active' }),
    resolvePlayer: jest.fn().mockResolvedValue({
      id: ROSTER_ID, player_id: PROFILE_ID, jersey_number: 36, position: 'C', leadership_role: 'captain',
      is_goalie: false, profile: { full_name: 'Matt Grossi', avatar_url: 'https://img/player.png', photo_url: null },
      team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny', logo_url: 'https://img/team.png', primary_color: '#ff0000', league_id: HOCKEY_LIFE_ID },
    }),
    getSeasons: jest.fn().mockResolvedValue([{ id: SEASON_ID, name: 'Fall 2026', start_date: '2026-09-01', status: 'active', league_id: HOCKEY_LIFE_ID }]),
    getCurrentSeason: jest.fn().mockResolvedValue({ id: SEASON_ID, name: 'Fall 2026' }),
    getStats: jest.fn().mockResolvedValue({ games_played: 0, goals: 0, assists: 0, points: 0, penalty_minutes: 0, plus_minus: 0 }),
    getPublicSeasonPlayer: jest.fn().mockResolvedValue(canonicalPlayer()),
    getTimeline: jest.fn().mockResolvedValue(timeline),
    getGames: jest.fn().mockResolvedValue([]),
    getBadges: jest.fn().mockResolvedValue([{ id: 'b', player_id: PROFILE_ID, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, team_id: TEAM_ID, badge_type: 'top_scorer', metadata: {}, created_at: '2026-09-02', season: { name: 'Fall 2026' }, team: { name: 'Bad Bunny' } }]),
    getImportedAchievements: jest.fn().mockResolvedValue({ championships: 2 }),
    getArticles: jest.fn().mockResolvedValue([{ id: 'a', league_id: HOCKEY_LIFE_ID, slug: 'story', title: 'Story', excerpt: null, image_url: '/news/story.jpg', published_at: '2026-09-03', type: 'news' }]),
    getMatchups: jest.fn().mockResolvedValue([]),
    generateHotFacts: jest.fn().mockResolvedValue(['Fact']),
  } as unknown as jest.Mocked<MobilePlayerProfileDependencies>;
}

describe('mobile Player Profile production dependencies', () => {
  it('[v13 mobile wiring] opts production Profile timeline hydration into a strict concurrency of two', async () => {
    const getTimeline = jest.spyOn(dataModule, 'getPlayerCareerStatsTimeline').mockResolvedValue([]);

    try {
      await mobilePlayerProfileDependencies.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
      expect(getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, false, {
        includeHistoricalBaseline: true,
        strict: true,
        profileSafeStrictAppearanceHydration: true,
        profileSafeStrictAppearanceBatchConcurrency: 2,
      });
    } finally {
      getTimeline.mockRestore();
    }
  });

  it('[v13 mobile wiring] opts production Profile game-log batches and evidence into a strict concurrency of two', async () => {
    const getGames = jest.spyOn(dataModule, 'getPlayerGameLog').mockResolvedValue([]);

    try {
      await mobilePlayerProfileDependencies.getGames(PROFILE_ID, SEASON_ID);
      expect(getGames).toHaveBeenCalledWith(PROFILE_ID, SEASON_ID, 20, {
        strict: true,
        strictBatchConcurrency: 2,
        strictEvidenceBatchConcurrency: 2,
      });
    } finally {
      getGames.mockRestore();
    }
  });

  it('[v13 production coordinator pressure] preserves the V12.1 graph and body while capping one route at two provider reads and three routes at six', async () => {
    const production = await runProductionCoordinatorPressure();
    const aggregate = await runProductionCoordinatorPressure(undefined, 3);

    expect(production.prerequisiteTables).toEqual([
      'leagues', 'team_rosters', 'team_rosters', 'seasons', 'seasons',
    ]);
    expect(createHash('sha256').update(JSON.stringify(production.body)).digest('hex'))
      .toBe('9a6709fe28eb294d0f90d360b53319d30877d37f7f0a8c6fd1ed5b1af66255df');
    expect(aggregate.statuses).toEqual([200, 200, 200]);
    expect(aggregate.bodies).toEqual([production.body, production.body, production.body]);
    expect({
      fullRouteRequestCount: production.requestCount,
      responseGraphRequestCount: production.responseGraphRequestCount,
      healthHeadRequests: production.healthHeadRequests,
      hasProductionHealthHook: Object.prototype.hasOwnProperty.call(mobilePlayerProfileDependencies, 'assertHealthy'),
      maxActive: production.maxActive,
      activeAtReturn: production.activeAtReturn,
      allSettledAtReturn: production.allSettledAtReturn,
      phaseMaxActive: production.phaseMaxActive,
      phaseOrder: production.phaseOrder,
      overlappingPhasePairs: production.overlappingPhasePairs,
      aggregateRequestCount: aggregate.requestCount,
      aggregateMaxActive: aggregate.maxActive,
      aggregateActiveAtReturn: aggregate.activeAtReturn,
      aggregateAllSettledAtReturn: aggregate.allSettledAtReturn,
    }).toEqual({
      fullRouteRequestCount: 42,
      responseGraphRequestCount: 37,
      healthHeadRequests: [],
      hasProductionHealthHook: false,
      maxActive: 2,
      activeAtReturn: 0,
      allSettledAtReturn: true,
      phaseMaxActive: {
        prerequisites: 2,
        selectedStats: 1,
        timeline: 2,
        gameLog: 2,
        decorative: 2,
      },
      phaseOrder: ['prerequisites', 'selectedStats', 'timeline', 'gameLog', 'decorative'],
      overlappingPhasePairs: [],
      aggregateRequestCount: 126,
      aggregateMaxActive: 6,
      aggregateActiveAtReturn: 0,
      aggregateAllSettledAtReturn: true,
    });
    expect(production.maxActive).not.toBe(4);
    expect(aggregate.maxActive).not.toBe(12);
    expect(Math.max(...Object.values(production.phaseMaxActive))).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/mobile/player-profile', () => {
  it('[v12 response headers] separates the successful browser and Vercel CDN cache policies', async () => {
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), deps());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('public, max-age=60, must-revalidate');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).not.toContain('s-maxage');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).not.toContain('stale-while-revalidate');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).not.toContain('stale-if-error');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('[v12 response headers] keeps representative 400, 404, and dependency 502 responses uncached', async () => {
    const invalid = await handleMobilePlayerProfileRequest(req('playerId=nope'), deps());
    const missingPlayerDeps = deps();
    missingPlayerDeps.resolvePlayer.mockResolvedValue(null);
    const missingPlayer = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), missingPlayerDeps);
    const failingDeps = deps();
    failingDeps.getPublicSeasonPlayer.mockRejectedValue({ code: '57014' });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const dependencyFailure = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), failingDeps);
    log.mockRestore();

    for (const [response, status] of [
      [invalid, 400],
      [missingPlayer, 404],
      [dependencyFailure, 502],
    ] as const) {
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('rejects malformed and invalid selection input before player helpers', async () => {
    const d = deps();
    expect((await handleMobilePlayerProfileRequest(req('playerId=nope'), d)).status).toBe(400);
    expect((await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=nope`), d)).status).toBe(400);
    expect(d.resolvePlayer).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown/foreign-league membership before canonical helpers', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue(null);
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    expect(response.status).toBe(404);
    expect(d.getSeasons).not.toHaveBeenCalled();
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('projects the anonymous DTO only, resolves artwork, and preserves valid zero/null stats', async () => {
    const d = deps();
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${ROSTER_ID}`), d);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe(1);
    expect(body.league).toEqual({ id: HOCKEY_LIFE_ID, slug: 'hockey-life' });
    expect(body.data).toMatchObject({ playerId: PROFILE_ID, rosterId: ROSTER_ID, metrics: { games_played: 0, points: null }, aggregateOnly: false });
    expect(body.data.metrics.save_percentage).toBeNull();
    expect(body.data.heroAwards).toEqual([
      { key: 'championships', label: 'Championships', count: 2, imageUrl: 'https://hockey-life.beerleaguehockey.ca/awards/championship-trophy.png' },
      { key: 'top_scorer', label: 'Top Scorer', count: 1, imageUrl: 'https://hockey-life.beerleaguehockey.ca/awards/top-scorer-trophy.png' },
    ]);
    expect(body.data.articles[0].imageUrl).toBe('https://hockey-life.beerleaguehockey.ca/news/story.jpg');
    expect(JSON.stringify(body)).not.toMatch(/phone|author_id|metadata/);
  });

  it('rejects a UUID season outside the visible league catalog', async () => {
    const d = deps();
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=20000000-0000-4000-8000-000000000002`), d);
    expect(response.status).toBe(400);
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('suppresses per-game work for career and aggregate-only selections', async () => {
    for (const season of ['all', SEASON_ID]) {
      const d = deps();
      if (season === SEASON_ID) d.getSeasons.mockResolvedValue([{ id: SEASON_ID, name: 'Historical Career Baseline - Imported', start_date: '2026-01-01', status: 'completed', league_id: HOCKEY_LIFE_ID }]);
      const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=${season}`), d);
      expect(response.status).toBe(200);
      expect(d.getGames).not.toHaveBeenCalled();
      expect(d.getMatchups).not.toHaveBeenCalled();
    }
  });

  it('[v13 prerequisite scheduler] starts only the independent season pair together and consumes both before selected stats', async () => {
    const d = deps();
    const starts: string[] = [];
    const resolvers = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;
    const providerRead = <T,>(name: string, value: T) => {
      starts.push(name);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<T>((resolve) => {
        resolvers.set(name, () => {
          active -= 1;
          resolve(value);
        });
      });
    };
    const seasons = await d.getSeasons(HOCKEY_LIFE_ID);
    const currentSeason = await d.getCurrentSeason(HOCKEY_LIFE_ID);
    d.getSeasons.mockClear();
    d.getCurrentSeason.mockClear();
    d.getSeasons.mockImplementation(() => providerRead('seasons', seasons));
    d.getCurrentSeason.mockImplementation(() => providerRead('currentSeason', currentSeason));

    const pendingResponse = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['seasons', 'currentSeason']);
    expect(maxActive).toBe(2);
    resolvers.get('currentSeason')!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.getPublicSeasonPlayer).not.toHaveBeenCalled();
    resolvers.get('seasons')!();
    const response = await pendingResponse;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.selectedSeasonId).toBe(SEASON_ID);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it('[v13 prerequisite scheduler] consumes the started pair after abort and starts no selected or later dependency', async () => {
    const d = deps();
    const seasons = await d.getSeasons(HOCKEY_LIFE_ID);
    const currentSeason = await d.getCurrentSeason(HOCKEY_LIFE_ID);
    d.getSeasons.mockClear();
    d.getCurrentSeason.mockClear();
    let resolveSeasons!: () => void;
    let resolveCurrentSeason!: () => void;
    let active = 0;
    d.getSeasons.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      resolveSeasons = () => { active -= 1; resolve(seasons); };
    }));
    d.getCurrentSeason.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      resolveCurrentSeason = () => { active -= 1; resolve(currentSeason); };
    }));
    const controller = new AbortController();
    const request = new NextRequest(
      `https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?playerId=${PROFILE_ID}`,
      { signal: controller.signal },
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pendingResponse = handleMobilePlayerProfileRequest(request, d);
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.getSeasons).toHaveBeenCalledTimes(1);
    expect(d.getCurrentSeason).toHaveBeenCalledTimes(1);
    expect(active).toBe(2);
    controller.abort();
    resolveCurrentSeason();
    resolveSeasons();
    const response = await pendingResponse;
    log.mockRestore();

    expect(response.status).toBe(502);
    expect(active).toBe(0);
    expect(d.getPublicSeasonPlayer).not.toHaveBeenCalled();
    expect(d.getTimeline).not.toHaveBeenCalled();
    expect(d.getGames).not.toHaveBeenCalled();
    expect(d.getBadges).not.toHaveBeenCalled();
  });

  it('[v13 deterministic waves] retains sequential major phases with only prerequisite and decorative pairs overlapping', async () => {
    jest.useFakeTimers({ now: 0 });
    const d = deps();
    const starts: Array<{ name: string; at: number }> = [];
    let active = 0;
    let maxActive = 0;
    const dependencyNames = [
      'getLeague',
      'resolvePlayer',
      'getSeasons',
      'getCurrentSeason',
      'getPublicSeasonPlayer',
      'getTimeline',
      'getGames',
      'getBadges',
      'getImportedAchievements',
      'getArticles',
      'getMatchups',
      'generateHotFacts',
    ] as const;
    const dependencyRecord = d as unknown as Record<string, jest.Mock>;
    for (const name of dependencyNames) {
      const original = dependencyRecord[name];
      dependencyRecord[name] = jest.fn(async (...args: unknown[]) => {
        starts.push({ name, at: Date.now() });
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        try {
          return await original(...args);
        } finally {
          active -= 1;
        }
      });
    }

    try {
      const responseRead = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
      await jest.advanceTimersByTimeAsync(90);
      const response = await responseRead;

      expect(response.status).toBe(200);
      expect(starts).toEqual([
        { name: 'getLeague', at: 0 },
        { name: 'resolvePlayer', at: 10 },
        { name: 'getSeasons', at: 20 },
        { name: 'getCurrentSeason', at: 20 },
        { name: 'getPublicSeasonPlayer', at: 30 },
        { name: 'getTimeline', at: 40 },
        { name: 'getGames', at: 50 },
        { name: 'getBadges', at: 60 },
        { name: 'getImportedAchievements', at: 60 },
        { name: 'getArticles', at: 70 },
        { name: 'getMatchups', at: 70 },
        { name: 'generateHotFacts', at: 80 },
      ]);
      expect(new Set(starts.map((start) => start.at)).size).toBe(9);
      expect(Date.now()).toBe(90);
      expect(maxActive).toBe(2);
      expect(active).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('loads one baseline-inclusive strict timeline and derives visible and totals views from it', async () => {
    const d = deps();
    const visible = (await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, false))[0];
    const baseline = {
      ...visible,
      season_id: 'e813368a-6389-4678-b596-294e70e89a9a',
      season_name: 'Historical Career Baseline (Pre-BLH)',
      team_id: null,
      team_name: null,
      games_played: 12,
      goals: 8,
      assists: 9,
      points: 17,
    };
    d.getTimeline.mockClear();
    d.getTimeline.mockResolvedValue([baseline, visible]);

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(d.getTimeline).toHaveBeenCalledTimes(1);
    expect(d.getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    expect(body.data.careerRows).toHaveLength(1);
    expect(body.data.careerRows[0].seasonId).toBe(SEASON_ID);
    expect(d.generateHotFacts).toHaveBeenCalledWith(expect.objectContaining({
      seasons: [visible],
      careerTotalsSeasons: [baseline, visible],
    }));
  });

  it('[v7 phase order] resolves the selected role before starting one canonical-role timeline or later dependencies', async () => {
    const d = deps();
    const timeline = await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true);
    d.getTimeline.mockClear();
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 1, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: unknown,
      savePercentage: unknown,
      goalsAgainstAverage: unknown,
      shutouts: unknown,
    };
    let resolveCanonical!: (value: PublicSeasonMetricPlayer) => void;
    let resolveTimeline!: (value: PlayerCareerSeasonRow[]) => void;
    d.getPublicSeasonPlayer.mockImplementation(() => new Promise((resolve) => { resolveCanonical = resolve; }));
    d.getTimeline.mockImplementation(() => new Promise((resolve) => { resolveTimeline = resolve; }));

    const pendingResponse = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    await new Promise((resolve) => setImmediate(resolve));
    const beforeCanonical = {
      timelineRoles: d.getTimeline.mock.calls.map((call) => call[2]),
      stats: d.getStats.mock.calls.length,
      games: d.getGames.mock.calls.length,
      matchups: d.getMatchups.mock.calls.length,
      badges: d.getBadges.mock.calls.length,
      achievements: d.getImportedAchievements.mock.calls.length,
      articles: d.getArticles.mock.calls.length,
      hotFacts: d.generateHotFacts.mock.calls.length,
    };

    resolveCanonical(canonical);
    await new Promise((resolve) => setImmediate(resolve));
    const whileTimelinePending = {
      timelineRoles: d.getTimeline.mock.calls.map((call) => call[2]),
      stats: d.getStats.mock.calls.length,
      games: d.getGames.mock.calls.length,
      matchups: d.getMatchups.mock.calls.length,
      badges: d.getBadges.mock.calls.length,
      achievements: d.getImportedAchievements.mock.calls.length,
      articles: d.getArticles.mock.calls.length,
      hotFacts: d.generateHotFacts.mock.calls.length,
    };

    resolveTimeline(timeline);
    await expect(pendingResponse).resolves.toMatchObject({ status: 200 });
    expect(beforeCanonical).toEqual({
      timelineRoles: [], stats: 0, games: 0, matchups: 0,
      badges: 0, achievements: 0, articles: 0, hotFacts: 0,
    });
    expect(whileTimelinePending).toEqual({
      timelineRoles: [true], stats: 0, games: 0, matchups: 0,
      badges: 0, achievements: 0, articles: 0, hotFacts: 0,
    });
    expect(d.getTimeline).toHaveBeenCalledTimes(1);
  });

  it('[v7 zero discarded work] starts only canonical-role timeline and matchup reads', async () => {
    const d = deps();
    const timeline = await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true);
    d.getTimeline.mockClear();
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['skater', 'goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 1, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: unknown,
      savePercentage: unknown,
      goalsAgainstAverage: unknown,
      shutouts: unknown,
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);
    d.getTimeline.mockImplementation((_leagueId, _playerId, isGoalie) => isGoalie
      ? Promise.resolve(timeline)
      : Promise.reject(new Error('wrong-role timeline must not start')));
    d.getStats.mockRejectedValue(new Error('ordinary selected stats must not start'));
    d.getMatchups.mockImplementation((_playerId, _seasonId, isGoalie) => isGoalie
      ? Promise.resolve([])
      : Promise.reject(new Error('wrong-role matchup must not start')));

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);

    expect(response.status).toBe(200);
    expect(d.getTimeline.mock.calls.map((call) => call[2])).toEqual([true]);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getMatchups.mock.calls.map((call) => call[2])).toEqual([true]);
  });

  it('[v9 injected health contract] reports stage=health and blocks every later dependency', async () => {
    const d = deps();
    d.assertHealthy = jest.fn().mockRejectedValue({ code: '57014' });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: 'UPSTREAM_FAILURE', message: 'Player profile data is temporarily unavailable.' } });
    expect(log).toHaveBeenCalledWith('mobile_player_profile_dependency_failure', {
      stage: 'health', providerCode: '57014',
    });
    expect(d.assertHealthy).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, SEASON_ID);
    expect(d.getPublicSeasonPlayer).not.toHaveBeenCalled();
    expect(d.getTimeline).not.toHaveBeenCalled();
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getGames).not.toHaveBeenCalled();
    expect(d.getBadges).not.toHaveBeenCalled();
    expect(d.getImportedAchievements).not.toHaveBeenCalled();
    expect(d.getArticles).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
    expect(d.generateHotFacts).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('[v7 canonical-role failure] preserves the timeline stage and generic 502 contract', async () => {
    const d = deps();
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 1, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: unknown,
      savePercentage: unknown,
      goalsAgainstAverage: unknown,
      shutouts: unknown,
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);
    d.getTimeline.mockImplementation((_leagueId, _playerId, isGoalie) => isGoalie
      ? Promise.reject({ code: '57014' })
      : Promise.reject(new Error('wrong-role timeline must not start')));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: 'UPSTREAM_FAILURE', message: 'Player profile data is temporarily unavailable.' } });
    expect(log).toHaveBeenCalledWith('mobile_player_profile_dependency_failure', {
      stage: 'timeline', providerCode: '57014',
    });
    expect(d.getTimeline.mock.calls.map((call) => call[2])).toEqual([true]);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('preserves current-season and career DTO fields while sharing the baseline-inclusive timeline', async () => {
    const currentDeps = deps();
    const currentCanonical = canonicalPlayer(4);
    currentCanonical.metrics.goals = { value: 3, state: 'recorded', sources: ['skater_stats'] };
    currentCanonical.metrics.assists = { value: 2, state: 'recorded', sources: ['skater_stats'] };
    currentCanonical.metrics.points = { value: 5, state: 'recorded', sources: ['skater_stats'] };
    currentCanonical.metrics.penaltyMinutes = { value: 6, state: 'recorded', sources: ['skater_stats'] };
    currentDeps.getPublicSeasonPlayer.mockResolvedValue(currentCanonical);
    const current = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), currentDeps)).json();
    expect(current.data).toMatchObject({
      selectedSeasonId: SEASON_ID,
      selectedSeasonName: 'Fall 2026',
      isCareer: false,
      aggregateOnly: false,
      metrics: { games_played: 4, goals: 3, assists: 2, points: 5, penalty_minutes: 6, plus_minus: null },
      careerRows: [{ seasonId: SEASON_ID, seasonName: 'Fall 2026' }],
    });

    const careerDeps = deps();
    const [careerRow] = await careerDeps.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    careerDeps.getTimeline.mockClear();
    careerDeps.getTimeline.mockResolvedValue([{
      ...careerRow,
      games_played: 37,
      goals: 156,
      assists: 75,
      points: 231,
    }]);
    const career = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), careerDeps)).json();
    expect(career.data).toMatchObject({
      selectedSeasonId: null,
      selectedSeasonName: 'Career Stats',
      isCareer: true,
      aggregateOnly: true,
      metrics: { games_played: 37, goals: 156, assists: 75, points: 231 },
      careerRows: [{ seasonId: SEASON_ID, seasonName: 'Fall 2026' }],
    });
    expect(currentDeps.getStats).not.toHaveBeenCalled();
    expect(careerDeps.getStats).not.toHaveBeenCalled();
    expect(currentDeps.getTimeline).toHaveBeenCalledTimes(1);
    expect(careerDeps.getTimeline).toHaveBeenCalledTimes(1);
  });

  it('[v7 canonical selected metrics] uses every publishable skater metric and never calls getStats', async () => {
    const d = deps();
    const canonical = canonicalPlayer(4);
    canonical.metrics.goals = { value: 3, state: 'recorded', sources: ['skater_stats'] };
    canonical.metrics.assists = { value: 2, state: 'verified', sources: ['skater_stats', 'capture_confirmation'] };
    canonical.metrics.points = { value: 99, state: 'conflicted', sources: ['skater_stats', 'override'] };
    canonical.metrics.penaltyMinutes = { value: 6, state: 'estimated', sources: ['skater_stats'] };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);
    d.getStats.mockResolvedValue({
      games_played: 99, goals: 88, assists: 77, points: 165, penalty_minutes: 66, plus_minus: 55,
    });

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`), d);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(body.data.metrics).toEqual({
      games_played: 4,
      goals: 3,
      assists: 2,
      points: null,
      penalty_minutes: null,
      plus_minus: null,
      wins: null,
      losses: null,
      ties: null,
      saves: null,
      goals_against: null,
      goals_against_average: null,
      shutouts: null,
      save_percentage: null,
    });
    expect(body.data.metricProvenance).toEqual({
      games_played: { state: 'reported', sources: ['roster_window'] },
      goals: { state: 'recorded', sources: ['skater_stats'] },
      assists: { state: 'verified', sources: ['skater_stats', 'capture_confirmation'] },
      points: { state: 'conflicted', sources: ['skater_stats', 'override'] },
      penalty_minutes: { state: 'estimated', sources: ['skater_stats'] },
    });
  });

  it('[v7 career reuse] derives selected career totals from the explicit baseline-inclusive timeline without getStats', async () => {
    const d = deps();
    const current = (await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true))[0];
    d.getTimeline.mockClear();
    const baseline: PlayerCareerSeasonRow = {
      ...current,
      season_id: HISTORICAL_BASELINE_ID,
      season_name: 'Historical Career Baseline (Pre-BLH)',
      team_id: null,
      team_name: null,
      games_played: 2,
      goals: 3,
      assists: 4,
      points: 7,
    };
    d.getTimeline.mockResolvedValue([
      baseline,
      { ...current, games_played: 1, goals: 1, assists: 2, points: 3 },
    ]);
    d.getStats.mockResolvedValue({ games_played: 99, goals: 88, assists: 77, points: 165, plus_minus: 44 });

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(d.getTimeline).toHaveBeenCalledTimes(1);
    expect(d.getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(body.data.metrics).toMatchObject({
      games_played: 3,
      goals: 4,
      assists: 6,
      points: 10,
      penalty_minutes: 0,
      plus_minus: 0,
    });
  });

  it('[v7 aggregate-only phase] starts preserved getStats only after the explicit timeline settles', async () => {
    const d = deps();
    d.getSeasons.mockResolvedValue([{
      id: SEASON_ID,
      name: 'Historical Career Baseline - Imported',
      start_date: '2026-01-01',
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    }]);
    const timeline = await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    d.getTimeline.mockClear();
    const starts: string[] = [];
    let resolveTimeline!: (value: PlayerCareerSeasonRow[]) => void;
    d.getTimeline.mockImplementation(() => {
      starts.push('timeline');
      return new Promise((resolve) => { resolveTimeline = resolve; });
    });
    d.getStats.mockImplementation(async () => {
      starts.push('stats');
      return { games_played: 9, goals: 5, assists: 4, points: 9 };
    });

    const pendingResponse = handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`),
      d,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const statsCallsWhileTimelinePending = d.getStats.mock.calls.length;
    resolveTimeline(timeline);
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(statsCallsWhileTimelinePending).toBe(0);
    expect(starts).toEqual(['timeline', 'stats']);
    expect(d.getStats).toHaveBeenCalledTimes(1);
    expect(d.getStats).toHaveBeenCalledWith(PROFILE_ID, SEASON_ID, HOCKEY_LIFE_ID, false);
    expect(d.getPublicSeasonPlayer).not.toHaveBeenCalled();
  });

  it('[v13 decorative scheduler] isolates game log and consumes later dependencies in deterministic pairs', async () => {
    const d = deps();
    const starts: string[] = [];
    const resolvers = new Map<string, () => void>();
    let activeProviderReads = 0;
    let maxProviderReads = 0;
    const providerRead = <T,>(name: string, value: T) => {
      starts.push(name);
      activeProviderReads += 1;
      maxProviderReads = Math.max(maxProviderReads, activeProviderReads);
      return new Promise<T>((resolve) => {
        resolvers.set(name, () => {
          activeProviderReads -= 1;
          resolve(value);
        });
      });
    };
    d.getGames.mockImplementation(() => providerRead('games', []));
    d.getBadges.mockImplementation(() => providerRead('badges', []));
    d.getImportedAchievements.mockImplementation(() => providerRead('achievements', { championships: 0 }));
    d.getArticles.mockImplementation(() => providerRead('articles', []));
    d.getMatchups.mockImplementation(() => providerRead('matchups', []));
    d.generateHotFacts.mockImplementation(() => providerRead('hotFacts', []));

    const pendingResponse = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`), d);
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['games']);
    resolvers.get('games')!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['games', 'badges', 'achievements']);
    resolvers.get('achievements')!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['games', 'badges', 'achievements', 'articles']);
    resolvers.get('badges')!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['games', 'badges', 'achievements', 'articles', 'matchups']);
    resolvers.get('articles')!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(starts).toEqual(['games', 'badges', 'achievements', 'articles', 'matchups', 'hotFacts']);
    resolvers.get('matchups')!();
    resolvers.get('hotFacts')!();
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(starts).toEqual(['games', 'badges', 'achievements', 'articles', 'matchups', 'hotFacts']);
    expect(maxProviderReads).toBe(2);
    expect(activeProviderReads).toBe(0);
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('[v13 decorative scheduler] drains bounded work and reports the earliest scheduled failure regardless of settlement order', async () => {
    const d = deps();
    const starts: string[] = [];
    const settled: string[] = [];
    const completions = new Map<string, {
      resolve: () => void;
      reject: (failure: unknown) => void;
    }>();
    let active = 0;
    let maxActive = 0;
    const decorativeRead = <T,>(name: string, value: T) => {
      starts.push(name);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<T>((resolve, reject) => {
        const settle = (complete: () => void) => {
          active -= 1;
          settled.push(name);
          complete();
        };
        completions.set(name, {
          resolve: () => settle(() => resolve(value)),
          reject: (failure) => settle(() => reject(failure)),
        });
      });
    };
    d.getBadges.mockImplementation(() => decorativeRead('badges', []));
    d.getImportedAchievements.mockImplementation(() => decorativeRead('achievements', { championships: 0 }));
    d.getArticles.mockImplementation(() => decorativeRead('articles', []));
    d.getMatchups.mockImplementation(() => decorativeRead('matchups', []));
    d.generateHotFacts.mockImplementation(() => decorativeRead('hotFacts', []));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', captureUnhandled);

    let activeAtReturn = -1;
    let settledAtReturn: string[] = [];
    let responseReturned = false;
    try {
      const pendingResponse = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`), d)
        .then((response) => {
          activeAtReturn = active;
          settledAtReturn = [...settled];
          responseReturned = true;
          return response;
        });
      await new Promise((resolve) => setImmediate(resolve));
      expect(starts).toEqual(['badges', 'achievements']);
      expect(active).toBe(2);

      completions.get('achievements')!.reject({ code: '57014' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(starts).toEqual(['badges', 'achievements', 'articles']);
      expect(settled).toEqual(['achievements']);
      expect(active).toBe(2);

      completions.get('articles')!.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      expect(starts).toEqual(['badges', 'achievements', 'articles', 'matchups']);
      expect(settled).toEqual(['achievements', 'articles']);
      expect(active).toBe(2);

      completions.get('matchups')!.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      expect(starts).toEqual(['badges', 'achievements', 'articles', 'matchups', 'hotFacts']);
      expect(settled).toEqual(['achievements', 'articles', 'matchups']);
      expect(active).toBe(2);

      completions.get('hotFacts')!.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toEqual(['achievements', 'articles', 'matchups', 'hotFacts']);
      expect(active).toBe(1);
      expect(responseReturned).toBe(false);

      completions.get('badges')!.reject({ code: 'PGRST500' });
      const response = await pendingResponse;
      await new Promise((resolve) => setImmediate(resolve));
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual({ error: { code: 'UPSTREAM_FAILURE', message: 'Player profile data is temporarily unavailable.' } });
      expect(starts).toEqual(['badges', 'achievements', 'articles', 'matchups', 'hotFacts']);
      expect(settled).toEqual(['achievements', 'articles', 'matchups', 'hotFacts', 'badges']);
      expect(maxActive).toBe(2);
      expect(settledAtReturn).toEqual(['achievements', 'articles', 'matchups', 'hotFacts', 'badges']);
      expect(activeAtReturn).toBe(0);
      expect(active).toBe(0);
      expect(unhandled).toHaveLength(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('mobile_player_profile_dependency_failure', {
        stage: 'badges', providerCode: 'UNKNOWN',
      });
    } finally {
      process.off('unhandledRejection', captureUnhandled);
      log.mockRestore();
    }
  });

  it('[v13 decorative scheduler] consumes the active pair after abort and starts no later provider dependency', async () => {
    const d = deps();
    let resolveBadges!: () => void;
    let resolveAchievements!: () => void;
    let active = 0;
    d.getBadges.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      resolveBadges = () => { active -= 1; resolve([]); };
    }));
    d.getImportedAchievements.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      resolveAchievements = () => { active -= 1; resolve({ championships: 0 }); };
    }));
    const controller = new AbortController();
    const request = new NextRequest(
      `https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?playerId=${PROFILE_ID}&season=${SEASON_ID}`,
      { signal: controller.signal },
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pendingResponse = handleMobilePlayerProfileRequest(request, d);
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.getBadges).toHaveBeenCalledTimes(1);
    expect(d.getImportedAchievements).toHaveBeenCalledTimes(1);
    expect(active).toBe(2);
    controller.abort();
    resolveAchievements();
    resolveBadges();
    const response = await pendingResponse;
    log.mockRestore();

    expect(response.status).toBe(502);
    expect(active).toBe(0);
    expect(d.getArticles).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
    expect(d.generateHotFacts).not.toHaveBeenCalled();
  });

  it('[v7 abort boundary] starts no later dependency after an abort observed when the active phase settles', async () => {
    const d = deps();
    const timeline = await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    d.getTimeline.mockClear();
    let resolveTimeline!: (value: PlayerCareerSeasonRow[]) => void;
    let activeTimelineSettledAfterAbort = false;
    d.getTimeline.mockImplementation(() => new Promise((resolve) => {
      resolveTimeline = (value) => {
        activeTimelineSettledAfterAbort = true;
        resolve(value);
      };
    }));
    const controller = new AbortController();
    const request = new NextRequest(
      `https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?playerId=${PROFILE_ID}&season=${SEASON_ID}`,
      { signal: controller.signal },
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pendingResponse = handleMobilePlayerProfileRequest(request, d);
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.getTimeline).toHaveBeenCalledTimes(1);
    controller.abort();
    resolveTimeline(timeline);
    const response = await pendingResponse;
    log.mockRestore();

    expect(response.status).toBe(502);
    expect(activeTimelineSettledAfterAbort).toBe(true);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getGames).not.toHaveBeenCalled();
    expect(d.getBadges).not.toHaveBeenCalled();
    expect(d.getImportedAchievements).not.toHaveBeenCalled();
    expect(d.getArticles).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
    expect(d.generateHotFacts).not.toHaveBeenCalled();
  });

  it('uses the canonical public-stat GP value and provenance for a selected season', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & {
      getPublicSeasonPlayer: jest.Mock<Promise<PublicSeasonMetricPlayer | null>>;
    };
    d.getStats.mockResolvedValue({ games_played: 99, goals: 3, assists: 2, points: 5, penalty_minutes: 0 });
    const awayTeamId = '70000000-0000-4000-8000-000000000008';
    const completedGameId = '80000000-0000-4000-8000-000000000008';
    const canonicalRows: PublicStatMetricRows = {
      games: [{
        id: completedGameId,
        league_id: HOCKEY_LIFE_ID,
        season_id: SEASON_ID,
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: awayTeamId,
        home_score: 4,
        away_score: 2,
        scheduled_at: '2026-09-20T20:00:00Z',
        penalty_capture_status: null,
        goalie_capture_status: null,
        skater_capture_status: null,
      }],
      teams: [
        { id: TEAM_ID, league_id: HOCKEY_LIFE_ID, division_id: null, name: 'Bad Bunny' },
        { id: awayTeamId, league_id: HOCKEY_LIFE_ID, division_id: null, name: 'Visitors' },
      ],
      profiles: [{ id: PROFILE_ID, full_name: 'Matt Grossi', avatar_url: null, photo_url: null }],
      rosters: [{
        id: ROSTER_ID,
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        league_id: HOCKEY_LIFE_ID,
        season_id: SEASON_ID,
        start_date: '2026-09-01',
        end_date: null,
        is_goalie: false,
        position: 'C',
        status: 'active',
        player_type: 'regular',
      }],
      checkins: [],
      availabilities: [],
      acceptedSubs: [],
      playerStats: [],
      goalieStats: [],
      goalieAppearances: [],
    };
    const canonical = aggregatePublicSeasonStats(canonicalRows, {
      leagueId: HOCKEY_LIFE_ID,
      seasonId: SEASON_ID,
      playerId: PROFILE_ID,
    }).players[0];
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toMatchObject({ games_played: canonical.metrics.gamesPlayed.value, goals: canonical.metrics.goals.value });
    expect(body.data.metricProvenance.games_played).toEqual({
      state: canonical.metrics.gamesPlayed.state,
      sources: canonical.metrics.gamesPlayed.sources,
    });
    expect(d.getPublicSeasonPlayer).toHaveBeenCalledWith(HOCKEY_LIFE_ID, SEASON_ID, PROFILE_ID);
  });

  it('preserves selected-season skater unknown GP provenance when metric payloads are absent', async () => {
    const d = deps();
    d.getStats.mockResolvedValue(null);
    d.getPublicSeasonPlayer.mockResolvedValue(null);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toBeNull();
    expect(body.data.metricProvenance).toEqual({
      games_played: { state: 'unknown', sources: [] },
    });
  });

  it('[correction-2 role coherence] uses a truthful skater position when a current goalie selects a canonical skater season', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({
      ...(await d.resolvePlayer(PROFILE_ID))!,
      position: 'Goalie',
      is_goalie: true,
    });
    const canonical = canonicalPlayer(4);
    canonical.metrics.goals = { value: 3, state: 'recorded', sources: ['skater_stats'] };
    canonical.metrics.assists = { value: 1, state: 'recorded', sources: ['skater_stats'] };
    canonical.metrics.points = { value: 4, state: 'recorded', sources: ['skater_stats'] };
    canonical.metrics.penaltyMinutes = { value: 0, state: 'recorded', sources: ['skater_stats'] };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`),
      d,
    )).json();

    expect(body.data).toMatchObject({ isGoalie: false, position: 'Skater' });
    expect(body.data.metrics).toMatchObject({ games_played: 4, goals: 3, assists: 1, points: 4 });
    expect(body.data.metricProvenance).toEqual({
      games_played: { state: 'reported', sources: ['roster_window'] },
      goals: { state: 'recorded', sources: ['skater_stats'] },
      assists: { state: 'recorded', sources: ['skater_stats'] },
      points: { state: 'recorded', sources: ['skater_stats'] },
      penalty_minutes: { state: 'recorded', sources: ['skater_stats'] },
    });
    expect(body.data.metricProvenance).not.toHaveProperty('wins');
    expect(d.getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getMatchups).toHaveBeenCalledWith(PROFILE_ID, SEASON_ID, false);
    expect(d.generateHotFacts).toHaveBeenCalledWith(expect.objectContaining({ isGoalie: false }));
  });

  it('[correction-2 role coherence] uses a truthful goalie position when a current skater selects a canonical goalie season', async () => {
    const d = deps();
    d.getStats.mockResolvedValue({
      games_played: 99,
      wins: 9,
      losses: 8,
      ties: 7,
      saves: 43,
      goals_against: 17,
      save_percentage: 0.71667,
      goals_against_average: 5.667,
      shutouts: 6,
    });
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 1, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: { value: 2, state: 'recorded', sources: ['goalie_assignment'] },
      savePercentage: unknown,
      goalsAgainstAverage: { value: 2, state: 'recorded', sources: ['goalie_assignment'] },
      shutouts: unknown,
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`),
      d,
    )).json();

    expect(body.data).toMatchObject({ isGoalie: true, position: 'G' });
    expect(body.data.metrics).toMatchObject({
      games_played: 1,
      wins: null,
      losses: null,
      ties: null,
      saves: null,
      goals_against: 2,
      save_percentage: null,
      goals_against_average: 2,
      shutouts: null,
    });
    expect(body.data.metricProvenance).toEqual({
      goals: { state: 'unknown', sources: [] },
      assists: { state: 'unknown', sources: [] },
      points: { state: 'unknown', sources: [] },
      penalty_minutes: { state: 'unknown', sources: [] },
      games_played: { state: 'reported', sources: ['goalie_assignment'] },
      wins: { state: 'unknown', sources: [] },
      losses: { state: 'unknown', sources: [] },
      ties: { state: 'unknown', sources: [] },
      saves: { state: 'unknown', sources: [] },
      goals_against: { state: 'recorded', sources: ['goalie_assignment'] },
      save_percentage: { state: 'unknown', sources: [] },
      goals_against_average: { state: 'recorded', sources: ['goalie_assignment'] },
      shutouts: { state: 'unknown', sources: [] },
    });
    expect(d.getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, true, true);
    expect(d.getStats).not.toHaveBeenCalled();
    expect(d.getMatchups).toHaveBeenCalledWith(PROFILE_ID, SEASON_ID, true);
    expect(d.generateHotFacts).toHaveBeenCalledWith(expect.objectContaining({ isGoalie: true }));
  });

  it.each([
    { goalieGroup: false, expectedIsGoalie: false, expectedPosition: 'C', expectedGamesPlayed: 3 },
    { goalieGroup: true, expectedIsGoalie: true, expectedPosition: 'G', expectedGamesPlayed: 2 },
  ])('[correction-2 dual role] resolves roles=[skater,goalie] from goalie group=$goalieGroup', async ({
    goalieGroup,
    expectedIsGoalie,
    expectedPosition,
    expectedGamesPlayed,
  }) => {
    const d = deps();
    const canonical = canonicalPlayer(3);
    const unknown = canonical.metrics.goals;
    canonical.roles = ['skater', 'goalie'];
    canonical.goalie = goalieGroup ? {
      gamesPlayed: { value: 2, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: unknown,
      savePercentage: unknown,
      goalsAgainstAverage: unknown,
      shutouts: unknown,
    } : null;
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`),
      d,
    )).json();

    expect(body.data).toMatchObject({
      isGoalie: expectedIsGoalie,
      position: expectedPosition,
      metrics: { games_played: expectedGamesPlayed },
    });
  });

  it('replaces selected-season legacy goalie metrics and provenance with the canonical public goalie group', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({
      ...(await d.resolvePlayer(PROFILE_ID))!,
      position: 'Goalie',
      is_goalie: true,
    });
    d.getStats.mockResolvedValue({
      games_played: 99,
      wins: 9,
      losses: 8,
      ties: 7,
      saves: 43,
      goals_against: 17,
      save_percentage: 0.71667,
      goals_against_average: 5.667,
      shutouts: 6,
    });
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.metrics.gamesPlayed = {
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'goalie_stats'],
    };
    canonical.goalie = {
      gamesPlayed: { value: 3, state: 'reported', sources: ['roster_window', 'goalie_stats'] },
      wins: { value: 2, state: 'recorded', sources: ['goalie_stats'] },
      losses: { value: 1, state: 'verified', sources: ['goalie_stats', 'goalie_assignment', 'capture_confirmation'] },
      saves: unknown,
      goalsAgainst: { value: 13, state: 'reported', sources: ['goalie_assignment'] },
      savePercentage: unknown,
      goalsAgainstAverage: { value: 4.333, state: 'reported', sources: ['goalie_assignment', 'roster_window'] },
      shutouts: { value: 0, state: 'recorded', sources: ['goalie_stats'] },
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toMatchObject({
      games_played: 3,
      wins: 2,
      losses: 1,
      ties: null,
      saves: null,
      goals_against: 13,
      save_percentage: null,
      goals_against_average: 4.333,
      shutouts: 0,
    });
    expect(body.data.metricProvenance).toEqual({
      goals: { state: 'unknown', sources: [] },
      assists: { state: 'unknown', sources: [] },
      points: { state: 'unknown', sources: [] },
      penalty_minutes: { state: 'unknown', sources: [] },
      games_played: { state: 'reported', sources: ['roster_window', 'goalie_stats'] },
      wins: { state: 'recorded', sources: ['goalie_stats'] },
      losses: { state: 'verified', sources: ['goalie_stats', 'goalie_assignment', 'capture_confirmation'] },
      ties: { state: 'unknown', sources: [] },
      saves: { state: 'unknown', sources: [] },
      goals_against: { state: 'reported', sources: ['goalie_assignment'] },
      save_percentage: { state: 'unknown', sources: [] },
      goals_against_average: { state: 'reported', sources: ['goalie_assignment', 'roster_window'] },
      shutouts: { state: 'recorded', sources: ['goalie_stats'] },
    });
    expect(body.data.metrics.saves).toBeNull();
    expect(body.data.metrics.save_percentage).toBeNull();
  });

  it.each([
    ['Aaron Buehler', 3, 13, 4.333333333333333],
    ['Christian Jarchow', 1, 2, 2],
    ['Cody Bolman', 3, 17, 5.666666666666667],
  ])('preserves captured live canonical goalie parity for %s', async (name, gamesPlayed, goalsAgainst, goalsAgainstAverage) => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({
      ...(await d.resolvePlayer(PROFILE_ID))!,
      position: 'Goalie',
      is_goalie: true,
      profile: { full_name: name, avatar_url: null, photo_url: null },
    });
    d.getStats.mockResolvedValue({
      games_played: 99,
      wins: 9,
      losses: 8,
      ties: 7,
      saves: 43,
      goals_against: 99,
      save_percentage: 0.71667,
      goals_against_average: 99,
      shutouts: 6,
    });
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.playerName = name;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: gamesPlayed, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: { value: goalsAgainst, state: 'reported', sources: ['goalie_assignment'] },
      savePercentage: unknown,
      goalsAgainstAverage: { value: goalsAgainstAverage, state: 'reported', sources: ['goalie_assignment'] },
      shutouts: unknown,
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data).toMatchObject({
      fullName: name,
      isGoalie: true,
      metrics: {
        games_played: gamesPlayed,
        wins: null,
        losses: null,
        ties: null,
        saves: null,
        goals_against: goalsAgainst,
        save_percentage: null,
        goals_against_average: goalsAgainstAverage,
        shutouts: null,
      },
    });
    expect(body.data.metricProvenance).toMatchObject({
      games_played: { state: 'reported', sources: ['goalie_assignment'] },
      goals_against: { state: 'reported', sources: ['goalie_assignment'] },
      goals_against_average: { state: 'reported', sources: ['goalie_assignment'] },
      saves: { state: 'unknown', sources: [] },
      save_percentage: { state: 'unknown', sources: [] },
    });
  });

  it('does not fall back to legacy GP when canonical selected-season evidence is absent', async () => {
    const d = deps();
    d.getStats.mockResolvedValue({ games_played: 99, goals: 3, assists: 2, points: 5, penalty_minutes: 0 });
    d.getPublicSeasonPlayer.mockResolvedValue(null);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toBeNull();
    expect(body.data.metricProvenance).toEqual({
      games_played: { state: 'unknown', sources: [] },
    });
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('[correction-3 position normalization] emits G for a missing-canonical selected-season goalie', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({
      ...(await d.resolvePlayer(PROFILE_ID))!,
      position: 'Goalie',
      is_goalie: true,
    });
    d.getPublicSeasonPlayer.mockResolvedValue(null);

    const body = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`),
      d,
    )).json();

    expect(body.data).toMatchObject({ isGoalie: true, position: 'G' });
  });

  it('fails closed at the profile metric budget before hydrating later source tables', async () => {
    const gameRows = Array.from({ length: 5_001 }, (_, index) => ({
      id: `80000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      league_id: HOCKEY_LIFE_ID,
      season_id: SEASON_ID,
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: '71000000-0000-4000-8000-000000000007',
      home_score: 2,
      away_score: 1,
      scheduled_at: '2026-09-01T20:00:00Z',
      penalty_capture_status: null,
      goalie_capture_status: null,
      skater_capture_status: null,
    }));
    const queriedTables: string[] = [];
    const ranges: Array<[string, number, number]> = [];
    const client = {
      from(table: string) {
        queriedTables.push(table);
        const query = {
          eq() { return this; },
          in() { return this; },
          order() { return this; },
          async range(from: number, to: number) {
            ranges.push([table, from, to]);
            const data = table === 'games' ? gameRows.slice(from, to + 1) : [];
            return { data, count: table === 'games' ? gameRows.length : 0, error: null };
          },
        };
        return { select: () => query };
      },
    };
    mockedCreateServiceRoleClient.mockReturnValueOnce(client as never);

    await expect(mobilePlayerProfileDependencies.getPublicSeasonPlayer(
      HOCKEY_LIFE_ID,
      SEASON_ID,
      PROFILE_ID,
    )).rejects.toThrow('metric source total row limit exceeded');
    expect(queriedTables).toEqual(['games']);
    expect(ranges).toEqual([['games', 0, 999]]);
  });

  it('fails closed for unproven goalie saves and save percentage in selected-season timeline and game rows', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'Goalie', is_goalie: true });
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 2, state: 'reported', sources: ['goalie_assignment'] },
      wins: unknown,
      losses: unknown,
      saves: unknown,
      goalsAgainst: unknown,
      savePercentage: unknown,
      goalsAgainstAverage: unknown,
      shutouts: unknown,
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);
    const row = (await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0];
    d.getTimeline.mockClear();
    d.getTimeline.mockResolvedValue([{ ...row, games_played: 2, saves: 40, goals_against: 5, save_percentage: 88.889 }]);
    d.getGames.mockResolvedValue([{
      game_id: '80000000-0000-4000-8000-000000000008',
      date: '2026-09-20T20:00:00Z',
      opponent: 'Visitors',
      result: 'W',
      goals: 0,
      assists: 0,
      points: 0,
      plus_minus: 0,
      saves: 20,
      goals_against: 2,
      save_percentage: 0.909,
    }]);
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();
    expect(body.data.careerRows[0].metrics).toMatchObject({ games_played: 2, saves: null, goals_against: 5, save_percentage: null });
    expect(body.data.games[0].metrics).toMatchObject({ saves: null, goals_against: 2, save_percentage: null });
  });

  it('preserves authoritative imported aggregate timeline saves and save percentage in selected and career modes', async () => {
    const importedRow = {
      ...(await deps().getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0],
      season_id: WINTER_2026_ID,
      season_name: 'Winter 2026',
      games_played: 9,
      saves: 80,
      goals_against: 10,
      save_percentage: 88.9,
      goals_against_average: 1.111,
    };
    const importedDeps = (statsSavePercentage = 88.9) => {
      const d = deps();
      d.resolvePlayer.mockResolvedValue({
        id: ROSTER_ID,
        player_id: PROFILE_ID,
        jersey_number: 36,
        position: 'Goalie',
        leadership_role: null,
        is_goalie: true,
        profile: { full_name: 'Imported Goalie', avatar_url: null, photo_url: null },
        team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny', logo_url: null, primary_color: '#ff0000', league_id: HOCKEY_LIFE_ID },
      });
      d.getSeasons.mockResolvedValue([{
        id: WINTER_2026_ID,
        name: 'Winter 2026',
        start_date: '2026-01-01',
        status: 'completed',
        league_id: HOCKEY_LIFE_ID,
      }]);
      d.getTimeline.mockResolvedValue([importedRow]);
      d.getStats.mockResolvedValue({
        games_played: 9,
        wins: 6,
        losses: 3,
        ties: 0,
        saves: 80,
        goals_against: 10,
        save_percentage: statsSavePercentage,
        goals_against_average: 1.111,
        shutouts: 1,
      });
      return d;
    };

    const selectedDeps = importedDeps();
    const selected = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=${WINTER_2026_ID}`),
      selectedDeps,
    )).json();
    const careerDeps = importedDeps(0.889);
    const career = await (await handleMobilePlayerProfileRequest(
      req(`playerId=${PROFILE_ID}&season=all`),
      careerDeps,
    )).json();

    expect(selected.data).toMatchObject({
      aggregateOnly: true,
      isGoalie: true,
      position: 'G',
      metrics: { saves: 80, save_percentage: 88.9 },
    });
    expect(selected.data.careerRows[0].metrics).toMatchObject({ saves: 80, save_percentage: 88.9 });
    expect(career.data).toMatchObject({
      isGoalie: true,
      position: 'G',
      metrics: { saves: 80, save_percentage: 88.9 },
    });
    expect(career.data.careerRows[0].metrics).toMatchObject({ saves: 80, save_percentage: 88.9 });
    expect(selectedDeps.getPublicSeasonPlayer).not.toHaveBeenCalled();
    expect(selectedDeps.getGames).not.toHaveBeenCalled();
  });

  it('fails closed for estimated and conflicted canonical goalie values even when they carry numbers', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getStats.mockResolvedValue({ games_played: 1, wins: 1, losses: 0, goals_against: 9, goals_against_average: 9 });
    const canonical = canonicalPlayer();
    const unknown = canonical.metrics.goals;
    canonical.roles = ['goalie'];
    canonical.goalie = {
      gamesPlayed: { value: 1, state: 'reported', sources: ['goalie_assignment'] },
      wins: { value: 4, state: 'estimated', sources: ['goalie_stats'] },
      losses: { value: 3, state: 'conflicted', sources: ['goalie_stats', 'goalie_assignment'] },
      saves: unknown,
      goalsAgainst: { value: 2, state: 'recorded', sources: ['goalie_assignment'] },
      savePercentage: unknown,
      goalsAgainstAverage: { value: 2, state: 'recorded', sources: ['goalie_assignment'] },
      shutouts: { value: 0, state: 'verified', sources: ['goalie_stats', 'capture_confirmation'] },
    };
    d.getPublicSeasonPlayer.mockResolvedValue(canonical);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toMatchObject({ wins: null, losses: null, goals_against: 2, goals_against_average: 2, shutouts: 0 });
    expect(body.data.metricProvenance).toMatchObject({
      wins: { state: 'estimated', sources: ['goalie_stats'] },
      losses: { state: 'conflicted', sources: ['goalie_stats', 'goalie_assignment'] },
    });
  });

  it('normalizes the actual canonical career goalie summarizer ratio to the DTO percentage unit', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    const row = (await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0] as PlayerCareerSeasonRow;
    d.getTimeline.mockClear();
    d.getTimeline.mockResolvedValue([{ ...row, games_played: 1, saves: 18, goals_against: 2, save_percentage: 90 }]);
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics.save_percentage).toBe(90);
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('projects the captured Matt career facts from the explicit timeline without recomputing them', async () => {
    const d = deps();
    const [row] = await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
    d.getTimeline.mockClear();
    d.getTimeline.mockResolvedValue([{
      ...row,
      games_played: 37,
      goals: 156,
      assists: 75,
      points: 231,
    }]);
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics).toMatchObject({ games_played: 37, goals: 156, assists: 75, points: 231 });
    expect(d.getStats).not.toHaveBeenCalled();
  });

  it('keeps captured Steven imported-goalie percentage provenance and aggregate-only behavior', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, player_id: '751c2f47-f0e8-4506-b10e-b39a7bbcd302', position: 'Goalie', is_goalie: true });
    d.getSeasons.mockResolvedValue([{ id: WINTER_2026_ID, name: 'Winter 2026', start_date: '2026-01-01', status: 'completed', league_id: HOCKEY_LIFE_ID }]);
    d.getStats.mockResolvedValue({ games_played: 10, wins: 5, losses: 4, ties: 1, goals_against: 33, goals_against_average: 3.3, shutouts: 0 });
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=751c2f47-f0e8-4506-b10e-b39a7bbcd302&season=${WINTER_2026_ID}`), d)).json();
    expect(body.data.metrics).toMatchObject({ games_played: 10, wins: 5, losses: 4, ties: 1, saves: null, save_percentage: null });
    expect(body.data.aggregateOnly).toBe(true);
    expect(d.getGames).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
  });

  it('logs only the dependency stage and allowlisted timeout code while preserving the generic 502 contract', async () => {
    for (const [providerError, expectedCode] of [
      [{ code: '57014', message: `secret ${PROFILE_ID}` }, '57014'],
      [{ code: 'PGRST500', message: `credential ${PROFILE_ID}` }, 'UNKNOWN'],
    ] as const) {
      const d = deps();
      d.getPublicSeasonPlayer.mockRejectedValue(providerError);
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body).toEqual({ error: { code: 'UPSTREAM_FAILURE', message: 'Player profile data is temporarily unavailable.' } });
      expect(log).toHaveBeenCalledWith('mobile_player_profile_dependency_failure', {
        stage: 'stats', providerCode: expectedCode,
      });
      const serializedLog = JSON.stringify(log.mock.calls);
      expect(serializedLog).not.toContain(PROFILE_ID);
      expect(serializedLog).not.toContain('secret');
      expect(serializedLog).not.toContain('credential');
      expect(serializedLog).not.toContain('PGRST500');
      log.mockRestore();
    }
  });

  it('returns 5xx rather than a fabricated zero payload when a dependency fails', async () => {
    const d = deps();
    d.getPublicSeasonPlayer.mockRejectedValue(new Error('schema read failed'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    log.mockRestore();
    expect(response.status).toBe(502);
  });
});

function queryResult(result: { data: unknown[] | null; error: unknown; count: number | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
  query.range = jest.fn((from: number, to: number) => Promise.resolve({
    ...result,
    data: result.data?.slice(from, to + 1) ?? null,
  }));
  query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

function strictFallbackScorelessClient(options: {
  gameRows: Array<Record<string, unknown>>;
  rosterRows?: Array<Record<string, unknown>>;
  outCheckinRows?: Array<Record<string, unknown>>;
  outAvailabilityRows?: Array<Record<string, unknown>>;
  scopedSkaterRows?: Array<Record<string, unknown>>;
  scopedGoalieRows?: Array<Record<string, unknown>>;
  gameLevelSkaterRows?: Array<Record<string, unknown>>;
  gameLevelGoalieRows?: Array<Record<string, unknown>>;
  returnOutOfScopeOptionalRows?: boolean;
  returnOutOfScopeCoreRows?: boolean;
  returnOutOfScopeGameRows?: boolean;
  returnOutOfScopeCheckinRows?: boolean;
  returnCoreRowsForWrongPackOnly?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
  conflictingDuplicateGameId?: string;
  conflictingDuplicateAwayTeamId?: string;
  coreErrorTable?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
  coreErrorGameId?: string;
  coreCountMismatchTable?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
  coreCountMismatchGameId?: string;
  corePageErrorTable?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
  corePageErrorGameId?: string;
  corePageErrorOffset?: number;
  optionalErrorTable?: 'player_stats' | 'goalie_stats';
  optionalErrorGameId?: string;
  optionalCountMismatchTable?: 'player_stats' | 'goalie_stats';
  optionalCountMismatchGameId?: string;
  optionalPageErrorTable?: 'player_stats' | 'goalie_stats';
  optionalPageErrorGameId?: string;
  optionalPageErrorOffset?: number;
}) {
  type Trace = {
    table: string;
    selection: string;
    filters: Array<[string, string, unknown]>;
    reads: number;
  };
  const traces: Trace[] = [];
  const indexedGames = options.gameRows.map((row) => ({
    row,
    seasonId: row.season_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
  }));
  const client = { from: jest.fn((table: string) => {
    const trace: Trace = { table, selection: '', filters: [], reads: 0 };
    traces.push(trace);
    const query: Record<string, unknown> = {};
    query.select = jest.fn((selection: string) => { trace.selection = selection; return query; });
    for (const method of ['eq', 'in', 'or', 'order']) {
      query[method] = jest.fn((column: string, value: unknown) => {
        trace.filters.push([method, column, value]);
        return query;
      });
    }
    const materialize = (from = 0) => {
      const gameIds = trace.filters.find(([method, column]) => method === 'in' && column === 'game_id')?.[2] as string[] | undefined;
      const optionalSignalRead = Boolean(gameIds && !trace.filters.some(
        ([method, column]) => method === 'in' && column === 'player_id',
      ));
      const coreEvidenceRead = table === 'game_checkins' || table === 'player_availability'
        || (table === 'player_stats' || table === 'goalie_stats') && !optionalSignalRead;
      const targetsOptionalGame = (gameId?: string) => !gameId || Boolean(gameIds?.includes(gameId));
      const targetsCoreGame = (gameId?: string) => !gameId || Boolean(gameIds?.includes(gameId));
      if (optionalSignalRead && options.optionalErrorTable === table
        && targetsOptionalGame(options.optionalErrorGameId)) {
        return { data: null, error: { code: '57014', message: 'optional signal read failed' }, count: null };
      }
      if (optionalSignalRead && options.optionalPageErrorTable === table
        && targetsOptionalGame(options.optionalPageErrorGameId) && options.optionalPageErrorOffset === from) {
        return { data: null, error: { code: 'PGRST500', message: 'optional later page failed' }, count: null };
      }
      if (coreEvidenceRead && options.corePageErrorTable === table
        && targetsCoreGame(options.corePageErrorGameId) && options.corePageErrorOffset === from) {
        return { data: null, error: { code: 'PGRST500', message: 'core later page failed' }, count: null };
      }
      if (coreEvidenceRead && options.coreErrorTable === table
        && targetsCoreGame(options.coreErrorGameId)) {
        return { data: null, error: { code: 'PGRST500', message: 'core evidence read failed' }, count: null };
      }
      let data: Array<Record<string, unknown>> = [];
      if (table === 'team_rosters') {
        data = (options.rosterRows || [{
          player_id: PROFILE_ID,
          team_id: TEAM_ID,
          season_id: SEASON_ID,
          start_date: '2026-01-01',
          joined_at: null,
          end_date: null,
          status: 'active',
          player_type: 'regular',
        }]).map((row) => ({
          start_date: '2026-01-01',
          status: 'active',
          player_type: 'regular',
          ...row,
        }));
      } else if (table === 'games') {
        const seasonEq = trace.filters.find(([method, column]) => method === 'eq' && column === 'season_id')?.[2];
        const seasonIn = trace.filters.find(([method, column]) => method === 'in' && column === 'season_id')?.[2];
        const teamFilter = trace.filters.find(([method]) => method === 'or')?.[1] || '';
        const requestedTeams = new Set(
          typeof teamFilter === 'string'
            ? [...teamFilter.matchAll(/(?:home|away)_team_id\.eq\.([0-9a-z-]+)/gi)].map((match) => match[1])
            : [],
        );
        data = indexedGames.filter((game) => (
          options.returnOutOfScopeGameRows
          || ((typeof seasonEq !== 'string' || game.seasonId === seasonEq)
          && (!Array.isArray(seasonIn) || seasonIn.includes(game.seasonId))
          && (requestedTeams.size === 0
            || requestedTeams.has(game.homeTeamId as string)
            || requestedTeams.has(game.awayTeamId as string)))
        )).map((game) => (
          game.row.id === options.conflictingDuplicateGameId
            && requestedTeams.has(options.conflictingDuplicateAwayTeamId || '')
            ? { ...game.row, scheduled_at: '2026-09-02' }
            : game.row
        ));
      } else if (table === 'game_checkins') {
        data = (options.outCheckinRows || []).filter((row) => (
          options.returnCoreRowsForWrongPackOnly === table
            ? Boolean(gameIds && !gameIds.includes(row.game_id as string))
            : options.returnOutOfScopeCheckinRows || !gameIds || gameIds.includes(row.game_id as string)
        ));
      } else if (table === 'player_availability') {
        data = (options.outAvailabilityRows || []).filter((row) => (
          options.returnCoreRowsForWrongPackOnly === table
            ? Boolean(gameIds && !gameIds.includes(row.game_id as string))
            : options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string)
        ));
      } else if (optionalSignalRead && table === 'player_stats') {
        data = (options.gameLevelSkaterRows || []).filter((row) => (
          options.returnOutOfScopeOptionalRows || gameIds?.includes(row.game_id as string)
        ));
      } else if (optionalSignalRead && table === 'goalie_stats') {
        data = (options.gameLevelGoalieRows || []).filter((row) => (
          options.returnOutOfScopeOptionalRows || gameIds?.includes(row.game_id as string)
        ));
      } else if (table === 'player_stats') {
        data = (options.scopedSkaterRows || [])
          .filter((row) => options.returnCoreRowsForWrongPackOnly === table
            ? Boolean(gameIds && !gameIds.includes(row.game_id as string))
            : options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string))
          .map((row) => ({ player_id: PROFILE_ID, ...row }));
      } else if (table === 'goalie_stats') {
        data = (options.scopedGoalieRows || [])
          .filter((row) => options.returnCoreRowsForWrongPackOnly === table
            ? Boolean(gameIds && !gameIds.includes(row.game_id as string))
            : options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string))
          .map((row) => ({ player_id: PROFILE_ID, ...row }));
      }
      const countMismatch = optionalSignalRead && options.optionalCountMismatchTable === table
        && targetsOptionalGame(options.optionalCountMismatchGameId);
      const coreCountMismatch = coreEvidenceRead && options.coreCountMismatchTable === table
        && targetsCoreGame(options.coreCountMismatchGameId);
      return { data, error: null, count: data.length + (countMismatch || coreCountMismatch ? 1 : 0) };
    };
    const read = (from = 0) => {
      trace.reads += 1;
      return Promise.resolve(materialize(from));
    };
    query.range = jest.fn((from: number, to: number) => read(from).then((result) => ({
      ...result,
      data: result.data?.slice(from, to + 1) ?? null,
    })));
    query.then = (resolve: (value: unknown) => unknown) => read().then(resolve);
    return query;
  }) };
  const optionalProviderReads = () => traces.filter((trace) => trace.filters.some(
    ([method, column]) => method === 'in' && column === 'game_id',
  ) && !trace.filters.some(
    ([method, column]) => method === 'in' && column === 'player_id',
  ));
  return { client, traces, optionalProviderReads };
}

function strictAppearanceClient(options: {
  checkins: Array<{ player_id?: unknown; team_id?: unknown; game_id?: unknown }>;
  checkinPageErrorOffset?: number;
  checkinPageRows?: (from: number, to: number) => Array<{ player_id?: unknown; team_id?: unknown; game_id?: unknown }>;
  gameBatchErrorIndex?: number;
  gameRows?: (ids: string[], batchIndex: number) => unknown[];
  gameResult?: (ids: string[], batchIndex: number) => Promise<{ data: unknown[] | null; error: unknown; count: number | null }>;
}) {
  const checkinQuery: Record<string, jest.Mock> & { then?: unknown } = {} as never;
  for (const method of ['select', 'eq', 'in', 'order']) checkinQuery[method] = jest.fn(() => checkinQuery);
  checkinQuery.range = jest.fn((from: number, to: number) => Promise.resolve(
    from === options.checkinPageErrorOffset
      ? { data: null, error: { code: 'PGRST500', message: 'later page failed' }, count: options.checkins.length }
      : { data: options.checkinPageRows?.(from, to) ?? options.checkins.slice(from, to + 1), error: null, count: options.checkins.length },
  ));

  const gameQueries: Array<Record<string, jest.Mock> & { then?: unknown }> = [];
  const client = { from: jest.fn((table: string) => {
    if (table === 'game_checkins') return checkinQuery;
    const batchIndex = gameQueries.length;
    const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    let ids: string[] = [];
    for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
    query.in = jest.fn((column: string, values: string[]) => {
      if (column === 'id') ids = values;
      return query;
    });
    query.then = (resolve: (value: unknown) => unknown) => (
      options.gameResult?.(ids, batchIndex) ?? Promise.resolve(
        batchIndex === options.gameBatchErrorIndex
          ? { data: null, error: { code: 'PGRST500', message: 'later batch failed' }, count: null }
          : {
              data: options.gameRows?.(ids, batchIndex) ?? ids.map((id) => ({
                id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed',
                home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01',
                home_score: 1, away_score: 0,
              })),
              error: null,
              count: ids.length,
            },
      )
    ).then(resolve);
    gameQueries.push(query);
    return query;
  }) };
  return { client, checkinQuery, gameQueries };
}

function strictTimelineProductionClient(options: {
  includeHistoricalBaseline?: boolean;
  isGoalie?: boolean;
  appearanceGameCount?: number;
  trackAppearanceConcurrency?: boolean;
  scorelessAppearanceGames?: boolean;
} = {}) {
  type Trace = {
    table: string;
    selection: string;
    selectOptions: unknown;
    filters: Array<[string, string, unknown]>;
    ranged: boolean;
  };
  const traces: Trace[] = [];
  const measuredGames = options.appearanceGameCount === undefined
    ? null
    : Array.from({ length: options.appearanceGameCount }, (_, index) => {
        const seasonId = index % 2 === 0 ? SEASON_ID : OTHER_SEASON_ID;
        const id = `v8-timeline-game-${String(index).padStart(4, '0')}`;
        return {
          id,
          league_id: HOCKEY_LIFE_ID,
          season_id: seasonId,
          status: 'completed',
          home_team_id: TEAM_ID,
          away_team_id: null,
          scheduled_at: seasonId === SEASON_ID ? '2026-09-01' : '2026-03-01',
          home_score: options.scorelessAppearanceGames ? null : 2,
          away_score: options.scorelessAppearanceGames ? null : 1,
        };
      });
  const games = new Map((measuredGames || [
    { id: 'season-a-game', league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01', home_score: 1, away_score: 0 },
    { id: 'season-b-game', league_id: HOCKEY_LIFE_ID, season_id: OTHER_SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-03-01', home_score: 2, away_score: 1 },
    { id: 'other-league-game', league_id: OTHER_LEAGUE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-06-01', home_score: 3, away_score: 2 },
    { id: 'historical-game', league_id: HOCKEY_LIFE_ID, season_id: HISTORICAL_BASELINE_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2025-01-01', home_score: 4, away_score: 3 },
  ]).map((game) => [game.id, game] as const));
  const checkins = measuredGames
    ? measuredGames.map((game) => ({ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: game.id }))
    : [
        { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'season-a-game' },
        { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'season-b-game' },
        { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'other-league-game' },
      ];
  const appearance = {
    active: 0,
    maxActive: 0,
    activeCoreEvidence: 0,
    maxCoreEvidenceActive: 0,
    startedCoreEvidence: 0,
    settledCoreEvidence: 0,
    activeOptionalEvidence: 0,
    maxOptionalEvidenceActive: 0,
    startedOptionalEvidence: 0,
    settledOptionalEvidence: 0,
    coreOptionalOverlap: false,
    overlap: false,
    started: { confirmed: 0, fallback: 0 },
    settled: { confirmed: 0, fallback: 0 },
    activeByPhase: { confirmed: 0, fallback: 0 },
    events: [] as string[],
  };
  const seasons = [
    { id: SEASON_ID, name: 'Fall 2026', start_date: '2026-09-01' },
    { id: OTHER_SEASON_ID, name: 'Spring 2026', start_date: '2026-03-01' },
    ...(options.includeHistoricalBaseline
      ? [{ id: HISTORICAL_BASELINE_ID, name: 'Historical Career Baseline - Imported', start_date: '2025-01-01' }]
      : []),
  ];
  const skaterRows = [
    { season_id: SEASON_ID, team_id: TEAM_ID, team_name: 'Bad Bunny', position: 'C', games_played: 0, goals: 1, assists: 0, points: 1 },
    { season_id: OTHER_SEASON_ID, team_id: TEAM_ID, team_name: 'Bad Bunny', position: 'C', games_played: 0, goals: 1, assists: 0, points: 1 },
    ...(options.includeHistoricalBaseline
      ? [{ season_id: HISTORICAL_BASELINE_ID, team_id: TEAM_ID, team_name: 'Legacy', position: 'C', games_played: 1, goals: 105, assists: 45, points: 150 }]
      : []),
  ];
  const goalieRows = [
    { id: 'goalie-a', game_id: 'season-a-game', season_id: SEASON_ID, team_id: TEAM_ID, saves: 18, shots_against: 20, goals_against: 2, game_result: 'W', shutout: false },
    { id: 'goalie-b', game_id: 'season-b-game', season_id: OTHER_SEASON_ID, team_id: TEAM_ID, saves: 27, shots_against: 30, goals_against: 3, game_result: 'L', shutout: false },
    ...(options.includeHistoricalBaseline
      ? [{ id: 'goalie-carrier', game_id: 'goalie-carrier-game', season_id: HISTORICAL_BASELINE_ID, team_id: null, saves: 1000, shots_against: 1250, goals_against: 250, game_result: 'W', shutout: true }]
      : []),
  ];
  const rosterRows = [
    { player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID, start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular' },
    { player_id: PROFILE_ID, team_id: TEAM_ID, season_id: OTHER_SEASON_ID, start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular' },
    ...(options.includeHistoricalBaseline
      ? [{ player_id: PROFILE_ID, team_id: TEAM_ID, season_id: HISTORICAL_BASELINE_ID, start_date: '2025-01-01', end_date: null, status: 'active', player_type: 'regular' }]
      : []),
  ];
  const baseline = options.isGoalie
    ? {
        league_id: HOCKEY_LIFE_ID, player_id: PROFILE_ID,
        source_system: 'hockeylifehl_legacy_players', source_batch_id: 'legacy_players_current',
        games_played: 100, wins: 60, ties: 10, saves: 1000, goals_against: 250,
        shutouts: 5, save_percentage: 80, goals_against_average: 2.5,
      }
    : {
        league_id: HOCKEY_LIFE_ID, player_id: PROFILE_ID,
        source_system: 'hockeylifehl_legacy_players', source_batch_id: 'legacy_players_current',
        games_played: 72, goals: 105, assists: 45, points: 150,
      };
  const client = { from: jest.fn((table: string) => {
    const trace: Trace = { table, selection: '', selectOptions: undefined, filters: [], ranged: false };
    traces.push(trace);
    const query: Record<string, unknown> = {};
    query.select = jest.fn((selection: string, selectOptions: unknown) => {
      trace.selection = selection;
      trace.selectOptions = selectOptions;
      return query;
    });
    for (const method of ['eq', 'in', 'or', 'order', 'limit']) {
      query[method] = jest.fn((column: string, value: unknown) => {
        trace.filters.push([method, column, value]);
        return query;
      });
    }
    const filterToRequestedSeasons = <T extends { season_id?: string | null }>(rows: T[]) => {
      const seasonEq = trace.filters.find(([method, column]) => method === 'eq' && column === 'season_id')?.[2];
      const seasonIn = trace.filters.find(([method, column]) => method === 'in' && column === 'season_id')?.[2];
      if (typeof seasonEq === 'string') return rows.filter((row) => row.season_id === seasonEq);
      if (Array.isArray(seasonIn)) return rows.filter((row) => row.season_id && seasonIn.includes(row.season_id));
      return rows;
    };
    const result = () => {
      if (table === 'seasons') return { data: seasons, error: null, count: seasons.length };
      if (table === 'player_season_stats') return { data: skaterRows, error: null, count: skaterRows.length };
      if (table === 'goalie_stats') {
        const data = trace.selection.includes('id, game_id, team_id') ? [] : filterToRequestedSeasons(goalieRows);
        return { data, error: null, count: data.length };
      }
      if (table === 'player_career_baselines') return {
        data: options.includeHistoricalBaseline ? baseline : null, error: null, count: null,
      };
      if (table === 'game_checkins') {
        const isOutRead = trace.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'out');
        return { data: isOutRead ? [] : checkins, error: null, count: isOutRead ? 0 : checkins.length };
      }
      if (table === 'teams') return { data: [{ id: TEAM_ID, name: 'Bad Bunny' }], error: null, count: 1 };
      if (table === 'games' && trace.selection.includes('league_id, status')) {
        const ids = trace.filters.find(([method, column]) => method === 'in' && column === 'id')?.[2] as string[];
        const data = ids.map((id) => games.get(id)).filter(Boolean);
        return { data, error: null, count: data.length };
      }
      if (table === 'games') {
        const data = filterToRequestedSeasons([...games.values()].filter((game) => game.league_id === HOCKEY_LIFE_ID));
        return { data, error: null, count: data.length };
      }
      if (table === 'team_rosters') {
        const data = filterToRequestedSeasons(rosterRows);
        return { data, error: null, count: data.length };
      }
      if (table === 'profiles') return { data: { full_name: 'Fixture Player' }, error: null, count: null };
      return { data: [], error: null, count: 0 };
    };
    const appearancePhase = () => {
      if (table === 'game_checkins' && trace.selection === 'player_id, team_id, game_id') return 'confirmed' as const;
      if (table === 'games' && trace.selection.includes('league_id, status')) return 'confirmed' as const;
      if (table === 'team_rosters' && trace.selection.includes('start_date')) return 'fallback' as const;
      if (table === 'games' && trace.selection.includes('scheduled_at, status')) return 'fallback' as const;
      if (trace.selection.startsWith('id, game_id, team_id')) return 'fallback' as const;
      return null;
    };
    const execute = async () => {
      const phase = options.trackAppearanceConcurrency ? appearancePhase() : null;
      const coreEvidence = phase === 'fallback' && (
        table === 'game_checkins'
          ? trace.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'out')
          : trace.selection === 'id, game_id, team_id, player_id, season_id'
            && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')
      );
      const optionalEvidence = phase === 'fallback'
        && (table === 'player_stats' || table === 'goalie_stats')
        && trace.selection === 'id, game_id, team_id, season_id'
        && !trace.filters.some(([method, column]) => method === 'in' && column === 'player_id');
      if (phase) {
        appearance.started[phase] += 1;
        appearance.active += 1;
        appearance.activeByPhase[phase] += 1;
        appearance.maxActive = Math.max(appearance.maxActive, appearance.active);
        if (coreEvidence) {
          appearance.activeCoreEvidence += 1;
          appearance.startedCoreEvidence += 1;
          appearance.maxCoreEvidenceActive = Math.max(
            appearance.maxCoreEvidenceActive,
            appearance.activeCoreEvidence,
          );
        }
        if (optionalEvidence) {
          appearance.activeOptionalEvidence += 1;
          appearance.startedOptionalEvidence += 1;
          appearance.maxOptionalEvidenceActive = Math.max(
            appearance.maxOptionalEvidenceActive,
            appearance.activeOptionalEvidence,
          );
        }
        appearance.coreOptionalOverlap ||= appearance.activeCoreEvidence > 0
          && appearance.activeOptionalEvidence > 0;
        appearance.overlap ||= appearance.activeByPhase.confirmed > 0 && appearance.activeByPhase.fallback > 0;
        appearance.events.push(`start:${phase}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        appearance.active -= 1;
        appearance.activeByPhase[phase] -= 1;
        if (coreEvidence) {
          appearance.activeCoreEvidence -= 1;
          appearance.settledCoreEvidence += 1;
        }
        if (optionalEvidence) {
          appearance.activeOptionalEvidence -= 1;
          appearance.settledOptionalEvidence += 1;
        }
        appearance.settled[phase] += 1;
        appearance.events.push(`settle:${phase}`);
      }
      return result();
    };
    query.range = jest.fn(async (from: number, to: number) => {
      trace.ranged = true;
      const value = await execute();
      return {
        ...value,
        data: Array.isArray(value.data) ? value.data.slice(from, to + 1) : value.data,
      };
    });
    query.maybeSingle = jest.fn(() => Promise.resolve(result()));
    query.then = (resolve: (value: unknown) => unknown) => execute().then(resolve);
    return query;
  }) };
  return { client, traces, appearance };
}

type ProductionPressurePhase = 'prerequisites' | 'selectedStats' | 'timeline' | 'gameLog' | 'decorative';

const productionPressurePhase = new AsyncLocalStorage<ProductionPressurePhase>();

function productionPressureDependencies(
  dependencies: MobilePlayerProfileDependencies = mobilePlayerProfileDependencies,
): MobilePlayerProfileDependencies {
  const inPhase = <T,>(phase: ProductionPressurePhase, read: () => Promise<T>) => (
    productionPressurePhase.run(phase, read)
  );
  return {
    getLeague: () => inPhase('prerequisites', () => dependencies.getLeague()),
    resolvePlayer: (playerOrRosterId, leagueId) => inPhase(
      'prerequisites',
      () => dependencies.resolvePlayer(playerOrRosterId, leagueId),
    ),
    getSeasons: (leagueId) => inPhase('prerequisites', () => dependencies.getSeasons(leagueId)),
    getCurrentSeason: (leagueId) => inPhase('prerequisites', () => dependencies.getCurrentSeason(leagueId)),
    getStats: (playerId, seasonId, leagueId, isGoalie) => inPhase(
      'selectedStats',
      () => dependencies.getStats(playerId, seasonId, leagueId, isGoalie),
    ),
    getPublicSeasonPlayer: (leagueId, seasonId, playerId) => inPhase(
      'selectedStats',
      () => dependencies.getPublicSeasonPlayer(leagueId, seasonId, playerId),
    ),
    getTimeline: (leagueId, playerId, isGoalie, includeHistoricalBaseline) => inPhase(
      'timeline',
      () => dependencies.getTimeline(leagueId, playerId, isGoalie, includeHistoricalBaseline),
    ),
    getGames: (playerId, seasonId) => inPhase('gameLog', () => dependencies.getGames(playerId, seasonId)),
    getBadges: (playerId) => inPhase('decorative', () => dependencies.getBadges(playerId)),
    getImportedAchievements: (playerId, leagueId) => inPhase(
      'decorative',
      () => dependencies.getImportedAchievements(playerId, leagueId),
    ),
    getArticles: (playerId) => inPhase('decorative', () => dependencies.getArticles(playerId)),
    getMatchups: (playerId, seasonId, isGoalie) => inPhase(
      'decorative',
      () => dependencies.getMatchups(playerId, seasonId, isGoalie),
    ),
    generateHotFacts: (input) => inPhase('decorative', () => dependencies.generateHotFacts(input)),
    assertHealthy: dependencies.assertHealthy
      ? (leagueId, playerId, seasonId) => inPhase(
          'prerequisites',
          () => dependencies.assertHealthy!(leagueId, playerId, seasonId),
        )
      : undefined,
  };
}

function productionCoordinatorPressureClient() {
  type Trace = {
    table: string;
    selection: string;
    selectOptions: { count?: string; head?: boolean } | null;
    filters: Array<[string, string, unknown]>;
    activeAtStart: number;
    phase: ProductionPressurePhase;
    settled: boolean;
  };
  const state = {
    active: 0,
    maxActive: 0,
    phaseActive: {
      prerequisites: 0,
      selectedStats: 0,
      timeline: 0,
      gameLog: 0,
      decorative: 0,
    } satisfies Record<ProductionPressurePhase, number>,
    phaseMaxActive: {
      prerequisites: 0,
      selectedStats: 0,
      timeline: 0,
      gameLog: 0,
      decorative: 0,
    } satisfies Record<ProductionPressurePhase, number>,
    overlappingPhasePairs: new Set<string>(),
  };
  const traces: Trace[] = [];
  const seasons = [
    { id: SEASON_ID, league_id: HOCKEY_LIFE_ID, name: 'Fall 2026', status: 'active', start_date: '2026-09-01', created_at: '2026-08-01' },
    { id: OTHER_SEASON_ID, league_id: HOCKEY_LIFE_ID, name: 'Spring 2026', status: 'completed', start_date: '2026-03-01', created_at: '2026-02-01' },
  ];
  const games = [
    { id: '80000000-0000-4000-8000-000000000001', league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, scheduled_at: '2026-09-20T20:00:00Z', status: 'completed', home_team_id: TEAM_ID, away_team_id: '71000000-0000-4000-8000-000000000007', home_score: 4, away_score: 2, location: 'Arena', penalty_capture_status: null, goalie_capture_status: null, skater_capture_status: null },
    { id: '80000000-0000-4000-8000-000000000002', league_id: HOCKEY_LIFE_ID, season_id: OTHER_SEASON_ID, scheduled_at: '2026-03-20T20:00:00Z', status: 'completed', home_team_id: TEAM_ID, away_team_id: '71000000-0000-4000-8000-000000000007', home_score: 3, away_score: 1, location: 'Arena', penalty_capture_status: null, goalie_capture_status: null, skater_capture_status: null },
  ];
  const nestedGame = (game: typeof games[number]) => ({
    ...game,
    home_team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny' },
    away_team: { id: game.away_team_id, name: 'Visitors', slug: 'visitors' },
  });
  const rosters = seasons.map((season, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 1}`,
    player_id: PROFILE_ID,
    team_id: TEAM_ID,
    league_id: HOCKEY_LIFE_ID,
    season_id: season.id,
    start_date: season.start_date,
    joined_at: season.start_date,
    end_date: null,
    status: 'active',
    player_type: 'regular',
    historical_retained: false,
    games_played_override: null,
    jersey_number: 36,
    leadership_role: null,
    position: 'C',
    is_goalie: false,
    team: { name: 'Bad Bunny' },
  }));
  const checkins = games.map((game, index) => ({
    id: `90000000-0000-4000-8000-00000000000${index + 1}`,
    player_id: PROFILE_ID,
    team_id: TEAM_ID,
    game_id: game.id,
    status: 'confirmed',
    game: { id: game.id },
  }));
  const playerStats = games.map((game, index) => ({
    id: `a0000000-0000-4000-8000-00000000000${index + 1}`,
    game_id: game.id,
    player_id: PROFILE_ID,
    team_id: TEAM_ID,
    league_id: HOCKEY_LIFE_ID,
    season_id: game.season_id,
    goals: index + 1,
    assists: 1,
    penalty_minutes: 2,
    scorekeeping_provenance: 'recorded',
    game: nestedGame(game),
  }));
  const sourceRows = (table: string, selection: string) => {
    if (table === 'leagues') return [{ id: HOCKEY_LIFE_ID, slug: 'hockey-life', status: 'active' }];
    if (table === 'seasons') return seasons;
    if (table === 'teams') return [
      { id: TEAM_ID, league_id: HOCKEY_LIFE_ID, division_id: null, name: 'Bad Bunny' },
      { id: '71000000-0000-4000-8000-000000000007', league_id: HOCKEY_LIFE_ID, division_id: null, name: 'Visitors' },
    ];
    if (table === 'team_rosters') {
      if (selection.includes('profile:profiles')) return rosters.map((row) => ({
        ...row,
        profile: { id: PROFILE_ID, full_name: 'Fixture Player', avatar_url: null, photo_url: null },
        team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny', logo_url: null, primary_color: null, secondary_color: null, league_id: HOCKEY_LIFE_ID },
      }));
      return rosters;
    }
    if (table === 'games') return games;
    if (table === 'game_checkins') return checkins;
    if (table === 'player_availability' || table === 'sub_invitations' || table === 'goalie_stats'
      || table === 'game_goalie_appearances' || table === 'player_career_baselines') return [];
    if (table === 'player_stats') return playerStats;
    if (table === 'profiles') return [{ id: PROFILE_ID, full_name: 'Fixture Player', avatar_url: null, photo_url: null }];
    if (table === 'player_season_stats') return seasons.map((season, index) => ({
      player_id: PROFILE_ID,
      season_id: season.id,
      team_id: TEAM_ID,
      team_name: 'Bad Bunny',
      position: 'C',
      games_played: 1,
      goals: index + 1,
      assists: 1,
      points: index + 2,
    }));
    if (table === 'player_badges') return [{
      id: 'b1000000-0000-4000-8000-000000000001',
      player_id: PROFILE_ID,
      league_id: HOCKEY_LIFE_ID,
      season_id: SEASON_ID,
      badge_type: 'top_scorer',
      created_at: '2026-10-01',
      season: { name: 'Fall 2026' },
      team: { name: 'Bad Bunny' },
    }];
    if (table === 'article_player_tags') return [{ article_id: 'a1000000-0000-4000-8000-000000000001', player_id: PROFILE_ID }];
    if (table === 'articles') return [{
      id: 'a1000000-0000-4000-8000-000000000001',
      league_id: HOCKEY_LIFE_ID,
      slug: 'fixture',
      title: 'Fixture',
      excerpt: 'Fixture',
      published_at: '2026-10-01',
      image_url: null,
      type: 'news',
      published: true,
      player_tags: [{ player_id: PROFILE_ID }],
    }];
    if (table === 'player_goalie_matchups') return [{
      id: '91000000-0000-4000-8000-000000000001',
      league_id: HOCKEY_LIFE_ID,
      season_id: SEASON_ID,
      player_id: PROFILE_ID,
      goalie_id: 'bdd94b26-b344-459f-9727-8cddae9783df',
      games_played: 1,
      goals: 1,
      assists: 0,
      points: 1,
      shots: 2,
      shooting_percentage: 50,
      goalie: { id: 'bdd94b26-b344-459f-9727-8cddae9783df', full_name: 'Goalie' },
    }];
    return [];
  };
  const client = { from: jest.fn((table: string) => {
    let selection = '';
    let selectOptions: { count?: string; head?: boolean } | null = null;
    const filters: Array<[string, string, unknown]> = [];
    let limit: number | null = null;
    const query: Record<string, unknown> = {};
    query.select = jest.fn((columns: string, options?: { count?: string; head?: boolean }) => {
      selection = columns;
      selectOptions = options ?? null;
      return query;
    });
    query.eq = jest.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return query; });
    query.in = jest.fn((column: string, value: unknown) => { filters.push(['in', column, value]); return query; });
    query.is = jest.fn((column: string, value: unknown) => { filters.push(['is', column, value]); return query; });
    query.or = jest.fn((value: string) => { filters.push(['or', value, null]); return query; });
    query.order = jest.fn(() => query);
    query.limit = jest.fn((value: number) => { limit = value; return query; });
    const execute = async (kind: 'then' | 'range' | 'single' | 'maybeSingle', range?: [number, number]) => {
      let rows = sourceRows(table, selection);
      for (const [method, column, value] of filters) {
        if (column.includes('.')) continue;
        if (method === 'eq') rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
        if (method === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes((row as Record<string, unknown>)[column]));
        if (method === 'is') rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
        if (method === 'or') {
          const teams = new Set([...column.matchAll(/(?:home|away)_team_id\.(?:eq|in\.\()([0-9a-z-]+)/gi)].map((match) => match[1]));
          if (teams.size > 0) rows = rows.filter((row) => teams.has((row as Record<string, unknown>).home_team_id as string)
            || teams.has((row as Record<string, unknown>).away_team_id as string));
        }
      }
      if (limit !== null) rows = rows.slice(0, limit);
      const count = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      const phase = productionPressurePhase.getStore();
      if (!phase) throw new Error(`unclassified production pressure read: ${table}`);
      const trace: Trace = {
        table,
        selection,
        selectOptions,
        filters: [...filters],
        activeAtStart: state.active + 1,
        phase,
        settled: false,
      };
      traces.push(trace);
      for (const [activePhase, activeCount] of Object.entries(state.phaseActive)) {
        if (activeCount > 0 && activePhase !== phase) {
          state.overlappingPhasePairs.add([activePhase, phase].sort().join('|'));
        }
      }
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      state.phaseActive[phase] += 1;
      state.phaseMaxActive[phase] = Math.max(state.phaseMaxActive[phase], state.phaseActive[phase]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      state.active -= 1;
      state.phaseActive[phase] -= 1;
      trace.settled = true;
      if (selectOptions?.head) return { data: null, error: null, count };
      if (kind === 'single' || kind === 'maybeSingle') return { data: rows[0] ?? null, error: null, count: selectOptions?.count === 'exact' ? count : null };
      return { data: rows, error: null, count: selectOptions?.count === 'exact' ? count : null };
    };
    query.range = jest.fn((from: number, to: number) => execute('range', [from, to]));
    query.single = jest.fn(() => execute('single'));
    query.maybeSingle = jest.fn(() => execute('maybeSingle'));
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute('then').then(resolve, reject);
    return query;
  }) };
  return { client, traces, state };
}

async function runProductionCoordinatorPressure(
  dependencies?: MobilePlayerProfileDependencies,
  routeCount = 1,
) {
  const { client, traces, state } = productionCoordinatorPressureClient();
  mockedCreateClient.mockResolvedValue(client as never);
  mockedCreateServiceRoleClient.mockReturnValue(client as never);
  const pressureDependencies = productionPressureDependencies(dependencies);
  const responses = await Promise.all(Array.from({ length: routeCount }, () => (
    handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), pressureDependencies)
  )));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  return {
    status: responses[0].status,
    statuses: responses.map((response) => response.status),
    body: bodies[0],
    bodies,
    requestCount: traces.length,
    prerequisiteTables: traces.slice(0, 5).map((trace) => trace.table),
    responseGraphRequestCount: routeCount === 1 ? traces.slice(5).length : null,
    healthHeadRequests: traces.filter((trace) => trace.selectOptions?.head).map((trace) => ({
      table: trace.table,
      selection: trace.selection,
    })),
    maxActive: state.maxActive,
    phaseMaxActive: state.phaseMaxActive,
    phaseOrder: traces.map((trace) => trace.phase).filter((phase, index, phases) => (
      index === 0 || phase !== phases[index - 1]
    )),
    overlappingPhasePairs: [...state.overlappingPhasePairs].sort(),
    activeAtReturn: state.active,
    allSettledAtReturn: traces.every((trace) => trace.settled),
  };
}

async function runProductionGameLogPressure(options: Parameters<typeof getPlayerGameLog>[3]) {
  const { client, traces, state } = productionCoordinatorPressureClient();
  mockedCreateClient.mockResolvedValue(client as never);
  mockedCreateServiceRoleClient.mockReturnValue(client as never);
  const rows = await productionPressurePhase.run('gameLog', () => (
    getPlayerGameLog(PROFILE_ID, SEASON_ID, 20, options)
  ));
  return {
    rows,
    requestCount: traces.length,
    maxActive: state.maxActive,
    activeAtReturn: state.active,
    allSettledAtReturn: traces.every((trace) => trace.settled),
  };
}

describe('strict Player Profile game-log concurrency', () => {
  it('[v11 game-log override] preserves rows and request count while retaining default four and honoring inherited and evidence overrides', async () => {
    const baseline = await runProductionGameLogPressure({ strict: true });
    const inheritedTwo = await runProductionGameLogPressure({
      strict: true,
      strictBatchConcurrency: 2,
    } as Parameters<typeof getPlayerGameLog>[3] & { strictBatchConcurrency: number });
    const serialEvidence = await runProductionGameLogPressure({
      strict: true,
      strictBatchConcurrency: 2,
      strictEvidenceBatchConcurrency: 1,
    } as Parameters<typeof getPlayerGameLog>[3] & {
      strictBatchConcurrency: number;
      strictEvidenceBatchConcurrency: number;
    });
    const serial = await runProductionGameLogPressure({
      strict: true,
      strictBatchConcurrency: 1,
      strictEvidenceBatchConcurrency: 1,
    } as Parameters<typeof getPlayerGameLog>[3] & {
      strictBatchConcurrency: number;
      strictEvidenceBatchConcurrency: number;
    });

    for (const candidate of [inheritedTwo, serialEvidence, serial]) {
      expect(candidate.rows).toEqual(baseline.rows);
      expect(candidate.requestCount).toBe(baseline.requestCount);
      expect(candidate.activeAtReturn).toBe(0);
      expect(candidate.allSettledAtReturn).toBe(true);
    }
    expect(baseline.maxActive).toBe(4);
    expect(inheritedTwo.maxActive).toBe(2);
    expect(serialEvidence.maxActive).toBe(1);
    expect(serial.maxActive).toBe(1);
  });

  it.each((['strictBatchConcurrency', 'strictEvidenceBatchConcurrency'] as const).flatMap((field) => (
    [0, 1.5, 5, Number.NaN].flatMap((value) => (
      [true, false].map((strict) => [field, value, strict] as const)
    ))
  )))('[v11 game-log validation] rejects %s=%s before provider work when strict=%s', async (field, value, strict) => {
    mockedCreateClient.mockClear();
    mockedCreateClient.mockImplementation(() => { throw new Error('provider work must not start'); });

    await expect(getPlayerGameLog(PROFILE_ID, SEASON_ID, 20, {
      strict,
      [field]: value,
    } as Parameters<typeof getPlayerGameLog>[3] & {
      strictBatchConcurrency?: number;
      strictEvidenceBatchConcurrency?: number;
    })).rejects.toThrow('strict batch concurrency must be an integer from 1 to 4');
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });
});

describe('strict canonical appearance query completeness', () => {
  it('returns only the requested season while excluding legitimate cross-season, cross-league, and inactive games', async () => {
    const checkins = ['requested', 'other-season', 'other-league', 'inactive'].map((gameId) => ({
      player_id: PROFILE_ID, team_id: TEAM_ID, game_id: gameId,
    }));
    const fixture = strictAppearanceClient({
      checkins,
      gameRows: (ids) => ids.map((id) => ({
        id,
        league_id: id === 'other-league' ? OTHER_LEAGUE_ID : HOCKEY_LIFE_ID,
        season_id: id === 'other-season' ? OTHER_SEASON_ID : SEASON_ID,
        status: id === 'inactive' ? 'scheduled' : 'completed',
        home_team_id: TEAM_ID,
        away_team_id: null,
        scheduled_at: '2026-09-01',
        home_score: 1,
        away_score: 0,
      })),
    });

    await expect(getConfirmedCheckinAppearanceRows(fixture.client as never, {
      leagueId: HOCKEY_LIFE_ID,
      seasonId: SEASON_ID,
      playerIds: [PROFILE_ID],
      strict: true,
    })).resolves.toMatchObject([{ game_id: 'requested', game: { season_id: SEASON_ID } }]);
  });

  it('fully pages 1,001 cross-scope check-ins, hydrates in URL-safe batches, and returns the in-scope subset', async () => {
    const checkins = Array.from({ length: 1001 }, (_, index) => ({
      player_id: PROFILE_ID,
      team_id: TEAM_ID,
      game_id: `game-${String(index).padStart(4, '0')}`,
    }));
    const checkinQuery: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq', 'in', 'order']) checkinQuery[method] = jest.fn(() => checkinQuery);
    checkinQuery.range = jest.fn((from: number, to: number) => Promise.resolve({
      data: checkins.slice(from, to + 1), error: null, count: checkins.length,
    }));
    checkinQuery.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: checkins.slice(0, 1000), error: null, count: checkins.length,
    }).then(resolve);

    const gameQueries: Array<Record<string, jest.Mock> & { then?: unknown }> = [];
    const client = { from: jest.fn((table: string) => {
      if (table === 'game_checkins') return checkinQuery;
      const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
      let ids: string[] = [];
      for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
      query.in = jest.fn((column: string, values: string[]) => {
        if (column === 'id') ids = values;
        return query;
      });
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: ids.map((id) => {
          const index = Number(id.slice('game-'.length));
          return {
            id,
            league_id: index >= 800 && index < 900 ? OTHER_LEAGUE_ID : HOCKEY_LIFE_ID,
            season_id: index < 300 ? SEASON_ID : index < 600 ? OTHER_SEASON_ID : '40000000-0000-4000-8000-000000000004',
            status: index >= 900 ? 'scheduled' : 'completed',
            home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01',
            home_score: 1, away_score: 0,
          };
        }),
        error: null,
        count: ids.length,
      }).then(resolve);
      gameQueries.push(query);
      return query;
    }) };

    await expect(getConfirmedCheckinAppearanceRows(client as never, {
      leagueId: HOCKEY_LIFE_ID,
      seasonIds: [SEASON_ID, OTHER_SEASON_ID],
      playerIds: [PROFILE_ID],
      strict: true,
    })).resolves.toHaveLength(600);
    expect(checkinQuery.select).toHaveBeenCalledWith('player_id, team_id, game_id', { count: 'exact' });
    expect(checkinQuery.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(checkinQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(gameQueries).toHaveLength(11);
    expect(gameQueries.every((query) => (query.in.mock.calls.find(([column]) => column === 'id')?.[1] as string[]).length <= 100)).toBe(true);
  });

  it('caps strict game hydration at four concurrent queries', async () => {
    const checkins = Array.from({ length: 1001 }, (_, index) => ({
      player_id: PROFILE_ID,
      team_id: TEAM_ID,
      game_id: `game-${String(index).padStart(4, '0')}`,
    }));
    const checkinQuery: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq', 'in', 'order']) checkinQuery[method] = jest.fn(() => checkinQuery);
    checkinQuery.range = jest.fn((from: number, to: number) => Promise.resolve({
      data: checkins.slice(from, to + 1), error: null, count: checkins.length,
    }));

    let activeGameQueries = 0;
    let maxActiveGameQueries = 0;
    const gameQueries: Array<Record<string, jest.Mock> & { then?: unknown }> = [];
    const client = { from: jest.fn((table: string) => {
      if (table === 'game_checkins') return checkinQuery;
      const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
      let ids: string[] = [];
      for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
      query.in = jest.fn((column: string, values: string[]) => {
        if (column === 'id') ids = values;
        return query;
      });
      query.then = (resolve: (value: unknown) => unknown) => {
        activeGameQueries += 1;
        maxActiveGameQueries = Math.max(maxActiveGameQueries, activeGameQueries);
        return new Promise((release) => {
          setImmediate(() => {
            activeGameQueries -= 1;
            release({
              data: ids.map((id) => ({
                id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed',
                home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01',
                home_score: 1, away_score: 0,
              })),
              error: null,
              count: ids.length,
            });
          });
        }).then(resolve);
      };
      gameQueries.push(query);
      return query;
    }) };

    await expect(getConfirmedCheckinAppearanceRows(client as never, {
      leagueId: HOCKEY_LIFE_ID,
      seasonId: SEASON_ID,
      playerIds: [PROFILE_ID],
      strict: true,
    })).resolves.toHaveLength(1001);
    expect(gameQueries).toHaveLength(11);
    expect(maxActiveGameQueries).toBe(4);
  });

  it('preserves the original non-strict capped-query behavior and projection options', async () => {
    const builder = queryResult({ data: [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'one' }], error: null, count: 1001 });
    const client = { from: jest.fn(() => builder) };
    await expect(getConfirmedCheckinAppearanceRows(client as never, { playerIds: [PROFILE_ID] })).resolves.toHaveLength(1);
    expect(builder.select).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('fails closed when a later direct check-in page errors', async () => {
    const fixture = strictAppearanceClient({
      checkins: Array.from({ length: 1001 }, (_, index) => ({
        player_id: PROFILE_ID, team_id: TEAM_ID, game_id: `game-${index}`,
      })),
      checkinPageErrorOffset: 1000,
    });
    await expect(getConfirmedCheckinAppearanceRows(fixture.client as never, {
      leagueId: HOCKEY_LIFE_ID, seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('confirmed check-in appearances page 1000');
  });

  it('fails closed when a provider cap truncates a direct check-in page', async () => {
    const checkins = Array.from({ length: 1001 }, (_, index) => ({
      player_id: PROFILE_ID, team_id: TEAM_ID, game_id: `game-${index}`,
    }));
    const fixture = strictAppearanceClient({
      checkins,
      checkinPageRows: (from, to) => checkins.slice(from, Math.min(to, 998) + 1),
    });
    await expect(getConfirmedCheckinAppearanceRows(fixture.client as never, {
      leagueId: HOCKEY_LIFE_ID, seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('confirmed check-in appearances completeness');
  });

  it('fails closed when a later game-validation batch errors', async () => {
    const fixture = strictAppearanceClient({
      checkins: Array.from({ length: 101 }, (_, index) => ({
        player_id: PROFILE_ID, team_id: TEAM_ID, game_id: `game-${index}`,
      })),
      gameBatchErrorIndex: 1,
    });
    await expect(getConfirmedCheckinAppearanceRows(fixture.client as never, {
      leagueId: HOCKEY_LIFE_ID, seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('confirmed check-in game validation batch 2');
  });

  it('[v6 direct-scheduler rail] consumes every hydration batch and chooses the earliest scheduled failure', async () => {
    const checkins = Array.from({ length: 501 }, (_, index) => ({
      player_id: PROFILE_ID,
      team_id: TEAM_ID,
      game_id: `scheduler-game-${String(index).padStart(4, '0')}`,
    }));
    const checkinQuery: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq', 'in', 'order']) checkinQuery[method] = jest.fn(() => checkinQuery);
    checkinQuery.range = jest.fn((from: number, to: number) => Promise.resolve({
      data: checkins.slice(from, to + 1), error: null, count: checkins.length,
    }));

    const schedules = [
      { delay: 30, error: 'scheduled-first' },
      { delay: 5, error: 'fastest-second' },
      { delay: 15, error: null },
      { delay: 10, error: null },
      { delay: 1, error: null },
      { delay: 1, error: 'later-sixth' },
    ];
    let active = 0;
    let settled = 0;
    let maxActive = 0;
    const started: number[] = [];
    let created = 0;
    const client = { from: jest.fn((table: string) => {
      if (table === 'game_checkins') return checkinQuery;
      const batchIndex = created++;
      const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
      let ids: string[] = [];
      for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
      query.in = jest.fn((column: string, values: string[]) => {
        if (column === 'id') ids = values;
        return query;
      });
      query.then = (resolve: (value: unknown) => unknown) => {
        started.push(batchIndex);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const schedule = schedules[batchIndex];
        return new Promise((release) => {
          setTimeout(() => {
            active -= 1;
            settled += 1;
            release(schedule.error
              ? { data: null, error: { code: 'PGRST500', message: schedule.error }, count: null }
              : {
                  data: ids.map((id) => ({
                    id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed',
                    home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01T20:00:00Z',
                    home_score: 3, away_score: 2,
                  })),
                  error: null,
                  count: ids.length,
                });
          }, schedule.delay);
        }).then(resolve);
      };
      return query;
    }) };

    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', captureUnhandled);
    let thrown: unknown;
    let stateAtReturn: { active: number; settled: number; started: number } | undefined;
    try {
      try {
        await getConfirmedCheckinAppearanceRows(client as never, {
          leagueId: HOCKEY_LIFE_ID, seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
        });
      } catch (error) {
        thrown = error;
        stateAtReturn = { active, settled, started: started.length };
      }
      while (active > 0) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }

    expect(thrown).toEqual(expect.objectContaining({
      message: expect.stringContaining('confirmed check-in game validation batch 1'),
    }));
    expect(stateAtReturn).toEqual({ active: 0, settled: 6, started: 6 });
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(unhandled).toHaveLength(0);
  });

  it('[v8 strict override] caps hydration at two while preserving deterministic errors and full settlement', async () => {
    const checkins = Array.from({ length: 501 }, (_, index) => ({
      player_id: PROFILE_ID,
      team_id: TEAM_ID,
      game_id: `v8-override-game-${String(index).padStart(4, '0')}`,
    }));
    const schedules = [
      { delay: 30, error: 'scheduled-first' },
      { delay: 5, error: 'fastest-second' },
      { delay: 15, error: null },
      { delay: 10, error: null },
      { delay: 1, error: null },
      { delay: 1, error: 'later-sixth' },
    ];
    let active = 0;
    let settled = 0;
    let maxActive = 0;
    const started: number[] = [];
    const fixture = strictAppearanceClient({
      checkins,
      gameResult: (ids, batchIndex) => new Promise((resolve) => {
        started.push(batchIndex);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const schedule = schedules[batchIndex];
        setTimeout(() => {
          active -= 1;
          settled += 1;
          resolve(schedule.error
            ? { data: null, error: { code: 'PGRST500', message: schedule.error }, count: null }
            : {
                data: ids.map((id) => ({
                  id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed',
                  home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01T20:00:00Z',
                  home_score: 3, away_score: 2,
                })),
                error: null,
                count: ids.length,
              });
        }, schedule.delay);
      }),
    });

    let thrown: unknown;
    let stateAtReturn: { active: number; settled: number; started: number } | undefined;
    try {
      await getConfirmedCheckinAppearanceRows(fixture.client as never, {
        leagueId: HOCKEY_LIFE_ID,
        seasonId: SEASON_ID,
        playerIds: [PROFILE_ID],
        strict: true,
        strictBatchConcurrency: 2,
      } as Parameters<typeof getConfirmedCheckinAppearanceRows>[1] & { strictBatchConcurrency: number });
    } catch (error) {
      thrown = error;
      stateAtReturn = { active, settled, started: started.length };
    }

    expect(thrown).toEqual(expect.objectContaining({
      message: expect.stringContaining('confirmed check-in game validation batch 1'),
    }));
    expect(stateAtReturn).toEqual({ active: 0, settled: 6, started: 6 });
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActive).toBe(2);
  });

  it.each([
    ['confirmed', 0],
    ['confirmed', 1.5],
    ['confirmed', 5],
    ['confirmed', Number.NaN],
    ['fallback', 0],
    ['fallback', 1.5],
    ['fallback', 5],
    ['fallback', Number.NaN],
  ] as const)('[v8 strict concurrency contract] fails closed for %s concurrency %s before provider work', async (helper, strictBatchConcurrency) => {
    const client = { from: jest.fn(() => { throw new Error('provider work must not start'); }) };
    const read = helper === 'confirmed'
      ? getConfirmedCheckinAppearanceRows(client as never, {
          leagueId: HOCKEY_LIFE_ID,
          seasonId: SEASON_ID,
          playerIds: [PROFILE_ID],
          strict: true,
          strictBatchConcurrency,
        })
      : getFallbackRosterAppearanceRows(client as never, {
          seasonId: SEASON_ID,
          playerIds: [PROFILE_ID],
          strict: true,
          strictBatchConcurrency,
        } as Parameters<typeof getFallbackRosterAppearanceRows>[1] & { strictBatchConcurrency: number });

    await expect(read).rejects.toThrow('strict batch concurrency must be an integer from 1 to 4');
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid check-in', [{ player_id: PROFILE_ID, team_id: null, game_id: 'game-1' }], undefined],
    ['duplicate check-in', [
      { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' },
      { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' },
    ], undefined],
    ['missing game validation', [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' }], () => []],
    ['duplicate game validation', [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' }], (ids: string[]) => ids.flatMap((id) => [
      { id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null },
      { id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null },
    ])],
    ['malformed game validation', [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' }], (ids: string[]) => ids.map((id) => ({
      id, league_id: null, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null,
    }))],
    ['cross-team game', [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'game-1' }], (ids: string[]) => ids.map((id) => ({
      id, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: 'other-a', away_team_id: 'other-b',
    }))],
  ] as const)('fails closed for %s provider rows', async (_label, checkins, gameRows) => {
    const fixture = strictAppearanceClient({ checkins: [...checkins], gameRows });
    await expect(getConfirmedCheckinAppearanceRows(fixture.client as never, {
      leagueId: HOCKEY_LIFE_ID, seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow(/validation|completeness/);
  });

  it('[v5 URL rail] keeps every installed-client core and optional request target URL-safe at 1,000 teams across 10 seasons', async () => {
    const seasonIds = Array.from({ length: 10 }, (_, index) => (
      `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const teamIds = Array.from({ length: 1000 }, (_, index) => (
      `20000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const gameIds = Array.from({ length: 1000 }, (_, index) => (
      `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const rosterRows = teamIds.map((teamId, index) => ({
      player_id: PROFILE_ID,
      team_id: teamId,
      season_id: seasonIds[Math.floor(index / 100)],
      start_date: '2026-01-01',
      end_date: null,
      status: 'active',
      player_type: 'regular',
    }));
    const games = gameIds.map((id, index) => ({
      id,
      season_id: seasonIds[Math.floor(index / 100)],
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: teamIds[index],
      away_team_id: teamIds[Math.floor(index / 100) * 100 + ((index + 1) % 100)],
      home_score: null,
      away_score: null,
    }));
    type SerializedRequest = {
      source: string;
      table: string;
      targetBytes: number;
      url: URL;
    };
    const requests: SerializedRequest[] = [];
    let activeReads = 0;
    let maxActiveReads = 0;
    const parseInFilter = (value: string | null) => {
      if (!value?.startsWith('in.(') || !value.endsWith(')')) return [];
      return value.slice(4, -1).split(',').filter(Boolean);
    };
    const requestedValues = (url: URL, column: string) => {
      const value = url.searchParams.get(column);
      if (!value) return [];
      if (value.startsWith('eq.')) return [value.slice(3)];
      return parseInFilter(value);
    };
    const exactResponse = (rows: Array<Record<string, unknown>>) => new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range': rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : '*/0',
      },
    });
    const serializedFetch: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const table = url.pathname.split('/').pop() || '';
      const hasPlayerScope = Boolean(url.searchParams.get('player_id'));
      const hasGameScope = Boolean(url.searchParams.get('game_id'));
      const source = table === 'player_stats' || table === 'goalie_stats'
        ? (hasGameScope && !hasPlayerScope ? `optional ${table}` : `core ${table}`)
        : table;
      requests.push({
        source,
        table,
        targetBytes: Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8'),
        url,
      });
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeReads -= 1;

      const requestedSeasons = requestedValues(url, 'season_id');
      const requestedTeams = requestedValues(url, 'team_id');
      const requestedGames = requestedValues(url, 'game_id');
      if (table === 'team_rosters') {
        return exactResponse(rosterRows.filter((row) => (
          requestedSeasons.length === 0 || requestedSeasons.includes(row.season_id)
        )));
      }
      if (table === 'games') {
        const teamFilter = url.searchParams.get('or') || '';
        const requestedGameTeams = new Set(
          [...teamFilter.matchAll(/(?:home|away)_team_id\.eq\.([0-9a-f-]+)/g)].map((match) => match[1]),
        );
        return exactResponse(games.filter((game) => (
          (requestedSeasons.length === 0 || requestedSeasons.includes(game.season_id))
          && (requestedGameTeams.has(game.home_team_id) || requestedGameTeams.has(game.away_team_id))
        )));
      }
      if ((table === 'player_stats' || table === 'goalie_stats') && hasGameScope && !hasPlayerScope) {
        const lastGame = games.at(-1)!;
        return exactResponse(table === 'player_stats' && requestedGames.includes(lastGame.id)
          ? [{ id: 'v5-last-evidence', game_id: lastGame.id, team_id: lastGame.home_team_id, season_id: lastGame.season_id }]
          : []);
      }
      if (table === 'game_checkins' || table === 'player_availability'
        || table === 'player_stats' || table === 'goalie_stats') {
        expect(requestedTeams.length).toBeGreaterThan(0);
        return exactResponse([]);
      }
      throw new Error(`unexpected table ${table}`);
    };
    const serializedClient = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: serializedFetch },
    });

    await expect(getFallbackRosterAppearanceRows(serializedClient as never, {
      seasonIds,
      playerIds: [PROFILE_ID],
      strict: true,
    })).resolves.toMatchObject([{
      player_id: PROFILE_ID,
      team_id: games.at(-1)?.home_team_id,
      game_id: games.at(-1)?.id,
    }]);

    const requiredSources = [
      'team_rosters', 'games', 'game_checkins', 'player_availability',
      'core player_stats', 'core goalie_stats', 'optional player_stats', 'optional goalie_stats',
    ];
    expect([...new Set(requests.map((request) => request.source))].sort())
      .toEqual([...requiredSources].sort());
    const maxTargetBySource = Object.fromEntries(requiredSources.map((source) => [
      source,
      Math.max(...requests.filter((request) => request.source === source).map((request) => request.targetBytes)),
    ]));
    const requestCountBySource = Object.fromEntries(requiredSources.map((source) => [
      source,
      requests.filter((request) => request.source === source).length,
    ]));
    const oversizedSources = Object.entries(maxTargetBySource)
      .filter(([, targetBytes]) => targetBytes > 8192);
    const requestMetrics = { maxTargetBySource, requestCountBySource, maxActiveReads, oversizedSources };
    expect(requestMetrics).toEqual({ ...requestMetrics, oversizedSources: [] });
    expect(maxActiveReads).toBeLessThanOrEqual(4);

    const coveredValues = (source: string, column: string) => requests
      .filter((request) => request.source === source)
      .flatMap((request) => requestedValues(request.url, column));
    expect(new Set(coveredValues('team_rosters', 'season_id'))).toEqual(new Set(seasonIds));
    expect(requests.filter((request) => request.source === 'team_rosters')).toHaveLength(1);
    expect(requests.find((request) => request.source === 'team_rosters')?.url.searchParams.get('season_id'))
      .toMatch(/^in\.\(/);
    for (const source of ['game_checkins', 'player_availability', 'core player_stats', 'core goalie_stats']) {
      const coveredTeams = coveredValues(source, 'team_id');
      expect(new Set(coveredTeams)).toEqual(new Set(teamIds));
    }
    const coveredCheckinGames = coveredValues('game_checkins', 'game_id');
    expect(coveredCheckinGames).toHaveLength(gameIds.length);
    expect(new Set(coveredCheckinGames)).toEqual(new Set(gameIds));
    expect(coveredCheckinGames.filter((gameId) => gameId === gameIds[0])).toHaveLength(1);
    expect(coveredCheckinGames.filter((gameId) => gameId === gameIds.at(-1))).toHaveLength(1);
    for (const source of ['player_availability', 'core player_stats', 'core goalie_stats']) {
      const sourceRequests = requests.filter((request) => request.source === source);
      expect(sourceRequests.every((request) => request.url.searchParams.get('season_id')?.startsWith('eq.'))).toBe(true);
      expect(new Set(coveredValues(source, 'season_id'))).toEqual(new Set(seasonIds));
      const coveredGames = coveredValues(source, 'game_id');
      expect(coveredGames).toHaveLength(gameIds.length);
      expect(new Set(coveredGames)).toEqual(new Set(gameIds));
    }
    const gameTeamCoverage = requests
      .filter((request) => request.source === 'games')
      .flatMap((request) => [...(request.url.searchParams.get('or') || '')
        .matchAll(/(?:home|away)_team_id\.eq\.([0-9a-f-]+)/g)].map((match) => match[1]));
    expect(new Set(gameTeamCoverage)).toEqual(new Set(teamIds));
    for (const source of ['optional player_stats', 'optional goalie_stats']) {
      const coveredGames = coveredValues(source, 'game_id');
      expect(coveredGames).toHaveLength(gameIds.length);
      expect(new Set(coveredGames)).toEqual(new Set(gameIds));
      expect(coveredGames.filter((gameId) => gameId === gameIds[0])).toHaveLength(1);
      expect(coveredGames.filter((gameId) => gameId === gameIds.at(-1))).toHaveLength(1);
    }
  });

  it('[v10 URL rail] admits cross-season core packs by the exact installed serializer target and preserves exact membership', async () => {
    const seasonIds = Array.from({ length: 7 }, (_, index) => (
      `11000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const teamIds = Array.from({ length: 60 }, (_, index) => (
      `22000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const gameIds = Array.from({ length: 60 }, (_, index) => (
      `game-${String(index).padStart(3, '0')}-${'x'.repeat(210)}`
    ));
    const rosterRows = teamIds.map((teamId, index) => ({
      player_id: PROFILE_ID,
      team_id: teamId,
      season_id: seasonIds[index % seasonIds.length],
      start_date: '2026-01-01',
      end_date: null,
      status: 'active',
      player_type: 'regular',
    }));
    const games = gameIds.map((id, index) => ({
      id,
      season_id: seasonIds[index % seasonIds.length],
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: teamIds[index],
      away_team_id: null,
      home_score: 2,
      away_score: 1,
    }));
    const canonicalGameById = new Map(games.map((game) => [game.id, game]));
    const parseInFilter = (value: string | null) => {
      if (!value?.startsWith('in.(') || !value.endsWith(')')) return [];
      return value.slice(4, -1).split(',').filter(Boolean);
    };
    const requestedValues = (url: URL, column: string) => {
      const value = url.searchParams.get(column);
      if (!value) return [];
      if (value.startsWith('eq.')) return [value.slice(3)];
      return parseInFilter(value);
    };
    const exactResponse = (rows: Array<Record<string, unknown>>) => new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range': rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : '*/0',
      },
    });
    type CoreRequest = {
      source: string;
      targetBytes: number;
      gameIds: string[];
      teamIds: string[];
      seasonIds: string[];
      playerIds: string[];
      status: string | null;
      select: string | null;
      order: string | null;
      offset: string | null;
      limit: string | null;
      prefersExactCount: boolean;
    };
    const coreRequests: CoreRequest[] = [];
    const serializedFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const table = url.pathname.split('/').pop() || '';
      const requestedSeasons = requestedValues(url, 'season_id');
      const requestedTeams = requestedValues(url, 'team_id');
      const requestedGames = requestedValues(url, 'game_id');
      if (table === 'team_rosters') {
        return exactResponse(rosterRows.filter((row) => requestedSeasons.includes(row.season_id)));
      }
      if (table === 'games') {
        const seasonId = requestedSeasons[0];
        const teamFilter = url.searchParams.get('or') || '';
        const requestedGameTeams = new Set(
          [...teamFilter.matchAll(/(?:home|away)_team_id\.eq\.([0-9a-f-]+)/g)].map((match) => match[1]),
        );
        return exactResponse(games.filter((game) => (
          game.season_id === seasonId && requestedGameTeams.has(game.home_team_id)
        )));
      }
      if (['game_checkins', 'player_availability', 'player_stats', 'goalie_stats'].includes(table)) {
        const source = table;
        const headers = new Headers(init?.headers);
        coreRequests.push({
          source,
          targetBytes: Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8'),
          gameIds: requestedGames,
          teamIds: requestedTeams,
          seasonIds: requestedSeasons,
          playerIds: requestedValues(url, 'player_id'),
          status: url.searchParams.get('status'),
          select: url.searchParams.get('select'),
          order: url.searchParams.get('order'),
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit'),
          prefersExactCount: headers.get('prefer')?.includes('count=exact') === true,
        });
        return exactResponse([]);
      }
      throw new Error(`unexpected table ${table}`);
    };
    const serializedClient = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: serializedFetch },
    });

    await expect(getFallbackRosterAppearanceRows(serializedClient as never, {
      seasonIds,
      playerIds: [PROFILE_ID],
      strict: true,
    })).resolves.toHaveLength(games.length);

    expect(new Set(coreRequests.map((request) => request.source)))
      .toEqual(new Set(['game_checkins', 'player_availability', 'player_stats', 'goalie_stats']));
    expect(coreRequests.every((request) => request.targetBytes <= 8192)).toBe(true);
    expect(coreRequests.every((request) => request.select && request.order
      && request.offset === '0' && request.limit === '1000' && request.prefersExactCount)).toBe(true);
    const membershipBySource = new Map<string, string[]>();
    for (const source of ['game_checkins', 'player_availability', 'player_stats', 'goalie_stats']) {
      const requests = coreRequests.filter((request) => request.source === source);
      const coveredGameIds = requests.flatMap((request) => request.gameIds);
      expect(coveredGameIds).toHaveLength(gameIds.length);
      expect(new Set(coveredGameIds)).toEqual(new Set(gameIds));
      expect(new Set(requests.flatMap((request) => request.playerIds))).toEqual(new Set([PROFILE_ID]));
      expect(requests.every((request) => (
        new Set(request.teamIds).size === request.teamIds.length
        && new Set(request.gameIds).size === request.gameIds.length
        && request.gameIds.every((gameId) => canonicalGameById.has(gameId))
        && new Set(request.teamIds).size === new Set(request.gameIds.map(
          (gameId) => canonicalGameById.get(gameId)!.home_team_id,
        )).size
        && request.teamIds.every((teamId) => request.gameIds.some(
          (gameId) => canonicalGameById.get(gameId)!.home_team_id === teamId,
        ))
      ))).toBe(true);
      if (source === 'game_checkins') {
        expect(requests.every((request) => request.seasonIds.length === 0 && request.status === 'eq.out')).toBe(true);
      } else {
        expect(requests.every((request) => (
          new Set(request.seasonIds).size === new Set(request.gameIds.map(
            (gameId) => canonicalGameById.get(gameId)!.season_id,
          )).size
          && request.seasonIds.every((seasonId) => request.gameIds.some(
            (gameId) => canonicalGameById.get(gameId)!.season_id === seasonId,
          ))
        ))).toBe(true);
        expect(requests.every((request) => (
          source === 'player_availability' ? request.status === 'eq.out' : request.status === null
        ))).toBe(true);
      }
      membershipBySource.set(source, requests.map((request) => request.gameIds.join('|')).sort());
    }
    expect(membershipBySource.get('player_availability')).toEqual(membershipBySource.get('game_checkins'));
    expect(membershipBySource.get('player_stats')).toEqual(membershipBySource.get('game_checkins'));
    expect(membershipBySource.get('goalie_stats')).toEqual(membershipBySource.get('game_checkins'));
  });

  it('[v5 batching rail] merges identical games returned by different team batches without double counting', async () => {
    const teamIds = Array.from({ length: 51 }, (_, index) => `batch-team-${index}`);
    const gameId = 'cross-batch-game';
    const fixture = strictFallbackScorelessClient({
      rosterRows: teamIds.map((teamId) => ({
        player_id: PROFILE_ID, team_id: teamId, season_id: SEASON_ID, joined_at: null, end_date: null,
      })),
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: teamIds[49],
        away_team_id: teamIds[50],
        home_score: 2,
        away_score: 1,
      }],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([
      { game_id: gameId, team_id: teamIds[49] },
      { game_id: gameId, team_id: teamIds[50] },
    ]);
    expect(fixture.traces.filter((trace) => trace.table === 'games')).toHaveLength(2);
  });

  it('[v5 batching rail] fails closed for conflicting duplicate games returned by different team batches', async () => {
    const teamIds = Array.from({ length: 51 }, (_, index) => `conflict-team-${index}`);
    const gameId = 'conflicting-cross-batch-game';
    const fixture = strictFallbackScorelessClient({
      rosterRows: teamIds.map((teamId) => ({
        player_id: PROFILE_ID, team_id: teamId, season_id: SEASON_ID, joined_at: null, end_date: null,
      })),
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: teamIds[49],
        away_team_id: teamIds[50],
        home_score: 2,
        away_score: 1,
      }],
      conflictingDuplicateGameId: gameId,
      conflictingDuplicateAwayTeamId: teamIds[50],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('fallback games validation');
  });

  it('[v5 exact-scope rail] excludes legitimate historical check-ins outside returned requested games', async () => {
    const gameId = 'requested-current-game';
    const fixture = strictFallbackScorelessClient({
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: null,
        home_score: 1,
        away_score: 0,
      }],
      outCheckinRows: [{
        id: 'legitimate-historical-out',
        game_id: 'historical-game-outside-requested-seasons',
        team_id: TEAM_ID,
        player_id: PROFILE_ID,
      }],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ game_id: gameId, team_id: TEAM_ID }]);
    const checkinRead = fixture.traces.find((trace) => trace.table === 'game_checkins');
    expect(checkinRead?.filters).toContainEqual(['in', 'game_id', [gameId]]);
  });

  it.each([
    ['later provider error', { coreErrorTable: 'goalie_stats' as const }, 'fallback goalie signals batch 1'],
    ['exact-count drift', { coreCountMismatchTable: 'player_stats' as const }, 'fallback skater signals batch 1 completeness'],
  ])('[v5 batching rail] consumes every scheduled core read before selecting a deterministic %s failure', async (_label, failure, expected) => {
    const teamIds = Array.from({ length: 101 }, (_, index) => `core-team-${index}`);
    const fixture = strictFallbackScorelessClient({
      rosterRows: teamIds.map((teamId) => ({
        player_id: PROFILE_ID, team_id: teamId, season_id: SEASON_ID, joined_at: null, end_date: null,
      })),
      gameRows: teamIds.map((teamId, index) => ({
        id: `core-game-${index}`,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: teamId,
        away_team_id: null,
        home_score: 1,
        away_score: 0,
      })),
      ...failure,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow(expected);
    const evidenceReads = fixture.traces.filter((trace) => (
      trace.table === 'game_checkins' || trace.table === 'player_availability'
      || trace.table === 'player_stats' || trace.table === 'goalie_stats'
    ));
    expect(evidenceReads).toHaveLength(12);
    expect(evidenceReads.every((trace) => trace.reads === 1)).toBe(true);
  });

  it('[v10 later-page URL rail] admits packs against the largest paged target and consumes deterministic later failures', async () => {
    const seasonIds = [SEASON_ID, OTHER_SEASON_ID];
    const baseGameIds = Array.from({ length: 101 }, (_, index) => (
      `edge-game-${String(index).padStart(3, '0')}-${'x'.repeat(20)}`
    ));
    type SerializerProbeQuery = {
      eq(column: string, value: unknown): SerializerProbeQuery;
      in(column: string, values: unknown[]): SerializerProbeQuery;
      order(column: string, options: { ascending: boolean }): SerializerProbeQuery;
      range(from: number, to: number): SerializerProbeQuery;
      url: URL;
    };
    const targetLengths = (gameIds: string[], from: number) => {
      const scope = { seasonIds, gameIds, teamIds: [TEAM_ID] };
      return ([
        ['game_checkins', 'id, game_id, team_id, player_id', false, true],
        ['player_availability', 'id, game_id, team_id, player_id, season_id', true, true],
        ['player_stats', 'id, game_id, team_id, player_id, season_id', true, false],
        ['goalie_stats', 'id, game_id, team_id, player_id, season_id', true, false],
      ] as const).map(([table, selection, seasonScoped, statusOut]) => {
        let query = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }).from(table).select(selection, { count: 'exact' }) as unknown as SerializerProbeQuery;
        if (!seasonScoped) query = query.eq('status', 'out');
        if (seasonScoped) query = query.in('season_id', scope.seasonIds);
        query = query.in('game_id', scope.gameIds).in('team_id', scope.teamIds);
        if (seasonScoped && statusOut) query = query.eq('status', 'out');
        query = query.in('player_id', [PROFILE_ID])
          .order('game_id', { ascending: true })
          .order('team_id', { ascending: true });
        if (!seasonScoped) query = query.order('player_id', { ascending: true });
        query = query.order('id', { ascending: true }).range(from, from + 999);
        return Buffer.byteLength(`${query.url.pathname}${query.url.search}`, 'utf8');
      });
    };
    const secondPackIndexes = [100, ...Array.from({ length: 49 }, (_, index) => index * 2 + 1)];
    const secondPackGameIds = () => secondPackIndexes.map((index) => baseGameIds[index]);
    const initialMax = Math.max(...targetLengths(secondPackGameIds(), 0));
    expect(initialMax).toBeLessThan(8190);
    baseGameIds[97] += 'z'.repeat(8190 - initialMax);
    expect(Math.max(...targetLengths(secondPackGameIds(), 0))).toBe(8190);
    expect(Math.max(...targetLengths(secondPackGameIds(), 1000))).toBeGreaterThan(8192);

    const games = baseGameIds.map((id, index) => ({
      id,
      season_id: seasonIds[index % seasonIds.length],
      scheduled_at: index % 2 === 0 ? '2026-09-01' : '2026-03-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: null,
      home_score: 2,
      away_score: 1,
    }));
    const finalGame = games[97];
    const coreRequests: Array<{
      source: string;
      gameIds: string[];
      offset: number;
      targetBytes: number;
    }> = [];
    let activeFetches = 0;
    let maxActiveFetches = 0;
    let startedFetches = 0;
    let settledFetches = 0;
    const parseFilter = (url: URL, column: string) => {
      const value = url.searchParams.get(column);
      if (!value) return [];
      if (value.startsWith('eq.')) return [value.slice(3)];
      return value.startsWith('in.(') && value.endsWith(')')
        ? value.slice(4, -1).split(',').filter(Boolean)
        : [];
    };
    const rangedResponse = (rows: Array<Record<string, unknown>>, from = 0) => {
      const page = rows.slice(from, from + 1000);
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Range': rows.length === 0 ? '*/0' : `${from}-${from + page.length - 1}/${rows.length}`,
        },
      });
    };
    const providerError = () => new Response(JSON.stringify({
      code: 'PGRST500', message: 'adversarial packed read failed', details: null, hint: null,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    const pageRows = (source: string) => Array.from({ length: 1001 }, (_, index) => ({
      id: `${source}-edge-row-${index}`,
      game_id: finalGame.id,
      team_id: TEAM_ID,
      player_id: PROFILE_ID,
      ...(source === 'game_checkins' ? {} : { season_id: finalGame.season_id }),
    }));
    const serializedFetch: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const table = url.pathname.split('/').pop() || '';
      const requestedSeasons = parseFilter(url, 'season_id');
      if (table === 'team_rosters') {
        return rangedResponse(seasonIds.filter((seasonId) => requestedSeasons.includes(seasonId)).map((seasonId) => ({
          player_id: PROFILE_ID, team_id: TEAM_ID, season_id: seasonId,
          start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
        })));
      }
      if (table === 'games') {
        return rangedResponse(games.filter((game) => requestedSeasons.includes(game.season_id)));
      }
      if (!['game_checkins', 'player_availability', 'player_stats', 'goalie_stats'].includes(table)) {
        throw new Error(`unexpected table ${table}`);
      }
      const requestedGames = parseFilter(url, 'game_id');
      const offset = Number(url.searchParams.get('offset') || 0);
      coreRequests.push({
        source: table,
        gameIds: requestedGames,
        offset,
        targetBytes: Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8'),
      });
      startedFetches += 1;
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeFetches -= 1;
      settledFetches += 1;
      const targetsFinalPack = requestedGames.includes(finalGame.id);
      if (table === 'player_stats' && targetsFinalPack && offset === 1000) return providerError();
      if (table === 'goalie_stats' && !targetsFinalPack && offset === 0) return providerError();
      return rangedResponse(targetsFinalPack ? pageRows(table) : [], offset);
    };
    const serializedClient = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: serializedFetch },
    });

    await expect(getFallbackRosterAppearanceRows(serializedClient as never, {
      seasonIds,
      playerIds: [PROFILE_ID],
      strict: true,
    })).rejects.toThrow(/fallback skater signals batch [23] page 1000/);

    expect(coreRequests.filter((request) => request.offset === 0)).toHaveLength(12);
    expect(new Set(coreRequests.map((request) => request.source)))
      .toEqual(new Set(['game_checkins', 'player_availability', 'player_stats', 'goalie_stats']));
    expect(coreRequests.some((request) => request.offset === 1000)).toBe(true);
    expect(coreRequests.every((request) => request.targetBytes <= 8192)).toBe(true);
    expect(startedFetches).toBe(coreRequests.length);
    expect(settledFetches).toBe(startedFetches);
    expect(activeFetches).toBe(0);
    expect(maxActiveFetches).toBeLessThanOrEqual(4);
  });

  it('[v10 later-pack count rail] consumes all packed reads and chooses the earliest scheduled count failure', async () => {
    const teamIds = Array.from({ length: 51 }, (_, index) => `v10-count-team-${index}`);
    const gameIds = teamIds.map((_, index) => `v10-count-game-${index}`);
    const fixture = strictFallbackScorelessClient({
      rosterRows: teamIds.map((teamId) => ({
        player_id: PROFILE_ID, team_id: teamId, season_id: SEASON_ID,
        start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
      })),
      gameRows: teamIds.map((teamId, index) => ({
        id: gameIds[index], season_id: SEASON_ID, scheduled_at: '2026-09-01', status: 'completed',
        home_team_id: teamId, away_team_id: null, home_score: 2, away_score: 1,
      })),
      coreCountMismatchTable: 'player_stats',
      coreCountMismatchGameId: gameIds.at(-1),
      coreErrorTable: 'goalie_stats',
      coreErrorGameId: gameIds[0],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID,
      playerIds: [PROFILE_ID],
      strict: true,
    })).rejects.toThrow('fallback skater signals batch 2 completeness');
    const coreReads = fixture.traces.filter((trace) => (
      trace.table === 'game_checkins' || trace.table === 'player_availability'
      || trace.table === 'player_stats' || trace.table === 'goalie_stats'
    ) && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id'));
    expect(coreReads).toHaveLength(8);
    expect(coreReads.every((trace) => trace.reads === 1)).toBe(true);
  });

  it.each([
    ['default strict caller', undefined, 4],
    ['existing strict concurrency override', 2, 2],
  ] as const)('[v10 caller preservation] keeps packed %s evidence on its inherited concurrency', async (
    _label,
    strictBatchConcurrency,
    expectedMaxCoreEvidence,
  ) => {
    const fixture = strictTimelineProductionClient({
      appearanceGameCount: 20,
      trackAppearanceConcurrency: true,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonIds: [SEASON_ID, OTHER_SEASON_ID],
      playerIds: [PROFILE_ID],
      strict: true,
      ...(strictBatchConcurrency === undefined ? {} : { strictBatchConcurrency }),
    })).resolves.toHaveLength(20);

    expect(fixture.appearance.startedCoreEvidence).toBe(4);
    expect(fixture.appearance.settledCoreEvidence).toBe(4);
    expect(fixture.appearance.maxCoreEvidenceActive).toBe(expectedMaxCoreEvidence);
    expect(fixture.appearance.activeCoreEvidence).toBe(0);
  });

  it('[v10 caller preservation] leaves the non-strict fallback query projection and fan-out unchanged', async () => {
    const traces: Array<{
      table: string;
      selection: string;
      selectOptions: unknown;
      filters: Array<[string, string, unknown]>;
      ranged: boolean;
    }> = [];
    const client = { from: jest.fn((table: string) => {
      const trace = { table, selection: '', selectOptions: undefined as unknown, filters: [] as Array<[string, string, unknown]>, ranged: false };
      traces.push(trace);
      const query: Record<string, unknown> = {};
      query.select = jest.fn((selection: string, selectOptions: unknown) => {
        trace.selection = selection;
        trace.selectOptions = selectOptions;
        return query;
      });
      for (const method of ['eq', 'in', 'or', 'order']) {
        query[method] = jest.fn((column: string, value: unknown) => {
          trace.filters.push([method, column, value]);
          return query;
        });
      }
      query.range = jest.fn(() => {
        trace.ranged = true;
        return Promise.resolve({ data: [], error: null, count: 0 });
      });
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
        table === 'team_rosters'
          ? {
              data: [{
                player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID,
                joined_at: null, end_date: null,
              }],
              error: null,
              count: null,
            }
          : { data: [], error: null, count: null },
      ).then(resolve);
      return query;
    }) };

    await getFallbackRosterAppearanceRows(client as never, {
      seasonId: SEASON_ID,
      playerIds: [PROFILE_ID],
    });

    expect(traces.map((trace) => [trace.table, trace.selection, trace.selectOptions])).toEqual([
      ['team_rosters', 'player_id, team_id, season_id, joined_at, end_date', undefined],
      ['game_checkins', 'game_id, team_id, player_id', undefined],
      ['player_availability', 'game_id, team_id, player_id, season_id', undefined],
      ['player_stats', 'game_id, team_id, season_id', undefined],
      ['goalie_stats', 'game_id, team_id, season_id', undefined],
      ['games', 'id, season_id, scheduled_at, status, home_team_id, away_team_id, home_score, away_score', undefined],
    ]);
    expect(traces.every((trace) => !trace.ranged)).toBe(true);
    expect(traces.slice(1).every((trace) => !trace.filters.some(
      ([method, column]) => method === 'in' && (column === 'game_id' || column === 'player_id'),
    ))).toBe(true);
  });

  it.each(([
    'game_checkins',
    'player_availability',
    'core player_stats',
    'core goalie_stats',
    'optional player_stats',
    'optional goalie_stats',
  ] as const).flatMap((source) => (
    (source === 'game_checkins'
      ? ['allowed-but-wrong game pair', 'wrong participating team', 'foreign game', 'duplicate id']
      : ['allowed-but-wrong season/game pair', 'wrong participating team', 'foreign game', 'duplicate id', 'malformed season']
    ).map((mutation) => [source, mutation] as const)
  )))('[v5 composite rail] rejects %s evidence with %s', async (source, mutation) => {
    const secondTeamId = '40000000-0000-4000-8000-000000000004';
    const firstGameId = '50000000-0000-4000-8000-000000000001';
    const secondGameId = '50000000-0000-4000-8000-000000000002';
    const foreignGameId = '50000000-0000-4000-8000-000000000003';
    const rosterRows = [
      { player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID, joined_at: null, end_date: null },
      { player_id: PROFILE_ID, team_id: secondTeamId, season_id: OTHER_SEASON_ID, joined_at: null, end_date: null },
    ];
    const gameRows = [
      {
        id: firstGameId, season_id: SEASON_ID, scheduled_at: '2026-09-01', status: 'completed',
        home_team_id: TEAM_ID, away_team_id: null, home_score: null, away_score: null,
      },
      {
        id: secondGameId, season_id: OTHER_SEASON_ID, scheduled_at: '2026-03-01', status: 'completed',
        home_team_id: secondTeamId, away_team_id: null, home_score: null, away_score: null,
      },
    ];
    const optionalSource = source.startsWith('optional');
    const checkinSource = source === 'game_checkins';
    const baseRow: Record<string, unknown> = {
      id: 'evidence-id',
      game_id: firstGameId,
      team_id: TEAM_ID,
      ...(checkinSource || source === 'player_availability' ? { player_id: PROFILE_ID } : {}),
      ...(checkinSource ? {} : { season_id: SEASON_ID }),
    };
    if (mutation.includes('allowed-but-wrong')) {
      if (checkinSource) {
        baseRow.game_id = secondGameId;
      } else {
        baseRow.season_id = OTHER_SEASON_ID;
      }
    } else if (mutation === 'wrong participating team') {
      baseRow.team_id = secondTeamId;
    } else if (mutation === 'foreign game') {
      baseRow.game_id = foreignGameId;
    } else if (mutation === 'malformed season') {
      baseRow.season_id = null;
    }
    const evidenceRows = mutation === 'duplicate id'
      ? [baseRow, { ...baseRow }]
      : [baseRow];
    const fixture = strictFallbackScorelessClient({
      rosterRows,
      gameRows,
      outCheckinRows: source === 'game_checkins' ? evidenceRows : [],
      outAvailabilityRows: source === 'player_availability' ? evidenceRows : [],
      scopedSkaterRows: source === 'core player_stats' ? evidenceRows : [],
      scopedGoalieRows: source === 'core goalie_stats' ? evidenceRows : [],
      gameLevelSkaterRows: source === 'optional player_stats' ? evidenceRows : [],
      gameLevelGoalieRows: source === 'optional goalie_stats' ? evidenceRows : [],
      returnOutOfScopeOptionalRows: mutation === 'foreign game',
      returnOutOfScopeCoreRows: !optionalSource && mutation === 'foreign game',
      returnOutOfScopeCheckinRows: source === 'game_checkins',
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonIds: [SEASON_ID, OTHER_SEASON_ID],
      playerIds: [PROFILE_ID],
      strict: true,
    })).rejects.toThrow(/validation|provider row|evidence/);
    if (optionalSource) {
      expect(fixture.optionalProviderReads().some((trace) => (
        trace.table === source.replace('optional ', '')
      ))).toBe(true);
    }
  });

  it.each([
    ['game_checkins', 'outCheckinRows'],
    ['player_availability', 'outAvailabilityRows'],
    ['player_stats', 'scopedSkaterRows'],
    ['goalie_stats', 'scopedGoalieRows'],
  ] as const)('[v10 packed composite rail] rejects a valid %s row returned for the wrong exact-game pack', async (table, fixtureField) => {
    const secondTeamId = '43000000-0000-4000-8000-000000000043';
    const games = Array.from({ length: 51 }, (_, index) => {
      const secondSeason = index % 2 === 1;
      return {
        id: `packed-composite-game-${String(index).padStart(3, '0')}`,
        season_id: secondSeason ? OTHER_SEASON_ID : SEASON_ID,
        scheduled_at: secondSeason ? '2026-03-01' : '2026-09-01',
        status: 'completed',
        home_team_id: secondSeason ? secondTeamId : TEAM_ID,
        away_team_id: null,
        home_score: 2,
        away_score: 1,
      };
    });
    const attackedGame = games.at(-1)!;
    const attackRow = {
      id: `wrong-pack-${table}`,
      game_id: attackedGame.id,
      team_id: attackedGame.home_team_id,
      player_id: PROFILE_ID,
      ...(table === 'game_checkins' ? {} : { season_id: attackedGame.season_id }),
    };
    const fixture = strictFallbackScorelessClient({
      rosterRows: [
        {
          player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID,
          start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
        },
        {
          player_id: PROFILE_ID, team_id: secondTeamId, season_id: OTHER_SEASON_ID,
          start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
        },
      ],
      gameRows: games,
      [fixtureField]: [attackRow],
      returnCoreRowsForWrongPackOnly: table,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonIds: [SEASON_ID, OTHER_SEASON_ID],
      playerIds: [PROFILE_ID],
      strict: true,
    })).rejects.toThrow(/validation|evidence/);
    const attackedRequests = fixture.traces.filter((trace) => trace.table === table
      && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id'));
    expect(attackedRequests).toHaveLength(2);
    expect(attackedRequests.some((trace) => {
      const requestedGames = trace.filters.find(
        ([method, column]) => method === 'in' && column === 'game_id',
      )?.[2] as string[];
      return !requestedGames.includes(attackedGame.id);
    })).toBe(true);
  });

  it('[v5 composite rail] accepts distinct stable IDs carrying the same legitimate canonical signal', async () => {
    const gameId = 'legitimate-distinct-signal-game';
    const fixture = strictFallbackScorelessClient({
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: null,
        home_score: null,
        away_score: null,
      }],
      scopedSkaterRows: [
        { id: 'distinct-signal-a', game_id: gameId, team_id: TEAM_ID, season_id: SEASON_ID },
        { id: 'distinct-signal-b', game_id: gameId, team_id: TEAM_ID, season_id: SEASON_ID },
      ],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ game_id: gameId, team_id: TEAM_ID }]);
  });

  it.each([
    ['regular', 'score', 1],
    ['regular', 'direct-stat', 1],
    ['regular', 'explicit-out', 0],
    ['sub', 'score', 0],
    ['sub', 'direct-stat', 1],
    ['sub', 'explicit-out', 0],
    ['part_time', 'score', 0],
    ['part_time', 'direct-stat', 1],
    ['part_time', 'explicit-out', 0],
    ['mystery', 'score', 0],
    ['mystery', 'direct-stat', 0],
    ['mystery', 'explicit-out', 0],
    [null, 'score', 0],
    [null, 'direct-stat', 0],
    [null, 'explicit-out', 0],
  ] as const)('[v6 roster-type rail] gives %s roster rows %s evidence the exact attendance result', async (playerType, evidence, expectedCount) => {
    const gameId = `roster-type-${playerType ?? 'null'}-${evidence}`;
    const hasDirectStat = evidence === 'direct-stat' || evidence === 'explicit-out';
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        season_id: SEASON_ID,
        start_date: '2026-01-01',
        end_date: null,
        status: 'active',
        player_type: playerType,
      }],
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01T20:00:00Z',
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: null,
        home_score: evidence === 'score' ? 3 : null,
        away_score: evidence === 'score' ? 2 : null,
      }],
      scopedSkaterRows: hasDirectStat ? [{
        id: `direct-${gameId}`,
        game_id: gameId,
        team_id: TEAM_ID,
        player_id: PROFILE_ID,
        season_id: SEASON_ID,
      }] : [],
      outAvailabilityRows: evidence === 'explicit-out' ? [{
        id: `out-${gameId}`,
        game_id: gameId,
        team_id: TEAM_ID,
        player_id: PROFILE_ID,
        season_id: SEASON_ID,
      }] : [],
    });

    const appearances = await getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    });

    expect(appearances).toHaveLength(expectedCount);
    expect(fixture.traces.find((trace) => trace.table === 'team_rosters')?.selection)
      .toContain('status, player_type');
    const coreSkaterRead = fixture.traces.find((trace) => trace.table === 'player_stats'
      && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id'));
    if (playerType === 'regular' || playerType === 'sub' || playerType === 'part_time') {
      expect(coreSkaterRead?.selection).toContain('player_id');
    } else {
      expect(coreSkaterRead).toBeUndefined();
    }
  });

  it.each([
    ['inactive'],
    ['mystery'],
    [null],
    [undefined],
  ] as const)('[v6 roster-type rail] locally denies a permissively returned %s roster status', async (status) => {
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        season_id: SEASON_ID,
        start_date: '2026-01-01',
        end_date: null,
        status,
        player_type: 'regular',
      }],
      gameRows: [{
        id: 'permissive-status-game', season_id: SEASON_ID,
        scheduled_at: '2026-09-01T20:00:00Z', status: 'completed',
        home_team_id: TEAM_ID, away_team_id: null, home_score: 3, away_score: 2,
      }],
    });

    const rows = await getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    });
    expect(rows).toHaveLength(0);
  });

  it('[v6 roster-type rail] does not cross-credit one substitute player direct stats to another player', async () => {
    const otherPlayerId = '60000000-0000-4000-8000-000000000006';
    const gameId = 'multi-player-direct-stat';
    const fixture = strictFallbackScorelessClient({
      rosterRows: [PROFILE_ID, otherPlayerId].map((playerId) => ({
        player_id: playerId,
        team_id: TEAM_ID,
        season_id: SEASON_ID,
        start_date: '2026-01-01',
        end_date: null,
        status: 'active',
        player_type: 'sub',
      })),
      gameRows: [{
        id: gameId, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z',
        status: 'completed', home_team_id: TEAM_ID, away_team_id: null,
        home_score: 3, away_score: 2,
      }],
      scopedGoalieRows: [{
        id: 'only-first-player-stat', game_id: gameId, team_id: TEAM_ID,
        player_id: PROFILE_ID, season_id: SEASON_ID,
      }],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID, otherPlayerId], strict: true,
    })).resolves.toMatchObject([{ player_id: PROFILE_ID, game_id: gameId }]);
  });

  it.each([
    ['same-day inclusive start and end', '2026-09-01', '2026-09-01', '2026-09-01T20:00:00Z', 1],
    ['before start', '2026-09-02', null, '2026-09-01T20:00:00Z', 0],
    ['after end', '2026-08-01', '2026-08-31', '2026-09-01T20:00:00Z', 0],
    ['Toronto date at a UTC-day boundary', '2026-09-01', '2026-09-01', '2026-09-02T02:00:00Z', 1],
    ['missing start', null, null, '2026-09-01T20:00:00Z', 0],
    ['malformed start text', 'not-a-date', null, '2026-09-01T20:00:00Z', 0],
    ['impossible start date', '2026-02-30', null, '2026-09-01T20:00:00Z', 0],
    ['malformed end text', '2026-01-01', 'not-a-date', '2026-09-01T20:00:00Z', 0],
    ['impossible end date', '2026-01-01', '2026-02-30', '2026-02-15T20:00:00Z', 0],
  ] as const)('[v6 roster-window rail] applies canonical league-date semantics for %s', async (_label, startDate, endDate, scheduledAt, expectedCount) => {
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        season_id: SEASON_ID,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        player_type: 'regular',
      }],
      gameRows: [{
        id: 'canonical-roster-window-game', season_id: SEASON_ID,
        scheduled_at: scheduledAt, status: 'completed',
        home_team_id: TEAM_ID, away_team_id: null, home_score: 3, away_score: 2,
      }],
    });

    const appearances = await getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    });

    expect(appearances).toHaveLength(expectedCount);
    const rosterSelection = fixture.traces.find((trace) => trace.table === 'team_rosters')?.selection;
    expect(rosterSelection).toContain('start_date');
    expect(rosterSelection).not.toContain('joined_at');
  });

  it.each([
    ['player_availability', 'outAvailabilityRows'],
    ['player_stats', 'scopedSkaterRows'],
    ['goalie_stats', 'scopedGoalieRows'],
  ] as const)('[v6 exact-evidence-scope rail] excludes a legitimate future %s row at the provider boundary', async (table, fixtureField) => {
    const currentGameId = `current-${table}`;
    const futureRow = {
      id: `future-${table}`,
      game_id: `future-game-${table}`,
      team_id: TEAM_ID,
      player_id: PROFILE_ID,
      season_id: SEASON_ID,
    };
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID,
        start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
      }],
      gameRows: [{
        id: currentGameId, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z',
        status: 'completed', home_team_id: TEAM_ID, away_team_id: null,
        home_score: 3, away_score: 2,
      }],
      [fixtureField]: [futureRow],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ player_id: PROFILE_ID, game_id: currentGameId }]);

    const coreRead = fixture.traces.find((trace) => trace.table === table
      && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id'));
    expect(coreRead?.filters).toEqual(expect.arrayContaining([
      ['in', 'game_id', [currentGameId]],
      ['eq', 'season_id', SEASON_ID],
      ['in', 'team_id', [TEAM_ID]],
      ['in', 'player_id', [PROFILE_ID]],
    ]));
  });

  it.each([
    ['player_availability', 'outAvailabilityRows'],
    ['player_stats', 'scopedSkaterRows'],
    ['goalie_stats', 'scopedGoalieRows'],
  ] as const)('[v6 exact-evidence-scope rail] still fails closed when a permissive %s provider returns a foreign row', async (table, fixtureField) => {
    const currentGameId = `permissive-current-${table}`;
    const fixture = strictFallbackScorelessClient({
      gameRows: [{
        id: currentGameId, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z',
        status: 'completed', home_team_id: TEAM_ID, away_team_id: null,
        home_score: 3, away_score: 2,
      }],
      [fixtureField]: [{
        id: `permissive-foreign-${table}`,
        game_id: `foreign-game-${table}`,
        team_id: TEAM_ID,
        player_id: PROFILE_ID,
        season_id: SEASON_ID,
      }],
      returnOutOfScopeCoreRows: true,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow(/validation|evidence/);
    const coreRead = fixture.traces.find((trace) => trace.table === table
      && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id'));
    expect(coreRead?.filters).toContainEqual(['in', 'game_id', [currentGameId]]);
  });

  it('serializes 1,000 scoreless game signals into exact URL-safe batches under one shared concurrency cap', async () => {
    const gameIds = Array.from({ length: 1000 }, (_, index) => (
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ));
    const games = gameIds.map((id) => ({
      id,
      season_id: SEASON_ID,
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: 'other-team',
      home_score: null,
      away_score: null,
    }));
    const optionalRequests: Array<{ table: string; targetBytes: number; gameIds: string[] }> = [];
    let optionalInFlight = 0;
    let maxOptionalInFlight = 0;
    const parseInFilter = (value: string | null) => {
      if (!value?.startsWith('in.(') || !value.endsWith(')')) throw new Error('invalid serialized in filter');
      return value.slice(4, -1).split(',').filter(Boolean);
    };
    const exactResponse = (rows: Array<Record<string, unknown>>) => new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range': rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : '*/0',
      },
    });
    const serializedFetch: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const table = url.pathname.split('/').pop() || '';
      const gameIdFilter = url.searchParams.get('game_id');
      const hasPlayerScope = Boolean(url.searchParams.get('player_id'));
      if ((table === 'player_stats' || table === 'goalie_stats') && gameIdFilter && !hasPlayerScope) {
        const requestedGameIds = parseInFilter(gameIdFilter);
        optionalRequests.push({
          table,
          targetBytes: Buffer.byteLength(`${url.pathname}${url.search}`, 'utf8'),
          gameIds: requestedGameIds,
        });
        optionalInFlight += 1;
        maxOptionalInFlight = Math.max(maxOptionalInFlight, optionalInFlight);
        await new Promise<void>((resolve) => setImmediate(resolve));
        optionalInFlight -= 1;
        return exactResponse(table === 'player_stats' && requestedGameIds.includes(gameIds.at(-1)!)
          ? [{ id: 'teammate-last', game_id: gameIds.at(-1), team_id: TEAM_ID, season_id: SEASON_ID }]
          : []);
      }
      if (table === 'team_rosters') {
        return exactResponse([{
          player_id: PROFILE_ID,
          team_id: TEAM_ID,
          season_id: SEASON_ID,
          start_date: '2026-01-01',
          end_date: null,
          status: 'active',
          player_type: 'regular',
        }]);
      }
      if (table === 'games') return exactResponse(games);
      return exactResponse([]);
    };
    const serializedClient = createSupabaseClient('https://project.supabase.co', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: serializedFetch },
    });

    await expect(getFallbackRosterAppearanceRows(serializedClient as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: gameIds.at(-1) }]);

    expect(maxOptionalInFlight).toBeLessThanOrEqual(4);
    for (const table of ['player_stats', 'goalie_stats']) {
      const requests = optionalRequests.filter((request) => request.table === table);
      expect(Math.max(...requests.map((request) => request.targetBytes))).toBeLessThanOrEqual(8192);
      expect(requests.length).toBeGreaterThan(1);
      expect(Math.max(...requests.map((request) => request.gameIds.length))).toBeLessThanOrEqual(100);
      const serializedIds = requests.flatMap((request) => request.gameIds);
      expect(serializedIds).toHaveLength(gameIds.length);
      expect(new Set(serializedIds).size).toBe(gameIds.length);
      expect([...serializedIds].sort()).toEqual([...gameIds].sort());
      expect(serializedIds.filter((id) => id === gameIds[0])).toHaveLength(1);
      expect(serializedIds.filter((id) => id === gameIds.at(-1))).toHaveLength(1);
    }
  });

  it('batches each optional scoreless-signal helper source while preserving exact teammate evidence', async () => {
    const games = Array.from({ length: 101 }, (_, index) => ({
      id: `scoreless-${index}`,
      season_id: SEASON_ID,
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: 'other-team',
      home_score: null,
      away_score: null,
    }));
    const fixture = strictFallbackScorelessClient({
      gameRows: games,
      gameLevelSkaterRows: [{
        id: 'teammate-last', game_id: 'scoreless-100', team_id: TEAM_ID, season_id: SEASON_ID,
      }],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'scoreless-100' }]);

    const optionalReads = fixture.optionalProviderReads();
    for (const table of ['player_stats', 'goalie_stats']) {
      const sourceReads = optionalReads.filter((trace) => trace.table === table);
      expect(sourceReads.length).toBeGreaterThan(1);
      expect(sourceReads.every((trace) => trace.reads === 1)).toBe(true);
      const serializedGameIds = sourceReads.flatMap((trace) => (
        trace.filters.find(([method, column]) => method === 'in' && column === 'game_id')?.[2] as string[]
      ));
      expect(Math.max(...sourceReads.map((trace) => (
        trace.filters.find(([method, column]) => method === 'in' && column === 'game_id')?.[2] as string[]
      ).length))).toBeLessThanOrEqual(100);
      expect(serializedGameIds).toEqual(games.map((game) => game.id));
    }
  });

  it('fails closed on a later optional provider batch error after consuming every scheduled read', async () => {
    const games = Array.from({ length: 101 }, (_, index) => ({
      id: `scoreless-error-${index}`,
      season_id: SEASON_ID,
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: 'other-team',
      home_score: null,
      away_score: null,
    }));
    const fixture = strictFallbackScorelessClient({
      gameRows: games,
      optionalErrorTable: 'goalie_stats',
      optionalErrorGameId: games.at(-1)?.id,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('fallback game goalie signals');
    expect(fixture.optionalProviderReads().every((trace) => trace.reads === 1)).toBe(true);
  });

  it('fails closed on a later optional provider batch exact-count mismatch', async () => {
    const games = Array.from({ length: 101 }, (_, index) => ({
      id: `scoreless-count-${index}`,
      season_id: SEASON_ID,
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: 'other-team',
      home_score: null,
      away_score: null,
    }));
    const fixture = strictFallbackScorelessClient({
      gameRows: games,
      optionalCountMismatchTable: 'player_stats',
      optionalCountMismatchGameId: games.at(-1)?.id,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('fallback game skater signals completeness');
    expect(fixture.optionalProviderReads().every((trace) => trace.reads === 1)).toBe(true);
  });

  it('fully pages an optional provider batch and fails closed on a later page error', async () => {
    const gameId = 'scoreless-page-error';
    const fixture = strictFallbackScorelessClient({
      gameRows: [{
        id: gameId,
        season_id: SEASON_ID,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: 'other-team',
        home_score: null,
        away_score: null,
      }],
      gameLevelSkaterRows: Array.from({ length: 1001 }, (_, index) => ({
        id: `page-row-${index}`, game_id: gameId, team_id: TEAM_ID, season_id: SEASON_ID,
      })),
      optionalPageErrorTable: 'player_stats',
      optionalPageErrorGameId: gameId,
      optionalPageErrorOffset: 1000,
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('fallback game skater signals batch 1 page 1000');
    const skaterPageReads = fixture.optionalProviderReads().filter((trace) => trace.table === 'player_stats');
    expect(skaterPageReads).toHaveLength(2);
    expect(skaterPageReads.every((trace) => trace.reads === 1)).toBe(true);
  });

  it('bounds near-cap roster/game derived work by composite season and team while preserving exact output', async () => {
    let derivedFieldAccesses = 0;
    const rosterRows = Array.from({ length: 1000 }, (_, index) => {
      const row: Record<string, unknown> = {
        player_id: PROFILE_ID,
        joined_at: null,
        end_date: null,
      };
      Object.defineProperties(row, {
        season_id: { enumerable: true, get: () => { derivedFieldAccesses += 1; return SEASON_ID; } },
        team_id: { enumerable: true, get: () => { derivedFieldAccesses += 1; return `team-${index}`; } },
      });
      return row;
    });
    const gameRows = Array.from({ length: 1000 }, (_, index) => {
      const row: Record<string, unknown> = {
        id: `near-cap-game-${index}`,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_score: 1,
        away_score: 0,
      };
      Object.defineProperties(row, {
        season_id: { enumerable: true, get: () => { derivedFieldAccesses += 1; return SEASON_ID; } },
        home_team_id: { enumerable: true, get: () => { derivedFieldAccesses += 1; return `team-${index}`; } },
        away_team_id: { enumerable: true, get: () => { derivedFieldAccesses += 1; return null; } },
      });
      return row;
    });
    const fixture = strictFallbackScorelessClient({ rosterRows, gameRows });

    const appearances = await getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    });
    const productionDerivedFieldAccesses = derivedFieldAccesses;

    expect(appearances).toHaveLength(1000);
    expect(appearances.map((row) => row.game_id)).toEqual(gameRows.map((row) => row.id));
    expect(productionDerivedFieldAccesses).toBeLessThanOrEqual(
      (rosterRows.length + gameRows.length) * 12 + appearances.length * 4,
    );
  });

  it.each(([
    ['team_rosters', OTHER_SEASON_ID],
    ['team_rosters', null],
    ['games', OTHER_SEASON_ID],
    ['games', null],
    ['player_availability', OTHER_SEASON_ID],
    ['player_availability', null],
    ['player_stats', OTHER_SEASON_ID],
    ['player_stats', null],
    ['goalie_stats', OTHER_SEASON_ID],
    ['goalie_stats', null],
  ] as const))('fails closed for returned %s rows with an out-of-request or malformed %s season', async (source, returnedSeasonId) => {
    const rosterRows = [{
      player_id: PROFILE_ID,
      team_id: TEAM_ID,
      season_id: source === 'team_rosters' ? returnedSeasonId : SEASON_ID,
      joined_at: null,
      end_date: null,
    }];
    const gameRows = [{
      id: 'season-validation-game',
      season_id: source === 'games' ? returnedSeasonId : SEASON_ID,
      scheduled_at: '2026-09-01',
      status: 'completed',
      home_team_id: TEAM_ID,
      away_team_id: 'other-team',
      home_score: 1,
      away_score: 0,
    }];
    const seasonBearingSignal = {
      game_id: 'season-validation-game',
      team_id: TEAM_ID,
      player_id: PROFILE_ID,
      season_id: returnedSeasonId,
    };
    const fixture = strictFallbackScorelessClient({
      rosterRows,
      gameRows,
      outAvailabilityRows: source === 'player_availability' ? [seasonBearingSignal] : [],
      scopedSkaterRows: source === 'player_stats' ? [seasonBearingSignal] : [],
      scopedGoalieRows: source === 'goalie_stats' ? [seasonBearingSignal] : [],
      returnOutOfScopeGameRows: source === 'games',
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).rejects.toThrow('fallback returned season validation');
  });

  it('accepts exact requested opaque text season IDs without UUID-shape validation', async () => {
    const opaqueSeasonId = 'legacy:season/text-v3';
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        season_id: opaqueSeasonId,
        joined_at: null,
        end_date: null,
      }],
      gameRows: [{
        id: 'opaque-season-game',
        season_id: opaqueSeasonId,
        scheduled_at: '2026-09-01',
        status: 'completed',
        home_team_id: TEAM_ID,
        away_team_id: null,
        home_score: 1,
        away_score: 0,
      }],
    });

    await expect(getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonId: opaqueSeasonId, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ game_id: 'opaque-season-game' }]);
    expect(fixture.traces.find((trace) => trace.table === 'team_rosters')?.filters)
      .toContainEqual(['eq', 'season_id', opaqueSeasonId]);
  });

  it('keeps batched fallback roster and game rows paired by identical season identity', async () => {
    const fixture = strictFallbackScorelessClient({
      rosterRows: [{
        player_id: PROFILE_ID,
        team_id: TEAM_ID,
        season_id: SEASON_ID,
        joined_at: null,
        end_date: null,
      }],
      gameRows: [
        { id: 'season-a-game', season_id: SEASON_ID, scheduled_at: '2026-09-01', status: 'completed', home_team_id: TEAM_ID, away_team_id: null, home_score: 2, away_score: 1 },
        { id: 'season-b-game', season_id: OTHER_SEASON_ID, scheduled_at: '2026-03-01', status: 'completed', home_team_id: TEAM_ID, away_team_id: null, home_score: 3, away_score: 2 },
      ],
    });

    const appearances = await getFallbackRosterAppearanceRows(fixture.client as never, {
      seasonIds: [SEASON_ID, OTHER_SEASON_ID, SEASON_ID],
      playerIds: [PROFILE_ID],
      strict: true,
    });

    expect(appearances).toHaveLength(1);
    expect(appearances[0]).toMatchObject({ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'season-a-game' });
    const pairedGame = Array.isArray(appearances[0].game) ? appearances[0].game[0] : appearances[0].game;
    expect(pairedGame?.season_id).toBe(SEASON_ID);
    expect(fixture.traces.find((trace) => trace.table === 'team_rosters')?.filters)
      .toContainEqual(['in', 'season_id', [SEASON_ID, OTHER_SEASON_ID]]);
    expect(fixture.traces.filter((trace) => trace.table === 'games')).toHaveLength(1);
  });

  it('propagates a later fallback-source query error after the roster query succeeds', async () => {
    const results: Record<string, { data: unknown[] | null; error: unknown; count: number | null }> = {
      team_rosters: { data: [{
        player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID,
        start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
      }], error: null, count: 1 },
      games: { data: [{
        id: 'later-source-error-game', season_id: SEASON_ID, scheduled_at: '2026-09-01', status: 'completed',
        home_team_id: TEAM_ID, away_team_id: null, home_score: 1, away_score: 0,
      }], error: null, count: 1 },
      game_checkins: { data: [], error: null, count: 0 },
      player_availability: { data: null, error: { code: 'PGRST500', message: 'later query failed' }, count: null },
      player_stats: { data: [], error: null, count: 0 },
      goalie_stats: { data: [], error: null, count: 0 },
    };
    const client = { from: jest.fn((table: string) => queryResult(results[table])) };
    await expect(getFallbackRosterAppearanceRows(client as never, { seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true }))
      .rejects.toThrow('fallback out availability');
  });

  it('scopes fallback signals to the player while retaining bounded scoreless teammate evidence', async () => {
    const traces: Array<{ table: string; filters: Array<[string, string, unknown]>; select?: unknown[] }> = [];
    const client = { from: jest.fn((table: string) => {
      const trace = { table, filters: [] as Array<[string, string, unknown]>, select: undefined as unknown[] | undefined };
      traces.push(trace);
      const query: Record<string, unknown> = {};
      query.select = jest.fn((...args: unknown[]) => { trace.select = args; return query; });
      for (const method of ['eq', 'in', 'or', 'order', 'range']) {
        query[method] = jest.fn((column: string, value: unknown) => {
          trace.filters.push([method, column, value]);
          return query;
        });
      }
      query.then = (resolve: (value: unknown) => unknown) => {
        const hasFilter = (method: string, column: string) => trace.filters.some(([candidate, field]) => candidate === method && field === column);
        let data: unknown[] = [];
        if (table === 'team_rosters') {
          data = [{
            player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID,
            start_date: '2026-01-01', end_date: null, status: 'active', player_type: 'regular',
          }];
        } else if (table === 'games') {
          data = [{ id: 'scoreless-game', season_id: SEASON_ID, scheduled_at: '2026-09-01', status: 'completed', home_team_id: TEAM_ID, away_team_id: 'other-team', home_score: null, away_score: null }];
        } else if (table === 'player_stats' && hasFilter('in', 'game_id') && !hasFilter('in', 'player_id')) {
          data = [{ id: 'teammate-stat', game_id: 'scoreless-game', team_id: TEAM_ID, season_id: SEASON_ID }];
        }
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
      };
      return query;
    }) };

    await expect(getFallbackRosterAppearanceRows(client as never, {
      seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true,
    })).resolves.toMatchObject([{ player_id: PROFILE_ID, game_id: 'scoreless-game' }]);

    for (const table of ['game_checkins', 'player_availability', 'player_stats', 'goalie_stats']) {
      expect(traces.some((trace) => trace.table === table
        && trace.filters.some(([method, column, value]) => method === 'in' && column === 'player_id'
          && (value as string[]).includes(PROFILE_ID)))).toBe(true);
    }
    for (const table of ['player_stats', 'goalie_stats']) {
      const gameScoped = traces.filter((trace) => trace.table === table
        && trace.filters.some(([method, column]) => method === 'in' && column === 'game_id'));
      expect(gameScoped).toHaveLength(2);
      expect(gameScoped.every((trace) => trace.select?.[1] && (trace.select[1] as { count?: unknown }).count === 'exact')).toBe(true);
      const coreScoped = gameScoped.filter((trace) => trace.filters.some(
        ([method, column]) => method === 'in' && column === 'player_id',
      ));
      const optionalScoped = gameScoped.filter((trace) => !trace.filters.some(
        ([method, column]) => method === 'in' && column === 'player_id',
      ));
      expect(coreScoped).toHaveLength(1);
      expect(optionalScoped).toHaveLength(1);
      for (const trace of gameScoped) {
        const gameIds = trace.filters.find(([method, column]) => method === 'in' && column === 'game_id')?.[2] as string[];
        expect(gameIds).toHaveLength(1);
        expect(gameIds.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it.each([
    ['matchups', () => getPlayerGoalieMatchups(PROFILE_ID, SEASON_ID, { leagueId: HOCKEY_LIFE_ID, strict: true })],
    ['badges', () => getPlayerBadges(PROFILE_ID, { leagueId: HOCKEY_LIFE_ID, strict: true })],
    ['season catalog', () => getSeasons(HOCKEY_LIFE_ID, { strict: true })],
  ])('fails closed for capped strict %s DTO reads', async (_label, read) => {
    mockedCreateClient.mockResolvedValue({ from: jest.fn(() => queryResult({ data: [{}], error: null, count: 1001 })) } as never);
    await expect(read()).rejects.toThrow('completeness');
  });

  it('fails closed when a later ordered team-game page errors', async () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
    query.range = jest.fn((from: number) => Promise.resolve(from === 0
      ? { data: Array.from({ length: 1000 }, (_, index) => ({ id: `game-${index}`, season_id: SEASON_ID, home_team_id: TEAM_ID, away_team_id: null })), error: null, count: 1001 }
      : { data: null, error: { code: 'PGRST500', message: 'later page failed' }, count: 1001 }));
    const client = { from: jest.fn(() => query) };
    await expect(loadTeamGameCountsBySeasonTeam(client as never, HOCKEY_LIFE_ID, [SEASON_ID], [TEAM_ID], { strict: true }))
      .rejects.toThrow('career timeline team games page');
    expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('excludes only explicitly marked aggregate carriers from a complete strict denominator', async () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
    query.range = jest.fn(() => Promise.resolve({ data: [
      { id: 'real', season_id: SEASON_ID, home_team_id: TEAM_ID, away_team_id: null, location: 'Arena' },
      { id: 'carrier', season_id: SEASON_ID, home_team_id: TEAM_ID, away_team_id: null, location: '[aggregate-only] historical aggregate stats carrier' },
    ], error: null, count: 2 }));
    const counts = await loadTeamGameCountsBySeasonTeam({ from: jest.fn(() => query) } as never, HOCKEY_LIFE_ID, [SEASON_ID], [TEAM_ID], { strict: true });
    expect(counts.get(`${SEASON_ID}:${TEAM_ID}`)).toBe(1);
  });
});

describe('strict goalie career provenance', () => {
  const historicalSeasonId = 'e813368a-6389-4678-b596-294e70e89a9a';
  const baseline = {
    league_id: HOCKEY_LIFE_ID, player_id: '751c2f47-f0e8-4506-b10e-b39a7bbcd302',
    source_system: 'hockeylifehl_legacy_players', source_batch_id: 'legacy_players_current',
    games_played: 311, wins: 140, ties: 28, saves: 0, goals_against: 1324, shutouts: 7,
    save_percentage: 0, goals_against_average: 4.26,
  };
  const carrier = {
    id: '6cd8f793-089d-49a5-aea1-c3abd53fc932', game_id: '2ae5be6f-10df-4d52-8ffd-82fc4521f87a',
    season_id: historicalSeasonId, team_id: null, saves: 0, shots_against: 1324,
    goals_against: 1324, game_result: 'W', shutout: true, provenance: null,
  };
  const genuine = { ...carrier, id: 'genuine', game_id: 'game', season_id: SEASON_ID, goals_against: 2, shots_against: 20, saves: 18 };

  it('supports baseline-only and rejects a raw-only historical aggregate carrier', () => {
    expect(classifyStrictGoalieCareerSources([], baseline, historicalSeasonId)).toHaveLength(0);
    expect(() => classifyStrictGoalieCareerSources([carrier], null, historicalSeasonId)).toThrow('goalie career provenance');
    expect(classifyStrictGoalieCareerSources([genuine], null, historicalSeasonId)).toEqual([genuine]);
  });

  it.each([null, carrier.game_id])('removes a proven historical carrier whether game_id is %s', (gameId) => {
    expect(classifyStrictGoalieCareerSources([{ ...carrier, game_id: gameId }, genuine], baseline, historicalSeasonId)).toEqual([genuine]);
  });

  it('fails closed on unresolved overlap while preserving genuine seasons and teams', () => {
    expect(() => classifyStrictGoalieCareerSources([{ ...carrier, goals_against: 99 }, genuine], baseline, historicalSeasonId))
      .toThrow('goalie career provenance');
  });

  it('keeps imported missing saves/SV unknown but retains a confirmed zero', () => {
    const baseRow = {
      season_id: historicalSeasonId, season_name: 'Historical Career Baseline (Pre-BLH)', sort_date: '2025-01-01',
      team_id: null, team_name: null, position: 'Goalie', games_played: 311, team_games: 311, attendance_pct: 100,
      goals: 0, assists: 0, points: 0, goals_per_game: 0, points_per_game: 0, wins: 140, losses: 143, ties: 28,
      saves: 0, goals_against: 1324, save_percentage: null, goals_against_average: 4.26, shutouts: 7,
    } as PlayerCareerSeasonRow;
    const unknown = summarizePlayerCareerTotalsFromTimeline(PROFILE_ID, [{ ...baseRow, saves_known: false }], true)!;
    const knownZero = summarizePlayerCareerTotalsFromTimeline(PROFILE_ID, [{ ...baseRow, saves_known: true }], true)!;
    expect(unknown.saves).toBeUndefined();
    expect(unknown.save_percentage).toBeUndefined();
    expect(knownZero.saves).toBe(0);
    expect(knownZero.save_percentage).toBe(0);
  });
});

describe('strict mobile hot-fact comparisons', () => {
  it('aggregates team rows within one season before comparison', async () => {
    const row = {
      season_id: SEASON_ID, season_name: 'Native season', sort_date: '2026-01-01', team_id: TEAM_ID,
      team_name: 'A', position: 'Goalie', games_played: 1, team_games: 1, attendance_pct: 100,
      goals: 0, assists: 0, points: 0, goals_per_game: 0, points_per_game: 0,
      wins: 1, losses: 0, ties: 0, saves: 18, saves_known: true, goals_against: 2,
      save_percentage: 90, goals_against_average: 2, shutouts: 0,
    } as PlayerCareerSeasonRow;
    const facts = await generatePlayerCareerHotFacts({
      playerName: 'Fixture', seasons: [row, { ...row, team_id: 'team-b', team_name: 'B', games_played: 4, team_games: 4, wins: 4, saves: 72, goals_against: 8 }],
      careerTotalsSeasons: [row], isGoalie: true, distinctSeasonComparisons: true,
    });
    expect(facts.join(' ')).not.toContain('year-over-year');
    expect(facts.join(' ')).not.toContain('than Native season');
  });
});

describe('strict skater career provenance', () => {
  const historicalSeasonId = 'e813368a-6389-4678-b596-294e70e89a9a';
  const baseline = {
    league_id: HOCKEY_LIFE_ID, player_id: PROFILE_ID,
    source_system: 'hockeylifehl_legacy_players', source_batch_id: 'legacy_players_current',
    games_played: 72, goals: 105, assists: 45, points: 150,
  };
  const carrier = { season_id: historicalSeasonId, team_id: TEAM_ID, team_name: 'Legacy', position: 'C', games_played: 1, goals: 105, assists: 45, points: 150 };

  it('replaces a proven one-appearance carrier with the authoritative imported baseline', () => {
    expect(classifyStrictSkaterCareerSources([carrier], baseline, historicalSeasonId)[0]).toMatchObject({ games_played: 72, goals: 105, assists: 45, points: 150 });
  });

  it('supports baseline-only and raw-only sources and fails closed on an unresolved overlap', () => {
    expect(classifyStrictSkaterCareerSources([], baseline, historicalSeasonId)).toHaveLength(1);
    expect(classifyStrictSkaterCareerSources([carrier], null, historicalSeasonId)).toEqual([carrier]);
    expect(() => classifyStrictSkaterCareerSources([{ ...carrier, points: 149 }], baseline, historicalSeasonId)).toThrow('skater career provenance');
  });
});

function selectedStatsProductionClient(seasonSummary: Record<string, unknown> | null) {
  return { from: jest.fn((table: string) => {
    let selection = '';
    const query: Record<string, unknown> = {};
    query.select = jest.fn((columns: string) => { selection = columns; return query; });
    for (const method of ['eq', 'in', 'or', 'order', 'limit']) query[method] = jest.fn(() => query);
    const result = () => {
      if (table === 'seasons') return { data: { name: 'Fall 2026' }, error: null, count: null };
      if (table === 'player_season_stats') return { data: seasonSummary, error: null, count: null };
      if (table === 'player_stats') return {
        data: [{ game_id: 'selected-game', goals: 3, assists: 2, penalty_minutes: 4 }], error: null, count: 1,
      };
      if (table === 'game_checkins') return { data: [], error: null, count: 0 };
      if (table === 'team_rosters' && selection.includes('start_date')) return { data: [], error: null, count: 0 };
      if (table === 'team_rosters') return {
        data: { position: 'C', team: { name: 'Bad Bunny' } }, error: null, count: null,
      };
      if (table === 'goalie_stats') return {
        data: [{ game_id: 'selected-game', team_id: TEAM_ID, saves: 99, shots_against: 100, goals_against: 1, shutout: false, game_result: 'W' }],
        error: null,
        count: 1,
      };
      return { data: [], error: null, count: 0 };
    };
    query.range = jest.fn(() => Promise.resolve(result()));
    query.maybeSingle = jest.fn(() => Promise.resolve(result()));
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return query;
  }) };
}

describe('selected-season production aggregator preservation', () => {
  it('keeps nonzero player_stats metrics when no player_season_stats timeline row exists', async () => {
    const client = selectedStatsProductionClient(null);
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    await expect(getPlayerCareerStats(PROFILE_ID, SEASON_ID, {
      leagueId: HOCKEY_LIFE_ID, isGoalie: false, strict: true,
    })).resolves.toMatchObject({
      games_played: 1, goals: 3, assists: 2, points: 5, penalty_minutes: 4,
      team_name: 'Bad Bunny', position: 'C',
    });
  });

  it('uses the selected season role even when the current profile role is goalie', async () => {
    const client = selectedStatsProductionClient({
      games_played: 1, goals: 3, assists: 2, points: 5, team_name: 'Bad Bunny', position: 'C',
    });
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    const result = await getPlayerCareerStats(PROFILE_ID, SEASON_ID, {
      leagueId: HOCKEY_LIFE_ID, isGoalie: true, strict: true,
    });
    expect(result).toMatchObject({ goals: 3, assists: 2, points: 5, position: 'C' });
    expect(result?.saves).toBeUndefined();
    expect(result?.wins).toBeUndefined();
  });
});

describe('strict career appearance query scoping', () => {
  it('[v10 pressure rail] packs two-season core evidence and serializes only the profile evidence phase', async () => {
    const selectedFixture = strictTimelineProductionClient({ trackAppearanceConcurrency: true });
    mockedCreateClient.mockResolvedValue(selectedFixture.client as never);
    mockedCreateServiceRoleClient.mockReturnValue(selectedFixture.client as never);

    const selected = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      strict: true,
      profileSafeStrictAppearanceHydration: true,
    });
    const selectedCoreEvidence = selectedFixture.traces.filter((trace) => (
      trace.table === 'game_checkins'
        ? trace.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'out')
        : ['player_availability', 'player_stats', 'goalie_stats'].includes(trace.table)
          && trace.selection === 'id, game_id, team_id, player_id, season_id'
          && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')
    ));

    expect({
      timelineRequests: selectedFixture.traces.length,
      coreEvidenceRequests: selectedCoreEvidence.length,
      coreEvidenceMaxActive: selectedFixture.appearance.maxCoreEvidenceActive,
      coreEvidenceStarted: selectedFixture.appearance.startedCoreEvidence,
      coreEvidenceSettled: selectedFixture.appearance.settledCoreEvidence,
      activeAtReturn: selectedFixture.appearance.active,
    }).toEqual({
      timelineRequests: 15,
      coreEvidenceRequests: 4,
      coreEvidenceMaxActive: 1,
      coreEvidenceStarted: 4,
      coreEvidenceSettled: 4,
      activeAtReturn: 0,
    });

    const aggregateFixture = strictTimelineProductionClient({ trackAppearanceConcurrency: true });
    mockedCreateClient.mockResolvedValue(aggregateFixture.client as never);
    mockedCreateServiceRoleClient.mockReturnValue(aggregateFixture.client as never);
    const timelines = await Promise.all(Array.from({ length: 3 }, () => (
      getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
        strict: true,
        profileSafeStrictAppearanceHydration: true,
      })
    )));
    const aggregateCoreEvidence = aggregateFixture.traces.filter((trace) => (
      trace.table === 'game_checkins'
        ? trace.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'out')
        : ['player_availability', 'player_stats', 'goalie_stats'].includes(trace.table)
          && trace.selection === 'id, game_id, team_id, player_id, season_id'
          && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')
    ));

    expect(timelines).toEqual([selected, selected, selected]);
    expect({
      timelineRequests: aggregateFixture.traces.length,
      coreEvidenceRequests: aggregateCoreEvidence.length,
      coreEvidenceMaxActive: aggregateFixture.appearance.maxCoreEvidenceActive,
      coreEvidenceStarted: aggregateFixture.appearance.startedCoreEvidence,
      coreEvidenceSettled: aggregateFixture.appearance.settledCoreEvidence,
      activeAtReturn: aggregateFixture.appearance.active,
    }).toEqual({
      timelineRequests: 45,
      coreEvidenceRequests: 12,
      coreEvidenceMaxActive: 3,
      coreEvidenceStarted: 12,
      coreEvidenceSettled: 12,
      activeAtReturn: 0,
    });
  });

  it('[v11 profile-safe timeline] serializes profile scoreless optional evidence with unchanged requests and full settlement', async () => {
    const { client, appearance } = strictTimelineProductionClient({
      appearanceGameCount: 2,
      trackAppearanceConcurrency: true,
      scorelessAppearanceGames: true,
    });
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      strict: true,
      profileSafeStrictAppearanceHydration: true,
    } as Parameters<typeof getPlayerCareerStatsTimeline>[3] & { profileSafeStrictAppearanceHydration: boolean });

    expect({
      coreStarted: appearance.startedCoreEvidence,
      coreSettled: appearance.settledCoreEvidence,
      coreMaxActive: appearance.maxCoreEvidenceActive,
      optionalStarted: appearance.startedOptionalEvidence,
      optionalSettled: appearance.settledOptionalEvidence,
      optionalMaxActive: appearance.maxOptionalEvidenceActive,
      coreOptionalOverlap: appearance.coreOptionalOverlap,
      activeAtReturn: appearance.active,
    }).toEqual({
      coreStarted: 4,
      coreSettled: 4,
      coreMaxActive: 1,
      optionalStarted: 4,
      optionalSettled: 4,
      optionalMaxActive: 1,
      coreOptionalOverlap: false,
      activeAtReturn: 0,
    });
  });

  it('hydrates all active source seasons through one exact-scoped fallback read set', async () => {
    const { client, traces } = strictTimelineProductionClient();
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    const timeline = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, { strict: true });

    expect(timeline.map((row) => row.season_id)).toEqual([OTHER_SEASON_ID, SEASON_ID]);
    expect(timeline.map((row) => row.games_played)).toEqual([1, 1]);
    const directCheckinReads = traces.filter((trace) => trace.table === 'game_checkins'
      && trace.selection === 'player_id, team_id, game_id' && trace.ranged);
    expect(directCheckinReads).toHaveLength(1);
    const hydrationReads = traces.filter((trace) => trace.table === 'games'
      && trace.selection.includes('league_id, status'));
    expect(hydrationReads).toHaveLength(1);
    const fallbackReads = traces.filter((trace) => trace.table === 'team_rosters'
      && trace.selection.includes('start_date'));
    expect(fallbackReads).toHaveLength(1);
    const fallbackOutReads = traces.filter((trace) => trace.table === 'game_checkins'
      && trace.selection === 'id, game_id, team_id, player_id' && trace.ranged);
    expect(fallbackOutReads).toHaveLength(1);
    expect(new Set(fallbackOutReads.flatMap((trace) => (
      trace.filters.find(([method, column]) => method === 'in' && column === 'game_id')?.[2] as string[]
    )))).toEqual(new Set(['season-a-game', 'season-b-game']));
    for (const fallbackOutRead of fallbackOutReads) {
      expect(fallbackOutRead.selectOptions).toEqual({ count: 'exact' });
      expect(fallbackOutRead.filters).toEqual(expect.arrayContaining([
        ['eq', 'status', 'out'],
        ['in', 'player_id', [PROFILE_ID]],
      ]));
      expect(fallbackOutRead.filters.some(([, column]) => column === 'season_id')).toBe(false);
    }

    const fallbackGameReads = traces.filter((trace) => trace.table === 'games'
      && trace.selection.includes('scheduled_at, status'));
    expect(fallbackGameReads).toHaveLength(2);
    expect(new Set(fallbackGameReads.map((trace) => trace.filters
      .find(([method, column]) => method === 'eq' && column === 'season_id')?.[2])))
      .toEqual(new Set([SEASON_ID, OTHER_SEASON_ID]));
    const fallbackEvidenceReads = [
      ...traces.filter((trace) => trace.table === 'player_availability'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'),
      ...traces.filter((trace) => trace.table === 'player_stats'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'
        && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')),
      ...traces.filter((trace) => trace.table === 'goalie_stats'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'
        && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')),
    ];
    expect(fallbackEvidenceReads).toHaveLength(3);
    expect(fallbackEvidenceReads.every((trace) => (
      trace.filters.find(([method, column]) => method === 'in' && column === 'season_id')?.[2] as string[]
    )?.join('|') === [SEASON_ID, OTHER_SEASON_ID].join('|'))).toBe(true);
    for (const fallbackRead of [...fallbackReads, ...fallbackGameReads, ...fallbackEvidenceReads]) {
      expect(fallbackRead.selectOptions).toEqual({ count: 'exact' });
      expect(fallbackRead.ranged).toBe(true);
    }
  });

  it('[v11 profile-safe timeline] caps every appearance phase at one and never overlaps confirmed with fallback hydration', async () => {
    const { client, appearance } = strictTimelineProductionClient({
      appearanceGameCount: 201,
      trackAppearanceConcurrency: true,
    });
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    const timeline = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      strict: true,
      profileSafeStrictAppearanceHydration: true,
    } as Parameters<typeof getPlayerCareerStatsTimeline>[3] & { profileSafeStrictAppearanceHydration: boolean });

    expect(timeline.map((row) => row.season_id)).toEqual([OTHER_SEASON_ID, SEASON_ID]);
    expect(appearance.maxActive).toBe(1);
    expect(appearance.overlap).toBe(false);
    expect(appearance.started.confirmed).toBeGreaterThan(1);
    expect(appearance.started.fallback).toBeGreaterThan(2);
    expect(appearance.settled).toEqual(appearance.started);
    expect(appearance.active).toBe(0);
    expect(appearance.events.lastIndexOf('settle:confirmed'))
      .toBeLessThan(appearance.events.indexOf('start:fallback'));
  });

  it('[v13 profile-safe timeline] caps the production override at exactly two without changing the serial default', async () => {
    const defaultFixture = strictTimelineProductionClient({
      appearanceGameCount: 201,
      trackAppearanceConcurrency: true,
    });
    mockedCreateClient.mockResolvedValue(defaultFixture.client as never);
    mockedCreateServiceRoleClient.mockReturnValue(defaultFixture.client as never);
    const baseline = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      strict: true,
      profileSafeStrictAppearanceHydration: true,
    });

    const boundedFixture = strictTimelineProductionClient({
      appearanceGameCount: 201,
      trackAppearanceConcurrency: true,
    });
    mockedCreateClient.mockResolvedValue(boundedFixture.client as never);
    mockedCreateServiceRoleClient.mockReturnValue(boundedFixture.client as never);
    const bounded = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      strict: true,
      profileSafeStrictAppearanceHydration: true,
      profileSafeStrictAppearanceBatchConcurrency: 2,
    } as Parameters<typeof getPlayerCareerStatsTimeline>[3] & {
      profileSafeStrictAppearanceBatchConcurrency: number;
    });

    expect(bounded).toEqual(baseline);
    expect(defaultFixture.appearance.maxActive).toBe(1);
    expect(boundedFixture.appearance.maxActive).toBe(2);
    expect(boundedFixture.appearance.maxActive).not.toBe(4);
    expect(boundedFixture.appearance.overlap).toBe(false);
    expect(boundedFixture.appearance.settled).toEqual(boundedFixture.appearance.started);
    expect(boundedFixture.appearance.active).toBe(0);
  });

  it.each([
    ['skater', false, {
      team_id: TEAM_ID, team_name: 'Legacy', position: 'C', games_played: 72, team_games: 72,
      attendance_pct: 100, goals: 105, assists: 45, points: 150,
    }],
    ['goalie', true, {
      team_id: null, team_name: null, position: 'Goalie', games_played: 100, team_games: 100,
      attendance_pct: 100, wins: 60, losses: 30, ties: 10, saves: 1000, goals_against: 250,
      save_percentage: 80, goals_against_average: 2.5, shutouts: 5,
    }],
  ] as const)('keeps the authoritative %s baseline without baseline attendance fanout', async (_role, isGoalie, expectedBaseline) => {
    const { client, traces } = strictTimelineProductionClient({ includeHistoricalBaseline: true, isGoalie });
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    const timeline = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, isGoalie, {
      includeHistoricalBaseline: true,
      strict: true,
    });

    expect(timeline.find((row) => row.season_id === HISTORICAL_BASELINE_ID)).toMatchObject({
      season_id: HISTORICAL_BASELINE_ID,
      season_name: 'Historical Career Baseline - Imported',
      ...expectedBaseline,
    });
    const fallbackReads = traces.filter((trace) => trace.table === 'team_rosters'
      && trace.selection.includes('start_date'));
    expect(fallbackReads).toHaveLength(1);
    const fallbackGameReads = traces.filter((trace) => trace.table === 'games'
      && trace.selection.includes('scheduled_at, status'));
    expect(fallbackGameReads).toHaveLength(2);
    const fallbackEvidenceReads = [
      ...traces.filter((trace) => trace.table === 'player_availability'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'),
      ...traces.filter((trace) => trace.table === 'player_stats'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'
        && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')),
      ...traces.filter((trace) => trace.table === 'goalie_stats'
        && trace.selection === 'id, game_id, team_id, player_id, season_id'
        && trace.filters.some(([method, column]) => method === 'in' && column === 'player_id')),
    ];
    expect(fallbackEvidenceReads).toHaveLength(3);
    const exactSeasonIds = fallbackGameReads.map((trace) => trace.filters
      .find(([method, column]) => method === 'eq' && column === 'season_id')?.[2]);
    expect(new Set(exactSeasonIds)).toEqual(new Set([SEASON_ID, OTHER_SEASON_ID]));
    expect(fallbackEvidenceReads.every((trace) => (
      trace.filters.find(([method, column]) => method === 'in' && column === 'season_id')?.[2] as string[]
    )?.join('|') === [SEASON_ID, OTHER_SEASON_ID].join('|'))).toBe(true);
    expect(exactSeasonIds).not.toContain(HISTORICAL_BASELINE_ID);
    expect(fallbackReads[0].filters
      .find(([method, column]) => method === 'in' && column === 'season_id')?.[2])
      .toEqual([SEASON_ID, OTHER_SEASON_ID]);
    for (const fallbackRead of [...fallbackReads, ...fallbackGameReads, ...fallbackEvidenceReads]) {
      expect(fallbackRead.selectOptions).toEqual({ count: 'exact' });
      expect(fallbackRead.ranged).toBe(true);
    }

    const teamGameReads = traces.filter((trace) => trace.table === 'games'
      && trace.selection === 'id, season_id, home_team_id, away_team_id, location');
    expect(teamGameReads).toHaveLength(1);
    const hydratedSeasonIds = teamGameReads[0].filters
      .find(([method, column]) => method === 'in' && column === 'season_id')?.[2];
    expect(hydratedSeasonIds).toEqual([SEASON_ID, OTHER_SEASON_ID]);
    expect(hydratedSeasonIds).not.toContain(HISTORICAL_BASELINE_ID);
  });
});

describe('non-strict career appearance query preservation', () => {
  it('keeps more than 1000 career check-ins split into unchanged joined per-season reads', async () => {
    const traces: Array<{ table: string; selection: string; selectOptions: unknown; filters: Array<[string, string, unknown]>; ranged: boolean }> = [];
    const seasonRows = Array.from({ length: 1001 }, (_, index) => ({
      season_id: index < 501 ? SEASON_ID : OTHER_SEASON_ID,
      team_id: TEAM_ID,
      team_name: 'Bad Bunny',
      position: 'C',
      games_played: 1,
      goals: 1,
      assists: 0,
      points: 1,
    }));
    const client = { from: jest.fn((table: string) => {
      const trace = { table, selection: '', selectOptions: undefined as unknown, filters: [] as Array<[string, string, unknown]>, ranged: false };
      traces.push(trace);
      const query: Record<string, unknown> = {};
      query.select = jest.fn((selection: string, selectOptions: unknown) => {
        trace.selection = selection;
        trace.selectOptions = selectOptions;
        return query;
      });
      for (const method of ['eq', 'in', 'or', 'order', 'limit']) {
        query[method] = jest.fn((column: string, value: unknown) => {
          trace.filters.push([method, column, value]);
          return query;
        });
      }
      const result = () => {
        if (table === 'seasons') return { data: [
          { id: SEASON_ID, name: 'Fall 2026', start_date: '2026-09-01' },
          { id: OTHER_SEASON_ID, name: 'Spring 2026', start_date: '2026-03-01' },
        ], error: null, count: null };
        if (table === 'player_season_stats') return { data: seasonRows, error: null, count: null };
        if (table === 'game_checkins') {
          const seasonId = trace.filters.find(([method, column]) => method === 'eq' && column === 'game.season_id')?.[2];
          const length = seasonId === SEASON_ID ? 501 : 500;
          return { data: Array.from({ length }, (_, index) => ({
            player_id: PROFILE_ID, team_id: TEAM_ID, game_id: `${String(seasonId)}-${index}`,
            game: { id: `${String(seasonId)}-${index}`, season_id: seasonId },
          })), error: null, count: null };
        }
        if (table === 'team_rosters') return { data: [], error: null, count: null };
        if (table === 'teams') return { data: [{ id: TEAM_ID, name: 'Bad Bunny' }], error: null, count: null };
        if (table === 'profiles') return { data: null, error: null, count: null };
        return { data: [], error: null, count: null };
      };
      query.range = jest.fn(() => { trace.ranged = true; return Promise.resolve(result()); });
      query.maybeSingle = jest.fn(() => Promise.resolve(result()));
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
      return query;
    }) };
    mockedCreateClient.mockResolvedValue(client as never);
    mockedCreateServiceRoleClient.mockReturnValue(client as never);

    await expect(getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false)).resolves.toHaveLength(1001);
    const checkinReads = traces.filter((trace) => trace.table === 'game_checkins');
    expect(checkinReads).toHaveLength(2);
    expect(checkinReads.map((trace) => trace.filters.find(([method, column]) => method === 'eq' && column === 'game.season_id')?.[2]))
      .toEqual(expect.arrayContaining([SEASON_ID, OTHER_SEASON_ID]));
    expect(checkinReads.every((trace) => trace.selection.includes('game:games!inner')
      && trace.selectOptions === undefined && !trace.ranged)).toBe(true);
  });
});
