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
  const userId = user?.id ?? null;
  const routeKey = `${leagueId}:${teamId}:${gameId}`;
  const controlKey = `${userId ?? 'anonymous'}:${routeKey}`;
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
  const [subSearch, setSubSearch] = React.useState('');
  const [loadingSubs, setLoadingSubs] = React.useState(false);
  const [subSavingPlayerId, setSubSavingPlayerId] = React.useState<string | null>(null);
  const [goalieModalVisible, setGoalieModalVisible] = React.useState(false);
  const [goalieRequest, setGoalieRequest] = React.useState<GoalieRequestRow | null>(null);
  const [goalieSkillLevel, setGoalieSkillLevel] = React.useState('intermediate');
  const [goalieCompensation, setGoalieCompensation] = React.useState('Free');
  const [goalieSaving, setGoalieSaving] = React.useState(false);
  const loadGenerationRef = React.useRef(0);
  const validatedRouteRef = React.useRef<string | null>(null);
  const activeScopeRef = React.useRef<string | null>(null);
  const subLoadTokenRef = React.useRef(0);
  const writeGuardsRef = React.useRef<Map<string, 'pending' | 'succeeded'>>(new Map());
  const [writeGuardStates, setWriteGuardStates] = React.useState<Record<string, 'pending' | 'succeeded'>>({});

  const loadData = React.useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    validatedRouteRef.current = null;
    setValidatedRouteKey(null);
    if (activeScopeRef.current !== controlKey) {
      activeScopeRef.current = controlKey;
      subLoadTokenRef.current += 1;
      setSubCandidates([]); setSubSearch(''); setLoadingSubs(false);
      setGoalieSkillLevel('intermediate'); setGoalieCompensation('Free');
    }
    setStatusSavingPlayerId(null); setSubSavingPlayerId(null); setGoalieSaving(false);
    setSubModalVisible(false); setGoalieModalVisible(false);
    setLoading(true); setAccessMessage(null); setActionError(null); setCaptainRole(null);
    try {
      if (!userId) {
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
      validatedRouteRef.current = controlKey;
      setValidatedRouteKey(controlKey);
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
    } catch {
      if (generation === loadGenerationRef.current) {
        validatedRouteRef.current = null; setValidatedRouteKey(null); setCaptainRole(null);
        setRoster([]); setCheckinMap({}); setGameInfo(null);
        setAccessMessage('Unable to load game availability.');
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [controlKey, gameId, leagueId, teamId, userId]);

  React.useEffect(() => {
    void loadData();
    return () => { loadGenerationRef.current += 1; validatedRouteRef.current = null; };
  }, [loadData]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
  }, [loadData]);
  const canMutate = Boolean(userId && captainRole !== null && validatedRouteKey === controlKey);

  async function handleStatusChange(playerId: string, nextStatus: CheckinStatus | 'waiting') {
    const operationPrefix = `status:${controlKey}:${playerId}:`;
    const operationKey = `${operationPrefix}${nextStatus}`;
    const anotherStatusPending = [...writeGuardsRef.current].some(([key, state]) => key.startsWith(operationPrefix) && state === 'pending');
    if (!canMutate || anotherStatusPending || writeGuardsRef.current.has(operationKey)) return;
    const operationControlKey = controlKey;
    const operationGameId = gameId;
    const operationTeamId = teamId;
    const previous = checkinMap;
    const updated = { ...previous };
    if (nextStatus === 'waiting') delete updated[playerId]; else updated[playerId] = nextStatus;
    writeGuardsRef.current.set(operationKey, 'pending');
    setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
    setStatusSavingPlayerId(playerId); setActionError(null); setCheckinMap(updated);
    try {
      const result = nextStatus === 'waiting'
        ? await clearPlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId)
        : await updatePlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId, nextStatus);
      if (!result.success) {
        writeGuardsRef.current.delete(operationKey);
        if (validatedRouteRef.current === operationControlKey) {
          setCheckinMap(previous); setActionError(result.error ?? 'Unable to update lineup.');
        }
        return;
      }
      writeGuardsRef.current.set(operationKey, 'succeeded');
      if (validatedRouteRef.current === operationControlKey) setCheckinMap(updated);
    } catch {
      writeGuardsRef.current.delete(operationKey);
      if (validatedRouteRef.current === operationControlKey) {
        setCheckinMap(previous); setActionError('Unable to update lineup.');
      }
    } finally {
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      if (validatedRouteRef.current === operationControlKey) setStatusSavingPlayerId(null);
    }
  }

  async function openSubModal() {
    if (!canMutate) return;
    setSubModalVisible(true); setSubSearch(''); setActionError(null);
    if (subCandidates.length || loadingSubs) return;
    const operationControlKey = controlKey;
    const loadToken = ++subLoadTokenRef.current;
    setLoadingSubs(true);
    try {
      const result = await getLeagueSubPlayers(leagueId, teamId);
      if (loadToken !== subLoadTokenRef.current || validatedRouteRef.current !== operationControlKey) return;
      if (!result.success) { setActionError(result.error ?? 'Unable to load sub players.'); return; }
      setSubCandidates(result.data ?? []);
    } catch {
      if (loadToken === subLoadTokenRef.current && validatedRouteRef.current === operationControlKey) {
        setActionError('Unable to load sub players.');
      }
    } finally {
      if (loadToken === subLoadTokenRef.current && validatedRouteRef.current === operationControlKey) setLoadingSubs(false);
    }
  }

  async function handleInviteSub(playerId: string) {
    const operationKey = `invite:${controlKey}:${playerId}`;
    if (!canMutate || writeGuardsRef.current.has(operationKey)) return;
    const operationControlKey = controlKey;
    const operationGameId = gameId;
    const operationTeamId = teamId;
    writeGuardsRef.current.set(operationKey, 'pending');
    setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
    setSubSavingPlayerId(playerId); setActionError(null);
    try {
      const result = await inviteSub(operationGameId, operationTeamId, playerId);
      if (!result.success) {
        writeGuardsRef.current.delete(operationKey);
        if (validatedRouteRef.current === operationControlKey) {
          setActionError(result.error ?? 'Unable to invite this sub.');
        }
        return;
      }

      writeGuardsRef.current.set(operationKey, 'succeeded');
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      try {
        const refreshed = await getTeamSubInvitations(operationTeamId, [operationGameId]);
        if (validatedRouteRef.current === operationControlKey) setSubInvitations(refreshed.data ?? []);
      } catch {
        // The write is confirmed. A readback failure must not make it retryable.
      }
    } catch {
      writeGuardsRef.current.delete(operationKey);
      if (validatedRouteRef.current === operationControlKey) setActionError('Unable to invite this sub.');
    } finally {
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      if (validatedRouteRef.current === operationControlKey) setSubSavingPlayerId(null);
    }
  }

  async function handleRequestGoalie() {
    const operationKey = `goalie:${controlKey}`;
    if (!canMutate || writeGuardsRef.current.has(operationKey) || goalieRequest) return;
    const operationControlKey = controlKey;
    const operationGameId = gameId;
    const operationTeamId = teamId;
    const operationLeagueId = leagueId;
    const operationDraft = { skillLevelNeeded: goalieSkillLevel, compensation: goalieCompensation, notes: null };
    writeGuardsRef.current.set(operationKey, 'pending');
    setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
    setGoalieSaving(true); setActionError(null);
    try {
      const result = await createGoalieRequest(operationGameId, operationTeamId, operationLeagueId, operationDraft);
      if (!result.success) {
        writeGuardsRef.current.delete(operationKey);
        if (validatedRouteRef.current === operationControlKey) {
          setActionError(result.error ?? 'Unable to create goalie request.');
        }
        return;
      }

      writeGuardsRef.current.set(operationKey, 'succeeded');
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      try {
        const refreshed = await getOpenGoalieRequest(operationGameId, operationTeamId);
        if (validatedRouteRef.current === operationControlKey) setGoalieRequest(refreshed);
      } catch {
        // The write is confirmed. A readback failure must not make it retryable.
      }
      if (validatedRouteRef.current === operationControlKey) {
        setGoalieModalVisible(false);
        Alert.alert('Goalie request posted', `${result.notifiedGoalies ?? 0} active goalies are currently in the pool for this league.`);
      }
    } catch {
      writeGuardsRef.current.delete(operationKey);
      if (validatedRouteRef.current === operationControlKey) setActionError('Unable to create goalie request.');
    } finally {
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      if (validatedRouteRef.current === operationControlKey) setGoalieSaving(false);
    }
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
  const invitedIds = React.useMemo(() => new Set(subInvitations.map((invite) => invite.invitedPlayerId)), [subInvitations]);
  const visibleSubs = React.useMemo(() => {
    const query = subSearch.trim().toLowerCase();
    return subCandidates.filter((candidate) => !query || (candidate.full_name ?? '').toLowerCase().includes(query) || (candidate.email ?? '').toLowerCase().includes(query));
  }, [subCandidates, subSearch]);
  const goalieGuardState = writeGuardStates[`goalie:${controlKey}`];
  const dataBelongsToIdentity = validatedRouteKey === controlKey;
  const captainAccess = dataBelongsToIdentity ? captainRole : null;

  const shellProps = { style: styles.safeArea, edges: cutIceContentEdges(['top']), onAccessibilityEscape: () => navigation.goBack() };
  if (loading || (!accessMessage && !dataBelongsToIdentity)) return <SafeAreaView {...shellProps}><View style={styles.centered}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  if (accessMessage) return <SafeAreaView {...shellProps}><View style={styles.centered}><Text style={styles.emptyTitle}>{accessMessage}</Text></View></SafeAreaView>;

  return <SafeAreaView {...shellProps}>
    <FocusScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
      {gameInfo && <FocusCard focusId={`availability:${gameId}:game`} style={styles.card}>
        <Text style={styles.gameTitle}>vs {gameInfo.opponent}</Text><Text style={styles.secondary}>{gameInfo.date}</Text>
        {gameInfo.location && <View style={styles.inline}><Ionicons name="location-outline" size={13} color={colors.textSecondary} /><Text style={styles.secondary}>{gameInfo.location}</Text></View>}
      </FocusCard>}
      {captainAccess && <FocusCard focusId={`availability:${gameId}:captain`} style={styles.card}>
        <Text style={styles.sectionTitle}>Captain tools</Text><Text style={styles.secondary}>Manage this game for your current Hockey Life team.</Text>
        {actionError && <Text testID="captain-action-error" accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
        <View style={styles.actions}>
          <Pressable testID="captain-request-sub" accessibilityRole="button" onPress={() => void openSubModal()} style={styles.primaryButton}><Text style={styles.buttonText}>Request Sub</Text></Pressable>
          <Pressable testID="captain-request-goalie" accessibilityRole="button" disabled={Boolean(goalieRequest) || Boolean(goalieGuardState)} onPress={() => setGoalieModalVisible(true)} style={[styles.primaryButton, (goalieRequest || goalieGuardState) && styles.disabled]}><Text style={styles.buttonText}>{goalieRequest || goalieGuardState === 'succeeded' ? 'Goalie Requested' : goalieGuardState === 'pending' ? 'Posting…' : 'Request Goalie'}</Text></Pressable>
        </View>
      </FocusCard>}
      <View style={styles.counts}>{groups.map((group) => <View key={group.key} style={styles.countCard}><Text style={[styles.count, { color: group.color }]}>{group.players.length}</Text><Text style={styles.countLabel}>{group.label}</Text></View>)}</View>
      {groups.map((group) => group.players.length ? <FocusCard key={group.key} focusId={`availability:${gameId}:${group.key}`} accentColor={group.color} style={styles.card}>
        <Text style={[styles.sectionTitle, { color: group.color }]}>{group.label} ({group.players.length})</Text>
        {group.players.map((player) => {
          const statusPrefix = `status:${controlKey}:${player.player_id}:`;
          const statusPending = statusSavingPlayerId === player.player_id || Object.entries(writeGuardStates).some(([key, state]) => key.startsWith(statusPrefix) && state === 'pending');
          return <View key={player.player_id} style={styles.playerRow}>
            <Avatar uri={player.avatar_url ?? null} name={player.player_name} size={36} />
            <View style={styles.playerInfo}><Text style={styles.playerName}>{player.player_name}</Text><Text style={styles.secondary}>#{player.jersey_number ?? '--'} {player.position ?? ''}</Text></View>
            {captainAccess ? <View style={styles.statusActions}>{STATUS_CHOICES.map((choice) => <Pressable key={choice.value}
              testID={`captain-status-${player.player_id}-${choice.value}`} accessibilityRole="button"
              accessibilityState={{ selected: (checkinMap[player.player_id] ?? 'waiting') === choice.value, disabled: statusPending }}
              disabled={statusPending} onPress={() => void handleStatusChange(player.player_id, choice.value)} style={styles.statusButton}
            ><Text style={styles.statusText}>{choice.label}</Text></Pressable>)}</View> : <View style={[styles.dot, { backgroundColor: group.color }]} />}
          </View>;
        })}
      </FocusCard> : null)}
      {!roster.length && <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No roster data available</Text></View>}
    </FocusScrollView>

    <Modal visible={subModalVisible} transparent animationType="fade" onRequestClose={() => setSubModalVisible(false)}><View style={styles.overlay}><View style={styles.modal}>
      <Text style={styles.sectionTitle}>Invite a Sub</Text><TextInput testID="captain-sub-search" style={styles.input} value={subSearch} onChangeText={setSubSearch} placeholder="Search by name or email" placeholderTextColor={colors.textSecondary} />
      {loadingSubs ? <ActivityIndicator color={colors.primary} /> : visibleSubs.map((candidate) => {
        const guardState = writeGuardStates[`invite:${controlKey}:${candidate.id}`];
        const invited = invitedIds.has(candidate.id) || guardState === 'succeeded';
        const sending = subSavingPlayerId === candidate.id || guardState === 'pending';
        return <View key={candidate.id} style={styles.playerRow}><View style={styles.playerInfo}><Text style={styles.playerName}>{candidate.full_name ?? 'Unknown player'}</Text>{candidate.email && <Text style={styles.secondary}>{candidate.email}</Text>}</View>
          <Pressable testID={`captain-invite-sub-${candidate.id}`} accessibilityRole="button" disabled={invited || sending} onPress={() => void handleInviteSub(candidate.id)} style={styles.primaryButton}><Text style={styles.buttonText}>{invited ? 'Invited' : sending ? 'Sending…' : 'Invite'}</Text></Pressable>
        </View>;
      })}
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
