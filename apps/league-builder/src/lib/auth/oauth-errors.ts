export const OAUTH_RECOVERY_CODES = [
  'consent_canceled',
  'identity_conflict',
  'oauth_failed',
] as const;

export type OAuthRecoveryCode = (typeof OAUTH_RECOVERY_CODES)[number];

const OAUTH_FAILURE_BY_PROVIDER_CODE = new Map<string, OAuthRecoveryCode>([
  ['access_denied', 'consent_canceled'],
  ['canceled', 'consent_canceled'],
  ['cancelled', 'consent_canceled'],
  ['user_canceled', 'consent_canceled'],
  ['user_cancelled', 'consent_canceled'],
  ['identity_already_exists', 'identity_conflict'],
  ['identity_exists', 'identity_conflict'],
  ['email_exists', 'identity_conflict'],
  ['email_already_exists', 'identity_conflict'],
  ['account_exists_with_different_credential', 'identity_conflict'],
  ['flow_state_expired', 'oauth_failed'],
  ['invalid_grant', 'oauth_failed'],
  ['bad_code_verifier', 'oauth_failed'],
  ['otp_expired', 'oauth_failed'],
]);

export function oauthRecoveryCode(value: string | null): OAuthRecoveryCode | null {
  return OAUTH_RECOVERY_CODES.find((code) => code === value) ?? null;
}

/** Convert untrusted provider text into a small, non-sensitive error vocabulary. */
export function classifyOAuthFailure(
  error: string | null,
  errorCode: string | null,
  description: string | null
): OAuthRecoveryCode {
  const structuredCode = errorCode?.toLowerCase();
  const providerError = error?.toLowerCase();

  // A dedicated structured code is authoritative. Unknown values stay generic
  // rather than allowing untrusted description text to change classification.
  if (structuredCode) {
    return OAUTH_FAILURE_BY_PROVIDER_CODE.get(structuredCode) ?? 'oauth_failed';
  }

  if (providerError) {
    const classifiedProviderError = OAUTH_FAILURE_BY_PROVIDER_CODE.get(providerError);
    if (classifiedProviderError) return classifiedProviderError;
  }

  const details = `${error ?? ''} ${description ?? ''}`.toLowerCase();

  if (
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
