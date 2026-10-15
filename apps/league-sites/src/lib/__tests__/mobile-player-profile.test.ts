import { NextRequest } from 'next/server';

import {
  HOCKEY_LIFE_ID,
  handleMobilePlayerProfileRequest,
  type MobilePlayerProfileDependencies,
} from '@/lib/mobile-player-profile';
import {
  getConfirmedCheckinAppearanceRows,
  getFallbackRosterAppearanceRows,
  classifyStrictGoalieCareerSources,
  classifyStrictSkaterCareerSources,
  getPlayerBadges,
  getPlayerGoalieMatchups,
  getSeasons,
  generatePlayerCareerHotFacts,
  loadTeamGameCountsBySeasonTeam,
  summarizePlayerCareerTotalsFromTimeline,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }));
const mockedCreateClient = jest.mocked(createClient);

const PROFILE_ID = 'add94b26-b344-459f-9727-8cddae9783de';
const ROSTER_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '145ac7ee-99fb-4a50-a0b5-37f24e9991f3';
const TEAM_ID = '093f611c-0cdc-4509-afde-9c661b5833c9';
const WINTER_2026_ID = '30ee2c0b-5981-4df4-b0cc-d7cae05b9e37';

function req(query: string) {
  return new NextRequest(`https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?${query}`);
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

  it('normalizes ordinary goalie selected ratios to 0-100 but leaves canonical timeline percentages alone', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    d.getStats.mockResolvedValue({ games_played: 1, wins: 1, losses: 0, ties: 0, saves: 18, goals_against: 2, save_percentage: 0.9, goals_against_average: 2, shutouts: 0 });
    d.getTimeline.mockResolvedValue([{ ...(await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, false))[0], save_percentage: 90 }]);
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}`), d)).json();
    expect(body.data.metrics.save_percentage).toBe(90);
    expect(body.data.careerRows[0].metrics.save_percentage).toBe(90);
  });

  it('normalizes the actual canonical career goalie summarizer ratio to the DTO percentage unit', async () => {
    const d = deps();
    d.resolvePlayer.mockResolvedValue({ ...(await d.resolvePlayer(PROFILE_ID))!, position: 'G', is_goalie: true });
    const row = (await d.getTimeline(HOCKEY_LIFE_ID, PROFILE_ID, true, true))[0] as PlayerCareerSeasonRow;
    d.getStats.mockResolvedValue(summarizePlayerCareerTotalsFromTimeline(PROFILE_ID, [{ ...row, games_played: 1, saves: 18, goals_against: 2, save_percentage: 90 }], true));
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics.save_percentage).toBe(90);
  });

  it('projects the captured Matt career facts from canonical dependencies without recomputing them', async () => {
    const d = deps();
    d.getStats.mockResolvedValue({ games_played: 37, goals: 156, assists: 75, points: 231, penalty_minutes: 0, plus_minus: 0 });
    const body = await (await handleMobilePlayerProfileRequest(req(`playerId=${PROFILE_ID}&season=all`), d)).json();
    expect(body.data.metrics).toMatchObject({ games_played: 37, goals: 156, assists: 75, points: 231 });
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

  it('returns 5xx rather than a fabricated zero payload when a dependency fails', async () => {
    const d = deps();
    d.getStats.mockRejectedValue(new Error('schema read failed'));
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
