import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AccessibleChoiceGroup from '../../components/AccessibleChoiceGroup';
import Avatar from '../../components/Avatar';
import { FocusCard, FocusScrollView } from '../../components/CardFocus';
import { HOCKEY_LIFE_ID } from '../../config/hockeyLife';
import { useAuth } from '../../context/AuthContext';
import {
  clearPlayerCheckinAsCaptain, createGoalieRequest, getCaptainRole, getGameCheckinStatusMap,
  getLeagueSubPlayers, getOpenGoalieRequest, getTeamSubInvitations, inviteSub,
  updatePlayerCheckinAsCaptain, type CaptainRole, type GoalieRequestRow, type SubCandidate,
  type TeamSubInvitation,
} from '../../lib/supabase/captain';
import { type CheckinStatus } from '../../lib/supabase/checkins';
import { supabase } from '../../lib/supabase/client';
import { getTeamRoster, type RosterMemberRow } from '../../lib/supabase/data';
import { cutIceContentEdges } from '../../navigation/cutIceSafeAreaPolicy';
import colors from '../../theme/colors';

const STATUS_CHOICES = [
  { value: 'confirmed', label: 'In' }, { value: 'tentative', label: 'Maybe' },
  { value: 'out', label: 'Out' }, { value: 'waiting', label: 'Waiting' },
] as const;
const GOALIE_SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' }, { value: 'expert', label: 'Expert' },
] as const;
const GOALIE_COMPENSATION_OPTIONS = [{ value: 'Free', label: 'Free' }, { value: 'Paid', label: 'Paid' }] as const;

type GameRow = {
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  location: string | null;
  home_team: { name?: string | null } | Array<{ name?: string | null }> | null;
  away_team: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ScreenProps = {
  route: { params: { gameId: string; teamId: string; leagueId: string } };
  navigation: { goBack(): void };
};

export default function GameAvailabilityScreen({ route, navigation }: ScreenProps) {
  const { gameId, teamId, leagueId } = route.params;
  const { user } = useAuth();
  const routeKey = `${leagueId}:${teamId}:${gameId}`;
  const [roster, setRoster] = React.useState<RosterMemberRow[]>([]);
  const [checkinMap, setCheckinMap] = React.useState<Record<string, CheckinStatus>>({});
  const [gameInfo, setGameInfo] = React.useState<{ opponent: string; date: string; location: string | null } | null>(null);
  const [captainRole, setCaptainRole] = React.useState<CaptainRole | null>(null);
  const [validatedRouteKey, setValidatedRouteKey] = React.useState<string | null>(null);
  const [accessMessage, setAccessMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [statusSavingPlayerId, setStatusSavingPlayerId] = React.useState<string | null>(null);
  const [subModalVisible, setSubModalVisible] = React.useState(false);
  const [subCandidates, setSubCandidates] = React.useState<SubCandidate[]>([]);
  const [subInvitations, setSubInvitations] = React.useState<TeamSubInvitation[]>([]);
  const [completedSubIds, setCompletedSubIds] = React.useState<Set<string>>(() => new Set());
  const [subSearch, setSubSearch] = React.useState('');
  const [loadingSubs, setLoadingSubs] = React.useState(false);
  const [subSavingPlayerId, setSubSavingPlayerId] = React.useState<string | null>(null);
  const [goalieModalVisible, setGoalieModalVisible] = React.useState(false);
  const [goalieRequest, setGoalieRequest] = React.useState<GoalieRequestRow | null>(null);
  const [goalieRequestCompleted, setGoalieRequestCompleted] = React.useState(false);
  const [goalieSkillLevel, setGoalieSkillLevel] = React.useState('intermediate');
  const [goalieCompensation, setGoalieCompensation] = React.useState('Free');
  const [goalieSaving, setGoalieSaving] = React.useState(false);
  const loadGenerationRef = React.useRef(0);
  const validatedRouteRef = React.useRef<string | null>(null);
  const statusPendingRef = React.useRef<string | null>(null);
  const subPendingRef = React.useRef<string | null>(null);
  const goaliePendingRef = React.useRef(false);

  const loadData = React.useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    validatedRouteRef.current = null;
    setValidatedRouteKey(null);
    statusPendingRef.current = null; subPendingRef.current = null; goaliePendingRef.current = false;
    setStatusSavingPlayerId(null); setSubSavingPlayerId(null); setGoalieSaving(false);
    setSubModalVisible(false); setGoalieModalVisible(false);
    setCompletedSubIds(new Set());
    setGoalieRequestCompleted(false);
    setLoading(true); setAccessMessage(null); setActionError(null); setCaptainRole(null);
    if (!user) {
      setRoster([]); setCheckinMap({}); setGameInfo(null);
      setAccessMessage('Sign in to view game availability.'); setLoading(false); return;
    }
    if (leagueId !== HOCKEY_LIFE_ID) {
      setRoster([]); setCheckinMap({}); setGameInfo(null);
      setAccessMessage('This game is not available in Hockey Life.'); setLoading(false); return;
    }
    const { data: game, error: gameError } = await supabase.from('games').select(`
      id, league_id, scheduled_at, location, home_team_id, away_team_id,
      home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name)
    `).eq('id', gameId).eq('league_id', leagueId).maybeSingle();
    if (generation !== loadGenerationRef.current) return;
    const g = game as GameRow | null;
    if (gameError || !g || g.league_id !== leagueId || (g.home_team_id !== teamId && g.away_team_id !== teamId)) {
      setRoster([]); setCheckinMap({}); setGameInfo(null);
      setAccessMessage('This game does not belong to the requested team.'); setLoading(false); return;
    }
    validatedRouteRef.current = routeKey;
    setValidatedRouteKey(routeKey);
    const role = await getCaptainRole(teamId);
    if (generation !== loadGenerationRef.current) return;
    const rosterData = await getTeamRoster(teamId, leagueId);
    if (generation !== loadGenerationRef.current) return;
    setRoster(rosterData); setCaptainRole(role);
    const home = Array.isArray(g.home_team) ? g.home_team[0] : g.home_team;
    const away = Array.isArray(g.away_team) ? g.away_team[0] : g.away_team;
    const date = new Date(g.scheduled_at);
    setGameInfo({
      opponent: g.home_team_id === teamId ? (away?.name ?? 'TBD') : (home?.name ?? 'TBD'),
      date: `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      location: g.location ?? null,
    });
    if (role) {
      const [checkins, invitations, request] = await Promise.all([
        getGameCheckinStatusMap(gameId, teamId), getTeamSubInvitations(teamId, [gameId]), getOpenGoalieRequest(gameId, teamId),
      ]);
      if (generation !== loadGenerationRef.current) return;
      setCheckinMap(checkins); setSubInvitations(invitations.data ?? []); setGoalieRequest(request);
    } else {
      setCheckinMap({}); setSubInvitations([]); setGoalieRequest(null);
    }
    setLoading(false);
  }, [gameId, leagueId, routeKey, teamId, user]);

  React.useEffect(() => {
    void loadData();
    return () => { loadGenerationRef.current += 1; validatedRouteRef.current = null; };
  }, [loadData]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true); await loadData(); setRefreshing(false);
  }, [loadData]);
  const canMutate = captainRole !== null && validatedRouteKey === routeKey;

  async function handleStatusChange(playerId: string, nextStatus: CheckinStatus | 'waiting') {
    if (!canMutate || statusPendingRef.current) return;
    const generation = loadGenerationRef.current;
    const previous = checkinMap;
    const updated = { ...previous };
    if (nextStatus === 'waiting') delete updated[playerId]; else updated[playerId] = nextStatus;
    statusPendingRef.current = playerId; setStatusSavingPlayerId(playerId); setActionError(null); setCheckinMap(updated);
    const result = nextStatus === 'waiting'
      ? await clearPlayerCheckinAsCaptain(gameId, teamId, playerId)
      : await updatePlayerCheckinAsCaptain(gameId, teamId, playerId, nextStatus);
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    statusPendingRef.current = null; setStatusSavingPlayerId(null);
    if (!result.success) { setCheckinMap(previous); setActionError(result.error ?? 'Unable to update lineup.'); }
  }

  async function openSubModal() {
    if (!canMutate) return;
    setSubModalVisible(true); setSubSearch(''); setActionError(null);
    if (subCandidates.length || loadingSubs) return;
    const generation = loadGenerationRef.current;
    setLoadingSubs(true);
    const result = await getLeagueSubPlayers(leagueId, teamId);
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    setLoadingSubs(false);
    if (!result.success) { setActionError(result.error ?? 'Unable to load sub players.'); return; }
    setSubCandidates(result.data ?? []);
  }

  async function handleInviteSub(playerId: string) {
    if (!canMutate || subPendingRef.current || completedSubIds.has(playerId)) return;
    const generation = loadGenerationRef.current;
    subPendingRef.current = playerId; setSubSavingPlayerId(playerId); setActionError(null);
    const result = await inviteSub(gameId, teamId, playerId);
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    if (!result.success) {
      subPendingRef.current = null; setSubSavingPlayerId(null);
      setActionError(result.error ?? 'Unable to invite this sub.'); return;
    }
    const refreshed = await getTeamSubInvitations(teamId, [gameId]);
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    subPendingRef.current = null; setSubSavingPlayerId(null); setSubInvitations(refreshed.data ?? []);
    setCompletedSubIds((current) => new Set(current).add(playerId));
  }

  async function handleRequestGoalie() {
    if (!canMutate || goaliePendingRef.current || goalieRequest || goalieRequestCompleted) return;
    const generation = loadGenerationRef.current;
    goaliePendingRef.current = true; setGoalieSaving(true); setActionError(null);
    const result = await createGoalieRequest(gameId, teamId, leagueId, {
      skillLevelNeeded: goalieSkillLevel, compensation: goalieCompensation, notes: null,
    });
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    if (!result.success) {
      goaliePendingRef.current = false; setGoalieSaving(false);
      setActionError(result.error ?? 'Unable to create goalie request.'); return;
    }
    const refreshed = await getOpenGoalieRequest(gameId, teamId);
    if (generation !== loadGenerationRef.current || validatedRouteRef.current !== routeKey) return;
    goaliePendingRef.current = false; setGoalieSaving(false); setGoalieRequest(refreshed); setGoalieRequestCompleted(true); setGoalieModalVisible(false);
    Alert.alert('Goalie request posted', `${result.notifiedGoalies ?? 0} active goalies are currently in the pool for this league.`);
  }

  const groups = React.useMemo(() => {
    const grouped: Record<string, RosterMemberRow[]> = { confirmed: [], tentative: [], out: [], noResponse: [] };
    roster.forEach((player) => grouped[checkinMap[player.player_id] ?? 'noResponse'].push(player));
    return [
      { key: 'confirmed', label: 'In', icon: 'checkmark-circle', color: colors.accentGreen, players: grouped.confirmed },
      { key: 'tentative', label: 'Maybe', icon: 'help-circle', color: '#EAB308', players: grouped.tentative },
      { key: 'out', label: 'Out', icon: 'close-circle', color: colors.accentRed, players: grouped.out },
      { key: 'noResponse', label: 'No Response', icon: 'ellipse-outline', color: colors.textSecondary, players: grouped.noResponse },
    ];
  }, [checkinMap, roster]);
  const invitedIds = React.useMemo(() => new Set([...subInvitations.map((invite) => invite.invitedPlayerId), ...completedSubIds]), [completedSubIds, subInvitations]);
  const visibleSubs = React.useMemo(() => {
    const query = subSearch.trim().toLowerCase();
    return subCandidates.filter((candidate) => !query || (candidate.full_name ?? '').toLowerCase().includes(query) || (candidate.email ?? '').toLowerCase().includes(query));
  }, [subCandidates, subSearch]);

  const shellProps = { style: styles.safeArea, edges: cutIceContentEdges(['top']), onAccessibilityEscape: () => navigation.goBack() };
  if (loading) return <SafeAreaView {...shellProps}><View style={styles.centered}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  if (accessMessage) return <SafeAreaView {...shellProps}><View style={styles.centered}><Text style={styles.emptyTitle}>{accessMessage}</Text></View></SafeAreaView>;

  return <SafeAreaView {...shellProps}>
    <FocusScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
      {gameInfo && <FocusCard focusId={`availability:${gameId}:game`} style={styles.card}>
        <Text style={styles.gameTitle}>vs {gameInfo.opponent}</Text><Text style={styles.secondary}>{gameInfo.date}</Text>
        {gameInfo.location && <View style={styles.inline}><Ionicons name="location-outline" size={13} color={colors.textSecondary} /><Text style={styles.secondary}>{gameInfo.location}</Text></View>}
      </FocusCard>}
      {captainRole && <FocusCard focusId={`availability:${gameId}:captain`} style={styles.card}>
        <Text style={styles.sectionTitle}>Captain tools</Text><Text style={styles.secondary}>Manage this game for your current Hockey Life team.</Text>
        {actionError && <Text testID="captain-action-error" accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
        <View style={styles.actions}>
          <Pressable testID="captain-request-sub" accessibilityRole="button" onPress={() => void openSubModal()} style={styles.primaryButton}><Text style={styles.buttonText}>Request Sub</Text></Pressable>
          <Pressable testID="captain-request-goalie" accessibilityRole="button" disabled={Boolean(goalieRequest) || goalieRequestCompleted} onPress={() => setGoalieModalVisible(true)} style={[styles.primaryButton, (goalieRequest || goalieRequestCompleted) && styles.disabled]}><Text style={styles.buttonText}>{goalieRequest || goalieRequestCompleted ? 'Goalie Requested' : 'Request Goalie'}</Text></Pressable>
        </View>
      </FocusCard>}
      <View style={styles.counts}>{groups.map((group) => <View key={group.key} style={styles.countCard}><Text style={[styles.count, { color: group.color }]}>{group.players.length}</Text><Text style={styles.countLabel}>{group.label}</Text></View>)}</View>
      {groups.map((group) => group.players.length ? <FocusCard key={group.key} focusId={`availability:${gameId}:${group.key}`} accentColor={group.color} style={styles.card}>
        <Text style={[styles.sectionTitle, { color: group.color }]}>{group.label} ({group.players.length})</Text>
        {group.players.map((player) => <View key={player.player_id} style={styles.playerRow}>
          <Avatar uri={player.avatar_url ?? null} name={player.player_name} size={36} />
          <View style={styles.playerInfo}><Text style={styles.playerName}>{player.player_name}</Text><Text style={styles.secondary}>#{player.jersey_number ?? '--'} {player.position ?? ''}</Text></View>
          {captainRole ? <View style={styles.statusActions}>{STATUS_CHOICES.map((choice) => <Pressable key={choice.value}
            testID={`captain-status-${player.player_id}-${choice.value}`} accessibilityRole="button"
            accessibilityState={{ selected: (checkinMap[player.player_id] ?? 'waiting') === choice.value, disabled: statusSavingPlayerId === player.player_id }}
            disabled={statusSavingPlayerId === player.player_id} onPress={() => void handleStatusChange(player.player_id, choice.value)} style={styles.statusButton}
          ><Text style={styles.statusText}>{choice.label}</Text></Pressable>)}</View> : <View style={[styles.dot, { backgroundColor: group.color }]} />}
        </View>)}
      </FocusCard> : null)}
      {!roster.length && <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No roster data available</Text></View>}
    </FocusScrollView>

    <Modal visible={subModalVisible} transparent animationType="fade" onRequestClose={() => setSubModalVisible(false)}><View style={styles.overlay}><View style={styles.modal}>
      <Text style={styles.sectionTitle}>Invite a Sub</Text><TextInput testID="captain-sub-search" style={styles.input} value={subSearch} onChangeText={setSubSearch} placeholder="Search by name or email" placeholderTextColor={colors.textSecondary} />
      {loadingSubs ? <ActivityIndicator color={colors.primary} /> : visibleSubs.map((candidate) => <View key={candidate.id} style={styles.playerRow}><View style={styles.playerInfo}><Text style={styles.playerName}>{candidate.full_name ?? 'Unknown player'}</Text>{candidate.email && <Text style={styles.secondary}>{candidate.email}</Text>}</View>
        <Pressable testID={`captain-invite-sub-${candidate.id}`} accessibilityRole="button" disabled={invitedIds.has(candidate.id) || subSavingPlayerId === candidate.id} onPress={() => void handleInviteSub(candidate.id)} style={styles.primaryButton}><Text style={styles.buttonText}>{invitedIds.has(candidate.id) ? 'Invited' : subSavingPlayerId === candidate.id ? 'Sending…' : 'Invite'}</Text></Pressable>
      </View>)}
      <Pressable testID="captain-close-sub-modal" accessibilityRole="button" onPress={() => setSubModalVisible(false)} style={styles.secondaryButton}><Text style={styles.buttonText}>Close</Text></Pressable>
    </View></View></Modal>

    <Modal visible={goalieModalVisible} transparent animationType="fade" onRequestClose={() => setGoalieModalVisible(false)}><View style={styles.overlay}><View style={styles.modal}>
      <Text style={styles.sectionTitle}>Request a Goalie</Text><Text style={styles.secondary}>Skill level needed</Text>
      <AccessibleChoiceGroup accessibilityLabel="Goalie skill level needed" options={GOALIE_SKILL_LEVELS} selectedValue={goalieSkillLevel} onSelect={setGoalieSkillLevel} />
      <Text style={styles.secondary}>Compensation</Text><AccessibleChoiceGroup accessibilityLabel="Goalie compensation" options={GOALIE_COMPENSATION_OPTIONS} selectedValue={goalieCompensation} onSelect={setGoalieCompensation} />
      <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => setGoalieModalVisible(false)} style={styles.secondaryButton}><Text style={styles.buttonText}>Cancel</Text></Pressable>
        <Pressable testID="captain-submit-goalie-request" accessibilityRole="button" disabled={goalieSaving} onPress={() => void handleRequestGoalie()} style={[styles.primaryButton, goalieSaving && styles.disabled]}><Text style={styles.buttonText}>{goalieSaving ? 'Posting…' : 'Post Request'}</Text></Pressable></View>
    </View></View></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.bgSurface, borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, padding: 14, gap: 10 }, gameTitle: { fontSize: 20, fontWeight: '900', color: colors.textPrimary }, sectionTitle: { fontSize: 16, fontWeight: '900', color: colors.textPrimary }, secondary: { fontSize: 12, fontWeight: '600', color: colors.textSecondary }, inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  error: { color: colors.accentRed, fontSize: 12, fontWeight: '700' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, primaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary }, secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.bgInteractive }, buttonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' }, disabled: { opacity: 0.5 },
  counts: { flexDirection: 'row', gap: 8 }, countCard: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.bgSurface }, count: { fontSize: 22, fontWeight: '900' }, countLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  playerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 8 }, playerInfo: { flex: 1, minWidth: 100 }, playerName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary }, statusActions: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, statusButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.bgInteractive }, statusText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' }, dot: { width: 10, height: 10, borderRadius: 5 },
  emptyCard: { padding: 32, alignItems: 'center', borderRadius: 16, backgroundColor: colors.bgSurface }, emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }, overlay: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#000000AA' }, modal: { borderRadius: 16, padding: 16, gap: 12, backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.glassStroke }, input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, color: colors.textPrimary, backgroundColor: colors.bgInteractive },
});
