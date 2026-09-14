import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness';

function mountNotifications(getUser: () => Promise<unknown>) {
  const harness = createHookHarness();
  const navigationCalls: unknown[][] = [];
  const passthrough = ({ children, ...props }: Record<string, unknown>) => createElement('View', props, children);
  const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/NotificationsFeedScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
        ScrollView: passthrough, Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 390 }),
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-linear-gradient': { LinearGradient: passthrough },
      'expo-linking': { openURL: async () => undefined },
      'expo-haptics': { ImpactFeedbackStyle: { Light: 'light' }, impactAsync: async () => undefined },
      '../components/BrandAtmosphere': () => null,
      '../components/QuickCheckinActions': () => null,
      '../components/RevealView': passthrough,
      '../components/ScheduleConflictList': () => null,
      '../components/SectionHeader': () => null,
      '../components/TeamLogo': () => null,
      '../context/LeagueContext': { useLeague: () => ({ activeLeague: null, availableLeagues: [], setActiveLeague: () => undefined }) },
      '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
      '../lib/calendar': { addGameToCalendar: async () => undefined },
      '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
      '../lib/supabase/checkins': { getMyCheckinsForTeams: async () => ({}), updateCheckin: async () => ({ success: true }) },
      '../lib/supabase/client': { supabase: { auth: { getUser } } },
      '../theme/colors': { default: { primary: '#0ff', bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000', brandGold: '#fc0', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', glassStroke: '#444', accentGreen: '#0f0', accentRed: '#f00' } },
    },
  ).default;
  harness.mount(() => Screen({ navigation: { navigate: (...args: unknown[]) => navigationCalls.push(args), goBack: () => undefined } }));
  return { harness, navigationCalls };
}

describe('Notifications settings action', () => {
  it('remains actionable while the independent feed request is pending', () => {
    const runtime = mountNotifications(() => new Promise(() => {}));
    const action = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Notification settings');
    assert.ok(action);
    action.props.onPress();
    assert.deepEqual(runtime.navigationCalls, [['NotificationSettings']]);
  });

  it('remains actionable after feed success and a handled feed error', async () => {
    const scenarios = [
      { getUser: async () => ({ data: { user: null } }), error: false },
      { getUser: async () => { throw new Error('Synthetic offline feed failure'); }, error: true },
    ];
    for (const scenario of scenarios) {
      const runtime = mountNotifications(scenario.getUser);
      await new Promise<void>((resolve) => setImmediate(resolve));
      runtime.harness.render();
      const action = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === 'Notification settings');
      assert.ok(action);
      action.props.onPress();
      assert.deepEqual(runtime.navigationCalls, [['NotificationSettings']]);
      assert.equal(Boolean(findNode(runtime.harness.output, (node) => node.props.testID === 'notifications-feed-error')), scenario.error);
      runtime.harness.unmount();
    }
  });
});
