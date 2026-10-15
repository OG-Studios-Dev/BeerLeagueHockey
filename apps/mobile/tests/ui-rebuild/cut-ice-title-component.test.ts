import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle, nodeText } from './component-harness.ts';

const measuredTitleWidthsAt29 = {
  'Captain Dashboard': 310.671875,
  'Notification Settings': 342.421875,
} as const;

function splitTitle(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const accent = words.pop() ?? '';
  return { base: words.join(' '), accent };
}

function renderTitle(topInset: number, onBack?: () => void, title = 'Notification Settings', viewportWidth = 390) {
  const react = { createElement };
  const CutIceTitle = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/CutIceTitle.tsx', import.meta.url),
    {
      react,
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'react-native': {
        Pressable: 'Pressable', StyleSheet: { create: <T>(v: T) => v, hairlineWidth: 1, absoluteFill: {} }, Text: 'Text', View: 'View',
        useWindowDimensions: () => ({ width: viewportWidth, height: 844 }),
      },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: topInset, right: 0, bottom: 0, left: 0 }) },
      '../navigation/MobileShellDataContext': { useMobileShellData: () => ({ titleAccent: '#E8FF00' }) },
      './cutIceTitleModel': {
        resolveCutIcePalette: () => ({ source: '#E8FF00', readable: '#E8FF00', textContrast: 12 }),
        splitCutIceTitle: splitTitle,
      },
    },
  ).default;

  return CutIceTitle({ title, onBack });
}

function availableTitleWidth(tree: unknown, viewportWidth: number) {
  const frame = findNode(tree, (node) => node.props.testID === 'cut-ice-title');
  const frameStyle = flattenStyle(frame?.props.style);
  const paddingLeft = Number(frameStyle.paddingLeft ?? frameStyle.paddingHorizontal ?? 0);
  const paddingRight = Number(frameStyle.paddingRight ?? frameStyle.paddingHorizontal ?? 0);
  const back = findNode(tree, (node) => node.props.accessibilityLabel === 'Back');
  const backStyle = flattenStyle(back?.props.style);
  const backFootprint = back
    ? Number(backStyle.width ?? 0) + Number(backStyle.marginLeft ?? 0) + Number(backStyle.marginRight ?? 0)
    : 0;
  return viewportWidth - paddingLeft - paddingRight - backFootprint;
}

function minimumRenderedTitleWidth(tree: unknown, title: keyof typeof measuredTitleWidthsAt29, fontScale: number) {
  const text = findNode(tree, (node) => node.type === 'Text' && node.props.numberOfLines === 1);
  const style = flattenStyle(text?.props.style);
  const fontSize = Number(style.fontSize);
  const letterSpacing = Number(style.letterSpacing ?? 0);
  const trackedGaps = title.length - 1;
  const glyphWidthAt29 = measuredTitleWidthsAt29[title] - (-0.7 * trackedGaps);
  const naturalWidth = (glyphWidthAt29 * fontSize * fontScale / 29) + (letterSpacing * trackedGaps);
  if (!text?.props.adjustsFontSizeToFit) return naturalWidth;
  const minimumScale = Number(text.props.minimumFontScale ?? 0);
  return (glyphWidthAt29 * fontSize * fontScale * minimumScale / 29) + (letterSpacing * trackedGaps);
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

  it('fits the full accessible navigator title at 320 points without wrapping or ellipsis', () => {
    const cases = [
      { title: 'Captain Dashboard' as const, onBack: undefined },
      { title: 'Notification Settings' as const, onBack: () => undefined },
    ];

    for (const testCase of cases) {
      const tree = renderTitle(47, testCase.onBack, testCase.title, 320);
      const frame = findNode(tree, (node) => node.props.testID === 'cut-ice-title');
      const title = findNode(tree, (node) => node.type === 'Text' && node.props.numberOfLines === 1);
      assert.equal(frame?.props.accessibilityLabel, testCase.title);
      assert.equal(nodeText(title), testCase.title.toUpperCase());
      assert.equal(title?.props.numberOfLines, 1);
      assert.equal(title?.props.maxFontSizeMultiplier, 1.2);

      for (const fontScale of [1, 1.2]) {
        const required = minimumRenderedTitleWidth(tree, testCase.title, fontScale);
        const available = availableTitleWidth(tree, 320);
        assert.ok(
          required <= available,
          `${testCase.title} requires ${required.toFixed(2)}pt but only ${available.toFixed(2)}pt is visible at ${fontScale}x`,
        );
      }

      assert.equal(title?.props.adjustsFontSizeToFit, true);
      assert.ok(Number(title?.props.minimumFontScale) > 0);
    }

    for (const viewportWidth of [390, 430]) {
      const tree = renderTitle(47, undefined, 'Captain Dashboard', viewportWidth);
      const title = findNode(tree, (node) => node.type === 'Text' && node.props.numberOfLines === 1);
      const style = flattenStyle(title?.props.style);
      assert.equal(style.fontSize, 29, `${viewportWidth}pt keeps approved title size`);
      assert.equal(style.lineHeight, 34, `${viewportWidth}pt keeps approved title leading`);
    }
  });
});
