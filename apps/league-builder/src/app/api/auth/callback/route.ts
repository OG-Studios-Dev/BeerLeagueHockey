import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { classifyOAuthFailure, type OAuthRecoveryCode } from '@/lib/auth/oauth-errors';

/**
 * Auth Callback Route
 *
 * Handles the PKCE code exchange for Supabase Auth flows:
 * - OAuth (Google, Apple) sign-in
 * - Password reset email links
 * - Email verification links
 * - Magic link sign-ins
 *
 * IMPORTANT: We must set cookies on the NextResponse directly (not via
 * cookies() from next/headers) because cookies().set() writes are NOT
 * included in NextResponse.redirect() responses in Next.js 15+.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const requestedNext = searchParams.get('next');
  const next = safeRedirectPath(requestedNext);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const isAccountLink = searchParams.get('flow') === 'link';
  const providerError = searchParams.get('error');
  const providerErrorDescription = searchParams.get('error_description');

  function oauthFailureRedirect(code: OAuthRecoveryCode): NextResponse {
    const fallback = isAccountLink
      ? '/en/dashboard/settings'
      : next.startsWith('/fr/')
        ? '/fr/login'
        : '/en/login';
    const returnPath = isAccountLink
      ? safeRedirectPath(requestedNext, fallback)
      : fallback;
    const url = new URL(returnPath, request.url);
    url.searchParams.set('oauth_error', code);
    return NextResponse.redirect(url);
  }

  // Providers can return a denial or failure without an authorization code.
  // Never forward their free-form text: it may contain an email or HTML.
  if (!code && (providerError || providerErrorDescription)) {
    return oauthFailureRedirect(
      classifyOAuthFailure(providerError, providerErrorDescription)
    );
  }

  // Create a response we can attach cookies to — we'll swap the URL later
  // when we know where to redirect.
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

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

  /**
   * Helper: create a redirect response that carries over all cookies
   * set during the auth exchange (session tokens, code verifier cleanup, etc.)
   */
  function redirectWithCookies(url: URL | string): NextResponse {
    const redirectUrl = typeof url === 'string' ? new URL(url, request.url) : url;
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Copy every cookie from the auth response to the redirect response
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  // Handle PKCE code exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('[Auth Callback] Code exchange failed');
      if (type === 'recovery') {
        return redirectWithCookies(
          new URL('/en/reset-password?error=Invalid or expired link', request.url)
        );
      }
      // A failed link exchange must not overwrite the already authenticated
      // account's cookies with partial/clearing exchange cookies.
      return oauthFailureRedirect('oauth_failed');
    }

    // For recovery type, redirect to reset-password page
    if (type === 'recovery') {
      return redirectWithCookies(new URL('/en/reset-password', request.url));
    }

    // For OAuth users, check if they need to complete org setup
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const isOAuthUser = user.app_metadata?.providers?.some(
        (p: string) => p === 'google' || p === 'apple'
      ) || user.app_metadata?.provider === 'google' || user.app_metadata?.provider === 'apple';

      if (isOAuthUser) {
        // Use service role to check org ownership (bypasses RLS that may
        // block the anon client for brand-new users)
        const serviceSupabase = createServiceRoleClient();

        const { data: ownedOrgs } = await serviceSupabase
          .from('organizations')
          .select('id')
          .eq('owner_user_id', user.id)
          .limit(1);

        const { data: memberships } = await serviceSupabase
          .from('organization_members')
          .select('id')
          .eq('user_id', user.id)
          .limit(1);

        const hasOrg = (ownedOrgs && ownedOrgs.length > 0) || (memberships && memberships.length > 0);

        if (!hasOrg) {
          const locale = next.startsWith('/fr') ? 'fr' : 'en';
          const setupPath = `/${locale}/setup-organization`;
          return redirectWithCookies(new URL(setupPath, request.url));
        }
      }
    }

    // Check for legacy profile matches requiring disambiguation
    try {
      const serviceSupabase = createServiceRoleClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await serviceSupabase
          .from('profiles')
          .select('pending_legacy_match_ids')
          .eq('id', authUser.id)
          .single();
        const matchIds = (profile as any)?.pending_legacy_match_ids as string[] | null;
        if (Array.isArray(matchIds) && matchIds.length > 1) {
          return redirectWithCookies(new URL('/en/claim-history', request.url));
        }
      }
    } catch {
      // Non-blocking — proceed with normal redirect
    }

    return redirectWithCookies(new URL(next, request.url));
  }

  // Handle token_hash verification (older flow)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'signup' | 'email',
    });

    if (error) {
      console.error('[Auth Callback] OTP verification failed');
      if (type === 'recovery') {
        return redirectWithCookies(
          new URL('/en/reset-password?error=Invalid or expired link', request.url)
        );
      }
      return redirectWithCookies(
        new URL('/en/login?error=auth_error', request.url)
      );
    }

    // For recovery type, redirect to reset-password page
    if (type === 'recovery') {
      return redirectWithCookies(new URL('/en/reset-password', request.url));
    }

    return redirectWithCookies(new URL(next, request.url));
  }

  // No code or token_hash provided
  return redirectWithCookies(new URL('/en/login', request.url));
}
