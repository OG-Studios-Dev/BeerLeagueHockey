import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { getStatsLeaders, type PlayerStatRow } from '../lib/supabase/data';
import { getPublicGoalies, type PublicGoalie } from '../lib/supabase/publicStats';
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
type GlobalLeagueLeaders = {
  leagueId: string;
  leagueName: string;
  primaryColor: string;
  rows: LeaderboardRow[];
  seasonName?: string;
  estimated?: boolean;
};

async function enrichWithAvatars<T extends { player_id: string; avatar_url?: string | null }>(
  players: T[],
): Promise<Array<T & { avatar_url: string | null }>> {
  if (players.length === 0) return [];
  const playerIds = players.map((p) => p.player_id);
  const { data: profiles } = await supabase.from('profiles').select('id, avatar_url').in('id', playerIds);
  const avatarMap = new Map<string, string | null>((profiles ?? []).map((p: { id: string; avatar_url: string | null }) => [p.id, p.avatar_url]));
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

function mapGoalieRows(players: PublicGoalie[]): LeaderboardRow[] {
  return players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    team_short_name: player.team_name,
    avatar_url: player.avatar_url,
    stats: [
      { label: 'W', value: player.wins },
      { label: 'SV%', value: player.save_percentage === null ? '—' : player.save_percentage.toFixed(3) },
      { label: 'GAA', value: player.goals_against_average === null ? '—' : player.goals_against_average.toFixed(2) },
    ],
  }));
}

export default function StatsScreen() {
  const navigation = useNavigation();
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions, availableLeagues } = useLeague();
  const [selectedTab, setSelectedTab] = React.useState<StatsTab>('Skaters');
  const [skaters, setSkaters] = React.useState<EnrichedPlayer[]>([]);
  const [goalieRetry, setGoalieRetry] = React.useState(0);
  const [goalieSnapshot, setGoalieSnapshot] = React.useState<{ scope: string; status: 'loading' | 'ready' | 'error'; rows: PublicGoalie[]; seasonName: string | null }>({ scope: '', status: 'loading', rows: [], seasonName: null });
  const [globalLeaders, setGlobalLeaders] = React.useState<GlobalLeagueLeaders[]>([]);
  const [globalSnapshotScope, setGlobalSnapshotScope] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [globalStatus, setGlobalStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const { reduceTransparency } = useAccessibilityPreferences();
  const [leaderMetric, setLeaderMetric] = React.useState<StatsLeaderMetric>('goals');
  const [leaderRetry, setLeaderRetry] = React.useState(0);
  const [leaderSnapshot, setLeaderSnapshot] = React.useState<{ scope: string; status: StatsLeaderStatus; rows: EnrichedPlayer[] }>({ scope: '', status: 'loading', rows: [] });
  const leaderLeagueId = activeLeague?.id;
  const activeLeagueSlug = activeLeague?.slug;
  const leaderDivisionId = activeDivision?.id;
  const leaderScope = `${leaderLeagueId ?? ''}:${leaderDivisionId ?? ''}:${leaderMetric}`;
  const leaderCard = leaderSnapshot.scope === leaderScope ? leaderSnapshot : { status: 'loading' as const, rows: [] };
  const goalieScope = `${activeLeague?.id ?? ''}:${activeDivision?.id ?? ''}`;
  const goalieView = goalieSnapshot.scope === goalieScope ? goalieSnapshot : { status: 'loading' as const, rows: [], seasonName: null };
  const globalScope = `${selectedTab}:${availableLeagues.map((league) => `${league.id}:${league.slug}`).join('|')}`;
  const globalView = globalSnapshotScope === globalScope
    ? { status: globalStatus, leaders: globalLeaders }
    : { status: 'loading' as const, leaders: [] as GlobalLeagueLeaders[] };

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
    if (!leaderLeagueId) {
      setSkaters([]);
      return;
    }

    setLoading(true);
    setSkaters([]);
    const divId = leaderDivisionId ?? undefined;
    let current = true;
    getStatsLeaders(leaderLeagueId, 'points', 50, divId).then(enrichWithAvatars)
      .then((rows) => { if (current) setSkaters(rows); })
      .catch(() => { if (current) setSkaters([]); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [leaderLeagueId, leaderDivisionId]);

  React.useEffect(() => {
    let current = true;
    if (!leaderLeagueId || !activeLeagueSlug || selectedTab !== 'Goalies') return;
    setGoalieSnapshot({ scope: goalieScope, status: 'loading', rows: [], seasonName: null });
    getPublicGoalies(activeLeagueSlug, leaderLeagueId, null, leaderDivisionId ?? null)
      .then((result) => { if (current) setGoalieSnapshot({ scope: goalieScope, status: 'ready', rows: result.goalies, seasonName: result.presentationSeason?.name ?? null }); })
      .catch(() => { if (current) setGoalieSnapshot({ scope: goalieScope, status: 'error', rows: [], seasonName: null }); });
    return () => { current = false; };
  }, [activeLeagueSlug, leaderLeagueId, leaderDivisionId, selectedTab, goalieRetry, goalieScope]);

  React.useEffect(() => {
    let current = true;
    if (activeLeague) {
      setGlobalLeaders([]);
      return () => { current = false; };
    }

    if (availableLeagues.length === 0) {
      setGlobalLeaders([]);
      return () => { current = false; };
    }

    setGlobalSnapshotScope(globalScope);
    setGlobalStatus('loading');

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

        const result = await getPublicGoalies(league.slug, league.id);
        return {
          leagueId: league.id,
          leagueName: league.name,
          primaryColor: league.theme.primaryColor,
          rows: mapGoalieRows(result.goalies.slice(0, 3)),
          seasonName: result.presentationSeason?.name,
          estimated: result.source === 'estimated',
        } satisfies GlobalLeagueLeaders;
      }),
    )
      .then((sections) => {
        if (!current) return;
        setGlobalLeaders(sections.filter((section) => section.rows.length > 0));
        setGlobalStatus('ready');
      })
      .catch(() => { if (current) { setGlobalLeaders([]); setGlobalStatus('error'); } });
    return () => { current = false; };
  }, [activeLeague, availableLeagues, selectedTab, goalieRetry, globalScope]);

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

        {globalView.status === 'loading' ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
        ) : globalView.status === 'error' ? (
          <View style={styles.emptyWrap}><Text style={styles.emptyTitle}>{selectedTab === 'Goalies' ? 'Unable to load goalie stats' : 'Unable to load skater stats'}</Text><Pressable testID="global-goalies-retry" onPress={() => setGoalieRetry((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable></View>
        ) : globalView.leaders.length === 0 ? (
          <View style={styles.emptyWrap}><Text style={styles.emptyTitle}>No league leaders available yet</Text></View>
        ) : (
          <FlatList
            data={globalView.leaders}
            keyExtractor={(item) => item.leagueId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.globalLeagueCard}>
                <View style={styles.globalLeagueHeader}>
                  <Text style={styles.globalLeagueName}>{item.leagueName}</Text>
                  {item.seasonName ? <Text style={styles.seasonLabel}>{item.seasonName}</Text> : null}
                  <View style={[styles.globalLeaguePill, { backgroundColor: `${item.primaryColor}22` }]}>
                    <Text style={[styles.globalLeaguePillText, { color: item.primaryColor }]}>Top 3</Text>
                  </View>
                </View>
                {item.estimated ? <Text style={styles.estimateNote}>Estimated from published game results.</Text> : null}

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
      : mapGoalieRows(goalieView.rows);
  const emptyMsg = selectedTab === 'Skaters' ? 'No skater stats yet' : 'No goalie stats yet';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['left', 'right']}>
      <View style={styles.headerWrap}><SectionHeader title="Stats" /></View>
      <FlatList
        testID="stats-page-list"
        data={(selectedTab === 'Skaters' ? loading : goalieView.status === 'loading') ? [] : list}
        keyExtractor={(item, index) => `${item.player_id}-${index}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <StatsLeadersCard leagueName={activeLeague.name} divisionName={activeDivision?.name} metric={leaderMetric} leaders={leaderCard.rows} status={leaderCard.status} reduceTransparency={reduceTransparency} onMetricChange={setLeaderMetric} onRetry={() => setLeaderRetry((value) => value + 1)} onOpenPlayer={(playerId) => navigateToPlayerCard(navigation, { playerId, leagueId: activeLeague.id })} />
            <View style={styles.tableControls}>
              <Text accessibilityRole="header" style={styles.tableTitle}>Player stats</Text>
              {selectedTab === 'Goalies' && goalieView.seasonName ? <Text style={styles.seasonLabel}>{goalieView.seasonName}</Text> : null}
              {selectedTab === 'Goalies' && goalieView.rows.some((row) => row.estimated) ? <Text style={styles.estimateNote}>Estimated from published game results.</Text> : null}
              <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />
              <PillToggle options={tabs} selected={selectedTab} onChange={setSelectedTab} />
            </View>
          </>
        }
        ListEmptyComponent={selectedTab === 'Goalies' && goalieView.status === 'error'
          ? <View style={styles.tableEmpty}><Text style={styles.emptyTitle}>Unable to load goalie stats</Text><Pressable testID="goalies-retry" onPress={() => setGoalieRetry((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable></View>
          : (selectedTab === 'Skaters' ? loading : goalieView.status === 'loading')
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
  headerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  tableControls: { marginBottom: 10, gap: 8 },
  tableTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  tableEmpty: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
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
