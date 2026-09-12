import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DivisionFilter from '../components/DivisionFilter';
import GuestBanner from '../components/GuestBanner';
import PillToggle from '../components/PillToggle';
import PlayerRow from '../components/PlayerRow';
import SectionHeader from '../components/SectionHeader';
import StatsLeadersCard, { type StatsLeaderMetric, type StatsLeaderStatus } from '../components/StatsLeadersCard';
import { useLeague } from '../context/LeagueContext';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { supabase } from '../lib/supabase/client';
import { getStatsLeaders, getGoalieLeaders, type GoalieStatRow, type PlayerStatRow } from '../lib/supabase/data';
import colors from '../theme/colors';

type StatsTab = 'Skaters' | 'Goalies';
const tabs: readonly StatsTab[] = ['Skaters', 'Goalies'];
type EnrichedPlayer = PlayerStatRow & { avatar_url: string | null };
type EnrichedGoalie = GoalieStatRow & { avatar_url: string | null };
type LeaderboardRow = {
  player_id: string;
  player_name: string;
  team_short_name: string;
  avatar_url: string | null;
  stats: Array<{ label: string; value: string | number }>;
};
type GlobalLeagueLeaders = {
  leagueId: string;
  leagueName: string;
  primaryColor: string;
  rows: LeaderboardRow[];
};

async function enrichWithAvatars<T extends { player_id: string; avatar_url?: string | null }>(
  players: T[],
): Promise<Array<T & { avatar_url: string | null }>> {
  if (players.length === 0) return [];
  const playerIds = players.map((p) => p.player_id);
  const { data: profiles } = await supabase.from('profiles').select('id, avatar_url').in('id', playerIds);
  const avatarMap = new Map<string, string | null>((profiles ?? []).map((p: any) => [p.id, p.avatar_url]));
  return players.map((player) => ({
    ...player,
    avatar_url: player.avatar_url ?? avatarMap.get(player.player_id) ?? null,
  }));
}

function mapSkaterRows(players: EnrichedPlayer[]): LeaderboardRow[] {
  return players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    team_short_name: player.team_short_name,
    avatar_url: player.avatar_url,
    stats: [
      { label: 'G', value: player.goals },
      { label: 'A', value: player.assists },
      { label: 'PTS', value: player.points },
    ],
  }));
}

function mapGoalieRows(players: EnrichedGoalie[]): LeaderboardRow[] {
  return players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    team_short_name: player.team_name,
    avatar_url: player.avatar_url,
    stats: [
      { label: 'W', value: player.wins },
      { label: 'SV%', value: player.save_percentage ? player.save_percentage.toFixed(3) : '0.000' },
      { label: 'GAA', value: player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00' },
    ],
  }));
}

export default function StatsScreen() {
  const navigation = useNavigation<any>();
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions, availableLeagues } = useLeague();
  const [selectedTab, setSelectedTab] = React.useState<StatsTab>('Skaters');
  const [skaters, setSkaters] = React.useState<EnrichedPlayer[]>([]);
  const [goalies, setGoalies] = React.useState<EnrichedGoalie[]>([]);
  const [globalLeaders, setGlobalLeaders] = React.useState<GlobalLeagueLeaders[]>([]);
  const [loading, setLoading] = React.useState(false);
  const { reduceTransparency } = useAccessibilityPreferences();
  const [leaderMetric, setLeaderMetric] = React.useState<StatsLeaderMetric>('goals');
  const [leaderRetry, setLeaderRetry] = React.useState(0);
  const [leaderSnapshot, setLeaderSnapshot] = React.useState<{ scope: string; status: StatsLeaderStatus; rows: EnrichedPlayer[] }>({ scope: '', status: 'loading', rows: [] });
  const leaderLeagueId = activeLeague?.id;
  const leaderDivisionId = activeDivision?.id;
  const leaderScope = `${leaderLeagueId ?? ''}:${leaderDivisionId ?? ''}:${leaderMetric}`;
  const leaderCard = leaderSnapshot.scope === leaderScope ? leaderSnapshot : { status: 'loading' as const, rows: [] };

  React.useEffect(() => {
    let current = true;
    if (!leaderLeagueId) return;
    setLeaderSnapshot({ scope: leaderScope, status: 'loading', rows: [] });
    // Query the selected metric's top five, not a client sort of the points table.
    getStatsLeaders(leaderLeagueId, leaderMetric, 5, leaderDivisionId, undefined, { throwOnError: true })
      .then(enrichWithAvatars)
      .then((rows) => { if (current) setLeaderSnapshot({ scope: leaderScope, status: 'ready', rows }); })
      .catch(() => { if (current) setLeaderSnapshot({ scope: leaderScope, status: 'error', rows: [] }); });
    return () => { current = false; };
  }, [leaderLeagueId, leaderDivisionId, leaderMetric, leaderRetry, leaderScope]);

  React.useEffect(() => {
    if (!activeLeague) {
      setSkaters([]);
      setGoalies([]);
      return;
    }

    setLoading(true);
    const divId = activeDivision?.id ?? undefined;
    Promise.all([
      getStatsLeaders(activeLeague.id, 'points', 50, divId).then(enrichWithAvatars),
      getGoalieLeaders(activeLeague.id, undefined, divId).then(enrichWithAvatars),
    ]).then(([s, g]) => {
      setSkaters(s);
      setGoalies(g);
    }).finally(() => setLoading(false));
  }, [activeLeague?.id, activeDivision?.id]);

  React.useEffect(() => {
    if (activeLeague) {
      setGlobalLeaders([]);
      return;
    }

    if (availableLeagues.length === 0) {
      setGlobalLeaders([]);
      return;
    }

    setLoading(true);

    Promise.all(
      availableLeagues.map(async (league) => {
        if (selectedTab === 'Skaters') {
          const rows = await getStatsLeaders(league.id, 'points', 3).then(enrichWithAvatars);
          return {
            leagueId: league.id,
            leagueName: league.name,
            primaryColor: league.theme.primaryColor,
            rows: mapSkaterRows(rows),
          } satisfies GlobalLeagueLeaders;
        }

        const rows = await getGoalieLeaders(league.id, undefined, undefined, 3).then(enrichWithAvatars);
        return {
          leagueId: league.id,
          leagueName: league.name,
          primaryColor: league.theme.primaryColor,
          rows: mapGoalieRows(rows),
        } satisfies GlobalLeagueLeaders;
      }),
    )
      .then((sections) => {
        setGlobalLeaders(sections.filter((section) => section.rows.length > 0));
      })
      .finally(() => setLoading(false));
  }, [activeLeague, availableLeagues, selectedTab]);

  if (!activeLeague && availableLeagues.length === 0) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['left', 'right']}>
        <View style={styles.headerWrap}><SectionHeader title="League Leaders" /></View>
        <View style={styles.emptyWrap}><Text style={styles.emptyTitle}>Join a league to see leaderboards</Text></View>
      </SafeAreaView>
    );
  }

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]} edges={['left', 'right']}>
        <GuestBanner />
        <View style={styles.headerWrap}>
          <SectionHeader title="League Leaders" />
          <Text style={styles.globalIntro}>
            Top {selectedTab === 'Skaters' ? 'skaters' : 'goalies'} across the leagues you play in.
          </Text>
          <PillToggle options={tabs} selected={selectedTab} onChange={setSelectedTab} />
        </View>

        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
        ) : globalLeaders.length === 0 ? (
          <View style={styles.emptyWrap}><Text style={styles.emptyTitle}>No league leaders available yet</Text></View>
        ) : (
          <FlatList
            data={globalLeaders}
            keyExtractor={(item) => item.leagueId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.globalLeagueCard}>
                <View style={styles.globalLeagueHeader}>
                  <Text style={styles.globalLeagueName}>{item.leagueName}</Text>
                  <View style={[styles.globalLeaguePill, { backgroundColor: `${item.primaryColor}22` }]}>
                    <Text style={[styles.globalLeaguePillText, { color: item.primaryColor }]}>Top 3</Text>
                  </View>
                </View>

                {item.rows.map((row, index) => (
                  <PlayerRow
                    key={`${item.leagueId}-${row.player_id}-${index}`}
                    rank={index + 1}
                    name={row.player_name}
                    teamShortName={row.team_short_name}
                    highlight={index === 0}
                    avatarUrl={row.avatar_url}
                    stats={row.stats}
                    onPress={() => navigateToPlayerCard(navigation, { playerId: row.player_id, leagueId: item.leagueId })}
                  />
                ))}
              </View>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  const list =
    selectedTab === 'Skaters'
      ? mapSkaterRows(skaters)
      : mapGoalieRows(goalies);
  const emptyMsg = selectedTab === 'Skaters' ? 'No skater stats yet' : 'No goalie stats yet';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['left', 'right']}>
      <View style={styles.headerWrap}><SectionHeader title="Stats" /></View>
      <FlatList
        testID="stats-page-list"
        data={loading ? [] : list}
        keyExtractor={(item, index) => `${item.player_id}-${index}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <StatsLeadersCard leagueName={activeLeague.name} divisionName={activeDivision?.name} metric={leaderMetric} leaders={leaderCard.rows} status={leaderCard.status} reduceTransparency={reduceTransparency} onMetricChange={setLeaderMetric} onRetry={() => setLeaderRetry((value) => value + 1)} onOpenPlayer={(playerId) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id })} />
            <View style={styles.tableControls}>
              <Text accessibilityRole="header" style={styles.tableTitle}>Player stats</Text>
              <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />
              <PillToggle options={tabs} selected={selectedTab} onChange={setSelectedTab} />
            </View>
          </>
        }
        ListEmptyComponent={loading ? <View style={styles.tableEmpty}><ActivityIndicator color={activeTheme.primaryColor} /></View> : <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>{emptyMsg}</Text></View>}
        renderItem={({ item, index }) => (
          <PlayerRow rank={index + 1} name={item.player_name} teamShortName={item.team_short_name} highlight={index === 0} avatarUrl={item.avatar_url} stats={item.stats} onPress={() => navigateToPlayerCard(navigation, { playerId: item.player_id, leagueId: activeLeague.id })} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  headerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  tableControls: { marginBottom: 10, gap: 8 },
  tableTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  tableEmpty: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
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
