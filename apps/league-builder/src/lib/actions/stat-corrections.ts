'use server';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import {
  SPARE_PLAYER_OPTION_ID,
  buildStatEntryPlayerOptions,
  normalizeGoalParticipantIds,
  type StatEntryAttendanceStatus,
  type StatEntryCheckinRow,
  type StatEntryRosterRow,
  type StatEntrySubInvitationRow,
} from '@/lib/games/stat-entry-players';

// ==============================================================================
// TYPES
// ==============================================================================

export interface GameEventForCorrection {
  id: string;
  event_type: string;
  period: number;
  game_time_seconds: number | null;
  team_id: string;
  team_type: 'home' | 'away';
  player_id: string | null;
  player_name: string;
  player_number: number | null;
  assist1_player_id: string | null;
  assist1_name: string | null;
  assist2_player_id: string | null;
  assist2_name: string | null;
  goalie_in_net_id: string | null;
  penalty_type: string | null;
  penalty_minutes: number | null;
  is_power_play: boolean;
  is_short_handed: boolean;
  is_empty_net: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface RosterPlayer {
  id: string;
  full_name: string;
  jersey_number: number;
  team_id: string;
  position: string;
  attendance_status: StatEntryAttendanceStatus;
}

type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

// ==============================================================================
// VALIDATION
// ==============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ==============================================================================
// HELPER: Verify user has admin access to league
// ==============================================================================

async function verifyLeagueAdmin(leagueId: string): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: league } = await supabase
    .from('leagues')
    .select('created_by, organizations(owner_user_id)')
    .eq('id', leagueId)
    .maybeSingle();

  const org = (league as any)?.organizations as { owner_user_id?: string } | null | undefined;
  if ((league as any)?.created_by === user.id || org?.owner_user_id === user.id) {
    return { userId: user.id };
  }

  const { data: membership } = await supabase
    .from('league_memberships')
    .select('role')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membership && ['owner', 'admin'].includes(membership.role)) {
    return { userId: user.id };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .maybeSingle();

  if ((profile as any)?.is_platform_admin === true) {
    return { userId: user.id };
  }

  return null;
}

// ==============================================================================
// GET GAME EVENTS FOR CORRECTION
// ==============================================================================

export async function getGameEventsForCorrection(gameId: string): Promise<ActionResult<{
  events: GameEventForCorrection[];
  rosters: RosterPlayer[];
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  seasonId: string;
  leagueId: string;
}>> {
  try {
    if (!isValidUUID(gameId)) {
      return { success: false, error: 'Invalid game ID' };
    }

    const serviceClient = createServiceRoleClient();

    // Get game info
    const { data: game, error: gameError } = await serviceClient
      .from('games')
      .select('id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, status')
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return { success: false, error: 'Game not found' };
    }

    // Verify admin access
    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) {
      return { success: false, error: 'Unauthorized' };
    }

    // Get events with player names
    const { data: events, error: eventsError } = await serviceClient
      .from('game_events')
      .select(`
        id,
        event_type,
        period,
        game_time_seconds,
        team_id,
        team_type,
        player_id,
        assist1_player_id,
        assist2_player_id,
        goalie_in_net_id,
        penalty_type,
        penalty_minutes,
        is_power_play,
        is_short_handed,
        is_empty_net,
        deleted_at,
        created_at,
        player:profiles!game_events_player_id_fkey(full_name),
        assist1:profiles!game_events_assist1_player_id_fkey(full_name),
        assist2:profiles!game_events_assist2_player_id_fkey(full_name)
      `)
      .eq('game_id', gameId)
      .order('period', { ascending: true })
      .order('game_time_seconds', { ascending: false, nullsFirst: false });

    if (eventsError) {
      return { success: false, error: 'Failed to load events' };
    }

    const teamIds = [game.home_team_id, game.away_team_id];

    // Get active season roster metadata and attendance signals for stat-entry labels.
    let rosterQuery = serviceClient
      .from('team_rosters')
      .select(`
        player_id,
        jersey_number,
        team_id,
        season_id,
        end_date,
        position,
        player_type,
        profiles!team_rosters_player_id_fkey(full_name)
      `)
      .in('team_id', teamIds)
      .eq('status', 'active')
      .is('end_date', null);

    if (game.season_id) {
      rosterQuery = rosterQuery.eq('season_id', game.season_id);
    }

    const [rostersResult, checkinsResult, subInvitationsResult] = await Promise.all([
      rosterQuery,
      serviceClient
        .from('game_checkins')
        .select('player_id, team_id, status')
        .eq('game_id', gameId)
        .in('team_id', teamIds),
      serviceClient
        .from('sub_invitations')
        .select(`
          invited_player_id,
          team_id,
          status,
          invited_player:profiles!sub_invitations_invited_player_id_fkey(full_name)
        `)
        .eq('game_id', gameId)
        .in('team_id', teamIds),
    ]);

    if (rostersResult.error || checkinsResult.error || subInvitationsResult.error) {
      return { success: false, error: 'Failed to load game attendance' };
    }

    const rosters = (rostersResult.data || []) as StatEntryRosterRow[];
    const checkins = (checkinsResult.data || []) as StatEntryCheckinRow[];
    const subInvitations = (subInvitationsResult.data || []) as StatEntrySubInvitationRow[];

    const jerseyMap = new Map(
      rosters.map((r) => [r.player_id, r.jersey_number ?? 0] as [string | null, number]) || []
    );

    const formattedEvents: GameEventForCorrection[] = (events || []).map((e) => ({
      id: e.id,
      event_type: e.event_type,
      period: e.period ?? 1,
      game_time_seconds: e.game_time_seconds,
      team_id: e.team_id,
      team_type: e.team_type as 'home' | 'away',
      player_id: e.player_id,
      player_name: e.player_id ? (e.player as { full_name: string } | null)?.full_name || 'Unknown' : 'Spare',
      player_number: e.player_id ? jerseyMap.get(e.player_id) ?? null : null,
      assist1_player_id: e.assist1_player_id,
      assist1_name: (e.assist1 as { full_name: string } | null)?.full_name || null,
      assist2_player_id: e.assist2_player_id,
      assist2_name: (e.assist2 as { full_name: string } | null)?.full_name || null,
      goalie_in_net_id: e.goalie_in_net_id,
      penalty_type: e.penalty_type,
      penalty_minutes: e.penalty_minutes,
      is_power_play: e.is_power_play || false,
      is_short_handed: e.is_short_handed || false,
      is_empty_net: e.is_empty_net || false,
      deleted_at: e.deleted_at,
      created_at: e.created_at ?? new Date().toISOString(),
    }));

    const formattedRosters: RosterPlayer[] = buildStatEntryPlayerOptions({
      rosterRows: rosters,
      checkinRows: checkins,
      subInvitationRows: subInvitations,
    });

    return {
      success: true,
      data: {
        events: formattedEvents,
        rosters: formattedRosters,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeScore: game.home_score ?? 0,
        awayScore: game.away_score ?? 0,
        seasonId: game.season_id,
        leagueId: game.league_id,
      },
    };
  } catch (error) {
    console.error('getGameEventsForCorrection error:', error);
    return { success: false, error: 'Failed to load game events' };
  }
}

// ==============================================================================
// DELETE GAME EVENT (soft delete)
// ==============================================================================

export async function deleteGameEvent(
  eventId: string,
  reason: string
): Promise<ActionResult<void>> {
  try {
    if (!isValidUUID(eventId)) {
      return { success: false, error: 'Invalid event ID' };
    }

    const serviceClient = createServiceRoleClient();

    // Get event and game info
    const { data: event, error: eventError } = await serviceClient
      .from('game_events')
      .select('id, game_id, event_type, player_id, period, game_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return { success: false, error: 'Event not found' };
    }

    // Get league_id for auth check
    const { data: game } = await serviceClient
      .from('games')
      .select('league_id')
      .eq('id', event.game_id)
      .single();

    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) {
      return { success: false, error: 'Unauthorized' };
    }

    const { error: correctionError } = await (serviceClient as any).rpc(
      'correct_game_event_atomic',
      {
        p_operation: 'delete',
        p_event_id: eventId,
        p_game_id: event.game_id,
        p_changed_by: auth.userId,
        p_event: null,
        p_reason: reason || 'Admin stat correction',
      },
    );

    if (correctionError) {
      console.error('Atomic delete event error:', correctionError);
      return { success: false, error: 'Failed to delete event' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    console.error('deleteGameEvent error:', error);
    return { success: false, error: 'Failed to delete event' };
  }
}

export async function updateGameEvent(
  eventId: string,
  updates: {
    teamId?: string;
    teamType?: 'home' | 'away';
    playerId?: string | null;
    assist1PlayerId?: string | null;
    assist2PlayerId?: string | null;
    goalieInNetId?: string | null;
    period?: number | null;
    penaltyMinutes?: number | null;
    reason?: string;
  },
): Promise<ActionResult<void>> {
  try {
    if (!isValidUUID(eventId) || [updates.teamId, updates.playerId, updates.assist1PlayerId,
      updates.assist2PlayerId, updates.goalieInNetId].some((id) => id != null && !isValidUUID(id))) {
      return { success: false, error: 'Invalid ID format' };
    }
    const serviceClient = createServiceRoleClient();
    const { data: event } = await serviceClient.from('game_events').select('id, game_id').eq('id', eventId).single();
    if (!event) return { success: false, error: 'Event not found' };
    const { data: game } = await serviceClient.from('games').select('league_id').eq('id', event.game_id).single();
    if (!game) return { success: false, error: 'Game not found' };
    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) return { success: false, error: 'Unauthorized' };
    const payload: Record<string, unknown> = {};
    if (updates.teamId !== undefined) payload.team_id = updates.teamId;
    if (updates.teamType !== undefined) payload.team_type = updates.teamType;
    if (updates.playerId !== undefined) payload.player_id = updates.playerId;
    if (updates.assist1PlayerId !== undefined) payload.assist1_player_id = updates.assist1PlayerId;
    if (updates.assist2PlayerId !== undefined) payload.assist2_player_id = updates.assist2PlayerId;
    if (updates.goalieInNetId !== undefined) payload.goalie_in_net_id = updates.goalieInNetId;
    if (updates.period !== undefined) payload.period = updates.period;
    if (updates.penaltyMinutes !== undefined) payload.penalty_minutes = updates.penaltyMinutes;
    const { error } = await (serviceClient as any).rpc('correct_game_event_atomic', {
      p_operation: 'edit', p_event_id: eventId, p_game_id: event.game_id,
      p_changed_by: auth.userId, p_event: payload,
      p_reason: updates.reason || 'Admin stat correction',
    });
    if (error) return { success: false, error: 'Failed to update event' };
    revalidatePath('/');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('updateGameEvent error:', error);
    return { success: false, error: 'Failed to update event' };
  }
}

// ==============================================================================
// ADD GAME EVENT
// ==============================================================================

export async function addGameEvent(data: {
  gameId: string;
  eventType: 'goal' | 'penalty' | 'save';
  period: number;
  gameTimeSeconds?: number;
  teamId: string;
  teamType: 'home' | 'away';
  playerId: string | null;
  assist1PlayerId?: string;
  assist2PlayerId?: string;
  goalieInNetId?: string;
  shotByPlayerId?: string;
  penaltyType?: string;
  penaltyMinutes?: number;
  isPowerPlay?: boolean;
  isShortHanded?: boolean;
  isEmptyNet?: boolean;
  reason?: string;
}): Promise<ActionResult<{ eventId: string }>> {
  try {
    const normalizedParticipants = data.eventType === 'goal'
      ? normalizeGoalParticipantIds({
          scorerId: data.playerId ?? SPARE_PLAYER_OPTION_ID,
          assist1Id: data.assist1PlayerId,
          assist2Id: data.assist2PlayerId,
        })
      : data.eventType === 'save'
        ? {
            playerId: data.playerId,
            assist1PlayerId: data.shotByPlayerId,
            assist2PlayerId: undefined,
          }
        : {
          playerId: data.playerId,
          assist1PlayerId: undefined,
          assist2PlayerId: undefined,
        };

    const hasValidPlayerId = normalizedParticipants.playerId === null
      || isValidUUID(normalizedParticipants.playerId);
    const hasValidAssistIds = [
      normalizedParticipants.assist1PlayerId,
      normalizedParticipants.assist2PlayerId,
      data.goalieInNetId,
    ].every((playerId) => !playerId || isValidUUID(playerId));

    if (!isValidUUID(data.gameId) || !isValidUUID(data.teamId) || !hasValidPlayerId || !hasValidAssistIds) {
      return { success: false, error: 'Invalid ID format' };
    }

    if (data.eventType !== 'goal' && !normalizedParticipants.playerId) {
      return { success: false, error: 'A real player is required for this event type' };
    }

    const serviceClient = createServiceRoleClient();

    // Get game info
    const { data: game } = await serviceClient
      .from('games')
      .select('league_id')
      .eq('id', data.gameId)
      .single();

    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) {
      return { success: false, error: 'Unauthorized' };
    }

    const clientEventId = `admin-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

    const eventPayload = {
        client_event_id: clientEventId,
        event_version: 1,
        sync_status: 'synced',
        created_offline: false,
        game_id: data.gameId,
        league_id: game.league_id,
        team_id: data.teamId,
        team_type: data.teamType,
        player_id: normalizedParticipants.playerId,
        event_type: data.eventType,
        period: data.period,
        game_time_seconds: data.gameTimeSeconds ?? null,
        assist1_player_id: normalizedParticipants.assist1PlayerId || null,
        assist2_player_id: normalizedParticipants.assist2PlayerId || null,
        goalie_in_net_id: data.eventType === 'goal' ? data.goalieInNetId || null : null,
        penalty_type: data.penaltyType || null,
        penalty_minutes: data.penaltyMinutes ?? null,
        is_power_play: data.isPowerPlay || false,
        is_short_handed: data.isShortHanded || false,
        is_empty_net: data.isEmptyNet || false,
        entered_by: auth.userId,
        entered_at: new Date().toISOString(),
      };
    const { data: correction, error: insertError } = await (serviceClient as any).rpc(
      'correct_game_event_atomic',
      {
        p_operation: 'add',
        p_event_id: null,
        p_game_id: data.gameId,
        p_changed_by: auth.userId,
        p_event: eventPayload,
        p_reason: data.reason || 'Admin stat correction',
      },
    );

    if (insertError || !correction?.event_id) {
      console.error('Insert event error:', insertError);
      return { success: false, error: 'Failed to add event' };
    }

    revalidatePath('/');
    return { success: true, data: { eventId: correction.event_id } };
  } catch (error) {
    console.error('addGameEvent error:', error);
    return { success: false, error: 'Failed to add event' };
  }
}

// ==============================================================================
// RECALCULATE GAME STATS
// ==============================================================================

export async function recalculateGameStats(gameId: string): Promise<ActionResult<{
  homeScore: number;
  awayScore: number;
}>> {
  try {
    if (!isValidUUID(gameId)) {
      return { success: false, error: 'Invalid game ID' };
    }

    const serviceClient = createServiceRoleClient();

    // Get game info for auth check
    const { data: game } = await serviceClient
      .from('games')
      .select('league_id, season_id')
      .eq('id', gameId)
      .single();

    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) {
      return { success: false, error: 'Unauthorized' };
    }

    // The database function owns score/stat/standings/audit changes in one
    // transaction. There is deliberately no partial-write fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: recalculated, error: rpcError } = await (serviceClient as any).rpc(
      'recalculate_game_stats_atomic',
      { p_game_id: gameId, p_changed_by: auth.userId },
    );

    if (rpcError) {
      const primaryError = {
        code: typeof rpcError.code === 'string' ? rpcError.code : 'database_error',
        message: typeof rpcError.message === 'string' ? rpcError.message : 'Atomic recalculation failed',
      };
      console.error('Atomic game stats recalculation failed:', primaryError);

      // Failure auditing is best-effort and intentionally excludes RPC details,
      // hints, request payloads, and credentials. It cannot turn a failed
      // recalculation into success or replace the primary failure.
      try {
        const { error: auditError } = await serviceClient.from('game_audit_log').insert({
          game_id: gameId,
          league_id: game.league_id,
          action: 'stat_correction_recalculate_failed',
          changed_by: auth.userId,
          previous_data: null,
          new_data: { primary_error: primaryError } as any,
          reason: 'Atomic stats recalculation failed',
        });
        if (auditError) {
          console.error('Failed to persist recalculation failure audit:', auditError);
        }
      } catch (auditError) {
        console.error('Failed to persist recalculation failure audit:', auditError);
      }
      return { success: false, error: 'Failed to recalculate stats' };
    }

    revalidatePath('/');

    return {
      success: true,
      data: {
        homeScore: Number(recalculated?.home_score ?? 0),
        awayScore: Number(recalculated?.away_score ?? 0),
      },
    };
  } catch (error) {
    console.error('recalculateGameStats error:', error);
    return { success: false, error: 'Failed to recalculate stats' };
  }
}

// ==============================================================================
// UPDATE FINAL SCORE (override without recalculation)
// ==============================================================================

export async function updateFinalScore(
  gameId: string,
  homeScore: number,
  awayScore: number,
  reason: string
): Promise<ActionResult<void>> {
  try {
    if (!isValidUUID(gameId)) {
      return { success: false, error: 'Invalid game ID' };
    }

    if (homeScore < 0 || homeScore > 99 || awayScore < 0 || awayScore > 99) {
      return { success: false, error: 'Score must be between 0 and 99' };
    }

    const serviceClient = createServiceRoleClient();

    const { data: game } = await serviceClient
      .from('games')
      .select('league_id, home_score, away_score')
      .eq('id', gameId)
      .single();

    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const auth = await verifyLeagueAdmin(game.league_id);
    if (!auth) {
      return { success: false, error: 'Unauthorized' };
    }

    const { error: updateError } = await serviceClient
      .from('games')
      .update({
        home_score: homeScore,
        away_score: awayScore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId);

    if (updateError) {
      return { success: false, error: 'Failed to update score' };
    }

    // Audit log
    await serviceClient.from('game_audit_log').insert({
      game_id: gameId,
      league_id: game.league_id,
      action: 'stat_correction_score',
      changed_by: auth.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      previous_data: { home_score: game.home_score, away_score: game.away_score } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new_data: { home_score: homeScore, away_score: awayScore } as any,
      reason: reason || 'Admin score correction',
    });

    revalidatePath('/');

    return { success: true, data: undefined };
  } catch (error) {
    console.error('updateFinalScore error:', error);
    return { success: false, error: 'Failed to update score' };
  }
}
