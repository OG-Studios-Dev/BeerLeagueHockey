/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptStatsScopePlayersToHomeLeaders, buildCompleteRows, buildGoalieRows, buildLeaderRows, buildRankedRows, buildSkaterRows, shouldShowChampionships, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import { formatPublicMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

function native(width = 320, fontScale = 1.8) {
  return {
    ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
    useWindowDimensions: () => ({ width, height: 740, scale: 1, fontScale }),
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    FlatList: (props: any) => createElement('FlatList', props, props.ListHeaderComponent,
      ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
      !props.data?.length ? props.ListEmptyComponent : null, props.ListFooterComponent),
  };
}
const colors = { __esModule: true, default: { primary: '#0ff', bgBase: '#000', bgSurface: '#111', textPrimary: '#fff', textSecondary: '#aaa', brandGold: '#fc0', borderCard: '#333', glassStroke: '#333', glassStrokeStrong: '#444', brandRink: '#0ff' } };
async function settle(h: ReturnType<typeof createHookHarness>) { for (let index = 0; index < 10; index += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); h.render(); } return h.output; }
function allNodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((node) => allNodes(node, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...allNodes(root.props.children, predicate)];
}
const metric = (value: number | null, state = value === null ? 'unknown' : 'recorded', sources: string[] = value === null ? [] : ['skater_stats']) => ({ value, state, sources });
const team = { id: '44444444-4444-4444-8444-444444444444', name: 'Owls', logoUrl: null };
function statsPlayer(name = 'Goalie', id = '22222222-2222-4222-8222-222222222222'): StatsScopePlayer {
  return {
    playerId: id, playerName: name, avatarUrl: null, displayTeam: team,
    skater: { gamesPlayed: metric(3), goals: metric(1), assists: metric(2), points: metric(3), championships: metric(0, 'verified', ['capture_confirmation']) } as any,
    goalie: { gamesPlayed: metric(3, 'recorded', ['goalie_stats']), goalsAgainst: metric(7, 'recorded', ['goalie_stats']), goalsAgainstAverage: metric(7 / 3, 'recorded', ['goalie_stats']), championships: metric(null) } as any,
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

function compileStats(
  h: ReturnType<typeof createHookHarness>,
  league: any,
  load: (...args: any[]) => Promise<any>,
  navigationCalls: any[][] = [],
  loadGoalies: (...args: any[]) => Promise<any> = async () => ({ goalies: [] }),
  viewport: { width: number; fontScale: number } = { width: 320, fontScale: 1.8 },
) {
  return compileCommonJs<any>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': native(viewport.width, viewport.fontScale), '@react-navigation/native': { useNavigation: () => ({}) }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/DivisionFilter': (props: any) => createElement('DivisionFilter', props),
    '../components/SelectableControl': {
      SelectableControl: (props: any) => createElement('SelectableControl', props, props.children),
      SelectableControlGroup: (props: any) => createElement('SelectableControlGroup', props, props.children),
    },
    '../components/StatsLeadersCard': { __esModule: true, default: (props: any) => createElement('StatsLeadersCard', props) },
    '../components/LeagueLeadersPresentation': { __esModule: true, default: (props: any) => createElement('LeagueLeadersPresentation', props, props.headingAccessory) },
    '../components/StatsRankedRow': { __esModule: true, default: (props: any) => createElement('StatsRankedRow', { ...props, testID: `stats-row-${props.row.playerId}`, onPress: () => props.onOpenPlayer(props.row.playerId) }, props.row.playerName, `${props.row.display} ${props.metric}`) },
    '../components/StatsRoleToggle': { __esModule: true, default: (props: any) => createElement('StatsRoleToggle', props) },
    '../components/StatsTimelineFilter': (props: any) => createElement('StatsTimelineFilter', props, props.label),
    '../context/LeagueContext': { useLeague: () => league },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
    '../navigation/playerCard': { navigateToPlayerCard: (...args: any[]) => navigationCalls.push(args) },
    '../lib/statsPresentationModel': { adaptStatsScopePlayersToHomeLeaders, buildCompleteRows, buildSkaterRows, buildGoalieRows, buildLeaderRows, buildRankedRows, shouldShowChampionships },
    '../lib/supabase/publicStats': { getPublicStatsScope: load, getPublicGoalies: loadGoalies, formatPublicMetric },
    '../theme/colors': colors,
    '../theme/ui': { getSurfacePalette: () => ({ surface: '#102030', elevated: '#182838', interactive: '#203040', stroke: '#406080' }) },
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
  it('shares one role and metric state across both heading toggles while keeping the timeline right-aligned', async () => {
    const h = createHookHarness();
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const payload = scopePayload('Synchronized Player');
    const unavailable = statsPlayer('Unavailable Player', '55555555-5555-4555-8555-555555555555');
    unavailable.skater!.goals = metric(11, 'estimated') as any;
    unavailable.skater!.assists = metric(null, 'unknown') as any;
    unavailable.skater!.points = metric(null, 'conflicted') as any;
    unavailable.goalie!.goalsAgainstAverage = metric(0.1, 'estimated') as any;
    payload.players.push(unavailable);
    const Stats = compileStats(h, league, async () => payload);
    h.mount(() => Stats()); await settle(h);

    let presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
    assert.ok(presentation, 'Stats must mount the shared League Leaders presentation');
    assert.equal(presentation.props.testIDPrefix, 'stats');
    assert.equal(presentation.props.focusPrefix, 'stats');
    assert.equal(presentation.props.showAllStats, false);
    assert.equal(presentation.props.compactMetricTabs, true);
    assert.equal(presentation.props.visibleLeaderLimit, 5);
    assert.equal(presentation.props.rowVariant, 'home-inline');
    assert.equal(presentation.props.metricTabsAccessibilityLabel, 'Stats League Leader metric');
    assert.deepEqual(presentation.props.metricOptions.map((option: any) => option.key), ['goals', 'assists', 'points']);
    assert.equal(presentation.props.leaders[0].player_id, '22222222-2222-4222-8222-222222222222');
    assert.equal(presentation.props.leaders.length, payload.players.length, 'the shared presentation receives the full scope population before it applies its five-row limit');
    assert.deepEqual(
      { goals: presentation.props.leaders[1].goals, assists: presentation.props.leaders[1].assists, points: presentation.props.leaders[1].points, gaa: presentation.props.leaders[1].gaa, estimated: presentation.props.leaders[1].estimated },
      { goals: null, assists: null, points: null, gaa: null, estimated: false },
    );

    let toggles = allNodes(h.output, (node) => node.type === 'StatsRoleToggle');
    assert.equal(toggles.length, 2, 'League Leaders and complete-stats headings each render the same toggle');
    assert.ok(toggles.every((toggle) => toggle.props.role === 'player'));
    const timelineRow = findNode(h.output, (node) => node.props.testID === 'stats-timeline-control-row')!;
    assert.equal(flattenStyle(timelineRow.props.style).justifyContent, 'flex-end');
    assert.ok(findNode(timelineRow, (node) => node.type === 'StatsTimelineFilter'));
    assert.equal(findNode(timelineRow, (node) => node.type === 'StatsRoleToggle'), undefined);

    const stalePlayerMetricChange = presentation.props.onMetricChange;
    toggles[0].props.onSelectRole('goalie'); h.render();
    presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
    toggles = allNodes(h.output, (node) => node.type === 'StatsRoleToggle');
    assert.equal(presentation.props.metric, 'gaa');
    assert.deepEqual(presentation.props.metricOptions.map((option: any) => option.key), ['gaa']);
    assert.ok(toggles.every((toggle) => toggle.props.role === 'goalie'));
    assert.match(nodeText(h.output), /Goalie Stats/);

    stalePlayerMetricChange('goals'); h.render();
    presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
    assert.equal(presentation.props.metric, 'gaa', 'a retained player-metric callback is a no-op after goalie selection');

    toggles[1].props.onSelectRole('player'); h.render();
    presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
    assert.equal(presentation.props.metric, 'points');
    assert.ok(allNodes(h.output, (node) => node.type === 'StatsRoleToggle').every((toggle) => toggle.props.role === 'player'));
  });

  it('keeps both enlarged-text heading titles shrinkable beside fixed 44pt role controls at 320 and 390 widths', async () => {
    for (const width of [320, 390]) {
      const h = createHookHarness();
      const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
      const Stats = compileStats(h, league, async () => scopePayload('Long Player Name'), [], undefined, { width, fontScale: 1.8 });
      h.mount(() => Stats()); await settle(h);

      const completeHeading = findNode(h.output, (node) => node.props.testID === 'stats-complete-heading')!;
      const headingStyle = flattenStyle(completeHeading.props.style);
      const title = findNode(completeHeading, (node) => node.props.accessibilityRole === 'header')!;
      const titleStyle = flattenStyle(title.props.style);
      assert.equal(headingStyle.flexDirection, 'row');
      assert.equal(headingStyle.gap, 8);
      assert.equal(titleStyle.flex, 1);
      assert.equal(titleStyle.minWidth, 0);
      assert.equal(titleStyle.flexShrink, 1);
      assert.ok((width - 32 - 92 - Number(headingStyle.gap)) > 0, `${width}px retains a positive title lane beside the 92pt toggle`);

      const presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
      assert.equal(presentation.props.width, width);
      assert.equal(presentation.props.fontScale, 1.8);
      assert.ok(presentation.props.headingAccessory);
    }
  });

  it('uses the applied payload scope, not the selection draft, to show Champs on complete rows', async () => {
    const h = createHookHarness();
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    let appliedScope: any = { kind: 'current', label: 'Current', seasonIds: ['33333333-3333-4333-8333-333333333333'], currentSeasonId: '33333333-3333-4333-8333-333333333333' };
    const Stats = compileStats(h, league, async () => {
      const payload = scopePayload('Scoped Player');
      payload.scope = { ...appliedScope };
      payload.seasons.push({ id: '66666666-6666-4666-8666-666666666666', name: 'Past', status: 'completed', startDate: '2025-06-01' });
      return payload;
    });
    h.mount(() => Stats()); await settle(h);
    const row = () => findNode(h.output, (node) => node.type === 'StatsRankedRow')!;
    assert.equal(row().props.showChampionships, false);

    appliedScope = { ...appliedScope, kind: 'multiple', label: '1 season' };
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'multiple', seasonIds: ['33333333-3333-4333-8333-333333333333'] });
    await settle(h);
    assert.equal(row().props.showChampionships, false, 'multiple mode with one returned season is still one-season scope');

    appliedScope = { ...appliedScope, kind: 'multiple', label: '2 seasons', seasonIds: ['33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-666666666666'] };
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'multiple', seasonIds: appliedScope.seasonIds });
    await settle(h);
    assert.equal(row().props.showChampionships, true);

    appliedScope = { ...appliedScope, kind: 'all', label: 'All time', seasonIds: ['33333333-3333-4333-8333-333333333333'] };
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'all' });
    await settle(h);
    assert.equal(row().props.showChampionships, true);
  });

  it('uses the server-owned scope, displays truthful goalie values, retries, and navigates by real id', async () => {
    const h = createHookHarness(); const calls: any[][] = []; const navigationCalls: any[][] = []; let fail = true;
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async (...args: any[]) => { calls.push(args); if (fail) throw new Error('offline'); return scopePayload(); }, navigationCalls);
    h.mount(() => Stats()); await settle(h);
    assert.match(nodeText(h.output), /Complete authoritative stats are unavailable/);
    fail = false; findNode(h.output, (node) => node.props.testID === 'stats-scope-retry')!.props.onPress(); await settle(h);
    findNode(h.output, (node) => node.type === 'StatsRoleToggle')!.props.onSelectRole('goalie'); h.render();
    assert.match(nodeText(h.output), /Server Summer/); assert.match(nodeText(h.output), /2\.3 gaa/);
    assert.match(nodeText(h.output), /Goalie Stats/);
    findNode(h.output, (node) => node.props.testID === 'stats-row-22222222-2222-4222-8222-222222222222')!.props.onPress();
    assert.equal(navigationCalls[0][1].playerId, '22222222-2222-4222-8222-222222222222');
    const lastCall = calls.at(-1);
    assert.ok(lastCall);
    assert.deepEqual(lastCall.slice(0, 4), [league.activeLeague.slug, league.activeLeague.id, { kind: 'current' }, null]);
  });

  it('uses only scope-owned GAA and never fetches the legacy goalie contract', async () => {
    const h = createHookHarness(); const goalieCalls: any[][] = [];
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const scope = scopePayload('Contract Goalie');
    scope.players[0].goalie!.goalsAgainst = metric(null) as any;
    scope.players[0].goalie!.goalsAgainstAverage = metric(null) as any;
    const Stats = compileStats(h, league, async () => scope, [], async (...args: any[]) => {
      goalieCalls.push(args);
      return { goalies: [{
        player_id: scope.players[0].playerId, player_name: scope.players[0].playerName,
        team_id: team.id, team_name: team.name, avatar_url: null,
        games_played: 2, wins: 1, losses: 1, save_percentage: null,
        goals_against_average: 2.5, shutouts: 0, saves: null, goals_against: 5, estimated: true,
      }] };
    });

    h.mount(() => Stats()); await settle(h);
    findNode(h.output, (node) => node.type === 'StatsRoleToggle')!.props.onSelectRole('goalie'); h.render();
    const presentation = findNode(h.output, (node) => node.type === 'LeagueLeadersPresentation')!;
    assert.equal(presentation.props.leaders[0].gaa, null);
    assert.equal(goalieCalls.length, 0);
  });

  it('keeps failure terminal on both tabs and retries the complete scope rather than showing plausible partial rows', async () => {
    const h = createHookHarness(); let calls = 0;
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: null, divisions: [], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async () => { calls += 1; if (calls === 1) throw new Error('incomplete'); return scopePayload('Recovered Goalie'); });
    h.mount(() => Stats()); await settle(h);
    findNode(h.output, (node) => node.type === 'StatsRoleToggle')!.props.onSelectRole('goalie'); h.render();
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
    assert.match(nodeText(h.output), /Career Totals—GP/); assert.match(nodeText(h.output), /Conflicting records need review/); assert.match(nodeText(h.output), /PIM unavailable/);
    assert.doesNotMatch(nodeText(h.output), /Needs review/);
    findNode(h.output, (node) => node.props.testID === 'career-league-11111111-1111-4111-8111-111111111111')!.props.onPress(); h.render();
    assert.match(nodeText(h.output), /Imported/);
  });

  it('renders estimated goalie career totals as unavailable through the shared formatter', async () => {
    for (const roles of [['goalie'], ['skater', 'goalie']] as const) {
      const h = createHookHarness(); const result: any = career(roles.length === 1 ? 'Goalie Only' : 'Dual Role');
      result.totals.roles = [...roles]; result.totals.goalie = { gamesPlayed: metric(3), wins: metric(2), losses: metric(1), saves: metric(18, 'estimated', ['goalie_stats']), goalsAgainst: metric(7), savePercentage: metric(null), goalsAgainstAverage: metric(null), shutouts: metric(0) };
      const auth = { user: { id: '22222222-2222-4222-8222-222222222222' } }; const league = { availableLeagues: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Harbour', slug: 'harbour' }] };
      const Career = compileCareer(h, auth, league, async () => result);
      h.mount(() => Career({ navigation: { goBack() {} } })); await settle(h);
      const totals = findNode(h.output, (node) => node.props.testID === 'career-goalie-totals'); assert.ok(totals); assert.match(nodeText(totals), /3.*GP.*2.*W.*1.*L.*—.*SV.*7.*GA.*—.*SV%.*—.*GAA.*0.*SO/);
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
    findNode(h.output, (node) => node.type === 'StatsRoleToggle')!.props.onSelectRole('goalie'); h.render(); assert.match(nodeText(h.output), /A GOALIE/);
    holdA = true; league.activeDivision = { id: '77777777-7777-4777-8777-777777777777', name: 'A' }; h.render(); await settle(h);
    league.activeLeague = { id: '55555555-5555-4555-8555-555555555555', slug: 'bay', name: 'Bay' }; league.activeDivision = null; h.render(); await settle(h);
    releaseA?.(scopePayload('STALE GOALIE')); await settle(h);
    assert.match(nodeText(h.output), /B GOALIE/); assert.doesNotMatch(nodeText(h.output), /STALE/);
  });

  it('makes All time explicitly league-wide while preserving the division for other timelines', async () => {
    const h = createHookHarness(); const calls: any[][] = []; const goalieCalls: any[][] = [];
    const division = { id: '77777777-7777-4777-8777-777777777777', name: 'North' };
    const league: any = { activeLeague: { id: '11111111-1111-4111-8111-111111111111', slug: 'harbour', name: 'Harbour' }, activeDivision: division, divisions: [division, { id: '88888888-8888-4888-8888-888888888888', name: 'South' }], activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, setActiveDivision() {} };
    const Stats = compileStats(h, league, async (...args: any[]) => { calls.push(args); const payload = scopePayload(); payload.scope.kind = args[2].kind; payload.scope.label = args[2].kind === 'all' ? 'All time' : 'Server Summer'; return payload; }, [], async (...args: any[]) => { goalieCalls.push(args); return { goalies: [] }; });
    h.mount(() => Stats()); await settle(h);
    assert.equal(goalieCalls.length, 0, 'Stats never fetches the legacy goalie contract');
    assert.ok(findNode(h.output, (node) => node.type === 'DivisionFilter'));
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'all' });
    await settle(h);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [{ kind: 'all' }, null]);
    assert.equal(goalieCalls.length, 0, 'all-time scope never fetches a goalie estimate');
    assert.match(nodeText(findNode(h.output, (node) => node.props.testID === 'stats-all-time-league-wide')), /league-wide.*unavailable/i);
    assert.equal(findNode(h.output, (node) => node.type === 'DivisionFilter'), undefined);
    findNode(h.output, (node) => node.type === 'StatsTimelineFilter')!.props.onApply({ kind: 'current' });
    await settle(h);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [{ kind: 'current' }, division.id]);
    assert.equal(findNode(h.output, (node) => node.type === 'DivisionFilter')?.props.activeDivision.id, division.id);
  });
});
