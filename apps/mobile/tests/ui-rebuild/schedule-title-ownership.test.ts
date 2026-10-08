import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { GameRow } from '../../src/lib/supabase/data.ts';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText, type TestNode } from './component-harness.ts';

const league = {
  id: 'league-a',
  name: 'Hockey Life',
  slug: 'hockey-life',
  logoUrl: null,
  city: 'London',
  theme: { backgroundColor: '#07111F', primaryColor: '#22D3EE' },
};
const season = { id: 'season-a', name: 'Winter', start_date: '2026-01-01', end_date: null, status: 'active' };
const game: GameRow = {
  id: 'game-a',
  home_team_id: 'home-a',
  away_team_id: 'away-a',
  home_score: null,
  away_score: null,
  scheduled_at: '2026-10-08T22:00:00.000Z',
  status: 'scheduled',
  location: 'Rink A',
  season_id: season.id,
  home_team: { id: 'home-a', name: 'Home A', primary_color: '#112233', logo_url: null },
  away_team: { id: 'away-a', name: 'Away A', primary_color: '#445566', logo_url: null },
};

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createScheduleComposition(loadScheduleSnapshot: () => Promise<unknown>) {
  const harness = createHookHarness();
  const passthrough = ({ children }: { children?: unknown }) => children ?? null;
  const reactNative = {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }: Record<string, any>) =>
      createElement('FlatList', props, ListHeaderComponent, ...data.map((item: unknown, index: number) => renderItem({ item, index }))),
    Pressable: 'Pressable',
    StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View',
  };
  const ScheduleScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/ScheduleScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': reactNative,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      'expo-haptics': { impactAsync: () => undefined, ImpactFeedbackStyle: { Light: 'light' } },
      '../components/DivisionFilter': (props: Record<string, unknown>) => createElement('DivisionFilter', props),
      '../components/GuestBanner': () => createElement('GuestBanner', null),
      '../components/QuickCheckinActions': (props: Record<string, unknown>) => createElement('QuickCheckinActions', props),
      '../components/ScheduleMatchupCard': (props: Record<string, any>) => createElement('ScheduleMatchupCard', props, props.game.id),
      '../components/ScheduleTeamFilter': (props: Record<string, unknown>) => createElement('ScheduleTeamFilter', props),
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague: league,
          activeTheme: league.theme,
          activeDivision: null,
          setActiveDivision: () => undefined,
          divisions: [],
          isGuestLeague: true,
        }),
      },
      '../lib/calendar': { addGameToCalendar: async () => undefined },
      '../lib/supabase/checkins': { getMyCheckinsForTeams: async () => ({}), updateCheckin: async () => ({ success: true }) },
      '../lib/supabase/client': { supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } },
      '../lib/supabase/schedule': { loadScheduleSnapshot },
      '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', borderCard: '#333' } },
    },
  ).default;

  const descriptor = (props: Record<string, unknown>) => createElement('ScreenDescriptor', props);
  const navigatorFactory = (type: string) => () => ({
    Screen: descriptor,
    Navigator: ({ children }: { children?: unknown }) => createElement(type, null, children),
  });
  const screenModule = { __esModule: true, default: () => null };
  const navigationMocks = new Proxy<Record<string, unknown>>({}, {
    has: () => true,
    get: (_target, id: string) => {
      if (id === 'react') return harness.react;
      if (id === 'react-native') return { StyleSheet: { create: <T>(value: T) => value }, View: 'View' };
      if (id === '@react-navigation/bottom-tabs') return { createBottomTabNavigator: navigatorFactory('TabNavigatorRuntime') };
      if (id === '@react-navigation/native-stack') return { createNativeStackNavigator: navigatorFactory('StackNavigatorRuntime') };
      if (id === '../context/AuthContext') return { useAuth: () => ({ isGuest: false, user: { id: 'viewer' } }) };
      if (id === '../context/LeagueContext') return { useLeague: () => ({ activeLeague: league, activeTheme: league.theme }) };
      if (id === '../context/FocusPauseContext') return { FocusPauseProvider: passthrough };
      if (id === './GuestBannerLayout') return { __esModule: true, default: passthrough };
      if (id === './MobileShellDataContext') return { MobileShellDataProvider: passthrough };
      if (id === './MobileWebDock') return screenModule;
      if (id === '../components/CutIceTitle') {
        return { __esModule: true, default: (props: Record<string, unknown>) => createElement('CutIceTitle', props) };
      }
      if (id === '../screens/ScheduleScreen') return { __esModule: true, default: ScheduleScreen };
      if (id === '../theme/colors') return { __esModule: true, default: { bgBase: '#000' } };
      return screenModule;
    },
  });
  const RootNavigation = compileCommonJs<{ default: () => unknown }>(
    new URL('../../src/navigation/index.tsx', import.meta.url),
    navigationMocks,
  ).default;
  const root = RootNavigation();
  const scheduleTab = findNode(root, (node) => node.type === 'ScreenDescriptor' && node.props.name === 'Schedule');
  assert.equal(typeof scheduleTab?.props.component, 'function');
  const scheduleStack = scheduleTab!.props.component();
  const scheduleRoute = findNode(scheduleStack, (node) => node.type === 'ScreenDescriptor' && node.props.name === 'ScheduleList');
  assert.ok(scheduleRoute);
  assert.equal(scheduleRoute.props.component, ScheduleScreen);

  const navigatorHeader = scheduleRoute.props.options.header({ navigation: { goBack: () => undefined }, back: undefined });
  const navigatorTitles = allNodes(navigatorHeader).filter((node) => node.type === 'CutIceTitle' && node.props.title === 'Schedule');
  assert.equal(navigatorTitles.length, 1, 'ScheduleList must retain one Cut Ice navigator title');

  harness.mount(() => scheduleRoute.props.component({ navigation: { navigate: () => undefined } }));
  return { harness, navigatorTitleCount: navigatorTitles.length };
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

function contentScheduleTitleCount(root: unknown) {
  return allNodes(root).filter((node) => node.props.accessibilityRole === 'header' && nodeText(node) === 'Schedule').length;
}

it('keeps the registered ScheduleList Cut Ice header as the only Schedule title in every screen state', async () => {
  const pending = deferred<unknown>();
  const loading = createScheduleComposition(() => pending.promise);
  assert.match(nodeText(loading.harness.output), /Loading schedule/);

  const error = createScheduleComposition(async () => { throw new Error('offline'); });
  await settle(error.harness);
  assert.match(nodeText(error.harness.output), /Couldn’t load schedule/);

  const ready = createScheduleComposition(async () => ({
    kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games: [game],
  }));
  await settle(ready.harness);
  assert.match(nodeText(ready.harness.output), /1 game/);

  const empty = createScheduleComposition(async () => ({
    kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games: [],
  }));
  await settle(empty.harness);
  assert.match(nodeText(empty.harness.output), /No games scheduled for Winter/);

  const filteredEmpty = createScheduleComposition(async () => ({
    kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games: [game],
  }));
  await settle(filteredEmpty.harness);
  const teamFilter = findNode(filteredEmpty.harness.output, (node) => node.type === 'ScheduleTeamFilter')!;
  teamFilter.props.onSelect('missing-team');
  filteredEmpty.harness.render();
  assert.match(nodeText(filteredEmpty.harness.output), /No games for Team unavailable in this schedule/);

  const states = { loading, error, ready, empty, filteredEmpty };
  assert.deepEqual(
    Object.fromEntries(Object.entries(states).map(([name, runtime]) => [
      name,
      runtime.navigatorTitleCount + contentScheduleTitleCount(runtime.harness.output),
    ])),
    { loading: 1, error: 1, ready: 1, empty: 1, filteredEmpty: 1 },
    'ScheduleScreen must not duplicate the ScheduleList navigator title in content',
  );
});
