'use server';

import type { ScheduleGame } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { pickOperationalSeason } from '@/lib/seasons/operational';
import { createAuthClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getCaptainGameLineupEditorData } from '@/lib/actions/game-lineups';
import { resolvePlayerPhotoUrl } from '@/lib/player-photo';
import type { LineupAvailability } from '@/lib/lineups/types';
import type { CheckinStatus } from '@/lib/actions/checkins';
import type { GameLineupEditorData } from '@/lib/lineups/types';

type RelevantGameRow = {
  id: string;
  league_id: string;
  season_id: string | null;
  scheduled_at: string;
  location: string | null;
  home_score: number | null;
  away_score: number | null;
  status: ScheduleGame['status'];
  home_team_id: string;
  away_team_id: string;
  home_team: any;
  away_team: any;
};

export type CaptainAttendanceStatus = CheckinStatus | 'no_response';

export interface GameDayAttendancePlayer {
  playerId: string;
  fullName: string;
  avatarUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  status: CaptainAttendanceStatus;
  isSub: boolean;
  replacedPlayerId: string | null;
  replacedPlayerName: string | null;
}

export interface CaptainGameDayData {
  resolvedGameId: string | null;
  game: ScheduleGame | null;
  attendance: GameDayAttendancePlayer[];
  lineup: GameLineupEditorData['lineup'];
  teamId: string;
  leagueId: string;
  leagueSlug: string;
  leagueTimezone: string | null;
  teamName: string;
  opponentName: string;
  scoreSelfEnabled: boolean;
  scoreDisabledReason: string | null;
  attendanceLocked: boolean;
  attendanceLockedAt: string | null;
  counts: {
    in: number;
    out: number;
    unsure: number;
    noResponse: number;
    subs: number;
  };
  rosterPlayerIds: string[];
}

async function verifyCaptainAccess(teamId: string) {
  const auth = await createAuthClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  if (!user) {
    return { authorized: false as const, error: 'Not authenticated' };
  }

  const supabase = createServiceRoleClient();
  const { data: membership } = await (supabase.from('team_rosters') as any)
    .select('player_id, leadership_role')
    .eq('team_id', teamId)
    .eq('player_id', user.id)
    .eq('status', 'active')
    .is('end_date', null)
    .limit(1)
    .maybeSingle();

  if (!membership || !['captain', 'alternate_captain'].includes(membership.leadership_role || '')) {
    return { authorized: false as const, error: 'Not authorized' };
  }

  return { authorized: true as const, auth, supabase };
}

type CaptainCheckinRpcReply = {
  outcome: 'set' | 'reset' | 'already_waiting';
  operation: 'set' | 'reset';
  status: CheckinStatus | null;
  affected_rows: number;
  checkin_id: string | null;
};

const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCaptainCheckinRpcReply(
  value: unknown,
  requestedStatus: CaptainAttendanceStatus,
): value is CaptainCheckinRpcReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  if (Object.keys(reply).sort().join(',') !== 'affected_rows,checkin_id,operation,outcome,status') return false;

  if (requestedStatus === 'no_response') {
    return reply.operation === 'reset'
      && reply.status === null
      && ((reply.outcome === 'reset'
          && reply.affected_rows === 1
          && typeof reply.checkin_id === 'string'
          && POSTGRES_UUID.test(reply.checkin_id))
        || (reply.outcome === 'already_waiting'
          && reply.affected_rows === 0
          && reply.checkin_id === null));
  }

  return reply.outcome === 'set'
    && reply.operation === 'set'
    && reply.status === requestedStatus
    && reply.affected_rows === 1
    && typeof reply.checkin_id === 'string'
    && POSTGRES_UUID.test(reply.checkin_id);
}

function normalizeGameTeam(rawTeam: any) {
  const team = Array.isArray(rawTeam) ? rawTeam[0] : rawTeam;
  return {
    id: team?.id ?? '',
    name: team?.name ?? 'TBD',
    slug: team?.slug ?? '',
    logo: team?.logo_url ?? null,
    colors: team?.primary_color ?? null,
  };
}

function selectRelevantGame(games: RelevantGameRow[], now: Date) {
  const inProgress = games
    .filter((game) => game.status === 'in_progress')
    .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime())[0];

  if (inProgress) {
    return inProgress;
  }

  const upcoming = games
    .filter((game) => game.status === 'scheduled' && new Date(game.scheduled_at).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime())[0];

  if (upcoming) {
    return upcoming;
  }

  return games
    .filter((game) => game.status === 'scheduled')
    .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime())[0] ?? null;
}

function normalizeAvailability(value: string | null | undefined): CaptainAttendanceStatus {
  if (value === 'confirmed' || value === 'tentative' || value === 'out') {
    return value;
  }
  return 'no_response';
}

async function loadAttendancePlayers(
  supabase: ReturnType<typeof createServiceRoleClient>,
  gameId: string,
  teamId: string,
  seasonId?: string | null,
): Promise<GameDayAttendancePlayer[]> {
  let rosterQuery = (supabase.from('team_rosters') as any)
    .select(`
      player_id,
      jersey_number,
      position,
      player_type,
      season_id,
      profile:profiles!team_rosters_player_id_fkey(full_name, avatar_url, photo_url)
    `)
    .eq('team_id', teamId)
    .eq('status', 'active')
    .is('end_date', null)
    .eq('player_type', 'regular');

  if (seasonId) {
    rosterQuery = rosterQuery.eq('season_id', seasonId);
  }

  // Only include subs the captain has actually invited to THIS game.
  // Pending + accepted = invited; declined/expired are excluded.
  const [rosterResult, checkinResult, invitedSubsResult] = await Promise.all([
    rosterQuery,
    (supabase.from('game_checkins') as any)
      .select('player_id, status')
      .eq('game_id', gameId)
      .eq('team_id', teamId),
    (supabase.from('sub_invitations') as any)
      .select(`
        invited_player_id,
        replaced_player_id,
        status,
        invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(full_name, avatar_url, photo_url)
      `)
      .eq('game_id', gameId)
      .eq('team_id', teamId)
      .in('status', ['pending', 'accepted']),
  ]);

  const checkins = new Map<string, CaptainAttendanceStatus>();
  for (const row of checkinResult.data || []) {
    checkins.set(row.player_id, normalizeAvailability(row.status));
  }

  const invitedSubIds = new Set(
    ((invitedSubsResult.data || []) as Array<{ invited_player_id: string | null }>)
      .map((row) => row.invited_player_id)
      .filter((playerId): playerId is string => Boolean(playerId)),
  );

  const players: GameDayAttendancePlayer[] = [];
  const seen = new Set<string>();
  const regularPlayerNames = new Map<string, string>();

  for (const row of rosterResult.data || []) {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    if (!row.player_id || seen.has(row.player_id)) continue;
    seen.add(row.player_id);
    regularPlayerNames.set(row.player_id, profile?.full_name ?? 'Player');

    players.push({
      playerId: row.player_id,
      fullName: profile?.full_name ?? 'Player',
      avatarUrl: resolvePlayerPhotoUrl(profile),
      jerseyNumber: row.jersey_number ?? null,
      position: row.position ?? null,
      status: checkins.get(row.player_id) ?? 'no_response',
      isSub: invitedSubIds.has(row.player_id),
      replacedPlayerId: null,
      replacedPlayerName: null,
    });
  }

  for (const row of invitedSubsResult.data || []) {
    if (!row.invited_player_id || seen.has(row.invited_player_id)) continue;
    const profile = Array.isArray(row.invited_player_profile)
      ? row.invited_player_profile[0]
      : row.invited_player_profile;

    seen.add(row.invited_player_id);
    // Accepted subs are auto-confirmed via game_checkins; pending invites
    // default to no_response until the sub responds or the captain overrides.
    const fallbackStatus: CaptainAttendanceStatus =
      row.status === 'accepted' ? 'confirmed' : 'no_response';

    players.push({
      playerId: row.invited_player_id,
      fullName: profile?.full_name ?? 'Player',
      avatarUrl: resolvePlayerPhotoUrl(profile),
      jerseyNumber: null,
      position: null,
      status: checkins.get(row.invited_player_id) ?? fallbackStatus,
      isSub: true,
      replacedPlayerId: row.replaced_player_id ?? null,
      replacedPlayerName: row.replaced_player_id
        ? regularPlayerNames.get(row.replaced_player_id) ?? null
        : null,
    });
  }

  return players.sort((left, right) => {
    if (left.isSub !== right.isSub) return Number(left.isSub) - Number(right.isSub);
    if (left.jerseyNumber !== null && right.jerseyNumber !== null && left.jerseyNumber !== right.jerseyNumber) {
      return left.jerseyNumber - right.jerseyNumber;
    }
    if (left.jerseyNumber !== null && right.jerseyNumber === null) return -1;
    if (left.jerseyNumber === null && right.jerseyNumber !== null) return 1;
    return left.fullName.localeCompare(right.fullName);
  });
}

async function loadCaptainGameDayData(
  supabase: ReturnType<typeof createServiceRoleClient>,
  teamId: string,
  requestedGameId?: string,
): Promise<{ success: true; data: CaptainGameDayData | null } | { success: false; error: string }> {
  const { data: team } = await (supabase.from('teams') as any)
    .select(`
      id,
      name,
      league_id,
      leagues!inner(
        id,
        slug,
        timezone,
        settings
      )
    `)
    .eq('id', teamId)
    .maybeSingle();

  if (!team) {
    return { success: false, error: 'Team not found' };
  }

  const rawLeague = Array.isArray(team.leagues) ? team.leagues[0] : team.leagues;

  const { data: seasons } = await (supabase.from('seasons') as any)
    .select('id, status, start_date, end_date, created_at')
    .eq('league_id', team.league_id)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false });

  const operationalSeason = pickOperationalSeason(seasons || []);
  const gameSelect = `
      id,
      league_id,
      season_id,
      scheduled_at,
      location,
      home_score,
      away_score,
      status,
      home_team_id,
      away_team_id,
      home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color),
      away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color)
    `;

  let resolvedGame: RelevantGameRow | null = null;

  if (requestedGameId) {
    const { data: requestedGame } = await (supabase.from('games') as any)
      .select(gameSelect)
      .eq('id', requestedGameId)
      .eq('league_id', team.league_id)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .in('status', ['scheduled', 'in_progress'])
      .maybeSingle();

    resolvedGame = (requestedGame as RelevantGameRow | null) ?? null;
  }

  if (!resolvedGame) {
    const loadRelevantGames = async (seasonId?: string | null) => {
      let gamesQuery = (supabase.from('games') as any)
        .select(gameSelect)
        .eq('league_id', team.league_id)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .in('status', ['scheduled', 'in_progress'])
        .order('scheduled_at', { ascending: true })
        .limit(12);

      if (seasonId) {
        gamesQuery = gamesQuery.eq('season_id', seasonId);
      }

      const { data: gameRows } = await gamesQuery;
      return selectRelevantGame((gameRows || []) as RelevantGameRow[], new Date());
    };

    resolvedGame = await loadRelevantGames(operationalSeason?.id ?? null);

    if (!resolvedGame && operationalSeason?.id) {
      resolvedGame = await loadRelevantGames(null);
    }
  }

  if (!resolvedGame) {
    return {
      success: true,
      data: null,
    };
  }

  const lineupResult = await getCaptainGameLineupEditorData(resolvedGame.id, teamId);
  if (!lineupResult.success) {
    return { success: false, error: lineupResult.error };
  }

  const leagueSettings = (rawLeague?.settings as Record<string, unknown> | null) ?? {};
  const scoreSelfEnabled =
    leagueSettings.self_scorekeeper_enabled === true ||
    leagueSettings.scorekeepingMode === 'self_scorekeeping' ||
    leagueSettings.statEntryMode === 'captain';

  const scoreDisabledReason = scoreSelfEnabled
    ? (resolvedGame.status === 'scheduled' || resolvedGame.status === 'in_progress'
        ? null
        : 'Scoring is only available for scheduled or live games.')
    : 'This league requires an assigned scorekeeper.';

  const attendance = await loadAttendancePlayers(
    supabase,
    resolvedGame.id,
    teamId,
    resolvedGame.season_id ?? operationalSeason?.id ?? null,
  );

  const counts = attendance.reduce(
    (summary, player) => {
      if (player.status === 'confirmed') summary.in += 1;
      else if (player.status === 'out') summary.out += 1;
      else if (player.status === 'tentative') summary.unsure += 1;
      else summary.noResponse += 1;

      if (player.isSub) summary.subs += 1;
      return summary;
    },
    { in: 0, out: 0, unsure: 0, noResponse: 0, subs: 0 },
  );

  const game: ScheduleGame = {
    id: resolvedGame.id,
    league_id: resolvedGame.league_id,
    season_id: resolvedGame.season_id ?? operationalSeason?.id ?? '',
    scheduled_at: resolvedGame.scheduled_at,
    venue: resolvedGame.location ?? null,
    home_score: resolvedGame.home_score,
    away_score: resolvedGame.away_score,
    status: resolvedGame.status,
    home_team: normalizeGameTeam(resolvedGame.home_team),
    away_team: normalizeGameTeam(resolvedGame.away_team),
  };

  const opponentName =
    resolvedGame.home_team_id === teamId
      ? normalizeGameTeam(resolvedGame.away_team).name
      : normalizeGameTeam(resolvedGame.home_team).name;

  return {
    success: true,
    data: {
      resolvedGameId: resolvedGame.id,
      game,
      attendance,
      lineup: lineupResult.data.lineup,
      teamId,
      leagueId: team.league_id,
      leagueSlug: rawLeague?.slug ?? '',
      leagueTimezone: rawLeague?.timezone ?? null,
      teamName: lineupResult.data.game.team.name,
      opponentName,
      scoreSelfEnabled,
      scoreDisabledReason,
      attendanceLocked: false,
      attendanceLockedAt: null,
      counts,
      rosterPlayerIds: attendance.filter((player) => !player.isSub).map((player) => player.playerId),
    },
  };
}

export async function getCaptainGameDayDataForAuthorizedTeam(
  teamId: string,
  requestedGameId?: string,
): Promise<{ success: true; data: CaptainGameDayData | null } | { success: false; error: string }> {
  const supabase = createServiceRoleClient();
  return loadCaptainGameDayData(supabase, teamId, requestedGameId);
}

export async function getCaptainGameDayData(
  teamId: string,
  requestedGameId?: string,
): Promise<{ success: true; data: CaptainGameDayData | null } | { success: false; error: string }> {
  const access = await verifyCaptainAccess(teamId);
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return loadCaptainGameDayData(access.supabase, teamId, requestedGameId);
}

export async function lockCaptainGameAttendance(input: {
  gameId: string;
  teamId: string;
  leagueSlug: string;
}) {
  const access = await verifyCaptainAccess(input.teamId);
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const { supabase } = access;
  const { data: game } = await (supabase.from('games') as any)
    .select('id, status, home_team_id, away_team_id')
    .eq('id', input.gameId)
    .maybeSingle();

  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  if (game.home_team_id !== input.teamId && game.away_team_id !== input.teamId) {
    return { success: false, error: 'That team is not assigned to this game' };
  }

  if (game.status === 'completed' || game.status === 'cancelled') {
    return { success: false, error: 'Completed or cancelled games can no longer be edited.' };
  }

  const field = game.home_team_id === input.teamId
    ? 'home_attendance_locked_at'
    : 'away_attendance_locked_at';

  const { error } = await (supabase.from('games') as any)
    .update({
      [field]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.gameId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/${input.leagueSlug}/captain/lineups/${input.gameId}`);
  revalidatePath(`/${input.leagueSlug}/scorekeeper/game/${input.gameId}`);
  return { success: true };
}

export async function updateCaptainGameAttendanceStatus(input: {
  gameId: string;
  teamId: string;
  playerId: string;
  status: CaptainAttendanceStatus;
  leagueSlug: string;
}) {
  const access = await verifyCaptainAccess(input.teamId);
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const { supabase } = access;
  const { data: game } = await (supabase.from('games') as any)
    .select('id, league_id, season_id, scheduled_at, status, home_team_id, away_team_id')
    .eq('id', input.gameId)
    .maybeSingle();

  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  if (game.home_team_id !== input.teamId && game.away_team_id !== input.teamId) {
    return { success: false, error: 'That team is not assigned to this game' };
  }

  const isFutureScheduled = game.status === 'scheduled'
    && new Date(game.scheduled_at).getTime() > Date.now();
  const isActiveDirectPath = game.status === 'in_progress'
    || game.status === 'pending_verification';

  if (!isFutureScheduled && !isActiveDirectPath) {
    return {
      success: false,
      error: 'Attendance can only be edited for a future scheduled or active game.',
    };
  }

  const authRpc = access.auth as unknown as {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await authRpc.rpc('captain_manage_game_checkin', {
    p_game_id: input.gameId,
    p_team_id: input.teamId,
    p_player_id: input.playerId,
    p_operation: input.status === 'no_response' ? 'reset' : 'set',
    p_status: input.status === 'no_response' ? null : input.status,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  if (!isCaptainCheckinRpcReply(data, input.status)) {
    return { success: false, error: 'Invalid captain check-in RPC response' };
  }

  const lockField = game.home_team_id === input.teamId
    ? 'home_attendance_locked_at'
    : 'away_attendance_locked_at';

  await (supabase.from('games') as any)
    .update({
      [lockField]: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.gameId);

  revalidatePath(`/${input.leagueSlug}/captain/lineups/${input.gameId}`);
  revalidatePath(`/${input.leagueSlug}/scorekeeper/game/${input.gameId}`);
  return { success: true };
}
