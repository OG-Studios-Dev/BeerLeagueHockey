import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import blhLogo from '../../assets/blh-logo.png';
import GameCard from '../components/GameCard';
import GuestBanner from '../components/GuestBanner';
import LeagueMarketplace from '../components/LeagueMarketplace';
import QuickCheckinActions from '../components/QuickCheckinActions';
import RevealView from '../components/RevealView';
import ScheduleConflictList from '../components/ScheduleConflictList';
import TeamLogo from '../components/TeamLogo';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useLeague } from '../context/LeagueContext';
import { getScheduleConflicts } from '../lib/scheduleConflicts';
import {
  CheckinStatus,
  getGameCheckinSummary,
  getMyCheckins,
  getMyCheckinsForTeams,
  updateCheckin,
} from '../lib/supabase/checkins';
import { supabase } from '../lib/supabase/client';
import { getLeagueGames, mapGameStatus, type GameRow } from '../lib/supabase/data';
import colors from '../theme/colors';
import { getHomeVisualPreferences, HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';
import { ui } from '../theme/ui';

type HomeScreenProps = {
  navigation?: any;
};

type UserTeam = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

type NextGame = {
  id: string;
  league_id?: string;
  scheduled_at: string;
  location: string | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { id: string; name: string; logo_url: string | null; primary_color: string | null } | null;
  away_team: { id: string; name: string; logo_url: string | null; primary_color: string | null } | null;
};

type CheckinSummary = { confirmed: number; tentative: number; out: number };

type GlobalRosterSlot = {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  leagueCity: string | null;
  leagueLogoUrl: string | null;
  leaguePrimaryColor: string | null;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  jerseyNumber: number | null;
  position: string | null;
};

type GlobalUpcomingGame = NextGame & {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  teamId: string;
  teamName: string;
  isHomeTeam: boolean;
};

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const date = d.getDate();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} ${month} ${date} · ${time}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Syncing...';
  return `Updated ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function getNextGameAccessibilityLabel(
  game: NextGame,
  summary: CheckinSummary,
  isGuestLeague: boolean,
) {
  const awayTeam = game.away_team?.name ?? game.away_team_id;
  const homeTeam = game.home_team?.name ?? game.home_team_id;
  const availability = isGuestLeague
    ? 'Join this league to check in'
    : `${summary.confirmed} In · ${summary.tentative} Maybe · ${summary.out} Out`;

  return [
    `Next game, ${awayTeam} at ${homeTeam}`,
    formatGameDate(game.scheduled_at),
    game.location,
    availability,
  ].filter(Boolean).join('. ');
}

function openLeagueSite(slug: string) {
  Linking.openURL(`https://${slug}.beerleaguehockey.ca`).catch(() => {});
}

function HomeArenaBackdrop({
  accentColor,
  showAtmosphericGlow,
}: {
  accentColor: string;
  showAtmosphericGlow: boolean;
}) {
  return (
    <View testID="home-arena-backdrop" pointerEvents="none" style={styles.arenaBackdrop}>
      <LinearGradient
        colors={[homeTokens.canvas, homeTokens.navy, homeTokens.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {showAtmosphericGlow ? (
        <LinearGradient
          testID="home-atmospheric-glow"
          colors={[`${accentColor}24`, 'rgba(255, 255, 255, 0.03)', 'transparent']}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 0.9, y: 0.62 }}
          style={styles.arenaGlow}
        />
      ) : null}
      <View testID="home-rink-lines" style={styles.arenaRink}>
        <View style={styles.arenaCenterLine} />
        <View style={styles.arenaCenterCircle} />
        <View style={[styles.arenaFaceoffCircle, styles.arenaFaceoffTop]} />
        <View style={[styles.arenaFaceoffCircle, styles.arenaFaceoffBottom]} />
      </View>
    </View>
  );
}

function HomeSectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const { activeLeague, setActiveLeague, activeTheme, availableLeagues, isGuestLeague } = useLeague();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const homeVisuals = getHomeVisualPreferences(reduceTransparency, reduceMotion);
  const { width } = useWindowDimensions();
  const isCompact = width < homeTokens.compactBreakpoint;

  const [games, setGames] = React.useState<GameRow[]>([]);
  const [userTeam, setUserTeam] = React.useState<UserTeam | null>(null);
  const [nextGame, setNextGame] = React.useState<NextGame | null>(null);
  const [loadingLeague, setLoadingLeague] = React.useState(false);
  const [globalRosterSlots, setGlobalRosterSlots] = React.useState<GlobalRosterSlot[]>([]);
  const [globalUpcomingGames, setGlobalUpcomingGames] = React.useState<GlobalUpcomingGame[]>([]);
  const [loadingGlobal, setLoadingGlobal] = React.useState(false);
  const [globalCheckins, setGlobalCheckins] = React.useState<Record<string, CheckinStatus>>({});
  const [savingGlobalGameId, setSavingGlobalGameId] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<string | null>(null);

  const [myCheckinStatus, setMyCheckinStatus] = React.useState<CheckinStatus | null>(null);
  const [checkinSummary, setCheckinSummary] = React.useState<CheckinSummary>({
    confirmed: 0,
    tentative: 0,
    out: 0,
  });
  const [checkinLoading, setCheckinLoading] = React.useState(false);

  const loadLeagueHome = React.useCallback(async () => {
    if (!activeLeague) return;

    setLoadingLeague(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: rosterRow } = await supabase
        .from('team_rosters')
        .select(
          'team_id, jersey_number, position, team:teams(id, name, logo_url, primary_color, secondary_color)',
        )
        .eq('player_id', user.id)
        .eq('league_id', activeLeague.id)
        .maybeSingle();

      const team = (rosterRow?.team as unknown as UserTeam | null) ?? null;
      setUserTeam(team);
      const userTeamId = team?.id;

      let scheduledGame: NextGame | null = null;

      if (userTeamId) {
        const { data } = await supabase
          .from('games')
          .select(`
            id, scheduled_at, location, status, league_id,
            home_team_id, away_team_id,
            home_team:teams!home_team_id(id, name, logo_url, primary_color),
            away_team:teams!away_team_id(id, name, logo_url, primary_color)
          `)
          .eq('league_id', activeLeague.id)
          .or(`home_team_id.eq.${userTeamId},away_team_id.eq.${userTeamId}`)
          .eq('status', 'scheduled')
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        scheduledGame = data as NextGame | null;
        setNextGame(scheduledGame);

        if (scheduledGame) {
          const [checkins, summary] = await Promise.all([
            getMyCheckins(userTeamId),
            getGameCheckinSummary(scheduledGame.id, userTeamId),
          ]);
          setMyCheckinStatus(checkins[scheduledGame.id] ?? null);
          setCheckinSummary({
            confirmed: summary.confirmed.length,
            tentative: summary.tentative.length,
            out: summary.out.length,
          });
        } else {
          setMyCheckinStatus(null);
          setCheckinSummary({ confirmed: 0, tentative: 0, out: 0 });
        }
      } else {
        setNextGame(null);
        setMyCheckinStatus(null);
        setCheckinSummary({ confirmed: 0, tentative: 0, out: 0 });
      }

      const leagueGames = await getLeagueGames(activeLeague.id);
      setGames(leagueGames);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoadingLeague(false);
    }
  }, [activeLeague]);

  const loadGlobalHome = React.useCallback(async () => {
    setLoadingGlobal(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: rosterRows } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id, jersey_number, position,
          team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color, secondary_color),
          league:leagues!team_rosters_league_id_fkey(id, name, slug, city, logo_url, primary_color)
        `)
        .eq('player_id', user.id)
        .eq('status', 'active');

      const slots: GlobalRosterSlot[] = ((rosterRows as any[]) ?? [])
        .map((row) => {
          const team = Array.isArray(row.team) ? row.team[0] : row.team;
          const league = Array.isArray(row.league) ? row.league[0] : row.league;

          if (!team || !league) return null;

          return {
            leagueId: row.league_id,
            leagueName: league.name,
            leagueSlug: league.slug,
            leagueCity: league.city ?? null,
            leagueLogoUrl: league.logo_url ?? null,
            leaguePrimaryColor: league.primary_color ?? null,
            teamId: row.team_id,
            teamName: team.name,
            teamLogoUrl: team.logo_url ?? null,
            teamPrimaryColor: team.primary_color ?? null,
            jerseyNumber: row.jersey_number ?? null,
            position: row.position ?? null,
          };
        })
        .filter(Boolean) as GlobalRosterSlot[];

      setGlobalRosterSlots(slots);

      if (slots.length === 0) {
        setGlobalUpcomingGames([]);
        setGlobalCheckins({});
        setLastUpdatedAt(new Date().toISOString());
        return;
      }

      const leagueIds = [...new Set(slots.map((slot) => slot.leagueId))];
      const teamIds = slots.map((slot) => slot.teamId);
      const teamMap = new Map(slots.map((slot) => [slot.teamId, slot]));

      const [{ data: gameRows }, myCheckins] = await Promise.all([
        supabase
          .from('games')
          .select(`
            id, league_id, scheduled_at, location, status,
            home_team_id, away_team_id,
            home_team:teams!games_home_team_id_fkey(id, name, logo_url, primary_color),
            away_team:teams!games_away_team_id_fkey(id, name, logo_url, primary_color)
          `)
          .in('league_id', leagueIds)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(30),
        getMyCheckinsForTeams(teamIds),
      ]);

      const normalizedGames = ((gameRows as any[]) ?? []).map((game) => ({
        ...game,
        home_team: Array.isArray(game.home_team) ? game.home_team[0] ?? null : game.home_team ?? null,
        away_team: Array.isArray(game.away_team) ? game.away_team[0] ?? null : game.away_team ?? null,
      })) as NextGame[];

      const upcomingGames = normalizedGames
        .map((game) => {
          const teamSlot = teamMap.get(game.home_team_id) ?? teamMap.get(game.away_team_id);
          if (!teamSlot) return null;

          return {
            ...game,
            leagueId: teamSlot.leagueId,
            leagueName: teamSlot.leagueName,
            leagueSlug: teamSlot.leagueSlug,
            teamId: teamSlot.teamId,
            teamName: teamSlot.teamName,
            isHomeTeam: teamSlot.teamId === game.home_team_id,
          };
        })
        .filter(Boolean) as GlobalUpcomingGame[];

      setGlobalUpcomingGames(upcomingGames);
      setGlobalCheckins(myCheckins);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoadingGlobal(false);
    }
  }, []);

  React.useEffect(() => {
    if (activeLeague) {
      setGlobalRosterSlots([]);
      setGlobalUpcomingGames([]);
      void loadLeagueHome();
      return;
    }

    setGames([]);
    setUserTeam(null);
    setNextGame(null);
    setMyCheckinStatus(null);
    setCheckinSummary({ confirmed: 0, tentative: 0, out: 0 });
  }, [activeLeague, loadLeagueHome]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeLeague) {
        await loadLeagueHome();
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeLeague, loadLeagueHome]);

  const recentFinals = React.useMemo(
    () =>
      games
        .filter((game) => mapGameStatus(game.status) === 'Final')
        .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
        .slice(0, 2),
    [games],
  );

  const globalCounts = React.useMemo(
    () => ({
      leagues: availableLeagues.length,
      teams: globalRosterSlots.length,
      games: globalUpcomingGames.length,
    }),
    [availableLeagues.length, globalRosterSlots.length, globalUpcomingGames.length],
  );

  const pendingGlobalGames = React.useMemo(
    () => globalUpcomingGames.filter((game) => !globalCheckins[game.id]).slice(0, 3),
    [globalCheckins, globalUpcomingGames],
  );

  const globalConflicts = React.useMemo(
    () =>
      getScheduleConflicts(
        globalUpcomingGames.map((game) => ({
          id: game.id,
          scheduled_at: game.scheduled_at,
          leagueId: game.leagueId,
          leagueName: game.leagueName,
          teamName: game.teamName,
          location: game.location ?? null,
        })),
      ),
    [globalUpcomingGames],
  );

  const notificationCount = activeLeague
    ? nextGame && !myCheckinStatus
      ? 1
      : 0
    : pendingGlobalGames.length;

  const openUpdates = () => {
    navigation?.navigate?.('Profile', {
      screen: 'NotificationsFeed',
    });
  };

  const handleCheckin = async (status: CheckinStatus) => {
    if (!nextGame || !userTeam || checkinLoading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previousStatus = myCheckinStatus;
    setMyCheckinStatus(status);

    setCheckinSummary((summary) => {
      const nextSummary = { ...summary };
      if (previousStatus === 'confirmed') nextSummary.confirmed = Math.max(0, nextSummary.confirmed - 1);
      if (previousStatus === 'tentative') nextSummary.tentative = Math.max(0, nextSummary.tentative - 1);
      if (previousStatus === 'out') nextSummary.out = Math.max(0, nextSummary.out - 1);
      if (status === 'confirmed') nextSummary.confirmed += 1;
      if (status === 'tentative') nextSummary.tentative += 1;
      if (status === 'out') nextSummary.out += 1;
      return nextSummary;
    });

    setCheckinLoading(true);
    const result = await updateCheckin(nextGame.id, userTeam.id, status);
    setCheckinLoading(false);

    if (!result.success) {
      setMyCheckinStatus(previousStatus);
      setCheckinSummary((summary) => {
        const nextSummary = { ...summary };
        if (status === 'confirmed') nextSummary.confirmed = Math.max(0, nextSummary.confirmed - 1);
        if (status === 'tentative') nextSummary.tentative = Math.max(0, nextSummary.tentative - 1);
        if (status === 'out') nextSummary.out = Math.max(0, nextSummary.out - 1);
        if (previousStatus === 'confirmed') nextSummary.confirmed += 1;
        if (previousStatus === 'tentative') nextSummary.tentative += 1;
        if (previousStatus === 'out') nextSummary.out += 1;
        return nextSummary;
      });
    }
  };

  const handleGlobalCheckin = async (game: GlobalUpcomingGame, status: CheckinStatus) => {
    if (savingGlobalGameId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previous = globalCheckins[game.id] ?? null;
    setGlobalCheckins((current) => ({ ...current, [game.id]: status }));
    setSavingGlobalGameId(game.id);

    const result = await updateCheckin(game.id, game.teamId, status);
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

  const navigateToGame = (gameId: string, leagueId?: string) => {
    if (leagueId) {
      const targetLeague = availableLeagues.find((league) => league.id === leagueId);
      if (targetLeague) {
        void setActiveLeague(targetLeague);
      }
    }

    navigation?.navigate?.('Schedule', {
      screen: 'GamePreview',
      params: { gameId },
    });
  };

  if (!activeLeague) {
    return (
      <LeagueMarketplace
        navigation={navigation}
        title="BLH Overview"
        subtitle="Nearby leagues, fit, and difficulty across Beer League Hockey."
        showJoinedLeagues
        includeTopInset={false}
      />
    );
  }

  const teamAccentColor = userTeam?.primary_color ?? activeTheme.primaryColor;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: homeVisuals.canvas }]} edges={['left', 'right']}>
      <HomeArenaBackdrop
        accentColor={teamAccentColor}
        showAtmosphericGlow={homeVisuals.showAtmosphericGlow}
      />
      <GuestBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeTheme.primaryColor} />}
        showsVerticalScrollIndicator={false}
      >
        <RevealView delay={20} duration={homeVisuals.revealDuration}>
            <View testID="home-editorial-header" style={styles.headerRow}>
              <View style={styles.brandWrap}>
                <View style={[styles.logoFrame, { borderColor: homeVisuals.stroke }]}>
                  <Image source={blhLogo} style={styles.smallLogo} />
                </View>
                <View style={styles.brandCopy}>
                  <Text style={[styles.homeEyebrow, { color: teamAccentColor }]}>LEAGUE HOME</Text>
                  <Text style={[styles.logo, isCompact && styles.logoCompact]}>
                    {activeLeague.name}
                  </Text>
                  <Text style={styles.logoSub}>
                    {isGuestLeague ? 'Preview mode' : formatSyncTime(lastUpdatedAt)}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Updates${notificationCount ? `, ${notificationCount} unread` : ''}`}
                style={[styles.iconButton, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }]}
                onPress={openUpdates}
              >
                <Ionicons name="notifications-outline" size={20} color={homeTokens.text} />
                {notificationCount > 0 ? (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>{Math.min(notificationCount, 9)}</Text>
                  </View>
                ) : null}
              </Pressable>
          </View>
        </RevealView>

        {loadingLeague ? (
          <View
            testID="home-loading-panel"
            accessibilityRole="progressbar"
            accessibilityLabel="Loading league home"
            accessibilityLiveRegion="polite"
            style={[styles.loadingBlock, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }]}
          >
            <ActivityIndicator color={teamAccentColor} />
            <Text style={styles.loadingText}>Loading league home</Text>
          </View>
        ) : (
          <>
            {!isGuestLeague ? (
              <RevealView delay={80} duration={homeVisuals.revealDuration}>
                <View testID="home-quick-actions" style={[styles.quickActionsRow, isCompact && styles.quickActionsRowCompact]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open full schedule"
                    style={[styles.quickActionCard, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }, isCompact && styles.quickActionCardCompact]}
                    onPress={() => navigation?.navigate?.('Schedule')}
                  >
                    <Ionicons name="calendar-outline" size={18} color={teamAccentColor} />
                    <Text style={styles.quickActionTitle}>Full Schedule</Text>
                    <Text style={styles.quickActionMeta}>See every game in this league</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${activeLeague.name} website`}
                    style={[styles.quickActionCard, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }, isCompact && styles.quickActionCardCompact]}
                    onPress={() => openLeagueSite(activeLeague.slug)}
                  >
                    <Ionicons name="globe-outline" size={18} color={teamAccentColor} />
                    <Text style={styles.quickActionTitle}>League Site</Text>
                    <Text style={styles.quickActionMeta}>{activeLeague.slug}.beerleaguehockey.ca</Text>
                  </Pressable>
                </View>
              </RevealView>
            ) : null}

            <RevealView delay={140} duration={homeVisuals.revealDuration}>
              <>
                <HomeSectionHeading eyebrow="ON DECK" title="Next game" />

                {nextGame ? (
                  <Pressable
                    testID="home-next-game-panel"
                    accessibilityRole="button"
                    accessibilityLabel={getNextGameAccessibilityLabel(nextGame, checkinSummary, isGuestLeague)}
                    accessibilityHint="Open next game details"
                    style={[styles.nextGameCard, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }]}
                    onPress={() => navigateToGame(nextGame.id, activeLeague.id)}
                  >
                    <LinearGradient
                      testID="home-stage-glass-gradient"
                      colors={[homeVisuals.surfaceTop, homeVisuals.surfaceBottom]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.featuredCardGlow}
                    />
                    <View pointerEvents="none" style={styles.matchupRinkLine} />
                    <View style={[styles.ngHeaderRow, isCompact && styles.stackHeaderRow]}>
                      <Text style={[styles.ngLabel, { color: teamAccentColor }]}>NEXT GAME</Text>
                      <Text style={styles.ngDateLabel}>{formatGameDate(nextGame.scheduled_at)}</Text>
                    </View>

                    <View testID="home-matchup-teams" style={[styles.ngTeamsRow, isCompact && styles.ngTeamsRowCompact]}>
                      <View style={[styles.ngTeamBlock, isCompact && styles.ngTeamBlockCompact]}>
                        <TeamLogo
                          teamId={nextGame.away_team_id}
                          logoUrl={nextGame.away_team?.logo_url ?? null}
                          teamName={nextGame.away_team?.name ?? '?'}
                          primaryColor={nextGame.away_team?.primary_color ?? colors.primary}
                          size={isCompact ? 40 : 52}
                        />
                        <Text
                          style={[
                            styles.ngTeamName,
                            isCompact && styles.ngTeamNameCompact,
                            nextGame.away_team_id === userTeam?.id && styles.ngTeamNameMyTeam,
                          ]}
                        >
                          {nextGame.away_team?.name ?? nextGame.away_team_id}
                        </Text>
                      </View>

                      <Text style={styles.ngVs}>VS</Text>

                      <View style={[styles.ngTeamBlock, styles.ngTeamBlockRight, isCompact && styles.ngTeamBlockCompact]}>
                        <TeamLogo
                          teamId={nextGame.home_team_id}
                          logoUrl={nextGame.home_team?.logo_url ?? null}
                          teamName={nextGame.home_team?.name ?? '?'}
                          primaryColor={nextGame.home_team?.primary_color ?? colors.primary}
                          size={isCompact ? 40 : 52}
                        />
                        <Text
                          style={[
                            styles.ngTeamName,
                            !isCompact && styles.ngTeamNameRight,
                            isCompact && styles.ngTeamNameCompact,
                            nextGame.home_team_id === userTeam?.id && styles.ngTeamNameMyTeam,
                          ]}
                        >
                          {nextGame.home_team?.name ?? nextGame.home_team_id}
                        </Text>
                      </View>
                    </View>

                    {nextGame.location ? (
                      <View style={styles.ngLocationRow}>
                        <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                        <Text style={styles.ngLocationText}>
                          {nextGame.location}
                        </Text>
                      </View>
                    ) : null}

                    {isGuestLeague ? (
                      <Text style={styles.guestCheckinHint}>Join this league to check in</Text>
                    ) : (
                      <>
                        <View style={styles.ngCheckinRow}>
                          <Pressable
                            style={[
                              styles.ngCheckinBtn,
                              myCheckinStatus === 'confirmed'
                                ? { backgroundColor: colors.accentGreen }
                                : { backgroundColor: colors.bgInteractive },
                            ]}
                            onPress={() => handleCheckin('confirmed')}
                            accessibilityRole="button"
                            accessibilityLabel="Check in for next game"
                            accessibilityState={{ selected: myCheckinStatus === 'confirmed' }}
                          >
                            <Ionicons
                              name="checkmark"
                              size={14}
                              color={myCheckinStatus === 'confirmed' ? '#000' : colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.ngCheckinBtnText,
                                { color: myCheckinStatus === 'confirmed' ? '#000' : colors.textSecondary },
                              ]}
                            >
                              In
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.ngCheckinBtn,
                              myCheckinStatus === 'tentative'
                                ? { backgroundColor: '#F59E0B' }
                                : { backgroundColor: colors.bgInteractive },
                            ]}
                            onPress={() => handleCheckin('tentative')}
                            accessibilityRole="button"
                            accessibilityLabel="Mark next game as maybe"
                            accessibilityState={{ selected: myCheckinStatus === 'tentative' }}
                          >
                            <Ionicons
                              name="help"
                              size={14}
                              color={myCheckinStatus === 'tentative' ? '#000' : colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.ngCheckinBtnText,
                                { color: myCheckinStatus === 'tentative' ? '#000' : colors.textSecondary },
                              ]}
                            >
                              Maybe
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.ngCheckinBtn,
                              myCheckinStatus === 'out'
                                ? { backgroundColor: colors.accentRed }
                                : { backgroundColor: colors.bgInteractive },
                            ]}
                            onPress={() => handleCheckin('out')}
                            accessibilityRole="button"
                            accessibilityLabel="Decline next game"
                            accessibilityState={{ selected: myCheckinStatus === 'out' }}
                          >
                            <Ionicons
                              name="close"
                              size={14}
                              color={myCheckinStatus === 'out' ? '#fff' : colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.ngCheckinBtnText,
                                { color: myCheckinStatus === 'out' ? '#fff' : colors.textSecondary },
                              ]}
                            >
                              Out
                            </Text>
                          </Pressable>
                        </View>

                        <Text style={styles.ngCheckinSummary}>
                          {checkinSummary.confirmed} In · {checkinSummary.tentative} Maybe · {checkinSummary.out} Out
                        </Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View testID="home-empty-game-panel" style={[styles.noGameCard, { backgroundColor: homeVisuals.surface, borderColor: homeVisuals.stroke }]}>
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} style={{ marginBottom: 4 }} />
                    <Text style={styles.noGameTitle}>No upcoming games</Text>
                    <Text style={styles.noGameSub}>Check back soon. League schedule updates will land here automatically.</Text>
                  </View>
                )}
              </>
            </RevealView>

            {recentFinals.length > 0 ? (
              <>
                <HomeSectionHeading eyebrow="FINAL HORN" title="Recent results" />
                {recentFinals.map((game) => (
                  <GameCard
                    key={game.id}
                    compact
                    visualVariant="homeEditorial"
                    reduceTransparency={reduceTransparency}
                    homeTeam={game.home_team?.name ?? game.home_team_id}
                    awayTeam={game.away_team?.name ?? game.away_team_id}
                    dateLabel={formatDate(game.scheduled_at)}
                    timeLabel={formatTime(game.scheduled_at)}
                    rinkName={game.location ?? ''}
                    status={mapGameStatus(game.status)}
                    homeScore={game.home_score ?? undefined}
                    awayScore={game.away_score ?? undefined}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  arenaBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  arenaGlow: {
    position: 'absolute',
    top: -80,
    left: -60,
    right: -80,
    height: 360,
    borderRadius: 180,
  },
  arenaRink: {
    position: 'absolute',
    width: 250,
    height: 470,
    right: -120,
    top: 120,
    borderWidth: 1,
    borderColor: homeTokens.rinkLine,
    borderRadius: 125,
    transform: [{ rotate: '-10deg' }],
  },
  arenaCenterLine: {
    position: 'absolute',
    top: '50%',
    right: 0,
    left: 0,
    height: 1,
    backgroundColor: homeTokens.rinkLine,
  },
  arenaCenterCircle: {
    position: 'absolute',
    top: 191,
    left: 81,
    width: 86,
    height: 86,
    borderWidth: 1,
    borderColor: homeTokens.rinkLine,
    borderRadius: 43,
  },
  arenaFaceoffCircle: {
    position: 'absolute',
    left: 98,
    width: 52,
    height: 52,
    borderWidth: 1,
    borderColor: homeTokens.rinkLine,
    borderRadius: 26,
  },
  arenaFaceoffTop: { top: 58 },
  arenaFaceoffBottom: { bottom: 58 },
  content: {
    paddingHorizontal: homeTokens.contentPadding,
    paddingTop: 6,
    paddingBottom: 32,
    gap: 10,
  },
  loadingBlock: {
    minHeight: 120,
    marginVertical: 8,
    borderWidth: 1,
    borderRadius: homeTokens.cardRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: homeTokens.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  headerRow: {
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  logoFrame: {
    width: homeTokens.minTouchTarget,
    height: homeTokens.minTouchTarget,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: homeTokens.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallLogo: { width: 30, height: 30 },
  brandCopy: { flex: 1, minWidth: 0 },
  homeEyebrow: { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1.8 },
  logo: {
    color: homeTokens.text,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  logoCompact: {
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  logoSub: { fontSize: 11, color: homeTokens.textSecondary, fontWeight: '600', marginTop: 4 },
  iconButton: {
    width: homeTokens.minTouchTarget,
    height: homeTokens.minTouchTarget,
    minHeight: homeTokens.minTouchTarget,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentRed,
    borderWidth: 1,
    borderColor: colors.bgBase,
  },
  notificationBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  sectionHeading: {
    marginTop: 8,
    marginBottom: 2,
  },
  sectionEyebrow: {
    color: homeTokens.success,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  sectionTitle: {
    color: homeTokens.text,
    fontSize: 25,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 1,
  },
  sectionRule: {
    width: 38,
    height: 2,
    marginTop: 8,
    borderRadius: 1,
    backgroundColor: homeTokens.success,
  },
  syncRow: { marginBottom: 4 },
  syncPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  globalHeroCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    padding: 16,
    gap: 10,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  featuredCardGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  globalHeroEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  globalHeroTitle: {
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
  },
  globalHeroTitleCompact: {
    fontSize: 24,
    lineHeight: 28,
  },
  globalHeroSub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  statCardsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  statCardsRowCompact: { flexWrap: 'wrap' },
  statCard: {
    flex: 1,
    backgroundColor: colors.glassHighlight,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  statCardCompact: {
    flexBasis: '31%',
  },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  globalHeroActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  globalHeroActionsCompact: {
    flexDirection: 'column',
  },
  globalHeroAction: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 12,
    gap: 4,
  },
  globalHeroActionCompact: {
    width: '100%',
  },
  globalHeroActionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  globalHeroActionMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  actionCenterList: { gap: 10 },
  actionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 10,
  },
  actionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stackHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  actionLeagueName: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  actionDate: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  actionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  actionMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  caughtUpCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  caughtUpTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  caughtUpMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  globalLeagueList: { gap: 10 },
  globalLeagueCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 12,
  },
  globalLeagueTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  globalLeagueTopRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  globalLeagueIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  globalLeagueName: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  globalLeagueMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  goButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  goButtonCompact: {
    alignSelf: 'flex-start',
  },
  goButtonText: { color: colors.textOnPrimary, fontSize: 13, fontWeight: '800' },
  globalLeagueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  globalLeagueFooterCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  globalLeagueCity: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  siteLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  siteLinkCompact: { alignSelf: 'flex-start' },
  siteLinkText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  crossLeagueGameCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    gap: 10,
  },
  crossLeagueGameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  crossLeagueLeagueName: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  crossLeagueGameTime: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  crossLeagueGameTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  crossLeagueMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  crossLeagueMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  crossLeagueMetaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  quickActionsRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  quickActionsRowCompact: { flexDirection: 'column' },
  quickActionCard: {
    flex: 1,
    minHeight: 88,
    backgroundColor: homeTokens.surface,
    borderRadius: homeTokens.cardRadius,
    borderWidth: 1,
    borderColor: homeTokens.stroke,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    justifyContent: 'center',
  },
  quickActionCardCompact: { flex: 0 },
  quickActionTitle: { color: homeTokens.text, fontSize: 15, fontWeight: '900' },
  quickActionMeta: { color: homeTokens.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  nextGameCard: {
    minHeight: homeTokens.minTouchTarget,
    backgroundColor: homeTokens.surface,
    borderRadius: homeTokens.panelRadius,
    borderWidth: 1,
    borderColor: homeTokens.stroke,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
    gap: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  matchupRinkLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: homeTokens.rinkLine,
  },
  ngHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ngLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  ngDateLabel: { fontSize: 12, color: homeTokens.textSecondary, fontWeight: '700' },
  ngTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  ngTeamsRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  ngTeamBlock: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignItems: 'flex-start',
    gap: 6,
  },
  ngTeamBlockRight: { alignItems: 'flex-end' },
  ngTeamBlockCompact: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ngTeamName: { fontSize: 16, fontWeight: '900', color: homeTokens.textSecondary, lineHeight: 19 },
  ngTeamNameRight: { textAlign: 'right' },
  ngTeamNameCompact: { flex: 1, textAlign: 'left', fontSize: 14, lineHeight: 18 },
  ngTeamNameMyTeam: {
    color: homeTokens.text,
    fontWeight: '900',
  },
  ngVs: {
    alignSelf: 'center',
    color: homeTokens.text,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginHorizontal: 6,
  },
  ngLocationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: -2 },
  ngLocationText: { fontSize: 12, lineHeight: 17, color: homeTokens.textSecondary, fontWeight: '700', flex: 1 },
  ngCheckinRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  ngCheckinBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: ui.minTouchTarget,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: homeTokens.stroke,
  },
  ngCheckinBtnText: { fontSize: 13, fontWeight: '800' },
  ngCheckinSummary: {
    fontSize: 12,
    color: homeTokens.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  guestCheckinHint: {
    fontSize: 13,
    color: homeTokens.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
    paddingVertical: 4,
  },
  noGameCard: {
    minHeight: 118,
    backgroundColor: homeTokens.surface,
    borderRadius: homeTokens.cardRadius,
    borderWidth: 1,
    borderColor: homeTokens.stroke,
    padding: 16,
    gap: 5,
    marginBottom: 8,
    justifyContent: 'center',
  },
  noGameTitle: { fontSize: 17, fontWeight: '900', color: homeTokens.text },
  noGameSub: { fontSize: 13, color: homeTokens.textSecondary, lineHeight: 19 },
});
