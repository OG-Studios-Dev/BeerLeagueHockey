import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isImmediateExternalRetryState,
  processExternalDeletionSteps,
} from '../processor.ts';

describe('immediate deletion retry eligibility', () => {
  it('accepts only an immediate workflow whose destructive database step already completed', () => {
    const base = {
      user_id: 'user-1',
      database_deleted_at: '2026-09-23T12:00:00Z',
      stripe_customer_id: null,
      stripe_completed_at: null,
      completion_email: 'player@example.test',
      email_completed_at: null,
      completed_at: null,
      initiation_kind: 'immediate',
      workflow_state: 'database_deleted',
    };
    assert.equal(isImmediateExternalRetryState(base), true);
    assert.equal(isImmediateExternalRetryState({ ...base, initiation_kind: 'scheduled' }), false);
    assert.equal(isImmediateExternalRetryState({ ...base, workflow_state: 'irreversible' }), false);
    assert.equal(isImmediateExternalRetryState({ ...base, database_deleted_at: null }), false);
    assert.equal(isImmediateExternalRetryState({ ...base, completed_at: '2026-09-23T12:01:00Z' }), false);
  });
});

describe('account deletion external-step retries', () => {
  it('retries Stripe after a first-attempt failure and never completes early', async () => {
    const state = {
      user_id: 'user-1',
      database_deleted_at: '2026-09-22T12:00:00Z',
      stripe_customer_id: 'cus_retry',
      stripe_completed_at: null as string | null,
      completion_email: 'player@example.test',
      email_completed_at: null as string | null,
      completed_at: null as string | null,
      initiation_kind: 'immediate',
      workflow_state: 'database_deleted',
    };
    const events: string[] = [];
    let stripeAttempts = 0;
    const dependencies = {
      deleteStripeCustomer: async () => {
        stripeAttempts += 1;
        events.push(`stripe:${stripeAttempts}`);
        if (stripeAttempts === 1) throw new Error('temporary Stripe failure');
      },
      sendCompletionEmail: async () => { events.push('email'); },
      recordStep: async (step: 'stripe' | 'email' | 'complete') => {
        events.push(`record:${step}`);
        if (step === 'stripe') {
          state.stripe_completed_at = 'done';
          state.stripe_customer_id = null;
        }
        if (step === 'email') {
          state.email_completed_at = 'done';
          state.completion_email = null;
        }
        if (step === 'complete') state.completed_at = 'done';
      },
    };

    await assert.rejects(processExternalDeletionSteps(state, dependencies), /temporary Stripe failure/);
    assert.deepEqual(events, ['stripe:1']);
    assert.equal(state.completed_at, null);

    await processExternalDeletionSteps(state, dependencies);
    assert.deepEqual(events, [
      'stripe:1',
      'stripe:2',
      'record:stripe',
      'email',
      'record:email',
      'record:complete',
    ]);
    assert.equal(state.completed_at, 'done');
  });

  it('retries email without repeating successful Stripe cleanup', async () => {
    const state = {
      user_id: 'user-2',
      database_deleted_at: '2026-09-22T12:00:00Z',
      stripe_customer_id: 'cus_once',
      stripe_completed_at: null as string | null,
      completion_email: 'retry@example.test',
      email_completed_at: null as string | null,
      completed_at: null as string | null,
      initiation_kind: 'immediate',
      workflow_state: 'database_deleted',
    };
    let emailAttempts = 0;
    let stripeAttempts = 0;
    const events: string[] = [];
    const dependencies = {
      deleteStripeCustomer: async () => { stripeAttempts += 1; events.push('stripe'); },
      sendCompletionEmail: async () => {
        emailAttempts += 1;
        events.push(`email:${emailAttempts}`);
        if (emailAttempts === 1) throw new Error('temporary email failure');
      },
      recordStep: async (step: 'stripe' | 'email' | 'complete') => {
        events.push(`record:${step}`);
        if (step === 'stripe') {
          state.stripe_completed_at = 'done';
          state.stripe_customer_id = null;
        }
        if (step === 'email') {
          state.email_completed_at = 'done';
          state.completion_email = null;
        }
        if (step === 'complete') state.completed_at = 'done';
      },
    };

    await assert.rejects(processExternalDeletionSteps(state, dependencies), /temporary email failure/);
    assert.equal(state.stripe_completed_at, 'done');
    assert.equal(state.completed_at, null);
    await processExternalDeletionSteps(state, dependencies);

    assert.equal(stripeAttempts, 1);
    assert.deepEqual(events, [
      'stripe',
      'record:stripe',
      'email:1',
      'email:2',
      'record:email',
      'record:complete',
    ]);
  });
});
