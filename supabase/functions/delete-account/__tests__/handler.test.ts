import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  createDeleteAccountHandler,
  extractOwnedProfileImageObjects,
  listOwnedProfileImageObjects,
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
        list: async () => ({ data: [], error: null }),
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
      name: 'prepare_account_deletion',
      args: { p_user_id: 'authenticated-user' },
    }, {
      name: 'mark_account_storage_deleted',
      args: { p_user_id: 'authenticated-user' },
    }, {
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

  it('rejects provider metadata, refresh tokens, and client secrets from the client', async () => {
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
      body: JSON.stringify({
        confirmation: 'DELETE',
        refreshToken: 'must-not-be-accepted',
        clientSecret: 'must-not-be-accepted',
        appleLinked: true,
      }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Provider metadata and credentials are not accepted from the client.',
      code: 'unsupported_provider_credentials',
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

  it('returns actionable guidance when league ownership blocks deletion', async () => {
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend(),
      auth: {
        getUser: async () => ({ data: { user: { id: 'league-owner' } }, error: null }),
      },
      rpc: async () => ({
        data: null,
        error: { message: 'Cannot delete account: transfer league ownership first.' },
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
      error: 'Transfer ownership of every league you own, then try again.',
      code: 'league_ownership',
    });
  });

  it('sanitizes generic deletion errors returned by the backend', async () => {
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend(),
      auth: {
        getUser: async () => ({ data: { user: { id: 'authenticated-user' } }, error: null }),
      },
      rpc: async (name: string) => name === 'execute_account_deletion'
        ? { data: null, error: { message: 'relation private_accounts failed with password=database-secret' } }
        : { data: { success: true }, error: null },
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
    assert.match(source, /createAppleAuthorizationService/);
    for (const secretName of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY_P8']) {
      assert.match(source, new RegExp(`Deno\\.env\\.get\\('${secretName}'\\)`));
    }
    assert.match(source, /Deno\.serve\(deleteAccountHandler\)/);
    assert.doesNotMatch(source, /EXPO_PUBLIC_/);
    assert.match(config, /\[functions\.delete-account\][\s\S]*?verify_jwt\s*=\s*true/);
  });
});

describe('delete-account profile image ownership', () => {
  it('lists every owned allowlisted object across bounded pages, including orphans', async () => {
    const calls: Array<{ bucket: string; prefix: string; options: unknown }> = [];
    const objects = await listOwnedProfileImageObjects(USER_ID, {
      from: (bucket: string) => ({
        list: async (prefix: string, options: { limit: number; offset: number; search?: string }) => {
          calls.push({ bucket, prefix, options });
          if (bucket === 'avatars') {
            return options.offset === 0
              ? { data: Array.from({ length: 100 }, (_, index) => ({ name: index === 0 ? 'avatar.webp' : `ignore-${index}` })), error: null }
              : { data: [{ name: 'avatar.png' }], error: null };
          }
          if (bucket === 'player-photos') {
            return { data: [{ name: '1700000000000.jpeg' }, { name: '../foreign.png' }], error: null };
          }
          return {
            data: [
              { name: `${USER_ID}-1700000000000.jpg` },
              { name: '22222222-2222-4222-8222-222222222222-1700000000000.jpg' },
            ],
            error: null,
          };
        },
        remove: async () => ({ error: null }),
      }),
    });

    assert.deepEqual(objects, [
      { bucket: 'avatars', path: `${USER_ID}/avatar.webp` },
      { bucket: 'avatars', path: `${USER_ID}/avatar.png` },
      { bucket: 'player-photos', path: `${USER_ID}/1700000000000.jpeg` },
      { bucket: 'player-avatars', path: `${USER_ID}-1700000000000.jpg` },
    ]);
    assert.equal(calls.filter(({ bucket }) => bucket === 'avatars').length, 2);
    assert.deepEqual(calls.find(({ bucket }) => bucket === 'player-avatars'), {
      bucket: 'player-avatars',
      prefix: '',
      options: { limit: 100, offset: 0, search: `${USER_ID}-` },
    });
  });

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
      'rpc',
      `remove:avatars:${USER_ID}/avatar.jpg`,
      `remove:player-photos:${USER_ID}/1700000000000.jpg`,
      'rpc',
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
      assert.equal(rpcCalls, 3);
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
    assert.equal(rpcCalls, 1);
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
      rpc: async (name: string) => {
        if (name !== 'prepare_account_deletion') lifecycleCalls += 1;
        return { data: { success: true }, error: null };
      },
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
  const grant = {
    subject: 'server-derived-apple-subject',
    revocationToken: 'server-only-revocation-token',
    tokenTypeHint: 'refresh_token' as const,
  };

  it('binds, stages, and revokes a fresh Apple grant before destructive work', async () => {
    const events: string[] = [];
    const handler = createDeleteAccountHandler(
      () => ({
        ...lifecycleBackend(),
        auth: {
          getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          events.push(`rpc:${name}`);
          if (name === 'prepare_account_deletion') {
            return {
              data: {
                apple_required: true,
                apple_revoked: false,
                apple_subject: grant.subject,
                apple_retry_ready: false,
              },
              error: null,
            };
          }
          if (name === 'stage_account_apple_revocation') {
            assert.deepEqual(args, {
              p_user_id: USER_ID,
              p_apple_subject: grant.subject,
              p_revocation_token: grant.revocationToken,
              p_token_type_hint: grant.tokenTypeHint,
            });
          }
          return { data: { success: true }, error: null };
        },
      }),
      {
        appleAuthorization: {
          exchangeAuthorizationCode: async (code, expectedSubject) => {
            events.push(`apple-exchange:${code}:${expectedSubject}`);
            return grant;
          },
          revokeToken: async (receivedGrant) => {
            assert.deepEqual(receivedGrant, grant);
            events.push('apple-revoke');
          },
        },
      },
    );

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-one-time-code' }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(events, [
      'rpc:prepare_account_deletion',
      `apple-exchange:fresh-one-time-code:${grant.subject}`,
      'rpc:stage_account_apple_revocation',
      'apple-revoke',
      'rpc:mark_account_apple_revoked',
      'rpc:mark_account_storage_deleted',
      'rpc:execute_account_deletion',
    ]);
  });

  it('blocks Apple-linked deletion before mutation when no revocable Apple grant is stored', async () => {
    let lifecycleCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({ remove: async () => { lifecycleCalls += 1; return { error: null }; } }),
      auth: {
        getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
      },
      rpc: async (name: string) => {
        if (name !== 'prepare_account_deletion') lifecycleCalls += 1;
        return {
          data: name === 'prepare_account_deletion'
            ? { apple_required: true, apple_revoked: false, apple_subject: grant.subject, apple_retry_ready: false }
            : null,
          error: null,
        };
      },
    }), { appleAuthorization: { exchangeAuthorizationCode: async () => grant, revokeToken: async () => {} } });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Sign in with Apple again to authorize account deletion.',
      code: 'apple_reauthentication_required',
    });
    assert.equal(lifecycleCalls, 0);
  });

  it('retries revocation from durable server state without another client code', async () => {
    let providerCalls = 0;
    const rpcNames: string[] = [];
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend(),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async (name: string) => {
        rpcNames.push(name);
        if (name === 'get_account_apple_revocation_retry') {
          return {
            data: {
              apple_subject: grant.subject,
              revocation_token: grant.revocationToken,
              token_type_hint: grant.tokenTypeHint,
            },
            error: null,
          };
        }
        return {
          data: name === 'prepare_account_deletion'
            ? { apple_required: true, apple_revoked: false, apple_subject: grant.subject, apple_retry_ready: true }
            : { success: true },
          error: null,
        };
      },
    }), {
      appleAuthorization: {
        exchangeAuthorizationCode: async () => { throw new Error('must use durable retry'); },
        revokeToken: async () => { providerCalls += 1; },
      },
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    assert.equal(response.status, 200);
    assert.equal(providerCalls, 1);
    assert.match(rpcNames.join(','), /get_account_apple_revocation_retry/);
    assert.match(rpcNames.join(','), /mark_account_apple_revoked/);
    assert.match(rpcNames.join(','), /execute_account_deletion/);
  });

  it('stages retry state before a provider failure and stops before other mutation', async () => {
    let destructiveCalls = 0;
    const events: string[] = [];
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend({ remove: async () => { destructiveCalls += 1; return { error: null }; } }),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async (name: string) => {
        events.push(name);
        if (!['prepare_account_deletion', 'stage_account_apple_revocation'].includes(name)) destructiveCalls += 1;
        return {
          data: name === 'prepare_account_deletion'
            ? { apple_required: true, apple_revoked: false, apple_subject: grant.subject, apple_retry_ready: false }
            : null,
          error: null,
        };
      },
    }), {
      appleAuthorization: {
        exchangeAuthorizationCode: async () => grant,
        revokeToken: async () => { throw new Error('provider detail'); },
      },
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE', appleAuthorizationCode: 'rejected-code' }),
    }));

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Unable to revoke Sign in with Apple access. Your account was not deleted.',
      code: 'apple_revocation_failed',
    });
    assert.equal(destructiveCalls, 0);
    assert.deepEqual(events, ['prepare_account_deletion', 'stage_account_apple_revocation']);
  });

  it('does not revoke when staging the provider retry token fails', async () => {
    let revokeCalls = 0;
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend(),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async (name: string) => name === 'prepare_account_deletion'
        ? {
            data: { apple_required: true, apple_revoked: false, apple_subject: grant.subject, apple_retry_ready: false },
            error: null,
          }
        : name === 'stage_account_apple_revocation'
          ? { data: null, error: { message: 'secret database detail' } }
          : { data: null, error: null },
    }), {
      appleAuthorization: {
        exchangeAuthorizationCode: async () => grant,
        revokeToken: async () => { revokeCalls += 1; },
      },
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-code' }),
    }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to save Sign in with Apple revocation for retry. Your account was not deleted.',
      code: 'apple_revocation_stage_failed',
    });
    assert.equal(revokeCalls, 0);
  });

  it('keeps the staged token retryable when the durable revoked marker fails', async () => {
    const events: string[] = [];
    const handler = createDeleteAccountHandler(() => ({
      ...lifecycleBackend(),
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      rpc: async (name: string) => {
        events.push(name);
        if (name === 'prepare_account_deletion') {
          return {
            data: { apple_required: true, apple_revoked: false, apple_subject: grant.subject, apple_retry_ready: false },
            error: null,
          };
        }
        if (name === 'mark_account_apple_revoked') {
          return { data: null, error: { message: 'database failure' } };
        }
        return { data: { success: true }, error: null };
      },
    }), {
      appleAuthorization: {
        exchangeAuthorizationCode: async () => grant,
        revokeToken: async () => { events.push('apple-provider-revoked'); },
      },
    });

    const response = await handler(new Request('https://example.test/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-code' }),
    }));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Apple access was revoked, but deletion could not be recorded. Try again.',
      code: 'apple_revocation_marker_failed',
    });
    assert.ok(events.indexOf('stage_account_apple_revocation') < events.indexOf('apple-provider-revoked'));
    assert.doesNotMatch(events.join(','), /execute_account_deletion/);
  });
});
