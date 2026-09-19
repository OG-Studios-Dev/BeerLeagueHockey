import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusFlatList } from '../components/CardFocus';
import DivisionFilter from '../components/DivisionFilter';
import PillToggle from '../components/PillToggle';
import PlayerRow from '../components/PlayerRow';
import StatsLeadersCard, { type StatsLeaderMetric, type StatsLeaderStatus } from '../components/StatsLeadersCard';
import { useLeague } from '../context/LeagueContext';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { navigateToPlayerCard } from '../navigation/playerCard';
import type { StatsStackParamList } from '../navigation/types';
import { getStatsLeadersFromPublicSeason, type PlayerStatRow } from '../lib/supabase/data';
import { getMetricsOperationalSeason } from '../lib/supabase/team';
import { formatPublicMetric, getPublicGoaliesV2, getPublicSeasonStats, type PublicGoalieV2, type PublicSeasonStats } from '../lib/supabase/publicStats';
import colors from '../theme/colors';

type StatsTab = 'Skaters' | 'Goalies';
const tabs: readonly StatsTab[] = ['Skaters', 'Goalies'];
type EnrichedPlayer = PlayerStatRow & { avatar_url: string | null };
type LeaderboardRow = {
  player_id: string;
  player_name: string;
  team_short_name: string;
  avatar_url: string | null;
  stats: Array<{ label: string; value: string | number }>;
};
function mapSkaterRows(players: EnrichedPlayer[]): LeaderboardRow[] {
  return players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    team_short_name: player.team_short_name,
    avatar_url: player.avatar_url,
    stats: [
      { label: 'G', value: player.metrics ? formatPublicMetric(player.metrics.goals).value : player.goals ?? '—' },
      { label: 'A', value: player.metrics ? formatPublicMetric(player.metrics.assists).value : player.assists ?? '—' },
      { label: 'PTS', value: player.metrics ? formatPublicMetric(player.metrics.points).value : player.points ?? '—' },
    ],
  }));
}

function mapGoalieRows(players: PublicGoalieV2[]): LeaderboardRow[] {
  return players.map((player) => ({
    player_id: player.playerId,
    player_name: player.playerName,
    team_short_name: player.displayTeam?.name ?? 'Unknown team',
    avatar_url: player.avatarUrl,
    stats: [
      { label: 'W', value: formatPublicMetric(player.metrics.wins).value },
      { label: 'SV%', value: formatPublicMetric(player.metrics.savePercentage, 3).value },
      { label: 'GAA', value: formatPublicMetric(player.metrics.goalsAgainstAverage, 2).value },
    ],
  }));
}

export default function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StatsStackParamList>>();
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions } = useLeague();
  const [selectedTab, setSelectedTab] = React.useState<StatsTab>('Skaters');
  const [seasonSnapshot, setSeasonSnapshot] = React.useState<{ scope: string; status: StatsLeaderStatus | 'no-season'; payload: PublicSeasonStats | null }>({ scope: '', status: 'loading', payload: null });
  const [goalieRetry, setGoalieRetry] = React.useState(0);
  const [goalieSnapshot, setGoalieSnapshot] = React.useState<{ scope: string; status: 'loading' | 'ready' | 'error' | 'no-season'; rows: PublicGoalieV2[]; seasonName: string | null }>({ scope: '', status: 'loading', rows: [], seasonName: null });
  const { reduceTransparency } = useAccessibilityPreferences();
  const [leaderMetric, setLeaderMetric] = React.useState<StatsLeaderMetric>('goals');
  const [leaderRetry, setLeaderRetry] = React.useState(0);
  const leaderLeagueId = activeLeague?.id;
  const activeLeagueSlug = activeLeague?.slug;
  const leaderDivisionId = activeDivision?.id;
  const seasonScope = `${leaderLeagueId ?? ''}:${activeLeagueSlug ?? ''}:${leaderDivisionId ?? ''}`;
  const seasonView = seasonSnapshot.scope === seasonScope ? seasonSnapshot : { status: 'loading' as const, payload: null };
  const skaters = seasonView.payload ? getStatsLeadersFromPublicSeason(seasonView.payload, 'points', 50) as EnrichedPlayer[] : [];
  const leaderRows = seasonView.payload ? getStatsLeadersFromPublicSeason(seasonView.payload, leaderMetric, 5) as EnrichedPlayer[] : [];
  const leaderCard = { status: seasonView.status === 'no-season' ? 'ready' as const : seasonView.status, rows: leaderRows };
  const goalieScope = `${activeLeague?.id ?? ''}:${activeDivision?.id ?? ''}`;
  const goalieView = goalieSnapshot.scope === goalieScope ? goalieSnapshot : { status: 'loading' as const, rows: [], seasonName: null };

  React.useEffect(() => {
    let current = true;
    if (!leaderLeagueId || !activeLeagueSlug) return;
    setSeasonSnapshot({ scope: seasonScope, status: 'loading', payload: null });
    void getMetricsOperationalSeason(leaderLeagueId)
      .then(({ season, error }) => {
        if (error) throw new Error(error);
        if (!season) {
          if (current) setSeasonSnapshot({ scope: seasonScope, status: 'no-season', payload: null });
          return null;
        }
        return getPublicSeasonStats(activeLeagueSlug, leaderLeagueId, season.id, leaderDivisionId ?? null);
      })
      .then((payload) => { if (current && payload) setSeasonSnapshot({ scope: seasonScope, status: 'ready', payload }); })
      .catch(() => { if (current) setSeasonSnapshot({ scope: seasonScope, status: 'error', payload: null }); });
    return () => { current = false; };
  }, [activeLeagueSlug, leaderDivisionId, leaderLeagueId, leaderRetry, seasonScope]);

  React.useEffect(() => {
    let current = true;
    if (!leaderLeagueId || !activeLeagueSlug || selectedTab !== 'Goalies') return;
    setGoalieSnapshot({ scope: goalieScope, status: 'loading', rows: [], seasonName: null });
    if (seasonView.status === 'error' || seasonView.status === 'no-season') {
      setGoalieSnapshot({ scope: goalieScope, status: seasonView.status, rows: [], seasonName: null });
      return;
    }
    if (!seasonView.payload) return () => { current = false; };
    getPublicGoaliesV2(activeLeagueSlug, leaderLeagueId, seasonView.payload.presentationSeason.id, leaderDivisionId ?? null)
      .then((result) => { if (current) setGoalieSnapshot({ scope: goalieScope, status: 'ready', rows: result.goalies, seasonName: result.presentationSeason?.name ?? null }); })
      .catch(() => { if (current) setGoalieSnapshot({ scope: goalieScope, status: 'error', rows: [], seasonName: null }); });
    return () => { current = false; };
  }, [activeLeagueSlug, leaderLeagueId, leaderDivisionId, selectedTab, goalieRetry, goalieScope, seasonView.payload, seasonView.status]);

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Hockey Life access required</Text>
          <Text style={styles.emptyBody}>Your account does not have an accessible Hockey Life membership.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const list =
    selectedTab === 'Skaters'
      ? mapSkaterRows(skaters)
      : mapGoalieRows(goalieView.rows);
  const emptyMsg = selectedTab === 'Skaters' ? 'No skater stats yet' : 'No goalie stats yet';
  const retrySeason = () => {
    setLeaderRetry((value) => value + 1);
    setGoalieRetry((value) => value + 1);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
      <FocusFlatList
        focusScopeKey={`stats:${seasonScope}:${selectedTab}`}
        testID="stats-page-list"
        data={(selectedTab === 'Skaters' ? seasonView.status === 'loading' : goalieView.status === 'loading') ? [] : list}
        keyExtractor={(item, index) => `${item.player_id}-${index}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.statsActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Leaderboards')}
                style={styles.leaderboardsAction}
                testID="stats-leaderboards-action"
              >
                <Text style={styles.leaderboardsActionText}>Leaderboards</Text>
              </Pressable>
            </View>
            <StatsLeadersCard leagueName={activeLeague.name} divisionName={activeDivision?.name} metric={leaderMetric} leaders={leaderCard.rows} status={leaderCard.status} reduceTransparency={reduceTransparency} onMetricChange={setLeaderMetric} onRetry={() => setLeaderRetry((value) => value + 1)} onOpenPlayer={(playerId) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id })} />
            <View style={styles.tableControls}>
              <Text accessibilityRole="header" style={styles.tableTitle}>Player stats</Text>
              {selectedTab === 'Goalies' && goalieView.seasonName ? <Text style={styles.seasonLabel}>{goalieView.seasonName}</Text> : null}
              {selectedTab === 'Goalies' && goalieView.rows.some((row) => Object.values(row.metrics).some((metric) => metric.state === 'estimated')) ? <Text style={styles.estimateNote}>~ indicates an estimate; unavailable fields remain —.</Text> : null}
              <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />
              <PillToggle options={tabs} selected={selectedTab} onChange={setSelectedTab} />
            </View>
          </>
        }
        ListEmptyComponent={selectedTab === 'Goalies' && goalieView.status === 'error'
          ? <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>Unable to load goalie stats</Text><Pressable testID="goalies-retry" onPress={retrySeason}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : selectedTab === 'Goalies' && goalieView.status === 'no-season'
            ? <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>No season available</Text><Pressable testID="goalies-retry" onPress={retrySeason}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : selectedTab === 'Skaters' && seasonView.status === 'error'
            ? <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>Unable to load skater stats</Text><Pressable testID="skaters-retry" onPress={retrySeason}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : selectedTab === 'Skaters' && seasonView.status === 'no-season'
            ? <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>No season available</Text><Pressable testID="skaters-retry" onPress={retrySeason}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : (selectedTab === 'Skaters' ? seasonView.status === 'loading' : goalieView.status === 'loading')
            ? <View style={styles.tableEmpty}><ActivityIndicator color={activeTheme.primaryColor} /></View>
            : <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>{emptyMsg}</Text></View>}
        renderItem={({ item, index }) => (
          <PlayerRow rank={index + 1} name={item.player_name} teamShortName={item.team_short_name} highlight={index === 0} avatarUrl={item.avatar_url} stats={item.stats} onPress={() => navigateToPlayerCard(navigation, { playerId: item.player_id, leagueId: activeLeague.id })} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  statsActions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 },
  headerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  leaderboardsAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  leaderboardsActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  tableControls: { marginBottom: 10, gap: 8 },
  tableTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  tableEmpty: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  emptyBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryText: { color: colors.primary, fontSize: 15, fontWeight: '800', marginTop: 12 },
  seasonLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  estimateNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  globalIntro: {
    marginTop: -2,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  globalLeagueCard: {
    marginBottom: 14,
  },
  globalLeagueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  globalLeagueName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  globalLeaguePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  globalLeaguePillText: {
    fontSize: 12,
    fontWeight: '800',
  },
});
