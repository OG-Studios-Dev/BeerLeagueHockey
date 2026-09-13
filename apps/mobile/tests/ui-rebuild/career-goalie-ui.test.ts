/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

function native() {
  return { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
    useWindowDimensions: () => ({ width: 320, height: 740, scale: 1, fontScale: 1.8 }),
    StyleSheet: { create: (s: any) => s, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    FlatList: (p: any) => createElement('FlatList', p, p.ListHeaderComponent, ...(p.data ?? []).map((item: any, index: number) => p.renderItem({ item, index })), !p.data?.length ? p.ListEmptyComponent : null) };
}
const colors = { __esModule: true, default: { primary:'#0ff', bgBase:'#000', bgSurface:'#111', textPrimary:'#fff', textSecondary:'#aaa', brandGold:'#fc0', borderCard:'#333', glassStroke:'#333', glassStrokeStrong:'#444', brandRink:'#0ff' } };
async function settle(h: any) { for (let i=0;i<10;i++) { await new Promise<void>(resolve => setImmediate(resolve)); h.render(); } return h.output; }
const metric=(value:number|null,state='recorded',sources:string[]=['skater_stats'])=>({value,state,sources});
const formatPublicMetric=(m:any,d?:number)=>({value:m.state==='conflicted'?'Needs review':m.value==null?'—':`${m.state==='estimated'?'~':''}${d==null?m.value:Number(m.value).toFixed(d)}`,hint:m.state==='unknown'?'Not recorded.':m.state==='estimated'?'Estimated.':m.state==='conflicted'?'Conflicting records need review.':'Recorded.'});
const goalie=(name='Goalie')=>({playerId:'22222222-2222-4222-8222-222222222222',playerName:name,displayTeam:{id:'44444444-4444-4444-8444-444444444444',name:'Owls'},avatarUrl:null,metrics:{wins:metric(2),losses:metric(1),gamesPlayed:metric(3),saves:metric(18,'estimated',['goalie_stats']),goalsAgainst:metric(7),savePercentage:metric(null,'unknown',[]),goalsAgainstAverage:metric(null,'unknown',[]),shutouts:metric(0)}});
const seasonStats=()=>({presentationSeason:{id:'33333333-3333-4333-8333-333333333333',name:'Summer'},players:[]});
const career=(name:string)=>({player:{name,avatarUrl:null},totals:{roles:['skater'],goalie:null,metrics:{gamesPlayed:metric(10),goals:metric(2),assists:metric(3),points:metric(5),penaltyMinutes:metric(null,'unknown',[])}},leagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour',seasonCount:1,seasons:[{seasonId:'33333333-3333-4333-8333-333333333333',sourceId:null,seasonName:'Historical baseline',sortDate:null,teams:[],roles:['skater'],goalie:null,metrics:{gamesPlayed:metric(10),goals:metric(2,'reported',['imported']),assists:metric(3,'reported',['imported']),points:metric(5,'reported',['imported']),penaltyMinutes:metric(null,'unknown',[])}}]}]});

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
      '../lib/supabase/data':{getStatsLeadersFromPublicSeason:()=>[]},'../lib/supabase/team':{getMetricsOperationalSeason:async()=>({season:{id:'33333333-3333-4333-8333-333333333333'},error:null})},'../lib/supabase/publicStats':{formatPublicMetric,getPublicSeasonStats:async()=>seasonStats(),getPublicGoaliesV2:async(...a:any[])=>{calls.push(a);if(fail)throw new Error('offline');if(holdA&&a[1].startsWith('1111'))return new Promise(resolve=>{releaseA=resolve;});const isB=a[1].startsWith('5555');return {presentationSeason:{id:'33333333-3333-4333-8333-333333333333',name:isB?'B Season':'Server Summer'},goalies:[goalie(isB?'B Goalie':'Goalie')]};}},
      '../theme/colors':colors,
    }).default;
    h.mount(()=>Stats()); await settle(h); findNode(h.output,n=>n.type==='PillToggle')!.props.onChange('Goalies'); await settle(h);
    assert.match(nodeText(h.output),/Unable to load goalie stats/); fail=false; findNode(h.output,n=>n.props.testID==='goalies-retry')!.props.onPress(); await settle(h);
    assert.match(nodeText(h.output),/Server Summer/); assert.match(nodeText(h.output),/unavailable fields/); assert.match(nodeText(h.output),/SV%:—/);
    const goalieRow=findNode(h.output,n=>n.type==='PlayerRow')!; assert.equal(goalieRow.props.stats.length,3);
    assert.doesNotMatch(nodeText(goalieRow),/Estimated/); goalieRow.props.onPress(); assert.equal(nav[0][1].playerId,'22222222-2222-4222-8222-222222222222');
    assert.deepEqual(calls.at(-1).slice(0,4),[league.activeLeague.slug,league.activeLeague.id,'33333333-3333-4333-8333-333333333333',null]);
    holdA=true; league.activeDivision={id:'77777777-7777-4777-8777-777777777777',name:'A'}; h.render(); await settle(h);
    league.activeLeague={id:'55555555-5555-4555-8555-555555555555',slug:'bay',name:'Bay',theme:{primaryColor:'#0ff'}}; league.activeDivision=null; h.render(); await settle(h);
    releaseA?.({presentationSeason:{id:'33333333-3333-4333-8333-333333333333',name:'STALE SEASON'},goalies:[goalie('STALE GOALIE')]});
    await settle(h); assert.match(nodeText(h.output),/B Goalie/); assert.doesNotMatch(nodeText(h.output),/STALE/);
  });

  it('terminates season errors and no-season states on both tabs and retries the actual season lookup', async () => {
    for (const first of ['error', 'none'] as const) {
      const h=createHookHarness(); let seasonCalls=0;
      const league:any={activeLeague:{id:'11111111-1111-4111-8111-111111111111',slug:'harbour',name:'Harbour'},activeDivision:null,divisions:[],availableLeagues:[],activeTheme:{backgroundColor:'#000',primaryColor:'#0ff'},setActiveDivision(){}};
      const Stats=compileCommonJs<any>(new URL('../../src/screens/StatsScreen.tsx',import.meta.url),{
        react:h.react,'react-native':native(),'@react-navigation/native':{useNavigation:()=>({})},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
        '../components/DivisionFilter':()=>null,'../components/GuestBanner':()=>null,'../components/PillToggle':(p:any)=>createElement('PillToggle',p),
        '../components/PlayerRow':(p:any)=>createElement('PlayerRow',p,p.name),'../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
        '../components/StatsLeadersCard':{__esModule:true,default:()=>null},'../context/LeagueContext':{useLeague:()=>league},'../context/AccessibilityPreferencesContext':{useAccessibilityPreferences:()=>({reduceTransparency:false})},
        '../navigation/playerCard':{navigateToPlayerCard:()=>{}},'../lib/supabase/data':{getStatsLeadersFromPublicSeason:()=>[]},
        '../lib/supabase/team':{getMetricsOperationalSeason:async()=>{seasonCalls+=1;if(seasonCalls===1)return first==='error'?{season:null,error:'offline'}:{season:null,error:null};return {season:{id:'33333333-3333-4333-8333-333333333333'},error:null};}},
        '../lib/supabase/publicStats':{formatPublicMetric,getPublicSeasonStats:async()=>seasonStats(),getPublicGoaliesV2:async()=>({presentationSeason:{name:'Recovered'},goalies:[goalie('Recovered Goalie')]})},
        '../theme/colors':colors,
      }).default;
      h.mount(()=>Stats()); await settle(h);
      assert.match(nodeText(h.output),first==='error'?/Unable to load skater stats/:/No season available/);
      findNode(h.output,n=>n.type==='PillToggle')!.props.onChange('Goalies'); await settle(h);
      assert.match(nodeText(h.output),first==='error'?/Unable to load goalie stats/:/No season available/);
      findNode(h.output,n=>n.props.testID==='goalies-retry')!.props.onPress(); await settle(h);
      assert.ok(seasonCalls>=2); assert.match(nodeText(h.output),/Recovered Goalie/);
      h.unmount();
    }
  });

  it('career screen shows canonical imported rows and retryable failures, without successful zero totals', async () => {
    const h=createHookHarness(); let fail=true;
    const careerLeague={activeTheme:{},availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour'}]};
    const careerUser={id:'22222222-2222-4222-8222-222222222222'};
    const Career=compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
      '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/BrandAtmosphere':()=>null,'../../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../../context/AuthContext':{useAuth:()=>({user:careerUser})},'../../context/LeagueContext':{useLeague:()=>careerLeague},
      '../../lib/supabase/publicStats':{formatPublicMetric,discoverCareerLeagues:async(_:any,s:any)=>s,loadCanonicalCareerV2:async()=>{if(fail)throw new Error('offline');const result:any=career('Pat');result.totals.roles=['skater','goalie'];result.totals.goalie=goalie().metrics;result.totals.metrics.gamesPlayed=metric(null,'conflicted',['attendance']);result.leagues[0].seasons[0].roles=['skater','goalie'];result.leagues[0].seasons[0].metrics.gamesPlayed=metric(null,'conflicted',['attendance']);result.leagues[0].seasons[0].goalie=goalie().metrics;return result;}},
      '../../theme/colors':colors,
    }).default;
    h.mount(()=>Career({navigation:{goBack(){}}})); await settle(h); assert.match(nodeText(h.output),/Unable to load career stats/); assert.doesNotMatch(nodeText(h.output),/No career stats yet/);
    fail=false; findNode(h.output,n=>n.props.testID==='career-retry')!.props.onPress(); await settle(h); assert.match(nodeText(h.output),/Needs review/); assert.match(nodeText(h.output),/PIM unavailable/); assert.match(nodeText(h.output),/both skater and goalie/);
    const heroGpCell=findNode(h.output,n=>n.props.testID==='career-hero-gp-cell');
    const heroGpValue=findNode(h.output,n=>n.props.testID==='career-hero-gp-value');
    assert.ok(heroGpCell&&heroGpValue,'conflicted Career GP has addressable cell and value bounds');
    assert.equal(flattenStyle(heroGpCell.props.style).width,'100%','conflicted Career GP receives a full-width status row');
    assert.equal(heroGpValue.props.numberOfLines,undefined,'conflicted Career GP remains wrappable rather than clipped');
    findNode(h.output,n=>n.props.testID==='career-league-11111111-1111-4111-8111-111111111111')!.props.onPress(); h.render(); assert.match(nodeText(h.output),/Imported/); assert.match(nodeText(h.output),/Goalie.*3 GP.*~18 SV.*— GAA/);
    for (const label of ['Season','GP','G','A','PTS','PIM']) {
      const header=findNode(h.output,n=>n.type==='Text'&&nodeText(n)===label&&n.props.maxFontSizeMultiplier===1.3);
      assert.ok(header,`${label} table header uses the compact-label scaling policy`);
    }
    assert.match(nodeText(h.output),/Published leagues only · Demo results excluded/);
  });

  it('renders goalie career totals with truthful goalie-only and dual-role labels', async () => {
    for (const roles of [['goalie'], ['skater','goalie']] as const) {
      const h=createHookHarness(); const result:any=career(roles.length===1?'Goalie Only':'Dual Role');
      const careerLeague={availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour'}]}; const careerUser={id:'22222222-2222-4222-8222-222222222222'};
      result.totals.roles=[...roles]; result.totals.goalie=goalie().metrics;
      if (roles.length===1) result.totals.metrics={gamesPlayed:metric(null,'unknown',[]),goals:metric(null,'unknown',[]),assists:metric(null,'unknown',[]),points:metric(null,'unknown',[]),penaltyMinutes:metric(null,'unknown',[])};
      const Career=compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx',import.meta.url),{
        react:h.react,'react-native':native(),'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
        '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/BrandAtmosphere':()=>null,'../../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
        '../../context/AuthContext':{useAuth:()=>({user:careerUser})},'../../context/LeagueContext':{useLeague:()=>careerLeague},
        '../../lib/supabase/publicStats':{formatPublicMetric,discoverCareerLeagues:async(_:any,s:any)=>s,loadCanonicalCareerV2:async()=>result},'../../theme/colors':colors,
      }).default;
      h.mount(()=>Career({navigation:{goBack(){}}})); await settle(h);
      const totals=findNode(h.output,n=>n.props.testID==='career-goalie-totals'); assert.ok(totals,nodeText(h.output)); assert.match(nodeText(totals),/3.*GP.*2.*W.*1.*L.*18.*SV.*7.*GA.*—.*SV%.*—.*GAA.*0.*SO/);
      for (const metricId of ['gp','w','l','sv','ga','sv-pct','gaa','so']) {
        const cell=findNode(totals,n=>n.props.testID===`career-goalie-${metricId}-cell`);
        const value=findNode(totals,n=>n.props.testID===`career-goalie-${metricId}-value`);
        assert.ok(cell&&value,`${metricId} exposes distinct value and cell bounds`);
        assert.equal(flattenStyle(cell.props.style).width,'50%',`${metricId} uses the narrow large-font two-column grid`);
      }
      if(roles.length===1){assert.match(nodeText(h.output),/goalie records/i);assert.doesNotMatch(nodeText(h.output),/both skater and goalie/i);}else{assert.match(nodeText(h.output),/both skater and goalie/i);}
      h.unmount();
    }
  });

  it('binds career content to user and seed scope before effects and invalidates completion on unmount', async () => {
    const h=createHookHarness(); const renders:any[]=[]; let release:((value:any)=>void)|undefined;
    const auth:any={user:{id:'22222222-2222-4222-8222-222222222222'}};
    const league:any={availableLeagues:[{id:'11111111-1111-4111-8111-111111111111',name:'Harbour',slug:'harbour'}]};
    let held=false;
    const Career=compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx',import.meta.url),{
      react:h.react,'react-native':native(),'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
      '../../components/Avatar':(p:any)=>createElement('Avatar',p),'../../components/BrandAtmosphere':()=>null,'../../components/SectionHeader':(p:any)=>createElement('SectionHeader',p,p.title),
      '../../context/AuthContext':{useAuth:()=>auth},'../../context/LeagueContext':{useLeague:()=>league},
      '../../lib/supabase/publicStats':{formatPublicMetric,discoverCareerLeagues:async(_:any,s:any)=>s,loadCanonicalCareerV2:async()=>held?new Promise(resolve=>{release=resolve;}):career(auth.user.id)},
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
      '../lib/supabase/data':{getStatsLeadersFromPublicSeason:()=>[{player_id:'skater',player_name:'OLD SKATER',team_short_name:'Old',goals:1,assists:0,points:1,games_played:1,avatar_url:null}]},
      '../lib/supabase/team':{getMetricsOperationalSeason:async()=>({season:{id:'33333333-3333-4333-8333-333333333333'},error:null})},
      '../lib/supabase/publicStats':{formatPublicMetric,getPublicSeasonStats:async()=>seasonStats(),getPublicGoaliesV2:async(_slug:string,id:string)=>({presentationSeason:{name:'Summer'},goalies:[goalie(id.startsWith('1111')?'A GOALIE':'B GOALIE')]})},
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
