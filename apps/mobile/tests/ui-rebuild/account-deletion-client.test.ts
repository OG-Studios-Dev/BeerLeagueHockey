import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type Invocation = { name: string; options: { body: unknown } };

type AccountDeletionModule = {
  deleteCurrentAccount: (
    client?: unknown,
  ) => Promise<{ error: Error | null }>;
};

const { deleteCurrentAccount } = compileCommonJs<AccountDeletionModule>(
  new URL('../../src/lib/supabase/accountDeletion.ts', import.meta.url),
  {
    './client': { supabase: {} },
    './auth': {
      getAppleDeletionAuthorizationCode: async () => ({
        authorizationCode: 'fresh-delete-code',
        error: null,
      }),
    },
  },
);

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
  it('invokes the authenticated delete-account function with an explicit confirmation and no user id', async () => {
    const invocations: Invocation[] = [];
    const result = await deleteCurrentAccount(
      clientReturning({ data: { success: true }, error: null }, invocations),
    );

    assert.deepEqual(result, { error: null });
    assert.deepEqual(invocations, [{
      name: 'delete-account',
      options: { body: { confirmation: 'DELETE' } },
    }]);
    assert.equal(JSON.stringify(invocations).includes('userId'), false);
  });

  it('uses server-derived Apple identity truth, then sends only a fresh authorization code', async () => {
    const invocations: Invocation[] = [];
    let call = 0;
    const result = await deleteCurrentAccount(
      {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
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
    );

    assert.deepEqual(result, { error: null });
    assert.deepEqual(invocations, [
      {
        name: 'delete-account',
        options: { body: { confirmation: 'DELETE' } },
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
