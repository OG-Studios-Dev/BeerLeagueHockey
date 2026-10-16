import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../../components/CardFocus';
import {
  getBeerGuyTracker,
  manageBeerGuyAsCaptain,
  type BeerGuyCaptainMutation,
  type BeerGuyHistoryEntry,
  type BeerGuyTracker,
  type BeerGuyUpcomingGame,
} from '../../lib/supabase/beerGuy';
import { createModalScopeLifecycle, type ModalScopeToken } from '../../navigation/dockModalLifecycle';
import type { CaptainStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';

type ScreenProps = NativeStackScreenProps<CaptainStackParamList, 'BeerTracker'>;

type TrackerViewState = {
  scopeKey: string;
  status: 'loading' | 'error' | 'ready';
  tracker: BeerGuyTracker | null;
  selectedGameId: string | null;
  message: string | null;
};

type PendingOperation = { id: number; token: ModalScopeToken };
type SelectedHistory = { scopeKey: string; entry: BeerGuyHistoryEntry; playerName: string };
type HistoryGroup = { playerId: string; playerName: string; former: boolean; entries: BeerGuyHistoryEntry[] };

const TRACKER_ERROR = 'Beer Tracker is unavailable. Your captain access may have changed.';

function loadingState(scopeKey: string): TrackerViewState {
  return { scopeKey, status: 'loading', tracker: null, selectedGameId: null, message: null };
}

function compareUpcoming(left: BeerGuyUpcomingGame, right: BeerGuyUpcomingGame): number {
  return Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at)
    || left.game_id.localeCompare(right.game_id);
}

function formatUpcomingDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
}

function formatHistoryDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function historyGroups(tracker: BeerGuyTracker): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const player of tracker.roster) {
    groups.set(player.player_id, {
      playerId: player.player_id,
      playerName: player.full_name?.trim() || 'Unnamed player',
      former: false,
      entries: [],
    });
  }
  for (const entry of tracker.history) {
    const current = groups.get(entry.player_id);
    if (current) {
      current.entries.push(entry);
      continue;
    }
    const historical = groups.get(entry.player_id) ?? {
      playerId: entry.player_id,
      playerName: entry.player_name.trim() || 'Former player',
      former: entry.player_deleted,
      entries: [],
    };
    historical.entries.push(entry);
    groups.set(entry.player_id, historical);
  }
  return [...groups.values()];
}

export default function BeerTrackerModal({ route, navigation }: ScreenProps) {
  const { teamId, seasonId } = route.params;
  const scopeKey = `${teamId}:${seasonId}`;
  const [viewState, setViewState] = React.useState<TrackerViewState>(() => loadingState(scopeKey));
  const [loadRevision, setLoadRevision] = React.useState(0);
  const [savingPlayerId, setSavingPlayerId] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = React.useState<SelectedHistory | null>(null);
  const [scopeLifecycle] = React.useState(createModalScopeLifecycle);
  const loadGenerationRef = React.useRef(0);
  const operationSequenceRef = React.useRef(0);
  const pendingOperationRef = React.useRef<PendingOperation | null>(null);
  const activeScopeTokenRef = React.useRef<ModalScopeToken | null>(null);

  React.useLayoutEffect(() => {
    const token = scopeLifecycle.activate(scopeKey);
    activeScopeTokenRef.current = token;
    loadGenerationRef.current += 1;
    pendingOperationRef.current = null;
    setSavingPlayerId(null);
    setActionMessage(null);
    setSelectedHistory(null);
    setViewState(loadingState(scopeKey));
    return () => {
      scopeLifecycle.reset(token);
      if (activeScopeTokenRef.current === token) activeScopeTokenRef.current = null;
      loadGenerationRef.current += 1;
      if (pendingOperationRef.current?.token === token) pendingOperationRef.current = null;
    };
  }, [scopeKey, scopeLifecycle]);

  React.useEffect(() => {
    const ownerToken = activeScopeTokenRef.current;
    if (!scopeLifecycle.isCurrent(ownerToken)) return;
    const generation = ++loadGenerationRef.current;
    setViewState(loadingState(scopeKey));
    setSelectedHistory(null);

    void getBeerGuyTracker(teamId).then((result) => {
      if (generation !== loadGenerationRef.current || !scopeLifecycle.isCurrent(ownerToken)) return;
      if (result.error || !result.data || result.data.season_id !== seasonId) {
        setViewState({ scopeKey, status: 'error', tracker: null, selectedGameId: null, message: TRACKER_ERROR });
        return;
      }
      const upcoming = [...result.data.upcoming_games].sort(compareUpcoming);
      setViewState({
        scopeKey,
        status: 'ready',
        tracker: { ...result.data, upcoming_games: upcoming },
        selectedGameId: upcoming[0]?.game_id ?? null,
        message: null,
      });
    }).catch(() => {
      if (generation === loadGenerationRef.current && scopeLifecycle.isCurrent(ownerToken)) {
        setViewState({ scopeKey, status: 'error', tracker: null, selectedGameId: null, message: TRACKER_ERROR });
      }
    });

    return () => { loadGenerationRef.current += 1; };
  }, [loadRevision, scopeKey, scopeLifecycle, seasonId, teamId]);

  const visibleState = viewState.scopeKey === scopeKey ? viewState : loadingState(scopeKey);
  const selectedGame = visibleState.tracker?.upcoming_games.find((game) => game.game_id === visibleState.selectedGameId) ?? null;
  const assignedPlayerId = selectedGame?.assignment?.player_id ?? null;
  const holderName = assignedPlayerId
    ? selectedGame?.assignment?.player_name
      ?? visibleState.tracker?.roster.find((player) => player.player_id === assignedPlayerId)?.full_name
      ?? 'Assigned player'
    : null;
  const renderScopeToken = activeScopeTokenRef.current;
  const saving = scopeLifecycle.isCurrent(renderScopeToken) && pendingOperationRef.current?.token === renderScopeToken;
  const completedHistoryGroups = visibleState.tracker ? historyGroups(visibleState.tracker) : [];
  const visibleHistory = selectedHistory?.scopeKey === scopeKey ? selectedHistory : null;

  const updateSelectedAssignment = React.useCallback((mutation: BeerGuyCaptainMutation, ownerToken: ModalScopeToken) => {
    if (!scopeLifecycle.isCurrent(ownerToken)) return;
    setViewState((current) => {
      if (!scopeLifecycle.isCurrent(ownerToken)
        || current.scopeKey !== scopeKey
        || current.status !== 'ready'
        || !current.selectedGameId
        || !current.tracker) return current;
      return {
        ...current,
        tracker: {
          ...current.tracker,
          upcoming_games: current.tracker.upcoming_games.map((game) => game.game_id === current.selectedGameId
            ? { ...game, assignment: mutation.assignment }
            : game),
        },
      };
    });
  }, [scopeKey, scopeLifecycle]);

  const saveAssignment = React.useCallback(async (
    game: BeerGuyUpcomingGame,
    playerId: string | null,
    ownerToken: ModalScopeToken | null,
  ) => {
    if (!scopeLifecycle.isCurrent(ownerToken)
      || pendingOperationRef.current
      || viewState.scopeKey !== scopeKey
      || viewState.status !== 'ready') return;
    const operation = { id: ++operationSequenceRef.current, token: ownerToken };
    pendingOperationRef.current = operation;
    setSavingPlayerId(playerId);
    setActionMessage(null);
    const observed = game.assignment;
    try {
      const result = await manageBeerGuyAsCaptain(
        game.game_id,
        teamId,
        playerId,
        observed?.id ?? null,
        observed?.version ?? null,
      );
      if (pendingOperationRef.current !== operation || !scopeLifecycle.isCurrent(ownerToken)) return;
      const conflict = result.data?.outcome === 'conflict' || /stale|conflict/i.test(result.error ?? '');
      if (conflict) {
        setActionMessage('Assignment changed. Beer Tracker refreshed.');
        setViewState(loadingState(scopeKey));
        setLoadRevision((current) => current + 1);
        return;
      }
      if (result.error || !result.data) {
        setActionMessage('Unable to update Beer Guy. Refresh and try again.');
        return;
      }
      updateSelectedAssignment(result.data, ownerToken);
    } catch {
      if (pendingOperationRef.current === operation && scopeLifecycle.isCurrent(ownerToken)) {
        setActionMessage('Unable to update Beer Guy. Refresh and try again.');
      }
    } finally {
      if (pendingOperationRef.current === operation) {
        pendingOperationRef.current = null;
        if (scopeLifecycle.isCurrent(ownerToken)) setSavingPlayerId(null);
      }
    }
  }, [scopeKey, scopeLifecycle, teamId, updateSelectedAssignment, viewState.scopeKey, viewState.status]);

  const closeTracker = React.useCallback((ownerToken: ModalScopeToken | null) => {
    if (!scopeLifecycle.isCurrent(ownerToken)) return;
    scopeLifecycle.reset(ownerToken);
    activeScopeTokenRef.current = null;
    loadGenerationRef.current += 1;
    pendingOperationRef.current = null;
    navigation.goBack();
  }, [navigation, scopeLifecycle]);

  return (
    <SafeAreaView
      accessibilityViewIsModal
      accessibilityLabel="Beer Tracker"
      onAccessibilityEscape={() => closeTracker(renderScopeToken)}
      style={styles.safeArea}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Season Tools</Text>
          <Text accessibilityRole="header" style={styles.title}>Beer Tracker</Text>
        </View>
        <Pressable
          testID="beer-tracker-close"
          accessibilityRole="button"
          accessibilityLabel="Close Beer Tracker"
          onPress={() => closeTracker(renderScopeToken)}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      {visibleState.status === 'loading' ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : visibleState.status === 'error' ? (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={styles.errorTitle}>Unable to load Beer Tracker</Text>
          <Text style={styles.secondary}>{visibleState.message}</Text>
          <Pressable
            testID="beer-tracker-retry"
            accessibilityRole="button"
            accessibilityLabel="Retry Beer Tracker"
            onPress={() => {
              if (!scopeLifecycle.isCurrent(renderScopeToken)) return;
              setViewState(loadingState(scopeKey));
              setLoadRevision((current) => current + 1);
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FocusScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FocusCard focusId="beer-tracker-upcoming" style={styles.card} testID="beer-tracker-upcoming">
            <Text accessibilityRole="header" style={styles.sectionTitle}>Upcoming Games</Text>
            {visibleState.tracker!.upcoming_games.length > 0 ? (
              <View accessibilityRole="tablist" accessibilityLabel="Upcoming games" style={styles.gameSelector}>
                {visibleState.tracker!.upcoming_games.map((game) => {
                  const selected = game.game_id === visibleState.selectedGameId;
                  const label = formatUpcomingDate(game.scheduled_at, visibleState.tracker!.timezone);
                  return (
                    <Pressable
                      key={game.game_id}
                      testID={`beer-tracker-game-${game.game_id}`}
                      accessibilityRole="tab"
                      accessibilityLabel={`Beer Tracker game ${label}`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (!scopeLifecycle.isCurrent(renderScopeToken)) return;
                        setViewState((current) => current.scopeKey === scopeKey
                          ? { ...current, selectedGameId: game.game_id }
                          : current);
                      }}
                      style={[styles.gameOption, selected && styles.gameOptionSelected]}
                    >
                      <Text style={[styles.gameOptionText, selected && styles.gameOptionTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : <Text style={styles.secondary}>No upcoming scheduled games.</Text>}
            {visibleState.tracker!.roster.length === 0
              ? <Text style={styles.secondary}>No eligible regular players are available.</Text>
              : null}

            {selectedGame ? (
              <>
                <View testID="beer-tracker-current-holder" accessible accessibilityLabel={holderName ? `Current Beer Guy, ${holderName}` : 'Current Beer Guy, unassigned'} style={styles.holder}>
                  <Text style={styles.holderLabel}>Current Beer Guy</Text>
                  <Text style={styles.holderName}>{holderName ?? 'Unassigned'}</Text>
                </View>
                {assignedPlayerId ? (
                  <Pressable
                    testID="beer-tracker-clear"
                    accessibilityRole="button"
                    accessibilityLabel={`Clear ${holderName ?? 'current player'} as Beer Guy`}
                    accessibilityState={{ disabled: saving }}
                    disabled={saving}
                    onPress={() => { if (selectedGame) void saveAssignment(selectedGame, null, renderScopeToken); }}
                    style={[styles.clearButton, saving && styles.playerRowDisabled]}
                  >
                    <Text style={styles.clearText}>{saving && savingPlayerId === null ? 'Clearing…' : 'Clear assignment'}</Text>
                  </Pressable>
                ) : null}
                {actionMessage ? <Text testID="beer-tracker-action-message" accessibilityRole="alert" style={styles.actionMessage}>{actionMessage}</Text> : null}
                <View style={styles.roster}>
                  {visibleState.tracker!.roster.map((player) => {
                    const selected = player.player_id === assignedPlayerId;
                    const playerName = player.full_name?.trim() || 'Unnamed player';
                    const disabled = selected || saving;
                    return (
                      <Pressable
                        key={player.player_id}
                        testID={`beer-tracker-player-${player.player_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={selected ? `${playerName} is the current Beer Guy` : `Assign ${playerName} as Beer Guy`}
                        accessibilityState={{ disabled, selected }}
                        disabled={disabled}
                        onPress={() => { if (selectedGame) void saveAssignment(selectedGame, player.player_id, renderScopeToken); }}
                        style={[styles.playerRow, selected && styles.playerRowSelected, disabled && !selected && styles.playerRowDisabled]}
                      >
                        <View style={styles.playerCopy}>
                          <Text style={styles.playerName}>{savingPlayerId === player.player_id ? 'Assigning…' : playerName}</Text>
                          <Text style={styles.playerMeta}>{player.is_goalie ? 'Goalie' : (player.position ?? 'Position not listed')}</Text>
                        </View>
                        <Text style={styles.jersey}>{player.jersey_number == null ? 'No jersey number' : `#${player.jersey_number}`}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </FocusCard>

          <FocusCard focusId="beer-tracker-history" style={styles.card} testID="beer-tracker-history">
            <Text accessibilityRole="header" style={styles.sectionTitle}>Completed History</Text>
            {visibleState.tracker!.history.length === 0
              ? <Text style={styles.secondary}>No completed Beer Guy assignments yet.</Text>
              : null}
            <View style={styles.historyList}>
              {completedHistoryGroups.map((group) => (
                <View key={group.playerId} testID={`beer-history-player-${group.playerId}`} style={styles.historyRow}>
                  <View style={styles.historyPlayerCopy}>
                    <Text style={styles.playerName}>{group.playerName}</Text>
                    {group.former ? <Text style={styles.playerMeta}>Former player</Text> : null}
                  </View>
                  <View style={styles.mugs}>
                    {group.entries.length === 0 ? <Text style={styles.noMugs}>—</Text> : group.entries.map((entry) => {
                      const date = formatHistoryDate(entry.game_date);
                      return (
                        <Pressable
                          key={entry.assignment_id}
                          testID={`beer-history-assignment-${entry.assignment_id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.playerName} Beer Guy assignment on ${date}`}
                          accessibilityHint="Show game date"
                          onPress={() => {
                            if (scopeLifecycle.isCurrent(renderScopeToken)) {
                              setSelectedHistory({ scopeKey, entry, playerName: group.playerName });
                            }
                          }}
                          style={styles.mugButton}
                        >
                          <Text accessible={false} style={styles.mug}>🍺</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </FocusCard>
        </FocusScrollView>
      )}

      <Modal
        visible={visibleHistory !== null}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={() => {
          if (scopeLifecycle.isCurrent(renderScopeToken)) setSelectedHistory(null);
        }}
      >
        <View style={styles.historyScrim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close game date"
            onPress={() => {
              if (scopeLifecycle.isCurrent(renderScopeToken)) setSelectedHistory(null);
            }}
            style={StyleSheet.absoluteFill}
          />
          <View testID="beer-history-date-dialog" accessibilityViewIsModal accessibilityLabel="Beer Guy game date" style={styles.historyDialog}>
            <Text accessibilityRole="header" style={styles.historyDialogTitle}>Beer Guy assignment</Text>
            <Text style={styles.historyDialogPlayer}>{visibleHistory?.playerName}</Text>
            <Text style={styles.historyDialogDate}>{visibleHistory ? formatHistoryDate(visibleHistory.entry.game_date) : ''}</Text>
            <Pressable
              testID="beer-history-date-close"
              accessibilityRole="button"
              accessibilityLabel="Close game date"
              onPress={() => {
                if (scopeLifecycle.isCurrent(renderScopeToken)) setSelectedHistory(null);
              }}
              style={styles.historyClose}
            >
              <Text style={styles.historyCloseText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgModal },
  header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.glassStroke, paddingHorizontal: 18, paddingVertical: 12 },
  eyebrow: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.8, textTransform: 'uppercase' },
  title: { color: colors.textPrimary, fontSize: 25, lineHeight: 31, fontWeight: '900' },
  closeButton: { minWidth: 60, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgInteractive, paddingHorizontal: 12 },
  closeText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28 },
  errorTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  secondary: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  retryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: colors.textOnPrimary, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 36 },
  card: { gap: 14 },
  sectionTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  gameSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gameOption: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive, paddingHorizontal: 14, paddingVertical: 9 },
  gameOptionSelected: { borderColor: colors.primary, backgroundColor: colors.bgControlOpaque },
  gameOptionText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  gameOptionTextSelected: { color: colors.primary },
  holder: { minHeight: 70, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgSurface, paddingHorizontal: 16, paddingVertical: 12 },
  holderLabel: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase' },
  holderName: { marginTop: 3, color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  clearButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgInteractive, paddingHorizontal: 14, paddingVertical: 10 },
  clearText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  actionMessage: { color: colors.accentRed, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  roster: { gap: 8 },
  playerRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive, paddingHorizontal: 14, paddingVertical: 10 },
  playerRowSelected: { borderColor: colors.primary, backgroundColor: colors.bgControlOpaque },
  playerRowDisabled: { opacity: 0.55 },
  playerCopy: { flex: 1, minWidth: 0 },
  playerName: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  playerMeta: { marginTop: 2, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  jersey: { marginLeft: 12, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  historyList: { gap: 8 },
  historyRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, paddingHorizontal: 14, paddingVertical: 8 },
  historyPlayerCopy: { flex: 1, minWidth: 0, marginRight: 10 },
  mugs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 },
  mugButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive },
  mug: { fontSize: 23, lineHeight: 29 },
  noMugs: { minWidth: 44, color: colors.textSecondary, fontSize: 18, lineHeight: 24, textAlign: 'center' },
  historyScrim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.72)', padding: 24 },
  historyDialog: { width: '100%', maxWidth: 360, alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.glassStrokeStrong, backgroundColor: colors.bgModal, padding: 22 },
  historyDialogTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  historyDialogPlayer: { marginTop: 8, color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  historyDialogDate: { marginTop: 4, color: colors.textPrimary, fontSize: 16, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  historyClose: { minWidth: 88, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 18 },
  historyCloseText: { color: colors.textOnPrimary, fontSize: 13, lineHeight: 18, fontWeight: '900' },
});
