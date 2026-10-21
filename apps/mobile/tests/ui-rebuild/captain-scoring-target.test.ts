/* eslint-disable supabase-test-quality/no-unscoped-service-test -- node:assert verifies exact league/team/game predicates; this rule recognizes only Jest expect. */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileCommonJs } from './component-harness.ts';
import type * as Adapter from '../../src/lib/supabase/captainScoring';
const id=(prefix:string,n=1)=>`${prefix}0000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=id('5'),league=id('1'),season=id('2'),team=id('4'),game=id('3');
const seasonRow={id:season,league_id:league,status:'active',start_date:'2026-09-01',created_at:'2026-08-01T00:00:00Z'};
const role={team_id:team,league_id:league,season_id:season,player_id:actor,status:'active',end_date:null,player_type:'regular',leadership_role:'captain'};
const gameRow={id:game,league_id:league,season_id:season,home_team_id:team,away_team_id:id('4',2),status:'in_progress',scheduled_at:'2026-10-20T22:00:00Z'};
function load(rows:Record<string,unknown[]>,rpc?: (args:Record<string,Record<string,unknown>>)=>unknown,errorTable?:string){
 const queries:{table:string;ops:unknown[][]}[]=[];const rpcs:unknown[]=[];
 const api=compileCommonJs<typeof Adapter>(new URL('../../src/lib/supabase/captainScoring.ts',import.meta.url),{'expo-crypto':{randomUUID:()=>id('7')},'./client':{supabase:{
  from(table:string){
   const ops:unknown[][]=[];queries.push({table,ops});
   const record=(name:string,args:unknown[])=>{ops.push([name,...args]);return builder;};
   const builder={then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:rows[table]??[],error:table===errorTable?{code:'offline'}:null}).then(resolve);},select:(...args:unknown[])=>record('select',args),eq:(...args:unknown[])=>record('eq',args),in:(...args:unknown[])=>record('in',args),is:(...args:unknown[])=>record('is',args),order:(...args:unknown[])=>record('order',args),limit:(...args:unknown[])=>record('limit',args),or:(...args:unknown[])=>record('or',args)};
   return builder;
  },
  rpc(name:string,args:Record<string,Record<string,unknown>>){rpcs.push({name,args});return Promise.resolve({data:rpc?.(args),error:null});}
 }}});return {api,queries,rpcs};
}

it('selects current authorized ongoing scoring independently of scheduled attendance with defensive local scope checks',async()=>{
 const run=load({seasons:[{...seasonRow,id:id('2',2),status:'completed'},seasonRow],team_rosters:[role,{...role,team_id:id('4',3),player_type:'spare'},{...role,team_id:id('4',4),end_date:'2026-10-01'}],games:[{...gameRow,id:id('3',2),status:'scheduled',scheduled_at:'2026-10-21T22:00:00Z'},{...gameRow,id:id('3',3),home_team_id:id('4',3)},gameRow]});
 assert.equal(typeof run.api.getScoringTarget,'function');
 assert.deepEqual(await run.api.getScoringTarget(actor,league),{gameId:game,teamId:team,leagueId:league,seasonId:season});assert.equal(run.rpcs.length,0);
 const roleOps=run.queries.find(q=>q.table==='team_rosters')!.ops;
 for(const expected of [['eq','player_id',actor],['eq','league_id',league],['eq','season_id',season],['eq','status','active'],['eq','player_type','regular'],['is','end_date',null],['in','leadership_role',['captain','alternate_captain']]])assert.ok(roleOps.some(op=>JSON.stringify(op)===JSON.stringify(expected)),JSON.stringify(expected));
 for(const table of ['seasons','team_rosters','games'])assert.ok(run.queries.find(q=>q.table===table)!.ops.some(op=>op[0]==='limit'));
 await assert.rejects(load({seasons:[seasonRow]},undefined,'seasons').api.getScoringTarget(actor,league));
});


it('prefers active seasons over newer playoffs while preserving phase date, null and identity ordering',async()=>{
 const active={...seasonRow,start_date:null,created_at:null};
 const playoffs={...seasonRow,id:id('2',9),status:'playoffs',start_date:'2026-12-01',created_at:'2026-12-01T00:00:00Z'};
 const assertSeason=async(seasons:unknown[],expected:string)=>{
  const run=load({seasons,team_rosters:[role,{...role,season_id:playoffs.id}],games:[gameRow,{...gameRow,season_id:playoffs.id}]});
  assert.equal((await run.api.getScoringTarget(actor,league))?.seasonId,expected);assert.equal(run.rpcs.length,0);
 };
 await assertSeason([playoffs,active],season);
 await assertSeason([active,playoffs],season);
 await assertSeason([playoffs],playoffs.id);
 for(const [rows,expected] of [
  [[{...active,id:id('2',2)},active],season],
  [[active,{...active,id:id('2',2),start_date:'2026-09-01'}],id('2',2)],
  [[active,{...active,id:id('2',2),created_at:'2026-09-01T00:00:00Z'}],id('2',2)],
 ] as const){
  const run=load({seasons:[...rows],team_rosters:[{...role,season_id:expected}],games:[{...gameRow,season_id:expected}]});
  assert.equal((await run.api.getScoringTarget(actor,league))?.seasonId,expected);
 }
});

it('uses exactly one authorized context clock to select most recent due, with complete bounded discovery',async()=>{
 const scheduled={...gameRow,status:'scheduled'};
 const rows={seasons:[seasonRow],team_rosters:[role],games:[{...scheduled,id:id('3',3),scheduled_at:'2026-10-22T00:00:00Z'}, {...scheduled,id:id('3',2),scheduled_at:'2026-10-20T23:00:00Z'},scheduled]};
 const body=(args:Record<string,Record<string,unknown>>): Adapter.ScoringResponse & {snapshot:Adapter.ScoringSnapshot}=>({...(args.p_request as Pick<Adapter.ScoringResponse,'schema_version'|'request_id'|'game_id'|'team_id'|'league_id'>),kind:'get_context',outcome:'ok',code:null,receipt:null,conflict:null,snapshot:{season_id:season,revision:'9007199254740993',server_time:'2026-10-20T23:00:00Z',complete:true,game:{status:'scheduled',scheduled_at:'2026-10-20T22:00:00Z',game_started_at:null,own_team_type:'home',home_team_id:team,away_team_id:id('4',2),home_team_name:null,away_team_name:null,home_score:0,away_score:0,timezone:'America/Toronto',home_team_logo_url:null,away_team_logo_url:null},permissions:{can_add_goal:true,can_correct_goal:true,can_manage_roster:true,can_comment:true,blocked_reason:null},own_goals:[],roster:[],commentary:{text:'',version:0},counts:{own_goals:0,roster:0}}});
 const run=load(rows,body);assert.deepEqual(await run.api.getScoringTarget(actor,league),{gameId:id('3',2),teamId:team,leagueId:league,seasonId:season});assert.equal(run.rpcs.length,1);
 const future=load({...rows,games:[rows.games[0]]},args=>{const raw=body(args);raw.snapshot.game.scheduled_at='2026-10-22T00:00:00Z';raw.snapshot.permissions={can_add_goal:false,can_correct_goal:false,can_manage_roster:false,can_comment:false,blocked_reason:'future_game'};return raw;});assert.equal(await future.api.getScoringTarget(actor,league),null);assert.equal(future.rpcs.length,1);
 await assert.rejects(load(rows,()=>({broken:true})).api.getScoringTarget(actor,league));
 for(const [table,count] of [['seasons',257],['team_rosters',1001],['games',1001]] as const){await assert.rejects(load({...rows,[table]:Array.from({length:count},()=>rows[table][0])},body).api.getScoringTarget(actor,league));}
});

it('serializes exact current-role predicates using the installed PostgREST client over a no-network transport',async()=>{
 const {createClient}=await import('@supabase/supabase-js');const urls:URL[]=[];
 const client=createClient('https://scoring-offline.invalid','offline-public-placeholder',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input)=>{
  const url=new URL(String(input));urls.push(url);const table=url.pathname.split('/').pop();const data=table==='seasons'?[seasonRow]:table==='team_rosters'?[role]:table==='games'?[gameRow]:[];
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 const api=compileCommonJs<typeof Adapter>(new URL('../../src/lib/supabase/captainScoring.ts',import.meta.url),{'./client':{supabase:client},'expo-crypto':{randomUUID:()=>id('7')}});
 assert.deepEqual(await api.getScoringTarget(actor,league),{gameId:game,teamId:team,leagueId:league,seasonId:season});
 const seasonUrl=urls.find(u=>u.pathname.endsWith('/seasons'))!;assert.equal(seasonUrl.searchParams.get('status'),'in.(active,playoffs)');assert.equal(seasonUrl.searchParams.get('order'),'start_date.desc,created_at.desc.nullslast,id.asc');assert.equal(seasonUrl.searchParams.get('limit'),'257');
 const roleUrl=urls.find(u=>u.pathname.endsWith('/team_rosters'))!;for(const [k,v] of Object.entries({player_id:'eq.'+actor,league_id:'eq.'+league,season_id:'eq.'+season,status:'eq.active',player_type:'eq.regular',end_date:'is.null',leadership_role:'in.(captain,alternate_captain)',limit:'1001'}))assert.equal(roleUrl.searchParams.get(k),v);
 const gameUrl=urls.find(u=>u.pathname.endsWith('/games'))!;assert.equal(gameUrl.searchParams.get('status'),'in.(in_progress,scheduled)');assert.equal(gameUrl.searchParams.get('or'),`(home_team_id.in.(${team}),away_team_id.in.(${team}))`);
});
