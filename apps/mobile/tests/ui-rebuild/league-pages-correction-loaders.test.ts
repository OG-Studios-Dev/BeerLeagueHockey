/* eslint-disable @typescript-eslint/no-explicit-any -- projection-aware Supabase boundary double */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

const leagueId = 'league-a';
const season = {
  id: 'season-current', league_id: leagueId, name: 'Fall', status: 'active',
  start_date: '2026-09-01', end_date: '2026-12-31', created_at: '2026-08-01T00:00:00Z',
};

function article(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `story-${String(index).padStart(3, '0')}`, league_id: leagueId, season_id: season.id,
    title: `Story ${index}`, content: '', excerpt: null, image_url: null, slug: `story-${index}`,
    published: true, published_at: `2026-10-${String((index % 3) + 1).padStart(2, '0')}T12:00:00Z`,
    created_at: '2026-10-01T12:00:00Z', type: 'news', ...overrides,
  };
}

function homeBoundary(rows: any[], failures = new Map<number, number>()) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, 'articles');
      let filtered = [...rows];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      const chain: any = {
        select(projection: string) { calls.push({ method: 'select', args: [projection] }); return chain; },
        eq(column: string, value: unknown) { calls.push({ method: 'eq', args: [column, value] }); filtered = filtered.filter((row) => row[column] === value); return chain; },
        in(column: string, values: unknown[]) { calls.push({ method: 'in', args: [column, values] }); filtered = filtered.filter((row) => values.includes(row[column])); return chain; },
        or(expression: string) {
          calls.push({ method: 'or', args: [expression] });
          const start = new Date(`${season.start_date}T00:00:00`).toISOString();
          const end = new Date(`${season.end_date}T23:59:59.999`).toISOString();
          assert.equal(expression, [
            `season_id.eq.${season.id}`,
            `and(season_id.is.null,published_at.not.is.null,published_at.gte.${start},published_at.lte.${end})`,
            `and(season_id.is.null,published_at.is.null,created_at.gte.${start},created_at.lte.${end})`,
          ].join(','));
          filtered = filtered.filter((row) => row.season_id === season.id || (row.season_id === null && (() => {
            const value = row.published_at ?? row.created_at;
            const time = new Date(value).getTime();
            return time >= new Date(`${season.start_date}T00:00:00`).getTime() && time <= new Date(`${season.end_date}T23:59:59.999`).getTime();
          })()));
          return chain;
        },
        order(column: string, options: { ascending: boolean }) { calls.push({ method: 'order', args: [column, options] }); orders.push({ column, ascending: options.ascending }); return chain; },
        range(from: number, to: number) {
          calls.push({ method: 'range', args: [from, to] });
          for (const order of [...orders].reverse()) filtered.sort((a, b) => {
            const compared = String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? ''));
            return order.ascending ? compared : -compared;
          });
          const remainingFailures = failures.get(from) ?? 0;
          if (remainingFailures > 0) {
            failures.set(from, remainingFailures - 1);
            return Promise.resolve({ data: null, error: { message: `page ${from} unavailable` } });
          }
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
        },
      };
      return chain;
    },
  };
  const loader = compileCommonJs<any>(new URL('../../src/lib/supabase/home.ts', import.meta.url), {
    './client': { supabase },
  });
  return { loader, calls };
}

describe('league pages correction loaders', () => {
  it('B1 pages every eligible current-season story with stable equal-date ordering past rows 5, 18, and provider page one', async () => {
    const current = Array.from({ length: 53 }, (_, index) => article(index));
    const input = [
      article(999, { season_id: 'historical', published_at: '2026-12-30T12:00:00Z' }),
      article(998, { published: false }),
      article(997, { type: 'feature' }),
      ...current.sort(() => 0.5 - 0.25),
    ];
    const boundary = homeBoundary(input);
    const result = await boundary.loader.loadPublishedPresentationArticles(leagueId, season);
    assert.equal(result.length, 53);
    assert.ok(result.some((row: any) => row.id === 'story-052'));
    assert.deepEqual(result, [...result].sort((a: any, b: any) =>
      String(b.published_at).localeCompare(String(a.published_at)) || a.id.localeCompare(b.id)));
    assert.deepEqual(boundary.calls.filter((call) => call.method === 'range').map((call) => call.args), [[0, 49], [50, 99]]);
    assert.ok(boundary.calls.some((call) => call.method === 'eq' && call.args[0] === 'published' && call.args[1] === true));
  });

  it('B1 retries a later provider page once and fails the whole news section instead of claiming partial completeness', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => article(index));
    const retry = homeBoundary(rows, new Map([[50, 1]]));
    assert.equal((await retry.loader.loadPublishedPresentationArticles(leagueId, season)).length, 51);
    assert.equal(retry.calls.filter((call) => call.method === 'range' && call.args[0] === 50).length, 2);

    const failure = homeBoundary(rows, new Map([[50, 2]]));
    await assert.rejects(() => failure.loader.loadPublishedPresentationArticles(leagueId, season), /page 50 unavailable/);
  });

  it('B1R applies exact explicit-season and unscoped date eligibility before the page range so history cannot consume the bound', async () => {
    const history = Array.from({ length: 1001 }, (_, index) => article(2000 + index, {
      id: `historical-${String(index).padStart(4, '0')}`, season_id: 'historical', published_at: '2026-12-30T12:00:00Z',
    }));
    const eligible = [
      article(1, { id: 'explicit-current-outside-date', published_at: '2027-02-01T00:00:00Z' }),
      article(2, { id: 'unscoped-start', season_id: null, published_at: '2026-09-01T00:00:00' }),
      article(3, { id: 'unscoped-end', season_id: null, published_at: '2026-12-31T23:59:59.999' }),
      article(4, { id: 'unscoped-created-fallback', season_id: null, published_at: null, created_at: '2026-10-15T12:00:00Z' }),
    ];
    const negatives = [
      article(5, { id: 'historical-in-window', season_id: 'historical', published_at: '2026-10-01T12:00:00Z' }),
      article(6, { id: 'unscoped-before', season_id: null, published_at: '2026-08-31T23:59:59' }),
      article(7, { id: 'unscoped-after', season_id: null, published_at: '2027-01-01T00:00:00' }),
    ];
    const boundary = homeBoundary([...history, ...negatives, ...eligible]);
    const result = await boundary.loader.loadPublishedPresentationArticles(leagueId, season);
    assert.deepEqual(new Set(result.map((row: any) => row.id)), new Set(eligible.map((row) => row.id)));
    const methods = boundary.calls.map((call) => call.method);
    assert.ok(methods.indexOf('or') > methods.indexOf('in'));
    assert.ok(methods.indexOf('or') < methods.indexOf('range'));
    assert.deepEqual(boundary.calls.filter((call) => call.method === 'range').map((call) => call.args), [[0, 49]]);
    const filter = boundary.calls.find((call) => call.method === 'or')?.args[0];
    assert.match(String(filter), /season_id\.eq\.season-current/);
    assert.match(String(filter), /season_id\.is\.null/);
    assert.match(String(filter), /published_at\.is\.null/);
    assert.match(String(filter), /created_at\.gte\./);
  });

  it('B2 selects the canonical operational season without changing the legacy helper', () => {
    const data = compileCommonJs<any>(new URL('../../src/lib/supabase/data.ts', import.meta.url), {
      './client': { supabase: {} },
    });
    const selected = data.selectOperationalSeason([
      { id: 'completed', status: 'completed', start_date: '2026-09-01', end_date: null, created_at: '2026-08-01' },
      { id: 'registration-old', status: 'registration', start_date: '2026-10-01', end_date: null, created_at: '2026-08-01' },
      { id: 'registration-new', status: 'registration', start_date: null, end_date: '2026-11-01', created_at: '2026-08-01' },
      { id: 'draft', status: 'draft', start_date: '2027-01-01', end_date: null, created_at: '2026-08-01' },
    ]);
    assert.equal(selected.id, 'registration-new');
  });

  it('B3 uses complete deterministic schedule pages and rejects later-page failure instead of returning partial facts', async () => {
    const rows = Array.from({ length: 251 }, (_, index) => ({
      id: `game-${String(index).padStart(3, '0')}`, league_id: leagueId, home_team_id: 'home', away_team_id: 'away',
      home_score: null, away_score: null, scheduled_at: index < 2 ? '2026-10-01T12:00:00Z' : `2026-10-${String((index % 27) + 1).padStart(2, '0')}T12:00:00Z`,
      status: 'scheduled', game_type: 'regular', location: null, season_id: season.id, division_id: null,
      home_team: null, away_team: null,
    }));
    const createData = (failFrom: number | null) => {
      const ranges: number[][] = [];
      const supabase = { from(table: string) {
        assert.equal(table, 'games');
        let values = [...rows];
        const orders: Array<{ column: string; ascending: boolean }> = [];
        const chain: any = {
          select() { return chain; },
          eq(column: string, value: unknown) { values = values.filter((row: any) => row[column] === value); return chain; },
          order(column: string, options: { ascending: boolean }) { orders.push({ column, ascending: options.ascending }); return chain; },
          range(from: number, to: number) {
            ranges.push([from, to]);
            if (from === failFrom) return Promise.resolve({ data: null, error: { message: 'later page failed' } });
            for (const order of [...orders].reverse()) values.sort((a: any, b: any) => {
              const compared = String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? ''));
              return order.ascending ? compared : -compared;
            });
            return Promise.resolve({ data: values.slice(from, to + 1), error: null });
          },
        };
        return chain;
      } };
      return { data: compileCommonJs<any>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': { supabase } }), ranges };
    };
    const success = createData(null);
    const games = await success.data.getSchedule(leagueId, season.id, null, { complete: true, throwOnError: true });
    assert.equal(games.length, 251);
    assert.deepEqual(success.ranges, [[0, 249], [250, 499]]);
    assert.deepEqual(games.slice(0, 2).map((game: any) => game.id), ['game-000', 'game-001']);

    const failure = createData(250);
    await assert.rejects(() => failure.data.getSchedule(leagueId, season.id, null, { complete: true, throwOnError: true }), /later page failed/);
    const firstFailure = createData(0);
    await assert.rejects(() => firstFailure.data.getSchedule(leagueId, season.id, null, { complete: true, throwOnError: true }), /later page failed/);
  });

  it('B3 rejects a failed standings RPC plus failed complete fallback instead of returning authoritative emptiness', async () => {
    const supabase = {
      rpc: async () => ({ data: null, error: { message: 'rpc failed' } }),
      from(table: string) {
        const chain: any = {
          select() { return chain; }, eq() { return chain; }, order() { return chain; },
          range() { return Promise.resolve({ data: null, error: { message: 'fallback failed' } }); },
          then(resolve: (value: unknown) => void) {
            resolve(table === 'teams' ? { data: [], error: null } : { data: null, error: { message: 'fallback failed' } });
          },
        };
        return chain;
      },
    };
    const data = compileCommonJs<any>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': { supabase } });
    await assert.rejects(() => data.getStandings(leagueId, season.id, { complete: true, throwOnError: true }), /fallback failed/);
  });
});
