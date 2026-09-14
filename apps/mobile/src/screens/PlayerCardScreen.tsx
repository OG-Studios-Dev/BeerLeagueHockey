import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';

import Avatar from '../components/Avatar';
import BrandAtmosphere from '../components/BrandAtmosphere';
import RevealView from '../components/RevealView';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { PlayerCardParams } from '../navigation/types';
import { navigateToTeamDetail } from '../navigation/teamDetail';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';
import { getContrastTextColor } from '../theme/contrast';

type PlayerProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  position: string | null;
  self_assessed_skill: string | null;
};

type SeasonStat = {
  goals: number;
  assists: number;
  points: number;
  games_played: number;
  team_name: string | null;
  team_id: string | null;
};

type BadgeRow = {
  badge_type: string;
  league_id: string | null;
  awarded_at: string;
  league: { name: string; primary_color: string | null } | null;
};

type ActiveTeamCard = {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  leagueId: string;
  leagueName: string;
  leagueSlug: string | null;
  leagueLogoUrl: string | null;
  leaguePrimaryColor: string | null;
  jerseyNumber: number | null;
  position: string | null;
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

type PlayerRecentResult = {
  id: string;
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  scheduled_at: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
};

type LeagueInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
};

type StatTotals = {
  gp: number;
  g: number;
  a: number;
  pts: number;
};

type Props = {
  route: { params: PlayerCardParams };
  navigation: any;
};

function sumStats(rows: SeasonStat[]): StatTotals {
  return rows.reduce(
    (acc, row) => ({
      gp: acc.gp + (row.games_played ?? 0),
      g: acc.g + (row.goals ?? 0),
      a: acc.a + (row.assists ?? 0),
      pts: acc.pts + (row.points ?? 0),
    }),
    { gp: 0, g: 0, a: 0, pts: 0 },
  );
}

function badgeIcon(badgeType: string): keyof typeof Ionicons.glyphMap {
  const map: Record<string, keyof typeof Ionicons.glyphMap> = {
    championship: 'trophy',
    top_scorer: 'stats-chart',
    points_leader: 'stats-chart',
    division_top_scorer: 'stats-chart',
    division_points_leader: 'stats-chart',
    top_goalie: 'shield-checkmark',
    division_top_goalie: 'shield-checkmark',
    shutout_king: 'shield-checkmark',
    iron_man: 'fitness',
    most_assists: 'git-network',
    best_plus_minus: 'trending-up',
    penalty_free: 'checkmark-circle',
    team_mvp: 'star',
    rookie_of_the_year: 'star-outline',
    hall_of_fame: 'ribbon',
  };
  return map[badgeType] ?? 'medal-outline';
}

function badgeLabel(badgeType: string): string {
  return badgeType.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function skillLabel(skill: string | null): string | null {
  if (!skill) return null;
  return skill.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRecord(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function getGameResult(game: PlayerRecentResult, teamId: string) {
  if (game.home_score == null || game.away_score == null) return null;
  const isHome = game.home_team_id === teamId;
  const myScore = isHome ? game.home_score : game.away_score;
  const theirScore = isHome ? game.away_score : game.home_score;
  if (myScore > theirScore) return 'W';
  if (myScore < theirScore) return 'L';
  return 'T';
}

export default function PlayerCardScreen({ route, navigation }: Props) {
  const { playerId, leagueId: scopedLeagueIdParam = null } = route.params;
  const { width } = useWindowDimensions();
  const isCompact = width < 390;

  const [loading, setLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<PlayerProfile | null>(null);
  const [playerRating, setPlayerRating] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<SeasonStat[]>([]);
  const [activeTeams, setActiveTeams] = React.useState<ActiveTeamCard[]>([]);
  const [teamStandings, setTeamStandings] = React.useState<TeamStanding[]>([]);
  const [recentResults, setRecentResults] = React.useState<PlayerRecentResult[]>([]);
  const [badges, setBadges] = React.useState<BadgeRow[]>([]);
  const [scopeLeague, setScopeLeague] = React.useState<LeagueInfo | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [
        { data: profileData },
        { data: rawStatsData },
        { data: ratingData },
        { data: badgesData },
        { data: rosterRows },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_url, position, self_assessed_skill')
          .eq('id', playerId)
          .single(),
        supabase
          .from('player_season_stats')
          .select('goals, assists, points, games_played, team_name, team_id')
          .eq('player_id', playerId)
          .order('season_id', { ascending: false })
          .limit(50),
        supabase
          .from('player_ratings')
          .select('rating, league_id, points_per_game')
          .eq('player_id', playerId)
          .order('points_per_game', { ascending: false })
          .limit(20),
        supabase
          .from('player_badges')
          .select('badge_type, league_id, awarded_at, league:leagues(name, primary_color)')
          .eq('player_id', playerId)
          .order('awarded_at', { ascending: false }),
        supabase
          .from('team_rosters')
          .select(`
            team_id, league_id, jersey_number, position,
            team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color),
            league:leagues!team_rosters_league_id_fkey(id, name, slug, logo_url, primary_color)
          `)
          .eq('player_id', playerId)
          .eq('status', 'active'),
      ]);

      if (cancelled) return;

      setProfile((profileData as PlayerProfile | null) ?? null);

      const normalizedBadges: BadgeRow[] = ((badgesData as any[]) ?? []).map((badge) => ({
        badge_type: badge.badge_type,
        league_id: badge.league_id,
        awarded_at: badge.awarded_at,
        league: Array.isArray(badge.league) ? badge.league[0] ?? null : badge.league ?? null,
      }));
      setBadges(normalizedBadges);

      const rosterCards: ActiveTeamCard[] = ((rosterRows as any[]) ?? [])
        .map((row) => {
          const team = Array.isArray(row.team) ? row.team[0] : row.team;
          const league = Array.isArray(row.league) ? row.league[0] : row.league;
          if (!team || !league) return null;

          return {
            teamId: row.team_id,
            teamName: team.name,
            teamLogoUrl: team.logo_url ?? null,
            teamPrimaryColor: team.primary_color ?? null,
            leagueId: row.league_id,
            leagueName: league.name,
            leagueSlug: league.slug ?? null,
            leagueLogoUrl: league.logo_url ?? null,
            leaguePrimaryColor: league.primary_color ?? null,
            jerseyNumber: row.jersey_number ?? null,
            position: row.position ?? null,
          };
        })
        .filter(Boolean) as ActiveTeamCard[];

      setActiveTeams(rosterCards);

      const requestedScope = scopedLeagueIdParam && rosterCards.some((team) => team.leagueId === scopedLeagueIdParam)
        ? scopedLeagueIdParam
        : null;

      const rosterLeagueMap = new Map<string, LeagueInfo>();
      const teamLeagueMap = new Map<string, string>();

      for (const team of rosterCards) {
        rosterLeagueMap.set(team.leagueId, {
          id: team.leagueId,
          name: team.leagueName,
          logo_url: team.leagueLogoUrl,
          primary_color: team.leaguePrimaryColor,
        });
        teamLeagueMap.set(team.teamId, team.leagueId);
      }

      setScopeLeague(requestedScope ? rosterLeagueMap.get(requestedScope) ?? null : null);

      const ratings = (ratingData as Array<{ rating: string; league_id: string | null }>) ?? [];
      const scopedRating = requestedScope ? ratings.find((rating) => rating.league_id === requestedScope)?.rating ?? null : null;
      setPlayerRating(scopedRating ?? ratings[0]?.rating ?? null);

      const allStats = (rawStatsData as SeasonStat[] | null) ?? [];
      const statTeamIds = [...new Set(allStats.map((row) => row.team_id).filter(Boolean) as string[])];

      if (statTeamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from('teams')
          .select('id, league_id, league:leagues!teams_league_id_fkey(id, name, logo_url, primary_color)')
          .in('id', statTeamIds);

        if (cancelled) return;

        for (const team of (teamsData as any[]) ?? []) {
          const league = Array.isArray(team.league) ? team.league[0] : team.league;
          if (!league) continue;
          teamLeagueMap.set(team.id, league.id);
          if (!rosterLeagueMap.has(league.id)) {
            rosterLeagueMap.set(league.id, league as LeagueInfo);
          }
        }
      }

      setStats(
        requestedScope
          ? allStats.filter((row) => row.team_id && teamLeagueMap.get(row.team_id) === requestedScope)
          : allStats,
      );

      const activeTeamIds = rosterCards.map((team) => team.teamId);
      const activeLeagueIds = [...new Set(rosterCards.map((team) => team.leagueId))];

      if (activeTeamIds.length === 0 || activeLeagueIds.length === 0) {
        setTeamStandings([]);
        setRecentResults([]);
        setLoading(false);
        return;
      }

      const recentCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
      const teamCardMap = new Map(rosterCards.map((team) => [team.teamId, team]));

      const [standingsResponse, recentResultsResponse] = await Promise.all([
        supabase
          .from('team_standings')
          .select('team_id, wins, losses, ties, points, games_played')
          .in('team_id', activeTeamIds),
        supabase
          .from('games')
          .select(
            'id, league_id, scheduled_at, status, home_score, away_score, home_team_id, away_team_id, home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name)',
          )
          .in('league_id', activeLeagueIds)
          .eq('status', 'completed')
          .gte('scheduled_at', recentCutoff)
          .order('scheduled_at', { ascending: false })
          .limit(30),
      ]);

      if (cancelled) return;

      const dedupedStandings = new Map<string, TeamStanding>();
      for (const row of (standingsResponse.data as any[]) ?? []) {
        const team = teamCardMap.get(row.team_id);
        if (!team) continue;

        const current = dedupedStandings.get(row.team_id);
        const next: TeamStanding = {
          teamId: row.team_id,
          teamName: team.teamName,
          teamLogoUrl: team.teamLogoUrl,
          teamPrimaryColor: team.teamPrimaryColor,
          leagueId: team.leagueId,
          leagueName: team.leagueName,
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

      setTeamStandings(
        Array.from(dedupedStandings.values())
          .filter((standing) => !requestedScope || standing.leagueId === requestedScope)
          .sort((a, b) => b.points - a.points),
      );

      const normalizedResults = ((recentResultsResponse.data as any[]) ?? [])
        .map((game) => ({
          ...game,
          home_team: Array.isArray(game.home_team) ? game.home_team[0] ?? null : game.home_team ?? null,
          away_team: Array.isArray(game.away_team) ? game.away_team[0] ?? null : game.away_team ?? null,
        }))
        .map((game) => {
          const team = teamCardMap.get(game.home_team_id) ?? teamCardMap.get(game.away_team_id);
          if (!team) return null;

          return {
            id: game.id,
            leagueId: team.leagueId,
            leagueName: team.leagueName,
            teamId: team.teamId,
            teamName: team.teamName,
            scheduled_at: game.scheduled_at,
            home_score: game.home_score ?? null,
            away_score: game.away_score ?? null,
            home_team_id: game.home_team_id,
            away_team_id: game.away_team_id,
            home_team: game.home_team ?? null,
            away_team: game.away_team ?? null,
          } satisfies PlayerRecentResult;
        })
        .filter(Boolean)
        .filter((game) => !requestedScope || game!.leagueId === requestedScope) as PlayerRecentResult[];

      setRecentResults(normalizedResults);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [playerId, scopedLeagueIdParam]);

  const displayName = profile?.full_name ?? 'Player';
  const primaryTeam = scopeLeague
    ? activeTeams.find((team) => team.leagueId === scopeLeague.id) ?? activeTeams[0] ?? null
    : activeTeams[0] ?? null;
  const primaryColor = primaryTeam?.teamPrimaryColor ?? primaryTeam?.leaguePrimaryColor ?? colors.primary;
  const totals = React.useMemo(() => sumStats(stats), [stats]);
  const careerPpg = totals.gp > 0 ? (totals.pts / totals.gp).toFixed(2) : '--';
  const uniqueLeagueCount = new Set(activeTeams.map((team) => team.leagueId)).size;
  const visibleTeams = scopeLeague ? activeTeams.filter((team) => team.leagueId === scopeLeague.id) : activeTeams;
  const recentFormGames = recentResults.slice(0, 5);

  const recentFormSummary = React.useMemo(
    () =>
      recentFormGames.reduce(
        (summary, game) => {
          const result = getGameResult(game, game.teamId);
          if (result === 'W') summary.wins += 1;
          if (result === 'L') summary.losses += 1;
          if (result === 'T') summary.ties += 1;
          return summary;
        },
        { wins: 0, losses: 0, ties: 0 },
      ),
    [recentFormGames],
  );

  const shareMessage = React.useMemo(() => {
    const lines = [
      `${displayName} · BLH Player Card`,
      scopeLeague ? `League focus: ${scopeLeague.name}` : null,
      visibleTeams.length > 0 ? `Current teams: ${visibleTeams.map((team) => team.teamName).join(', ')}` : null,
      totals.gp > 0 ? `${totals.pts} points in ${totals.gp} games` : 'No season stats posted yet',
      playerRating ? `BLH rating: ${playerRating}` : skillLabel(profile?.self_assessed_skill ?? null) ? `League match level: ${skillLabel(profile?.self_assessed_skill ?? null)}` : null,
      'View this player in the Beer League Hockey app.',
    ].filter(Boolean);

    return lines.join('\n');
  }, [displayName, playerRating, profile?.self_assessed_skill, scopeLeague, totals.gp, totals.pts, visibleTeams]);

  const handleShare = async () => {
    await Share.share({
      title: `${displayName} · BLH Player Card`,
      message: shareMessage,
    });
  };

  const handleOpenTeam = (team: ActiveTeamCard) => {
    navigateToTeamDetail(navigation, { teamId: team.teamId, leagueId: team.leagueId });
  };

  const handleOpenLeagueSite = (team: ActiveTeamCard) => {
    if (!team.leagueSlug) return;
    Linking.openURL(`https://${team.leagueSlug}.beerleaguehockey.ca`).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <BrandAtmosphere accentColor={primaryColor} secondaryColor={colors.brandArena} intensity="medium" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FocusScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.contentActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Share player card" onPress={() => void handleShare()} style={styles.headerButton}>
              <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <RevealView delay={80}>
            <FocusCard focusId={`player:${playerId}:hero`} accentColor={primaryColor} style={[styles.heroCard, { borderLeftColor: primaryColor }]}>
              <LinearGradient
                colors={['rgba(255,255,255,0.08)', `${primaryColor}18`, 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGlow}
              />
              <View style={[styles.heroTopRow, isCompact && styles.heroTopRowCompact]}>
                <Avatar uri={profile?.avatar_url ?? null} name={displayName} size={78} borderColor={primaryColor} />
                <View style={styles.heroCopy}>
                  <Text style={styles.heroEyebrow}>PUBLIC PLAYER CARD</Text>
                  <Text style={styles.heroName}>{displayName}</Text>
                  <Text style={styles.heroSubtitle}>
                    {scopeLeague ? `${scopeLeague.name} focus` : 'Across Beer League Hockey'}
                  </Text>
                  <View style={[styles.heroMetaRow, isCompact && styles.heroMetaRowCompact]}>
                    {(primaryTeam?.position ?? profile?.position) ? (
                      <Text style={styles.positionBadge}>{primaryTeam?.position ?? profile?.position}</Text>
                    ) : null}
                    {primaryTeam?.jerseyNumber != null ? (
                      <Text style={[styles.jerseyBadge, { color: primaryColor }]}>#{primaryTeam.jerseyNumber}</Text>
                    ) : null}
                    {playerRating ? (
                      <View style={[styles.ratingBadge, { backgroundColor: `${primaryColor}22`, borderColor: primaryColor }]}>
                        <Text style={[styles.ratingBadgeText, { color: primaryColor }]}>{playerRating}</Text>
                      </View>
                    ) : skillLabel(profile?.self_assessed_skill ?? null) ? (
                      <View style={styles.skillBadge}>
                        <Ionicons name="sparkles-outline" size={12} color={colors.primary} />
                        <Text style={styles.skillBadgeText}>{skillLabel(profile?.self_assessed_skill ?? null)}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </FocusCard>
          </RevealView>

          <RevealView delay={120}>
            <FocusCard focusId={`player:${playerId}:metrics`} accentColor={primaryColor} style={[styles.heroMetricsRow, isCompact && styles.heroMetricsRowCompact]}>
              <View style={[styles.heroMetricCard, isCompact && styles.heroMetricCardCompact]}>
                <Text style={styles.heroMetricValue}>{uniqueLeagueCount}</Text>
                <Text style={styles.heroMetricLabel}>Leagues</Text>
              </View>
              <View style={[styles.heroMetricCard, isCompact && styles.heroMetricCardCompact]}>
                <Text style={styles.heroMetricValue}>{visibleTeams.length}</Text>
                <Text style={styles.heroMetricLabel}>{scopeLeague ? 'Teams Here' : 'Active Teams'}</Text>
              </View>
              <View style={[styles.heroMetricCard, isCompact && styles.heroMetricCardCompact]}>
                <Text style={styles.heroMetricValue}>{badges.length}</Text>
                <Text style={styles.heroMetricLabel}>Badges</Text>
              </View>
            </FocusCard>
          </RevealView>

          <RevealView delay={150}>
            <FocusCard focusId={`player:${playerId}:stats`} accentColor={primaryColor} style={styles.statsCard}>
            <Text style={styles.sectionEyebrow}>CAREER SNAPSHOT</Text>
            <View style={[styles.statsRow, isCompact && styles.statsRowCompact]}>
              {[
                { label: 'GP', value: totals.gp },
                { label: 'G', value: totals.g },
                { label: 'A', value: totals.a },
                { label: 'PTS', value: totals.pts },
              ].map((metric) => (
                <View key={metric.label} style={[styles.statCell, isCompact && styles.statCellCompact]}>
                  <Text style={[styles.statValue, metric.label === 'PTS' && { color: primaryColor }]}>{metric.value}</Text>
                  <Text style={styles.statLabel}>{metric.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.ppgRow}>
              <Text style={styles.ppgLabel}>Points Per Game</Text>
              <Text style={styles.ppgValue}>{careerPpg}</Text>
            </View>
            </FocusCard>
          </RevealView>

          {recentFormGames.length > 0 || teamStandings.length > 0 ? (
            <>
              <SectionHeader title="Season Radar" />
              <FocusCard focusId={`player:${playerId}:radar`} accentColor={primaryColor} style={styles.radarCard}>
                {recentFormGames.length > 0 ? (
                  <View style={styles.formCard}>
                    <View style={[styles.formHeader, isCompact && styles.formHeaderCompact]}>
                      <View>
                        <Text style={styles.formTitle}>Recent Form</Text>
                        <Text style={styles.formSubtitle}>Last {recentFormGames.length} completed games</Text>
                      </View>
                      <Text style={styles.formRecord}>
                        {formatRecord(recentFormSummary.wins, recentFormSummary.losses, recentFormSummary.ties)}
                      </Text>
                    </View>

                    <View style={styles.formChipsRow}>
                      {recentFormGames.map((game) => {
                        const result = getGameResult(game, game.teamId);
                        const color =
                          result === 'W'
                            ? colors.accentGreen
                            : result === 'L'
                              ? colors.accentRed
                              : colors.textSecondary;

                        return (
                          <View key={game.id} style={[styles.formChip, { backgroundColor: `${color}22`, borderColor: `${color}44` }]}>
                            <Text style={[styles.formChipText, { color }]}>{result ?? '-'}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {teamStandings.length > 0 ? (
                  <View style={styles.recordList}>
                    {teamStandings.map((standing, index) => {
                      const accentColor = standing.teamPrimaryColor ?? colors.primary;
                      const ppg = standing.gamesPlayed > 0 ? (standing.points / standing.gamesPlayed).toFixed(2) : '0.00';

                      return (
                        <View
                          key={standing.teamId}
                          style={[styles.recordRow, isCompact && styles.recordRowCompact, index < teamStandings.length - 1 && styles.recordRowBorder]}
                        >
                          <View style={styles.recordIdentity}>
                            <TeamLogo
                              teamId={standing.teamId}
                              logoUrl={standing.teamLogoUrl}
                              teamName={standing.teamName}
                              primaryColor={accentColor}
                              size={28}
                            />
                            <View style={styles.recordCopy}>
                              <Text style={styles.recordTeamName} numberOfLines={1}>{standing.teamName}</Text>
                              <Text style={styles.recordLeagueName} numberOfLines={1}>{standing.leagueName}</Text>
                            </View>
                          </View>

                          <View style={[styles.recordMetrics, isCompact && styles.recordMetricsCompact]}>
                            <View style={styles.recordMetric}>
                              <Text style={[styles.recordMetricValue, { color: accentColor }]}>
                                {formatRecord(standing.wins, standing.losses, standing.ties)}
                              </Text>
                              <Text style={styles.recordMetricLabel}>Record</Text>
                            </View>
                            <View style={styles.recordMetric}>
                              <Text style={styles.recordMetricValue}>{standing.points}</Text>
                              <Text style={styles.recordMetricLabel}>PTS</Text>
                            </View>
                            <View style={styles.recordMetric}>
                              <Text style={styles.recordMetricValue}>{ppg}</Text>
                              <Text style={styles.recordMetricLabel}>Pts/Game</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </FocusCard>
            </>
          ) : null}

          {visibleTeams.length > 0 ? (
            <>
              <SectionHeader title="Current Teams" />
              <View style={styles.teamList}>
                {visibleTeams.map((team) => {
                  const accentColor = team.teamPrimaryColor ?? team.leaguePrimaryColor ?? colors.primary;

                  return (
                    <FocusCard key={`${team.leagueId}-${team.teamId}`} focusId={`player:${playerId}:team:${team.leagueId}:${team.teamId}`} accentColor={accentColor} style={[styles.teamCard, { borderLeftColor: accentColor }]}>
                      <View style={[styles.teamCardTop, isCompact && styles.teamCardTopCompact]}>
                        <View style={styles.teamIdentity}>
                          <TeamLogo
                            teamId={team.teamId}
                            logoUrl={team.teamLogoUrl ?? team.leagueLogoUrl}
                            teamName={team.teamName}
                            primaryColor={accentColor}
                            size={40}
                          />
                          <View style={styles.teamCopy}>
                            <Text style={styles.teamName} numberOfLines={1}>{team.teamName}</Text>
                            <Text style={styles.teamLeagueName} numberOfLines={1}>{team.leagueName}</Text>
                          </View>
                        </View>
                        <View style={styles.teamBadges}>
                          {team.position ? <Text style={styles.teamPositionBadge}>{team.position}</Text> : null}
                          {team.jerseyNumber != null ? (
                            <Text style={[styles.teamJerseyBadge, { color: accentColor }]}>#{team.jerseyNumber}</Text>
                          ) : null}
                        </View>
                      </View>

                      <View style={[styles.teamActions, isCompact && styles.teamActionsCompact]}>
                        <Pressable style={[styles.primaryButton, { backgroundColor: accentColor }]} onPress={() => handleOpenTeam(team)}>
                          <Text style={[styles.primaryButtonText, { color: getContrastTextColor(accentColor) }]}>Open Team</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={() => handleOpenLeagueSite(team)} disabled={!team.leagueSlug}>
                          <Ionicons name="globe-outline" size={14} color={colors.primary} />
                          <Text style={styles.secondaryButtonText}>League Site</Text>
                        </Pressable>
                      </View>
                    </FocusCard>
                  );
                })}
              </View>
            </>
          ) : null}

          {badges.length > 0 ? (
            <>
              <SectionHeader title="Achievements" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgesScroll}>
                {badges.map((badge, index) => {
                  const badgeColor = badge.league?.primary_color ?? colors.primary;
                  return (
                    <View key={`${badge.badge_type}-${index}`} style={styles.badgeCard}>
                      <View style={[styles.badgeCircle, { backgroundColor: `${badgeColor}22`, borderColor: badgeColor }]}>
                        <Ionicons name={badgeIcon(badge.badge_type)} size={20} color={badgeColor} />
                      </View>
                      <Text style={styles.badgeTitle} numberOfLines={2}>{badgeLabel(badge.badge_type)}</Text>
                      <Text style={styles.badgeMeta} numberOfLines={1}>
                        {badge.league?.name ?? formatDate(badge.awarded_at)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {!profile && visibleTeams.length === 0 && totals.gp === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="person-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>No public player data yet</Text>
              <Text style={styles.emptySub}>
                This card will populate once the player has league profile, team, or stat data in BLH.
              </Text>
            </View>
          ) : null}
        </FocusScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgBase },
  contentActions: { minHeight: 44, flexDirection: 'row', justifyContent: 'flex-end' },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 0 },

  heroCard: {
    marginTop: 10,
    marginBottom: 12,
    backgroundColor: colors.bgSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    borderLeftWidth: 4,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroTopRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  heroName: { fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  heroSubtitle: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  heroMetaRowCompact: { alignItems: 'flex-start' },
  positionBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  jerseyBadge: { fontSize: 14, fontWeight: '800' },
  ratingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  ratingBadgeText: { fontSize: 12, fontWeight: '900' },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skillBadgeText: { fontSize: 11, fontWeight: '800', color: colors.textPrimary },
  heroMetricsRow: { flexDirection: 'row', gap: 8 },
  heroMetricsRowCompact: { flexWrap: 'wrap' },
  heroMetricCard: {
    flex: 1,
    backgroundColor: colors.glassHighlight,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  heroMetricCardCompact: { flexBasis: '31%' },
  heroMetricValue: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  heroMetricLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2, textAlign: 'center' },

  statsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    marginBottom: 12,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statsRowCompact: { flexWrap: 'wrap' },
  statCell: { flex: 1, minWidth: 0, alignItems: 'center' },
  statCellCompact: { flexBasis: '48%' },
  statValue: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  ppgRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ppgLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  ppgValue: { fontSize: 16, fontWeight: '900', color: colors.textPrimary },

  radarCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  formCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  formHeaderCompact: { alignItems: 'flex-start', flexDirection: 'column' },
  formTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  formSubtitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  formRecord: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  formChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  formChipText: { fontSize: 14, fontWeight: '900' },
  recordList: { gap: 0 },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  recordRowCompact: { alignItems: 'flex-start', flexDirection: 'column' },
  recordRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  recordIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  recordCopy: { flex: 1, minWidth: 0 },
  recordTeamName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  recordLeagueName: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  recordMetrics: { flexDirection: 'row', gap: 14 },
  recordMetricsCompact: { width: '100%', justifyContent: 'space-between' },
  recordMetric: { alignItems: 'center' },
  recordMetricValue: { fontSize: 15, fontWeight: '900', color: colors.textPrimary },
  recordMetricLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },

  teamList: { gap: 10, marginBottom: 12 },
  teamCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    borderLeftWidth: 4,
    padding: 14,
    gap: 10,
  },
  teamCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  teamCardTopCompact: { alignItems: 'flex-start', flexDirection: 'column' },
  teamIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  teamCopy: { flex: 1, minWidth: 0 },
  teamName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  teamLeagueName: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  teamBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  teamPositionBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.bgInteractive,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  teamJerseyBadge: { fontSize: 13, fontWeight: '800' },
  teamActions: { flexDirection: 'row', gap: 8 },
  teamActionsCompact: { flexDirection: 'column' },
  primaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { fontSize: 13, fontWeight: '800', color: colors.textOnPrimary },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgElevated,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '800', color: colors.primary },

  badgesScroll: { paddingHorizontal: 16, paddingBottom: 12, gap: 12, flexDirection: 'row' },
  badgeCard: { alignItems: 'center', width: 92, gap: 6 },
  badgeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTitle: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  badgeMeta: { fontSize: 10, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },

  emptyCard: {
    marginTop: 8,
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  emptySub: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
});
