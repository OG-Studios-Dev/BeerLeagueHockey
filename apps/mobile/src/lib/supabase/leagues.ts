import { supabase } from './client';

export type LeagueRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  short_name: string | null;
  city: string | null;
};

type SafeRequestFacts = {
  status: 'ok' | 'missing-user' | 'error';
  code: string | null;
  httpStatus: number | null;
};

export type UserLeagueLookupResult = {
  status: 'success' | 'incomplete' | 'auth-error' | 'missing-user' | 'query-error' | 'identity-mismatch';
  leagues: LeagueRow[];
  identityMatchesExpected: boolean | null;
  userSuffix: string | null;
  getUser: SafeRequestFacts;
  membership: {
    status: 'not-requested' | 'success' | 'incomplete' | 'error';
    code: string | null;
    httpStatus: number | null;
    rowCount: number | null;
    nonNullLeagueCount: number | null;
  };
};

const SAFE_AUTH_ERROR_CODES = new Set([
  'bad_jwt',
  'request_timeout',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_expired',
  'session_not_found',
  'unexpected_audience',
  'unexpected_failure',
  'user_banned',
  'user_not_found',
]);

function safeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  if (SAFE_AUTH_ERROR_CODES.has(code)) return code;
  if (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code)) return code;
  return null;
}

function safeHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599
    ? status as number
    : null;
}

function userSuffix(userId: string): string | null {
  const suffix = userId.slice(-4);
  return /^[A-Za-z0-9]{4}$/.test(suffix) ? `••••${suffix}` : null;
}

function isLeagueRow(value: unknown): value is LeagueRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<LeagueRow>;
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.slug === 'string';
}

const notRequestedMembership: UserLeagueLookupResult['membership'] = {
  status: 'not-requested',
  code: null,
  httpStatus: null,
  rowCount: null,
  nonNullLeagueCount: null,
};

// Performs a fresh Supabase getUser validation before the RLS-scoped membership
// query. The expected ID is used only to reject stale account responses; it is
// never used as a substitute for getUser or as the query identity.
export async function getUserLeaguesDetailed(
  expectedUserId: string | null = null,
): Promise<UserLeagueLookupResult> {
  let authResponse: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResponse = await supabase.auth.getUser();
  } catch (error) {
    return {
      status: 'auth-error',
      leagues: [],
      identityMatchesExpected: null,
      userSuffix: null,
      getUser: { status: 'error', code: safeErrorCode(error), httpStatus: safeHttpStatus(error) },
      membership: notRequestedMembership,
    };
  }

  const { user } = authResponse.data;
  if (authResponse.error) {
    return {
      status: 'auth-error',
      leagues: [],
      identityMatchesExpected: null,
      userSuffix: null,
      getUser: {
        status: 'error',
        code: safeErrorCode(authResponse.error),
        httpStatus: safeHttpStatus(authResponse.error),
      },
      membership: notRequestedMembership,
    };
  }

  if (!user) {
    return {
      status: 'missing-user',
      leagues: [],
      identityMatchesExpected: null,
      userSuffix: null,
      getUser: { status: 'missing-user', code: null, httpStatus: null },
      membership: notRequestedMembership,
    };
  }

  const identityMatchesExpected = expectedUserId == null ? null : expectedUserId === user.id;
  const safeUserSuffix = userSuffix(user.id);

  if (identityMatchesExpected === false) {
    return {
      status: 'identity-mismatch',
      leagues: [],
      identityMatchesExpected: false,
      userSuffix: null,
      getUser: { status: 'ok', code: null, httpStatus: null },
      membership: notRequestedMembership,
    };
  }

  let queryResponse: { data: unknown; error: unknown; status?: unknown };
  try {
    queryResponse = await supabase
      .from('league_memberships')
      .select('league:leagues(id, name, slug, logo_url, primary_color, secondary_color, short_name, city)')
      .eq('user_id', user.id);
  } catch (error) {
    return {
      status: 'query-error',
      leagues: [],
      identityMatchesExpected,
      userSuffix: safeUserSuffix,
      getUser: { status: 'ok', code: null, httpStatus: null },
      membership: {
        status: 'error',
        code: safeErrorCode(error),
        httpStatus: safeHttpStatus(error),
        rowCount: null,
        nonNullLeagueCount: null,
      },
    };
  }

  if (queryResponse.error || !Array.isArray(queryResponse.data)) {
    return {
      status: 'query-error',
      leagues: [],
      identityMatchesExpected,
      userSuffix: safeUserSuffix,
      getUser: { status: 'ok', code: null, httpStatus: null },
      membership: {
        status: 'error',
        code: safeErrorCode(queryResponse.error),
        httpStatus: safeHttpStatus(queryResponse),
        rowCount: null,
        nonNullLeagueCount: null,
      },
    };
  }

  const embedded = queryResponse.data.map((membership) => (
    membership && typeof membership === 'object' && 'league' in membership
      ? (membership as { league?: unknown }).league
      : null
  ));
  const leagues = embedded.filter(isLeagueRow);
  const incomplete = leagues.length !== queryResponse.data.length;

  return {
    status: incomplete ? 'incomplete' : 'success',
    leagues,
    identityMatchesExpected,
    userSuffix: safeUserSuffix,
    getUser: { status: 'ok', code: null, httpStatus: null },
    membership: {
      status: incomplete ? 'incomplete' : 'success',
      code: null,
      httpStatus: safeHttpStatus(queryResponse),
      rowCount: queryResponse.data.length,
      nonNullLeagueCount: leagues.length,
    },
  };
}

// Compatibility for callers that only consume the successful league rows.
export async function getUserLeagues(): Promise<LeagueRow[]> {
  const result = await getUserLeaguesDetailed();
  return result.leagues;
}

// Fetch all public leagues (for discovery)
export async function getPublicLeagues(): Promise<LeagueRow[]> {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, name, slug, logo_url, primary_color, secondary_color, short_name, city')
    .eq('is_public', true)
    .limit(20);
  return error ? [] : (data ?? []);
}
