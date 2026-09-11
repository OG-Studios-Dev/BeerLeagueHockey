import Constants from 'expo-constants';

export type MembershipLoadTrigger = 'bootstrap' | 'sign-in' | 'manual-retry';
export type MembershipLoadStatus = 'signed-out' | 'loading' | 'ready' | 'empty' | 'error' | 'incomplete';

export type MembershipDiagnosticEntry = {
  requestId: number;
  generation: number;
  trigger: MembershipLoadTrigger;
  phase: 'requesting' | 'completed';
  outcome: 'pending' | 'success' | 'empty' | 'incomplete' | 'auth-error' | 'missing-user' | 'query-error' | 'identity-mismatch' | 'session-error';
  sessionPresent: boolean | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userSuffix: string | null;
  getSessionCode: string | null;
  getSessionHttpStatus: number | null;
  getUserStatus: 'pending' | 'not-requested' | 'ok' | 'missing-user' | 'error';
  getUserCode: string | null;
  getUserHttpStatus: number | null;
  membershipResponseStatus: 'pending' | 'not-requested' | 'success' | 'incomplete' | 'error';
  membershipErrorCode: string | null;
  membershipHttpStatus: number | null;
  rowCount: number | null;
  nonNullLeagueCount: number | null;
  commit: 'pending' | 'committed' | 'retained' | 'dropped';
  availableLeagueCount: number | null;
};

export type MembershipDiagnostics = {
  backendOrigin: string | null;
  appVersion: string | null;
  appBuild: string | null;
  entries: MembershipDiagnosticEntry[];
};

function safeRuntimeLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][0-9A-Za-z.-]{1,16})?$/.test(value)
    ? value
    : null;
}

export function safeBackendOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function getMembershipDiagnosticRuntime(
  backendUrl: unknown = process.env.EXPO_PUBLIC_SUPABASE_URL,
): Omit<MembershipDiagnostics, 'entries'> {
  return {
    backendOrigin: safeBackendOrigin(backendUrl),
    appVersion: safeRuntimeLabel(Constants.expoConfig?.version),
    appBuild: safeRuntimeLabel(Constants.expoConfig?.ios?.buildNumber),
  };
}

const safeValues = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => (
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback
);

function safeCount(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000
    ? value as number
    : null;
}

function safeHttpStatus(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599
    ? value as number
    : null;
}

function safeRequestId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= Number.MAX_SAFE_INTEGER
    ? value as number
    : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeDiagnosticCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value)) return value;
  if ([
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
  ].includes(value)) {
    return value;
  }
  return null;
}

function safeUserSuffix(value: unknown): string | null {
  return typeof value === 'string' && /^••••[A-Za-z0-9]{4}$/.test(value) ? value : null;
}

export function getSafeDiagnosticErrorFacts(error: unknown): {
  code: string | null;
  httpStatus: number | null;
} {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; status?: unknown }
    : {};
  return {
    code: safeDiagnosticCode(value.code),
    httpStatus: safeHttpStatus(value.status),
  };
}

const label = (value: string | number | null) => value == null ? 'unknown' : String(value);

// This formatter intentionally projects individual allowlisted fields. It must
// never stringify the source object because callers may hold SDK errors/session
// objects alongside these facts in development fixtures.
export function formatMembershipDiagnostics(value: unknown, currentStatus: unknown): string {
  const diagnostics = value && typeof value === 'object'
    ? value as Partial<MembershipDiagnostics> & Record<string, unknown>
    : {};
  const backendOrigin = safeBackendOrigin(diagnostics.backendOrigin);
  const appVersion = safeRuntimeLabel(diagnostics.appVersion);
  const appBuild = safeRuntimeLabel(diagnostics.appBuild);
  const status = safeValues(currentStatus, ['signed-out', 'loading', 'ready', 'empty', 'error', 'incomplete'] as const, 'error');
  const rawEntries = Array.isArray(diagnostics.entries) ? diagnostics.entries.slice(-3) : [];
  const lines = [
    `App: ${label(appVersion)} (build ${label(appBuild)})`,
    `Backend: ${label(backendOrigin)}`,
    `Current league status: ${status}`,
  ];

  if (rawEntries.length === 0) {
    lines.push(
      `Session: ${status === 'signed-out' ? 'not signed in' : 'unknown'}`,
      'Request: none in this app session',
      'Membership: not requested',
    );
    return lines.join('\n');
  }

  for (const rawEntry of rawEntries) {
    const entry = rawEntry && typeof rawEntry === 'object'
      ? rawEntry as Partial<MembershipDiagnosticEntry> & Record<string, unknown>
      : {};
    const requestId = safeRequestId(entry.requestId);
    const generation = safeRequestId(entry.generation);
    const trigger = safeValues(entry.trigger, ['bootstrap', 'sign-in', 'manual-retry'] as const, 'bootstrap');
    const phase = safeValues(entry.phase, ['requesting', 'completed'] as const, 'completed');
    const outcome = safeValues(entry.outcome, [
      'pending', 'success', 'empty', 'incomplete', 'auth-error', 'missing-user',
      'query-error', 'identity-mismatch', 'session-error',
    ] as const, 'session-error');
    const getUserStatus = safeValues(entry.getUserStatus, ['pending', 'not-requested', 'ok', 'missing-user', 'error'] as const, 'error');
    const membershipResponseStatus = safeValues(entry.membershipResponseStatus, ['pending', 'not-requested', 'success', 'incomplete', 'error'] as const, 'error');
    const commit = safeValues(entry.commit, ['pending', 'committed', 'retained', 'dropped'] as const, 'dropped');
    const startedAt = safeTimestamp(entry.startedAt);
    const finishedAt = safeTimestamp(entry.finishedAt);
    const durationMs = safeCount(entry.durationMs);
    const user = safeUserSuffix(entry.userSuffix);
    const getSessionCode = safeDiagnosticCode(entry.getSessionCode);
    const getSessionHttpStatus = safeHttpStatus(entry.getSessionHttpStatus);
    const getUserCode = safeDiagnosticCode(entry.getUserCode);
    const membershipCode = safeDiagnosticCode(entry.membershipErrorCode);
    const getUserHttpStatus = safeHttpStatus(entry.getUserHttpStatus);
    const membershipHttpStatus = safeHttpStatus(entry.membershipHttpStatus);
    const rowCount = safeCount(entry.rowCount);
    const nonNullLeagueCount = safeCount(entry.nonNullLeagueCount);
    const availableLeagueCount = safeCount(entry.availableLeagueCount);
    const sessionPresent = entry.sessionPresent === true ? 'present' : entry.sessionPresent === false ? 'absent' : 'unknown';

    lines.push(
      '',
      `Request: #${label(requestId)} · generation ${label(generation)} · ${trigger} · ${phase}`,
      `Outcome: ${outcome}`,
      `Session: ${sessionPresent} · validated user: ${label(user)}`,
      `Started: ${label(startedAt)} · finished: ${label(finishedAt)} · duration: ${durationMs == null ? 'unknown' : `${durationMs} ms`}`,
      `getSession: HTTP ${label(getSessionHttpStatus)} · code ${label(getSessionCode)}`,
      `getUser: ${getUserStatus} · HTTP ${label(getUserHttpStatus)} · code ${label(getUserCode)}`,
      `Membership: ${membershipResponseStatus} · HTTP ${label(membershipHttpStatus)} · code ${label(membershipCode)}`,
      `Rows: ${label(rowCount)} · accessible leagues: ${label(nonNullLeagueCount)}`,
      `Commit: ${commit} · Available leagues: ${label(availableLeagueCount)}`,
    );
  }

  return lines.join('\n');
}
