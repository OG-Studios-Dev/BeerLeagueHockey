import { NextRequest } from 'next/server';

import {
  HOCKEY_LIFE_ID,
  handleMobilePlayerProfileRequest,
  type MobilePlayerProfileDependencies,
} from '@/lib/mobile-player-profile';
import {
  getConfirmedCheckinAppearanceRows,
  getFallbackRosterAppearanceRows,
  getPlayerGameLog,
  classifyStrictGoalieCareerSources,
  classifyStrictSkaterCareerSources,
  getPlayerCareerStatsTimeline,
  getPlayerBadges,
  getPlayerGoalieMatchups,
  getSeasons,
  generatePlayerCareerHotFacts,
  loadTeamGameCountsBySeasonTeam,
  summarizePlayerCareerTotalsFromTimeline,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }));
const mockedCreateClient = jest.mocked(createClient);
const mockedCreateServiceRoleClient = jest.mocked(createServiceRoleClient);

const PROFILE_ID = 'add94b26-b344-459f-9727-8cddae9783de';
const ROSTER_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '145ac7ee-99fb-4a50-a0b5-37f24e9991f3';
const TEAM_ID = '093f611c-0cdc-4509-afde-9c661b5833c9';
const WINTER_2026_ID = '30ee2c0b-5981-4df4-b0cc-d7cae05b9e37';

const publicMetric = (value: number | null, state = value === null ? 'unknown' : 'recorded', sources: string[] = value === null ? [] : ['skater_stats']) => ({ value, state, sources });

function publicSeasonPlayer(goalie = false) {
  return {
    playerId: PROFILE_ID,
    playerName: 'Matt Grossi',
    avatarUrl: null,
    displayTeam: { id: TEAM_ID, name: 'Bad Bunny' },
    teams: [{ id: TEAM_ID, name: 'Bad Bunny' }],
    roles: goalie ? ['goalie'] : ['skater'],
    metrics: {
      gamesPlayed: publicMetric(0, 'reported', ['roster_window']),
      goals: publicMetric(0), assists: publicMetric(0), points: publicMetric(0), penaltyMinutes: publicMetric(0),
    },
    goalie: goalie ? {
      gamesPlayed: publicMetric(0, 'reported', ['roster_window']),
      wins: publicMetric(null), losses: publicMetric(null), saves: publicMetric(null), goalsAgainst: publicMetric(0, 'reported', ['roster_window']),
      savePercentage: publicMetric(null), goalsAgainstAverage: publicMetric(null), shutouts: publicMetric(null),
    } : null,
  };
}

function req(query: string) {
  return new NextRequest(`https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?${query}`);
}

type TestProfileDependencies = jest.Mocked<MobilePlayerProfileDependencies> & { getMatchups: jest.Mock };

function deps(): TestProfileDependencies {
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
    getCareerScope: jest.fn().mockResolvedValue({ isEligible: true, canonicalSeasonIds: [SEASON_ID] }),
    getPublicSeasonPlayer: jest.fn().mockResolvedValue(publicSeasonPlayer()),
    getTimeline: jest.fn().mockResolvedValue(timeline),
    getGames: jest.fn().mockResolvedValue([]),
    getBadges: jest.fn().mockResolvedValue([{ id: 'b', player_id: PROFILE_ID, league_id: HOCKEY_LIFE_ID, season_id: SEASON_ID, team_id: TEAM_ID, badge_type: 'top_scorer', metadata: {}, created_at: '2026-09-02', season: { name: 'Fall 2026' }, team: { name: 'Bad Bunny' } }]),
    getImportedAchievements: jest.fn().mockResolvedValue({ championships: 2 }),
    getArticles: jest.fn().mockResolvedValue([{ id: 'a', league_id: HOCKEY_LIFE_ID, slug: 'story', title: 'Story', excerpt: null, image_url: '/news/story.jpg', published_at: '2026-09-03', type: 'news' }]),
    getMatchups: jest.fn().mockResolvedValue([]),
    generateHotFacts: jest.fn().mockResolvedValue(['Fact']),
  } as unknown as TestProfileDependencies;
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
  });

  it('projects the anonymous DTO only, resolves artwork, and preserves valid zero/null stats', async () => {
    const d = deps();
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${ROSTER_ID}`), d);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe(1);
    expect(body.league).toEqual({ id: HOCKEY_LIFE_ID, slug: 'hockey-life' });
    expect(body.data).toMatchObject({ playerId: PROFILE_ID, rosterId: ROSTER_ID, metrics: { games_played: 0, points: 0 }, aggregateOnly: false });
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

  it('publishes synthetic appearance game rows with blank numeric metrics instead of fabricated zeroes', async () => {
    const d = deps();
    d.getGames.mockResolvedValue([{
      game_id: '40000000-0000-4000-8000-000000000004',
      date: '2026-09-10T20:00:00Z',
      opponent: 'Fixture Opponent', opponent_name: 'Fixture Opponent', result: 'W',
      goals: 0, assists: 0, points: 0, pim: 0, plus_minus: 0,
      metric_availability: { goals: false, assists: false, points: false, penalty_minutes: false, plus_minus: false },
    }] as never);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.games[0].metrics).toEqual({
      goals: null,
      assists: null,
      points: null,
      penalty_minutes: null,
      plus_minus: null,
      saves: null,
      goals_against: null,
      save_percentage: null,
    });
  });

  it('blanks nullable real player-stat fields while retaining an authoritative zero', async () => {
    const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq', 'order', 'limit']) query[method] = jest.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: [{
        id: 'real-stat',
        goals: null,
        assists: 0,
        penalty_minutes: null,
        game_id: 'real-game',
        team_id: TEAM_ID,
        game: {
          id: 'real-game', scheduled_at: '2026-09-12T20:00:00Z', home_score: 2, away_score: 1,
          status: 'completed', home_team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny' },
          away_team: { id: 'away', name: 'Wolves', slug: 'wolves' },
        },
      }],
      error: null,
    }).then(resolve);
    mockedCreateClient.mockResolvedValue({ from: jest.fn(() => query) } as never);
    const log = await getPlayerGameLog(PROFILE_ID, undefined, 20, { strict: true });
    const d = deps();
    d.getGames.mockResolvedValue(log);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(log[0].metric_availability).toEqual({
      goals: false,
      assists: true,
      points: false,
      penalty_minutes: false,
      plus_minus: false,
      saves: false,
      goals_against: false,
      save_percentage: false,
    });
    expect(body.data.games[0].metrics).toEqual({
      goals: null,
      assists: 0,
      points: null,
      penalty_minutes: null,
      plus_minus: null,
      saves: null,
      goals_against: null,
      save_percentage: null,
    });
  });

  it('never publishes per-game saves or save percentage even when a source marks them available', async () => {
    const d = deps();
    d.getGames.mockResolvedValue([{
      game_id: '40000000-0000-4000-8000-000000000014',
      date: '2026-09-10T20:00:00Z',
      opponent: 'Fixture Opponent', opponent_name: 'Fixture Opponent', result: 'W',
      goals: 0, assists: 0, points: 0, pim: 0, plus_minus: 0,
      saves: 18, goals_against: 2, save_percentage: 0.9,
      metric_availability: { saves: true, goals_against: true, save_percentage: true },
    }] as never);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.games[0].metrics).toMatchObject({
      saves: null,
      goals_against: 2,
      save_percentage: null,
    });
  });

  it('does not generate goalie hot facts when canonical inputs such as saves are unavailable', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1, 'reported', ['roster_window']), wins: publicMetric(1), losses: publicMetric(0),
        saves: publicMetric(null), goalsAgainst: publicMetric(3), savePercentage: publicMetric(null),
        goalsAgainstAverage: publicMetric(3), shutouts: publicMetric(0),
      },
    });
    d.generateHotFacts.mockResolvedValue(['171 assumed saves']);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.hotFacts).toEqual([]);
    expect(d.generateHotFacts).not.toHaveBeenCalled();
  });

  it('feeds hot facts canonical metrics instead of exact mismatched timeline values', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    const rawTimeline = {
      ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, false))[0],
      games_played: 9,
      team_games: 10,
      attendance_pct: 90,
      goals: 99,
      assists: 88,
      points: 187,
      goals_per_game: 11,
      points_per_game: 20.78,
    };
    d.getTimeline.mockResolvedValue([rawTimeline]);
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(),
      metrics: {
        gamesPlayed: publicMetric(2),
        goals: publicMetric(1),
        assists: publicMetric(1),
        points: publicMetric(2),
        penaltyMinutes: publicMetric(0),
      },
    });

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);

    expect(response.status).toBe(200);
    expect(d.generateHotFacts).toHaveBeenCalledTimes(1);
    expect(d.generateHotFacts).toHaveBeenCalledWith(expect.objectContaining({
      seasons: [expect.objectContaining({
        season_id: SEASON_ID,
        games_played: 2,
        goals: 1,
        assists: 1,
        points: 2,
        attendance_pct: 0,
      })],
      careerTotalsSeasons: [expect.objectContaining({ games_played: 2, goals: 1, assists: 1, points: 2 })],
    }));
  });

  it('fails closed on profile matchups without reading the unproven aggregate source', async () => {
    const d = deps();
    d.getMatchups.mockResolvedValue([{
      id: '50000000-0000-4000-8000-000000000005', name: 'Complete Opponent',
      gamesPlayed: 1, goals: 1, assists: 0, points: 1, shots: 2, shootingPct: 50,
    }]);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.matchups).toEqual([]);
    expect(d.getMatchups).not.toHaveBeenCalled();
  });

  it('omits matchup rows whose numeric source metrics are incomplete', async () => {
    const d = deps();
    d.getMatchups.mockResolvedValue([{
      id: '50000000-0000-4000-8000-000000000005', name: 'Incomplete Opponent',
      gamesPlayed: 1, goals: 1, assists: 0, points: undefined, shots: 1, shootingPct: 100,
    }] as never);

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.matchups).toEqual([]);
  });

  it('blanks canonical selected and timeline saves and save percentage even when supplied', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1), wins: publicMetric(1), losses: publicMetric(0), saves: publicMetric(18),
        goalsAgainst: publicMetric(2), savePercentage: publicMetric(90), goalsAgainstAverage: publicMetric(2), shutouts: publicMetric(0),
      },
    });
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();
    expect(body.data.metrics.saves).toBeNull();
    expect(body.data.metrics.save_percentage).toBeNull();
    expect(body.data.careerRows[0].metrics.saves).toBeNull();
    expect(body.data.careerRows[0].metrics.save_percentage).toBeNull();
    expect(body.data.metricProvenance.saves).toEqual({ state: 'unknown', sources: [] });
    expect(body.data.metricProvenance.save_percentage).toEqual({ state: 'unknown', sources: [] });
  });

  it('uses canonical public goalie policy and never publishes legacy assumed-save candidates', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getTimeline.mockResolvedValue([{ ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, false))[0], games_played: 9, saves: 171, goals_against: 9, save_percentage: 95, goals_against_average: 1 }]);
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1, 'reported', ['roster_window']),
        wins: publicMetric(null), losses: publicMetric(null), saves: publicMetric(null),
        goalsAgainst: publicMetric(3, 'reported', ['roster_window']), savePercentage: publicMetric(null),
        goalsAgainstAverage: publicMetric(3, 'reported', ['roster_window']), shutouts: publicMetric(null),
      },
    });

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();

    expect(body.data.metrics).toMatchObject({
      games_played: 1,
      saves: null,
      goals_against: 3,
      save_percentage: null,
      goals_against_average: 3,
    });
    expect(body.data.metricProvenance).toMatchObject({
      games_played: { state: 'reported', sources: ['roster_window'] },
      saves: { state: 'unknown', sources: [] },
      goals_against: { state: 'reported', sources: ['roster_window'] },
      save_percentage: { state: 'unknown', sources: [] },
    });
    expect(body.data.careerRows[0].metrics).toMatchObject({
      games_played: 1,
      saves: null,
      goals_against: 3,
      save_percentage: null,
      goals_against_average: 3,
    });
    expect(body.data.careerRows[0].metricProvenance).toMatchObject({
      games_played: { state: 'reported', sources: ['roster_window'] },
      saves: { state: 'unknown', sources: [] },
      goals_against: { state: 'reported', sources: ['roster_window'] },
    });
    expect(JSON.stringify(body)).not.toContain('171');
  });

  it('builds native career goalie totals only from canonical policy rows', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getTimeline.mockResolvedValue([{ ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0], games_played: 9, saves: 171, goals_against: 9, save_percentage: 95, goals_against_average: 1 }]);
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1, 'reported', ['roster_window']),
        wins: publicMetric(1), losses: publicMetric(0), saves: publicMetric(null),
        goalsAgainst: publicMetric(3, 'reported', ['roster_window']), savePercentage: publicMetric(null),
        goalsAgainstAverage: publicMetric(3, 'reported', ['roster_window']), shutouts: publicMetric(0),
      },
    });

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();

    expect(body.data.metrics).toMatchObject({
      games_played: 1,
      wins: 1,
      losses: 0,
      saves: null,
      goals_against: 3,
      save_percentage: null,
      goals_against_average: 3,
      shutouts: 0,
    });
    expect(body.data.metricProvenance).toMatchObject({
      games_played: { state: 'reported', sources: ['roster_window'] },
      saves: { state: 'unknown', sources: [] },
      goals_against: { state: 'reported', sources: ['roster_window'] },
    });
    expect(JSON.stringify(body)).not.toContain('171');
  });

  it('includes a policy-reported roster-only goalie appearance in career rows without legacy saves', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getTimeline.mockResolvedValue([]);
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1, 'reported', ['roster_window']),
        wins: publicMetric(0), losses: publicMetric(1), saves: publicMetric(null),
        goalsAgainst: publicMetric(3, 'reported', ['roster_window']), savePercentage: publicMetric(null),
        goalsAgainstAverage: publicMetric(3, 'reported', ['roster_window']), shutouts: publicMetric(0),
      },
    });

    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();

    expect(body.data.careerRows).toHaveLength(1);
    expect(body.data.careerRows[0].metrics).toMatchObject({ games_played: 1, saves: null, goals_against: 3, goals_against_average: 3, save_percentage: null });
    expect(body.data.metrics).toMatchObject({ games_played: 1, saves: null, goals_against: 3, goals_against_average: 3, save_percentage: null });
    expect(body.data.careerRows[0].metricProvenance.games_played).toEqual({ state: 'reported', sources: ['roster_window'] });
    expect(d.generateHotFacts).not.toHaveBeenCalled();
  });

  it('keeps canonical career goalie saves and save percentage blank', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(true),
      goalie: {
        gamesPlayed: publicMetric(1), wins: publicMetric(1), losses: publicMetric(0), saves: publicMetric(18),
        goalsAgainst: publicMetric(2), savePercentage: publicMetric(90), goalsAgainstAverage: publicMetric(2), shutouts: publicMetric(0),
      },
    });
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics.saves).toBeNull();
    expect(body.data.metrics.save_percentage).toBeNull();
    expect(body.data.metricProvenance.saves).toEqual({ state: 'unknown', sources: [] });
    expect(body.data.metricProvenance.save_percentage).toEqual({ state: 'unknown', sources: [] });
  });

  it('projects the captured Matt career facts from canonical dependencies without recomputing them', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.getPublicSeasonPlayer.mockResolvedValue({
      ...publicSeasonPlayer(),
      metrics: {
        gamesPlayed: publicMetric(37), goals: publicMetric(156), assists: publicMetric(75),
        points: publicMetric(231), penaltyMinutes: publicMetric(0),
      },
    });
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics).toMatchObject({ games_played: 37, goals: 156, assists: 75, points: 231 });
    expect(body.data.careerRows[0].metricProvenance).toMatchObject({
      goals_per_game: { state: 'recorded', sources: ['skater_stats'] },
      points_per_game: { state: 'recorded', sources: ['skater_stats'] },
    });
  });

  it('emits a repeated imported season aggregate once without multiplying career totals', async () => {
    const d = deps();
    const imported = {
      ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true))[0],
      season_id: WINTER_2026_ID,
      season_name: 'Winter 2026',
      games_played: 10,
      team_games: 10,
      attendance_pct: 100,
      goals: 12,
      assists: 7,
      points: 19,
      goals_per_game: 1.2,
      points_per_game: 1.9,
    };
    d.getSeasons.mockResolvedValue([{
      id: WINTER_2026_ID,
      name: 'Winter 2026',
      start_date: '2026-01-01',
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    }]);
    d.getTimeline.mockResolvedValue([
      imported,
      { ...imported, team_id: '193f611c-0cdc-4509-afde-9c661b5833c9', team_name: 'Wolves' },
    ]);

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.careerRows).toHaveLength(1);
    expect(body.data.careerRows[0]).toMatchObject({
      seasonId: WINTER_2026_ID,
      teamId: TEAM_ID,
      teamName: 'Bad Bunny',
      metrics: { games_played: 10, attendance: null, goals: 12, assists: 7, points: 19 },
      metricProvenance: { attendance: { state: 'unknown', sources: [] } },
    });
    expect(body.data.metrics).toMatchObject({ games_played: 10, attendance: null, goals: 12, assists: 7, points: 19 });
    expect(body.data.metricProvenance.attendance).toEqual({ state: 'unknown', sources: [] });
    expect(d.generateHotFacts).toHaveBeenCalledWith(expect.objectContaining({
      careerTotalsSeasons: [expect.objectContaining({
        season_id: WINTER_2026_ID,
        attendance_known: false,
      })],
    }));
  });

  it('fails closed when repeated imported season aggregate metrics disagree', async () => {
    const d = deps();
    const imported = {
      ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, true))[0],
      season_id: WINTER_2026_ID,
      season_name: 'Winter 2026',
      games_played: 10,
      team_games: 10,
      attendance_pct: 100,
      goals: 12,
      assists: 7,
      points: 19,
      goals_per_game: 1.2,
      points_per_game: 1.9,
    };
    d.getSeasons.mockResolvedValue([{
      id: WINTER_2026_ID,
      name: 'Winter 2026',
      start_date: '2026-01-01',
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    }]);
    d.getTimeline.mockResolvedValue([
      imported,
      {
        ...imported,
        team_id: '193f611c-0cdc-4509-afde-9c661b5833c9',
        team_name: 'Wolves',
        goals: 11,
        points: 18,
      },
    ]);

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);

    expect(response.status).toBe(502);
    expect(d.generateHotFacts).not.toHaveBeenCalled();
  });

  it('keeps captured Steven imported-goalie percentage provenance and aggregate-only behavior', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, player_id: '751c2f47-f0e8-4506-b10e-b39a7bbcd302', position: 'Goalie', is_goalie: true });
    d.getSeasons.mockResolvedValue([{ id: WINTER_2026_ID, name: 'Winter 2026', start_date: '2026-01-01', status: 'completed', league_id: HOCKEY_LIFE_ID }]);
    d.getTimeline.mockResolvedValue([{
      ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0],
      season_id: WINTER_2026_ID, season_name: 'Winter 2026', games_played: 10,
      wins: 5, losses: 4, ties: 1, saves: 171, saves_known: true,
      goals_against: 33, save_percentage: 83.8, goals_against_average: 3.3, shutouts: 0,
    }]);
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=751c2f47-f0e8-4506-b10e-b39a7bbcd302&season=${WINTER_2026_ID}`), d)).json();
    expect(body.data.metrics).toMatchObject({ games_played: 10, attendance: null, wins: 5, losses: 4, ties: 1, saves: null, save_percentage: null });
    expect(body.data.careerRows).toHaveLength(1);
    expect(body.data.careerRows[0].metrics).toMatchObject({ games_played: 10, saves: null, save_percentage: null, goals_against: 33 });
    expect(body.data.careerRows[0].metricProvenance).toMatchObject({
      games_played: { state: 'recorded', sources: ['imported'] },
      attendance: { state: 'unknown', sources: [] },
      saves: { state: 'unknown', sources: [] },
      save_percentage: { state: 'unknown', sources: [] },
    });
    expect(body.data.metricProvenance).toMatchObject({
      games_played: { state: 'recorded', sources: ['imported'] },
      attendance: { state: 'unknown', sources: [] },
      saves: { state: 'unknown', sources: [] },
      save_percentage: { state: 'unknown', sources: [] },
    });
    expect(JSON.stringify(body)).not.toContain('"saves":171');
    expect(JSON.stringify(body)).not.toContain('83.8');
    expect(body.data.hotFacts).toEqual([]);
    expect(d.generateHotFacts).not.toHaveBeenCalled();
    expect(body.data.aggregateOnly).toBe(true);
    expect(d.getGames).not.toHaveBeenCalled();
    expect(d.getMatchups).not.toHaveBeenCalled();
  });

  it('loads one baseline-inclusive timeline and derives the public views locally', async () => {
    const d = deps();

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);

    expect(response.status).toBe(200);
    expect(d.getTimeline).toHaveBeenCalledTimes(1);
    expect(d.getTimeline).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID, false, true);
  });

  it('accepts a large league catalog and queries only the player-relevant canonical season', async () => {
    const d = deps();
    d.getSeasons.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      id: index === 0 ? SEASON_ID : `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      name: `Season ${index + 1}`,
      start_date: `2026-${String((index % 12) + 1).padStart(2, '0')}-01`,
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    })));
    d.getCareerScope.mockResolvedValue({
      isEligible: true,
      canonicalSeasonIds: [SEASON_ID],
    });

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);

    expect(response.status).toBe(200);
    expect(d.getCareerScope).toHaveBeenCalledWith(HOCKEY_LIFE_ID, PROFILE_ID);
    expect(d.getPublicSeasonPlayer).toHaveBeenCalledTimes(1);
    expect(d.getPublicSeasonPlayer).toHaveBeenCalledWith(HOCKEY_LIFE_ID, SEASON_ID, PROFILE_ID);
  });

  it('rejects more than eight canonical seasons before timeline or metric fan-out', async () => {
    const d = deps();
    const seasonRows = Array.from({ length: 9 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      name: `Season ${index + 1}`,
      start_date: `2026-${String((index % 12) + 1).padStart(2, '0')}-01`,
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    }));
    d.getSeasons.mockResolvedValue(seasonRows);
    d.getCareerScope.mockResolvedValue({ isEligible: true, canonicalSeasonIds: seasonRows.map((season) => season.id) });
    d.getTimeline.mockResolvedValue(seasonRows.map((season) => ({
      season_id: season.id,
      season_name: season.name,
      sort_date: season.start_date,
      team_id: TEAM_ID,
      team_name: 'Bad Bunny',
      position: 'C',
      games_played: 1,
      team_games: 1,
      attendance_pct: 100,
      goals: 0,
      assists: 0,
      points: 0,
      goals_per_game: 0,
      points_per_game: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      saves: 0,
      goals_against: 0,
      save_percentage: null,
      goals_against_average: null,
      shutouts: 0,
    })));

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);

    expect(response.status).toBe(502);
    expect(d.getTimeline).not.toHaveBeenCalled();
    expect(d.getPublicSeasonPlayer).not.toHaveBeenCalled();
  });

  it('reads canonical mobile seasons sequentially instead of amplifying anonymous requests', async () => {
    const d = deps() as jest.Mocked<MobilePlayerProfileDependencies> & { getPublicSeasonPlayer: jest.Mock };
    d.getSeasons.mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({
      id: index === 0 ? SEASON_ID : `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      name: `Season ${index + 1}`,
      start_date: `2026-0${index + 1}-01`,
      status: 'completed',
      league_id: HOCKEY_LIFE_ID,
    })));
    d.getCareerScope.mockResolvedValue({
      isEligible: true,
      canonicalSeasonIds: [
        SEASON_ID,
        '20000000-0000-4000-8000-000000000011',
        '20000000-0000-4000-8000-000000000012',
      ],
    });
    let active = 0;
    let maxActive = 0;
    d.getPublicSeasonPlayer.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return publicSeasonPlayer();
    });

    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d);

    expect(response.status).toBe(200);
    expect(d.getPublicSeasonPlayer).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });

  it('returns 5xx rather than a fabricated zero payload when a dependency fails', async () => {
    const d = deps();
    d.getPublicSeasonPlayer.mockRejectedValue(new Error('schema read failed'));
    const response = await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d);
    expect(response.status).toBe(502);
  });
});

function queryResult(result: { data: unknown[] | null; error: unknown; count: number | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
  query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe('strict canonical appearance query completeness', () => {
  it('emits only completed games from the player game log', async () => {
    const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq', 'order', 'limit']) query[method] = jest.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: [
        {
          id: 'completed-stat', goals: 1, assists: 1, penalty_minutes: 0, game_id: 'completed-game', team_id: TEAM_ID,
          game: { id: 'completed-game', scheduled_at: '2026-09-10T20:00:00Z', home_score: 2, away_score: 1,
            status: 'completed', home_team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny' },
            away_team: { id: 'away', name: 'Wolves', slug: 'wolves' } },
        },
        {
          id: 'pending-stat', goals: 9, assists: 9, penalty_minutes: 0, game_id: 'pending-game', team_id: TEAM_ID,
          game: { id: 'pending-game', scheduled_at: '2026-09-11T20:00:00Z', home_score: 3, away_score: 1,
            status: 'pending_verification', home_team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny' },
            away_team: { id: 'away', name: 'Wolves', slug: 'wolves' } },
        },
      ],
      error: null,
    }).then(resolve);
    mockedCreateClient.mockResolvedValue({ from: jest.fn(() => query) } as never);

    const rows = await getPlayerGameLog(PROFILE_ID, undefined, 20, { strict: true });

    expect(rows).toEqual([expect.objectContaining({ game_id: 'completed-game', result: 'W' })]);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('game:games!inner('));
    expect(query.eq).toHaveBeenCalledWith('game.status', 'completed');
  });

  it('selects the latest 20 completed games before the limit when the newest stat was backfilled earliest', async () => {
    const completedRows = Array.from({ length: 21 }, (_, index) => ({
      id: `stat-${index + 1}`,
      created_at: index === 0 ? '2026-08-01T00:00:00Z' : `2026-10-${String(index).padStart(2, '0')}T00:00:00Z`,
      goals: index === 0 ? 1 : 0,
      assists: 0,
      penalty_minutes: 0,
      game_id: `game-${index + 1}`,
      team_id: TEAM_ID,
      game: {
        id: `game-${index + 1}`,
        scheduled_at: `2026-09-${String(21 - index).padStart(2, '0')}T20:00:00Z`,
        home_score: 2,
        away_score: 1,
        status: 'completed',
        home_team: { id: TEAM_ID, name: 'Bad Bunny', slug: 'bad-bunny' },
        away_team: { id: 'away', name: 'Wolves', slug: 'wolves' },
      },
    }));
    const orderings: Array<{ column: string; ascending: boolean }> = [];
    let requestedLimit = completedRows.length;
    const query: Record<string, jest.Mock> & { then?: unknown } = {} as never;
    for (const method of ['select', 'eq']) query[method] = jest.fn(() => query);
    query.order = jest.fn((column: string, options: { ascending?: boolean } = {}) => {
      orderings.push({ column, ascending: options.ascending ?? true });
      return query;
    });
    query.limit = jest.fn((value: number) => {
      requestedLimit = value;
      return query;
    });
    query.then = (resolve: (value: unknown) => unknown) => {
      const valueFor = (row: (typeof completedRows)[number], column: string) => {
        if (column === 'game(scheduled_at)') return row.game.scheduled_at;
        if (column === 'created_at') return row.created_at;
        if (column === 'id') return row.id;
        throw new Error(`unexpected order column: ${column}`);
      };
      const selectedRows = [...completedRows]
        .sort((left, right) => {
          for (const ordering of orderings) {
            const comparison = valueFor(left, ordering.column).localeCompare(valueFor(right, ordering.column));
            if (comparison !== 0) return ordering.ascending ? comparison : -comparison;
          }
          return 0;
        })
        .slice(0, requestedLimit);
      return Promise.resolve({ data: selectedRows, error: null, count: completedRows.length }).then(resolve);
    };
    mockedCreateClient.mockResolvedValue({ from: jest.fn(() => query) } as never);

    const rows = await getPlayerGameLog(PROFILE_ID, undefined, 20, { strict: true });

    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.game_id)).toEqual(completedRows.slice(0, 20).map((row) => row.game_id));
    expect(query.order).toHaveBeenNthCalledWith(1, 'game(scheduled_at)', { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(20);
  });

  it('uses completed-only games for fallback roster appearances while preserving completed roster GP', async () => {
    const results: Record<string, { data: unknown[] | null; error: unknown; count: number | null }> = {
      team_rosters: {
        data: [{ player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID, joined_at: null, end_date: null }],
        error: null,
        count: 1,
      },
      games: {
        data: [{ id: 'completed-game', season_id: SEASON_ID, scheduled_at: '2026-09-10T20:00:00Z', status: 'completed',
          home_team_id: TEAM_ID, away_team_id: 'away', home_score: 2, away_score: 1 }],
        error: null,
        count: 1,
      },
      game_checkins: { data: [], error: null, count: 0 },
      player_availability: { data: [], error: null, count: 0 },
      player_stats: { data: [], error: null, count: 0 },
      goalie_stats: { data: [], error: null, count: 0 },
    };
    const builders = new Map<string, ReturnType<typeof queryResult>>();
    const client = { from: jest.fn((table: string) => {
      const builder = queryResult(results[table]);
      builders.set(table, builder);
      return builder;
    }) };

    const rows = await getFallbackRosterAppearanceRows(client as never, {
      seasonId: SEASON_ID,
      playerIds: [PROFILE_ID],
      strict: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'completed-game' });
    expect(builders.get('games')?.in).toHaveBeenCalledWith('status', ['completed']);
  });

  it('serializes per-season timeline appearance fallback work', async () => {
    const seasons = Array.from({ length: 3 }, (_, index) => ({
      id: `season-${index + 1}`,
      name: `Season ${index + 1}`,
      start_date: `2026-0${index + 1}-01`,
    }));
    const tableRows: Record<string, unknown[]> = {
      seasons,
      player_season_stats: seasons.map((season) => ({
        season_id: season.id,
        team_id: null,
        team_name: null,
        position: 'C',
        games_played: 1,
        goals: 0,
        assists: 0,
        points: 0,
      })),
      game_checkins: [],
      team_rosters: [],
    };
    let activeFallbackReads = 0;
    let maxActiveFallbackReads = 0;
    const queryFor = (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
      const result = {
        data: table === 'profiles' ? { full_name: 'Casey Example' } : tableRows[table] ?? [],
        error: null,
        count: table === 'profiles' ? null : (tableRows[table] ?? []).length,
      };
      query.maybeSingle = jest.fn(() => Promise.resolve(result));
      query.then = (resolve: (value: unknown) => unknown) => {
        const tracked = table === 'game_checkins' || table === 'team_rosters';
        if (!tracked) return Promise.resolve(result).then(resolve);
        activeFallbackReads += 1;
        maxActiveFallbackReads = Math.max(maxActiveFallbackReads, activeFallbackReads);
        return new Promise<void>((done) => setImmediate(done)).then(() => {
          activeFallbackReads -= 1;
          return resolve(result);
        });
      };
      return query;
    };
    mockedCreateClient.mockResolvedValue({ from: jest.fn((table: string) => queryFor(table)) } as never);
    mockedCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() => {
        const query = queryFor('player_career_baselines');
        query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
        return query;
      }),
    } as never);

    const rows = await getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, false, {
      includeHistoricalBaseline: true,
      strict: true,
    });

    expect(rows).toHaveLength(3);
    expect(maxActiveFallbackReads).toBe(1);
  });

  it('fails closed when an actual confirmed-checkin query is capped below its exact count', async () => {
    const capped = Array.from({ length: 1000 }, (_, index) => ({ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: `game-${index}` }));
    const client = { from: jest.fn(() => queryResult({ data: capped, error: null, count: 1001 })) };
    await expect(getConfirmedCheckinAppearanceRows(client as never, { playerIds: [PROFILE_ID], strict: true }))
      .rejects.toThrow('confirmed check-in appearances completeness');
  });

  it('preserves the original non-strict capped-query behavior and projection options', async () => {
    const builder = queryResult({ data: [{ player_id: PROFILE_ID, team_id: TEAM_ID, game_id: 'one' }], error: null, count: 1001 });
    const client = { from: jest.fn(() => builder) };
    await expect(getConfirmedCheckinAppearanceRows(client as never, { playerIds: [PROFILE_ID] })).resolves.toHaveLength(1);
    expect(builder.select).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('propagates a later fallback-source query error after the roster query succeeds', async () => {
    const results: Record<string, { data: unknown[] | null; error: unknown; count: number | null }> = {
      team_rosters: { data: [{ player_id: PROFILE_ID, team_id: TEAM_ID, season_id: SEASON_ID, joined_at: null, end_date: null }], error: null, count: 1 },
      games: { data: [], error: null, count: 0 },
      game_checkins: { data: [], error: null, count: 0 },
      player_availability: { data: null, error: { code: 'PGRST500', message: 'later query failed' }, count: null },
      player_stats: { data: [], error: null, count: 0 },
      goalie_stats: { data: [], error: null, count: 0 },
    };
    const client = { from: jest.fn((table: string) => queryResult(results[table])) };
    await expect(getFallbackRosterAppearanceRows(client as never, { seasonId: SEASON_ID, playerIds: [PROFILE_ID], strict: true }))
      .rejects.toThrow('fallback out availability');
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

  it('counts only completed games in career timeline attendance denominators', async () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'or', 'order']) query[method] = jest.fn(() => query);
    query.range = jest.fn(() => Promise.resolve({
      data: [{ id: 'completed-game', season_id: SEASON_ID, home_team_id: TEAM_ID, away_team_id: null, location: 'Arena' }],
      error: null,
      count: 1,
    }));

    const counts = await loadTeamGameCountsBySeasonTeam(
      { from: jest.fn(() => query) } as never,
      HOCKEY_LIFE_ID,
      [SEASON_ID],
      [TEAM_ID],
      { strict: true },
    );

    expect(counts.get(`${SEASON_ID}:${TEAM_ID}`)).toBe(1);
    expect(query.in).toHaveBeenCalledWith('status', ['completed']);
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

  it('joins goalie timeline stats through completed games before aggregation', async () => {
    const builders = new Map<string, ReturnType<typeof queryResult>>();
    const client = { from: jest.fn((table: string) => {
      const result = table === 'seasons'
        ? { data: [{ id: SEASON_ID, name: 'Fall 2026', start_date: '2026-09-01' }], error: null, count: 1 }
        : { data: null, error: { code: 'PGRST500', message: 'stop after goalie query' }, count: null };
      const builder = queryResult(result);
      builders.set(table, builder);
      return builder;
    }) };
    mockedCreateClient.mockResolvedValue(client as never);

    await expect(getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, { strict: true }))
      .rejects.toThrow('goalie career timeline');

    expect(builders.get('goalie_stats')?.select).toHaveBeenCalledWith(
      expect.stringContaining('game:games!inner(id)'),
      { count: 'exact' },
    );
    expect(builders.get('goalie_stats')?.eq).toHaveBeenCalledWith('game.status', 'completed');
  });

  it('fails closed over 32 timeline seasons before attendance fallback fan-out', async () => {
    const seasonRows = Array.from({ length: 33 }, (_, index) => ({
      id: `season-${index}`,
      name: `Season ${index}`,
      start_date: `2026-${String((index % 12) + 1).padStart(2, '0')}-01`,
    }));
    const goalieRows = seasonRows.map((season, index) => ({
      id: `stat-${index}`,
      game_id: `game-${index}`,
      season_id: season.id,
      team_id: null,
      saves: 10,
      shots_against: 11,
      goals_against: 1,
      game_result: 'W',
      shutout: false,
      provenance: null,
    }));
    const from = jest.fn((table: string) => queryResult(table === 'seasons'
      ? { data: seasonRows, error: null, count: seasonRows.length }
      : table === 'goalie_stats'
        ? { data: goalieRows, error: null, count: goalieRows.length }
        : { data: [], error: null, count: 0 }));
    mockedCreateClient.mockResolvedValue({ from } as never);

    await expect(getPlayerCareerStatsTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, { strict: true }))
      .rejects.toThrow('career timeline season work limit exceeded');
    expect(from).not.toHaveBeenCalledWith('game_checkins');
    expect(from).not.toHaveBeenCalledWith('team_rosters');
  });

  it('supports baseline-only and rejects a raw-only historical aggregate carrier', () => {
    expect(classifyStrictGoalieCareerSources([], baseline, historicalSeasonId)).toEqual([]);
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
  it('does not turn explicitly unknown attendance into a public hot fact', async () => {
    const rows = [
      {
        season_id: 'season-1', season_name: 'Season 1', sort_date: '2025-01-01', team_id: TEAM_ID, team_name: 'Bad Bunny', position: 'C',
        games_played: 1, team_games: 2, attendance_pct: 50, attendance_known: false,
        goals: 1, assists: 0, points: 1, goals_per_game: 1, points_per_game: 1,
        wins: 0, losses: 0, ties: 0, saves: 0, goals_against: 0, save_percentage: null, goals_against_average: null, shutouts: 0,
      },
      {
        season_id: 'season-2', season_name: 'Season 2', sort_date: '2026-01-01', team_id: TEAM_ID, team_name: 'Bad Bunny', position: 'C',
        games_played: 2, team_games: 2, attendance_pct: 100, attendance_known: false,
        goals: 1, assists: 0, points: 1, goals_per_game: 0.5, points_per_game: 0.5,
        wins: 0, losses: 0, ties: 0, saves: 0, goals_against: 0, save_percentage: null, goals_against_average: null, shutouts: 0,
      },
    ] as Array<PlayerCareerSeasonRow & { attendance_known: false }>;

    const facts = await generatePlayerCareerHotFacts({
      playerName: 'Casey Example',
      seasons: rows,
      careerTotalsSeasons: rows,
      isGoalie: false,
      distinctSeasonComparisons: true,
    });

    expect(facts.join(' ')).not.toMatch(/attendance|showed up/i);
  });

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
