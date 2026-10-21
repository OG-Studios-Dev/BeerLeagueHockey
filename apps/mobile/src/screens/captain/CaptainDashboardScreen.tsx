import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../../components/CardFocus';
import { HOCKEY_LIFE_ID } from '../../config/hockeyLife';
import {
  HOCKEY_LIFE_CAPTAIN_FEES_URL,
  buildHockeyLifeCaptainLineupUrl,
} from '../../config/publicLinks';
import { useAccessibilityPreferences } from '../../context/AccessibilityPreferencesContext';
import { useAuth } from '../../context/AuthContext';
import { openPublicLink } from '../../lib/publicLinks';
import { supabase } from '../../lib/supabase/client';
import type { ScoringScope } from '../../lib/supabase/captainScoring';
import { getTeamActiveSeason } from '../../lib/supabase/team';
import { cutIceContentEdges } from '../../navigation/cutIceSafeAreaPolicy';
import type { CaptainStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static image requires. */
const weeklyGamesBackground = require('../../assets/team-page/weekly-games-bg.jpg');
/* eslint-enable @typescript-eslint/no-require-imports */

type CaptainGame = {
  id: string;
  scheduledAt: string;
  opponent: string;
  location: string | null;
};

type CaptainTeam = {
  teamId: string;
  teamName: string;
  teamPrimaryColor: string | null;
  leagueId: string;
  seasonId: string;
  timezone: string;
  nextGame: CaptainGame | null;
};

type CaptainDashboardState = {
  ownerId: string | null;
  selectedTeam: CaptainTeam | null;
  loadError: string | null;
  loading: boolean;
};

type CaptainRosterRow = {
  team_id: string;
  league_id: string;
  team: { id: string; name: string | null; primary_color: string | null } | Array<{ id: string; name: string | null; primary_color: string | null }> | null;
  league: { id: string; name: string | null; timezone: string | null } | Array<{ id: string; name: string | null; timezone: string | null }> | null;
};

type CaptainGameRow = {
  id: string;
  scheduled_at: string;
  location: string | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string | null } | Array<{ name: string | null }> | null;
  away_team: { name: string | null } | Array<{ name: string | null }> | null;
};

type ScreenProps = NativeStackScreenProps<CaptainStackParamList, 'CaptainDashboard'>;

const CAPTAIN_DASHBOARD_ERROR = 'Captain duties are temporarily unavailable.';

function loadingDashboardState(ownerId: string | null): CaptainDashboardState {
  return { ownerId, selectedTeam: null, loadError: null, loading: true };
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function formatGameDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
}

function formatGameTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectCaptainTeam(teams: CaptainTeam[]): CaptainTeam | null {
  const gameTeams = teams.filter((team) => team.nextGame).sort((left, right) => {
    const leftTime = Date.parse(left.nextGame!.scheduledAt);
    const rightTime = Date.parse(right.nextGame!.scheduledAt);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) throw new TypeError('Invalid scheduled game time');
    return leftTime - rightTime
      || compareText(left.teamName, right.teamName)
      || compareText(left.teamId, right.teamId)
      || compareText(left.nextGame!.id, right.nextGame!.id);
  });
  if (gameTeams.length > 0) return gameTeams[0];
  return [...teams].sort((left, right) =>
    compareText(left.teamName, right.teamName) || compareText(left.teamId, right.teamId))[0] ?? null;
}

function SectionTitle({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>;
}

function ActionTile({
  testID,
  icon,
  label,
  accessibilityHint,
  opaque,
  onPress,
}: {
  testID: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityHint?: string;
  opaque: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.actionTile, opaque && styles.actionTileOpaque, pressed && styles.actionTilePressed]}
    >
      <View pointerEvents="none" style={styles.actionIconTile}>
        <Ionicons name={icon} size={21} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function CaptainDashboardScreen({ navigation }: ScreenProps) {
  const { user } = useAuth();
  const { reduceTransparency } = useAccessibilityPreferences();
  const userId = user?.id ?? null;
  const [dashboardState, setDashboardState] = React.useState<CaptainDashboardState>(() => loadingDashboardState(userId));
  const [refreshing, setRefreshing] = React.useState(false);
  const loadRequestRef = React.useRef(0);
  const refreshRequestRef = React.useRef(0);
  const currentUserIdRef = React.useRef<string | null>(userId);
  const mountedRef = React.useRef(false);
  const lifecycleGenerationRef = React.useRef(0);
  React.useLayoutEffect(()=>{currentUserIdRef.current=userId;},[userId]);
  const addNavigationListener=navigation.addListener;
  const scoringOwner=React.useRef<{actor:string | null;generation:number}>({actor:null,generation:0});
  const [scoring,setScoring]=React.useState<{owner:typeof scoringOwner.current;target:ScoringScope | null;error:string | null} | null>(null);
  React.useLayoutEffect(()=>{const owner={actor:userId,generation:scoringOwner.current.generation+1};scoringOwner.current=owner;return()=>{if(scoringOwner.current===owner)scoringOwner.current={actor:null,generation:owner.generation+1};};},[userId]);
  React.useEffect(()=>{let stopped=false;const owner=scoringOwner.current;let request=0;const load=async()=>{const id=++request;if(!userId)return;try{const {getScoringTarget}=await import('../../lib/supabase/captainScoring');const target=await getScoringTarget(userId,HOCKEY_LIFE_ID);if(!stopped&&owner===scoringOwner.current&&id===request)setScoring({owner,target,error:null});}catch{if(!stopped&&owner===scoringOwner.current&&id===request)setScoring({owner,target:null,error:'Scoring is temporarily unavailable.'});}};void load();const remove=addNavigationListener?.('focus',()=>void load());return()=>{stopped=true;request+=1;remove?.();};},[userId,addNavigationListener]);

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
      mountedRef.current
      && lifecycleGenerationRef.current === lifecycleGeneration
      && loadRequestRef.current === requestId
      && currentUserIdRef.current === userId;

    if (!userId) {
      if (isCurrentRequest()) {
        setDashboardState({ ownerId: userId, selectedTeam: null, loadError: null, loading: false });
      }
      return;
    }

    try {
      if (isCurrentRequest()) {
        setDashboardState((current) => current.ownerId === userId
          ? { ...current, loadError: null }
          : loadingDashboardState(userId));
      }

      const { season, error: seasonError } = await getTeamActiveSeason(HOCKEY_LIFE_ID);
      if (!isCurrentRequest()) return;
      if (seasonError) throw new Error(seasonError);
      if (!season || !['active', 'playoffs'].includes(season.status)) {
        setDashboardState({ ownerId: userId, selectedTeam: null, loadError: null, loading: false });
        return;
      }

      const { data: rosterRows, error: rosterError } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id, leadership_role,
          team:teams!team_rosters_team_id_fkey(id, name, primary_color),
          league:leagues!team_rosters_league_id_fkey(id, name, timezone)
        `)
        .eq('player_id', userId)
        .eq('league_id', HOCKEY_LIFE_ID)
        .eq('season_id', season.id)
        .eq('status', 'active')
        .is('end_date', null)
        .in('leadership_role', ['captain', 'alternate_captain']);
      if (!isCurrentRequest()) return;
      if (rosterError) throw rosterError;

      const rows = (rosterRows ?? []) as unknown as CaptainRosterRow[];
      if (rows.length === 0) {
        setDashboardState({ ownerId: userId, selectedTeam: null, loadError: null, loading: false });
        return;
      }

      const loadTime = new Date().toISOString();
      const teams: CaptainTeam[] = [];
      for (const row of rows) {
        const team = relation(row.team);
        const league = relation(row.league);
        if (!team || !league || typeof row.team_id !== 'string' || typeof row.league_id !== 'string') continue;

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
          .gte('scheduled_at', loadTime)
          .order('scheduled_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!isCurrentRequest()) return;
        if (nextGameError) throw nextGameError;

        let nextGame: CaptainGame | null = null;
        if (nextGameData) {
          const game = nextGameData as unknown as CaptainGameRow;
          const homeTeam = relation(game.home_team);
          const awayTeam = relation(game.away_team);
          nextGame = {
            id: game.id,
            scheduledAt: game.scheduled_at,
            opponent: game.home_team_id === row.team_id ? (awayTeam?.name ?? 'TBD') : (homeTeam?.name ?? 'TBD'),
            location: game.location ?? null,
          };
        }

        teams.push({
          teamId: row.team_id,
          teamName: team.name ?? 'Team',
          teamPrimaryColor: team.primary_color ?? null,
          leagueId: row.league_id,
          seasonId: season.id,
          timezone: league.timezone ?? 'America/Toronto',
          nextGame,
        });
      }

      if (isCurrentRequest()) {
        setDashboardState({ ownerId: userId, selectedTeam: selectCaptainTeam(teams), loadError: null, loading: false });
      }
    } catch {
      if (isCurrentRequest()) {
        setDashboardState({ ownerId: userId, selectedTeam: null, loadError: CAPTAIN_DASHBOARD_ERROR, loading: false });
      }
    } finally {
      if (isCurrentRequest()) {
        setDashboardState((current) => current.ownerId === userId && current.loading
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
      mountedRef.current
      && lifecycleGenerationRef.current === lifecycleGeneration
      && refreshRequestRef.current === refreshRequest
      && currentUserIdRef.current === refreshOwnerId;
    if (!isCurrentRefresh()) return;

    setRefreshing(true);
    try {
      await loadData();
    } finally {
      if (isCurrentRefresh()) setRefreshing(false);
    }
  }, [loadData, userId]);

  const visibleState = dashboardState.ownerId === userId ? dashboardState : loadingDashboardState(userId);
  const { selectedTeam, loadError, loading } = visibleState;
  const shellProps = {
    style: styles.safeArea,
    edges: cutIceContentEdges(['top']),
    onAccessibilityEscape: () => navigation.goBack(),
  };

  if (loading) {
    return <SafeAreaView {...shellProps}><View style={styles.centered}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  }

  if (!selectedTeam) {
    return (
      <SafeAreaView {...shellProps}>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="shield-crown-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>{loadError ? 'Unable to load captain duties' : 'No captain duties'}</Text>
          <Text style={styles.emptyBody}>{loadError ?? 'You are not a captain or alternate captain on a current Hockey Life team.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const game = selectedTeam.nextGame;
  const scoringTarget=scoring?.owner===scoringOwner.current&&scoring.owner.actor===userId?scoring.target:null;
  const openCaptainLink = async (url: string | null) => {
    if (!url) {
      Alert.alert('Unable to open link', 'This link is not available in Hockey Life.');
      return;
    }
    const result = await openPublicLink(url, (approvedUrl) => Linking.openURL(approvedUrl));
    if (!result.success) Alert.alert('Unable to open link', result.error);
  };

  return (
    <SafeAreaView {...shellProps}>
      <FocusScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <FocusCard focusId="captain-game-day" testID="captain-game-day-section" style={styles.section}>
          <SectionTitle>Game Day</SectionTitle>
          {game ? (
            <ImageBackground
              testID="captain-game-card"
              accessible
              accessibilityLabel={`${game.opponent}, ${formatGameDate(game.scheduledAt, selectedTeam.timezone)}, ${formatGameTime(game.scheduledAt, selectedTeam.timezone)}, ${game.location ?? 'Rink TBD'}`}
              source={weeklyGamesBackground}
              resizeMode="cover"
              imageStyle={styles.matchupImage}
              style={styles.matchupCard}
            >
              <LinearGradient colors={['rgba(3,7,13,.08)', 'rgba(3,7,13,.48)', '#03070D']} locations={[0, .48, 1]} style={StyleSheet.absoluteFillObject} />
              <View style={styles.matchupCopy}>
                <Text style={styles.opponentEyebrow}>UP NEXT</Text>
                <Text style={styles.opponent}>vs {game.opponent}</Text>
                <View testID="captain-game-metadata" style={[styles.metadataPanel, reduceTransparency && styles.metadataPanelOpaque]}>
                  <Text style={styles.metadataText}>{formatGameDate(game.scheduledAt, selectedTeam.timezone)}</Text>
                  <View style={styles.metadataDivider} />
                  <Text style={styles.metadataText}>{formatGameTime(game.scheduledAt, selectedTeam.timezone)}</Text>
                  <View style={styles.metadataDivider} />
                  <Text style={[styles.metadataText, styles.metadataLocation]}>{game.location ?? 'Rink TBD'}</Text>
                </View>
              </View>
            </ImageBackground>
          ) : (
            <View style={[styles.noGamePanel, reduceTransparency && styles.noGamePanelOpaque]}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={28} color={colors.textSecondary} />
              <Text style={styles.noGameTitle}>No upcoming game</Text>
              <Text style={styles.emptyBody}>There is no scheduled upcoming game for your current captain team.</Text>
            </View>
          )}
          {game ? (
            <View testID="captain-game-actions" style={styles.actionGrid}>
              <ActionTile testID="captain-edit-attendance" icon="clipboard-outline" label="Edit attendance" opaque={reduceTransparency} onPress={() => navigation.navigate('GameAvailability', { gameId: game.id, teamId: selectedTeam.teamId, leagueId: selectedTeam.leagueId })} />
              <ActionTile testID="captain-invite-sub" icon="person-add-outline" label="Invite sub" opaque={reduceTransparency} onPress={() => navigation.navigate('GameAvailability', { gameId: game.id, teamId: selectedTeam.teamId, leagueId: selectedTeam.leagueId, intent: 'invite-sub' })} />
              <ActionTile testID="captain-set-lineup" icon="shirt-outline" label="Set lineup" opaque={reduceTransparency} onPress={() => void openCaptainLink(buildHockeyLifeCaptainLineupUrl(game.id))} />
            </View>
          ) : null}
          {scoringTarget ? <ActionTile testID="captain-score-game" icon="trophy-outline" label="Score game" opaque={reduceTransparency} onPress={() => {if(scoring?.owner===scoringOwner.current&&scoringOwner.current.actor===userId)navigation.navigate('Scoreboard',scoringTarget);}} /> : <Text testID="captain-scoring-unavailable" style={styles.emptyBody}>{scoring?.error ?? 'No ongoing or due game to score.'}</Text>}
        </FocusCard>

        <FocusCard focusId="captain-season-tools" testID="captain-season-tools-section" style={styles.section}>
          <SectionTitle>Season Tools</SectionTitle>
          <View style={styles.actionGrid}>
            <ActionTile testID="captain-beer-tracker" icon="beer-outline" label="Beer Tracker" accessibilityHint={`Open Beer Tracker for ${selectedTeam.teamName}`} opaque={reduceTransparency} onPress={() => navigation.navigate('BeerTracker', { teamId: selectedTeam.teamId, seasonId: selectedTeam.seasonId })} />
            <ActionTile testID="captain-team-fees" icon="card-outline" label="Team fees" accessibilityHint={`Open season fees for ${selectedTeam.teamName}`} opaque={reduceTransparency} onPress={() => void openCaptainLink(HOCKEY_LIFE_CAPTAIN_FEES_URL)} />
          </View>
        </FocusCard>
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 28 },
  section: { gap: 12 },
  sectionTitle: { color: '#F7FBFF', fontSize: 21, lineHeight: 27, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  matchupCard: { minHeight: 232, overflow: 'hidden', justifyContent: 'flex-end', borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,.14)', backgroundColor: '#03070D' },
  matchupImage: { borderRadius: 26 },
  matchupCopy: { minHeight: 232, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 16 },
  opponentEyebrow: { color: colors.primary, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 2.2 },
  opponent: { marginTop: 5, color: '#FFFFFF', fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -.6, textAlign: 'center' },
  metadataPanel: { minHeight: 44, maxWidth: '100%', marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(3,7,13,.78)', paddingHorizontal: 12, paddingVertical: 9 },
  metadataPanelOpaque: { borderColor: '#32425A', backgroundColor: '#0B1728' },
  metadataText: { flexShrink: 1, color: '#D4DCE8', fontSize: 10, lineHeight: 14, fontWeight: '800' },
  metadataLocation: { flexBasis: '100%', marginTop: 4, textAlign: 'center' },
  metadataDivider: { width: 3, height: 3, marginHorizontal: 7, borderRadius: 2, backgroundColor: '#65748A' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionTile: { minHeight: 96, flexBasis: '47%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', backgroundColor: 'rgba(14,27,47,.78)', paddingHorizontal: 10, paddingVertical: 12 },
  actionTileOpaque: { borderColor: '#344760', backgroundColor: '#10223B' },
  actionTilePressed: { backgroundColor: 'rgba(27,46,73,.92)', transform: [{ scale: .985 }] },
  actionIconTile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', backgroundColor: 'rgba(3,7,13,.44)' },
  actionLabel: { color: '#F7FBFF', fontSize: 12, lineHeight: 17, fontWeight: '900', letterSpacing: .6, textAlign: 'center' },
  noGamePanel: { minHeight: 176, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(10,22,40,.82)', padding: 22 },
  noGamePanelOpaque: { borderColor: '#32425A', backgroundColor: '#0B1728' },
  noGameTitle: { color: '#F7FBFF', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  emptyBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
});
