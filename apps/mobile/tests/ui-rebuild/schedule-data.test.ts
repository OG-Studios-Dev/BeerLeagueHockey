import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createLeagueClient(row: unknown) {
  const predicates: Array<[string, unknown]> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => { predicates.push([column, value]); return query; },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { supabase: { from: (table: string) => { assert.equal(table, 'leagues'); return query; } }, predicates };
}

describe('Schedule snapshot loader', () => {
  it('waits for the operational season before issuing one complete, explicit-error schedule read', async () => {
    const season = deferred<Record<string, unknown> | null>();
    const calls: Array<{ leagueId: string; seasonId: string | null; divisionId: string | null; options: unknown }> = [];
    const league = createLeagueClient({ id: 'league-a', status: 'active', timezone: 'America/Toronto' });
    const loader = compileCommonJs<any>(new URL('../../src/lib/supabase/schedule.ts', import.meta.url), {
      './client': { supabase: league.supabase },
      './data': {
        getOperationalSeason: async () => season.promise,
        getSchedule: async (leagueId: string, seasonId: string | null, divisionId: string | null, options: unknown) => {
          calls.push({ leagueId, seasonId, divisionId, options });
          return [{ id: 'game-a' }];
        },
      },
    });

    const pending = loader.loadScheduleSnapshot('league-a', 'division-a');
    await Promise.resolve();
    assert.deepEqual(calls, []);
    season.resolve({ id: 'season-a', name: 'Winter', start_date: '2026-01-01', end_date: null, status: 'active' });
    const snapshot = await pending;

    assert.deepEqual(calls, [{
      leagueId: 'league-a', seasonId: 'season-a', divisionId: 'division-a', options: { complete: true, throwOnError: true },
    }]);
    assert.deepEqual(league.predicates, [['id', 'league-a']]);
    assert.equal(snapshot.kind, 'ready');
    assert.equal(snapshot.scopeKey, 'league-a:season-a:division-a');
    assert.equal(snapshot.timezone, 'America/Toronto');
    assert.equal(snapshot.games[0].id, 'game-a');
  });

  it('returns no-season without a schedule read and rejects mismatched league identity before games', async () => {
    let scheduleReads = 0;
    const noSeasonClient = createLeagueClient({ id: 'league-a', status: 'active', timezone: null });
    const noSeasonLoader = compileCommonJs<any>(new URL('../../src/lib/supabase/schedule.ts', import.meta.url), {
      './client': { supabase: noSeasonClient.supabase },
      './data': {
        getOperationalSeason: async () => null,
        getSchedule: async () => { scheduleReads += 1; return []; },
      },
    });
    assert.deepEqual(await noSeasonLoader.loadScheduleSnapshot('league-a', null), {
      kind: 'no-season', scopeKey: 'league-a:no-season:all', season: null, timezone: null, games: [],
    });
    assert.equal(scheduleReads, 0);
    assert.deepEqual(noSeasonClient.predicates, []);

    const mismatchClient = createLeagueClient({ id: 'league-b', status: 'active', timezone: 'America/Toronto' });
    const mismatchLoader = compileCommonJs<any>(new URL('../../src/lib/supabase/schedule.ts', import.meta.url), {
      './client': { supabase: mismatchClient.supabase },
      './data': {
        getOperationalSeason: async () => ({ id: 'season-a', name: 'Winter' }),
        getSchedule: async () => { scheduleReads += 1; return []; },
      },
    });
    await assert.rejects(() => mismatchLoader.loadScheduleSnapshot('league-a', null), /inactive or mismatched/);
    assert.equal(scheduleReads, 0);
  });
});
