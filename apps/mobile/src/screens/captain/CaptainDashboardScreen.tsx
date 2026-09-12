import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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

import BrandAtmosphere from '../../components/BrandAtmosphere';
import SectionHeader from '../../components/SectionHeader';
import TeamLogo from '../../components/TeamLogo';
import { useAuth } from '../../context/AuthContext';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../lib/supabase/client';
import { getCaptainRole, type CaptainRole } from '../../lib/supabase/captain';
import colors from '../../theme/colors';

type CaptainTeam = {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  leagueId: string;
  leagueName: string;
  role: CaptainRole;
  rosterCount: number;
  nextGame: {
    id: string;
    scheduled_at: string;
    opponent: string;
    location: string | null;
  } | null;
};

export default function CaptainDashboardScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const { activeTheme, availableLeagues, setActiveLeague } = useLeague();
  const [captainTeams, setCaptainTeams] = React.useState<CaptainTeam[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const loadData = React.useCallback(async () => {
    if (!user) return;

    try {
      // Get all teams the user is on with leadership roles
      const { data: rosterRows } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id, leadership_role,
          team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color),
          league:leagues!team_rosters_league_id_fkey(id, name)
        `)
        .eq('player_id', user.id)
        .eq('status', 'active')
        .in('leadership_role', ['captain', 'alternate_captain']);

      const rows = (rosterRows as any[]) ?? [];
      if (rows.length === 0) {
        setCaptainTeams([]);
        return;
      }

      const teams: CaptainTeam[] = [];

      for (const row of rows) {
        const team = Array.isArray(row.team) ? row.team[0] : row.team;
        const league = Array.isArray(row.league) ? row.league[0] : row.league;
        if (!team || !league) continue;

        // Get roster count
        const { count: rosterCount } = await supabase
          .from('team_rosters')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', row.team_id)
          .eq('league_id', row.league_id)
          .eq('status', 'active');

        // Get next game
        const { data: nextGameData } = await supabase
          .from('games')
          .select(`
            id, scheduled_at, location, home_team_id, away_team_id,
            home_team:teams!games_home_team_id_fkey(name),
            away_team:teams!games_away_team_id_fkey(name)
          `)
          .eq('league_id', row.league_id)
          .or(`home_team_id.eq.${row.team_id},away_team_id.eq.${row.team_id}`)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        let nextGame: CaptainTeam['nextGame'] = null;
        if (nextGameData) {
          const g = nextGameData as any;
          const homeTeam = Array.isArray(g.home_team) ? g.home_team[0] : g.home_team;
          const awayTeam = Array.isArray(g.away_team) ? g.away_team[0] : g.away_team;
          const isHome = g.home_team_id === row.team_id;
          const opponent = isHome ? (awayTeam?.name ?? 'TBD') : (homeTeam?.name ?? 'TBD');
          nextGame = {
            id: g.id,
            scheduled_at: g.scheduled_at,
            opponent,
            location: g.location ?? null,
          };
        }

        teams.push({
          teamId: row.team_id,
          teamName: team.name,
          teamLogoUrl: team.logo_url ?? null,
          teamPrimaryColor: team.primary_color ?? null,
          leagueId: row.league_id,
          leagueName: league.name,
          role: row.leadership_role as CaptainRole,
          rosterCount: rosterCount ?? 0,
          nextGame,
        });
      }

      setCaptainTeams(teams);
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  function formatGameDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Captain Dashboard</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (captainTeams.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Captain Dashboard</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="shield-crown-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>No captain duties</Text>
          <Text style={styles.emptySub}>You are not a captain or assistant captain on any teams.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <BrandAtmosphere accentColor={colors.brandGold} intensity="low" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Captain Dashboard</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Your Teams" />

        {captainTeams.map((team) => (
          <View key={`${team.teamId}-${team.leagueId}`} style={styles.teamCard}>
            <LinearGradient
              colors={[`${team.teamPrimaryColor ?? colors.primary}12`, 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            {/* Team Identity */}
            <View style={styles.teamIdentity}>
              <TeamLogo
                teamId={team.teamId}
                logoUrl={team.teamLogoUrl}
                teamName={team.teamName}
                primaryColor={team.teamPrimaryColor}
                size={48}
              />
              <View style={styles.teamInfo}>
                <Text style={styles.teamName}>{team.teamName}</Text>
                <Text style={styles.leagueName}>{team.leagueName}</Text>
              </View>
              <View style={[styles.roleBadge, team.role === 'captain' ? styles.captainBadge : styles.altCaptainBadge]}>
                <Text style={styles.roleBadgeText}>
                  {team.role === 'captain' ? 'C' : 'A'}
                </Text>
              </View>
            </View>

            {/* Quick Stats */}
            <View style={styles.quickStatsRow}>
              <View style={styles.quickStat}>
                <Text style={styles.quickStatValue}>{team.rosterCount}</Text>
                <Text style={styles.quickStatLabel}>Roster</Text>
              </View>
              <View style={styles.quickStat}>
                <Text style={styles.quickStatValue}>
                  {team.nextGame ? 'Yes' : 'No'}
                </Text>
                <Text style={styles.quickStatLabel}>Next Game</Text>
              </View>
            </View>

            {/* Next Game */}
            {team.nextGame && (
              <View style={styles.nextGameSection}>
                <Text style={styles.nextGameLabel}>NEXT GAME</Text>
                <Text style={styles.nextGameOpponent}>vs {team.nextGame.opponent}</Text>
                <Text style={styles.nextGameDate}>{formatGameDate(team.nextGame.scheduled_at)}</Text>
                {team.nextGame.location && (
                  <Text style={styles.nextGameLocation}>{team.nextGame.location}</Text>
                )}
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.actionRow}>
              {team.nextGame && (
                <Pressable
                  style={styles.actionButton}
                  onPress={() => navigation.navigate('GameAvailability', {
                    gameId: team.nextGame!.id,
                    teamId: team.teamId,
                    leagueId: team.leagueId,
                  })}
                >
                  <Ionicons name="clipboard-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.actionButtonText}>Availability</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.actionButton}
                onPress={() => navigation.navigate('TeamChat', {
                  teamId: team.teamId,
                  leagueId: team.leagueId,
                  teamName: team.teamName,
                })}
              >
                <Ionicons name="megaphone-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.actionButtonText}>Announce</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => navigation.navigate('InvitePlayers', {
                  teamId: team.teamId,
                  leagueId: team.leagueId,
                  teamName: team.teamName,
                })}
              >
                <Ionicons name="person-add-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.actionButtonText}>Invite</Text>
              </Pressable>
            </View>
          </View>
        ))}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  emptySub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  teamCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  teamIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  leagueName: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captainBadge: { backgroundColor: colors.brandGold },
  altCaptainBadge: { backgroundColor: colors.accentViolet },
  roleBadgeText: { fontSize: 14, fontWeight: '900', color: '#000' },

  quickStatsRow: { flexDirection: 'row', gap: 10 },
  quickStat: {
    flex: 1,
    backgroundColor: colors.glassHighlight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 12,
    alignItems: 'center',
  },
  quickStatValue: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  quickStatLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },

  nextGameSection: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 12,
    gap: 4,
  },
  nextGameLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.primary },
  nextGameOpponent: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  nextGameDate: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  nextGameLocation: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionButton: {
    flex: 1,
    minWidth: 90,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.bgInteractive,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  actionButtonText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
});
