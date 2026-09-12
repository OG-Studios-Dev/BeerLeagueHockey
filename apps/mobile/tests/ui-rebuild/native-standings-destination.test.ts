import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const leagueA = {
  id: 'league-a', name: 'League A', slug: 'league-a', logoUrl: null, city: null,
  theme: { backgroundColor: '#010203', primaryColor: '#00ffff' },
};

function createRenderedScreens(activeLeague: typeof leagueA | null) {
  const harness = createHookHarness();
  let league = activeLeague;
  let authReads = 0;
  let standingsReads = 0;
  const selected: string[] = [];
  const leagueContext = () => ({
    activeLeague: league,
    activeTheme: league?.theme ?? { backgroundColor: '#000000', primaryColor: '#00ffff' },
    activeDivision: null,
    setActiveDivision: () => {},
    divisions: [],
    isGuestLeague: false,
    availableLeagues: [leagueA],
    setActiveLeague: (next: typeof leagueA) => { selected.push(next.id); league = next; },
  });
  const reactNative = {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }: Record<string, any>) =>
      createElement('FlatList', props, ListHeaderComponent, ...data.map((item: unknown, index: number) => renderItem({ item, index }))),
    Pressable: 'Pressable',
    StyleSheet: { create: <T>(value: T) => value },
    Text: 'Text',
    View: 'View',
  };
  const ScheduleScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/ScheduleScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': reactNative,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      'expo-haptics': { impactAsync: () => {}, ImpactFeedbackStyle: { Light: 'light' } },
      '../components/DivisionFilter': () => null,
      '../components/GuestBanner': () => null,
      '../components/GameCard': (props: Record<string, unknown>) => createElement('GameCard', props),
      '../components/PillToggle': () => null,
      '../components/QuickCheckinActions': () => null,
      '../components/ScheduleConflictList': () => null,
      '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/LeagueContext': { useLeague: leagueContext },
      '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
      '../lib/supabase/checkins': {
        getMyCheckins: async () => ({}), getMyCheckinsForTeams: async () => ({}), updateCheckin: async () => ({ success: true }),
      },
      '../lib/supabase/client': {
        supabase: { auth: { getUser: async () => { authReads += 1; return { data: { user: null } }; } } },
      },
      '../lib/supabase/data': {
        getCurrentSeason: async () => ({ id: 'season-a', name: 'Current', start_date: '2026-01-01', end_date: null, status: 'active' }),
        getSchedule: async () => [],
        getStandings: async () => {
          standingsReads += 1;
          return [{
            team_id: 'team-owls', team_name: 'Ice Owls', primary_color: '#123456', logo_url: null,
            division_id: null, wins: 3, losses: 1, ties: 0, points: 6, goals_for: 10, goals_against: 4, games_played: 4,
          }];
        },
        mapGameStatus: () => 'Upcoming',
      },
      '../theme/colors': { default: { bgBase: '#000', bgSurface: '#111', borderCard: '#222', bgInteractive: '#333', textSecondary: '#aaa', textPrimary: '#fff', primary: '#0ff' } },
    },
  ).default;
  const StandingsScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/StandingsScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': reactNative,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
      '../context/LeagueContext': { useLeague: leagueContext },
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', borderCard: '#222' } },
      './ScheduleScreen': ScheduleScreen,
    },
  ).default;
  return { harness, ScheduleScreen, StandingsScreen, selected, counts: () => ({ authReads, standingsReads }) };
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

describe('native Standings dock destination', () => {
  it('renders a Standings-specific league chooser without mounting global Schedule work', () => {
    const screen = createRenderedScreens(null);
    screen.harness.mount(() => screen.StandingsScreen({ navigation: { navigate: () => {} } }));

    assert.match(nodeText(screen.harness.output), /Choose a league for standings/);
    assert.doesNotMatch(nodeText(screen.harness.output), /Upcoming games across every BLH league/);
    assert.deepEqual(screen.counts(), { authReads: 0, standingsReads: 0 });

    const choice = findNode(screen.harness.output, (node) => node.props.testID === 'standings-league-choice-league-a');
    choice?.props.onPress();
    assert.deepEqual(screen.selected, ['league-a']);
  });

  it('preserves the default Schedule cross-league upcoming content', () => {
    const screen = createRenderedScreens(null);
    screen.harness.mount(() => screen.ScheduleScreen({ navigation: { navigate: () => {} } }));
    assert.match(nodeText(screen.harness.output), /Upcoming games across every BLH league/);
  });

  it('renders selected-league standings rows through the existing Schedule helpers', async () => {
    const screen = createRenderedScreens(leagueA);
    screen.harness.mount(() => screen.StandingsScreen({ navigation: { navigate: () => {} } }));
    await settle(screen.harness);

    assert.match(nodeText(screen.harness.output), /Standings/);
    assert.match(nodeText(screen.harness.output), /Ice Owls/);
    assert.match(nodeText(screen.harness.output), /Ice Owls4316/);
    assert.ok(screen.counts().standingsReads > 0);
  });
});
