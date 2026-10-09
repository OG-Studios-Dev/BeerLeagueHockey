/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

describe('Stats navigation', () => {
  it('shows an accessible Leaderboards action for an active league and opens the registered route', () => {
    const h = createHookHarness();
    let capturedStyles: Record<string, Record<string, unknown>> = {};
    const navigationCalls: any[][] = [];
    const navigation = { navigate: (...args: any[]) => navigationCalls.push(args) };
    let activeLeague: { id: string; name: string; slug: string } | null = { id: 'league-a', name: 'League A', slug: 'league-a' };
    const league = { get activeLeague() { return activeLeague; }, activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' }, activeDivision: null, setActiveDivision() {}, divisions: [], availableLeagues: [] as Array<{ id: string; name: string; slug: string }> };
    const native = {
      ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
      useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
      StyleSheet: { create: (styles: Record<string, Record<string, unknown>>) => { capturedStyles = styles; return styles; } },
      ScrollView: (p: any) => createElement('ScrollView', p, p.children),
      FlatList: (p: any) => createElement('FlatList', p, p.ListHeaderComponent, p.ListEmptyComponent, p.ListFooterComponent),
    };
    const Screen = compileCommonJs<{ default: () => unknown }>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
      react: h.react, 'react-native': native, '@react-navigation/native': { useNavigation: () => navigation },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../components/DivisionFilter': () => null, '../components/GuestBanner': () => null,
      '../components/PillToggle': () => null,
      '../components/StatsTable': { needsExpandedGoalieMetrics: () => false, StatsTableHeader: () => null, StatsTableRowView: () => null },
      '../components/StatsTimelineFilter': () => null,
      '../components/StatsLeadersCard': { __esModule: true, default: () => null },
      '../context/LeagueContext': { useLeague: () => league },
      '../navigation/playerCard': { navigateToPlayerCard() {} },
      '../lib/statsPresentationModel': { buildSkaterRows: () => [], buildGoalieRows: () => [], buildLeaderRows: () => [] },
      '../lib/supabase/publicStats': { getPublicStatsScope: async () => ({ players: [], seasons: [], scope: { label: 'Current season', currentSeasonId: 'season-a' } }) },
      '../theme/colors': { __esModule: true, default: { bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', primary: '#0ff', glassHighlight: '#333' } },
    }).default;
    h.mount(() => Screen());
    const action = findNode(h.output, node => node.props.testID === 'stats-leaderboards-action');
    assert.match(nodeText(action), /Leaderboards/);
    assert.equal(action?.props.accessibilityRole, 'button');
    action?.props.onPress();
    assert.deepEqual(navigationCalls, [['Leaderboards']]);
    assert.equal(capturedStyles.horizontalOverflow.width, '100%', 'Stats content is constrained to the viewport');
    assert.equal(capturedStyles.content.paddingHorizontal, 16);
    activeLeague = null; h.render();
    assert.equal(findNode(h.output, node => node.props.style === capturedStyles.horizontalOverflow), undefined, 'empty global branch has no stats viewport');
    league.availableLeagues.push({ id: 'league-a', name: 'League A', slug: 'league-a' }); h.render();
    assert.match(nodeText(h.output), /Hockey Life access required/);
    assert.doesNotMatch(nodeText(h.output), /Top skaters/);
    h.unmount();
  });
});
