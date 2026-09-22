import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { processExternalDeletionSteps } from '../processor.ts';

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
