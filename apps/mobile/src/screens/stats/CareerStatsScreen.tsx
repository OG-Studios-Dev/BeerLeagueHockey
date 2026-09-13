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
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '../../components/Avatar';
import BrandAtmosphere from '../../components/BrandAtmosphere';
import SectionHeader from '../../components/SectionHeader';
import { useAuth } from '../../context/AuthContext';
import { useLeague } from '../../context/LeagueContext';
import { discoverCareerLeagues, formatPublicMetric, loadCanonicalCareerV2, type CareerSeasonV2, type PublicCareerV2 } from '../../lib/supabase/publicStats';
import colors from '../../theme/colors';

type CareerTotals = PublicCareerV2['totals'];

type LeagueGroup = {
  leagueId: string;
  leagueName: string;
  seasonCount: number;
  seasons: CareerSeasonV2[];
  expanded: boolean;
};

export default function CareerStatsScreen({ navigation }: { navigation: { goBack(): void } }) {
  const { user } = useAuth();
  const { availableLeagues } = useLeague();
  const { width, fontScale } = useWindowDimensions();
  const useTwoColumnGoalieTotals = width <= 360 || fontScale >= 1.3;
  const [totals, setTotals] = React.useState<CareerTotals>({
    roles: ['skater'], goalie: null,
    metrics: {
      gamesPlayed: { value: null, state: 'unknown', sources: [] }, goals: { value: 0, state: 'recorded', sources: ['skater_stats'] },
      assists: { value: 0, state: 'recorded', sources: ['skater_stats'] }, points: { value: 0, state: 'recorded', sources: ['skater_stats'] },
      penaltyMinutes: { value: null, state: 'unknown', sources: [] },
    },
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
      const career = await loadCanonicalCareerV2(user.id, leagues);
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
        {totals.roles.includes('skater') ? <View style={styles.totalsCard}>
          <LinearGradient
            colors={['rgba(255,255,255,0.06)', 'rgba(79,216,255,0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.totalsRow}>
            <View testID="career-hero-gp-cell" style={[styles.totalItem, totals.metrics.gamesPlayed.state === 'conflicted' && styles.statusTotalItem]}>
              <Text testID="career-hero-gp-value" style={[styles.totalValue, totals.metrics.gamesPlayed.state === 'conflicted' && styles.statusTotalValue]}>{formatPublicMetric(totals.metrics.gamesPlayed).value}</Text>
              <Text style={styles.totalLabel}>GP</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{formatPublicMetric(totals.metrics.goals).value}</Text>
              <Text style={styles.totalLabel}>G</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{formatPublicMetric(totals.metrics.assists).value}</Text>
              <Text style={styles.totalLabel}>A</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={[styles.totalValue, { color: colors.brandGold }]}>{formatPublicMetric(totals.metrics.points).value}</Text>
              <Text style={styles.totalLabel}>PTS</Text>
            </View>
            <View style={styles.totalItem}>
              <Text style={styles.totalValue}>{formatPublicMetric(totals.metrics.penaltyMinutes).value}</Text>
              <Text style={styles.totalLabel}>PIM</Text>
            </View>
          </View>
        </View> : null}
        {totals.goalie ? (
          <View testID="career-goalie-totals" style={styles.totalsCard}>
            <Text style={styles.goalieTotalsTitle}>Goalie Totals</Text>
            <View style={[styles.totalsRow, styles.goalieTotalsRow]}>
              {([
                ['GP', 'gp', totals.goalie.gamesPlayed, undefined], ['W', 'w', totals.goalie.wins, undefined],
                ['L', 'l', totals.goalie.losses, undefined], ['SV', 'sv', totals.goalie.saves, undefined],
                ['GA', 'ga', totals.goalie.goalsAgainst, undefined], ['SV%', 'sv-pct', totals.goalie.savePercentage, 3],
                ['GAA', 'gaa', totals.goalie.goalsAgainstAverage, 2], ['SO', 'so', totals.goalie.shutouts, undefined],
              ] as const).map(([label, metricId, metric, precision]) => (
                <View key={label} testID={`career-goalie-${metricId}-cell`} style={[styles.goalieTotalItem, useTwoColumnGoalieTotals && styles.goalieTotalItemCompact]}>
                  <Text testID={`career-goalie-${metricId}-value`} style={styles.totalValue}>{formatPublicMetric(metric, precision).value}</Text>
                  <Text style={styles.totalLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {totals.roles.includes('skater') && totals.metrics.gamesPlayed.state === 'conflicted' ? <Text style={styles.pimNote}>GP: {formatPublicMetric(totals.metrics.gamesPlayed).hint}</Text> : null}
        {totals.roles.includes('skater') && totals.metrics.penaltyMinutes.value === null ? <Text style={styles.pimNote}>PIM unavailable: {formatPublicMetric(totals.metrics.penaltyMinutes).hint}</Text> : null}
        {totals.roles.includes('skater') && totals.roles.includes('goalie')
          ? <Text style={styles.scopeNote}>Career includes both skater and goalie records.</Text>
          : totals.roles.includes('goalie') ? <Text style={styles.scopeNote}>Career includes goalie records.</Text> : null}
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
                      <Text maxFontSizeMultiplier={1.3} style={[styles.tableHeaderCell, styles.tableTeamCol]}>Season</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.tableHeaderCell}>GP</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.tableHeaderCell}>G</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.tableHeaderCell}>A</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.tableHeaderCell}>PTS</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.tableHeaderCell}>PIM</Text>
                    </View>
                    {group.seasons.map((season, index) => (
                      <View key={`${season.seasonId}-${index}`} style={styles.tableRow}>
                        <View style={styles.tableTeamCol}>
                          <Text style={styles.seasonName} numberOfLines={1}>{season.seasonName}</Text>
                          <Text style={styles.seasonTeam} numberOfLines={1}>{season.teams.map((team) => team.name).join(' · ') || 'League aggregate'}{Object.values(season.metrics).some((metric) => metric.sources.includes('imported')) ? ' · Imported' : ''}</Text>
                        </View>
                        <Text style={styles.tableCell}>{formatPublicMetric(season.metrics.gamesPlayed).value}</Text>
                        <Text style={styles.tableCell}>{formatPublicMetric(season.metrics.goals).value}</Text>
                        <Text style={styles.tableCell}>{formatPublicMetric(season.metrics.assists).value}</Text>
                        <Text style={[styles.tableCell, styles.tableCellHighlight]}>{formatPublicMetric(season.metrics.points).value}</Text>
                        <Text style={styles.tableCell}>{formatPublicMetric(season.metrics.penaltyMinutes).value}</Text>
                        {season.goalie ? <Text style={styles.roleDetail}>Goalie · {formatPublicMetric(season.goalie.gamesPlayed).value} GP · {formatPublicMetric(season.goalie.saves).value} SV · {formatPublicMetric(season.goalie.goalsAgainstAverage, 2).value} GAA</Text> : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* Empty State */}
        {totals.metrics.gamesPlayed.value === 0 && totals.metrics.points.value === 0 && (totals.goalie?.gamesPlayed.value ?? 0) === 0 && (
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
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: 14,
  },
  totalItem: { alignItems: 'center', gap: 4 },
  statusTotalItem: { width: '100%', paddingHorizontal: 8 },
  statusTotalValue: { alignSelf: 'stretch', fontSize: 20, lineHeight: 26, textAlign: 'center' },
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
    flexWrap: 'wrap',
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
  roleDetail: { flexBasis: '100%', marginTop: 8, color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  goalieTotalsTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  goalieTotalsRow: { flexWrap: 'wrap', rowGap: 14 },
  goalieTotalItem: { width: '25%', alignItems: 'center' },
  goalieTotalItemCompact: { width: '50%' },

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
