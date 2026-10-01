import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';
import DivisionFilter from '../components/DivisionFilter';
import GuestBanner from '../components/GuestBanner';
import TeamLogo from '../components/TeamLogo';
import TeamPositioningChart from '../components/TeamPositioningChart';
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
import { getCurrentSeason, getSchedule, getStandings, type Season } from '../lib/supabase/data';
import { cutIceContentEdges } from '../navigation/cutIceSafeAreaPolicy';
import colors from '../theme/colors';

type Navigation = { navigate: (screen: string, params?: unknown) => void };
type LoadState = {
  loading: boolean;
  error: string | null;
  season: Season | null;
  standings: StandingsFact[];
  games: StandingsGameFact[];
  playoffs: PlayoffsPageResponse | null;
  teams: TeamsPageResponse | null;
};

const initialState: LoadState = { loading: true, error: null, season: null, standings: [], games: [], playoffs: null, teams: null };

function percent(value: number) {
  const amount = value * 100;
  if (amount <= 0) return '<1%';
  if (amount >= 100) return '100%';
  return amount >= 10 ? `${Math.round(amount)}%` : `${amount.toFixed(1)}%`;
}

export default function StandingsScreen({ navigation }: { navigation: Navigation }) {
  const { activeLeague, activeTheme, activeDivision, setActiveDivision, divisions } = useLeague();
  const [state, setState] = React.useState<LoadState>(initialState);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!activeLeague) return;
    const request = ++generation.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const season = await getCurrentSeason(activeLeague.id, { throwOnError: true });
      if (!season) {
        if (request === generation.current) setState({ ...initialState, loading: false, season: null });
        return;
      }
      const [standingsRows, games, playoffs, teams] = await Promise.all([
        getStandings(activeLeague.id, season.id),
        getSchedule(activeLeague.id, season.id),
        getLeaguePage(activeLeague.slug, 'playoffs', season.id).catch(() => null),
        getLeaguePage(activeLeague.slug, 'teams', season.id).catch(() => null),
      ]);
      if (request !== generation.current) return;
      setState({
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

  const scoped = rankStandings(activeDivision ? state.standings.filter((row) => row.divisionId === activeDivision.id) : state.standings);
  const config = state.playoffs?.previewConfig ?? { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null };
  const picture = buildPlayoffPicture(state.standings, config);
  const predictor = calculatePlayoffPredictor(state.standings, state.games, config);
  const completion = buildSeasonCompletion(state.games);
  const positioning = filterAndRerankPositioning(state.teams?.positioning ?? null, activeDivision?.id ?? null);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: activeTheme.backgroundColor }]} edges={cutIceContentEdges(['top', 'left', 'right'])}>
      <GuestBanner />
      <DivisionFilter divisions={divisions} activeDivision={activeDivision} primaryColor={activeTheme.primaryColor} onSelect={setActiveDivision} />
      {state.loading ? <View style={styles.center}><ActivityIndicator color={activeTheme.primaryColor} /></View> : state.error ? (
        <View accessibilityRole="alert" style={styles.center}><Text style={styles.stateTitle}>Couldn’t load standings</Text><Text style={styles.muted}>{state.error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={[styles.retry, { backgroundColor: activeTheme.primaryColor }]}><Text style={styles.retryText}>Retry</Text></Pressable></View>
      ) : (
        <FocusScrollView focusScopeKey={`standings:${activeLeague.id}`} contentContainerStyle={styles.content}>
          <View><Text accessibilityRole="header" style={styles.title}>Standings</Text>{state.season ? <Text style={styles.season}>{state.season.name} Season</Text> : null}</View>
          {scoped.length ? <FocusCard focusId={`standings:table:${activeLeague.id}`} style={styles.card}>
            <View style={styles.tableHeader}><Text style={[styles.headerText, styles.teamCol]}>Team</Text><Text style={styles.headerText}>GP</Text><Text style={styles.headerText}>W</Text><Text style={styles.headerText}>L</Text><Text style={styles.headerText}>PTS</Text></View>
            {scoped.map((row, index) => <Pressable key={row.teamId} accessibilityRole="button" accessibilityLabel={`${row.teamName}, ${row.points} points`} onPress={() => navigation.navigate('Team', { screen: 'TeamDetail', params: { teamId: row.teamId, leagueId: activeLeague.id } })} style={[styles.tableRow, index === 0 && styles.leader]}><View style={styles.teamCol}><TeamLogo teamId={row.teamId} logoUrl={row.logoUrl} teamName={row.teamName} primaryColor={row.primaryColor} size={30} /><Text style={styles.teamName}>{row.teamName}</Text></View><Text style={styles.cell}>{row.gamesPlayed}</Text><Text style={styles.cell}>{row.wins}</Text><Text style={styles.cell}>{row.losses}</Text><Text style={[styles.cell, styles.points]}>{row.points}</Text></Pressable>)}
          </FocusCard> : <Text style={styles.muted}>No standings available yet.</Text>}

          <View style={styles.section}><Text style={styles.sectionTitle}>Playoff Picture</Text>
            {picture.status === 'ready' ? picture.groups.map((group) => <View key={group.key} style={styles.pictureGroup}>{group.name ? <Text style={styles.groupTitle}>{group.name}</Text> : null}{group.matchups.map((matchup) => <View key={`${group.key}-${matchup.highSeed.teamId}`} style={styles.matchup}><View style={styles.seed}><Text style={styles.seedRank}>{matchup.highRank}</Text><TeamLogo teamId={matchup.highSeed.teamId} logoUrl={matchup.highSeed.logoUrl} teamName={matchup.highSeed.teamName} primaryColor={matchup.highSeed.primaryColor} size={42} /></View><Text style={styles.versus}>VS</Text>{matchup.lowSeed ? <View style={styles.seed}><Text style={styles.seedRank}>{matchup.lowRank}</Text><TeamLogo teamId={matchup.lowSeed.teamId} logoUrl={matchup.lowSeed.logoUrl} teamName={matchup.lowSeed.teamName} primaryColor={matchup.lowSeed.primaryColor} size={42} /></View> : <Text style={styles.muted}>BYE</Text>}</View>)}</View>) : <Text style={styles.muted}>{picture.reason}</Text>}
          </View>

          <View style={styles.section}><Text style={styles.sectionTitle}>Predictor</Text>
            {predictor.status === 'ready' ? predictor.teams.map((odds) => {
              const team = state.standings.find((row) => row.teamId === odds.teamId)!;
              return <View key={odds.teamId} style={styles.oddsRow}><TeamLogo teamId={team.teamId} logoUrl={team.logoUrl} teamName={team.teamName} primaryColor={team.primaryColor} size={38} /><Text style={styles.oddsTeam}>{team.teamName}</Text><View><Text style={styles.oddsValue}>{percent(odds.firstPlace)}</Text><Text style={styles.oddsLabel}>1st</Text></View><View><Text style={styles.oddsValue}>{percent(odds.makePlayoffs)}</Text><Text style={styles.oddsLabel}>Playoffs</Text></View></View>;
            }) : <Text style={styles.muted}>{predictor.reason}</Text>}
          </View>

          <View style={styles.section}><Text style={styles.sectionTitle}>Season Completion</Text>
            {completion.totalRegular ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: completion.percentage, text: completion.playoffMode ? 'Playoffs' : `${completion.percentage}%` }} style={styles.completion}><View style={[styles.completionFill, { width: `${completion.playoffMode ? 100 : completion.percentage}%`, backgroundColor: activeTheme.primaryColor }]} /><Text style={styles.completionText}>{completion.playoffMode ? 'PLAYOFFS' : `${completion.percentage}%`}</Text></View> : <Text style={styles.muted}>Season schedule data is unavailable.</Text>}
          </View>

          {positioning ? <View style={styles.section}><Text style={styles.sectionTitle}>Team Positioning</Text><TeamPositioningChart positioning={positioning} /></View> : null}
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
