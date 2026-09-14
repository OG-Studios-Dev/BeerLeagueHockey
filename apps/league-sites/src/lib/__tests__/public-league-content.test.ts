import { NextRequest } from 'next/server';

import {
  handlePublicLeagueContentRequest,
  type PublicLeagueContentDependencies,
} from '@/lib/public-league-content';
import { GET, dynamic } from '@/app/api/public/league-content/route';

const SYNTHETIC_LEAGUE_ID = '10000000-0000-4000-8000-000000000001';

function request(query: string, host = 'hockey-life.beerleaguehockey.ca', method = 'GET') {
  return new NextRequest(`https://${host}/api/public/league-content?${query}`, {
    method,
    headers: { host },
  });
}

function syntheticDependencies(): PublicLeagueContentDependencies {
  return {
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    getLeagueBySlug: async () => ({
      id: SYNTHETIC_LEAGUE_ID,
      slug: 'hockey-life',
      name: 'Synthetic Hockey League',
      logo_url: null,
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
      custom_domain: null,
      custom_domain_verified: false,
    }),
    hasPlatformSubscription: async () => true,
    createSource: () => ({
      loadNews: async () => [],
      loadArticle: async () => null,
      loadHistory: async () => ({
        foundingYear: 2020,
        seasons: [], champions: [], seasonStandings: [], dynasties: [], boards: [], awards: [],
        stats: { totalSeasons: 0, totalGames: 0, totalTeams: 0, uniqueChampions: 0 },
      }),
      loadGallery: async () => ({ seasons: [], albums: [] }),
      loadAlbum: async () => null,
    }),
  };
}

describe('GET /api/public/league-content query and tenant boundary', () => {
  it('is mounted as a dynamic GET route', async () => {
    const response = await GET(request('leagueSlug=hockey-life'));
    expect(dynamic).toBe('force-dynamic');
    expect(response.status).toBe(400);
  });
  it('returns the exact version-1 news DTO after active/subscription guards', async () => {
    const deps = syntheticDependencies();
    const response = await handlePublicLeagueContentRequest(
      request('leagueSlug=hockey-life&view=news'),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      view: 'news',
      league: { id: SYNTHETIC_LEAGUE_ID, slug: 'hockey-life', name: 'Synthetic Hockey League', logoUrl: null },
      articles: [],
      total: 0,
    });
  });

  it.each([
    ['leagueSlug=hockey-life', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&view=news&view=gallery', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&view=news&albumId=20000000-0000-4000-8000-000000000002', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&view=article', 'INVALID_QUERY'],
    ['leagueSlug=hockey-life&view=album&albumId=not-a-uuid', 'INVALID_ALBUM_ID'],
    ['leagueSlug=hockey-life&view=news&extra=1', 'INVALID_QUERY'],
  ])('rejects invalid exact-contract query %s', async (query, code) => {
    const response = await handlePublicLeagueContentRequest(request(query), syntheticDependencies());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a tenant-host mismatch before privileged source creation', async () => {
    const deps = syntheticDependencies();
    const createSource = jest.fn(deps.createSource);
    const response = await handlePublicLeagueContentRequest(
      request('leagueSlug=hockey-life&view=news', 'other.beerleaguehockey.ca'),
      { ...deps, createSource },
    );
    expect(response.status).toBe(400);
    expect(createSource).not.toHaveBeenCalled();
  });

  it('returns public not-found and does not read content when subscription is absent', async () => {
    const deps = syntheticDependencies();
    const createSource = jest.fn(deps.createSource);
    const response = await handlePublicLeagueContentRequest(
      request('leagueSlug=hockey-life&view=news'),
      { ...deps, hasPlatformSubscription: async () => false, createSource },
    );
    expect(response.status).toBe(404);
    expect(createSource).not.toHaveBeenCalled();
  });

  it('distinguishes a factual empty dataset from a source failure', async () => {
    const empty = await handlePublicLeagueContentRequest(request('leagueSlug=hockey-life&view=news'), syntheticDependencies());
    expect(empty.status).toBe(200);
    expect((await empty.json()).total).toBe(0);

    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const deps = syntheticDependencies();
      const source = deps.createSource({ id: SYNTHETIC_LEAGUE_ID, slug: 'hockey-life', name: 'Synthetic Hockey League' }, deps.now());
      const failed = await handlePublicLeagueContentRequest(request('leagueSlug=hockey-life&view=news'), {
        ...deps,
        createSource: () => ({ ...source, loadNews: async () => { throw new Error('synthetic read failure'); } }),
      });
      expect(failed.status).toBe(503);
      expect((await failed.json()).error.code).toBe('CONTENT_DATA_UNAVAILABLE');
    } finally {
      log.mockRestore();
    }
  });

  it('enforces the 512 KiB UTF-8 response bound', async () => {
    const deps = syntheticDependencies();
    const source = deps.createSource({ id: SYNTHETIC_LEAGUE_ID, slug: 'hockey-life', name: 'Synthetic Hockey League' }, deps.now());
    const response = await handlePublicLeagueContentRequest(request('leagueSlug=hockey-life&view=article&articleSlug=large'), {
      ...deps,
      createSource: () => ({ ...source, loadArticle: async () => ({
        id: 'large', slug: 'large', title: 'Synthetic large article', excerpt: null, imageUrl: null,
        type: 'news', publishedAt: '2026-09-01T00:00:00.000Z', authorName: null, authorId: null,
        content: 'x'.repeat(513 * 1024), mentions: [], taggedPlayers: [], relatedGame: null,
      }) }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PAYLOAD_LIMIT_EXCEEDED');
  });
});
