import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_RESEND_FROM_EMAIL,
  sendAccountDeletionCompletionEmail,
} from '../email.ts';

const USER_ID = '72d37220-497b-422e-ba6c-2cd1de56a697';

describe('account deletion completion email', () => {
  it('uses the verified-domain default and preserves the stable idempotency key', async () => {
    let captured: RequestInit | undefined;
    await sendAccountDeletionCompletionEmail({
      apiKey: 'test-api-key',
      fetchImpl: async (_input, init) => {
        captured = init;
        return new Response(null, { status: 202 });
      },
    }, USER_ID, 'retained@example.test');

    assert.equal(DEFAULT_RESEND_FROM_EMAIL, 'HockeyLife <noreply@beerleaguehockey.ca>');
    assert.equal(new Headers(captured?.headers).get('Idempotency-Key'), `account-deletion-${USER_ID}`);
    assert.deepEqual(JSON.parse(String(captured?.body)), {
      from: DEFAULT_RESEND_FROM_EMAIL,
      to: 'retained@example.test',
      subject: 'Your account deletion is complete',
      html: '<p>Your sign-in and active account data were deleted. Historical hockey facts and legally required payment and signed-waiver records are retained as described in our privacy notice.</p>',
    });
  });

  it('honors RESEND_FROM_EMAIL input without changing the idempotency key', async () => {
    let captured: RequestInit | undefined;
    await sendAccountDeletionCompletionEmail({
      apiKey: 'test-api-key',
      fromEmail: 'HockeyLife Ops <deletions@beerleaguehockey.ca>',
      fetchImpl: async (_input, init) => {
        captured = init;
        return new Response(null, { status: 202 });
      },
    }, USER_ID, 'retained@example.test');

    assert.equal(JSON.parse(String(captured?.body)).from, 'HockeyLife Ops <deletions@beerleaguehockey.ca>');
    assert.equal(new Headers(captured?.headers).get('Idempotency-Key'), `account-deletion-${USER_ID}`);
  });
});
