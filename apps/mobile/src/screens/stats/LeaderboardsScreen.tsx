import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import PillToggle from '../../components/PillToggle';
import { useAuth } from '../../context/AuthContext';
import { useLeague } from '../../context/LeagueContext';
import { navigateToPlayerCard } from '../../navigation/playerCard';
import { supabase } from '../../lib/supabase/client';
import { getStatsLeaders, type PlayerStatRow } from '../../lib/supabase/data';
import { getPenaltyLeaders } from '../../lib/supabase/penaltyLeaders';
import colors from '../../theme/colors';

type StatCategory = 'Points' | 'Goals' | 'Assists' | 'PIM';
const categories: readonly StatCategory[] = ['Points', 'Goals', 'Assists', 'PIM'];

const STAT_MAP: Record<Exclude<StatCategory, 'PIM'>, 'points' | 'goals' | 'assists'> = {
  Points: 'points',
  Goals: 'goals',
  Assists: 'assists',
};

type LeaderRow = PlayerStatRow & { avatar_url: string | null; rank: number };
type LoadStatus = 'loading' | 'ready' | 'empty' | 'no-season' | 'unavailable' | 'error';
type LoadState = {
  key: string; status: LoadStatus; leaders: LeaderRow[]; error: string | null; userRank: number | null;
  unavailablePlayerCount: number;
};

export default function LeaderboardsScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const { user } = useAuth();
  const { activeLeague, activeTheme } = useLeague();
  const [category, setCategory] = React.useState<StatCategory>('Points');
  const [retryToken, setRetryToken] = React.useState(0);
  const requestSerial = React.useRef(0);
  const userId = user?.id ?? null;
  const leagueId = activeLeague?.id ?? null;
  const requestKey = `${leagueId ?? 'none'}:${category}:${userId ?? 'guest'}:${retryToken}`;
  const [loadState, setLoadState] = React.useState<LoadState>({
    key: requestKey, status: 'loading', leaders: [], error: null, userRank: null, unavailablePlayerCount: 0,
  });

  React.useEffect(() => {
    const serial = ++requestSerial.current;
    let active = true;
    const invalidate = () => {
      active = false;
      if (requestSerial.current === serial) requestSerial.current += 1;
    };
    if (!leagueId) {
      setLoadState({ key: requestKey, status: 'empty', leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 });
      return invalidate;
    }
    setLoadState({ key: requestKey, status: 'loading', leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 });

    void (async () => {
      try {
        let rows: Array<PlayerStatRow & { avatar_url: string | null }>;
        let status: Exclude<LoadStatus, 'loading' | 'error'>;
        let unavailablePlayerCount = 0;
        if (category === 'PIM') {
          const result = await getPenaltyLeaders(leagueId, 50);
          rows = result.leaders;
          status = result.status;
          unavailablePlayerCount = result.unavailablePlayerCount;
        } else {
          const stats = await getStatsLeaders(
            leagueId, STAT_MAP[category], 50, null, undefined, { throwOnError: true },
          );
          const playerIds = stats.map((row) => row.player_id);
          let avatarMap = new Map<string, string | null>();
          if (playerIds.length > 0) {
            const { data: profiles, error } = await supabase
              .from('profiles')
              .select('id, avatar_url')
              .in('id', playerIds);
            if (error) throw new Error(error.message);
            avatarMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.avatar_url]));
          }
          rows = stats.map((row) => ({ ...row, avatar_url: avatarMap.get(row.player_id) ?? null }));
          status = rows.length > 0 ? 'ready' : 'empty';
        }

        const sorted = [...rows];
        if (category === 'Goals') sorted.sort((left, right) => right.goals - left.goals);
        if (category === 'Assists') sorted.sort((left, right) => right.assists - left.assists);
        const ranked: LeaderRow[] = sorted.map((row, index) => ({ ...row, rank: index + 1 }));
        if (!active || requestSerial.current !== serial) return;
        const myIndex = userId ? ranked.findIndex((row) => row.player_id === userId) : -1;
        setLoadState({
          key: requestKey, status, leaders: ranked, error: null,
          userRank: myIndex >= 0 ? myIndex + 1 : null, unavailablePlayerCount,
        });
      } catch (error) {
        if (!active || requestSerial.current !== serial) return;
        setLoadState({
          key: requestKey, status: 'error', leaders: [], userRank: null,
          error: error instanceof Error ? error.message : 'Unable to load leaderboard',
          unavailablePlayerCount: 0,
        });
      }
    })();
    return invalidate;
  }, [category, leagueId, requestKey, retryToken, userId]);

  const boundState = loadState.key === requestKey
    ? loadState
    : { key: requestKey, status: 'loading' as const, leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 };
  const leaders = boundState.leaders;

  const getStatValue = (row: LeaderRow): number => {
    switch (category) {
      case 'Goals': return row.goals;
      case 'Assists': return row.assists;
      case 'PIM': return row.penalty_minutes as number;
      default: return row.points;
    }
  };

  if (!activeLeague) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Leaderboards</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Select a league to view leaderboards</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Leaderboards</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.filterWrap}>
        <PillToggle options={categories} selected={category} onChange={setCategory} />
      </View>

      {boundState.userRank !== null && (
        <View style={styles.userRankBanner}>
          <Ionicons name="trophy" size={16} color={colors.brandGold} />
          <Text style={styles.userRankText}>
            Your rank: #{boundState.userRank} in {category}
          </Text>
        </View>
      )}

      {boundState.status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={activeTheme.primaryColor} />
        </View>
      ) : boundState.status === 'error' ? (
        <View style={styles.centered} testID="pim-leaders-error">
          <Text style={styles.emptyText}>{boundState.error ?? 'Unable to load leaderboard'}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetryToken((value) => value + 1)}
            style={styles.retryButton}
            testID="pim-leaders-retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : boundState.status === 'no-season' ? (
        <View style={styles.centered}><Text style={styles.emptyText}>No current season</Text></View>
      ) : boundState.status === 'unavailable' ? (
        <View style={styles.centered}><Text style={styles.emptyText}>PIM is unavailable for this season</Text></View>
      ) : leaders.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{category === 'PIM' ? 'No PIM recorded yet' : 'No stats available yet'}</Text>
        </View>
      ) : (
        <>
          {boundState.unavailablePlayerCount > 0 && (
            <View style={styles.partialNotice} testID="pim-partial-notice">
              <Text style={styles.partialNoticeText}>
                {boundState.unavailablePlayerCount} players excluded: PIM unavailable
              </Text>
            </View>
          )}
          <FlatList
            data={leaders}
            keyExtractor={(item) => `${item.player_id}-${item.rank}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
            const isCurrentUser = user?.id === item.player_id;
            const isTop3 = item.rank <= 3;
            return (
              <Pressable
                accessibilityLabel={`${item.player_name}, rank ${item.rank}. Open player card`}
                accessibilityRole="button"
                onPress={() => navigateToPlayerCard(navigation, { playerId: item.player_id, leagueId })}
                style={[
                  styles.leaderRow,
                  isCurrentUser && styles.leaderRowHighlight,
                  isTop3 && styles.leaderRowTop3,
                ]}
                testID={`leaderboard-player-${item.player_id}`}
              >
                <View style={styles.rankCol}>
                  <Text
                    style={[
                      styles.rankText,
                      isTop3 && { color: colors.brandGold },
                    ]}
                  >
                    {item.rank}
                  </Text>
                </View>
                <Avatar uri={item.avatar_url} name={item.player_name} size={36} />
                <View style={styles.playerInfo}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {item.player_name}
                    {isCurrentUser ? ' (You)' : ''}
                  </Text>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {item.team_short_name}
                    {category !== 'PIM' ? ` | ${item.games_played} GP` : ''}
                  </Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={[styles.statValue, isTop3 && { color: colors.brandGold }]}>
                    {getStatValue(item)}
                  </Text>
                  <Text style={styles.statLabel}>{category === 'PIM' ? 'PIM' : category.slice(0, 3).toUpperCase()}</Text>
                </View>
                {category !== 'PIM' && (
                  <View style={styles.secondaryStats}>
                    {category !== 'Goals' && <Text style={styles.secondaryStat}>{item.goals}G</Text>}
                    {category !== 'Assists' && <Text style={styles.secondaryStat}>{item.assists}A</Text>}
                    {category !== 'Points' && <Text style={styles.secondaryStat}>{item.points}P</Text>}
                  </View>
                )}
              </Pressable>
            );
            }}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  retryButton: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  filterWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  partialNotice: { marginHorizontal: 16, marginBottom: 8 },
  partialNoticeText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },

  userRankBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userRankText: { fontSize: 13, fontWeight: '800', color: colors.brandGold },

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  leaderRowHighlight: {
    backgroundColor: 'rgba(79,216,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(79,216,255,0.2)',
    borderBottomWidth: 1,
  },
  leaderRowTop3: {
    backgroundColor: 'rgba(212,175,55,0.06)',
  },
  rankCol: { width: 28, alignItems: 'center' },
  rankText: { fontSize: 16, fontWeight: '900', color: colors.textSecondary },
  playerInfo: { flex: 1, minWidth: 0 },
  playerName: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  teamName: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  statCol: { alignItems: 'center', minWidth: 36 },
  statValue: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  secondaryStats: { flexDirection: 'column', minWidth: 32 },
  secondaryStat: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
});
