import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url).toString()), 'utf8');
}

describe('mobile shell chrome contract', () => {
  it('removes the tab league header and lets every main page own the top safe area', () => {
    const navigation = source('src/navigation/index.tsx');
    assert.match(navigation, /screenOptions=\{\(\) => \(\{[\s\S]*?headerShown:\s*false,/);
    assert.doesNotMatch(navigation, /LeagueSwitcher|AppHeaderBackground|headerTitle:/);
    assert.match(navigation, /tabBar=\{\(props\) => <MobileWebDock \{\.\.\.props\} \/>\}/);

    const dock = source('src/navigation/MobileWebDock.tsx');
    assert.match(dock, /dockOuter:\s*\{[^}]*backgroundColor:\s*'transparent'/);
    assert.match(dock, /dockOuter:\s*\{[^}]*position:\s*'absolute'/);
    assert.match(dock, /dockShadow:\s*\{[\s\S]*?backgroundColor:\s*'#080F1C'/);

    const app = source('App.tsx');
    assert.match(app, /<NavigationContainer theme=\{APP_NAVIGATION_THEME\}>/);
    assert.doesNotMatch(app, /tabBarBackground|dockShadow|dockOuter/);

    const mainPageSources = [
      'src/screens/HomeScreen.tsx',
      'src/screens/StandingsScreen.tsx',
      'src/screens/ScheduleScreen.tsx',
      'src/screens/StatsScreen.tsx',
      'src/screens/TeamScreen.tsx',
      'src/screens/ProfileScreen.tsx',
      'src/screens/discover/LeagueDiscoveryScreen.tsx',
    ].map(source);
    for (const page of mainPageSources) {
      assert.match(page, /edges=\{\['top', 'left', 'right'\]\}/);
      assert.doesNotMatch(page, /edges=\{\['left', 'right'\]\}/);
    }

    const common = source('src/screens/league-pages/LeaguePageCommon.tsx');
    assert.match(common, /<SafeAreaView edges=\{\['top', 'left', 'right'\]\}/);
    assert.match(common, /<Text accessibilityRole="header" style=\{styles\.title\}>\{title\}<\/Text>/);
  });

  it('removes handcrafted page-title/back bars while retaining content and modal controls', () => {
    const titledBarFiles = [
      'src/screens/EditProfileScreen.tsx',
      'src/screens/GamePreviewScreen.tsx',
      'src/screens/NotificationSettingsScreen.tsx',
      'src/screens/NotificationsFeedScreen.tsx',
      'src/screens/PlayerCardScreen.tsx',
      'src/screens/TeamScreen/TeamDetailScreen.tsx',
      'src/screens/captain/CaptainDashboardScreen.tsx',
      'src/screens/captain/GameAvailabilityScreen.tsx',
      'src/screens/captain/InvitePlayersScreen.tsx',
      'src/screens/captain/LineupNotesScreen.tsx',
      'src/screens/discover/LeagueDetailScreen.tsx',
      'src/screens/games/GameRecapScreen.tsx',
      'src/screens/stats/CareerStatsScreen.tsx',
      'src/screens/stats/LeaderboardsScreen.tsx',
      'src/screens/team/TeamChatScreen.tsx',
    ];
    for (const path of titledBarFiles) {
      assert.doesNotMatch(source(path), /styles\.headerTitle/);
    }

    const marketplace = source('src/components/LeagueMarketplace.tsx');
    assert.doesNotMatch(marketplace, /\{\/\* Header \*\/\}|canGoBack|styles\.backButton/);
    assert.match(marketplace, /accessibilityLabel="Close league details"/);

    assert.doesNotMatch(source('src/screens/league-pages/ContactScreen.tsx'), /const back =/);
    assert.doesNotMatch(source('src/screens/league-pages/EventsScreen.tsx'), /const back =/);
    assert.doesNotMatch(source('src/screens/league-pages/NewsArticleScreen.tsx'), /Back to News/);
    const gallery = source('src/screens/league-pages/GalleryAlbumScreen.tsx');
    assert.doesNotMatch(gallery, /Back to Gallery/);
    assert.match(gallery, /accessibilityLabel="Close photo viewer"/);

    const lineup = source('src/screens/captain/LineupNotesScreen.tsx');
    assert.match(lineup, /accessibilityLabel="Save lineup notes"/);
    const player = source('src/screens/PlayerCardScreen.tsx');
    assert.match(player, /accessibilityLabel="Share player card"/);
    const updates = source('src/screens/NotificationsFeedScreen.tsx');
    assert.match(updates, /accessibilityLabel="Notification settings"/);
  });

  it('removes main-route title rows without removing their content actions', () => {
    const home = source('src/screens/HomeScreen.tsx');
    assert.doesNotMatch(home, /testID="home-editorial-header"/);
    assert.match(home, /accessibilityLabel="Updates"/);

    const standings = source('src/screens/StandingsScreen.tsx');
    assert.doesNotMatch(standings, /SectionHeader title="Standings"/);
    assert.match(standings, /Choose a league for standings/);

    const schedule = source('src/screens/ScheduleScreen.tsx');
    assert.doesNotMatch(schedule, /SectionHeader title=\{standalone \? initialTab : 'Schedule'\}/);
    assert.match(schedule, /SectionHeader title="Conflict Watch"/);

    const stats = source('src/screens/StatsScreen.tsx');
    assert.doesNotMatch(stats, /SectionHeader title="(?:Stats|League Leaders)"/);
    assert.match(stats, /testID="stats-leaderboards-action"/);

    const team = source('src/screens/TeamScreen.tsx');
    assert.doesNotMatch(team, /<SectionHeader title=\{?(?:"My Team"|"My Teams"|teamName)\}?/);
    assert.match(team, /testID="team-list-identity-card"[\s\S]*?accessibilityLabel=\{`Open \$\{teamName\} team details`\}/);

    const discover = source('src/screens/discover/LeagueDiscoveryScreen.tsx');
    assert.doesNotMatch(discover, /SectionHeader title="Discover Leagues"/);
    assert.match(discover, /\{filteredLeagues\.length\} league/);
  });

  function mountLeagueSelection({
    leagues,
    activeLeague,
    loading = false,
    onComplete,
  }: {
    leagues: Array<{ id: string; name: string; city: string; logoUrl: null; theme: { primaryColor: string } }>;
    activeLeague: { id: string } | null;
    loading?: boolean;
    onComplete?: () => void;
  }) {
    const harness = createHookHarness();
    const selected: Array<string | null> = [];
    let dismissals = 0;
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/auth/LeagueSelectScreen.tsx', import.meta.url),
      {
        react: harness.react,
        '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
        'expo-linking': { openURL: async () => undefined },
        'react-native': {
          ActivityIndicator: 'ActivityIndicator', FlatList: (props: Record<string, unknown>) => createElement(
            'FlatList',
            props,
            props.ListHeaderComponent,
            leagues.length ? leagues.map((item) => (props.renderItem as (input: { item: unknown }) => unknown)({ item })) : props.ListEmptyComponent,
            props.ListFooterComponent,
          ),
          Pressable: 'Pressable', StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 }, Text: 'Text', View: 'View',
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '../../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
        '../../context/LeagueContext': { useLeague: () => ({ availableLeagues: leagues, activeLeague, isLoading: loading, setActiveLeague: (next: { id: string } | null) => { selected.push(next?.id ?? null); } }) },
        '../../lib/supabase/leagues': { getPublicLeagues: () => new Promise(() => {}) },
        '../../theme/colors': { default: { primary: '#00ffff', textPrimary: '#fff', textSecondary: '#aaa', bgBase: '#000', bgSurface: '#111', borderCard: '#333' } },
      },
    ).default;

    harness.mount(() => Screen({ navigation: { goBack: () => { dismissals += 1; } }, onComplete }));
    return { harness, selected, get dismissals() { return dismissals; } };
  }

  it('selects and dismisses BLH Global View for null, zero-member, and multi-member states', () => {
    // Explicitly synthetic and confined to this offline component harness.
    const leagues = [
      { id: 'synthetic-league-a', name: 'Synthetic League A', city: 'Test City', logoUrl: null, theme: { primaryColor: '#00ffff' } },
      { id: 'synthetic-league-b', name: 'Synthetic League B', city: 'Test City', logoUrl: null, theme: { primaryColor: '#00ffff' } },
    ];
    for (const scenario of [
      { leagues: [] as typeof leagues, activeLeague: null },
      { leagues, activeLeague: leagues[0] },
    ]) {
      const mounted = mountLeagueSelection(scenario);
      const global = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'BLH Global View, All leagues');
      assert.ok(global);
      assert.equal(global.props.accessibilityState.selected, scenario.activeLeague === null);
      global.props.onPress();
      assert.deepEqual(mounted.selected, [null]);
      assert.equal(mounted.dismissals, 1);
      mounted.harness.unmount();
    }
  });

  it('keeps global and membership choices usable during provider/public loading and honors both dismissal contracts', () => {
    const league = { id: 'synthetic-league-b', name: 'Synthetic League B', city: 'Test City', logoUrl: null, theme: { primaryColor: '#00ffff' } };
    const standalone = mountLeagueSelection({ leagues: [league], activeLeague: null, loading: true });
    assert.ok(findNode(standalone.harness.output, (node) => node.props.accessibilityLabel === 'BLH Global View, All leagues'));
    const choice = findNode(standalone.harness.output, (node) => node.props.accessibilityLabel === 'Select Synthetic League B');
    assert.ok(choice);
    choice.props.onPress();
    assert.deepEqual(standalone.selected, ['synthetic-league-b']);
    assert.equal(standalone.dismissals, 1);

    let completions = 0;
    const onboarding = mountLeagueSelection({ leagues: [league], activeLeague: null, onComplete: () => { completions += 1; } });
    findNode(onboarding.harness.output, (node) => node.props.accessibilityLabel === 'Select Synthetic League B')?.props.onPress();
    assert.deepEqual(onboarding.selected, ['synthetic-league-b']);
    assert.equal(completions, 1);
    assert.equal(onboarding.dismissals, 0);
  });
});
