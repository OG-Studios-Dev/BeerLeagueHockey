import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';
import * as standingsModel from '../../src/lib/standingsModel.ts';

const leagueA = {
  id: 'league-a', name: 'League A', slug: 'league-a', logoUrl: null, city: null,
  theme: { backgroundColor: '#010203', primaryColor: '#00ffff' },
};
const leagueB = { ...leagueA, id: 'league-b', name: 'League B', slug: 'league-b' };

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
      'expo-haptics': { impactAsync: () => {}, ImpactFeedbackStyle: { Light: 'light' } },
      '../components/DivisionFilter': () => null,
      '../components/GuestBanner': () => null,
      '../components/SeasonCompletionHump': (props: Record<string, unknown>) => createElement('SeasonCompletionHump', props),
      '../components/StandingsPlayoffsPanel': (props: Record<string, unknown>) => createElement('StandingsPlayoffsPanel', props, createElement('Text', null, 'Playoffs')),
      '../components/GameCard': (props: Record<string, unknown>) => createElement('GameCard', props),
      '../components/PillToggle': () => null,
      '../components/QuickCheckinActions': () => null,
      '../components/ScheduleConflictList': () => null,
      '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/LeagueContext': { useLeague: leagueContext },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }) },
      '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
      '../lib/supabase/checkins': {
        getMyCheckins: async () => ({}), getMyCheckinsForTeams: async () => ({}), updateCheckin: async () => ({ success: true }),
      },
      '../lib/supabase/client': {
        supabase: { auth: { getUser: async () => { authReads += 1; return { data: { user: null } }; } } },
      },
      '../lib/supabase/data': {
        getCurrentSeason: async () => ({ id: 'season-a', name: 'Current', start_date: '2026-01-01', end_date: null, status: 'active' }),
        getOperationalSeason: async (leagueId: string) => ({ id: leagueId === leagueB.id ? 'season-b' : 'season-a', name: 'Current', start_date: '2026-01-01', end_date: null, status: 'active' }),
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
      '../components/CardFocus': {
        FocusCard: ({ children, ...props }: Record<string, unknown>) => createElement('FocusCard', props, children),
        FocusScrollView: ({ children, ...props }: Record<string, unknown>) => createElement('FocusScrollView', props, children),
      },
      '../components/DivisionFilter': () => null,
      '../components/GuestBanner': () => null,
      '../components/SeasonCompletionHump': (props: Record<string, unknown>) => createElement('SeasonCompletionHump', props),
      '../components/StandingsPlayoffsPanel': (props: Record<string, unknown>) => createElement('StandingsPlayoffsPanel', props, createElement('Text', null, 'Playoffs')),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../components/TeamPositioningChart': (props: Record<string, unknown>) => createElement('TeamPositioningChart', props),
      '../context/LeagueContext': { useLeague: leagueContext },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }) },
      '../lib/leaguePages': { getLeaguePage: async (_slug: string, page: string) => page === 'playoffs'
        ? { previewConfig: { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false } }
        : { positioning: null } },
      '../lib/leaguePagesModel': { filterAndRerankPositioning: (value: unknown) => value },
      '../lib/standingsModel': standingsModel,
      '../lib/supabase/data': {
        getOperationalSeason: async (leagueId: string) => ({ id: leagueId === leagueB.id ? 'season-b' : 'season-a', name: 'Current', start_date: '2026-01-01', end_date: null, status: 'active' }),
        getSchedule: async () => [{ id: 'game-1', home_team_id: 'team-owls', away_team_id: 'team-foxes', status: 'completed', game_type: 'regular' }],
        getStandings: async (leagueId: string) => {
          standingsReads += 1;
          return [{ team_id: leagueId === leagueB.id ? 'team-b' : 'team-owls', team_name: leagueId === leagueB.id ? 'Blue Blades' : 'Ice Owls', primary_color: '#123456', logo_url: null, division_id: null, wins: 3, losses: 1, ties: 0, points: 6, goals_for: 10, goals_against: 4, games_played: 4 }];
        },
      },
      '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#222', glassStroke: '#333' } },
    },
  ).default;
  return { harness, ScheduleScreen, StandingsScreen, selected, switchLeague: (next: typeof leagueA) => { league = next; harness.render(); }, counts: () => ({ authReads, standingsReads }) };
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

describe('native Standings dock destination', () => {
  it('renders a Hockey-Life-specific access state without mounting Schedule work', () => {
    const screen = createRenderedScreens(null);
    screen.harness.mount(() => screen.StandingsScreen({ navigation: { navigate: () => {} } }));

    assert.match(nodeText(screen.harness.output), /Hockey Life access required/);
    assert.deepEqual(screen.counts(), { authReads: 0, standingsReads: 0 });
    assert.deepEqual(screen.selected, []);
  });

  it('fails Schedule closed instead of exposing a cross-league fallback', () => {
    const screen = createRenderedScreens(null);
    screen.harness.mount(() => screen.ScheduleScreen({ navigation: { navigate: () => {} } }));
    assert.match(nodeText(screen.harness.output), /Hockey Life access required/);
    assert.deepEqual(screen.selected, []);
  });

  it('renders selected-league standings and enhancement sections natively', async () => {
    const screen = createRenderedScreens(leagueA);
    screen.harness.mount(() => screen.StandingsScreen({ navigation: { navigate: () => {} } }));
    await settle(screen.harness);

    assert.match(nodeText(screen.harness.output), /Standings/);
    assert.match(nodeText(screen.harness.output), /Ice Owls/);
    assert.match(nodeText(screen.harness.output), /Playoffs/);
    assert.match(nodeText(screen.harness.output), /Season Completion/);
    assert.ok(screen.counts().standingsReads > 0);
  });

  it('B5 never renders completed facts beneath a different mounted league scope', async () => {
    const screen = createRenderedScreens(leagueA);
    screen.harness.mount(() => screen.StandingsScreen({ navigation: { navigate: () => {} } }));
    await settle(screen.harness);
    assert.match(nodeText(screen.harness.output), /Ice Owls/);
    screen.switchLeague(leagueB);
    assert.doesNotMatch(nodeText(screen.harness.output), /Ice Owls/);
    await settle(screen.harness);
    assert.match(nodeText(screen.harness.output), /Blue Blades/);
    assert.ok(findNode(screen.harness.output, (node) => node.props.testID === 'standings-scope:league-b:season-b'));
  });
});
