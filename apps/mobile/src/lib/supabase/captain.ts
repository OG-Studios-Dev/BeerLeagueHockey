import type { CheckinStatus } from './checkins';
import { supabase } from './client';

export type CaptainRole = 'captain' | 'alternate_captain';

export type TeamMessageRow = {
  id: string;
  subject: string | null;
  message: string;
  messageType: string | null;
  isUrgent: boolean;
  createdAt: string | null;
  sentBy: {
    id: string;
    fullName: string | null;
  } | null;
};

export type SubCandidate = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type TeamSubInvitation = {
  id: string;
  gameId: string;
  invitedPlayerId: string;
  status: string;
  message: string | null;
  createdAt: string | null;
  invitedPlayer: {
    id: string;
    fullName: string | null;
    email: string | null;
  } | null;
};

export type GoalieRequestRow = {
  id: string;
  status: string;
  skillLevelNeeded: string | null;
  compensation: string | null;
  notes: string | null;
  createdAt: string;
  expiresAt: string | null;
};

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function getCaptainRole(teamId: string): Promise<CaptainRole | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('team_rosters')
    .select('leadership_role')
    .eq('team_id', teamId)
    .eq('player_id', userId)
    .eq('status', 'active')
    .is('end_date', null)
    .limit(1)
    .maybeSingle();

  if (error) return null;

  const role = data?.leadership_role;
  return role === 'captain' || role === 'alternate_captain' ? role : null;
}

async function verifyCaptainAccess(teamId: string) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { userId: null, role: null as CaptainRole | null, error: 'Not authenticated' };
  }

  const role = await getCaptainRole(teamId);
  if (!role) {
    return { userId, role: null as CaptainRole | null, error: 'Captain access required' };
  }

  return { userId, role, error: null as string | null };
}

export async function getRecentTeamMessages(teamId: string, limit = 5): Promise<TeamMessageRow[]> {
  const { data, error } = await supabase
    .from('team_messages')
    .select(`
      id,
      subject,
      message,
      message_type,
      is_urgent,
      created_at,
      sent_by,
      sender:profiles!team_messages_sent_by_fkey(id, full_name)
    `)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as any[]).map((row) => ({
    id: row.id,
    subject: row.subject ?? null,
    message: row.message,
    messageType: row.message_type ?? null,
    isUrgent: !!row.is_urgent,
    createdAt: row.created_at ?? null,
    sentBy: Array.isArray(row.sender) ? row.sender[0] ?? null : row.sender ?? null,
  }));
}

export async function postTeamMessage(input: {
  teamId: string;
  seasonId?: string | null;
  subject?: string | null;
  message: string;
  messageType?: string | null;
  isUrgent?: boolean;
}) {
  const auth = await verifyCaptainAccess(input.teamId);
  if (auth.error || !auth.userId) {
    return { success: false as const, error: auth.error ?? 'Captain access required' };
  }

  const { error } = await supabase.from('team_messages').insert({
    team_id: input.teamId,
    season_id: input.seasonId ?? null,
    subject: input.subject ?? null,
    message: input.message,
    message_type: input.messageType ?? 'captain_alert',
    is_urgent: input.isUrgent ?? false,
    sent_by: auth.userId,
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  return { success: true as const };
}

export async function getLeagueSubPlayers(leagueId: string, excludeTeamId?: string) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false as const, error: 'Not authenticated', data: [] as SubCandidate[] };
  }

  let query = supabase
    .from('team_rosters')
    .select(`
      player_id,
      profile:profiles!team_rosters_player_id_fkey(id, full_name, email)
    `)
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .in('player_type', ['sub', 'part_time']);

  if (excludeTeamId) {
    query = query.neq('team_id', excludeTeamId);
  }

  const { data, error } = await query;
  if (error) {
    return { success: false as const, error: error.message, data: [] as SubCandidate[] };
  }

  const seen = new Set<string>();
  const players: SubCandidate[] = [];

  for (const row of (data as any[]) ?? []) {
    const profile = Array.isArray(row.profile) ? row.profile[0] ?? null : row.profile ?? null;
    if (!profile || seen.has(profile.id)) continue;

    seen.add(profile.id);
    players.push({
      id: profile.id,
      full_name: profile.full_name ?? null,
      email: profile.email ?? null,
    });
  }

  return { success: true as const, data: players, error: null };
}

export async function inviteSub(gameId: string, teamId: string, playerId: string, message?: string) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error || !auth.userId) {
    return { success: false as const, error: auth.error ?? 'Captain access required' };
  }

  const { error } = await supabase.from('sub_invitations').insert({
    game_id: gameId,
    team_id: teamId,
    invited_by: auth.userId,
    invited_player_id: playerId,
    status: 'pending',
    message: message?.trim() ? message.trim() : null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === '23505') {
      return { success: false as const, error: 'This player has already been invited for this game.' };
    }

    return { success: false as const, error: error.message };
  }

  return { success: true as const };
}

export async function getTeamSubInvitations(teamId: string, gameIds?: string[]) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error) {
    return { success: false as const, error: auth.error, data: [] as TeamSubInvitation[] };
  }

  let query = supabase
    .from('sub_invitations')
    .select(`
      id,
      game_id,
      invited_player_id,
      status,
      message,
      created_at,
      invited_player:profiles!sub_invitations_invited_player_id_fkey(id, full_name, email)
    `)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  if (gameIds && gameIds.length > 0) {
    query = query.in('game_id', gameIds);
  }

  const { data, error } = await query;
  if (error) {
    return { success: false as const, error: error.message, data: [] as TeamSubInvitation[] };
  }

  return {
    success: true as const,
    error: null,
    data: ((data as any[]) ?? []).map((row) => ({
      id: row.id,
      gameId: row.game_id,
      invitedPlayerId: row.invited_player_id,
      status: row.status,
      message: row.message ?? null,
      createdAt: row.created_at ?? null,
      invitedPlayer: Array.isArray(row.invited_player) ? row.invited_player[0] ?? null : row.invited_player ?? null,
    })),
  };
}

export async function createGoalieRequest(
  gameId: string,
  teamId: string,
  leagueId: string,
  data: {
    skillLevelNeeded?: string | null;
    compensation?: string | null;
    notes?: string | null;
  },
) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error || !auth.userId) {
    return { success: false as const, error: auth.error ?? 'Captain access required' };
  }

  const { data: existing } = await supabase
    .from('goalie_requests')
    .select('id')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { success: false as const, error: 'A goalie request is already open for this game.' };
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('scheduled_at')
    .eq('id', gameId)
    .limit(1)
    .maybeSingle();

  if (gameError || !game) {
    return { success: false as const, error: 'Game not found.' };
  }

  const expiresAt = new Date(new Date(game.scheduled_at).getTime() - 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('goalie_requests').insert({
    game_id: gameId,
    team_id: teamId,
    league_id: leagueId,
    requested_by: auth.userId,
    skill_level_needed: data.skillLevelNeeded ?? 'intermediate',
    compensation: data.compensation?.trim() ? data.compensation.trim() : null,
    notes: data.notes?.trim() ? data.notes.trim() : null,
    expires_at: expiresAt,
    status: 'open',
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  const { count } = await supabase
    .from('goalie_pool')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('status', 'active');

  return {
    success: true as const,
    error: null,
    notifiedGoalies: count ?? 0,
  };
}

export async function getOpenGoalieRequest(gameId: string, teamId: string): Promise<GoalieRequestRow | null> {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error) return null;

  const { data, error } = await supabase
    .from('goalie_requests')
    .select('id, status, skill_level_needed, compensation, notes, created_at, expires_at')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .in('status', ['open', 'filled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    status: data.status,
    skillLevelNeeded: data.skill_level_needed ?? null,
    compensation: data.compensation ?? null,
    notes: data.notes ?? null,
    createdAt: data.created_at,
    expiresAt: data.expires_at ?? null,
  };
}

export async function getGameCheckinStatusMap(gameId: string, teamId: string) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error) {
    return {} as Record<string, CheckinStatus>;
  }

  const { data, error } = await supabase
    .from('game_checkins')
    .select('player_id, status')
    .eq('game_id', gameId)
    .eq('team_id', teamId);

  if (error || !data) return {} as Record<string, CheckinStatus>;

  return ((data as any[]) ?? []).reduce((acc, row) => {
    acc[row.player_id] = row.status as CheckinStatus;
    return acc;
  }, {} as Record<string, CheckinStatus>);
}

export async function updatePlayerCheckinAsCaptain(
  gameId: string,
  teamId: string,
  playerId: string,
  status: CheckinStatus,
) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error) {
    return { success: false as const, error: auth.error };
  }

  const { error } = await supabase.rpc('captain_manage_game_checkin', {
    p_game_id: gameId,
    p_team_id: teamId,
    p_player_id: playerId,
    p_operation: 'set',
    p_status: status,
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  return { success: true as const };
}

export async function clearPlayerCheckinAsCaptain(gameId: string, teamId: string, playerId: string) {
  const auth = await verifyCaptainAccess(teamId);
  if (auth.error) {
    return { success: false as const, error: auth.error };
  }

  const { error } = await supabase.rpc('captain_manage_game_checkin', {
    p_game_id: gameId,
    p_team_id: teamId,
    p_player_id: playerId,
    p_operation: 'reset',
    p_status: null,
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  return { success: true as const };
}
