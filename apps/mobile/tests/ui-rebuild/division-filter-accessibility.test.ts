import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle } from './component-harness.ts';

describe('DivisionFilter accessibility', () => {
  it('exposes truthful selected buttons with 44pt targets', () => {
    const selected: Array<string | null> = [];
    const Filter = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/DivisionFilter.tsx', import.meta.url),
      {
        react: { createElement },
        'react-native': {
          Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value },
        },
        '../theme/colors': { default: { bgInteractive: '#222', textSecondary: '#aaa' } },
      },
    ).default;
    const divisions = [{ id: 'east', name: 'East' }, { id: 'west', name: 'West' }];
    const tree = Filter({
      divisions,
      activeDivision: divisions[0],
      primaryColor: '#00ffff',
      onSelect: (division: { id: string } | null) => selected.push(division?.id ?? null),
    });
    const all = findNode(tree, (node) => node.props.testID === 'division-filter-all')!;
    const east = findNode(tree, (node) => node.props.testID === 'division-filter-east')!;
    assert.equal(all.props.accessibilityRole, 'button');
    assert.equal(all.props.accessibilityLabel, 'All divisions');
    assert.deepEqual(all.props.accessibilityState, { selected: false });
    assert.deepEqual(east.props.accessibilityState, { selected: true });
    assert.ok(flattenStyle(east.props.style).minHeight >= 44);
    all.props.onPress();
    assert.deepEqual(selected, [null]);
  });
});
