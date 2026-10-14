import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cutIceContentEdges } from '../../navigation/cutIceSafeAreaPolicy';

import { FocusCard, FocusScrollView } from '../../components/CardFocus';
import SectionHeader from '../../components/SectionHeader';
import TeamLogo from '../../components/TeamLogo';
import { useAuth } from '../../context/AuthContext';
import { HOCKEY_LIFE_ID } from '../../config/hockeyLife';
import { supabase } from '../../lib/supabase/client';
import { type CaptainRole } from '../../lib/supabase/captain';
import { getTeamActiveSeason } from '../../lib/supabase/team';
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

type CaptainDashboardState = {
  ownerId: string | null;
  captainTeams: CaptainTeam[];
  loadError: string | null;
  loading: boolean;
};

const CAPTAIN_DASHBOARD_ERROR = 'Captain duties are temporarily unavailable.';

function loadingDashboardState(ownerId: string | null): CaptainDashboardState {
  return { ownerId, captainTeams: [], loadError: null, loading: true };
}

export default function CaptainDashboardScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [dashboardState, setDashboardState] = React.useState<CaptainDashboardState>(() => loadingDashboardState(userId));
  const [refreshing, setRefreshing] = React.useState(false);
  const loadRequestRef = React.useRef(0);
  const refreshRequestRef = React.useRef(0);
  const currentUserIdRef = React.useRef<string | null>(userId);
  const mountedRef = React.useRef(false);
  const lifecycleGenerationRef = React.useRef(0);
  currentUserIdRef.current = userId;

  React.useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      loadRequestRef.current += 1;
      refreshRequestRef.current += 1;
    };
  }, []);

  const loadData = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      lifecycleGenerationRef.current === lifecycleGeneration &&
      loadRequestRef.current === requestId &&
      currentUserIdRef.current === userId;
    if (!userId) {
      if (isCurrentRequest()) {
        setDashboardState({ ownerId: userId, captainTeams: [], loadError: null, loading: false });
      }
      return;
    }

    try {
      if (isCurrentRequest()) {
        setDashboardState(current => current.ownerId === userId
          ? { ...current, loadError: null }
          : loadingDashboardState(userId));
      }
      const { season, error: seasonError } = await getTeamActiveSeason(HOCKEY_LIFE_ID);
      if (!isCurrentRequest()) return;
      if (seasonError) throw new Error(seasonError);
      if (!season || !['active', 'playoffs'].includes(season.status)) {
        setDashboardState({ ownerId: userId, captainTeams: [], loadError: null, loading: false });
        return;
      }

      // Get current-season teams the user is on with leadership roles
      const { data: rosterRows, error: rosterError } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id, leadership_role,
          team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color),
          league:leagues!team_rosters_league_id_fkey(id, name)
        `)
        .eq('player_id', userId)
        .eq('league_id', HOCKEY_LIFE_ID)
        .eq('season_id', season.id)
        .eq('status', 'active')
        .is('end_date', null)
        .in('leadership_role', ['captain', 'alternate_captain']);
      if (!isCurrentRequest()) return;
      if (rosterError) throw rosterError;

      const rows = (rosterRows as any[]) ?? [];
      if (rows.length === 0) {
        setDashboardState({ ownerId: userId, captainTeams: [], loadError: null, loading: false });
        return;
      }

      const teams: CaptainTeam[] = [];

      for (const row of rows) {
        const team = Array.isArray(row.team) ? row.team[0] : row.team;
        const league = Array.isArray(row.league) ? row.league[0] : row.league;
        if (!team || !league) continue;

        // Get roster count
        const { count: rosterCount, error: rosterCountError } = await supabase
          .from('team_rosters')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', row.team_id)
          .eq('league_id', row.league_id)
          .eq('season_id', season.id)
          .eq('status', 'active')
          .is('end_date', null);
        if (!isCurrentRequest()) return;
        if (rosterCountError) throw rosterCountError;

        // Get next game
        const { data: nextGameData, error: nextGameError } = await supabase
          .from('games')
          .select(`
            id, scheduled_at, location, home_team_id, away_team_id,
            home_team:teams!games_home_team_id_fkey(name),
            away_team:teams!games_away_team_id_fkey(name)
          `)
          .eq('league_id', row.league_id)
          .eq('season_id', season.id)
          .or(`home_team_id.eq.${row.team_id},away_team_id.eq.${row.team_id}`)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!isCurrentRequest()) return;
        if (nextGameError) throw nextGameError;

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

      if (isCurrentRequest()) {
        setDashboardState({ ownerId: userId, captainTeams: teams, loadError: null, loading: false });
      }
    } catch {
      if (isCurrentRequest()) {
        setDashboardState({
          ownerId: userId,
          captainTeams: [],
          loadError: CAPTAIN_DASHBOARD_ERROR,
          loading: false,
        });
      }
    } finally {
      if (isCurrentRequest()) {
        setDashboardState(current => current.ownerId === userId && current.loading
          ? { ...current, loading: false }
          : current);
      }
    }
  }, [userId]);

  React.useEffect(() => {
    refreshRequestRef.current += 1;
    setRefreshing(false);
    setDashboardState(loadingDashboardState(userId));
    void loadData();
  }, [loadData, userId]);

  const onRefresh = React.useCallback(async () => {
    const refreshRequest = ++refreshRequestRef.current;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    const refreshOwnerId = userId;
    const isCurrentRefresh = () =>
      mountedRef.current &&
      lifecycleGenerationRef.current === lifecycleGeneration &&
      refreshRequestRef.current === refreshRequest &&
      currentUserIdRef.current === refreshOwnerId;
    if (!isCurrentRefresh()) return;

    setRefreshing(true);
    try {
      await loadData();
    } finally {
      if (isCurrentRefresh()) setRefreshing(false);
    }
  }, [loadData, userId]);

  function formatGameDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const visibleState = dashboardState.ownerId === userId
    ? dashboardState
    : loadingDashboardState(userId);
  const { captainTeams, loadError, loading } = visibleState;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={cutIceContentEdges(['top'])} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (captainTeams.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={cutIceContentEdges(['top'])} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="shield-crown-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>{loadError ? 'Unable to load captain duties' : 'No captain duties'}</Text>
          <Text style={styles.emptySub}>
            {loadError ?? 'You are not a captain or assistant captain on any teams.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={cutIceContentEdges(['top'])} onAccessibilityEscape={() => navigation.goBack()}>
      <FocusScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Your Teams" />

        {captainTeams.map((team) => (
          <FocusCard key={`${team.teamId}-${team.leagueId}`} focusId={`captain-team:${team.leagueId}:${team.teamId}`} style={styles.teamCard}>
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
            </View>
          </FocusCard>
        ))}
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
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
