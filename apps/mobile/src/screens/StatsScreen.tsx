import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DivisionFilter from '../components/DivisionFilter';
import { FocusFlatList } from '../components/CardFocus';
import { SelectableControl, SelectableControlGroup } from '../components/SelectableControl';
import { SECTION_HEADING_TEXT_STYLE } from '../components/SectionHeader';
import StatsLeadersCard, { type StatsLeaderMetric } from '../components/StatsLeadersCard';
import StatsRankedRow from '../components/StatsRankedRow';
import StatsRoleToggle from '../components/StatsRoleToggle';
import StatsTimelineFilter from '../components/StatsTimelineFilter';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import { buildRankedRows } from '../lib/statsPresentationModel';
import { getPublicStatsScope, type PublicStatsScope, type PublicStatsScopeSelection } from '../lib/supabase/publicStats';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import { navigateToPlayerCard } from '../navigation/playerCard';
import type { StatsStackParamList } from '../navigation/types';
import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';

type PlayerMetric = Extract<StatsLeaderMetric, 'goals' | 'assists' | 'points'>;
type StatsView = { role: 'player'; metric: PlayerMetric } | { role: 'goalie'; metric: 'gaa' };
type Snapshot = { key: string; status: 'loading' | 'ready' | 'error'; payload: PublicStatsScope | null };
const PLAYER_METRICS: ReadonlyArray<{ key: PlayerMetric; label: string }> = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'points', label: 'Points' },
];
const emptySnapshot = (key = ''): Snapshot => ({ key, status: 'loading', payload: null });

function selectionKey(selection: PublicStatsScopeSelection) {
  return `${selection.kind}:${[...(selection.seasonIds ?? [])].sort().join(',')}`;
}

export default function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StatsStackParamList>>();
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions } = useLeague();
  const { reduceTransparency } = useAccessibilityPreferences();
  const surfaces = getSurfacePalette(reduceTransparency);
  const inactiveControlStyle = reduceTransparency ? { backgroundColor: surfaces.interactive, borderColor: surfaces.stroke } : undefined;
  const selectedControlStyle = reduceTransparency ? { backgroundColor: surfaces.elevated, borderColor: '#A78BFA' } : undefined;
  const inactivePressedControlStyle = reduceTransparency ? { opacity: 1, backgroundColor: surfaces.surface, borderColor: '#61E2E8' } : undefined;
  const selectedPressedControlStyle = reduceTransparency ? { opacity: 1, backgroundColor: surfaces.interactive, borderColor: '#C8B8FF' } : undefined;
  const divisionControlStyles = reduceTransparency ? {
    selected: selectedControlStyle,
    inactive: inactiveControlStyle,
    selectedPressed: selectedPressedControlStyle,
    inactivePressed: inactivePressedControlStyle,
  } : undefined;
  const [statsView, setStatsView] = React.useState<StatsView>({ role: 'player', metric: 'points' });
  const [selection, setSelection] = React.useState<PublicStatsScopeSelection>({ kind: 'current' });
  const [retry, setRetry] = React.useState(0);
  const { width } = useWindowDimensions();
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => emptySnapshot());
  const leagueId = activeLeague?.id ?? '';
  const leagueSlug = activeLeague?.slug ?? '';
  const selectedDivisionId = activeDivision?.id ?? null;
  const requestDivisionId = selection.kind === 'all' ? null : selectedDivisionId;
  const requestKey = `${leagueId}:${leagueSlug}:${requestDivisionId ?? ''}:${selectionKey(selection)}:${retry}`;
  const previousLeagueId = React.useRef(leagueId);

  React.useEffect(() => {
    if (previousLeagueId.current && previousLeagueId.current !== leagueId) setSelection({ kind: 'current' });
    previousLeagueId.current = leagueId;
  }, [leagueId]);

  React.useEffect(() => {
    let mounted = true;
    if (!leagueId || !leagueSlug) return;
    setSnapshot(emptySnapshot(requestKey));
    void getPublicStatsScope(leagueSlug, leagueId, selection, requestDivisionId)
      .then((payload) => { if (mounted) setSnapshot({ key: requestKey, status: 'ready', payload }); })
      .catch(() => { if (mounted) setSnapshot({ key: requestKey, status: 'error', payload: null }); });
    return () => { mounted = false; };
  }, [leagueId, leagueSlug, requestDivisionId, requestKey, selection]);

  if (!activeLeague) {
    return <SafeAreaView style={styles.safeArea} edges={cutIceContentEdges(['top', 'left', 'right'])}><View style={styles.emptyWrap}><Text style={styles.emptyTitle}>Hockey Life access required</Text><Text style={styles.emptyBody}>Your account does not have an accessible Hockey Life membership.</Text></View></SafeAreaView>;
  }

  const view = snapshot.key === requestKey ? snapshot : emptySnapshot(requestKey);
  const players = view.payload?.players ?? [];
  const selectedTab = statsView.role === 'goalie' ? 'Goalies' : 'Skaters';
  const leaderMetric = statsView.metric;
  const rankedRows = buildRankedRows(players, leaderMetric);
  const leaders = rankedRows.slice(0, 5);
  const scopeLabel = view.payload?.scope.label ?? (selection.kind === 'current' ? 'Current season' : selection.kind === 'all' ? 'All time' : selection.kind === 'single' ? 'One season' : `${selection.seasonIds?.length ?? 0} seasons`);
  const openPlayer = (playerId: string) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id });
  const timeline = <StatsTimelineFilter label={scopeLabel} currentSeasonId={view.payload?.scope.currentSeasonId ?? null} seasons={view.payload?.seasons ?? []} selection={selection} onApply={setSelection} />;
  const selectRole = (role: 'player' | 'goalie') => {
    setStatsView((current) => current.role === role
      ? current
      : role === 'goalie' ? { role: 'goalie', metric: 'gaa' } : { role: 'player', metric: 'points' });
  };
  const selectMetric = (metric: StatsLeaderMetric) => setStatsView((current) => (
    current.role === 'player' && metric !== 'gaa' ? { role: 'player', metric } : current
  ));
  const roleControls = <View testID="stats-role-controls" style={styles.roleControls}>
    {timeline}
    <StatsRoleToggle role={selectedTab === 'Goalies' ? 'goalie' : 'player'} onSelectRole={selectRole} />
  </View>;
  const availableMetrics: ReadonlyArray<{ key: StatsLeaderMetric; label: string }> = selectedTab === 'Goalies'
    ? [{ key: 'gaa', label: 'GAA' }]
    : PLAYER_METRICS;

  return (
    <SafeAreaView style={styles.safeArea} edges={cutIceContentEdges(['top', 'left', 'right'])}>
      <FocusFlatList
        focusScopeKey={`stats:${requestKey}:${leaderMetric}`}
        testID="stats-page-list"
        style={styles.horizontalOverflow}
        contentContainerStyle={styles.content}
        data={view.status === 'ready' ? rankedRows : []}
        keyExtractor={(row) => row.playerId}
        ListHeaderComponent={<>
          <View testID="stats-page-controls" style={styles.pageControls}>
            {roleControls}
            <SelectableControlGroup testID="stats-metric-selector" role="tablist" horizontal={false} accessibilityLabel={`${selectedTab === 'Goalies' ? 'Goalie' : 'Player'} stat metric`} contentContainerStyle={styles.metricSelector}>
              {availableMetrics.map(({ key, label }) => {
                const isSelected = leaderMetric === key;
                return <SelectableControl key={key} testID={`stats-metric-tab-${key}`} role="tab" label={label} accessibilityLabel={`Show ${label} stats`} selected={isSelected} onPress={() => selectMetric(key)} style={styles.metricOption} selectedStyle={selectedControlStyle} inactiveStyle={inactiveControlStyle} pressedStyle={isSelected ? selectedPressedControlStyle : inactivePressedControlStyle} />;
              })}
            </SelectableControlGroup>
          </View>
          {selection.kind === 'all'
            ? <View testID="stats-all-time-league-wide" accessible accessibilityRole="text" accessibilityLabel="All time is league-wide. Division filters are unavailable for All time." style={[styles.leagueWideNotice, reduceTransparency && { backgroundColor: surfaces.surface, borderColor: surfaces.stroke }]}><Text style={styles.leagueWideNoticeText}>All time is league-wide. Division filters are unavailable.</Text></View>
            : <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} controlStyles={divisionControlStyles} />}
          <StatsLeadersCard leagueId={activeLeague.id} width={width} metric={leaderMetric} leaders={leaders} status={view.status} onRetry={() => setRetry((value) => value + 1)} onOpenPlayer={openPlayer} />
          <View style={styles.tableHeading}><Text accessibilityRole="header" style={styles.tableTitle}>{selectedTab === 'Goalies' ? 'Goalie Stats' : 'Player Stats'}</Text></View>
          <Text style={styles.scopeCopy}>{scopeLabel} · ranked by {leaderMetric === 'gaa' ? 'GAA (lowest first)' : leaderMetric}</Text>
        </>}
        ListEmptyComponent={view.status === 'loading' ? <View style={styles.tableState}><ActivityIndicator color={activeTheme.primaryColor} /></View>
          : view.status === 'error' ? <View style={styles.tableState}><Text style={styles.emptyTitle}>Complete authoritative stats are unavailable for this timeline.</Text><Pressable testID="stats-scope-retry" accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable></View>
            : <View style={styles.tableState}><Text style={styles.emptyTitle}>No eligible {selectedTab === 'Goalies' ? 'goalie' : 'player'} stats yet</Text></View>}
        renderItem={({ item }) => <StatsRankedRow row={item} metric={leaderMetric} onOpenPlayer={openPlayer} />}
        ListFooterComponent={<View style={styles.foot}><View style={styles.footDot} /><Text style={styles.footText}>{selectedTab === 'Skaters' ? 'Rankings include every player with a known selected metric. Unavailable selected values are excluded; other unavailable values remain —.' : 'GAA ranks every eligible goalie from lowest to highest. Unavailable GAA values are excluded.'}</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, horizontalOverflow: { width: '100%', overflow: 'hidden' }, content: { width: '100%', paddingHorizontal: 16, paddingBottom: 40 },
  pageControls: { width: '100%', gap: 10, paddingTop: 8, paddingBottom: 12 },
  roleControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricSelector: { width: '100%', minWidth: 0, flexDirection: 'row', gap: 8, paddingVertical: 0 },
  metricOption: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 4 },
  tableHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, tableTitle: { ...SECTION_HEADING_TEXT_STYLE, flex: 1, color: colors.textPrimary },
  leagueWideNotice: { minHeight: 44, justifyContent: 'center', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(97,226,232,0.26)', borderRadius: 12, backgroundColor: 'rgba(5,20,33,0.24)' }, leagueWideNoticeText: { color: '#A9C4D2', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  scopeCopy: { flex: 1, minWidth: 0, color: '#849AAE', fontSize: 9 },
  tableState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 }, emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, emptyTitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center' }, emptyBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, retryText: { color: colors.primary, fontSize: 14, fontWeight: '900', marginTop: 12 },
  foot: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8 }, footDot: { width: 4, height: 4, marginTop: 5, borderRadius: 2, backgroundColor: '#61E2E8' }, footText: { flex: 1, color: '#7690A4', fontSize: 8, lineHeight: 12 },
});
