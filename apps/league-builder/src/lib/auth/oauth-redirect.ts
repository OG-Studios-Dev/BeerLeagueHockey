import { safeRedirectPath } from './safe-redirect';

export type AuthLocale = 'en' | 'fr';

export function validatedAuthLocale(value: string | null, path?: string): AuthLocale {
  if (value === 'fr' || value === 'en') return value;
  return path === '/fr' || path?.startsWith('/fr/') ? 'fr' : 'en';
}

export function buildOAuthCallbackUrl(
  origin: string,
  localeValue: string,
  redirectTo?: string
): URL {
  const locale = validatedAuthLocale(localeValue, redirectTo);
  const defaultNext = `/${locale}/dashboard`;
  const callbackUrl = new URL('/api/auth/callback', origin);
  callbackUrl.searchParams.set('locale', locale);
  callbackUrl.searchParams.set(
    'next',
    safeRedirectPath(redirectTo ?? null, defaultNext)
  );
  return callbackUrl;
}
