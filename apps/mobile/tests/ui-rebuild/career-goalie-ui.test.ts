/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGoalieRows, buildLeaderRows, buildSkaterRows, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

function native() {
  return {
    ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
    useWindowDimensions: () => ({ width: 320, height: 740, scale: 1, fontScale: 1.8 }),
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    FlatList: (props: any) => createElement('FlatList', props, props.ListHeaderComponent,
      ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
      !props.data?.length ? props.ListEmptyComponent : null, props.ListFooterComponent),
  };
}
const colors = { __esModule: true, default: { primary: '#0ff', bgBase: '#000', bgSurface: '#111', textPrimary: '#fff', textSecondary: '#aaa', brandGold: '#fc0', borderCard: '#333', glassStroke: '#333', glassStrokeStrong: '#444', brandRink: '#0ff' } };
async function settle(h: ReturnType<typeof createHookHarness>) { for (let index = 0; index < 10; index += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); h.render(); } return h.output; }
const metric = (value: number | null, state = value === null ? 'unknown' : 'recorded', sources: string[] = value === null ? [] : ['skater_stats']) => ({ value, state, sources });
const formatPublicMetric = (value: any, digits?: number) => ({ value: value.state === 'conflicted' ? 'Needs review' : value.value == null ? '—' : `${value.state === 'estimated' ? '~' : ''}${digits == null ? value.value : Number(value.value).toFixed(digits)}`, hint: value.state === 'unknown' ? 'Not recorded.' : value.state === 'estimated' ? 'Estimated.' : value.state === 'conflicted' ? 'Conflicting records need review.' : 'Recorded.' });
const team = { id: '44444444-4444-4444-8444-444444444444', name: 'Owls', logoUrl: null };
function statsPlayer(name = 'Goalie', id = '22222222-2222-4222-8222-222222222222'): StatsScopePlayer {
  return {
    playerId: id, playerName: name, avatarUrl: null, displayTeam: team,
    skater: { gamesPlayed: metric(3), goals: metric(1), assists: metric(2), points: metric(3), championships: metric(0, 'verified', ['capture_confirmation']) } as any,
    goalie: { gamesPlayed: metric(3), goalsAgainst: metric(7), goalsAgainstAverage: metric(7 / 3, 'estimated', ['goalie_stats']), championships: metric(null) } as any,
  };
}
function scopePayload(name = 'Goalie', leagueId = '11111111-1111-4111-8111-111111111111') {
  return {
    schemaVersion: 1, leagueId, leagueSlug: 'harbour', divisionId: null,
    scope: { kind: 'current', label: 'Server Summer', seasonIds: ['33333333-3333-4333-8333-333333333333'], currentSeasonId: '33333333-3333-4333-8333-333333333333' },
    seasons: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Server Summer', status: 'active', startDate: '2026-06-01' }],
    players: [statsPlayer(name)],
  };
}
const career = (name: string) => ({
  player: { name, avatarUrl: null },
  totals: { roles: ['skater'], goalie: null, metrics: { gamesPlayed: metric(10), goals: metric(2), assists: metric(3), points: metric(5), penaltyMinutes: metric(null) } },
  leagues: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Harbour', slug: 'harbour', seasonCount: 1, seasons: [{ seasonId: '33333333-3333-4333-8333-333333333333', sourceId: null, seasonName: 'Historical baseline', sortDate: null, teams: [], roles: ['skater'], goalie: null, metrics: { gamesPlayed: metric(10), goals: metric(2, 'reported', ['imported']), assists: metric(3, 'reported', ['imported']), points: metric(5, 'reported', ['imported']), penaltyMinutes: metric(null) } }] }],
});

function compileStats(h: ReturnType<typeof createHookHarness>, league: any, load: (...args: any[]) => Promise<any>, navigationCalls: any[][] = []) {
  return compileCommonJs<any>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': native(), '@react-navigation/native': { useNavigation: () => ({}) }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/DivisionFilter': (props: any) => createElement('DivisionFilter', props),
    '../components/PillToggle': (props: any) => createElement('PillToggle', props),
    '../components/StatsLeadersCard': { __esModule: true, default: (props: any) => createElement('StatsLeadersCard', props, props.headerControl) },
    '../components/StatsTimelineFilter': (props: any) => createElement('StatsTimelineFilter', props, props.label),
    '../components/StatsTable': {
      STATS_TABLE_ROW_HEIGHT: 60,
      StatsTableHeader: (props: any) => createElement('StatsTableHeader', props),
      StatsTableRowView: (props: any) => createElement('StatsTableRowView', { ...props, testID: `stats-row-${props.row.playerId}`, onPress: () => props.onOpenPlayer(props.row.playerId) }, props.row.playerName, ...props.row.columns.map((column: any) => `${column.label}:${column.display}`)),
    },
    '../context/LeagueContext': { useLeague: () => league },
    '../navigation/playerCard': { navigateToPlayerCard: (...args: any[]) => navigationCalls.push(args) },
    '../lib/statsPresentationModel': { buildSkaterRows, buildGoalieRows, buildLeaderRows },
    '../lib/supabase/publicStats': { getPublicStatsScope: load, formatPublicMetric },
    '../theme/colors': colors,
  }).default;
}

function compileCareer(h: ReturnType<typeof createHookHarness>, auth: any, league: any, load: () => Promise<any>) {
  return compileCommonJs<any>(new URL('../../src/screens/stats/CareerStatsScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': native(), 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '../../components/Avatar': (props: any) => createElement('Avatar', props), '../../components/BrandAtmosphere': () => null, '../../components/SectionHeader': (props: any) => createElement('SectionHeader', props, props.title),
    '../../context/AuthContext': { useAuth: () => auth }, '../../context/LeagueContext': { useLeague: () => league },
    '../../lib/supabase/publicStats': { formatPublicMetric, discoverCareerLeagues: async (_player: string, seeds: any) => seeds, loadCanonicalCareerV2: load }, '../../theme/colors': colors,
  }).default;
}

describe('career and scoped Stats screen behavior', () => {
  it('uses the server-owned scope, displays truthful goalie values, retries, and navigates by real id', async () => {
    const h = createHookHarness(); const calls: any[][] = []; const navigationCalls: any[][] = []; let fail = true;
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async (...args: any[]) => { calls.push(args); if (fail) throw new Error('offline'); return scopePayload(); }, navigationCalls);
    h.mount(() => Stats()); await settle(h);
    assert.match(nodeText(h.output), /Complete authoritative stats are unavailable/);
    fail = false; findNode(h.output, (node) => node.props.testID === 'stats-scope-retry')!.props.onPress(); await settle(h);
    findNode(h.output, (node) => node.type === 'PillToggle')!.props.onChange('Goalies'); h.render();
    assert.match(nodeText(h.output), /Server Summer/); assert.match(nodeText(h.output), /GAA:~2\.33/); assert.match(nodeText(h.output), /CH:—/);
    assert.equal(findNode(h.output, (node) => node.type === 'StatsTableHeader')?.props.expandedMetrics, true, 'enlarged system text opts goalies into the accessible scrolling layout');
    findNode(h.output, (node) => node.props.testID === 'stats-row-22222222-2222-4222-8222-222222222222')!.props.onPress();
    assert.equal(navigationCalls[0][1].playerId, '22222222-2222-4222-8222-222222222222');
    const lastCall = calls.at(-1);
    assert.ok(lastCall);
    assert.deepEqual(lastCall.slice(0, 4), [league.activeLeague.slug, league.activeLeague.id, { kind: 'current' }, null]);
  });

  it('keeps failure terminal on both tabs and retries the complete scope rather than showing plausible partial rows', async () => {
    const h = createHookHarness(); let calls = 0;
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async () => { calls += 1; if (calls === 1) throw new Error('incomplete'); return scopePayload('Recovered Goalie'); });
    h.mount(() => Stats()); await settle(h);
    findNode(h.output, (node) => node.type === 'PillToggle')!.props.onChange('Goalies'); h.render();
    assert.match(nodeText(h.output), /Complete authoritative stats are unavailable/);
    findNode(h.output, (node) => node.props.testID === 'stats-scope-retry')!.props.onPress(); await settle(h);
    assert.ok(calls >= 2); assert.match(nodeText(h.output), /Recovered Goalie/);
  });

  it('career screen shows canonical imported rows and retryable failures without fabricated zero totals', async () => {
    const h = createHookHarness(); let fail = true;
    const auth = { user: { id: '22222222-2222-4222-8222-222222222222' } };
    const league = { activeTheme: {}, availableLeagues: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Harbour', slug: 'harbour' }] };
    const Career = compileCareer(h, auth, league, async () => { if (fail) throw new Error('offline'); const result: any = career('Pat'); result.totals.metrics.gamesPlayed = metric(null, 'conflicted', ['attendance']); return result; });
    h.mount(() => Career({ navigation: { goBack() {} } })); await settle(h);
    assert.match(nodeText(h.output), /Unable to load career stats/); assert.doesNotMatch(nodeText(h.output), /No career stats yet/);
    fail = false; findNode(h.output, (node) => node.props.testID === 'career-retry')!.props.onPress(); await settle(h);
    assert.match(nodeText(h.output), /Needs review/); assert.match(nodeText(h.output), /PIM unavailable/);
    findNode(h.output, (node) => node.props.testID === 'career-league-11111111-1111-4111-8111-111111111111')!.props.onPress(); h.render();
    assert.match(nodeText(h.output), /Imported/);
  });

  it('renders goalie career totals with truthful goalie-only and dual-role labels', async () => {
    for (const roles of [['goalie'], ['skater', 'goalie']] as const) {
      const h = createHookHarness(); const result: any = career(roles.length === 1 ? 'Goalie Only' : 'Dual Role');
      result.totals.roles = [...roles]; result.totals.goalie = { gamesPlayed: metric(3), wins: metric(2), losses: metric(1), saves: metric(18, 'estimated', ['goalie_stats']), goalsAgainst: metric(7), savePercentage: metric(null), goalsAgainstAverage: metric(null), shutouts: metric(0) };
      const auth = { user: { id: '22222222-2222-4222-8222-222222222222' } }; const league = { availableLeagues: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Harbour', slug: 'harbour' }] };
      const Career = compileCareer(h, auth, league, async () => result);
      h.mount(() => Career({ navigation: { goBack() {} } })); await settle(h);
      const totals = findNode(h.output, (node) => node.props.testID === 'career-goalie-totals'); assert.ok(totals); assert.match(nodeText(totals), /3.*GP.*2.*W.*1.*L.*18.*SV.*7.*GA.*—.*SV%.*—.*GAA.*0.*SO/);
      const gpCell = findNode(totals, (node) => node.props.testID === 'career-goalie-gp-cell'); assert.equal(flattenStyle(gpCell!.props.style).width, '50%');
      if (roles.length === 1) assert.match(nodeText(h.output), /goalie records/i); else assert.match(nodeText(h.output), /both skater and goalie/i);
    }
  });

  it('binds career content to user scope and ignores completion after unmount', async () => {
    const h = createHookHarness(); let held = false; let release: ((value: any) => void) | undefined;
    const auth: any = { user: { id: '22222222-2222-4222-8222-222222222222' } }; const league = { availableLeagues: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Harbour', slug: 'harbour' }] };
    const Career = compileCareer(h, auth, league, async () => held ? new Promise((resolve) => { release = resolve; }) : career(auth.user.id));
    h.mount(() => Career({ navigation: { goBack() {} } })); await settle(h); assert.match(nodeText(h.output), /22222222/);
    held = true; auth.user = { id: '55555555-5555-4555-8555-555555555555' }; h.render(); assert.doesNotMatch(nodeText(h.output), /22222222/);
    const updates = h.stateUpdateCount; h.unmount(); release?.(career('LATE PLAYER')); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(h.stateUpdateCount, updates);
  });

  it('binds Stats rows to tab and active league before effects and ignores stale scope completion', async () => {
    const h = createHookHarness(); let releaseA: ((value: any) => void) | undefined; let holdA = false;
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async (_slug: string, id: string) => {
      if (holdA && id.startsWith('1111')) return new Promise((resolve) => { releaseA = resolve; });
      return scopePayload(id.startsWith('1111') ? 'A GOALIE' : 'B GOALIE', id);
    });
    h.mount(() => Stats()); await settle(h); assert.match(nodeText(h.output), /A GOALIE/);
    findNode(h.output, (node) => node.type === 'PillToggle')!.props.onChange('Goalies'); h.render(); assert.match(nodeText(h.output), /A GOALIE/);
    holdA = true; league.activeDivision = { id: '77777777-7777-4777-8777-777777777777', name: 'A' }; h.render(); await settle(h);
    league.activeLeague = { id: '55555555-5555-4555-8555-555555555555', slug: 'bay', name: 'Bay' }; league.activeDivision = null; h.render(); await settle(h);
    releaseA?.(scopePayload('STALE GOALIE')); await settle(h);
    assert.match(nodeText(h.output), /B GOALIE/); assert.doesNotMatch(nodeText(h.output), /STALE/);
  });

  it('makes All time explicitly league-wide while preserving the division for other timelines', async () => {
    const h = createHookHarness(); const calls: any[][] = [];
    const division = { id: '77777777-7777-4777-8777-777777777777', name: 'North' };
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: division, divisions: [division, { id: '88888888-8888-4888-8888-888888888888', name: 'South' }], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async (...args: any[]) => { calls.push(args); const payload = scopePayload(); payload.scope.kind = args[2].kind; payload.scope.label = args[2].kind === 'all' ? 'All time' : 'Server Summer'; return payload; });
    h.mount(() => Stats()); await settle(h);
    assert.ok(findNode(h.output, (node) => node.type === 'DivisionFilter'));
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'all' });
    await settle(h);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [{ kind: 'all' }, null]);
    assert.match(nodeText(findNode(h.output, (node) => node.props.testID === 'stats-all-time-league-wide')), /league-wide.*unavailable/i);
    assert.equal(findNode(h.output, (node) => node.type === 'DivisionFilter'), undefined);
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'current' });
    await settle(h);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [{ kind: 'current' }, division.id]);
    assert.equal(findNode(h.output, (node) => node.type === 'DivisionFilter')?.props.activeDivision.id, division.id);
  });
});
