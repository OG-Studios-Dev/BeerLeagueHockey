import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle } from './component-harness.ts';

describe('AccessibleChoiceGroup', () => {
  it('exposes a named radio group with labelled, selected, 44-point choices', () => {
    const selections: string[] = [];
    const harness = createHookHarness();
    const ChoiceGroup = compileCommonJs<{
      default: (props: Record<string, unknown>) => unknown;
    }>(new URL('../../src/components/AccessibleChoiceGroup.tsx', import.meta.url), {
      react: harness.react,
      'react-native': {
        Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', glassStrokeStrong: '#333', bgInteractive: '#222' } },
    }).default;

    harness.mount(() => ChoiceGroup({
      accessibilityLabel: 'Goalie compensation',
      options: [
        { value: 'Free', label: 'Free' },
        { value: 'Paid', label: 'Paid' },
      ],
      selectedValue: 'Free',
      onSelect: (value: string) => selections.push(value),
    }));
    const output = harness.output;

    const group = findNode(output, (node) => node.props.accessibilityRole === 'radiogroup');
    assert.ok(group);
    assert.equal(group.props.accessibilityLabel, 'Goalie compensation');

    const free = findNode(group, (node) => node.props.accessibilityLabel === 'Free');
    const paid = findNode(group, (node) => node.props.accessibilityLabel === 'Paid');
    assert.ok(free);
    assert.ok(paid);
    assert.equal(free.props.accessibilityRole, 'radio');
    assert.equal(paid.props.accessibilityRole, 'radio');
    assert.deepEqual(free.props.accessibilityState, { selected: true, disabled: false, checked: true });
    assert.deepEqual(paid.props.accessibilityState, { selected: false, disabled: false, checked: false });
    assert.ok(Number(flattenStyle(free.props.style({ pressed: false })).minHeight) >= 44);
    assert.ok(Number(flattenStyle(paid.props.style({ pressed: false })).minHeight) >= 44);

    paid.props.onPress();
    assert.deepEqual(selections, ['Paid']);
  });
});
