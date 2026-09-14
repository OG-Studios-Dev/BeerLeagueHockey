import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getLeagueContent } from '../../src/lib/leagueContent.ts';

const league = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'hockey-life',
  name: 'Hockey Life',
  logoUrl: null,
};

describe('public league-content client', () => {
  it('times out a pending request, then permits a successful retry', async () => {
    let attempts = 0;
    const empty = { schemaVersion: 1, view: 'news', league, articles: [], total: 0 } as const;
    const fetcher = async (_url: string, init?: { signal?: AbortSignal }) => {
      attempts += 1;
      if (attempts === 1) {
        return await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(empty) };
    };

    await assert.rejects(getLeagueContent('hockey-life', { view: 'news' }, fetcher, undefined, 10), /request timed out/i);
    const recovered = await getLeagueContent('hockey-life', { view: 'news' }, fetcher, undefined, 50);
    assert.equal(recovered.view, 'news');
    assert.equal(recovered.total, 0);
  });

  it('propagates an external abort and ignores a late transport completion', async () => {
    const external = new AbortController();
    let resolveLate!: (value: { ok: boolean; status: number; text(): Promise<string> }) => void;
    let internalSignal: AbortSignal | undefined;
    const pending = getLeagueContent('hockey-life', { view: 'news' }, async (_url, init) => {
      internalSignal = init?.signal;
      return await new Promise(resolve => { resolveLate = resolve; });
    }, external.signal, 1000);

    external.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError');
    assert.equal(internalSignal?.aborted, true);
    resolveLate({ ok: true, status: 200, text: async () => JSON.stringify({ schemaVersion: 1, view: 'news', league, articles: [], total: 0 }) });
    await new Promise<void>(resolve => setImmediate(resolve));

    const completedExternal = new AbortController();
    let completedInternal: AbortSignal | undefined;
    await getLeagueContent('hockey-life', { view: 'news' }, async (_url, init) => {
      completedInternal = init?.signal;
      return { ok: true, status: 200, text: async () => JSON.stringify({ schemaVersion: 1, view: 'news', league, articles: [], total: 0 }) };
    }, completedExternal.signal, 1000);
    completedExternal.abort();
    assert.equal(completedInternal?.aborted, false);
  });

  it('reads and validates the real news transport composition', async () => {
    // SYNTHETIC FIXTURE: contract-shaped public response, not business data.
    const payload = {
      schemaVersion: 1,
      view: 'news',
      league,
      articles: [{
        id: '22222222-2222-4222-8222-222222222222', slug: 'synthetic-recap', title: 'Synthetic recap',
        excerpt: null, imageUrl: null, type: 'game_recap', publishedAt: '2026-01-02T03:04:05.000Z',
        authorName: null, authorId: null,
      }],
      total: 1,
    } as const;
    let requested = '';
    const result = await getLeagueContent('hockey-life', { view: 'news' }, async (url) => {
      requested = url;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    });

    assert.equal(requested, 'https://api.beerleaguehockey.ca/api/public/league-content?leagueSlug=hockey-life&view=news');
    assert.equal(result.view, 'news');
    assert.equal(result.articles[0]?.excerpt, null);
    assert.equal(result.total, result.articles.length);
  });

  it('rejects a stale article response whose detail identity differs from the request', async () => {
    // SYNTHETIC FIXTURE: deliberately mismatched detail identity.
    const payload = {
      schemaVersion: 1, view: 'article', league,
      article: {
        id: '22222222-2222-4222-8222-222222222222', slug: 'different-story', title: 'Synthetic story',
        excerpt: null, imageUrl: null, type: 'news', publishedAt: '2026-01-02T03:04:05.000Z',
        authorName: null, authorId: null, content: 'Published paragraph.', mentions: [], taggedPlayers: [], relatedGame: null,
      },
    } as const;
    await assert.rejects(
      getLeagueContent('hockey-life', { view: 'article', articleSlug: 'requested-story' }, async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(payload),
      })),
      /article identity mismatch/i,
    );
  });

  it('rejects unsafe automatic media URLs instead of loading executable schemes', async () => {
    // SYNTHETIC FIXTURE: malicious transport value, not published content.
    const payload = {
      schemaVersion: 1, view: 'news', league,
      articles: [{ id: '22222222-2222-4222-8222-222222222222', slug: 'synthetic-news', title: 'Synthetic news', excerpt: null, imageUrl: 'data:text/html,bad', type: 'news', publishedAt: '2026-01-02T03:04:05.000Z', authorName: null, authorId: null }], total: 1,
    };
    await assert.rejects(getLeagueContent('hockey-life', { view: 'news' }, async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) })), /image URL/i);
  });

  it('distinguishes published absence, incomplete composition, and source failure', async () => {
    // SYNTHETIC FIXTURES: empty means published absence only when the complete count agrees.
    const empty = { schemaVersion: 1, view: 'news', league, articles: [], total: 0 };
    const result = await getLeagueContent('hockey-life', { view: 'news' }, async () => ({ ok: true, status: 200, text: async () => JSON.stringify(empty) }));
    assert.equal(result.view, 'news');
    assert.equal(result.total, 0);

    await assert.rejects(getLeagueContent('hockey-life', { view: 'news' }, async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ...empty, total: 1 }) })), /Incomplete news response/);
    await assert.rejects(getLeagueContent('hockey-life', { view: 'news' }, async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 'source_read_failed', message: 'Synthetic later page failed' } }) })), /Synthetic later page failed/);
  });

  it('requires every album photo and the exact UTF-8 response budget', async () => {
    const albumId = '33333333-3333-4333-8333-333333333333';
    // SYNTHETIC FIXTURE: total sentinel represents a later page omitted by the producer.
    const incomplete = {
      schemaVersion: 1, view: 'album', league,
      album: { id: albumId, title: 'Synthetic album', description: null, seasonId: null, seasonName: null, coverUrl: null, photoCount: 2, createdAt: null },
      photos: [{ id: '44444444-4444-4444-8444-444444444444', albumId, imageUrl: 'https://images.example.test/one.jpg', thumbnailUrl: null, caption: null, sortOrder: 0 }], total: 2,
    };
    await assert.rejects(getLeagueContent('hockey-life', { view: 'album', albumId }, async () => ({ ok: true, status: 200, text: async () => JSON.stringify(incomplete) })), /Incomplete album response/);
    await assert.rejects(getLeagueContent('hockey-life', { view: 'news' }, async () => ({ ok: true, status: 200, text: async () => '🏒'.repeat(140_000) })), /payload exceeds byte limit/);
  });
});
