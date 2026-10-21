/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileCommonJs } from './component-harness';
const require = createRequire(import.meta.url);
export const React = require('react');
const { createRoot } = require('react-dom/client');
const pnpm = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
const jsdom = readdirSync(pnpm).find(p => p.startsWith('jsdom@'))!;
const { JSDOM } = createRequire(`${pnpm}${jsdom}/node_modules/jsdom/package.json`)('jsdom');
export const scope = { gameId: '30000000-0000-0000-0000-000000000001', teamId: '40000000-0000-0000-0000-000000000001', leagueId: '10000000-0000-0000-0000-000000000001', seasonId: '20000000-0000-0000-0000-000000000001' };
export const players = ['Zoe Full Name', 'Alex First Name', 'Cameron Player'].map((full_name, i) => ({ player_id: `50000000-0000-0000-0000-00000000000${i + 1}`, full_name, jersey_number: i + 11, position: 'Forward', source: 'regular', checkin_status: 'confirmed', presence_version: 1, state: 'checked_in', eligible_for_goal: true, has_credited_stats: false, availability_state: 'none', blocking_goal_ids: [] }));
export const snapshot = () => ({ season_id: scope.seasonId, revision: '1', server_time: '2026-10-20T23:00:00Z', complete: true, game: { status: 'in_progress', scheduled_at: '2026-10-20T22:00:00Z', game_started_at: '2026-10-20T22:02:00Z', own_team_type: 'home', home_team_id: scope.teamId, away_team_id: '40000000-0000-0000-0000-000000000002', home_team_name: 'Home Team', away_team_name: 'Away Team', home_score: 0, away_score: 2, timezone: 'America/Toronto', home_team_logo_url: null, away_team_logo_url: null }, permissions: { can_add_goal: true, can_correct_goal: true, can_manage_roster: true, can_comment: true, blocked_reason: null }, own_goals: [], roster: players.map(p => ({ ...p })), commentary: { text: 'Server note', version: 1 }, counts: { own_goals: 0, roster: 3 } });
export function deferred() { let resolve!: (v: any) => void; let reject!: (v: any) => void; const promise = new Promise<any>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
// Declared unit helper fakes: these tests execute actual mounted UI handlers, not wire decoding.
// Parent raw-transport/browser acceptance executes the real adapter separately.
export async function mountScoring(options: any = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const props = new Map<string, any>(); const calls: any = { reads: [], writes: [], nav: [], watches: [], spares: [] };
  let actor: string | null = 'captain-a', focused = true, params: any = { ...scope }, visible = true, draft: any = { scorerId: null, assist1Id: null, assist2Id: null, unassisted: false, secondChosen: false, stage: 0 };
  let current = options.snapshot ?? snapshot(); let seq = 0;
  const host = (tag: string) => function Host(p: any) { if (p.testID) props.set(p.testID, p); return React.createElement(tag, { 'data-testid': p.testID, onClick: p.onPress, disabled: p.disabled, 'aria-label': p.accessibilityLabel }, p.children); };
  const native = { Image: host('img'), ImageBackground: host('div'), View: host('div'), Text: host('span'), Pressable: host('button'), TextInput: host('div'), ScrollView: host('section'), KeyboardAvoidingView: host('div'), ActivityIndicator: host('i'), RefreshControl: host('i'), Modal: (p: any) => p.visible ? React.createElement('aside', null, p.children) : null, Platform: { OS: 'ios' }, StyleSheet: { create: (s: any) => s }, AppState: { currentState: 'active', addEventListener: (_: any, cb: any) => { calls.appState = cb; return { remove() {} }; } }, BackHandler: { addEventListener: (_: any, cb: any) => { calls.back = cb; return { remove() {} }; } } };
  const eligible = (s: any, excluded: string[] = []) => s.roster.filter((p: any) => p.eligible_for_goal && !excluded.some(id => id.toLowerCase() === p.player_id.toLowerCase())).sort((a: any,b: any) => a.full_name.localeCompare(b.full_name) || a.player_id.localeCompare(b.player_id));
  class RpcError extends Error { constructor(public kind: string, message: string) { super(message); } }
  const api = { getScoringContext: async (...args: any[]) => { calls.reads.push(args); return options.read ? options.read(...args) : { outcome: 'ok', snapshot: current }; }, manageScoring: async (...args: any[]) => { calls.writes.push(args); return options.write ? options.write(...args) : { outcome: 'applied', snapshot: { ...current, revision: '2' } }; }, getScoringTarget: async (...args: any[]) => { calls.targets = args; return options.target === undefined ? scope : options.target; }, createScoringRequestId: () => `70000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`, createScoringEventId: () => `60000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`, CaptainScoringRpcError: RpcError };
  const mocks: any = { react: React, 'react-native': native, '@react-navigation/native': { useIsFocused: () => focused }, 'react-native-safe-area-context': { SafeAreaView: host('main'), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, 'expo-linear-gradient': { LinearGradient: host('div') }, '@expo/vector-icons': { Ionicons: host('i'), MaterialCommunityIcons: host('i') }, '../../components/CutIceTitle': { __esModule:true, default:(p:any)=>React.createElement('header',p) }, '../../components/CardFocus': { FocusCard: host('div'), FocusScrollView: host('section') }, '../../assets/team-page/weekly-games-bg.jpg': 'fixture', '../../context/AuthContext': { useAuth: () => ({ user: actor ? { id: actor } : null }) }, '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: true }) }, '../../config/hockeyLife': { HOCKEY_LIFE_ID: scope.leagueId }, '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (x: any) => x }, '../../lib/supabase/captainScoring': api, '../../lib/captain/scoringModel': { eligibleScoringPlayers: eligible, scoringPlayerName: (p: any) => p.full_name ?? 'Unnamed player', sameScoringIdentity: (a: string,b: string) => a.toLowerCase() === b.toLowerCase() }, '../../lib/supabase/captainScoringObserver': { watchCaptainScoring: (_s: any, invalidate: any, status: any) => { const w = { invalidate, status, disposed: false }; calls.watches.push(w); return () => { w.disposed = true; }; } }, '../../components/captain/FindSpareModal': { __esModule: true, default: (p: any) => { calls.spares.push(p); return p.visible ? React.createElement('button', { 'data-testid': 'spare-close', onClick: p.onClose }, 'Find Spare') : null; } } };
  if(options.rpc){
    calls.rpc=[];calls.channels=[];
    const transport={
      rpc:(name:string,args:any)=>{const call={name,args,signal:undefined as any};calls.rpc.push(call);return {abortSignal(signal:any){call.signal=signal;return this;},then(yes:any,no:any){return Promise.resolve().then(()=>options.rpc(name,args)).then(yes,no);}};},
      channel:()=>{const channel:any={callbacks:[],disposed:false,on(_event:any,_filter:any,cb:any){this.callbacks.push(cb);return this;},subscribe(cb:any){this.status=cb;return this;}};calls.channels.push(channel);return channel;},
      removeChannel:(channel:any)=>{channel.disposed=true;return Promise.resolve();},
    };
    const boundary={'./client':{supabase:transport},'expo-crypto':{randomUUID:()=>`70000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`}};
    mocks['../../lib/supabase/captainScoring']=compileCommonJs<any>(new URL('../../src/lib/supabase/captainScoring.ts',import.meta.url),boundary);
    mocks['../../lib/supabase/captainScoringObserver']=compileCommonJs<any>(new URL('../../src/lib/supabase/captainScoringObserver.ts',import.meta.url),boundary);
    mocks['../../lib/captain/scoringModel']=compileCommonJs<any>(new URL('../../src/lib/captain/scoringModel.ts',import.meta.url),{});
  }
  calls.networkListeners=[];
  const network = { getNetworkStateAsync: () => options.networkInitial ?? Promise.resolve({isConnected:true,isInternetReachable:true}), addNetworkStateListener: (cb:any) => { const sub={cb,removed:false};calls.networkListeners.push(sub);return {remove:()=>{sub.removed=true;}}; } };
  const networkUrl=new URL('../../src/lib/captain/scoringConnectivity.ts',import.meta.url);
  if(existsSync(fileURLToPath(networkUrl.href)))mocks['../../lib/captain/scoringConnectivity']=compileCommonJs<any>(networkUrl,{'expo-network':network});
  const load = (path: string) => {
    const url = new URL(`../../src/${path}`, import.meta.url);
    if (!existsSync(fileURLToPath(url.href))) return () => null;
    if (!options.clock) return compileCommonJs<any>(url,mocks).default;
    // Scope fake timers to the unchanged production module; ReactDOM/JSDOM keep real scheduling.
    const compiled = ts.transpileModule(readFileSync(fileURLToPath(url.href),'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports: any = {};
    new Function('require','exports','setTimeout','clearTimeout',compiled)((id: string) => {
      assert.ok(id in mocks, `Unapproved timed-module import: ${id}`);
      return mocks[id];
    }, exports, options.clock.set, options.clock.clear);
    return exports.default;
  };
  const Wizard = load('components/captain/ScoringGoalWizard.tsx'); mocks['../../components/captain/ScoringGoalWizard'] = { __esModule: true, default: Wizard };
  const Roster = load('components/captain/ScoringGameRoster.tsx'); mocks['../../components/captain/ScoringGameRoster'] = { __esModule: true, default: Roster };
  if(options.dashboard){
    const builder=(data:any)=>{const b:any={select:()=>b,eq:()=>b,in:()=>b,is:()=>b,or:()=>b,gte:()=>b,order:()=>b,limit:()=>b,maybeSingle:async()=>({data,error:null}),then:(yes:any)=>Promise.resolve({data,error:null}).then(yes)};return b;};
    mocks['../../lib/supabase/client']={supabase:{from:(table:string)=>builder(table==='games'?null:[{team_id:scope.teamId,league_id:scope.leagueId,team:{id:scope.teamId,name:'Current Team'},league:{id:scope.leagueId,timezone:'America/Toronto'}}])}};
    mocks['../../lib/supabase/team']={getTeamActiveSeason:async()=>({season:{id:scope.seasonId,status:'active'},error:null})};
    mocks['../../config/publicLinks']={};mocks['../../lib/publicLinks']={};mocks['../../theme/colors']={__esModule:true,default:{primary:'#22d3ee'}};
  }
  const Screen = load(options.dashboard?'screens/captain/CaptainDashboardScreen.tsx':'screens/captain/ScoreboardScreen.tsx');
  const root = createRoot(dom.window.document.getElementById('root'));
  const navigation = { setOptions: (o:any)=>{calls.header=o.header;}, canGoBack: () => options.canGoBack !== false, goBack: () => calls.nav.push(['back']), navigate: (...a: any[]) => calls.nav.push(a), addListener: (_: any, cb: any) => { calls.beforeRemove = cb; return () => {}; } };
  let suspended=false;const suspension=new Promise(()=>{});const Suspend=()=>{if(suspended)throw suspension;return null;};
  const tree = () => React.createElement(React.StrictMode, null, options.wizard ? React.createElement(Wizard, { visible, scope, mode: 'add', teamName: 'Home Team', gameLabel: 'Tue, Oct 20', players: current.roster, draft, onDraftChange: (d: any) => { draft = d; void render(); }, onClose: () => { visible = false; void render(); }, onBack: () => {}, onSave: (d: any) => calls.writes.push(d), pending: false, error: null }) : React.createElement(React.Suspense,{fallback:React.createElement('div',null,'Suspended')},React.createElement(Screen, { route: { params }, navigation }),React.createElement(Suspend)));
  const render = async () => {await React.act(async()=>root.render(tree()));};
  await render();
  return { calls, props, dom, RpcError, text: () => dom.window.document.body.textContent ?? '', render,
    async press(id: string) { const node = dom.window.document.querySelector(`[data-testid="${id}"]`) as HTMLElement; assert.ok(node, `missing ${id}`); await React.act(async () => { await props.get(id)?.onPress?.(); if (!props.has(id)) node.click(); }); },
    async edit(id: string, value: string) { await React.act(async () => props.get(id).onChangeText(value)); },
    async speculate(v:any) { params=v;suspended=true;await React.act(async()=>{React.startTransition(()=>root.render(tree()));}); },
    async network(state:any) { await React.act(async()=>{for(const sub of calls.networkListeners)if(!sub.removed)sub.cb(state);}); },
    async actor(v: string | null) { actor=v; await render(); }, async focus(v: boolean) { focused=v; await render(); }, async route(v: any) { params=v; await render(); },
    async update(s: any) { current=s; await React.act(async () => calls.watches.at(-1)?.invalidate()); },
    async close() { await React.act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis,previous); } };
}
// CONNECTIVITY-V4-01: actual Android8.0.8 producer shapes, not generic boolean fixtures.
for(const reachable of [true,false])it(`mounted Android UNKNOWN internet=${reachable} retains observer and dirty eligible Save before known offline`,async()=>{
 const r=await mountScoring();
 try {
  await r.edit('scoring-commentary','Retained local note');
  const observer=r.calls.watches.at(-1);const reads=r.calls.reads.length;
  const eligibleSave=r.props.get('scoring-save-commentary').onPress;
  await r.network({type:'UNKNOWN',isConnected:false,isInternetReachable:reachable});
  assert.match(r.text(),/Connection unknown/);assert.doesNotMatch(r.text(),/Offline/);
  assert.equal(observer.disposed,false);assert.equal(r.calls.watches.at(-1),observer);
  assert.equal(r.calls.reads.length,reads,'uncertainty is not an offline epoch');
  assert.equal(r.props.get('scoring-commentary').value,'Retained local note');
  assert.equal(r.props.get('scoring-save-commentary').disabled,false);
  await React.act(async()=>observer.invalidate());
  assert.equal(r.calls.reads.length,reads+1,'uncertainty keeps the read observer live');
  await r.network({type:'NONE',isConnected:false,isInternetReachable:false});
  assert.equal(observer.disposed,true);assert.equal(r.props.get('scoring-save-commentary').disabled,true);
  await React.act(async()=>{observer.invalidate();eligibleSave();});
  assert.equal(r.calls.reads.length,reads+1);assert.equal(r.calls.writes.length,0);
  await r.network({type:'WIFI',isConnected:true,isInternetReachable:true});
  assert.equal(r.calls.reads.length,reads+2,'reconnect makes exactly one fresh READ');
  await r.network({type:'WIFI',isConnected:true,isInternetReachable:true});
  assert.equal(r.calls.reads.length,reads+2);assert.equal(r.calls.writes.length,0);
  assert.equal(r.props.get('scoring-commentary').value,'Retained local note');
  assert.equal(r.props.get('scoring-save-commentary').disabled,false);
 }finally{await r.close();}
});
it('mounted web UNKNOWN positive flags remain connected without a second initial read',async()=>{
 const initial=deferred();const r=await mountScoring({networkInitial:initial.promise});
 try {
  const observer=r.calls.watches.at(-1);assert.equal(r.calls.reads.length,1);
  await React.act(async()=>initial.resolve({type:'UNKNOWN',isConnected:true,isInternetReachable:true}));
  assert.doesNotMatch(r.text(),/Connection unknown|Offline/);
  assert.equal(r.calls.reads.length,1);assert.equal(r.calls.watches.at(-1),observer);
  await r.edit('scoring-commentary','Web connected note');
  assert.equal(r.props.get('scoring-save-commentary').disabled,false);
  assert.equal(r.calls.writes.length,0);
 }finally{await r.close();}
});
it('loads the authoritative shared score without fake empty totals and ignores older snapshots', async () => {
  const r = await mountScoring(); try {
    assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-scorecard"]'));
    assert.equal(r.props.get('scoring-score-opponent').children,2);
    const next = snapshot(); next.revision='8'; next.game.away_score=7; await r.update(next);
    assert.equal(r.props.get('scoring-score-opponent').children,7);
    const old = snapshot(); old.revision='2'; await r.update(old); assert.equal(r.props.get('scoring-score-opponent').children,7);
    assert.ok(r.calls.reads.length >= 3);
    await r.focus(false); assert.ok(r.calls.watches.every((w: any) => w.disposed));
  } finally { await r.close(); }
});

it('edits populated own goals and confirms removal of the exact versioned ID only', async () => {
  const s: any=snapshot(); s.own_goals=[1,2].map(n=>({event_id:`60000000-0000-0000-0000-00000000000${n}`,event_version:n,team_id:scope.teamId,scorer_id:players[0].player_id,assist1_id:players[1].player_id,assist2_id:null,entered_at:'2026-10-20T23:00:00Z',can_edit:true,blocked_reason:null}));
  const r=await mountScoring({snapshot:s});try{
    await r.press(`scoring-actions-${s.own_goals[1].event_id}`); await r.press('scoring-edit-goal');
    assert.match(r.text(),/Edit goal/); assert.equal(r.props.get(`scoring-player-${players[0].player_id}`).accessibilityState.selected,true);assert.equal(r.calls.writes.length,0);
    await r.press('scoring-wizard-back'); await r.press(`scoring-actions-${s.own_goals[1].event_id}`); await r.press('scoring-remove-goal');assert.match(r.text(),/Remove this goal/);assert.equal(r.calls.writes.length,0);
    await r.press('scoring-confirm-remove');assert.equal(r.calls.writes[0][2].kind,'remove_goal');assert.equal(r.calls.writes[0][2].event_id,s.own_goals[1].event_id);assert.equal(r.calls.writes[0][2].expected_version,2);
  }finally{await r.close();}
});


it('uses game-only roster CAS and blocks credited scratch with real related-goal review', async()=>{
 const s:any=snapshot();s.roster[0].has_credited_stats=true;s.roster[1].state='scratched';s.roster[1].eligible_for_goal=false;s.roster[1].checkin_status='out';
 const r=await mountScoring({snapshot:s});try{
  await r.press('scoring-checked-in');await r.press(`scoring-scratch-${players[0].player_id}`);assert.equal(r.calls.writes.length,0);assert.match(r.text(),/credited/);assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-review-goals"]'));
  await r.press(`scoring-reinstate-${players[1].player_id}`);assert.equal(r.calls.writes[0][2].kind,'reinstate');assert.equal(r.calls.writes[0][2].expected_version,1);
  await r.press('scoring-add-spare');const p=r.calls.spares.at(-1);assert.equal(p.actorId,'captain-a');assert.equal(p.visible,true);assert.equal('onSuccess' in p,false);assert.deepEqual(p.scope,{gameId:scope.gameId,teamId:scope.teamId,leagueId:scope.leagueId});await r.press('spare-close');assert.ok(r.calls.reads.length>=2);
 }finally{await r.close();}
});


it('preserves dirty team commentary and its original CAS version across opponent refresh and conflict',async()=>{
 const r=await mountScoring({write:async()=>({outcome:'conflict',code:'commentary_version_conflict',snapshot:snapshot()})});try{
  assert.ok(r.props.has('scoring-commentary'),'team commentary input is reachable'); await r.edit('scoring-commentary','My local note');const s=snapshot();s.revision='3';s.game.away_score=3;s.commentary={text:'Other editor note',version:2};await r.update(s);
  assert.equal(r.props.get('scoring-commentary').value,'My local note');await r.press('scoring-save-commentary');assert.equal(r.calls.writes[0][2].kind,'set_commentary');assert.equal(r.calls.writes[0][2].expected_version,1);assert.equal(r.calls.writes[0][2].text,'My local note');assert.equal(r.props.get('scoring-commentary').value,'My local note');assert.match(r.text(),/Review/);
 }finally{await r.close();}
});

it('exposes only real visible surfaces for source-bound phone geometry and roster close',async()=>{const r=await mountScoring();try{for(const id of ['scoring-root','scoring-body','scoring-crest-own','scoring-crest-opponent'])assert.ok(r.dom.window.document.querySelector(`[data-testid="${id}"]`),id);await r.press('scoring-checked-in');assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-roster-body"]'));await r.press('scoring-roster-close');assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-roster"]'),null);await r.press('scoring-add-goal');for(const id of ['scoring-wizard-body','scoring-wizard-footer','scoring-wizard-close'])assert.ok(r.dom.window.document.querySelector(`[data-testid="${id}"]`),id);}finally{await r.close();}});

it('keeps the first assist when no second assist is chosen and preserves draft on Back',async()=>{const r=await mountScoring({wizard:true});try{await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press(`scoring-player-${players[1].player_id}`);await r.press('scoring-continue');await r.press('scoring-no-second-assist');assert.equal(r.calls.writes.length,0);await r.press('scoring-save-goal');assert.equal(r.calls.writes[0].assist1Id,players[1].player_id);assert.equal(r.calls.writes[0].assist2Id,null);}finally{await r.close();}});
it('blocks a saved player callback after authoritative eligibility changes and exposes legacy goals read only',async()=>{const s:any=snapshot();s.own_goals=[{event_id:'60000000-0000-0000-0000-000000000009',event_version:1,team_id:scope.teamId,scorer_id:null,assist1_id:null,assist2_id:null,entered_at:'2026-10-20T23:00:00Z',can_edit:false,blocked_reason:'legacy_unattributed'}];const r=await mountScoring({snapshot:s});try{assert.match(r.text(),/legacy unattributed/);assert.equal(r.dom.window.document.querySelector('[data-testid^="scoring-actions-"]'),null);await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');const save=r.props.get('scoring-save-goal').onPress;const next:any={...s,revision:'5',roster:s.roster.map((p:any)=>({...p,eligible_for_goal:false}))};await r.update(next);await React.act(async()=>save());assert.equal(r.calls.writes.length,0);assert.match(r.text(),/no longer eligible/);}finally{await r.close();}});

it('shows confirmed unavailable attendance honestly as Needs review without goal or attendance mutations',async()=>{const s:any=snapshot();s.roster[0]={...s.roster[0],state:'unavailable',availability_state:'unknown',eligible_for_goal:false,checkin_status:'confirmed'};s.roster[1]={...s.roster[1],state:'scratched',availability_state:'out',eligible_for_goal:false,checkin_status:'out'};s.roster[2]={...s.roster[2],state:'credited_not_eligible',availability_state:'conflict',eligible_for_goal:false,has_credited_stats:true};const r=await mountScoring({snapshot:s});try{await r.press('scoring-checked-in');assert.match(r.text(),/Needs review/);assert.match(r.text(),/Confirmed check-in/);for(const p of s.roster){assert.equal(r.dom.window.document.querySelector(`[data-testid="scoring-scratch-${p.player_id}"]`),null);assert.equal(r.dom.window.document.querySelector(`[data-testid="scoring-reinstate-${p.player_id}"]`),null);}assert.ok(r.dom.window.document.querySelector(`[data-testid="scoring-review-goals-${players[2].player_id}"]`));await r.press('scoring-roster-close');await r.press('scoring-add-goal');assert.equal(r.dom.window.document.querySelectorAll('[data-testid^="scoring-player-"]').length,0);assert.equal(r.calls.writes.length,0);}finally{await r.close();}});

it('requires a scorer and sorts actual goal tiles alphabetically before explicit unassisted save', async () => {
  const r = await mountScoring({ wizard: true }); try {
    assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-stage-goal"]'));
    assert.equal(r.props.get('scoring-continue').disabled, true);
    const ids = [...r.dom.window.document.querySelectorAll('[data-testid^="scoring-player-"]')].map((n: any) => n.dataset.testid);
    assert.deepEqual(ids, [players[1],players[2],players[0]].map(p => `scoring-player-${p.player_id}`));
    await r.press(`scoring-player-${players[1].player_id}`); await r.press('scoring-continue');
    assert.match(r.text(), /First Assist/); assert.equal(r.calls.writes.length,0);
    await r.press('scoring-unassisted'); assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-save-goal"]')); assert.equal(r.calls.writes.length,0);
    await r.press('scoring-save-goal'); assert.equal(r.calls.writes.length,1); assert.equal(r.calls.writes[0].assist1Id,null); assert.equal(r.calls.writes[0].assist2Id,null);
  } finally { await r.close(); }
});
