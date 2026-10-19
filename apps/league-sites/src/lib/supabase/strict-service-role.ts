import 'server-only';

import { createServerClient } from '@supabase/ssr';

/**
 * Fail-closed service-role client for server-only security boundaries.
 *
 * This isolated module cannot enter a Client Component graph. It never accepts
 * a NEXT_PUBLIC credential and never falls back to the anonymous client.
 */
export function createStrictServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role is not configured');
  }

  return createServerClient(
    supabaseUrl,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Service-role requests never consume or mutate user cookies.
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
