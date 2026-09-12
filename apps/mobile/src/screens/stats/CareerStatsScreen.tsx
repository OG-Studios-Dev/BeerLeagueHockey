import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import BrandAtmosphere from '../../components/BrandAtmosphere';
import SectionHeader from '../../components/SectionHeader';
import { useAuth } from '../../context/AuthContext';
import { useLeague } from '../../context/LeagueContext';
import { discoverCareerLeagues, loadCanonicalCareer, type CareerSeason } from '../../lib/supabase/publicStats';
import colors from '../../theme/colors';

type CareerTotals = {
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  penaltyMinutes: number | null;
};

type LeagueGroup = {
  leagueId: string;
  leagueName: string;
  seasonCount: number;
  seasons: CareerSeason[];
  expanded: boolean;
};

export default function CareerStatsScreen({ navigation }: { navigation: { goBack(): void } }) {
  const { user } = useAuth();
  const { availableLeagues } = useLeague();
  const [totals, setTotals] = React.useState<CareerTotals>({
    gamesPlayed: 0,
    goals: 0,
    assists: 0,
    points: 0,
    penaltyMinutes: null,
  });
  const [leagueGroups, setLeagueGroups] = React.useState<LeagueGroup[]>([]);
  const [profile, setProfile] = React.useState<{ full_name: string | null; avatar_url: string | null } | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>(user ? 'loading' : 'ready');
  const [refreshing, setRefreshing] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [snapshotScope, setSnapshotScope] = React.useState('');
  const requestGeneration = React.useRef(0);
  const careerScope = `${user?.id ?? 'signed-out'}:${availableLeagues.map(({ id, name, slug }) => `${id}:${name}:${slug}`).join('|')}`;
  const viewStatus = snapshotScope === careerScope ? status : (user ? 'loading' : 'ready');

  const loadStats = React.useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!user) {
      setSnapshotScope(careerScope); setStatus('ready'); setLeagueGroups([]); setProfile(null);
      return true;
    }
    setSnapshotScope(careerScope);
    setStatus('loading');
    try {
      const seeds = availableLeagues.map(({ id, name, slug }) => ({ id, name, slug }));
      const leagues = await discoverCareerLeagues(user.id, seeds);
      const career = await loadCanonicalCareer(user.id, leagues);
      if (generation !== requestGeneration.current) return false;
      setProfile(career.player ? { full_name: career.player.name, avatar_url: career.player.avatarUrl } : null);
      setTotals(career.totals);
      setLeagueGroups(career.leagues.filter((league) => league.seasons.length > 0).map((league) => ({ leagueId: league.id, leagueName: league.name,
        seasonCount: league.seasonCount, seasons: league.seasons, expanded: false })));
      setStatus('ready');
      return true;
    } catch {
      if (generation === requestGeneration.current) { setStatus('error'); return true; }
      return false;
    }
  }, [user, availableLeagues, careerScope]);

  React.useEffect(() => {
    void loadStats();
    return () => { requestGeneration.current += 1; };
  }, [loadStats, retry]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    if (await loadStats()) setRefreshing(false);
  }, [loadStats]);

  const toggleLeague = (leagueId: string) => {
    setLeagueGroups((groups) =>
      groups.map((g) =>
        g.leagueId === leagueId ? { ...g, expanded: !g.expanded } : g,
      ),
    );
  };

  if (viewStatus === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Career Stats</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user || viewStatus === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></Pressable>
          <Text style={styles.headerTitle}>Career Stats</Text><View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>{user ? 'Unable to load career stats' : 'Sign in to view career stats'}</Text>
          {user ? <Pressable testID="career-retry" onPress={() => setRetry((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <BrandAtmosphere intensity="low" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Career Stats</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Player Identity */}
        <View style={styles.identityCard}>
          <LinearGradient
            colors={['rgba(79,216,255,0.12)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Avatar
            uri={profile?.avatar_url ?? null}
            name={profile?.full_name ?? 'Player'}
            size={64}
            borderColor={colors.primary}
          />
          <View style={styles.identityInfo}>
            <Text style={styles.playerName}>{profile?.full_name ?? 'Player'}</Text>
            <Text style={styles.playerSub}>Career Overview</Text>
          </View>
        </View>

        {/* Career Totals Hero */}
        <SectionHeader title="Career Totals" />
        <View style={styles.totalsCard}>
          <LinearGradient
            colors={['rgba(255,255,255,0.06)', 'rgba(79,216,255,0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.totalsRow}>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{totals.gamesPlayed}</Text>
              <Text style={styles.totalLabel}>GP</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{totals.goals}</Text>
              <Text style={styles.totalLabel}>G</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{totals.assists}</Text>
              <Text style={styles.totalLabel}>A</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={[styles.totalValue, { color: colors.brandGold }]}>{totals.points}</Text>
              <Text style={styles.totalLabel}>PTS</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{totals.penaltyMinutes ?? '—'}</Text>
              <Text style={styles.totalLabel}>PIM</Text>
            </View>
          </View>
        </View>
        {totals.penaltyMinutes === null ? <Text style={styles.pimNote}>PIM unavailable for some historical records.</Text> : null}
        <Text style={styles.scopeNote}>Published leagues only · Demo results excluded</Text>

        {/* By League Breakdown */}
        {leagueGroups.length > 0 && (
          <>
            <SectionHeader title="By League" />
            {leagueGroups.map((group) => (
              <View key={group.leagueId} style={styles.leagueGroupCard}>
                <Pressable testID={`career-league-${group.leagueId}`} style={styles.leagueGroupHeader} onPress={() => toggleLeague(group.leagueId)}>
                  <View style={styles.leagueGroupInfo}>
                    <Text style={styles.leagueGroupName}>{group.leagueName}</Text>
                    <Text style={styles.leagueGroupMeta}>
                      {group.seasonCount} season{group.seasonCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={group.expanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>

                {group.expanded && (
                  <View style={styles.seasonsTable}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHeaderCell, styles.tableTeamCol]}>Season</Text>
                      <Text style={styles.tableHeaderCell}>GP</Text>
                      <Text style={styles.tableHeaderCell}>G</Text>
                      <Text style={styles.tableHeaderCell}>A</Text>
                      <Text style={styles.tableHeaderCell}>PTS</Text>
                      <Text style={styles.tableHeaderCell}>PIM</Text>
                    </View>
                    {group.seasons.map((season, index) => (
                      <View key={`${season.seasonId}-${index}`} style={styles.tableRow}>
                        <View style={styles.tableTeamCol}>
                          <Text style={styles.seasonName} numberOfLines={1}>{season.seasonName}</Text>
                          <Text style={styles.seasonTeam} numberOfLines={1}>{season.teamName ?? 'League aggregate'}{season.source === 'imported' ? ' · Imported' : ''}</Text>
                        </View>
                        <Text style={styles.tableCell}>{season.gamesPlayed}</Text>
                        <Text style={styles.tableCell}>{season.goals}</Text>
                        <Text style={styles.tableCell}>{season.assists}</Text>
                        <Text style={[styles.tableCell, styles.tableCellHighlight]}>{season.points}</Text>
                        <Text style={styles.tableCell}>{season.penaltyMinutes ?? '—'}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* Empty State */}
        {totals.gamesPlayed === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="stats-chart-outline" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No career stats yet</Text>
            <Text style={styles.emptySub}>
              Stats from your games will accumulate here as you play in BLH leagues.
            </Text>
          </View>
        )}
      </ScrollView>
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
  content: { padding: 16, paddingBottom: 40, gap: 8 },

  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 16,
    overflow: 'hidden',
  },
  identityInfo: { flex: 1 },
  playerName: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  playerSub: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

  totalsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    padding: 20,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  totalItem: { alignItems: 'center', gap: 4 },
  totalValue: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  pimNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  scopeNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  retryText: { color: colors.primary, fontSize: 15, fontWeight: '800', marginTop: 14 },

  leagueGroupCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    overflow: 'hidden',
    marginBottom: 4,
  },
  leagueGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  leagueGroupInfo: { flex: 1 },
  leagueGroupName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  leagueGroupMeta: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },

  seasonsTable: {
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgInteractive,
  },
  tableHeaderCell: {
    flex: 0.7,
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tableTeamCol: { flex: 2, paddingRight: 6 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  seasonName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  seasonTeam: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  tableCell: {
    flex: 0.7,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tableCellHighlight: { fontWeight: '900', color: colors.primary },

  emptyCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  emptySub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
});
