import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, flattenStyle, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

describe('QuickCheckinActions accessibility', () => {
  it('keeps compact choices at least 44pt with truthful button state', () => {
    const QuickCheckinActions = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/QuickCheckinActions.tsx', import.meta.url),
      {
        react: { createElement },
        'react-native': {
          Pressable: 'Pressable',
          StyleSheet: { create: <T>(value: T) => value },
          Text: 'Text',
          View: 'View',
        },
        '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
        '../theme/colors': { default: { accentGreen: '#0f0', accentRed: '#f00', textSecondary: '#aaa', bgSurface: '#111', glassStroke: '#333' } },
      },
    ).default;

    const tree = QuickCheckinActions({ value: 'confirmed', onChange: () => undefined, disabled: true, compact: true });
    const buttons = allNodes(tree).filter((node) => node.type === 'Pressable');
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityLabel), ['Check in: In', 'Check in: Maybe', 'Check in: Out']);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityRole), ['button', 'button', 'button']);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityState), [
      { selected: true, disabled: true },
      { selected: false, disabled: true },
      { selected: false, disabled: true },
    ]);
    for (const button of buttons) {
      const style = typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style;
      assert.ok(flattenStyle(style).minHeight >= 44);
    }
  });
});
