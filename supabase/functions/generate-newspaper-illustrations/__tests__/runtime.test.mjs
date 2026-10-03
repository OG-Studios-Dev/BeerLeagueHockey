import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ObservableIllustrationError,
  OVERALL_DEADLINE_MS,
  PROVIDER_TIMEOUT_MS,
  illustrationFailureLog,
  publicIllustrationError,
} from '../runtime.ts';

test('provider, request, and lease budgets are finite and ordered below the platform request ceiling', () => {
  const leaseMs = 180_000;
  assert.equal(PROVIDER_TIMEOUT_MS, 120_000);
  assert.equal(OVERALL_DEADLINE_MS, 140_000);
  assert.ok(PROVIDER_TIMEOUT_MS < OVERALL_DEADLINE_MS);
  assert.ok(OVERALL_DEADLINE_MS < 150_000);
  assert.ok(OVERALL_DEADLINE_MS < leaseMs);
});

test('timeouts have a stable public code and an allowlisted diagnostic shape', () => {
  const error = new ObservableIllustrationError('PROVIDER_TIMEOUT', 'provider_timeout');
  const publicFailure = publicIllustrationError(error);
  assert.deepEqual(publicFailure, {
    status: 504,
    code: 'ILLUSTRATION_GENERATION_TIMEOUT',
    message: 'Illustration generation timed out safely. Retry the draft generation.',
  });
  assert.deepEqual(illustrationFailureLog(error, publicFailure.code), {
    event: 'newspaper_illustrations_failed',
    stage: 'provider_timeout',
    failureCode: 'PROVIDER_TIMEOUT',
    status: null,
    requestId: null,
  });
});

test('provider diagnostics retain only bounded status/request ID fields and never raw messages', () => {
  const safe = new ObservableIllustrationError('PROVIDER_REQUEST_FAILED', 'provider_request', 429, 'req_safe-123');
  assert.deepEqual(illustrationFailureLog(safe, 'ILLUSTRATION_GENERATION_FAILED'), {
    event: 'newspaper_illustrations_failed',
    stage: 'provider_request',
    failureCode: 'PROVIDER_REQUEST_FAILED',
    status: 429,
    requestId: 'req_safe-123',
  });

  const unsafe = new ObservableIllustrationError(
    'PROVIDER_REQUEST_FAILED',
    'provider_request',
    999,
    'secret\nraw-provider-message',
  );
  const logged = illustrationFailureLog(unsafe, 'ILLUSTRATION_GENERATION_FAILED');
  assert.equal(logged.status, null);
  assert.equal(logged.requestId, null);
  assert.deepEqual(Object.keys(logged), ['event', 'stage', 'failureCode', 'status', 'requestId']);
  assert.doesNotMatch(JSON.stringify(logged), /secret|raw-provider-message/);
});

test('unknown exceptions collapse to the generic public and log contracts', () => {
  const error = new Error('raw credentials and prompt');
  const publicFailure = publicIllustrationError(error);
  assert.equal(publicFailure.code, 'ILLUSTRATION_GENERATION_FAILED');
  const logged = illustrationFailureLog(error, publicFailure.code);
  assert.equal(logged.failureCode, 'ILLUSTRATION_GENERATION_FAILED');
  assert.equal(logged.stage, 'workflow');
  assert.doesNotMatch(JSON.stringify(logged), /credentials|prompt/);
});
