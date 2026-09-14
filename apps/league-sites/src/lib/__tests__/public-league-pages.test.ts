import { NextRequest } from 'next/server';

import {
  assertValidLeaguePageResponse,
  handlePublicLeaguePagesRequest,
  MAX_PUBLIC_LEAGUE_PAGES_RESPONSE_BYTES,
  type PublicLeaguePagesDependencies,
} from '@/lib/public-league-pages';
import {
  buildPublicPlayers,
  buildPublicPlayoffs,
  buildPublicPositioning,
  buildPublicTeams,
  loadPublicLeaguePageCatalogFromClient,
  loadPublicLeaguePageSeasonDataFromClient,
  readCompletePages,
} from '@/lib/public-league-pages-loader';
import type { PageTeam } from '@/lib/public-league-pages-contract';
import { GET, dynamic } from '@/app/api/public/league-pages/route';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const TEAM_A = '40000000-0000-4000-8000-000000000004';
const TEAM_B = '40000000-0000-4000-8000-000000000005';
const PLAYER_A = '50000000-0000-4000-8000-000000000006';
const PLAYER_B = '50000000-0000-4000-8000-000000000007';
const GAME_ID = '70000000-0000-4000-8000-000000000008';
const SERIES_ID = 'a0000000-0000-4000-8000-000000000001';

type SourceTrace = {
  source: string;
  columns: string;
  options: unknown;
  args?: Record<string, unknown>;
  filters: Array<[string, ...unknown[]]>;
  orders: Array<[string, unknown]>;
  ranges: Array<[number, number]>;
};

function semanticSourceClient(
  rowsBySource: Record<string, unknown[]>,
  fault?: { source: string; from: number; kind: 'error' | 'count-change' | 'incomplete' | 'underreport' },
) {
  const traces: SourceTrace[] = [];
  const build = (source: string, columns: string, options: unknown, args?: Record<string, unknown>) => {
    const trace: SourceTrace = { source, columns, options, args, filters: [], orders: [], ranges: [] };
    traces.push(trace);
    const builder = {
      eq(column: string, value: unknown) { trace.filters.push(['eq', column, value]); return builder; },
      in(column: string, value: unknown[]) { trace.filters.push(['in', column, value]); return builder; },
      not(column: string, operator: string, value: unknown) { trace.filters.push(['not', column, operator, value]); return builder; },
      order(column: string, value: unknown) { trace.orders.push([column, value]); return builder; },
      async range(from: number, to: number) {
        trace.ranges.push([from, to]);
        const sourceRows = rowsBySource[source] ?? [];
        const valueAt = (value: unknown, column: string) => {
          const row = value as Record<string, unknown>;
          if (!column.startsWith('game.')) return row[column];
          const game = (rowsBySource.games ?? []).find((candidate) =>
            (candidate as { id?: unknown }).id === row.game_id) as Record<string, unknown> | undefined;
          return game?.[column.slice('game.'.length)];
        };
        const rows = sourceRows.filter((row) => trace.filters.every(([operator, column, ...values]) => {
          const actual = valueAt(row, column as string);
          if (operator === 'eq') return actual === values[0];
          if (operator === 'in') return (values[0] as unknown[]).includes(actual);
          if (operator === 'not' && values[0] === 'is' && values[1] === null) return actual !== null;
          return true;
        }));
        if (fault?.source === source && fault.from === from && fault.kind === 'error') {
          return { data: null, count: rows.length, error: { message: 'sensitive provider error' } };
        }
        const count = fault?.source === source && fault.from === from
          ? fault.kind === 'count-change' ? rows.length + 1
            : fault.kind === 'underreport' ? Math.max(0, rows.length - 1)
              : rows.length
          : rows.length;
        const data = fault?.source === source && fault.from === from && fault.kind === 'incomplete'
          ? []
          : rows.slice(from, to + 1);
        return { data, count, error: null };
      },
    };
    return builder;
  };
  return {
    traces,
    client: {
      from(table: string) {
        return { select: (columns: string, options?: unknown) => build(table, columns, options) };
      },
      rpc(name: string, args: Record<string, unknown>, options?: unknown) {
        return { select: (columns: string) => build(`rpc:${name}`, columns, options, args) };
      },
    },
  };
}

function productionSeasonRows(): Record<string, unknown[]> {
  return {
    teams: [
      { id: TEAM_A, league_id: LEAGUE_ID, name: 'Falcons', slug: 'falcons', logo_url: '/falcons.png', division_id: DIVISION_ID, primary_color: '#112233', team_type: 'standard' },
      { id: TEAM_B, league_id: LEAGUE_ID, name: 'Blades', slug: 'blades', logo_url: '/blades.png', division_id: DIVISION_ID, primary_color: '#445566', team_type: 'standard' },
      { id: '40000000-0000-4000-8000-000000000099', league_id: LEAGUE_ID, name: 'Old Team', slug: 'old-team', logo_url: null, division_id: DIVISION_ID, primary_color: null, team_type: 'standard' },
    ],
    team_rosters: [
      { id: '60000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_A, player_id: PLAYER_A, jersey_number: 9, position: 'C', leadership_role: 'captain', status: 'active', player_type: 'regular', joined_at: '2026-01-01T00:00:00Z', end_date: null },
      { id: '60000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_B, player_id: PLAYER_B, jersey_number: 31, position: 'G', leadership_role: null, status: 'inactive', player_type: 'regular', joined_at: '2025-01-01T00:00:00Z', end_date: '2025-12-01T00:00:00Z' },
    ],
    team_schedule_preferences: [
      { id: '61000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_A },
      { id: '61000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_B },
    ],
    registration_submissions: [],
    games: [
      { id: GAME_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z', status: 'completed', home_team_id: TEAM_A, away_team_id: TEAM_B, home_score: 2, away_score: 1, playoff_series_id: null, location: 'Rink 1', game_type: 'regular' },
      { id: '70000000-0000-4000-8000-000000000009', league_id: LEAGUE_ID, season_id: SEASON_ID, scheduled_at: '2026-09-14T20:00:00Z', status: 'scheduled', home_team_id: TEAM_A, away_team_id: TEAM_B, home_score: null, away_score: null, playoff_series_id: SERIES_ID, location: 'Rink 2', game_type: 'playoff' },
    ],
    profiles: [
      { id: PLAYER_A, full_name: 'Alex Alpha', avatar_url: null, photo_url: null },
      { id: PLAYER_B, full_name: 'Blair Beta', avatar_url: null, photo_url: '/blair.png' },
    ],
    game_checkins: [{ id: '80000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, status: 'confirmed' }],
    player_availability: [],
    player_stats: [{ id: '90000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, goals: 2 }],
    goalie_stats: [],
    playoff_series: [{ id: SERIES_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, round_number: 1, series_number: 1, high_seed_id: TEAM_A, low_seed_id: TEAM_B, high_seed_wins: 2, low_seed_wins: 1, winner_id: TEAM_A, status: 'completed' }],
    standings_config: [{ id: 'c0000000-0000-4000-8000-000000000001', playoff_teams_total: 2, playoff_teams_per_division: 2, use_division_playoffs: true }],
    'rpc:get_team_standings': [
      { team_id: TEAM_A, games_played: 1, wins: 1, losses: 0, ties: 0, points: 2, goals_for: 2, goals_against: 1, goal_differential: 1 },
      { team_id: TEAM_B, games_played: 1, wins: 0, losses: 1, ties: 0, points: 0, goals_for: 1, goals_against: 2, goal_differential: -1 },
    ],
  };
}

function request(
  query: string,
  host = 'hockey-life.beerleaguehockey.ca',
  method = 'GET',
) {
  return new NextRequest(`https://${host}/api/public/league-pages?${query}`, {
    method,
    headers: { host },
  });
}

function dependencies(
  overrides: Partial<PublicLeaguePagesDependencies> = {},
): PublicLeaguePagesDependencies {
  return {
    getLeagueBySlug: jest.fn().mockResolvedValue({
      id: LEAGUE_ID,
      slug: 'hockey-life',
      name: 'Hockey Life',
      status: 'active',
      custom_domain: null,
      custom_domain_verified: false,
    }),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    requirePrivilegedAccess: jest.fn(),
    loadCatalog: jest.fn().mockResolvedValue({ seasons: [], divisions: [] }),
    loadSeasonData: jest.fn(),
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    ...overrides,
  };
}

describe('GET /api/public/league-pages request boundary', () => {
  it('is mounted as a dynamic GET route', async () => {
    expect(dynamic).toBe('force-dynamic');
    const response = await GET(request('leagueSlug=hockey-life&page=stats'), { params: Promise.resolve({}) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_PAGE');
  });

  it.each([
    ['', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&page=stats', 'INVALID_PAGE'],
    ['leagueSlug=hockey-life&page=teams&seasonId=nope', 'INVALID_SEASON_ID'],
    ['leagueSlug=hockey-life&page=teams&seasonId=20000000-0000-0000-8000-000000000002', 'INVALID_SEASON_ID'],
    ['leagueSlug=hockey-life&page=teams&wat=1', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&leagueSlug=other&page=teams', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&page=teams&page=players', 'INVALID_QUERY'],
  ])('rejects malformed query %s before any source read', async (query, code) => {
    const deps = dependencies();
    const response = await handlePublicLeaguePagesRequest(request(query), deps);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(deps.getLeagueBySlug).not.toHaveBeenCalled();
    expect(deps.loadCatalog).not.toHaveBeenCalled();
  });

  it('returns a schema-version-1 factual empty when the league has no presentation season', async () => {
    const deps = dependencies();
    const response = await handlePublicLeaguePagesRequest(
      request('leagueSlug=hockey-life&page=players'),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      page: 'players',
      league: { id: LEAGUE_ID, slug: 'hockey-life', name: 'Hockey Life' },
      seasons: [],
      selectedSeason: null,
      divisions: [],
      teams: [],
      players: [],
    });
    expect(deps.loadSeasonData).not.toHaveBeenCalled();
  });

  it('treats an explicit completed season as history even when it is the presentation fallback', async () => {
    const seasonId = '20000000-0000-4000-8000-000000000002';
    const deps = dependencies({
      loadCatalog: jest.fn().mockResolvedValue({
        seasons: [{ id: seasonId, name: 'Spring 2025', status: 'completed', leagueId: LEAGUE_ID, startDate: '2025-03-01', endDate: '2025-06-01', createdAt: '2025-01-01' }],
        divisions: [],
      }),
      loadSeasonData: jest.fn().mockResolvedValue({
        teams: [], players: [], positioning: null, series: [], standings: [],
        previewConfig: { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null },
      }),
    });

    const response = await handlePublicLeaguePagesRequest(
      request(`leagueSlug=hockey-life&page=players&seasonId=${seasonId}`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.loadSeasonData).toHaveBeenCalledWith(expect.objectContaining({
      seasonId,
      isPresentationSeason: true,
      currentMembershipOnly: false,
    }));
  });

  it('enforces tenant, active-publication, and subscription gates before privileged reads', async () => {
    const mismatch = dependencies();
    let response = await handlePublicLeaguePagesRequest(
      request('leagueSlug=hockey-life&page=teams', 'another.beerleaguehockey.ca'),
      mismatch,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('TENANT_MISMATCH');
    expect(mismatch.getLeagueBySlug).not.toHaveBeenCalled();

    const inactive = dependencies({ getLeagueBySlug: jest.fn().mockResolvedValue({ id: LEAGUE_ID, slug: 'hockey-life', name: 'Hockey Life', status: 'draft' }) });
    response = await handlePublicLeaguePagesRequest(request('leagueSlug=hockey-life&page=teams'), inactive);
    expect(response.status).toBe(404);
    expect(inactive.hasPlatformSubscription).not.toHaveBeenCalled();

    const unsubscribed = dependencies({ hasPlatformSubscription: jest.fn().mockResolvedValue(false) });
    response = await handlePublicLeaguePagesRequest(request('leagueSlug=hockey-life&page=teams'), unsubscribed);
    expect(response.status).toBe(404);
    expect(unsubscribed.requirePrivilegedAccess).not.toHaveBeenCalled();
    expect(unsubscribed.loadCatalog).not.toHaveBeenCalled();
  });

  it('rejects an unowned or hidden season before season-scoped reads', async () => {
    const deps = dependencies({
      loadCatalog: jest.fn().mockResolvedValue({
        seasons: [{ id: '20000000-0000-4000-8000-000000000002', name: 'Historical Career Baseline 1', status: 'completed', leagueId: LEAGUE_ID, startDate: null, endDate: null, createdAt: null }],
        divisions: [],
      }),
    });
    const response = await handlePublicLeaguePagesRequest(
      request('leagueSlug=hockey-life&page=players&seasonId=20000000-0000-4000-8000-000000000002'),
      deps,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('SEASON_NOT_IN_LEAGUE');
    expect(deps.loadSeasonData).not.toHaveBeenCalled();
  });

  it('returns a retryable non-2xx boundary without leaking provider details', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const deps = dependencies({ loadCatalog: jest.fn().mockRejectedValue(new Error('secret provider query')) });
      const response = await handlePublicLeaguePagesRequest(
        request('leagueSlug=hockey-life&page=playoffs'),
        deps,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: {
        code: 'LEAGUE_PAGE_DATA_UNAVAILABLE',
        message: 'Public league-page data is temporarily unavailable.',
      } });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret provider query');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects a provider DTO that the mobile decoder cannot consume as a sanitized non-2xx', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const deps = dependencies({
        loadCatalog: jest.fn().mockResolvedValue({
          seasons: [{ id: SEASON_ID, name: 'Summer', status: 'active', leagueId: LEAGUE_ID, startDate: '2026-06-01', endDate: '2026-09-30', createdAt: '2026-01-01' }],
          divisions: [],
        }),
        loadSeasonData: jest.fn().mockResolvedValue({
          teams: [{ id: TEAM_A, name: 'Falcons', slug: 'Bad Slug', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null }],
          players: [], positioning: null, series: [], standings: [],
          previewConfig: { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null },
        }),
      });
      const response = await handlePublicLeaguePagesRequest(request('leagueSlug=hockey-life&page=teams'), deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: {
        code: 'LEAGUE_PAGE_DATA_UNAVAILABLE',
        message: 'Public league-page data is temporarily unavailable.',
      } });
      expect(JSON.stringify(log.mock.calls)).not.toContain('Bad Slug');
    } finally {
      log.mockRestore();
    }
  });

  it('enforces the 512 KiB serialized response ceiling after DTO validation', async () => {
    expect(MAX_PUBLIC_LEAGUE_PAGES_RESPONSE_BYTES).toBe(512 * 1024);
    const teams = Array.from({ length: 300 }, (_, index) => ({
      id: `d0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      name: `Team ${index}`,
      slug: `team-${index}`,
      logoUrl: `/${'x'.repeat(2047)}`,
      divisionId: null,
      divisionName: null,
      primaryColor: null,
    }));
    const deps = dependencies({
      loadCatalog: jest.fn().mockResolvedValue({
        seasons: [{ id: SEASON_ID, name: 'Summer', status: 'active', leagueId: LEAGUE_ID, startDate: '2026-06-01', endDate: '2026-09-30', createdAt: '2026-01-01' }],
        divisions: [],
      }),
      loadSeasonData: jest.fn().mockResolvedValue({
        teams, players: [], positioning: null, series: [], standings: [],
        previewConfig: { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null },
      }),
    });
    const response = await handlePublicLeaguePagesRequest(request('leagueSlug=hockey-life&page=teams'), deps);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PAYLOAD_LIMIT_EXCEEDED');
  });
});

describe('public wire validator', () => {
  const valid = () => ({
    schemaVersion: 1 as const,
    page: 'players' as const,
    league: { id: LEAGUE_ID, slug: 'hockey-life', name: 'Hockey Life' },
    seasons: [{ id: SEASON_ID, name: 'Summer', status: 'active' }],
    selectedSeason: { id: SEASON_ID, name: 'Summer', status: 'active' },
    divisions: [],
    teams: [{ id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null }],
    players: [{ id: PLAYER_A, fullName: 'Alex Alpha', photoUrl: null, jerseyNumber: 9, position: 'C', leadershipRole: null, teamId: TEAM_A, teamName: 'Falcons', teamSlug: 'falcons', teamLogoUrl: null, divisionId: null }],
  });

  it('matches mobile UUID, slug, bounded string, nonnegative and integer constraints', () => {
    expect(() => assertValidLeaguePageResponse(valid())).not.toThrow();
    expect(() => assertValidLeaguePageResponse(valid(), 'another-league')).toThrow('league slug mismatch');
    expect(() => assertValidLeaguePageResponse({ ...valid(), league: { ...valid().league, id: '10000000-0000-0000-8000-000000000001' } })).toThrow('invalid league ID');
    expect(() => assertValidLeaguePageResponse({ ...valid(), teams: [{ ...valid().teams[0], slug: 'Bad Slug' }] })).toThrow('invalid team 0 slug');
    expect(() => assertValidLeaguePageResponse({ ...valid(), players: [{ ...valid().players[0], fullName: 'x'.repeat(201) }] })).toThrow('invalid player 0 name');
    expect(() => assertValidLeaguePageResponse({ ...valid(), players: [{ ...valid().players[0], jerseyNumber: 9.5 }] })).toThrow('invalid player 0 jersey number');
    expect(() => assertValidLeaguePageResponse({ ...valid(), teams: [{ ...valid().teams[0], logoUrl: `/${'x'.repeat(2048)}` }] })).toThrow('invalid team 0 logo URL');
  });

  it('requires nonnegative integer series wins and nonnegative standing points', () => {
    const playoff = {
      ...valid(),
      page: 'playoffs' as const,
      series: [{ id: SERIES_ID, divisionId: null, divisionName: null, roundNumber: 1, seriesNumber: 1, highSeed: { id: TEAM_A, name: 'Falcons', logoUrl: null }, lowSeed: null, highSeedWins: 0, lowSeedWins: 0, winnerId: null, status: 'pending', nextGame: null }],
      standings: [{ teamId: TEAM_A, teamName: 'Falcons', logoUrl: null, points: 0, divisionId: null, divisionName: null }],
      previewConfig: { playoffTeamsTotal: 2, playoffTeamsPerDivision: 2, useDivisionPlayoffs: false },
    };
    const { players: _players, ...payload } = playoff;
    expect(() => assertValidLeaguePageResponse(payload)).not.toThrow();
    expect(() => assertValidLeaguePageResponse({ ...payload, series: [{ ...payload.series[0], highSeedWins: 0.5 }] })).toThrow('invalid series 0 high seed wins');
    expect(() => assertValidLeaguePageResponse({ ...payload, standings: [{ ...payload.standings[0], points: -1 }] })).toThrow('invalid standing 0 points');
  });
});

describe('public Players source decoder (simulated selected-season rows)', () => {
  const TEAM_A = '40000000-0000-4000-8000-000000000004';
  const TEAM_B = '40000000-0000-4000-8000-000000000005';
  const PLAYER_A = '50000000-0000-4000-8000-000000000006';
  const PLAYER_B = '50000000-0000-4000-8000-000000000007';
  const teams: PageTeam[] = [
    { id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: '/falcons.png', divisionId: null, divisionName: null, primaryColor: '#112233' },
    { id: TEAM_B, name: 'Blades', slug: 'blades', logoUrl: '/blades.png', divisionId: null, divisionName: null, primaryColor: '#445566' },
  ];
  const profiles = [
    { id: PLAYER_A, full_name: 'Alex Alpha', avatar_url: ' /alex-avatar.png ', photo_url: '/alex-photo.png' },
    { id: PLAYER_B, full_name: 'Blair Beta', avatar_url: null, photo_url: '/blair-photo.png' },
  ];
  const rosterRows = [
    { id: '60000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: '20000000-0000-4000-8000-000000000002', team_id: TEAM_A, player_id: PLAYER_A, jersey_number: 9, position: 'C', leadership_role: 'captain', status: 'active', joined_at: '2026-08-01T00:00:00Z', end_date: null },
    // Duplicate temporal row for the same exact membership: newest wins.
    { id: '60000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: '20000000-0000-4000-8000-000000000002', team_id: TEAM_A, player_id: PLAYER_A, jersey_number: 19, position: 'RW', leadership_role: null, status: 'active', joined_at: '2026-09-01T00:00:00Z', end_date: null },
    // Same player on a different team remains a distinct membership row.
    { id: '60000000-0000-4000-8000-000000000003', league_id: LEAGUE_ID, season_id: '20000000-0000-4000-8000-000000000002', team_id: TEAM_B, player_id: PLAYER_A, jersey_number: 91, position: 'D', leadership_role: 'alternate_captain', status: 'active', joined_at: '2026-09-02T00:00:00Z', end_date: null },
    // An ended membership is excluded from the presentation season only.
    { id: '60000000-0000-4000-8000-000000000004', league_id: LEAGUE_ID, season_id: '20000000-0000-4000-8000-000000000002', team_id: TEAM_B, player_id: PLAYER_B, jersey_number: 4, position: 'D', leadership_role: null, status: 'inactive', joined_at: '2025-09-01T00:00:00Z', end_date: '2026-01-01' },
  ];

  it('filters current memberships and dedupes only the exact player/team key', () => {
    const players = buildPublicPlayers({ rosterRows, profiles, teams, currentMembershipOnly: true });

    expect(players).toEqual([
      { id: PLAYER_A, fullName: 'Alex Alpha', photoUrl: '/alex-avatar.png', jerseyNumber: 19, position: 'RW', leadershipRole: null, teamId: TEAM_A, teamName: 'Falcons', teamSlug: 'falcons', teamLogoUrl: '/falcons.png', divisionId: null },
      { id: PLAYER_A, fullName: 'Alex Alpha', photoUrl: '/alex-avatar.png', jerseyNumber: 91, position: 'D', leadershipRole: 'alternate_captain', teamId: TEAM_B, teamName: 'Blades', teamSlug: 'blades', teamLogoUrl: '/blades.png', divisionId: null },
    ]);
  });

  it('retains genuine ended memberships for an explicitly selected past season', () => {
    const players = buildPublicPlayers({ rosterRows, profiles, teams, currentMembershipOnly: false });

    expect(players).toHaveLength(3);
    expect(players.find((player) => player.id === PLAYER_B)).toMatchObject({
      fullName: 'Blair Beta',
      photoUrl: '/blair-photo.png',
      teamId: TEAM_B,
    });
  });

  it('rejects malformed canonical profile IDs instead of publishing an unusable native link', () => {
    expect(() => buildPublicPlayers({
      rosterRows: [{ ...rosterRows[0], player_id: 'not-a-profile-id' }],
      profiles: [{ ...profiles[0], id: 'not-a-profile-id' }],
      teams,
      currentMembershipOnly: true,
    })).toThrow('invalid roster player ID');
  });
});

describe('public Teams source decoder (simulated selected-season rows)', () => {
  const SEASON_ID = '20000000-0000-4000-8000-000000000002';
  const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
  const TEAM_A = '40000000-0000-4000-8000-000000000004';
  const TEAM_B = '40000000-0000-4000-8000-000000000005';
  const PLAYER_A = '50000000-0000-4000-8000-000000000006';
  const PLAYER_B = '50000000-0000-4000-8000-000000000007';
  const GAME_ID = '70000000-0000-4000-8000-000000000008';

  it('does not double-count one confirmed appearance in the composed production loader', async () => {
    const rowsByTable: Record<string, unknown[]> = {
      teams: [{ id: TEAM_A, league_id: LEAGUE_ID, name: 'Falcons', slug: 'falcons', logo_url: null, division_id: null, primary_color: '#112233', team_type: 'standard' }],
      team_rosters: [{ id: '60000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_A, player_id: PLAYER_A, jersey_number: 9, position: 'C', leadership_role: null, status: 'active', player_type: 'regular', joined_at: '2026-08-01T00:00:00Z', end_date: null }],
      team_schedule_preferences: [],
      registration_submissions: [],
      games: [{ id: GAME_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z', status: 'completed', home_team_id: TEAM_A, away_team_id: TEAM_B, home_score: 1, away_score: 0, playoff_series_id: null, location: null, game_type: 'regular' }],
      game_checkins: [{ id: '80000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, status: 'confirmed' }],
      player_availability: [],
      player_stats: [{ id: '90000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, goals: 1 }],
      goalie_stats: [],
      'rpc:get_team_standings': [{ team_id: TEAM_A, games_played: 1, wins: 1, losses: 0, ties: 0, points: 2, goals_for: 1, goals_against: 0, goal_differential: 1 }],
    };
    const { client } = semanticSourceClient(rowsByTable);

    const result = await loadPublicLeaguePageSeasonDataFromClient(client as never, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      page: 'teams',
      isPresentationSeason: true,
      currentMembershipOnly: true,
      divisions: [],
      now: new Date('2026-09-13T12:00:00.000Z'),
    });

    expect(result.positioning?.teams[0]?.metrics.commitment).toEqual({ rank: 1, value: 100, valueLabel: '100%' });
  });

  it('publishes only participating public teams and builds all five positioning metrics', () => {
    const teams = buildPublicTeams({
      leagueId: LEAGUE_ID,
      participantTeamIds: [TEAM_A, TEAM_B, '40000000-0000-4000-8000-000000000099'],
      divisions: [{ id: DIVISION_ID, name: 'Summer', leagueId: LEAGUE_ID }],
      teamRows: [
        { id: TEAM_A, league_id: LEAGUE_ID, name: 'Falcons', slug: 'falcons', logo_url: '/falcons.png', division_id: DIVISION_ID, primary_color: '#112233', team_type: 'standard' },
        { id: TEAM_B, league_id: LEAGUE_ID, name: 'Blades', slug: 'blades', logo_url: '/blades.png', division_id: DIVISION_ID, primary_color: '#445566', team_type: 'standard' },
        // Simulated hidden historical carrier: never part of the public DTO.
        { id: '40000000-0000-4000-8000-000000000099', league_id: LEAGUE_ID, name: 'Historical Baseline', slug: 'historical-baseline', logo_url: null, division_id: null, primary_color: null, team_type: 'placeholder' },
      ],
    });
    expect(teams.map((team) => team.name)).toEqual(['Blades', 'Falcons']);

    const positioning = buildPublicPositioning({
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      teams,
      standings: [
        { team_id: TEAM_A, team_name: 'Falcons', team_logo: '/falcons.png', division_id: DIVISION_ID, division_name: 'Summer', team_type: 'standard', games_played: 1, wins: 1, losses: 0, ties: 0, overtime_losses: 0, points: 2, goals_for: 5, goals_against: 2, goal_differential: 3, streak: null, last_10: null },
        { team_id: TEAM_B, team_name: 'Blades', team_logo: '/blades.png', division_id: DIVISION_ID, division_name: 'Summer', team_type: 'standard', games_played: 1, wins: 0, losses: 1, ties: 0, overtime_losses: 0, points: 0, goals_for: 2, goals_against: 5, goal_differential: -3, streak: null, last_10: null },
      ],
      games: [{ id: GAME_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, scheduled_at: '2026-09-01T20:00:00Z', status: 'completed', home_team_id: TEAM_A, away_team_id: TEAM_B, home_score: 5, away_score: 2 }],
      rosterRows: [
        { id: '60000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_A, player_id: PLAYER_A, jersey_number: 9, position: 'C', leadership_role: null, status: 'active', player_type: 'regular', joined_at: '2026-08-01T00:00:00Z', end_date: null },
        { id: '60000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, team_id: TEAM_B, player_id: PLAYER_B, jersey_number: 4, position: 'D', leadership_role: null, status: 'active', player_type: 'regular', joined_at: '2026-08-01T00:00:00Z', end_date: null },
      ],
      checkins: [{ id: '80000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, status: 'confirmed' }],
      availability: [{ id: '80000000-0000-4000-8000-000000000002', game_id: GAME_ID, team_id: TEAM_B, player_id: PLAYER_B, status: 'out' }],
      playerStats: [
        { id: '90000000-0000-4000-8000-000000000001', game_id: GAME_ID, team_id: TEAM_A, player_id: PLAYER_A, goals: 3 },
        { id: '90000000-0000-4000-8000-000000000002', game_id: GAME_ID, team_id: TEAM_B, player_id: PLAYER_B, goals: 2 },
      ],
      goalieStats: [],
    });

    expect(positioning?.attendanceSource).toBe('confirmed-plus-fallback-roster-appearances');
    expect(positioning?.teams).toHaveLength(2);
    expect(positioning?.teams.find((team) => team.teamId === TEAM_A)?.metrics).toMatchObject({
      overall: { rank: 1, value: 2, valueLabel: '2 pts' },
      offense: { rank: 1, value: 5, valueLabel: '5 GF' },
      defense: { rank: 1, value: 2, valueLabel: '2 GA' },
      scoringDepth: { rank: 1, value: 2, valueLabel: '2 goals beyond top 3' },
      commitment: { rank: 1, value: 100, valueLabel: '100%' },
    });
    expect(positioning?.teams.find((team) => team.teamId === TEAM_B)?.metrics.commitment.value).toBe(0);
  });
});

describe('public Playoffs source decoder (simulated official rows)', () => {
  const SEASON_ID = '20000000-0000-4000-8000-000000000002';
  const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
  const TEAM_A = '40000000-0000-4000-8000-000000000004';
  const TEAM_B = '40000000-0000-4000-8000-000000000005';
  const SERIES_ID = 'a0000000-0000-4000-8000-000000000001';

  it('maps actual series results and the first future scheduled game while preserving preview inputs', () => {
    const result = buildPublicPlayoffs({
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      now: new Date('2026-09-13T12:00:00.000Z'),
      divisions: [{ id: DIVISION_ID, name: 'Summer', leagueId: LEAGUE_ID }],
      teams: [
        { id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: '/falcons.png', divisionId: DIVISION_ID, divisionName: 'Summer', primaryColor: '#112233' },
        { id: TEAM_B, name: 'Blades', slug: 'blades', logoUrl: '/blades.png', divisionId: DIVISION_ID, divisionName: 'Summer', primaryColor: '#445566' },
      ],
      seriesRows: [{ id: SERIES_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, round_number: 1, series_number: 1, high_seed_id: TEAM_A, low_seed_id: TEAM_B, high_seed_wins: 2, low_seed_wins: 1, winner_id: TEAM_A, status: 'completed' }],
      gameRows: [
        { id: 'b0000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, season_id: SEASON_ID, playoff_series_id: SERIES_ID, scheduled_at: '2026-09-12T20:00:00Z', location: 'Past Rink', status: 'scheduled', game_type: 'playoff', home_team_id: TEAM_A, away_team_id: TEAM_B },
        { id: 'b0000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, playoff_series_id: SERIES_ID, scheduled_at: '2026-09-14T20:00:00Z', location: 'North Rink', status: 'scheduled', game_type: 'playoff', home_team_id: TEAM_A, away_team_id: TEAM_B },
        { id: 'b0000000-0000-4000-8000-000000000003', league_id: LEAGUE_ID, season_id: SEASON_ID, playoff_series_id: SERIES_ID, scheduled_at: '2026-09-15T20:00:00Z', location: 'Later Rink', status: 'scheduled', game_type: 'playoff', home_team_id: TEAM_A, away_team_id: TEAM_B },
      ],
      standings: [
        { team_id: TEAM_A, team_name: 'Falcons', team_logo: '/falcons.png', division_id: DIVISION_ID, division_name: 'Summer', team_type: 'standard', games_played: 10, wins: 8, losses: 2, ties: 0, overtime_losses: 0, points: 16, goals_for: 40, goals_against: 20, goal_differential: 20, streak: null, last_10: null },
        { team_id: TEAM_B, team_name: 'Blades', team_logo: '/blades.png', division_id: DIVISION_ID, division_name: 'Summer', team_type: 'standard', games_played: 10, wins: 6, losses: 4, ties: 0, overtime_losses: 0, points: 12, goals_for: 30, goals_against: 25, goal_differential: 5, streak: null, last_10: null },
      ],
      config: { playoff_teams_total: 4, playoff_teams_per_division: 4, use_division_playoffs: true },
    });

    expect(result.series).toEqual([{
      id: SERIES_ID,
      divisionId: DIVISION_ID,
      divisionName: 'Summer',
      roundNumber: 1,
      seriesNumber: 1,
      highSeed: { id: TEAM_A, name: 'Falcons', logoUrl: '/falcons.png' },
      lowSeed: { id: TEAM_B, name: 'Blades', logoUrl: '/blades.png' },
      highSeedWins: 2,
      lowSeedWins: 1,
      winnerId: TEAM_A,
      status: 'completed',
      nextGame: { id: 'b0000000-0000-4000-8000-000000000002', scheduledAt: '2026-09-14T20:00:00Z', location: 'North Rink' },
    }]);
    expect(result.standings).toEqual([
      { teamId: TEAM_A, teamName: 'Falcons', logoUrl: '/falcons.png', points: 16, divisionId: DIVISION_ID, divisionName: 'Summer' },
      { teamId: TEAM_B, teamName: 'Blades', logoUrl: '/blades.png', points: 12, divisionId: DIVISION_ID, divisionName: 'Summer' },
    ]);
    expect(result.previewConfig).toEqual({ playoffTeamsTotal: 4, playoffTeamsPerDivision: 4, useDivisionPlayoffs: true });
  });

  it('keeps an empty official bracket factual while still returning preview inputs', () => {
    const result = buildPublicPlayoffs({
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      now: new Date('2026-09-13T12:00:00.000Z'),
      divisions: [],
      teams: [],
      seriesRows: [],
      gameRows: [],
      standings: [],
      config: null,
    });
    expect(result).toEqual({
      series: [],
      standings: [],
      previewConfig: { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null },
    });
  });

  it('rejects same-league historical seeds outside the selected-season DTO team set', () => {
    const historicalTeam = '40000000-0000-4000-8000-000000000099';
    expect(() => buildPublicPlayoffs({
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      now: new Date('2026-09-13T12:00:00.000Z'),
      divisions: [],
      teams: [{ id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null }],
      seriesRows: [{ id: SERIES_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, round_number: 1, series_number: 1, high_seed_id: historicalTeam, low_seed_id: null, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'pending' }],
      gameRows: [], standings: [], config: null,
    } as never)).toThrow('playoff seed is not a selected-season public team');
  });

  it('rejects unknown series links and foreign or mismatched next-game participants', () => {
    const teams: PageTeam[] = [
      { id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null },
      { id: TEAM_B, name: 'Blades', slug: 'blades', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null },
    ];
    const base = {
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, now: new Date('2026-09-13T12:00:00.000Z'), divisions: [], teams,
      seriesRows: [{ id: SERIES_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, round_number: 1, series_number: 1, high_seed_id: TEAM_A, low_seed_id: TEAM_B, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'scheduled' }],
      standings: [], config: null,
    };
    const game = { id: GAME_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, playoff_series_id: SERIES_ID, scheduled_at: '2026-09-14T20:00:00Z', location: null, status: 'scheduled', game_type: 'playoff', home_team_id: TEAM_A, away_team_id: TEAM_B };
    expect(() => buildPublicPlayoffs({ ...base, gameRows: [{ ...game, playoff_series_id: 'a0000000-0000-4000-8000-000000000099' }] } as never))
      .toThrow('playoff game series missing');
    expect(() => buildPublicPlayoffs({ ...base, gameRows: [{ ...game, away_team_id: '40000000-0000-4000-8000-000000000099' }] } as never))
      .toThrow('playoff game team is not a selected-season public team');
    expect(() => buildPublicPlayoffs({ ...base, gameRows: [{ ...game, away_team_id: TEAM_A }] } as never))
      .toThrow('playoff game participants do not match series');
  });

  it('preserves BYE/TBD and winners while selecting only scheduled or in-progress next games', () => {
    const teams: PageTeam[] = [
      { id: TEAM_A, name: 'Falcons', slug: 'falcons', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null },
      { id: TEAM_B, name: 'Blades', slug: 'blades', logoUrl: null, divisionId: null, divisionName: null, primaryColor: null },
    ];
    const games = [
      { id: 'b0000000-0000-4000-8000-000000000001', status: null, scheduled_at: '2026-09-14T18:00:00Z' },
      { id: 'b0000000-0000-4000-8000-000000000002', status: 'postponed', scheduled_at: '2026-09-14T19:00:00Z' },
      { id: 'b0000000-0000-4000-8000-000000000003', status: 'pending_verification', scheduled_at: '2026-09-14T19:30:00Z' },
      { id: 'b0000000-0000-4000-8000-000000000004', status: 'in_progress', scheduled_at: '2026-09-14T20:00:00Z' },
      { id: 'b0000000-0000-4000-8000-000000000005', status: 'scheduled', scheduled_at: '2026-09-14T21:00:00Z' },
    ].map((row) => ({ ...row, league_id: LEAGUE_ID, season_id: SEASON_ID, playoff_series_id: SERIES_ID, location: null, game_type: 'playoff', home_team_id: TEAM_A, away_team_id: TEAM_B }));
    const result = buildPublicPlayoffs({
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, now: new Date('2026-09-13T12:00:00.000Z'), divisions: [], teams,
      seriesRows: [
        { id: SERIES_ID, league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, round_number: 1, series_number: 1, high_seed_id: TEAM_A, low_seed_id: TEAM_B, high_seed_wins: 2, low_seed_wins: 1, winner_id: TEAM_A, status: 'completed' },
        { id: 'a0000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, round_number: 1, series_number: 2, high_seed_id: TEAM_A, low_seed_id: null, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'bye' },
        { id: 'a0000000-0000-4000-8000-000000000003', league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: null, round_number: 2, series_number: 1, high_seed_id: null, low_seed_id: null, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'pending' },
      ],
      gameRows: games as never,
      standings: [], config: null,
    } as never);
    expect(result.series.map((series) => [series.status, series.highSeed?.id ?? null, series.lowSeed?.id ?? null, series.winnerId])).toEqual([
      ['completed', TEAM_A, TEAM_B, TEAM_A], ['bye', TEAM_A, null, null], ['pending', null, null, null],
    ]);
    expect(result.series[0]?.nextGame?.id).toBe('b0000000-0000-4000-8000-000000000004');
    expect(result.series[1]?.nextGame).toBeNull();
    expect(result.series[2]?.nextGame).toBeNull();
  });
});

describe('public league-page complete source reader', () => {
  it('reads every exact-count page instead of accepting a database default cap', async () => {
    const range = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 'one' }, { id: 'two' }], count: 3, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'three' }], count: 3, error: null });

    const rows = await readCompletePages(() => ({ range }), 'semantic fixture', 2, 10);

    expect(rows).toEqual([{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
    expect(range.mock.calls).toEqual([[0, 1], [2, 2]]);
  });

  it('rejects source errors and count races rather than returning partial success', async () => {
    const changedCount = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 'one' }], count: 2, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'two' }], count: 3, error: null });
    await expect(readCompletePages(() => ({ range: changedCount }), 'semantic fixture', 1, 10))
      .rejects.toThrow('source count changed');

    const failedPage = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 'one' }], count: 2, error: null })
      .mockResolvedValueOnce({ data: null, count: 2, error: { message: 'provider detail must not escape' } });
    await expect(readCompletePages(() => ({ range: failedPage }), 'semantic fixture', 1, 10))
      .rejects.toThrow('source page failed');
  });
});

describe('production catalog loader (simulated database responses)', () => {
  it('paginates exact public allowlists and preserves website season/division ordering', async () => {
    const selections: Array<{ table: string; columns: string }> = [];
    const rowsByTable: Record<string, unknown[]> = {
      seasons: [
        { id: '20000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, name: 'Spring 2025', status: 'completed', start_date: '2025-03-01', end_date: '2025-06-01', created_at: '2025-01-01' },
        { id: '20000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, name: 'Summer 2026', status: 'active', start_date: '2026-06-01', end_date: '2026-09-01', created_at: '2026-01-01' },
      ],
      divisions: [
        { id: '30000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, name: 'B Division', sort_order: 2 },
        { id: '30000000-0000-4000-8000-000000000001', league_id: LEAGUE_ID, name: 'A Division', sort_order: 1 },
      ],
    };
    const client = {
      from(table: string) {
        return {
          select(columns: string) {
            selections.push({ table, columns });
            const builder = {
              eq: () => builder,
              order: () => builder,
              range: async (from: number, to: number) => ({
                data: rowsByTable[table].slice(from, to + 1),
                count: rowsByTable[table].length,
                error: null,
              }),
            };
            return builder;
          },
        };
      },
      rpc: jest.fn(),
    };

    const catalog = await loadPublicLeaguePageCatalogFromClient(client as never, LEAGUE_ID, 1);

    expect(catalog.seasons.map((season) => season.name)).toEqual(['Summer 2026', 'Spring 2025']);
    expect(catalog.divisions.map((division) => division.name)).toEqual(['A Division', 'B Division']);
    const selectedColumns = selections.map(({ table, columns }) => `${table}:${columns}`).join('\n');
    expect(selectedColumns).not.toContain('*');
    expect(selectedColumns).not.toMatch(/email|phone|notes|created_by/);
  });
});

describe('production season loader (projection-aware paginated semantic client)', () => {
  const scope = (page: 'teams' | 'players' | 'playoffs', currentMembershipOnly = true) => ({
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    page,
    isPresentationSeason: true,
    currentMembershipOnly,
    divisions: [{ id: DIVISION_ID, name: 'Summer', leagueId: LEAGUE_ID }],
    now: new Date('2026-09-13T12:00:00.000Z'),
  });

  function expectCommonQueryContract(traces: SourceTrace[]) {
    const teams = traces.find((trace) => trace.source === 'teams')!;
    expect(teams.columns).toBe('id, league_id, name, slug, logo_url, division_id, primary_color, team_type');
    expect(teams.options).toEqual({ count: 'exact' });
    expect(teams.filters).toEqual([['eq', 'league_id', LEAGUE_ID]]);
    expect(teams.orders).toEqual([['id', { ascending: true }]]);
    const rosters = traces.find((trace) => trace.source === 'team_rosters')!;
    expect(rosters.columns).toBe('id, league_id, season_id, team_id, player_id, jersey_number, position, leadership_role, status, player_type, joined_at, end_date');
    expect(rosters.filters).toEqual([['eq', 'league_id', LEAGUE_ID], ['eq', 'season_id', SEASON_ID]]);
    expect(rosters.orders).toEqual([['id', { ascending: true }]]);
    const games = traces.find((trace) => trace.source === 'games')!;
    expect(games.columns).toBe('id, league_id, season_id, scheduled_at, status, home_team_id, away_team_id, home_score, away_score, playoff_series_id, location, game_type');
    expect(games.filters).toEqual([['eq', 'league_id', LEAGUE_ID], ['eq', 'season_id', SEASON_ID]]);
    expect(traces.filter((trace) => trace.source === 'games').flatMap((trace) => trace.ranges)).toEqual([[0, 0], [1, 1]]);
  }

  it('loads Teams through the actual query/composition path and paginates counted standings', async () => {
    const { client, traces } = semanticSourceClient(productionSeasonRows());
    const result = await loadPublicLeaguePageSeasonDataFromClient(client as never, scope('teams'), 1);

    expect(result.teams.map((team) => team.id)).toEqual([TEAM_B, TEAM_A]);
    expect(result.positioning?.teams.find((team) => team.teamId === TEAM_A)?.metrics.commitment.value).toBe(100);
    expectCommonQueryContract(traces);
    const standings = traces.find((trace) => trace.source === 'rpc:get_team_standings')!;
    expect(standings).toMatchObject({
      columns: 'team_id, games_played, wins, losses, ties, points, goals_for, goals_against, goal_differential',
      options: { count: 'exact' },
      args: { check_league_id: LEAGUE_ID, check_season_id: SEASON_ID },
      filters: [], orders: [['team_id', { ascending: true }]], ranges: [[0, 0]],
    });
    expect(traces.filter((trace) => trace.source === 'rpc:get_team_standings')[1]?.ranges).toEqual([[1, 1]]);
    const checkins = traces.find((trace) => trace.source === 'game_checkins')!;
    expect(checkins.columns).toBe('id, game_id, team_id, player_id, status, game:games!inner(id)');
    expect(checkins.filters).toContainEqual(['in', 'game.status', ['in_progress', 'pending_verification', 'completed']]);
  });

  it('loads Players with minimal profile projection and keeps a non-stat ended roster only for an explicit past season', async () => {
    const { client, traces } = semanticSourceClient(productionSeasonRows());
    const result = await loadPublicLeaguePageSeasonDataFromClient(client as never, scope('players', false), 1);

    expect(result.players.map((player) => [player.id, player.jerseyNumber])).toEqual([[PLAYER_A, 9], [PLAYER_B, 31]]);
    expect(result.players.find((player) => player.id === PLAYER_B)?.photoUrl).toBe('/blair.png');
    expectCommonQueryContract(traces);
    const profiles = traces.find((trace) => trace.source === 'profiles')!;
    expect(profiles.columns).toBe('id, full_name, avatar_url, photo_url');
    expect(profiles.options).toEqual({ count: 'exact' });
    expect(profiles.filters).toEqual([['in', 'id', [PLAYER_A, PLAYER_B]]]);
    expect(profiles.orders).toEqual([['id', { ascending: true }]]);
    expect(traces.filter((trace) => trace.source === 'profiles').flatMap((trace) => trace.ranges)).toEqual([[0, 0], [1, 1]]);

    const current = semanticSourceClient(productionSeasonRows());
    const currentResult = await loadPublicLeaguePageSeasonDataFromClient(current.client as never, scope('players', true), 1);
    expect(currentResult.players.map((player) => player.id)).toEqual([PLAYER_A]);
    expect(current.traces.find((trace) => trace.source === 'profiles')?.filters).toEqual([['in', 'id', [PLAYER_A]]]);
  });

  it('loads official Playoffs with selected teams, winner and valid next game through the actual mapper', async () => {
    const rows = productionSeasonRows();
    rows.playoff_series.push(
      { id: 'a0000000-0000-4000-8000-000000000002', league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, round_number: 1, series_number: 2, high_seed_id: TEAM_A, low_seed_id: null, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'bye' },
      { id: 'a0000000-0000-4000-8000-000000000003', league_id: LEAGUE_ID, season_id: SEASON_ID, division_id: DIVISION_ID, round_number: 2, series_number: 1, high_seed_id: null, low_seed_id: null, high_seed_wins: 0, low_seed_wins: 0, winner_id: null, status: 'pending' },
    );
    const { client, traces } = semanticSourceClient(rows);
    const result = await loadPublicLeaguePageSeasonDataFromClient(client as never, scope('playoffs'), 1);

    expect(result.series[0]).toEqual(expect.objectContaining({
      id: SERIES_ID,
      highSeed: expect.objectContaining({ id: TEAM_A }),
      lowSeed: expect.objectContaining({ id: TEAM_B }),
      winnerId: TEAM_A,
      nextGame: { id: '70000000-0000-4000-8000-000000000009', scheduledAt: '2026-09-14T20:00:00Z', location: 'Rink 2' },
    }));
    expect(result.series.slice(1).map((series) => [series.status, series.highSeed?.id ?? null, series.lowSeed?.id ?? null, series.nextGame])).toEqual([
      ['bye', TEAM_A, null, null],
      ['pending', null, null, null],
    ]);
    expectCommonQueryContract(traces);
    const series = traces.find((trace) => trace.source === 'playoff_series')!;
    expect(series.columns).toBe('id, league_id, season_id, division_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_wins, low_seed_wins, winner_id, status');
    expect(series.filters).toEqual([['eq', 'league_id', LEAGUE_ID], ['eq', 'season_id', SEASON_ID]]);
    expect(series.orders.map(([column]) => column)).toEqual(['division_id', 'round_number', 'series_number', 'id']);
  });

  it('rejects nonparticipant seeds, unknown series and foreign game participants through the actual loader', async () => {
    const historicalRows = productionSeasonRows();
    (historicalRows.playoff_series[0] as { high_seed_id: string }).high_seed_id = '40000000-0000-4000-8000-000000000099';
    (historicalRows.playoff_series[0] as { winner_id: string | null }).winner_id = null;
    historicalRows.games = historicalRows.games.slice(0, 1);
    await expect(loadPublicLeaguePageSeasonDataFromClient(
      semanticSourceClient(historicalRows).client as never, scope('playoffs'), 1,
    )).rejects.toThrow('playoff seed is not a selected-season public team');

    const unknownSeriesRows = productionSeasonRows();
    (unknownSeriesRows.games[1] as { playoff_series_id: string }).playoff_series_id = 'a0000000-0000-4000-8000-000000000099';
    await expect(loadPublicLeaguePageSeasonDataFromClient(
      semanticSourceClient(unknownSeriesRows).client as never, scope('playoffs'), 1,
    )).rejects.toThrow('playoff game series missing');

    const foreignParticipantRows = productionSeasonRows();
    (foreignParticipantRows.games[1] as { away_team_id: string }).away_team_id = '40000000-0000-4000-8000-000000000098';
    await expect(loadPublicLeaguePageSeasonDataFromClient(
      semanticSourceClient(foreignParticipantRows).client as never, scope('playoffs'), 1,
    )).rejects.toThrow('playoff game team is not a selected-season public team');
  });

  it('rejects later table-page failures and count changes', async () => {
    const failed = semanticSourceClient(productionSeasonRows(), { source: 'games', from: 1, kind: 'error' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(failed.client as never, scope('players'), 1))
      .rejects.toThrow('games source page failed');

    const changed = semanticSourceClient(productionSeasonRows(), { source: 'team_rosters', from: 1, kind: 'count-change' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(changed.client as never, scope('players'), 1))
      .rejects.toThrow('team_rosters source count changed');
  });

  it('rejects an invalid provider slug in the actual loader instead of repairing it', async () => {
    const rows = productionSeasonRows();
    (rows.teams[0] as { slug: string }).slug = ' falcons ';
    await expect(loadPublicLeaguePageSeasonDataFromClient(
      semanticSourceClient(rows).client as never, scope('players'), 1,
    )).rejects.toThrow('invalid team slug');
  });

  it('rejects standings undercounts, incomplete pages and later-page errors', async () => {
    const undercount = semanticSourceClient(productionSeasonRows(), { source: 'rpc:get_team_standings', from: 0, kind: 'underreport' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(undercount.client as never, scope('teams'), 2))
      .rejects.toThrow('standings source read incomplete');

    const incomplete = semanticSourceClient(productionSeasonRows(), { source: 'rpc:get_team_standings', from: 1, kind: 'incomplete' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(incomplete.client as never, scope('teams'), 1))
      .rejects.toThrow('standings source read incomplete');

    const changed = semanticSourceClient(productionSeasonRows(), { source: 'rpc:get_team_standings', from: 1, kind: 'count-change' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(changed.client as never, scope('teams'), 1))
      .rejects.toThrow('standings source count changed');

    const failed = semanticSourceClient(productionSeasonRows(), { source: 'rpc:get_team_standings', from: 1, kind: 'error' });
    await expect(loadPublicLeaguePageSeasonDataFromClient(failed.client as never, scope('playoffs'), 1))
      .rejects.toThrow('standings source page failed');
  });
});
