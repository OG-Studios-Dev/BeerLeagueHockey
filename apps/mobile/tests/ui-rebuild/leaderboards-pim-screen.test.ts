/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const row = (playerId = 'enforcer', pim = 88) => ({
  player_id: playerId, player_name: playerId === 'user-a' ? 'Current User' : 'Hidden Enforcer', avatar_url: null,
  team_id: 'real-team', team_name: 'Real Team', team_short_name: 'Real', position: null, is_goalie: false,
  jersey_number: null, goals: 0, assists: 1, points: 1, plus_minus: 0, games_played: 12,
  games_played_state: 'recorded', penalty_minutes: pim, penalty_minutes_state: 'verified',
  metrics: {
    gamesPlayed: { value: 12, state: 'recorded', sources: ['skater_stats'] },
    goals: { value: 0, state: 'recorded', sources: ['skater_stats'] },
    assists: { value: 1, state: 'recorded', sources: ['skater_stats'] },
    points: { value: 1, state: 'recorded', sources: ['skater_stats'] },
    penaltyMinutes: { value: pim, state: 'verified', sources: ['capture_confirmation'] },
  },
});
const publicPayload = (unknownPim = 0) => ({ presentationSeason: { id: 'season-a' }, players: Array.from({ length: unknownPim }, (_, index) => ({
  playerId: `unknown-${index}`, roles: ['skater'], metrics: { penaltyMinutes: { value: null, state: 'unknown', sources: [] } },
})) });

function runtime({ rows = (_metric: string) => [row()], load = async () => publicPayload(), resolveSeason = async () => ({season:{id:'season-a'},error:null}) }: { rows?: (metric: string) => any[]; load?: (...args: any[]) => Promise<any>; resolveSeason?: () => Promise<any> } = {}) {
  const h=createHookHarness(); const v2Calls:any[][]=[]; const mapperCalls:any[][]=[]; const playerCalls:any[][]=[];
  const auth:any={user:{id:'user-a'}}; const league:any={activeLeague:{id:'league-a',slug:'harbour',name:'League A'},activeTheme:{backgroundColor:'#000',primaryColor:'#0ff'}};
  const native={ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:(s:any)=>s},FlatList:(p:any)=>createElement('FlatList',p,...(p.data??[]).map((item:any)=>p.renderItem({item})))};
  const Screen=compileCommonJs<any>(new URL('../../src/screens/stats/LeaderboardsScreen.tsx',import.meta.url),{
    react:h.react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},
    '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/PillToggle':(p:any)=>createElement('PillToggle',p),
    '../../context/AuthContext':{useAuth:()=>auth},'../../context/LeagueContext':{useLeague:()=>league},
    '../../lib/supabase/data':{getStatsLeadersFromPublicSeason:(_p:any,metric:string,limit:number)=>{mapperCalls.push([metric,limit]);return rows(metric).slice(0,limit);}},
    '../../lib/supabase/team':{getMetricsOperationalSeason:resolveSeason},
    '../../lib/supabase/publicStats':{getPublicSeasonStats:async(...args:any[])=>{v2Calls.push(args);return load(...args);},formatPublicMetric:(m:any)=>({value:m.value==null?'—':String(m.value),hint:'Recorded.'})},
    '../../navigation/playerCard':{navigateToPlayerCard:(...args:any[])=>playerCalls.push(args)},'../../theme/colors':{__esModule:true,default:{textPrimary:'#fff',textSecondary:'#aaa',brandGold:'#fc0',bgBase:'#000',borderCard:'#222'}},
  }).default;
  const navigation={goBack(){}};h.mount(()=>Screen({navigation}));return{h,auth,league,navigation,v2Calls,mapperCalls,playerCalls};
}
async function settle(r:ReturnType<typeof runtime>){for(let i=0;i<8;i++){await new Promise<void>(resolve=>setImmediate(resolve));r.h.render();}return r.h.output;}
function select(r:ReturnType<typeof runtime>,category:string){findNode(r.h.output,n=>n.type==='PillToggle')?.props.onChange(category);}

describe('PIM leaderboard screen state',()=>{
  it('opens an accessible leaderboard row with its real player id',async()=>{const r=runtime();await settle(r);select(r,'PIM');const output=await settle(r);const player=findNode(output,n=>n.props.testID==='leaderboard-player-enforcer');assert.equal(player?.props.accessibilityRole,'button');player?.props.onPress();assert.deepEqual(r.playerCalls,[[r.navigation,{playerId:'enforcer',leagueId:'league-a'}]]);});
  it('uses explicit v2 season stats and the aggregate PIM mapper, never the legacy reader',async()=>{const r=runtime();await settle(r);select(r,'PIM');const output=await settle(r);assert.ok(r.v2Calls.every(call=>call[0]==='harbour'&&call[1]==='league-a'&&call[2]==='season-a'));assert.ok(r.mapperCalls.some(call=>call[0]==='penalty_minutes'&&call[1]===50));assert.match(nodeText(output),/Hidden Enforcer/);assert.match(nodeText(output),/88PIM/);assert.doesNotMatch(nodeText(output),/12 GP|0G|1A/);});
  it('discloses excluded unknown PIM players only on the matching PIM result',async()=>{const r=runtime({load:async()=>publicPayload(2)});await settle(r);select(r,'PIM');let output=await settle(r);assert.match(nodeText(output),/2 players excluded: PIM unavailable/);select(r,'Points');output=r.h.render();assert.doesNotMatch(nodeText(output),/players excluded/);});
  it('shows actionable v2 read errors with retry',async()=>{let fail=true;const r=runtime({load:async()=>{if(fail)throw new Error('v2 season feed failed');return publicPayload();}});let output=await settle(r);assert.ok(findNode(output,n=>n.props.testID==='pim-leaders-error'));fail=false;findNode(output,n=>n.props.testID==='pim-leaders-retry')?.props.onPress();output=await settle(r);assert.match(nodeText(output),/Hidden Enforcer/);});
  it('invalidates a failed season lookup when retry is pressed',async()=>{let calls=0;const r=runtime({resolveSeason:async()=>{calls+=1;return calls===1?{season:null,error:'offline'}:{season:{id:'season-a'},error:null};}});let output=await settle(r);assert.ok(findNode(output,n=>n.props.testID==='pim-leaders-error'));findNode(output,n=>n.props.testID==='pim-leaders-retry')?.props.onPress();output=await settle(r);assert.equal(calls,2);assert.match(nodeText(output),/Hidden Enforcer/);});
  it('renders unknown secondary scoring as dashes and excludes an unknown selected metric',async()=>{
    const unknownRow={...row('unknown-scorer'),player_name:'Known Points',goals:null,assists:null,points:5,metrics:{...row().metrics,goals:{value:null,state:'unknown',sources:[]},assists:{value:null,state:'unknown',sources:[]},points:{value:5,state:'recorded',sources:['skater_stats']}}};
    const r=runtime({rows:(metric)=>metric==='goals'?[]:[unknownRow]});
    let output=await settle(r);
    assert.match(nodeText(output),/—G/); assert.match(nodeText(output),/—A/); assert.doesNotMatch(nodeText(output),/0G|0A/);
    select(r,'Goals'); output=await settle(r); assert.doesNotMatch(nodeText(output),/Known Points/);
  });
  it('never lets a late response overwrite a changed category or stale user rank',async()=>{let release!:(value:any)=>void;let calls=0;const r=runtime({load:async()=>{calls+=1;if(calls===2)return new Promise(resolve=>{release=resolve;});return publicPayload();}});await settle(r);select(r,'PIM');await new Promise<void>(resolve=>setImmediate(resolve));select(r,'Goals');await settle(r);release(publicPayload(3));const output=await settle(r);assert.doesNotMatch(nodeText(output),/players excluded|Your rank/);});
  it('invalidates an in-flight v2 request when the screen unmounts',async()=>{let release!:(value:any)=>void;const r=runtime({load:()=>new Promise(resolve=>{release=resolve;})});await new Promise<void>(resolve=>setImmediate(resolve));const before=r.h.stateUpdateCount;r.h.unmount();release(publicPayload());await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(r.h.stateUpdateCount,before);});
});
