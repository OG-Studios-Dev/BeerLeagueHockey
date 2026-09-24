import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type Invocation = { name: string; options: { body: unknown } };

type AccountDeletionModule = {
  deleteCurrentAccount: (
    client?: unknown,
    revoke?: (options?: { notificationDestinationAlreadyRevoked?: boolean }) => Promise<{ error: Error | null }>,
  ) => Promise<{ error: Error | null; localCleanupError?: Error }>;
};

function loadAccountDeletion(
  authorize: () => Promise<{ authorizationCode: string | null; error: Error | null }> = async () => ({
    authorizationCode: 'fresh-delete-code',
    error: null,
  }),
) {
  return compileCommonJs<AccountDeletionModule>(
    new URL('../../src/lib/supabase/accountDeletion.ts', import.meta.url),
    {
    '../notifications': { unregisterPushNotifications: async () => ({ error: null }) },
    './client': { supabase: {} },
      './auth': { getAppleDeletionAuthorizationCode: authorize },
    },
  ).deleteCurrentAccount;
}

const deleteCurrentAccount = loadAccountDeletion();

function clientReturning(result: { data: unknown; error: unknown }, invocations: Invocation[]) {
  return {
    functions: {
      invoke: async (name: string, options: { body: unknown }) => {
        invocations.push({ name, options });
        return result;
      },
    },
  };
}

describe('mobile account-deletion client', () => {
  it('performs non-Apple deletion before local notification cleanup', async () => {
    const invocations: Invocation[] = [];
    const lifecycle: string[] = [];
    let call = 0;
    const result = await deleteCurrentAccount(
      {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            lifecycle.push('invoke');
            invocations.push({ name, options });
            call += 1;
            return {
              data: call === 1 ? { success: true, preflight: true } : { success: true },
              error: null,
            };
          },
        },
      },
      async (options) => {
        lifecycle.push(`cleanup:${JSON.stringify(options)}`);
        return { error: null };
      },
    );

    assert.deepEqual(result, { error: null });
    assert.deepEqual(invocations, [{
      name: 'delete-account',
      options: { body: { confirmation: 'DELETE', preflightOnly: true } },
    }, {
      name: 'delete-account',
      options: { body: { confirmation: 'DELETE' } },
    }]);
    assert.equal(JSON.stringify(invocations).includes('userId'), false);
    assert.deepEqual(lifecycle, [
      'invoke',
      'invoke',
      'cleanup:{"notificationDestinationAlreadyRevoked":true}',
    ]);
  });

  it('leaves notification state unchanged when the backend deletion fails', async () => {
    const invocations: Invocation[] = [];
    let cleanupCalls = 0;
    const result = await deleteCurrentAccount(
      clientReturning({ data: null, error: { message: 'database unavailable' } }, invocations),
      async () => { cleanupCalls += 1; return { error: null }; },
    );

    assert.equal(result.error?.message, 'database unavailable');
    assert.equal(cleanupCalls, 0);
    assert.equal(invocations.length, 1);
  });

  it('leaves notification state unchanged when the Apple sheet is cancelled', async () => {
    const cancellation = new Error('The Apple authorization request was cancelled.');
    const cancelDeletion = loadAccountDeletion(async () => ({ authorizationCode: null, error: cancellation }));
    const invocations: Invocation[] = [];
    let cleanupCalls = 0;
    const context = new Response(JSON.stringify({
      error: 'Sign in with Apple again to authorize account deletion.',
      code: 'apple_reauthentication_required',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });

    const result = await cancelDeletion(
      clientReturning({ data: null, error: { message: 'non-2xx', context } }, invocations),
      async () => { cleanupCalls += 1; return { error: null }; },
    );

    assert.equal(result.error, cancellation);
    assert.equal(cleanupCalls, 0);
    assert.equal(invocations.length, 1);
  });

  it('leaves notification state unchanged when Apple authorization verification fails', async () => {
    const invocations: Invocation[] = [];
    let cleanupCalls = 0;
    let call = 0;
    const result = await deleteCurrentAccount({
      functions: {
        invoke: async (name: string, options: { body: unknown }) => {
          invocations.push({ name, options });
          call += 1;
          const payload = call === 1
            ? { error: 'Sign in with Apple again.', code: 'apple_reauthentication_required' }
            : { error: 'Unable to verify Sign in with Apple access.', code: 'apple_identity_verification_failed' };
          return {
            data: null,
            error: {
              message: 'non-2xx',
              context: new Response(JSON.stringify(payload), {
                status: call === 1 ? 409 : 502,
                headers: { 'Content-Type': 'application/json' },
              }),
            },
          };
        },
      },
    }, async () => { cleanupCalls += 1; return { error: null }; });

    assert.equal(result.error?.message, 'Unable to verify Sign in with Apple access.');
    assert.equal(cleanupCalls, 0);
    assert.equal(invocations.length, 2);
  });

  it('uses server-derived Apple identity truth, then cleans locally only after Apple deletion succeeds', async () => {
    const invocations: Invocation[] = [];
    const lifecycle: string[] = [];
    let call = 0;
    const result = await deleteCurrentAccount(
      {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            lifecycle.push(`invoke:${call + 1}`);
            invocations.push({ name, options });
            call += 1;
            if (call === 1) {
              const context = new Response(JSON.stringify({
                error: 'Sign in with Apple again to authorize account deletion.',
                code: 'apple_reauthentication_required',
              }), { status: 409, headers: { 'Content-Type': 'application/json' } });
              return { data: null, error: { message: 'non-2xx', context } };
            }
            return { data: { success: true }, error: null };
          },
        },
      },
      async (options) => {
        lifecycle.push(`cleanup:${JSON.stringify(options)}`);
        return { error: null };
      },
    );

    assert.deepEqual(result, { error: null });
    assert.deepEqual(invocations, [
      {
        name: 'delete-account',
        options: { body: { confirmation: 'DELETE', preflightOnly: true } },
      },
      {
        name: 'delete-account',
        options: {
          body: {
            confirmation: 'DELETE',
            appleAuthorizationCode: 'fresh-delete-code',
          },
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(invocations), /refresh|clientSecret|identityToken/i);
    assert.deepEqual(lifecycle, [
      'invoke:1',
      'invoke:2',
      'cleanup:{"notificationDestinationAlreadyRevoked":true}',
    ]);
  });

  it('reports local cleanup separately after irreversible server deletion succeeds', async () => {
    const invocations: Invocation[] = [];
    const cleanupError = new Error('Unable to clear reminders on this device');
    let call = 0;
    const result = await deleteCurrentAccount(
      {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            invocations.push({ name, options });
            call += 1;
            return {
              data: call === 1 ? { success: true, preflight: true } : { success: true },
              error: null,
            };
          },
        },
      },
      async (options) => {
        assert.deepEqual(options, { notificationDestinationAlreadyRevoked: true });
        return { error: cleanupError };
      },
    );

    assert.equal(result.error, null);
    assert.equal(result.localCleanupError, cleanupError);
    assert.equal(invocations.length, 2);
  });

  it('returns the backend organization-ownership guidance from a failed function response', async () => {
    const invocations: Invocation[] = [];
    const context = new Response(JSON.stringify({
      error: 'Transfer ownership of every organization you own, then try again.',
      code: 'organization_ownership',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });

    const result = await deleteCurrentAccount(clientReturning({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context },
    }, invocations));

    assert.equal(result.error?.message, 'Transfer ownership of every organization you own, then try again.');
  });

  it('uses a safe fallback when the function error has no readable response body', async () => {
    const invocations: Invocation[] = [];
    const result = await deleteCurrentAccount(clientReturning({
      data: null,
      error: { message: 'network unavailable' },
    }, invocations));

    assert.equal(result.error?.message, 'network unavailable');
  });
});
