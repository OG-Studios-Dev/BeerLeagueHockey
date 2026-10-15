import { NextRequest } from 'next/server';

import { HLHL_WINTER_2026_SEASON_ID } from '@/lib/imported-aggregate-season-overrides';
import { loadPublicStatMetricRows, type PublicStatMetric } from '@/lib/public-stat-metrics';
import {
  aggregatePublicStatsScope,
  assertPublicStatsScopeResponseBytes,
  handlePublicStatsScopeRequest,
  MAX_PUBLIC_STATS_SCOPE_RESPONSE_BYTES,
  MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS,
  PublicStatsScopeDataError,
  PublicStatsScopeLimitError,
  readCompleteStatsScopeRows,
  resolveBaselinePlayerIds,
  resolvePublicStatsAvatar,
  supportsPublicStatsScopeDivision,
  type PublicStatsScopeDependencies,
  type StatsScopeBaselineRow,
  type StatsScopeSeason,
  type StatsScopeSeasonPayload,
} from '@/lib/public-stats-scope';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const ACTIVE_SEASON = '20000000-0000-4000-8000-000000000002';
const OLD_SEASON = '21000000-0000-4000-8000-000000000002';
const HISTORICAL_SEASON = '22000000-0000-4000-8000-000000000002';
const FOREIGN_SEASON = '23000000-0000-4000-8000-000000000002';
const HIDDEN_SEASON = '24000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const PLAYER_ID = '40000000-0000-4000-8000-000000000004';
const TEAM_ID = '50000000-0000-4000-8000-000000000005';
const BADGE_ID = '60000000-0000-4000-8000-000000000006';
const BASELINE_ID = '70000000-0000-4000-8000-000000000007';

function publicMetric(
  value: number | null,
  state: PublicStatMetric['state'] = value === null ? 'unknown' : 'recorded',
  sources: PublicStatMetric['sources'] = value === null ? [] : ['skater_stats'],
): PublicStatMetric {
  return { value, state, sources };
}

function season(
  id: string,
  name: string,
  status: string,
  startDate: string,
): StatsScopeSeason {
  return {
    id,
    league_id: LEAGUE_ID,
    name,
    status,
    start_date: startDate,
    end_date: null,
    created_at: startDate,
  };
}

const ACTIVE = season(ACTIVE_SEASON, 'Fall 2026', 'active', '2026-09-01');
const OLD = season(OLD_SEASON, 'Spring 2026', 'completed', '2026-04-01');
const HISTORICAL = season(HISTORICAL_SEASON, 'Historical Career Baseline import', 'archived', '2000-01-01');
const HIDDEN = season(HIDDEN_SEASON, 'Private 2025', 'completed', '2025-09-01');

function payload(
  selected: StatsScopeSeason,
  options: {
    gamesPlayed?: PublicStatMetric;
    goals?: PublicStatMetric;
    assists?: PublicStatMetric;
    points?: PublicStatMetric;
    goalieGames?: PublicStatMetric;
    goalsAgainst?: PublicStatMetric;
    avatarUrl?: string | null;
  } = {},
): StatsScopeSeasonPayload {
  const goals = options.goals ?? publicMetric(2);
  const assists = options.assists ?? publicMetric(1);
  const goalieGames = options.goalieGames ?? publicMetric(2, 'recorded', ['goalie_stats']);
  const goalsAgainst = options.goalsAgainst ?? publicMetric(5, 'recorded', ['goalie_stats']);
  const goalieSources = [...new Set([...goalieGames.sources, ...goalsAgainst.sources])];
  const goalieState = goalieGames.state === 'conflicted' || goalsAgainst.state === 'conflicted'
    ? 'conflicted'
    : goalieGames.state === 'unknown' || goalsAgainst.state === 'unknown'
      ? 'unknown'
      : goalieGames.state === 'reported' || goalsAgainst.state === 'reported'
        ? 'reported'
        : 'recorded';
  const goalsAgainstAverage = goalieGames.value !== null && goalsAgainst.value !== null && goalieGames.value > 0
    ? publicMetric(goalsAgainst.value / goalieGames.value, goalieState, goalieSources)
    : publicMetric(null, goalieState === 'conflicted' ? 'conflicted' : 'unknown', goalieSources);
  return {
    presentationSeason: {
      id: selected.id,
      name: selected.name,
      league_id: selected.league_id,
      status: selected.status,
    },
    sourceRowCount: 10,
    players: [{
      playerId: PLAYER_ID,
      playerName: 'Contract Pat',
      avatarUrl: options.avatarUrl ?? 'contract.png',
      displayTeam: { id: TEAM_ID, name: 'Wolves' },
      teams: [{ id: TEAM_ID, name: 'Wolves' }],
      roles: ['skater', 'goalie'],
      metrics: {
        gamesPlayed: options.gamesPlayed ?? publicMetric(2),
        goals,
        assists,
        points: options.points ?? (goals.value !== null && assists.value !== null
          ? publicMetric(goals.value + assists.value)
          : publicMetric(null)),
        penaltyMinutes: publicMetric(null),
      },
      goalie: {
        gamesPlayed: goalieGames,
        wins: publicMetric(1, 'recorded', ['goalie_stats']),
        losses: publicMetric(1, 'recorded', ['goalie_stats']),
        saves: publicMetric(20, 'recorded', ['goalie_stats']),
        goalsAgainst,
        savePercentage: publicMetric(0.8, 'recorded', ['goalie_stats']),
        goalsAgainstAverage,
        shutouts: publicMetric(0, 'recorded', ['goalie_stats']),
      },
    }],
  };
}

function baseline(overrides: Partial<StatsScopeBaselineRow> = {}): StatsScopeBaselineRow {
  return {
    id: BASELINE_ID,
    player_id: PLAYER_ID,
    is_goalie: false,
    games_played: 10,
    goals: 4,
    assists: 5,
    points: 9,
    goals_against: 0,
    moosehead_cup_wins: 2,
    ...overrides,
  };
}

function dependencies(): jest.Mocked<PublicStatsScopeDependencies> {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE_ID, slug: 'hockey-life', status: 'active' }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    requirePrivilegedAccess: jest.fn(),
    readPublicSeasonCatalog: jest.fn().mockResolvedValue([OLD, HISTORICAL, ACTIVE]),
    readSeasonCatalog: jest.fn().mockResolvedValue([OLD, HISTORICAL, ACTIVE]),
    readPublicDivision: jest.fn().mockResolvedValue({ id: DIVISION_ID, league_id: LEAGUE_ID }),
    readDivision: jest.fn().mockResolvedValue({ id: DIVISION_ID, league_id: LEAGUE_ID }),
    loadNativeSeason: jest.fn().mockImplementation(async (selected: StatsScopeSeason) => payload(selected)),
    loadImportedAggregateSeason: jest.fn().mockImplementation(async (selected: StatsScopeSeason) => payload(selected)),
    readBadges: jest.fn().mockResolvedValue([{ id: BADGE_ID, player_id: PLAYER_ID, season_id: ACTIVE_SEASON }]),
    readBaselines: jest.fn().mockResolvedValue([]),
    readProfiles: jest.fn().mockImplementation(async (playerIds: string[]) => playerIds.map((id) => ({
      id,
      full_name: 'Profile Pat',
      avatar_url: '  ',
      photo_url: 'photo.png',
    }))),
    readTeams: jest.fn().mockImplementation(async (leagueId: string, teamIds: string[]) => teamIds.map((id) => ({
      id,
      league_id: leagueId,
      name: 'Wolves',
      logo_url: ' crest.png ',
      division_id: DIVISION_ID,
    }))),
  };
}

function request(query: string, host = 'hockey-life.beerleaguehockey.ca'): NextRequest {
  return new NextRequest(`https://${host}/api/public/stats-scope?${query}`, { headers: { host } });
}

describe('complete stats-scope reads', () => {
  it('reads the sentinel row beyond a provider 1000-row page', async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index }));
    const ranges: Array<[number, number]> = [];
    const result = await readCompleteStatsScopeRows(
      () => ({
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), count: rows.length, error: null };
        },
      }),
      'sentinel source',
      2_000,
    );
    expect(result).toHaveLength(1_001);
    expect(result[1_000]).toEqual({ id: 1_000 });
    expect(ranges).toEqual([[0, 999], [1_000, 1_000]]);
  });

  it('fails closed on a later-page error, count drift, incomplete page, and a global limit', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({ id: index }));
    await expect(readCompleteStatsScopeRows(
      () => ({
        range: async (from: number) => from === 0
          ? { data: firstPage, count: 1_001, error: null }
          : { data: null, count: 1_001, error: new Error('private provider failure') },
      }),
      'later failure',
      2_000,
    )).rejects.toBeInstanceOf(PublicStatsScopeDataError);

    await expect(readCompleteStatsScopeRows(
      () => ({
        range: async (from: number) => from === 0
          ? { data: firstPage, count: 1_001, error: null }
          : { data: [{ id: 1_000 }], count: 1_002, error: null },
      }),
      'count drift',
      2_000,
    )).rejects.toBeInstanceOf(PublicStatsScopeDataError);

    await expect(readCompleteStatsScopeRows(
      () => ({ range: async () => ({ data: [], count: 1, error: null }) }),
      'incomplete',
      10,
    )).rejects.toBeInstanceOf(PublicStatsScopeDataError);

    const boundedRanges: Array<[number, number]> = [];
    await expect(readCompleteStatsScopeRows(
      () => ({
        range: async (from: number, to: number) => {
          boundedRanges.push([from, to]);
          return { data: Array.from({ length: to - from + 1 }, (_, id) => ({ id })), count: 11, error: null };
        },
      }),
      'oversized',
      10,
    )).rejects.toBeInstanceOf(PublicStatsScopeLimitError);
    expect(boundedRanges).toEqual([[0, 9]]);
  });

  it('enforces a cross-table v2 producer row budget', async () => {
    const ranges: Array<[number, number]> = [];
    const query = {
      in() { return this; },
      order() { return this; },
      async range(from: number, to: number) {
        ranges.push([from, to]);
        return { data: [{ id: PLAYER_ID }, { id: TEAM_ID }].slice(from, to + 1), count: 2, error: null };
      },
    };
    const client = { from: () => ({ select: () => query }) };
    await expect(loadPublicStatMetricRows(
      client as never,
      { leagueId: LEAGUE_ID, seasonId: ACTIVE_SEASON },
      { tables: ['profiles'], maxTotalRows: 1 },
    )).rejects.toThrow('metric source total row limit exceeded');
    expect(ranges).toEqual([[0, 0]]);
  });

  it('does not start a later metric table after the remaining total budget is exhausted', async () => {
    const queriedTables: string[] = [];
    const rows = Array.from({ length: 1_000 }, (_, index) => ({ id: index }));
    const client = {
      from(table: string) {
        queriedTables.push(table);
        return {
          select: () => ({
            eq() { return this; },
            order() { return this; },
            async range(from: number, to: number) {
              return { data: rows.slice(from, to + 1), count: rows.length, error: null };
            },
          }),
        };
      },
    };
    await expect(loadPublicStatMetricRows(
      client as never,
      { leagueId: LEAGUE_ID, seasonId: ACTIVE_SEASON },
      { tables: ['games', 'teams'], maxTotalRows: 1_000 },
    )).rejects.toThrow('metric source total row limit exceeded');
    expect(queriedTables).toEqual(['games']);
  });

  it('keeps the legacy loader default free of the opt-in cross-table budget', async () => {
    const client = {
      from() {
        return {
          select: () => ({
            eq() { return this; },
            order() { return this; },
            async range() { return { data: [{ id: PLAYER_ID }], count: 1, error: null }; },
          }),
        };
      },
    };
    await expect(loadPublicStatMetricRows(
      client as never,
      { leagueId: LEAGUE_ID, seasonId: ACTIVE_SEASON },
      { tables: ['games', 'teams'] },
    )).resolves.toMatchObject({ games: [{ id: PLAYER_ID }], teams: [{ id: PLAYER_ID }] });
  });
});

describe('public stats-scope aggregation', () => {
  const profiles = new Map([[PLAYER_ID, {
    id: PLAYER_ID,
    full_name: 'Profile Pat',
    avatar_url: ' ',
    photo_url: 'photo.png',
  }]]);
  const teams = new Map([[TEAM_ID, {
    id: TEAM_ID,
    league_id: LEAGUE_ID,
    name: 'Wolves',
    logo_url: ' crest.png ',
    division_id: DIVISION_ID,
  }]]);

  it('uses avatar/photo/contract fallback and rejects division-filtered all time', () => {
    expect(resolvePublicStatsAvatar('  ', ' photo.png ', 'contract.png')).toBe('photo.png');
    expect(resolvePublicStatsAvatar('avatar.png', 'photo.png', 'contract.png')).toBe('avatar.png');
    expect(resolvePublicStatsAvatar(null, null, ' contract.png ')).toBe('contract.png');
    expect(resolvePublicStatsAvatar('', '', '')).toBeNull();
    expect(supportsPublicStatsScopeDivision('all', DIVISION_ID)).toBe(false);
  });

  it('derives multi-season GAA from total GA / total GP and adds a baseline once', () => {
    const result = aggregatePublicStatsScope({
      payloads: [
        payload(ACTIVE),
        payload(OLD, { goalieGames: publicMetric(1, 'recorded', ['goalie_stats']), goalsAgainst: publicMetric(4, 'recorded', ['goalie_stats']) }),
      ],
      profiles,
      teams,
      badges: [{ id: BADGE_ID, player_id: PLAYER_ID, season_id: ACTIVE_SEASON }],
      baselines: [baseline()],
      includeBaselines: true,
    });
    expect(result[0].goalie?.gamesPlayed.value).toBe(3);
    expect(result[0].goalie?.goalsAgainst.value).toBe(9);
    expect(result[0].goalie?.goalsAgainstAverage.value).toBe(3);
    expect(result[0].skater).toMatchObject({
      gamesPlayed: { value: 14 },
      goals: { value: 8 },
      assists: { value: 7 },
      points: { value: 15 },
      championships: { value: 3, state: 'reported', sources: ['imported', 'player_badges'] },
    });
    expect(result[0].avatarUrl).toBe('photo.png');
    expect(result[0].displayTeam).toEqual({ id: TEAM_ID, name: 'Wolves', logoUrl: 'crest.png' });
  });

  it('resolves a null baseline identity only through one league-proven exact-name profile', () => {
    const unresolved = baseline({ player_id: null, full_name: 'Profile Pat' });
    const otherId = '41000000-0000-4000-8000-000000000004';
    const candidates = [
      { id: PLAYER_ID, full_name: 'Profile Pat', avatar_url: null, photo_url: null },
      { id: otherId, full_name: 'Profile Pat', avatar_url: null, photo_url: null },
    ];
    expect(resolveBaselinePlayerIds(
      [unresolved],
      candidates,
      [{ id: '42000000-0000-4000-8000-000000000004', player_id: PLAYER_ID }],
    )[0].player_id).toBe(PLAYER_ID);
    expect(() => resolveBaselinePlayerIds(
      [unresolved],
      candidates,
      [
        { id: '42000000-0000-4000-8000-000000000004', player_id: PLAYER_ID },
        { id: '43000000-0000-4000-8000-000000000004', player_id: otherId },
      ],
    )).toThrow('missing or ambiguous');
    expect(() => resolveBaselinePlayerIds([unresolved], candidates, [])).toThrow('missing or ambiguous');
  });

  it('preserves unknown and conflicted states without averaging rates', () => {
    const conflicted = payload(OLD, {
      gamesPlayed: publicMetric(null, 'conflicted', ['attendance']),
      goalieGames: publicMetric(null, 'unknown', []),
    });
    const result = aggregatePublicStatsScope({
      payloads: [payload(ACTIVE), conflicted],
      profiles,
      teams,
      badges: [],
      baselines: [],
      includeBaselines: false,
    });
    expect(result[0].skater?.gamesPlayed).toMatchObject({ value: null, state: 'conflicted' });
    expect(result[0].goalie?.goalsAgainstAverage).toMatchObject({ value: null, state: 'unknown' });
    expect(result[0].skater?.championships).toEqual({ value: 0, state: 'verified', sources: ['player_badges'] });
  });

  it('fails closed when successful-looking points do not reconcile', () => {
    expect(() => aggregatePublicStatsScope({
      payloads: [payload(ACTIVE, { goals: publicMetric(2), assists: publicMetric(1), points: publicMetric(99) })],
      profiles,
      teams,
      badges: [],
      baselines: [],
      includeBaselines: false,
    })).toThrow('aggregate points do not reconcile');
  });
});

describe('GET /api/public/stats-scope', () => {
  it('uses operational-season parity and returns the exact parser-compatible identity', async () => {
    const deps = dependencies();
    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=60');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['schemaVersion', 'leagueId', 'leagueSlug', 'divisionId', 'scope', 'seasons', 'players'].sort());
    expect(body).toMatchObject({
      schemaVersion: 1,
      leagueId: LEAGUE_ID,
      leagueSlug: 'hockey-life',
      divisionId: null,
      scope: { kind: 'current', seasonIds: [ACTIVE_SEASON], currentSeasonId: ACTIVE_SEASON },
    });
    expect(body.seasons.map((entry: { id: string }) => entry.id)).toEqual([ACTIVE_SEASON, OLD_SEASON]);
    expect(body.players[0]).toMatchObject({
      playerId: PLAYER_ID,
      playerName: 'Profile Pat',
      avatarUrl: 'photo.png',
      displayTeam: { id: TEAM_ID, name: 'Wolves', logoUrl: 'crest.png' },
    });
    expect(deps.readPublicSeasonCatalog).toHaveBeenCalledWith(LEAGUE_ID, MAX_PUBLIC_STATS_SCOPE_SOURCE_ROWS);
    expect(deps.loadNativeSeason).toHaveBeenCalledWith(ACTIVE, null, expect.any(Number));
    expect(deps.readBadges).toHaveBeenCalledWith(LEAGUE_ID, [ACTIVE_SEASON], expect.any(Number));
    expect(deps.readBaselines).not.toHaveBeenCalled();
  });

  it('rejects foreign season, division, and tenant identities before producing stats', async () => {
    const foreignSeasonDeps = dependencies();
    const foreignSeason = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=single&seasonId=${FOREIGN_SEASON}`),
      foreignSeasonDeps,
    );
    expect(foreignSeason.status).toBe(409);
    expect(foreignSeasonDeps.loadNativeSeason).not.toHaveBeenCalled();

    const divisionDeps = dependencies();
    divisionDeps.readPublicDivision.mockResolvedValue(null);
    const division = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=current&divisionId=${DIVISION_ID}`),
      divisionDeps,
    );
    expect(division.status).toBe(400);
    expect(divisionDeps.readDivision).not.toHaveBeenCalled();
    expect(divisionDeps.loadNativeSeason).not.toHaveBeenCalled();

    const tenantDeps = dependencies();
    const tenant = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&scope=current', 'other.beerleaguehockey.ca'),
      tenantDeps,
    );
    expect(tenant.status).toBe(400);
    expect(tenantDeps.getLeagueBySlug).not.toHaveBeenCalled();
  });

  it('never exposes or selects service-role-visible seasons and divisions hidden from anon users', async () => {
    const seasonDeps = dependencies();
    seasonDeps.readPublicSeasonCatalog.mockResolvedValue([ACTIVE]);
    seasonDeps.readSeasonCatalog.mockResolvedValue([ACTIVE, HIDDEN]);
    const hiddenSeason = await handlePublicStatsScopeRequest(
      new NextRequest(
        `https://hockey-life.beerleaguehockey.ca/api/public/stats-scope?leagueSlug=hockey-life&scope=single&seasonId=${HIDDEN_SEASON}`,
        { headers: { host: 'hockey-life.beerleaguehockey.ca', cookie: 'sb-access-token=privileged-user' } },
      ),
      seasonDeps,
    );
    expect(hiddenSeason.status).toBe(409);
    expect(seasonDeps.loadNativeSeason).not.toHaveBeenCalled();
    expect(seasonDeps.readPublicSeasonCatalog).toHaveBeenCalledTimes(1);
    expect(seasonDeps.readSeasonCatalog).not.toHaveBeenCalled();

    const currentDeps = dependencies();
    currentDeps.readPublicSeasonCatalog.mockResolvedValue([ACTIVE]);
    currentDeps.readSeasonCatalog.mockResolvedValue([ACTIVE, HIDDEN]);
    const current = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), currentDeps);
    expect(current.status).toBe(200);
    expect((await current.json()).seasons.map((entry: { id: string }) => entry.id)).toEqual([ACTIVE_SEASON]);
    expect(currentDeps.readPublicSeasonCatalog.mock.invocationCallOrder[0])
      .toBeLessThan(currentDeps.readSeasonCatalog.mock.invocationCallOrder[0]);

    const divisionDeps = dependencies();
    divisionDeps.readPublicDivision.mockResolvedValue(null);
    divisionDeps.readDivision.mockResolvedValue({ id: DIVISION_ID, league_id: LEAGUE_ID });
    const hiddenDivision = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=current&divisionId=${DIVISION_ID}`),
      divisionDeps,
    );
    expect(hiddenDivision.status).toBe(400);
    expect(divisionDeps.readDivision).not.toHaveBeenCalled();
    expect(divisionDeps.loadNativeSeason).not.toHaveBeenCalled();
  });

  it('constrains all-time championship reads to every selected public season and adds imported wins once', async () => {
    const deps = dependencies();
    deps.readPublicSeasonCatalog.mockResolvedValue([OLD, HISTORICAL, ACTIVE]);
    deps.readSeasonCatalog.mockResolvedValue([OLD, HISTORICAL, ACTIVE, HIDDEN]);
    deps.readBaselines.mockResolvedValue([baseline()]);
    const storedBadges = [
      { id: BADGE_ID, player_id: PLAYER_ID, season_id: ACTIVE_SEASON },
      { id: '61000000-0000-4000-8000-000000000006', player_id: PLAYER_ID, season_id: OLD_SEASON },
      { id: '62000000-0000-4000-8000-000000000006', player_id: PLAYER_ID, season_id: HIDDEN_SEASON },
    ];
    deps.readBadges.mockImplementation(async (_leagueId, seasonIds) => storedBadges.filter((badge) =>
      seasonIds?.includes(badge.season_id) ?? true));

    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), deps);
    expect(response.status).toBe(200);
    expect(deps.readBadges).toHaveBeenCalledWith(
      LEAGUE_ID,
      [ACTIVE_SEASON, OLD_SEASON],
      expect.any(Number),
    );
    const body = await response.json();
    expect(body.scope.seasonIds).toEqual([ACTIVE_SEASON, OLD_SEASON]);
    expect(body.players[0].skater.championships).toEqual({
      value: 4,
      state: 'reported',
      sources: ['imported', 'player_badges'],
    });
  });

  it('keeps all-time championship zero verified after a complete selected-season badge read', async () => {
    const deps = dependencies();
    deps.readBadges.mockResolvedValue([]);

    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), deps);
    expect(response.status).toBe(200);
    expect(deps.readBadges).toHaveBeenCalledWith(
      LEAGUE_ID,
      [ACTIVE_SEASON, OLD_SEASON],
      expect.any(Number),
    );
    const body = await response.json();
    expect(body.players[0].skater.championships).toEqual({
      value: 0,
      state: 'verified',
      sources: ['player_badges'],
    });
  });

  it('rejects all-time division filtering and exact-query abuse', async () => {
    const division = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=all&divisionId=${DIVISION_ID}`),
      dependencies(),
    );
    expect(division.status).toBe(422);

    const duplicate = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&leagueSlug=hockey-life&scope=current'),
      dependencies(),
    );
    expect(duplicate.status).toBe(400);

    const unknown = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&scope=current&debug=true'),
      dependencies(),
    );
    expect(unknown.status).toBe(400);

    const seasonIds = Array.from({ length: 33 }, (_, index) =>
      `8${String(index).padStart(7, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const overLimit = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=multiple&${seasonIds.map((id) => `seasonId=${id}`).join('&')}`),
      dependencies(),
    );
    expect(overLimit.status).toBe(413);
  });

  it('excludes the Hockey Life Winter 2026 aggregate carrier from native work and preserves imported goalie semantics', async () => {
    const winter = season(HLHL_WINTER_2026_SEASON_ID, 'Winter 2026', 'completed', '2026-01-01');
    const deps = dependencies();
    deps.readPublicSeasonCatalog.mockResolvedValue([ACTIVE, winter]);
    deps.readSeasonCatalog.mockResolvedValue([ACTIVE, winter]);
    deps.loadImportedAggregateSeason.mockResolvedValue(payload(winter, {
      gamesPlayed: publicMetric(10, 'reported', ['imported']),
      goals: publicMetric(12, 'reported', ['imported']),
      assists: publicMetric(7, 'reported', ['imported']),
      points: publicMetric(19, 'reported', ['imported']),
      goalieGames: publicMetric(10, 'reported', ['imported']),
      goalsAgainst: publicMetric(33, 'reported', ['imported']),
    }));
    deps.readBaselines.mockResolvedValue([baseline()]);
    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope.seasonIds).toEqual([ACTIVE_SEASON, HLHL_WINTER_2026_SEASON_ID]);
    expect(deps.loadNativeSeason).toHaveBeenCalledTimes(1);
    expect(deps.loadNativeSeason).toHaveBeenCalledWith(ACTIVE, null, expect.any(Number));
    expect(deps.loadImportedAggregateSeason).toHaveBeenCalledWith(winter, null, expect.any(Number));
    expect(body.players[0].goalie).toMatchObject({
      gamesPlayed: { value: 12, state: 'reported' },
      goalsAgainst: { value: 38, state: 'reported' },
    });
    expect(body.players[0].goalie.goalsAgainstAverage.value).toBeCloseTo(38 / 12);
    expect(body.players[0].skater).toMatchObject({
      goals: { value: 18 },
      assists: { value: 13 },
      points: { value: 31 },
    });
  });

  it('accepts multiple authoritative baseline source rows for the same player', async () => {
    const deps = dependencies();
    deps.readBaselines.mockResolvedValue([
      baseline(),
      baseline({
        id: '71000000-0000-4000-8000-000000000007',
        games_played: 2,
        goals: 1,
        assists: 1,
        points: 2,
        moosehead_cup_wins: 0,
      }),
      baseline({
        id: '71000000-0000-4000-8000-000000000008',
        is_goalie: true,
        games_played: 3,
        goals: 0,
        assists: 0,
        points: 0,
        goals_against: 6,
        moosehead_cup_wins: 0,
      }),
    ]);

    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.players[0].skater.gamesPlayed.value).toBe(16);
    expect(body.players[0].goalie.gamesPlayed.value).toBe(7);
  });

  it('fails closed on duplicate baseline rows, badge incompleteness, missing profiles, and producer identity mismatch', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const baselineDeps = dependencies();
    baselineDeps.readBaselines.mockResolvedValue([baseline(), baseline()]);
    const baselineResponse = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), baselineDeps);
    expect(baselineResponse.status).toBe(503);

    const baselineArithmeticDeps = dependencies();
    baselineArithmeticDeps.readBaselines.mockResolvedValue([baseline({ points: 99 })]);
    expect((await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), baselineArithmeticDeps)).status).toBe(503);

    const duplicateBadgeDeps = dependencies();
    duplicateBadgeDeps.readBadges.mockResolvedValue([
      { id: BADGE_ID, player_id: PLAYER_ID, season_id: ACTIVE_SEASON },
      { id: '61000000-0000-4000-8000-000000000006', player_id: PLAYER_ID, season_id: ACTIVE_SEASON },
    ]);
    expect((await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), duplicateBadgeDeps)).status).toBe(503);

    const overlapBadgeDeps = dependencies();
    overlapBadgeDeps.readBadges.mockResolvedValue([{
      id: BADGE_ID,
      player_id: PLAYER_ID,
      season_id: HISTORICAL_SEASON,
    }]);
    expect((await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=all'), overlapBadgeDeps)).status).toBe(503);

    const hiddenBadgeDeps = dependencies();
    hiddenBadgeDeps.readSeasonCatalog.mockResolvedValue([OLD, HISTORICAL, ACTIVE, HIDDEN]);
    hiddenBadgeDeps.readBadges.mockResolvedValue([{
      id: BADGE_ID,
      player_id: PLAYER_ID,
      season_id: HIDDEN_SEASON,
    }]);
    const hiddenBadgeResponse = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&scope=all'),
      hiddenBadgeDeps,
    );
    expect(hiddenBadgeResponse.status).toBe(503);
    expect(hiddenBadgeResponse.headers.get('cache-control')).toBe('no-store');

    const badgeDeps = dependencies();
    badgeDeps.readBadges.mockRejectedValue(new Error('private later page detail'));
    const badgeResponse = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), badgeDeps);
    expect(badgeResponse.status).toBe(503);
    expect(badgeResponse.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await badgeResponse.json())).not.toContain('private later page detail');

    const profileDeps = dependencies();
    profileDeps.readProfiles.mockResolvedValue([]);
    expect((await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), profileDeps)).status).toBe(503);

    const identityDeps = dependencies();
    identityDeps.loadNativeSeason.mockResolvedValue(payload({ ...ACTIVE, league_id: '90000000-0000-4000-8000-000000000009' }));
    expect((await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), identityDeps)).status).toBe(503);

    log.mockRestore();
  });

  it('maps producer and response work limits to a safe 413', async () => {
    const deps = dependencies();
    deps.loadNativeSeason.mockRejectedValue(new PublicStatsScopeLimitError('source detail'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), deps);
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const responseBytesDeps = dependencies();
    const basePayload = payload(ACTIVE);
    const playerIds = Array.from({ length: 520 }, (_, index) =>
      `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    responseBytesDeps.loadNativeSeason.mockResolvedValue({
      ...basePayload,
      sourceRowCount: playerIds.length,
      players: playerIds.map((playerId) => ({ ...basePayload.players[0], playerId })),
    });
    responseBytesDeps.readProfiles.mockResolvedValue(playerIds.map((id) => ({
      id,
      full_name: 'Player',
      avatar_url: 'x'.repeat(2_048),
      photo_url: null,
    })));
    const responseBytes = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&scope=current'),
      responseBytesDeps,
    );
    log.mockRestore();
    expect(responseBytes.status).toBe(413);
    expect(responseBytes.headers.get('cache-control')).toBe('no-store');
  });

  it('stops before a later season or support read when the global row budget is exhausted', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const seasonDeps = dependencies();
    seasonDeps.loadNativeSeason.mockImplementationOnce(async (selected, _divisionId, maxSourceRows) => ({
      ...payload(selected),
      sourceRowCount: maxSourceRows,
    }));
    const seasonResponse = await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=multiple&seasonId=${ACTIVE_SEASON}&seasonId=${OLD_SEASON}`),
      seasonDeps,
    );
    expect(seasonResponse.status).toBe(413);
    expect(seasonDeps.loadNativeSeason).toHaveBeenCalledTimes(1);
    expect(seasonDeps.readBadges).not.toHaveBeenCalled();

    const supportDeps = dependencies();
    supportDeps.loadNativeSeason.mockImplementationOnce(async (selected, _divisionId, maxSourceRows) => ({
      ...payload(selected),
      sourceRowCount: maxSourceRows - 1,
    }));
    const supportResponse = await handlePublicStatsScopeRequest(
      request('leagueSlug=hockey-life&scope=current'),
      supportDeps,
    );
    log.mockRestore();
    expect(supportResponse.status).toBe(413);
    expect(supportDeps.readBadges).toHaveBeenCalledWith(LEAGUE_ID, [ACTIVE_SEASON], 1);
    expect(supportDeps.readProfiles).not.toHaveBeenCalled();
  });

  it('matches every mobile v1 field limit at the boundary and fails one over', async () => {
    const run = async (configure: (deps: jest.Mocked<PublicStatsScopeDependencies>) => void) => {
      const deps = dependencies();
      configure(deps);
      return handlePublicStatsScopeRequest(request('leagueSlug=hockey-life&scope=current'), deps);
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: 'é'.repeat(200), avatar_url: null, photo_url: null,
    }]))).status).toBe(200);
    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: 'é'.repeat(201), avatar_url: null, photo_url: null,
    }]))).status).toBe(503);
    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: `${'n'.repeat(200)} `, avatar_url: null, photo_url: null,
    }]))).status).toBe(503);
    expect((await run((deps) => deps.loadNativeSeason.mockImplementation(async (selected) => {
      const produced = payload(selected);
      produced.players[0].playerName = 'p'.repeat(200);
      return produced;
    }))).status).toBe(200);
    expect((await run((deps) => deps.loadNativeSeason.mockImplementation(async (selected) => {
      const produced = payload(selected);
      produced.players[0].playerName = 'p'.repeat(201);
      return produced;
    }))).status).toBe(503);

    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: 'Pat', avatar_url: 'a'.repeat(2_048), photo_url: null,
    }]))).status).toBe(200);
    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: 'Pat', avatar_url: 'a'.repeat(2_049), photo_url: null,
    }]))).status).toBe(503);
    expect((await run((deps) => deps.readProfiles.mockResolvedValue([{
      id: PLAYER_ID, full_name: 'Pat', avatar_url: `${'a'.repeat(2_048)} `, photo_url: null,
    }]))).status).toBe(503);

    const exactShort = season(ACTIVE_SEASON, 'Fall 2026', 's'.repeat(40), 'd'.repeat(40));
    expect((await run((deps) => {
      deps.readPublicSeasonCatalog.mockResolvedValue([exactShort]);
      deps.readSeasonCatalog.mockResolvedValue([exactShort]);
    })).status).toBe(200);
    const overStatus = { ...exactShort, status: 's'.repeat(41) };
    expect((await run((deps) => {
      deps.readPublicSeasonCatalog.mockResolvedValue([overStatus]);
      deps.readSeasonCatalog.mockResolvedValue([overStatus]);
    })).status).toBe(503);
    const overDate = { ...exactShort, start_date: 'd'.repeat(41) };
    expect((await run((deps) => {
      deps.readPublicSeasonCatalog.mockResolvedValue([overDate]);
      deps.readSeasonCatalog.mockResolvedValue([overDate]);
    })).status).toBe(503);

    expect((await run((deps) => deps.loadNativeSeason.mockImplementation(async (selected) => payload(selected, {
      gamesPlayed: publicMetric(10_000_000),
    })))).status).toBe(200);
    expect((await run((deps) => deps.loadNativeSeason.mockImplementation(async (selected) => payload(selected, {
      gamesPlayed: publicMetric(10_000_001),
    })))).status).toBe(503);
    expect((await run((deps) => {
      deps.readPublicSeasonCatalog.mockResolvedValue([ACTIVE, OLD]);
      deps.readSeasonCatalog.mockResolvedValue([ACTIVE, OLD]);
      deps.loadNativeSeason.mockImplementation(async (selected) => payload(selected, {
        gamesPlayed: publicMetric(6_000_000),
      }));
    })).status).toBe(200);
    expect((await handlePublicStatsScopeRequest(
      request(`leagueSlug=hockey-life&scope=multiple&seasonId=${ACTIVE_SEASON}&seasonId=${OLD_SEASON}`),
      (() => {
        const deps = dependencies();
        deps.loadNativeSeason.mockImplementation(async (selected) => payload(selected, {
          gamesPlayed: publicMetric(6_000_000),
        }));
        return deps;
      })(),
    )).status).toBe(503);

    expect(() => assertPublicStatsScopeResponseBytes('é'.repeat(MAX_PUBLIC_STATS_SCOPE_RESPONSE_BYTES / 2))).not.toThrow();
    expect(() => assertPublicStatsScopeResponseBytes(`x${'é'.repeat(MAX_PUBLIC_STATS_SCOPE_RESPONSE_BYTES / 2)}`))
      .toThrow(PublicStatsScopeLimitError);
    log.mockRestore();
  });
});
