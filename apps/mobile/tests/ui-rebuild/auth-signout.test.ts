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
  signOut: () => Promise<{ error: Error | null }>;
};

function createAuthFixture(options: {
  getSession?: () => Promise<any>;
  signOut?: (...args: any[]) => Promise<any>;
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
      onAuthStateChange: (listener: typeof authListener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: options.signOut ?? (async () => ({ error: null })),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ error: null }),
    },
  };
  const exports = compileCommonJs<{ AuthProvider: (props: { children: null }) => unknown }>(
    new URL('../../src/context/AuthContext.tsx', import.meta.url),
    {
      react,
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
  it('signs out only this device and closes guest mode after success', async () => {
    const calls: unknown[] = [];
    const fixture = createAuthFixture({
      signOut: async (options: unknown) => {
        calls.push(options);
        return { error: null };
      },
    });

    assert.deepEqual(await fixture.value.signOut(), { error: null });
    fixture.unmount();
    assert.deepEqual(calls, [{ scope: 'local' }]);
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
