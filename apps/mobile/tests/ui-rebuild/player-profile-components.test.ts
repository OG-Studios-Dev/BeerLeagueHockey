import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

function nativeMock() {
  return {
    Modal: ({ children, visible }: Record<string, unknown>) => visible ? createElement('Modal', {}, children) : null,
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  };
}

describe('player profile native controls', () => {
  it('switches career metrics and exposes every plotted value accessibly', () => {
    const harness = createHookHarness();
    const Chart = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/PlayerProfile/CareerTrendChart.tsx', import.meta.url),
      { react: harness.react, 'react-native': nativeMock(), '../../lib/playerPageModel': awaitModel() },
    ).default;
    harness.mount(() => Chart({
      isGoalie: false,
      accent: '#7026D9',
      rows: [
        { seasonId: 'one', seasonName: 'Spring', metrics: { goals: 4, assists: 2 } },
        { seasonId: 'two', seasonName: 'Summer', metrics: { goals: 7, assists: 5 } },
      ],
      hotFacts: ['Fixture player improved in Summer.'],
    }));
    const assists = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Show Assists career trend');
    assert.ok(assists);
    assists.props.onPress();
    harness.render();
    assert.match(nodeText(harness.output), /Assists: Spring 2, Summer 5/);
    assert.match(nodeText(harness.output), /Fixture player improved in Summer/);
  });

  it('opens one compact season picker and returns career or season identity', () => {
    const harness = createHookHarness();
    const selections: Array<string | null> = [];
    const Picker = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/PlayerProfile/SeasonPicker.tsx', import.meta.url),
      { react: harness.react, 'react-native': nativeMock(), 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }, '@expo/vector-icons': { Ionicons: () => null } },
    ).default;
    harness.mount(() => Picker({
      seasons: [{ id: 'season-one', name: 'Fall 2026' }], selectedSeasonId: 'season-one', isCareer: false,
      accent: '#7026D9', onSelect: (value: string | null) => selections.push(value),
    }));
    const trigger = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Change season, Fall 2026 selected');
    assert.ok(trigger);
    trigger.props.onPress();
    harness.render();
    const career = findNode(harness.output, (node) => node.props.accessibilityLabel === 'View Career Stats');
    assert.ok(career);
    career.props.onPress();
    assert.deepEqual(selections, [null]);
  });

  it('adds the physical bottom safe area to the existing modal sheet padding', () => {
    const sheetPadding = (bottom: number) => {
      const harness = createHookHarness();
      const Picker = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
        new URL('../../src/components/PlayerProfile/SeasonPicker.tsx', import.meta.url),
        {
          react: harness.react, 'react-native': nativeMock(),
          'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom, left: 0 }) },
          '@expo/vector-icons': { Ionicons: () => null },
        },
      ).default;
      harness.mount(() => Picker({ seasons: [], selectedSeasonId: null, isCareer: true, accent: '#7026D9', onSelect: () => undefined }));
      findNode(harness.output, (node) => node.props.accessibilityLabel === 'Change season, Career Stats selected')?.props.onPress();
      harness.render();
      const sheet = findNode(harness.output, (node) => node.props.testID === 'player-season-picker-sheet');
      assert.ok(sheet);
      return flattenStyle(sheet.props.style).paddingBottom;
    };
    assert.equal(sheetPadding(0), 18);
    assert.equal(sheetPadding(34), 52);
  });
});

function awaitModel() {
  return {
    getCareerMetricDefinitions: (goalie: boolean) => goalie
      ? [{ key: 'wins', label: 'Wins' }]
      : [{ key: 'goals', label: 'Goals' }, { key: 'assists', label: 'Assists' }],
    lineChartGeometry: (values: Array<number | null>) => ({
      points: values.flatMap((value, index) => value == null ? [] : [{ value, index, x: index * 100, y: 100 - value }]),
      minimum: 0, maximum: 10, linePath: '', areaPath: '',
    }),
  };
}
