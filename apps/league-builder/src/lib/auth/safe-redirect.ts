/**
 * Validate a redirect path to prevent open-redirect attacks.
 * Only relative paths starting with "/" are allowed; anything else
 * (absolute URLs, protocol-relative "//evil.com", etc.) falls back to the dashboard.
 */
export function safeRedirectPath(
  next: string | null,
  fallback = '/en/dashboard'
): string {
  if (!next) return fallback;
  // Backslashes are normalized to slashes by URL parsing and can turn
  // `/\evil.example` into a cross-origin redirect.
  if (next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
    return next;
  }
  return fallback;
}
