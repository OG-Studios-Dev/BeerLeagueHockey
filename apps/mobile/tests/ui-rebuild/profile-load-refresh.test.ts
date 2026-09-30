import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';
import { notifyProfilePreferencesChanged } from '../../src/lib/profileContract';

type ProfileResult = { data: Record<string, unknown> | null; error: Error | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mountProfile(options: {
  authResult?: Promise<any> | any;
  profileResults?: Array<Promise<ProfileResult> | ProfileResult>;
  isGuest?: boolean;
} = {}) {
  const harness = createHookHarness();
  const shares: Array<Record<string, unknown>> = [];
  let profileReads = 0;
  const profileResults = options.profileResults ?? [
    { data: { id: 'player-1', full_name: 'Casey', avatar_url: null, position: 'C', skill_level: 'beginner' }, error: null },
  ];
  const chain: Record<string, any> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => {
    const result = profileResults[Math.min(profileReads, profileResults.length - 1)];
    profileReads += 1;
    return await result;
  };
  const supabase = {
    auth: { getUser: async () => await (options.authResult ?? { data: { user: { id: 'player-1' } }, error: null }) },
    from: () => chain,
  };
  const component = (name: string) => name;
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/ProfileScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Alert: { alert: () => undefined }, Linking: { openURL: async () => undefined },
        Pressable: 'Pressable', ScrollView: 'ScrollView', Share: { share: async (payload: Record<string, unknown>) => { shares.push(payload); } },
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: {} }, Text: 'Text', View: 'View',
        useWindowDimensions: () => ({ width: 390, height: 844 }),
      },
      '@expo/vector-icons': { Ionicons: component('Ionicons'), MaterialCommunityIcons: component('MaterialCommunityIcons') },
      'expo-linear-gradient': { LinearGradient: component('LinearGradient') },
      'react-native-safe-area-context': { SafeAreaView: component('SafeAreaView') },
      '../components/Avatar': { default: component('Avatar') }, '../components/BrandAtmosphere': { default: component('BrandAtmosphere') },
      '../components/RevealView': { default: ({ children }: any) => createElement('RevealView', {}, children) },
      '../components/SectionHeader': { default: component('SectionHeader') }, '../components/TeamLogo': { default: component('TeamLogo') },
      '../components/MembershipDiagnosticsCard': { __esModule: true, default: component('MembershipDiagnosticsCard') },
      '../context/AuthContext': { useAuth: () => ({
        user: options.isGuest ? null : { id: 'player-1' }, isGuest: options.isGuest ?? false,
        exitGuest: () => undefined, signOut: async () => ({ error: null }),
      }) },
      '../context/LeagueContext': { useLeague: () => ({
        activeLeague: null, activeTheme: { backgroundColor: '#000', primaryColor: '#0ff', secondaryColor: '#00f' },
        membershipStatus: options.isGuest ? 'signed-out' : 'empty', membershipDiagnostics: { entries: [] },
        retryMemberships: () => undefined, exitGuestLeague: () => undefined,
      }) },
      '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
      '../lib/supabase/accountDeletion': { deleteCurrentAccount: async () => ({ error: null }) },
      '../lib/supabase/client': { supabase },
      '../theme/colors': { __esModule: true, default: {
        bgSurface: '#111', glassStrokeStrong: '#333', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
        primary: '#0ff', accentGreen: '#0f0', accentRed: '#f00', brandGold: '#fc0', bgInteractive: '#222', borderCard: '#333',
      } },
      '../theme/contrast': { getContrastTextColor: () => '#fff' },
    },
  ).default;
  const navigation = { navigate: () => undefined };
  harness.mount(() => Screen({ navigation }));
  return { harness, shares, get profileReads() { return profileReads; } };
}

describe('profile loading and retained-screen refresh', () => {
  it('refreshes badge, fit text, and share content after a confirmed-save invalidation', async () => {
    const mounted = mountProfile({ profileResults: [
      { data: { id: 'player-1', full_name: 'Casey', avatar_url: null, position: 'C', skill_level: 'beginner' }, error: null },
      { data: { id: 'player-1', full_name: 'Casey', avatar_url: null, position: 'C', skill_level: 'expert' }, error: null },
    ] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    assert.match(nodeText(mounted.harness.output), /Beginner/);
    assert.equal(mounted.profileReads, 1);

    notifyProfilePreferencesChanged('player-2');
    mounted.harness.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    assert.equal(mounted.profileReads, 1);
    assert.match(nodeText(mounted.harness.output), /Beginner/);

    notifyProfilePreferencesChanged('player-1');
    mounted.harness.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();

    assert.equal(mounted.profileReads, 2);
    assert.match(nodeText(mounted.harness.output), /Expert/);
    assert.doesNotMatch(nodeText(mounted.harness.output), /Beginner/);
    const share = findNode(mounted.harness.output, (node) => node.type === 'Pressable' && nodeText(node) === 'Share Player Card');
    assert.ok(share);
    await share.props.onPress();
    assert.match(String(mounted.shares[0]?.message), /League match level: Expert/);
  });

  it('shows an authenticated auth error instead of fallback identity', async () => {
    const mounted = mountProfile({ authResult: { data: { user: null }, error: new Error('auth unavailable') } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    assert.match(nodeText(mounted.harness.output), /couldn't load your player profile/i);
    assert.equal(mounted.profileReads, 0);
  });

  it('shows a rejected profile read as a load failure', async () => {
    const mounted = mountProfile({ profileResults: [Promise.reject(new Error('network failure'))] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    assert.match(nodeText(mounted.harness.output), /couldn't load your player profile/i);
  });

  it('keeps genuine guest state intentional without a profile-load failure', async () => {
    const mounted = mountProfile({ isGuest: true, authResult: { data: { user: null }, error: null } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    mounted.harness.render();
    assert.doesNotMatch(nodeText(mounted.harness.output), /couldn't load your player profile/i);
    assert.equal(mounted.profileReads, 0);
  });

  it('suppresses every late profile-query UI effect after unmount', async () => {
    const pending = deferred<ProfileResult>();
    const mounted = mountProfile({ profileResults: [pending.promise] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.profileReads, 1, 'profile query must be pending before unmount');
    const updatesBeforeUnmount = mounted.harness.stateUpdateCount;
    mounted.harness.unmount();
    pending.resolve({ data: null, error: new Error('late failure') });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mounted.harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
