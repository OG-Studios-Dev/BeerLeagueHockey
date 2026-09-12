/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileCommonJs } from './component-harness';

function dataBoundary() {
  const requests: any[] = [];
  const supabase = {
    rpc: async (name: string, args: any) => { requests.push({ name, args }); return { data: null, error: { message: 'RPC unavailable' } }; },
    from: (table: string) => {
      const query: any = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: table === 'seasons' ? { id: 'current-season' } : null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'Stats read failed' } }).then(resolve),
      };
      return query;
    },
  };
  const data = compileCommonJs<{ getStatsLeaders: (...args: any[]) => Promise<any[]> }>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': { supabase } });
  return { ...data, requests };
}

it('lets the card distinguish failed stats reads from successful emptiness without changing legacy callers', async () => {
  const data = dataBoundary();
  await assert.rejects(data.getStatsLeaders('league-a', 'goals', 5, 'division-a', undefined, { throwOnError: true }), /Stats read failed/);
  assert.deepEqual(await data.getStatsLeaders('league-a', 'goals', 5, 'division-a'), []);
  assert.deepEqual(data.requests[0], { name: 'get_stats_leaders', args: { p_league_id: 'league-a', p_stat_type: 'goals', p_limit: 5, p_division_id: 'division-a' } });
});
