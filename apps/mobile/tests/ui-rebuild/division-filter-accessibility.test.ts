import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle } from './component-harness.ts';

describe('DivisionFilter accessibility', () => {
  it('exposes truthful selected radios with 44pt targets', () => {
    const selected: Array<string | null> = [];
    const harness = createHookHarness();
    const Filter = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/DivisionFilter.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value },
        },
        '../theme/colors': { default: {
          primary: '#8B5CF6', primaryLight: '#A78BFA', bgInteractive: '#222', textPrimary: '#fff', textSecondary: '#aaa', borderCard: '#444', glassStrokeStrong: '#666',
        } },
      },
    ).default;
    const divisions = [{ id: 'east', name: 'East' }, { id: 'west', name: 'West' }];
    harness.mount(() => Filter({
      divisions,
      activeDivision: divisions[0],
      primaryColor: '#00ffff',
      onSelect: (division: { id: string } | null) => selected.push(division?.id ?? null),
    }));
    const all = findNode(harness.output, (node) => node.props.testID === 'division-filter-all')!;
    const east = findNode(harness.output, (node) => node.props.testID === 'division-filter-east')!;
    assert.equal(all.props.accessibilityRole, 'radio');
    assert.equal(all.props.accessibilityLabel, 'All divisions');
    assert.deepEqual(all.props.accessibilityState, { selected: false, disabled: false, checked: false });
    assert.deepEqual(east.props.accessibilityState, { selected: true, disabled: false, checked: true });
    const eastStyle = typeof east.props.style === 'function' ? east.props.style({ pressed: false, focused: false }) : east.props.style;
    assert.ok(flattenStyle(eastStyle).minHeight >= 44);
    all.props.onPress();
    assert.deepEqual(selected, [null]);
  });
});
