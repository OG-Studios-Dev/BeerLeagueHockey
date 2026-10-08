import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusFlatList } from '../components/CardFocus';
import DivisionFilter from '../components/DivisionFilter';
import GuestBanner from '../components/GuestBanner';
import QuickCheckinActions from '../components/QuickCheckinActions';
import ScheduleMatchupCard from '../components/ScheduleMatchupCard';
import ScheduleTeamFilter from '../components/ScheduleTeamFilter';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import { addGameToCalendar } from '../lib/calendar';
import {
  buildScheduleRows,
  buildScheduleTeamOptions,
  filterScheduleGamesByTeam,
  resolveScheduleTeamSelection,
  type SchedulePresentationRow,
  type ScheduleTeamSelection,
} from '../lib/schedulePresentation';
import { getMyCheckinsForTeams, type CheckinStatus, updateCheckin } from '../lib/supabase/checkins';
import { supabase } from '../lib/supabase/client';
import type { GameRow, Season } from '../lib/supabase/data';
import { loadScheduleSnapshot } from '../lib/supabase/schedule';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import colors from '../theme/colors';

type Navigation = { navigate: (route: string, params: { gameId: string }) => void };
type LoadState = {
  ownerKey: string | null;
  status: 'loading' | 'no-season' | 'ready' | 'error';
  scopeKey: string | null;
  season: Season | null;
  timezone: string | null;
  games: GameRow[];
};
type CheckinState = { scopeKey: string | null; teamIds: string[]; values: Record<string, CheckinStatus> };

const emptyCheckins: CheckinState = { scopeKey: null, teamIds: [], values: {} };

function loadingState(ownerKey: string | null): LoadState {
  return { ownerKey, status: 'loading', scopeKey: null, season: null, timezone: null, games: [] };
}

function scheduleOwnerKey(leagueId: string, divisionId: string | null) {
  return `${leagueId}:${divisionId ?? 'all'}`;
}

function safeTeamName(game: GameRow, side: 'away' | 'home') {
  return game[`${side}_team`]?.name?.trim() || 'Team unavailable';
}

export default function ScheduleScreen({ navigation }: { navigation: Navigation }) {
  const {
    activeLeague,
    activeTheme,
    activeDivision,
    setActiveDivision,
    divisions,
    isGuestLeague,
  } = useLeague();
  const { reduceTransparency } = useAccessibilityPreferences();
  const leagueId = activeLeague?.id ?? null;
  const divisionId = activeDivision?.id ?? null;
  const ownerKey = leagueId ? scheduleOwnerKey(leagueId, divisionId) : null;
  const [state, setState] = React.useState<LoadState>(() => loadingState(ownerKey));
  const [selection, setSelection] = React.useState<ScheduleTeamSelection>({ scopeKey: '', teamId: null });
  const [checkinState, setCheckinState] = React.useState<CheckinState>(emptyCheckins);
  const [savingCheckinKey, setSavingCheckinKey] = React.useState<string | null>(null);
  const loadGeneration = React.useRef(0);
  const checkinGeneration = React.useRef(0);
  const activeScheduleScope = React.useRef<string | null>(null);
  const activeCheckinWrite = React.useRef<string | null>(null);

  const load = React.useCallback(async () => {
    if (!leagueId) return;
    const request = ++loadGeneration.current;
    const requestOwner = scheduleOwnerKey(leagueId, divisionId);
    setSelection({ scopeKey: `loading:${request}`, teamId: null });
    setState(loadingState(requestOwner));
    try {
      const snapshot = await loadScheduleSnapshot(leagueId, divisionId);
      if (request !== loadGeneration.current) return;
      if (snapshot.kind === 'no-season') {
        setState({ ownerKey: requestOwner, status: 'no-season', scopeKey: snapshot.scopeKey, season: null, timezone: null, games: [] });
        return;
      }
      setState({
        ownerKey: requestOwner,
        status: 'ready',
        scopeKey: snapshot.scopeKey,
        season: snapshot.season,
        timezone: snapshot.timezone,
        games: snapshot.games,
      });
    } catch {
      if (request === loadGeneration.current) {
        setState({ ownerKey: requestOwner, status: 'error', scopeKey: null, season: null, timezone: null, games: [] });
      }
    }
  }, [divisionId, leagueId]);

  React.useEffect(() => {
    if (!leagueId) {
      loadGeneration.current += 1;
      setState(loadingState(null));
      setSelection({ scopeKey: '', teamId: null });
      return;
    }
    void load();
    return () => { loadGeneration.current += 1; };
  }, [leagueId, load]);

  const visibleState = state.ownerKey === ownerKey ? state : loadingState(ownerKey);
  const readyScope = visibleState.status === 'ready' ? visibleState.scopeKey : null;

  React.useEffect(() => {
    activeScheduleScope.current = readyScope;
  }, [readyScope]);

  React.useEffect(() => {
    const request = ++checkinGeneration.current;
    if (!leagueId || isGuestLeague || visibleState.status !== 'ready' || !visibleState.season || !visibleState.scopeKey) {
      setCheckinState(emptyCheckins);
      setSavingCheckinKey(null);
      activeCheckinWrite.current = null;
      return;
    }
    const scopeKey = visibleState.scopeKey;
    const seasonId = visibleState.season.id;
    setCheckinState({ scopeKey, teamIds: [], values: {} });
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || request !== checkinGeneration.current || activeScheduleScope.current !== scopeKey) return;
      const { data, error } = await supabase
        .from('team_rosters')
        .select('team_id')
        .eq('player_id', user.id)
        .eq('league_id', leagueId)
        .eq('season_id', seasonId)
        .eq('status', 'active')
        .is('end_date', null);
      if (error || request !== checkinGeneration.current || activeScheduleScope.current !== scopeKey) return;
      const teamIds = [...new Set((data ?? []).map((row) => row.team_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
      const values = await getMyCheckinsForTeams(teamIds);
      if (request === checkinGeneration.current && activeScheduleScope.current === scopeKey) {
        setCheckinState({ scopeKey, teamIds, values });
      }
    })();
    return () => { checkinGeneration.current += 1; };
  }, [isGuestLeague, leagueId, readyScope, visibleState.scopeKey, visibleState.season, visibleState.status]);

  const teamOptions = React.useMemo(
    () => visibleState.status === 'ready' ? buildScheduleTeamOptions(visibleState.games) : [],
    [visibleState.games, visibleState.status],
  );
  const selectedTeamId = visibleState.status === 'ready' && visibleState.scopeKey
    ? resolveScheduleTeamSelection(selection, visibleState.scopeKey, teamOptions)
    : null;
  const selectedTeamName = selectedTeamId
    ? teamOptions.find((option) => option.id === selectedTeamId)?.name ?? 'Team unavailable'
    : null;
  const filteredGames = React.useMemo(
    () => visibleState.status === 'ready' ? filterScheduleGamesByTeam(visibleState.games, selectedTeamId) : [],
    [selectedTeamId, visibleState.games, visibleState.status],
  );
  const rows = React.useMemo(
    () => buildScheduleRows(filteredGames, visibleState.timezone ?? ''),
    [filteredGames, visibleState.timezone],
  );

  const handleCheckin = async (gameId: string, teamId: string, status: CheckinStatus, scopeKey: string) => {
    if (activeScheduleScope.current !== scopeKey || activeCheckinWrite.current) return;
    const operationKey = `${scopeKey}:${gameId}:${teamId}`;
    const operationGeneration = checkinGeneration.current;
    const previous = checkinState.scopeKey === scopeKey ? (checkinState.values[gameId] ?? null) : null;
    activeCheckinWrite.current = operationKey;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCheckinState((current) => current.scopeKey === scopeKey
      ? { ...current, values: { ...current.values, [gameId]: status } }
      : current);
    setSavingCheckinKey(operationKey);
    let success = false;
    try {
      success = (await updateCheckin(gameId, teamId, status)).success;
    } catch {
      success = false;
    } finally {
      if (operationGeneration === checkinGeneration.current && activeScheduleScope.current === scopeKey) {
        if (activeCheckinWrite.current === operationKey) activeCheckinWrite.current = null;
        setSavingCheckinKey((current) => current === operationKey ? null : current);
      }
    }
    if (operationGeneration !== checkinGeneration.current || activeScheduleScope.current !== scopeKey) return;
    if (!success) {
      setCheckinState((current) => {
        if (current.scopeKey !== scopeKey) return current;
        const values = { ...current.values };
        if (previous) values[gameId] = previous;
        else delete values[gameId];
        return { ...current, values };
      });
    }
  };

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}>
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Hockey Life access required</Text>
          <Text style={styles.stateBody}>Your account does not have an accessible Hockey Life membership.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const listHeader = visibleState.status === 'ready' ? (
    <View style={styles.listHeader}>
      <View>
        <Text style={styles.season}>{visibleState.season?.name ?? 'Current season'}</Text>
      </View>
      <ScheduleTeamFilter
        options={teamOptions}
        selectedTeamId={selectedTeamId}
        onSelect={(teamId) => {
          if (visibleState.scopeKey) setSelection({ scopeKey: visibleState.scopeKey, teamId });
        }}
      />
      {visibleState.games.length === 0 ? (
        <View style={styles.inlineState}>
          <Text style={styles.stateTitle}>No games scheduled for {visibleState.season?.name ?? 'this season'}.</Text>
        </View>
      ) : selectedTeamId && filteredGames.length === 0 ? (
        <View style={styles.inlineState}>
          <Text style={styles.stateTitle}>No games for {selectedTeamName ?? 'this team'} in this schedule.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear team filter"
            onPress={() => visibleState.scopeKey && setSelection({ scopeKey: visibleState.scopeKey, teamId: null })}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>Clear filter</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.count}>{filteredGames.length} {filteredGames.length === 1 ? 'game' : 'games'}</Text>
      )}
    </View>
  ) : null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}>
      <GuestBanner />
      <DivisionFilter
        divisions={divisions}
        activeDivision={activeDivision}
        primaryColor={activeTheme.primaryColor}
        onSelect={setActiveDivision}
      />
      {visibleState.status === 'loading' ? (
        <View accessibilityLiveRegion="polite" style={styles.stateWrap}>
          <ActivityIndicator color={activeTheme.primaryColor} />
          <Text style={styles.stateBody}>Loading schedule…</Text>
        </View>
      ) : visibleState.status === 'no-season' ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>No current season is available.</Text>
        </View>
      ) : visibleState.status === 'error' ? (
        <View accessibilityRole="alert" style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Couldn’t load schedule</Text>
          <Text style={styles.stateBody}>The schedule is temporarily unavailable.</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={[styles.retry, { backgroundColor: activeTheme.primaryColor }]}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FocusFlatList
          focusItems={false}
          focusScopeKey={`schedule:${visibleState.scopeKey}`}
          data={rows}
          keyExtractor={(item: SchedulePresentationRow) => item.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: SchedulePresentationRow }) => {
            if (item.type === 'date') {
              return <View style={styles.dateHeader}><Text accessibilityRole="header" style={styles.dateHeaderText}>{item.title}</Text></View>;
            }
            const game = item.game;
            const gameTeamId = checkinState.scopeKey === visibleState.scopeKey
              ? checkinState.teamIds.find((teamId) => teamId === game.home_team_id || teamId === game.away_team_id) ?? null
              : null;
            return (
              <FocusCard focusId={`schedule:game:${game.id}`}>
                <ScheduleMatchupCard
                  game={game}
                  timezone={visibleState.timezone}
                  leagueColor={activeTheme.primaryColor}
                  reduceTransparency={reduceTransparency}
                  onOpenGame={(gameId) => navigation.navigate('GamePreview', { gameId })}
                  onAddToCalendar={(scheduledGame) => void addGameToCalendar({
                    awayTeam: safeTeamName(scheduledGame, 'away'),
                    homeTeam: safeTeamName(scheduledGame, 'home'),
                    scheduledAt: scheduledGame.scheduled_at,
                    location: scheduledGame.location,
                  })}
                />
                {game.status === 'scheduled' && gameTeamId && visibleState.scopeKey && !isGuestLeague ? (
                  <View style={styles.quickCheckinWrap}>
                    <QuickCheckinActions
                      value={checkinState.values[game.id] ?? null}
                      onChange={(status) => void handleCheckin(game.id, gameTeamId, status, visibleState.scopeKey!)}
                      disabled={savingCheckinKey !== null}
                      compact
                    />
                  </View>
                ) : null}
              </FocusCard>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  listHeader: { minWidth: 0, gap: 12, paddingBottom: 10 },
  season: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2 },
  count: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  inlineState: { alignItems: 'center', gap: 10, paddingVertical: 22 },
  stateTitle: { color: colors.textPrimary, fontSize: 17, lineHeight: 23, fontWeight: '900', textAlign: 'center' },
  stateBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { minWidth: 120, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 16 },
  retryText: { color: '#07111F', fontSize: 14, fontWeight: '900' },
  clearButton: { minWidth: 120, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderCard },
  clearText: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  dateHeader: { paddingTop: 12, paddingBottom: 7, backgroundColor: 'transparent' },
  dateHeaderText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  quickCheckinWrap: { paddingHorizontal: 12, paddingBottom: 12 },
});
