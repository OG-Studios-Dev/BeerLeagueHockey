import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DivisionFilter from '../components/DivisionFilter';
import { FocusFlatList } from '../components/CardFocus';
import PillToggle from '../components/PillToggle';
import { SECTION_HEADING_TEXT_STYLE } from '../components/SectionHeader';
import StatsLeadersCard, { type StatsLeaderMetric } from '../components/StatsLeadersCard';
import { needsExpandedGoalieMetrics, StatsTableHeader, StatsTableRowView, type StatsHorizontalSync } from '../components/StatsTable';
import StatsTimelineFilter from '../components/StatsTimelineFilter';
import { useLeague } from '../context/LeagueContext';
import { buildGoalieRows, buildLeaderRows, buildSkaterRows } from '../lib/statsPresentationModel';
import { getPublicStatsScope, type PublicStatsScope, type PublicStatsScopeSelection } from '../lib/supabase/publicStats';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import { navigateToPlayerCard } from '../navigation/playerCard';
import type { StatsStackParamList } from '../navigation/types';
import colors from '../theme/colors';

type StatsTab = 'Skaters' | 'Goalies';
type Snapshot = { key: string; status: 'loading' | 'ready' | 'error'; payload: PublicStatsScope | null };
const tabs: readonly StatsTab[] = ['Skaters', 'Goalies'];

function selectionKey(selection: PublicStatsScopeSelection) {
  return `${selection.kind}:${[...(selection.seasonIds ?? [])].sort().join(',')}`;
}

export default function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StatsStackParamList>>();
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions } = useLeague();
  const [selectedTab, setSelectedTab] = React.useState<StatsTab>('Skaters');
  const [leaderMetric, setLeaderMetric] = React.useState<StatsLeaderMetric>('points');
  const [selection, setSelection] = React.useState<PublicStatsScopeSelection>({ kind: 'current' });
  const [retry, setRetry] = React.useState(0);
  const { fontScale } = useWindowDimensions();
  const [horizontalSync, setHorizontalSync] = React.useState<StatsHorizontalSync>({ offset: 0, revision: 0, sourceId: null });
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ key: '', status: 'loading', payload: null });
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

  React.useEffect(() => setHorizontalSync((current) => ({ offset: 0, revision: current.revision + 1, sourceId: null })), [requestKey, selectedTab]);

  React.useEffect(() => {
    let mounted = true;
    if (!leagueId || !leagueSlug) return;
    setSnapshot({ key: requestKey, status: 'loading', payload: null });
    void getPublicStatsScope(leagueSlug, leagueId, selection, requestDivisionId)
      .then((payload) => { if (mounted) setSnapshot({ key: requestKey, status: 'ready', payload }); })
      .catch(() => { if (mounted) setSnapshot({ key: requestKey, status: 'error', payload: null }); });
    return () => { mounted = false; };
  }, [leagueId, leagueSlug, requestDivisionId, requestKey, selection]);

  if (!activeLeague) {
    return <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}><View style={styles.emptyWrap}><Text style={styles.emptyTitle}>Hockey Life access required</Text><Text style={styles.emptyBody}>Your account does not have an accessible Hockey Life membership.</Text></View></SafeAreaView>;
  }

  const view = snapshot.key === requestKey ? snapshot : { status: 'loading' as const, payload: null };
  const players = view.payload?.players ?? [];
  const skaterRows = buildSkaterRows(players);
  const goalieRows = buildGoalieRows(players);
  const leaders = buildLeaderRows(players, leaderMetric);
  const tableRows = selectedTab === 'Skaters' ? skaterRows : goalieRows;
  const expandedGoalieMetrics = selectedTab === 'Goalies' && (fontScale > 1.3 || needsExpandedGoalieMetrics(goalieRows));
  const scopeLabel = view.payload?.scope.label ?? (selection.kind === 'current' ? 'Current season' : selection.kind === 'all' ? 'All time' : selection.kind === 'single' ? 'One season' : `${selection.seasonIds?.length ?? 0} seasons`);
  const openPlayer = (playerId: string) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id });
  const timeline = <StatsTimelineFilter label={scopeLabel} currentSeasonId={view.payload?.scope.currentSeasonId ?? null} seasons={view.payload?.seasons ?? []} selection={selection} onApply={setSelection} />;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}>
      <FocusFlatList
        focusScopeKey={`stats:${requestKey}:${selectedTab}`}
        testID="stats-page-list"
        style={styles.horizontalOverflow}
        contentContainerStyle={styles.content}
        data={view.status === 'ready' ? tableRows : []}
        keyExtractor={(row) => row.playerId}
        ListHeaderComponent={<>
          <StatsLeadersCard leagueId={activeLeague.id} headerControl={timeline} metric={leaderMetric} leaders={leaders} status={view.status} onMetricChange={setLeaderMetric} onRetry={() => setRetry((value) => value + 1)} onOpenPlayer={openPlayer} />
          <View style={styles.tableHeading}><Text accessibilityRole="header" style={styles.tableTitle}>Player stats</Text><Pressable accessibilityRole="button" onPress={() => navigation.navigate('Leaderboards')} style={styles.leaderboardsAction} testID="stats-leaderboards-action"><Text style={styles.leaderboardsActionText}>Leaderboards</Text></Pressable></View>
          {selection.kind === 'all'
            ? <View testID="stats-all-time-league-wide" accessible accessibilityRole="text" accessibilityLabel="All time is league-wide. Division filters are unavailable for All time." style={styles.leagueWideNotice}><Text style={styles.leagueWideNoticeText}>All time is league-wide. Division filters are unavailable.</Text></View>
            : <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />}
          <View style={styles.tabWrap}><PillToggle options={tabs} selected={selectedTab} onChange={setSelectedTab} /></View>
          <View style={styles.tableMeta}><Text style={styles.scopeCopy}><Text style={styles.scopeStrong}>{selectedTab}</Text> ranked by {selectedTab === 'Skaters' ? 'points' : 'GAA'}</Text><Text accessibilityLabel={expandedGoalieMetrics ? 'Swipe metrics. Long values use an expanded accessible layout.' : undefined} style={styles.swipeHint}>{selectedTab === 'Skaters' ? 'Swipe metrics ↔' : expandedGoalieMetrics ? 'Swipe long values ↔' : 'All metrics ✓'}</Text></View>
          {view.status === 'ready' && tableRows.length > 0 ? <StatsTableHeader kind={selectedTab === 'Skaters' ? 'skater' : 'goalie'} syncId="header" horizontalSync={horizontalSync} onHorizontalOffset={(sourceId, offset) => setHorizontalSync((current) => ({ offset, revision: current.revision + 1, sourceId }))} expandedMetrics={expandedGoalieMetrics} /> : null}
        </>}
        ListEmptyComponent={view.status === 'loading' ? <View style={styles.tableState}><ActivityIndicator color={activeTheme.primaryColor} /></View>
          : view.status === 'error' ? <View style={styles.tableState}><Text style={styles.emptyTitle}>Complete authoritative stats are unavailable for this timeline.</Text><Pressable testID="stats-scope-retry" accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable></View>
            : <View style={styles.tableState}><Text style={styles.emptyTitle}>No {selectedTab.toLowerCase()} stats yet</Text></View>}
        renderItem={({ item, index }) => <StatsTableRowView kind={selectedTab === 'Skaters' ? 'skater' : 'goalie'} syncId={`row-${item.playerId}`} row={item} last={index === tableRows.length - 1} horizontalSync={horizontalSync} onHorizontalOffset={(sourceId, offset) => setHorizontalSync((current) => ({ offset, revision: current.revision + 1, sourceId }))} expandedMetrics={expandedGoalieMetrics} onOpenPlayer={openPlayer} />}
        ListFooterComponent={<View style={styles.foot}><View style={styles.footDot} /><Text style={styles.footText}>{selectedTab === 'Skaters' ? 'CH = authoritative championships. Unavailable values remain —. GPG and PPG use known GP.' : 'GAA is total GA divided by total GP. CH remains — when an authoritative championship result is unavailable.'}</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, horizontalOverflow: { width: '100%', overflow: 'hidden' }, content: { width: '100%', paddingHorizontal: 16, paddingBottom: 40 },
  tableHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, tableTitle: { ...SECTION_HEADING_TEXT_STYLE, flex: 1, color: colors.textPrimary },
  leaderboardsAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }, leaderboardsActionText: { color: colors.primary, fontSize: 12, fontWeight: '900' }, tabWrap: { marginTop: 8 },
  leagueWideNotice: { minHeight: 44, justifyContent: 'center', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(97,226,232,0.26)', borderRadius: 12, backgroundColor: 'rgba(5,20,33,0.24)' }, leagueWideNoticeText: { color: '#A9C4D2', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  tableMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, marginBottom: 7 }, scopeCopy: { flex: 1, minWidth: 0, color: '#849AAE', fontSize: 9 }, scopeStrong: { color: '#DCE9F2', fontWeight: '900' }, swipeHint: { color: '#7690A5', fontSize: 8, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  tableState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 }, emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, emptyTitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center' }, emptyBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, retryText: { color: colors.primary, fontSize: 14, fontWeight: '900', marginTop: 12 },
  foot: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8 }, footDot: { width: 4, height: 4, marginTop: 5, borderRadius: 2, backgroundColor: '#61E2E8' }, footText: { flex: 1, color: '#7690A4', fontSize: 8, lineHeight: 12 },
});
