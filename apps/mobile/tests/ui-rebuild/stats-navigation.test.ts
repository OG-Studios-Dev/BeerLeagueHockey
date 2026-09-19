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
      StyleSheet: { create: (styles: Record<string, Record<string, unknown>>) => { capturedStyles = styles; return styles; } },
      FlatList: (p: any) => createElement('FlatList', p, p.ListHeaderComponent, p.ListEmptyComponent),
    };
    const Screen = compileCommonJs<{ default: () => unknown }>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
      react: h.react, 'react-native': native, '@react-navigation/native': { useNavigation: () => navigation },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../components/DivisionFilter': () => null, '../components/GuestBanner': () => null,
      '../components/PillToggle': () => null, '../components/PlayerRow': () => null,
      '../components/SectionHeader': (p: any) => createElement('SectionHeader', p, p.title),
      '../components/StatsLeadersCard': { __esModule: true, default: () => null },
      '../context/LeagueContext': { useLeague: () => league },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
      '../navigation/playerCard': { navigateToPlayerCard() {} },
      '../lib/supabase/client': { supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) } },
      '../lib/supabase/data': { getStatsLeadersFromPublicSeason: () => [] },
      '../lib/supabase/team': { getMetricsOperationalSeason: async () => ({ season: { id: 'season-a' }, error: null }) },
      '../lib/supabase/publicStats': { getPublicSeasonStats: async () => ({ presentationSeason: { id: 'season-a' }, players: [] }), getPublicGoaliesV2: async () => ({ goalies: [], presentationSeason: { id: 'season-a' } }) },
      '../theme/colors': { __esModule: true, default: { bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', primary: '#0ff', glassHighlight: '#333' } },
    }).default;
    h.mount(() => Screen());
    const action = findNode(h.output, node => node.props.testID === 'stats-leaderboards-action');
    assert.match(nodeText(action), /Leaderboards/);
    assert.equal(action?.props.accessibilityRole, 'button');
    action?.props.onPress();
    assert.deepEqual(navigationCalls, [['Leaderboards']]);
    assert.equal(capturedStyles.headerWrap.flex, undefined, 'standalone global Stats header must not consume the list viewport');
    assert.equal(capturedStyles.headerWrap.paddingHorizontal, 16);
    assert.equal(capturedStyles.headerTitleWrap, undefined, 'active page-title row is removed');
    activeLeague = null; h.render();
    assert.equal(findNode(h.output, node => node.props.style === capturedStyles.headerWrap), undefined, 'empty global branch has no title row');
    league.availableLeagues.push({ id: 'league-a', name: 'League A', slug: 'league-a' }); h.render();
    assert.match(nodeText(h.output), /Hockey Life access required/);
    assert.doesNotMatch(nodeText(h.output), /Top skaters/);
    assert.equal(capturedStyles.headerTitleWrap, undefined);
    h.unmount();
  });
});
