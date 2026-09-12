import { NextRequest } from 'next/server';

import { hasPlatformSubscription } from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  handlePublicCareerLeaguesRequest,
  readPublicLeagues,
  readPlayerLeagueIds,
  type PublicCareerLeagueDependencies,
} from '@/lib/public-career-leagues';
import { GET, dynamic } from '@/app/api/public/career-leagues/route';

jest.mock('@/lib/data', () => ({ hasPlatformSubscription: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));

const PLAYER_ID = '10000000-0000-4000-8000-000000000001';
const LEAGUE_A = '20000000-0000-4000-8000-000000000002';
const LEAGUE_B = '30000000-0000-4000-8000-000000000003';
const DEMO_ID = 'b629dd71-665f-45b0-8d66-96a1c10fb850';

beforeEach(() => jest.clearAllMocks());

function request(query = `playerId=${PLAYER_ID}`, host = 'api.beerleaguehockey.ca', method = 'GET') {
  return new NextRequest(`https://${host}/api/public/career-leagues?${query}`, {
    method,
    headers: { host },
  });
}

function dependencies(overrides: Partial<PublicCareerLeagueDependencies> = {}): PublicCareerLeagueDependencies {
  return {
    readPlayerLeagueIds: jest.fn().mockResolvedValue([LEAGUE_A]),
    readPublicLeagues: jest.fn().mockResolvedValue([
      { id: LEAGUE_A, name: 'Alpha League', slug: 'alpha-league', status: 'active' },
    ]),
    hasPlatformSubscription: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('public career league discovery policy', () => {
  it('returns only active subscribed non-demo leagues, sorted and allowlisted', async () => {
    const deps = dependencies({
      readPlayerLeagueIds: jest.fn().mockResolvedValue([DEMO_ID, LEAGUE_B, LEAGUE_A, LEAGUE_A]),
      readPublicLeagues: jest.fn().mockResolvedValue([
        { id: LEAGUE_B, name: 'Zulu', slug: 'zulu', status: 'active', private_note: 'secret' },
        { id: DEMO_ID, name: 'Demo', slug: 'demo', status: 'active' },
        { id: LEAGUE_A, name: 'Alpha', slug: 'alpha', status: 'active' },
      ]),
      hasPlatformSubscription: jest.fn(async (id) => id !== LEAGUE_B),
    });

    const response = await handlePublicCareerLeaguesRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      playerId: PLAYER_ID,
      leagues: [{ id: LEAGUE_A, name: 'Alpha', slug: 'alpha' }],
    });
    expect(deps.readPublicLeagues).toHaveBeenCalledWith([LEAGUE_A, LEAGUE_B, DEMO_ID]);
    expect(deps.hasPlatformSubscription).toHaveBeenCalledTimes(2);
    expect(response.headers.get('cache-control')).toContain('s-maxage=60');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('keeps a genuine imported-only baseline league', async () => {
    const deps = dependencies({
      readPlayerLeagueIds: jest.fn().mockResolvedValue([LEAGUE_B]),
      readPublicLeagues: jest.fn().mockResolvedValue([
        { id: LEAGUE_B, name: 'Imported League', slug: 'imported-league', status: 'active' },
      ]),
    });
    const response = await handlePublicCareerLeaguesRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.readPublicLeagues).toHaveBeenCalledWith([LEAGUE_B]);
  });

  it('returns a genuine empty result but turns source errors into 503 no-store', async () => {
    const empty = await handlePublicCareerLeaguesRequest(request(), dependencies({
      readPlayerLeagueIds: jest.fn().mockResolvedValue([]),
    }));
    // eslint-disable-next-line supabase-test-quality/no-mock-echo -- verifies factual empty differs from query failure below
    expect((await empty.json()).leagues).toEqual([]);

    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failed = await handlePublicCareerLeaguesRequest(request(), dependencies({
        readPlayerLeagueIds: jest.fn().mockRejectedValue(new Error('provider secret')),
      }));
      expect(failed.status).toBe(503);
      expect(failed.headers.get('cache-control')).toBe('no-store');
      expect(await failed.json()).toEqual({ error: {
        code: 'CAREER_LEAGUES_UNAVAILABLE',
        message: 'Career league discovery is temporarily unavailable.',
      } });
    } finally {
      log.mockRestore();
    }
  });

  it('validates exact input and serving hosts before any lookup', async () => {
    for (const req of [
      request(''),
      request('playerId=nope'),
      request(`playerId=${PLAYER_ID}&playerId=${PLAYER_ID}`),
      request(`playerId=${PLAYER_ID}&extra=1`),
    ]) {
      const deps = dependencies();
      const response = await handlePublicCareerLeaguesRequest(req, deps);
      expect(response.status).toBe(400);
      expect(deps.readPlayerLeagueIds).not.toHaveBeenCalled();
    }
  });

  it('rejects non-GET and more than 100 complete eligible scopes', async () => {
    const method = await handlePublicCareerLeaguesRequest(request(undefined, undefined, 'POST'), dependencies());
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');

    const ids = Array.from({ length: 101 }, (_, index) =>
      `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const overflow = await handlePublicCareerLeaguesRequest(request(), dependencies({
        readPlayerLeagueIds: jest.fn().mockResolvedValue(ids),
      }));
      expect(overflow.status).toBe(503);
    } finally {
      log.mockRestore();
    }
  });

  it('excludes missing/inactive visibility while failing closed on duplicate, malformed or oversize metadata', async () => {
    for (const leagues of [[], [{ id: LEAGUE_A, name: 'Alpha', slug: 'alpha', status: 'inactive' }]]) {
      const response = await handlePublicCareerLeaguesRequest(request(), dependencies({
        readPublicLeagues: jest.fn().mockResolvedValue(leagues),
      }));
      expect(response.status).toBe(200);
      // eslint-disable-next-line supabase-test-quality/no-mock-echo -- verifies hidden metadata cannot escape
      expect((await response.json()).leagues).toEqual([]);
    }
    const cases = [
      [
        { id: LEAGUE_A, name: 'Alpha', slug: 'alpha', status: 'active' },
        { id: LEAGUE_A, name: 'Alpha 2', slug: 'alpha-2', status: 'active' },
      ],
      [{ id: LEAGUE_A, name: '', slug: 'alpha', status: 'active' }],
    ];
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const leagues of cases) {
        const response = await handlePublicCareerLeaguesRequest(request(), dependencies({
          readPublicLeagues: jest.fn().mockResolvedValue(leagues),
        }));
        expect(response.status).toBe(503);
      }
      const huge = 'x'.repeat(256 * 1024);
      const response = await handlePublicCareerLeaguesRequest(request(), dependencies({
        readPublicLeagues: jest.fn().mockResolvedValue([
          { id: LEAGUE_A, name: huge, slug: 'alpha', status: 'active' },
        ]),
      }));
      expect(response.status).toBe(503);
    } finally {
      log.mockRestore();
    }
  });

  it('serves a verified target custom domain but rejects an unbound external host', async () => {
    const verified = dependencies({
      readPublicLeagues: jest.fn().mockResolvedValue([{
        id: LEAGUE_A,
        name: 'Alpha',
        slug: 'alpha',
        status: 'active',
        custom_domain: 'stats.alpha.example',
        custom_domain_verified: true,
      }]),
    });
    expect((await handlePublicCareerLeaguesRequest(
      request(undefined, 'stats.alpha.example'),
      verified,
    )).status).toBe(200);

    const rejected = await handlePublicCareerLeaguesRequest(request(undefined, 'evil.example'), dependencies());
    expect(rejected.status).toBe(400);
  });
});

type QueryCall = { table: string; method: string; args: unknown[] };

function queryClient(rows: Record<string, Array<{ league_id: string }>>, calls: QueryCall[]) {
  return {
    from(table: string) {
      const tableCalls = calls;
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order']) {
        builder[method] = (...args: unknown[]) => {
          tableCalls.push({ table, method, args });
          return builder;
        };
      }
      builder.range = async (...args: unknown[]) => {
        tableCalls.push({ table, method: 'range', args });
        const data = rows[table] ?? [];
        return { data, count: data.length, error: null };
      };
      return builder;
    },
  };
}

describe('default Supabase player-scoped discovery reads', () => {
  it('reads only league IDs with exact deterministic player-scoped queries before service access', async () => {
    const calls: QueryCall[] = [];
    const publicClient = queryClient({
      player_stats: [{ league_id: LEAGUE_A }],
      goalie_stats: [{ league_id: LEAGUE_B }],
      team_rosters: [{ league_id: LEAGUE_A }],
    }, calls);
    const serviceClient = queryClient({
      player_career_baselines: [{ league_id: LEAGUE_B }],
    }, calls);
    jest.mocked(createClient).mockResolvedValue(publicClient as never);
    jest.mocked(createServiceRoleClient).mockImplementation(() => {
      calls.push({ table: 'SERVICE', method: 'create', args: [] });
      return serviceClient as never;
    });

    await expect(readPlayerLeagueIds(PLAYER_ID)).resolves.toEqual([LEAGUE_A, LEAGUE_B]);
    expect(calls.filter((call) => call.method === 'select')).toEqual([
      { table: 'player_stats', method: 'select', args: ['league_id', { count: 'exact' }] },
      { table: 'goalie_stats', method: 'select', args: ['league_id', { count: 'exact' }] },
      { table: 'team_rosters', method: 'select', args: ['league_id', { count: 'exact' }] },
      { table: 'player_career_baselines', method: 'select', args: ['league_id', { count: 'exact' }] },
    ]);
    for (const table of ['player_stats', 'goalie_stats', 'team_rosters', 'player_career_baselines']) {
      expect(calls).toContainEqual({ table, method: 'eq', args: ['player_id', PLAYER_ID] });
      expect(calls).toContainEqual({ table, method: 'order', args: ['league_id', { ascending: true }] });
    }
    const serviceIndex = calls.findIndex((call) => call.table === 'SERVICE');
    expect(calls.slice(0, serviceIndex).filter((call) => call.method === 'range')).toHaveLength(3);
  });

  it('does not interpret a default source query failure as empty', async () => {
    const calls: QueryCall[] = [];
    const client = queryClient({}, calls);
    const originalFrom = client.from;
    client.from = ((table: string) => {
      const builder = originalFrom(table) as Record<string, unknown>;
      if (table === 'goalie_stats') builder.range = async () => ({ data: [], count: null, error: { message: 'denied' } });
      return builder;
    }) as typeof client.from;
    jest.mocked(createClient).mockResolvedValue(client as never);
    await expect(readPlayerLeagueIds(PLAYER_ID)).rejects.toThrow();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it('resolves only explicit active public metadata for the exact candidate IDs', async () => {
    const calls: QueryCall[] = [];
    jest.mocked(createClient).mockResolvedValue(queryClient({
      leagues: [{ league_id: LEAGUE_A }],
    }, calls) as never);
    await readPublicLeagues([LEAGUE_A]);
    expect(calls).toContainEqual({
      table: 'leagues',
      method: 'select',
      args: ['id, name, slug, status, custom_domain, custom_domain_verified', { count: 'exact' }],
    });
    expect(calls).toContainEqual({ table: 'leagues', method: 'in', args: ['id', [LEAGUE_A]] });
    expect(calls).toContainEqual({ table: 'leagues', method: 'eq', args: ['status', 'active'] });
  });
});

describe('career leagues route metadata', () => {
  it('is force-dynamic and delegates GET', async () => {
    jest.mocked(createClient).mockResolvedValue(queryClient({}, []) as never);
    jest.mocked(createServiceRoleClient).mockReturnValue(queryClient({}, []) as never);
    jest.mocked(hasPlatformSubscription).mockResolvedValue(true);
    expect(dynamic).toBe('force-dynamic');
    const response = await GET(request('playerId=bad'), { params: Promise.resolve({}) });
    expect(response.status).toBe(400);
  });
});
