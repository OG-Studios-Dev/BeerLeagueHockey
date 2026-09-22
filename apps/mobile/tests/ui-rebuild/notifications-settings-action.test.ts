import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

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

async function mountNotificationSettings() {
  const harness = createHookHarness();
  const passthrough = ({ children, ...props }: Record<string, unknown>) => createElement('View', props, children);
  const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/NotificationSettingsScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: <T>(styles: T) => styles },
        Switch: 'Switch', Text: 'Text', View: 'View',
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => undefined },
      '../components/CardFocus': { FocusCard: passthrough, FocusScrollView: passthrough },
      '../context/LeagueContext': { useLeague: () => ({ activeLeague: null }) },
      '../lib/notifications': { cancelAllGameReminders: async () => undefined, registerForPushNotifications: async () => null, scheduleGameReminder: async () => undefined },
      '../lib/supabase/data': { getSchedule: async () => [], getCurrentSeason: async () => null, mapGameStatus: () => 'Upcoming' },
      '../lib/supabase/client': { supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } },
      '../theme/colors': { default: { primary: '#0ff', bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333' } },
    },
  ).default;
  harness.mount(() => Screen({ navigation: { goBack: () => undefined } }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  harness.render();
  return harness;
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

  it('renders only the working local game-reminder setting with truthful scope', async () => {
    const harness = await mountNotificationSettings();
    const copy = nodeText(harness.output);
    assert.match(copy, /Game Reminders/);
    assert.match(copy, /Local alerts 2 hours before currently listed upcoming team games/);
    assert.doesNotMatch(copy, /Check-in Reminders|Score Alerts|League Announcements/);

    const switches: unknown[] = [];
    const visit = (root: unknown) => {
      if (Array.isArray(root)) return root.forEach(visit);
      if (!root || typeof root !== 'object' || !('props' in root)) return;
      const node = root as { type: unknown; props: Record<string, unknown> };
      if (node.type === 'Switch') switches.push(node);
      visit(node.props.children);
    };
    visit(harness.output);
    assert.equal(switches.length, 1);
  });
});
