/* eslint-disable @typescript-eslint/no-explicit-any -- deliberately hostile boundary fixtures */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const SLUG = 'harbour-hockey';

const season = {
  id: SEASON_ID, league_id: LEAGUE_ID, name: 'Fall 2026', status: 'active',
  start_date: '2026-09-01', end_date: null, created_at: '2026-08-01T00:00:00Z',
};

const leader = {
  player_id: 'player-opaque-1', player_name: 'Alex Ace', avatar_url: null,
  team_id: null, team_name: 'Free Agent', display_team_name: null,
  display_team_logo_url: null, position: null, goals: 4, assists: 3, points: 7,
};

const standing = {
  team_id: 'team-opaque-1', team_name: 'Harbour Wolves', logo_url: null,
  primary_color: null, division_id: DIVISION_ID, division_name: 'A', team_type: 'standard',
  games_played: 4, wins: 3, losses: 1, ties: 0, goals_for: 14,
  goals_against: 8, goal_differential: 6, points: 6,
};

const division = { id: DIVISION_ID, name: 'A', sort_order: 2 };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, leagueId: LEAGUE_ID, leagueSlug: SLUG,
    presentationSeason: season, leaders: [leader], standings: [standing], divisions: [division],
    ...overrides,
  };
}

function makeBoundary({
  responsePayload = payload(), timezone = 'America/Toronto', leagueRow,
  seasonRows = [season],
  resultData = {},
}: {
  responsePayload?: unknown;
  timezone?: unknown;
  leagueRow?: unknown;
  seasonRows?: unknown[];
  resultData?: Record<string, unknown>;
} = {}) {
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  const results: Record<string, { data: unknown; error: unknown }> = {
    leagues: {
      data: leagueRow === undefined
        ? { id: LEAGUE_ID, slug: SLUG, status: 'active', timezone, settings: {} }
        : leagueRow,
      error: null,
    },
    seasons: { data: seasonRows, error: null },
    articles: { data: [], error: null },
    games: { data: [], error: null },
    gallery_photos: { data: [], error: null },
    league_gallery: { data: [], error: null },
    league_sponsors: { data: [], error: null },
    teams: { data: [], error: null },
  };
  for (const [table, data] of Object.entries(resultData)) results[table] = { data, error: null };
  const query = (table: string) => {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => results[table];
    chain.then = (resolve: (value: unknown) => void) => resolve(results[table]);
    return chain;
  };
  const loader = compileCommonJs<any>(new URL('../../src/lib/supabase/home.ts', import.meta.url), {
    './client': {
      supabase: {
        from: (table: string) => query(table),
        rpc: async (...args: unknown[]) => {
          calls.push({ method: 'rpc', args });
          return { data: [], error: null };
        },
      },
    },
  });
  let fetchCount = 0;
  const load = async (slug = SLUG) => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    try {
      return await loader.loadHomePublicSnapshot(LEAGUE_ID, slug, new Date('2026-09-11T12:00:00Z'));
    } finally {
      globalThis.fetch = previousFetch;
    }
  };
  return { calls, fetchCount: () => fetchCount, load, loader };
}

describe('reviewed Home data corrections', () => {
  it('keeps article fallback separate from current-season album filtering', () => {
    const { loader } = makeBoundary();
    const oldAlbum = { id: 'old', season_id: 'old-season', created_at: '2025-01-01' };
    assert.deepEqual(loader.filterAlbumsForPresentationSeason([oldAlbum], season), []);
    assert.deepEqual(loader.filterAlbumsForPresentationSeason([oldAlbum], null), []);
  });

  it('accepts the complete versioned companion DTO, preserves opaque IDs, and never invokes generic standings', async () => {
    const boundary = makeBoundary();
    const result = await boundary.load();
    assert.equal(result.leaders.status, 'ready');
    assert.equal(result.standings.status, 'ready');
    assert.deepEqual(result.leaders.data, [leader]);
    assert.deepEqual(result.standings.data, [standing]);
    assert.deepEqual(result.divisions, [division]);
    assert.equal(boundary.calls.some((call) => call.method === 'rpc'), false);
  });

  it('rejects wrong schema/tenant/season, malformed rows, non-finite facts, invalid divisions, and bounds as one endpoint-owned error', async () => {
    const hostile = [
      payload({ schemaVersion: 2 }),
      payload({ leagueId: 'other-league' }),
      payload({ leagueSlug: 'other-slug' }),
      payload({ presentationSeason: { ...season, id: 'other-season' } }),
      payload({ presentationSeason: { ...season, league_id: 'other-league' } }),
      payload({ leaders: [{ ...leader, player_id: '', player_name: 7 }] }),
      payload({ leaders: [{ ...leader, goals: '4' }] }),
      payload({ leaders: [{ ...leader, points: Number.NaN }] }),
      payload({ standings: [{ ...standing, wins: 'many' }] }),
      payload({ standings: [{ ...standing, team_id: '' }] }),
      payload({ divisions: [{ id: '', name: 'A' }] }),
      payload({ leaders: Array.from({ length: 16 }, (_, index) => ({ ...leader, player_id: `p-${index}` })) }),
      payload({ standings: Array.from({ length: 201 }, (_, index) => ({ ...standing, team_id: `t-${index}` })) }),
      payload({ divisions: Array.from({ length: 65 }, (_, index) => ({ id: `d-${index}`, name: `D${index}` })) }),
    ];
    for (const responsePayload of hostile) {
      const boundary = makeBoundary({ responsePayload });
      const result = await boundary.load();
      assert.equal(result.leaders.status, 'error');
      assert.equal(result.standings.status, 'error');
      assert.deepEqual(result.leaders.data, []);
      assert.deepEqual(result.standings.data, []);
      assert.equal(boundary.calls.some((call) => call.method === 'rpc'), false);
    }
  });

  it('requires null season and both authoritative arrays to stay empty when the client has no presentation season', async () => {
    const boundary = makeBoundary({ responsePayload: payload({ presentationSeason: null, leaders: [leader], standings: [] }), seasonRows: [] });
    const result = await boundary.load();
    assert.equal(result.leaders.status, 'error');
    assert.equal(result.standings.status, 'error');
  });

  it('contains an invalid configured timezone to weekly games while other good public sections settle', async () => {
    const boundary = makeBoundary({ timezone: 'Not/A_Zone' });
    const result = await boundary.load();
    assert.equal(result.timezone, null);
    assert.equal(result.weeklyGames.status, 'error');
    assert.equal(result.articles.status, 'ready');
    assert.equal(result.leaders.status, 'ready');
    assert.equal(result.standings.status, 'ready');
  });

  it('rejects a non-literal host slug before URL construction and does not treat missing/inactive league metadata as public data', async () => {
    const badSlug = makeBoundary();
    const slugResult = await badSlug.load('hockey‑life');
    assert.equal(badSlug.fetchCount(), 0);
    assert.equal(slugResult.leaders.status, 'error');
    assert.equal(slugResult.standings.status, 'error');

    const missingLeague = makeBoundary({ leagueRow: null });
    const missingResult = await missingLeague.load();
    assert.equal(missingLeague.fetchCount(), 0);
    for (const key of ['articles', 'weeklyGames', 'leaders', 'standings', 'photos', 'albums', 'community', 'sponsors'] as const) {
      assert.equal(missingResult[key].status, 'error', `${key} must disclose inactive/missing league metadata`);
    }
  });

  it('rejects missing or mismatched weekly team joins and cross-season rows without stranding independent facts', async () => {
    const home = { id: 'home-team', name: 'Home', logo_url: null, primary_color: null };
    const away = { ...home, id: 'away-team', name: 'Away' };
    const game = { id: 'game', league_id: LEAGUE_ID, season_id: SEASON_ID, status: 'scheduled',
      scheduled_at: '2026-09-11T19:00:00Z', location: null, home_score: null, away_score: null,
      home_team_id: home.id, away_team_id: away.id, home_team: home, away_team: away };
    for (const invalid of [{ ...game, home_team: null }, { ...game, away_team: [] },
      { ...game, home_team: { ...home, id: 'wrong-team' } }, { ...game, season_id: 'other-season' }]) {
      const result = await makeBoundary({ resultData: { games: [invalid] } }).load();
      assert.equal(result.weeklyGames.status, 'error');
      assert.equal(result.leaders.status, 'ready');
    }
  });

  it('adds News, current-season Photos, and Contact only inside a configured-social Community', async () => {
    const article = {
      id: 'article-1', league_id: LEAGUE_ID, season_id: SEASON_ID, title: 'News', content: '',
      excerpt: null, image_url: null, slug: 'news', published_at: '2026-09-10', created_at: '2026-09-10', type: 'news',
    };
    const album = {
      id: 'album-1', league_id: LEAGUE_ID, season_id: SEASON_ID, title: 'Photos', description: null,
      cover_photo_url: null, created_at: '2026-09-10',
    };
    const configured = makeBoundary({
      leagueRow: { id: LEAGUE_ID, slug: SLUG, status: 'active', timezone: 'America/Toronto', settings: { website: { socialInstagram: 'https://instagram.com/harbour' } } },
      resultData: { articles: [article], league_gallery: [album] },
    });
    const configuredResult = await configured.load();
    assert.deepEqual(configuredResult.community.data.map((row: any) => row.label), ['Instagram', 'News', 'Photos', 'Contact']);

    const noSocial = makeBoundary({ resultData: { articles: [article], league_gallery: [album] } });
    const noSocialResult = await noSocial.load();
    assert.deepEqual(noSocialResult.community.data, []);
  });
});
