/**
 * Validate a redirect path to prevent open-redirect attacks.
 * Only relative paths starting with "/" are allowed; anything else
 * (absolute URLs, protocol-relative "//evil.com", etc.) falls back to the dashboard.
 */
const REDIRECT_VALIDATION_ORIGIN = 'https://redirect-validation.invalid';
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ENCODED_CONTROL_CHARACTER = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

function trustedRelativePath(value: string | null): string | null {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTER.test(value) ||
    ENCODED_CONTROL_CHARACTER.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, REDIRECT_VALIDATION_ORIGIN);
    if (parsed.origin !== REDIRECT_VALIDATION_ORIGIN) return null;
    const serializedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const reparsed = new URL(serializedPath, REDIRECT_VALIDATION_ORIGIN);
    if (reparsed.origin !== REDIRECT_VALIDATION_ORIGIN) return null;
    return serializedPath;
  } catch {
    return null;
  }
}

export function safeRedirectPath(
  next: string | null,
  fallback = '/en/dashboard'
): string {
  return trustedRelativePath(next) ?? trustedRelativePath(fallback) ?? '/en/dashboard';
}
