import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle, nodeText } from './component-harness.ts';

function renderTitle(topInset: number, onBack?: () => void) {
  const react = { createElement };
  const CutIceTitle = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/CutIceTitle.tsx', import.meta.url),
    {
      react,
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'react-native': { Pressable: 'Pressable', StyleSheet: { create: <T>(v: T) => v, hairlineWidth: 1, absoluteFill: {} }, Text: 'Text', View: 'View' },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: topInset, right: 0, bottom: 0, left: 0 }) },
      '../navigation/MobileShellDataContext': { useMobileShellData: () => ({ titleAccent: '#E8FF00' }) },
      './cutIceTitleModel': {
        resolveCutIcePalette: () => ({ source: '#E8FF00', readable: '#E8FF00', textContrast: 12 }),
        splitCutIceTitle: () => ({ base: 'Notification', accent: 'Settings' }),
      },
    },
  ).default;

  return CutIceTitle({ title: 'Notification Settings', onBack });
}

describe('CutIceTitle component', () => {
  it('renders only the compact uppercase title with no eyebrow or metadata slots', () => {
    const tree = renderTitle(47);
    assert.equal(nodeText(tree), 'NOTIFICATION SETTINGS');
    assert.ok(findNode(tree, (node) => node.props.testID === 'cut-ice-title'));
    assert.equal(findNode(tree, (node) => node.props.testID === 'cut-ice-eyebrow'), undefined);
    assert.equal(findNode(tree, (node) => node.props.testID === 'cut-ice-subtitle'), undefined);
  });

  it('adds the provider top inset exactly once to the shared 62-point masthead', () => {
    for (const topInset of [0, 20, 47, 59]) {
      const tree = renderTitle(topInset);
      const frame = findNode(tree, (node) => node.props.testID === 'cut-ice-title');
      const style = flattenStyle(frame?.props.style);
      assert.equal(style.paddingTop, topInset, `top inset ${topInset}`);
      assert.equal(style.height, 62 + topInset, `top inset ${topInset}`);
    }
  });

  it('renders Back as an accessible 44 by 44 point control when supplied', () => {
    const tree = renderTitle(47, () => undefined);
    const back = findNode(tree, (node) => node.props.accessibilityLabel === 'Back');
    assert.equal(back?.props.accessibilityRole, 'button');
    assert.deepEqual({ width: flattenStyle(back?.props.style).width, height: flattenStyle(back?.props.style).height }, { width: 44, height: 44 });
  });
});
