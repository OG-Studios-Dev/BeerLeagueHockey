import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DivisionFilter from '../components/DivisionFilter';
import GuestBanner from '../components/GuestBanner';
import GameCard from '../components/GameCard';
import PillToggle from '../components/PillToggle';
import QuickCheckinActions from '../components/QuickCheckinActions';
import ScheduleConflictList from '../components/ScheduleConflictList';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { useLeague } from '../context/LeagueContext';
import { getScheduleConflicts } from '../lib/scheduleConflicts';
import { getMyCheckins, getMyCheckinsForTeams, type CheckinStatus, updateCheckin } from '../lib/supabase/checkins';
import {
  getCurrentSeason,
  getSchedule,
  getStandings,
  mapGameStatus,
  type GameRow,
  type Season,
  type StandingRow,
} from '../lib/supabase/data';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';
import * as Haptics from 'expo-haptics';

type ScheduleTab = 'Upcoming' | 'Scores' | 'Standings';

type UpcomingRow =
  | { type: 'header'; id: string; title: string }
  | { type: 'game'; id: string; game: GameRow };

type GlobalUpcomingGame = GameRow & {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  myTeamId: string;
  myTeamName: string;
};

const scheduleTabs: readonly ScheduleTab[] = ['Upcoming', 'Scores', 'Standings'];

function formatDateHeading(dateISO: string): string {
  const date = new Date(dateISO);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function buildUpcomingRows(games: GameRow[]): { rows: UpcomingRow[]; stickyHeaderIndices: number[] } {
  const upcomingGames = games
    .filter((g) => mapGameStatus(g.status) === 'Upcoming')
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const rows: UpcomingRow[] = [];
  const stickyHeaderIndices: number[] = [];
  let currentHeading = '';

  upcomingGames.forEach((game) => {
    const heading = formatDateHeading(game.scheduled_at);
    if (heading !== currentHeading) {
      currentHeading = heading;
      stickyHeaderIndices.push(rows.length);
      rows.push({ type: 'header', id: `header-${heading}`, title: heading });
    }
    rows.push({ type: 'game', id: game.id, game });
  });

  return { rows, stickyHeaderIndices };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ScheduleScreen({
  navigation,
  initialTab = 'Upcoming',
  standalone = false,
}: {
  navigation: any;
  initialTab?: ScheduleTab;
  standalone?: boolean;
}) {
  const {
    activeLeague,
    activeTheme,
    activeDivision,
    setActiveDivision,
    divisions,
    isGuestLeague,
    availableLeagues,
    setActiveLeague,
  } = useLeague();
  const [selectedTab, setSelectedTab] = React.useState<ScheduleTab>(initialTab);
  const [season, setSeason] = React.useState<Season | null>(null);
  const [games, setGames] = React.useState<GameRow[]>([]);
  const [standings, setStandings] = React.useState<StandingRow[]>([]);
  const [loadingGames, setLoadingGames] = React.useState(false);
  const [loadingStandings, setLoadingStandings] = React.useState(false);
  const [userTeamId, setUserTeamId] = React.useState<string | null>(null);
  const [checkins, setCheckins] = React.useState<Record<string, CheckinStatus>>({});
  const [globalGames, setGlobalGames] = React.useState<GlobalUpcomingGame[]>([]);
  const [globalLoading, setGlobalLoading] = React.useState(false);
  const [globalCheckins, setGlobalCheckins] = React.useState<Record<string, CheckinStatus>>({});
  const [savingGameId, setSavingGameId] = React.useState<string | null>(null);
  const [savingGlobalGameId, setSavingGlobalGameId] = React.useState<string | null>(null);

  // Load user's team once per league
  React.useEffect(() => {
    if (!activeLeague) { setUserTeamId(null); return; }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('team_rosters')
        .select('team_id')
        .eq('player_id', user.id)
        .eq('league_id', activeLeague.id)
        .eq('status', 'active')
        .maybeSingle()
        .then(({ data }) => setUserTeamId(data?.team_id ?? null));
    });
  }, [activeLeague?.id]);

  // Load checkins when team or games change
  React.useEffect(() => {
    if (!userTeamId) { setCheckins({}); return; }
    getMyCheckins(userTeamId).then(setCheckins);
  }, [userTeamId, games.length]);

  React.useEffect(() => {
    if (activeLeague || availableLeagues.length === 0) {
      setGlobalGames([]);
      setGlobalCheckins({});
      return;
    }

    setGlobalLoading(true);

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setGlobalGames([]);
        setGlobalCheckins({});
        setGlobalLoading(false);
        return;
      }

      const { data: rosterRows } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id,
          team:teams!team_rosters_team_id_fkey(id, name),
          league:leagues!team_rosters_league_id_fkey(id, name, slug)
        `)
        .eq('player_id', user.id)
        .eq('status', 'active');

      const teamSlots = ((rosterRows as any[]) ?? [])
        .map((row) => {
          const team = Array.isArray(row.team) ? row.team[0] : row.team;
          const league = Array.isArray(row.league) ? row.league[0] : row.league;
          if (!team || !league) return null;

          return {
            leagueId: row.league_id,
            leagueName: league.name,
            leagueSlug: league.slug,
            teamId: row.team_id,
            teamName: team.name,
          };
        })
        .filter(Boolean) as Array<{
          leagueId: string;
          leagueName: string;
          leagueSlug: string;
          teamId: string;
          teamName: string;
        }>;

      if (teamSlots.length === 0) {
        setGlobalGames([]);
        setGlobalCheckins({});
        setGlobalLoading(false);
        return;
      }

      const teamMap = new Map(teamSlots.map((slot) => [slot.teamId, slot]));
      const leagueIds = [...new Set(teamSlots.map((slot) => slot.leagueId))];
      const teamIds = teamSlots.map((slot) => slot.teamId);

      const [gamesResponse, myCheckins] = await Promise.all([
        supabase
          .from('games')
          .select(
            `id, league_id, home_team_id, away_team_id, home_score, away_score,
             scheduled_at, status, location, season_id, division_id,
             home_team:teams!games_home_team_id_fkey(id, name, primary_color, logo_url),
             away_team:teams!games_away_team_id_fkey(id, name, primary_color, logo_url)`,
          )
          .in('league_id', leagueIds)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(40),
        getMyCheckinsForTeams(teamIds),
      ]);
      const gamesData = gamesResponse.data;

      const normalizedGames = ((gamesData as any[]) ?? []).map((game) => ({
        ...game,
        home_team: Array.isArray(game.home_team) ? game.home_team[0] ?? null : game.home_team ?? null,
        away_team: Array.isArray(game.away_team) ? game.away_team[0] ?? null : game.away_team ?? null,
      })) as GameRow[];

      const upcoming = normalizedGames
        .map((game) => {
          const teamSlot = teamMap.get(game.home_team_id) ?? teamMap.get(game.away_team_id);
          if (!teamSlot) return null;

          return {
            ...game,
            leagueId: teamSlot.leagueId,
            leagueName: teamSlot.leagueName,
            leagueSlug: teamSlot.leagueSlug,
            myTeamId: teamSlot.teamId,
            myTeamName: teamSlot.teamName,
          };
        })
        .filter(Boolean) as GlobalUpcomingGame[];

      setGlobalGames(upcoming);
      setGlobalCheckins(myCheckins);
      setGlobalLoading(false);
    });
  }, [activeLeague, availableLeagues.length]);

  const handleLeagueScheduleCheckin = async (gameId: string, status: CheckinStatus) => {
    if (!userTeamId || savingGameId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const previous = checkins[gameId] ?? null;
    setCheckins((current) => ({ ...current, [gameId]: status }));
    setSavingGameId(gameId);

    const result = await updateCheckin(gameId, userTeamId, status);
    setSavingGameId(null);

    if (!result.success) {
      setCheckins((current) => {
        const next = { ...current };
        if (previous) {
          next[gameId] = previous;
        } else {
          delete next[gameId];
        }
        return next;
      });
    }
  };

  const handleGlobalScheduleCheckin = async (game: GlobalUpcomingGame, status: CheckinStatus) => {
    if (savingGlobalGameId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const previous = globalCheckins[game.id] ?? null;
    setGlobalCheckins((current) => ({ ...current, [game.id]: status }));
    setSavingGlobalGameId(game.id);

    const result = await updateCheckin(game.id, game.myTeamId, status);
    setSavingGlobalGameId(null);

    if (!result.success) {
      setGlobalCheckins((current) => {
        const next = { ...current };
        if (previous) {
          next[game.id] = previous;
        } else {
          delete next[game.id];
        }
        return next;
      });
    }
  };

  // Load season once per league
  React.useEffect(() => {
    if (!activeLeague) {
      setSeason(null);
      setGames([]);
      setStandings([]);
      return;
    }
    getCurrentSeason(activeLeague.id).then(setSeason);
  }, [activeLeague?.id]);

  // Load games when league, season, or division changes
  React.useEffect(() => {
    if (!activeLeague) return;
    setLoadingGames(true);
    getSchedule(activeLeague.id, season?.id ?? null, activeDivision?.id ?? null)
      .then(setGames)
      .finally(() => setLoadingGames(false));
  }, [activeLeague?.id, season?.id, activeDivision?.id]);

  // Load standings when on Standings tab
  React.useEffect(() => {
    if (!activeLeague || selectedTab !== 'Standings') return;
    setLoadingStandings(true);
    getStandings(activeLeague.id, season?.id)
      .then((rows) => {
        if (activeDivision) {
          setStandings(rows.filter((r) => r.division_id === activeDivision.id));
        } else {
          setStandings(rows);
        }
      })
      .finally(() => setLoadingStandings(false));
  }, [activeLeague?.id, season?.id, selectedTab, activeDivision?.id]);

  const { rows: upcomingRows, stickyHeaderIndices } = React.useMemo(
    () => buildUpcomingRows(games),
    [games],
  );

  const finalGames = React.useMemo(
    () =>
      games
        .filter((g) => mapGameStatus(g.status) === 'Final')
        .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()),
    [games],
  );

  const globalScheduleConflicts = React.useMemo(
    () =>
      getScheduleConflicts(
        globalGames.map((game) => ({
          id: game.id,
          scheduled_at: game.scheduled_at,
          leagueId: game.leagueId,
          leagueName: game.leagueName,
          teamName: game.myTeamName,
          location: game.location ?? null,
        })),
      ),
    [globalGames],
  );

  const openGlobalGame = React.useCallback(
    (game: { id: string; leagueId?: string }) => {
      if (game.leagueId) {
        const nextLeague = availableLeagues.find((league) => league.id === game.leagueId);
        if (nextLeague) {
          void setActiveLeague(nextLeague);
        }
      }

      navigation.navigate('GamePreview', { gameId: game.id });
    },
    [availableLeagues, navigation, setActiveLeague],
  );

  if (!activeLeague && availableLeagues.length === 0) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Select a league to see the schedule</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeLeague) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]} edges={['top', 'left', 'right']}>
        <View style={styles.screenPadding}>
          <Text style={styles.globalScheduleIntro}>
            Upcoming games across every BLH league you play in. Switch into a league when you want standings or league-only views.
          </Text>
        </View>

        {globalLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : globalGames.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No upcoming games across your leagues</Text>
          </View>
                ) : (
                  <FlatList
            data={globalGames}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              globalScheduleConflicts.length > 0 ? (
                <View style={styles.globalListHeader}>
                  <SectionHeader title="Conflict Watch" />
                  <ScheduleConflictList conflicts={globalScheduleConflicts} onOpenGame={openGlobalGame} />
                  <SectionHeader title="Upcoming Across Leagues" />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View>
                <View style={styles.globalLeagueRow}>
                  <Text style={styles.globalLeagueLabel}>{item.leagueName}</Text>
                  <Text style={styles.globalLeagueMeta}>{item.myTeamName}</Text>
                </View>
                <GameCard
                  gameId={item.id}
                  homeTeam={item.home_team?.name ?? item.home_team_id}
                  awayTeam={item.away_team?.name ?? item.away_team_id}
                  dateLabel={formatDate(item.scheduled_at)}
                  timeLabel={formatTime(item.scheduled_at)}
                  rinkName={item.location ?? ''}
                  status={mapGameStatus(item.status)}
                  homeScore={item.home_score ?? undefined}
                  awayScore={item.away_score ?? undefined}
                  scheduledAt={item.scheduled_at}
                  location={item.location}
                  onPress={() => openGlobalGame(item)}
                />
                {!isGuestLeague ? (
                  <View style={styles.globalCheckinWrap}>
                    <QuickCheckinActions
                      value={globalCheckins[item.id] ?? null}
                      onChange={(status) => void handleGlobalScheduleCheckin(item, status)}
                      disabled={savingGlobalGameId === item.id}
                      compact
                    />
                  </View>
                ) : null}
              </View>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
      <GuestBanner />
      <DivisionFilter
        divisions={divisions}
        activeDivision={activeDivision}
        primaryColor={activeTheme.primaryColor}
        onSelect={setActiveDivision}
      />

      {!standalone ? (
        <View style={styles.screenPadding}>
          <PillToggle options={scheduleTabs} selected={selectedTab} onChange={setSelectedTab} />
        </View>
      ) : null}

      {selectedTab === 'Upcoming' ? (
        loadingGames ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={activeTheme.primaryColor} />
          </View>
        ) : upcomingRows.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No upcoming games yet</Text>
          </View>
        ) : (
          <FlatList
            data={upcomingRows}
            keyExtractor={(item) => item.id}
            stickyHeaderIndices={stickyHeaderIndices}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                return (
                  <View style={[styles.stickyHeaderWrap, { backgroundColor: activeTheme.backgroundColor }]}>
                    <Text style={styles.stickyHeaderText}>{item.title}</Text>
                  </View>
                );
              }
              const { game } = item as { type: 'game'; id: string; game: GameRow };
              const isUserGame = userTeamId &&
                (game.home_team_id === userTeamId || game.away_team_id === userTeamId);
              const myCheckin = isUserGame ? (checkins[game.id] ?? null) : null;

              return (
                <View>
                  <GameCard
                    gameId={game.id}
                    homeTeam={game.home_team?.name ?? game.home_team_id}
                    awayTeam={game.away_team?.name ?? game.away_team_id}
                    dateLabel={formatDate(game.scheduled_at)}
                    timeLabel={formatTime(game.scheduled_at)}
                    rinkName={game.location ?? ''}
                    status={mapGameStatus(game.status)}
                    homeScore={game.home_score ?? undefined}
                    awayScore={game.away_score ?? undefined}
                    scheduledAt={game.scheduled_at}
                    location={game.location}
                    onPress={() => navigation.navigate('GamePreview', { gameId: game.id })}
                  />
                  {isUserGame && !isGuestLeague && (
                    <View style={styles.quickCheckinWrap}>
                      <QuickCheckinActions
                        value={myCheckin}
                        onChange={(status) => void handleLeagueScheduleCheckin(game.id, status)}
                        disabled={savingGameId === game.id}
                        compact
                      />
                    </View>
                  )}
                </View>
              );
            }}
          />
        )
      ) : null}

      {selectedTab === 'Scores' ? (
        loadingGames ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={activeTheme.primaryColor} />
          </View>
        ) : finalGames.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No scores yet</Text>
          </View>
        ) : (
          <FlatList
            data={finalGames}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <GameCard
                gameId={item.id}
                homeTeam={item.home_team?.name ?? item.home_team_id}
                awayTeam={item.away_team?.name ?? item.away_team_id}
                dateLabel={formatDate(item.scheduled_at)}
                timeLabel={formatTime(item.scheduled_at)}
                rinkName={item.location ?? ''}
                status={mapGameStatus(item.status)}
                homeScore={item.home_score ?? undefined}
                awayScore={item.away_score ?? undefined}
                onPress={() => navigation.navigate('GamePreview', { gameId: item.id })}
              />
            )}
          />
        )
      ) : null}

      {selectedTab === 'Standings' ? (
        loadingStandings ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={activeTheme.primaryColor} />
          </View>
        ) : standings.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No standings yet</Text>
          </View>
        ) : (
          <View style={styles.listContent}>
            <View style={[styles.standingsCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
              <View style={styles.tableHeader}>
                <Text style={[styles.headerText, styles.teamHeaderText]}>Team</Text>
                <Text style={styles.headerText}>GP</Text>
                <Text style={styles.headerText}>W</Text>
                <Text style={styles.headerText}>L</Text>
                <Text style={styles.headerText}>PTS</Text>
              </View>
              {standings.map((row, index) => {
                const isLeader = index === 0;
                const color = row.primary_color ?? activeTheme.primaryColor;
                return (
                  <Pressable
                    key={row.team_id ?? index}
                    style={({ pressed }) => [styles.tableRow, isLeader ? styles.leaderRow : undefined, pressed && row.team_id ? styles.tableRowPressed : undefined]}
                    onPress={() => row.team_id ? navigation.navigate('Team', { screen: 'TeamDetail', params: { teamId: row.team_id, leagueId: activeLeague.id } }) : undefined}
                    disabled={!row.team_id}
                  >
                    <View style={styles.teamCol}>
                      <TeamLogo
                        teamId={row.team_id}
                        logoUrl={row.logo_url ?? null}
                        teamName={row.team_name ?? row.short_name ?? 'Team'}
                        primaryColor={color}
                        size={28}
                      />
                      <Text style={[styles.teamName, isLeader ? styles.leaderText : undefined]} numberOfLines={1}>
                        {row.team_name ?? '—'}
                      </Text>
                    </View>
                    <Text style={[styles.rowText, isLeader ? styles.leaderText : undefined]}>{row.games_played ?? 0}</Text>
                    <Text style={[styles.rowText, isLeader ? styles.leaderText : undefined]}>{row.wins ?? 0}</Text>
                    <Text style={[styles.rowText, isLeader ? styles.leaderText : undefined]}>{row.losses ?? 0}</Text>
                    <Text style={[styles.rowText, styles.ptsText, isLeader ? styles.ptsLeaderText : undefined]}>
                      {row.points ?? 0}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenPadding: { paddingHorizontal: 16, paddingBottom: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  globalScheduleIntro: {
    marginTop: -2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  globalListHeader: {
    paddingBottom: 6,
  },
  globalLeagueRow: {
    paddingHorizontal: 2,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalLeagueLabel: { fontSize: 12, fontWeight: '800', color: colors.primary },
  globalLeagueMeta: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  globalCheckinWrap: { paddingHorizontal: 14, paddingBottom: 10 },
  quickCheckinWrap: { paddingHorizontal: 14, paddingBottom: 10 },
  stickyHeaderWrap: { paddingTop: 10, paddingBottom: 6 },
  stickyHeaderText: {
    fontSize: 14, fontWeight: '800', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  standingsCard: { marginTop: 12, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  tableHeader: {
    flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.bgInteractive, alignItems: 'center',
  },
  headerText: { flex: 0.8, fontSize: 11, fontWeight: '800', color: colors.textSecondary, textAlign: 'center' },
  teamHeaderText: { flex: 2.8, textAlign: 'left' },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: colors.borderCard,
  },
  tableRowPressed: {
    backgroundColor: colors.bgInteractive,
  },
  leaderRow: { backgroundColor: 'rgba(34, 211, 238, 0.08)' },
  teamCol: { flex: 2.8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  rowText: { flex: 0.8, fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  ptsText: { fontWeight: '800', color: colors.textPrimary },
  ptsLeaderText: { color: colors.primary, fontWeight: '900' },
  leaderText: { fontWeight: '900', color: colors.textPrimary },
});
