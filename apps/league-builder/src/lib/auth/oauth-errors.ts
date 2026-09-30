export const OAUTH_RECOVERY_CODES = [
  'consent_canceled',
  'identity_conflict',
  'oauth_failed',
] as const;

export type OAuthRecoveryCode = (typeof OAUTH_RECOVERY_CODES)[number];

export function oauthRecoveryCode(value: string | null): OAuthRecoveryCode | null {
  return OAUTH_RECOVERY_CODES.find((code) => code === value) ?? null;
}

/** Convert untrusted provider text into a small, non-sensitive error vocabulary. */
export function classifyOAuthFailure(
  error: string | null,
  description: string | null
): OAuthRecoveryCode {
  const details = `${error ?? ''} ${description ?? ''}`.toLowerCase();

  if (
    error?.toLowerCase() === 'access_denied' ||
    /\b(cancel(?:ed|led)?|denied|declined)\b/.test(details)
  ) {
    return 'consent_canceled';
  }

  if (
    /identity[^\n]*(already|linked|exists)|already[^\n]*(identity|linked)|account[^\n]*already[^\n]*(linked|exists)/.test(
      details
    )
  ) {
    return 'identity_conflict';
  }

  return 'oauth_failed';
}
