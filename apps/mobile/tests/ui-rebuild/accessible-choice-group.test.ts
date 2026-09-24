import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle } from './component-harness.ts';

describe('AccessibleChoiceGroup', () => {
  it('exposes a named radio group with labelled, selected, 44-point choices', () => {
    const selections: string[] = [];
    const ChoiceGroup = compileCommonJs<{
      default: (props: Record<string, unknown>) => unknown;
    }>(new URL('../../src/components/AccessibleChoiceGroup.tsx', import.meta.url), {
      react: { createElement },
      'react-native': {
        Pressable: 'Pressable', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '../theme/colors': { default: { primary: '#0ff', textSecondary: '#aaa', borderCard: '#333', bgInteractive: '#222' } },
      '../theme/ui': { ui: { minTouchTarget: 44 } },
    }).default;

    const output = ChoiceGroup({
      accessibilityLabel: 'Goalie compensation',
      options: [
        { value: 'Free', label: 'Free' },
        { value: 'Paid', label: 'Paid' },
      ],
      selectedValue: 'Free',
      onSelect: (value: string) => selections.push(value),
    });

    const group = findNode(output, (node) => node.props.accessibilityRole === 'radiogroup');
    assert.ok(group);
    assert.equal(group.props.accessibilityLabel, 'Goalie compensation');

    const free = findNode(group, (node) => node.props.accessibilityLabel === 'Free');
    const paid = findNode(group, (node) => node.props.accessibilityLabel === 'Paid');
    assert.ok(free);
    assert.ok(paid);
    assert.equal(free.props.accessibilityRole, 'radio');
    assert.equal(paid.props.accessibilityRole, 'radio');
    assert.deepEqual(free.props.accessibilityState, { selected: true });
    assert.deepEqual(paid.props.accessibilityState, { selected: false });
    assert.ok(Number(flattenStyle(free.props.style).minHeight) >= 44);
    assert.ok(Number(flattenStyle(paid.props.style).minHeight) >= 44);

    paid.props.onPress();
    assert.deepEqual(selections, ['Paid']);
  });
});
