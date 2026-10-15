import { createServerClient } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/config';

// Create the intl middleware
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

// Public routes that don't require authentication (without locale prefix)
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/privacy-policy',
  '/setup-organization',
  '/pricing',
  '/book-demo',
];

// Auth routes that authenticated users should be redirected away from
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];

// French route mappings
const FR_ROUTES: Record<string, string> = {
  '/connexion': '/login',
  '/inscription': '/signup',
  '/mot-de-passe-oublie': '/forgot-password',
  '/reinitialiser-mot-de-passe': '/reset-password',
  '/tableau-de-bord': '/dashboard',
  '/equipes': '/teams',
  '/joueurs': '/players',
  '/calendrier': '/schedule',
  '/classement': '/standings',
  '/repechage': '/drafts',
  '/parametres': '/settings',
  '/profil': '/profile',
  '/facturation': '/billing',
  '/notifications': '/notifications',
  '/configuration-organisation': '/setup-organization',
};

// API routes that should skip middleware entirely (webhooks, auth callbacks, etc.)
const SKIP_MIDDLEWARE_ROUTES = ['/api/stripe/webhooks', '/api/'];

function removeLocalePrefix(pathname: string): string {
  const localePattern = new RegExp(`^/(${locales.join('|')})`);
  return pathname.replace(localePattern, '') || '/';
}

function getLocaleFromPath(pathname: string): string | null {
  const match = pathname.match(new RegExp(`^/(${locales.join('|')})`));
  return match ? match[1] : null;
}

function normalizeFrenchRoute(pathname: string): string {
  // Check if it's a French route and convert to English equivalent
  for (const [frRoute, enRoute] of Object.entries(FR_ROUTES)) {
    if (pathname === frRoute || pathname.startsWith(frRoute + '/')) {
      return pathname.replace(frRoute, enRoute);
    }
  }
  return pathname;
}

/**
 * Copy Supabase auth cookies from one response to another.
 * This is critical when the middleware needs to return a redirect
 * instead of the original intl response — without this, refreshed
 * session tokens are lost and the user appears unauthenticated.
 */
function copyAuthCookies(from: NextResponse, to: NextResponse): void {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value, {
      // Preserve the cookie attributes from the Set-Cookie header
      ...(cookie as any),
    });
  });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip middleware for API routes, static files
  const shouldSkipMiddleware = SKIP_MIDDLEWARE_ROUTES.some(route =>
    pathname.startsWith(route)
  );

  if (shouldSkipMiddleware) {
    return NextResponse.next();
  }

  // Skip middleware for static assets
  if (
    pathname.includes('_next') ||
    pathname.includes('favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|ogg|mp3|wav|woff|woff2|ttf|eot|webmanifest|json)$/)
  ) {
    return NextResponse.next();
  }

  // Handle internationalization first
  const response = intlMiddleware(request);

  // Extract locale and path without locale
  const locale = getLocaleFromPath(pathname) || defaultLocale;
  let pathWithoutLocale = removeLocalePrefix(pathname);

  // Normalize French routes to English equivalents for auth checking
  if (locale === 'fr') {
    pathWithoutLocale = normalizeFrenchRoute(pathWithoutLocale);
  }

  // Keep the previously published policy URL public and send it to the
  // canonical localized policy before performing any authentication lookup.
  if (pathWithoutLocale === '/privacy-policy') {
    return NextResponse.redirect(new URL(`/${locale}/privacy`, request.url));
  }

  // Create Supabase client for auth — cookies are read from the request
  // and any refreshed tokens are written to the intl response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Check if the current path is a public route
  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    pathWithoutLocale === route || pathWithoutLocale.startsWith(route + '/')
  );
  const isAuthRoute = AUTH_ROUTES.some(route => pathWithoutLocale === route);

  // Redirect unauthenticated users trying to access protected routes
  if (!user && !isPublicRoute) {
    const loginPath = locale === 'fr' ? '/fr/connexion' : '/en/login';
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    // Carry over any refreshed auth cookies so they aren't lost
    copyAuthCookies(response, redirectResponse);
    return redirectResponse;
  }

  // Redirect authenticated users away from auth pages
  if (user && isAuthRoute) {
    const dashboardPath = locale === 'fr' ? '/fr/tableau-de-bord' : '/en/dashboard';
    const redirectResponse = NextResponse.redirect(new URL(dashboardPath, request.url));
    copyAuthCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|site\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|ogg|mp3|wav|woff|woff2|ttf|eot|webmanifest|json)$).*)',
  ],
};
