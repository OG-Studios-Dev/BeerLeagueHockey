/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGoalieRows, buildLeaderRows, buildRankedRows, buildSkaterRows, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const currentPayload = {
  players: [],
  seasons: [{ id: 'season-a', name: 'Fall 2026', status: 'active', startDate: '2026-09-01' }],
  scope: { kind: 'current', label: 'Current season', seasonIds: ['season-a'], currentSeasonId: 'season-a' },
};

const statMetric = (value: number | null, state: PublicStatMetric['state'] = value === null ? 'unknown' : 'recorded'): PublicStatMetric => ({
  value,
  state,
  sources: value === null ? [] : ['skater_stats'],
});

function rankedPlayers(): StatsScopePlayer[] {
  const values = [
    ['a', 'Alpha Ace', 2, 9, 11, 3],
    ['b', 'Beta Blue', 8, 1, 9, 2],
    ['c', 'Cam Centre', 5, 7, 12, 1],
    ['d', 'Drew Defence', 7, 8, 15, 4],
    ['e', 'Eli Edge', 6, 0, 6, 5],
    ['f', 'Finn Finisher', 4, 2, 6, 6],
    ['g', 'Gray Goalie', null, 6, 10, 0.5],
  ] as const;
  return values.map(([id, playerName, goals, assists, points, gaa]) => ({
    playerId: id,
    playerName,
    avatarUrl: null,
    displayTeam: { id: `team-${id}`, name: `Team ${id.toUpperCase()}`, logoUrl: null },
    skater: {
      gamesPlayed: statMetric(10), goals: statMetric(goals), assists: statMetric(assists), points: statMetric(points), championships: statMetric(0),
    },
    goalie: {
      gamesPlayed: statMetric(2), goalsAgainst: statMetric(gaa * 2), goalsAgainstAverage: statMetric(gaa), championships: statMetric(0),
    },
  }));
}

function payloadWith(players: StatsScopePlayer[], label = 'Current season') {
  return { ...currentPayload, players, scope: { ...currentPayload.scope, label } };
}

function native(width = 390, fontScale = 1) {
  return {
    ActivityIndicator: 'ActivityIndicator',
    Modal: (props: any) => createElement('Modal', props, props.children),
    Pressable: 'Pressable',
    ScrollView: (props: any) => createElement('ScrollView', props, props.children),
    Text: 'Text',
    View: 'View',
    FlatList: (props: any) => createElement(
      'FlatList',
      props,
      props.ListHeaderComponent,
      ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
      props.ListEmptyComponent,
      props.ListFooterComponent,
    ),
    useWindowDimensions: () => ({ width, height: 844, scale: 1, fontScale }),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFill: { position: 'absolute', inset: 0 } },
  };
}

function runtime(width = 390, fontScale = 1, options: {
  payload?: any;
  activeDivision?: { id: string; name: string } | null;
  divisions?: Array<{ id: string; name: string }>;
  getScope?: (...args: any[]) => Promise<any>;
  reduceTransparency?: boolean;
} = {}) {
  const h = createHookHarness();
  const navigationCalls: any[][] = [];
  const scopeCalls: any[][] = [];
  const navigation = { navigate: (...args: any[]) => navigationCalls.push(args) };
  const league = {
    activeLeague: { id: 'league-a', name: 'League A', slug: 'league-a' },
    activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' },
    activeDivision: options.activeDivision ?? null,
    setActiveDivision() {},
    divisions: options.divisions ?? (options.activeDivision ? [options.activeDivision, { id: 'division-b', name: 'Division B' }] : []),
  };
  const Screen = compileCommonJs<{ default: () => unknown }>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
    react: h.react,
    'react-native': native(width, fontScale),
    '@react-navigation/native': { useNavigation: () => navigation },
    '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicons', props) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/PillToggle': (props: any) => createElement('PillToggle', props),
    './Avatar': (props: any) => createElement('Avatar', props),
    './TeamLogo': (props: any) => createElement('TeamLogo', props),
    '../components/StatsLeadersCard': { __esModule: true, default: (props: any) => createElement('StatsLeadersCard', props) },
    '../components/StatsTable': {
      needsExpandedGoalieMetrics: () => false,
      StatsTableHeader: (props: any) => createElement('StatsTableHeader', props),
      StatsTableRowView: (props: any) => createElement('StatsTableRowView', props),
    },
    '../context/LeagueContext': { useLeague: () => league },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: options.reduceTransparency ?? false }) },
    '../navigation/playerCard': { navigateToPlayerCard: (...args: any[]) => navigationCalls.push(['player-card', ...args]) },
    '../lib/statsPresentationModel': { buildSkaterRows, buildGoalieRows, buildLeaderRows, buildRankedRows },
    '../lib/supabase/publicStats': {
      getPublicStatsScope: async (...args: any[]) => {
        scopeCalls.push(args);
        return options.getScope ? options.getScope(...args) : options.payload ?? currentPayload;
      },
      getPublicGoalies: async () => ({ goalies: [] }),
      formatPublicMetric: (metric: PublicStatMetric, digits?: number) => ({
        value: metric.value === null ? '—' : digits === undefined ? String(metric.value) : metric.value.toFixed(digits),
        hint: metric.value === null ? 'Not recorded.' : 'Recorded.',
      }),
    },
    '../theme/ui': { getSurfacePalette: (reduced: boolean) => reduced
      ? { surface: '#102030', elevated: '#182838', interactive: '#203040', stroke: '#406080' }
      : { surface: 'rgba(16,32,48,0.3)', elevated: 'rgba(24,40,56,0.4)', interactive: 'rgba(32,48,64,0.7)', stroke: 'rgba(64,96,128,0.4)' } },
    '../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', primary: '#0ff', bgInteractive: '#1C2A42', glassStrokeStrong: 'rgba(64,96,128,0.4)' } },
  }).default;
  h.mount(() => Screen());
  return { h, navigationCalls, scopeCalls };
}

async function settle(result: ReturnType<typeof runtime>) {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    result.h.render();
  }
  return result.h.output;
}

function findNodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((node) => findNodes(node, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...findNodes(root.props.children, predicate)];
}

function alpha(color: unknown): number {
  if (typeof color !== 'string') return 0;
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

describe('unified Stats page controls', () => {
  it('renders the timeline as a clock-only 44pt control whose accessible name includes the current scope', async () => {
    const result = runtime();
    const output = await settle(result);
    const timeline = findNode(output, (node) => node.props.testID === 'stats-timeline-open');

    assert.equal(timeline?.props.accessibilityRole, 'button');
    assert.equal(timeline?.props.accessibilityLabel, 'Open timeline filter. Current season');
    assert.ok(flattenStyle(timeline?.props.style({ pressed: false })).minWidth >= 44);
    assert.ok(flattenStyle(timeline?.props.style({ pressed: false })).minHeight >= 44);
    assert.equal(nodeText(timeline), '');
    assert.equal(findNode(timeline, (node) => node.type === 'Ionicons')?.props.name, 'time-outline');
  });

  it('places a compact two-option icon role selector immediately beside the timeline with truthful mutually-exclusive state', async () => {
    const result = runtime(320);
    let output = await settle(result);
    const controls = findNode(output, (node) => node.props.testID === 'stats-role-controls');
    let group = findNode(controls, (node) => node.props.testID === 'stats-role-toggle');
    let player = findNode(group, (node) => node.props.testID === 'stats-role-option-player');
    let goalie = findNode(group, (node) => node.props.testID === 'stats-role-option-goalie');

    assert.equal(group?.props.accessibilityRole, 'tablist');
    assert.equal(group?.props.accessibilityLabel, 'Stats role');
    assert.equal(player?.props.accessibilityRole, 'tab');
    assert.equal(player?.props.accessibilityLabel, 'Player stats');
    assert.deepEqual(player?.props.accessibilityState, { selected: true });
    assert.equal(player?.props['aria-selected'], true);
    assert.equal(goalie?.props.accessibilityRole, 'tab');
    assert.equal(goalie?.props.accessibilityLabel, 'Goalie stats');
    assert.deepEqual(goalie?.props.accessibilityState, { selected: false });
    assert.equal(goalie?.props['aria-selected'], false);
    for (const option of [player, goalie]) {
      const style = flattenStyle(option?.props.style({ pressed: false }));
      assert.ok(style.minWidth >= 44);
      assert.ok(style.minHeight >= 44);
    }
    assert.equal(nodeText(group), '');
    assert.ok(findNode(group, (node) => node.props.testID === 'stats-role-icon-player'));
    assert.ok(findNode(group, (node) => node.props.testID === 'stats-role-icon-goalie'));
    assert.ok(Number(flattenStyle(group?.props.style).maxWidth) <= 92, 'two targets stay compact beside the timeline at 320pt');

    goalie?.props.onPress();
    output = result.h.render();
    group = findNode(output, (node) => node.props.testID === 'stats-role-toggle');
    player = findNode(group, (node) => node.props.testID === 'stats-role-option-player');
    goalie = findNode(group, (node) => node.props.testID === 'stats-role-option-goalie');
    assert.deepEqual(player?.props.accessibilityState, { selected: false });
    assert.equal(player?.props['aria-selected'], false);
    assert.deepEqual(goalie?.props.accessibilityState, { selected: true });
    assert.equal(goalie?.props['aria-selected'], true);
    assert.ok(findNode(group, (node) => node.props.testID === 'stats-role-icon-player'));
    assert.ok(findNode(group, (node) => node.props.testID === 'stats-role-icon-goalie'));
  });

  it('ignores a retained player metric callback after goalie selection commits', async () => {
    const result = runtime(390, 1, { payload: payloadWith(rankedPlayers()) });
    let output = await settle(result);
    const retainedGoalsCallback = findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals')?.props.onPress;
    assert.equal(typeof retainedGoalsCallback, 'function');

    findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')?.props.onPress();
    output = result.h.render();
    const goalieState = () => ({
      playerSelected: findNode(output, (node) => node.props.testID === 'stats-role-option-player')?.props.accessibilityState.selected,
      goalieSelected: findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')?.props.accessibilityState.selected,
      metricSelected: findNode(output, (node) => node.props.testID === 'stats-metric-tab-gaa')?.props.accessibilityState.selected,
      metric: findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.metric,
      leaderIDs: (findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.leaders ?? []).map((row: any) => row.playerId),
      tableIDs: (findNode(output, (node) => node.type === 'FlatList')?.props.data ?? []).map((row: any) => row.playerId),
      heading: findNodes(output, (node) => node.props.accessibilityRole === 'header').map(nodeText),
      pageText: nodeText(output),
    });
    const before = goalieState();
    assert.equal(before.metric, 'gaa');
    assert.equal(before.playerSelected, false);
    assert.equal(before.goalieSelected, true);
    assert.equal(before.metricSelected, true);
    assert.ok(before.heading.includes('Goalie Stats'));
    assert.match(before.pageText, /ranked by GAA \(lowest first\)/);

    retainedGoalsCallback();
    output = result.h.render();
    assert.deepEqual(goalieState(), before);
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals'), undefined);
  });

  it('keeps normal Stats surfaces translucent and makes every control and ranked-row surface opaque under Reduced Transparency', async () => {
    const players = rankedPlayers();
    const normal = runtime(320, 1.8, { payload: payloadWith(players), reduceTransparency: false });
    const normalOutput = await settle(normal);
    const normalTimeline = findNode(normalOutput, (node) => node.props.testID === 'stats-timeline-open')!;
    const normalRoleGroup = findNode(normalOutput, (node) => node.props.testID === 'stats-role-toggle')!;
    const normalSelectedMetric = findNode(normalOutput, (node) => node.props.testID === 'stats-metric-tab-points')!;
    const normalTopRow = findNode(normalOutput, (node) => node.props.testID === 'stats-ranked-row-d')!;
    assert.equal(flattenStyle(normalTimeline.props.style({ pressed: false })).backgroundColor, '#1C2A42');
    assert.ok(alpha(flattenStyle(normalRoleGroup.props.style).backgroundColor) < 1);
    assert.ok(alpha(flattenStyle(normalSelectedMetric.props.style({ pressed: false })).backgroundColor) < 1);
    assert.ok(alpha(flattenStyle(normalTopRow.props.style({ pressed: false })).backgroundColor) < 1);
    assert.equal(flattenStyle(normalTimeline.props.style({ pressed: true })).opacity, 0.7,
      'ordinary SelectableControl callers retain the existing translucent pressed feedback');

    const reducedPayload = {
      ...payloadWith(players),
      seasons: [
        ...currentPayload.seasons,
        { id: 'season-b', name: 'Winter 2025', status: 'completed', startDate: '2025-11-01' },
      ],
    };
    const reduced = runtime(320, 1.8, { payload: reducedPayload, reduceTransparency: true });
    let output = await settle(reduced);
    findNode(output, (node) => node.props.testID === 'stats-timeline-open')!.props.onPress();
    output = reduced.h.render();
    findNode(output, (node) => node.props.testID === 'stats-timeline-mode-multiple')!.props.onPress();
    output = reduced.h.render();

    const surfaces: Array<[string, any]> = [
      ['timeline opener', findNode(output, (node) => node.props.testID === 'stats-timeline-open')!],
      ['selected role', findNode(output, (node) => node.props.testID === 'stats-role-option-player')!],
      ['inactive role', findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')!],
      ['selected metric', findNode(output, (node) => node.props.testID === 'stats-metric-tab-points')!],
      ['inactive metric', findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals')!],
      ['selected timeline mode', findNode(output, (node) => node.props.testID === 'stats-timeline-mode-multiple')!],
      ['inactive timeline mode', findNode(output, (node) => node.props.testID === 'stats-timeline-mode-current')!],
      ['selected season', findNode(output, (node) => node.props.accessibilityLabel === 'Fall 2026, current season')!],
      ['inactive season', findNode(output, (node) => node.props.accessibilityLabel === 'Winter 2025, past season')!],
      ['top-three complete row', findNode(output, (node) => node.props.testID === 'stats-ranked-row-d')!],
      ['ordinary complete row', findNode(output, (node) => node.props.testID === 'stats-ranked-row-e')!],
    ];
    assert.equal(alpha(flattenStyle(findNode(output, (node) => node.props.testID === 'stats-role-toggle')!.props.style).backgroundColor), 1);
    for (const [label, node] of surfaces) {
      const resting = flattenStyle(node.props.style({ pressed: false }));
      const pressed = flattenStyle(node.props.style({ pressed: true }));
      assert.equal(pressed.opacity ?? 1, 1, `${label} keeps computed opacity 1 while pressed`);
      assert.equal(alpha(pressed.backgroundColor), 1, `${label} keeps an opaque pressed background`);
      assert.ok(
        pressed.backgroundColor !== resting.backgroundColor || pressed.borderColor !== resting.borderColor,
        `${label} preserves press feedback with an opaque color or border change`,
      );
    }
    assert.notEqual(
      flattenStyle(findNode(output, (node) => node.props.testID === 'stats-role-option-player')!.props.style({ pressed: false })).backgroundColor,
      flattenStyle(findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')!.props.style({ pressed: false })).backgroundColor,
      'selected and inactive role options remain visibly distinct in opaque mode',
    );
    assert.notEqual(
      flattenStyle(findNode(output, (node) => node.props.testID === 'stats-metric-tab-points')!.props.style({ pressed: false })).backgroundColor,
      flattenStyle(findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals')!.props.style({ pressed: false })).backgroundColor,
      'selected and inactive metric options remain visibly distinct in opaque mode',
    );
  });

  it('makes the all-time notice and every seasonal division state opaque only under Reduced Transparency', async () => {
    const divisions = [{ id: 'division-a', name: 'Atlantic' }, { id: 'division-b', name: 'Pacific' }];
    const inspectDivisionStates = async (reduceTransparency: boolean) => {
      const result = runtime(320, 1.8, {
        payload: payloadWith(rankedPlayers()),
        activeDivision: divisions[0],
        divisions,
        reduceTransparency,
      });
      const output = await settle(result);
      const selected = findNode(output, (node) => node.props.testID === 'division-filter-division-a')!;
      const inactive = findNode(output, (node) => node.props.testID === 'division-filter-division-b')!;
      return {
        selectedRest: flattenStyle(selected.props.style({ pressed: false })),
        selectedPressed: flattenStyle(selected.props.style({ pressed: true })),
        inactiveRest: flattenStyle(inactive.props.style({ pressed: false })),
        inactivePressed: flattenStyle(inactive.props.style({ pressed: true })),
      };
    };
    const openAllTime = async (reduceTransparency: boolean) => {
      const result = runtime(320, 1.8, {
        payload: payloadWith(rankedPlayers()),
        activeDivision: divisions[0],
        divisions,
        reduceTransparency,
      });
      let output = await settle(result);
      findNode(output, (node) => node.props.testID === 'stats-timeline-open')!.props.onPress();
      output = result.h.render();
      findNode(output, (node) => node.props.testID === 'stats-timeline-mode-all')!.props.onPress();
      output = result.h.render();
      findNode(output, (node) => node.props.accessibilityLabel === 'Apply timeline')!.props.onPress();
      output = await settle(result);
      return flattenStyle(findNode(output, (node) => node.props.testID === 'stats-all-time-league-wide')!.props.style);
    };

    const normal = await inspectDivisionStates(false);
    assert.ok(alpha(normal.selectedRest.backgroundColor) < 1, 'ordinary selected DivisionFilter keeps its translucent default');
    assert.equal(normal.inactiveRest.backgroundColor, '#1C2A42', 'ordinary inactive DivisionFilter keeps its existing default background');
    assert.equal(normal.selectedPressed.opacity, 0.7, 'ordinary selected DivisionFilter keeps default pressed opacity');
    assert.equal(normal.inactivePressed.opacity, 0.7, 'ordinary inactive DivisionFilter keeps default pressed opacity');
    assert.ok(alpha((await openAllTime(false)).backgroundColor) < 1, 'ordinary all-time notice stays translucent');

    const reduced = await inspectDivisionStates(true);
    for (const [label, style] of Object.entries(reduced)) {
      assert.equal(style.opacity ?? 1, 1, `${label} keeps computed opacity 1`);
      assert.equal(alpha(style.backgroundColor), 1, `${label} has an opaque computed background`);
    }
    assert.notEqual(reduced.selectedRest.backgroundColor, reduced.inactiveRest.backgroundColor,
      'opaque selected and inactive division states remain visibly distinct');
    assert.ok(
      reduced.selectedPressed.backgroundColor !== reduced.selectedRest.backgroundColor
        || reduced.selectedPressed.borderColor !== reduced.selectedRest.borderColor,
      'opaque selected division preserves pressed feedback',
    );
    assert.ok(
      reduced.inactivePressed.backgroundColor !== reduced.inactiveRest.backgroundColor
        || reduced.inactivePressed.borderColor !== reduced.inactiveRest.borderColor,
      'opaque inactive division preserves pressed feedback',
    );
    const reducedNotice = await openAllTime(true);
    assert.equal(reducedNotice.opacity ?? 1, 1);
    assert.equal(alpha(reducedNotice.backgroundColor), 1, 'Reduced Transparency all-time notice has an opaque computed background');
  });

  it('offers only valid role metrics and applies one authoritative selection to League Leaders', async () => {
    const result = runtime();
    let output = await settle(result);
    const metricIDs = () => findNodes(output, (node) => /^stats-metric-tab-(goals|assists|points|gaa)$/.test(String(node.props.testID ?? '')))
      .map((node) => node.props.testID);

    assert.deepEqual(metricIDs(), ['stats-metric-tab-goals', 'stats-metric-tab-assists', 'stats-metric-tab-points']);
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-points')?.props.accessibilityState.selected, true);
    assert.equal(findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.metric, 'points');

    findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals')?.props.onPress();
    output = result.h.render();
    assert.equal(findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.metric, 'goals');

    findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')?.props.onPress();
    output = result.h.render();
    assert.deepEqual(metricIDs(), ['stats-metric-tab-gaa']);
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-gaa')?.props.accessibilityState.selected, true);
    assert.equal(findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.metric, 'gaa');

    findNode(output, (node) => node.props.testID === 'stats-role-option-player')?.props.onPress();
    output = result.h.render();
    assert.deepEqual(metricIDs(), ['stats-metric-tab-goals', 'stats-metric-tab-assists', 'stats-metric-tab-points']);
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-points')?.props.accessibilityState.selected, true);
    assert.equal(findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.metric, 'points');
  });
});

describe('unified Stats ranked section', () => {
  it('uses the authoritative metric for the complete ranked table, dynamic heading, goalie GAA, and player-card actions', async () => {
    const players = rankedPlayers();
    const result = runtime(390, 1, { payload: payloadWith(players) });
    let output = await settle(result);
    const dataIDs = () => (findNode(output, (node) => node.type === 'FlatList')?.props.data ?? []).map((row: any) => row.playerId);
    const leaderIDs = () => (findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.leaders ?? []).map((row: any) => row.playerId);

    assert.ok(findNodes(output, (node) => node.props.accessibilityRole === 'header').some((node) => nodeText(node) === 'Player Stats'));
    assert.deepEqual(dataIDs(), ['d', 'c', 'a', 'g', 'b', 'e', 'f']);
    assert.deepEqual(leaderIDs(), dataIDs().slice(0, 5));
    assert.equal(findNode(output, (node) => node.type === 'StatsTableHeader'), undefined);
    assert.doesNotMatch(nodeText(output), /Swipe metrics/i);

    findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals')?.props.onPress();
    output = result.h.render();
    assert.deepEqual(dataIDs(), ['b', 'd', 'e', 'c', 'f', 'a']);
    assert.deepEqual(leaderIDs(), dataIDs().slice(0, 5));
    const playerRow = findNode(output, (node) => node.props.testID === 'stats-ranked-row-b');
    assert.match(playerRow?.props.accessibilityLabel ?? '', /Rank 1.*Beta Blue.*Team B.*8 goals.*Open player card/i);
    playerRow?.props.onPress();
    assert.deepEqual(result.navigationCalls.at(-1)?.[2], { playerId: 'b', leagueId: 'league-a' });

    findNode(output, (node) => node.props.testID === 'stats-role-option-goalie')?.props.onPress();
    output = result.h.render();
    assert.ok(findNodes(output, (node) => node.props.accessibilityRole === 'header').some((node) => nodeText(node) === 'Goalie Stats'));
    assert.deepEqual(dataIDs(), ['g', 'c', 'b', 'a', 'd', 'e', 'f']);
    assert.deepEqual(leaderIDs(), dataIDs().slice(0, 5));
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-goals'), undefined);
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-metric-tab-gaa')?.props.accessibilityState.selected, true);
    assert.match(findNode(output, (node) => node.props.testID === 'stats-ranked-row-g')?.props.accessibilityLabel ?? '', /0\.5 GAA/i);
  });

  it('applies timeline and division scope to both League Leaders and the complete ranked population', async () => {
    const currentPlayers = rankedPlayers().slice(0, 2);
    const allPlayers = rankedPlayers().map((player) => ({ ...player, playerId: `all-${player.playerId}`, playerName: `All ${player.playerName}` }));
    const division = { id: 'division-a', name: 'Division A' };
    const result = runtime(390, 1, {
      activeDivision: division,
      getScope: async (_slug, _leagueId, selection) => selection.kind === 'all'
        ? { ...payloadWith(allPlayers, 'All time'), scope: { ...currentPayload.scope, kind: 'all', label: 'All time' } }
        : payloadWith(currentPlayers),
    });
    let output = await settle(result);

    assert.deepEqual(result.scopeCalls[0].slice(2, 4), [{ kind: 'current' }, division.id]);
    assert.deepEqual((findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.leaders ?? []).map((row: any) => row.playerId), ['a', 'b']);
    assert.deepEqual((findNode(output, (node) => node.type === 'FlatList')?.props.data ?? []).map((row: any) => row.playerId), ['a', 'b']);
    assert.ok(findNode(output, (node) => node.props.accessibilityLabel === 'Division filter'));

    findNode(output, (node) => node.props.testID === 'stats-timeline-open')?.props.onPress();
    output = result.h.render();
    findNode(output, (node) => node.props.testID === 'stats-timeline-mode-all')?.props.onPress();
    output = result.h.render();
    findNode(output, (node) => node.props.accessibilityLabel === 'Apply timeline')?.props.onPress();
    output = await settle(result);

    assert.deepEqual(result.scopeCalls.at(-1)?.slice(2, 4), [{ kind: 'all' }, null]);
    const allRankedIDs = (findNode(output, (node) => node.type === 'FlatList')?.props.data ?? []).map((row: any) => row.playerId);
    assert.equal(allRankedIDs.length, allPlayers.length);
    assert.ok(allRankedIDs.every((id: string) => id.startsWith('all-')));
    assert.deepEqual((findNode(output, (node) => node.type === 'StatsLeadersCard')?.props.leaders ?? []).map((row: any) => row.playerId), allRankedIDs.slice(0, 5));
    assert.equal(findNode(output, (node) => node.props.testID === 'stats-timeline-open')?.props.accessibilityLabel, 'Open timeline filter. All time');
    assert.equal(findNode(output, (node) => node.props.accessibilityLabel === 'Division filter'), undefined);
    assert.ok(findNode(output, (node) => node.props.testID === 'stats-all-time-league-wide'));
  });
});
