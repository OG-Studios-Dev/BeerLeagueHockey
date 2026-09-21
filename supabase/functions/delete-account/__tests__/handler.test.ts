import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createDeleteAccountHandler } from '../handler.ts';

describe('delete-account Edge Function authorization', () => {
  it('allows only POST without creating a privileged client for other methods', async () => {
    let clientFactoryCalls = 0;
    const handler = createDeleteAccountHandler(() => {
      clientFactoryCalls += 1;
      throw new Error('privileged client must not be created');
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'GET',
      headers: { Authorization: 'Bearer verified-user-token' },
    }));

    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: 'Method not allowed.', code: 'method_not_allowed' });
    assert.equal(response.headers.get('Allow'), 'POST');
    assert.equal(clientFactoryCalls, 0);
  });

  it('rejects requests without a bearer token before creating a privileged client', async () => {
    let clientFactoryCalls = 0;
    const handler = createDeleteAccountHandler(() => {
      clientFactoryCalls += 1;
      throw new Error('privileged client must not be created');
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required.', code: 'unauthorized' });
    assert.equal(clientFactoryCalls, 0);
  });

  it('rejects an invalid bearer token without invoking the deletion RPC', async () => {
    let rpcCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: 'invalid token' } }),
      },
      rpc: async () => {
        rpcCalls += 1;
        return { data: { success: true }, error: null };
      },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 401);
    assert.equal(rpcCalls, 0);
  });

  it('validates the bearer token and deletes only the authenticated caller', async () => {
    const validatedTokens: string[] = [];
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async (token: string) => {
          validatedTokens.push(token);
          return { data: { user: { id: 'authenticated-user' } }, error: null };
        },
      },
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return { data: { success: true }, error: null };
      },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE', userId: 'attacker-selected-user' }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(validatedTokens, ['verified-user-token']);
    assert.deepEqual(rpcCalls, [{
      name: 'execute_account_deletion',
      args: { p_user_id: 'authenticated-user' },
    }]);
  });

  it('requires the exact destructive confirmation before invoking the deletion RPC', async () => {
    let rpcCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'authenticated-user' } }, error: null }),
      },
      rpc: async () => {
        rpcCalls += 1;
        return { data: { success: true }, error: null };
      },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'delete' }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Explicit deletion confirmation is required.',
      code: 'confirmation_required',
    });
    assert.equal(rpcCalls, 0);
  });

  it('returns actionable guidance when organization ownership blocks deletion', async () => {
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'org-owner' } }, error: null }),
      },
      rpc: async () => ({
        data: null,
        error: {
          message: 'Cannot delete account: user owns 2 organizations. Transfer ownership first.',
        },
      }),
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Transfer ownership of every organization you own, then try again.',
      code: 'organization_ownership',
    });
  });

  it('sanitizes generic deletion errors returned by the backend', async () => {
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'authenticated-user' } }, error: null }),
      },
      rpc: async () => ({
        data: null,
        error: { message: 'relation private_accounts failed with password=database-secret' },
      }),
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to delete account.',
      code: 'deletion_failed',
    });
  });

  it('does not expose unexpected thrown backend failures', async () => {
    const handler = createDeleteAccountHandler(() => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'authenticated-user' } }, error: null }),
      },
      rpc: async () => {
        throw new Error('internal database topology and secret details');
      },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to delete account.',
      code: 'deletion_failed',
    });
  });

  it('wires the deployed entrypoint to server-only Supabase credentials and requires gateway JWT verification', () => {
    const source = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    const config = readFileSync(fileURLToPath(new URL('../../../config.toml', import.meta.url)), 'utf8');

    assert.match(source, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
    assert.match(source, /createDeleteAccountHandler/);
    assert.match(source, /Deno\.serve\(deleteAccountHandler\)/);
    assert.doesNotMatch(source, /EXPO_PUBLIC_/);
    assert.match(config, /\[functions\.delete-account\][\s\S]*?verify_jwt\s*=\s*true/);
  });
});
