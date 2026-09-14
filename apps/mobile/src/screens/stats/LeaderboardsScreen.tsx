import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import { FocusFlatList } from '../../components/CardFocus';
import PillToggle from '../../components/PillToggle';
import { useAuth } from '../../context/AuthContext';
import { useLeague } from '../../context/LeagueContext';
import { navigateToPlayerCard } from '../../navigation/playerCard';
import { getStatsLeadersFromPublicSeason, type PlayerStatRow } from '../../lib/supabase/data';
import { formatPublicMetric, getPublicSeasonStats, type PublicSeasonStats } from '../../lib/supabase/publicStats';
import { getMetricsOperationalSeason, type TeamActiveSeason } from '../../lib/supabase/team';
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
  const leagueSlug = activeLeague?.slug ?? null;
  const seasonPromise = React.useRef<{ leagueId: string; promise: Promise<{ season: TeamActiveSeason | null; error: string | null }> } | null>(null);
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
    if (!leagueId || !leagueSlug) {
      setLoadState({ key: requestKey, status: 'empty', leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 });
      return invalidate;
    }
    setLoadState({ key: requestKey, status: 'loading', leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 });

    void (async () => {
      try {
        let rows: Array<PlayerStatRow & { avatar_url: string | null }>;
        let status: Exclude<LoadStatus, 'loading' | 'error'>;
        let unavailablePlayerCount = 0;
        if (seasonPromise.current?.leagueId !== leagueId) {
          seasonPromise.current = { leagueId, promise: getMetricsOperationalSeason(leagueId) };
        }
        const { season, error: seasonError } = await seasonPromise.current.promise;
        if (seasonError) throw new Error(`Unable to resolve the stats season: ${seasonError}`);
        if (!season) {
          rows = []; status = 'no-season';
        } else {
          const payload: PublicSeasonStats = await getPublicSeasonStats(leagueSlug, leagueId, season.id);
          const stat = category === 'PIM' ? 'penalty_minutes' : STAT_MAP[category];
          rows = getStatsLeadersFromPublicSeason(payload, stat, 50) as Array<PlayerStatRow & { avatar_url: string | null }>;
          if (category === 'PIM') {
            unavailablePlayerCount = payload.players.filter((player) => player.roles.includes('skater') && player.metrics.penaltyMinutes.value === null).length;
            status = rows.length > 0 ? 'ready' : unavailablePlayerCount > 0 ? 'unavailable' : 'empty';
          } else status = rows.length > 0 ? 'ready' : 'empty';
        }

        const sorted = [...rows];
        if (category === 'Goals') sorted.sort((left, right) => (right.goals ?? -Infinity) - (left.goals ?? -Infinity));
        if (category === 'Assists') sorted.sort((left, right) => (right.assists ?? -Infinity) - (left.assists ?? -Infinity));
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
  }, [category, leagueId, leagueSlug, requestKey, retryToken, userId]);

  const boundState = loadState.key === requestKey
    ? loadState
    : { key: requestKey, status: 'loading' as const, leaders: [], error: null, userRank: null, unavailablePlayerCount: 0 };
  const leaders = boundState.leaders;

  const getStatValue = (row: LeaderRow): string | number => {
    if (row.metrics) {
      const metric = category === 'PIM' ? row.metrics.penaltyMinutes
        : category === 'Goals' ? row.metrics.goals
          : category === 'Assists' ? row.metrics.assists : row.metrics.points;
      return formatPublicMetric(metric).value;
    }
    switch (category) {
      case 'Goals': return row.goals ?? '—';
      case 'Assists': return row.assists ?? '—';
      case 'PIM': return row.penalty_minutes ?? '—';
      default: return row.points ?? '—';
    }
  };

  const retryLoad = () => {
    seasonPromise.current = null;
    setRetryToken((value) => value + 1);
  };

  if (!activeLeague) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Select a league to view leaderboards</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
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
            onPress={retryLoad}
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
          <FocusFlatList
            focusScopeKey={`leaderboards:${activeLeague.id}:${category}`}
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
                    {category !== 'PIM' ? ` | ${item.metrics ? formatPublicMetric(item.metrics.gamesPlayed).value : item.games_played ?? '—'} GP` : ''}
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
                    {category !== 'Goals' && <Text style={styles.secondaryStat}>{item.metrics ? formatPublicMetric(item.metrics.goals).value : item.goals ?? '—'}G</Text>}
                    {category !== 'Assists' && <Text style={styles.secondaryStat}>{item.metrics ? formatPublicMetric(item.metrics.assists).value : item.assists ?? '—'}A</Text>}
                    {category !== 'Points' && <Text style={styles.secondaryStat}>{item.metrics ? formatPublicMetric(item.metrics.points).value : item.points ?? '—'}P</Text>}
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
