/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, findNode } from './component-harness';

function renderToggle() {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = { createElement };
  try {
    const PillToggle = compileCommonJs<{ default: (props: any) => unknown }>(
      new URL('../../src/components/PillToggle.tsx', import.meta.url),
      {
        'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {} } },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
        '../theme/colors': { __esModule: true, default: { brandRink: '#0ff', brandArena: '#00f', bgSurface: '#111', glassStroke: '#333', glassHighlight: '#222', textPrimary: '#fff', textSecondary: '#aaa' } },
      },
    ).default;
    const changes: string[] = [];
    return { output: PillToggle({ options: ['Points', 'Assists'], selected: 'Points', onChange: (next: string) => changes.push(next) }), changes };
  } finally {
    (globalThis as any).React = previousReact;
  }
}

describe('PillToggle accessibility and compact labels', () => {
  it('exposes named button selection semantics and preserves its action', () => {
    const run = renderToggle();
    const points = findNode(run.output, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Points');
    const assists = findNode(run.output, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Assists');
    assert.equal(points?.props.accessibilityRole, 'button');
    assert.deepEqual(points?.props.accessibilityState, { selected: true });
    assert.equal(points?.props['aria-pressed'], true);
    assert.equal(assists?.props.accessibilityRole, 'button');
    assert.deepEqual(assists?.props.accessibilityState, { selected: false });
    assert.equal(assists?.props['aria-pressed'], false);
    assists?.props.onPress();
    assert.deepEqual(run.changes, ['Assists']);
  });

  it('keeps only compact toggle labels within a font scaling limit', () => {
    const label = findNode(renderToggle().output, (node) => node.type === 'Text');
    assert.equal(label?.props.maxFontSizeMultiplier, 1.3);
    assert.notEqual(label?.props.allowFontScaling, false);
  });
});
