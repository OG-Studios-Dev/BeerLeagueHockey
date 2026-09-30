'use server';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/actions/auth';
import { revalidatePath } from 'next/cache';

const isDevelopment = process.env.NODE_ENV !== 'production';

// ============================================================================
// TYPES
// ============================================================================

export interface UnlinkedLegacyProfile {
  id: string;
  fullName: string;
  email: string | null;
  createdAt: string;
  teams: Array<{ teamName: string; seasonName: string }>;
  stats: {
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
  };
}

export interface PlayerSearchResult {
  id: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface MergePreview {
  legacyProfile: UnlinkedLegacyProfile;
  targetPlayer: PlayerSearchResult;
}

export interface MergeHistoryEntry {
  legacyProfileId: string;
  legacyName: string;
  targetProfileId: string;
  targetName: string;
  targetEmail: string | null;
  mergedAt: string;
  totalReassigned: number | null;
}

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// ============================================================================
// AUTH GUARD
// ============================================================================

async function assertPlatformAdmin() {
  const userData = await getCurrentUser();
  if (!userData?.user?.id || !userData.profile?.is_platform_admin) {
    throw new Error('Unauthorized');
  }
  return userData;
}

// ============================================================================
// GET UNLINKED LEGACY PROFILES
// ============================================================================

export async function getUnlinkedLegacyProfiles(): Promise<
  ActionResult<UnlinkedLegacyProfile[]>
> {
  await assertPlatformAdmin();
  const supabase = createServiceRoleClient();

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, created_at')
    .eq('is_legacy_import', true)
    .is('legacy_merge_completed_at', null)
    .order('full_name', { ascending: true })
    .limit(200);

  if (error) {
    if (isDevelopment) console.error('[admin-legacy-merge] fetch error:', error.message);
    return { success: false, error: 'Failed to fetch legacy profiles' };
  }

  const results: UnlinkedLegacyProfile[] = [];

  for (const p of profiles || []) {
    // Fetch teams via team_rosters
    const { data: rosters } = await supabase
      .from('team_rosters')
      .select('teams:team_id(name), seasons:season_id(name)')
      .eq('player_id', p.id) as any;

    const teams = (rosters || []).map((r: any) => ({
      teamName: r.teams?.name || 'Unknown Team',
      seasonName: r.seasons?.name || 'Unknown Season',
    }));

    // Fetch aggregated stats
    const { data: stats } = await supabase
      .from('player_season_stats')
      .select('games_played, goals, assists, points')
      .eq('player_id', p.id) as any;

    const aggregatedStats = (stats || []).reduce(
      (acc: any, s: any) => ({
        gamesPlayed: acc.gamesPlayed + (s.games_played || 0),
        goals: acc.goals + (s.goals || 0),
        assists: acc.assists + (s.assists || 0),
        points: acc.points + (s.points || 0),
      }),
      { gamesPlayed: 0, goals: 0, assists: 0, points: 0 }
    );

    results.push({
      id: p.id,
      fullName: p.full_name || 'Unknown',
      email: p.email ?? null,
      createdAt: p.created_at ?? '',
      teams,
      stats: aggregatedStats,
    });
  }

  return { success: true, data: results };
}

// ============================================================================
// SEARCH PLAYER ACCOUNTS (non-legacy)
// ============================================================================

export async function searchPlayerAccounts(
  query: string
): Promise<ActionResult<PlayerSearchResult[]>> {
  await assertPlatformAdmin();

  if (!query || query.trim().length < 2) {
    return { success: true, data: [] };
  }

  const supabase = createServiceRoleClient();
  const trimmed = query.trim();

  // Search by name (ilike) or email (ilike)
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, created_at')
    .or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`)
    .neq('is_legacy_import', true)
    .order('full_name', { ascending: true })
    .limit(20);

  if (error) {
    if (isDevelopment) console.error('[admin-legacy-merge] search error:', error.message);
    return { success: false, error: 'Search failed' };
  }

  return {
    success: true,
    data: (profiles || []).map((p) => ({
      id: p.id,
      fullName: p.full_name || 'Unknown',
      email: p.email ?? null,
      avatarUrl: p.avatar_url ?? null,
      createdAt: p.created_at ?? '',
    })),
  };
}

// ============================================================================
// EXECUTE MERGE
// ============================================================================

export async function executeAdminMerge(
  targetProfileId: string,
  legacyProfileId: string
): Promise<ActionResult<{ totalReassigned: number }>> {
  const admin = await assertPlatformAdmin();

  if (!targetProfileId || !legacyProfileId) {
    return { success: false, error: 'Both profile IDs are required' };
  }

  if (targetProfileId === legacyProfileId) {
    return { success: false, error: 'Cannot merge a profile into itself' };
  }

  const supabase = createServiceRoleClient();

  // The guarded DB wrapper repeats actor, target, and source invariants under lock.
  const { data, error } = await (supabase.rpc as any)('admin_merge_legacy_profile', {
    p_actor_profile_id: admin.user.id,
    p_target_profile_id: targetProfileId,
    p_source_profile_id: legacyProfileId,
  });

  if (error) {
    if (isDevelopment) console.error('[admin-legacy-merge] RPC error:', error.message);
    return { success: false, error: `Merge failed: ${error.message}` };
  }

  const result = data as any;
  if (result?.success !== true) {
    return { success: false, error: result?.error || 'Merge RPC returned failure' };
  }

  if (typeof result.total_reassigned !== 'number'
    || !Number.isFinite(result.total_reassigned)
    || result.total_reassigned < 0) {
    return { success: false, error: 'Merge RPC returned invalid response' };
  }

  if (isDevelopment) {
    console.info(
      '[admin-legacy-merge] Admin merged legacy %s into %s (%d records)',
      legacyProfileId,
      targetProfileId,
      result.total_reassigned
    );
  }

  revalidatePath('/dashboard/admin/player-merge');

  return { success: true, data: { totalReassigned: result.total_reassigned } };
}

// ============================================================================
// GET MERGE HISTORY
// ============================================================================

export async function getMergeHistory(): Promise<ActionResult<MergeHistoryEntry[]>> {
  await assertPlatformAdmin();
  const supabase = createServiceRoleClient();

  // Fetch legacy profiles that have been merged (legacy_merge_completed_at IS NOT NULL)
  const { data: merged, error } = await supabase
    .from('profiles')
    .select('id, full_name, legacy_merge_completed_at, legacy_merged_into_profile_id')
    .eq('is_legacy_import', true)
    .not('legacy_merge_completed_at', 'is', null)
    .order('legacy_merge_completed_at', { ascending: false })
    .limit(50) as any;

  if (error) {
    if (isDevelopment) console.error('[admin-legacy-merge] history error:', error.message);
    return { success: false, error: 'Failed to fetch merge history' };
  }

  const entries: MergeHistoryEntry[] = [];

  for (const m of merged || []) {
    const targetId = m.legacy_merged_into_profile_id;
    let targetName = 'Unknown';
    let targetEmail: string | null = null;

    if (targetId) {
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', targetId)
        .single();

      if (targetProfile) {
        targetName = targetProfile.full_name || 'Unknown';
        targetEmail = targetProfile.email ?? null;
      }
    }

    entries.push({
      legacyProfileId: m.id,
      legacyName: m.full_name || 'Unknown',
      targetProfileId: targetId ?? '',
      targetName,
      targetEmail,
      mergedAt: m.legacy_merge_completed_at ?? '',
      totalReassigned: null, // Not tracked on the profile row
    });
  }

  return { success: true, data: entries };
}
