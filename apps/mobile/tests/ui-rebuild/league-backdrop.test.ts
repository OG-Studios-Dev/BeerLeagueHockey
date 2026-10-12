import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle } from './component-harness.ts';

describe('shared LeagueBackdrop', () => {
  function render(reduceTransparency: boolean) {
    const LeagueBackdrop = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/LeagueBackdrop.tsx', import.meta.url),
      {
        react: { createElement },
        'react-native': {
          StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: { position: 'absolute', inset: 0 } },
          View: 'View',
        },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
        '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency }) },
        '../theme/league': {
          LEAGUE_VISUAL_TOKENS: {
            canvas: '#07111F', navy: '#0A1628', ink: '#030A13', rinkLine: 'rgba(255, 255, 255, 0.08)',
          },
        },
      },
    ).default;
    return LeagueBackdrop({ accentColor: '#36A852' });
  }

  it('renders the accepted Home gradient and rink geometry from one shared component', () => {
    const output = render(false);
    const backdrop = findNode(output, (node) => node.props.testID === 'league-backdrop');
    const base = findNode(output, (node) => node.props.testID === 'league-backdrop-gradient');
    const glow = findNode(output, (node) => node.props.testID === 'league-atmospheric-glow');
    assert.equal(backdrop?.props.pointerEvents, 'none');
    assert.deepEqual(base?.props.colors, ['#07111F', '#0A1628', '#030A13']);
    assert.deepEqual(glow?.props.colors, ['#36A85224', 'rgba(255,255,255,0.03)', 'transparent']);
    assert.ok(findNode(output, (node) => node.props.testID === 'league-rink-lines'));
    assert.equal(flattenStyle(backdrop?.props.style).overflow, 'hidden');
  });

  it('renders a flat opaque canvas with no gradient, glow, or rink bleed when Reduce Transparency is enabled', () => {
    const output = render(true);
    const backdrop = findNode(output, (node) => node.props.testID === 'league-backdrop');
    assert.equal(flattenStyle(backdrop?.props.style).backgroundColor, '#07111F');
    assert.equal(findNode(output, (node) => node.props.testID === 'league-backdrop-gradient'), undefined);
    assert.equal(findNode(output, (node) => node.props.testID === 'league-atmospheric-glow'), undefined);
    assert.equal(findNode(output, (node) => node.props.testID === 'league-rink-lines'), undefined);
  });
});
