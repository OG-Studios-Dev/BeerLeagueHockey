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

describe('GET /api/mobile/player-profile', () => {
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

  it('[v7 bounded later phases] isolates game log from a four-read decorative provider phase', async () => {
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
    d.generateHotFacts.mockImplementation(async () => {
      starts.push('hotFacts');
      return [];
    });

    const pendingResponse = handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=${SEASON_ID}`), d);
    await new Promise((resolve) => setImmediate(resolve));
    const startsWhileGamesPending = [...starts];
    resolvers.get('games')!();
    await new Promise((resolve) => setImmediate(resolve));
    const startsAfterGames = [...starts];
    for (const name of ['badges', 'achievements', 'articles', 'matchups']) resolvers.get(name)!();
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(startsWhileGamesPending).toEqual(['games']);
    expect(startsAfterGames).toEqual(['games', 'badges', 'achievements', 'articles', 'matchups', 'hotFacts']);
    expect(maxProviderReads).toBe(4);
    expect(d.getStats).not.toHaveBeenCalled();
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
  conflictingDuplicateGameId?: string;
  conflictingDuplicateAwayTeamId?: string;
  coreErrorTable?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
  coreCountMismatchTable?: 'game_checkins' | 'player_availability' | 'player_stats' | 'goalie_stats';
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
      if (optionalSignalRead && options.optionalErrorTable === table
        && targetsOptionalGame(options.optionalErrorGameId)) {
        return { data: null, error: { code: '57014', message: 'optional signal read failed' }, count: null };
      }
      if (optionalSignalRead && options.optionalPageErrorTable === table
        && targetsOptionalGame(options.optionalPageErrorGameId) && options.optionalPageErrorOffset === from) {
        return { data: null, error: { code: 'PGRST500', message: 'optional later page failed' }, count: null };
      }
      if (coreEvidenceRead && options.coreErrorTable === table) {
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
          options.returnOutOfScopeCheckinRows || !gameIds || gameIds.includes(row.game_id as string)
        ));
      } else if (table === 'player_availability') {
        data = (options.outAvailabilityRows || []).filter((row) => (
          options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string)
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
          .filter((row) => options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string))
          .map((row) => ({ player_id: PROFILE_ID, ...row }));
      } else if (table === 'goalie_stats') {
        data = (options.scopedGoalieRows || [])
          .filter((row) => options.returnOutOfScopeCoreRows || !gameIds || gameIds.includes(row.game_id as string))
          .map((row) => ({ player_id: PROFILE_ID, ...row }));
      }
      const countMismatch = optionalSignalRead && options.optionalCountMismatchTable === table
        && targetsOptionalGame(options.optionalCountMismatchGameId);
      const coreCountMismatch = coreEvidenceRead && options.coreCountMismatchTable === table;
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
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
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
    ).then(resolve);
    gameQueries.push(query);
    return query;
  }) };
  return { client, checkinQuery, gameQueries };
}

function strictTimelineProductionClient(options: { includeHistoricalBaseline?: boolean; isGoalie?: boolean } = {}) {
  type Trace = {
    table: string;
    selection: string;
    selectOptions: unknown;
    filters: Array<[string, string, unknown]>;
    ranged: boolean;
  };
  const traces: Trace[] = [];
  const checkins = [
    { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'season-a-game' },
    { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'season-b-game' },
    { player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'other-league-game' },
  ];
  const games = new Map([
    ['season-a-game', { id: 'season-a-game', league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-09-01', home_score: 1, away_score: 0 }],
    ['season-b-game', { id: 'season-b-game', league_id: HOCKEY_LIFE_ID, season_id: OTHER_SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-03-01', home_score: 2, away_score: 1 }],
    ['other-league-game', { id: 'other-league-game', league_id: OTHER_LEAGUE_ID, season_id: SEASON_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2026-06-01', home_score: 3, away_score: 2 }],
    ['historical-game', { id: 'historical-game', league_id: HOCKEY_LIFE_ID, season_id: HISTORICAL_BASELINE_ID, status: 'completed', home_team_id: TEAM_ID, away_team_id: null, scheduled_at: '2025-01-01', home_score: 4, away_score: 3 }],
  ]);
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
    query.range = jest.fn((from: number, to: number) => {
      trace.ranged = true;
      const value = result();
      return Promise.resolve({
        ...value,
        data: Array.isArray(value.data) ? value.data.slice(from, to + 1) : value.data,
      });
    });
    query.maybeSingle = jest.fn(() => Promise.resolve(result()));
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return query;
  }) };
  return { client, traces };
}

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
    expect(maxActiveGameQueries).toBeLessThanOrEqual(4);
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
    expect(fallbackOutReads).toHaveLength(2);
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
    expect(fallbackEvidenceReads).toHaveLength(6);
    expect(new Set(fallbackEvidenceReads.map((trace) => trace.filters
      .find(([method, column]) => method === 'eq' && column === 'season_id')?.[2])))
      .toEqual(new Set([SEASON_ID, OTHER_SEASON_ID]));
    for (const fallbackRead of [...fallbackReads, ...fallbackGameReads, ...fallbackEvidenceReads]) {
      expect(fallbackRead.selectOptions).toEqual({ count: 'exact' });
      expect(fallbackRead.ranged).toBe(true);
    }
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
    expect(fallbackEvidenceReads).toHaveLength(6);
    const exactSeasonIds = [...fallbackGameReads, ...fallbackEvidenceReads].map((trace) => trace.filters
      .find(([method, column]) => method === 'eq' && column === 'season_id')?.[2]);
    expect(new Set(exactSeasonIds)).toEqual(new Set([SEASON_ID, OTHER_SEASON_ID]));
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
