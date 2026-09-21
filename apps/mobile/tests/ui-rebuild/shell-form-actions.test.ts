import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness';

const colors = {
  primary: '#0ff', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
  textInteractive: '#0ff', bgSurface: '#111', borderCard: '#333', accentGreen: '#0f0', accentRed: '#f00',
};

function mountAuthScreen(file: 'SignUpScreen' | 'ForgotPasswordScreen') {
  const harness = createHookHarness();
  let backs = 0;
  const navigation = { goBack: () => { backs += 1; } };
  const Screen = compileCommonJs<{ default: () => unknown }>(
    new URL(`../../src/screens/auth/${file}.tsx`, import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '@react-navigation/native': { useNavigation: () => navigation },
      '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
      '../../components/AuthShell': ({ children }: Record<string, unknown>) => createElement('AuthShell', {}, children),
      '../../context/AuthContext': { useAuth: () => ({ signUpWithEmail: async () => ({ error: null }) }) },
      '../../lib/supabase/client': { supabase: { auth: { resetPasswordForEmail: async () => ({ error: null }) } } },
      '../../theme/colors': { default: colors },
    },
  ).default;
  harness.mount(() => Screen());
  return { harness, get backs() { return backs; } };
}

describe('shell form exits', () => {
  it('removes auth top-arrow chrome while keeping real inline form exits', () => {
    const signup = mountAuthScreen('SignUpScreen');
    assert.equal(findNode(signup.harness.output, (node) => node.type === 'Ionicons' && node.props.name === 'arrow-back'), undefined);
    const signIn = findNode(signup.harness.output, (node) => node.props.accessibilityLabel === 'Sign in instead');
    assert.ok(signIn);
    signIn.props.onPress();
    assert.equal(signup.backs, 1);

    const forgot = mountAuthScreen('ForgotPasswordScreen');
    assert.equal(findNode(forgot.harness.output, (node) => node.type === 'Ionicons' && node.props.name === 'arrow-back'), undefined);
    const cancel = findNode(forgot.harness.output, (node) => node.props.accessibilityLabel === 'Cancel password reset');
    assert.ok(cancel);
    cancel.props.onPress();
    assert.equal(forgot.backs, 1);
  });

  it('keeps the real lineup save callback and adds an adjacent cancel callback', async () => {
    const harness = createHookHarness();
    const writes: Array<[string, string]> = [];
    let backs = 0;
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/captain/LineupNotesScreen.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Alert: { alert: () => undefined }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
          StyleSheet: { create: <T>(styles: T) => styles },
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async (key: string, value: string) => { writes.push([key, value]); } },
        '../../theme/colors': { default: { ...colors, bgBase: '#000', bgInteractive: '#222', accentGreen: '#0f0' } },
      },
    ).default;
    harness.mount(() => Screen({
      route: { params: { gameId: 'synthetic-game', teamId: 'synthetic-team', opponentName: 'Synthetic Opponent' } },
      navigation: { goBack: () => { backs += 1; } },
    }));
    const input = findNode(harness.output, (node) => node.type === 'TextInput');
    input?.props.onChangeText('Synthetic lineup note');
    harness.render();
    await findNode(harness.output, (node) => node.props.accessibilityLabel === 'Save lineup notes')?.props.onPress();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], 'blh_lineup_notes_synthetic-game_synthetic-team');
    assert.equal(JSON.parse(writes[0][1]).notes, 'Synthetic lineup note');
    findNode(harness.output, (node) => node.props.accessibilityLabel === 'Cancel lineup notes')?.props.onPress();
    assert.equal(backs, 1);
  });

  it('keeps the real profile save callback and adds an adjacent cancel callback', async () => {
    const harness = createHookHarness();
    const updates: Record<string, unknown>[] = [];
    let backs = 0;
    const supabase = {
      auth: { getUser: async () => ({ data: { user: { id: 'synthetic-player' } } }) },
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.single = async () => ({ data: table === 'profiles' ? { full_name: 'Synthetic Player', position: 'C', avatar_url: null, self_assessed_skill: 'beginner' } : null });
        chain.maybeSingle = async () => ({ data: { jersey_number: 12 } });
        chain.update = (payload: Record<string, unknown>) => { updates.push(payload); return chain; };
        return chain;
      },
      storage: { from: () => ({}) },
    };
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/EditProfileScreen.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          ActivityIndicator: 'ActivityIndicator', Alert: { alert: () => undefined }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
          StyleSheet: { create: <T>(styles: T) => styles }, useWindowDimensions: () => ({ width: 390 }),
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        'expo-image-picker': {},
        '../components/Avatar': () => null,
        '../lib/supabase/client': { supabase },
        '../theme/colors': { default: { ...colors, bgBase: '#000', bgInteractive: '#222' } },
      },
    ).default;
    harness.mount(() => Screen({ navigation: { goBack: () => { backs += 1; } } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.render();
    const cancel = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Cancel profile editing');
    assert.ok(cancel);
    cancel.props.onPress();
    await findNode(harness.output, (node) => node.props.accessibilityLabel === 'Save profile changes')?.props.onPress();
    assert.equal(backs, 2);
    assert.deepEqual(updates, [{ full_name: 'Synthetic Player', position: 'C', self_assessed_skill: 'beginner' }]);
  });

  it('executes the real player-card Share callback with the loaded synthetic identity', async () => {
    const harness = createHookHarness();
    const shares: Record<string, unknown>[] = [];
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/PlayerCardScreen.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
          Share: { share: async (payload: Record<string, unknown>) => { shares.push(payload); } },
          StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
        '../components/Avatar': () => null, '../components/BrandAtmosphere': () => null,
        '../components/SectionHeader': () => null, '../components/TeamLogo': () => null,
        '../lib/supabase/playerPage': { loadHockeyLifePlayerPage: async () => ({
          playerId: 'synthetic-player', rosterId: 'roster-1', fullName: 'Synthetic Player', photoUrl: null,
          position: null, leadershipRole: null, jerseyNumber: null, isGoalie: false, team: null,
          seasons: [], selectedSeasonId: null, selectedSeasonName: null, isCareer: true, metrics: null,
          careerRows: [], badges: [], games: [], matchups: [], articles: [],
        }) },
        '../theme/colors': { default: { ...colors, primary: '#0ff', bgBase: '#000', brandArena: '#00f', brandGold: '#fc0', bgElevated: '#222', bgInteractive: '#222', glassStroke: '#333' } },
        '../theme/contrast': { getContrastTextColor: () => '#000' },
      },
    ).default;
    harness.mount(() => Screen({ route: { params: { playerId: 'synthetic-player', leagueId: null } }, navigation: { goBack: () => undefined, navigate: () => undefined } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.render();
    const share = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Share player card');
    assert.ok(share);
    await share.props.onPress();
    assert.deepEqual(shares, [{ title: 'Synthetic Player · Hockey Life Player', message: 'Synthetic Player · Hockey Life Player\nCareer stats and history in the Hockey Life app.' }]);
  });
});
