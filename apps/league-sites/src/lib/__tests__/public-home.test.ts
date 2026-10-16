import { NextRequest } from 'next/server';

import {
  getCurrentSeason,
  getDivisions,
  getLeagueBySlug,
  getStandings,
  hasPlatformSubscription,
} from '@/lib/data';
import type {
  Division,
  League,
  Season,
  TeamStanding,
} from '@/lib/types';
import {
  MAX_STANDINGS_ROWS,
  buildPublicHomeLeaders,
  handlePublicHomeRequest,
} from '@/lib/public-home';
import {
  aggregatePublicSeasonStats,
  readPublicStatMetricRows,
  type PublicMetricState,
  type PublicSeasonMetricPlayer,
} from '@/lib/public-stat-metrics';
import { GET, dynamic } from '@/app/api/public/home/route';

jest.mock('@/lib/data', () => ({
  getCurrentSeason: jest.fn(),
  getDivisions: jest.fn(),
  getLeagueBySlug: jest.fn(),
  getStandings: jest.fn(),
  hasPlatformSubscription: jest.fn(),
}));
jest.mock('@/lib/public-stat-metrics', () => ({
  aggregatePublicSeasonStats: jest.fn(),
  readPublicStatMetricRows: jest.fn(),
}));

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';

const mockedGetLeagueBySlug = jest.mocked(getLeagueBySlug);
const mockedHasPlatformSubscription = jest.mocked(hasPlatformSubscription);
const mockedGetCurrentSeason = jest.mocked(getCurrentSeason);
const mockedGetDivisions = jest.mocked(getDivisions);
const mockedGetStandings = jest.mocked(getStandings);
const mockedAggregatePublicSeasonStats = jest.mocked(aggregatePublicSeasonStats);
const mockedReadPublicStatMetricRows = jest.mocked(readPublicStatMetricRows);

function policyMetric(value: number | null, state: PublicMetricState = value === null ? 'unknown' : 'recorded') {
  return { value, state, sources: value === null ? [] : ['skater_stats'] } as const;
}

function policyPlayer(
  playerId: string,
  playerName: string,
  goals: ReturnType<typeof policyMetric>,
  assists: ReturnType<typeof policyMetric>,
  points: ReturnType<typeof policyMetric>,
): PublicSeasonMetricPlayer {
  return {
    playerId,
    playerName,
    avatarUrl: `https://images.example/${playerId}.png`,
    displayTeam: { id: `team-${playerId}`, name: `Current ${playerId}` },
    teams: [{ id: `team-${playerId}`, name: `Current ${playerId}` }],
    roles: ['skater'],
    metrics: {
      gamesPlayed: policyMetric(8, 'reported'),
      goals,
      assists,
      points,
      penaltyMinutes: policyMetric(null),
    },
    goalie: null,
  } as PublicSeasonMetricPlayer;
}

function request(
  query = `leagueSlug=hockey-life&seasonId=${SEASON_ID}`,
  host = 'hockey-life.beerleaguehockey.ca',
  method = 'GET',
) {
  return new NextRequest(`https://${host}/api/public/home?${query}`, {
    method,
    headers: { host },
  });
}

function canonicalPlayer(
  playerId: string,
  playerName: string,
  goals: number,
  assists: number,
  extras: Record<string, unknown> = {},
) {
  const player = policyPlayer(
    playerId,
    playerName,
    policyMetric(goals),
    policyMetric(assists),
    policyMetric(goals + assists),
  );
  if ('goals' in extras) {
    player.metrics.goals = { value: extras.goals as number, state: 'recorded', sources: ['skater_stats'] };
  }
  return player;
}

function canonicalStanding(index = 0) {
  return {
    team_id: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    team_name: `Team ${index}`,
    team_logo: `https://images.example/standing-${index}.png`,
    division_id: DIVISION_ID,
    division_name: 'A Division',
    team_type: 'standard',
    games_played: 12,
    wins: 8,
    losses: 3,
    ties: 1,
    goals_for: 42,
    goals_against: 30,
    goal_differential: 12,
    points: 17,
    overtime_losses: 9,
    private_note: 'do not expose',
  } as unknown as TeamStanding;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetLeagueBySlug.mockResolvedValue({
    id: LEAGUE_ID,
    slug: 'hockey-life',
    status: 'active',
    contact_email: 'owner@private.example',
    custom_domain: null,
    custom_domain_verified: false,
  } as unknown as League);
  mockedHasPlatformSubscription.mockResolvedValue(true);
  mockedGetCurrentSeason.mockResolvedValue({
    id: SEASON_ID,
    league_id: LEAGUE_ID,
    name: 'Fall 2026',
    status: 'active',
    start_date: '2026-09-01',
    end_date: '2026-12-20',
    created_at: '2026-08-01T00:00:00.000Z',
  } as unknown as Season);
  mockedGetDivisions.mockResolvedValue([
    { id: DIVISION_ID, league_id: LEAGUE_ID, name: 'A Division', sort_order: 1 },
  ] as Division[]);
  mockedReadPublicStatMetricRows.mockResolvedValue({} as never);
  mockedAggregatePublicSeasonStats.mockReturnValue({
    players: [canonicalPlayer('player-a', 'Alex Alpha', 5, 3)],
    coverage: { participation: [], penalties: [], goalies: [] },
  });
  mockedGetStandings.mockResolvedValue([canonicalStanding(1)]);
});

describe('public Home numeric integrity', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, '4'])(
    'rejects invalid canonical numeric facts rather than publishing invented zeros: %s',
    async (invalid) => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        mockedAggregatePublicSeasonStats.mockReturnValue({
          players: [canonicalPlayer('player-a', 'Alex Alpha', 5, 3, { goals: invalid })],
          coverage: { participation: [], penalties: [], goalies: [] },
        });
        const response = await GET(request(), { params: Promise.resolve({}) });
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: {
          code: 'HOME_DATA_UNAVAILABLE', message: 'Public Home data is temporarily unavailable.',
        } });
      } finally {
        log.mockRestore();
      }
    },
  );
});

describe('public Home leader DTO', () => {
  it('ranks only publishable policy metrics and retains an authoritative zero', () => {
    const rows = [
      policyPlayer('estimated', 'Estimated', policyMetric(99, 'estimated'), policyMetric(0, 'estimated'), policyMetric(99, 'estimated')),
      policyPlayer('conflicted', 'Conflicted', policyMetric(98, 'conflicted'), policyMetric(0, 'conflicted'), policyMetric(98, 'conflicted')),
      policyPlayer('zero', 'Recorded Zero', policyMetric(0), policyMetric(0), policyMetric(0)),
    ];

    expect(buildPublicHomeLeaders(rows as never).map((leader) => leader.player_id)).toEqual(['zero']);
  });

  it('keeps a metric-specific cutoff tie within the strict first-five visible limit', () => {
    const values = [9, 8, 7, 6, 5, 5];
    const rows = values.map((value, index) => policyPlayer(
      `p${index + 1}`,
      `Player ${index + 1}`,
      policyMetric(value),
      policyMetric(null),
      policyMetric(null),
    ));

    expect(buildPublicHomeLeaders(rows).map((leader) => leader.player_id)).toEqual([
      'p1', 'p2', 'p3', 'p4', 'p5',
    ]);
  });

  it('caps the disjoint Goals, Assists, and Points union at fifteen skaters', () => {
    const rows = (['goals', 'assists', 'points'] as const).flatMap((metric) =>
      Array.from({ length: 6 }, (_, index) => {
        const values = {
          goals: policyMetric(null),
          assists: policyMetric(null),
          points: policyMetric(null),
        };
        values[metric] = policyMetric(6 - index);
        return policyPlayer(`${metric}-${index + 1}`, `${metric} ${index + 1}`, values.goals, values.assists, values.points);
      }));

    const leaders = buildPublicHomeLeaders(rows);

    expect(leaders).toHaveLength(15);
    expect(leaders.map((leader) => leader.player_id)).toEqual([
      'goals-1', 'goals-2', 'goals-3', 'goals-4', 'goals-5',
      'assists-1', 'assists-2', 'assists-3', 'assists-4', 'assists-5',
      'points-1', 'points-2', 'points-3', 'points-4', 'points-5',
    ]);
  });

  it('returns the canonical-ID union of positive top-five goals, assists, and points with deterministic ties', () => {
    const rows = [
      canonicalPlayer('p1', 'Zed Same', 10, 0),
      canonicalPlayer('p2', 'Amy Same', 10, 0),
      canonicalPlayer('p3', 'Chris', 9, 1),
      canonicalPlayer('p4', 'Dana', 8, 8),
      canonicalPlayer('p5', 'Evan', 7, 9),
      canonicalPlayer('p6', 'Fran', 6, 10),
      canonicalPlayer('p7', 'Gale', 0, 11),
      canonicalPlayer('p8', 'Alex Duplicate Name', 0, 12),
      canonicalPlayer('p9', 'Alex Duplicate Name', 0, 13),
      canonicalPlayer('zero', 'Zero', 0, 0),
    ];

    const leaders = buildPublicHomeLeaders(rows);

    expect(leaders.map((leader) => leader.player_id)).toEqual([
      'p2', 'p1', 'p3', 'p4', 'p5',
      'p9', 'p8', 'p7', 'p6',
    ]);
    expect(leaders).toHaveLength(9);
    // Exact DTO keys prove that producer-only/private columns are dropped.
    // eslint-disable-next-line supabase-test-quality/no-mock-echo
    expect(leaders.every((leader) => Object.keys(leader).sort().join(',') === [
      'assists',
      'avatar_url',
      'display_team_logo_url',
      'display_team_name',
      'goals',
      'player_id',
      'player_name',
      'points',
      'position',
      'team_id',
      'team_name',
    ].sort().join(','))).toBe(true);
  });
});

describe('GET /api/public/home', () => {
  it('is mounted as a dynamic GET route and returns only the version-1 public DTO', async () => {
    mockedGetStandings.mockResolvedValue([{ ...canonicalStanding(1), team_id: 'team-player-a' }]);
    const response = await GET(request(), { params: Promise.resolve({}) });
    const payload = await response.json();

    expect(dynamic).toBe('force-dynamic');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(payload).toEqual({
      schemaVersion: 1,
      leagueId: LEAGUE_ID,
      leagueSlug: 'hockey-life',
      presentationSeason: {
        id: SEASON_ID,
        league_id: LEAGUE_ID,
        name: 'Fall 2026',
        status: 'active',
        start_date: '2026-09-01',
        end_date: '2026-12-20',
        created_at: '2026-08-01T00:00:00.000Z',
      },
      leaders: [{
        player_id: 'player-a',
        player_name: 'Alex Alpha',
        avatar_url: 'https://images.example/player-a.png',
        team_id: 'team-player-a',
        team_name: 'Current player-a',
        display_team_name: 'Current player-a',
        display_team_logo_url: 'https://images.example/standing-1.png',
        position: null,
        goals: 5,
        assists: 3,
        points: 8,
      }],
      standings: [{
        team_id: 'team-player-a',
        team_name: 'Team 1',
        logo_url: 'https://images.example/standing-1.png',
        primary_color: null,
        division_id: DIVISION_ID,
        division_name: 'A Division',
        team_type: 'standard',
        games_played: 12,
        wins: 8,
        losses: 3,
        ties: 1,
        goals_for: 42,
        goals_against: 30,
        goal_differential: 12,
        points: 17,
      }],
      divisions: [{ id: DIVISION_ID, name: 'A Division', sort_order: 1 }],
    });
    expect(JSON.stringify(payload)).not.toMatch(/owner@|private_note|championships|overtime_losses|email/);
    const scope = { leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: null };
    expect(mockedReadPublicStatMetricRows).toHaveBeenCalledWith(scope);
    expect(mockedAggregatePublicSeasonStats).toHaveBeenCalledWith(expect.anything(), scope);
    expect(mockedGetStandings).toHaveBeenCalledWith(LEAGUE_ID, SEASON_ID);
  });

  it.each([
    ['', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&leagueSlug=other', 'INVALID_QUERY'],
    ['leagueSlug=hockey‑life', 'INVALID_LEAGUE_SLUG'],
    ['leagueSlug=hockey-life&wat=1', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&seasonId=nope', 'INVALID_SEASON_ID'],
    ['leagueSlug=hockey-life&divisionId=nope', 'INVALID_DIVISION_ID'],
  ])('rejects malformed query %s before reads', async (query, code) => {
    const response = await GET(request(query), { params: Promise.resolve({}) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(mockedGetLeagueBySlug).not.toHaveBeenCalled();
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
  });

  it('rejects a known tenant host/query mismatch before canonical aggregators', async () => {
    const response = await GET(
      request('leagueSlug=hockey-life', 'other-league.beerleaguehockey.ca'),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('TENANT_MISMATCH');
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
    expect(mockedGetStandings).not.toHaveBeenCalled();
  });

  it('allows documented localhost fixture routing without treating it as a production tenant bypass', async () => {
    const response = await GET(
      request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}`, 'localhost:3001'),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
  });

  it('accepts only the resolved league verified custom domain for external tenant hosts', async () => {
    mockedGetLeagueBySlug.mockResolvedValue({
      id: LEAGUE_ID,
      slug: 'hockey-life',
      status: 'active',
      custom_domain: 'hockeylife.example',
      custom_domain_verified: true,
    } as unknown as League);

    const accepted = await GET(
      request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}`, 'hockeylife.example'),
      { params: Promise.resolve({}) },
    );
    expect(accepted.status).toBe(200);

    jest.clearAllMocks();
    mockedGetLeagueBySlug.mockResolvedValue({
      id: LEAGUE_ID,
      slug: 'hockey-life',
      status: 'active',
      custom_domain: 'hockeylife.example',
      custom_domain_verified: true,
    } as unknown as League);
    const rejected = await GET(
      request('leagueSlug=hockey-life', 'another.example'),
      { params: Promise.resolve({}) },
    );
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe('TENANT_MISMATCH');
    expect(mockedHasPlatformSubscription).not.toHaveBeenCalled();
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown or inactive leagues before subscription/stat reads', async () => {
    mockedGetLeagueBySlug.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('LEAGUE_NOT_FOUND');
    expect(mockedHasPlatformSubscription).not.toHaveBeenCalled();
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
  });

  it('applies the existing web subscription gate before season/division/aggregator reads', async () => {
    mockedHasPlatformSubscription.mockResolvedValue(false);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('LEAGUE_NOT_FOUND');
    expect(mockedGetCurrentSeason).not.toHaveBeenCalled();
    expect(mockedGetDivisions).not.toHaveBeenCalled();
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
  });

  it('rejects a division outside the resolved league before aggregators', async () => {
    const otherDivision = '30000000-0000-4000-8000-000000000099';
    const response = await GET(
      request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&divisionId=${otherDivision}`),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('DIVISION_NOT_IN_LEAGUE');
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
    expect(mockedGetStandings).not.toHaveBeenCalled();
  });

  it('uses seasonId only as a 409 version guard before aggregators', async () => {
    const staleSeason = '20000000-0000-4000-8000-000000000099';
    const response = await GET(
      request(`leagueSlug=hockey-life&seasonId=${staleSeason}`),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'SEASON_MISMATCH',
        message: 'The presentation season changed; refresh league Home data.',
        presentationSeasonId: SEASON_ID,
      },
    });
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
    expect(mockedGetStandings).not.toHaveBeenCalled();
  });

  it('returns a bounded factual empty when there is no season and never requests all-time stats', async () => {
    mockedGetCurrentSeason.mockResolvedValue(null);
    const response = await GET(request('leagueSlug=hockey-life'), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      presentationSeason: null,
      leaders: [],
      standings: [],
    });
    expect(mockedReadPublicStatMetricRows).not.toHaveBeenCalled();
    expect(mockedGetStandings).not.toHaveBeenCalled();
  });

  it('distinguishes a successful canonical empty from a producer failure', async () => {
    mockedAggregatePublicSeasonStats.mockReturnValue({
      players: [],
      coverage: { participation: [], penalties: [], goalies: [] },
    });
    mockedGetStandings.mockResolvedValue([]);
    const emptyResponse = await GET(request(), { params: Promise.resolve({}) });
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toMatchObject({ leaders: [], standings: [] });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockedGetStandings.mockRejectedValue(new Error('provider secret detail'));
      const errorResponse = await GET(request(), { params: Promise.resolve({}) });
      expect(errorResponse.status).toBe(503);
      expect(await errorResponse.json()).toEqual({
        error: {
          code: 'HOME_DATA_UNAVAILABLE',
          message: 'Public Home data is temporarily unavailable.',
        },
      });
      expect(consoleError).toHaveBeenCalledWith(
        '[public-home] public read failed',
        { leagueSlug: 'hockey-life', errorType: 'Error' },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('provider secret detail');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('filters standings by division while leaving the canonical standings call league-season scoped', async () => {
    mockedGetStandings.mockResolvedValue([
      canonicalStanding(1),
      { ...canonicalStanding(2), division_id: '30000000-0000-4000-8000-000000000004' },
    ]);
    const response = await GET(
      request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&divisionId=${DIVISION_ID}`),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).standings).toHaveLength(1);
    expect(mockedReadPublicStatMetricRows).toHaveBeenCalledWith({
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      divisionId: DIVISION_ID,
    });
    expect(mockedGetStandings).toHaveBeenCalledWith(LEAGUE_ID, SEASON_ID);
  });

  it('accepts the documented maximum complete standings payload and rejects overflow instead of truncating', async () => {
    mockedGetStandings.mockResolvedValue(
      Array.from({ length: MAX_STANDINGS_ROWS }, (_, index) => canonicalStanding(index)),
    );
    const maxResponse = await GET(request(), { params: Promise.resolve({}) });
    expect(maxResponse.status).toBe(200);
    expect((await maxResponse.json()).standings).toHaveLength(MAX_STANDINGS_ROWS);

    mockedGetStandings.mockResolvedValue(
      Array.from({ length: MAX_STANDINGS_ROWS + 1 }, (_, index) => canonicalStanding(index)),
    );
    const overflowResponse = await GET(request(), { params: Promise.resolve({}) });
    expect(overflowResponse.status).toBe(503);
    expect((await overflowResponse.json()).error.code).toBe('PAYLOAD_LIMIT_EXCEEDED');
  });

  it('rejects non-GET methods without invoking any read boundary', async () => {
    const response = await handlePublicHomeRequest(request('leagueSlug=hockey-life', 'localhost:3001', 'PATCH'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect((await response.json()).error.code).toBe('METHOD_NOT_ALLOWED');
    expect(mockedGetLeagueBySlug).not.toHaveBeenCalled();
  });
});
