/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGoalieRows, buildSkaterRows, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const metric = (value: number | null, state: PublicStatMetric['state'], sources: PublicStatMetric['sources']): PublicStatMetric => ({ value, state, sources });

function allNodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((node) => allNodes(node, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...allNodes(root.props.children, predicate)];
}

type ScrollCall = { id: string; x: number; animated: boolean };

function native(width: number, scrollCalls: ScrollCall[] = []) {
  return {
    Modal: (props: any) => createElement('Modal', props, props.children),
    Pressable: 'Pressable', Text: 'Text', View: 'View',
    ScrollView: (props: any) => {
      if (props.ref) props.ref.current = { scrollTo: (options: { x: number; animated: boolean }) => scrollCalls.push({ id: props.testID, ...options }) };
      return createElement('ScrollView', props, props.children);
    },
    useWindowDimensions: () => ({ width, height: 740, scale: 1, fontScale: 1.8 }),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
  };
}

function tableRuntime(kind: 'skater' | 'goalie' = 'skater', width = 320, options: { expandedMetrics?: boolean; initialSync?: any; goalieMetrics?: StatsScopePlayer['goalie'] } = {}) {
  const h = createHookHarness();
  const offsets: Array<{ sourceId: string; offset: number }> = [];
  const scrollCalls: ScrollCall[] = [];
  const Table = compileCommonJs<any>(new URL('../../src/components/StatsTable.tsx', import.meta.url), {
    react: h.react,
    'react-native': native(width, scrollCalls),
    './Avatar': (props: any) => createElement('Avatar', props),
    './TeamLogo': (props: any) => createElement('TeamLogo', props),
  });
  const player: StatsScopePlayer = {
    playerId: 'player-a', playerName: 'Avery Longsurname', avatarUrl: null,
    displayTeam: { id: 'team-a', name: 'Owls', logoUrl: null },
    skater: {
      gamesPlayed: metric(4, 'reported', ['imported']),
      goals: metric(2, 'estimated', ['roster_window']),
      assists: metric(1, 'recorded', ['skater_stats']),
      points: metric(null, 'conflicted', ['skater_stats']),
      championships: metric(null, 'unknown', []),
    },
    goalie: options.goalieMetrics ?? {
      gamesPlayed: metric(4, 'reported', ['imported']),
      goalsAgainst: metric(2, 'estimated', ['roster_window']),
      goalsAgainstAverage: metric(0.5, 'estimated', ['roster_window', 'goalie_stats']),
      championships: metric(null, 'conflicted', ['player_badges']),
    },
  };
  const rows = { goalie: buildGoalieRows([player])[0], skater: buildSkaterRows([player])[0] };
  let currentKind = kind;
  let replaceSync: ((next: any) => void) | null = null;
  let currentSync: any = options.initialSync ?? { offset: 0, revision: 0, sourceId: null };
  function Root() {
    const [horizontalSync, setHorizontalSync] = h.react.useState(options.initialSync ?? { offset: 0, revision: 0, sourceId: null });
    currentSync = horizontalSync;
    replaceSync = setHorizontalSync;
    const onHorizontalOffset = (sourceId: string, offset: number) => {
      offsets.push({ sourceId, offset });
      setHorizontalSync((current: any) => ({ offset, revision: current.revision + 1, sourceId }));
    };
    return createElement('Fragment', null,
      Table.StatsTableHeader({ kind: currentKind, syncId: 'header', horizontalSync, onHorizontalOffset, expandedMetrics: options.expandedMetrics }),
      Table.StatsTableRowView({ kind: currentKind, syncId: 'row-player-a', row: rows[currentKind], last: true, horizontalSync, onHorizontalOffset, expandedMetrics: options.expandedMetrics, onOpenPlayer() {} }),
    );
  }
  h.mount(Root);
  return {
    h, offsets, scrollCalls, Table,
    replaceTable(nextKind: 'skater' | 'goalie', nextSync: any) {
      currentKind = nextKind;
      replaceSync!(nextSync);
      h.render();
    },
    get currentSync() { return currentSync; },
  };
}

describe('Stats table responsive accessibility', () => {
  it('labels every metric with its column and truthful provenance at enlarged text', () => {
    const { h } = tableRuntime();
    const expected = {
      gp: /GP, 4.*Reported from imported records/i,
      g: /G, ~2.*Estimated from roster eligibility/i,
      a: /A, 1.*Recorded from game statistics/i,
      pts: /PTS, unavailable.*Conflicting records need review/i,
      ch: /CH, unavailable.*Not recorded/i,
      gpg: /GPG, ~0\.50.*Estimated from roster eligibility/i,
      ppg: /PPG, unavailable.*Conflicting source metrics need review/i,
    };
    for (const [key, label] of Object.entries(expected)) {
      const cell = findNode(h.output, (node) => node.props.testID === `stats-metric-player-a-${key}`);
      assert.ok(cell, `missing ${key} cell`);
      assert.match(cell.props.accessibilityLabel, label);
      assert.notEqual(cell.props.allowFontScaling, false);
      assert.equal(cell.props.maxFontSizeMultiplier, 1.4);
    }
    assert.match(findNode(h.output, (node) => node.props.accessibilityRole === 'summary')?.props.accessibilityLabel ?? '', /Skater statistics table.*GP.*PPG/i);
    assert.equal(nodeText(findNode(h.output, (node) => node.props.testID === 'stats-metric-player-a-pts')), 'Review');
  });

  it('fits every goalie metric at 320 and 390 points and keeps skater metrics scrollable', () => {
    const { Table } = tableRuntime();
    for (const width of [320, 390]) {
      const goalie = Table.getStatsTableLayout('goalie', width, false);
      assert.equal(goalie.identityWidth + goalie.metricPaneWidth, goalie.contentWidth);
      assert.ok(goalie.metricCellWidth >= 35, `goalie metric width ${goalie.metricCellWidth} at ${width}`);
      const skater = Table.getStatsTableLayout('skater', width, false);
      assert.equal(skater.identityWidth + skater.availableMetricsWidth, skater.contentWidth);
      assert.ok(skater.metricPaneWidth > skater.availableMetricsWidth);
    }
    const skaterRuntime = tableRuntime('skater');
    const skaterScroll = findNode(skaterRuntime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    skaterScroll.props.onScrollBeginDrag({ timeStamp: 100, nativeEvent: { contentOffset: { x: 0 } } });
    skaterScroll.props.onScroll({ timeStamp: 101, nativeEvent: { contentOffset: { x: 72 } } });
    skaterRuntime.h.render();
    assert.deepEqual(skaterRuntime.offsets, [{ sourceId: 'row-player-a', offset: 72 }]);
    assert.ok(skaterRuntime.scrollCalls.some((call) => call.id === 'header-metrics-scroll' && call.x === 72 && call.animated === false), 'the sibling metrics pane follows the dragged row');
    assert.equal(skaterScroll.props.scrollEnabled, true);
    const goalieRuntime = tableRuntime('goalie');
    assert.ok(allNodes(goalieRuntime.h.output, (node) => node.type === 'ScrollView').every((node) => node.props.scrollEnabled === false));
  });

  it('keeps the latest user-owned offset through rapid, delayed, and source-switching events', () => {
    const runtime = tableRuntime('skater');
    let rowScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    rowScroll.props.onScrollBeginDrag({ timeStamp: 100, nativeEvent: { contentOffset: { x: 0 } } });
    for (const [timeStamp, x] of [[101, 72], [102, 18], [103, 84]] as const) {
      rowScroll.props.onScroll({ timeStamp, nativeEvent: { contentOffset: { x } } });
    }
    rowScroll.props.onScrollEndDrag({ timeStamp: 104, nativeEvent: { contentOffset: { x: 84 } } });
    runtime.h.render();
    assert.deepEqual(runtime.offsets.map(({ offset }) => offset), [72, 18, 84]);

    const headerScroll = findNode(runtime.h.output, (node) => node.props.testID === 'header-metrics-scroll')!;
    headerScroll.props.onScroll({ timeStamp: 105, nativeEvent: { contentOffset: { x: 18 } } });
    headerScroll.props.onScroll({ timeStamp: 106, nativeEvent: { contentOffset: { x: 84 } } });
    assert.deepEqual(runtime.offsets.map(({ offset }) => offset), [72, 18, 84], 'programmatic/intermediate events never republish');

    headerScroll.props.onScrollBeginDrag({ timeStamp: 200, nativeEvent: { contentOffset: { x: 84 } } });
    headerScroll.props.onScroll({ timeStamp: 199, nativeEvent: { contentOffset: { x: 18 } } });
    headerScroll.props.onScroll({ timeStamp: 201, nativeEvent: { contentOffset: { x: 33 } } });
    headerScroll.props.onScrollEndDrag({ timeStamp: 202, nativeEvent: { contentOffset: { x: 33 } } });
    runtime.h.render();
    assert.deepEqual(runtime.offsets.at(-1), { sourceId: 'header', offset: 33 });
    assert.ok(runtime.scrollCalls.some((call) => call.id === 'row-player-a-metrics-scroll' && call.x === 33));

    rowScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    rowScroll.props.onScroll({ timeStamp: 203, nativeEvent: { contentOffset: { x: 84 } } });
    assert.deepEqual(runtime.offsets.at(-1), { sourceId: 'header', offset: 33 }, 'a delayed old command cannot reclaim ownership');
  });

  it('keeps an active drag and its momentum live across self-published revisions', () => {
    const runtime = tableRuntime('skater');
    let rowScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    rowScroll.props.onScrollBeginDrag({ timeStamp: 100, nativeEvent: { contentOffset: { x: 0 } } });
    rowScroll.props.onScroll({ timeStamp: 101, nativeEvent: { contentOffset: { x: 20 } } });
    runtime.h.render();

    rowScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    rowScroll.props.onScroll({ timeStamp: 102, nativeEvent: { contentOffset: { x: 35 } } });
    runtime.h.render();
    assert.deepEqual(runtime.offsets.map(({ offset }) => offset), [20, 35]);

    rowScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    rowScroll.props.onScrollEndDrag({ timeStamp: 103, nativeEvent: { contentOffset: { x: 35 } } });
    rowScroll.props.onMomentumScrollBegin();
    rowScroll.props.onScroll({ timeStamp: 104, nativeEvent: { contentOffset: { x: 50 } } });
    assert.deepEqual(runtime.offsets.map(({ offset }) => offset), [20, 35, 50]);
  });

  it('revokes stale ownership across a kind and revision A to B to A reset', () => {
    const runtime = tableRuntime('skater', 320, { initialSync: { offset: 11, revision: 7, sourceId: null } });
    const oldScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    oldScroll.props.onScrollBeginDrag({ timeStamp: 100, nativeEvent: { contentOffset: { x: 11 } } });

    runtime.replaceTable('goalie', { offset: 22, revision: 8, sourceId: 'header' });
    runtime.replaceTable('skater', { offset: 47, revision: 7, sourceId: 'header' });
    runtime.scrollCalls.length = 0;

    oldScroll.props.onScroll({ timeStamp: 101, nativeEvent: { contentOffset: { x: 88 } } });
    assert.deepEqual(runtime.offsets, [], 'the delayed old scroll callback cannot publish its offset');
    assert.deepEqual(runtime.currentSync, { offset: 47, revision: 7, sourceId: 'header' });
    assert.deepEqual(runtime.scrollCalls.at(-1), { id: 'row-player-a-metrics-scroll', x: 47, animated: false }, 'the stale callback restores the latest shared offset');

    runtime.scrollCalls.length = 0;
    oldScroll.props.onScrollBeginDrag({ timeStamp: 102, nativeEvent: { contentOffset: { x: 91 } } });
    oldScroll.props.onScroll({ timeStamp: 103, nativeEvent: { contentOffset: { x: 93 } } });
    assert.deepEqual(runtime.offsets, [], 'a stale begin-drag callback cannot reacquire ownership');
    assert.deepEqual(runtime.currentSync, { offset: 47, revision: 7, sourceId: 'header' });
    assert.ok(runtime.scrollCalls.every((call) => call.x === 47), 'stale handlers only restore from the latest sync ref');

    const currentScroll = findNode(runtime.h.output, (node) => node.props.testID === 'row-player-a-metrics-scroll')!;
    currentScroll.props.onScrollBeginDrag({ timeStamp: 200, nativeEvent: { contentOffset: { x: 47 } } });
    currentScroll.props.onScroll({ timeStamp: 201, nativeEvent: { contentOffset: { x: 63 } } });
    assert.deepEqual(runtime.offsets, [{ sourceId: 'row-player-a', offset: 63 }], 'the current generation remains live');
  });

  it('hydrates remounted panes from the latest revision even when their source id matches', () => {
    const runtime = tableRuntime('skater', 320, { initialSync: { offset: 47, revision: 9, sourceId: 'row-player-a' } });
    assert.ok(runtime.scrollCalls.some((call) => call.id === 'header-metrics-scroll' && call.x === 47));
    assert.ok(runtime.scrollCalls.some((call) => call.id === 'row-player-a-metrics-scroll' && call.x === 47));
    assert.deepEqual(runtime.offsets, []);
  });

  it('switches exceptional goalie values to an explicit truthful scrolling layout', () => {
    const { Table } = tableRuntime();
    const longMetric = metric(10_000_000, 'estimated', ['goalie_stats']);
    const rows = [{ columns: [
      { display: '10000000', state: 'recorded' },
      { display: '10000000', state: 'recorded' },
      { display: '~10000000.00', state: 'estimated' },
      { display: 'Review', state: 'conflicted' },
    ] }];
    assert.equal(Table.needsExpandedGoalieMetrics(rows), true);
    for (const width of [320, 390]) {
      const layout = Table.getStatsTableLayout('goalie', width, true);
      assert.equal(layout.metricCellWidth, 144);
      assert.ok(layout.metricPaneWidth > layout.availableMetricsWidth);
    }
    const runtime = tableRuntime('goalie', 320, { expandedMetrics: true, goalieMetrics: {
      gamesPlayed: metric(10_000_000, 'recorded', ['goalie_stats']),
      goalsAgainst: metric(10_000_000, 'recorded', ['goalie_stats']),
      goalsAgainstAverage: longMetric,
      championships: metric(null, 'conflicted', ['player_badges']),
    } });
    const cells = allNodes(runtime.h.output, (node) => String(node.props.testID ?? '').startsWith('stats-metric-'));
    assert.deepEqual(cells.map(nodeText), ['10000000', '10000000', '~10000000.00', 'Review']);
    assert.ok(cells.every((cell) => flattenStyle(cell.props.style).width === 144));
    assert.ok(cells.every((cell) => cell.props.numberOfLines === undefined));
    assert.ok(allNodes(runtime.h.output, (node) => node.type === 'ScrollView').every((node) => node.props.scrollEnabled === true));
  });

  it('uses adaptive row minimums and genuinely translucent panes', () => {
    const { h } = tableRuntime();
    const row = findNode(h.output, (node) => node.props.testID === 'stats-table-row-player-a');
    const rowStyle = flattenStyle(row?.props.style);
    assert.equal(rowStyle.height, undefined);
    assert.equal(rowStyle.minHeight, 68);
    const identity = findNode(row, (node) => node.type === 'Pressable');
    const identityStyle = flattenStyle(identity?.props.style({ pressed: false }));
    assert.equal(identityStyle.height, undefined);
    assert.equal(identityStyle.minHeight, 68);
    assert.match(String(identityStyle.backgroundColor), /rgba\([^)]*,0\.2\)/);
    assert.deepEqual(identity?.props.children.map((child: any) => child.type), ['Text', 'Avatar', 'View', 'TeamLogo']);
    assert.equal(nodeText(identity?.props.children[2]), 'AveryLongsurname');
  });
});

describe('Stats timeline modal behavior', () => {
  it('opens as a modal, explains league-wide All time, and applies that selection', () => {
    const h = createHookHarness();
    const applied: any[] = [];
    const Timeline = compileCommonJs<any>(new URL('../../src/components/StatsTimelineFilter.tsx', import.meta.url), {
      react: h.react,
      'react-native': native(320),
      '@expo/vector-icons': { Ionicons: 'Icon' },
    }).default;
    h.mount(() => Timeline({
      label: 'Current season', currentSeasonId: 'season-a',
      seasons: [{ id: 'season-a', name: 'Fall 2026', status: 'active', startDate: '2026-09-01' }],
      selection: { kind: 'current' }, onApply: (selection: any) => applied.push(selection),
    }));
    findNode(h.output, (node) => node.props.testID === 'stats-timeline-open')!.props.onPress(); h.render();
    assert.equal(findNode(h.output, (node) => node.props.testID === 'stats-timeline-modal')?.props.visible, true);
    findNode(h.output, (node) => node.props.testID === 'stats-timeline-mode-all')!.props.onPress(); h.render();
    const explanation = findNode(h.output, (node) => node.props.testID === 'stats-timeline-all-explanation');
    assert.match(nodeText(explanation), /league-wide.*division filters are unavailable/i);
    assert.equal(findNode(h.output, (node) => node.props.accessibilityLabel === 'Timeline filter dialog')?.props.accessibilityViewIsModal, true);
    findNode(h.output, (node) => node.props.accessibilityLabel === 'Apply timeline')!.props.onPress(); h.render();
    assert.deepEqual(applied, [{ kind: 'all' }]);
    assert.equal(findNode(h.output, (node) => node.props.testID === 'stats-timeline-modal')?.props.visible, false);
  });

  it('keeps the approved mode order and closes from the backdrop without applying a draft', () => {
    const h = createHookHarness();
    const applied: any[] = [];
    const Timeline = compileCommonJs<any>(new URL('../../src/components/StatsTimelineFilter.tsx', import.meta.url), {
      react: h.react,
      'react-native': native(390),
      '@expo/vector-icons': { Ionicons: 'Icon' },
    }).default;
    h.mount(() => Timeline({
      label: 'Current season', currentSeasonId: 'season-a',
      seasons: [{ id: 'season-a', name: 'Fall 2026', status: 'active', startDate: '2026-09-01' }],
      selection: { kind: 'current' }, onApply: (selection: any) => applied.push(selection),
    }));
    findNode(h.output, (node) => node.props.testID === 'stats-timeline-open')!.props.onPress(); h.render();
    const modes = allNodes(h.output, (node) => String(node.props.testID ?? '').startsWith('stats-timeline-mode-'));
    assert.deepEqual(modes.map((node) => nodeText(node)), ['Current', 'All time', 'Single', 'Multiple']);
    findNode(h.output, (node) => node.props.testID === 'stats-timeline-mode-multiple')!.props.onPress(); h.render();
    findNode(h.output, (node) => node.props.testID === 'stats-timeline-backdrop')!.props.onPress(); h.render();
    assert.deepEqual(applied, []);
    assert.equal(findNode(h.output, (node) => node.props.testID === 'stats-timeline-modal')?.props.visible, false);
  });
});
