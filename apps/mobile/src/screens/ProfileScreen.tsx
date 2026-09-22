import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Alert,
  Linking,
  ActivityIndicator,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusScrollView } from '../components/CardFocus';

import Avatar from '../components/Avatar';
import BrandAtmosphere from '../components/BrandAtmosphere';
import MembershipDiagnosticsCard from '../components/MembershipDiagnosticsCard';
import RevealView from '../components/RevealView';
import SectionHeader from '../components/SectionHeader';
import TeamLogo from '../components/TeamLogo';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { HOCKEY_LIFE_ID } from '../config/hockeyLife';
import { navigateToPlayerCard } from '../navigation/playerCard';
import { deleteCurrentAccount } from '../lib/supabase/accountDeletion';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';
import { getContrastTextColor } from '../theme/contrast';

type Profile = {
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

type RosterInfo = {
  jersey_number: number | null;
  position: string | null;
  team: { id: string; name: string; logo_url: string | null; primary_color: string | null } | null;
};

type RecentGame = {
  id: string;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
};

type PlayerRecentResult = {
  id: string;
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  isHomeTeam: boolean;
  scheduled_at: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
};

type BadgeRow = {
  badge_type: string;
  league_id: string | null;
  awarded_at: string;
  league: { name: string; primary_color: string | null } | null;
};

type LeagueInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
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

type StatTotals = { gp: number; g: number; a: number; pts: number };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  return badgeType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function skillLabel(skill: string | null): string | null {
  if (!skill) return null;
  return skill.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sumStats(rows: SeasonStat[]): StatTotals {
  return rows.reduce(
    (acc, s) => ({
      gp: acc.gp + (s.games_played ?? 0),
      g: acc.g + (s.goals ?? 0),
      a: acc.a + (s.assists ?? 0),
      pts: acc.pts + (s.points ?? 0),
    }),
    { gp: 0, g: 0, a: 0, pts: 0 },
  );
}

function getGameResult(game: { home_score: number | null; away_score: number | null; home_team_id: string; away_team_id: string }, teamId: string) {
  if (game.home_score == null || game.away_score == null) return null;
  const isHome = game.home_team_id === teamId;
  const myScore = isHome ? game.home_score : game.away_score;
  const theirScore = isHome ? game.away_score : game.home_score;
  if (myScore > theirScore) return 'W';
  if (myScore < theirScore) return 'L';
  return 'T';
}

function formatRecord(wins: number, losses: number, ties: number) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export default function ProfileScreen({ navigation }: { navigation: any }) {
  const { isGuest, exitGuest, signOut } = useAuth();
  const {
    activeLeague,
    activeTheme,
    membershipStatus,
    membershipDiagnostics,
    retryMemberships,
    exitGuestLeague,
  } = useLeague();
  const { width } = useWindowDimensions();
  const isCompact = width < 390;

  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [stats, setStats] = React.useState<SeasonStat[]>([]);
  const [roster, setRoster] = React.useState<RosterInfo | null>(null);
  const [recentGames, setRecentGames] = React.useState<RecentGame[]>([]);
  const [recentResults, setRecentResults] = React.useState<PlayerRecentResult[]>([]);
  const [userTeamId, setUserTeamId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [playerRating, setPlayerRating] = React.useState<string | null>(null);
  const [badges, setBadges] = React.useState<BadgeRow[]>([]);
  const [leagueMap, setLeagueMap] = React.useState<Record<string, LeagueInfo>>({});
  const [teamLeagueMap, setTeamLeagueMap] = React.useState<Record<string, string>>({});
  const [activeTeams, setActiveTeams] = React.useState<ActiveTeamCard[]>([]);
  const [teamStandings, setTeamStandings] = React.useState<TeamStanding[]>([]);
  const [isCaptain, setIsCaptain] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const isSigningOutRef = React.useRef(false);
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);
  const isDeletingAccountRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }

      const statsQuery = supabase
        .from('player_season_stats')
        .select('goals, assists, points, games_played, team_name, team_id')
        .eq('player_id', user.id)
        .order('season_id', { ascending: false })
        .limit(50);

      let ratingQuery = supabase
        .from('player_ratings')
        .select('rating, league_id, points_per_game')
        .eq('player_id', user.id)
        .order('points_per_game', { ascending: false })
        .limit(activeLeague ? 1 : 20);

      if (activeLeague) {
        ratingQuery = ratingQuery.eq('league_id', activeLeague.id) as typeof ratingQuery;
      }

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
          .eq('id', user.id)
          .single(),
        statsQuery,
        ratingQuery,
        supabase
          .from('player_badges')
          .select('badge_type, league_id, awarded_at, league:leagues(name, primary_color)')
          .eq('player_id', user.id)
          .eq('league_id', HOCKEY_LIFE_ID)
          .order('awarded_at', { ascending: false }),
        supabase
          .from('team_rosters')
          .select(`
            team_id, league_id, jersey_number, position,
            team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color),
            league:leagues!team_rosters_league_id_fkey(id, name, slug, logo_url, primary_color)
          `)
          .eq('player_id', user.id)
          .eq('league_id', HOCKEY_LIFE_ID)
          .eq('status', 'active'),
      ]);

      if (cancelled) return;

      // Check captain status
      const { data: captainData } = await supabase
        .from('team_rosters')
        .select('leadership_role')
        .eq('player_id', user.id)
        .eq('league_id', HOCKEY_LIFE_ID)
        .eq('status', 'active')
        .in('leadership_role', ['captain', 'alternate_captain'])
        .limit(1);
      setIsCaptain((captainData ?? []).length > 0);

      setProfile(profileData as Profile | null);

      const ratings =
        (ratingData as Array<{ rating: string; league_id: string | null; points_per_game: number | null }>) ?? [];
      setPlayerRating(ratings[0]?.rating ?? null);

      const normalizedBadges: BadgeRow[] =
        ((badgesData as Array<{
          badge_type: string;
          league_id: string | null;
          awarded_at: string;
          league: { name: string; primary_color: string | null } | { name: string; primary_color: string | null }[] | null;
        }>) ?? []).map((badge) => ({
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

      const teamIds = rosterCards.map((card) => card.teamId);
      const leagueIds = [...new Set(rosterCards.map((card) => card.leagueId))];
      const teamCardMap = new Map(rosterCards.map((card) => [card.teamId, card]));

      const rosterLeagueMap: Record<string, LeagueInfo> = {};
      const rosterTeamLeagueMap: Record<string, string> = {};
      for (const card of rosterCards) {
        rosterLeagueMap[card.leagueId] = {
          id: card.leagueId,
          name: card.leagueName,
          logo_url: card.leagueLogoUrl,
          primary_color: card.leaguePrimaryColor,
        };
        rosterTeamLeagueMap[card.teamId] = card.leagueId;
      }

      const activeLeagueRoster = activeLeague
        ? rosterCards.find((card) => card.leagueId === activeLeague.id) ?? null
        : null;

      if (activeLeagueRoster) {
        setRoster({
          jersey_number: activeLeagueRoster.jerseyNumber,
          position: activeLeagueRoster.position,
          team: {
            id: activeLeagueRoster.teamId,
            name: activeLeagueRoster.teamName,
            logo_url: activeLeagueRoster.teamLogoUrl,
            primary_color: activeLeagueRoster.teamPrimaryColor,
          },
        });
        setUserTeamId(activeLeagueRoster.teamId);
      } else {
        setRoster(null);
        setUserTeamId(null);
      }

      const allStats = (rawStatsData as SeasonStat[] | null) ?? [];

      if (allStats.length === 0) {
        setLeagueMap(rosterLeagueMap);
        setTeamLeagueMap(rosterTeamLeagueMap);
        setStats(
          rosterCards.map((card) => ({
            goals: 0,
            assists: 0,
            points: 0,
            games_played: 0,
            team_name: card.teamName,
            team_id: card.teamId,
          })),
        );
      } else {
        const teamIds = [...new Set(allStats.map((row) => row.team_id).filter(Boolean) as string[])];
        const { data: teamsData } =
          teamIds.length > 0
            ? await supabase
                .from('teams')
                .select('id, league_id, league:leagues!teams_league_id_fkey(id, name, logo_url, primary_color)')
                .in('id', teamIds)
            : { data: [] };

        if (cancelled) return;

        const nextLeagueMap = { ...rosterLeagueMap };
        const nextTeamLeagueMap = { ...rosterTeamLeagueMap };

        for (const team of (teamsData as any[]) ?? []) {
          const league = Array.isArray(team.league) ? team.league[0] : team.league;
          if (!league) continue;
          nextLeagueMap[league.id] = league as LeagueInfo;
          nextTeamLeagueMap[team.id] = league.id;
        }

        setLeagueMap(nextLeagueMap);
        setTeamLeagueMap(nextTeamLeagueMap);

        if (activeLeague) {
          const leagueTeamIds = Object.entries(nextTeamLeagueMap)
            .filter(([, leagueId]) => leagueId === activeLeague.id)
            .map(([teamId]) => teamId);
          setStats(allStats.filter((row) => row.team_id && leagueTeamIds.includes(row.team_id)));
        } else {
          setStats(allStats);
        }
      }

      if (teamIds.length === 0 || leagueIds.length === 0) {
        setTeamStandings([]);
        setRecentResults([]);
        setRecentGames([]);
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      const recentCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

      const [standingsResponse, recentResultsResponse] = await Promise.all([
        supabase
          .from('team_standings')
          .select('team_id, wins, losses, ties, points, games_played')
          .in('team_id', teamIds),
        supabase
          .from('games')
          .select(
            'id, league_id, scheduled_at, status, home_score, away_score, home_team_id, away_team_id, home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name)',
          )
          .in('league_id', leagueIds)
          .eq('status', 'completed')
          .gte('scheduled_at', recentCutoff)
          .order('scheduled_at', { ascending: false })
          .limit(24),
      ]);

      if (cancelled) return;

      const dedupedStandings = new Map<string, TeamStanding>();
      for (const row of (standingsResponse.data as any[]) ?? []) {
        const teamCard = teamCardMap.get(row.team_id);
        if (!teamCard) continue;

        const current = dedupedStandings.get(row.team_id);
        const nextStanding: TeamStanding = {
          teamId: row.team_id,
          teamName: teamCard.teamName,
          teamLogoUrl: teamCard.teamLogoUrl,
          teamPrimaryColor: teamCard.teamPrimaryColor,
          leagueId: teamCard.leagueId,
          leagueName: teamCard.leagueName,
          wins: Number(row.wins) || 0,
          losses: Number(row.losses) || 0,
          ties: Number(row.ties) || 0,
          points: Number(row.points) || 0,
          gamesPlayed: Number(row.games_played) || 0,
        };

        if (!current || nextStanding.gamesPlayed >= current.gamesPlayed) {
          dedupedStandings.set(row.team_id, nextStanding);
        }
      }
      setTeamStandings(Array.from(dedupedStandings.values()).sort((a, b) => b.points - a.points));

      const normalizedRecentResults = ((recentResultsResponse.data as any[]) ?? [])
        .map((game) => ({
          ...game,
          home_team: Array.isArray(game.home_team) ? game.home_team[0] ?? null : game.home_team ?? null,
          away_team: Array.isArray(game.away_team) ? game.away_team[0] ?? null : game.away_team ?? null,
        }))
        .map((game) => {
          const teamCard = teamCardMap.get(game.home_team_id) ?? teamCardMap.get(game.away_team_id);
          if (!teamCard) return null;

          return {
            id: game.id,
            leagueId: teamCard.leagueId,
            leagueName: teamCard.leagueName,
            teamId: teamCard.teamId,
            teamName: teamCard.teamName,
            isHomeTeam: teamCard.teamId === game.home_team_id,
            scheduled_at: game.scheduled_at,
            home_score: game.home_score ?? null,
            away_score: game.away_score ?? null,
            home_team_id: game.home_team_id,
            away_team_id: game.away_team_id,
            home_team: game.home_team ?? null,
            away_team: game.away_team ?? null,
          } satisfies PlayerRecentResult;
        })
        .filter(Boolean) as PlayerRecentResult[];

      setRecentResults(normalizedRecentResults);
      setRecentGames(
        activeLeague
          ? (normalizedRecentResults
              .filter((game) => game.leagueId === activeLeague.id)
              .slice(0, 5)
              .map((game) => ({
                id: game.id,
                scheduled_at: game.scheduled_at,
                status: 'completed',
                home_score: game.home_score,
                away_score: game.away_score,
                home_team_id: game.home_team_id,
                away_team_id: game.away_team_id,
                home_team: game.home_team,
                away_team: game.away_team,
              })) as RecentGame[])
          : [],
      );

      if (!cancelled) {
        setLoading(false);
      }
    }

    void load().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeLeague?.id]);

  const displayName = profile?.full_name ?? 'Player';
  const primaryColor = roster?.team?.primary_color ?? activeTheme.primaryColor;
  const teamName = roster?.team?.name ?? null;
  const totals = sumStats(stats);

  const leagueBreakdown = React.useMemo(() => {
    if (activeLeague) return [];

    const grouped: Record<string, SeasonStat[]> = {};
    for (const row of stats) {
      const leagueId = row.team_id ? teamLeagueMap[row.team_id] : null;
      if (!leagueId) continue;
      if (!grouped[leagueId]) grouped[leagueId] = [];
      grouped[leagueId].push(row);
    }

    return Object.entries(grouped).map(([leagueId, rows]) => ({
      league:
        leagueMap[leagueId] ?? {
          id: leagueId,
          name: 'Unknown League',
          logo_url: null,
          primary_color: null,
        },
      totals: sumStats(rows),
    }));
  }, [activeLeague, leagueMap, stats, teamLeagueMap]);

  const statsSectionTitle = activeLeague ? `${activeLeague.name} Stats` : 'Career Stats';
  const careerPpg = totals.gp > 0 ? (totals.pts / totals.gp).toFixed(2) : '--';
  const fitProfile = playerRating ? `${playerRating} rating` : skillLabel(profile?.self_assessed_skill ?? null) ?? 'Set your skill';

  const passportMetrics = React.useMemo(
    () => [
      { label: 'Active Seasons', value: String(new Set(activeTeams.map((team) => team.leagueId)).size) },
      { label: 'Active Teams', value: String(activeTeams.length) },
      { label: 'Career PPG', value: careerPpg },
      { label: 'Badges', value: String(badges.length) },
    ],
    [activeTeams, badges.length, careerPpg],
  );

  const scopedStandings = React.useMemo(
    () => (activeLeague ? teamStandings.filter((standing) => standing.leagueId === activeLeague.id) : teamStandings),
    [activeLeague, teamStandings],
  );

  const recentFormGames = React.useMemo(
    () =>
      (activeLeague ? recentResults.filter((game) => game.leagueId === activeLeague.id) : recentResults).slice(0, 5),
    [activeLeague, recentResults],
  );

  const recentFormSummary = React.useMemo(() => {
    return recentFormGames.reduce(
      (summary, game) => {
        const result = getGameResult(game, game.teamId);
        if (result === 'W') summary.wins += 1;
        if (result === 'L') summary.losses += 1;
        if (result === 'T') summary.ties += 1;
        return summary;
      },
      { wins: 0, losses: 0, ties: 0 },
    );
  }, [recentFormGames]);

  const recentFormChips = React.useMemo(
    () =>
      recentFormGames.map((game) => ({
        id: game.id,
        result: getGameResult(game, game.teamId),
        teamName: game.teamName,
      })),
    [recentFormGames],
  );

  const playerCardMessage = React.useMemo(() => {
    const activeTeamNames = activeTeams.map((team) => `${team.teamName} (${team.leagueName})`).slice(0, 3);
    const lines = [
      `${displayName} on Hockey Life`,
      activeTeamNames.length > 0 ? `Playing for ${activeTeamNames.join(', ')}` : 'Hockey Life player account',
      totals.gp > 0 ? `${totals.pts} points in ${totals.gp} games` : null,
      playerRating ? `Hockey Life rating: ${playerRating}` : skillLabel(profile?.self_assessed_skill ?? null) ? `League match level: ${skillLabel(profile?.self_assessed_skill ?? null)}` : null,
      badges.length > 0 ? `${badges.length} Hockey Life achievements earned` : null,
      'Track Hockey Life games, teams, and stats in the app.',
    ].filter(Boolean);

    return lines.join('\n');
  }, [activeTeams, badges.length, displayName, playerRating, profile?.self_assessed_skill, totals.gp, totals.pts]);

  const handleSharePlayerCard = async () => {
    await Share.share({
      title: `${displayName} · Hockey Life Player Card`,
      message: playerCardMessage,
    });
  };

  const handleOpenTeam = async (team: ActiveTeamCard) => {
    navigation.navigate('Team', {
      screen: 'TeamDetail',
      params: { teamId: team.teamId, leagueId: team.leagueId },
    });
  };

  const handleOpenLeagueSite = (team: ActiveTeamCard) => {
    if (!team.leagueSlug) return;
    Linking.openURL(`https://${team.leagueSlug}.beerleaguehockey.ca`).catch(() => {});
  };

  const handleAccountAction = () => {
    if (isSigningOutRef.current || isDeletingAccountRef.current) return;

    if (isGuest) {
      exitGuestLeague();
      exitGuest();
      return;
    }

    Alert.alert(
      'Log Out?',
      'You will need to sign in again to access your teams and private league information on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            if (isSigningOutRef.current) return;
            isSigningOutRef.current = true;
            setIsSigningOut(true);
            try {
              const { error } = await signOut();
              if (error) {
                Alert.alert('Unable to Log Out', error.message);
              }
            } finally {
              isSigningOutRef.current = false;
              setIsSigningOut(false);
            }
          },
        },
      ],
    );
  };

  const performAccountDeletion = async () => {
    if (isDeletingAccountRef.current) return;
    isDeletingAccountRef.current = true;
    setIsDeletingAccount(true);

    try {
      const { error } = await deleteCurrentAccount();
      if (error) {
        Alert.alert('Unable to Delete Account', error.message);
        return;
      }

      const { error: signOutError } = await signOut();
      if (signOutError) {
        Alert.alert(
          'Account Deleted',
          'Your account was deleted, but this device could not finish signing out. Close and reopen the app.',
        );
      }
    } finally {
      isDeletingAccountRef.current = false;
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    if (isGuest || isDeletingAccountRef.current || isSigningOutRef.current) return;

    Alert.alert(
      'Delete Account?',
      'This permanently deletes your sign-in, profile, memberships, and personal account data. Legally required records may be retained only in anonymized form.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Permanently Delete Account?',
              'This cannot be undone. You will lose access to every team and league connected to this account.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: performAccountDeletion,
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeTheme.backgroundColor }]} edges={['top', 'left', 'right']}>
      <BrandAtmosphere accentColor={primaryColor} secondaryColor={activeTheme.secondaryColor} intensity="medium" />
      <View style={styles.accountActionBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isGuest ? 'Sign in' : 'Log out'}
          accessibilityState={{ busy: isSigningOut, disabled: isSigningOut || isDeletingAccount }}
          disabled={isSigningOut || isDeletingAccount}
          hitSlop={6}
          style={({ pressed }) => [
            styles.accountActionButton,
            pressed && !isSigningOut && !isDeletingAccount && styles.accountActionButtonPressed,
          ]}
          onPress={handleAccountAction}
        >
          {isSigningOut ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Ionicons name={isGuest ? 'log-in-outline' : 'log-out-outline'} size={18} color={colors.textPrimary} />
          )}
          <Text style={styles.accountActionText}>
            {isSigningOut ? 'Signing Out…' : isGuest ? 'Sign In' : 'Log Out'}
          </Text>
        </Pressable>
      </View>
      <MembershipDiagnosticsCard
        diagnostics={membershipDiagnostics}
        status={membershipStatus}
        onRetry={retryMemberships}
      />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={activeTheme.primaryColor} />
        </View>
      ) : (
        <FocusScrollView focusScopeKey={`profile:${activeLeague?.id ?? 'global'}`} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <RevealView delay={40}>
            <FocusCard
              focusId="profile:identity"
              accentColor={primaryColor}
              style={[
                styles.headerCard,
                isCompact && styles.headerCardCompact,
                {
                  backgroundColor: colors.bgSurface,
                  borderColor: colors.glassStrokeStrong,
                  borderLeftColor: primaryColor,
                },
              ]}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0.08)', `${primaryColor}18`, 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGlow}
              />
              <Avatar uri={profile?.avatar_url ?? null} name={displayName} size={72} borderColor={primaryColor} />
              <View style={styles.headerInfo}>
                <Text style={styles.name}>{displayName}</Text>
                <View style={[styles.metaRow, isCompact && styles.metaRowCompact]}>
                  {roster?.jersey_number != null ? (
                    <Text style={[styles.jersey, { color: primaryColor }]}>#{roster.jersey_number}</Text>
                  ) : null}
                  {(roster?.position ?? profile?.position) != null ? (
                    <Text style={styles.positionBadge}>{roster?.position ?? profile?.position}</Text>
                  ) : null}
                  {playerRating !== null ? (
                    <View style={[styles.ratingBadge, { backgroundColor: `${primaryColor}33`, borderColor: primaryColor }]}>
                      <Text style={[styles.ratingBadgeText, { color: primaryColor }]}>{playerRating}</Text>
                    </View>
                  ) : null}
                  {playerRating == null && profile?.self_assessed_skill ? (
                    <View style={styles.skillBadge}>
                      <Ionicons name="sparkles-outline" size={12} color={colors.primary} />
                      <Text style={styles.skillBadgeText}>{skillLabel(profile.self_assessed_skill)}</Text>
                    </View>
                  ) : null}
                </View>
                {teamName != null ? (
                  <View style={styles.teamBadge}>
                    <TeamLogo
                      teamId={roster?.team?.id ?? null}
                      logoUrl={roster?.team?.logo_url ?? null}
                      teamName={teamName}
                      primaryColor={primaryColor}
                      size={18}
                    />
                    <Text style={styles.teamName}>{teamName}</Text>
                  </View>
                ) : (
                  <Text style={styles.teamName}>Hockey Life player account</Text>
                )}
              </View>
            </FocusCard>
          </RevealView>

          <SectionHeader title="Player Passport" />
          <RevealView delay={90}>
            <FocusCard focusId="profile:passport" accentColor={primaryColor} style={[styles.passportCard, { backgroundColor: colors.bgSurface, borderColor: colors.glassStrokeStrong }]}>
              <LinearGradient
                colors={['rgba(255,255,255,0.08)', 'rgba(79,216,255,0.05)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.passportGlow}
              />
              <Text style={styles.passportEyebrow}>HOCKEY LIFE PLAYER</Text>
              <Text style={styles.passportTitle}>Your current player snapshot.</Text>
              <Text style={styles.passportSub}>
                Track your team, career trend, and Hockey Life player rating.
              </Text>

              <View style={[styles.passportGrid, isCompact && styles.passportGridCompact]}>
                {passportMetrics.map((metric) => (
                  <View key={metric.label} style={[styles.passportMetric, isCompact && styles.passportMetricCompact]}>
                    <Text style={styles.passportMetricValue}>{metric.value}</Text>
                    <Text style={styles.passportMetricLabel}>{metric.label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.fitProfileCard}>
                <Ionicons name="compass-outline" size={16} color={colors.primary} />
                <View style={styles.fitProfileInfo}>
                  <Text style={styles.fitProfileLabel}>League Match Signal</Text>
                  <Text style={styles.fitProfileValue}>{fitProfile}</Text>
                </View>
                <Pressable style={styles.fitProfileButton} onPress={() => navigation.navigate('EditProfile')}>
                  <Text style={styles.fitProfileButtonText}>Update</Text>
                </Pressable>
              </View>

              <View style={[styles.passportActions, isCompact && styles.passportActionsCompact]}>
                <Pressable
                  style={[styles.passportActionButton, isCompact && styles.passportActionButtonCompact]}
                  onPress={() => profile?.id ? navigateToPlayerCard(navigation, { playerId: profile.id, leagueId: activeLeague?.id ?? null }) : undefined}
                  disabled={!profile?.id}
                >
                  <Ionicons name="person-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.passportActionButtonText}>Open Public Card</Text>
                </Pressable>
                <Pressable style={[styles.passportActionButton, styles.passportActionButtonGhost, isCompact && styles.passportActionButtonCompact]} onPress={() => void handleSharePlayerCard()}>
                  <Ionicons name="share-social-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.passportActionButtonText}>Share Player Card</Text>
                </Pressable>
              </View>
            </FocusCard>
          </RevealView>

          <FocusCard focusId="profile:stats" accentColor={primaryColor} style={[styles.statsCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
            <Text style={styles.statsLabel}>{statsSectionTitle.toUpperCase()}</Text>
            <View style={[styles.statsRow, isCompact && styles.statsRowCompact]}>
              {(
                [
                  { label: 'GP', value: totals.gp },
                  { label: 'G', value: totals.g },
                  { label: 'A', value: totals.a },
                  { label: 'PTS', value: totals.pts },
                ] as Array<{ label: string; value: number | string }>
              ).map(({ label, value }) => (
                <View key={label} style={[styles.statCell, isCompact && styles.statCellCompact]}>
                  <Text style={[styles.statNumber, label === 'PTS' && { color: primaryColor }]}>{value}</Text>
                  <Text style={styles.statLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </FocusCard>

          {scopedStandings.length > 0 || recentFormGames.length > 0 ? (
            <>
              <SectionHeader title="Season Radar" />
              <FocusCard focusId="profile:season-radar" accentColor={primaryColor} style={[styles.seasonRadarCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
                {recentFormGames.length > 0 ? (
                  <View style={styles.formSummaryCard}>
                    <View style={[styles.formSummaryHeader, isCompact && styles.formSummaryHeaderCompact]}>
                      <View>
                        <Text style={styles.formSummaryLabel}>Recent Form</Text>
                        <Text style={styles.formSummaryValue}>
                          {formatRecord(recentFormSummary.wins, recentFormSummary.losses, recentFormSummary.ties)}
                        </Text>
                      </View>
                      <Text style={styles.formSummaryMeta}>Last {recentFormGames.length} completed games</Text>
                    </View>

                    <View style={styles.formChipsRow}>
                      {recentFormChips.map((chip) => {
                        const color =
                          chip.result === 'W'
                            ? colors.accentGreen
                            : chip.result === 'L'
                              ? colors.accentRed
                              : colors.textSecondary;

                        return (
                          <View key={chip.id} style={[styles.formChip, { backgroundColor: `${color}22`, borderColor: `${color}44` }]}>
                            <Text style={[styles.formChipText, { color }]}>{chip.result ?? '-'}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {scopedStandings.length > 0 ? (
                  <View style={styles.standingsList}>
                    {scopedStandings.map((standing, index) => {
                      const accentColor = standing.teamPrimaryColor ?? colors.primary;

                      return (
                        <View
                          key={standing.teamId}
                          style={[styles.standingRow, isCompact && styles.standingRowCompact, index < scopedStandings.length - 1 && styles.standingRowBorder]}
                        >
                          <View style={styles.standingIdentity}>
                            <TeamLogo
                              teamId={standing.teamId}
                              logoUrl={standing.teamLogoUrl}
                              teamName={standing.teamName}
                              primaryColor={accentColor}
                              size={28}
                            />
                            <View style={styles.standingCopy}>
                              <Text style={styles.standingTeamName} numberOfLines={1}>
                                {standing.teamName}
                              </Text>
                              <Text style={styles.standingLeagueName} numberOfLines={1}>
                                {standing.leagueName}
                              </Text>
                            </View>
                          </View>

                          <View style={[styles.standingMetrics, isCompact && styles.standingMetricsCompact]}>
                            <View style={styles.standingMetric}>
                              <Text style={[styles.standingMetricValue, { color: accentColor }]}>
                                {formatRecord(standing.wins, standing.losses, standing.ties)}
                              </Text>
                              <Text style={styles.standingMetricLabel}>Record</Text>
                            </View>
                            <View style={styles.standingMetric}>
                              <Text style={styles.standingMetricValue}>{standing.points}</Text>
                              <Text style={styles.standingMetricLabel}>Points</Text>
                            </View>
                            <View style={styles.standingMetric}>
                              <Text style={styles.standingMetricValue}>{standing.gamesPlayed}</Text>
                              <Text style={styles.standingMetricLabel}>GP</Text>
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

          {activeTeams.length > 0 ? (
            <>
              <SectionHeader title="Current Teams" />
              <View style={styles.currentTeamsList}>
                {activeTeams.map((team) => {
                  const accentColor = team.teamPrimaryColor ?? team.leaguePrimaryColor ?? colors.primary;
                  const isSelectedLeague = activeLeague?.id === team.leagueId;

                  return (
                    <FocusCard
                      key={`${team.leagueId}-${team.teamId}`}
                      focusId={`profile:team:${team.leagueId}:${team.teamId}`}
                      accentColor={accentColor}
                      style={[
                        styles.currentTeamCard,
                        {
                          backgroundColor: colors.bgSurface,
                          borderColor: colors.borderCard,
                          borderLeftColor: accentColor,
                        },
                      ]}
                    >
                      <View style={[styles.currentTeamHeader, isCompact && styles.currentTeamHeaderCompact]}>
                        <View style={styles.currentTeamIdentity}>
                          <TeamLogo
                            teamId={team.teamId}
                            logoUrl={team.teamLogoUrl ?? team.leagueLogoUrl}
                            teamName={team.teamName}
                            primaryColor={accentColor}
                            size={42}
                          />
                          <View style={styles.currentTeamCopy}>
                            <Text style={styles.currentTeamName} numberOfLines={1}>
                              {team.teamName}
                            </Text>
                            <Text style={styles.currentLeagueName} numberOfLines={1}>
                              {team.leagueName}
                            </Text>
                          </View>
                        </View>

                        {isSelectedLeague ? (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>Current League</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.currentTeamMeta}>
                        {team.position ?? profile?.position ?? 'Skater'}
                        {team.jerseyNumber != null ? ` · #${team.jerseyNumber}` : ''}
                        {team.leagueSlug ? ` · ${team.leagueSlug}.beerleaguehockey.ca` : ''}
                      </Text>

                      <View style={[styles.currentTeamActions, isCompact && styles.currentTeamActionsCompact]}>
                        <Pressable
                          style={[styles.currentTeamPrimaryButton, { backgroundColor: accentColor }]}
                          onPress={() => void handleOpenTeam(team)}
                        >
                          <Text style={[styles.currentTeamPrimaryButtonText, { color: getContrastTextColor(accentColor) }]}>Open Team</Text>
                        </Pressable>

                        <Pressable
                          style={styles.currentTeamSecondaryButton}
                          onPress={() => handleOpenLeagueSite(team)}
                          disabled={!team.leagueSlug}
                        >
                          <Ionicons name="globe-outline" size={14} color={colors.primary} />
                          <Text style={styles.currentTeamSecondaryButtonText}>League Site</Text>
                        </Pressable>
                      </View>
                    </FocusCard>
                  );
                })}
              </View>
            </>
          ) : null}

          {!activeLeague && leagueBreakdown.length > 0 ? (
            <>
              <SectionHeader title="By League" />
              <FocusCard focusId="profile:league-breakdown" accentColor={primaryColor} style={[styles.leagueBreakdownCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
                {leagueBreakdown.map((row, index) => {
                  const leagueColor = row.league.primary_color ?? colors.primary;

                  return (
                    <View
                      key={row.league.id}
                      style={[styles.leagueRow, isCompact && styles.leagueRowCompact, index < leagueBreakdown.length - 1 && styles.leagueRowBorder]}
                    >
                      <View style={styles.leagueRowLeft}>
                        <TeamLogo
                          logoUrl={row.league.logo_url}
                          teamName={row.league.name}
                          primaryColor={leagueColor}
                          size={24}
                        />
                        <Text style={[styles.leagueName, { color: leagueColor }]} numberOfLines={1}>
                          {row.league.name}
                        </Text>
                      </View>

                      <View style={[styles.leagueRowStats, isCompact && styles.leagueRowStatsCompact]}>
                        {(
                          [
                            { label: 'GP', val: row.totals.gp },
                            { label: 'G', val: row.totals.g },
                            { label: 'A', val: row.totals.a },
                            { label: 'PTS', val: row.totals.pts },
                          ] as Array<{ label: string; val: number }>
                        ).map(({ label, val }) => (
                          <View key={label} style={styles.leagueStatCell}>
                            <Text style={[styles.leagueStatVal, label === 'PTS' && { color: leagueColor }]}>{val}</Text>
                            <Text style={styles.leagueStatLabel}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </FocusCard>
            </>
          ) : null}

          {badges.length > 0 ? (
            <>
              <SectionHeader title="Achievements" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgesScroll}>
                {badges.map((badge, index) => {
                  const badgeColor = badge.league?.primary_color ?? colors.primary;

                  return (
                    <View key={`${badge.badge_type}-${index}`} style={styles.badgeChip}>
                      <View
                        style={[
                          styles.badgeIconCircle,
                          { backgroundColor: `${badgeColor}22`, borderColor: badgeColor },
                        ]}
                      >
                        <Ionicons name={badgeIcon(badge.badge_type)} size={20} color={badgeColor} />
                      </View>
                      <Text style={styles.badgeChipLabel} numberOfLines={2}>
                        {badgeLabel(badge.badge_type)}
                      </Text>
                      <Text style={styles.badgeChipMeta} numberOfLines={1}>
                        {badge.league?.name ?? formatDate(badge.awarded_at)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {activeLeague != null && recentGames.length > 0 ? (
            <>
              <SectionHeader title="Recent Scores" />
              <FocusCard focusId="profile:recent-games" accentColor={primaryColor} style={[styles.gamesCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
                {recentGames.map((game, index) => {
                  const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
                  const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
                  const awayName = (awayTeam as { name: string } | null)?.name ?? '?';
                  const homeName = (homeTeam as { name: string } | null)?.name ?? '?';
                  const isHome = game.home_team_id === userTeamId;
                  const myScore = isHome ? game.home_score : game.away_score;
                  const theirScore = isHome ? game.away_score : game.home_score;
                  const result =
                    myScore != null && theirScore != null
                      ? myScore > theirScore
                        ? 'W'
                        : myScore < theirScore
                          ? 'L'
                          : 'T'
                      : null;
                  const resultColor =
                    result === 'W'
                      ? colors.accentGreen
                      : result === 'L'
                        ? colors.accentRed
                        : colors.textSecondary;

                  return (
                    <View
                      key={game.id}
                      style={[styles.gameRow, isCompact && styles.gameRowCompact, index < recentGames.length - 1 && styles.gameRowBorder]}
                    >
                      <View
                        style={[
                          styles.resultBadge,
                          { backgroundColor: result ? `${resultColor}22` : colors.bgInteractive },
                        ]}
                      >
                        <Text style={[styles.resultText, { color: result ? resultColor : colors.textSecondary }]}>
                          {result ?? '-'}
                        </Text>
                      </View>
                      <View style={styles.gameInfo}>
                        <Text style={styles.gameTeams} numberOfLines={1}>
                          {awayName} @ {homeName}
                        </Text>
                        <Text style={styles.gameDate}>{formatDate(game.scheduled_at)}</Text>
                      </View>
                      {game.away_score != null && game.home_score != null ? (
                        <Text style={styles.gameScore}>
                          {game.away_score} - {game.home_score}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </FocusCard>
            </>
          ) : null}

          <SectionHeader title="Settings" />
          <FocusCard focusId="profile:settings" accentColor={primaryColor} style={[styles.settingsCard, { backgroundColor: colors.bgSurface, borderColor: colors.borderCard }]}>
            <Pressable style={styles.settingRow} onPress={() => navigation.navigate('NotificationsFeed')}>
              <Ionicons name="notifications-outline" size={18} color={primaryColor} />
              <Text style={styles.settingLabel}>Updates &amp; Alerts</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.settingRow} onPress={() => navigation.navigate('NotificationSettings')}>
              <Ionicons name="settings-outline" size={18} color={primaryColor} />
              <Text style={styles.settingLabel}>Notification Preferences</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.settingRow} onPress={() => navigation.navigate('CareerStats')}>
              <Ionicons name="trophy-outline" size={18} color={primaryColor} />
              <Text style={styles.settingLabel}>Career Stats</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            {isCaptain && (
              <Pressable
                style={styles.settingRow}
                onPress={() => {
                  // Navigate to Captain tab
                  const parent = navigation.getParent();
                  if (parent) {
                    parent.navigate('Captain');
                  }
                }}
              >
                <MaterialCommunityIcons name="shield-crown-outline" size={18} color={colors.brandGold} />
                <Text style={styles.settingLabel}>Captain Dashboard</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
            <Pressable style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={() => navigation.navigate('EditProfile')}>
              <Ionicons name="create-outline" size={18} color={primaryColor} />
              <Text style={styles.settingLabel}>Player Preferences</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            {!isGuest ? (
              <Pressable
                testID="account-delete-button"
                accessibilityRole="button"
                accessibilityLabel="Delete account"
                accessibilityState={{ busy: isDeletingAccount, disabled: isDeletingAccount || isSigningOut }}
                disabled={isDeletingAccount || isSigningOut}
                style={[styles.settingRow, styles.deleteAccountRow]}
                onPress={handleDeleteAccount}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color={colors.accentRed} />
                ) : (
                  <Ionicons name="trash-outline" size={18} color={colors.accentRed} />
                )}
                <View style={styles.deleteAccountCopy}>
                  <Text style={styles.deleteAccountLabel}>
                    {isDeletingAccount ? 'Deleting Account…' : 'Delete Account'}
                  </Text>
                  <Text style={styles.deleteAccountMeta}>Permanently remove your account and personal data</Text>
                </View>
              </Pressable>
            ) : null}
          </FocusCard>
        </FocusScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 0 },
  accountActionBar: {
    zIndex: 1,
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  accountActionButton: {
    minWidth: 104,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    backgroundColor: colors.bgElevated,
  },
  accountActionButtonPressed: { opacity: 0.72 },
  accountActionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },

  headerCard: {
    marginTop: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  headerCardCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  headerInfo: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaRowCompact: { alignItems: 'flex-start' },
  jersey: { fontSize: 15, fontWeight: '800' },
  positionBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.bgElevated,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  teamBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, borderWidth: 1 },
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
  teamName: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },

  passportCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 10,
    overflow: 'hidden',
    shadowColor: colors.brandRink,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  passportGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  passportEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  passportTitle: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  passportSub: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, fontWeight: '600' },
  passportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  passportGridCompact: { gap: 10 },
  passportMetric: {
    flexBasis: '48%',
    backgroundColor: colors.glassHighlight,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  passportMetricCompact: { flexBasis: '100%' },
  passportMetricValue: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  passportMetricLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  fitProfileCard: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  fitProfileInfo: { flex: 1, minWidth: 0 },
  fitProfileLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.6 },
  fitProfileValue: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  fitProfileButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  fitProfileButtonText: { fontSize: 12, fontWeight: '800', color: colors.textOnPrimary },
  passportActions: { flexDirection: 'row', gap: 8 },
  passportActionsCompact: { flexDirection: 'column' },
  passportActionButton: {
    flex: 1,
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
  passportActionButtonCompact: { width: '100%' },
  passportActionButtonGhost: {
    backgroundColor: 'transparent',
  },
  passportActionButtonText: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  passportActionButtonGhostText: { fontSize: 13, fontWeight: '800', color: colors.primary },

  statsCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  statsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statsRowCompact: { flexWrap: 'wrap' },
  statCell: { alignItems: 'center', flex: 1, minWidth: 0 },
  statCellCompact: { flexBasis: '48%' },
  statNumber: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  seasonRadarCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  formSummaryCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.glassStroke,
  },
  formSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  formSummaryHeaderCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  formSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.6,
  },
  formSummaryValue: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
    marginTop: 2,
  },
  formSummaryMeta: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  formChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  formChipText: { fontSize: 13, fontWeight: '900' },
  standingsList: { borderRadius: 14, overflow: 'hidden' },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  standingRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  standingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  standingIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  standingCopy: { flex: 1, minWidth: 0 },
  standingTeamName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  standingLeagueName: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  standingMetrics: { flexDirection: 'row', gap: 14 },
  standingMetricsCompact: { width: '100%', justifyContent: 'space-between' },
  standingMetric: { alignItems: 'center' },
  standingMetricValue: { fontSize: 15, fontWeight: '900', color: colors.textPrimary },
  standingMetricLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },

  currentTeamsList: { gap: 10, marginBottom: 12 },
  currentTeamCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 14,
    gap: 10,
  },
  currentTeamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  currentTeamHeaderCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  currentTeamIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  currentTeamCopy: { flex: 1, minWidth: 0 },
  currentTeamName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  currentLeagueName: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  currentBadge: {
    backgroundColor: `${colors.primary}22`,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  currentBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  currentTeamMeta: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, fontWeight: '600' },
  currentTeamActions: { flexDirection: 'row', gap: 8 },
  currentTeamActionsCompact: { flexDirection: 'column' },
  currentTeamPrimaryButton: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  currentTeamPrimaryButtonText: { fontSize: 13, fontWeight: '800', color: colors.textOnPrimary },
  currentTeamSecondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStroke,
    backgroundColor: colors.bgElevated,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  currentTeamSecondaryButtonText: { fontSize: 13, fontWeight: '800', color: colors.primary },

  leagueBreakdownCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  leagueRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  leagueRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  leagueRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  leagueName: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  leagueRowStats: { flexDirection: 'row', gap: 12 },
  leagueRowStatsCompact: { flexWrap: 'wrap' },
  leagueStatCell: { alignItems: 'center' },
  leagueStatVal: { fontSize: 15, fontWeight: '900', color: colors.textPrimary },
  leagueStatLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: 1 },

  badgesScroll: { paddingHorizontal: 16, paddingBottom: 12, gap: 12, flexDirection: 'row' },
  badgeChip: { alignItems: 'center', width: 88, gap: 6 },
  badgeIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeChipLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  badgeChipMeta: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },

  gamesCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  gameRowCompact: {
    alignItems: 'flex-start',
  },
  gameRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  resultBadge: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  resultText: { fontSize: 13, fontWeight: '900' },
  gameInfo: { flex: 1, minWidth: 0 },
  gameTeams: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  gameDate: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 1 },
  gameScore: { fontSize: 15, fontWeight: '900', color: colors.textPrimary, flexShrink: 0 },

  exploreCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  exploreCopy: { gap: 4 },
  exploreTitle: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  exploreSubtitle: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, fontWeight: '600' },
  exploreButton: {
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  exploreButtonText: { fontSize: 14, fontWeight: '800', color: colors.textOnPrimary },

  settingsCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 6 },
  settingRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  deleteAccountRow: { borderTopWidth: 1, borderTopColor: colors.borderCard, borderBottomWidth: 0 },
  deleteAccountCopy: { flex: 1, gap: 2 },
  deleteAccountLabel: { fontSize: 15, fontWeight: '800', color: colors.accentRed },
  deleteAccountMeta: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
});
