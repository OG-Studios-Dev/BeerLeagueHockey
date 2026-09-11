import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compileCommonJs,
  createElement,
  createHookHarness,
  findNode,
  flattenStyle,
  nodeText,
  type TestNode,
} from './component-harness';

const harness = createHookHarness();
(globalThis as unknown as { React: unknown }).React = harness.react;
const colors = {
  badgeLiveBg: '#DA3633', badgeLiveText: '#F0F6FC', badgeFinalBg: 'rgba(255,255,255,.1)',
  badgeFinalText: '#C9D1D9', badgeUpcomingBg: 'rgba(34,211,238,.2)', badgeUpcomingText: '#F0F6FC',
  brandRink: '#22D3EE', glassStroke: 'rgba(255,255,255,.12)', textPrimary: '#F8FBFF',
  textSecondary: '#A9B8CC', primary: '#22D3EE', glassHighlight: 'rgba(255,255,255,.08)',
};

const GameCard = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
  new URL('../../src/components/GameCard.tsx', import.meta.url),
  {
    react: harness.react,
    'react-native': {
      Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: {
        create: <T>(styles: T) => styles,
        absoluteFillObject: { position: 'absolute', inset: 0 },
      },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '../lib/calendar': { addGameToCalendar: async () => {} },
    '../theme/colors': colors,
    '../theme/ui': { ui: { minTouchTarget: 44, radius: { card: 18 } } },
    './GlassSurface': ({ children, style }: Record<string, unknown>) => createElement('GlassSurface', { style }, children),
  },
).default;

const longAway = 'Scarborough East End Thursday Night Ice Hockey Club';
const longHome = 'Northumberland County Old-Timers Hockey Club';
const longVenue = 'Northumberland Community Recreation Centre — West Olympic Ice Pad';

function render(visualVariant?: string) {
  return GameCard({
    awayTeam: longAway,
    homeTeam: longHome,
    rinkName: longVenue,
    dateLabel: 'Sep 9',
    timeLabel: '7:30 PM',
    status: 'Final',
    awayScore: 2,
    homeScore: 4,
    compact: true,
    visualVariant,
    reduceTransparency: false,
  });
}

describe('Home-only Recent Results visual variant', () => {
  it('removes neon, uses pinned glass, and leaves all Home result labels wrappable', () => {
    const output = render('homeEditorial');
    const root = output as TestNode;
    const rootStyle = flattenStyle(root.props.style({ pressed: false }));
    assert.equal(rootStyle.shadowColor, '#000000');
    assert.equal(rootStyle.elevation, 0);

    const card = findNode(output, (node) => node.type === 'GlassSurface');
    assert.ok(card);
    assert.equal(flattenStyle(card.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(flattenStyle(card.props.style).borderColor, 'rgba(125, 190, 255, 0.22)');

    for (const value of [longAway, longHome, longVenue]) {
      const label = findNode(output, (node) => node.type === 'Text' && nodeText(node) === value);
      assert.ok(label);
      assert.equal(label.props.numberOfLines, undefined);
    }
  });

  it('retains byte-equivalent default presentation semantics for other screens', () => {
    const output = render();
    const root = output as TestNode;
    const rootStyle = flattenStyle(root.props.style({ pressed: false }));
    assert.equal(rootStyle.shadowColor, colors.brandRink);
    assert.equal(rootStyle.shadowOpacity, 0.16);
    for (const value of [longAway, longHome, longVenue]) {
      const label = findNode(output, (node) => node.type === 'Text' && nodeText(node) === value);
      assert.ok(label);
      assert.equal(label.props.numberOfLines, 1);
    }
  });
});
