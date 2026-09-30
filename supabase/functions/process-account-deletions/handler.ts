import {
  isImmediateExternalRetryState,
  processExternalDeletionSteps,
  type ExternalDeletionState,
} from './processor.ts';

export type DeletionSelection =
  | { mode: 'batch'; limit: 50 }
  | { mode: 'target'; userId: string; limit: 1 };

type LoadResult = {
  data: ExternalDeletionState[] | null;
  error: unknown;
};

export type ProcessAccountDeletionsDependencies = {
  serviceRoleKey: string;
  cronSecret?: string;
  loadEligibleStates: (selection: DeletionSelection) => PromiseLike<LoadResult>;
  deleteStripeCustomer: (customerId: string) => Promise<void>;
  sendCompletionEmail: (userId: string, email: string) => Promise<void>;
  recordStep: (
    userId: string,
    step: 'stripe' | 'email' | 'complete',
  ) => Promise<void>;
  recordRetryError: (userId: string) => Promise<boolean>;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const MAX_REQUEST_BODY_BYTES = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function isAuthorized(
  request: Request,
  dependencies: ProcessAccountDeletionsDependencies,
): boolean {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = request.headers.get('X-Cron-Secret');
  return (
    Boolean(dependencies.cronSecret)
    && cronSecret === dependencies.cronSecret
  ) || (
    Boolean(dependencies.serviceRoleKey)
    && authHeader === `Bearer ${dependencies.serviceRoleKey}`
  );
}

async function parseSelection(request: Request): Promise<DeletionSelection | Response> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return json(400, { error: 'A JSON request body is required.', code: 'invalid_request' });
  }

  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return json(400, { error: 'Invalid request body.', code: 'invalid_request' });
    }
    if (length > MAX_REQUEST_BODY_BYTES) {
      return json(413, { error: 'Request body is too large.', code: 'body_too_large' });
    }
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
    return json(413, { error: 'Request body is too large.', code: 'body_too_large' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: 'Invalid request body.', code: 'invalid_request' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json(400, { error: 'Invalid request body.', code: 'invalid_request' });
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (record.mode === 'batch' && keys.length === 1 && keys[0] === 'mode') {
    return { mode: 'batch', limit: 50 };
  }
  if (
    record.mode === 'target'
    && keys.length === 2
    && keys[0] === 'mode'
    && keys[1] === 'user_id'
    && typeof record.user_id === 'string'
    && UUID_PATTERN.test(record.user_id)
  ) {
    return { mode: 'target', userId: record.user_id.toLowerCase(), limit: 1 };
  }
  return json(400, { error: 'Invalid request body.', code: 'invalid_request' });
}

export function createProcessAccountDeletionsHandler(
  dependencies: ProcessAccountDeletionsDependencies,
) {
  return async function handleProcessAccountDeletions(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed.', code: 'method_not_allowed' }, { Allow: 'POST' });
    }
    if (!isAuthorized(request, dependencies)) {
      return json(401, { error: 'Unauthorized.', code: 'unauthorized' });
    }

    const selection = await parseSelection(request);
    if (selection instanceof Response) return selection;

    const results = { processed: 0, completed: 0, failed: 0, retryMarkerFailures: 0 };
    const { data, error } = await dependencies.loadEligibleStates(selection);
    if (error) {
      return json(500, { error: 'Unable to load external deletion retry work.', results });
    }

    let rows = data ?? [];
    if (selection.mode === 'target') {
      const exactTarget = rows.find((row) => row.user_id === selection.userId);
      if (!exactTarget) {
        return json(404, { error: 'Eligible deletion retry target not found.', code: 'target_not_found' });
      }
      if (!isImmediateExternalRetryState(exactTarget)) {
        return json(409, { error: 'Deletion retry target is not eligible.', code: 'target_not_eligible' });
      }
      rows = [exactTarget];
    }

    for (const state of rows) {
      results.processed += 1;
      if (!isImmediateExternalRetryState(state)) {
        results.failed += 1;
        continue;
      }
      try {
        await processExternalDeletionSteps(state, {
          deleteStripeCustomer: dependencies.deleteStripeCustomer,
          sendCompletionEmail: (email) => dependencies.sendCompletionEmail(state.user_id, email),
          recordStep: (step) => dependencies.recordStep(state.user_id, step),
        });
        results.completed += 1;
      } catch {
        results.failed += 1;
        if (!await dependencies.recordRetryError(state.user_id)) {
          results.retryMarkerFailures += 1;
        }
      }
    }

    return json(results.failed === 0 ? 200 : 500, {
      message: results.failed === 0
        ? 'Immediate account-deletion retries processed.'
        : 'One or more immediate account-deletion retries failed.',
      results,
    });
  };
}
