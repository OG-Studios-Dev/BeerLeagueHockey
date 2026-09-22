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
  session: { user: { id: string } } | null;
  user: { id: string } | null;
  isLoading: boolean;
  isGuest: boolean;
  continueAsGuest: () => void;
  exitGuest: () => void;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: (options?: { notificationDestinationAlreadyRevoked?: boolean }) => Promise<{ error: Error | null }>;
};

function createAuthFixture(options: {
  getSession?: () => Promise<any>;
  signOut?: (...args: any[]) => Promise<any>;
  unregister?: () => Promise<{ error: Error | null }>;
} = {}) {
  const harness = createHookHarness();
  let authListener: ((event: string, session: any) => void) | undefined;
  let providerValue: AuthValue | undefined;
  const signUpCalls: unknown[] = [];
  const lifecycleCalls: string[] = [];
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
      onAuthStateChange: (listener: typeof authListener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: options.signOut ?? (async () => ({ error: null })),
      signInWithPassword: async () => ({ error: null }),
      signUp: async (payload: unknown) => { signUpCalls.push(payload); return { error: null }; },
    },
  };
  const exports = compileCommonJs<{ AuthProvider: (props: { children: null }) => unknown }>(
    new URL('../../src/context/AuthContext.tsx', import.meta.url),
    {
      react,
      '../lib/notifications': {
        unregisterPushNotifications: options.unregister ?? (async () => {
          lifecycleCalls.push('unregister');
          return { error: null };
        }),
      },
      '../lib/supabase/auth': { signInWithOAuth: async () => ({ error: null }) },
      '../lib/supabase/client': { supabase },
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
    signUpCalls,
    lifecycleCalls,
    unmount: () => harness.unmount(),
  };
}

describe('AuthProvider bootstrap freshness', () => {
  it('enters and exits guest mode from a fresh signed-out state', async () => {
    const fixture = createAuthFixture();
    await fixture.settle();

    fixture.value.continueAsGuest();
    await fixture.settle();
    assert.equal(fixture.value.isGuest, true);
    assert.equal(fixture.value.session, null);
    assert.equal(fixture.value.user, null);

    fixture.value.exitGuest();
    await fixture.settle();
    assert.equal(fixture.value.isGuest, false);
    assert.equal(fixture.value.session, null);
  });

  it('does not restore stale bootstrap account state after guest entry', async () => {
    const bootstrap = deferred<any>();
    const fixture = createAuthFixture({ getSession: () => bootstrap.promise });

    fixture.value.continueAsGuest();
    bootstrap.resolve({ data: { session: { user: { id: 'stale-account' } } } });
    await fixture.settle();

    assert.equal(fixture.value.isGuest, true);
    assert.equal(fixture.value.session, null);
    assert.equal(fixture.value.user, null);
    assert.equal(fixture.value.isLoading, false);
  });

  it('keeps guest mode when a stale signed-out auth event arrives after entry', async () => {
    const fixture = createAuthFixture();
    await fixture.settle();

    fixture.value.continueAsGuest();
    fixture.emit('INITIAL_SESSION', null);
    await fixture.settle();

    assert.equal(fixture.value.isGuest, true);
    assert.equal(fixture.value.session, null);
  });

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
  it('signs out only this device and closes guest mode after success', async () => {
    const calls: unknown[] = [];
    const fixture = createAuthFixture({
      signOut: async (options: unknown) => {
        calls.push('signOut');
        calls.push(options);
        return { error: null };
      },
    });

    assert.deepEqual(await fixture.value.signOut(), { error: null });
    fixture.unmount();
    assert.deepEqual(fixture.lifecycleCalls, ['unregister']);
    assert.deepEqual(calls, ['signOut', { scope: 'local' }]);
  });

  it('keeps the authenticated session when the push destination cannot be revoked', async () => {
    const signOutCalls: unknown[] = [];
    const fixture = createAuthFixture({
      unregister: async () => ({ error: new Error('profile update denied') }),
      signOut: async (options: unknown) => { signOutCalls.push(options); return { error: null }; },
    });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'profile update denied');
    assert.deepEqual(signOutCalls, []);
  });

  it('finishes local sign-out after account deletion without a redundant profile lookup', async () => {
    const fixture = createAuthFixture({
      unregister: async () => { throw new Error('must not be called'); },
    });

    assert.deepEqual(
      await fixture.value.signOut({ notificationDestinationAlreadyRevoked: true }),
      { error: null },
    );
  });

  it('does not force session or guest state closed when Supabase returns an error', async () => {
    const fixture = createAuthFixture({
      signOut: async () => ({ error: { message: 'Session could not be cleared' } }),
    });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'Session could not be cleared');
    assert.equal(fixture.value.session, null);
  });

  it('turns a rejected sign-out promise into a handled error result', async () => {
    const fixture = createAuthFixture({
      signOut: async () => { throw new Error('Secure storage unavailable'); },
    });

    const result = await fixture.value.signOut();
    assert.equal(result.error?.message, 'Secure storage unavailable');
  });
});

describe('AuthProvider account creation identity boundary', () => {
  it('creates a private auth account without user-controlled public profile metadata', async () => {
    const fixture = createAuthFixture();

    assert.deepEqual(await fixture.value.signUpWithEmail('player@example.test', 'password123'), { error: null });
    assert.deepEqual(fixture.signUpCalls, [{ email: 'player@example.test', password: 'password123' }]);
  });
});
