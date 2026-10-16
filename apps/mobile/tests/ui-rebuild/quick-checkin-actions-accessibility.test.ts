import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, flattenStyle, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

describe('QuickCheckinActions accessibility', () => {
  it('keeps compact choices at least 44pt with truthful radio state', () => {
    const harness = createHookHarness();
    const QuickCheckinActions = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/QuickCheckinActions.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Pressable: 'Pressable', ScrollView: 'ScrollView',
          StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View',
        },
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        '../theme/colors': { default: {
          primary: '#8B5CF6', primaryLight: '#A78BFA', accentGreen: '#0f0', accentRed: '#f00', textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#111', borderCard: '#333', glassStrokeStrong: '#555',
        } },
      },
    ).default;

    harness.mount(() => QuickCheckinActions({ value: 'confirmed', onChange: () => undefined, disabled: true, compact: true }));
    const buttons = allNodes(harness.output).filter((node) => node.type === 'Pressable');
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityLabel), ['Check in: In', 'Check in: Maybe', 'Check in: Out']);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityRole), ['radio', 'radio', 'radio']);
    assert.deepEqual(buttons.map((button) => button.props.accessibilityState), [
      { selected: true, disabled: true, checked: true },
      { selected: false, disabled: true, checked: false },
      { selected: false, disabled: true, checked: false },
    ]);
    for (const button of buttons) {
      const style = typeof button.props.style === 'function' ? button.props.style({ pressed: false, focused: false }) : button.props.style;
      assert.ok(flattenStyle(style).minHeight >= 44);
    }
  });

  it('keeps Beer Guy outside the attendance radiogroup as an independent checkbox', () => {
    const harness = createHookHarness();
    const QuickCheckinActions = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/QuickCheckinActions.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Pressable: 'Pressable', ScrollView: 'ScrollView',
          StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View',
        },
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        '../theme/colors': { default: {
          primary: '#8B5CF6', primaryLight: '#A78BFA', brandGold: '#fc0', accentGreen: '#0f0', accentRed: '#f00', textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#111', borderCard: '#333', glassStrokeStrong: '#555',
        } },
      },
    ).default;

    harness.mount(() => QuickCheckinActions({
      value: null,
      onChange: () => undefined,
      beerGuy: {
        assignment: null,
        currentUserId: '40000000-0000-4000-8000-000000000011',
        callerEligible: true,
        loading: false,
        busy: false,
        error: null,
        onToggle: () => undefined,
      },
    }));

    const radios = allNodes(harness.output).filter((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'radio');
    const beer = allNodes(harness.output).filter((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'checkbox');
    const radioGroup = allNodes(harness.output).find((node) => node.props.accessibilityRole === 'radiogroup')!;
    assert.equal(radios.length, 3);
    assert.equal(beer.length, 1);
    assert.equal(allNodes(radioGroup).filter((node) => node.props.accessibilityRole === 'checkbox').length, 0);
  });
});
