import { useFocusEffect } from '@react-navigation/native';
import React from 'react';

import {
  claimBeerGuy,
  getBeerGuyGameState,
  type BeerGuyAssignment,
} from '../lib/supabase/beerGuy';
import { updateCheckin } from '../lib/supabase/checkins';
import { supabase } from '../lib/supabase/client';

export type BeerGuyScope = {
  gameId: string;
  teamId: string;
};

export type BeerGuyAssignmentState = {
  status: 'loading' | 'ready' | 'error';
  assignment: BeerGuyAssignment | null;
  callerEligible: boolean | null;
  busy: boolean;
  error: string | null;
};

export type BeerGuyToggleResult = {
  outcome: 'claimed' | 'cleared' | 'taken' | 'error' | 'ignored';
  attendanceStatus: 'confirmed' | null;
  error: string | null;
};

type Snapshot = {
  ownerKey: string;
  entries: Record<string, BeerGuyAssignmentState>;
};

type Options = {
  scopes: BeerGuyScope[];
  currentUserId: string | null;
  enabled?: boolean;
};

const unavailableState: BeerGuyAssignmentState = {
  status: 'loading',
  assignment: null,
  callerEligible: null,
  busy: false,
  error: null,
};

function scopeKey(gameId: string, teamId: string) {
  return `${gameId}:${teamId}`;
}

function normalizeScopes(scopes: BeerGuyScope[]) {
  const unique = new Map<string, BeerGuyScope>();
  for (const scope of scopes) {
    if (!scope.gameId || !scope.teamId) continue;
    unique.set(scopeKey(scope.gameId, scope.teamId), scope);
  }
  return [...unique.values()].sort((left, right) => scopeKey(left.gameId, left.teamId).localeCompare(scopeKey(right.gameId, right.teamId)));
}

function loadingEntries(scopes: BeerGuyScope[]): Record<string, BeerGuyAssignmentState> {
  return Object.fromEntries(scopes.map((scope) => [scopeKey(scope.gameId, scope.teamId), { ...unavailableState }]));
}

export function useBeerGuyAssignments({ scopes, currentUserId, enabled = true }: Options) {
  const normalizedKey = normalizeScopes(scopes)
    .map((scope) => scopeKey(scope.gameId, scope.teamId))
    .join('|');
  const normalizedScopes = React.useMemo<BeerGuyScope[]>(() => (
    normalizedKey
      ? normalizedKey.split('|').map((key) => {
        const separator = key.indexOf(':');
        return { gameId: key.slice(0, separator), teamId: key.slice(separator + 1) };
      })
      : []
  ), [normalizedKey]);
  const ownerKey = `${enabled ? 'enabled' : 'disabled'}:${currentUserId ?? 'signed-out'}:${normalizedKey}`;
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ ownerKey: '', entries: {} });
  const committedOwner = React.useRef('');
  const mounted = React.useRef(false);
  const requestGeneration = React.useRef(0);
  const activeActions = React.useRef(new Map<string, symbol>());
  const activeActionMap = activeActions.current;

  React.useLayoutEffect(() => {
    committedOwner.current = ownerKey;
  }, [ownerKey]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      activeActionMap.clear();
    };
  }, [activeActionMap]);

  const refresh = React.useCallback(async () => {
    const request = ++requestGeneration.current;
    const requestOwner = ownerKey;
    if (!enabled || !currentUserId || normalizedScopes.length === 0) {
      if (mounted.current && committedOwner.current === requestOwner) {
        setSnapshot({ ownerKey: requestOwner, entries: loadingEntries(normalizedScopes) });
      }
      return;
    }

    setSnapshot((current) => current.ownerKey === requestOwner
      ? current
      : { ownerKey: requestOwner, entries: loadingEntries(normalizedScopes) });

    const results = await Promise.all(normalizedScopes.map(async (scope) => ({
      scope,
      result: await getBeerGuyGameState(scope.gameId, scope.teamId),
    })));
    if (!mounted.current || request !== requestGeneration.current || committedOwner.current !== requestOwner) return;

    setSnapshot((current) => {
      const prior = current.ownerKey === requestOwner ? current.entries : {};
      const entries: Record<string, BeerGuyAssignmentState> = {};
      for (const { scope, result } of results) {
        const key = scopeKey(scope.gameId, scope.teamId);
        const previous = prior[key];
        if (result.error || !result.data) {
          entries[key] = {
            status: 'error',
            assignment: previous?.assignment ?? null,
            callerEligible: previous?.callerEligible ?? null,
            busy: previous?.busy ?? false,
            error: result.error ?? 'Beer Guy is unavailable',
          };
        } else {
          entries[key] = {
            status: 'ready',
            assignment: result.data.assignment,
            callerEligible: result.data.caller_eligible,
            busy: previous?.busy ?? false,
            error: null,
          };
        }
      }
      return { ownerKey: requestOwner, entries };
    });
  }, [currentUserId, enabled, normalizedScopes, ownerKey]);

  useFocusEffect(React.useCallback(() => {
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]));

  React.useEffect(() => {
    if (!enabled || !currentUserId || normalizedScopes.length === 0) return undefined;
    type RealtimeChannel = {
      on(
        event: 'postgres_changes',
        filter: { event: '*'; schema: 'public'; table: string },
        callback: (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => void,
      ): RealtimeChannel;
      subscribe(): RealtimeChannel;
    };
    const client = supabase as unknown as {
      channel(name: string): {
        on: RealtimeChannel['on'];
        subscribe: RealtimeChannel['subscribe'];
      };
      removeChannel(channel: unknown): PromiseLike<unknown>;
    };
    const subscribedScopes = new Set(normalizedScopes.map((scope) => scopeKey(scope.gameId, scope.teamId)));
    const handleChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = payload.new?.game_id ? payload.new : payload.old;
      const gameId = typeof row?.game_id === 'string' ? row.game_id : null;
      const teamId = typeof row?.team_id === 'string' ? row.team_id : null;
      if (!gameId || !teamId || !subscribedScopes.has(scopeKey(gameId, teamId))) return;
      void refresh();
    };
    const channel = client
      .channel(`beer-guy:${ownerKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_duties' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_checkins' }, handleChange)
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [currentUserId, enabled, normalizedScopes, ownerKey, refresh]);

  const visibleEntries = snapshot.ownerKey === ownerKey ? snapshot.entries : loadingEntries(normalizedScopes);

  const getState = React.useCallback((gameId: string, teamId: string): BeerGuyAssignmentState => (
    visibleEntries[scopeKey(gameId, teamId)] ?? unavailableState
  ), [visibleEntries]);

  const setEntry = React.useCallback((key: string, update: (current: BeerGuyAssignmentState) => BeerGuyAssignmentState) => {
    setSnapshot((current) => {
      if (current.ownerKey !== ownerKey || !current.entries[key]) return current;
      return {
        ...current,
        entries: { ...current.entries, [key]: update(current.entries[key]) },
      };
    });
  }, [ownerKey]);

  const toggleBeerGuy = React.useCallback(async (gameId: string, teamId: string): Promise<BeerGuyToggleResult> => {
    const key = scopeKey(gameId, teamId);
    if (committedOwner.current !== ownerKey || !normalizedScopes.some((scope) => scopeKey(scope.gameId, scope.teamId) === key)) {
      return { outcome: 'ignored', attendanceStatus: null, error: null };
    }
    if (activeActions.current.has(key)) {
      return { outcome: 'ignored', attendanceStatus: null, error: null };
    }
    const current = visibleEntries[key];
    if (!current || current.status !== 'ready' || current.callerEligible !== true) {
      return { outcome: 'ignored', attendanceStatus: null, error: null };
    }
    const clearingSelf = Boolean(currentUserId && current.assignment?.player_id === currentUserId);
    if (current.assignment?.player_id && !clearingSelf) {
      return { outcome: 'taken', attendanceStatus: null, error: null };
    }

    const operation = Symbol(key);
    activeActions.current.set(key, operation);
    setEntry(key, (entry) => ({ ...entry, busy: true, error: null }));
    try {
      if (clearingSelf) {
        const attendanceResult = await updateCheckin(gameId, teamId, 'confirmed');
        if (committedOwner.current !== ownerKey || activeActions.current.get(key) !== operation) {
          return { outcome: 'ignored', attendanceStatus: null, error: null };
        }
        if (!attendanceResult.success) {
          const error = attendanceResult.error ?? 'Beer Guy clear failed';
          setEntry(key, (entry) => ({ ...entry, error }));
          return { outcome: 'error', attendanceStatus: null, error };
        }
        await refresh();
        return { outcome: 'cleared', attendanceStatus: 'confirmed', error: null };
      }

      const result = await claimBeerGuy(gameId, teamId);
      if (committedOwner.current !== ownerKey || activeActions.current.get(key) !== operation) {
        return { outcome: 'ignored', attendanceStatus: null, error: null };
      }
      if (result.error || !result.data) {
        const error = result.error ?? 'Beer Guy claim failed';
        setEntry(key, (entry) => ({ ...entry, error }));
        return { outcome: 'error', attendanceStatus: null, error };
      }

      const { assignment, outcome } = result.data;
      setEntry(key, (entry) => ({ ...entry, assignment, error: null }));
      await refresh();
      if (outcome === 'taken') {
        return { outcome: 'taken', attendanceStatus: null, error: null };
      }
      return { outcome: 'claimed', attendanceStatus: 'confirmed', error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Beer Guy claim failed';
      setEntry(key, (entry) => ({ ...entry, error: message }));
      return { outcome: 'error', attendanceStatus: null, error: message };
    } finally {
      if (activeActions.current.get(key) === operation) activeActions.current.delete(key);
      setEntry(key, (entry) => ({ ...entry, busy: false }));
    }
  }, [currentUserId, normalizedScopes, ownerKey, refresh, setEntry, visibleEntries]);

  return { getState, toggleBeerGuy, refresh };
}
