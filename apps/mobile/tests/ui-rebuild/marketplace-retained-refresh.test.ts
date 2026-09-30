import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, nodeText } from './component-harness';
import { notifyProfilePreferencesChanged } from '../../src/lib/profileContract';

describe('retained marketplace profile fallback', () => {
  it('reloads its profile-derived rating after a confirmed-save invalidation', async () => {
    const harness = createHookHarness();
    let loads = 0;
    const league = {
      id: 'league-1', name: 'Hockey Life', short_name: null, slug: 'hockey-life', logo_url: null, city: null,
      distanceKm: null, primary_color: '#0ff', fitLabel: 'Competitive fit', fitColor: '#0f0', fitScore: 1,
      leagueMedianRating: null, leagueRatingRange: null,
    };
    const Component = compileCommonJs<{ default: (props: any) => unknown }>(
      new URL('../../src/components/LeagueMarketplace.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          Alert: { alert: () => undefined }, FlatList: 'FlatList', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
          StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: {} }, Text: 'Text', TextInput: 'TextInput',
          TouchableOpacity: 'TouchableOpacity', useWindowDimensions: () => ({ width: 390, height: 844 }), View: 'View',
        },
        '@expo/vector-icons': { Ionicons: 'Ionicons' }, 'expo-linking': { openURL: async () => undefined, openSettings: () => undefined },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: false, reduceTransparency: false }) },
        '../context/AuthContext': { useAuth: () => ({ session: { user: { id: 'player-1' } }, isGuest: false, exitGuest: () => undefined }) },
        '../context/LeagueContext': { useLeague: () => ({
          availableLeagues: [], setActiveLeague: () => undefined, membershipStatus: 'empty', membershipDiagnostics: { entries: [] }, retryMemberships: () => undefined,
        }) },
        '../lib/leagueMarketplace': { getLeagueMarketplace: async () => {
          loads += 1;
          return { leagues: [league], userRating: loads === 1 ? 'D' : 'A+', userTier: loads === 1 ? 3 : 11 };
        } },
        '../lib/supabase/client': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'player-1' } }, error: null }) } } },
        '../theme/colors': { __esModule: true, default: {
          bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', primary: '#0ff', textPrimary: '#fff',
          textSecondary: '#aaa', textOnPrimary: '#000', accentGreen: '#0f0', accentRed: '#f00', glassStrokeStrong: '#333',
        } },
        '../theme/contrast': { getContrastTextColor: () => '#fff' }, './MembershipDiagnosticsCard': { default: 'MembershipDiagnosticsCard' }, './TeamLogo': { default: 'TeamLogo' },
      },
    ).default;
    harness.mount(() => Component({}));
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.render();
    assert.equal(loads, 1);
    let list = findNode(harness.output, (node) => node.type === 'FlatList');
    assert.ok(list);
    assert.match(nodeText(list.props.ListHeaderComponent), /Your Rating:D/);

    notifyProfilePreferencesChanged();
    harness.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.render();

    assert.equal(loads, 2);
    list = findNode(harness.output, (node) => node.type === 'FlatList');
    assert.ok(list);
    assert.match(nodeText(list.props.ListHeaderComponent), /Your Rating:A\+/);
  });
});
