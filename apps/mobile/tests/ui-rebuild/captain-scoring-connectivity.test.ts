/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mountScoring, React, snapshot, players } from './captain-scoring-screen.test';
import { compileCommonJs } from './component-harness';

class ScoringClock {
 now=0; sequence=0; jobs=new Map<number,{run:()=>void;at:number}>();
 set=(run:()=>void,delay:number)=>{const id=++this.sequence;this.jobs.set(id,{run,at:this.now+delay});return id;};
 clear=(id:number)=>{this.jobs.delete(id);};
 async advance(ms:number){const end=this.now+ms;let fired=0;for(;;){const next=[...this.jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;assert.ok(++fired<200);this.now=next[1].at;this.jobs.delete(next[0]);await React.act(async()=>next[1].run());}this.now=end;}
}
const online = { isConnected:true, isInternetReachable:true };
const offline = { isConnected:false, isInternetReachable:false };
function held() { let resolve!: (v:any)=>void, reject!: (e:any)=>void; const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function watcher(options:any={}) {
 const initial=held(), listeners:any[]=[], seen:string[]=[];
 const url=new URL('../../src/lib/captain/scoringConnectivity.ts',import.meta.url);
 assert.ok(existsSync(fileURLToPath(url.href)), 'native connectivity watcher must be implemented');
 const api=compileCommonJs<any>(url,{'expo-network':{getNetworkStateAsync:()=>{if(options.getThrows)throw new Error('native get failure');return initial.promise;},addNetworkStateListener:(cb:any)=>{if(options.listenThrows)throw new Error('native listen failure');const item={cb,removed:false};listeners.push(item);return {remove:()=>{item.removed=true;}};}}});
 const stop=api.watchScoringConnectivity((s:string)=>seen.push(s));
 return {initial,listeners,seen,stop};
}
it('mounted real adapter sends no offline RPC and preserves raw UUID and full payload for explicit retry',async()=>{
 const clock=new ScoringClock();const initial=held();const r=await mountScoring({clock,networkInitial:initial.promise,rpc:(name:string,args:any)=>name==='captain_get_game_scoring_context'?{data:{...args.p_request,kind:'get_context',outcome:'ok',code:null,receipt:null,conflict:null,snapshot:snapshot()},error:null,status:200}:{data:null,error:{code:'transport_unavailable'},status:503}});try{assert.equal(r.calls.rpc.length,1);await React.act(async()=>initial.resolve(online));assert.equal(r.calls.rpc.length,1);await r.edit('scoring-commentary','Exact 🚨 full note');const save=r.props.get('scoring-save-commentary').onPress;await r.network(offline);await React.act(async()=>save());assert.equal(r.calls.rpc.length,1);await r.network(online);assert.equal(r.calls.rpc.length,2);await r.press('scoring-save-commentary');assert.equal(r.calls.rpc.length,3);assert.match(r.text(),/Result unknown/);const original=structuredClone(r.calls.rpc[2].args);const retry=r.props.get('scoring-retry-same-request').onPress;assert.equal(original.p_request.text,'Exact 🚨 full note');assert.equal(original.p_request.expected_version,1);assert.equal('actor_id' in original.p_request,false);assert.equal('season_id' in original.p_request,false);assert.equal(r.calls.rpc[2].signal,undefined,'native loss must not create mutation abort wiring');await r.network(offline);await React.act(async()=>retry());await clock.advance(30000);assert.equal(r.calls.rpc.length,3);await r.network(online);assert.equal(r.calls.rpc.length,4);assert.ok(r.calls.channels.slice(0,-1).every((channel:any)=>channel.disposed));await r.press('scoring-retry-same-request');assert.equal(r.calls.rpc.length,5);assert.deepEqual(r.calls.rpc[4].args,original);assert.equal(r.calls.rpc[4].name,'captain_manage_game_scoring');}finally{await r.close();}assert.ok(r.calls.channels.every((channel:any)=>channel.disposed));
});
// These are preservation regressions for behavior established by the vertical slices above.
it('mounted initial unknown to online keeps one initial read and one observer owner',async()=>{
 const initial=held();const r=await mountScoring({networkInitial:initial.promise});try{assert.equal(r.calls.reads.length,1);const observer=r.calls.watches.at(-1);assert.match(r.text(),/Connection unknown/);await React.act(async()=>initial.resolve(online));assert.equal(r.calls.reads.length,1,'initial connection indication is not a reconnect');assert.equal(r.calls.watches.at(-1),observer);assert.equal(observer.disposed,false);await r.network(offline);await r.network(online);assert.equal(r.calls.reads.length,2);assert.equal(r.calls.writes.length,0);}finally{await r.close();}
});
for(const mode of ['focus','background'])it(`mounted reconnect waits for ${mode} before its one authoritative read`,async()=>{
 const r=await mountScoring();try{if(mode==='focus')await r.focus(false);else await React.act(async()=>r.calls.appState('background'));const reads=r.calls.reads.length;await r.network(offline);await r.network(online);assert.equal(r.calls.reads.length,reads);if(mode==='focus')await r.focus(true);else await React.act(async()=>r.calls.appState('active'));assert.equal(r.calls.reads.length,reads+1);assert.equal(r.calls.writes.length,0);}finally{await r.close();}
});
it('mounted unknown SDK failure retains bounded error fallback instead of declaring offline or connected',async()=>{
 const initial=held(),clock=new ScoringClock();const r=await mountScoring({clock,networkInitial:initial.promise,read:async()=>{throw new Error('server unreachable');}});try{await React.act(async()=>initial.reject(new Error('SDK unavailable')));assert.match(r.text(),/Connection unknown/);assert.doesNotMatch(r.text(),/Offline|Connected/);assert.equal(r.calls.reads.length,1);await clock.advance(9999);assert.equal(r.calls.reads.length,1);await clock.advance(1);assert.equal(r.calls.reads.length,2);assert.equal(r.calls.writes.length,0);}finally{await r.close();}assert.equal(clock.jobs.size,0);
});
it('mounted StrictMode removes obsolete native subscriptions and ignores initial promises after unmount',async()=>{
 const initial=held();const r=await mountScoring({networkInitial:initial.promise});assert.ok(r.calls.networkListeners.length>=2);assert.ok(r.calls.networkListeners.slice(0,-1).every((s:any)=>s.removed));await r.close();assert.ok(r.calls.networkListeners.every((s:any)=>s.removed));await React.act(async()=>{initial.resolve(offline);for(const sub of r.calls.networkListeners)sub.cb(online);});assert.equal(r.calls.writes.length,0);
});
it('mounted speculative suspended route cannot revoke the still committed scoring callback',async()=>{
 const r=await mountScoring();try{await r.edit('scoring-commentary','Committed owner');const save=r.props.get('scoring-save-commentary').onPress;await r.speculate({gameId:'30000000-0000-0000-0000-000000000002',teamId:'40000000-0000-0000-0000-000000000001',leagueId:'10000000-0000-0000-0000-000000000001',seasonId:'20000000-0000-0000-0000-000000000001'});await React.act(async()=>save());assert.equal(r.calls.writes.length,1);assert.equal(r.calls.writes[0][0].gameId,'30000000-0000-0000-0000-000000000001');}finally{await r.close();}
});
for(const outcome of ['applied','replayed','conflict','rejected','unknown-error','rejected-error'])it(`mounted already issued ${outcome} settles honestly while offline without a refresh or replay`,async()=>{
 const deferred=held(),clock=new ScoringClock();const r=await mountScoring({clock,write:()=>deferred.promise});try{await r.edit('scoring-commentary','Issued note');await r.press('scoring-save-commentary');const request=structuredClone(r.calls.writes[0]);await r.network(offline);const reads=r.calls.reads.length;await clock.advance(4000);await React.act(async()=>{if(outcome.endsWith('-error'))deferred.reject(new r.RpcError(outcome==='unknown-error'?'unknown':'rejected','Definitive rejection'));else deferred.resolve({outcome,code:'commentary_version_conflict',snapshot:snapshot()});});assert.equal(r.calls.writes.length,1);assert.deepEqual(r.calls.writes[0],request);assert.equal(r.calls.reads.length,reads);if(outcome==='applied'||outcome==='replayed')assert.match(r.text(),/Saved/);else if(outcome==='unknown-error')assert.match(r.text(),/Result unknown/);else assert.match(r.text(),/Not saved|Definitive rejection/);await clock.advance(30000);assert.equal(r.calls.writes.length,1);}finally{await r.close();}assert.equal(clock.jobs.size,0);
});
it('mounted offline timeout ignores late original success and keeps immutable explicit retry gated',async()=>{
 const original=held(),retry=held(),clock=new ScoringClock();let writes=0;const r=await mountScoring({clock,write:()=>++writes===1?original.promise:retry.promise});try{await r.edit('scoring-commentary','Immutable');await r.press('scoring-save-commentary');const request=structuredClone(r.calls.writes[0]);await clock.advance(10000);const saved=r.props.get('scoring-retry-same-request').onPress;await r.network(offline);await React.act(async()=>saved());assert.equal(r.calls.writes.length,1);const late=snapshot();late.revision='999';late.commentary={text:'Late old result',version:99};await React.act(async()=>original.resolve({outcome:'applied',snapshot:late}));assert.match(r.text(),/Result unknown/);assert.doesNotMatch(r.text(),/Saved/);assert.equal(r.props.get('scoring-commentary').value,'Immutable');await r.network(online);await React.act(async()=>saved());assert.equal(r.calls.writes.length,1);await r.press('scoring-retry-same-request');assert.equal(r.calls.writes.length,2);assert.deepEqual(r.calls.writes[1],request);}finally{await r.close();}
});
it('mounted offline retains the removal dialog and explains blocked writes inside it',async()=>{
 const s:any=snapshot();const goal={event_id:'60000000-0000-0000-0000-000000000009',event_version:1,team_id:s.game.home_team_id,scorer_id:players[0].player_id,assist1_id:null,assist2_id:null,entered_at:'2026-10-20T23:00:00Z',can_edit:true,blocked_reason:null};s.own_goals=[goal];const r=await mountScoring({snapshot:s});try{await r.press(`scoring-actions-${goal.event_id}`);await r.press('scoring-remove-goal');const remove=r.props.get('scoring-confirm-remove').onPress;await r.network(offline);const sheet=r.dom.window.document.querySelector('[data-testid="scoring-remove-confirmation"]');assert.ok(sheet);assert.match(sheet.textContent,/Offline/,'visible removal dialog needs the connection feedback');await React.act(async()=>remove());assert.equal(r.calls.writes.length,0);assert.equal(r.props.get('scoring-confirm-remove').disabled,true);}finally{await r.close();}
});
it('mounted offline cancels an outstanding read deadline but never a write deadline',async()=>{
 const clock=new ScoringClock(), read=held();const r=await mountScoring({clock,read:()=>read.promise});try{assert.equal(clock.jobs.size,1);await r.network(offline);assert.equal(r.calls.reads.at(-1)[2].aborted,true);assert.equal(clock.jobs.size,0,'offline cleans up outstanding read deadline');await r.network(online);assert.equal(r.calls.reads.length,2);const stale=snapshot();stale.revision='999';await React.act(async()=>read.resolve({outcome:'ok',snapshot:stale}));assert.equal(r.calls.writes.length,0);}finally{await r.close();}
});
it('mounted native offline-online in one event turn revokes old write ownership',async()=>{
 const r=await mountScoring();try{await r.edit('scoring-commentary','Retained');const save=r.props.get('scoring-save-commentary').onPress;await React.act(async()=>{const native=r.calls.networkListeners.at(-1).cb;native(offline);native(online);save();});assert.equal(r.calls.writes.length,0,'batched offline/online cannot revive a captured callback');await r.press('scoring-save-commentary');assert.equal(r.calls.writes.length,1);}finally{await r.close();}
});
it('mounted offline revokes read callbacks synchronously before passive cleanup',async()=>{
 const clock=new ScoringClock();const r=await mountScoring({clock});try{const reads=r.calls.reads.length;const observer=r.calls.watches.at(-1);await React.act(async()=>{r.calls.networkListeners.at(-1).cb(offline);observer.invalidate();});assert.equal(r.calls.reads.length,reads,'native offline event must gate reads immediately');await clock.advance(30000);assert.equal(r.calls.reads.length,reads);assert.equal(clock.jobs.size,0);}finally{await r.close();}
});
it('mounted offline preserves the exact pending mutation deadline and unknown journal without retry',async()=>{
 const clock=new ScoringClock(), late=held();const r=await mountScoring({clock,write:()=>late.promise});try{await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');await r.press('scoring-save-goal');const request=structuredClone(r.calls.writes[0]);await clock.advance(4000);await r.network(offline);assert.match(r.text(),/Offline/);await clock.advance(5999);assert.doesNotMatch(r.text(),/Result unknown/);await clock.advance(1);assert.match(r.dom.window.document.querySelector('[data-testid="scoring-wizard"]').textContent,/Result unknown/,'offline must not hide the mutation deadline outcome in the modal');const reads=r.calls.reads.length;await React.act(async()=>r.props.get('scoring-reconcile').onPress());assert.equal(r.calls.reads.length,reads);assert.equal(r.calls.writes.length,1);await r.network(online);assert.equal(r.calls.writes.length,1);await r.press('scoring-retry-same-request');assert.equal(r.calls.writes.length,2);assert.deepEqual(r.calls.writes[1],request);const old=snapshot();old.revision='99';old.game.home_score=99;await React.act(async()=>late.resolve({outcome:'applied',snapshot:old}));assert.equal(r.props.get('scoring-score-own').children,99);}finally{await r.close();}
});
it('mounted offline gates new writes and revokes captured write callbacks through reconnect ABA',async()=>{
 const r=await mountScoring();try{await r.edit('scoring-commentary','Local only');const save=r.props.get('scoring-save-commentary').onPress;await r.network(offline);await React.act(async()=>save());assert.equal(r.calls.writes.length,0,'an online callback retained before offline cannot issue a write');assert.equal(r.props.get('scoring-save-commentary').disabled,true);assert.match(r.text(),/Offline.*last confirmed/i);await r.network(online);await React.act(async()=>save());assert.equal(r.calls.writes.length,0,'offline/reconnect must not resurrect an older callback');await r.press('scoring-save-commentary');assert.equal(r.calls.writes.length,1);}finally{await r.close();}
});
it('mounted offline pauses observer refresh and reconnects with one read preserving the open draft',async()=>{
 const r=await mountScoring();try{await r.edit('scoring-commentary','Keep my draft');await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);const before=r.calls.reads.length;const old=r.calls.watches.at(-1);await r.network(offline);assert.ok(old.disposed,'known offline must detach refresh observer');await React.act(async()=>old.invalidate());assert.equal(r.calls.reads.length,before);assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-wizard"]'));assert.equal(r.props.get('scoring-commentary').value,'Keep my draft');await r.network(online);assert.equal(r.calls.reads.length,before+1);await r.network(online);assert.equal(r.calls.reads.length,before+1);assert.equal(r.calls.writes.length,0);assert.equal(r.props.get(`scoring-player-${players[0].player_id}`).accessibilityState.selected,true);}finally{await r.close();}
});
it('native watcher tolerates synchronous SDK failures as unknown',async()=>{
 for(const options of [{getThrows:true},{listenThrows:true}]){const r=watcher(options);if(!options.getThrows)r.initial.resolve(online);await Promise.resolve();await Promise.resolve();assert.equal(r.seen.at(-1),options.getThrows?'unknown':'online');r.stop();}
});
it('native watcher catches initial SDK failure as unknown without overriding a newer event',async()=>{
 const r=watcher();r.initial.reject(new Error('native unavailable'));await new Promise(resolve=>setImmediate(resolve));assert.equal(r.seen.at(-1),'unknown');r.listeners[0].cb({});assert.equal(r.seen.at(-1),'unknown');r.listeners[0].cb(online);assert.equal(r.seen.at(-1),'online');r.stop();
 const newer=watcher();newer.listeners[0].cb(offline);newer.initial.reject(new Error('old failure'));await new Promise(resolve=>setImmediate(resolve));assert.equal(newer.seen.at(-1),'offline');newer.stop();
});
it('native watcher keeps newer events authoritative over the initial promise and suppresses cleanup callbacks',async()=>{
 const r=watcher();r.listeners[0].cb(offline);r.initial.resolve(online);await Promise.resolve();await Promise.resolve();assert.equal(r.seen.at(-1),'offline','stale initial state must not overtake native event');r.stop();const count=r.seen.length;r.listeners[0].cb(online);assert.equal(r.seen.length,count);
 const old=watcher();old.stop();old.initial.resolve(online);await Promise.resolve();assert.equal(old.seen.length,0,'removed setup cannot publish its initial fetch');
});
it('native watcher keeps Android missing-capabilities UNKNOWN negative flags uncertain',async()=>{
 const r=watcher();
 try {
  // expo-network8.0.8 Android: active network with no capabilities is UNKNOWN/false/true.
  r.initial.resolve({type:'UNKNOWN',isConnected:false,isInternetReachable:true});
  await Promise.resolve();await Promise.resolve();
  assert.equal(r.seen.at(-1),'unknown','SDK uncertainty is not proven offline');
 }finally{r.stop();}
});
// Producer-shaped and compatibility controls added after the primary semantic RED→GREEN.
const actualProducerShapes = [
 {producer:'Android missing capabilities',state:{type:'UNKNOWN',isConnected:false,isInternetReachable:true},expected:'unknown'},
 {producer:'Android caught exception',state:{type:'UNKNOWN',isConnected:false,isInternetReachable:false},expected:'unknown'},
 {producer:'web navigator online',state:{type:'UNKNOWN',isConnected:true,isInternetReachable:true},expected:'online'},
 {producer:'known disconnected',state:{type:'NONE',isConnected:false,isInternetReachable:false},expected:'offline'},
 {producer:'known connected WIFI',state:{type:'WIFI',isConnected:true,isInternetReachable:true},expected:'online'},
 {producer:'known WIFI without internet',state:{type:'WIFI',isConnected:true,isInternetReachable:false},expected:'offline'},
 {producer:'empty SDK result',state:{},expected:'unknown'},
 {producer:'legacy connected booleans',state:online,expected:'online'},
 {producer:'legacy disconnected booleans',state:offline,expected:'offline'},
];
for(const {producer,state,expected} of actualProducerShapes)it(`native actualProducerShapes ${producer} preserves initial and event semantics`,async()=>{
 const r=watcher();
 try {
  r.initial.resolve(state);await Promise.resolve();await Promise.resolve();
  assert.equal(r.seen.at(-1),expected,'initial SDK state');
  r.listeners[0].cb(online);assert.equal(r.seen.at(-1),'online');
  r.listeners[0].cb(state);assert.equal(r.seen.at(-1),expected,'SDK event state');
 }finally{r.stop();}
});
it('mounted Android UNKNOWN preserves bounded polling until known offline and reconnect reads only',async()=>{
 const clock=new ScoringClock();const r=await mountScoring({clock});
 try {
  await r.network({type:'UNKNOWN',isConnected:false,isInternetReachable:false});
  const reads=r.calls.reads.length;const observer=r.calls.watches.at(-1);
  await clock.advance(4999);assert.equal(r.calls.reads.length,reads);
  await clock.advance(1);assert.equal(r.calls.reads.length,reads+1);
  assert.equal(observer.disposed,false);
  await r.network({type:'NONE',isConnected:false,isInternetReachable:false});
  await clock.advance(30000);assert.equal(r.calls.reads.length,reads+1);
  assert.equal(clock.jobs.size,0);
  await r.network({type:'WIFI',isConnected:true,isInternetReachable:true});
  assert.equal(r.calls.reads.length,reads+2);assert.equal(r.calls.writes.length,0);
 }finally{await r.close();}
 assert.equal(clock.jobs.size,0);
});
it('native watcher maps the initial disconnected state to offline',async()=>{
 const r=watcher();r.initial.resolve(offline);await Promise.resolve();await Promise.resolve();assert.equal(r.seen.at(-1),'offline');r.stop();assert.equal(r.listeners[0].removed,true);
});
