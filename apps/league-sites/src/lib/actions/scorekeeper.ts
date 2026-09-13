'use server';

import { createServiceRoleClient, createAuthClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { randomBytes, timingSafeEqual } from 'crypto';
import { resolvePlayerPhotoUrl } from '@/lib/player-photo';

// Session cookie name for scorekeeper tokens
const SCOREKEEPER_SESSION_COOKIE = 'sk_session';

export type ScorekeeperSessionOrigin = 'assigned_scorekeeper' | 'captain_self_score';
export type ScorekeeperTeamType = 'home' | 'away';
export type CaptainVerificationMode = 'both_captains' | 'opponent_only';
export type ScorekeeperCaptureStatus = 'complete' | 'not_recorded';
export interface ScorekeeperGoalieAppearance {
  playerId: string;
  teamId: string;
  teamType: ScorekeeperTeamType;
}

// =============================================================================
// Rate limiting (in-memory, same approach as league-builder)
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface TokenFailureEntry {
  failedAttempts: number;
  lockedUntil: number | null;
  lastAttemptTime: number;
}

const ipRateLimitStore = new Map<string, RateLimitEntry>();
const tokenFailureStore = new Map<string, TokenFailureEntry>();

const IP_RATE_LIMIT = 5;
const IP_WINDOW_MS = 60 * 1000;
const TOKEN_FAILURE_LIMIT = 10;
const TOKEN_LOCKOUT_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string, token: string): {
  allowed: boolean;
  error?: string;
  shouldShowCaptcha?: boolean;
  retryAfterMs?: number;
} {
  const now = Date.now();
  const ipKey = `ip:${ip}`;

  // Check IP rate limit
  let ipEntry = ipRateLimitStore.get(ipKey);
  if (!ipEntry || ipEntry.resetTime < now) {
    ipEntry = { count: 1, resetTime: now + IP_WINDOW_MS };
    ipRateLimitStore.set(ipKey, ipEntry);
  } else {
    ipEntry.count++;
    if (ipEntry.count > IP_RATE_LIMIT) {
      return {
        allowed: false,
        error: `Too many attempts. Please try again in ${Math.ceil((ipEntry.resetTime - now) / 1000)} seconds.`,
        shouldShowCaptcha: true,
        retryAfterMs: ipEntry.resetTime - now,
      };
    }
  }

  // Check token failure limit
  const tokenKey = `token:${token.toUpperCase()}`;
  const tokenEntry = tokenFailureStore.get(tokenKey);
  if (tokenEntry) {
    if (tokenEntry.lockedUntil && tokenEntry.lockedUntil > now) {
      return {
        allowed: false,
        error: `Token locked. Try again in ${Math.ceil((tokenEntry.lockedUntil - now) / 60000)} minutes.`,
        retryAfterMs: tokenEntry.lockedUntil - now,
      };
    }
    if (tokenEntry.lockedUntil && tokenEntry.lockedUntil <= now) {
      tokenFailureStore.delete(tokenKey);
    }
  }

  return { allowed: true, shouldShowCaptcha: (ipEntry.count) >= 3 };
}

function recordFailure(token: string) {
  const now = Date.now();
  const key = `token:${token.toUpperCase()}`;
  const entry = tokenFailureStore.get(key);
  if (!entry) {
    tokenFailureStore.set(key, { failedAttempts: 1, lockedUntil: null, lastAttemptTime: now });
  } else {
    entry.failedAttempts++;
    entry.lastAttemptTime = now;
    if (entry.failedAttempts >= TOKEN_FAILURE_LIMIT) {
      entry.lockedUntil = now + TOKEN_LOCKOUT_MS;
    }
  }
}

function clearFailures(token: string) {
  tokenFailureStore.delete(`token:${token.toUpperCase()}`);
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of ipRateLimitStore) {
      if (entry.resetTime < now) ipRateLimitStore.delete(key);
    }
    for (const [key, entry] of tokenFailureStore) {
      if (entry.lockedUntil && entry.lockedUntil < now) tokenFailureStore.delete(key);
    }
  }, 5 * 60 * 1000);
}

// =============================================================================
// Types (shared with components)
// =============================================================================

export interface ScorekeeperSession {
  sessionId: string;
  gameId: string;
  leagueId: string;
  isValid: boolean;
  expiresAt: string;
  gameStatus: string;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string;
  sessionType: 'single' | 'multi';
  sessionOrigin: ScorekeeperSessionOrigin;
  initiatingTeamId: string | null;
  initiatingTeamType: ScorekeeperTeamType | null;
  initiatingCaptainId: string | null;
  attendanceLocked: boolean;
}

export interface GameOfficial {
  id: string;
  name: string;
  role: string;
  jerseyNumber: string | null;
}

export interface PenaltyRule {
  type: string;
  minutes: number;
}

export interface GameData {
  id: string;
  scorekeeperTracksTimePeriods: boolean;
  homeTeam: TeamData;
  awayTeam: TeamData;
  scheduledAt: string;
  status: string;
  periodCount: number;
  periodLengthMinutes: number;
  homeScore: number;
  awayScore: number;
  currentPeriod: number;
  homeVerifiedAt: string | null;
  awayVerifiedAt: string | null;
  statsLockedAt: string | null;
  timerRunning: boolean;
  timerStartedAt: string | null;
  timerElapsedSeconds: number;
  homeGoaliePulled: boolean;
  awayGoaliePulled: boolean;
  officials: GameOfficial[];
  scorekeeperNotes: string | null;
  /** Custom penalty rules from league settings */
  penaltyRules?: PenaltyRule[];
}

export interface TeamData {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  roster: PlayerData[];
  captainId: string | null;
  captainName: string | null;
}

export interface PlayerData {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  jerseyNumber: number;
  position: 'Forward' | 'Defense' | 'Goalie';
  isCaptain: boolean;
  isAssistantCaptain: boolean;
}

export interface GameEventData {
  id: string;
  clientEventId: string;
  eventType: string;
  period: number | null;
  gameTimeSeconds: number | null;
  teamId: string;
  teamType: 'home' | 'away';
  playerId: string | null;
  playerName: string;
  playerNumber: number | null;
  assist1PlayerId: string | null;
  assist1Name: string | null;
  assist1Number: number | null;
  assist2PlayerId: string | null;
  assist2Name: string | null;
  assist2Number: number | null;
  penaltyType: string | null;
  penaltyMinutes: number | null;
  isPowerPlay: boolean;
  isShortHanded: boolean;
  isEmptyNet: boolean;
  goalieInNetId: string | null;
  isGWG: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export interface SessionGameInfo {
  gameId: string;
  gameOrder: number;
  startedAt: string | null;
  completedAt: string | null;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string;
  status: string;
  homeScore: number;
  awayScore: number;
}

// =============================================================================
// Session lookup helper
// =============================================================================

type SessionLookupResult = {
  sessionId: string;
  createdBy: string;
  gameId: string;
  leagueId: string;
  expiresAt: string;
  isValid: boolean;
  gameStatus: string;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string;
  sessionType: 'single' | 'multi';
  sessionOrigin: ScorekeeperSessionOrigin;
  initiatingTeamId: string | null;
  initiatingTeamType: ScorekeeperTeamType | null;
  initiatingCaptainId: string | null;
  attendanceLocked: boolean;
  accessCount: number;
};

async function lookupSessionByToken(
  rawToken: string,
  options?: { touchAccess?: boolean }
): Promise<SessionLookupResult | null> {
  const token = rawToken.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (!token) return null;

  const supabase = createServiceRoleClient();
  const { data, error } = await (supabase as any)
    .from('scorekeeper_sessions')
    .select(`
      *,
      games!inner(
        status,
        scheduled_at,
        home_team_id,
        away_team_id,
        home_attendance_locked_at,
        away_attendance_locked_at,
        home_team:teams!games_home_team_id_fkey(name),
        away_team:teams!games_away_team_id_fkey(name)
      )
    `)
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  const nowMs = Date.now();
  const expiresAtMs = new Date(data.expires_at as string).getTime();
  const isValid = Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  const accessCount = Number((data.access_count as number | null) ?? 0);

  if (options?.touchAccess && isValid) {
    await (supabase as any)
      .from('scorekeeper_sessions')
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: accessCount + 1,
      })
      .eq('id', data.id);
  }

  const game = data.games as {
    status: string | null;
    scheduled_at: string;
    home_team_id: string;
    away_team_id: string;
    home_attendance_locked_at: string | null;
    away_attendance_locked_at: string | null;
    home_team: { name: string } | null;
    away_team: { name: string } | null;
  };

  // A captain self-score session belongs to the initiating team's captain, so
  // "attendance locked" means THAT team's pre-game lock is set (done on the
  // captain game-day page). This lets the scoring surface skip the redundant
  // PreGameCheckin pass. Previously hardcoded to false, which forced captains
  // to re-enter attendance a second time.
  const initiatingTeamTypeValue =
    (data.initiating_team_type as ScorekeeperTeamType | null) ?? null;
  const attendanceLocked =
    initiatingTeamTypeValue === 'home'
      ? Boolean(game?.home_attendance_locked_at)
      : initiatingTeamTypeValue === 'away'
        ? Boolean(game?.away_attendance_locked_at)
        : false;

  return {
    sessionId: data.id,
    createdBy: data.created_by as string,
    gameId: data.game_id,
    leagueId: data.league_id,
    expiresAt: data.expires_at,
    isValid,
    gameStatus: game?.status || 'scheduled',
    homeTeamName: game?.home_team?.name || 'Home',
    awayTeamName: game?.away_team?.name || 'Away',
    scheduledAt: game?.scheduled_at || new Date().toISOString(),
    sessionType: (data.session_type as 'single' | 'multi') || 'single',
    sessionOrigin: (data.session_origin as ScorekeeperSessionOrigin | null) || 'assigned_scorekeeper',
    initiatingTeamId: (data.initiating_team_id as string | null) ?? null,
    initiatingTeamType: initiatingTeamTypeValue,
    initiatingCaptainId: (data.initiating_captain_id as string | null) ?? null,
    attendanceLocked,
    accessCount,
  };
}

/**
 * Verify active scorekeeper session for a given game.
 * Supports both single-game and multi-game sessions.
 */
async function requireActiveSession(gameId: string): Promise<SessionLookupResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SCOREKEEPER_SESSION_COOKIE)?.value;

  if (!token) {
    throw new Error('No scorekeeper session found. Please log in with a valid token.');
  }

  const session = await lookupSessionByToken(token, { touchAccess: false });

  if (!session || !session.isValid) {
    throw new Error('Invalid scorekeeper session. Token may be expired or revoked.');
  }

  // For single-game sessions, verify direct match
  if (session.sessionType === 'single') {
    if (session.gameId !== gameId) {
      throw new Error('Session mismatch: This session is not for this game.');
    }
    return session;
  }

  // For multi-game sessions, check if gameId is in session_games
  const supabase = createServiceRoleClient();
  const { data: sessionGame } = await (supabase as any)
    .from('scorekeeper_session_games')
    .select('id')
    .eq('session_id', session.sessionId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (!sessionGame) {
    throw new Error('This game is not part of your scorekeeper session.');
  }

  return session;
}

async function verifyActiveSession(gameId: string): Promise<string> {
  const session = await requireActiveSession(gameId);
  return session.createdBy;
}

function normalizeGameClockValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeEventPeriod(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function leagueTracksScorekeeperTimePeriods(leagueOrSettings: unknown): boolean {
  if (leagueOrSettings && typeof leagueOrSettings === 'object' && !Array.isArray(leagueOrSettings)) {
    const row = leagueOrSettings as Record<string, unknown>;
    if (typeof row.scorekeeper_tracks_time_periods === 'boolean') return row.scorekeeper_tracks_time_periods;
    const settings = row.settings;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const value = (settings as Record<string, unknown>).scorekeeper_tracks_time_periods;
      if (typeof value === 'boolean') return value;
    }
  }
  return true;
}

function normalizeVerificationToken(token: string): string {
  return token.replace(/[,.()"\\]/g, '');
}

function generateVerificationToken(length = 12): string {
  return randomBytes(8)
    .toString('base64')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .substring(0, length);
}

function buildCaptainVerificationPath(leagueSlug: string, token: string): string {
  return `/${leagueSlug}/verify/${token}`;
}

function buildCaptainVerificationUrl(leagueSlug: string, token: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://beerleaguehockey.ca').replace(/\/$/, '');
  return `${baseUrl}${buildCaptainVerificationPath(leagueSlug, token)}`;
}

function revalidateLeagueSiteGameResultPaths(
  leagueSlug: string,
  teamSlugs: Array<string | null | undefined> = [],
) {
  const paths = Array.from(
    new Set([
      `/${leagueSlug}`,
      `/${leagueSlug}/schedule`,
      `/${leagueSlug}/scores`,
      `/${leagueSlug}/standings`,
      `/${leagueSlug}/playoffs`,
      `/${leagueSlug}/stats`,
      `/${leagueSlug}/teams`,
      `/${leagueSlug}/news`,
      ...teamSlugs.filter(Boolean).map((teamSlug) => `/${leagueSlug}/teams/${teamSlug}`),
    ]),
  );

  for (const path of paths) {
    revalidatePath(path);
  }

  revalidatePath(`/${leagueSlug}`, 'layout');
}

async function finalizeCompletedGameStats(
  supabase: ReturnType<typeof createServiceRoleClient>,
  gameId: string,
  options?: { allowUnverified?: boolean },
): Promise<void> {
  const { data: gameBeforeFinalize, error: gameLookupError } = await supabase
    .from('games')
    .select(`
      status,
      league_id,
      leagues(slug),
      home_team:teams!games_home_team_id_fkey(slug),
      away_team:teams!games_away_team_id_fkey(slug)
    `)
    .eq('id', gameId)
    .single();

  if (gameLookupError || !gameBeforeFinalize) {
    throw new Error('Game not found');
  }

  const wasCompleted = gameBeforeFinalize.status === 'completed';
  const { error: finalizeError } = await (supabase as any).rpc('finalize_game_stats_atomic', {
    p_game_id: gameId,
    p_allow_unverified: options?.allowUnverified ?? false,
  });

  if (finalizeError) {
    throw new Error(finalizeError.message || 'Atomic game finalization failed');
  }

  if (!wasCompleted) {
    const leagueRelation = Array.isArray(gameBeforeFinalize.leagues)
      ? gameBeforeFinalize.leagues[0]
      : gameBeforeFinalize.leagues;
    const homeTeamRelation = Array.isArray(gameBeforeFinalize.home_team)
      ? gameBeforeFinalize.home_team[0]
      : gameBeforeFinalize.home_team;
    const awayTeamRelation = Array.isArray(gameBeforeFinalize.away_team)
      ? gameBeforeFinalize.away_team[0]
      : gameBeforeFinalize.away_team;
    const leagueSlug = leagueRelation?.slug ?? null;

    if (leagueSlug) {
      revalidateLeagueSiteGameResultPaths(leagueSlug, [homeTeamRelation?.slug, awayTeamRelation?.slug]);
    }

  }
}

/**
 * Auto-finalize games that have been stuck in `pending_verification` for more
 * than 24 hours because the opposing captain never opened the verify link.
 *
 * A self-scored submission auto-verifies the initiating side and issues a 24h
 * token to the opponent. If they never respond, the game would otherwise sit in
 * pending_verification forever — never completed. This treats
 * the non-responding side as auto-verified after the window and finalizes the
 * game through the same path a normal verification would (rollup + complete +
 * stats recalculation). Recaps are generated manually from the admin Games page.
 *
 * Intended to be called from a cron route (see /api/cron/auto-finalize-games).
 * Failure on one game never blocks the others.
 */
export async function autoFinalizeExpiredCaptainVerifications(options?: {
  windowHours?: number;
  limit?: number;
}): Promise<{ finalized: number; gameIds: string[]; errors: number }> {
  const windowHours = options?.windowHours ?? 24;
  const limit = options?.limit ?? 100;
  const supabase = createServiceRoleClient();
  const cutoffIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data: games, error } = await supabase
    .from('games')
    .select('id, home_verified_at, away_verified_at, stats_submitted_at')
    .eq('status', 'pending_verification')
    .not('stats_submitted_at', 'is', null)
    .lt('stats_submitted_at', cutoffIso)
    .limit(limit);

  if (error) {
    console.error('[scorekeeper] auto-finalize lookup failed', error.message);
    return { finalized: 0, gameIds: [], errors: 1 };
  }

  if (!games || games.length === 0) {
    return { finalized: 0, gameIds: [], errors: 0 };
  }

  const finalizedIds: string[] = [];
  let errors = 0;

  for (const game of games as Array<{
    id: string;
    home_verified_at: string | null;
    away_verified_at: string | null;
  }>) {
    try {
      await finalizeCompletedGameStats(supabase, game.id, { allowUnverified: true });
      finalizedIds.push(game.id);
      console.log('[scorekeeper] auto-finalized stuck verification', { gameId: game.id, windowHours });
    } catch (finalizeError) {
      console.error('[scorekeeper] auto-finalize failed', { gameId: game.id, error: finalizeError });
      errors += 1;
    }
  }

  return { finalized: finalizedIds.length, gameIds: finalizedIds, errors };
}

/**
 * Constant-time check of an internal server-to-server secret against
 * REVALIDATION_SECRET (the same shared secret league-builder already uses to call
 * /api/revalidate). Fails closed when the secret isn't configured.
 */
function isValidInternalSecret(provided: string | null | undefined): boolean {
  const expected = process.env.REVALIDATION_SECRET;
  if (!expected) return false;
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Admin escape hatch: force-finalize a game now.
 *
 * Secret-gated (not a user-facing session action) — invoked only from the
 * league-builder admin dashboard via the /api/admin/game-lifecycle route. Works
 * from `in_progress` or `pending_verification`; treats any unverified side as
 * verified (like the 24h auto-finalize) and runs the canonical finalize path
 * (rollup + complete + recalc). Idempotent for already-completed games.
 */
export async function adminFinalizeGame(
  gameId: string,
  secret: string,
): Promise<{ success: boolean; status?: string; error?: string }> {
  if (!isValidInternalSecret(secret)) return { success: false, error: 'Unauthorized' };

  const supabase = createServiceRoleClient();
  const { data: game } = await supabase
    .from('games')
    .select('id, status, home_verified_at, away_verified_at')
    .eq('id', gameId)
    .maybeSingle();

  if (!game) return { success: false, error: 'Game not found' };
  if (game.status === 'completed') return { success: true, status: 'completed' };
  if (game.status !== 'in_progress' && game.status !== 'pending_verification') {
    return { success: false, error: `Cannot finalize a ${game.status} game` };
  }

  try {
    await finalizeCompletedGameStats(supabase, gameId, { allowUnverified: true });
    return { success: true, status: 'completed' };
  } catch (error) {
    console.error('[scorekeeper] admin finalize failed', { gameId, error });
    return { success: false, error: error instanceof Error ? error.message : 'Finalize failed' };
  }
}

/**
 * Admin escape hatch: reopen a game that's awaiting verification back to
 * `in_progress` so the score can be corrected.
 *
 * Secret-gated. Only allowed from `pending_verification` — the stats rollup only
 * happens at completion, so nothing needs to be reversed. Reopening a completed
 * game is intentionally refused (that would require unwinding the rollup).
 */
export async function adminReopenGame(
  gameId: string,
  secret: string,
): Promise<{ success: boolean; status?: string; error?: string }> {
  if (!isValidInternalSecret(secret)) return { success: false, error: 'Unauthorized' };

  const supabase = createServiceRoleClient();
  const { data: game } = await supabase
    .from('games')
    .select('id, status')
    .eq('id', gameId)
    .maybeSingle();

  if (!game) return { success: false, error: 'Game not found' };
  if (game.status === 'in_progress') return { success: true, status: 'in_progress' };
  if (game.status !== 'pending_verification') {
    return {
      success: false,
      error: `Only games awaiting verification can be reopened (this game is ${game.status}).`,
    };
  }

  const { error } = await supabase
    .from('games')
    .update({
      status: 'in_progress',
      stats_submitted_at: null,
      home_verified_at: null,
      away_verified_at: null,
      home_verification_token: null,
      away_verification_token: null,
      home_verification_token_expires_at: null,
      away_verification_token_expires_at: null,
    })
    .eq('id', gameId)
    .eq('status', 'pending_verification');

  if (error) return { success: false, error: error.message };

  await recalculateGameDerivedState(supabase, gameId);
  return { success: true, status: 'in_progress' };
}

async function resolveTeamCaptainContact(
  supabase: ReturnType<typeof createServiceRoleClient>,
  teamId: string,
): Promise<{ teamName: string; email: string | null; fullName: string | null }> {
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, captain_id')
    .eq('id', teamId)
    .maybeSingle();

  if (!team) {
    return { teamName: 'Team', email: null, fullName: null };
  }

  const getProfileContact = async (profileId: string | null | undefined) => {
    if (!profileId) {
      return null;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile?.email) {
      return null;
    }

    return {
      teamName: team.name,
      email: profile.email as string,
      fullName: (profile.full_name as string | null) ?? null,
    };
  };

  const directCaptain = await getProfileContact(team.captain_id as string | null | undefined);
  if (directCaptain) {
    return directCaptain;
  }

  for (const role of ['captain', 'alternate_captain'] as const) {
    const { data: rosterCaptain } = await (supabase as any)
      .from('team_rosters')
      .select(`
        player_id,
        profiles!team_rosters_player_id_fkey(email, full_name)
      `)
      .eq('team_id', teamId)
      .eq('status', 'active')
      .eq('leadership_role', role)
      .is('end_date', null)
      .limit(1)
      .maybeSingle();

    const profile = rosterCaptain?.profiles;
    if (profile?.email) {
      return {
        teamName: team.name,
        email: profile.email as string,
        fullName: (profile.full_name as string | null) ?? null,
      };
    }
  }

  return { teamName: team.name, email: null, fullName: null };
}

type VerificationEmailOutcome = 'sent' | 'no_captain_email' | 'email_disabled';

async function maybeEmailCaptainVerificationLink(params: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  leagueName: string;
  leagueSlug: string;
  opposingTeamId: string;
  verificationToken: string;
  expiresAt: string;
}): Promise<VerificationEmailOutcome> {
  const { supabase, leagueName, leagueSlug, opposingTeamId, verificationToken, expiresAt } = params;
  const captain = await resolveTeamCaptainContact(supabase, opposingTeamId);

  if (!captain.email) {
    return 'no_captain_email';
  }

  const { Resend } = await import('resend');
  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  if (!resend) {
    return 'email_disabled';
  }

  const verifyUrl = buildCaptainVerificationUrl(leagueSlug, verificationToken);
  const expiryLabel = new Date(expiresAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; color: #1a1a1a;">Verify Your Game Stats</h2>
      <p style="margin: 0 0 8px; color: #555; font-size: 14px;">
        Hi${captain.fullName ? ` ${captain.fullName}` : ''}, the stats for <strong>${captain.teamName}</strong> in <strong>${leagueName}</strong> are ready for captain verification.
      </p>
      <p style="margin: 0 0 16px; color: #555; font-size: 14px;">
        Review the score sheet and confirm the stats using the link below.
      </p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${verifyUrl}" style="display: inline-block; background: #d4af37; color: #000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Review And Verify
        </a>
      </div>
      <p style="margin: 16px 0 0; color: #888; font-size: 12px; text-align: center;">
        Link expires: ${expiryLabel}
      </p>
    </div>
  `;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@beerleaguehockey.ca';
  await resend.emails.send({
    from: fromEmail,
    to: captain.email,
    subject: `Verify your game stats — ${leagueName}`,
    html,
  });
  return 'sent';
}

async function recalculateGameDerivedState(supabase: any, gameId: string): Promise<void> {
  const { data: goalCounts, error: goalCountError } = await supabase
    .from('game_events')
    .select('team_type')
    .eq('game_id', gameId)
    .eq('event_type', 'goal')
    .is('deleted_at', null);

  if (goalCountError) {
    console.error('[scorekeeper] Failed to recount game goals', goalCountError);
    return;
  }

  const homeScore = goalCounts?.filter((event: { team_type: string | null }) => event.team_type === 'home').length ?? 0;
  const awayScore = goalCounts?.filter((event: { team_type: string | null }) => event.team_type === 'away').length ?? 0;

  const { error: scoreUpdateError } = await supabase
    .from('games')
    .update({ home_score: homeScore, away_score: awayScore })
    .eq('id', gameId);

  if (scoreUpdateError) {
    console.error('[scorekeeper] Failed to persist live game score', scoreUpdateError);
  }

  // Completed-game materialization is transactionally owned by
  // finalize_game_stats_atomic/recalculate_game_stats_atomic. This helper only
  // keeps the live score current while events are being entered.
}

// =============================================================================
// Public server actions
// =============================================================================

/**
 * Request scorekeeper token via email.
 * Always returns success to prevent email enumeration.
 */
export async function requestTokenByEmail(
  leagueSlug: string,
  email: string
): Promise<{ success: boolean }> {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const clientIp = forwardedFor?.split(',')[0].trim() || realIp || 'unknown';

    // Rate limit using a synthetic token key
    const rateLimitCheck = checkRateLimit(clientIp, `email-request:${email}`);
    if (!rateLimitCheck.allowed) {
      return { success: true }; // Silent — never reveal rate limiting for email requests
    }

    const supabase = createServiceRoleClient();

    // Look up league by slug
    const { data: league } = await (supabase as any)
      .from('leagues')
      .select('id, name')
      .eq('slug', leagueSlug)
      .maybeSingle();

    if (!league) return { success: true };

    // Find active scorekeeper with matching email
    const { data: scorekeeper } = await (supabase as any)
      .from('league_scorekeepers')
      .select('id, display_name')
      .eq('league_id', league.id)
      .ilike('email', email.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (!scorekeeper) return { success: true };

    // Find active, non-expired session for this scorekeeper
    const { data: session } = await (supabase as any)
      .from('scorekeeper_sessions')
      .select('token, expires_at, game_id')
      .eq('league_scorekeeper_id', scorekeeper.id)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) return { success: true };

    // Build email content
    const accessUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://beerleaguehockey.ca'}/${leagueSlug}/scorekeeper?token=${session.token}`;
    const expiresAt = new Date(session.expires_at);
    const expiryStr = expiresAt.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px; color: #1a1a1a;">Your Scorekeeper Token</h2>
        <p style="margin: 0 0 8px; color: #555; font-size: 14px;">
          Hi${scorekeeper.display_name ? ` ${scorekeeper.display_name}` : ''}, here is your scorekeeper token for <strong>${league.name}</strong>:
        </p>
        <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; text-align: center; margin: 16px 0;">
          <code style="font-size: 28px; font-family: 'SF Mono', 'Fira Code', monospace; letter-spacing: 0.15em; color: #1a1a1a; font-weight: 600;">
            ${session.token}
          </code>
        </div>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${accessUrl}" style="display: inline-block; background: #d4af37; color: #000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Open Scorekeeper
          </a>
        </div>
        <p style="margin: 16px 0 0; color: #888; font-size: 12px; text-align: center;">
          Token expires: ${expiryStr}
        </p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
        <p style="margin: 0; color: #aaa; font-size: 11px; text-align: center;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `;

    // Send via Resend
    const { Resend } = await import('resend');
    const resend = process.env.RESEND_API_KEY
      ? new Resend(process.env.RESEND_API_KEY)
      : null;

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@beerleaguehockey.ca';

    if (resend) {
      await resend.emails.send({
        from: fromEmail,
        to: email.trim(),
        subject: `Your Scorekeeper Token — ${league.name}`,
        html,
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Request token by email error:', error);
    return { success: true }; // Always return success
  }
}

/**
 * Validate a scorekeeper token and set session cookie
 */
export async function validateScorekeeperToken(token: string): Promise<{
  success: boolean;
  session?: ScorekeeperSession;
  error?: string;
  shouldShowCaptcha?: boolean;
  retryAfterMs?: number;
}> {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const clientIp = forwardedFor?.split(',')[0].trim() || realIp || 'unknown';

    const rateLimitCheck = checkRateLimit(clientIp, token);
    if (!rateLimitCheck.allowed) {
      return {
        success: false,
        error: rateLimitCheck.error,
        shouldShowCaptcha: rateLimitCheck.shouldShowCaptcha,
        retryAfterMs: rateLimitCheck.retryAfterMs,
      };
    }

    const normalizedToken = token.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    const session = await lookupSessionByToken(normalizedToken, { touchAccess: true });

    if (!session || !session.isValid) {
      recordFailure(token);
      return {
        success: false,
        error: 'Token expired or invalid',
        shouldShowCaptcha: rateLimitCheck.shouldShowCaptcha,
      };
    }

    clearFailures(token);

    // Store token in httpOnly cookie
    const cookieStore = await cookies();
    cookieStore.set(SCOREKEEPER_SESSION_COOKIE, normalizedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });

    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        gameId: session.gameId,
        leagueId: session.leagueId,
        isValid: session.isValid,
        expiresAt: session.expiresAt,
        gameStatus: session.gameStatus,
        homeTeamName: session.homeTeamName,
        awayTeamName: session.awayTeamName,
        scheduledAt: session.scheduledAt,
        sessionType: session.sessionType,
        sessionOrigin: session.sessionOrigin,
        initiatingTeamId: session.initiatingTeamId,
        initiatingTeamType: session.initiatingTeamType,
        initiatingCaptainId: session.initiatingCaptainId,
        attendanceLocked: session.attendanceLocked,
      },
    };
  } catch (error) {
    console.error('Token validation error:', error);
    recordFailure(token);
    return { success: false, error: 'Failed to validate token' };
  }
}

/**
 * Get current scorekeeper session from cookie.
 * Uses lookupSessionByToken directly (NOT validateScorekeeperToken) because
 * this is called from server component renders where cookies().set() is forbidden.
 */
export async function getScorekeeperSession(): Promise<{
  success: boolean;
  session?: ScorekeeperSession;
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SCOREKEEPER_SESSION_COOKIE)?.value;
    if (!token) {
      return { success: false, error: 'No session found' };
    }

    const session = await lookupSessionByToken(token);
    if (!session || !session.isValid) {
      return { success: false, error: 'Session expired or invalid' };
    }

    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        gameId: session.gameId,
        leagueId: session.leagueId,
        isValid: session.isValid,
        expiresAt: session.expiresAt,
        gameStatus: session.gameStatus,
        homeTeamName: session.homeTeamName,
        awayTeamName: session.awayTeamName,
        scheduledAt: session.scheduledAt,
        sessionType: session.sessionType,
        sessionOrigin: session.sessionOrigin,
        initiatingTeamId: session.initiatingTeamId,
        initiatingTeamType: session.initiatingTeamType,
        initiatingCaptainId: session.initiatingCaptainId,
        attendanceLocked: session.attendanceLocked,
      },
    };
  } catch (error) {
    console.error('Get session error:', error);
    return { success: false, error: 'Failed to get session' };
  }
}

/**
 * Clear scorekeeper session
 */
export async function clearScorekeeperSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SCOREKEEPER_SESSION_COOKIE);
}

/**
 * Get all games in a multi-game session
 */
export async function getSessionGames(token?: string): Promise<{
  success: boolean;
  games?: SessionGameInfo[];
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const sessionToken = token || cookieStore.get(SCOREKEEPER_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return { success: false, error: 'No session found' };
    }

    const session = await lookupSessionByToken(sessionToken);
    if (!session || !session.isValid) {
      return { success: false, error: 'Invalid session' };
    }

    if (session.sessionType === 'single') {
      // Return the single game
      return {
        success: true,
        games: [{
          gameId: session.gameId,
          gameOrder: 0,
          startedAt: null,
          completedAt: null,
          homeTeamName: session.homeTeamName,
          awayTeamName: session.awayTeamName,
          scheduledAt: session.scheduledAt,
          status: session.gameStatus,
          homeScore: 0,
          awayScore: 0,
        }],
      };
    }

    // Multi-game session: fetch from scorekeeper_session_games
    const supabase = createServiceRoleClient();
    const { data, error } = await (supabase as any)
      .from('scorekeeper_session_games')
      .select(`
        game_id,
        game_order,
        started_at,
        completed_at,
        games!inner(
          status,
          scheduled_at,
          home_score,
          away_score,
          home_team:teams!games_home_team_id_fkey(name),
          away_team:teams!games_away_team_id_fkey(name)
        )
      `)
      .eq('session_id', session.sessionId)
      .order('game_order', { ascending: true });

    if (error) {
      console.error('Get session games error:', error);
      return { success: false, error: 'Failed to load session games' };
    }

    const games: SessionGameInfo[] = (data || []).map((row: any) => ({
      gameId: row.game_id,
      gameOrder: row.game_order,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      homeTeamName: row.games?.home_team?.name || 'Home',
      awayTeamName: row.games?.away_team?.name || 'Away',
      scheduledAt: row.games?.scheduled_at || '',
      status: row.games?.status || 'scheduled',
      homeScore: row.games?.home_score || 0,
      awayScore: row.games?.away_score || 0,
    }));

    return { success: true, games };
  } catch (error) {
    console.error('Get session games error:', error);
    return { success: false, error: 'Failed to load session games' };
  }
}

/**
 * Get full game data for scorekeeper
 */
export async function getScorekeeperGameData(gameId: string): Promise<{
  success: boolean;
  game?: GameData;
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { data: game, error: gameError } = await (supabase as any)
      .from('games')
      .select(`
        id,
        scheduled_at,
        season_id,
        status,
        period_count,
        period_length_minutes,
        home_score,
        away_score,
        current_period,
        home_verified_at,
        away_verified_at,
        stats_locked_at,
        timer_running,
        timer_started_at,
        timer_elapsed_seconds,
        home_goalie_pulled,
        away_goalie_pulled,
        league_id,
        scorekeeper_notes,
        home_team:teams!games_home_team_id_fkey(
          id, name, short_name, logo_url, primary_color, secondary_color, captain_id
        ),
        away_team:teams!games_away_team_id_fkey(
          id, name, short_name, logo_url, primary_color, secondary_color, captain_id
        )
      `)
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return { success: false, error: 'Game not found' };
    }

    // Fetch league settings for custom penalty rules and scorekeeper clock behavior.
    let penaltyRules: PenaltyRule[] | undefined;
    let scorekeeperTracksTimePeriods = true;
    if (game.league_id) {
      const { data: leagueData } = await (supabase as any)
        .from('leagues')
        .select('settings, scorekeeper_tracks_time_periods')
        .eq('id', game.league_id)
        .single();

      scorekeeperTracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueData);

      if (leagueData?.settings?.penalty_rules && Array.isArray(leagueData.settings.penalty_rules)) {
        penaltyRules = leagueData.settings.penalty_rules as PenaltyRule[];
      }
    }

    // Get rosters for both teams
    const [homeRosterResult, awayRosterResult] = await Promise.all([
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select(`
            player_id, jersey_number, position, leadership_role,
            profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
          `)
          .eq('team_id', (game.home_team as { id: string }).id)
          .eq('status', 'active')
          .is('end_date', null);

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select(`
            player_id, jersey_number, position, leadership_role,
            profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
          `)
          .eq('team_id', (game.away_team as { id: string }).id)
          .eq('status', 'active')
          .is('end_date', null);

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
    ]);

    const formatRoster = (roster: any[] | null): PlayerData[] => {
      if (!roster) return [];
      return roster
        .filter(r => r.profiles)
        .map(r => ({
          id: r.player_id,
          fullName: r.profiles.full_name,
          avatarUrl: resolvePlayerPhotoUrl(r.profiles),
          jerseyNumber: r.jersey_number,
          position: r.position as 'Forward' | 'Defense' | 'Goalie',
          isCaptain: r.leadership_role === 'captain',
          isAssistantCaptain: r.leadership_role === 'alternate_captain',
        }))
        .sort((a, b) => a.jerseyNumber - b.jerseyNumber);
    };

    const homeRoster = formatRoster(homeRosterResult.data);
    const awayRoster = formatRoster(awayRosterResult.data);
    const homeCaptain = homeRoster.find(p => p.isCaptain);
    const awayCaptain = awayRoster.find(p => p.isCaptain);

    const homeTeam = game.home_team as any;
    const awayTeam = game.away_team as any;

    const { data: officialsData } = await (supabase as any)
      .from('game_officials')
      .select('id, name, role, jersey_number')
      .eq('game_id', gameId);

    return {
      success: true,
      game: {
        id: game.id,
        scorekeeperTracksTimePeriods,
        homeTeam: {
          id: homeTeam.id,
          name: homeTeam.name,
          shortName: homeTeam.short_name,
          logoUrl: homeTeam.logo_url,
          primaryColor: homeTeam.primary_color,
          secondaryColor: homeTeam.secondary_color,
          roster: homeRoster,
          captainId: homeCaptain?.id || null,
          captainName: homeCaptain?.fullName || null,
        },
        awayTeam: {
          id: awayTeam.id,
          name: awayTeam.name,
          shortName: awayTeam.short_name,
          logoUrl: awayTeam.logo_url,
          primaryColor: awayTeam.primary_color,
          secondaryColor: awayTeam.secondary_color,
          roster: awayRoster,
          captainId: awayCaptain?.id || null,
          captainName: awayCaptain?.fullName || null,
        },
        scheduledAt: game.scheduled_at,
        status: game.status || 'scheduled',
        periodCount: game.period_count || 3,
        periodLengthMinutes: game.period_length_minutes || 20,
        homeScore: game.home_score || 0,
        awayScore: game.away_score || 0,
        currentPeriod: game.current_period || 1,
        homeVerifiedAt: game.home_verified_at,
        awayVerifiedAt: game.away_verified_at,
        statsLockedAt: game.stats_locked_at,
        timerRunning: game.timer_running || false,
        timerStartedAt: game.timer_started_at || null,
        timerElapsedSeconds: game.timer_elapsed_seconds || 0,
        homeGoaliePulled: game.home_goalie_pulled || false,
        awayGoaliePulled: game.away_goalie_pulled || false,
        officials: (officialsData || []).map((o: any) => ({
          id: o.id,
          name: o.name,
          role: o.role,
          jerseyNumber: o.jersey_number,
        })),
        scorekeeperNotes: game.scorekeeper_notes || null,
        penaltyRules,
      },
    };
  } catch (error) {
    console.error('Get game data error:', error);
    return { success: false, error: 'Failed to load game data' };
  }
}

/**
 * Save scorekeeper notes for a game
 */
export async function saveScorekeeperNotes(
  gameId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await verifyActiveSession(gameId);
    const supabase = createServiceRoleClient();

    const { error } = await (supabase as any)
      .from('games')
      .update({ scorekeeper_notes: notes })
      .eq('id', gameId);

    if (error) {
      return { success: false, error: 'Failed to save notes' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to save notes' };
  }
}

/**
 * Lightweight refetch of game events.
 * Used by the scoring interface to refresh after recording events.
 */
export async function refreshGameEvents(gameId: string): Promise<{
  success: boolean;
  events?: GameEventData[];
  homeScore?: number;
  awayScore?: number;
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { data: events, error } = await supabase
      .from('game_events')
      .select(`
        id, client_event_id, event_type, period, game_time_seconds,
        team_id, team_type, player_id,
        assist1_player_id, assist2_player_id,
        penalty_type, penalty_minutes, is_gwg, goalie_in_net_id,
        is_power_play, is_short_handed, is_empty_net,
        created_at, deleted_at,
        player:profiles!game_events_player_id_fkey(full_name),
        assist1:profiles!game_events_assist1_player_id_fkey(full_name),
        assist2:profiles!game_events_assist2_player_id_fkey(full_name)
      `)
      .eq('game_id', gameId)
      .order('period', { ascending: true, nullsFirst: false })
      .order('game_time_seconds', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('refreshGameEvents query error:', error);
      return { success: false, error: 'Failed to load events' };
    }

    const { data: game } = await supabase
      .from('games')
      .select('home_team_id, away_team_id, season_id, home_score, away_score')
      .eq('id', gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };

    let rosterQuery = supabase
      .from('team_rosters')
      .select('player_id, jersey_number')
      .in('team_id', [game.home_team_id, game.away_team_id])
      .is('end_date', null);

    if (game.season_id) {
      rosterQuery = rosterQuery.eq('season_id', game.season_id);
    }

    const { data: rosters } = await rosterQuery;

    const jerseyMap = new Map(rosters?.map((r: { player_id: string; jersey_number: number | null }) => [r.player_id, r.jersey_number]) || []);

    const formattedEvents: GameEventData[] = (events || []).map((e: any) => ({
      id: e.id,
      clientEventId: e.client_event_id,
      eventType: e.event_type,
      period: e.period,
      gameTimeSeconds: e.game_time_seconds,
      teamId: e.team_id,
      teamType: e.team_type as 'home' | 'away',
      playerId: e.player_id,
      playerName: e.player_id ? (e.player as { full_name: string })?.full_name || 'Unknown' : 'Spare',
      playerNumber: e.player_id ? jerseyMap.get(e.player_id) || null : null,
      assist1PlayerId: e.assist1_player_id,
      assist1Name: (e.assist1 as { full_name: string } | null)?.full_name || null,
      assist1Number: e.assist1_player_id ? jerseyMap.get(e.assist1_player_id) || null : null,
      assist2PlayerId: e.assist2_player_id,
      assist2Name: (e.assist2 as { full_name: string } | null)?.full_name || null,
      assist2Number: e.assist2_player_id ? jerseyMap.get(e.assist2_player_id) || null : null,
      penaltyType: e.penalty_type,
      penaltyMinutes: e.penalty_minutes,
      isPowerPlay: e.is_power_play || false,
      isShortHanded: e.is_short_handed || false,
      isEmptyNet: e.is_empty_net || false,
      goalieInNetId: e.goalie_in_net_id ?? null,
      isGWG: e.is_gwg || false,
      createdAt: (e.created_at ?? new Date().toISOString()) as string,
      deletedAt: e.deleted_at,
    }));

    return {
      success: true,
      events: formattedEvents,
      homeScore: game.home_score || 0,
      awayScore: game.away_score || 0,
    };
  } catch (error) {
    console.error('refreshGameEvents error:', error);
    return { success: false, error: 'Failed to refresh events' };
  }
}

/**
 * Get all events for a game
 */
export async function getGameEvents(gameId: string): Promise<{
  success: boolean;
  events?: GameEventData[];
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { data: events, error } = await supabase
      .from('game_events')
      .select(`
        id, client_event_id, event_type, period, game_time_seconds,
        team_id, team_type, player_id,
        assist1_player_id, assist2_player_id,
        penalty_type, penalty_minutes, is_gwg, goalie_in_net_id,
        is_power_play, is_short_handed, is_empty_net,
        created_at, deleted_at,
        player:profiles!game_events_player_id_fkey(full_name),
        assist1:profiles!game_events_assist1_player_id_fkey(full_name),
        assist2:profiles!game_events_assist2_player_id_fkey(full_name)
      `)
      .eq('game_id', gameId)
      .order('period', { ascending: true, nullsFirst: false })
      .order('game_time_seconds', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: 'Failed to load events' };
    }

    const { data: game } = await supabase
      .from('games')
      .select('home_team_id, away_team_id, season_id')
      .eq('id', gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };

    let rosterQuery = supabase
      .from('team_rosters')
      .select('player_id, jersey_number')
      .in('team_id', [game.home_team_id, game.away_team_id])
      .is('end_date', null);

    if (game.season_id) {
      rosterQuery = rosterQuery.eq('season_id', game.season_id);
    }

    const { data: rosters } = await rosterQuery;

    const jerseyMap = new Map(rosters?.map((r: { player_id: string; jersey_number: number | null }) => [r.player_id, r.jersey_number]) || []);

    // Check for is_gwg column existence
    const formattedEvents: GameEventData[] = (events || []).map((e: any) => ({
      id: e.id,
      clientEventId: e.client_event_id,
      eventType: e.event_type,
      period: e.period,
      gameTimeSeconds: e.game_time_seconds,
      teamId: e.team_id,
      teamType: e.team_type as 'home' | 'away',
      playerId: e.player_id,
      playerName: e.player_id ? (e.player as { full_name: string })?.full_name || 'Unknown' : 'Spare',
      playerNumber: e.player_id ? jerseyMap.get(e.player_id) || null : null,
      assist1PlayerId: e.assist1_player_id,
      assist1Name: (e.assist1 as { full_name: string } | null)?.full_name || null,
      assist1Number: e.assist1_player_id ? jerseyMap.get(e.assist1_player_id) || null : null,
      assist2PlayerId: e.assist2_player_id,
      assist2Name: (e.assist2 as { full_name: string } | null)?.full_name || null,
      assist2Number: e.assist2_player_id ? jerseyMap.get(e.assist2_player_id) || null : null,
      penaltyType: e.penalty_type,
      penaltyMinutes: e.penalty_minutes,
      isPowerPlay: e.is_power_play || false,
      isShortHanded: e.is_short_handed || false,
      isEmptyNet: e.is_empty_net || false,
      isGWG: e.is_gwg || false,
      createdAt: (e.created_at ?? new Date().toISOString()) as string,
      deletedAt: e.deleted_at,
    }));

    return { success: true, events: formattedEvents };
  } catch (error) {
    console.error('Get events error:', error);
    return { success: false, error: 'Failed to load events' };
  }
}

/**
 * Add a goal event
 */
export async function addGoalEvent(data: {
  gameId: string;
  teamId: string;
  teamType: 'home' | 'away';
  scorerId: string;
  assist1Id?: string;
  assist2Id?: string;
  period?: number | null;
  gameTimeSeconds?: number | null;
  isPowerPlay?: boolean;
  isShortHanded?: boolean;
  isEmptyNet?: boolean;
  goalieInNetId?: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const enteredByProfileId = await verifyActiveSession(data.gameId);
    const supabase = createServiceRoleClient();

    const { data: game } = await supabase
      .from('games')
      .select('league_id, status, home_team_id, away_team_id, leagues(settings, scorekeeper_tracks_time_periods)')
      .eq('id', data.gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'in_progress') return { success: false, error: 'Game is not in progress' };
    if (data.isEmptyNet && data.goalieInNetId) {
      return { success: false, error: 'An empty-net goal cannot charge a goalie' };
    }
    if (data.goalieInNetId) {
      const expectedGoalieTeamId = data.teamType === 'home' ? game.away_team_id : game.home_team_id;
      const { data: goalieCheckin } = await (supabase as any)
        .from('game_checkins')
        .select('player_id')
        .eq('game_id', data.gameId)
        .eq('team_id', expectedGoalieTeamId)
        .eq('player_id', data.goalieInNetId)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (!goalieCheckin) {
        return { success: false, error: 'Goalie must be confirmed for the defending team' };
      }
    }

    const leagueRelation = Array.isArray((game as any).leagues) ? (game as any).leagues[0] : (game as any).leagues;
    const tracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRelation);
    const period = normalizeEventPeriod(data.period);
    if (tracksTimePeriods && period == null) {
      return { success: false, error: 'Period is required for this league' };
    }

    const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;

    const { data: event, error } = await supabase
      .from('game_events')
      .insert({
        client_event_id: clientEventId,
        event_version: 1,
        sync_status: 'synced',
        created_offline: false,
        game_id: data.gameId,
        league_id: game.league_id,
        team_id: data.teamId,
        team_type: data.teamType,
        player_id: data.scorerId,
        event_type: 'goal',
        period,
        game_time_seconds: tracksTimePeriods ? normalizeGameClockValue(data.gameTimeSeconds) : null,
        assist1_player_id: data.assist1Id || null,
        assist2_player_id: data.assist2Id || null,
        is_power_play: data.isPowerPlay || false,
        is_short_handed: data.isShortHanded || false,
        is_empty_net: data.isEmptyNet || false,
        goalie_in_net_id: data.goalieInNetId || null,
        entered_by: enteredByProfileId,
        entered_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Add goal error:', error);
      return { success: false, error: 'Failed to add goal' };
    }

    await recalculateGameDerivedState(supabase, data.gameId);

    return { success: true, eventId: event.id };
  } catch (error) {
    console.error('Add goal error:', error);
    return { success: false, error: 'Failed to add goal' };
  }
}

/**
 * Add a penalty event
 */
export async function addPenaltyEvent(data: {
  gameId: string;
  teamId: string;
  teamType: 'home' | 'away';
  playerId: string;
  period?: number | null;
  gameTimeSeconds?: number | null;
  penaltyType: string;
  penaltyMinutes: number;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const enteredByProfileId = await verifyActiveSession(data.gameId);
    const supabase = createServiceRoleClient();

    const { data: game } = await supabase
      .from('games')
      .select('league_id, status, leagues(settings, scorekeeper_tracks_time_periods)')
      .eq('id', data.gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'in_progress') return { success: false, error: 'Game is not in progress' };

    const leagueRelation = Array.isArray((game as any).leagues) ? (game as any).leagues[0] : (game as any).leagues;
    const tracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRelation);
    const period = normalizeEventPeriod(data.period);
    if (tracksTimePeriods && period == null) {
      return { success: false, error: 'Period is required for this league' };
    }

    const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;

    const { data: event, error } = await supabase
      .from('game_events')
      .insert({
        client_event_id: clientEventId,
        event_version: 1,
        sync_status: 'synced',
        created_offline: false,
        game_id: data.gameId,
        league_id: game.league_id,
        team_id: data.teamId,
        team_type: data.teamType,
        player_id: data.playerId,
        event_type: 'penalty',
        period,
        game_time_seconds: tracksTimePeriods ? normalizeGameClockValue(data.gameTimeSeconds) : null,
        penalty_type: data.penaltyType,
        penalty_minutes: data.penaltyMinutes,
        entered_by: enteredByProfileId,
        entered_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Add penalty error:', error);
      return { success: false, error: 'Failed to add penalty' };
    }

    await recalculateGameDerivedState(supabase, data.gameId);

    return { success: true, eventId: event.id };
  } catch (error) {
    console.error('Add penalty error:', error);
    return { success: false, error: 'Failed to add penalty' };
  }
}

/**
 * Add a shot/save event
 */
export async function addShotEvent(data: {
  gameId: string;
  teamId: string;
  teamType: 'home' | 'away';
  goalieId: string;
  shotByPlayerId?: string;
  period?: number | null;
  gameTimeSeconds?: number | null;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const enteredByProfileId = await verifyActiveSession(data.gameId);
    const supabase = createServiceRoleClient();

    const { data: game } = await supabase
      .from('games')
      .select('league_id, status, leagues(settings, scorekeeper_tracks_time_periods)')
      .eq('id', data.gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'in_progress') return { success: false, error: 'Game is not in progress' };

    const leagueRelation = Array.isArray((game as any).leagues) ? (game as any).leagues[0] : (game as any).leagues;
    const tracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRelation);
    const period = normalizeEventPeriod(data.period);
    if (tracksTimePeriods && period == null) {
      return { success: false, error: 'Period is required for this league' };
    }

    const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;

    const { data: event, error } = await supabase
      .from('game_events')
      .insert({
        client_event_id: clientEventId,
        event_version: 1,
        sync_status: 'synced',
        created_offline: false,
        game_id: data.gameId,
        league_id: game.league_id,
        team_id: data.teamId,
        team_type: data.teamType,
        player_id: data.goalieId,
        assist1_player_id: data.shotByPlayerId || null,
        event_type: 'save',
        period,
        game_time_seconds: tracksTimePeriods ? normalizeGameClockValue(data.gameTimeSeconds) : null,
        entered_by: enteredByProfileId,
        entered_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Add shot error:', error);
      return { success: false, error: 'Failed to record shot' };
    }

    await recalculateGameDerivedState(supabase, data.gameId);

    return { success: true, eventId: event.id };
  } catch (error) {
    console.error('Add shot error:', error);
    return { success: false, error: 'Failed to record shot' };
  }
}

/**
 * Undo/soft-delete an event
 */
export async function undoEvent(eventId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const supabase = createServiceRoleClient();

    const { data: event } = await supabase
      .from('game_events')
      .select('game_id, event_type, team_type')
      .eq('id', eventId)
      .single();

    if (!event) return { success: false, error: 'Event not found' };

    const enteredByProfileId = await verifyActiveSession(event.game_id);

    const { error } = await supabase
      .from('game_events')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: enteredByProfileId,
      })
      .eq('id', eventId);

    if (error) {
      return { success: false, error: 'Failed to undo event' };
    }

    await recalculateGameDerivedState(supabase, event.game_id);

    return { success: true };
  } catch (error) {
    console.error('Undo event error:', error);
    return { success: false, error: 'Failed to undo event' };
  }
}

/**
 * Edit an existing goal or penalty event in place.
 *
 * Lets a scorekeeper correct a mis-entered event (wrong scorer, missing assist,
 * wrong period/time, wrong penalty) without the undo + re-add dance. Only
 * provided fields are changed; omitted fields keep their current value. Pass
 * `null` for an assist to clear it. Bumps event_version for offline-sync
 * conflict detection and recalculates derived game state.
 */
export async function updateGameEvent(data: {
  eventId: string;
  teamId?: string;
  teamType?: 'home' | 'away';
  period?: number | null;
  gameTimeSeconds?: number | null;
  // Goal fields
  scorerId?: string;
  assist1Id?: string | null;
  assist2Id?: string | null;
  isPowerPlay?: boolean;
  isShortHanded?: boolean;
  isEmptyNet?: boolean;
  goalieInNetId?: string | null;
  // Penalty fields
  playerId?: string;
  penaltyType?: string;
  penaltyMinutes?: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceRoleClient();

    const { data: event } = await supabase
      .from('game_events')
      .select(
        'id, game_id, event_type, event_version, deleted_at, team_id, team_type, player_id, ' +
          'assist1_player_id, assist2_player_id, period, game_time_seconds, ' +
          'is_power_play, is_short_handed, is_empty_net, goalie_in_net_id, penalty_type, penalty_minutes',
      )
      .eq('id', data.eventId)
      .single();

    if (!event) return { success: false, error: 'Event not found' };
    if (event.deleted_at) return { success: false, error: 'Cannot edit a removed event' };
    if (event.event_type !== 'goal' && event.event_type !== 'penalty') {
      return { success: false, error: 'Only goals and penalties can be edited' };
    }

    const enteredByProfileId = await verifyActiveSession(event.game_id);

    const { data: game } = await supabase
      .from('games')
      .select('status, leagues(settings, scorekeeper_tracks_time_periods)')
      .eq('id', event.game_id)
      .single();

    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'in_progress') {
      return { success: false, error: 'Game is not in progress' };
    }

    const leagueRelation = Array.isArray((game as any).leagues)
      ? (game as any).leagues[0]
      : (game as any).leagues;
    const tracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRelation);

    // Resolve effective period / clock (only enforce when the league tracks them)
    const effectivePeriod =
      data.period !== undefined ? normalizeEventPeriod(data.period) : event.period;
    if (tracksTimePeriods && effectivePeriod == null) {
      return { success: false, error: 'Period is required for this league' };
    }
    const effectiveClock = tracksTimePeriods
      ? normalizeGameClockValue(
          data.gameTimeSeconds !== undefined ? data.gameTimeSeconds : event.game_time_seconds,
        )
      : null;

    const updatePayload: Record<string, unknown> = {
      team_id: data.teamId ?? event.team_id,
      team_type: data.teamType ?? event.team_type,
      period: effectivePeriod,
      game_time_seconds: effectiveClock,
      event_version: (event.event_version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    };

    if (event.event_type === 'goal') {
      const scorerId = data.scorerId ?? event.player_id;
      const assist1Id =
        data.assist1Id !== undefined ? data.assist1Id : event.assist1_player_id;
      const assist2Id =
        data.assist2Id !== undefined ? data.assist2Id : event.assist2_player_id;

      if (assist1Id && assist1Id === scorerId) {
        return { success: false, error: 'A scorer cannot also be credited with an assist' };
      }
      if (assist2Id && assist2Id === scorerId) {
        return { success: false, error: 'A scorer cannot also be credited with an assist' };
      }
      if (assist1Id && assist2Id && assist1Id === assist2Id) {
        return { success: false, error: 'The two assists must be different players' };
      }

      updatePayload.player_id = scorerId;
      updatePayload.assist1_player_id = assist1Id || null;
      updatePayload.assist2_player_id = assist2Id || null;
      updatePayload.is_power_play =
        data.isPowerPlay !== undefined ? data.isPowerPlay : event.is_power_play ?? false;
      updatePayload.is_short_handed =
        data.isShortHanded !== undefined ? data.isShortHanded : event.is_short_handed ?? false;
      updatePayload.is_empty_net =
        data.isEmptyNet !== undefined ? data.isEmptyNet : event.is_empty_net ?? false;
      updatePayload.goalie_in_net_id =
        data.goalieInNetId !== undefined ? data.goalieInNetId : event.goalie_in_net_id;
      if (updatePayload.is_empty_net && updatePayload.goalie_in_net_id) {
        return { success: false, error: 'An empty-net goal cannot charge a goalie' };
      }
    } else {
      // penalty
      updatePayload.player_id = data.playerId ?? event.player_id;
      updatePayload.penalty_type = data.penaltyType ?? event.penalty_type;
      const minutes = data.penaltyMinutes ?? event.penalty_minutes;
      if (minutes == null || minutes <= 0) {
        return { success: false, error: 'Penalty minutes must be greater than zero' };
      }
      updatePayload.penalty_minutes = minutes;
    }

    const { error } = await supabase
      .from('game_events')
      .update(updatePayload)
      .eq('id', data.eventId);

    if (error) {
      console.error('Update event error:', error);
      return { success: false, error: 'Failed to update event' };
    }

    await recalculateGameDerivedState(supabase, event.game_id);

    return { success: true };
  } catch (error) {
    console.error('Update event error:', error);
    return { success: false, error: 'Failed to update event' };
  }
}

/**
 * Sync timer state to server
 */
export async function syncTimerState(
  gameId: string,
  state: {
    timerRunning: boolean;
    timerElapsedSeconds: number;
    currentPeriod: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { error } = await supabase
      .from('games')
      .update({
        timer_running: state.timerRunning,
        timer_elapsed_seconds: state.timerElapsedSeconds,
        current_period: state.currentPeriod,
        timer_started_at: state.timerRunning ? new Date().toISOString() : null,
      })
      .eq('id', gameId);

    if (error) {
      console.error('Sync timer error:', error);
      return { success: false, error: 'Failed to sync timer' };
    }

    return { success: true };
  } catch (error) {
    console.error('Sync timer error:', error);
    return { success: false, error: 'Failed to sync timer' };
  }
}

/**
 * Toggle goalie pull state
 */
export async function toggleGoaliePull(
  gameId: string,
  teamType: 'home' | 'away'
): Promise<{ success: boolean; pulled?: boolean; error?: string }> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();
    const column = teamType === 'home' ? 'home_goalie_pulled' : 'away_goalie_pulled';

    // Get current state
    const { data: game } = await supabase
      .from('games')
      .select(column)
      .eq('id', gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };

    const currentPulled = (game as any)[column] || false;
    const newPulled = !currentPulled;

    const { error } = await supabase
      .from('games')
      .update({ [column]: newPulled })
      .eq('id', gameId);

    if (error) {
      return { success: false, error: 'Failed to toggle goalie' };
    }

    return { success: true, pulled: newPulled };
  } catch (error) {
    console.error('Toggle goalie error:', error);
    return { success: false, error: 'Failed to toggle goalie' };
  }
}

/**
 * Batch add events from score sheet photo analysis.
 * Maps jersey numbers to player IDs and inserts goals/penalties.
 */
export async function batchAddEvents(
  gameId: string,
  events: Array<{
    type: 'goal' | 'penalty';
    teamType: 'home' | 'away';
    period?: number | null;
    gameTimeSeconds?: number | null;
    scorerJersey?: number;
    assist1Jersey?: number | null;
    assist2Jersey?: number | null;
    penaltyType?: string;
    penaltyMinutes?: number;
    playerJersey?: number;
  }>
): Promise<{ success: boolean; addedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let addedCount = 0;

  try {
    const enteredByProfileId = await verifyActiveSession(gameId);
    const supabase = createServiceRoleClient();

    // Load game to get team IDs and league_id
    const { data: game } = await supabase
      .from('games')
      .select('league_id, home_team_id, away_team_id, season_id')
      .eq('id', gameId)
      .single();

    if (!game) return { success: false, addedCount: 0, errors: ['Game not found'] };

    // Load rosters for both teams to build jersey→playerId map
    const [homeRosterResult, awayRosterResult] = await Promise.all([
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select('player_id, jersey_number')
          .eq('team_id', game.home_team_id)
          .eq('status', 'active')
          .is('end_date', null);

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select('player_id, jersey_number')
          .eq('team_id', game.away_team_id)
          .eq('status', 'active')
          .is('end_date', null);

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
    ]);

    const homeJerseyMap = new Map<number, string>();
    (homeRosterResult.data || []).forEach((r: { player_id: string; jersey_number: number }) => {
      homeJerseyMap.set(r.jersey_number, r.player_id);
    });

    const awayJerseyMap = new Map<number, string>();
    (awayRosterResult.data || []).forEach((r: { player_id: string; jersey_number: number }) => {
      awayJerseyMap.set(r.jersey_number, r.player_id);
    });

    const { data: leagueRow } = await supabase
      .from('leagues')
      .select('settings, scorekeeper_tracks_time_periods')
      .eq('id', game.league_id)
      .maybeSingle();
    const tracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRow);

    const getPlayerId = (teamType: 'home' | 'away', jersey: number | undefined | null): string | null => {
      if (jersey == null) return null;
      const map = teamType === 'home' ? homeJerseyMap : awayJerseyMap;
      return map.get(jersey) || null;
    };

    const getTeamId = (teamType: 'home' | 'away'): string => {
      return teamType === 'home' ? game.home_team_id : game.away_team_id;
    };

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;

      if (evt.type === 'goal') {
        const scorerId = getPlayerId(evt.teamType, evt.scorerJersey);
        if (!scorerId) {
          errors.push(`Goal #${i + 1}: Could not find player with jersey #${evt.scorerJersey} on ${evt.teamType} team`);
          continue;
        }
        if (tracksTimePeriods && normalizeEventPeriod(evt.period) == null) {
          errors.push(`Goal #${i + 1}: Period is required for this league`);
          continue;
        }

        const assist1Id = getPlayerId(evt.teamType, evt.assist1Jersey);
        const assist2Id = getPlayerId(evt.teamType, evt.assist2Jersey);

        const { error } = await supabase
          .from('game_events')
          .insert({
            client_event_id: clientEventId,
            event_version: 1,
            sync_status: 'synced',
            created_offline: false,
            game_id: gameId,
            league_id: game.league_id,
            team_id: getTeamId(evt.teamType),
            team_type: evt.teamType,
            player_id: scorerId,
            event_type: 'goal',
            period: tracksTimePeriods ? normalizeEventPeriod(evt.period) : null,
            game_time_seconds: tracksTimePeriods ? normalizeGameClockValue(evt.gameTimeSeconds) : null,
            assist1_player_id: assist1Id,
            assist2_player_id: assist2Id,
            entered_by: enteredByProfileId,
            entered_at: new Date().toISOString(),
          });

        if (error) {
          errors.push(`Goal #${i + 1}: Database insert failed`);
          continue;
        }

        addedCount++;
      } else if (evt.type === 'penalty') {
        const playerId = getPlayerId(evt.teamType, evt.playerJersey);
        if (!playerId) {
          errors.push(`Penalty #${i + 1}: Could not find player with jersey #${evt.playerJersey} on ${evt.teamType} team`);
          continue;
        }
        if (tracksTimePeriods && normalizeEventPeriod(evt.period) == null) {
          errors.push(`Penalty #${i + 1}: Period is required for this league`);
          continue;
        }

        const { error } = await supabase
          .from('game_events')
          .insert({
            client_event_id: clientEventId,
            event_version: 1,
            sync_status: 'synced',
            created_offline: false,
            game_id: gameId,
            league_id: game.league_id,
            team_id: getTeamId(evt.teamType),
            team_type: evt.teamType,
            player_id: playerId,
            event_type: 'penalty',
            period: tracksTimePeriods ? normalizeEventPeriod(evt.period) : null,
            game_time_seconds: tracksTimePeriods ? normalizeGameClockValue(evt.gameTimeSeconds) : null,
            penalty_type: evt.penaltyType || 'Minor',
            penalty_minutes: evt.penaltyMinutes || 2,
            entered_by: enteredByProfileId,
            entered_at: new Date().toISOString(),
          });

        if (error) {
          errors.push(`Penalty #${i + 1}: Database insert failed`);
          continue;
        }

        addedCount++;
      }
    }

    if (addedCount > 0) {
      await recalculateGameDerivedState(supabase, gameId);
    }

    return { success: true, addedCount, errors };
  } catch (error) {
    console.error('Batch add events error:', error);
    return { success: false, addedCount, errors: [...errors, 'Failed to batch add events'] };
  }
}

/**
 * Update game status (e.g., to 'in_progress' when starting)
 */
export async function updateGameStatus(
  gameId: string,
  status: string
): Promise<{ success: boolean; error?: string }> {
  // Scorekeeper sessions may start a game, but every completion/finalization
  // transition must go through the captain-verification RPCs below.
  if (status !== 'in_progress') {
    return { success: false, error: 'Only the start-game transition is allowed' };
  }

  try {
    const session = await requireActiveSession(gameId);

    const supabase = createServiceRoleClient();
    const { error } = await (supabase as any).rpc('start_scorekeeper_game_atomic', {
      p_game_id: gameId,
      p_session_id: session.sessionId,
    });

    if (error) {
      return { success: false, error: 'Failed to update game status' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update game status error:', error);
    return { success: false, error: 'Failed to update game status' };
  }
}

// =============================================================================
// Pre-game check-in actions
// =============================================================================

export interface CheckinPlayer {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  jerseyNumber: number | null;
  position: string;
  checkinStatus: 'confirmed' | 'tentative' | 'out' | null;
  isSub?: boolean;
}

/**
 * Get check-in data for both teams in a game (scorekeeper view)
 */
export async function getScorekeeperCheckins(gameId: string): Promise<{
  success: boolean;
  checkins?: { homeTeam: CheckinPlayer[]; awayTeam: CheckinPlayer[] };
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    // Get game to find team IDs
    const { data: game, error: gameError } = await (supabase as any)
      .from('games')
      .select('home_team_id, away_team_id, season_id')
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return { success: false, error: 'Game not found' };
    }

    // Fetch regular rosters, accepted game spares, and existing checkins in parallel.
    const [homeRosterResult, awayRosterResult, homeSubResult, awaySubResult, checkinsResult] = await Promise.all([
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select(`
            player_id, jersey_number, position,
            profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
          `)
          .eq('team_id', game.home_team_id)
          .eq('status', 'active')
          .is('end_date', null)
          .eq('player_type', 'regular');

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
      (() => {
        let query = (supabase as any)
          .from('team_rosters')
          .select(`
            player_id, jersey_number, position,
            profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
          `)
          .eq('team_id', game.away_team_id)
          .eq('status', 'active')
          .is('end_date', null)
          .eq('player_type', 'regular');

        if (game.season_id) {
          query = query.eq('season_id', game.season_id);
        }

        return query;
      })(),
      (supabase as any)
        .from('sub_invitations')
        .select(`
          invited_player_id,
          invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(id, full_name, avatar_url, photo_url)
        `)
        .eq('game_id', gameId)
        .eq('team_id', game.home_team_id)
        .eq('status', 'accepted'),
      (supabase as any)
        .from('sub_invitations')
        .select(`
          invited_player_id,
          invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(id, full_name, avatar_url, photo_url)
        `)
        .eq('game_id', gameId)
        .eq('team_id', game.away_team_id)
        .eq('status', 'accepted'),
      (supabase as any)
        .from('game_checkins')
        .select('player_id, status')
        .eq('game_id', gameId),
    ]);

    // Build checkin status map
    const checkinMap = new Map<string, string>();
    for (const row of checkinsResult.data || []) {
      checkinMap.set(row.player_id, row.status);
    }

    const formatCheckinRoster = (roster: any[] | null, subs: any[] | null): CheckinPlayer[] => {
      const regulars = (roster || [])
        .filter((r: any) => r.profiles)
        .map((r: any) => ({
          id: r.player_id,
          fullName: r.profiles.full_name,
          avatarUrl: resolvePlayerPhotoUrl(r.profiles),
          jerseyNumber: r.jersey_number,
          position: r.position as string,
          checkinStatus: (checkinMap.get(r.player_id) as CheckinPlayer['checkinStatus']) || null,
          isSub: false,
        }));

      const seen = new Set(regulars.map((player: CheckinPlayer) => player.id));
      const acceptedSubs = (subs || [])
        .filter((row: any) => row.invited_player_id && !seen.has(row.invited_player_id))
        .map((row: any) => {
          const profile = Array.isArray(row.invited_player_profile)
            ? row.invited_player_profile[0]
            : row.invited_player_profile;

          return {
            id: row.invited_player_id,
            fullName: profile?.full_name ?? 'Spare Player',
            avatarUrl: resolvePlayerPhotoUrl(profile),
            jerseyNumber: null,
            position: 'Spare',
            checkinStatus: (checkinMap.get(row.invited_player_id) as CheckinPlayer['checkinStatus']) || 'confirmed',
            isSub: true,
          };
        });

      return [...regulars, ...acceptedSubs].sort((a: CheckinPlayer, b: CheckinPlayer) => {
        if (a.isSub !== b.isSub) return Number(a.isSub) - Number(b.isSub);
        if (a.jerseyNumber !== null && b.jerseyNumber !== null) return a.jerseyNumber - b.jerseyNumber;
        if (a.jerseyNumber !== null) return -1;
        if (b.jerseyNumber !== null) return 1;
        return a.fullName.localeCompare(b.fullName);
      });
    };

    return {
      success: true,
      checkins: {
        homeTeam: formatCheckinRoster(homeRosterResult.data, homeSubResult.data),
        awayTeam: formatCheckinRoster(awayRosterResult.data, awaySubResult.data),
      },
    };
  } catch (error) {
    console.error('Get scorekeeper checkins error:', error);
    return { success: false, error: 'Failed to load check-in data' };
  }
}

/**
 * Update a player's check-in status (scorekeeper action)
 */
export async function updateScorekeeperCheckin(
  gameId: string,
  playerId: string,
  teamId: string,
  status: 'confirmed' | 'out'
): Promise<{ success: boolean; error?: string }> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { error } = await (supabase as any)
      .from('game_checkins')
      .upsert(
        {
          game_id: gameId,
          player_id: playerId,
          team_id: teamId,
          status,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'game_id,player_id',
        }
      );

    if (error) {
      console.error('Update scorekeeper checkin error:', error);
      return { success: false, error: 'Failed to update check-in' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update scorekeeper checkin error:', error);
    return { success: false, error: 'Failed to update check-in' };
  }
}

// =============================================================================
// Verification & game summary actions
// =============================================================================

/**
 * Get game summary stats (aggregated from game events)
 */
export async function getGameSummary(gameId: string): Promise<{
  success: boolean;
  summary?: {
    homeGoals: number;
    awayGoals: number;
    homePenaltyMinutes: number;
    awayPenaltyMinutes: number;
    homeSaves: number;
    awaySaves: number;
    homeShots: number;
    awayShots: number;
    homePPGoals: number;
    awayPPGoals: number;
    homeSHGoals: number;
    awaySHGoals: number;
    homeENGoals: number;
    awayENGoals: number;
    periods: Array<{
      period: number;
      homeGoals: number;
      awayGoals: number;
      homeSaves: number;
      awaySaves: number;
    }>;
    scorers: Array<{
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      goals: number;
      assists: number;
      ppGoals: number;
      ppAssists: number;
      shGoals: number;
      shAssists: number;
    }>;
    goalies: Array<{
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      saves: number;
      goalsAgainst: number;
      shotsAgainst: number;
      savePercentage: number;
      periodStats: Array<{
        period: number;
        saves: number;
        goalsAgainst: number;
      }>;
    }>;
  };
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();

    const { data: events, error } = await supabase
      .from('game_events')
      .select(`
        event_type, team_type, player_id,
        assist1_player_id, assist2_player_id,
        period, penalty_minutes,
        is_power_play, is_short_handed, is_empty_net,
        goalie_in_net_id,
        player:profiles!game_events_player_id_fkey(full_name)
      `)
      .eq('game_id', gameId)
      .is('deleted_at', null);

    if (error) {
      return { success: false, error: 'Failed to load events' };
    }

    const allEvents = (events || []) as any[];
    const goals = allEvents.filter(e => e.event_type === 'goal');
    const penalties = allEvents.filter(e => e.event_type === 'penalty');
    const saves = allEvents.filter(e => e.event_type === 'save');

    // Collect ALL unique player IDs (scorers, assists, goalies) for bulk name lookup
    const allPlayerIds = new Set<string>();
    allEvents.forEach(e => {
      if (e.player_id) allPlayerIds.add(e.player_id);
      if (e.assist1_player_id) allPlayerIds.add(e.assist1_player_id);
      if (e.assist2_player_id) allPlayerIds.add(e.assist2_player_id);
      if (e.goalie_in_net_id) allPlayerIds.add(e.goalie_in_net_id);
    });

    // Bulk fetch player names from profiles
    const playerNameMap = new Map<string, string>();
    if (allPlayerIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(allPlayerIds));
      if (profiles) {
        profiles.forEach((p: any) => playerNameMap.set(p.id, p.full_name || 'Unknown'));
      }
    }
    const getPlayerName = (id: string) => playerNameMap.get(id) || 'Unknown';

    const periods = [1, 2, 3].map(period => ({
      period,
      homeGoals: goals.filter(g => g.period === period && g.team_type === 'home').length,
      awayGoals: goals.filter(g => g.period === period && g.team_type === 'away').length,
      homeSaves: saves.filter(s => s.period === period && s.team_type === 'home').length,
      awaySaves: saves.filter(s => s.period === period && s.team_type === 'away').length,
    }));

    // Scorer stats with PP/SH breakdown
    const scorerMap = new Map<string, {
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      goals: number;
      assists: number;
      ppGoals: number;
      ppAssists: number;
      shGoals: number;
      shAssists: number;
    }>();

    goals.forEach(g => {
      const key = g.player_id;
      const isPP = g.is_power_play || false;
      const isSH = g.is_short_handed || false;
      const existing = scorerMap.get(key);

      if (existing) {
        existing.goals += 1;
        if (isPP) existing.ppGoals += 1;
        if (isSH) existing.shGoals += 1;
      } else {
        scorerMap.set(key, {
          playerId: g.player_id,
          playerName: getPlayerName(g.player_id),
          teamType: g.team_type as 'home' | 'away',
          goals: 1,
          assists: 0,
          ppGoals: isPP ? 1 : 0,
          ppAssists: 0,
          shGoals: isSH ? 1 : 0,
          shAssists: 0,
        });
      }

      [g.assist1_player_id, g.assist2_player_id].forEach(assistId => {
        if (assistId) {
          const assistExisting = scorerMap.get(assistId);
          if (assistExisting) {
            assistExisting.assists += 1;
            if (isPP) assistExisting.ppAssists += 1;
            if (isSH) assistExisting.shAssists += 1;
          } else {
            scorerMap.set(assistId, {
              playerId: assistId,
              playerName: getPlayerName(assistId),
              teamType: g.team_type as 'home' | 'away',
              goals: 0,
              assists: 1,
              ppGoals: 0,
              ppAssists: isPP ? 1 : 0,
              shGoals: 0,
              shAssists: isSH ? 1 : 0,
            });
          }
        }
      });
    });

    // Goalie stats with period breakdown
    const goalieMap = new Map<string, {
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      saves: number;
      goalsAgainst: number;
      periodSaves: Record<number, number>;
      periodGA: Record<number, number>;
    }>();

    saves.forEach(s => {
      const key = s.player_id;
      const existing = goalieMap.get(key);
      if (existing) {
        existing.saves += 1;
        existing.periodSaves[s.period] = (existing.periodSaves[s.period] || 0) + 1;
      } else {
        goalieMap.set(key, {
          playerId: s.player_id,
          playerName: getPlayerName(s.player_id),
          teamType: s.team_type as 'home' | 'away',
          saves: 1,
          goalsAgainst: 0,
          periodSaves: { [s.period]: 1 },
          periodGA: {},
        });
      }
    });

    // Goals against — use goalie_in_net_id if available
    goals.forEach(g => {
      if (g.goalie_in_net_id) {
        const goalie = goalieMap.get(g.goalie_in_net_id);
        if (goalie) {
          goalie.goalsAgainst += 1;
          goalie.periodGA[g.period] = (goalie.periodGA[g.period] || 0) + 1;
        } else {
          goalieMap.set(g.goalie_in_net_id, {
            playerId: g.goalie_in_net_id,
            playerName: getPlayerName(g.goalie_in_net_id),
            teamType: g.team_type === 'home' ? 'away' : 'home',
            saves: 0,
            goalsAgainst: 1,
            periodSaves: {},
            periodGA: { [g.period]: 1 },
          });
        }
      } else {
        const oppositeTeam = g.team_type === 'home' ? 'away' : 'home';
        goalieMap.forEach(goalie => {
          if (goalie.teamType === oppositeTeam) {
            goalie.goalsAgainst += 1;
            goalie.periodGA[g.period] = (goalie.periodGA[g.period] || 0) + 1;
          }
        });
      }
    });

    const goalies = Array.from(goalieMap.values()).map(g => {
      const shotsAgainst = g.saves + g.goalsAgainst;
      const savePercentage = shotsAgainst > 0 ? Math.round((g.saves / shotsAgainst) * 1000) / 10 : 100;
      return {
        playerId: g.playerId,
        playerName: g.playerName,
        teamType: g.teamType,
        saves: g.saves,
        goalsAgainst: g.goalsAgainst,
        shotsAgainst,
        savePercentage,
        periodStats: [1, 2, 3].map(period => ({
          period,
          saves: g.periodSaves[period] || 0,
          goalsAgainst: g.periodGA[period] || 0,
        })),
      };
    });

    const summary = {
      homeGoals: goals.filter(g => g.team_type === 'home').length,
      awayGoals: goals.filter(g => g.team_type === 'away').length,
      homePenaltyMinutes: penalties.filter(p => p.team_type === 'home').reduce((sum, p) => sum + (p.penalty_minutes || 0), 0),
      awayPenaltyMinutes: penalties.filter(p => p.team_type === 'away').reduce((sum, p) => sum + (p.penalty_minutes || 0), 0),
      homeSaves: saves.filter(s => s.team_type === 'home').length,
      awaySaves: saves.filter(s => s.team_type === 'away').length,
      homeShots: goals.filter(g => g.team_type === 'home').length + saves.filter(s => s.team_type === 'away').length,
      awayShots: goals.filter(g => g.team_type === 'away').length + saves.filter(s => s.team_type === 'home').length,
      homePPGoals: goals.filter(g => g.team_type === 'home' && g.is_power_play).length,
      awayPPGoals: goals.filter(g => g.team_type === 'away' && g.is_power_play).length,
      homeSHGoals: goals.filter(g => g.team_type === 'home' && g.is_short_handed).length,
      awaySHGoals: goals.filter(g => g.team_type === 'away' && g.is_short_handed).length,
      homeENGoals: goals.filter(g => g.team_type === 'home' && g.is_empty_net).length,
      awayENGoals: goals.filter(g => g.team_type === 'away' && g.is_empty_net).length,
      periods,
      scorers: Array.from(scorerMap.values()).sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists)),
      goalies,
    };

    return { success: true, summary };
  } catch (error) {
    console.error('Get game summary error:', error);
    return { success: false, error: 'Failed to load summary' };
  }
}

/**
 * Submit game for captain verification — generates crypto tokens for each team
 */
export async function submitGameForVerification(
  gameId: string,
  captureStatus?: {
    penalties?: ScorekeeperCaptureStatus;
    goalies?: ScorekeeperCaptureStatus;
    goalieAppearances?: ScorekeeperGoalieAppearance[];
  },
): Promise<{
  success: boolean;
  verificationMode?: CaptainVerificationMode;
  autoVerifiedTeamType?: ScorekeeperTeamType;
  homeToken?: string;
  awayToken?: string;
  /** Whether the opposing captain was emailed the verification link (self-score path). */
  emailSent?: boolean;
  /** Why the email was not sent, when emailSent is false. */
  emailSkipReason?: 'no_captain_email' | 'email_disabled' | 'send_failed' | 'game_completed';
  error?: string;
}> {
  try {
    const session = await requireActiveSession(gameId);

    const supabase = createServiceRoleClient();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    const expiresAtIso = expiresAt.toISOString();
    const submittedAt = new Date().toISOString();

    if (session.sessionOrigin === 'captain_self_score') {
      const { data: gameDetails, error: gameLookupError } = await (supabase as any)
        .from('games')
        .select(`
          id,
          home_team_id,
          away_team_id,
          leagues(name, slug)
        `)
        .eq('id', gameId)
        .single();

      if (gameLookupError || !gameDetails) {
        console.error('Captain self-score game lookup error:', gameLookupError);
        return { success: false, error: 'Failed to submit for verification' };
      }

      let initiatingTeamId = session.initiatingTeamId;
      let initiatingTeamType = session.initiatingTeamType;

      if (!initiatingTeamId || !initiatingTeamType) {
        const { data: initiatorRoster } = await (supabase as any)
          .from('team_rosters')
          .select('team_id')
          .eq('player_id', session.createdBy)
          .in('team_id', [gameDetails.home_team_id, gameDetails.away_team_id])
          .eq('status', 'active')
          .is('end_date', null)
          .limit(1)
          .maybeSingle();

        initiatingTeamId = initiatorRoster?.team_id ?? null;

        if (initiatingTeamId === gameDetails.home_team_id) {
          initiatingTeamType = 'home';
        } else if (initiatingTeamId === gameDetails.away_team_id) {
          initiatingTeamType = 'away';
        } else {
          return {
            success: false,
            error: 'Captain self-scoring session is missing team metadata. Start a new scoring session and try again.',
          };
        }
      }

      const opposingTeamType: ScorekeeperTeamType =
        initiatingTeamType === 'home' ? 'away' : 'home';
      const opposingTeamId =
        opposingTeamType === 'home' ? gameDetails.home_team_id : gameDetails.away_team_id;
      const opposingToken = generateVerificationToken();

      const { data: submitResult, error } = await (supabase as any).rpc(
        'submit_game_for_verification_atomic',
        {
          p_game_id: gameId,
          p_session_id: session.sessionId,
          p_mode: 'opponent_only',
          p_initiating_team_type: initiatingTeamType,
          p_home_token: opposingTeamType === 'home' ? opposingToken : null,
          p_away_token: opposingTeamType === 'away' ? opposingToken : null,
          p_expires_at: expiresAtIso,
          p_submitted_at: submittedAt,
          p_penalty_capture_status: captureStatus?.penalties ?? null,
          p_goalie_capture_status: captureStatus?.goalies ?? null,
          p_goalie_appearances: captureStatus?.goalieAppearances?.map((appearance) => ({
            player_id: appearance.playerId,
            team_id: appearance.teamId,
            team_type: appearance.teamType,
          })) ?? null,
        },
      );

      if (error) {
        console.error('Submit for verification error:', error);
        return { success: false, error: 'Failed to submit for verification' };
      }

      const gameCompleted = submitResult?.status === 'completed';
      const effectiveOpposingToken = (opposingTeamType === 'home'
        ? submitResult?.home_token
        : submitResult?.away_token) || opposingToken;
      const leagueRelation = Array.isArray(gameDetails.leagues)
        ? gameDetails.leagues[0]
        : gameDetails.leagues;

      let emailSent = false;
      let emailSkipReason: 'no_captain_email' | 'email_disabled' | 'send_failed' | 'game_completed' | undefined =
        gameCompleted ? 'game_completed' : undefined;

      if (!gameCompleted && leagueRelation?.name && leagueRelation?.slug && opposingTeamId) {
        try {
          const outcome = await maybeEmailCaptainVerificationLink({
            supabase,
            leagueName: leagueRelation.name as string,
            leagueSlug: leagueRelation.slug as string,
            opposingTeamId,
            verificationToken: effectiveOpposingToken,
            expiresAt: expiresAtIso,
          });
          emailSent = outcome === 'sent';
          if (outcome !== 'sent') {
            emailSkipReason = outcome;
            console.warn('[scorekeeper] captain verification email skipped', { gameId, reason: outcome });
          }
        } catch (emailError) {
          emailSkipReason = 'send_failed';
          console.warn('Captain verification email send failed:', emailError);
        }
      }

      return {
        success: true,
        verificationMode: 'opponent_only',
        autoVerifiedTeamType: initiatingTeamType,
        homeToken: opposingTeamType === 'home' ? effectiveOpposingToken : undefined,
        awayToken: opposingTeamType === 'away' ? effectiveOpposingToken : undefined,
        emailSent,
        emailSkipReason,
      };
    }

    const homeToken = generateVerificationToken();
    const awayToken = generateVerificationToken();

    const { data: submitResult, error } = await (supabase as any).rpc('submit_game_for_verification_atomic', {
      p_game_id: gameId,
      p_session_id: session.sessionId,
      p_mode: 'both_captains',
      p_initiating_team_type: null,
      p_home_token: homeToken,
      p_away_token: awayToken,
      p_expires_at: expiresAtIso,
      p_submitted_at: submittedAt,
      p_penalty_capture_status: captureStatus?.penalties ?? null,
      p_goalie_capture_status: captureStatus?.goalies ?? null,
      p_goalie_appearances: captureStatus?.goalieAppearances?.map((appearance) => ({
        player_id: appearance.playerId,
        team_id: appearance.teamId,
        team_type: appearance.teamType,
      })) ?? null,
    });

    if (error) {
      console.error('Submit for verification error:', error);
      return { success: false, error: 'Failed to submit for verification' };
    }

    return {
      success: true,
      verificationMode: 'both_captains',
      homeToken: submitResult?.home_token || homeToken,
      awayToken: submitResult?.away_token || awayToken,
    };
  } catch (error) {
    console.error('Submit for verification error:', error);
    const message =
      error instanceof Error &&
      (error.message.includes('scorekeeper session') ||
        error.message.includes('Session mismatch') ||
        error.message.includes('not part of your scorekeeper session'))
        ? error.message
        : 'Failed to submit for verification';
    return { success: false, error: message };
  }
}

/**
 * Look up a captain verification token (without side effects)
 */
export async function lookupCaptainVerificationToken(token: string): Promise<{
  success: boolean;
  gameId?: string;
  teamType?: 'home' | 'away';
  error?: string;
}> {
  try {
    const supabase = createServiceRoleClient();
    const normalizedToken = normalizeVerificationToken(token);

    const { data, error } = await supabase.rpc('validate_captain_token', {
      p_token: normalizedToken,
    });

    if (error) {
      console.error('Validate captain token error:', error);
      return { success: false, error: 'Invalid verification token' };
    }

    if (!data || data.length === 0 || !data[0].is_valid) {
      return { success: false, error: 'Invalid verification token' };
    }

    return {
      success: true,
      gameId: data[0].game_id,
      teamType: data[0].team_type as 'home' | 'away',
    };
  } catch (error) {
    console.error('Lookup token error:', error);
    return { success: false, error: 'Failed to lookup token' };
  }
}

/**
 * Verify game stats as captain — validates token and marks team as verified
 */
export async function verifyCaptainStats(token: string): Promise<{
  success: boolean;
  gameId?: string;
  teamType?: 'home' | 'away';
  error?: string;
}> {
  try {
    const supabase = createServiceRoleClient();
    const normalizedToken = normalizeVerificationToken(token);

    const { data: verification, error: verificationError } = await (supabase as any).rpc(
      'verify_and_finalize_game_stats_atomic',
      { p_token: normalizedToken },
    );

    if (
      verificationError ||
      !verification?.game_id ||
      !verification?.team_type
    ) {
      if (verificationError) {
        console.error('Verify and finalize captain token error:', verificationError);
      }
      const invalidToken = typeof verificationError?.message === 'string'
        && verificationError.message.toLowerCase().includes('invalid verification token');
      return {
        success: false,
        error: invalidToken
          ? 'Invalid verification token'
          : 'Verification was saved but finalization failed. Please retry with the same link.',
      };
    }

    return {
      success: true,
      gameId: verification.game_id as string,
      teamType: verification.team_type as 'home' | 'away',
    };
  } catch (error) {
    console.error('Verify captain error:', error);
    return { success: false, error: 'Failed to verify' };
  }
}

/**
 * Get game data for captain verification (no scorekeeper session required).
 * Validates the verification token matches the game before returning data.
 */
export async function getGameDataForVerification(
  gameId: string,
  verificationToken: string
): Promise<{
  success: boolean;
  game?: GameData;
  error?: string;
}> {
  try {
    const supabase = createServiceRoleClient();

    // Verify the token matches this game
    const safeToken = verificationToken.replace(/[,.()"\\]/g, '');
    const { data: tokenCheck } = await supabase
      .from('games')
      .select('id')
      .eq('id', gameId)
      .or(`home_verification_token.eq.${safeToken},away_verification_token.eq.${safeToken}`)
      .maybeSingle();

    if (!tokenCheck) {
      return { success: false, error: 'Invalid verification token for this game' };
    }

    // Same data fetching as getScorekeeperGameData but without session check
    const { data: game, error: gameError } = await (supabase as any)
      .from('games')
      .select(`
        id, scheduled_at, status, period_count, period_length_minutes,
        home_score, away_score, current_period,
        home_verified_at, away_verified_at, stats_locked_at,
        timer_running, timer_started_at, timer_elapsed_seconds,
        home_goalie_pulled, away_goalie_pulled, scorekeeper_notes,
        leagues(settings, scorekeeper_tracks_time_periods),
        home_team:teams!games_home_team_id_fkey(
          id, name, short_name, logo_url, primary_color, secondary_color, captain_id
        ),
        away_team:teams!games_away_team_id_fkey(
          id, name, short_name, logo_url, primary_color, secondary_color, captain_id
        )
      `)
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return { success: false, error: 'Game not found' };
    }

    const leagueRelation = Array.isArray((game as any).leagues) ? (game as any).leagues[0] : (game as any).leagues;
    const scorekeeperTracksTimePeriods = leagueTracksScorekeeperTimePeriods(leagueRelation);

    const [homeRosterResult, awayRosterResult] = await Promise.all([
      (supabase as any)
        .from('team_rosters')
        .select(`
          player_id, jersey_number, position, leadership_role,
          profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
        `)
        .eq('team_id', (game.home_team as { id: string }).id)
        .eq('status', 'active'),
      (supabase as any)
        .from('team_rosters')
        .select(`
          player_id, jersey_number, position, leadership_role,
          profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url)
        `)
        .eq('team_id', (game.away_team as { id: string }).id)
        .eq('status', 'active'),
    ]);

    const formatRoster = (roster: any[] | null): PlayerData[] => {
      if (!roster) return [];
      return roster
        .filter(r => r.profiles)
        .map(r => ({
          id: r.player_id,
          fullName: r.profiles.full_name,
          avatarUrl: resolvePlayerPhotoUrl(r.profiles),
          jerseyNumber: r.jersey_number,
          position: r.position as 'Forward' | 'Defense' | 'Goalie',
          isCaptain: r.leadership_role === 'captain',
          isAssistantCaptain: r.leadership_role === 'alternate_captain',
        }))
        .sort((a, b) => a.jerseyNumber - b.jerseyNumber);
    };

    const homeRoster = formatRoster(homeRosterResult.data);
    const awayRoster = formatRoster(awayRosterResult.data);
    const homeCaptain = homeRoster.find(p => p.isCaptain);
    const awayCaptain = awayRoster.find(p => p.isCaptain);
    const homeTeam = game.home_team as any;
    const awayTeam = game.away_team as any;

    const { data: officials } = await (supabase as any)
      .from('game_officials')
      .select('id, name, role, jersey_number')
      .eq('game_id', gameId);

    return {
      success: true,
      game: {
        id: game.id,
        scorekeeperTracksTimePeriods,
        homeTeam: {
          id: homeTeam.id, name: homeTeam.name, shortName: homeTeam.short_name,
          logoUrl: homeTeam.logo_url, primaryColor: homeTeam.primary_color,
          secondaryColor: homeTeam.secondary_color, roster: homeRoster,
          captainId: homeCaptain?.id || null, captainName: homeCaptain?.fullName || null,
        },
        awayTeam: {
          id: awayTeam.id, name: awayTeam.name, shortName: awayTeam.short_name,
          logoUrl: awayTeam.logo_url, primaryColor: awayTeam.primary_color,
          secondaryColor: awayTeam.secondary_color, roster: awayRoster,
          captainId: awayCaptain?.id || null, captainName: awayCaptain?.fullName || null,
        },
        scheduledAt: game.scheduled_at,
        status: game.status || 'scheduled',
        periodCount: game.period_count || 3,
        periodLengthMinutes: game.period_length_minutes || 20,
        homeScore: game.home_score || 0,
        awayScore: game.away_score || 0,
        currentPeriod: game.current_period || 1,
        homeVerifiedAt: game.home_verified_at,
        awayVerifiedAt: game.away_verified_at,
        statsLockedAt: game.stats_locked_at,
        timerRunning: game.timer_running || false,
        timerStartedAt: game.timer_started_at || null,
        timerElapsedSeconds: game.timer_elapsed_seconds || 0,
        homeGoaliePulled: game.home_goalie_pulled || false,
        awayGoaliePulled: game.away_goalie_pulled || false,
        officials: (officials || []).map((o: any) => ({
          id: o.id,
          name: o.name,
          role: o.role,
          jerseyNumber: o.jersey_number,
        })),
        scorekeeperNotes: game.scorekeeper_notes || null,
      },
    };
  } catch (error) {
    console.error('Get game data for verification error:', error);
    return { success: false, error: 'Failed to load game data' };
  }
}

/**
 * Get game summary for captain verification (no scorekeeper session required).
 * Validates the verification token matches the game before returning data.
 */
export async function getGameSummaryForVerification(
  gameId: string,
  verificationToken: string
): Promise<{
  success: boolean;
  summary?: {
    homeGoals: number;
    awayGoals: number;
    homePenaltyMinutes: number;
    awayPenaltyMinutes: number;
    periods: Array<{ period: number; homeGoals: number; awayGoals: number }>;
    scorers: Array<{
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      goals: number;
      assists: number;
    }>;
  };
  error?: string;
}> {
  try {
    const supabase = createServiceRoleClient();

    const safeToken = verificationToken.replace(/[,.()"\\]/g, '');
    const { data: tokenCheck } = await supabase
      .from('games')
      .select('id')
      .eq('id', gameId)
      .or(`home_verification_token.eq.${safeToken},away_verification_token.eq.${safeToken}`)
      .maybeSingle();

    if (!tokenCheck) {
      return { success: false, error: 'Invalid verification token for this game' };
    }

    const { data: events, error } = await supabase
      .from('game_events')
      .select(`
        event_type, team_type, player_id,
        assist1_player_id, assist2_player_id,
        period, penalty_minutes,
        player:profiles!game_events_player_id_fkey(full_name)
      `)
      .eq('game_id', gameId)
      .is('deleted_at', null);

    if (error) {
      return { success: false, error: 'Failed to load events' };
    }

    const allEvents = (events || []) as any[];
    const goals = allEvents.filter(e => e.event_type === 'goal');
    const penalties = allEvents.filter(e => e.event_type === 'penalty');

    // Bulk fetch all player names
    const allPlayerIds2 = new Set<string>();
    allEvents.forEach((e: any) => {
      if (e.player_id) allPlayerIds2.add(e.player_id);
      if (e.assist1_player_id) allPlayerIds2.add(e.assist1_player_id);
      if (e.assist2_player_id) allPlayerIds2.add(e.assist2_player_id);
    });
    const playerNameMap2 = new Map<string, string>();
    if (allPlayerIds2.size > 0) {
      const { data: profiles2 } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(allPlayerIds2));
      if (profiles2) {
        profiles2.forEach((p: any) => playerNameMap2.set(p.id, p.full_name || 'Unknown'));
      }
    }
    const getName2 = (id: string) => playerNameMap2.get(id) || 'Unknown';

    const periods = [1, 2, 3].map(period => ({
      period,
      homeGoals: goals.filter(g => g.period === period && g.team_type === 'home').length,
      awayGoals: goals.filter(g => g.period === period && g.team_type === 'away').length,
    }));

    const scorerMap = new Map<string, {
      playerId: string; playerName: string; teamType: 'home' | 'away';
      goals: number; assists: number;
    }>();

    goals.forEach(g => {
      const existing = scorerMap.get(g.player_id);
      if (existing) {
        existing.goals += 1;
      } else {
        scorerMap.set(g.player_id, {
          playerId: g.player_id,
          playerName: getName2(g.player_id),
          teamType: g.team_type as 'home' | 'away',
          goals: 1, assists: 0,
        });
      }

      [g.assist1_player_id, g.assist2_player_id].forEach((assistId: string | null) => {
        if (assistId) {
          const a = scorerMap.get(assistId);
          if (a) {
            a.assists += 1;
          } else {
            scorerMap.set(assistId, {
              playerId: assistId, playerName: getName2(assistId),
              teamType: g.team_type as 'home' | 'away',
              goals: 0, assists: 1,
            });
          }
        }
      });
    });

    return {
      success: true,
      summary: {
        homeGoals: goals.filter(g => g.team_type === 'home').length,
        awayGoals: goals.filter(g => g.team_type === 'away').length,
        homePenaltyMinutes: penalties.filter(p => p.team_type === 'home').reduce((sum: number, p: any) => sum + (p.penalty_minutes || 0), 0),
        awayPenaltyMinutes: penalties.filter(p => p.team_type === 'away').reduce((sum: number, p: any) => sum + (p.penalty_minutes || 0), 0),
        periods,
        scorers: Array.from(scorerMap.values()).sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists)),
      },
    };
  } catch (error) {
    console.error('Get game summary for verification error:', error);
    return { success: false, error: 'Failed to load summary' };
  }
}

/**
 * Finalize game stats — roll up to player_stats/standings and mark complete
 */
export async function finalizeGameStats(gameId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await verifyActiveSession(gameId);

    const supabase = createServiceRoleClient();
    await finalizeCompletedGameStats(supabase, gameId, { allowUnverified: false });

    return { success: true };
  } catch (error) {
    console.error('Finalize stats error:', error);
    return { success: false, error: 'Failed to finalize stats' };
  }
}

// =============================================================================
// Captain Self-Scorekeeper: Auto-Assign
// =============================================================================

/**
 * Get or create a scorekeeper session for a captain's own game.
 *
 * Self-scorekeeping must be enabled in the league settings.
 * Supports both the current `self_scorekeeper_enabled` flag and older
 * self-scoring config shapes (`scorekeepingMode=self_scorekeeping` or
 * `statEntryMode=captain`).
 *
 * Returns the token which the client uses to start the scorekeeper session
 * by navigating to `/{leagueSlug}/scorekeeper?token={token}`.
 */
export async function getOrCreateCaptainScorekeeperSession(
  gameId: string,
  teamId: string
): Promise<{ success: boolean; token?: string; leagueSlug?: string; error?: string }> {
  try {
    const authClient = await createAuthClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) return { success: false, error: 'Not authenticated' };

    // Verify captain role for this team
    const { data: roster } = await authClient
      .from('team_rosters')
      .select('leadership_role')
      .eq('team_id', teamId)
      .eq('player_id', user.id)
      .eq('status', 'active')
      .is('end_date', null)
      .single();

    if (
      !roster ||
      !['captain', 'alternate_captain'].includes(roster.leadership_role || '')
    ) {
      return { success: false, error: 'Captain role required to start scoring' };
    }

    const supabase = createServiceRoleClient();

    // Fetch game + league details
    const { data: game } = await supabase
      .from('games')
      .select('id, league_id, home_team_id, away_team_id, scheduled_at, status, leagues(slug, settings)')
      .eq('id', gameId)
      .single();

    if (!game) return { success: false, error: 'Game not found' };

    // Verify the team is actually in this game
    if (game.home_team_id !== teamId && game.away_team_id !== teamId) {
      return { success: false, error: 'Your team is not in this game' };
    }

    if (!['scheduled', 'in_progress'].includes(game.status || 'scheduled')) {
      return { success: false, error: 'Scoring is only available for scheduled or live games' };
    }

    // Verify self-scorekeeping is enabled for this league
    const leagueArr = game.leagues as any;
    const leagueData = Array.isArray(leagueArr) ? leagueArr[0] : leagueArr;
    const leagueSettings = (leagueData?.settings as Record<string, unknown>) ?? {};
    const selfScorekeeperEnabled =
      leagueSettings.self_scorekeeper_enabled === true ||
      leagueSettings.scorekeepingMode === 'self_scorekeeping' ||
      leagueSettings.statEntryMode === 'captain';

    if (!selfScorekeeperEnabled) {
      return { success: false, error: 'Self-scorekeeping is not enabled for this league' };
    }

    const leagueSlug: string = leagueData?.slug ?? '';
    const initiatingTeamType: ScorekeeperTeamType =
      game.home_team_id === teamId ? 'home' : 'away';

    // Reuse only this captain team's active session. Sharing one token across
    // both captains loses the initiating team context and can leave games stuck.
    const { data: existing } = await supabase
      .from('scorekeeper_sessions')
      .select('token, expires_at')
      .eq('game_id', gameId)
      .eq('session_origin', 'captain_self_score')
      .eq('initiating_team_id', teamId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return { success: true, token: existing.token, leagueSlug };
    }

    // Generate a unique 16-character token
    let token = randomBytes(8).toString('hex').toUpperCase();
    let attempts = 0;
    while (attempts < 10) {
      const { data: collision } = await supabase
        .from('scorekeeper_sessions')
        .select('id')
        .eq('token', token)
        .eq('is_active', true)
        .maybeSingle();
      if (!collision) break;
      token = randomBytes(8).toString('hex').toUpperCase();
      attempts++;
    }

    // Session expires 6 hours after game start time
    const gameTime = new Date(game.scheduled_at);
    const expiresAt = new Date(gameTime.getTime() + 6 * 60 * 60 * 1000).toISOString();

    const { data: session, error: sessionError } = await supabase
      .from('scorekeeper_sessions')
      .insert({
        game_id: gameId,
        league_id: game.league_id,
        token,
        expires_at: expiresAt,
        created_by: user.id,
        scorekeeper_id: user.id,
        session_type: 'single',
        session_origin: 'captain_self_score',
        initiating_team_id: teamId,
        initiating_team_type: initiatingTeamType,
        initiating_captain_id: user.id,
        is_active: true,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      console.error('[CaptainScorekeeper] Session create error:', sessionError?.message);
      if (
        sessionError?.message?.includes('session_origin') ||
        sessionError?.message?.includes('initiating_team') ||
        sessionError?.message?.includes('initiating_captain')
      ) {
        return {
          success: false,
          error: 'Captain self-scoring requires the latest database migration. Apply migrations and try again.',
        };
      }
      return { success: false, error: 'Failed to create scoring session' };
    }

    return { success: true, token, leagueSlug };
  } catch (err) {
    console.error('[CaptainScorekeeper] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start scoring session',
    };
  }
}

/**
 * Start (or resume) captain self-scoring in a single step.
 *
 * Wraps getOrCreateCaptainScorekeeperSession and sets the scorekeeper session
 * cookie server-side, so the captain can go straight from Game Day to the
 * scoring surface — collapsing the old 4-hop path
 * (/captain → lineups → /scorekeeper?token= → /scorekeeper/game/:id) into one.
 */
export async function startCaptainScoring(
  gameId: string,
  teamId: string,
): Promise<{ success: boolean; gameId?: string; leagueSlug?: string; error?: string }> {
  const result = await getOrCreateCaptainScorekeeperSession(gameId, teamId);
  if (!result.success || !result.token) {
    return { success: false, error: result.error || 'Failed to start scoring session.' };
  }

  const normalizedToken = result.token.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  const cookieStore = await cookies();
  cookieStore.set(SCOREKEEPER_SESSION_COOKIE, normalizedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });

  return { success: true, gameId, leagueSlug: result.leagueSlug };
}
