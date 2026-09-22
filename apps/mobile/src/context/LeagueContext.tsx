import * as SecureStore from 'expo-secure-store';
import { registerForPushNotifications } from '../lib/notifications';
import React from 'react';

import { supabase } from '../lib/supabase/client';
import { getDivisions, type Division } from '../lib/supabase/data';
import { getUserLeaguesDetailed, type LeagueRow, type UserLeagueLookupResult } from '../lib/supabase/leagues';
import {
  HOCKEY_LIFE_PRIMARY,
  HOCKEY_LIFE_NAME,
  HOCKEY_LIFE_ID,
  HOCKEY_LIFE_SLUG,
  HOCKEY_LIFE_SECONDARY,
  isHockeyLifeLeague,
  selectHockeyLifeMembership,
} from '../config/hockeyLife';
import {
  getSafeDiagnosticErrorFacts,
  getMembershipDiagnosticRuntime,
  type MembershipDiagnosticEntry,
  type MembershipDiagnostics,
  type MembershipLoadStatus,
  type MembershipLoadTrigger,
} from '../lib/membershipDiagnostics';
import { BLH_THEME, type LeagueTheme } from '../theme/LeagueTheme';

export type League = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  theme: LeagueTheme;
  city: string | null;
};

export type { Division };

const PERSIST_KEY = 'blh_active_league_id';
const MAX_DIAGNOSTIC_ENTRIES = 6;
let preferenceQueue: Promise<void> = Promise.resolve();
let membershipRequestSequence = 0;
let identityGenerationSequence = 0;
let sessionResolutionSequence = 0;

function runPreferenceOperation<T>(operation: () => Promise<T>) {
  const result = preferenceQueue.then(operation, operation);
  preferenceQueue = result.then(() => undefined, () => undefined);
  return result;
}

type LeagueContextValue = {
  activeLeague: League | null;
  activeTheme: LeagueTheme;
  availableLeagues: League[];
  isLoading: boolean;
  membershipStatus: MembershipLoadStatus;
  membershipDiagnostics: MembershipDiagnostics;
  retryMemberships: () => void;
  setActiveLeague: (league: League | null) => void;
  previewLeague: (league: League) => void;
  enterGuestLeague: () => void;
  exitGuestLeague: () => void;
  isGuestLeague: boolean;
  activeDivision: Division | null;
  setActiveDivision: (division: Division | null) => void;
  divisions: Division[];
};

function rowToLeague(row: LeagueRow): League {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    city: row.city,
    theme: {
      ...BLH_THEME,
      primaryColor: row.primary_color ?? HOCKEY_LIFE_PRIMARY,
      secondaryColor: row.secondary_color ?? HOCKEY_LIFE_SECONDARY,
      logoUrl: row.logo_url,
      leagueName: row.name,
    },
  };
}

const HOCKEY_LIFE_PUBLIC_LEAGUE: League = {
  id: HOCKEY_LIFE_ID,
  name: HOCKEY_LIFE_NAME,
  slug: HOCKEY_LIFE_SLUG,
  logoUrl: null,
  city: 'London, Ontario',
  theme: {
    ...BLH_THEME,
    primaryColor: HOCKEY_LIFE_PRIMARY,
    secondaryColor: HOCKEY_LIFE_SECONDARY,
    logoUrl: null,
    leagueName: HOCKEY_LIFE_NAME,
  },
};

const LeagueContext = React.createContext<LeagueContextValue | undefined>(undefined);

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [activeLeague, _setActiveLeague] = React.useState<League | null>(null);
  const [availableLeagues, setAvailableLeagues] = React.useState<League[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeDivision, setActiveDivision] = React.useState<Division | null>(null);
  const [divisions, setDivisions] = React.useState<Division[]>([]);
  const [isGuestLeague, setIsGuestLeague] = React.useState(false);
  const isGuestLeagueRef = React.useRef(false);
  const [membershipStatus, setMembershipStatus] = React.useState<MembershipLoadStatus>('loading');
  const [diagnosticEntries, setDiagnosticEntries] = React.useState<MembershipDiagnosticEntry[]>([]);
  const authLoadGeneration = React.useRef(0);
  const selectionGeneration = React.useRef(0);
  const divisionLoadGeneration = React.useRef(0);
  const identityGeneration = React.useRef(++identityGenerationSequence);
  const currentIdentity = React.useRef<string | null>(null);
  const latestMembershipRequest = React.useRef(0);
  const manualRetryRequest = React.useRef<number | null>(null);
  const latestSessionResolution = React.useRef(0);
  const pendingSessionResolution = React.useRef<number | null>(null);
  const hasSessionResolutionFailure = React.useRef(false);
  const hasSuccessfulMembership = React.useRef(false);
  const isMounted = React.useRef(true);
  const availableLeaguesRef = React.useRef<League[]>([]);
  const diagnosticRuntime = React.useMemo(
    () => getMembershipDiagnosticRuntime(),
    [],
  );

  availableLeaguesRef.current = availableLeagues;

  const replaceAvailableLeagues = React.useCallback((leagues: League[]) => {
    availableLeaguesRef.current = leagues;
    setAvailableLeagues(leagues);
  }, []);

  const replaceActiveLeague = React.useCallback((league: League | null) => {
    _setActiveLeague(league);
  }, []);

  const upsertDiagnostic = React.useCallback((entry: MembershipDiagnosticEntry) => {
    setDiagnosticEntries((current) => {
      const withoutEntry = current.filter(({ requestId }) => requestId !== entry.requestId);
      return [...withoutEntry, entry].sort((a, b) => a.requestId - b.requestId).slice(-MAX_DIAGNOSTIC_ENTRIES);
    });
  }, []);

  const clearLeagueState = React.useCallback((clearPersisted: boolean) => {
    selectionGeneration.current += 1;
    divisionLoadGeneration.current += 1;
    replaceAvailableLeagues([]);
    replaceActiveLeague(null);
    isGuestLeagueRef.current = false;
    setIsGuestLeague(false);
    setActiveDivision(null);
    setDivisions([]);
    if (clearPersisted) {
      void runPreferenceOperation(() => SecureStore.deleteItemAsync(PERSIST_KEY)).catch(() => {});
    }
  }, [replaceActiveLeague, replaceAvailableLeagues]);

  const activeLeagueId = activeLeague?.id;

  // Load divisions whenever activeLeague changes; default to first division
  React.useEffect(() => {
    const generation = ++divisionLoadGeneration.current;
    let isCurrent = true;

    if (!activeLeagueId) {
      setDivisions([]);
      setActiveDivision(null);
      return () => {
        isCurrent = false;
      };
    }
    getDivisions(activeLeagueId)
      .then((divs) => {
        if (!isCurrent || generation !== divisionLoadGeneration.current) return;
        setDivisions(divs);
        setActiveDivision(null);
      })
      .catch(() => {
        if (!isCurrent || generation !== divisionLoadGeneration.current) return;
        setDivisions([]);
        setActiveDivision(null);
      });

    return () => {
      isCurrent = false;
      if (generation === divisionLoadGeneration.current) {
        divisionLoadGeneration.current += 1;
      }
    };
  }, [activeLeagueId]);

  const setActiveLeague = React.useCallback(async (league: League | null) => {
    if (!league || !isHockeyLifeLeague(league)) return;
    selectionGeneration.current += 1;
    if (league.id !== activeLeagueId) {
      divisionLoadGeneration.current += 1;
    }
    replaceActiveLeague(league);
    isGuestLeagueRef.current = false;
    setIsGuestLeague(false);
    await runPreferenceOperation(() => SecureStore.setItemAsync(PERSIST_KEY, league.id)).catch(() => {});
  }, [activeLeagueId, replaceActiveLeague]);

  const previewLeague = React.useCallback((league: League) => {
    if (!isHockeyLifeLeague(league)) return;
    if (league.id !== activeLeagueId) {
      divisionLoadGeneration.current += 1;
    }
    replaceActiveLeague(league);
    isGuestLeagueRef.current = true;
    setIsGuestLeague(true);
  }, [activeLeagueId, replaceActiveLeague]);

  const changeIdentity = React.useCallback((userId: string | null, clearPersisted: boolean) => {
    if (currentIdentity.current === userId && userId !== null) return;
    currentIdentity.current = userId;
    identityGeneration.current = ++identityGenerationSequence;
    authLoadGeneration.current += 1;
    latestMembershipRequest.current = 0;
    manualRetryRequest.current = null;
    hasSuccessfulMembership.current = false;
    setDiagnosticEntries([]);
    clearLeagueState(clearPersisted);
  }, [clearLeagueState]);

  const loadUserLeagues = React.useCallback((trigger: MembershipLoadTrigger, expectedUserId: string) => {
    if (!isMounted.current || currentIdentity.current !== expectedUserId) return;
    if (trigger === 'manual-retry' && manualRetryRequest.current !== null) return;

    const requestId = ++membershipRequestSequence;
    const loadGeneration = ++authLoadGeneration.current;
    const accountGeneration = identityGeneration.current;
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const startingEntry: MembershipDiagnosticEntry = {
      requestId,
      generation: accountGeneration,
      trigger,
      phase: 'requesting',
      outcome: 'pending',
      sessionPresent: true,
      startedAt,
      finishedAt: null,
      durationMs: null,
      userSuffix: null,
      getSessionCode: null,
      getSessionHttpStatus: null,
      getUserStatus: 'pending',
      getUserCode: null,
      getUserHttpStatus: null,
      membershipResponseStatus: 'pending',
      membershipErrorCode: null,
      membershipHttpStatus: null,
      rowCount: null,
      nonNullLeagueCount: null,
      commit: 'pending',
      availableLeagueCount: availableLeaguesRef.current.length,
    };

    latestMembershipRequest.current = requestId;
    if (trigger === 'manual-retry') manualRetryRequest.current = requestId;
    setMembershipStatus('loading');
    setIsLoading(true);
    upsertDiagnostic(startingEntry);

    void getUserLeaguesDetailed(expectedUserId)
      .catch((): UserLeagueLookupResult => ({
        status: 'auth-error',
        leagues: [],
        identityMatchesExpected: null,
        userSuffix: null,
        getUser: { status: 'error', code: null, httpStatus: null },
        membership: {
          status: 'not-requested',
          code: null,
          httpStatus: null,
          rowCount: null,
          nonNullLeagueCount: null,
        },
      }))
      .then(async (result) => {
        const accountIsCurrent = isMounted.current
          && accountGeneration === identityGeneration.current
          && currentIdentity.current === expectedUserId;
        if (!accountIsCurrent) return;

        if (manualRetryRequest.current === requestId) manualRetryRequest.current = null;
        const requestIsCurrent = latestMembershipRequest.current === requestId
          && loadGeneration === authLoadGeneration.current;
        let commit: MembershipDiagnosticEntry['commit'] = 'dropped';
        let outcome: MembershipDiagnosticEntry['outcome'] = result.status;

        if (requestIsCurrent && result.identityMatchesExpected === false) {
          outcome = 'identity-mismatch';
          setMembershipStatus('error');
          setIsLoading(false);
        } else if (requestIsCurrent && result.status === 'success') {
          const memberships = selectHockeyLifeMembership(result.leagues, null);
          const leagues = memberships.available.map(rowToLeague);
          replaceAvailableLeagues(leagues);
          hasSuccessfulMembership.current = true;
          commit = 'committed';
          outcome = leagues.length === 0 ? 'empty' : 'success';

          const selection = selectionGeneration.current;
          try {
            const savedId = await runPreferenceOperation(() => SecureStore.getItemAsync(PERSIST_KEY));
            if (
              isMounted.current
              && requestId === latestMembershipRequest.current
              && accountGeneration === identityGeneration.current
              && currentIdentity.current === expectedUserId
              && selection === selectionGeneration.current
            ) {
              const selectionResult = selectHockeyLifeMembership(leagues, savedId);
              if (selectionResult.shouldClearPersistedSelection) {
                await runPreferenceOperation(() => SecureStore.deleteItemAsync(PERSIST_KEY)).catch(() => {});
              }
              if (
                isMounted.current
                && requestId === latestMembershipRequest.current
                && accountGeneration === identityGeneration.current
                && currentIdentity.current === expectedUserId
                && selection === selectionGeneration.current
              ) {
                replaceActiveLeague(selectionResult.active);
                if (selectionResult.active) {
                  await runPreferenceOperation(() => SecureStore.setItemAsync(PERSIST_KEY, selectionResult.active!.id)).catch(() => {});
                }
              }
            }
          } catch {
            // Membership data is still valid when local selection restoration fails.
          }

          if (
            isMounted.current
            && requestId === latestMembershipRequest.current
            && loadGeneration === authLoadGeneration.current
            && accountGeneration === identityGeneration.current
            && currentIdentity.current === expectedUserId
          ) {
            setMembershipStatus(leagues.length === 0 ? 'empty' : 'ready');
            setIsLoading(false);
          }
        } else if (requestIsCurrent) {
          if (result.status === 'incomplete' && !hasSuccessfulMembership.current) {
            replaceAvailableLeagues(selectHockeyLifeMembership(result.leagues, null).available.map(rowToLeague));
            commit = 'committed';
          } else {
            commit = 'retained';
          }
          setMembershipStatus(result.status === 'incomplete' ? 'incomplete' : 'error');
          setIsLoading(false);
        }

        if (!isMounted.current || accountGeneration !== identityGeneration.current || currentIdentity.current !== expectedUserId) {
          return;
        }
        const finishedMs = Date.now();
        upsertDiagnostic({
          ...startingEntry,
          phase: 'completed',
          outcome,
          finishedAt: new Date(finishedMs).toISOString(),
          durationMs: Math.max(0, finishedMs - startedMs),
          userSuffix: outcome === 'identity-mismatch' ? null : result.userSuffix,
          getUserStatus: result.getUser.status,
          getUserCode: result.getUser.code,
          getUserHttpStatus: result.getUser.httpStatus,
          membershipResponseStatus: result.membership.status,
          membershipErrorCode: result.membership.code,
          membershipHttpStatus: result.membership.httpStatus,
          rowCount: result.membership.rowCount,
          nonNullLeagueCount: result.membership.nonNullLeagueCount,
          commit,
          availableLeagueCount: availableLeaguesRef.current.length,
        });
      });
  }, [replaceActiveLeague, replaceAvailableLeagues, upsertDiagnostic]);

  const invalidateSessionResolution = React.useCallback(() => {
    latestSessionResolution.current = ++sessionResolutionSequence;
    pendingSessionResolution.current = null;
  }, []);

  const resolveSession = React.useCallback((trigger: 'bootstrap' | 'manual-retry') => {
    if (!isMounted.current || pendingSessionResolution.current !== null) return;

    const resolutionId = ++sessionResolutionSequence;
    const requestId = ++membershipRequestSequence;
    const startedMs = Date.now();
    const startingEntry: MembershipDiagnosticEntry = {
      requestId,
      generation: identityGeneration.current,
      trigger,
      phase: 'requesting',
      outcome: 'pending',
      sessionPresent: null,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: null,
      durationMs: null,
      userSuffix: null,
      getSessionCode: null,
      getSessionHttpStatus: null,
      getUserStatus: 'not-requested',
      getUserCode: null,
      getUserHttpStatus: null,
      membershipResponseStatus: 'not-requested',
      membershipErrorCode: null,
      membershipHttpStatus: null,
      rowCount: null,
      nonNullLeagueCount: null,
      commit: 'pending',
      availableLeagueCount: availableLeaguesRef.current.length,
    };
    latestSessionResolution.current = resolutionId;
    pendingSessionResolution.current = resolutionId;
    setMembershipStatus('loading');
    setIsLoading(true);
    upsertDiagnostic(startingEntry);

    const resolutionIsCurrent = () => isMounted.current
      && latestSessionResolution.current === resolutionId
      && pendingSessionResolution.current === resolutionId;
    const settleSessionError = (error: unknown) => {
      if (!resolutionIsCurrent()) return;
      pendingSessionResolution.current = null;
      hasSessionResolutionFailure.current = true;
      clearLeagueState(false);
      setMembershipStatus('error');
      setIsLoading(false);
      const finishedMs = Date.now();
      const errorFacts = getSafeDiagnosticErrorFacts(error);
      upsertDiagnostic({
        ...startingEntry,
        phase: 'completed',
        outcome: 'session-error',
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: Math.max(0, finishedMs - startedMs),
        getSessionCode: errorFacts.code,
        getSessionHttpStatus: errorFacts.httpStatus,
        commit: 'retained',
        availableLeagueCount: availableLeaguesRef.current.length,
      });
    };

    void supabase.auth.getSession()
      .then((response) => {
        if (!resolutionIsCurrent()) return;
        if (response.error) {
          settleSessionError(response.error);
          return;
        }

        pendingSessionResolution.current = null;
        hasSessionResolutionFailure.current = false;
        const session = response.data.session;
        if (session) {
          changeIdentity(session.user.id, false);
          loadUserLeagues(trigger, session.user.id);
        } else {
          changeIdentity(null, false);
          clearLeagueState(false);
          setMembershipStatus('signed-out');
          setIsLoading(false);
        }
      })
      .catch(settleSessionError);
  }, [changeIdentity, clearLeagueState, loadUserLeagues, upsertDiagnostic]);

  const retryMemberships = React.useCallback(() => {
    const userId = currentIdentity.current;
    if (userId) {
      if (pendingSessionResolution.current === null) loadUserLeagues('manual-retry', userId);
    } else if (hasSessionResolutionFailure.current) {
      resolveSession('manual-retry');
    }
  }, [loadUserLeagues, resolveSession]);

  const enterGuestLeague = React.useCallback(() => {
    invalidateSessionResolution();
    changeIdentity(null, true);
    replaceAvailableLeagues([HOCKEY_LIFE_PUBLIC_LEAGUE]);
    replaceActiveLeague(HOCKEY_LIFE_PUBLIC_LEAGUE);
    isGuestLeagueRef.current = true;
    setIsGuestLeague(true);
    setMembershipStatus('signed-out');
    setIsLoading(false);
  }, [changeIdentity, invalidateSessionResolution, replaceActiveLeague, replaceAvailableLeagues]);

  const exitGuestLeague = React.useCallback(() => {
    invalidateSessionResolution();
    changeIdentity(null, true);
    setMembershipStatus('signed-out');
    setIsLoading(false);
  }, [changeIdentity, invalidateSessionResolution]);

  React.useEffect(() => {
    isMounted.current = true;
    resolveSession('bootstrap');

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted.current) return;
      if (event === 'SIGNED_IN' && session) {
        invalidateSessionResolution();
        hasSessionResolutionFailure.current = false;
        registerForPushNotifications().catch(() => {});
        changeIdentity(session.user.id, false);
        loadUserLeagues('sign-in', session.user.id);
      } else if (event === 'SIGNED_OUT') {
        if (isGuestLeagueRef.current) return;
        invalidateSessionResolution();
        hasSessionResolutionFailure.current = false;
        changeIdentity(null, true);
        setMembershipStatus('signed-out');
        setIsLoading(false);
      } else if (event === 'INITIAL_SESSION') {
        if (session) {
          invalidateSessionResolution();
          hasSessionResolutionFailure.current = false;
          changeIdentity(session.user.id, false);
          loadUserLeagues('bootstrap', session.user.id);
        } else if (!hasSessionResolutionFailure.current) {
          if (isGuestLeagueRef.current) return;
          // INITIAL_SESSION(null) is enough to render signed-out, but it does not
          // cancel an independently pending getSession resolution. The SDK also
          // emits this callback on an initialization error path, whose returned
          // or thrown failure must still be allowed to become distinguishable.
          if (pendingSessionResolution.current === null) invalidateSessionResolution();
          changeIdentity(null, false);
          clearLeagueState(false);
          setMembershipStatus('signed-out');
          setIsLoading(false);
        }
      }
    });

    return () => {
      isMounted.current = false;
      invalidateSessionResolution();
      authLoadGeneration.current += 1;
      selectionGeneration.current += 1;
      currentIdentity.current = null;
      manualRetryRequest.current = null;
      subscription.unsubscribe();
    };
  }, [changeIdentity, clearLeagueState, invalidateSessionResolution, loadUserLeagues, resolveSession]);

  const membershipDiagnostics = React.useMemo<MembershipDiagnostics>(() => ({
    ...diagnosticRuntime,
    entries: diagnosticEntries,
  }), [diagnosticEntries, diagnosticRuntime]);

  const value = React.useMemo<LeagueContextValue>(
    () => ({
      activeLeague,
      activeTheme: activeLeague?.theme ?? BLH_THEME,
      availableLeagues,
      isLoading,
      membershipStatus,
      membershipDiagnostics,
      retryMemberships,
      setActiveLeague,
      previewLeague,
      enterGuestLeague,
      exitGuestLeague,
      isGuestLeague,
      activeDivision,
      setActiveDivision,
      divisions,
    }),
    [activeLeague, availableLeagues, isLoading, membershipStatus, membershipDiagnostics, retryMemberships, setActiveLeague, previewLeague, enterGuestLeague, exitGuestLeague, isGuestLeague, activeDivision, divisions],
  );

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  const context = React.useContext(LeagueContext);
  if (!context) {
    throw new Error('useLeague must be used within a LeagueProvider');
  }
  return context;
}
