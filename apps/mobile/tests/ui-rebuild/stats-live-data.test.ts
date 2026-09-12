/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileCommonJs } from './component-harness';

const active = { id: 'summer', name: 'Summer', league_id: 'league-a', status: 'active', start_date: '2026-07-02', end_date: '2026-09-25' };
const rows = [
  { player_id: 'scorer', full_name: 'Scorer', season_id: 'summer', division_id: 'division-a', goals: 15, assists: 10, points: 25, team_id: 'team-a', team_name: 'Team A', games_played: 9 },
  { player_id: 'older', full_name: 'Older season', season_id: 'spring', division_id: 'division-a', goals: 18, assists: 10, points: 28, team_id: 'team-b', team_name: 'Team B', games_played: 13 },
];
function boundary(options: { seasons?: any[]; seasonFailure?: boolean; rpcRows?: any[]; statsRows?: any[] } = {}) {
  const requests: any[] = [];
  const seasons = options.seasons ?? [active];
  const validStatuses = new Set(['active', 'playoffs', 'draft', 'completed', 'archived']);
  const supabase = {
    rpc: async (name: string, args: any) => { requests.push({ rpc: name, args }); return { data: options.rpcRows ?? [], error: null }; },
    from: (table: string) => {
      const filters: any[] = [], orders: any[] = []; let cap = Infinity;
      const execute = () => {
        requests.push({ table, filters: [...filters], orders: [...orders], limit: cap });
        if (table === 'seasons' && options.seasonFailure) return { data: null, error: { code: '08006', message: 'Season service unavailable' } };
        if (table === 'seasons' && filters.some(([key,value]) => key === 'status' && !validStatuses.has(value))) return { data: null, error: { code: '22P02', message: 'Unsupported season status' } };
        const source = table === 'seasons' ? seasons : (options.statsRows ?? rows);
        const data = source.filter(row => filters.every(([key,value]) => row[key] === value)).sort((a,b) => {
          for (const [key,ascending] of orders) { const delta = typeof a[key] === 'number' ? a[key]-b[key] : String(a[key]).localeCompare(String(b[key])); if (delta) return ascending ? delta : -delta; }
          return 0;
        }).slice(0, cap);
        return { data, error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string,value: any) => { filters.push([key,value]); return query; },
        order: (key: string,{ ascending = true } = {}) => { orders.push([key,ascending]); return query; },
        limit: (value: number) => { cap=value; return query; },
        maybeSingle: async () => { const result=execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then: (resolve: any,reject: any) => Promise.resolve(execute()).then(resolve,reject),
      };
      return query;
    },
  };
  const data = compileCommonJs<{ getStatsLeaders: (...args: any[]) => Promise<any[]>; getCurrentSeason: (...args: any[]) => Promise<any>; getGoalieLeaders: (...args: any[]) => Promise<any[]> }>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': { supabase } });
  return { ...data, requests };
}

it('falls back from an HTTP-success empty leaders RPC to populated scoped season stats', async () => {
  const data = boundary();
  const leaders = await data.getStatsLeaders('league-a', 'goals', 5, 'division-a', undefined, { throwOnError: true });
  assert.deepEqual(leaders.map(row => [row.player_id,row.goals,row.assists,row.points]), [['scorer',15,10,25]]);
  const query=data.requests.find(r => r.table==='player_season_stats');
  assert.deepEqual(query.filters,[['season_id','summer'],['division_id','division-a']]);
});

it('uses the current playoff season instead of an older completed season', async () => {
  const data=boundary({ seasons:[{...active,status:'playoffs'},{...active,id:'spring',name:'Spring',status:'completed',start_date:'2026-04-02'}] });
  const season=await data.getCurrentSeason('league-a');
  assert.equal(season.id,'summer');
  const leaders=await data.getStatsLeaders('league-a','points',50);
  assert.deepEqual(leaders.map(row=>row.player_id),['scorer']);
  assert.ok(data.requests.filter(r=>r.table==='seasons').every(r=>r.filters.every(([key,value]: [string,string])=>key!=='status'||['active','playoffs','draft','completed','archived'].includes(value))));
});

it('does not turn failed season discovery into a successful empty card', async () => {
  const data=boundary({seasonFailure:true});
  await assert.rejects(data.getStatsLeaders('league-a','goals',5,null,undefined,{throwOnError:true}),/Season service unavailable/);
  assert.deepEqual(await data.getStatsLeaders('league-a','goals',5),[]);
});

it('uses deterministic player-name ordering when the selected metric is tied', async () => {
  const data=boundary({statsRows:[{...rows[0],player_id:'z',full_name:'Zulu'},{...rows[0],player_id:'a',full_name:'Alpha'}]});
  const leaders=await data.getStatsLeaders('league-a','goals',5);
  assert.deepEqual(leaders.map(row=>row.player_id),['a','z']);
});
