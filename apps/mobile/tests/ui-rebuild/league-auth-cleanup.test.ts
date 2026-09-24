import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness } from './component-harness.ts';
import { HOCKEY_LIFE_ID } from '../../src/config/hockeyLife.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const leagueRow = (id: string) => ({
  id: HOCKEY_LIFE_ID,
  name: `League ${id}`,
  slug: 'hockey-life',
  logo_url: null,
  city: null,
  primary_color: null,
  secondary_color: null,
});

type AuthSession = { user: { id: string } } | null;
type SessionResult = { data: { session: AuthSession }; error?: unknown };
type LeagueRowFixture = ReturnType<typeof leagueRow>;
type LeagueSelection = { id: string } & Record<string, unknown>;
type DivisionFixture = { id: string };

type LeagueValue = {
  activeLeague: LeagueSelection | null;
  availableLeagues: LeagueSelection[];
  divisions: DivisionFixture[];
  isLoading: boolean;
  isGuestLeague: boolean;
  membershipStatus: string;
  membershipDiagnostics: {
    entries: Array<{
      requestId: number;
      trigger: string;
      phase: string;
      outcome: string;
      commit: string;
      availableLeagueCount: number | null;
      userSuffix: string | null;
      getSessionCode: string | null;
      getSessionHttpStatus: number | null;
      getUserStatus: string;
      getUserCode: string | null;
      getUserHttpStatus: number | null;
    }>;
  };
  retryMemberships: () => void;
  setActiveLeague: (league: LeagueSelection | null) => Promise<void>;
  previewLeague: (league: LeagueSelection) => void;
  enterGuestLeague: () => void;
  exitGuestLeague: () => void;
};

type LookupFixture = {
  status: 'success' | 'incomplete' | 'auth-error' | 'missing-user' | 'query-error' | 'identity-mismatch';
  leagues: LeagueRowFixture[];
  identityMatchesExpected: boolean | null;
  userSuffix: string | null;
  getUser: { status: 'ok' | 'missing-user' | 'error'; code: string | null; httpStatus: number | null };
  membership: {
    status: 'not-requested' | 'success' | 'incomplete' | 'error';
    code: string | null;
    httpStatus: number | null;
    rowCount: number | null;
    nonNullLeagueCount: number | null;
  };
};

function lookup(
  status: LookupFixture['status'],
  leagues: LeagueRowFixture[] = [],
  overrides: Partial<LookupFixture> = {},
): LookupFixture {
  const successful = status === 'success' || status === 'incomplete';
  return {
    status,
    leagues,
    identityMatchesExpected: true,
    userSuffix: '••••safe',
    getUser: {
      status: status === 'auth-error' ? 'error' : status === 'missing-user' ? 'missing-user' : 'ok',
      code: null,
      httpStatus: null,
    },
    membership: {
      status: status === 'incomplete' ? 'incomplete' : successful ? 'success' : status === 'query-error' ? 'error' : 'not-requested',
      code: null,
      httpStatus: null,
      rowCount: successful ? leagues.length : null,
      nonNullLeagueCount: successful ? leagues.length : null,
    },
    ...overrides,
  };
}

type LeagueFixtureOptions = {
  getSession?: () => Promise<SessionResult>;
  getUserLeagues?: () => Promise<LeagueRowFixture[]>;
  getUserLeaguesDetailed?: (expectedUserId: string | null) => Promise<LookupFixture>;
  getDivisions?: (leagueId: string) => Promise<DivisionFixture[]>;
  getItemAsync?: () => Promise<string | null>;
  setItemAsync?: (key: string, value: string) => Promise<void>;
  deleteItemAsync?: (key: string) => Promise<void>;
  membershipDiagnosticsModule?: {
    getMembershipDiagnosticRuntime: () => {
      backendOrigin: string | null;
      appVersion: string | null;
      appBuild: string | null;
    };
  };
};

function createLeagueModule(options: LeagueFixtureOptions = {}) {
  type Harness = ReturnType<typeof createHookHarness>;
  type ProviderSlot = {
    authListener?: (event: string, session: AuthSession) => void;
    providerValue?: LeagueValue;
  };

  let activeHarness: Harness | undefined;
  let activeSlot: ProviderSlot | undefined;
  const getHarness = () => {
    assert.ok(activeHarness, 'a provider harness should be active');
    return activeHarness;
  };
  const context = {
    Provider: ({ value }: { value: LeagueValue }) => {
      assert.ok(activeSlot, 'a provider slot should be active');
      activeSlot.providerValue = value;
      return null;
    },
  };
  const react = {
    Fragment: 'Fragment',
    createContext: () => context,
    createElement: (...args: Parameters<Harness['react']['createElement']>) => getHarness().react.createElement(...args),
    useCallback: <T,>(callback: T, dependencies: readonly unknown[]) =>
      getHarness().react.useCallback(callback, dependencies),
    useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) =>
      getHarness().react.useEffect(effect, dependencies),
    useMemo: <T,>(factory: () => T, dependencies: readonly unknown[]) =>
      getHarness().react.useMemo(factory, dependencies),
    useRef: <T,>(initial: T) => getHarness().react.useRef(initial),
    useState: <T,>(initial: T | (() => T)) => getHarness().react.useState(initial),
  };
  const exports = compileCommonJs<{ LeagueProvider: (props: { children: null }) => unknown }>(
    new URL('../../src/context/LeagueContext.tsx', import.meta.url),
    {
      react,
      'expo-secure-store': {
        deleteItemAsync: options.deleteItemAsync ?? (async () => undefined),
        getItemAsync: options.getItemAsync ?? (async () => null),
        setItemAsync: options.setItemAsync ?? (async () => undefined),
      },
      '../lib/notifications': { registerForPushNotifications: async () => undefined },
      '../lib/supabase/client': {
        supabase: {
          auth: {
            getSession: options.getSession ?? (async () => ({ data: { session: null } })),
            onAuthStateChange: (listener: (event: string, session: AuthSession) => void) => {
              assert.ok(activeSlot, 'a provider slot should be active');
              activeSlot.authListener = listener;
              return { data: { subscription: { unsubscribe: () => undefined } } };
            },
          },
        },
      },
      '../lib/supabase/data': { getDivisions: options.getDivisions ?? (async () => []) },
      '../lib/supabase/leagues': {
        getUserLeagues: options.getUserLeagues ?? (async (): Promise<LeagueRowFixture[]> => []),
        getUserLeaguesDetailed: options.getUserLeaguesDetailed ?? (async () => (
          lookup('success', await (options.getUserLeagues?.() ?? Promise.resolve([])))
        )),
      },
      '../lib/membershipDiagnostics': options.membershipDiagnosticsModule ?? createDiagnosticsModule(),
      '../theme/LeagueTheme': { BLH_THEME: { primaryColor: '#22D3EE' } },
    },
  );

  return {
    mount() {
      const harness = createHookHarness();
      const slot: ProviderSlot = {};
      const render = () => {
        activeHarness = harness;
        activeSlot = slot;
        return harness.render();
      };

      activeHarness = harness;
      activeSlot = slot;
      harness.mount(() => {
        activeHarness = harness;
        activeSlot = slot;
        return exports.LeagueProvider({ children: null });
      });

      return {
        emit(event: string, session: AuthSession) {
          assert.ok(slot.authListener, 'auth listener should be registered');
          slot.authListener(event, session);
          render();
        },
        async settle() {
          await flush();
          render();
          await flush();
          render();
        },
        get value() {
          assert.ok(slot.providerValue);
          return slot.providerValue;
        },
        get stateUpdateCount() {
          return harness.stateUpdateCount;
        },
        unmount() {
          activeHarness = harness;
          activeSlot = slot;
          harness.unmount();
        },
      };
    },
  };
}

function createLeagueFixture(options: LeagueFixtureOptions = {}) {
  return createLeagueModule(options).mount();
}

type DiagnosticsModule = {
  getMembershipDiagnosticRuntime: () => {
    backendOrigin: string | null;
    appVersion: string | null;
    appBuild: string | null;
  };
  formatMembershipDiagnostics: (value: unknown, status: unknown) => string;
};

function createDiagnosticsModule(): DiagnosticsModule {
  return compileCommonJs<DiagnosticsModule>(
    new URL('../../src/lib/membershipDiagnostics.ts', import.meta.url),
    {
      'expo-constants': {
        default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '14' } } },
      },
    },
  );
}

function formatProviderDiagnostics(diagnostics: DiagnosticsModule, value: LeagueValue) {
  return diagnostics.formatMembershipDiagnostics(value.membershipDiagnostics, value.membershipStatus);
}

describe('LeagueProvider persisted selection ordering', () => {
  it('orders a delayed read and logout delete before a remounted provider selection', async () => {
    const bootstrap = deferred<SessionResult>();
    const storageRead = deferred<string | null>();
    const pendingDelete = deferred<void>();
    let persisted: string | null = 'A';
    const operations: string[] = [];
    const leagueModule = createLeagueModule({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [leagueRow('A')],
      getItemAsync: async () => {
        operations.push('read:start');
        const value = await storageRead.promise;
        operations.push(`read:${value}`);
        return value;
      },
      deleteItemAsync: async () => {
        operations.push('delete:start');
        await pendingDelete.promise;
        persisted = null;
        operations.push('delete:finish');
      },
      setItemAsync: async (_key, value) => {
        persisted = value;
        operations.push(`set:${value}`);
      },
    });

    const providerA = leagueModule.mount();
    providerA.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await providerA.settle();
    assert.deepEqual(providerA.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.deepEqual(operations, ['read:start']);

    providerA.emit('SIGNED_OUT', null);
    providerA.unmount();
    const providerB = leagueModule.mount();
    const selectingB = providerB.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });

    storageRead.resolve('A');
    await flush();
    await flush();
    assert.equal(operations.includes('delete:start'), true);
    pendingDelete.resolve();
    await selectingB;
    await providerB.settle();

    assert.equal(providerB.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(persisted, HOCKEY_LIFE_ID);
    assert.equal(operations.at(-1), `set:${HOCKEY_LIFE_ID}`);
  });

  it('orders a pending set and logout delete before a remounted provider selection', async () => {
    const bootstrap = deferred<SessionResult>();
    const pendingASet = deferred<void>();
    let setCalls = 0;
    let persisted: string | null = null;
    const operations: string[] = [];
    const leagueModule = createLeagueModule({
      getSession: () => bootstrap.promise,
      setItemAsync: async (_key, value) => {
        operations.push(`set:${value}:start`);
        if (++setCalls === 1) await pendingASet.promise;
        persisted = value;
        operations.push(`set:${value}:finish`);
      },
      deleteItemAsync: async () => {
        persisted = null;
        operations.push('delete');
      },
    });

    const providerA = leagueModule.mount();
    const selectingA = providerA.value.setActiveLeague({ ...leagueRow('A'), logoUrl: null, theme: {} });
    await flush();
    assert.deepEqual(operations, [`set:${HOCKEY_LIFE_ID}:start`]);
    providerA.emit('SIGNED_OUT', null);
    providerA.unmount();

    const providerB = leagueModule.mount();
    const selectingB = providerB.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });
    pendingASet.resolve();
    await Promise.all([selectingA, selectingB]);
    await providerB.settle();

    assert.equal(providerB.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(persisted, HOCKEY_LIFE_ID);
    assert.deepEqual(operations, [
      `set:${HOCKEY_LIFE_ID}:start`,
      `set:${HOCKEY_LIFE_ID}:finish`,
      'delete',
      `set:${HOCKEY_LIFE_ID}:start`,
      `set:${HOCKEY_LIFE_ID}:finish`,
    ]);
  });

  it('recovers shared ordering after a rejected old-provider read', async () => {
    const bootstrap = deferred<SessionResult>();
    const storageRead = deferred<string | null>();
    let persisted: string | null = 'A';
    const operations: string[] = [];
    const leagueModule = createLeagueModule({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [leagueRow('A')],
      getItemAsync: async () => {
        operations.push('read:start');
        return storageRead.promise;
      },
      deleteItemAsync: async () => {
        persisted = null;
        operations.push('delete');
      },
      setItemAsync: async (_key, value) => {
        persisted = value;
        operations.push(`set:${value}`);
      },
    });

    const providerA = leagueModule.mount();
    providerA.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await providerA.settle();
    assert.deepEqual(operations, ['read:start']);
    providerA.emit('SIGNED_OUT', null);
    providerA.unmount();

    const providerB = leagueModule.mount();
    const selectingB = providerB.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });
    storageRead.reject(new Error('old provider read failed'));
    await selectingB;
    await providerB.settle();

    assert.equal(providerB.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(persisted, HOCKEY_LIFE_ID);
    assert.equal(operations.at(-1), `set:${HOCKEY_LIFE_ID}`);
  });

  it('cannot let account A storage restoration delete account B selection', async () => {
    const bootstrap = deferred<SessionResult>();
    const storageRead = deferred<string | null>();
    const membershipLoads = [Promise.resolve([leagueRow('A')]), Promise.resolve([leagueRow('B')])];
    let persisted: string | null = null;
    const operations: string[] = [];
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: () => membershipLoads.shift() ?? Promise.resolve([]),
      getItemAsync: async () => {
        operations.push('read:start');
        const value = await storageRead.promise;
        operations.push(`read:${value}`);
        return value;
      },
      setItemAsync: async (_key, value) => {
        operations.push(`set:${value}`);
        persisted = value;
      },
      deleteItemAsync: async () => {
        operations.push('delete');
        persisted = null;
      },
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);

    fixture.emit('SIGNED_OUT', null);
    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);

    const accountBLeague = fixture.value.availableLeagues[0];
    const selectingB = fixture.value.setActiveLeague(accountBLeague);
    persisted = HOCKEY_LIFE_ID;
    storageRead.resolve('B');
    await selectingB;
    await fixture.settle();

    assert.equal(persisted, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(operations.at(-1), `set:${HOCKEY_LIFE_ID}`);
  });

  it('serializes a pending account A set, sign-out delete, and account B set', async () => {
    const bootstrap = deferred<SessionResult>();
    const pendingASet = deferred<void>();
    let setCalls = 0;
    let persisted: string | null = null;
    const operations: string[] = [];
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [],
      setItemAsync: async (_key, value) => {
        operations.push(`set:${value}:start`);
        if (++setCalls === 1) await pendingASet.promise;
        persisted = value;
        operations.push(`set:${value}:finish`);
      },
      deleteItemAsync: async () => {
        operations.push('delete');
        persisted = null;
      },
    });

    const selectingA = fixture.value.setActiveLeague({ ...leagueRow('A'), logoUrl: null, theme: {} });
    await flush();
    fixture.emit('SIGNED_OUT', null);
    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    const selectingB = fixture.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });
    pendingASet.resolve();
    await Promise.all([selectingA, selectingB]);
    await fixture.settle();

    assert.equal(persisted, HOCKEY_LIFE_ID);
    assert.deepEqual(operations, [`set:${HOCKEY_LIFE_ID}:start`, `set:${HOCKEY_LIFE_ID}:finish`, 'delete', `set:${HOCKEY_LIFE_ID}:start`, `set:${HOCKEY_LIFE_ID}:finish`]);
  });

  it('continues preference ordering after a sign-out deletion failure', async () => {
    const bootstrap = deferred<SessionResult>();
    let persisted: string | null = 'A';
    let deleteAttempts = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [],
      deleteItemAsync: async () => {
        deleteAttempts += 1;
        throw new Error('storage unavailable');
      },
      setItemAsync: async (_key, value) => {
        persisted = value;
      },
    });

    fixture.emit('SIGNED_OUT', null);
    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    await fixture.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });
    await fixture.settle();

    assert.equal(deleteAttempts, 1);
    assert.equal(persisted, HOCKEY_LIFE_ID);
  });
});

describe('LeagueProvider auth bootstrap freshness', () => {
  it('selects Hockey Life public data for fresh guest entry without membership', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({ data: { session: null }, error: null }),
      getUserLeagues: async () => [],
    });
    await fixture.settle();

    fixture.value.enterGuestLeague();
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.activeLeague?.slug, 'hockey-life');
    assert.equal(fixture.value.isGuestLeague, true);
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
  });

  it('clears the public league when a guest exits to sign in', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({ data: { session: null }, error: null }),
    });
    await fixture.settle();

    fixture.value.enterGuestLeague();
    fixture.value.exitGuestLeague();
    await fixture.settle();

    assert.equal(fixture.value.activeLeague, null);
    assert.deepEqual(fixture.value.availableLeagues, []);
    assert.equal(fixture.value.isGuestLeague, false);
  });

  it('replaces stale account league state when guest mode begins', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({ data: { session: null }, error: null }),
      getUserLeagues: async () => [leagueRow('account')],
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    assert.equal(fixture.value.isGuestLeague, false);

    fixture.value.enterGuestLeague();
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.activeLeague?.name, 'Hockey Life');
    assert.equal(fixture.value.isGuestLeague, true);
  });

  it('keeps the public league when a stale signed-out event follows guest entry', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({ data: { session: null }, error: null }),
    });
    await fixture.settle();

    fixture.value.enterGuestLeague();
    fixture.emit('INITIAL_SESSION', null);
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.isGuestLeague, true);
  });

  it('treats a successful real null getSession result as signed out', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({ data: { session: null }, error: null }),
    });

    await fixture.settle();
    assert.equal(fixture.value.isLoading, false);
    assert.equal(fixture.value.membershipStatus, 'signed-out');
    assert.deepEqual(fixture.value.membershipDiagnostics.entries, []);
  });

  it('treats a null INITIAL_SESSION callback as the current signed-out bootstrap', async () => {
    const bootstrap = deferred<SessionResult>();
    const fixture = createLeagueFixture({ getSession: () => bootstrap.promise });

    fixture.emit('INITIAL_SESSION', null);
    await fixture.settle();

    assert.equal(fixture.value.isLoading, false);
    assert.deepEqual(fixture.value.availableLeagues, []);
  });

  it('loads memberships from a non-null INITIAL_SESSION callback', async () => {
    const bootstrap = deferred<SessionResult>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [leagueRow('A')],
    });

    fixture.emit('INITIAL_SESSION', { user: { id: 'account-a' } });
    await fixture.settle();

    assert.equal(fixture.value.isLoading, false);
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
  });

  it('ignores an older null bootstrap after a newer SIGNED_IN load', async () => {
    const bootstrap = deferred<SessionResult>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => [leagueRow('B')],
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);

    bootstrap.resolve({ data: { session: null } });
    await fixture.settle();

    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.isLoading, false);
  });

  it('ignores an older non-null bootstrap after a newer SIGNED_OUT event', async () => {
    const bootstrap = deferred<SessionResult>();
    let membershipLoads = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeagues: async () => {
        membershipLoads += 1;
        return [leagueRow('A')];
      },
    });

    fixture.emit('SIGNED_OUT', null);
    bootstrap.resolve({ data: { session: { user: { id: 'account-a' } } } });
    await fixture.settle();

    assert.equal(membershipLoads, 0);
    assert.deepEqual(fixture.value.availableLeagues, []);
    assert.equal(fixture.value.activeLeague, null);
    assert.equal(fixture.value.isLoading, false);
  });

  it('ends loading when the current bootstrap rejects', async () => {
    const bootstrap = deferred<SessionResult>();
    const fixture = createLeagueFixture({ getSession: () => bootstrap.promise });

    bootstrap.reject(new Error('session storage unavailable'));
    await fixture.settle();

    assert.equal(fixture.value.isLoading, false);
    assert.deepEqual(fixture.value.availableLeagues, []);
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.trigger, 'bootstrap');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.outcome, 'session-error');
  });

  it('treats a returned getSession error as unknown identity and preserves it across INITIAL_SESSION null', async () => {
    const fixture = createLeagueFixture({
      getSession: async () => ({
        data: { session: null },
        error: { code: 'session_not_found', message: 'synthetic private marker' },
      }),
    });

    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.outcome, 'session-error');
    assert.equal(JSON.stringify(fixture.value.membershipDiagnostics).includes('synthetic private marker'), false);

    fixture.emit('INITIAL_SESSION', null);
    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.outcome, 'session-error');
  });

  it('projects returned and thrown getSession facts through the actual provider and formatter', async () => {
    const diagnostics = createDiagnosticsModule();
    const failures = [
      {
        label: 'returned',
        getSession: async () => ({
          data: { session: null },
          error: { code: 'session_not_found', status: 401, message: 'private returned detail' },
        }),
        code: 'session_not_found',
        status: 401,
      },
      {
        label: 'thrown',
        getSession: async () => {
          throw { code: 'session_expired', status: 503, message: 'private thrown detail' };
        },
        code: 'session_expired',
        status: 503,
      },
    ];

    for (const failure of failures) {
      const fixture = createLeagueFixture({
        getSession: failure.getSession,
        membershipDiagnosticsModule: diagnostics,
      });
      await fixture.settle();

      const entry = fixture.value.membershipDiagnostics.entries.at(-1);
      assert.equal(entry?.outcome, 'session-error', failure.label);
      assert.equal(entry?.getSessionCode, failure.code, failure.label);
      assert.equal(entry?.getSessionHttpStatus, failure.status, failure.label);
      assert.equal(entry?.getUserStatus, 'not-requested', failure.label);
      assert.equal(entry?.getUserCode, null, failure.label);
      assert.equal(entry?.getUserHttpStatus, null, failure.label);

      const rendered = formatProviderDiagnostics(diagnostics, fixture.value);
      assert.match(
        rendered,
        new RegExp(`getSession: HTTP ${failure.status} · code ${failure.code}`),
        failure.label,
      );
      assert.match(rendered, /getUser: not-requested · HTTP unknown · code unknown/, failure.label);
      assert.equal(rendered.includes('private returned detail'), false, failure.label);
      assert.equal(rendered.includes('private thrown detail'), false, failure.label);
    }
  });

  it('keeps unknown session facts null, accepts only status boundaries, and never leaks hostile fields', async () => {
    const diagnostics = createDiagnosticsModule();
    const hostileMarker = 'PRIVATE_SESSION_RAW_MARKER';
    const cases = [
      { code: 'session_not_found', status: 100, expectedCode: 'session_not_found', expectedStatus: 100 },
      { code: 'bad_jwt', status: 599, expectedCode: 'bad_jwt', expectedStatus: 599 },
      { code: hostileMarker, status: 99, expectedCode: null, expectedStatus: null },
      { code: hostileMarker, status: 600, expectedCode: null, expectedStatus: null },
      { code: hostileMarker, status: 200.5, expectedCode: null, expectedStatus: null },
      { code: hostileMarker, status: '401', expectedCode: null, expectedStatus: null },
    ];
    const consoleOutput: unknown[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...values: unknown[]) => { consoleOutput.push(...values); };
    console.warn = (...values: unknown[]) => { consoleOutput.push(...values); };
    console.error = (...values: unknown[]) => { consoleOutput.push(...values); };

    try {
      for (const testCase of cases) {
        const fixture = createLeagueFixture({
          membershipDiagnosticsModule: diagnostics,
          getSession: async () => ({
            data: { session: null },
            error: {
              code: testCase.code,
              status: testCase.status,
              message: hostileMarker,
              stack: hostileMarker,
              session: { access_token: hostileMarker, user: { email: hostileMarker } },
              url: `https://example.invalid/${hostileMarker}`,
              headers: { authorization: hostileMarker },
              extra: hostileMarker,
            },
          }),
        });
        await fixture.settle();

        const entry = fixture.value.membershipDiagnostics.entries.at(-1);
        assert.equal(entry?.getSessionCode, testCase.expectedCode);
        assert.equal(entry?.getSessionHttpStatus, testCase.expectedStatus);
        assert.equal(entry?.getUserStatus, 'not-requested');
        const state = JSON.stringify(fixture.value.membershipDiagnostics);
        const rendered = formatProviderDiagnostics(diagnostics, fixture.value);
        assert.equal(state.includes(hostileMarker), false);
        assert.equal(rendered.includes(hostileMarker), false);
      }
    } finally {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    }
    assert.equal(JSON.stringify(consoleOutput).includes(hostileMarker), false);
  });

  it('preserves returned and thrown session facts when INITIAL_SESSION null arrives before completion', async () => {
    const diagnostics = createDiagnosticsModule();
    for (const mode of ['returned', 'thrown'] as const) {
      const bootstrap = deferred<SessionResult>();
      const fixture = createLeagueFixture({
        getSession: () => bootstrap.promise,
        membershipDiagnosticsModule: diagnostics,
      });

      fixture.emit('INITIAL_SESSION', null);
      assert.equal(fixture.value.membershipStatus, 'signed-out');
      if (mode === 'returned') {
        bootstrap.resolve({
          data: { session: null },
          error: { code: 'session_not_found', status: 401, message: 'private returned detail' },
        });
      } else {
        bootstrap.reject({ code: 'session_expired', status: 503, stack: 'private thrown detail' });
      }
      await fixture.settle();

      const expectedCode = mode === 'returned' ? 'session_not_found' : 'session_expired';
      const expectedStatus = mode === 'returned' ? 401 : 503;
      assert.equal(fixture.value.membershipStatus, 'error');
      assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.getSessionCode, expectedCode);
      assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.getSessionHttpStatus, expectedStatus);
      assert.match(
        formatProviderDiagnostics(diagnostics, fixture.value),
        new RegExp(`getSession: HTTP ${expectedStatus} · code ${expectedCode}`),
      );

      fixture.emit('INITIAL_SESSION', null);
      await fixture.settle();
      assert.equal(fixture.value.membershipStatus, 'error');
      assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.getSessionCode, expectedCode);
      assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.getSessionHttpStatus, expectedStatus);
    }
  });

  it('carries all ten auth codes through the actual helper, provider, and formatter', async () => {
    const diagnostics = createDiagnosticsModule();
    const supportedCodes = [
      'bad_jwt',
      'request_timeout',
      'refresh_token_already_used',
      'refresh_token_not_found',
      'session_expired',
      'session_not_found',
      'unexpected_audience',
      'unexpected_failure',
      'user_banned',
      'user_not_found',
    ];

    for (const code of supportedCodes) {
      const bootstrap = deferred<SessionResult>();
      const helper = compileCommonJs<{
        getUserLeaguesDetailed: (expectedUserId: string | null) => Promise<LookupFixture>;
      }>(new URL('../../src/lib/supabase/leagues.ts', import.meta.url), {
        './client': {
          supabase: {
            auth: {
              getUser: async () => ({
                data: { user: null },
                error: { code, status: 401, message: 'PRIVATE_HELPER_MARKER' },
              }),
            },
            from: () => { throw new Error('membership query must not run'); },
          },
        },
      });
      const fixture = createLeagueFixture({
        getSession: () => bootstrap.promise,
        getUserLeaguesDetailed: helper.getUserLeaguesDetailed,
        membershipDiagnosticsModule: diagnostics,
      });
      fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
      await fixture.settle();

      const entry = fixture.value.membershipDiagnostics.entries.at(-1);
      assert.equal(entry?.outcome, 'auth-error', code);
      assert.equal(entry?.getSessionCode, null, code);
      assert.equal(entry?.getSessionHttpStatus, null, code);
      assert.equal(entry?.getUserCode, code, code);
      assert.equal(entry?.getUserHttpStatus, 401, code);
      const rendered = formatProviderDiagnostics(diagnostics, fixture.value);
      assert.match(rendered, new RegExp(`getUser: error · HTTP 401 · code ${code}`), code);
      assert.equal(rendered.includes('PRIVATE_HELPER_MARKER'), false, code);
    }
  });

  it('uses a recovered session for a fresh scoped getUser membership lookup', async () => {
    const diagnostics = createDiagnosticsModule();
    let getSessionCalls = 0;
    let getUserCalls = 0;
    const queryCalls: unknown[][] = [];
    const helper = compileCommonJs<{
      getUserLeaguesDetailed: (expectedUserId: string | null) => Promise<LookupFixture>;
    }>(new URL('../../src/lib/supabase/leagues.ts', import.meta.url), {
      './client': {
        supabase: {
          auth: {
            getUser: async () => {
              getUserCalls += 1;
              return { data: { user: { id: 'account-a' } }, error: null };
            },
          },
          from: (table: string) => ({
            select: (columns: string) => ({
              eq: async (column: string, userId: string) => {
                queryCalls.push([table, columns, column, userId]);
                return { data: [{ league: leagueRow('A') }], error: null, status: 200 };
              },
            }),
          }),
        },
      },
    });
    const fixture = createLeagueFixture({
      membershipDiagnosticsModule: diagnostics,
      getSession: async () => {
        getSessionCalls += 1;
        if (getSessionCalls === 1) {
          throw { code: 'session_expired', status: 401, message: 'PRIVATE_RETRY_MARKER' };
        }
        return { data: { session: { user: { id: 'account-a' } } }, error: null };
      },
      getUserLeaguesDetailed: helper.getUserLeaguesDetailed,
    });

    await fixture.settle();
    fixture.value.retryMemberships();
    await fixture.settle();

    assert.equal(getSessionCalls, 2);
    assert.equal(getUserCalls, 1);
    assert.equal(queryCalls.length, 1);
    assert.deepEqual(queryCalls[0]?.slice(0, 3), ['league_memberships', 'league:leagues(id, name, slug, logo_url, primary_color, secondary_color, short_name, city)', 'user_id']);
    assert.equal(queryCalls[0]?.[3], 'account-a');
    assert.equal(fixture.value.membershipStatus, 'ready');
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    const rendered = formatProviderDiagnostics(diagnostics, fixture.value);
    assert.match(rendered, /getSession: HTTP unknown · code unknown/);
    assert.match(rendered, /getUser: ok · HTTP unknown · code unknown/);
    assert.equal(rendered.includes('PRIVATE_RETRY_MARKER'), false);
  });

  it('retries thrown session resolution once and resolves through validated membership lookup', async () => {
    let sessionCalls = 0;
    let membershipCalls = 0;
    const fixture = createLeagueFixture({
      getSession: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) throw new Error('session storage unavailable');
        return { data: { session: { user: { id: 'account-a' } } }, error: null };
      },
      getUserLeaguesDetailed: async (expectedUserId) => {
        membershipCalls += 1;
        assert.equal(expectedUserId, 'account-a');
        return lookup('success', [leagueRow('A')]);
      },
    });

    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'error');
    fixture.emit('INITIAL_SESSION', null);
    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.outcome, 'session-error');
    fixture.value.retryMemberships();
    await fixture.settle();

    assert.equal(sessionCalls, 2);
    assert.equal(membershipCalls, 1);
    assert.equal(fixture.value.membershipStatus, 'ready');
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.trigger, 'manual-retry');
  });

  it('suppresses duplicate session retries while resolution is pending', async () => {
    const retry = deferred<SessionResult>();
    let sessionCalls = 0;
    const fixture = createLeagueFixture({
      getSession: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) throw { code: 'session_expired', status: 503, message: 'private marker' };
        return retry.promise;
      },
    });

    await fixture.settle();
    fixture.value.retryMemberships();
    fixture.value.retryMemberships();
    await fixture.settle();
    assert.equal(sessionCalls, 2);
    assert.equal(fixture.value.membershipStatus, 'loading');

    retry.resolve({ data: { session: null }, error: null });
    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'signed-out');
    assert.deepEqual(fixture.value.membershipDiagnostics.entries, []);
  });

  it('explicit SIGNED_OUT clears session failure and a late retry cannot restore identity', async () => {
    const retry = deferred<SessionResult>();
    let sessionCalls = 0;
    let membershipCalls = 0;
    const fixture = createLeagueFixture({
      getSession: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) return { data: { session: null }, error: { code: 'session_not_found' } };
        return retry.promise;
      },
      getUserLeaguesDetailed: async () => {
        membershipCalls += 1;
        return lookup('success', [leagueRow('A')]);
      },
    });

    await fixture.settle();
    fixture.value.retryMemberships();
    await flush();
    fixture.emit('SIGNED_OUT', null);
    assert.equal(fixture.value.membershipStatus, 'signed-out');
    assert.deepEqual(fixture.value.membershipDiagnostics.entries, []);

    retry.resolve({ data: { session: { user: { id: 'account-a' } } }, error: null });
    await fixture.settle();
    assert.equal(membershipCalls, 0);
    assert.equal(fixture.value.membershipStatus, 'signed-out');
    assert.deepEqual(fixture.value.availableLeagues, []);
  });

  it('ignores a late session retry after a new identity and after unmount', async () => {
    const retryForSwitch = deferred<SessionResult>();
    let sessionCalls = 0;
    const fixture = createLeagueFixture({
      getSession: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) throw new Error('session unavailable');
        return retryForSwitch.promise;
      },
      getUserLeaguesDetailed: async (expectedUserId) => lookup('success', [leagueRow(expectedUserId === 'account-b' ? 'B' : 'A')]),
    });

    await fixture.settle();
    fixture.value.retryMemberships();
    await flush();
    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    await fixture.settle();
    retryForSwitch.resolve({ data: { session: { user: { id: 'account-a' } } }, error: null });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);

    const retryForUnmount = deferred<SessionResult>();
    let unmountCalls = 0;
    const unmountFixture = createLeagueFixture({
      getSession: async () => {
        unmountCalls += 1;
        if (unmountCalls === 1) throw new Error('session unavailable');
        return retryForUnmount.promise;
      },
    });
    await unmountFixture.settle();
    unmountFixture.value.retryMemberships();
    await flush();
    unmountFixture.unmount();
    const updatesAtUnmount = unmountFixture.stateUpdateCount;
    retryForUnmount.resolve({ data: { session: null }, error: null });
    await flush();
    assert.equal(unmountFixture.stateUpdateCount, updatesAtUnmount);
  });
});

describe('LeagueProvider membership request status and generation safety', () => {
  it('settles membership success when selection changes during delayed preference restoration', async () => {
    const bootstrap = deferred<SessionResult>();
    const storageRead = deferred<string | null>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => lookup('success', [leagueRow('A')], { userSuffix: '••••aaaa' }),
      getItemAsync: () => storageRead.promise,
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    const currentRequestId = fixture.value.membershipDiagnostics.entries.at(-1)?.requestId;
    const selecting = fixture.value.setActiveLeague(fixture.value.availableLeagues[0]);
    storageRead.resolve(null);
    await selecting;
    await fixture.settle();

    const finalEntry = fixture.value.membershipDiagnostics.entries.at(-1);
    assert.equal(fixture.value.membershipStatus, 'ready');
    assert.equal(fixture.value.isLoading, false);
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(finalEntry?.requestId, currentRequestId);
    assert.equal(finalEntry?.outcome, 'success');
    assert.equal(finalEntry?.commit, 'committed');
    assert.equal(finalEntry?.userSuffix, '••••aaaa');
  });
  it('settles an unexpected detailed-helper rejection without leaking or spinning', async () => {
    const bootstrap = deferred<SessionResult>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => { throw new Error('synthetic private marker'); },
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();

    assert.equal(fixture.value.isLoading, false);
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.equal(JSON.stringify(fixture.value.membershipDiagnostics).includes('synthetic private marker'), false);
  });

  it('settles a failure and lets a manual retry update the current provider tree', async () => {
    const bootstrap = deferred<SessionResult>();
    const results = [
      lookup('query-error', [], {
        membership: { status: 'error', code: 'PGRST301', httpStatus: 503, rowCount: null, nonNullLeagueCount: null },
      }),
      lookup('success', [leagueRow('A')]),
    ];
    let requests = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => {
        requests += 1;
        return results.shift() ?? lookup('success');
      },
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'error');
    assert.deepEqual(fixture.value.availableLeagues, []);
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.commit, 'retained');

    fixture.value.retryMemberships();
    await fixture.settle();
    assert.equal(requests, 2);
    assert.equal(fixture.value.membershipStatus, 'ready');
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.trigger, 'manual-retry');
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.commit, 'committed');
  });

  it('prevents duplicate pending manual retries', async () => {
    const bootstrap = deferred<SessionResult>();
    const pendingRetry = deferred<LookupFixture>();
    let requests = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => {
        requests += 1;
        return requests === 1 ? lookup('query-error') : pendingRetry.promise;
      },
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    fixture.value.retryMemberships();
    fixture.value.retryMemberships();
    await fixture.settle();
    assert.equal(requests, 2);
    assert.equal(fixture.value.membershipStatus, 'loading');

    pendingRetry.resolve(lookup('success', [leagueRow('A')]));
    await fixture.settle();
    assert.equal(fixture.value.membershipStatus, 'ready');
  });

  it('retains known same-user membership and selection when refresh fails', async () => {
    const bootstrap = deferred<SessionResult>();
    const results = [lookup('success', [leagueRow('A')]), lookup('query-error')];
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => results.shift() ?? lookup('query-error'),
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    await fixture.value.setActiveLeague(fixture.value.availableLeagues[0]);
    fixture.value.retryMemberships();
    await fixture.settle();

    assert.equal(fixture.value.membershipStatus, 'error');
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.availableLeagueCount, 1);
    assert.equal(fixture.value.membershipDiagnostics.entries.at(-1)?.commit, 'retained');
  });

  it('drops an older same-user result after a newer success', async () => {
    const bootstrap = deferred<SessionResult>();
    const oldRequest = deferred<LookupFixture>();
    let requests = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => ++requests === 1
        ? oldRequest.promise
        : lookup('success', [leagueRow('new')]),
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);

    oldRequest.resolve(lookup('success'));
    await fixture.settle();
    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(fixture.value.membershipStatus, 'ready');
    assert.equal(fixture.value.membershipDiagnostics.entries.some(({ commit }) => commit === 'dropped'), true);
  });

  it('does not let account A results or diagnostics contaminate account B', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountA = deferred<LookupFixture>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async (expectedUserId) => expectedUserId === 'account-a'
        ? accountA.promise
        : lookup('success', [leagueRow('B')], { userSuffix: '••••bbbb' }),
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    fixture.emit('SIGNED_IN', { user: { id: 'account-b' } });
    await fixture.settle();
    accountA.resolve(lookup('success', [leagueRow('A')], { userSuffix: '••••aaaa' }));
    await fixture.settle();

    assert.deepEqual(fixture.value.availableLeagues.map(({ id }) => id), [HOCKEY_LIFE_ID]);
    assert.equal(JSON.stringify(fixture.value.membershipDiagnostics).includes('aaaa'), false);
    assert.equal(JSON.stringify(fixture.value.membershipDiagnostics).includes('bbbb'), true);
  });

  it('clears account diagnostics on logout and ignores post-unmount completion', async () => {
    const bootstrap = deferred<SessionResult>();
    const request = deferred<LookupFixture>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => request.promise,
    });
    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    fixture.emit('SIGNED_OUT', null);
    assert.equal(fixture.value.membershipStatus, 'signed-out');
    assert.deepEqual(fixture.value.membershipDiagnostics.entries, []);

    fixture.unmount();
    const updatesAtUnmount = fixture.stateUpdateCount;
    request.resolve(lookup('success', [leagueRow('A')]));
    await flush();
    assert.equal(fixture.stateUpdateCount, updatesAtUnmount);
  });

  it('keeps diagnostics in memory only and bounds recent request history', async () => {
    const bootstrap = deferred<SessionResult>();
    const storageOperations: string[] = [];
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getUserLeaguesDetailed: async () => lookup('query-error'),
      getItemAsync: async () => { storageOperations.push('get'); return null; },
      setItemAsync: async () => { storageOperations.push('set'); },
      deleteItemAsync: async () => { storageOperations.push('delete'); },
    });

    fixture.emit('SIGNED_IN', { user: { id: 'account-a' } });
    await fixture.settle();
    for (let index = 0; index < 8; index += 1) {
      fixture.value.retryMemberships();
      await fixture.settle();
    }

    assert.equal(fixture.value.membershipDiagnostics.entries.length, 6);
    assert.deepEqual(storageOperations, []);
  });
});

describe('LeagueProvider division request freshness', () => {
  it('keeps a pending division request current when setActiveLeague receives a new object with the same id', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountADivisions = deferred<DivisionFixture[]>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getDivisions: () => accountADivisions.promise,
    });

    const initialLeague = { ...leagueRow('A'), logoUrl: null, theme: {} };
    await fixture.value.setActiveLeague(initialLeague);
    await fixture.settle();

    await fixture.value.setActiveLeague({ ...initialLeague });
    accountADivisions.resolve([{ id: 'A-current-division' }]);
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.deepEqual(fixture.value.divisions.map(({ id }) => id), ['A-current-division']);
  });

  it('keeps a pending division request current when previewLeague receives the same league object', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountADivisions = deferred<DivisionFixture[]>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getDivisions: () => accountADivisions.promise,
    });

    const league = { ...leagueRow('A'), logoUrl: null, theme: {} };
    await fixture.value.setActiveLeague(league);
    await fixture.settle();

    fixture.value.previewLeague(league);
    accountADivisions.resolve([{ id: 'A-current-division' }]);
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(fixture.value.isGuestLeague, true);
    assert.deepEqual(fixture.value.divisions.map(({ id }) => id), ['A-current-division']);
  });

  it('does not restore account A divisions after sign-out cleanup', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountADivisions = deferred<DivisionFixture[]>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getDivisions: () => accountADivisions.promise,
    });

    await fixture.value.setActiveLeague({ ...leagueRow('A'), logoUrl: null, theme: {} });
    await fixture.settle();
    fixture.emit('SIGNED_OUT', null);
    accountADivisions.resolve([{ id: 'A-private-division' }]);
    await fixture.settle();

    assert.equal(fixture.value.activeLeague, null);
    assert.deepEqual(fixture.value.divisions, []);
  });

  it('does not let an older account response replace current Hockey Life divisions after an identity reset', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountADivisions = deferred<DivisionFixture[]>();
    let divisionReads = 0;
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getDivisions: () => ++divisionReads === 1
        ? accountADivisions.promise
        : Promise.resolve([{ id: 'B-current-division' }]),
    });

    await fixture.value.setActiveLeague({ ...leagueRow('A'), logoUrl: null, theme: {} });
    await fixture.settle();
    fixture.emit('SIGNED_OUT', null);
    await fixture.settle();
    await fixture.value.setActiveLeague({ ...leagueRow('B'), logoUrl: null, theme: {} });
    await fixture.settle();
    assert.deepEqual(fixture.value.divisions.map(({ id }) => id), ['B-current-division']);

    accountADivisions.resolve([{ id: 'A-private-division' }]);
    await fixture.settle();

    assert.equal(fixture.value.activeLeague?.id, HOCKEY_LIFE_ID);
    assert.deepEqual(fixture.value.divisions.map(({ id }) => id), ['B-current-division']);
  });

  it('does not write division state after provider unmount', async () => {
    const bootstrap = deferred<SessionResult>();
    const accountADivisions = deferred<DivisionFixture[]>();
    const fixture = createLeagueFixture({
      getSession: () => bootstrap.promise,
      getDivisions: () => accountADivisions.promise,
    });

    await fixture.value.setActiveLeague({ ...leagueRow('A'), logoUrl: null, theme: {} });
    await fixture.settle();
    fixture.unmount();
    const updatesAtUnmount = fixture.stateUpdateCount;
    accountADivisions.resolve([{ id: 'A-private-division' }]);
    await flush();

    assert.equal(fixture.stateUpdateCount, updatesAtUnmount);
  });
});
