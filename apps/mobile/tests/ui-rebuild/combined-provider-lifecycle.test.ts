import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOCKEY_LIFE_ID } from '../../src/config/hockeyLife';
import { compileCommonJs, createHookHarness } from './component-harness';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('combined AuthProvider and LeagueProvider lifecycle', () => {
  it('finishes coherent after guest entry, guest exit, real sign-in, and real logout', async () => {
    const harness = createHookHarness();
    type Session = { user: { id: string } } | null;
    type AuthValue = {
      isGuest: boolean;
      session: Session;
      user: { id: string } | null;
      continueAsGuest(): void;
      exitGuest(): void;
      signOut(): Promise<{ error: Error | null }>;
    };
    type LeagueValue = {
      activeLeague: { id: string } | null;
      availableLeagues: Array<{ id: string }>;
      isGuestLeague: boolean;
      membershipStatus: string;
      enterGuestLeague(): void;
      exitGuestLeague(): void;
    };
    const listeners: Array<(event: string, session: Session) => void> = [];
    let authValue!: AuthValue;
    let leagueValue!: LeagueValue;
    const currentAuth = () => authValue;
    const currentLeague = () => leagueValue;

    const authContext = { Provider: ({ value }: { value: unknown }) => { authValue = value as AuthValue; return null; } };
    const leagueContext = { Provider: ({ value }: { value: unknown }) => { leagueValue = value as LeagueValue; return null; } };
    const authReact = { ...harness.react, createContext: () => authContext };
    const leagueReact = { ...harness.react, createContext: () => leagueContext };
    const emit = (event: string, session: Session) => listeners.forEach((listener) => listener(event, session));
    const supabase = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: (listener: (event: string, session: Session) => void) => {
          listeners.push(listener);
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
        signOut: async () => { emit('SIGNED_OUT', null); return { error: null }; },
        signInWithPassword: async () => ({ error: null }),
        signUp: async () => ({ error: null }),
      },
    };

    const AuthProvider = compileCommonJs<{ AuthProvider: (props: { children: null }) => unknown }>(
      new URL('../../src/context/AuthContext.tsx', import.meta.url),
      {
        react: authReact,
        '../lib/supabase/auth': { signInWithOAuth: async () => ({ error: null }) },
        '../lib/supabase/client': { supabase },
      },
    ).AuthProvider;
    const LeagueProvider = compileCommonJs<{ LeagueProvider: (props: { children: null }) => unknown }>(
      new URL('../../src/context/LeagueContext.tsx', import.meta.url),
      {
        react: leagueReact,
        'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined },
        '../lib/notifications': { registerForPushNotifications: async () => undefined },
        '../lib/supabase/client': { supabase },
        '../lib/supabase/data': { getDivisions: async () => [] },
        '../lib/supabase/leagues': { getUserLeaguesDetailed: async () => ({
          status: 'success',
          leagues: [{
            id: HOCKEY_LIFE_ID, name: 'Hockey Life', slug: 'hockey-life', logo_url: null,
            city: 'London', primary_color: null, secondary_color: null,
          }],
          identityMatchesExpected: true,
          userSuffix: 'safe',
          getUser: { status: 'ok', code: null, httpStatus: null },
          membership: { status: 'success', code: null, httpStatus: 200, rowCount: 1, nonNullLeagueCount: 1 },
        }) },
        '../lib/membershipDiagnostics': {
          getSafeDiagnosticErrorFacts: () => ({ code: null, httpStatus: null }),
          getMembershipDiagnosticRuntime: () => ({ backendOrigin: null, appVersion: '1.0.0', appBuild: '29' }),
        },
        '../theme/LeagueTheme': { BLH_THEME: { primaryColor: '#22D3EE', secondaryColor: '#2563EB' } },
      },
    ).LeagueProvider;

    harness.mount(() => {
      AuthProvider({ children: null });
      LeagueProvider({ children: null });
      return null;
    });
    const settle = async () => {
      await flush();
      harness.render();
      await flush();
      harness.render();
    };
    await settle();

    leagueValue.enterGuestLeague();
    authValue.continueAsGuest();
    await settle();
    assert.equal(authValue.isGuest, true);
    assert.equal(authValue.user, null);
    assert.equal(leagueValue.isGuestLeague, true);
    assert.equal(leagueValue.activeLeague?.id, HOCKEY_LIFE_ID);

    leagueValue.exitGuestLeague();
    authValue.exitGuest();
    await settle();
    assert.equal(authValue.isGuest, false);
    assert.equal(authValue.session, null);
    assert.equal(leagueValue.isGuestLeague, false);
    assert.equal(leagueValue.activeLeague, null);
    assert.deepEqual(leagueValue.availableLeagues, []);

    const realSession = { user: { id: 'real-player' } };
    emit('SIGNED_IN', realSession);
    await settle();
    assert.equal(currentAuth().user?.id, 'real-player');
    assert.equal(authValue.isGuest, false);
    assert.equal(leagueValue.isGuestLeague, false);
    assert.equal(currentLeague().activeLeague?.id, HOCKEY_LIFE_ID);
    assert.equal(leagueValue.membershipStatus, 'ready');

    assert.deepEqual(await authValue.signOut(), { error: null });
    await settle();
    assert.equal(authValue.session, null);
    assert.equal(authValue.user, null);
    assert.equal(authValue.isGuest, false);
    assert.equal(leagueValue.activeLeague, null);
    assert.deepEqual(leagueValue.availableLeagues, []);
    assert.equal(leagueValue.isGuestLeague, false);
    assert.equal(leagueValue.membershipStatus, 'signed-out');
  });
});
