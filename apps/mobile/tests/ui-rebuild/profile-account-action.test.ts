import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

type RenderOptions = {
  isGuest?: boolean;
  loading?: boolean;
  profile?: { id: string; full_name: string } | null;
  signOutResult?: { error: Error | null };
};

function renderProfile({
  isGuest = false,
  loading = true,
  profile = null,
  signOutResult = { error: null },
}: RenderOptions = {}) {
  const sourceUrl = new URL('../../src/screens/ProfileScreen.tsx', import.meta.url);
  const alerts: Array<{ title: string; message?: string; buttons?: any[] }> = [];
  const signOutCalls: unknown[] = [];
  const exitGuestCalls: unknown[] = [];
  const effects: Array<() => unknown> = [];
  const stateUpdates: unknown[][] = Array.from({ length: 20 }, () => []);
  let stateIndex = 0;
  const stateOverrides = new Map<number, unknown>([
    [0, profile],
    [6, loading],
  ]);
  const react = {
    Fragment: 'Fragment',
    createElement,
    useCallback: (fn: unknown) => fn,
    useEffect: (effect: () => unknown) => { effects.push(effect); },
    useMemo: (fn: () => unknown) => fn(),
    useRef: (value: unknown) => ({ current: value }),
    useState: (initial: unknown) => {
      const index = stateIndex++;
      const value = stateOverrides.has(index) ? stateOverrides.get(index) : initial;
      return [value, (next: unknown) => stateUpdates[index].push(next)];
    },
  };
  const native = {
    ActivityIndicator: 'ActivityIndicator',
    Alert: { alert: (title: string, message?: string, buttons?: any[]) => alerts.push({ title, message, buttons }) },
    Linking: { openURL: async () => undefined },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Share: { share: async () => undefined },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
    Text: 'Text',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    View: 'View',
  };
  const component = (name: string) => name;
  const exports = compileCommonJs<{ default: (props: { navigation: any }) => unknown }>(sourceUrl, {
    react,
    'react-native': native,
    '@expo/vector-icons': { Ionicons: component('Ionicons'), MaterialCommunityIcons: component('MaterialCommunityIcons') },
    'expo-linear-gradient': { LinearGradient: component('LinearGradient') },
    'react-native-safe-area-context': { SafeAreaView: component('SafeAreaView') },
    '../components/Avatar': { default: component('Avatar') },
    '../components/BrandAtmosphere': { default: component('BrandAtmosphere') },
    '../components/RevealView': { default: component('RevealView') },
    '../components/SectionHeader': { default: component('SectionHeader') },
    '../components/TeamLogo': { default: component('TeamLogo') },
    '../components/MembershipDiagnosticsCard': { __esModule: true, default: component('MembershipDiagnosticsCard') },
    '../context/AuthContext': {
      useAuth: () => ({
        isGuest,
        session: isGuest ? null : { user: { id: 'user-1' } },
        signOut: async () => { signOutCalls.push(true); return signOutResult; },
        exitGuest: () => exitGuestCalls.push(true),
      }),
    },
    '../context/LeagueContext': {
      useLeague: () => ({
        activeLeague: null,
        activeTheme: { backgroundColor: '#07111F', primaryColor: '#22D3EE', secondaryColor: '#2563EB' },
        setActiveLeague: async () => undefined,
        availableLeagues: [],
        membershipStatus: isGuest ? 'signed-out' : 'empty',
        membershipDiagnostics: { backendOrigin: null, appVersion: '1.0.0', appBuild: '14', entries: [] },
        retryMemberships: () => undefined,
      }),
    },
    '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
    '../lib/supabase/client': { supabase: {} },
    '../theme/colors': { default: { textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', primary: '#22D3EE', accentGreen: '#22C55E', accentRed: '#EF4444', brandGold: '#D4AF37' } },
    '../theme/contrast': { getContrastTextColor: () => '#F7FBFF' },
  });

  const tree = exports.default({ navigation: { navigate: () => undefined } });
  return { tree, alerts, signOutCalls, exitGuestCalls, stateUpdates, effects };
}

function renderPendingProfile(signOutImpl: () => Promise<{ error: Error | null }>) {
  const sourceUrl = new URL('../../src/screens/ProfileScreen.tsx', import.meta.url);
  const harness = createHookHarness();
  const alerts: Array<{ title: string; message?: string; buttons?: any[] }> = [];
  const signOutCalls: unknown[] = [];
  const native = {
    ActivityIndicator: 'ActivityIndicator',
    Alert: { alert: (title: string, message?: string, buttons?: any[]) => alerts.push({ title, message, buttons }) },
    Linking: { openURL: async () => undefined },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Share: { share: async () => undefined },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
    Text: 'Text',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    View: 'View',
  };
  const component = (name: string) => name;
  const exports = compileCommonJs<{ default: (props: { navigation: any }) => unknown }>(sourceUrl, {
    react: harness.react,
    'react-native': native,
    '@expo/vector-icons': { Ionicons: component('Ionicons'), MaterialCommunityIcons: component('MaterialCommunityIcons') },
    'expo-linear-gradient': { LinearGradient: component('LinearGradient') },
    'react-native-safe-area-context': { SafeAreaView: component('SafeAreaView') },
    '../components/Avatar': { default: component('Avatar') },
    '../components/BrandAtmosphere': { default: component('BrandAtmosphere') },
    '../components/RevealView': { default: component('RevealView') },
    '../components/SectionHeader': { default: component('SectionHeader') },
    '../components/TeamLogo': { default: component('TeamLogo') },
    '../components/MembershipDiagnosticsCard': { __esModule: true, default: component('MembershipDiagnosticsCard') },
    '../context/AuthContext': {
      useAuth: () => ({
        isGuest: false,
        session: { user: { id: 'user-1' } },
        signOut: async () => {
          signOutCalls.push(true);
          return signOutImpl();
        },
        exitGuest: () => undefined,
      }),
    },
    '../context/LeagueContext': {
      useLeague: () => ({
        activeLeague: null,
        activeTheme: { backgroundColor: '#07111F', primaryColor: '#22D3EE', secondaryColor: '#2563EB' },
        setActiveLeague: async () => undefined,
        availableLeagues: [],
        membershipStatus: 'loading',
        membershipDiagnostics: { backendOrigin: null, appVersion: '1.0.0', appBuild: '14', entries: [] },
        retryMemberships: () => undefined,
      }),
    },
    '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
    '../lib/supabase/client': {
      supabase: { auth: { getUser: () => new Promise(() => undefined) } },
    },
    '../theme/colors': { default: { textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', primary: '#22D3EE', accentGreen: '#22C55E', accentRed: '#EF4444', brandGold: '#D4AF37' } },
    '../theme/contrast': { getContrastTextColor: () => '#F7FBFF' },
  });

  harness.mount(() => exports.default({ navigation: { navigate: () => undefined } }));
  return {
    alerts,
    signOutCalls,
    render: () => harness.render(),
    get tree() {
      return harness.output;
    },
  };
}

function accountButton(tree: unknown, label: string) {
  return findNode(tree, (node) => node.props.accessibilityLabel === label);
}

describe('Profile account action', () => {
  it('keeps authenticated logout reachable while profile data is loading', () => {
    assert.ok(accountButton(renderProfile({ loading: true }).tree, 'Log out'));
  });

  it('keeps authenticated logout reachable with no membership', () => {
    assert.ok(accountButton(renderProfile({ loading: false, profile: { id: 'user-1', full_name: 'Player' } }).tree, 'Log out'));
  });

  it('keeps authenticated logout reachable and ends loading after profile loading fails', async () => {
    const rendered = renderProfile({ loading: true, profile: null });
    assert.ok(accountButton(rendered.tree, 'Log out'));
    rendered.effects.forEach((effect) => effect());
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.ok(rendered.stateUpdates[6].includes(false));
  });

  it('gives guests a Sign In exit instead of authenticated logout', () => {
    const rendered = renderProfile({ isGuest: true, loading: false });
    assert.equal(accountButton(rendered.tree, 'Log out'), undefined);
    const button = accountButton(rendered.tree, 'Sign in');
    assert.ok(button);
    button.props.onPress();
    assert.equal(rendered.exitGuestCalls.length, 1);
    assert.equal(rendered.signOutCalls.length, 0);
  });

  it('keeps league diagnostics reachable for guests and missing profiles', () => {
    const guest = renderProfile({ isGuest: true, loading: false }).tree;
    assert.ok(findNode(guest, (node) => node.type === 'MembershipDiagnosticsCard'));

    const missingProfile = renderProfile({ loading: false, profile: null }).tree;
    assert.ok(findNode(missingProfile, (node) => node.type === 'MembershipDiagnosticsCard'));
  });

  it('requires confirmation, supports cancel, and reports a sign-out failure', async () => {
    const rendered = renderProfile({ loading: true, signOutResult: { error: new Error('Session could not be cleared') } });
    const button = accountButton(rendered.tree, 'Log out');
    assert.ok(button);
    button.props.onPress();
    assert.equal(rendered.signOutCalls.length, 0);
    assert.equal(rendered.alerts[0]?.title, 'Log Out?');
    assert.equal(rendered.alerts[0]?.buttons?.[0]?.text, 'Cancel');

    await rendered.alerts[0]?.buttons?.[1]?.onPress();
    assert.equal(rendered.signOutCalls.length, 1);
    assert.equal(rendered.alerts.at(-1)?.title, 'Unable to Log Out');
    assert.deepEqual(rendered.stateUpdates[14], [true, false]);
  });

  it('finishes a confirmed successful logout without showing an error', async () => {
    const rendered = renderProfile({ loading: false, signOutResult: { error: null } });
    const button = accountButton(rendered.tree, 'Log out');
    assert.ok(button);
    button.props.onPress();

    await rendered.alerts[0]?.buttons?.[1]?.onPress();
    assert.equal(rendered.signOutCalls.length, 1);
    assert.equal(rendered.alerts.length, 1);
    assert.deepEqual(rendered.stateUpdates[14], [true, false]);
  });

  it('renders pending state, prevents duplicate confirmation, and restores the current button after failure', async () => {
    let resolveSignOut!: (result: { error: Error | null }) => void;
    const signOutPending = new Promise<{ error: Error | null }>((resolve) => {
      resolveSignOut = resolve;
    });
    const rendered = renderPendingProfile(() => signOutPending);
    accountButton(rendered.tree, 'Log out')?.props.onPress();
    const confirm = rendered.alerts[0]?.buttons?.[1]?.onPress;
    assert.equal(typeof confirm, 'function');

    const firstConfirmation = confirm();
    rendered.render();
    const pendingButton = accountButton(rendered.tree, 'Log out');
    assert.equal(pendingButton?.props.disabled, true);
    assert.deepEqual(pendingButton?.props.accessibilityState, { busy: true, disabled: true });
    assert.match(nodeText(pendingButton), /Signing Out/);

    const duplicateConfirmation = confirm();
    assert.equal(rendered.signOutCalls.length, 1);

    resolveSignOut({ error: new Error('Session could not be cleared') });
    await Promise.all([firstConfirmation, duplicateConfirmation]);
    rendered.render();

    const finalButton = accountButton(rendered.tree, 'Log out');
    assert.equal(finalButton?.props.disabled, false);
    assert.deepEqual(finalButton?.props.accessibilityState, { busy: false, disabled: false });
    assert.match(nodeText(finalButton), /Log Out/);
    assert.equal(rendered.alerts.filter(({ title }) => title === 'Unable to Log Out').length, 1);
  });
});
