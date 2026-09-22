import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness } from './component-harness.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type AuthValue = {
  session: any;
  user: any;
  isLoading: boolean;
  isGuest: boolean;
  signOut: (options?: { pushTokenAlreadyCleared?: boolean }) => Promise<{ error: Error | null }>;
};

function createAuthFixture(options: {
  getSession?: () => Promise<any>;
  getUser?: () => Promise<{
    data: { user: { id: string } | null };
    error: Error | null;
  }>;
  signOut?: (...args: any[]) => Promise<any>;
  clearPushToken?: (userId: string) => Promise<{ error: { message: string } | null }>;
  clearPushDestination?: (args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  purgeStoredSession?: () => Promise<void>;
} = {}) {
  const harness = createHookHarness();
  let authListener: ((event: string, session: any) => void) | undefined;
  let providerValue: AuthValue | undefined;
  const context = {
    Provider: ({ value }: { value: AuthValue }) => {
      providerValue = value;
      return null;
    },
  };
  const react = { ...harness.react, createContext: () => context };
  const supabase = {
    auth: {
      getSession: options.getSession ?? (async () => ({ data: { session: null } })),
      getUser: options.getUser ?? (async () => ({ data: { user: { id: providerValue?.user?.id } }, error: null })),
      onAuthStateChange: (listener: typeof authListener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: options.signOut ?? (async () => ({ error: null })),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ error: null }),
    },
    rpc: (name: string, args: unknown) => {
      assert.equal(name, 'clear_current_push_destination');
      return options.clearPushDestination?.(args) ?? Promise.resolve({ data: true, error: null });
    },
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: async (column: string, userId: string) => {
          assert.equal(table, 'profiles');
          assert.deepEqual(values, { push_token: null });
          assert.equal(column, 'id');
          return options.clearPushToken?.(userId) ?? { error: null };
        },
      }),
    }),
  };
  const exports = compileCommonJs<{ AuthProvider: (props: { children: null }) => unknown }>(
    new URL('../../src/context/AuthContext.tsx', import.meta.url),
    {
      react,
      '../lib/supabase/auth': { signInWithOAuth: async () => ({ error: null }) },
      '../lib/supabase/client': {
        supabase,
        purgeStoredSession: options.purgeStoredSession ?? (async () => undefined),
      },
    },
  );

  harness.mount(() => exports.AuthProvider({ children: null }));

  return {
    emit(event: string, session: any) {
      assert.ok(authListener, 'auth listener should be registered');
      authListener(event, session);
      harness.render();
    },
    async settle() {
      await flush();
      harness.render();
      await flush();
      harness.render();
    },
    get value() {
      assert.ok(providerValue);
      return providerValue;
    },
    unmount: () => harness.unmount(),
  };
}

describe('AuthProvider bootstrap freshness', () => {
  it('ignores an older null bootstrap after a newer SIGNED_IN event', async () => {
    const bootstrap = deferred<any>();
    const fixture = createAuthFixture({ getSession: () => bootstrap.promise });
    const sessionB = { user: { id: 'account-b' } };

    fixture.emit('SIGNED_IN', sessionB);
    bootstrap.resolve({ data: { session: null } });
    await fixture.settle();

    assert.equal(fixture.value.session, sessionB);
    assert.equal(fixture.value.user, sessionB.user);
    assert.equal(fixture.value.isLoading, false);
  });

  it('ignores an older non-null bootstrap after a newer SIGNED_OUT event', async () => {
    const bootstrap = deferred<any>();
    const fixture = createAuthFixture({ getSession: () => bootstrap.promise });

    fixture.emit('SIGNED_OUT', null);
    bootstrap.resolve({ data: { session: { user: { id: 'account-a' } } } });
    await fixture.settle();

    assert.equal(fixture.value.session, null);
    assert.equal(fixture.value.user, null);
    assert.equal(fixture.value.isLoading, false);
  });

  it('ends loading when the current bootstrap rejects', async () => {
    const bootstrap = deferred<any>();
    const fixture = createAuthFixture({ getSession: () => bootstrap.promise });

    bootstrap.reject(new Error('session storage unavailable'));
    await fixture.settle();

    assert.equal(fixture.value.session, null);
    assert.equal(fixture.value.isLoading, false);
  });
});

describe('AuthProvider signOut', () => {
  it('refuses logout when there is no current session to authenticate token cleanup', async () => {
    let localSignOuts = 0;
    const fixture = createAuthFixture({
      signOut: async () => {
        localSignOuts += 1;
        return { error: null };
      },
    });
    await fixture.settle();

    const result = await fixture.value.signOut();

    assert.equal(result.error?.message, 'Your session is missing or stale. Sign in again before logging out.');
    assert.equal(localSignOuts, 0);
  });

  it('clears the authenticated push destination before ending the local session', async () => {
    const calls: string[] = [];
    const fixture = createAuthFixture({
      clearPushDestination: async () => {
        calls.push('clear');
        return { data: true, error: null };
      },
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    assert.deepEqual(await fixture.value.signOut(), { error: null });
    assert.deepEqual(calls, ['clear', 'signOut']);
  });

  it('uses an authenticated exact-one RPC without sending a client-selected user id', async () => {
    const rpcArgs: unknown[] = [];
    const calls: string[] = [];
    const fixture = createAuthFixture({
      getUser: async () => ({ data: { user: { id: 'account-a' } }, error: null }),
      clearPushDestination: async (args) => {
        rpcArgs.push(args);
        calls.push('rpc');
        return { data: true, error: null };
      },
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    assert.deepEqual(await fixture.value.signOut(), { error: null });
    assert.deepEqual(rpcArgs, [{}]);
    assert.deepEqual(calls, ['rpc', 'signOut']);
  });

  it('keeps the session active and returns safe feedback when push-token cleanup fails', async () => {
    let signOutCalls = 0;
    const fixture = createAuthFixture({
      clearPushDestination: async () => ({ data: null, error: { message: 'private schema detail' } }),
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    const result = await fixture.value.signOut();

    assert.equal(
      result.error?.message,
      'Unable to turn off notifications for this account. Check your connection and try logging out again.',
    );
    assert.equal(result.error?.message.includes('private schema detail'), false);
    assert.equal(signOutCalls, 0);
    assert.equal(fixture.value.user?.id, 'account-a');
  });

  it('skips the redundant profile write after verified server-side account deletion', async () => {
    let pushTokenClears = 0;
    let localSignOuts = 0;
    const fixture = createAuthFixture({
      clearPushDestination: async () => {
        pushTokenClears += 1;
        return { data: true, error: null };
      },
      signOut: async () => {
        localSignOuts += 1;
        return { error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'deleted-account' } });

    assert.deepEqual(
      await fixture.value.signOut({ pushTokenAlreadyCleared: true }),
      { error: null },
    );
    assert.equal(pushTokenClears, 0);
    assert.equal(localSignOuts, 1);
  });

  it('purges local credentials and state when post-deletion sign-out fails', async () => {
    let purges = 0;
    const fixture = createAuthFixture({
      signOut: async () => ({ error: { message: 'local sign-out failed' } }),
      purgeStoredSession: async () => { purges += 1; },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'deleted-account' } });

    const result = await fixture.value.signOut({ pushTokenAlreadyCleared: true });
    await fixture.settle();

    assert.equal(result.error?.message, 'local sign-out failed');
    assert.equal(purges, 1);
    assert.equal(fixture.value.session, null);
  });

  it('signs out only this device and closes guest mode after success', async () => {
    const calls: unknown[] = [];
    const fixture = createAuthFixture({
      signOut: async (options: unknown) => {
        calls.push(options);
        return { error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    assert.deepEqual(await fixture.value.signOut(), { error: null });
    fixture.unmount();
    assert.deepEqual(calls, [{ scope: 'local' }]);
  });

  it('does not force session or guest state closed when Supabase returns an error', async () => {
    const fixture = createAuthFixture({
      signOut: async () => ({ error: { message: 'Session could not be cleared' } }),
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'Session could not be cleared');
    assert.equal(fixture.value.user?.id, 'account-a');
  });

  it('turns a rejected sign-out promise into a handled error result', async () => {
    const fixture = createAuthFixture({
      signOut: async () => { throw new Error('Secure storage unavailable'); },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'Secure storage unavailable');
  });

  it('fails closed for zero-row cleanup and RLS denial', async () => {
    for (const result of [
      { data: false, error: null },
      { data: null, error: { message: 'RLS denied' } },
    ]) {
      let signOutCalls = 0;
      const fixture = createAuthFixture({
        clearPushDestination: async () => result,
        signOut: async () => {
          signOutCalls += 1;
          return { error: null };
        },
      });
      fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

      const logout = await fixture.value.signOut();
      assert.equal(logout.error?.message, 'Unable to turn off notifications for this account. Check your connection and try logging out again.');
      assert.equal(signOutCalls, 0);
    }
  });

  it('rejects a stale account-switch session before cleanup', async () => {
    let rpcCalls = 0;
    const fixture = createAuthFixture({
      getUser: async () => ({ data: { user: { id: 'account-b' } }, error: null }),
      clearPushDestination: async () => {
        rpcCalls += 1;
        return { data: true, error: null };
      },
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'Your session is missing or stale. Sign in again before logging out.');
    assert.equal(rpcCalls, 0);
  });
});
