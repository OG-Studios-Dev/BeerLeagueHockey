/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

function native() {
  return { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
    StyleSheet: { create: (s: any) => s, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    FlatList: (p: any) => createElement('FlatList', p, p.ListHeaderComponent, ...(p.data ?? []).map((item: any, index: number) => p.renderItem({ item, index })), !p.data?.length ? p.ListEmptyComponent : null) };
}
const colors = { __esModule: true, default: { primary:'#0ff', bgBase:'#000', bgSurface:'#111', textPrimary:'#fff', textSecondary:'#aaa', brandGold:'#fc0', borderCard:'#333', glassStroke:'#333', glassStrokeStrong:'#444', brandRink:'#0ff' } };
async function settle(h: any) { for (let i=0;i<10;i++) { await new Promise<void>(resolve => setImmediate(resolve)); h.render(); } return h.output; }

describe('career and goalie screen behavior', () => {
  it('uses the canonical goalie page helper, server season name, em dashes, estimate label, retry, and real navigation IDs', async () => {
    const h=createHookHarness(); const calls:any[]=[]; let fail=true; let holdA=false; let releaseA:((value:any)=>void)|undefined; const nav:any[][]=[];
    const league:any={activeLeague:{id:'11111111-1111-4111-8111-111111111111',slug:'harbour',name:'Harbour',theme:{primaryColor:'#0ff'}},activeDivision:null,divisions:[],availableLeagues:[],activeTheme:{backgroundColor:'#000',primaryColor:'#0ff'},setActiveDivision() {}};
    const Stats=compileCommonJs<any>(new URL('../../src/screens/StatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'@react-navigation/native':{useNavigation:()=>({})},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
      '../components/DivisionFilter':(p:any)=>createElement('DivisionFilter',p),'../components/GuestBanner':()=>null,'../components/PillToggle':(p:any)=>createElement('PillToggle',p),
      '../components/PlayerRow':(p:any)=>createElement('PlayerRow',p,p.name,...p.stats.map((x:any)=>`${x.label}:${x.value}`)),'../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../components/StatsLeadersCard':{__esModule:true,default:()=>null},'../context/LeagueContext':{useLeague:()=>league},'../context/AccessibilityPreferencesContext':{useAccessibilityPreferences:()=>({reduceTransparency:false})},
      '../navigation/playerCard':{navigateToPlayerCard:(...a:any[])=>nav.push(a)},'../lib/supabase/client':{supabase:{from:()=>({select:()=>({in:async()=>({data:[]})})})}},
      '../lib/supabase/data':{getStatsLeaders:async()=>[]},'../lib/supabase/publicStats':{getPublicGoalies:async(...a:any[])=>{calls.push(a);if(fail)throw new Error('offline');if(holdA&&a[1].startsWith('1111'))return new Promise(resolve=>{releaseA=resolve;});const isB=a[1].startsWith('5555');return {presentationSeason:{id:'33333333-3333-4333-8333-333333333333',name:isB?'B Season':'Server Summer'},source:'estimated',goalies:[{player_id:'22222222-2222-4222-8222-222222222222',player_name:isB?'B Goalie':'Goalie',team_name:'Owls',avatar_url:null,wins:2,save_percentage:null,goals_against_average:null,estimated:true}]};}},
      '../theme/colors':colors,
    }).default;
    h.mount(()=>Stats()); await settle(h); findNode(h.output,n=>n.type==='PillToggle')!.props.onChange('Goalies'); await settle(h);
    assert.match(nodeText(h.output),/Unable to load goalie stats/); fail=false; findNode(h.output,n=>n.props.testID==='goalies-retry')!.props.onPress(); await settle(h);
    assert.match(nodeText(h.output),/Server Summer/); assert.match(nodeText(h.output),/Estimated/); assert.match(nodeText(h.output),/SV%:—/);
    const goalieRow=findNode(h.output,n=>n.type==='PlayerRow')!; assert.equal(goalieRow.props.stats.length,3);
    assert.doesNotMatch(nodeText(goalieRow),/Estimated/); goalieRow.props.onPress(); assert.equal(nav[0][1].playerId,'22222222-2222-4222-8222-222222222222');
    assert.deepEqual(calls.at(-1).slice(0,4),[league.activeLeague.slug,league.activeLeague.id,null,null]);
    holdA=true; league.activeDivision={id:'77777777-7777-4777-8777-777777777777',name:'A'}; h.render(); await settle(h);
    league.activeLeague={id:'55555555-5555-4555-8555-555555555555',slug:'bay',name:'Bay',theme:{primaryColor:'#0ff'}}; league.activeDivision=null; h.render(); await settle(h);
    releaseA?.({presentationSeason:{id:'33333333-3333-4333-8333-333333333333',name:'STALE SEASON'},source:'estimated',goalies:[{player_id:'22222222-2222-4222-8222-222222222222',player_name:'STALE GOALIE',team_name:'Owls',avatar_url:null,wins:9,save_percentage:null,goals_against_average:null,estimated:true}]});
    await settle(h); assert.match(nodeText(h.output),/B Goalie/); assert.doesNotMatch(nodeText(h.output),/STALE/);
  });

  it('career screen shows canonical imported rows and retryable failures, without successful zero totals', async () => {
    const h=createHookHarness(); let fail=true;
    const careerLeague={activeTheme:{},availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour'}]};
    const careerUser={id:'22222222-2222-4222-8222-222222222222'};
    const Career=compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
      '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/BrandAtmosphere':()=>null,'../../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../../context/AuthContext':{useAuth:()=>({user:careerUser})},'../../context/LeagueContext':{useLeague:()=>careerLeague},
      '../../lib/supabase/publicStats':{discoverCareerLeagues:async(_:any,s:any)=>s,loadCanonicalCareer:async()=>{if(fail)throw new Error('offline');return {player:{name:'Pat',avatarUrl:null},totals:{gamesPlayed:10,goals:2,assists:3,points:5,penaltyMinutes:null},leagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour',seasonCount:1,seasons:[{seasonId:'33333333-3333-4333-8333-333333333333',seasonName:'Historical baseline',teamId:null,teamName:null,gamesPlayed:10,goals:2,assists:3,points:5,penaltyMinutes:null,source:'imported'}]}]};}},
      '../../theme/colors':colors,
    }).default;
    h.mount(()=>Career({navigation:{goBack(){}}})); await settle(h); assert.match(nodeText(h.output),/Unable to load career stats/); assert.doesNotMatch(nodeText(h.output),/No career stats yet/);
    fail=false; findNode(h.output,n=>n.props.testID==='career-retry')!.props.onPress(); await settle(h); assert.match(nodeText(h.output),/10/); assert.match(nodeText(h.output),/PIM unavailable/);
    findNode(h.output,n=>n.props.testID==='career-league-11111111-1111-4111-8111-111111111111')!.props.onPress(); h.render(); assert.match(nodeText(h.output),/Imported/);
    assert.match(nodeText(h.output),/Published leagues only · Demo results excluded/);
  });

  it('binds career content to user and seed scope before effects and invalidates completion on unmount', async () => {
    const h=createHookHarness(); const renders:any[]=[]; let release:((value:any)=>void)|undefined;
    const auth:any={user:{id:'22222222-2222-4222-8222-222222222222'}};
    const league:any={availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour'}]};
    const career=(name:string)=>({player:{name,avatarUrl:null},totals:{gamesPlayed:1,goals:1,assists:0,points:1,penaltyMinutes:0},leagues:[]});
    let held=false;
    const Career=compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
      '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/BrandAtmosphere':()=>null,'../../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../../context/AuthContext':{useAuth:()=>auth},'../../context/LeagueContext':{useLeague:()=>league},
      '../../lib/supabase/publicStats':{discoverCareerLeagues:async(_:any,s:any)=>s,loadCanonicalCareer:async()=>held?new Promise(resolve=>{release=resolve;}):career(auth.user.id)},
      '../../theme/colors':colors,
    }).default;
    h.mount(()=>{const tree=Career({navigation:{goBack(){}}});renders.push(tree);return tree;}); await settle(h);
    assert.match(nodeText(h.output),/22222222/);
    const start=renders.length; held=true; auth.user={id:'55555555-5555-4555-8555-555555555555'}; h.render();
    assert.doesNotMatch(nodeText(renders[start]),/22222222/,'first render of new identity must not paint old career');
    const updates=h.stateUpdateCount; h.unmount(); release?.(career('LATE PLAYER')); await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(h.stateUpdateCount,updates,'late career completion must not update unmounted state');
  });

  it('binds global leaders to tab and league set before effects and labels estimates outside metric columns', async () => {
    const h=createHookHarness(); const renders:any[]=[];
    const league:any={activeLeague:null,activeDivision:null,divisions:[],availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',slug:'harbour',name:'Harbour',theme:{primaryColor:'#0ff'}}],activeTheme:{backgroundColor:'#000',primaryColor:'#0ff'},setActiveDivision(){}};
    const Stats=compileCommonJs<any>(new URL('../../src/screens/StatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'@react-navigation/native':{useNavigation:()=>({})},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
      '../components/DivisionFilter':()=>null,'../components/GuestBanner':()=>null,'../components/PillToggle':(p:any)=>createElement('PillToggle',p),
      '../components/PlayerRow':(p:any)=>createElement('PlayerRow',p,p.name,...p.stats.map((x:any)=>`${x.label}:${x.value}`)),'../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../components/StatsLeadersCard':{__esModule:true,default:()=>null},'../context/LeagueContext':{useLeague:()=>league},'../context/AccessibilityPreferencesContext':{useAccessibilityPreferences:()=>({reduceTransparency:false})},
      '../navigation/playerCard':{navigateToPlayerCard:()=>{}},'../lib/supabase/client':{supabase:{from:()=>({select:()=>({in:async()=>({data:[]})})})}},
      '../lib/supabase/data':{getStatsLeaders:async()=>[{player_id:'skater',player_name:'OLD SKATER',team_short_name:'Old',goals:1,assists:0,points:1,games_played:1}]},
      '../lib/supabase/publicStats':{getPublicGoalies:async(_slug:string,id:string)=>({presentationSeason:{name:'Summer'},source:'estimated',goalies:[{player_id:'goalie',player_name:id.startsWith('1111')?'A GOALIE':'B GOALIE',team_name:'Owls',avatar_url:null,wins:1,save_percentage:null,goals_against_average:null,estimated:true}]})},
      '../theme/colors':colors,
    }).default;
    h.mount(()=>{const tree=Stats();renders.push(tree);return tree;}); await settle(h); assert.match(nodeText(h.output),/OLD SKATER/);
    const start=renders.length; findNode(h.output,n=>n.type==='PillToggle')!.props.onChange('Goalies'); h.render();
    assert.doesNotMatch(nodeText(renders[start]),/OLD SKATER/,'first goalie render must not paint skater snapshot');
    await settle(h); const row=findNode(h.output,n=>n.type==='PlayerRow')!;
    assert.equal(row.props.stats.length,3); assert.doesNotMatch(nodeText(row),/Estimated/); assert.match(nodeText(h.output),/Estimated/);
    const leagueStart=renders.length;
    league.availableLeagues=[{id:'55555555-5555-4555-8555-555555555555',slug:'bay',name:'Bay',theme:{primaryColor:'#0ff'}}]; h.render();
    assert.doesNotMatch(nodeText(renders[leagueStart]),/A GOALIE/,'first changed-league render must not paint old league snapshot');
    await settle(h); assert.match(nodeText(h.output),/B GOALIE/);
  });
});
