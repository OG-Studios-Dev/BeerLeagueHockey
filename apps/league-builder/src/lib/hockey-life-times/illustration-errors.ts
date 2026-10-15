export const ILLUSTRATION_FAILURE_CODES = [
  'INVALID_REQUEST',
  'EDITION_NOT_FOUND',
  'EDITION_TENANT_MISMATCH',
  'SUPABASE_PROJECT_MISMATCH',
  'STALE_GENERATION_LEASE',
  'INVALID_EDITION_SCOPE',
  'PLAYER_NOT_RECORDED_CONTRIBUTOR',
  'PLAYER_PROFILE_NOT_FOUND',
  'PLAYER_NAME_UNRESOLVED',
  'PLAYER_PHOTO_UNRESOLVED',
  'PLAYER_PHOTO_FETCH_FAILED',
  'PLAYER_PHOTO_REDIRECT',
  'INVALID_PLAYER_PHOTO_MIME',
  'UNSAFE_PLAYER_PHOTO_URL',
  'NO_COMPLETED_GAMES',
  'GAME_SCOPE_MISMATCH',
  'ILLUSTRATION_GENERATION_TIMEOUT',
  'ILLUSTRATION_GENERATION_FAILED',
] as const;

export type IllustrationFailureCode = typeof ILLUSTRATION_FAILURE_CODES[number];

const FAILURE_CODE_SET = new Set<string>(ILLUSTRATION_FAILURE_CODES);

export function isIllustrationFailureCode(value: unknown): value is IllustrationFailureCode {
  return typeof value === 'string' && FAILURE_CODE_SET.has(value);
}

function normalizeIllustrationFailureCode(value: unknown): IllustrationFailureCode {
  return isIllustrationFailureCode(value)
    ? value
    : 'ILLUSTRATION_GENERATION_FAILED';
}

/** Reads only the Edge function's public code contract. Raw response details stay server-side. */
export async function readIllustrationFailureCode(error: unknown): Promise<IllustrationFailureCode> {
  try {
    const context = (error as { context?: { clone?: () => Response } } | null)?.context;
    if (!context || typeof context.clone !== 'function') return 'ILLUSTRATION_GENERATION_FAILED';
    const body = await context.clone().json() as { error?: { code?: unknown } };
    return normalizeIllustrationFailureCode(body?.error?.code);
  } catch {
    return 'ILLUSTRATION_GENERATION_FAILED';
  }
}

export function illustrationFailureMessage(code: string | null | undefined): string {
  const normalized = normalizeIllustrationFailureCode(code);
  if (normalized.startsWith('PLAYER_') || ['INVALID_PLAYER_PHOTO_MIME', 'UNSAFE_PLAYER_PHOTO_URL'].includes(normalized)) {
    return 'A featured player is missing a complete profile and usable profile photo. Update the player profile, then retry generation.';
  }
  if (['STALE_GENERATION_LEASE', 'EDITION_NOT_FOUND'].includes(normalized)) {
    return 'The generation attempt expired before artwork was completed. Retry generation.';
  }
  if (normalized === 'ILLUSTRATION_GENERATION_TIMEOUT') {
    return 'Newspaper artwork timed out safely. Retry generation; completed artwork can be reused and no edition was published.';
  }
  if (['NO_COMPLETED_GAMES', 'GAME_SCOPE_MISMATCH', 'INVALID_EDITION_SCOPE'].includes(normalized)) {
    return 'The selected week no longer matches the verified game set. Check readiness, then retry generation.';
  }
  if (['EDITION_TENANT_MISMATCH', 'SUPABASE_PROJECT_MISMATCH', 'INVALID_REQUEST'].includes(normalized)) {
    return 'The illustration request was rejected by the newspaper safety checks. Retry generation or contact support if it repeats.';
  }
  return 'Newspaper artwork could not be generated and validated. Retry generation; no edition was published.';
}
