import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';

import { addGameToCalendar } from '../lib/calendar';
import Avatar from '../components/Avatar';
import TeamLogo from '../components/TeamLogo';
import { supabase } from '../lib/supabase/client';
import {
  getGameGoalScorers,
  getGoalieStats,
  getSeasonSeries,
  getTopPlayers,
  getTeamRoster,
  mapGameStatus,
  type RosterMemberRow,
} from '../lib/supabase/data';
import {
  updateCheckin,
  getMyCheckins,
  getGameCheckinSummary,
  type CheckinStatus,
  type GameCheckinEntry,
} from '../lib/supabase/checkins';
import { useLeague } from '../context/LeagueContext';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { ScheduleStackParamList } from '../navigation/types';
import colors from '../theme/colors';

type Props = NativeStackScreenProps<ScheduleStackParamList, 'GamePreview'>;

type GameDetail = {
  id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string;
  status: string | null;
  location: string | null;
  home_team: { name: string; primary_color: string | null; logo_url: string | null } | null;
  away_team: { name: string; primary_color: string | null; logo_url: string | null } | null;
};

type CheckinSummary = { confirmed: GameCheckinEntry[]; tentative: GameCheckinEntry[]; out: GameCheckinEntry[] };

function formatFullDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function LiveDot() {
  const [pulse] = React.useState(() => new Animated.Value(1));

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [pulse]);

  return <Animated.View style={[styles.liveDot, { opacity: pulse }]} />;
}

export default function GamePreviewScreen({ route, navigation }: Props) {
  const { gameId } = route.params;
  const { isGuestLeague } = useLeague();
  const [game, setGame] = React.useState<GameDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [userTeamId, setUserTeamId] = React.useState<string | null>(null);
  const [checkinStatus, setCheckinStatus] = React.useState<CheckinStatus | null>(null);
  const [checkinSummary, setCheckinSummary] = React.useState<CheckinSummary | null>(null);
  const [teamRoster, setTeamRoster] = React.useState<RosterMemberRow[]>([]);
  const [seasonSeries, setSeasonSeries] = React.useState<any[]>([]);
  const [topPlayers, setTopPlayers] = React.useState<any[]>([]);
  const [goalies, setGoalies] = React.useState<any[]>([]);
  const [goalScorers, setGoalScorers] = React.useState<any[]>([]);

  const pendingRosterPlayers = React.useMemo(() => {
    if (!checkinSummary || teamRoster.length === 0) return [];

    const respondedIds = new Set(
      [...checkinSummary.confirmed, ...checkinSummary.tentative, ...checkinSummary.out]
        .map((entry) => entry.player?.id)
        .filter(Boolean),
    );

    return teamRoster.filter((player) => !respondedIds.has(player.player_id));
  }, [checkinSummary, teamRoster]);

  const availabilitySections = React.useMemo(
    () => [
      { key: 'confirmed', label: 'In', color: colors.accentGreen, players: checkinSummary?.confirmed ?? [] },
      { key: 'tentative', label: 'Maybe', color: '#EAB308', players: checkinSummary?.tentative ?? [] },
      { key: 'out', label: 'Out', color: colors.accentRed, players: checkinSummary?.out ?? [] },
      { key: 'pending', label: 'Awaiting', color: colors.textSecondary, players: pendingRosterPlayers },
    ],
    [checkinSummary, pendingRosterPlayers],
  );

  React.useEffect(() => {
    async function load() {
      // Load game details
      const { data, error } = await supabase
        .from('games')
        .select(
          `*, 
           home_team:teams!games_home_team_id_fkey(name, primary_color, logo_url),
           away_team:teams!games_away_team_id_fkey(name, primary_color, logo_url)`,
        )
        .eq('id', gameId)
        .single();

      if (!error && data) {
        setGame(data as any);
        const g = data as any;
        const seasonId = g.season_id;
        const leagueId = g.league_id;
        const homeTeamId = g.home_team_id;
        const awayTeamId = g.away_team_id;
        const gameStatus = g.status;

        const [seriesData, playersData, goaliesData] = await Promise.all([
          getSeasonSeries(homeTeamId, awayTeamId, leagueId),
          getTopPlayers(homeTeamId, awayTeamId, seasonId),
          getGoalieStats(homeTeamId, awayTeamId, seasonId),
        ]);
        setSeasonSeries(seriesData);
        setTopPlayers(playersData);
        setGoalies(goaliesData);

        if (gameStatus === 'completed') {
          const scorers = await getGameGoalScorers(gameId);
          setGoalScorers(scorers);
        } else {
          setGoalScorers([]);
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: rosterData } = await supabase
            .from('team_rosters')
            .select('team_id')
            .eq('player_id', user.id)
            .eq('league_id', leagueId)
            .eq('status', 'active');

          const activeTeamIds = new Set(((rosterData as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id));
          const teamId = activeTeamIds.has(homeTeamId)
            ? homeTeamId
            : activeTeamIds.has(awayTeamId)
              ? awayTeamId
              : null;

          if (teamId) {
            setUserTeamId(teamId);

            const [checkins, summary, rosterRows] = await Promise.all([
              getMyCheckins(teamId),
              getGameCheckinSummary(gameId, teamId),
              getTeamRoster(teamId, leagueId),
            ]);
            setCheckinStatus(checkins[gameId] ?? null);
            setCheckinSummary(summary);
            setTeamRoster(rosterRows);
          } else {
            setUserTeamId(null);
            setCheckinStatus(null);
            setCheckinSummary(null);
            setTeamRoster([]);
          }
        } else {
          setUserTeamId(null);
          setCheckinStatus(null);
          setCheckinSummary(null);
          setTeamRoster([]);
        }
      }
      setLoading(false);
    }
    load();
  }, [gameId]);

  async function handleCheckin(status: CheckinStatus) {
    if (!userTeamId) return;
    // Optimistic update
    setCheckinStatus(status);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await updateCheckin(gameId, userTeamId, status);
    // Refresh summary
    const summary = await getGameCheckinSummary(gameId, userTeamId);
    setCheckinSummary(summary);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Game not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = mapGameStatus(game.status);
  const homeColor = game.home_team?.primary_color ?? colors.primary;
  const awayColor = game.away_team?.primary_color ?? colors.accentViolet;
  const homeName = game.home_team?.name ?? game.home_team_id;
  const awayName = game.away_team?.name ?? game.away_team_id;

  function openDirections() {
    if (!game?.location) return;
    const q = encodeURIComponent(game.location);
    Linking.openURL(`maps://?q=${q}`);
  }

  function openPlayerCard(playerId: string) {
    navigateToPlayerCard(navigation, { playerId, leagueId: game?.league_id ?? null });
  }

  const checkinOptions: { key: CheckinStatus; label: string; icon: string; activeColor: string }[] = [
    { key: 'confirmed', label: 'IN', icon: 'checkmark-circle', activeColor: colors.accentGreen },
    { key: 'tentative', label: 'MAYBE', icon: 'help-circle', activeColor: '#EAB308' },
    { key: 'out', label: 'OUT', icon: 'close-circle', activeColor: colors.accentRed },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <FocusScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero */}
        <FocusCard focusId={`preview:${gameId}:hero`} accentColor={awayColor} style={styles.heroCard}>
          <View style={[styles.teamStrip, { backgroundColor: awayColor + '33' }]}>
            <Text style={[styles.teamHeroLabel, { color: awayColor }]}>AWAY</Text>
            <TeamLogo
              teamId={game.away_team_id}
              logoUrl={game.away_team?.logo_url ?? null}
              teamName={awayName}
              primaryColor={awayColor}
              size={56}
            />
            <Text style={styles.teamHeroName}>{awayName}</Text>
          </View>
          <Text style={styles.vsText}>vs</Text>
          <View style={[styles.teamStrip, { backgroundColor: homeColor + '33' }]}>
            <Text style={[styles.teamHeroLabel, { color: homeColor }]}>HOME</Text>
            <TeamLogo
              teamId={game.home_team_id}
              logoUrl={game.home_team?.logo_url ?? null}
              teamName={homeName}
              primaryColor={homeColor}
              size={56}
            />
            <Text style={styles.teamHeroName}>{homeName}</Text>
          </View>
        </FocusCard>

        {/* Date/time */}
        <Text style={styles.dateTimeText}>{formatFullDate(game.scheduled_at)}</Text>

        {/* Status badge */}
        <View style={styles.badgeRow}>
          {status === 'Live' ? (
            <View style={styles.liveBadge}>
              <LiveDot />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          ) : (
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    status === 'Final' ? colors.badgeFinalBg : colors.badgeUpcomingBg,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  { color: status === 'Final' ? colors.badgeFinalText : colors.badgeUpcomingText },
                ]}
              >
                {status}
              </Text>
            </View>
          )}
        </View>

        {/* Score (Final/Live) */}
        {(status === 'Final' || status === 'Live') &&
          game.away_score != null &&
          game.home_score != null && (
            <FocusCard focusId={`preview:${gameId}:score`} accentColor={homeColor} style={styles.scoreCard}>
              <View style={styles.scoreTeamCol}>
                <Text style={styles.scoreTeamName}>{awayName}</Text>
                <Text style={[styles.bigScore, { color: awayColor }]}>{game.away_score}</Text>
              </View>
              <Text style={styles.scoreDash}>-</Text>
              <View style={styles.scoreTeamCol}>
                <Text style={styles.scoreTeamName}>{homeName}</Text>
                <Text style={[styles.bigScore, { color: homeColor }]}>{game.home_score}</Text>
              </View>
            </FocusCard>
          )}

        {/* Location */}
        {game.location && (
          <FocusCard focusId={`preview:${gameId}:location`} style={styles.locationCard}>
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={styles.locationText}>{game.location}</Text>
            <Pressable onPress={openDirections} style={styles.directionsBtn}>
              <Text style={styles.directionsBtnText}>Directions</Text>
            </Pressable>
          </FocusCard>
        )}

        {/* Check-in (Upcoming + user is on a team in this game) */}
        {status === 'Upcoming' && userTeamId && !isGuestLeague && (
          <FocusCard focusId={`preview:${gameId}:checkin`} style={styles.checkinCard}>
            <Text style={styles.checkinTitle}>Are you in?</Text>
            <View style={styles.checkinRow}>
              {checkinOptions.map((opt) => {
                const isSelected = checkinStatus === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.checkinBtn,
                      isSelected && { backgroundColor: opt.activeColor, borderColor: opt.activeColor },
                    ]}
                    onPress={() => handleCheckin(opt.key)}
                  >
                    <Ionicons
                      name={opt.icon as any}
                      size={20}
                      color={isSelected ? '#fff' : colors.textSecondary}
                    />
                    <Text style={[styles.checkinBtnText, isSelected && { color: '#fff' }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {checkinSummary && (
              <Text style={styles.checkinSummary}>
                ✓ {checkinSummary.confirmed.length} In · {checkinSummary.tentative.length} Maybe · {checkinSummary.out.length} Out
              </Text>
            )}
          </FocusCard>
        )}

        {status === 'Upcoming' && userTeamId && !isGuestLeague && checkinSummary && (
          <FocusCard focusId={`preview:${gameId}:availability`} style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>TEAM AVAILABILITY</Text>
            <Text style={styles.availabilityIntro}>
              Track who is in, who is out, and who still needs to respond before puck drop.
            </Text>

            <View style={styles.availabilityCountsRow}>
              {availabilitySections.map((section) => (
                <View key={section.key} style={styles.availabilityCountCard}>
                  <Text style={[styles.availabilityCountValue, { color: section.color }]}>
                    {section.players.length}
                  </Text>
                  <Text style={styles.availabilityCountLabel}>{section.label}</Text>
                </View>
              ))}
            </View>

            {availabilitySections.map((section) => {
              if (section.players.length === 0) return null;

              return (
                <View key={section.key} style={styles.availabilityGroup}>
                  <View style={styles.availabilityGroupHeader}>
                    <Text style={[styles.availabilityGroupTitle, { color: section.color }]}>
                      {section.label}
                    </Text>
                    <Text style={styles.availabilityGroupCount}>{section.players.length}</Text>
                  </View>

                  <View style={styles.availabilityList}>
                    {section.players.slice(0, 6).map((player: any) => {
                      const playerName =
                        'player_name' in player ? player.player_name : player.player?.full_name ?? 'Unknown';
                      const avatarUrl =
                        'avatar_url' in player ? player.avatar_url : player.player?.avatar_url ?? null;
                      const playerId =
                        'player_id' in player ? player.player_id : player.player?.id ?? null;

                      return (
                        <Pressable
                          key={`${section.key}-${playerId ?? playerName}`}
                          style={({ pressed }) => [styles.availabilityRow, pressed && playerId ? styles.availabilityRowPressed : undefined]}
                          onPress={() => playerId ? openPlayerCard(playerId) : undefined}
                          disabled={!playerId}
                        >
                          <Avatar uri={avatarUrl} name={playerName} size={32} />
                          <Text style={styles.availabilityPlayerName} numberOfLines={1}>
                            {playerName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {section.players.length > 6 ? (
                    <Text style={styles.availabilityOverflow}>
                      +{section.players.length - 6} more
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </FocusCard>
        )}

        {/* Add to Calendar */}
        {status === 'Upcoming' && (
          <Pressable
            style={styles.calendarBtn}
            onPress={() =>
              addGameToCalendar({
                homeTeam: homeName,
                awayTeam: awayName,
                scheduledAt: game.scheduled_at,
                location: game.location,
              })
            }
          >
            <Ionicons name="calendar-outline" size={18} color={colors.textOnPrimary} />
            <Text style={styles.calendarBtnText}>Add to Calendar</Text>
          </Pressable>
        )}

        {/* Top Players */}
        {topPlayers.length > 0 &&
          (() => {
            const awayPlayers = topPlayers.filter((p) => p.team_id === game.away_team_id).slice(0, 3);
            const homePlayers = topPlayers.filter((p) => p.team_id === game.home_team_id).slice(0, 3);
            return (
              <FocusCard focusId={`preview:${gameId}:top-players`} style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>TOP PLAYERS</Text>
                <View style={styles.twoColRow}>
                  <View style={styles.playerCol}>
                    <Text style={[styles.colHeader, { color: awayColor }]}>{awayName}</Text>
                    {awayPlayers.map((p) => (
                      <Pressable key={p.player_id} style={({ pressed }) => [styles.playerRow, pressed && styles.playerRowPressed]} onPress={() => openPlayerCard(p.player_id)}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          {p.full_name ?? '—'}
                        </Text>
                        <Text style={styles.playerStat}>
                          {p.goals}G {p.assists}A {p.points}PTS
                        </Text>
                      </Pressable>
                    ))}
                    {awayPlayers.length === 0 && <Text style={styles.emptyCol}>No data</Text>}
                  </View>
                  <View style={styles.colDivider} />
                  <View style={styles.playerCol}>
                    <Text style={[styles.colHeader, { color: homeColor }]}>{homeName}</Text>
                    {homePlayers.map((p) => (
                      <Pressable key={p.player_id} style={({ pressed }) => [styles.playerRow, pressed && styles.playerRowPressed]} onPress={() => openPlayerCard(p.player_id)}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          {p.full_name ?? '—'}
                        </Text>
                        <Text style={styles.playerStat}>
                          {p.goals}G {p.assists}A {p.points}PTS
                        </Text>
                      </Pressable>
                    ))}
                    {homePlayers.length === 0 && <Text style={styles.emptyCol}>No data</Text>}
                  </View>
                </View>
              </FocusCard>
            );
          })()}

        {/* In Goal */}
        {goalies.length > 0 &&
          (() => {
            const awayGoalie = goalies
              .filter((g) => g.team_id === game.away_team_id)
              .sort((a, b) => (b.games_played ?? 0) - (a.games_played ?? 0))[0];
            const homeGoalie = goalies
              .filter((g) => g.team_id === game.home_team_id)
              .sort((a, b) => (b.games_played ?? 0) - (a.games_played ?? 0))[0];
            if (!awayGoalie && !homeGoalie) return null;
            return (
              <FocusCard focusId={`preview:${gameId}:goalies`} style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>IN GOAL</Text>
                <View style={styles.twoColRow}>
                  <Pressable
                    style={({ pressed }) => [styles.goalieCard, { borderColor: awayColor + '66' }, pressed && styles.goalieCardPressed]}
                    onPress={() => awayGoalie?.player_id ? openPlayerCard(awayGoalie.player_id) : undefined}
                    disabled={!awayGoalie?.player_id}
                  >
                    <Text style={[styles.goalieTeam, { color: awayColor }]}>{awayName}</Text>
                    <Text style={styles.goalieName}>{awayGoalie?.full_name ?? '—'}</Text>
                    <Text style={styles.goalieStat}>
                      {awayGoalie ? `${awayGoalie.games_played ?? 0} GP` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.goalieCard, { borderColor: homeColor + '66' }, pressed && styles.goalieCardPressed]}
                    onPress={() => homeGoalie?.player_id ? openPlayerCard(homeGoalie.player_id) : undefined}
                    disabled={!homeGoalie?.player_id}
                  >
                    <Text style={[styles.goalieTeam, { color: homeColor }]}>{homeName}</Text>
                    <Text style={styles.goalieName}>{homeGoalie?.full_name ?? '—'}</Text>
                    <Text style={styles.goalieStat}>
                      {homeGoalie ? `${homeGoalie.games_played ?? 0} GP` : ''}
                    </Text>
                  </Pressable>
                </View>
              </FocusCard>
            );
          })()}

        {/* Season Series */}
        {seasonSeries.length > 0 &&
          (() => {
            let homeWins = 0,
              awayWins = 0,
              ties = 0;
            for (const g of seasonSeries) {
              const homeIsHome = g.home_team_id === game.home_team_id;
              const hScore = homeIsHome ? g.home_score : g.away_score;
              const aScore = homeIsHome ? g.away_score : g.home_score;
              if (hScore > aScore) homeWins++;
              else if (aScore > hScore) awayWins++;
              else ties++;
            }
            let seriesRecord = '';
            if (homeWins > awayWins)
              seriesRecord = `${homeName} leads ${homeWins}-${awayWins}${ties > 0 ? `-${ties}` : ''}`;
            else if (awayWins > homeWins)
              seriesRecord = `${awayName} leads ${awayWins}-${homeWins}${ties > 0 ? `-${ties}` : ''}`;
            else seriesRecord = `Tied ${homeWins}-${awayWins}`;

            return (
              <FocusCard focusId={`preview:${gameId}:series`} style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>SEASON SERIES</Text>
                <Text style={styles.seriesRecord}>{seriesRecord}</Text>
                {seasonSeries.map((g) => {
                  const homeIsHome = g.home_team_id === game.home_team_id;
                  const awayScore = homeIsHome ? g.away_score : g.home_score;
                  const homeScore = homeIsHome ? g.home_score : g.away_score;
                  const date = new Date(g.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <View key={g.id} style={styles.seriesRow}>
                      <Text style={styles.seriesDate}>{date}</Text>
                      <Text style={styles.seriesScore}>
                        {awayScore} – {homeScore}
                      </Text>
                    </View>
                  );
                })}
              </FocusCard>
            );
          })()}

        {/* Goal Scorers */}
        {status === 'Final' && goalScorers.length > 0 && (
          <FocusCard focusId={`preview:${gameId}:scorers`} style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>GOAL SCORERS</Text>
            {goalScorers.map((s) => (
              <Pressable key={s.player_id} style={({ pressed }) => [styles.scorerRow, pressed && styles.scorerRowPressed]} onPress={() => openPlayerCard(s.player_id)}>
                <Text style={styles.scorerName}>{s.full_name}</Text>
                <Text style={styles.scorerGoals}>{s.goals > 1 ? `${s.goals} goals` : '1 goal'}</Text>
              </Pressable>
            ))}
          </FocusCard>
        )}
      </FocusScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 16 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 16 },

  heroCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderCard,
    overflow: 'hidden',
    gap: 0,
  },
  teamStrip: {
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  teamHeroLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  teamHeroName: { fontSize: 26, fontWeight: '900', color: colors.textPrimary, textAlign: 'center' },
  vsText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    paddingVertical: 6,
    backgroundColor: colors.bgInteractive,
  },

  dateTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },

  badgeRow: { alignItems: 'center' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.badgeLiveBg,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveBadgeText: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusBadgeText: { fontWeight: '700', fontSize: 14 },

  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 24,
    gap: 24,
  },
  scoreTeamCol: { alignItems: 'center', flex: 1 },
  scoreTeamName: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
  bigScore: { fontSize: 56, fontWeight: '900' },
  scoreDash: { fontSize: 32, fontWeight: '300', color: colors.textSecondary },

  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 14,
    gap: 8,
  },
  locationText: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  directionsBtn: {
    backgroundColor: colors.bgInteractive,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  directionsBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  checkinCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
    gap: 12,
  },
  checkinTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  checkinRow: { flexDirection: 'row', gap: 10 },
  checkinBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  checkinBtnText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  checkinSummary: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  availabilityIntro: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  availabilityCountsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  availabilityCountCard: {
    flex: 1,
    minWidth: 72,
    backgroundColor: colors.bgInteractive,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  availabilityCountValue: { fontSize: 18, fontWeight: '900' },
  availabilityCountLabel: { marginTop: 2, color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  availabilityGroup: {
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
    paddingTop: 12,
    gap: 10,
  },
  availabilityGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  availabilityGroupTitle: { fontSize: 13, fontWeight: '800' },
  availabilityGroupCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  availabilityList: { gap: 8 },
  availabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  availabilityRowPressed: { backgroundColor: colors.bgInteractive },
  availabilityPlayerName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  availabilityOverflow: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },

  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  calendarBtnText: { fontSize: 15, fontWeight: '800', color: colors.textOnPrimary },
  sectionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  twoColRow: { flexDirection: 'row', gap: 12 },
  playerCol: { flex: 1, gap: 6 },
  colHeader: { fontSize: 12, fontWeight: '800', marginBottom: 2 },
  playerRow: { gap: 2, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  playerRowPressed: { backgroundColor: colors.bgInteractive },
  playerName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  playerStat: { fontSize: 11, color: colors.textSecondary },
  emptyCol: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic' },
  colDivider: { width: 1, backgroundColor: colors.borderCard },
  goalieCard: {
    flex: 1,
    backgroundColor: colors.bgInteractive,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  goalieCardPressed: {
    backgroundColor: colors.bgSurface,
  },
  goalieTeam: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  goalieName: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  goalieStat: { fontSize: 12, color: colors.textSecondary },
  seriesRecord: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  seriesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  seriesDate: { fontSize: 12, color: colors.textSecondary },
  seriesScore: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  scorerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  scorerRowPressed: { backgroundColor: colors.bgInteractive },
  scorerName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  scorerGoals: { fontSize: 12, color: colors.textSecondary },
});
