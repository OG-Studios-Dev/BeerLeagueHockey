import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, findNode, nodeText } from './component-harness.ts';

const league = {
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

function renderMarketplace(options: {
  status: 'signed-out' | 'loading' | 'ready' | 'empty' | 'error' | 'incomplete';
  guest?: boolean;
  member?: boolean;
  modal?: boolean;
}) {
  let stateIndex = 0;
  const retries: unknown[] = [];
  const exits: unknown[] = [];
  const react = {
    Fragment: 'Fragment',
    createElement,
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const index = stateIndex++;
      const value = index === 0 ? [league] : index === 1 ? false : index === 7 && options.modal ? league : initial;
      return [value, () => undefined];
    },
  };
  const availableLeagues = options.member ? [{
    id: league.id,
    name: league.name,
    slug: league.slug,
    logoUrl: null,
    city: league.city,
    theme: { primaryColor: league.primary_color },
  }] : [];
  const exports = compileCommonJs<{ default: (props: object) => unknown }>(
    new URL('../../src/components/LeagueMarketplace.tsx', import.meta.url),
    {
      react,
      'react-native': {
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
      },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-linking': { openSettings: () => undefined, openURL: async () => undefined },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../context/AccessibilityPreferencesContext': {
        useAccessibilityPreferences: () => ({ reduceMotion: false, reduceTransparency: false }),
      },
      '../context/AuthContext': {
        useAuth: () => ({
          session: options.guest ? null : { user: { id: 'account-a' } },
          isGuest: options.guest ?? false,
          exitGuest: () => exits.push(true),
        }),
      },
      '../context/LeagueContext': {
        useLeague: () => ({
          availableLeagues,
          setActiveLeague: () => undefined,
          membershipStatus: options.status,
          membershipDiagnostics: { backendOrigin: null, appVersion: null, appBuild: null, entries: [] },
          retryMemberships: () => retries.push(true),
        }),
      },
      '../lib/leagueMarketplace': { getLeagueMarketplace: async () => ({ leagues: [], userRating: null }) },
      '../lib/supabase/client': { supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } },
      '../theme/colors': { __esModule: true, default: {
        primary: '#22D3EE', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', textOnPrimary: '#02111B',
        bgBase: '#07111F', bgSurface: 'rgba(12, 27, 49, 0.72)', bgInteractive: 'rgba(28, 42, 66, 0.84)',
        borderCard: 'rgba(255, 255, 255, 0.1)', glassStrokeStrong: 'rgba(96, 165, 250, 0.28)',
        accentGreen: '#22C55E', accentRed: '#EF4444',
      } },
      '../theme/contrast': { getContrastTextColor: () => '#fff' },
      './MembershipDiagnosticsCard': { __esModule: true, default: 'MembershipDiagnosticsCard' },
      './TeamLogo': { default: 'TeamLogo' },
    },
  );

  const tree = exports.default({});
  const list = findNode(tree, (node) => node.type === 'FlatList');
  assert.ok(list);
  const cardElement = list.props.renderItem({ item: league });
  const card = cardElement.type(cardElement.props);
  return { tree, card, retries, exits };
}

describe('Marketplace membership truth states', () => {
  it('does not offer Request to Join before the first signed-in lookup succeeds', () => {
    const rendered = renderMarketplace({ status: 'loading' });
    assert.equal(nodeText(rendered.card).includes('Request to Join'), false);
    assert.match(nodeText(rendered.card), /Checking membership/);
  });

  it('shows an honest failure, Retry, and diagnostics in card and modal states', () => {
    for (const status of ['error', 'incomplete'] as const) {
      const rendered = renderMarketplace({ status, modal: true });
      const expected = status === 'error' ? "Couldn't load leagues" : 'Membership unavailable';
      const list = findNode(rendered.tree, (node) => node.type === 'FlatList');
      assert.ok(list);
      assert.match(nodeText(list.props.ListHeaderComponent), new RegExp(expected.replace("'", "\\'")));
      assert.equal(nodeText(rendered.card).includes('Request to Join'), false);
      assert.match(nodeText(rendered.card), /Membership unavailable/);
      assert.equal(nodeText(rendered.tree).includes('Request to Join'), false);
      assert.ok(findNode(list.props.ListHeaderComponent, (node) => node.type === 'MembershipDiagnosticsCard'));
      const retry = findNode(list.props.ListHeaderComponent, (node) => node.props.accessibilityLabel === 'Retry loading league memberships');
      assert.ok(retry);
      retry.props.onPress();
      assert.equal(rendered.retries.length, 1);

      const dialog = findNode(rendered.tree, (node) => node.props.accessibilityViewIsModal === true);
      assert.ok(dialog);
      assert.ok(findNode(dialog, (node) => node.type === 'MembershipDiagnosticsCard'));
      const modalRetry = findNode(dialog, (node) => node.props.accessibilityLabel === 'Retry loading league memberships from league details');
      assert.ok(modalRetry);
      modalRetry.props.onPress();
      assert.equal(rendered.retries.length, 2);
    }
  });

  it('offers nonmembership action only after a successful empty/current lookup', () => {
    const empty = renderMarketplace({ status: 'empty' });
    assert.match(nodeText(empty.card), /Request to Join/);

    const readyNonmember = renderMarketplace({ status: 'ready' });
    assert.match(nodeText(readyNonmember.card), /Request to Join/);

    const member = renderMarketplace({ status: 'ready', member: true });
    assert.match(nodeText(member.card), /Joined/);
    assert.match(nodeText(member.card), /Enter League/);
  });

  it('keeps guest browsing and presents sign-in instead of an auth failure loop', () => {
    const guest = renderMarketplace({ status: 'signed-out', guest: true });
    assert.equal(nodeText(guest.tree).includes("Couldn't load leagues"), false);
    assert.match(nodeText(guest.card), /Sign In to Join/);
    const signIn = findNode(guest.card, (node) => node.props.accessibilityLabel === 'Sign in to request league membership');
    assert.ok(signIn);
    signIn.props.onPress();
    assert.equal(guest.exits.length, 1);
  });
});
