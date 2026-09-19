import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, nodeText } from './component-harness.ts';

describe('CutIceTitle component', () => {
  it('renders only the compact uppercase title with no eyebrow or metadata slots', () => {
    const react = { createElement };
    const CutIceTitle = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/CutIceTitle.tsx', import.meta.url),
      {
        react,
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
        'react-native': { Pressable: 'Pressable', StyleSheet: { create: <T>(v: T) => v, hairlineWidth: 1, absoluteFill: {} }, Text: 'Text', View: 'View' },
        '../navigation/MobileShellDataContext': { useMobileShellData: () => ({ titleAccent: '#E8FF00' }) },
        './cutIceTitleModel': {
          resolveCutIcePalette: () => ({ source: '#E8FF00', readable: '#E8FF00', textContrast: 12 }),
          splitCutIceTitle: () => ({ base: 'Notification', accent: 'Settings' }),
        },
      },
    ).default;

    const tree = CutIceTitle({ title: 'Notification Settings' });
    assert.equal(nodeText(tree), 'NOTIFICATION SETTINGS');
    assert.ok(findNode(tree, (node) => node.props.testID === 'cut-ice-title'));
    assert.equal(findNode(tree, (node) => node.props.testID === 'cut-ice-eyebrow'), undefined);
    assert.equal(findNode(tree, (node) => node.props.testID === 'cut-ice-subtitle'), undefined);
  });
});
