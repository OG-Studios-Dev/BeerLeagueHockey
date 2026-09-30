'use server';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

const isDevelopment = process.env.NODE_ENV !== 'production';

// ============================================================================
// TYPES
// ============================================================================

export interface LegacyCandidate {
  id: string;
  fullName: string;
  teams: Array<{ teamName: string; seasonName: string }>;
  stats: {
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
  };
}

export interface ClaimablePlayerCandidate extends LegacyCandidate {
  emailHint: string | null;
  isLegacyImport: boolean;
}

export interface LegacyMergeStatus {
  hasPendingMatches: boolean;
  matchCount: number;
  isMerged: boolean;
}

// ============================================================================
// CHECK LEGACY MERGE STATUS
// ============================================================================

/**
 * Check if the current user has pending legacy profile matches.
 * Called after login to determine if disambiguation is needed.
 */
export async function checkLegacyMergeStatus(): Promise<LegacyMergeStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { hasPendingMatches: false, matchCount: 0, isMerged: false };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('pending_legacy_match_ids, legacy_merge_completed_at')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return { hasPendingMatches: false, matchCount: 0, isMerged: false };
  }

  const matchIds = (profile as any).pending_legacy_match_ids as string[] | null;
  const mergedAt = (profile as any).legacy_merge_completed_at as string | null;

  return {
    hasPendingMatches: Array.isArray(matchIds) && matchIds.length > 0,
    matchCount: Array.isArray(matchIds) ? matchIds.length : 0,
    isMerged: !!mergedAt,
  };
}

// ============================================================================
// GET LEGACY CANDIDATES
// ============================================================================

/**
 * Fetch the legacy profile candidates for the current user with
 * differentiating info (teams, stats) for disambiguation.
 */
export async function getLegacyCandidates(): Promise<
  { success: true; data: LegacyCandidate[] } | { success: false; error: string }
> {
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  // Get the pending match IDs from the user's profile
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('pending_legacy_match_ids')
    .eq('id', user.id)
    .single();

  const matchIds = (profile as any)?.pending_legacy_match_ids as string[] | null;

  if (!matchIds || matchIds.length === 0) {
    return { success: true, data: [] };
  }

  // Fetch each legacy profile with team/stat context
  const candidates: LegacyCandidate[] = [];

  for (const legacyId of matchIds) {
    // Get basic profile info
    const { data: legacyProfile } = await serviceSupabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', legacyId)
      .single();

    if (!legacyProfile) continue;

    // Get teams played on via team_rosters
    const { data: rosters } = await serviceSupabase
      .from('team_rosters')
      .select('teams:team_id(name), seasons:season_id(name)')
      .eq('player_id', legacyId) as any;

    const teams = (rosters || []).map((r: any) => ({
      teamName: r.teams?.name || 'Unknown Team',
      seasonName: r.seasons?.name || 'Unknown Season',
    }));

    // Get aggregated season totals. player_stats is per-game and does not expose
    // games_played/points columns directly.
    const { data: stats } = await serviceSupabase
      .from('player_season_stats')
      .select('games_played, goals, assists, points')
      .eq('player_id', legacyId) as any;

    const aggregatedStats = (stats || []).reduce(
      (acc: any, s: any) => ({
        gamesPlayed: acc.gamesPlayed + (s.games_played || 0),
        goals: acc.goals + (s.goals || 0),
        assists: acc.assists + (s.assists || 0),
        points: acc.points + (s.points || 0),
      }),
      { gamesPlayed: 0, goals: 0, assists: 0, points: 0 }
    );

    candidates.push({
      id: legacyProfile.id,
      fullName: legacyProfile.full_name || 'Unknown',
      teams,
      stats: aggregatedStats,
    });
  }

  return { success: true, data: candidates };
}

// ============================================================================
// CLAIM LEGACY PROFILE
// ============================================================================

/**
 * Merge a specific legacy profile into the current user's profile.
 * Called when the user selects "This is me" in the disambiguation UI.
 */
export async function claimLegacyProfile(
  legacyProfileId: string
): Promise<{ success: true; pendingApproval: true } | { success: false; error: string }> {
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  // Verify this legacy ID is actually in the user's pending matches
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('pending_legacy_match_ids')
    .eq('id', user.id)
    .single();

  const matchIds = (profile as any)?.pending_legacy_match_ids as string[] | null;

  if (!matchIds || !matchIds.includes(legacyProfileId)) {
    return { success: false, error: 'This legacy profile is not in your pending matches' };
  }

  // pending_legacy_match_ids is discovery/request state only. Selection does not
  // authorize a merge; a platform administrator must review it separately.
  return { success: true, pendingApproval: true };
}

// ============================================================================
// DISMISS LEGACY MATCH
// ============================================================================

/**
 * Clear pending legacy matches — user says "none of these are me".
 */
export async function dismissLegacyMatch(): Promise<
  { success: true } | { success: false; error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  // Preserve pending hints for administrator review. This action now only lets
  // the user leave the chooser; it never clears claim evidence.
  return { success: true };
}

// ============================================================================
// SIGNUP-TIME PLAYER CLAIM SEARCH
// ============================================================================

function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!domain) return null;
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

async function hasAuthUser(serviceSupabase: ReturnType<typeof createServiceRoleClient>, profileId: string): Promise<boolean> {
  const { data, error } = await serviceSupabase.auth.admin.getUserById(profileId);
  return !error && !!data?.user;
}

async function buildClaimableCandidate(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  profile: any
): Promise<ClaimablePlayerCandidate | null> {
  // Never offer an already-auth-backed profile for claiming.
  if (await hasAuthUser(serviceSupabase, profile.id)) {
    return null;
  }

  const { data: rosters } = await serviceSupabase
    .from('team_rosters')
    .select('teams:team_id(name), seasons:season_id(name)')
    .eq('player_id', profile.id) as any;

  if (!rosters || rosters.length === 0) {
    return null;
  }

  const { data: stats } = await serviceSupabase
    .from('player_season_stats')
    .select('games_played, goals, assists, points')
    .eq('player_id', profile.id) as any;

  const aggregatedStats = (stats || []).reduce(
    (acc: any, s: any) => ({
      gamesPlayed: acc.gamesPlayed + (s.games_played || 0),
      goals: acc.goals + (s.goals || 0),
      assists: acc.assists + (s.assists || 0),
      points: acc.points + (s.points || 0),
    }),
    { gamesPlayed: 0, goals: 0, assists: 0, points: 0 }
  );

  return {
    id: profile.id,
    fullName: profile.full_name || 'Unknown Player',
    emailHint: maskEmail(profile.email),
    isLegacyImport: !!profile.is_legacy_import,
    teams: (rosters || []).slice(0, 6).map((r: any) => ({
      teamName: r.teams?.name || 'Unknown Team',
      seasonName: r.seasons?.name || 'Unknown Season',
    })),
    stats: aggregatedStats,
  };
}

/**
 * Find rostered, unclaimed player profile stubs that a signup user may claim.
 * This intentionally returns limited context only and excludes any profile already
 * tied to an auth.users row so a real account cannot be stolen from signup.
 */
export async function searchClaimablePlayerProfiles(
  query: string
): Promise<{ success: true; data: ClaimablePlayerCandidate[] } | { success: false; error: string }> {
  const trimmed = query.trim();
  const safeQuery = trimmed.replace(/[%_,]/g, '').trim();
  if (safeQuery.length < 2) {
    return { success: true, data: [] };
  }

  const serviceSupabase = createServiceRoleClient();

  const { data: profiles, error } = await serviceSupabase
    .from('profiles')
    .select('id, full_name, email, is_legacy_import, legacy_merge_completed_at')
    .or(`full_name.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`)
    .is('legacy_merge_completed_at', null)
    .limit(12) as any;

  if (error) {
    if (isDevelopment) console.error('[legacy-merge] Claimable player search error:', error.message);
    return { success: false, error: 'Player search failed' };
  }

  const candidates: ClaimablePlayerCandidate[] = [];
  for (const profile of profiles || []) {
    const candidate = await buildClaimableCandidate(serviceSupabase, profile);
    if (candidate) candidates.push(candidate);
  }

  return { success: true, data: candidates.slice(0, 8) };
}
