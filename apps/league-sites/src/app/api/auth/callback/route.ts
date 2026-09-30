import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { consumeCaptainInvite } from '@/lib/actions/captain-player-invites';

/**
 * Auth Callback Route for League Sites
 *
 * Handles the PKCE code exchange for Supabase Auth flows:
 * - OAuth provider redirects (Google, Apple, etc.)
 * - Password reset email links
 * - Email verification links
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'));

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('[Auth Callback] Code exchange error:', error.message);
      return NextResponse.redirect(new URL('/?auth_error=true', request.url));
    }

    // Check for legacy profile matches — append ?claim=true so /me page shows banner
    try {
      const serviceSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const captainInviteId = cookieStore.get('captain_player_invite')?.value;
        if (captainInviteId) {
          const inviteResult = await consumeCaptainInvite(captainInviteId);
          if (inviteResult.success) {
            cookieStore.delete('captain_player_invite');
          }
        }

        const { data: profile } = await serviceSupabase
          .from('profiles')
          .select('pending_legacy_match_ids')
          .eq('id', authUser.id)
          .single();
        const matchIds = (profile as any)?.pending_legacy_match_ids as string[] | null;
        if (Array.isArray(matchIds) && matchIds.length > 1) {
          const claimUrl = new URL(next, request.url);
          claimUrl.searchParams.set('claim', 'true');
          return NextResponse.redirect(claimUrl);
        }
      }
    } catch {
      // Non-blocking — proceed with normal redirect
    }

    return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL('/', request.url));
}
