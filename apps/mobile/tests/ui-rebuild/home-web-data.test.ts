/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Supabase query harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

const {
  filterArticlesForPresentationSeason,
  filterGamesToLeagueWeek,
  normalizeHomeGameStatus,
  selectPresentationSeason,
  selectSponsorStrip,
  toSafeWebUrl,
} = compileCommonJs<any>(new URL('../../src/lib/supabase/home.ts', import.meta.url), {
  './client': { supabase: {} },
});

describe('web-contract Home data boundary', () => {
  it('chooses the website presentation season rather than the operational membership season', () => {
    const selected = selectPresentationSeason([
      { id: 'completed-new', league_id: 'l', name: 'C', status: 'completed', start_date: '2026-09-01', end_date: null, created_at: '2026-09-01' },
      { id: 'playoffs', league_id: 'l', name: 'P', status: 'playoffs', start_date: '2026-03-01', end_date: null, created_at: '2026-03-01' },
      { id: 'active-old', league_id: 'l', name: 'A', status: 'active', start_date: '2025-09-01', end_date: null, created_at: '2025-09-01' },
    ], 'l');
    assert.equal(selected?.id, 'active-old');
  });

  it('uses exact season tags, bounded untagged dates, then the published all-season fallback', () => {
    const season = { id: 'season-a', league_id: 'l', name: 'A', status: 'active', start_date: '2026-01-01', end_date: '2026-04-30', created_at: null };
    const rows = [
      { id: 'tagged', season_id: 'season-a', published_at: '2025-01-01', created_at: '2025-01-01' },
      { id: 'other-tag', season_id: 'season-b', published_at: '2026-02-01', created_at: '2026-02-01' },
      { id: 'in-window', season_id: null, published_at: '2026-03-01', created_at: '2026-03-01' },
      { id: 'outside', season_id: null, published_at: '2025-12-31', created_at: '2025-12-31' },
    ];
    assert.deepEqual(filterArticlesForPresentationSeason(rows, season).map((row: any) => row.id), ['tagged', 'in-window']);
    assert.deepEqual(filterArticlesForPresentationSeason([rows[1], rows[3]], season).map((row: any) => row.id), ['other-tag', 'outside']);
  });

  it('filters the ±8 day read to the tenant timezone Monday-through-Sunday week', () => {
    const games = [
      { id: 'sun-before', scheduled_at: '2026-09-07T03:30:00.000Z' },
      { id: 'monday', scheduled_at: '2026-09-07T04:00:00.000Z' },
      { id: 'sunday', scheduled_at: '2026-09-14T03:59:59.000Z' },
      { id: 'monday-after', scheduled_at: '2026-09-14T04:00:00.000Z' },
    ];
    assert.deepEqual(
      filterGamesToLeagueWeek(games, new Date('2026-09-11T12:00:00.000Z'), 'America/Toronto').map((game: any) => game.id),
      ['monday', 'sunday'],
    );
  });

  it('keeps final/live/review/postponed/cancelled labels distinct from scheduled games', () => {
    assert.deepEqual(
      ['completed', 'in_progress', 'pending_verification', 'postponed', 'cancelled', 'scheduled'].map(normalizeHomeGameStatus),
      ['Final', 'Live', 'Awaiting Review', 'Postponed', 'Cancelled', 'Scheduled'],
    );
  });

  it('accepts only web links and applies the real sponsor tier/fallback contract', () => {
    assert.equal(toSafeWebUrl('https://example.com/path'), 'https://example.com/path');
    assert.equal(toSafeWebUrl('javascript:alert(1)'), null);
    assert.deepEqual(selectSponsorStrip([
      { id: 'silver', name: 'Silver', logo_url: 'https://images.test/s.png', website_url: null, tier: 'silver', display_order: 1 },
      { id: 'gold', name: 'Gold', logo_url: 'https://images.test/g.png', website_url: 'https://gold.test', tier: 'gold', display_order: 2 },
    ]).map((row: any) => row.id), ['gold']);
    assert.equal(selectSponsorStrip([])[0].id, 'hockey-life-contract-fallback');
    assert.equal(selectSponsorStrip([])[0].name, 'Hockey Life');
  });

  it('issues published, season-scoped, bounded read-only queries and keeps endpoint failure local to leaders', async () => {
    const calls: Array<[string, string, unknown[]]> = [];
    const results: Record<string, { data: unknown; error: unknown }> = {
      leagues: { data: { id: 'league-1', slug: 'harbour', status: 'active', timezone: 'America/Toronto', settings: {} }, error: null },
      seasons: { data: [{ id: 'season-1', league_id: 'league-1', name: '2026', status: 'active', start_date: '2026-01-01', end_date: null, created_at: null }], error: null },
      articles: { data: [], error: null }, games: { data: [], error: null }, gallery_photos: { data: [], error: null },
      league_gallery: { data: [], error: null }, league_sponsors: { data: [], error: null }, teams: { data: [], error: null },
    };
    const query = (table: string) => {
      const chain: Record<string, any> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => { calls.push([table, method, args]); return chain; };
      }
      chain.maybeSingle = async () => results[table];
      chain.then = (resolve: (value: unknown) => void) => resolve(results[table]);
      return chain;
    };
    const loader = compileCommonJs<any>(new URL('../../src/lib/supabase/home.ts', import.meta.url), {
      './client': {
        supabase: {
          from: (table: string) => query(table),
          rpc: async () => ({ data: [], error: null }),
        },
      },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    try {
      const result = await loader.loadHomePublicSnapshot('league-1', 'harbour', new Date('2026-09-11T12:00:00Z'));
      assert.equal(result.articles.status, 'ready');
      assert.equal(result.weeklyGames.status, 'ready');
      assert.equal(result.leaders.status, 'error');
      assert.equal(result.standings.status, 'error');
    } finally {
      globalThis.fetch = previousFetch;
    }
    const has = (table: string, method: string, first: unknown, second?: unknown) => calls.some(([t, m, args]) => t === table && m === method && args[0] === first && (second === undefined || args[1] === second));
    assert.ok(has('articles', 'eq', 'published', true));
    assert.ok(has('articles', 'in', 'type'));
    assert.ok(has('games', 'eq', 'season_id', 'season-1'));
    assert.ok(has('games', 'in', 'status'));
    assert.ok(has('games', 'gte', 'scheduled_at'));
    assert.ok(has('games', 'lte', 'scheduled_at'));
    assert.ok(has('gallery_photos', 'eq', 'league_gallery.is_published', true));
    assert.ok(has('league_sponsors', 'eq', 'is_active', true));
    assert.equal(calls.some(([, method]) => method === 'rpc'), false);
  });
});
