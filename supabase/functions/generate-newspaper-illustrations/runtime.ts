// OpenAI documents that complex image generations may take up to two minutes.
// Supabase requires an HTTP response within 150 seconds, so retain 20 seconds
// for preflight, validation, storage, and the response after the provider budget.
export const PROVIDER_TIMEOUT_MS = 120_000;
export const OVERALL_DEADLINE_MS = 140_000;

export type FailureStage =
  | 'request'
  | 'scope'
  | 'preflight'
  | 'provider_request'
  | 'provider_timeout'
  | 'provider_validation'
  | 'overall_deadline'
  | 'workflow';

const LOGGABLE_FAILURE_CODES = new Set([
  'INVALID_REQUEST',
  'EDITION_NOT_FOUND',
  'EDITION_TENANT_MISMATCH',
  'SUPABASE_PROJECT_MISMATCH',
  'STALE_GENERATION_LEASE',
  'INVALID_EDITION_SCOPE',
  'PLAYER_NOT_RECORDED_CONTRIBUTOR',
  'PLAYER_PROFILE_NOT_FOUND',
  'PLAYER_NAME_UNRESOLVED',
  'PLAYER_PHOTO_UNRESOLVED',
  'PLAYER_PHOTO_FETCH_FAILED',
  'PLAYER_PHOTO_REDIRECT',
  'INVALID_PLAYER_PHOTO_MIME',
  'UNSAFE_PLAYER_PHOTO_URL',
  'NO_COMPLETED_GAMES',
  'GAME_SCOPE_MISMATCH',
  'PROVIDER_REQUEST_FAILED',
  'PROVIDER_TIMEOUT',
  'INVALID_PROVIDER_RESPONSE',
  'INVALID_GENERATED_IMAGE',
  'GENERATION_DEADLINE_EXCEEDED',
  'STORAGE_CONFIGURATION_INVALID',
  'SERVER_CONFIGURATION_MISSING',
  'ILLUSTRATION_GENERATION_FAILED',
]);

export class ObservableIllustrationError extends Error {
  readonly stage: FailureStage;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    code: 'PROVIDER_REQUEST_FAILED' | 'PROVIDER_TIMEOUT' | 'INVALID_PROVIDER_RESPONSE',
    stage: FailureStage,
    status: number | null = null,
    requestId: string | null = null,
  ) {
    super(code);
    this.name = 'ObservableIllustrationError';
    this.stage = stage;
    this.status = status;
    this.requestId = requestId;
  }
}

export function publicIllustrationError(error: unknown): { status: number; code: string; message: string } {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
  if (code === 'INVALID_REQUEST') return { status: 400, code, message: 'Request must contain a valid editionId, generationToken, and one to four distinct playerIds.' };
  if (code === 'EDITION_NOT_FOUND') return { status: 404, code, message: 'Edition was not found.' };
  if (['EDITION_TENANT_MISMATCH', 'SUPABASE_PROJECT_MISMATCH'].includes(code)) return { status: 403, code, message: 'Project or league scope was rejected.' };
  if (['STALE_GENERATION_LEASE', 'INVALID_EDITION_SCOPE'].includes(code)) return { status: 409, code, message: 'The newspaper generation lease or canonical week is no longer valid.' };
  if (code.startsWith('PLAYER_') || code === 'UNSAFE_PLAYER_PHOTO_URL' || code === 'NO_COMPLETED_GAMES' || code === 'GAME_SCOPE_MISMATCH') {
    return { status: 422, code, message: 'A requested player is not an eligible, fully resolved contributor in this edition.' };
  }
  if (code === 'PROVIDER_TIMEOUT' || code === 'GENERATION_DEADLINE_EXCEEDED') {
    return { status: 504, code: 'ILLUSTRATION_GENERATION_TIMEOUT', message: 'Illustration generation timed out safely. Retry the draft generation.' };
  }
  return { status: 502, code: 'ILLUSTRATION_GENERATION_FAILED', message: 'Illustrations could not be generated and validated.' };
}

function stageForCode(code: string): FailureStage {
  if (code === 'INVALID_REQUEST') return 'request';
  if (['EDITION_NOT_FOUND', 'EDITION_TENANT_MISMATCH', 'STALE_GENERATION_LEASE', 'INVALID_EDITION_SCOPE'].includes(code)) return 'scope';
  if (code === 'PROVIDER_TIMEOUT') return 'provider_timeout';
  if (code === 'PROVIDER_REQUEST_FAILED') return 'provider_request';
  if (code === 'INVALID_PROVIDER_RESPONSE' || code === 'INVALID_GENERATED_IMAGE') return 'provider_validation';
  if (code === 'GENERATION_DEADLINE_EXCEEDED') return 'overall_deadline';
  if (code.endsWith('_CONFIGURATION_INVALID') || code === 'SERVER_CONFIGURATION_MISSING') return 'preflight';
  return 'workflow';
}

function safeRequestId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

export function illustrationFailureLog(error: unknown, publicCode: string) {
  const rawCode = error instanceof Error ? error.message : '';
  const failureCode = LOGGABLE_FAILURE_CODES.has(rawCode) ? rawCode : publicCode;
  const operational = error instanceof ObservableIllustrationError ? error : null;
  const status = operational?.status;
  return {
    event: 'newspaper_illustrations_failed',
    stage: operational?.stage ?? stageForCode(failureCode),
    failureCode,
    status: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    requestId: safeRequestId(operational?.requestId),
  };
}
