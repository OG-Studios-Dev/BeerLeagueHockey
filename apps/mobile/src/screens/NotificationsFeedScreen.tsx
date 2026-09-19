import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';

import BrandAtmosphere from '../components/BrandAtmosphere';
import QuickCheckinActions from '../components/QuickCheckinActions';
import RevealView from '../components/RevealView';
import ScheduleConflictList from '../components/ScheduleConflictList';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { useLeague } from '../context/LeagueContext';
import { HOCKEY_LIFE_ID } from '../config/hockeyLife';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { addGameToCalendar } from '../lib/calendar';
import { getScheduleConflicts } from '../lib/scheduleConflicts';
import { getMyCheckinsForTeams, type CheckinStatus, updateCheckin } from '../lib/supabase/checkins';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';

type TeamSlot = {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  leaguePrimaryColor: string | null;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
};

type TeamStanding = {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  leagueId: string;
  leagueName: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  gamesPlayed: number;
};

type PlayerGame = {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  scheduled_at: string;
  location: string | null;
  status: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  home_team: { id: string; name: string; logo_url?: string | null; primary_color: string | null } | null;
  away_team: { id: string; name: string; logo_url?: string | null; primary_color: string | null } | null;
  myTeamId: string;
  myTeamName: string;
  isHomeTeam: boolean;
};

type Scope = 'all' | 'active';

function formatSyncTime(iso: string | null) {
  if (!iso) return 'Syncing...';
  return `Updated ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatGameDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelativeDay(iso: string) {
  const gameDate = new Date(iso);
  const today = new Date();
  const diff = Math.floor((gameDate.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) {
    return `In ${diff} days`;
  }
  return gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getOpponentName(game: PlayerGame) {
  return game.myTeamId === game.home_team_id
    ? game.away_team?.name ?? 'Opponent'
    : game.home_team?.name ?? 'Opponent';
}

function openLeagueSite(slug: string) {
  const url = `https://${slug}.beerleaguehockey.ca`;
  Linking.openURL(url).catch(() => {});
}

export default function NotificationsFeedScreen({ navigation }: { navigation: any }) {
  const { activeLeague } = useLeague();
  const { width } = useWindowDimensions();
  const isCompact = width < 390;

  const [scope, setScope] = React.useState<Scope>(activeLeague ? 'active' : 'all');
  const [teamSlots, setTeamSlots] = React.useState<TeamSlot[]>([]);
  const [upcomingGames, setUpcomingGames] = React.useState<PlayerGame[]>([]);
  const [recentResults, setRecentResults] = React.useState<PlayerGame[]>([]);
  const [teamStandings, setTeamStandings] = React.useState<TeamStanding[]>([]);
  const [checkins, setCheckins] = React.useState<Record<string, CheckinStatus>>({});
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [savingGameId, setSavingGameId] = React.useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setScope(activeLeague ? 'active' : 'all');
  }, [activeLeague?.id]);

  const loadFeed = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setCurrentUserId(null);
        setTeamSlots([]);
        setUpcomingGames([]);
        setRecentResults([]);
        setTeamStandings([]);
        setCheckins({});
        setLastUpdatedAt(new Date().toISOString());
        return;
      }

      setCurrentUserId(user.id);

      const { data: rosterRows } = await supabase
        .from('team_rosters')
        .select(`
          team_id, league_id,
          team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color),
          league:leagues!team_rosters_league_id_fkey(id, name, slug, primary_color)
        `)
        .eq('player_id', user.id)
        .eq('league_id', HOCKEY_LIFE_ID)
        .eq('status', 'active');

      const slots = ((rosterRows as any[]) ?? [])
        .map((row) => {
          const team = Array.isArray(row.team) ? row.team[0] : row.team;
          const league = Array.isArray(row.league) ? row.league[0] : row.league;

          if (!team || !league) return null;

          return {
            leagueId: row.league_id,
            leagueName: league.name,
            leagueSlug: league.slug,
            leaguePrimaryColor: league.primary_color ?? null,
            teamId: row.team_id,
            teamName: team.name,
            teamLogoUrl: team.logo_url ?? null,
            teamPrimaryColor: team.primary_color ?? null,
          };
        })
        .filter(Boolean) as TeamSlot[];

      setTeamSlots(slots);

      if (slots.length === 0) {
        setUpcomingGames([]);
        setRecentResults([]);
        setTeamStandings([]);
        setCheckins({});
        setLastUpdatedAt(new Date().toISOString());
        return;
      }

      const teamIds = slots.map((slot) => slot.teamId);
      const leagueIds = [...new Set(slots.map((slot) => slot.leagueId))];
      const teamMap = new Map(slots.map((slot) => [slot.teamId, slot]));
      const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const [upcomingResponse, recentResponse, standingsResponse, myCheckins] = await Promise.all([
        supabase
          .from('games')
          .select(`
            id, league_id, scheduled_at, location, status, home_score, away_score,
            home_team_id, away_team_id,
            home_team:teams!games_home_team_id_fkey(id, name, logo_url, primary_color),
            away_team:teams!games_away_team_id_fkey(id, name, logo_url, primary_color)
          `)
          .in('league_id', leagueIds)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(40),
        supabase
          .from('games')
          .select(`
            id, league_id, scheduled_at, location, status, home_score, away_score,
            home_team_id, away_team_id,
            home_team:teams!games_home_team_id_fkey(id, name, logo_url, primary_color),
            away_team:teams!games_away_team_id_fkey(id, name, logo_url, primary_color)
          `)
          .in('league_id', leagueIds)
          .eq('status', 'completed')
          .gte('scheduled_at', recentCutoff)
          .order('scheduled_at', { ascending: false })
          .limit(20),
        supabase
          .from('team_standings')
          .select('team_id, wins, losses, ties, points, games_played')
          .in('team_id', teamIds),
        getMyCheckinsForTeams(teamIds),
      ]);

      const normalizeGames = (rows: any[] | null | undefined) =>
        ((rows as any[]) ?? [])
          .map((game) => ({
            ...game,
            home_team: Array.isArray(game.home_team) ? game.home_team[0] ?? null : game.home_team ?? null,
            away_team: Array.isArray(game.away_team) ? game.away_team[0] ?? null : game.away_team ?? null,
          }))
          .map((game) => {
            const slot = teamMap.get(game.home_team_id) ?? teamMap.get(game.away_team_id);
            if (!slot) return null;

            return {
              ...game,
              leagueId: slot.leagueId,
              leagueName: slot.leagueName,
              leagueSlug: slot.leagueSlug,
              myTeamId: slot.teamId,
              myTeamName: slot.teamName,
              isHomeTeam: slot.teamId === game.home_team_id,
            };
          })
          .filter(Boolean) as PlayerGame[];

      setUpcomingGames(normalizeGames(upcomingResponse.data));
      setRecentResults(normalizeGames(recentResponse.data));

      const dedupedStandings = new Map<string, TeamStanding>();
      for (const row of (standingsResponse.data as any[]) ?? []) {
        const slot = teamMap.get(row.team_id);
        if (!slot) continue;

        const current = dedupedStandings.get(row.team_id);
        const next: TeamStanding = {
          teamId: row.team_id,
          teamName: slot.teamName,
          teamLogoUrl: slot.teamLogoUrl,
          teamPrimaryColor: slot.teamPrimaryColor,
          leagueId: slot.leagueId,
          leagueName: slot.leagueName,
          wins: Number(row.wins) || 0,
          losses: Number(row.losses) || 0,
          ties: Number(row.ties) || 0,
          points: Number(row.points) || 0,
          gamesPlayed: Number(row.games_played) || 0,
        };

        if (!current || next.gamesPlayed >= current.gamesPlayed) {
          dedupedStandings.set(row.team_id, next);
        }
      }

      setTeamStandings(Array.from(dedupedStandings.values()).sort((a, b) => b.points - a.points));
      setCheckins(myCheckins);
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      setLoadError('Unable to load updates. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFeed();
    } finally {
      setRefreshing(false);
    }
  }, [loadFeed]);

  const filteredTeamSlots = React.useMemo(
    () =>
      scope === 'active' && activeLeague
        ? teamSlots.filter((slot) => slot.leagueId === activeLeague.id)
        : teamSlots,
    [activeLeague, scope, teamSlots],
  );

  const filteredUpcomingGames = React.useMemo(
    () =>
      scope === 'active' && activeLeague
        ? upcomingGames.filter((game) => game.leagueId === activeLeague.id)
        : upcomingGames,
    [activeLeague, scope, upcomingGames],
  );

  const filteredRecentResults = React.useMemo(
    () =>
      scope === 'active' && activeLeague
        ? recentResults.filter((game) => game.leagueId === activeLeague.id)
        : recentResults,
    [activeLeague, scope, recentResults],
  );

  const filteredStandings = React.useMemo(
    () =>
      scope === 'active' && activeLeague
        ? teamStandings.filter((team) => team.leagueId === activeLeague.id)
        : teamStandings,
    [activeLeague, scope, teamStandings],
  );

  const pendingGames = React.useMemo(
    () => filteredUpcomingGames.filter((game) => !checkins[game.id]),
    [checkins, filteredUpcomingGames],
  );

  const soonGames = React.useMemo(() => {
    const twoDaysFromNow = Date.now() + 48 * 60 * 60 * 1000;
    const prioritized = filteredUpcomingGames.filter((game) => new Date(game.scheduled_at).getTime() <= twoDaysFromNow);
    return (prioritized.length > 0 ? prioritized : filteredUpcomingGames).slice(0, 4);
  }, [filteredUpcomingGames]);

  const scheduleConflicts = React.useMemo(
    () =>
      getScheduleConflicts(
        filteredUpcomingGames.map((game) => ({
          id: game.id,
          scheduled_at: game.scheduled_at,
          leagueId: game.leagueId,
          leagueName: game.leagueName,
          teamName: game.myTeamName,
          location: game.location ?? null,
        })),
      ),
    [filteredUpcomingGames],
  );

  const handleCheckin = async (game: PlayerGame, status: CheckinStatus) => {
    if (savingGameId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const previous = checkins[game.id] ?? null;
    setCheckins((current) => ({ ...current, [game.id]: status }));
    setSavingGameId(game.id);

    const result = await updateCheckin(game.id, game.myTeamId, status);
    setSavingGameId(null);

    if (!result.success) {
      setCheckins((current) => {
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

  const navigateToGame = (game: PlayerGame) => {
    navigation.navigate('Schedule', {
      screen: 'GamePreview',
      params: { gameId: game.id },
    });
  };

  const addToCalendar = async (game: PlayerGame) => {
    await addGameToCalendar({
      homeTeam: game.home_team?.name ?? 'Home',
      awayTeam: game.away_team?.name ?? 'Away',
      scheduledAt: game.scheduled_at,
      location: game.location,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <BrandAtmosphere intensity="medium" />
      <View style={styles.updatesActions}>
        <Text accessibilityRole="header" style={styles.updatesContext}>League changes, game-day actions, and team pulse</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          onPress={() => navigation.navigate('NotificationSettings')}
          style={[styles.headerButton, styles.headerSettingsButton]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError ? (
        <View testID="notifications-feed-error" style={styles.centered}>
          <Text style={styles.emptyTitle}>{loadError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry updates" onPress={() => void loadFeed()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FocusScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          <RevealView delay={80}>
            <FocusCard focusId="notifications:summary" style={styles.summaryCard}>
              <LinearGradient
                colors={['rgba(255,255,255,0.08)', 'rgba(79,216,255,0.06)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.summaryGlow}
              />
              <View style={[styles.summaryTopRow, isCompact && styles.summaryTopRowCompact]}>
                <View style={styles.summaryHeadlineWrap}>
                  <Text style={styles.summaryEyebrow}>PLAYER OPS</Text>
                  <Text style={[styles.summaryTitle, isCompact && styles.summaryTitleCompact]}>Stay ahead of tonight.</Text>
                </View>
                <View style={[styles.syncPill, isCompact && styles.syncPillCompact]}>
                  <Ionicons name="sync-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.syncText}>{formatSyncTime(lastUpdatedAt)}</Text>
                </View>
              </View>

              <View style={[styles.summaryStatsRow, isCompact && styles.summaryStatsRowCompact]}>
                <View style={[styles.summaryStatCard, isCompact && styles.summaryStatCardCompact]}>
                  <Text style={styles.summaryStatValue}>{pendingGames.length}</Text>
                  <Text style={styles.summaryStatLabel}>Need Response</Text>
                </View>
                <View style={[styles.summaryStatCard, isCompact && styles.summaryStatCardCompact]}>
                  <Text style={styles.summaryStatValue}>{filteredUpcomingGames.length}</Text>
                  <Text style={styles.summaryStatLabel}>Upcoming</Text>
                </View>
                <View style={[styles.summaryStatCard, isCompact && styles.summaryStatCardCompact]}>
                  <Text style={styles.summaryStatValue}>{filteredTeamSlots.length}</Text>
                  <Text style={styles.summaryStatLabel}>Teams</Text>
                </View>
              </View>

              {currentUserId ? (
                <View style={styles.summaryActionRow}>
                  <Pressable
                    style={styles.summaryActionButton}
                    onPress={() => navigateToPlayerCard(navigation, { playerId: currentUserId, leagueId: activeLeague?.id ?? null })}
                  >
                    <Ionicons name="person-circle-outline" size={16} color={colors.textPrimary} />
                    <Text style={styles.summaryActionText}>My Player Card</Text>
                  </Pressable>
                </View>
              ) : null}

              {activeLeague ? (
                <View style={[styles.scopeRow, isCompact && styles.scopeRowCompact]}>
                  <Pressable
                    style={[styles.scopePill, scope === 'active' && styles.scopePillActive]}
                    onPress={() => setScope('active')}
                  >
                    <Text style={[styles.scopePillText, scope === 'active' && styles.scopePillTextActive]}>
                      {activeLeague.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.scopePill, scope === 'all' && styles.scopePillActive]}
                    onPress={() => setScope('all')}
                  >
                    <Text style={[styles.scopePillText, scope === 'all' && styles.scopePillTextActive]}>All BLH</Text>
                  </Pressable>
                </View>
              ) : null}
            </FocusCard>
          </RevealView>

          <SectionHeader title="Needs Attention" />

          {pendingGames.length > 0 ? (
            <View style={styles.cardList}>
              {pendingGames.slice(0, 4).map((game) => (
                <FocusCard key={game.id} focusId={`notifications:action:${game.id}`} style={styles.actionCard}>
                  <View style={[styles.cardHeaderRow, isCompact && styles.cardHeaderRowCompact]}>
                    <Text style={styles.cardLeagueName}>{game.leagueName}</Text>
                    <Text style={styles.cardDateText}>{formatRelativeDay(game.scheduled_at)}</Text>
                  </View>

                  <Text style={styles.cardTitle}>
                    Confirm {game.myTeamName} vs {getOpponentName(game)}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {formatGameDate(game.scheduled_at)}
                    {game.location ? ` · ${game.location}` : ''}
                  </Text>

                  <QuickCheckinActions
                    value={checkins[game.id] ?? null}
                    onChange={(status) => void handleCheckin(game, status)}
                    disabled={savingGameId === game.id}
                  />

                  <View style={styles.cardActionRow}>
                    <Pressable style={styles.secondaryActionButton} onPress={() => navigateToGame(game)}>
                      <Ionicons name="open-outline" size={15} color={colors.textPrimary} />
                      <Text style={styles.secondaryActionText}>Open Game</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryActionButton} onPress={() => void addToCalendar(game)}>
                      <Ionicons name="calendar-outline" size={15} color={colors.textPrimary} />
                      <Text style={styles.secondaryActionText}>Calendar</Text>
                    </Pressable>
                  </View>
                </FocusCard>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.accentGreen} />
              <View style={styles.emptyTextWrap}>
                <Text style={styles.emptyTitle}>No open actions</Text>
                <Text style={styles.emptySubtitle}>You’re caught up on availability across your BLH teams.</Text>
              </View>
            </View>
          )}

          {scheduleConflicts.length > 0 ? (
            <>
              <SectionHeader title="Conflict Watch" />
              <ScheduleConflictList
                conflicts={scheduleConflicts}
                onOpenGame={(game) => {
                  const targetGame = filteredUpcomingGames.find((entry) => entry.id === game.id);
                  if (targetGame) {
                    navigateToGame(targetGame);
                  }
                }}
              />
            </>
          ) : null}

          <SectionHeader title="Coming Up" />

          {soonGames.length > 0 ? (
            <View style={styles.cardList}>
              {soonGames.map((game) => (
                <FocusCard key={game.id} focusId={`notifications:upcoming:${game.id}`}>
                  <Pressable style={styles.upcomingCard} onPress={() => navigateToGame(game)}>
                  <View style={[styles.cardHeaderRow, isCompact && styles.cardHeaderRowCompact]}>
                    <Text style={styles.cardLeagueName}>{game.leagueName}</Text>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillText}>{checkins[game.id] ? 'Responded' : 'Awaiting'}</Text>
                    </View>
                  </View>

                  <View style={[styles.upcomingIdentityRow, isCompact && styles.upcomingIdentityRowCompact]}>
                    <TeamLogo
                      teamId={game.myTeamId}
                      logoUrl={game.home_team?.logo_url ?? game.away_team?.logo_url ?? null}
                      teamName={game.myTeamName}
                      primaryColor={game.home_team?.primary_color ?? game.away_team?.primary_color ?? colors.primary}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>
                        {game.myTeamName} vs {getOpponentName(game)}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {formatGameDate(game.scheduled_at)}
                        {game.location ? ` · ${game.location}` : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardActionRow}>
                    <Pressable style={styles.secondaryActionButton} onPress={() => void addToCalendar(game)}>
                      <Ionicons name="calendar-outline" size={15} color={colors.textPrimary} />
                      <Text style={styles.secondaryActionText}>Add to Calendar</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryActionButton}
                      onPress={() => openLeagueSite(game.leagueSlug)}
                    >
                      <Ionicons name="globe-outline" size={15} color={colors.textPrimary} />
                      <Text style={styles.secondaryActionText}>League Site</Text>
                    </Pressable>
                  </View>
                  </Pressable>
                </FocusCard>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <View style={styles.emptyTextWrap}>
                <Text style={styles.emptyTitle}>No upcoming games</Text>
                <Text style={styles.emptySubtitle}>When schedules publish, upcoming games will appear here.</Text>
              </View>
            </View>
          )}

          <SectionHeader title="Recent Finals" />

          {filteredRecentResults.length > 0 ? (
            <View style={styles.cardList}>
              {filteredRecentResults.slice(0, 4).map((game) => {
                const myScore = game.myTeamId === game.home_team_id ? game.home_score ?? 0 : game.away_score ?? 0;
                const opponentScore = game.myTeamId === game.home_team_id ? game.away_score ?? 0 : game.home_score ?? 0;
                const result = myScore > opponentScore ? 'W' : myScore < opponentScore ? 'L' : 'T';
                const resultColor =
                  result === 'W' ? colors.accentGreen : result === 'L' ? colors.accentRed : colors.textSecondary;

                return (
                  <FocusCard key={game.id} focusId={`notifications:result:${game.id}`} style={[styles.resultCard, isCompact && styles.resultCardCompact]}>
                    <View style={[styles.resultBadge, { backgroundColor: `${resultColor}22` }]}>
                      <Text style={[styles.resultBadgeText, { color: resultColor }]}>{result}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultLeagueName}>{game.leagueName}</Text>
                      <Text style={styles.resultTitle}>
                        {game.myTeamName} vs {getOpponentName(game)}
                      </Text>
                      <Text style={styles.resultMeta}>{formatGameDate(game.scheduled_at)}</Text>
                    </View>
                    <Text style={[styles.resultScore, isCompact && styles.resultScoreCompact]}>
                      {myScore} - {opponentScore}
                    </Text>
                  </FocusCard>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="trophy-outline" size={20} color={colors.textSecondary} />
              <View style={styles.emptyTextWrap}>
                <Text style={styles.emptyTitle}>No recent finals</Text>
                <Text style={styles.emptySubtitle}>Completed game results will show up here after the final buzzer.</Text>
              </View>
            </View>
          )}

          <SectionHeader title="Team Watch" />

          {filteredStandings.length > 0 ? (
            <View style={styles.teamWatchGrid}>
              {filteredStandings.slice(0, 6).map((team) => (
                <FocusCard key={team.teamId} focusId={`notifications:team:${team.leagueId}:${team.teamId}`} accentColor={team.teamPrimaryColor ?? colors.primary}>
                  <Pressable
                    style={styles.teamWatchCard}
                    onPress={() => {
                    navigation.navigate('Team', {
                      screen: 'TeamDetail',
                      params: { teamId: team.teamId, leagueId: team.leagueId },
                    });
                  }}
                  >
                  <View style={styles.teamWatchHeader}>
                    <TeamLogo
                      teamId={team.teamId}
                      logoUrl={team.teamLogoUrl}
                      teamName={team.teamName}
                      primaryColor={team.teamPrimaryColor ?? colors.primary}
                      size={34}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamWatchTeamName} numberOfLines={1}>
                        {team.teamName}
                      </Text>
                      <Text style={styles.teamWatchLeagueName} numberOfLines={1}>
                        {team.leagueName}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.teamWatchRecord}>
                    {team.wins}-{team.losses}-{team.ties}
                  </Text>
                  <Text style={styles.teamWatchMeta}>{team.points} pts · {team.gamesPlayed} GP</Text>
                  </Pressable>
                </FocusCard>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="stats-chart-outline" size={20} color={colors.textSecondary} />
              <View style={styles.emptyTextWrap}>
                <Text style={styles.emptyTitle}>Standings not loaded yet</Text>
                <Text style={styles.emptySubtitle}>Your team record cards will appear here once standings are available.</Text>
              </View>
            </View>
          )}
        </FocusScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  headerSettingsButton: {
    backgroundColor: colors.bgElevated,
  },
  updatesActions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  updatesContext: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  summaryCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    backgroundColor: colors.bgSurface,
    padding: 18,
    gap: 16,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  summaryGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  summaryHeadlineWrap: { flex: 1, minWidth: 0 },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryTopRowCompact: {
    flexDirection: 'column',
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.primary,
  },
  summaryTitle: { marginTop: 6, fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  summaryTitleCompact: { fontSize: 22, lineHeight: 26 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  syncPillCompact: { alignSelf: 'flex-start' },
  syncText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  summaryStatsRow: { flexDirection: 'row', gap: 10 },
  summaryStatsRowCompact: { flexWrap: 'wrap' },
  summaryStatCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: colors.glassHighlight,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  summaryStatCardCompact: {
    flexBasis: '48%',
  },
  summaryStatValue: { fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  summaryStatLabel: { marginTop: 4, fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  summaryActionRow: { marginTop: -4 },
  summaryActionButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryActionText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeRowCompact: { flexWrap: 'wrap' },
  scopePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgElevated,
  },
  scopePillActive: {
    backgroundColor: colors.brandArena,
    borderColor: colors.brandArena,
  },
  scopePillText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
  scopePillTextActive: { color: colors.textPrimary },
  cardList: { gap: 12 },
  actionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgSurface,
    padding: 16,
    gap: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  cardLeagueName: { fontSize: 12, fontWeight: '800', color: colors.primary, flexShrink: 1 },
  cardDateText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  cardTitle: { fontSize: 17, fontWeight: '900', color: colors.textPrimary },
  cardMeta: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  cardActionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  secondaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '100%',
    flexShrink: 1,
  },
  secondaryActionText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgSurface,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  emptyTextWrap: { flex: 1 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  emptySubtitle: { marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  retryButton: { minHeight: 44, marginTop: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 18 },
  retryButtonText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '800' },
  upcomingCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgSurface,
    padding: 16,
    gap: 12,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  statusPillText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
  upcomingIdentityRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  upcomingIdentityRowCompact: { alignItems: 'flex-start' },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgSurface,
    padding: 16,
  },
  resultCardCompact: {
    flexWrap: 'wrap',
  },
  resultBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultBadgeText: { fontSize: 14, fontWeight: '900' },
  resultLeagueName: { fontSize: 12, fontWeight: '800', color: colors.primary },
  resultTitle: { marginTop: 3, fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  resultMeta: { marginTop: 4, fontSize: 12, color: colors.textSecondary },
  resultScore: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  resultScoreCompact: { width: '100%', textAlign: 'right' },
  teamWatchGrid: { gap: 12 },
  teamWatchCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgSurface,
    padding: 16,
    gap: 10,
  },
  teamWatchHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamWatchTeamName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  teamWatchLeagueName: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  teamWatchRecord: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  teamWatchMeta: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
