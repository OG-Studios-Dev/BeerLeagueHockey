import { NextRequest } from 'next/server';

import {
  getCurrentSeason,
  getDivisions,
  getLeagueBySlug,
  getStandings,
  getUnifiedSkaterStatsRows,
  hasPlatformSubscription,
} from '@/lib/data';
import type {
  Division,
  League,
  Season,
  TeamStanding,
  UnifiedSkaterStatsRow,
} from '@/lib/types';
import {
  MAX_STANDINGS_ROWS,
  buildPublicHomeLeaders,
  handlePublicHomeRequest,
} from '@/lib/public-home';
import { GET, dynamic } from '@/app/api/public/home/route';

jest.mock('@/lib/data', () => ({
  getCurrentSeason: jest.fn(),
  getDivisions: jest.fn(),
  getLeagueBySlug: jest.fn(),
  getStandings: jest.fn(),
  getUnifiedSkaterStatsRows: jest.fn(),
  hasPlatformSubscription: jest.fn(),
}));

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';

const mockedGetLeagueBySlug = jest.mocked(getLeagueBySlug);
const mockedHasPlatformSubscription = jest.mocked(hasPlatformSubscription);
const mockedGetCurrentSeason = jest.mocked(getCurrentSeason);
const mockedGetDivisions = jest.mocked(getDivisions);
const mockedGetStandings = jest.mocked(getStandings);
const mockedGetUnifiedSkaterStatsRows = jest.mocked(getUnifiedSkaterStatsRows);

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
  return {
    player_id: playerId,
    player_name: playerName,
    avatar_url: `https://images.example/${playerId}.png`,
    team_id: `team-${playerId}`,
    team_name: `Recorded ${playerId}`,
    display_team_name: `Current ${playerId}`,
    display_team_logo_url: `https://images.example/team-${playerId}.png`,
    position: 'C',
    goals,
    assists,
    points: goals + assists,
    games_played: 8,
    championships: 2,
    email: `${playerId}@private.example`,
    ...extras,
  } as unknown as UnifiedSkaterStatsRow;
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
  mockedGetUnifiedSkaterStatsRows.mockResolvedValue([
    canonicalPlayer('player-a', 'Alex Alpha', 5, 3),
  ]);
  mockedGetStandings.mockResolvedValue([canonicalStanding(1)]);
});

describe('public Home numeric integrity', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, '4'])(
    'rejects invalid canonical numeric facts rather than publishing invented zeros: %s',
    async (invalid) => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        mockedGetUnifiedSkaterStatsRows.mockResolvedValue([
          canonicalPlayer('player-a', 'Alex Alpha', 5, 3, { goals: invalid }),
        ]);
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
        team_name: 'Recorded player-a',
        display_team_name: 'Current player-a',
        display_team_logo_url: 'https://images.example/team-player-a.png',
        position: 'C',
        goals: 5,
        assists: 3,
        points: 8,
      }],
      standings: [{
        team_id: '40000000-0000-4000-8000-000000000001',
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
    expect(mockedGetUnifiedSkaterStatsRows).toHaveBeenCalledWith(
      LEAGUE_ID,
      SEASON_ID,
      undefined,
      'hockey-life',
      'Fall 2026',
    );
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
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
  });

  it('rejects a known tenant host/query mismatch before canonical aggregators', async () => {
    const response = await GET(
      request('leagueSlug=hockey-life', 'other-league.beerleaguehockey.ca'),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('TENANT_MISMATCH');
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
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
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown or inactive leagues before subscription/stat reads', async () => {
    mockedGetLeagueBySlug.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('LEAGUE_NOT_FOUND');
    expect(mockedHasPlatformSubscription).not.toHaveBeenCalled();
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
  });

  it('applies the existing web subscription gate before season/division/aggregator reads', async () => {
    mockedHasPlatformSubscription.mockResolvedValue(false);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('LEAGUE_NOT_FOUND');
    expect(mockedGetCurrentSeason).not.toHaveBeenCalled();
    expect(mockedGetDivisions).not.toHaveBeenCalled();
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
  });

  it('rejects a division outside the resolved league before aggregators', async () => {
    const otherDivision = '30000000-0000-4000-8000-000000000099';
    const response = await GET(
      request(`leagueSlug=hockey-life&seasonId=${SEASON_ID}&divisionId=${otherDivision}`),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('DIVISION_NOT_IN_LEAGUE');
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
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
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
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
    expect(mockedGetUnifiedSkaterStatsRows).not.toHaveBeenCalled();
    expect(mockedGetStandings).not.toHaveBeenCalled();
  });

  it('distinguishes a successful canonical empty from a producer failure', async () => {
    mockedGetUnifiedSkaterStatsRows.mockResolvedValue([]);
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
    expect(mockedGetUnifiedSkaterStatsRows).toHaveBeenCalledWith(
      LEAGUE_ID, SEASON_ID, DIVISION_ID, 'hockey-life', 'Fall 2026',
    );
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
