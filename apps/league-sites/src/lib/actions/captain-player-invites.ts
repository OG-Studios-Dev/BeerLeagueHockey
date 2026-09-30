'use server';

import { getPublicCaptainInvitePreview, type CaptainInvitePreview } from '@/lib/captain/invite-preview';
export type { CaptainInvitePreview } from '@/lib/captain/invite-preview';
import { createAuthClient as createClient, createServiceRoleClient } from '@/lib/supabase/server';

const LEGACY_EMAIL_DOMAIN = 'captaininvite.hockeylifehl.com';
const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

export interface ExistingInviteCandidate {
  rosterId: string;
  playerId: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  playerType: 'regular' | 'sub' | 'part_time';
}

async function verifyCaptain(teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, error: 'Not authenticated' };
  }

  const { data: membership } = await supabase
    .from('team_rosters')
    .select('leadership_role')
    .eq('team_id', teamId)
    .eq('player_id', user.id)
    .eq('status', 'active')
    .is('end_date', null)
    .maybeSingle();

  if (!membership || !['captain', 'alternate_captain'].includes(membership.leadership_role || '')) {
    return { ok: false as const, error: 'Not authorized' };
  }

  return { ok: true as const, userId: user.id };
}

function normalizePhone(phone: string | null | undefined) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (phone?.startsWith('+')) return phone;
  return `+${digits}`;
}

function legacyInviteEmail(id: string) {
  return `captaininvite_${id}@${LEGACY_EMAIL_DOMAIN}`;
}

function isAuthoritativeAuthUserNotFound(response: unknown) {
  if (!response || typeof response !== 'object') return false;

  const { data, error } = response as {
    data?: { user?: unknown } | null;
    error?: {
      __isAuthError?: unknown;
      name?: unknown;
      status?: unknown;
      code?: unknown;
    } | null;
  };

  // This mirrors the installed SDK's isAuthApiError brand check and the
  // getUserById not-found response. Message text is never authoritative.
  return !!data
    && data.user === null
    && !!error
    && error.__isAuthError === true
    && error.name === 'AuthApiError'
    && error.status === 404
    && error.code === 'user_not_found';
}

export async function getCaptainInviteWizardData(teamId: string, seasonId: string) {
  const auth = await verifyCaptain(teamId);
  if (!auth.ok) return { success: false as const, error: auth.error };

  const serviceSupabase = createServiceRoleClient();
  const { data: rows, error } = await (serviceSupabase as any)
    .from('team_rosters')
    .select(`
      id,
      player_id,
      season_id,
      joined_at,
      created_at,
      position,
      player_type,
      leadership_role,
      player:player_id(id, full_name, phone, email, is_legacy_import)
    `)
    .eq('team_id', teamId)
    .eq('status', 'active')
    .is('end_date', null)
    .order('joined_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false });

  if (error) {
    return { success: false as const, error: 'Failed to load invite data' };
  }

  const latestRosterByPlayer = new Map<string, any>();
  for (const row of (rows || []) as any[]) {
    const existing = latestRosterByPlayer.get(row.player_id);
    const rowMatchesSeason = row.season_id === seasonId;
    const existingMatchesSeason = existing?.season_id === seasonId;

    if (!existing || (rowMatchesSeason && !existingMatchesSeason)) {
      latestRosterByPlayer.set(row.player_id, row);
    }
  }

  const enrichedRows = await Promise.all(
    Array.from(latestRosterByPlayer.values()).map(async (row) => {
      const player = Array.isArray(row.player) ? row.player[0] : row.player;
      const normalizedEmail = String(player?.email || '').trim().toLowerCase();
      const isPlaceholderEmail = !normalizedEmail
        || normalizedEmail.includes(LEGACY_EMAIL_DOMAIN)
        || normalizedEmail.startsWith('legacy_');

      let hasAuthAccount = true;
      try {
        const authLookup = await (serviceSupabase as any).auth.admin.getUserById(row.player_id);
        if (!authLookup?.error && authLookup?.data?.user) {
          hasAuthAccount = !!authLookup?.data?.user;
        } else if (isAuthoritativeAuthUserNotFound(authLookup)) {
          hasAuthAccount = false;
        }
      } catch {
        hasAuthAccount = true;
      }

      return {
        rosterId: row.id,
        playerId: row.player_id,
        fullName: player?.full_name || null,
        phone: player?.phone || null,
        email: player?.email || null,
        position: row.position || null,
        playerType: row.player_type || 'regular',
        leadershipRole: row.leadership_role || null,
        isUnlinked: !hasAuthAccount || player?.is_legacy_import === true || isPlaceholderEmail,
      };
    })
  );

  const existingPlayers = enrichedRows
    .filter((row) => row.isUnlinked && !row.leadershipRole)
    .map(({ isUnlinked: _ignored, leadershipRole: _role, ...row }) => row)
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

  return { success: true as const, data: { existingPlayers } };
}

export async function createCaptainPlayerInvite(input: {
  teamId: string;
  seasonId: string;
  existingPlayerId?: string;
  existingRosterId?: string;
  fullName?: string;
  phone?: string;
  position?: string | null;
  isSpare: boolean;
  shareWithLeague?: boolean;
}) {
  const auth = await verifyCaptain(input.teamId);
  if (!auth.ok) return { success: false as const, error: auth.error };

  const serviceSupabase = createServiceRoleClient();
  const { data: team, error: teamError } = await (serviceSupabase as any)
    .from('teams')
    .select('id, name, logo_url, league_id, leagues (id, name, slug, subdomain, custom_domain, custom_domain_verified, logo_url)')
    .eq('id', input.teamId)
    .single();

  if (teamError || !team) {
    return { success: false as const, error: 'Team not found' };
  }

  const { data: season, error: seasonError } = await (serviceSupabase as any)
    .from('seasons')
    .select('id, league_id')
    .eq('id', input.seasonId)
    .eq('league_id', team.league_id)
    .maybeSingle();
  if (seasonError || !season) {
    return { success: false as const, error: 'Season does not belong to this league' };
  }

  const league = Array.isArray(team.leagues) ? team.leagues[0] : team.leagues;
  const brandScope = 'team';
  const playerType = input.isSpare ? 'part_time' : 'regular';
  const normalizedPhone = normalizePhone(input.phone);

  let playerId = input.existingPlayerId || null;
  let rosterId = input.existingRosterId || null;
  let inviteeName = input.fullName?.trim() || null;
  let inviteePhone = normalizedPhone;
  const invitePosition = input.position || null;

  if (Boolean(playerId) !== Boolean(rosterId)) {
    return { success: false as const, error: 'Existing player and roster must be selected together' };
  }

  if (playerId && rosterId) {
    const { data: roster, error: rosterError } = await (serviceSupabase as any)
      .from('team_rosters')
      .select('id, player_id, team_id, season_id, league_id')
      .eq('id', rosterId)
      .eq('player_id', playerId)
      .eq('team_id', input.teamId)
      .eq('season_id', input.seasonId)
      .eq('league_id', team.league_id)
      .eq('status', 'active')
      .is('end_date', null)
      .maybeSingle();
    if (rosterError || !roster) {
      return { success: false as const, error: 'Existing player is not on this team roster' };
    }

    const { data: existing } = await (serviceSupabase as any)
      .from('profiles')
      .select('id, full_name, phone, deleted_at, legacy_merge_completed_at')
      .eq('id', playerId)
      .maybeSingle();

    if (!existing || existing.deleted_at || existing.legacy_merge_completed_at) {
      return { success: false as const, error: 'Existing player not found' };
    }

    try {
      const authLookup = await (serviceSupabase as any).auth.admin.getUserById(playerId);
      if (!authLookup?.error && authLookup?.data?.user) {
        return { success: false as const, error: 'Existing player already has an account' };
      }
      if (!isAuthoritativeAuthUserNotFound(authLookup)) {
        return { success: false as const, error: 'Could not verify existing player eligibility' };
      }
    } catch {
      return { success: false as const, error: 'Could not verify existing player eligibility' };
    }

    inviteeName = inviteeName || existing.full_name || 'Player';
    inviteePhone = inviteePhone || normalizePhone(existing.phone);

    if (inviteePhone && inviteePhone !== existing.phone) {
      await (serviceSupabase as any)
        .from('profiles')
        .update({ phone: inviteePhone, updated_at: new Date().toISOString() })
        .eq('id', playerId);
    }

    if (invitePosition && rosterId) {
      await (serviceSupabase as any)
        .from('team_rosters')
        .update({ position: invitePosition, player_type: playerType })
        .eq('id', rosterId)
        .eq('team_id', input.teamId);
    }
  } else {
    if (!inviteeName) {
      return { success: false as const, error: 'Full name is required' };
    }

    const newPlayerId = crypto.randomUUID();
    const { error: profileError } = await (serviceSupabase as any)
      .from('profiles')
      .insert({
        id: newPlayerId,
        full_name: inviteeName,
        phone: inviteePhone,
        email: legacyInviteEmail(newPlayerId),
        is_legacy_import: true,
      });

    if (profileError) {
      return { success: false as const, error: profileError.message || 'Failed to create player profile' };
    }

    const { data: newRoster, error: rosterError } = await (serviceSupabase as any)
      .from('team_rosters')
      .insert({
        team_id: input.teamId,
        player_id: newPlayerId,
        league_id: team.league_id,
        season_id: input.seasonId,
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
        position: invitePosition,
        player_type: playerType,
      })
      .select('id')
      .single();

    if (rosterError || !newRoster) {
      return { success: false as const, error: rosterError?.message || 'Failed to create roster entry' };
    }

    playerId = newPlayerId;
    rosterId = newRoster.id;
  }

  const { data: invite, error: inviteError } = await (serviceSupabase as any)
    .from('captain_player_invites')
    .insert({
      team_id: input.teamId,
      league_id: team.league_id,
      season_id: input.seasonId,
      roster_id: rosterId,
      target_player_id: playerId,
      invitee_name: inviteeName,
      share_phone: inviteePhone,
      position: invitePosition,
      player_type: playerType,
      share_with_league: false,
      brand_scope: brandScope,
      invited_by: auth.userId,
      registration_path: `/${league.slug}/register?captainInvite=`,
    })
    .select('id')
    .single();

  if (inviteError || !invite) {
    return { success: false as const, error: inviteError?.message || 'Failed to create invite' };
  }

  await (serviceSupabase as any)
    .from('captain_player_invites')
    .update({ registration_path: `/${league.slug}/register?captainInvite=${invite.id}` })
    .eq('id', invite.id);

  const preview = await getPublicCaptainInvitePreview(invite.id);
  if (!preview) {
    return { success: false as const, error: 'Failed to build invite preview' };
  }

  return { success: true as const, data: preview };
}

export async function getCaptainInvitePrefill(inviteId: string) {
  const serviceSupabase = createServiceRoleClient();
  const { data: invite } = await (serviceSupabase as any)
    .from('captain_player_invites')
    .select('id, league_id, season_id, team_id, invitee_name, share_phone, position, created_at, consumed_at')
    .eq('id', inviteId)
    .is('consumed_at', null)
    .maybeSingle();

  if (!invite || (invite.created_at && Date.now() - new Date(invite.created_at).getTime() > INVITE_EXPIRY_MS)) {
    return { success: false as const, error: 'Invite not found' };
  }

  return {
    success: true as const,
    data: {
      current_step: 1,
      season_id: invite.season_id,
      full_name: invite.invitee_name || '',
      phone: invite.share_phone || '',
      primary_position: invite.position || '',
      registration_type: 'individual' as const,
      registration_intent: 'join_team' as const,
      requested_team_id: invite.team_id,
      team_id: invite.team_id,
    },
  };
}

export async function consumeCaptainInvite(inviteId: string) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return { success: false as const, error: 'Not authenticated' };
  }

  const serviceSupabase = createServiceRoleClient();
  const { data: invite } = await (serviceSupabase as any)
    .from('captain_player_invites')
    .select('id, target_player_id, roster_id, consumed_at, share_phone, created_at')
    .eq('id', inviteId)
    .maybeSingle();

  if (!invite || invite.consumed_at) {
    return { success: false as const, error: 'Invite is invalid or no longer available' };
  }

  if (invite.created_at && Date.now() - new Date(invite.created_at).getTime() > INVITE_EXPIRY_MS) {
    return { success: false as const, error: 'Invite is invalid or no longer available' };
  }

  // Link possession, mutable phone, and a signed-in account are not identity
  // proof. Keep the invite and source intact for platform-admin review.
  return { success: false as const, pendingApproval: true as const };
}
