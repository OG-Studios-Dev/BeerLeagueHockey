import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandAtmosphere from '../../components/BrandAtmosphere';
import { useAccessibilityPreferences } from '../../context/AccessibilityPreferencesContext';
import {
  type CheckinStatus,
  getGameCheckinSummary,
} from '../../lib/supabase/checkins';
import {
  clearPlayerCheckinAsCaptain,
  createGoalieRequest,
  getCaptainRole,
  getGameCheckinStatusMap,
  getLeagueSubPlayers,
  getOpenGoalieRequest,
  getRecentTeamMessages,
  getTeamSubInvitations,
  inviteSub,
  postTeamMessage,
  type CaptainRole,
  type GoalieRequestRow,
  type SubCandidate,
  type TeamMessageRow,
  type TeamSubInvitation,
  updatePlayerCheckinAsCaptain,
} from '../../lib/supabase/captain';
import { supabase } from '../../lib/supabase/client';
import { getMetricsOperationalSeason, getTeamActiveSeason } from '../../lib/supabase/team';
import { loadTeamPageSnapshot, type TeamPageSnapshot } from '../../lib/supabase/teamPage';
import { navigateToPlayerCard } from '../../navigation/playerCard';
import { navigateToGamePreview } from '../../navigation/gamePreview';
import { TeamStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { ui } from '../../theme/ui';
import TeamPublicPage from './TeamPublicPage';

type Props = NativeStackScreenProps<TeamStackParamList, 'TeamDetail'>;

type TeamInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

type StandingInfo = {
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points: number | null;
  goals_for: number | null;
  goals_against: number | null;
  games_played: number | null;
};

type RosterPlayer = {
  id: string;
  player_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean;
  leadership_role: string | null;
  player_name: string;
  avatar_url: string | null;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
};

type TeamRosterQueryRow = {
  id: string;
  player_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean | null;
  leadership_role: string | null;
};

type ProfileQueryRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type PlayerSeasonStatsQueryRow = {
  player_id: string;
  games_played: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
};

type UpcomingGame = {
  id: string;
  league_id: string;
  season_id: string | null;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  status: string | null;
  location: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team: { name: string; primary_color: string | null } | null;
  away_team: { name: string; primary_color: string | null } | null;
};

type LeagueInfo = {
  id: string;
  name: string;
  slug: string | null;
};

type ActiveSeasonInfo = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: string;
};

type NextGameAvailability = {
  confirmed: number;
  tentative: number;
  out: number;
  pending: number;
};

const GOALIE_SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return 'Just now';

  const diffMs = Date.now() - new Date(iso).getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));

  if (diffHours <= 0) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(iso);
}

function formatRosterPosition(position: string | null, isGoalie: boolean) {
  if (isGoalie) return 'G';
  if (!position) return '—';

  const normalized = position.trim().toLowerCase();

  if (
    normalized === 'd' ||
    normalized === 'defence' ||
    normalized === 'defense' ||
    normalized === 'defenceman' ||
    normalized === 'defenseman'
  ) {
    return 'D';
  }

  if (normalized === 'g' || normalized === 'goalie' || normalized === 'goaltender') {
    return 'G';
  }

  if (
    normalized === 'f' ||
    normalized === 'forward' ||
    normalized === 'centre' ||
    normalized === 'center' ||
    normalized === 'wing' ||
    normalized === 'winger' ||
    normalized === 'lw' ||
    normalized === 'rw' ||
    normalized === 'c'
  ) {
    return 'F';
  }

  return normalized.startsWith('d') ? 'D' : normalized.startsWith('g') ? 'G' : 'F';
}

function formatCaptainRole(role: CaptainRole | null) {
  if (role === 'captain') return 'Captain';
  if (role === 'alternate_captain') return 'Alternate';
  return null;
}

function buildAvailabilityCounts(
  roster: RosterPlayer[],
  statusMap: Record<string, CheckinStatus>,
): NextGameAvailability {
  const rosterPlayerIds = new Set(roster.map((player) => player.player_id));
  const statuses = Object.entries(statusMap)
    .filter(([playerId]) => rosterPlayerIds.has(playerId))
    .map(([, status]) => status);
  const confirmed = statuses.filter((status) => status === 'confirmed').length;
  const tentative = statuses.filter((status) => status === 'tentative').length;
  const out = statuses.filter((status) => status === 'out').length;

  return {
    confirmed,
    tentative,
    out,
    pending: Math.max(roster.length - statuses.length, 0),
  };
}

function getLineupPillStyle(selected: boolean, tone: 'in' | 'maybe' | 'out' | 'wait') {
  if (!selected) {
    return {
      backgroundColor: colors.bgInteractive,
      borderColor: colors.borderCard,
      color: colors.textSecondary,
    };
  }

  if (tone === 'in') {
    return {
      backgroundColor: colors.accentGreen,
      borderColor: colors.accentGreen,
      color: '#04110B',
    };
  }

  if (tone === 'maybe') {
    return {
      backgroundColor: '#F59E0B',
      borderColor: '#F59E0B',
      color: '#0F0A00',
    };
  }

  if (tone === 'out') {
    return {
      backgroundColor: colors.accentRed,
      borderColor: colors.accentRed,
      color: '#FFFFFF',
    };
  }

  return {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary + '50',
    color: colors.primary,
  };
}

function StatBox({ label, value, compact = false }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <View style={[styles.statBox, compact && styles.statBoxCompact]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function TeamDetailScreen({ route, navigation }: Props) {
  const { teamId, leagueId } = route.params;
  const { width } = useWindowDimensions();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const isCompact = width < 390;

  const [team, setTeam] = React.useState<TeamInfo | null>(null);
  const [league, setLeague] = React.useState<LeagueInfo | null>(null);
  const [activeSeason, setActiveSeason] = React.useState<ActiveSeasonInfo | null>(null);
  const [presentationSeason, setPresentationSeason] = React.useState<ActiveSeasonInfo | null>(null);
  const [_standing, setStanding] = React.useState<StandingInfo | null>(null);
  const [roster, setRoster] = React.useState<RosterPlayer[]>([]);
  const [upcomingGames, setUpcomingGames] = React.useState<UpcomingGame[]>([]);
  const [nextGameAvailability, setNextGameAvailability] = React.useState<NextGameAvailability | null>(null);
  const [captainRole, setCaptainRole] = React.useState<CaptainRole | null>(null);
  const [teamMessages, setTeamMessages] = React.useState<TeamMessageRow[]>([]);
  const [lineupStatuses, setLineupStatuses] = React.useState<Record<string, CheckinStatus>>({});
  const [subInvitations, setSubInvitations] = React.useState<TeamSubInvitation[]>([]);
  const [goalieRequest, setGoalieRequest] = React.useState<GoalieRequestRow | null>(null);
  const [subCandidates, setSubCandidates] = React.useState<SubCandidate[]>([]);
  const [loadingSubCandidates, setLoadingSubCandidates] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isRosterMember, setIsRosterMember] = React.useState(false);
  const [lineupSavingPlayerId, setLineupSavingPlayerId] = React.useState<string | null>(null);
  const [captainError, setCaptainError] = React.useState<string | null>(null);

  const [reminderModalVisible, setReminderModalVisible] = React.useState(false);
  const [reminderMessage, setReminderMessage] = React.useState('');
  const [reminderSaving, setReminderSaving] = React.useState(false);

  const [subModalVisible, setSubModalVisible] = React.useState(false);
  const [subSearch, setSubSearch] = React.useState('');
  const [subInviteMessage, setSubInviteMessage] = React.useState('');
  const [subSavingPlayerId, setSubSavingPlayerId] = React.useState<string | null>(null);

  const [goalieModalVisible, setGoalieModalVisible] = React.useState(false);
  const [goalieSkillLevel, setGoalieSkillLevel] = React.useState('intermediate');
  const [goalieCompensation, setGoalieCompensation] = React.useState('Free');
  const [goalieNotes, setGoalieNotes] = React.useState('');
  const [goalieSaving, setGoalieSaving] = React.useState(false);
  const loadGenerationRef = React.useRef(0);
  const publicLoadGenerationRef = React.useRef(0);
  const [publicSnapshot, setPublicSnapshot] = React.useState<TeamPageSnapshot | null>(null);
  const [publicLoading, setPublicLoading] = React.useState(true);
  const [publicError, setPublicError] = React.useState<string | null>(null);
  const [publicRetryToken, setPublicRetryToken] = React.useState(0);

  const nextGame = upcomingGames[0] ?? null;
  const teamName = team?.name ?? 'Team';
  const primaryColor = team?.primary_color ?? colors.primary;
  const publicSurface = reduceTransparency
    ? { backgroundColor: '#0C1B31', borderColor: '#41607F' }
    : { backgroundColor: 'rgba(10, 22, 40, 0.30)', borderColor: 'rgba(125, 190, 255, 0.22)' };
  const nextOpponent = nextGame
    ? nextGame.home_team_id === teamId
      ? nextGame.away_team?.name ?? 'Opponent'
      : nextGame.home_team?.name ?? 'Opponent'
    : null;

  const refreshCaptainData = React.useCallback(
    async (currentRoster: RosterPlayer[], currentNextGame: UpcomingGame | null, generation: number) => {
      const [role, messages] = await Promise.all([
        getCaptainRole(teamId),
        getRecentTeamMessages(teamId, 5),
      ]);

      if (generation !== loadGenerationRef.current) return;
      setCaptainRole(role);
      setTeamMessages(messages);

      if (!role || !currentNextGame) {
        setLineupStatuses({});
        setSubInvitations([]);
        setGoalieRequest(null);
        return;
      }

      const [statusMap, invitationsResult, openGoalieRequest] = await Promise.all([
        getGameCheckinStatusMap(currentNextGame.id, teamId),
        getTeamSubInvitations(teamId, [currentNextGame.id]),
        getOpenGoalieRequest(currentNextGame.id, teamId),
      ]);

      if (generation !== loadGenerationRef.current) return;
      setLineupStatuses(statusMap);
      setNextGameAvailability(buildAvailabilityCounts(currentRoster, statusMap));
      setSubInvitations(invitationsResult.data ?? []);
      setGoalieRequest(openGoalieRequest);
    },
    [teamId],
  );

  function navigateToGame(gameId: string) {
    navigateToGamePreview(navigation, { gameId });
  }

  React.useEffect(() => {
    if (!presentationSeason?.id) {
      setPublicSnapshot(null);
      setPublicError(null);
      setPublicLoading(false);
      return;
    }
    let isMounted = true;
    const generation = ++publicLoadGenerationRef.current;
    setPublicSnapshot(null);
    setPublicError(null);
    setPublicLoading(true);

    void loadTeamPageSnapshot(teamId, leagueId, new Date(), presentationSeason.id)
      .then((result) => {
        if (!isMounted || generation !== publicLoadGenerationRef.current) return;
        setPublicSnapshot(result.data);
        setPublicError(result.error);
        setPublicLoading(false);
      })
      .catch(() => {
        if (!isMounted || generation !== publicLoadGenerationRef.current) return;
        setPublicSnapshot(null);
        setPublicError('Public Team facts could not be loaded. Please try again.');
        setPublicLoading(false);
      });

    return () => {
      isMounted = false;
      if (publicLoadGenerationRef.current === generation) publicLoadGenerationRef.current += 1;
    };
  }, [leagueId, presentationSeason?.id, publicRetryToken, teamId]);

  React.useEffect(() => {
    let isMounted = true;
    const generation = ++loadGenerationRef.current;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setTeam(null);
      setLeague(null);
      setActiveSeason(null);
      setPresentationSeason(null);
      setStanding(null);
      setRoster([]);
      setUpcomingGames([]);
      setNextGameAvailability(null);
      setIsRosterMember(false);
      setCaptainRole(null);
      setTeamMessages([]);
      setLineupStatuses({});
      setSubInvitations([]);
      setGoalieRequest(null);
      setSubCandidates([]);
      setLoadingSubCandidates(false);
      setLineupSavingPlayerId(null);
      setCaptainError(null);
      setReminderModalVisible(false);
      setReminderMessage('');
      setReminderSaving(false);
      setSubModalVisible(false);
      setSubSearch('');
      setSubInviteMessage('');
      setSubSavingPlayerId(null);
      setGoalieModalVisible(false);
      setGoalieSkillLevel('intermediate');
      setGoalieCompensation('Free');
      setGoalieNotes('');
      setGoalieSaving(false);

      const [activeSeasonRes, presentationSeasonRes] = await Promise.all([
        getTeamActiveSeason(leagueId),
        getMetricsOperationalSeason(leagueId),
      ]);

      if (!isMounted) return;

      if (activeSeasonRes.error || presentationSeasonRes.error) {
        setActiveSeason(null);
        setPresentationSeason(null);
        setLoadError(activeSeasonRes.error
          ? 'We could not determine the active season for this league.'
          : 'We could not determine the presentation season for this league.');
        setLoading(false);
        return;
      }

      const season = (activeSeasonRes.season as ActiveSeasonInfo | null) ?? null;
      const presentation = (presentationSeasonRes.season as ActiveSeasonInfo | null) ?? null;
      setPresentationSeason(presentation);
      const activeSeasonId = season?.id ?? null;
      if (!activeSeasonId) {
        setActiveSeason(null);
        setTeam(null);
        setLeague(null);
        setStanding(null);
        setRoster([]);
        setUpcomingGames([]);
        setNextGameAvailability(null);
        setLoading(false);
        return;
      }

      setActiveSeason(season);

      const [teamRes, leagueRes, standingRes, rosterRes, gamesRes, viewerRes] = await Promise.all([
        supabase.from('teams').select('id, name, logo_url, primary_color, secondary_color').eq('id', teamId).eq('league_id', leagueId).maybeSingle(),
        supabase.from('leagues').select('id, name, slug').eq('id', leagueId).maybeSingle(),
        supabase
          .from('team_standings')
          .select('wins, losses, ties, points, goals_for, goals_against, games_played')
          .eq('team_id', teamId)
          .eq('season_id', activeSeasonId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('team_rosters')
          .select('id, player_id, jersey_number, position, is_goalie, leadership_role')
          .eq('team_id', teamId)
          .eq('league_id', leagueId)
          .eq('season_id', activeSeasonId)
          .eq('status', 'active')
          .is('end_date', null),
        supabase
          .from('games')
          .select(
            `id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status, location, home_score, away_score,
             home_team:teams!games_home_team_id_fkey(name, primary_color),
             away_team:teams!games_away_team_id_fkey(name, primary_color)`,
          )
          .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
          .eq('league_id', leagueId)
          .eq('season_id', activeSeasonId)
          .in('status', ['scheduled', 'in_progress'])
          .order('scheduled_at', { ascending: true })
          .limit(8),
        supabase.auth.getUser(),
      ]);

      if (!isMounted) return;

      if (teamRes.error || leagueRes.error || standingRes.error || rosterRes.error || gamesRes.error) {
        setLoadError('Team details could not be loaded. Please try again.');
        setLoading(false);
        return;
      }

      setTeam((teamRes.data as TeamInfo | null) ?? null);
      setLeague((leagueRes.data as LeagueInfo | null) ?? null);
      setStanding((standingRes.data as StandingInfo | null) ?? null);
      const gameRows = [...((gamesRes.data as unknown as UpcomingGame[] | null) ?? [])]
        .sort((left, right) => {
          const statusDifference = Number(right.status === 'in_progress') - Number(left.status === 'in_progress');
          if (statusDifference !== 0) return statusDifference;
          return new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime();
        })
        .slice(0, 4);
      setUpcomingGames(gameRows);

      const sortedRosterRows = [
        ...((rosterRes.data as unknown as TeamRosterQueryRow[] | null) ?? []),
      ].sort((left, right) => {
        const jerseyDifference = (left.jersey_number ?? Number.MAX_SAFE_INTEGER) - (right.jersey_number ?? Number.MAX_SAFE_INTEGER);
        if (jerseyDifference !== 0) return jerseyDifference;
        return left.id.localeCompare(right.id);
      });
      const rosterRowsByPlayer = new Map<string, TeamRosterQueryRow>();
      for (const row of sortedRosterRows) {
        if (!rosterRowsByPlayer.has(row.player_id)) rosterRowsByPlayer.set(row.player_id, row);
      }
      const rosterRows = Array.from(rosterRowsByPlayer.values());
      const nextScheduledGame = gameRows[0] ?? null;

      if (rosterRows.length > 0) {
        const playerIds = rosterRows.map((row) => row.player_id);

        const [profileRes, statsRes] = await Promise.all([
          supabase.from('profiles').select('id, full_name, avatar_url').in('id', playerIds),
          supabase
            .from('player_season_stats')
            .select('player_id, games_played, goals, assists, points')
            .in('player_id', playerIds)
            .eq('season_id', activeSeasonId)
            .eq('team_id', teamId),
        ]);

        if (!isMounted) return;

        if (profileRes.error || statsRes.error) {
          setLoadError('Roster details could not be loaded. Please try again.');
          setLoading(false);
          return;
        }

        const nameMap = new Map<string, { fullName: string; avatarUrl: string | null }>();
        for (const profile of (profileRes.data as unknown as ProfileQueryRow[] | null) ?? []) {
          nameMap.set(profile.id, {
            fullName: profile.full_name ?? 'Unknown',
            avatarUrl: profile.avatar_url ?? null,
          });
        }

        const statsMap = new Map<string, { gamesPlayed: number; goals: number; assists: number; points: number }>();
        for (const statsRow of (statsRes.data as unknown as PlayerSeasonStatsQueryRow[] | null) ?? []) {
          const existing = statsMap.get(statsRow.player_id);
          const next = {
            gamesPlayed: statsRow.games_played ?? 0,
            goals: statsRow.goals ?? 0,
            assists: statsRow.assists ?? 0,
            points: statsRow.points ?? (statsRow.goals ?? 0) + (statsRow.assists ?? 0),
          };
          if (!existing || next.gamesPlayed > existing.gamesPlayed || next.points > existing.points) {
            statsMap.set(statsRow.player_id, next);
          }
        }

        const players: RosterPlayer[] = rosterRows
          .map((row) => {
            const statLine = statsMap.get(row.player_id) ?? { gamesPlayed: 0, goals: 0, assists: 0, points: 0 };
            const profile = nameMap.get(row.player_id);

            return {
              id: row.id,
              player_id: row.player_id,
              jersey_number: row.jersey_number ?? null,
              position: row.position ?? null,
              is_goalie: row.is_goalie ?? false,
              leadership_role: row.leadership_role ?? null,
              player_name: profile?.fullName ?? 'Unknown',
              avatar_url: profile?.avatarUrl ?? null,
              games_played: statLine.gamesPlayed,
              goals: statLine.goals,
              assists: statLine.assists,
              points: statLine.points,
            };
          })
          .sort((a, b) => {
            const jerseyDifference = (a.jersey_number ?? Number.MAX_SAFE_INTEGER) - (b.jersey_number ?? Number.MAX_SAFE_INTEGER);
            if (jerseyDifference !== 0) return jerseyDifference;
            const nameDifference = a.player_name.localeCompare(b.player_name);
            return nameDifference !== 0 ? nameDifference : a.player_id.localeCompare(b.player_id);
          });

        setRoster(players);
        setIsRosterMember(Boolean(viewerRes.data.user?.id && players.some((player) => player.player_id === viewerRes.data.user?.id)));

        if (nextScheduledGame) {
          const summary = await getGameCheckinSummary(nextScheduledGame.id, teamId);
          if (!isMounted) return;

          const rosterPlayerIds = new Set(players.map((player) => player.player_id));
          const confirmed = summary.confirmed.filter((entry) => entry.player && rosterPlayerIds.has(entry.player.id));
          const tentative = summary.tentative.filter((entry) => entry.player && rosterPlayerIds.has(entry.player.id));
          const out = summary.out.filter((entry) => entry.player && rosterPlayerIds.has(entry.player.id));
          const respondedPlayerIds = new Set(
            [...confirmed, ...tentative, ...out]
              .map((entry) => entry.player?.id)
              .filter((playerId): playerId is string => Boolean(playerId)),
          );

          setNextGameAvailability({
            confirmed: confirmed.length,
            tentative: tentative.length,
            out: out.length,
            pending: Math.max(players.length - respondedPlayerIds.size, 0),
          });
        } else {
          setNextGameAvailability(null);
        }

        await refreshCaptainData(players, nextScheduledGame, generation);
      } else {
        setRoster([]);
        setIsRosterMember(false);
        setNextGameAvailability(null);
        await refreshCaptainData([], nextScheduledGame, generation);
      }

      if (isMounted) {
        setLoading(false);
      }
    }

    void load();

    return () => {
      isMounted = false;
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1;
    };
  }, [leagueId, publicRetryToken, refreshCaptainData, teamId]);

  const pendingPlayers = React.useMemo(
    () => roster.filter((player) => !lineupStatuses[player.player_id]),
    [lineupStatuses, roster],
  );

  const reminderTemplate = React.useMemo(() => {
    if (!nextGame) {
      return 'Please update your availability as soon as you can.';
    }

    const pendingNames = pendingPlayers.slice(0, 4).map((player) => player.player_name.split(' ')[0]);
    const nameSuffix =
      pendingNames.length > 0 ? ` Still waiting on ${pendingNames.join(', ')}${pendingPlayers.length > 4 ? ` and ${pendingPlayers.length - 4} more` : ''}.` : '';

    return `Please update your availability for ${teamName} vs ${nextOpponent ?? 'our next opponent'} on ${formatDateTime(
      nextGame.scheduled_at,
    )}.${nameSuffix}`;
  }, [nextGame, nextOpponent, pendingPlayers, teamName]);

  const invitedPlayerIds = React.useMemo(() => new Set(subInvitations.map((invite) => invite.invitedPlayerId)), [subInvitations]);

  const filteredSubCandidates = React.useMemo(() => {
    const query = subSearch.trim().toLowerCase();
    return subCandidates.filter((candidate) => {
      if (invitedPlayerIds.has(candidate.id)) return true;
      if (!query) return true;

      return (
        (candidate.full_name ?? '').toLowerCase().includes(query) ||
        (candidate.email ?? '').toLowerCase().includes(query)
      );
    });
  }, [invitedPlayerIds, subCandidates, subSearch]);

  const openLeagueSite = () => {
    if (!league?.slug) return;
    Linking.openURL(`https://${league.slug}.beerleaguehockey.ca`).catch(() => {});
  };

  const openReminderModal = () => {
    setReminderMessage(reminderTemplate);
    setReminderModalVisible(true);
    setCaptainError(null);
  };

  const openSubModal = async () => {
    if (!captainRole || !nextGame) return;
    const generation = loadGenerationRef.current;
    const operationLeagueId = leagueId;
    const operationTeamId = teamId;

    setSubModalVisible(true);
    setSubSearch('');
    setCaptainError(null);

    if (subCandidates.length > 0 || loadingSubCandidates) {
      return;
    }

    setLoadingSubCandidates(true);
    const result = await getLeagueSubPlayers(operationLeagueId, operationTeamId);
    if (generation !== loadGenerationRef.current) return;
    setLoadingSubCandidates(false);

    if (!result.success) {
      setCaptainError(result.error ?? 'Unable to load sub players.');
      return;
    }

    setSubCandidates(result.data ?? []);
  };

  const handleCaptainStatusChange = async (
    playerId: string,
    nextStatus: CheckinStatus | 'waiting',
  ) => {
    if (!captainRole || !nextGame) return;
    const generation = loadGenerationRef.current;
    const operationGameId = nextGame.id;
    const operationTeamId = teamId;
    const operationRoster = roster;

    const previousStatuses = lineupStatuses;
    const updatedStatuses = { ...lineupStatuses };
    if (nextStatus === 'waiting') {
      delete updatedStatuses[playerId];
    } else {
      updatedStatuses[playerId] = nextStatus;
    }

    setCaptainError(null);
    setLineupSavingPlayerId(playerId);
    setLineupStatuses(updatedStatuses);
    setNextGameAvailability(buildAvailabilityCounts(roster, updatedStatuses));

    const result =
      nextStatus === 'waiting'
        ? await clearPlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId)
        : await updatePlayerCheckinAsCaptain(operationGameId, operationTeamId, playerId, nextStatus);

    if (generation !== loadGenerationRef.current) return;
    setLineupSavingPlayerId(null);

    if (!result.success) {
      setLineupStatuses(previousStatuses);
      setNextGameAvailability(buildAvailabilityCounts(operationRoster, previousStatuses));
      setCaptainError(result.error ?? 'Unable to update lineup.');
    }
  };

  const handleSendReminder = async () => {
    if (!captainRole || !nextGame || !reminderMessage.trim()) {
      return;
    }
    const generation = loadGenerationRef.current;
    const operationTeamId = teamId;
    const operationSeasonId = nextGame.season_id ?? null;
    const operationOpponent = nextOpponent ?? 'opponent';
    const operationMessage = reminderMessage.trim();
    const operationTemplate = reminderTemplate;

    setCaptainError(null);
    setReminderSaving(true);
    const result = await postTeamMessage({
      teamId: operationTeamId,
      seasonId: operationSeasonId,
      subject: `Check-in reminder vs ${operationOpponent}`,
      message: operationMessage,
      messageType: 'checkin_reminder',
      isUrgent: true,
    });
    if (generation !== loadGenerationRef.current) return;
    setReminderSaving(false);

    if (!result.success) {
      setCaptainError(result.error ?? 'Unable to send reminder.');
      return;
    }

    setReminderModalVisible(false);
    setReminderMessage(operationTemplate);
    const messages = await getRecentTeamMessages(operationTeamId, 5);
    if (generation !== loadGenerationRef.current) return;
    setTeamMessages(messages);
    Alert.alert('Reminder sent', 'Your team bulletin has been updated with a check-in reminder.');
  };

  const handleInviteSub = async (playerId: string) => {
    if (!captainRole || !nextGame) return;
    const generation = loadGenerationRef.current;
    const operationGameId = nextGame.id;
    const operationTeamId = teamId;
    const operationMessage = subInviteMessage;

    setCaptainError(null);
    setSubSavingPlayerId(playerId);
    const result = await inviteSub(operationGameId, operationTeamId, playerId, operationMessage);
    if (generation !== loadGenerationRef.current) return;
    setSubSavingPlayerId(null);

    if (!result.success) {
      setCaptainError(result.error ?? 'Unable to invite this sub.');
      return;
    }

    const refreshed = await getTeamSubInvitations(operationTeamId, [operationGameId]);
    if (generation !== loadGenerationRef.current) return;
    setSubInvitations(refreshed.data ?? []);
  };

  const handleRequestGoalie = async () => {
    if (!captainRole || !nextGame) return;
    const generation = loadGenerationRef.current;
    const operationGameId = nextGame.id;
    const operationTeamId = teamId;
    const operationLeagueId = leagueId;
    const operationRequest = {
      skillLevelNeeded: goalieSkillLevel,
      compensation: goalieCompensation,
      notes: goalieNotes,
    };

    setCaptainError(null);
    setGoalieSaving(true);
    const result = await createGoalieRequest(operationGameId, operationTeamId, operationLeagueId, operationRequest);
    if (generation !== loadGenerationRef.current) return;
    setGoalieSaving(false);

    if (!result.success) {
      setCaptainError(result.error ?? 'Unable to create goalie request.');
      return;
    }

    const refreshedRequest = await getOpenGoalieRequest(operationGameId, operationTeamId);
    if (generation !== loadGenerationRef.current) return;
    setGoalieRequest(refreshedRequest);
    setGoalieModalVisible(false);
    Alert.alert(
      'Goalie request posted',
      `${result.notifiedGoalies ?? 0} active goalie${result.notifiedGoalies === 1 ? '' : 's'} are currently in the pool for this league.`,
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View testID="team-error-state" style={styles.centeredState}>
          <Ionicons name="alert-circle-outline" size={30} color={colors.accentRed} />
          <Text style={styles.stateTitle}>Unable to load team</Text>
          <Text style={styles.stateBody}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const matchingPublicSnapshot = publicSnapshot?.team.id === teamId && publicSnapshot.league.id === leagueId && publicSnapshot.season.id === presentationSeason?.id
    ? publicSnapshot
    : null;

  if (!presentationSeason) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View testID="team-no-active-season-state" style={styles.centeredState}>
          <Ionicons name="calendar-outline" size={30} color={colors.primary} />
          <Text style={styles.stateTitle}>No season available</Text>
          <Text style={styles.stateBody}>Team stats will appear when this league has a presentation season.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (activeSeason && !team) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
        <View testID="team-missing-state" style={styles.centeredState}>
          <Ionicons name="shield-outline" size={30} color={colors.textSecondary} />
          <Text style={styles.stateTitle}>Team not found</Text>
          <Text style={styles.stateBody}>This team is not part of the selected league.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={() => navigation.goBack()}>
      <BrandAtmosphere accentColor={primaryColor} secondaryColor={team?.secondary_color ?? colors.brandArena} intensity="medium" />
      <View style={[styles.colorStrip, { backgroundColor: primaryColor }]} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {matchingPublicSnapshot ? (
          <TeamPublicPage
            key={`${leagueId}:${teamId}:${presentationSeason.id}`}
            snapshot={matchingPublicSnapshot}
            reduceTransparency={reduceTransparency}
            onOpenPlayer={(playerId) => navigateToPlayerCard(navigation, { playerId, leagueId })}
            onOpenGame={navigateToGame}
          />
        ) : publicLoading ? (
          <View testID="team-public-loading-state" style={styles.publicStateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateBody}>Loading current Team page…</Text>
          </View>
        ) : (
          <View testID="team-public-error-state" style={styles.publicStateCard}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.accentRed} />
            <Text style={styles.stateTitle}>Public Team page unavailable</Text>
            <Text style={styles.stateBody}>{publicError ?? 'Current public Team facts are not available for this season.'}</Text>
            <Pressable testID="team-public-retry" accessibilityRole="button" accessibilityLabel="Retry public Team page" onPress={() => {
              setPublicSnapshot(null);
              setPublicError(null);
              setPublicLoading(true);
              setActiveSeason(null);
              setPresentationSeason(null);
              setLoading(true);
              setPublicRetryToken((value) => value + 1);
            }} style={styles.publicRetryButton}>
              <Text style={styles.publicRetryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {activeSeason ? <View testID="team-operations-wrapper" style={styles.operationsWrapper}>
        {(nextGame || league?.slug) && (
          <View testID="team-operations-card" style={[styles.opsCard, publicSurface]}>
            <Text style={styles.sectionTitle}>Team Operations</Text>

            {nextGame ? (
              <>
                <View style={[styles.opsHeaderRow, isCompact && styles.opsHeaderRowCompact]}>
                  <View style={styles.opsTextWrap}>
                    <Text style={styles.opsTitle}>Next up: {nextOpponent}</Text>
                    <Text style={styles.opsMeta}>
                      {formatDate(nextGame.scheduled_at)} · {formatTime(nextGame.scheduled_at)}
                      {nextGame.location ? ` · ${nextGame.location}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    testID="team-open-game-action"
                    accessibilityRole="button"
                    accessibilityLabel="Open next game"
                    style={[styles.opsPrimaryButton, isCompact && styles.opsPrimaryButtonCompact]}
                    onPress={() => navigateToGame(nextGame.id)}
                  >
                    <Text style={styles.opsPrimaryButtonText}>Open Game</Text>
                  </Pressable>
                </View>

                {nextGameAvailability ? (
                  <>
                    <View style={[styles.opsCountsRow, isCompact && styles.opsCountsRowCompact]}>
                      <StatBox label="IN" value={nextGameAvailability.confirmed} compact={isCompact} />
                      <StatBox label="MAYBE" value={nextGameAvailability.tentative} compact={isCompact} />
                      <StatBox label="OUT" value={nextGameAvailability.out} compact={isCompact} />
                      <StatBox label="WAITING" value={nextGameAvailability.pending} compact={isCompact} />
                    </View>
                    <Text style={styles.opsHint}>
                      Use this to spot lineup risk early before players have all responded.
                    </Text>
                  </>
                ) : null}
              </>
            ) : (
              <Text style={styles.opsMeta}>No scheduled games are posted for this team yet.</Text>
            )}

            {league?.slug ? (
              <Pressable testID="team-league-site-action" accessibilityRole="button" accessibilityLabel="Open league site" style={styles.opsSecondaryButton} onPress={openLeagueSite}>
                <Ionicons name="globe-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.opsSecondaryButtonText}>Open League Site</Text>
              </Pressable>
            ) : null}

            {isRosterMember ? (
              <Pressable
                testID="team-chat-action"
                accessibilityRole="button"
                accessibilityLabel={`Open ${teamName} team chat`}
                style={styles.opsSecondaryButton}
                onPress={() => navigation.navigate('TeamChat', { teamId, leagueId, teamName })}
              >
                <Ionicons name="chatbubbles-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.opsSecondaryButtonText}>Team Chat</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {captainRole && nextGame ? (
          <View style={styles.captainCard}>
            <View style={[styles.captainHeaderRow, isCompact && styles.captainHeaderRowCompact]}>
              <View style={styles.captainHeaderCopy}>
                <Text style={styles.sectionTitle}>Captain Center</Text>
                <Text style={styles.cardMeta}>
                  {formatCaptainRole(captainRole)} tools for {formatDateTime(nextGame.scheduled_at)}
                </Text>
              </View>
              <View style={styles.captainRoleBadge}>
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
                <Text style={styles.captainRoleText}>{formatCaptainRole(captainRole)}</Text>
              </View>
            </View>

            <View style={[styles.captainActionRow, isCompact && styles.captainActionRowCompact]}>
              <Pressable testID="team-captain-reminder-action" accessibilityRole="button" style={styles.captainActionButton} onPress={openReminderModal}>
                <Ionicons name="notifications-outline" size={16} color={colors.primary} />
                <Text style={styles.captainActionTitle}>Remind Team</Text>
                <Text style={styles.captainActionMeta}>{pendingPlayers.length} awaiting response</Text>
              </Pressable>

              <Pressable testID="team-captain-sub-action" accessibilityRole="button" style={styles.captainActionButton} onPress={() => void openSubModal()}>
                <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                <Text style={styles.captainActionTitle}>Request Sub</Text>
                <Text style={styles.captainActionMeta}>{subInvitations.length} invites for this game</Text>
              </Pressable>

              <Pressable testID="team-captain-goalie-action" accessibilityRole="button" style={styles.captainActionButton} onPress={() => setGoalieModalVisible(true)}>
                <Ionicons name="shield-half-outline" size={16} color={colors.primary} />
                <Text style={styles.captainActionTitle}>Request Goalie</Text>
                <Text style={styles.captainActionMeta}>{goalieRequest ? goalieRequest.status : 'No open request'}</Text>
              </Pressable>
            </View>

            {captainError ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.accentRed} />
                <Text style={styles.errorText}>{captainError}</Text>
              </View>
            ) : null}

            <View style={styles.inlineSection}>
              <Text style={styles.inlineSectionTitle}>Lineup Watch</Text>
              {pendingPlayers.length > 0 ? (
                <View style={styles.pendingPlayersWrap}>
                  {pendingPlayers.map((player) => (
                    <View key={player.id} style={styles.pendingPlayerChip}>
                      <Text style={styles.pendingPlayerText}>
                        {player.player_name}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.inlineSectionBody}>Everyone on the roster has responded for this game.</Text>
              )}
            </View>

            {subInvitations.length > 0 ? (
              <View style={styles.inlineSection}>
                <Text style={styles.inlineSectionTitle}>Sub Requests</Text>
                <View style={styles.statusList}>
                  {subInvitations.slice(0, 4).map((invite) => (
                    <View key={invite.id} style={styles.statusListRow}>
                      <Text style={styles.statusListTitle}>
                        {invite.invitedPlayer?.fullName ?? 'Invited player'}
                      </Text>
                      <View style={[styles.statusBadge, invite.status === 'accepted' ? styles.statusBadgeSuccess : styles.statusBadgeNeutral]}>
                        <Text style={styles.statusBadgeText}>{invite.status}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {goalieRequest ? (
              <View style={styles.inlineSection}>
                <Text style={styles.inlineSectionTitle}>Goalie Request</Text>
                <View style={styles.goalieStatusCard}>
                  <View style={styles.statusListRow}>
                    <Text style={styles.statusListTitle}>Status</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        goalieRequest.status === 'filled' ? styles.statusBadgeSuccess : styles.statusBadgeNeutral,
                      ]}
                    >
                      <Text style={styles.statusBadgeText}>{goalieRequest.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardMeta}>
                    Skill: {goalieRequest.skillLevelNeeded ?? 'intermediate'}
                    {goalieRequest.compensation ? ` · ${goalieRequest.compensation}` : ''}
                  </Text>
                  {goalieRequest.notes ? <Text style={styles.inlineSectionBody}>{goalieRequest.notes}</Text> : null}
                </View>
              </View>
            ) : null}

            <View style={styles.inlineSection}>
              <Text style={styles.inlineSectionTitle}>Lineup Board</Text>
              <View style={styles.lineupBoard}>
                {roster.map((player) => {
                  const status = lineupStatuses[player.player_id] ?? null;
                  const isSaving = lineupSavingPlayerId === player.player_id;

                  return (
                    <View key={player.id} style={[styles.lineupRow, isCompact && styles.lineupRowCompact]}>
                      <View style={styles.lineupPlayerCopy}>
                        <Text style={styles.lineupPlayerName}>
                          {player.player_name}
                        </Text>
                        <Text style={styles.lineupPlayerMeta}>
                          {player.jersey_number != null ? `#${player.jersey_number}` : 'No #'} ·{' '}
                          {formatRosterPosition(player.position, player.is_goalie)}
                          {player.leadership_role ? ` · ${player.leadership_role === 'captain' ? 'C' : 'A'}` : ''}
                        </Text>
                      </View>

                      <View style={styles.lineupActions}>
                        {[
                          { key: 'confirmed', label: 'IN', tone: 'in' as const },
                          { key: 'tentative', label: 'MAYBE', tone: 'maybe' as const },
                          { key: 'out', label: 'OUT', tone: 'out' as const },
                          { key: 'waiting', label: 'WAIT', tone: 'wait' as const },
                        ].map((option) => {
                          const selected =
                            option.key === 'waiting' ? status == null : status === (option.key as CheckinStatus);
                          const tone = getLineupPillStyle(selected, option.tone);

                          return (
                            <Pressable
                              key={option.key}
                              disabled={isSaving}
                              style={[
                                styles.lineupActionPill,
                                {
                                  backgroundColor: tone.backgroundColor,
                                  borderColor: tone.borderColor,
                                  opacity: isSaving ? 0.5 : 1,
                                },
                              ]}
                              onPress={() =>
                                void handleCaptainStatusChange(
                                  player.player_id,
                                  option.key === 'waiting' ? 'waiting' : (option.key as CheckinStatus),
                                )
                              }
                            >
                              <Text style={[styles.lineupActionText, { color: tone.color }]}>{option.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}

        {teamMessages.length > 0 ? (
          <View testID="team-bulletin-card" style={[styles.messagesCard, publicSurface]}>
            <Text style={styles.sectionTitle}>Team Bulletin</Text>
            <View style={styles.messagesList}>
              {teamMessages.map((message) => (
                <View key={message.id} style={styles.messageRow}>
                  <View style={styles.messageHeader}>
                    <View style={styles.messageTitleWrap}>
                      <Text style={styles.messageTitle}>
                        {message.subject ?? 'Team update'}
                      </Text>
                      <Text style={styles.messageMeta}>
                        {message.sentBy?.fullName ?? 'Team'} · {formatRelativeTime(message.createdAt)}
                      </Text>
                    </View>
                    {message.isUrgent ? (
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentBadgeText}>Urgent</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.messageBody}>{message.message}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        </View> : null}
      </ScrollView>

      <Modal visible={reminderModalVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setReminderModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setReminderModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Send Check-in Reminder</Text>
              <Pressable onPress={() => setReminderModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalMeta}>Post an urgent team bulletin for players who still have not responded.</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              value={reminderMessage}
              onChangeText={setReminderMessage}
              placeholder="Write the reminder to your team..."
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalSecondaryButton} onPress={() => setReminderModalVisible(false)}>
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalPrimaryButton, reminderSaving && styles.buttonDisabled]}
                onPress={() => void handleSendReminder()}
                disabled={reminderSaving}
              >
                <Text style={styles.modalPrimaryButtonText}>{reminderSaving ? 'Sending...' : 'Send Reminder'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={subModalVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setSubModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSubModalVisible(false)}>
          <Pressable style={styles.modalCardLarge} onPress={() => {}}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Invite a Sub</Text>
              <Pressable onPress={() => setSubModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalMeta}>
              Invite registered sub or part-time players from this league for {nextOpponent ?? 'your next game'}.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={subInviteMessage}
              onChangeText={setSubInviteMessage}
              placeholder="Optional message to the player..."
              placeholderTextColor={colors.textSecondary}
            />
            <TextInput
              style={styles.modalInput}
              value={subSearch}
              onChangeText={setSubSearch}
              placeholder="Search by name or email..."
              placeholderTextColor={colors.textSecondary}
            />

            {loadingSubCandidates ? (
              <View style={styles.modalLoadingState}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <ScrollView style={styles.modalList}>
                {filteredSubCandidates.length > 0 ? (
                  filteredSubCandidates.map((candidate) => {
                    const alreadyInvited = invitedPlayerIds.has(candidate.id);
                    return (
                      <View key={candidate.id} style={styles.modalListRow}>
                        <View style={styles.modalListCopy}>
                          <Text style={styles.modalListTitle}>{candidate.full_name ?? 'Unknown player'}</Text>
                          {candidate.email ? <Text style={styles.modalListMeta}>{candidate.email}</Text> : null}
                        </View>
                        {alreadyInvited ? (
                          <View style={[styles.statusBadge, styles.statusBadgeNeutral]}>
                            <Text style={styles.statusBadgeText}>Invited</Text>
                          </View>
                        ) : (
                          <Pressable
                            style={[styles.inlineActionButton, subSavingPlayerId === candidate.id && styles.buttonDisabled]}
                            onPress={() => void handleInviteSub(candidate.id)}
                            disabled={subSavingPlayerId === candidate.id}
                          >
                            <Text style={styles.inlineActionButtonText}>
                              {subSavingPlayerId === candidate.id ? 'Sending...' : 'Invite'}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.emptyInlineState}>
                    <Text style={styles.inlineSectionBody}>No sub players matched this search.</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={goalieModalVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setGoalieModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setGoalieModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Request a Goalie</Text>
              <Pressable onPress={() => setGoalieModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalMeta}>
              Create an open goalie request for {nextOpponent ?? 'this game'} and record the compensation or notes.
            </Text>

            <Text style={styles.fieldLabel}>Skill level needed</Text>
            <View style={styles.skillRow}>
              {GOALIE_SKILL_LEVELS.map((level) => {
                const selected = goalieSkillLevel === level.value;
                return (
                  <Pressable
                    key={level.value}
                    style={[styles.skillPill, selected && styles.skillPillSelected]}
                    onPress={() => setGoalieSkillLevel(level.value)}
                  >
                    <Text style={[styles.skillPillText, selected && styles.skillPillTextSelected]}>{level.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Compensation</Text>
            <TextInput
              style={styles.modalInput}
              value={goalieCompensation}
              onChangeText={setGoalieCompensation}
              placeholder='Example: "Free", "$20", "Beer"'
              placeholderTextColor={colors.textSecondary}
            />

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              value={goalieNotes}
              onChangeText={setGoalieNotes}
              placeholder="Anything the goalie should know..."
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalSecondaryButton} onPress={() => setGoalieModalVisible(false)}>
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalPrimaryButton, goalieSaving && styles.buttonDisabled]}
                onPress={() => void handleRequestGoalie()}
                disabled={goalieSaving}
              >
                <Text style={styles.modalPrimaryButtonText}>{goalieSaving ? 'Posting...' : 'Post Request'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  colorStrip: {
    height: 6,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  stateTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 40,
    gap: 20,
  },
  operationsWrapper: { paddingHorizontal: 16, gap: 20 },
  publicStateCard: {
    marginHorizontal: 16,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: '#03070D',
    padding: 24,
  },
  publicRetryButton: {
    minWidth: 104,
    minHeight: ui.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
  },
  publicRetryText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
    gap: 18,
  },
  heroIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroIdentityCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  heroLogoWell: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  heroEyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroSeason: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  heroName: {
    marginTop: 8,
    color: colors.textPrimary,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  heroRecordRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  heroRecord: {
    color: colors.textPrimary,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '900',
  },
  heroRecordLabel: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  statBox: {
    alignItems: 'center',
    minWidth: 48,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  statBoxCompact: {
    flexBasis: 'auto',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
  },
  opsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
    gap: 14,
  },
  opsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  opsHeaderRowCompact: {
    flexDirection: 'column',
  },
  opsTextWrap: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  opsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  opsMeta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  opsCountsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  opsCountsRowCompact: {
    flexWrap: 'wrap',
  },
  opsHint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  opsPrimaryButton: {
    minHeight: ui.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  opsPrimaryButtonCompact: {
    alignSelf: 'flex-start',
  },
  opsPrimaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  opsSecondaryButton: {
    minHeight: ui.minTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  opsSecondaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  captainCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
    gap: 14,
  },
  captainHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  captainHeaderRowCompact: {
    flexDirection: 'column',
  },
  captainHeaderCopy: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  cardMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 18,
  },
  captainRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary + '44',
    backgroundColor: colors.primary + '16',
  },
  captainRoleText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  captainActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  captainActionRowCompact: {
    flexDirection: 'column',
  },
  captainActionButton: {
    minHeight: ui.minTouchTarget,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    gap: 4,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  captainActionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  captainActionMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.accentRed + '14',
    borderWidth: 1,
    borderColor: colors.accentRed + '30',
  },
  errorText: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    fontSize: 12,
    lineHeight: 17,
    color: colors.accentRed,
  },
  inlineSection: {
    gap: 8,
  },
  inlineSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  inlineSectionBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  pendingPlayersWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pendingPlayerChip: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  pendingPlayerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusList: {
    gap: 8,
  },
  statusListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusListTitle: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusBadgeNeutral: {
    backgroundColor: colors.bgInteractive,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  statusBadgeSuccess: {
    backgroundColor: colors.accentGreen + '20',
    borderWidth: 1,
    borderColor: colors.accentGreen + '40',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  goalieStatusCard: {
    gap: 6,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  lineupBoard: {
    gap: 10,
  },
  lineupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  lineupRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  lineupPlayerCopy: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  lineupPlayerName: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  lineupPlayerMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  lineupActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  lineupActionPill: {
    minHeight: ui.minTouchTarget,
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  lineupActionText: {
    fontSize: 11,
    fontWeight: '800',
  },
  messagesCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
  },
  messagesList: {
    gap: 10,
  },
  messageRow: {
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  messageTitleWrap: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  messageTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  messageMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  messageBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  urgentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.accentRed + '18',
    borderWidth: 1,
    borderColor: colors.accentRed + '30',
  },
  urgentBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.accentRed,
  },
  rosterCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: 16,
  },
  rosterTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  rosterCount: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  emptyRosterTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  emptyRosterBody: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  rosterList: {
    gap: 10,
  },
  rosterPlayerCard: {
    minHeight: ui.minTouchTarget,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: 'rgba(7, 17, 31, 0.42)',
    gap: 12,
  },
  rosterPlayerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rosterJersey: {
    width: 38,
    fontSize: 14,
    fontWeight: '900',
  },
  rosterPlayerIdentity: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  rosterPlayerName: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  rosterPlayerRole: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  rosterStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderCard,
  },
  rosterStatItem: {
    minWidth: 48,
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  rosterStatValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  rosterStatLabel: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  scheduleCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  rosterRowPressed: {
    backgroundColor: colors.bgInteractive,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.74)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    backgroundColor: colors.bgSurface,
    padding: 18,
  },
  modalCardLarge: {
    maxHeight: '78%',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    backgroundColor: colors.bgSurface,
    padding: 18,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  modalCloseButton: {
    width: ui.minTouchTarget,
    height: ui.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.bgInteractive,
  },
  modalMeta: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  modalInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  modalTextarea: {
    minHeight: 104,
    paddingTop: 12,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalPrimaryButton: {
    minHeight: ui.minTouchTarget,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: colors.primary,
  },
  modalPrimaryButtonText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.textOnPrimary,
  },
  modalSecondaryButton: {
    minHeight: ui.minTouchTarget,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: colors.bgInteractive,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  modalSecondaryButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  modalLoadingState: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalList: {
    maxHeight: 300,
  },
  modalListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderCard,
  },
  modalListCopy: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  modalListTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalListMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  inlineActionButton: {
    minHeight: ui.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primary + '18',
    borderWidth: 1,
    borderColor: colors.primary + '36',
  },
  inlineActionButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  emptyInlineState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  skillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillPill: {
    minHeight: ui.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgInteractive,
  },
  skillPillSelected: {
    borderColor: colors.primary + '50',
    backgroundColor: colors.primary + '1A',
  },
  skillPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  skillPillTextSelected: {
    color: colors.primary,
  },
});
