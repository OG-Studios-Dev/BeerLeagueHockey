import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, flattenStyle, nodeText } from './component-harness.ts';
import { getContrastTextColor } from '../../src/theme/contrast.ts';
import colors from '../../src/theme/colors.ts';

const selectedLeague = {
  id: 'league-1',
  name: 'Hockey Life',
  short_name: null,
  slug: 'hockey-life',
  logo_url: null,
  city: 'London',
  distanceKm: 7,
  primary_color: '#1239B8',
  fitLabel: 'New League',
  fitColor: '#A8B4C8',
  fitScore: null,
  leagueMedianRating: null,
  leagueRatingRange: null,
};

function renderModal(preferences = { reduceMotion: false, reduceTransparency: false }) {
  const sourceUrl = new URL('../../src/components/LeagueMarketplace.tsx', import.meta.url);
  let stateIndex = 0;
  const react = {
    Fragment: 'Fragment',
    createElement,
    useEffect: () => undefined,
    useMemo: (fn: () => unknown) => fn(),
    useState: (initial: unknown) => {
      const index = stateIndex++;
      const value = index === 0 ? [selectedLeague] : index === 1 ? false : index === 7 ? selectedLeague : initial;
      return [value, () => undefined];
    },
  };
  const native = {
    ActivityIndicator: 'ActivityIndicator',
    Alert: { alert: () => undefined },
    FlatList: 'FlatList',
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
    Text: 'Text',
    TextInput: 'TextInput',
    TouchableOpacity: 'TouchableOpacity',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    View: 'View',
  };
  const exports = compileCommonJs<{ default: (props: object) => unknown }>(sourceUrl, {
    react,
    'react-native': native,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-linking': { openSettings: () => undefined, openURL: async () => undefined },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => preferences },
    '../context/AuthContext': { useAuth: () => ({ session: { user: { id: 'user-1' } }, isGuest: false, exitGuest: () => undefined }) },
    '../context/LeagueContext': { useLeague: () => ({
      availableLeagues: [], setActiveLeague: () => undefined, membershipStatus: 'ready',
      membershipDiagnostics: { backendOrigin: null, appVersion: null, appBuild: null, entries: [] },
      retryMemberships: () => undefined,
    }) },
    '../lib/leagueMarketplace': { getLeagueMarketplace: async () => ({ leagues: [], userRating: null, userTier: null }) },
    '../lib/supabase/client': { supabase: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } },
    '../theme/colors': {
      __esModule: true,
      default: {
        primary: '#22D3EE', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', textOnPrimary: '#02111B',
        bgBase: '#07111F', bgSurface: 'rgba(12, 27, 49, 0.72)', bgInteractive: 'rgba(28, 42, 66, 0.84)',
        borderCard: 'rgba(255, 255, 255, 0.1)', glassStrokeStrong: 'rgba(96, 165, 250, 0.28)', accentGreen: '#22C55E',
      },
    },
    './TeamLogo': { default: 'TeamLogo' },
    './MembershipDiagnosticsCard': { __esModule: true, default: 'MembershipDiagnosticsCard' },
  });
  return exports.default({});
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255);
  const [r, g, b] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first: string, second: string) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('League marketplace detail modal', () => {
  it('uses a solid modal surface without changing scrolling-card translucency', () => {
    const tree = renderModal();
    const dialog = findNode(tree, (node) => node.props.accessibilityViewIsModal === true);
    assert.ok(dialog);
    assert.match(flattenStyle(dialog.props.style).backgroundColor, /^#[0-9a-f]{6}$/i);

    const list = findNode(tree, (node) => node.type === 'FlatList');
    assert.ok(list);
    const cardElement = list.props.renderItem({ item: selectedLeague });
    const card = cardElement.type(cardElement.props);
    assert.match(flattenStyle(card.props.style).backgroundColor, /^rgba\(/);
  });

  it('uses theme-aware primary text with WCAG contrast for dark blue, cyan, and yellow', () => {
    const tree = renderModal();
    const actionText = findNode(tree, (node) => nodeText(node) === 'Open League Site' && node.type === 'Text');
    assert.ok(actionText);
    const foreground = flattenStyle(actionText.props.style).color;
    assert.ok(contrastRatio(selectedLeague.primary_color, foreground) >= 4.5);

    for (const background of ['#1239B8', '#22D3EE', '#D4AF37']) {
      assert.ok(
        contrastRatio(background, getContrastTextColor(background)) >= 4.5,
        `${background} primary action should meet 4.5:1 contrast`,
      );
    }
  });

  it('chooses the higher-contrast existing foreground using sRGB relative luminance', () => {
    const expectedForeground = (background: string) =>
      contrastRatio(background.length === 4
        ? `#${[...background.slice(1)].map((character) => character.repeat(2)).join('')}`
        : background, colors.textPrimary)
      > contrastRatio(background.length === 4
        ? `#${[...background.slice(1)].map((character) => character.repeat(2)).join('')}`
        : background, colors.textOnPrimary)
        ? colors.textPrimary
        : colors.textOnPrimary;

    for (const background of [
      '#22C55E',
      '#00AA00',
      '#1239B8',
      '#22D3EE',
      '#D4AF37',
      '#777777',
      '#787878',
      '#0a0',
    ]) {
      assert.equal(
        getContrastTextColor(background),
        expectedForeground(background),
        `${background} should use the existing foreground with the higher WCAG contrast ratio`,
      );
    }
  });

  it('preserves missing and invalid color fallback semantics', () => {
    assert.equal(getContrastTextColor(), colors.textOnPrimary);
    assert.equal(getContrastTextColor(null), colors.textOnPrimary);
    assert.equal(getContrastTextColor('transparent'), colors.textPrimary);
    assert.equal(getContrastTextColor('#12'), colors.textPrimary);
  });

  it('provides a visible accessible close control and a safe scrolling body', () => {
    const tree = renderModal();
    const close = findNode(tree, (node) => node.props.accessibilityLabel === 'Close league details');
    assert.ok(close);
    assert.equal(close.props.accessibilityRole, 'button');
    assert.ok(findNode(tree, (node) => node.type === 'ScrollView' && node.props.contentContainerStyle));
    const modal = findNode(tree, (node) => node.type === 'Modal');
    assert.equal(typeof modal?.props.onRequestClose, 'function');
  });

  it('disables modal animation when reduced motion is enabled', () => {
    const tree = renderModal({ reduceMotion: true, reduceTransparency: true });
    const modal = findNode(tree, (node) => node.type === 'Modal');
    assert.equal(modal?.props.animationType, 'none');
  });
});
