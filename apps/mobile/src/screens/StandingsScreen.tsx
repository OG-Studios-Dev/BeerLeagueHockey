import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';
import DivisionFilter from '../components/DivisionFilter';
import GuestBanner from '../components/GuestBanner';
import SeasonCompletionHump from '../components/SeasonCompletionHump';
import StandingsPlayoffsPanel from '../components/StandingsPlayoffsPanel';
import TeamLogo from '../components/TeamLogo';
import TeamPositioningChart from '../components/TeamPositioningChart';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import { getLeaguePage, type PlayoffsPageResponse, type TeamsPageResponse } from '../lib/leaguePages';
import { filterAndRerankPositioning } from '../lib/leaguePagesModel';
import {
  buildPlayoffPicture,
  buildSeasonCompletion,
  calculatePlayoffPredictor,
  rankStandings,
  type StandingsFact,
  type StandingsGameFact,
} from '../lib/standingsModel';
import { getOperationalSeason, getSchedule, getStandings, type Season } from '../lib/supabase/data';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import colors from '../theme/colors';

type Navigation = { navigate: (screen: string, params?: unknown) => void };
type LoadState = {
  scopeKey: string | null;
  loading: boolean;
  error: string | null;
  season: Season | null;
  standings: StandingsFact[];
  games: StandingsGameFact[];
  playoffs: PlayoffsPageResponse | null;
  teams: TeamsPageResponse | null;
};

const initialState: LoadState = { scopeKey: null, loading: true, error: null, season: null, standings: [], games: [], playoffs: null, teams: null };

export function standingsScopeKey(leagueId: string, seasonId: string) {
  return `${leagueId}:${seasonId}`;
}

export default function StandingsScreen({ navigation }: { navigation: Navigation }) {
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions } = useLeague();
  const { reduceTransparency } = useAccessibilityPreferences();
  const [state, setState] = React.useState<LoadState>(initialState);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!activeLeague) return;
    const request = ++generation.current;
    setState({ ...initialState, loading: true });
    try {
      const season = await getOperationalSeason(activeLeague.id);
      if (!season) {
        if (request === generation.current) setState({ ...initialState, loading: false, season: null });
        return;
      }
      const [standingsRows, games, playoffs, teams] = await Promise.all([
        getStandings(activeLeague.id, season.id, { complete: true, throwOnError: true }),
        getSchedule(activeLeague.id, season.id, null, { complete: true, throwOnError: true }),
        getLeaguePage(activeLeague.slug, 'playoffs', season.id),
        getLeaguePage(activeLeague.slug, 'teams', season.id),
      ]);
      if (request !== generation.current) return;
      setState({
        scopeKey: standingsScopeKey(activeLeague.id, season.id),
        loading: false,
        error: null,
        season,
        standings: standingsRows.filter((row) => row.team_id).map((row) => ({
          teamId: row.team_id!, teamName: row.team_name ?? 'Team', logoUrl: row.logo_url ?? null,
          primaryColor: row.primary_color, divisionId: row.division_id ?? null, divisionName: row.division_name ?? null,
          wins: row.wins ?? 0, losses: row.losses ?? 0, ties: row.ties ?? 0, points: row.points ?? 0,
          goalsFor: row.goals_for ?? 0, goalsAgainst: row.goals_against ?? 0, gamesPlayed: row.games_played ?? 0,
        })),
        games: games.map((game) => ({ id: game.id, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, status: game.status, gameType: game.game_type ?? null })),
        playoffs,
        teams,
      });
    } catch (reason) {
      if (request === generation.current) setState({ ...initialState, loading: false, error: reason instanceof Error ? reason.message : 'Standings are temporarily unavailable.' });
    }
  }, [activeLeague]);

  React.useEffect(() => {
    if (!activeLeague) { generation.current += 1; setState(initialState); return; }
    void load();
    return () => { generation.current += 1; };
  }, [activeLeague, load]);

  if (!activeLeague) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}><View style={styles.center}><Text style={styles.stateTitle}>Hockey Life access required</Text></View></SafeAreaView>;
  }

  const stateMatchesLeague = state.scopeKey === null || state.scopeKey.startsWith(`${activeLeague.id}:`);
  const visibleState = stateMatchesLeague ? state : initialState;

  const scoped = rankStandings(activeDivision ? visibleState.standings.filter((row) => row.divisionId === activeDivision.id) : visibleState.standings);
  const config = visibleState.playoffs?.previewConfig ?? { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null };
  const picture = buildPlayoffPicture(rankStandings(visibleState.standings), config);
  const predictor = calculatePlayoffPredictor(visibleState.standings, visibleState.games, config);
  const completion = buildSeasonCompletion(visibleState.games);
  const positioning = filterAndRerankPositioning(visibleState.teams?.positioning ?? null, activeDivision?.id ?? null);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}>
      <GuestBanner />
      <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />
      {visibleState.loading ? <View style={styles.center}><ActivityIndicator color={activeTheme.primaryColor} /></View> : visibleState.error ? (
        <View accessibilityRole="alert" style={styles.center}><Text style={styles.stateTitle}>Couldn’t load standings</Text><Text style={styles.muted}>{visibleState.error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={[styles.retry, { backgroundColor: activeTheme.primaryColor }]}><Text style={styles.retryText}>Retry</Text></Pressable></View>
      ) : (
        <FocusScrollView focusScopeKey={`standings:${activeLeague.id}`} contentContainerStyle={styles.content}>
          <View testID={`standings-scope:${visibleState.scopeKey ?? 'loading'}`}><Text accessibilityRole="header" style={styles.title}>Standings</Text>{visibleState.season ? <Text style={styles.season}>{visibleState.season.name} Season</Text> : null}</View>
          {scoped.length ? <FocusCard focusId={`standings:table:${activeLeague.id}`} style={styles.card}>
            <View style={styles.tableHeader}><Text style={[styles.headerText, styles.teamCol]}>Team</Text><Text style={styles.headerText}>GP</Text><Text style={styles.headerText}>W</Text><Text style={styles.headerText}>L</Text><Text style={styles.headerText}>PTS</Text></View>
            {scoped.map((row, index) => <Pressable key={row.teamId} accessibilityRole="button" accessibilityLabel={`${row.teamName}, ${row.points} points`} onPress={() => navigation.navigate('Team', { screen: 'TeamDetail', params: { teamId: row.teamId, leagueId: activeLeague.id } })} style={[styles.tableRow, index === 0 && styles.leader]}><View style={styles.teamCol}><TeamLogo teamId={row.teamId} logoUrl={row.logoUrl} teamName={row.teamName} primaryColor={row.primaryColor} size={30} /><Text style={styles.teamName}>{row.teamName}</Text></View><Text style={styles.cell}>{row.gamesPlayed}</Text><Text style={styles.cell}>{row.wins}</Text><Text style={styles.cell}>{row.losses}</Text><Text style={[styles.cell, styles.points]}>{row.points}</Text></Pressable>)}
          </FocusCard> : <Text style={styles.muted}>No standings available yet.</Text>}

          {positioning ? <View style={styles.section}><Text style={styles.sectionTitle}>Team Positioning</Text><TeamPositioningChart positioning={positioning} /></View> : null}

          <StandingsPlayoffsPanel picture={picture} predictor={predictor} standings={visibleState.standings} accentColor={activeTheme.primaryColor} />

          <View style={styles.section}><Text style={styles.sectionTitle}>Season Completion</Text>
            <SeasonCompletionHump percentage={completion.percentage} playoffMode={completion.playoffMode} accentColor={activeTheme.primaryColor} reduceTransparency={reduceTransparency} />
          </View>

        </FocusScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 36, gap: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  title: { color: colors.textPrimary, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  season: { color: colors.textSecondary, marginTop: 4 },
  stateTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  retryText: { color: '#07111F', fontWeight: '900' },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.borderCard, backgroundColor: colors.bgSurface, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: colors.bgInteractive },
  tableRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderCard },
  leader: { backgroundColor: 'rgba(143,122,75,0.12)' },
  teamCol: { flex: 3, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 0.8, color: colors.textSecondary, fontSize: 10, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  teamName: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  cell: { flex: 0.8, color: colors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  points: { fontWeight: '900' },
  section: { gap: 12 },
  sectionTitle: { color: colors.textPrimary, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  pictureGroup: { gap: 10 },
  groupTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  matchup: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: 18, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, padding: 10 },
  seed: { minWidth: 82, flexDirection: 'row', alignItems: 'center', gap: 8 },
  seedRank: { color: colors.textSecondary, fontWeight: '900' },
  versus: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  oddsRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderCard },
  oddsTeam: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  oddsValue: { minWidth: 58, color: colors.textPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  oddsLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', textAlign: 'center', textTransform: 'uppercase' },
  completion: { height: 132, borderTopLeftRadius: 160, borderTopRightRadius: 160, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgInteractive },
  completionFill: { position: 'absolute', top: 0, bottom: 0, left: 0, opacity: 0.25 },
  completionText: { color: colors.textPrimary, fontSize: 27, fontWeight: '900' },
});
