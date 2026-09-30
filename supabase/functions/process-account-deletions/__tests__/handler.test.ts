import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createProcessAccountDeletionsHandler,
  type DeletionSelection,
} from '../handler.ts';

const TARGET_ID = '72d37220-497b-422e-ba6c-2cd1de56a697';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';

function eligibleState(userId = TARGET_ID) {
  return {
    user_id: userId,
    database_deleted_at: '2026-09-30T03:45:00Z',
    stripe_customer_id: null,
    stripe_completed_at: null as string | null,
    completion_email: 'retained@example.test',
    email_completed_at: null as string | null,
    completed_at: null as string | null,
    initiation_kind: 'immediate',
    workflow_state: 'database_deleted',
  };
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/process-account-deletions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer service-role-test',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
}

function dependencies(options: {
  rows?: ReturnType<typeof eligibleState>[];
  onSelection?: (selection: DeletionSelection) => void;
  events?: string[];
  providerFailure?: Error;
} = {}) {
  const events = options.events ?? [];
  return {
    serviceRoleKey: 'service-role-test',
    cronSecret: 'cron-secret-test',
    loadEligibleStates: async (selection: DeletionSelection) => {
      options.onSelection?.(selection);
      events.push(`query:${selection.mode}:${selection.limit}`);
      return { data: options.rows ?? [], error: null };
    },
    deleteStripeCustomer: async (customerId: string) => {
      events.push(`stripe:${customerId}`);
      if (options.providerFailure) throw options.providerFailure;
    },
    sendCompletionEmail: async (userId: string) => {
      events.push(`email:${userId}`);
      if (options.providerFailure) throw options.providerFailure;
    },
    recordStep: async (userId: string, step: 'stripe' | 'email' | 'complete') => {
      events.push(`record:${userId}:${step}`);
    },
    recordRetryError: async (userId: string) => {
      events.push(`retry:${userId}`);
      return true;
    },
  };
}

describe('process-account-deletions handler boundary', () => {
  it('rejects GET before querying or invoking a provider', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
    const response = await handler(new Request('https://example.test/process-account-deletions'));

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
    assert.deepEqual(events, []);
  });

  it('rejects unauthorized POST before parsing work or querying', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
    const response = await handler(new Request('https://example.test/process-account-deletions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'batch' }),
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(events, []);
  });

  it('accepts the configured dedicated cron secret when the service-role bearer is wrong', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
    const response = await handler(request(JSON.stringify({ mode: 'batch' }), {
      Authorization: 'Bearer wrong-token',
      'X-Cron-Secret': 'cron-secret-test',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(events, ['query:batch:50']);
  });

  it('rejects a wrong dedicated cron secret before parsing or querying', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
    const response = await handler(request('{', {
      Authorization: 'Bearer wrong-token',
      'X-Cron-Secret': 'wrong-cron-secret',
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(events, []);
  });

  it('fails the cron path closed when no cron secret is configured', async () => {
    const events: string[] = [];
    const configured = dependencies({ events });
    configured.cronSecret = undefined;
    const handler = createProcessAccountDeletionsHandler(configured);
    const response = await handler(request('{', {
      Authorization: 'Bearer wrong-token',
      'X-Cron-Secret': 'any-value',
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(events, []);
  });

  it('rejects an empty body, unknown mode, malformed target, and extra keys before querying', async () => {
    const invalidBodies = [
      '',
      '{}',
      JSON.stringify({ mode: 'everything' }),
      JSON.stringify({ mode: 'target' }),
      JSON.stringify({ mode: 'target', user_id: 'not-a-uuid' }),
      JSON.stringify({ mode: 'target', user_id: TARGET_ID, extra: true }),
      JSON.stringify({ mode: 'batch', user_id: TARGET_ID }),
    ];

    for (const body of invalidBodies) {
      const events: string[] = [];
      const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
      const response = await handler(request(body));
      assert.equal(response.status, 400, `expected invalid body ${body} to be rejected`);
      assert.deepEqual(events, []);
    }
  });

  it('rejects an oversized body before querying', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({ events }));
    const response = await handler(request(JSON.stringify({ mode: 'batch', padding: 'x'.repeat(2048) })));

    assert.equal(response.status, 413);
    assert.deepEqual(events, []);
  });

  it('passes an exact target selector with limit one and ignores hostile extra rows', async () => {
    const events: string[] = [];
    let selection: DeletionSelection | undefined;
    const target = eligibleState();
    const handler = createProcessAccountDeletionsHandler(dependencies({
      rows: [eligibleState(OTHER_ID), target, eligibleState('22222222-2222-4222-8222-222222222222')],
      events,
      onSelection: (value) => { selection = value; },
    }));
    const response = await handler(request(JSON.stringify({ mode: 'target', user_id: TARGET_ID })));

    assert.equal(response.status, 200);
    assert.deepEqual(selection, { mode: 'target', userId: TARGET_ID, limit: 1 });
    assert.deepEqual(events, [
      'query:target:1',
      `record:${TARGET_ID}:stripe`,
      `email:${TARGET_ID}`,
      `record:${TARGET_ID}:email`,
      `record:${TARGET_ID}:complete`,
    ]);
    assert.equal(events.some((event) => event.includes(OTHER_ID)), false);
  });

  it('reports target not found without exposing the requested identifier', async () => {
    const events: string[] = [];
    const handler = createProcessAccountDeletionsHandler(dependencies({
      rows: [eligibleState(OTHER_ID)],
      events,
    }));
    const response = await handler(request(JSON.stringify({ mode: 'target', user_id: TARGET_ID })));
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(body.includes(TARGET_ID), false);
    assert.deepEqual(events, ['query:target:1']);
  });

  it('does not invoke providers or markers for an already-completed target', async () => {
    const events: string[] = [];
    const completed = eligibleState();
    completed.completed_at = '2026-09-30T04:00:00Z';
    const handler = createProcessAccountDeletionsHandler(dependencies({ rows: [completed], events }));
    const response = await handler(request(JSON.stringify({ mode: 'target', user_id: TARGET_ID })));

    assert.equal(response.status, 409);
    assert.deepEqual(events, ['query:target:1']);
  });

  it('records a sanitized retry marker after a provider failure and never completes early', async () => {
    const events: string[] = [];
    const state = eligibleState();
    state.stripe_customer_id = 'cus_retry';
    const handler = createProcessAccountDeletionsHandler(dependencies({
      rows: [state],
      events,
      providerFailure: new Error('provider response containing private details'),
    }));
    const response = await handler(request(JSON.stringify({ mode: 'target', user_id: TARGET_ID })));
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.equal(body.includes('private details'), false);
    assert.deepEqual(events, [
      'query:target:1',
      'stripe:cus_retry',
      `retry:${TARGET_ID}`,
    ]);
  });

  it('preserves provider-before-marker ordering for idempotent retries', async () => {
    const events: string[] = [];
    const state = eligibleState();
    state.stripe_customer_id = 'cus_once';
    const handler = createProcessAccountDeletionsHandler(dependencies({ rows: [state], events }));
    const response = await handler(request(JSON.stringify({ mode: 'target', user_id: TARGET_ID })));

    assert.equal(response.status, 200);
    assert.deepEqual(events, [
      'query:target:1',
      'stripe:cus_once',
      `record:${TARGET_ID}:stripe`,
      `email:${TARGET_ID}`,
      `record:${TARGET_ID}:email`,
      `record:${TARGET_ID}:complete`,
    ]);
  });
});
