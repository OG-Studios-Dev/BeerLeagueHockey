import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AccessibleChoiceGroup from '../../components/AccessibleChoiceGroup';
import FindSpareModal from '../../components/captain/FindSpareModal';
import Avatar from '../../components/Avatar';
import { FocusCard, FocusScrollView } from '../../components/CardFocus';
import { SECTION_HEADING_TEXT_STYLE } from '../../components/SectionHeader';
import { SelectableControl, SelectableControlGroup } from '../../components/SelectableControl';
import { HOCKEY_LIFE_ID } from '../../config/hockeyLife';
import { useAuth } from '../../context/AuthContext';
import {
  clearPlayerCheckinAsCaptain, createGoalieRequest, getCaptainRoleForSeason, getGameCheckinStatusMap,
  getOpenGoalieRequest,
  updatePlayerCheckinAsCaptain, type CaptainRole, type GoalieRequestRow,
} from '../../lib/supabase/captain';
import { type CheckinStatus } from '../../lib/supabase/checkins';
import { supabase } from '../../lib/supabase/client';
import { getBeerGuyGameState, manageBeerGuyAsCaptain, type BeerGuyAssignment } from '../../lib/supabase/beerGuy';
import { getActiveSeasonRoster, getTeamActiveSeason, type TeamRosterMember } from '../../lib/supabase/team';
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
  season_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  location: string | null;
  home_team: { name?: string | null } | Array<{ name?: string | null }> | null;
  away_team: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ScreenProps = {
  route: { params: { gameId: string; teamId: string; leagueId: string; intent?: 'invite-sub' } };
  navigation: { goBack(): void };
};

type BeerFact = { scope: string; assignment: BeerGuyAssignment | null; error: string | null; revision: number };

type ScopedStatusFact = {
  value: CheckinStatus | null;
  revision: number;
};

export default function GameAvailabilityScreen({ route, navigation }: ScreenProps) {
  const { gameId, teamId, leagueId } = route.params;
  const routeIntent = route.params.intent === 'invite-sub' ? 'invite-sub' : null;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const routeKey = `${leagueId}:${teamId}:${gameId}`;
  const controlKey = `${userId ?? 'anonymous'}:${routeKey}`;
  const [roster, setRoster] = React.useState<TeamRosterMember[]>([]);
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
  const [goalieModalVisible, setGoalieModalVisible] = React.useState(false);
  const [goalieRequest, setGoalieRequest] = React.useState<GoalieRequestRow | null>(null);
  const [goalieSkillLevel, setGoalieSkillLevel] = React.useState('intermediate');
  const [goalieCompensation, setGoalieCompensation] = React.useState('Free');
  const [goalieSaving, setGoalieSaving] = React.useState(false);
  const [beerFact, setBeerFact] = React.useState<BeerFact | null>(null);
  const confirmedBeerRef = React.useRef<Map<string, BeerFact>>(new Map());
  const beerRevisionRef = React.useRef(0);
  const beerReadGenerationRef = React.useRef<Map<string, number>>(new Map());
  const loadGenerationRef = React.useRef(0);
  const validatedRouteRef = React.useRef<string | null>(null);
  const activeScopeRef = React.useRef<string | null>(null);
  const consumedInviteIntentKeysRef = React.useRef<Set<string>>(new Set());
  const confirmedStatusRef = React.useRef<Map<string, ScopedStatusFact>>(new Map());
  const confirmedStatusRevisionRef = React.useRef(0);
  const authoritativeStatusRef = React.useRef<Map<string, ScopedStatusFact>>(new Map());
  const authoritativeStatusRevisionRef = React.useRef(0);
  const writeGuardsRef = React.useRef<Map<string, 'pending' | 'succeeded'>>(new Map());
  const [writeGuardStates, setWriteGuardStates] = React.useState<Record<string, 'pending' | 'succeeded'>>({});

  // All authoritative observations share the same scope-local revision. A canonical
  // holder also proves confirmed attendance (the existing RPC's atomic invariant).
  const recordBeerFact = React.useCallback((scope: string, assignment: BeerGuyAssignment | null, error: string | null) => {
    const previous = confirmedBeerRef.current.get(scope);
    if (!error && assignment && previous?.assignment?.id === assignment.id
      && previous.assignment.version > assignment.version) return previous;
    const fact = { scope, assignment, error, revision: ++beerRevisionRef.current };
    confirmedBeerRef.current.set(scope, fact);
    const holder = !error ? assignment?.player_id : null;
    if (holder) confirmedStatusRef.current.set(`${scope}:${holder}`, { value: 'confirmed', revision: ++confirmedStatusRevisionRef.current });
    if (validatedRouteRef.current === scope) {
      setBeerFact(fact);
      if (holder) setCheckinMap(current => ({ ...current, [holder]: 'confirmed' }));
    }
    return fact;
  }, []);

  const loadData = React.useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const beerReadGeneration = (beerReadGenerationRef.current.get(controlKey) ?? 0) + 1;
    beerReadGenerationRef.current.set(controlKey, beerReadGeneration);
    const beerRevisionAtLoad = confirmedBeerRef.current.get(controlKey)?.revision ?? 0;
    const confirmedRevisionsAtLoad = new Map(
      [...confirmedStatusRef.current].map(([key, fact]) => [key, fact.revision]),
    );
    validatedRouteRef.current = null;
    setValidatedRouteKey(null);
    if (activeScopeRef.current !== controlKey) {
      activeScopeRef.current = controlKey;
      setGoalieSkillLevel('intermediate'); setGoalieCompensation('Free');
    }
    setStatusSavingPlayerId(null); setGoalieSaving(false);
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
      id, league_id, season_id, scheduled_at, location, home_team_id, away_team_id,
      home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name)
    `).eq('id', gameId).eq('league_id', leagueId).maybeSingle();
      if (generation !== loadGenerationRef.current) return;
      const g = game as GameRow | null;
      if (gameError || !g || g.league_id !== leagueId || (g.home_team_id !== teamId && g.away_team_id !== teamId)) {
      setRoster([]); setCheckinMap({}); setGameInfo(null);
      setAccessMessage('This game does not belong to the requested team.'); setLoading(false); return;
      }
      const { season, error: seasonError } = await getTeamActiveSeason(HOCKEY_LIFE_ID);
      if (generation !== loadGenerationRef.current) return;
      if (seasonError || !season || !['active', 'playoffs'].includes(season.status) || g.season_id !== season.id) {
      setRoster([]); setCheckinMap({}); setGameInfo(null);
      setAccessMessage('This game is not in the current Hockey Life season.'); setLoading(false); return;
      }
      const role = await getCaptainRoleForSeason(teamId, HOCKEY_LIFE_ID, season.id);
      if (generation !== loadGenerationRef.current) return;
      validatedRouteRef.current = controlKey;
      setValidatedRouteKey(controlKey);
      const rosterData = await getActiveSeasonRoster(teamId, leagueId, season.id);
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
      const [checkins, request, beer] = await Promise.all([
        getGameCheckinStatusMap(gameId, teamId), getOpenGoalieRequest(gameId, teamId), getBeerGuyGameState(gameId, teamId),
      ]);
      if (generation !== loadGenerationRef.current) return;
      const confirmedBeer = confirmedBeerRef.current.get(controlKey);
      if (confirmedBeer && (confirmedBeer.revision > beerRevisionAtLoad || beerReadGenerationRef.current.get(controlKey) !== beerReadGeneration)) setBeerFact(confirmedBeer);
      else if (beerReadGenerationRef.current.get(controlKey) === beerReadGeneration) recordBeerFact(controlKey, beer.data?.assignment ?? null, beer.error ?? (!beer.data ? 'Beer Guy unavailable' : null));
      const authoritativeRevision = ++authoritativeStatusRevisionRef.current;
      for (const player of rosterData) {
        const statusKey = `${controlKey}:${player.player_id}`;
        authoritativeStatusRef.current.set(statusKey, {
          value: checkins[player.player_id] ?? null,
          revision: authoritativeRevision,
        });
      }
      setCheckinMap(() => {
        const merged = { ...checkins };
        for (const player of rosterData) {
          const statusKey = `${controlKey}:${player.player_id}`;
          const confirmed = confirmedStatusRef.current.get(statusKey);
          if (!confirmed || confirmed.revision <= (confirmedRevisionsAtLoad.get(statusKey) ?? 0)) continue;
          if (confirmed.value) merged[player.player_id] = confirmed.value;
          else delete merged[player.player_id];
        }
        return merged;
      });
      setGoalieRequest(request);
      } else {
      setCheckinMap({}); setGoalieRequest(null);
      }
    } catch {
      if (generation === loadGenerationRef.current) {
        validatedRouteRef.current = null; setValidatedRouteKey(null); setCaptainRole(null);
        setRoster([]); setCheckinMap({}); setGameInfo(null);
        setAccessMessage('Unable to load game availability.');
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
        setLoading(false);
      }
    }
  }, [controlKey, gameId, leagueId, recordBeerFact, teamId, userId]);

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
    if (!canMutate || validatedRouteRef.current !== controlKey || !roster.some(player => player.player_id === playerId) || writeGuardsRef.current.has(`beer:${controlKey}`) || anotherStatusPending || writeGuardsRef.current.get(operationKey) === 'pending') return;
    const operationControlKey = controlKey;
    const operationGameId = gameId;
    const operationTeamId = teamId;
    const previousStatus = checkinMap[playerId];
    const statusKey = `${operationControlKey}:${playerId}`;
    const authoritativeRevisionAtStart = authoritativeStatusRef.current.get(statusKey)?.revision ?? 0;
    writeGuardsRef.current.set(operationKey, 'pending');
    setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
    setStatusSavingPlayerId(playerId); setActionError(null);
    setCheckinMap((current) => {
      const updated = { ...current };
      if (nextStatus === 'waiting') delete updated[playerId]; else updated[playerId] = nextStatus;
      return updated;
    });
    try {
      const result = nextStatus === 'waiting'
        ? await clearPlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId)
        : await updatePlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId, nextStatus);
      if (!result.success) {
        writeGuardsRef.current.delete(operationKey);
        if (validatedRouteRef.current === operationControlKey) {
          const authoritative = authoritativeStatusRef.current.get(statusKey);
          const restoredStatus = authoritative && authoritative.revision > authoritativeRevisionAtStart
            ? authoritative.value
            : previousStatus ?? null;
          setCheckinMap((current) => {
            const restored = { ...current };
            if (restoredStatus) restored[playerId] = restoredStatus; else delete restored[playerId];
            return restored;
          });
          setActionError(result.error ?? 'Unable to update lineup.');
        }
        return;
      }
      confirmedStatusRef.current.set(statusKey, {
        value: nextStatus === 'waiting' ? null : nextStatus,
        revision: ++confirmedStatusRevisionRef.current,
      });
      if (validatedRouteRef.current === operationControlKey) {
        setCheckinMap((current) => {
          const confirmed = { ...current };
          if (nextStatus === 'waiting') delete confirmed[playerId]; else confirmed[playerId] = nextStatus;
          return confirmed;
        });
      }
      const beerReadGeneration = (beerReadGenerationRef.current.get(operationControlKey) ?? 0) + 1;
      beerReadGenerationRef.current.set(operationControlKey, beerReadGeneration);
      const beer = await getBeerGuyGameState(operationGameId, operationTeamId);
      if (beerReadGenerationRef.current.get(operationControlKey) === beerReadGeneration) {
        recordBeerFact(operationControlKey, beer.data?.assignment ?? null, beer.error ?? (!beer.data ? 'Beer Guy unavailable' : null));
      }
    } catch {
      writeGuardsRef.current.delete(operationKey);
      if (validatedRouteRef.current === operationControlKey) {
        const authoritative = authoritativeStatusRef.current.get(statusKey);
        const restoredStatus = authoritative && authoritative.revision > authoritativeRevisionAtStart
          ? authoritative.value
          : previousStatus ?? null;
        setCheckinMap((current) => {
          const restored = { ...current };
          if (restoredStatus) restored[playerId] = restoredStatus; else delete restored[playerId];
          return restored;
        });
        setActionError('Unable to update lineup.');
      }
    } finally {
      writeGuardsRef.current.delete(operationKey);
      setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
      if (validatedRouteRef.current === operationControlKey) setStatusSavingPlayerId(null);
    }
  }

  async function handleBeerChange(playerId: string) {
    const operationKey = `beer:${controlKey}`;
    const observed = beerFact?.scope === controlKey ? beerFact : null;
    const pendingStatus = [...writeGuardsRef.current].some(([key, state]) => key.startsWith(`status:${controlKey}:`) && state === 'pending');
    if (!canMutate || validatedRouteRef.current !== controlKey || !roster.some(player => player.player_id === playerId)
      || !observed || observed.error || pendingStatus || writeGuardsRef.current.has(operationKey)) return;
    const operationControlKey = controlKey;
    const target = observed.assignment?.player_id === playerId ? null : playerId;
    writeGuardsRef.current.set(operationKey, 'pending');
    setWriteGuardStates(Object.fromEntries(writeGuardsRef.current)); setActionError(null);
    try {
      const result = await manageBeerGuyAsCaptain(gameId, teamId, target, observed.assignment?.id ?? null, observed.assignment?.version ?? null);
      if (result.error || !result.data) {
        if (validatedRouteRef.current === operationControlKey) setActionError(result.error ?? 'Unable to update Beer Guy.');
        return;
      }
      if (result.data.outcome === 'conflict') {
        const beerReadGeneration = (beerReadGenerationRef.current.get(operationControlKey) ?? 0) + 1;
        beerReadGenerationRef.current.set(operationControlKey, beerReadGeneration);
        const refreshed = await getBeerGuyGameState(gameId, teamId);
        if (beerReadGenerationRef.current.get(operationControlKey) === beerReadGeneration) {
          recordBeerFact(operationControlKey, refreshed.data?.assignment ?? null, refreshed.error ?? (!refreshed.data ? 'Beer Guy unavailable' : null));
        }
        if (validatedRouteRef.current === operationControlKey) {
          setActionError('Beer Guy changed. Review the current assignment and try again.');
        }
        return;
      }
      beerReadGenerationRef.current.set(operationControlKey, (beerReadGenerationRef.current.get(operationControlKey) ?? 0) + 1);
      recordBeerFact(operationControlKey, result.data.assignment, null);
    } finally {
      writeGuardsRef.current.delete(operationKey);
      if (validatedRouteRef.current === operationControlKey) setWriteGuardStates(Object.fromEntries(writeGuardsRef.current));
    }
  }

  const openSubModal = React.useCallback(() => {
    if (!canMutate || validatedRouteRef.current !== controlKey) return;
    setSubModalVisible(true);
  }, [canMutate, controlKey]);

  React.useEffect(() => {
    if (routeIntent !== 'invite-sub' || !canMutate || validatedRouteRef.current !== controlKey) return;
    const intentKey = `invite-sub:${controlKey}`;
    if (consumedInviteIntentKeysRef.current.has(intentKey)) return;
    consumedInviteIntentKeysRef.current.add(intentKey);
    void openSubModal();
  }, [canMutate, controlKey, openSubModal, routeIntent]);

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
    const grouped: Record<string, TeamRosterMember[]> = { confirmed: [], tentative: [], out: [], noResponse: [] };
    roster.forEach((player) => grouped[checkinMap[player.player_id] ?? 'noResponse'].push(player));
    return [
      { key: 'confirmed', label: 'In', icon: 'checkmark-circle', color: colors.accentGreen, players: grouped.confirmed },
      { key: 'tentative', label: 'Maybe', icon: 'help-circle', color: '#EAB308', players: grouped.tentative },
      { key: 'out', label: 'Out', icon: 'close-circle', color: colors.accentRed, players: grouped.out },
      { key: 'noResponse', label: 'No Response', icon: 'ellipse-outline', color: colors.textSecondary, players: grouped.noResponse },
    ];
  }, [checkinMap, roster]);
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
      {captainAccess && actionError && <Text testID="captain-action-error" accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
      <View style={styles.counts}>{groups.map((group) => <View key={group.key} style={styles.countCard}><Text style={[styles.count, { color: group.color }]}>{group.players.length}</Text><Text style={styles.countLabel}>{group.label}</Text></View>)}</View>
      {groups.map((group) => group.players.length ? <FocusCard key={group.key} focusId={`availability:${gameId}:${group.key}`} accentColor={group.color} style={styles.card}>
        <Text style={[styles.sectionTitle, { color: group.color }]}>{group.label} ({group.players.length})</Text>
        {group.players.map((player) => {
          const statusPrefix = `status:${controlKey}:${player.player_id}:`;
          const beerPending = writeGuardStates[`beer:${controlKey}`] === 'pending';
          const beerKnown = beerFact?.scope === controlKey && !beerFact.error;
          const isBeerGuy = Boolean(beerKnown && beerFact?.assignment?.player_id === player.player_id && checkinMap[player.player_id] === 'confirmed');
          const anyStatusPending = Object.entries(writeGuardStates).some(([key, state]) => key.startsWith(`status:${controlKey}:`) && state === 'pending');
          const statusPending = beerPending || statusSavingPlayerId === player.player_id || Object.entries(writeGuardStates).some(([key, state]) => key.startsWith(statusPrefix) && state === 'pending');
          return <View key={player.player_id} style={styles.playerRow}>
            <Avatar uri={player.avatar_url ?? null} name={player.player_name} size={36} />
            <View style={styles.playerInfo}><Text style={styles.playerName}>{player.player_name}</Text><Text style={styles.secondary}>#{player.jersey_number ?? '--'} {player.position ?? ''}</Text></View>
            {captainAccess && <Pressable testID={`captain-beer-${player.player_id}`} accessibilityRole="checkbox"
              accessibilityLabel={`${player.player_name} Beer Guy`} accessibilityHint={isBeerGuy ? 'Clear Beer Guy and remain In.' : 'Assign Beer Guy and check in as In.'}
              accessibilityState={{ checked: beerKnown ? isBeerGuy : 'mixed', disabled: !beerKnown || beerPending || anyStatusPending, busy: beerPending }}
              disabled={!beerKnown || beerPending || anyStatusPending} onPress={() => void handleBeerChange(player.player_id)} style={styles.beerButton}>
              <Text style={styles.secondary}>{beerPending ? 'Updating Beer Guy…' : !beerKnown ? '🍺 Beer Guy unavailable' : isBeerGuy ? '🍺 Beer Guy ✓' : '🍺 Beer Guy'}</Text>
            </Pressable>}
            {captainAccess ? <SelectableControlGroup role="radiogroup" accessibilityLabel={`${player.player_name} check-in status`} contentContainerStyle={styles.statusActions}>{STATUS_CHOICES.map((choice) => <SelectableControl key={choice.value}
              testID={`captain-status-${player.player_id}-${choice.value}`} role="radio" label={choice.label}
              selected={(checkinMap[player.player_id] ?? 'waiting') === choice.value}
              disabled={statusPending} onPress={() => void handleStatusChange(player.player_id, choice.value)} style={styles.statusButton}
            />)}</SelectableControlGroup> : <View style={[styles.dot, { backgroundColor: group.color }]} />}
          </View>;
        })}
      </FocusCard> : null)}
      {!roster.length && <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No roster data available</Text></View>}
    </FocusScrollView>

    <FindSpareModal scope={{ gameId, teamId, leagueId }} actorId={userId} visible={subModalVisible && canMutate} gameDateLabel={gameInfo?.date}
      onClose={() => { setSubModalVisible(false); void loadData(); }} />

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
  safeArea: { flex: 1 }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.bgSurface, borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, padding: 14, gap: 10 }, gameTitle: { fontSize: 20, fontWeight: '900', color: colors.textPrimary }, sectionTitle: { ...SECTION_HEADING_TEXT_STYLE, color: colors.textPrimary }, secondary: { fontSize: 12, fontWeight: '600', color: colors.textSecondary }, inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  error: { color: colors.accentRed, fontSize: 12, fontWeight: '700' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, primaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary }, secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.bgInteractive }, buttonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' }, disabled: { opacity: 0.5 },
  counts: { flexDirection: 'row', gap: 8 }, countCard: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.bgSurface }, count: { fontSize: 22, fontWeight: '900' }, countLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  beerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.bgInteractive },
  playerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 8 }, playerInfo: { flex: 1, minWidth: 100 }, playerName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary }, statusActions: { width: '100%', gap: 6 }, statusButton: { minWidth: 88 }, dot: { width: 10, height: 10, borderRadius: 5 },
  emptyCard: { padding: 32, alignItems: 'center', borderRadius: 16, backgroundColor: colors.bgSurface }, emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }, overlay: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#000000AA' }, modal: { borderRadius: 16, padding: 16, gap: 12, backgroundColor: colors.bgModal, borderWidth: 1, borderColor: colors.glassStroke }, input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, color: colors.textPrimary, backgroundColor: colors.bgInteractive },
});
