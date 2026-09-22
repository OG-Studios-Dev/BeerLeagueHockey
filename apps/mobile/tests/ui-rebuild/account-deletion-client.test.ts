import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type Invocation = { name: string; options: { body: unknown } };

type AccountDeletionModule = {
  deleteCurrentAccount: (
    client: unknown,
    revoke?: () => Promise<{ error: Error | null }>,
  ) => Promise<{ error: Error | null }>;
};

const { deleteCurrentAccount } = compileCommonJs<AccountDeletionModule>(
  new URL('../../src/lib/supabase/accountDeletion.ts', import.meta.url),
  {
    '../notifications': { unregisterPushNotifications: async () => ({ error: null }) },
    './client': { supabase: {} },
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
    const lifecycle: string[] = [];
    const result = await deleteCurrentAccount(
      {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            lifecycle.push('invoke');
            invocations.push({ name, options });
            return { data: { success: true }, error: null };
          },
        },
      },
      async () => { lifecycle.push('revoke'); return { error: null }; },
    );

    assert.deepEqual(result, { error: null });
    assert.deepEqual(invocations, [{
      name: 'delete-account',
      options: { body: { confirmation: 'DELETE' } },
    }]);
    assert.equal(JSON.stringify(invocations).includes('userId'), false);
    assert.deepEqual(lifecycle, ['revoke', 'invoke']);
  });

  it('does not delete the account while its notification destination remains usable', async () => {
    const invocations: Invocation[] = [];
    const result = await deleteCurrentAccount(
      clientReturning({ data: { success: true }, error: null }, invocations),
      async () => ({ error: new Error('profile update denied') }),
    );

    assert.equal(result.error?.message, 'profile update denied');
    assert.deepEqual(invocations, []);
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
