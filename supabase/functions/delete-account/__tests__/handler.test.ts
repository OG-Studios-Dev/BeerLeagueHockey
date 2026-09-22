import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  createDeleteAccountHandler,
  extractOwnedProfileImageObjects,
} from '../handler.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function lifecycleBackend(options: {
  profile?: { avatar_url: string | null; photo_url: string | null } | null;
  profileError?: { message: string } | null;
  organizationCount?: number;
  remove?: (bucket: string, paths: string[]) => Promise<{ error: unknown }>;
} = {}) {
  return {
    from: (table: string) => ({
      select: (columns: string, selectOptions?: unknown) => ({
        eq: (column: string, userId: string) => table === 'organizations'
          ? Promise.resolve({ data: null, error: null, count: options.organizationCount ?? 0 })
          : ({
          maybeSingle: async () => {
            assert.equal(table, 'profiles');
            assert.equal(columns, 'avatar_url, photo_url');
            assert.equal(selectOptions, undefined);
            assert.equal(column, 'id');
            assert.ok(userId);
            return {
              data: options.profile ?? { avatar_url: null, photo_url: null },
              error: options.profileError ?? null,
            };
          },
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => options.remove?.(bucket, paths) ?? Promise.resolve({ error: null }),
      }),
    },
  };
}

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
      ...lifecycleBackend(),
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
      ...lifecycleBackend(),
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
      ...lifecycleBackend(),
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
      ...lifecycleBackend(),
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
      ...lifecycleBackend(),
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
      ...lifecycleBackend(),
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

describe('delete-account profile image ownership', () => {
  it('extracts only repository-proven buckets and caller-owned paths', () => {
    assert.deepEqual(extractOwnedProfileImageObjects(USER_ID, {
      avatar_url: `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/avatar.jpg?t=1`,
      photo_url: `https://project.supabase.co/storage/v1/object/public/player-photos/${USER_ID}/1700000000000.webp`,
    }), [
      { bucket: 'avatars', path: `${USER_ID}/avatar.jpg` },
      { bucket: 'player-photos', path: `${USER_ID}/1700000000000.webp` },
    ]);

    assert.deepEqual(extractOwnedProfileImageObjects(USER_ID, {
      avatar_url: `https://project.supabase.co/storage/v1/object/public/player-avatars/${USER_ID}-1700000000000.png`,
      photo_url: null,
    }), [
      { bucket: 'player-avatars', path: `${USER_ID}-1700000000000.png` },
    ]);
  });

  it('rejects arbitrary buckets, foreign identities, and encoded traversal', () => {
    for (const url of [
      `https://project.supabase.co/storage/v1/object/public/team-logos/${USER_ID}/avatar.jpg`,
      'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg',
      `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/%2e%2e/private.jpg`,
      `https://project.supabase.co/storage/v1/object/public/player-avatars/${USER_ID}-other-user.png`,
      'not a URL',
    ]) {
      assert.deepEqual(extractOwnedProfileImageObjects(USER_ID, {
        avatar_url: url,
        photo_url: null,
      }), [], url);
    }
  });

  it('deletes allowlisted stored objects before database and auth deletion', async () => {
    const events: string[] = [];
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({
        profile: {
          avatar_url: `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/avatar.jpg`,
          photo_url: `https://project.supabase.co/storage/v1/object/public/player-photos/${USER_ID}/1700000000000.jpg`,
        },
        remove: async (bucket, paths) => {
          events.push(`remove:${bucket}:${paths.join(',')}`);
          return { error: null };
        },
      }),
      auth: {
        getUser: async () => ({
          data: { user: { id: USER_ID, app_metadata: { providers: ['email'] }, identities: [] } },
          error: null,
        }),
      },
      rpc: async () => {
        events.push('rpc');
        return { data: { success: true }, error: null };
      },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer verified-user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(events, [
      `remove:avatars:${USER_ID}/avatar.jpg`,
      `remove:player-photos:${USER_ID}/1700000000000.jpg`,
      'rpc',
    ]);
  });

  it('continues for absent images and explicit already-missing storage objects', async () => {
    for (const fixture of [
      { profile: { avatar_url: null, photo_url: null }, remove: undefined },
      {
        profile: {
          avatar_url: `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/avatar.jpg`,
          photo_url: null,
        },
        remove: async () => ({ error: { statusCode: '404', message: 'missing' } }),
      },
    ]) {
      let rpcCalls = 0;
      const handler = createDeleteAccountHandler(() => ({
        ...lifecycleBackend(fixture),
        auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
        rpc: async () => { rpcCalls += 1; return { data: { success: true }, error: null }; },
      }));
      const response = await handler(new Request('https://example.test/delete-account', {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      }));
      assert.equal(response.status, 200);
      assert.equal(rpcCalls, 1);
    }
  });

  it('stops before auth deletion when a proven object cannot be removed', async () => {
    let rpcCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({
        profile: {
          avatar_url: `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/avatar.jpg`,
          photo_url: null,
        },
        remove: async () => ({ error: { statusCode: '500', message: 'private storage detail' } }),
      }),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async () => { rpcCalls += 1; return { data: { success: true }, error: null }; },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to remove your profile image. Your account was not deleted.',
      code: 'image_cleanup_failed',
    });
    assert.equal(rpcCalls, 0);
  });

  it('does not remove an image when organization ownership blocks deletion', async () => {
    let lifecycleCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({
        organizationCount: 1,
        profile: {
          avatar_url: `https://project.supabase.co/storage/v1/object/public/avatars/${USER_ID}/avatar.jpg`,
          photo_url: null,
        },
        remove: async () => { lifecycleCalls += 1; return { error: null }; },
      }),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async () => { lifecycleCalls += 1; return { data: null, error: null }; },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Transfer ownership of every organization you own, then try again.',
      code: 'organization_ownership',
    });
    assert.equal(lifecycleCalls, 0);
  });
});

describe('delete-account Apple revocation guard', () => {
  it('blocks Apple-linked deletion before mutation when no revocable Apple grant is stored', async () => {
    let lifecycleCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({ remove: async () => { lifecycleCalls += 1; return { error: null }; } }),
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: USER_ID,
              app_metadata: { provider: 'apple', providers: ['email', 'apple'] },
              identities: [{ provider: 'apple' }],
            },
          },
          error: null,
        }),
      },
      rpc: async () => { lifecycleCalls += 1; return { data: null, error: null }; },
    }));

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Apple sign-in access must be revoked before this account can be deleted. Contact support to complete deletion.',
      code: 'apple_revocation_unavailable',
    });
    assert.equal(lifecycleCalls, 0);
  });
});
