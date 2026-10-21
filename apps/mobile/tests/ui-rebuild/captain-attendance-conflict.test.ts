import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileCommonJs, createHookHarness, findNode, nodeText } from './component-harness';

type Row = Record<string, unknown>;
const league = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const season = { id: 'current', league_id: league, status: 'active', start_date: '2026-09-01' };
const base = { team_id: '10000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', status: 'active', end_date: null, player_type: 'regular', position: 'Forward', is_goalie: false, leadership_role: null };
const rows: Row[] = [
  { ...base, id: 'a', player_id: '30000000-0000-4000-8000-000000000001', jersey_number: 7, leadership_role: 'captain' },
  { ...base, id: 'b', player_id: '30000000-0000-4000-8000-000000000001', jersey_number: null, position: 'Goalie', is_goalie: true },
  { ...base, id: 'c', player_id: 'p2', jersey_number: 96 },
  { ...base, id: 'd', player_id: 'goalie', jersey_number: 1, position: 'Goalie', is_goalie: true },
  { ...base, id: 'e', player_id: '30000000-0000-4000-8000-000000000002', jersey_number: 8 },
  ...[
    { player_id: 'history', season_id: 'old' }, { player_id: 'ended', end_date: '2026-10-01' },
    { player_id: 'sub', player_type: 'sub' }, { player_id: 'part', player_type: 'part_time' },
    { player_id: 'inactive', status: 'inactive' }, { player_id: 'other-team', team_id: 'other' },
    { player_id: 'other-league', league_id: 'other' },
  ].map((extra, i) => ({ ...base, id: `excluded-${i}`, jersey_number: 20 + i, ...extra })),
];
const profiles = rows.map(row => ({ id: row.player_id, full_name: row.player_id === '30000000-0000-4000-8000-000000000001' || row.player_id === '30000000-0000-4000-8000-000000000002' ? 'Cameron Wallace' : row.player_id === 'p2' ? 'Matt Grossi' : String(row.player_id), avatar_url: null }));
type RpcReply = { data: unknown; error: { message: string } | null };
type Query = { table: string; columns: string; filters: Array<[string, unknown]> };
function provider(options: { errorTable?: string; season?: Row | null; game?: Row; roleError?: boolean; checkins?: Row[]; rosterRows?: Row[]; beerError?: boolean; beerPlayerId?: string | null; rpcOverride?: (name: string, args: Row) => Promise<RpcReply | undefined>; gameRead?: (fallback: RpcReply) => Promise<RpcReply> } = {}) {
  let actorId: string | null = '30000000-0000-4000-8000-000000000001';
  const queries: Query[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  let checkins = [...(options.checkins ?? [])];
  let assignment: Row | null = options.beerPlayerId ? { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: options.beerPlayerId, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } : null;
  const game = options.game ?? { id: '20000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', home_team_id: '10000000-0000-4000-8000-000000000001', away_team_id: 'away', scheduled_at: '2026-10-21T20:00:00Z', home_team: { name: 'Home' }, away_team: { name: 'Away' } };
  const supabase = { rpc: async (name: string, args: Row) => {
    rpcCalls.push({ name, args });
    const override = await options.rpcOverride?.(name, args);
    if (override) return override;
    if (name === 'captain_manage_game_checkin') {
      checkins = checkins.filter(row => row.player_id !== args.p_player_id);
      if (args.p_operation === 'set') checkins.push({ game_id: args.p_game_id, team_id: args.p_team_id, player_id: args.p_player_id, status: args.p_status });
      if (args.p_status !== 'confirmed' && assignment !== null && assignment.player_id === args.p_player_id) assignment = { ...assignment, version: Number(assignment.version) + 1, player_id: null, player_name: null };
      return { data: { outcome: args.p_operation, operation: args.p_operation, status: args.p_status, affected_rows: 1, checkin_id: '50000000-0000-4000-8000-000000000001' }, error: null };
    }
    if (options.beerError) return { data: null, error: { message: 'Beer unavailable' } };
    if (name === 'beer_guy_get_game_state') return { data: { game_id: args.p_game_id, team_id: args.p_team_id, caller_eligible: true, assignment }, error: null };
    assert.equal(name, 'beer_guy_captain_manage');
    if ((assignment?.id ?? null) !== args.p_expected_assignment_id || (assignment?.version ?? null) !== args.p_expected_version) return { data: {game_id: args.p_game_id, team_id: args.p_team_id, outcome:'conflict', assignment}, error:null };
    if (args.p_player_id) {
      checkins = checkins.filter(row => row.player_id !== args.p_player_id);
      checkins.push({ game_id: args.p_game_id, team_id: args.p_team_id, player_id: args.p_player_id, status: 'confirmed' });
    }
    const previous = assignment;
    assignment = { id: previous?.id ?? '40000000-0000-4000-8000-000000000001', version: Number(previous?.version ?? 0) + 1, player_id: args.p_player_id, player_name: args.p_player_id ? 'Cameron Wallace' : null, player_avatar_url: null, status: 'pending' };
    return { data: { game_id: args.p_game_id, team_id: args.p_team_id, outcome: args.p_player_id ? 'assigned' : 'cleared', assignment }, error: null };
  }, auth: { getUser: async () => ({ data: { user: actorId ? { id: actorId } : null } }) }, from(table: string) {
    const query: Query = { table, columns: '', filters: [] }; queries.push(query);
    let max = Infinity;
    const result = (single = false) => {
      if (table === options.errorTable || (options.roleError && table === 'team_rosters' && query.columns === 'leadership_role')) return { data: null, error: { message: 'denied' } };
      let data: Row[] = table === 'team_rosters' ? options.rosterRows ?? rows : table === 'game_checkins' ? checkins : table === 'profiles' ? profiles : table === 'games' ? [game] : table === 'seasons' ? (options.season === null ? [] : [options.season ?? season]) : [];
      data = data.filter(row => query.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, max);
      // Honor projection: a missing scope field must not accidentally rescue a broken reader.
      const columns = query.columns.split(',').map(x => x.trim());
      data = data.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key) || query.columns.includes(`${key}:`))));
      return { data: single ? data[0] ?? null : data, error: null };
    };
    const builder = {
      select(columns: string) { query.columns = columns; return builder; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      is(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      in(key: string, value: unknown[]) { query.filters.push([key, value]); return builder; },
      order() { return builder; }, limit(value: number) { max = value; return builder; },
      maybeSingle: async () => table === 'games' && options.gameRead ? options.gameRead(result(true)) : result(true),
      then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
    }; return builder;
  } };
  return { supabase, queries, rpcCalls,
    externalClaim(playerId: string) {
      assignment = { id: assignment?.id ?? '40000000-0000-4000-8000-000000000001',version:Number(assignment?.version ?? 0)+1,player_id:playerId,player_name:'Cameron Wallace',player_avatar_url:null,status:'pending' };
      checkins=checkins.filter(row=>row.player_id!==playerId).concat([{game_id:game.id,team_id:game.home_team_id,player_id:playerId,status:'confirmed'}]);
    },
    store() { return {assignment,checkins:[...checkins]}; }, getUser: () => actorId ? { id: actorId } : null, setUserId: (id: string | null) => { actorId = id; } };
}
async function mount(options: Parameters<typeof provider>[0] = {}) {
  const transport = provider(options); const h = createHookHarness();
  const team = compileCommonJs<typeof import('../../src/lib/supabase/team')>(new URL('../../src/lib/supabase/team.ts', import.meta.url), { './client': transport });
  const beer = compileCommonJs<typeof import('../../src/lib/supabase/beerGuy')>(new URL('../../src/lib/supabase/beerGuy.ts', import.meta.url), { './client': { ...transport, publicSupabase: transport.supabase } });
  const captain = compileCommonJs<typeof import('../../src/lib/supabase/captain')>(new URL('../../src/lib/supabase/captain.ts', import.meta.url), { './client': transport });
  const data = compileCommonJs<typeof import('../../src/lib/supabase/data')>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': transport, './publicStats': {} });
  const Screen = compileCommonJs<{ default: (props: unknown) => unknown }>(new URL('../../src/screens/captain/GameAvailabilityScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Modal: () => null, StyleSheet: { create: (s: unknown) => s } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../../components/Avatar': () => null,
    '../../components/SelectableControl': { SelectableControl: 'Control', SelectableControlGroup: 'Group' },
    '../../components/AccessibleChoiceGroup': () => null,
    '../../components/captain/FindSpareModal': (props: Record<string, unknown>) => props.visible ? h.react.createElement('FindSpareBoundary', props) : null,
    '../../context/AuthContext': { useAuth: () => ({ user: transport.getUser() }) },
    '../../config/hockeyLife': { HOCKEY_LIFE_ID: league }, '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (v: unknown) => v },
    '../../theme/colors': { default: {}, __esModule: true }, '../../lib/supabase/client': transport,
    '../../lib/supabase/team': team, '../../lib/supabase/data': data, '../../lib/supabase/beerGuy': beer,
    '../../lib/supabase/captain': { ...captain, getTeamSubInvitations: async () => ({ data: [] }), getOpenGoalieRequest: async () => null },
  }).default;
  let params = { gameId: '20000000-0000-4000-8000-000000000001', teamId: '10000000-0000-4000-8000-000000000001', leagueId: league };
  h.mount(() => Screen({ route: { params }, navigation: { goBack() {} } }));
  for (let i = 0; i < 100; i += 1) { await Promise.resolve(); h.render(); }
  return { h, ...transport, setUser(id: string | null) { transport.setUserId(id); h.render(); }, setParams(next: typeof params) { params = next; h.render(); }, async settle() { for (let i = 0; i < 100; i += 1) { await Promise.resolve(); h.render(); } } };
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>resolve=r); return {resolve,promise}; }
const player='30000000-0000-4000-8000-000000000001', personB='30000000-0000-4000-8000-000000000002';
const gameId='20000000-0000-4000-8000-000000000001', teamId='10000000-0000-4000-8000-000000000001';
const button=(r:Awaited<ReturnType<typeof mount>>, id:string)=>findNode(r.h.output,n=>n.props.testID===id);
it('BLOCKER I1: stable external B claim then stale local A CAS conflict must reconcile B holder and In',async()=>{
 const pending=deferred<RpcReply|undefined>();
 const r=await mount({rpcOverride:async(name)=>name==='beer_guy_captain_manage'?pending.promise:undefined});
 assert.equal(button(r,`captain-status-${personB}-waiting`)?.props.selected,true);
 button(r,`captain-beer-${player}`)?.props.onPress(); await r.settle();
 r.externalClaim(personB); pending.resolve(undefined); await r.settle();
 const result={store:r.store(),checked:button(r,`captain-beer-${personB}`)?.props.accessibilityState.checked,in:button(r,`captain-status-${personB}-confirmed`)?.props.selected,waiting:button(r,`captain-status-${personB}-waiting`)?.props.selected,conflict:nodeText(r.h.output).includes('Beer Guy changed'),rpc:r.rpcCalls};
 assert.equal(button(r,`captain-status-${player}-waiting`)?.props.selected,true,'failed local A CAS must not confirm A');
 assert.match(nodeText(r.h.output),/In \(1\)/); assert.match(nodeText(r.h.output),/No Response \(3\)/);
 assert.equal(result.conflict,true,'conflict remains visible, not reported as success');
 console.log('STABLE_EXTERNAL_CLAIM',JSON.stringify(result)); r.h.unmount();
 assert.equal(result.store.assignment?.player_id,personB);assert.equal(result.store.checkins.find(row=>row.player_id===personB)?.status,'confirmed');
 assert.equal(result.checked,true,'B canonical holder must be shown'); assert.equal(result.in,true,'B canonical confirmed attendance must be shown');
});
it('BLOCKER I2: older refresh must not erase newer conflict reconciliation from unchanged stable store',async()=>{
 const mutation=deferred<RpcReply|undefined>(), old=deferred<RpcReply>(); let reads=0;
 const r=await mount({beerPlayerId:player,checkins:[{game_id:gameId,team_id:teamId,player_id:personB,status:'confirmed'},{game_id:gameId,team_id:teamId,player_id:player,status:'confirmed'}],rpcOverride:async(name)=>{
   if(name==='beer_guy_captain_manage')return mutation.promise;
   if(name==='beer_guy_get_game_state'&&++reads===2)return old.promise; return undefined;
 }});
 const oldSnapshot=r.store().assignment;
 button(r,`captain-beer-${personB}`)?.props.onPress(); await r.settle();
 const refresh=findNode(r.h.output,n=>n.type==='ScrollView')?.props.refreshControl.props.onRefresh();await r.settle();
 // The old request began before the external claim; its actual A-holder snapshot remains intentionally delayed.
 r.externalClaim(personB);mutation.resolve(undefined);await r.settle();
 old.resolve({data:{game_id:gameId,team_id:teamId,caller_eligible:true,assignment:oldSnapshot},error:null});await refresh;await r.settle();
 const result={store:r.store(),checked:button(r,`captain-beer-${personB}`)?.props.accessibilityState.checked,oldHolderChecked:button(r,`captain-beer-${player}`)?.props.accessibilityState.checked,in:button(r,`captain-status-${personB}-confirmed`)?.props.selected,conflict:nodeText(r.h.output).includes('Beer Guy changed'),reads};
 console.log('STABLE_CONFLICT_REFRESH_RACE',JSON.stringify(result));r.h.unmount();
 assert.equal(result.in,true,'preconfirmed B isolates holder race from I1');assert.equal(result.store.assignment?.player_id,personB);
 assert.equal(result.checked,true,'old refresh must not replace the conflict-read canonical B holder');
 assert.equal(result.oldHolderChecked,false); assert.equal(result.conflict,true);
 assert.equal(result.store.assignment?.version,2);
});
it('CONTROL: canonical stable B store becomes correct after a fresh complete reload',async()=>{
 const mutation=deferred<RpcReply|undefined>(); const r=await mount({rpcOverride:async(name)=>name==='beer_guy_captain_manage'?mutation.promise:undefined});
 button(r,`captain-beer-${player}`)?.props.onPress(); await r.settle();r.externalClaim(personB);mutation.resolve(undefined);await r.settle();
 const refresh=findNode(r.h.output,n=>n.type==='ScrollView')?.props.refreshControl.props.onRefresh();await refresh;await r.settle();
 assert.equal(button(r,`captain-beer-${personB}`)?.props.accessibilityState.checked,true);assert.equal(button(r,`captain-status-${personB}-confirmed`)?.props.selected,true);r.h.unmount();
});

it('retains conflict facts for their original scope while same-route validation is temporarily pending',async()=>{
 const mutation=deferred<RpcReply|undefined>(), validation=deferred<RpcReply>(); let games=0; let snapshot:RpcReply|undefined;
 const r=await mount({gameRead:async fallback=>{ if(++games===2){snapshot=fallback;return validation.promise;}return fallback; },rpcOverride:async name=>name==='beer_guy_captain_manage'?mutation.promise:undefined});
 button(r,`captain-beer-${player}`)?.props.onPress();await r.settle();
 const refresh=findNode(r.h.output,n=>n.type==='ScrollView')?.props.refreshControl.props.onRefresh();await r.settle();
 assert.ok(snapshot,'same-route game validation is held');
 r.externalClaim(personB);mutation.resolve(undefined);await r.settle();
 validation.resolve(snapshot);await refresh;await r.settle();
 assert.equal(button(r,`captain-beer-${personB}`)?.props.accessibilityState.checked,true);
 assert.equal(button(r,`captain-status-${personB}-confirmed`)?.props.selected,true);
 assert.equal(button(r,`captain-status-${player}-waiting`)?.props.selected,true);
 assert.match(nodeText(r.h.output),/In \(1\)/);r.h.unmount();
});
