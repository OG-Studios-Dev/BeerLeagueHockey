import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness } from './component-harness.ts';

const GAME_ID = '50000000-0000-4000-8000-000000000001';
const TEAM_ID = '30000000-0000-4000-8000-000000000001';
const GAME_B_ID = '50000000-0000-4000-8000-000000000002';
const TEAM_B_ID = '30000000-0000-4000-8000-000000000002';
const PLAYER_ID = '40000000-0000-4000-8000-000000000011';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

const selfAssignment = {
  id: '70000000-0000-4000-8000-000000000011',
  version: 1,
  player_id: PLAYER_ID,
  status: 'pending' as const,
  player_name: 'Current Player',
  player_avatar_url: null,
};
const otherAssignment = {
  ...selfAssignment,
  id: '70000000-0000-4000-8000-000000000012',
  player_id: '40000000-0000-4000-8000-000000000012',
  player_name: 'Pat Holder',
};

type Assignment = typeof selfAssignment | typeof otherAssignment;
type AssignmentState = {
  status: 'loading' | 'ready' | 'error';
  assignment: Assignment | null;
  callerEligible: boolean | null;
  busy: boolean;
  error: string | null;
};
type ToggleResult = {
  outcome: 'claimed' | 'cleared' | 'taken' | 'error' | 'ignored';
  attendanceStatus: 'confirmed' | null;
  error: string | null;
};
type HookResult = {
  getState(gameId: string, teamId: string): AssignmentState;
  toggleBeerGuy(gameId: string, teamId: string): Promise<ToggleResult>;
  refresh(): Promise<void>;
};
type HookModule = {
  useBeerGuyAssignments(input: {
    scopes: Array<{ gameId: string; teamId: string }>;
    currentUserId: string | null;
    enabled: boolean;
  }): HookResult;
};
type StateReply = {
  data: ReturnType<typeof scopedGameState>;
  error: string | null;
};
type ClaimReply = {
  data: {
    game_id: string;
    team_id: string;
    outcome: 'claimed';
    assignment: Assignment;
  };
  error: null;
};
type RealtimePayload = {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};
type TestChannel = {
  on(event: string, filter: Record<string, string>, handler: (payload: RealtimePayload) => void): TestChannel;
  subscribe(): TestChannel;
};

function gameState(assignment: typeof selfAssignment | typeof otherAssignment | null) {
  return { game_id: GAME_ID, team_id: TEAM_ID, caller_eligible: true, assignment };
}

function scopedGameState(gameId: string, teamId: string, assignment: typeof selfAssignment | typeof otherAssignment | null) {
  return { game_id: gameId, team_id: teamId, caller_eligible: true, assignment };
}

describe('useBeerGuyAssignments', () => {
  it('does not optimistically claim and suppresses a disabled double press while refreshing server truth', async () => {
    const harness = createHookHarness();
    const claim = deferred<ClaimReply>();
    const stateReplies = [
      { data: gameState(null), error: null },
      { data: gameState(selfAssignment), error: null },
    ];
    let claimCalls = 0;
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    };
    const hook = compileCommonJs<HookModule>(
      new URL('../../src/hooks/useBeerGuyAssignments.ts', import.meta.url),
      {
        react: { ...harness.react, default: harness.react },
        '@react-navigation/native': {
          useFocusEffect: (effect: () => void | (() => void)) => harness.react.useEffect(effect, [effect]),
        },
        '../lib/supabase/beerGuy': {
          getBeerGuyGameState: async () => stateReplies.shift()!,
          claimBeerGuy: async () => { claimCalls += 1; return claim.promise; },
        },
        '../lib/supabase/checkins': {
          updateCheckin: async () => ({ success: true }),
        },
        '../lib/supabase/client': {
          supabase: {
            channel: () => channel,
            removeChannel: async () => undefined,
          },
        },
      },
    );

    harness.mount(() => hook.useBeerGuyAssignments({
      scopes: [{ gameId: GAME_ID, teamId: TEAM_ID }],
      currentUserId: PLAYER_ID,
      enabled: true,
    }));
    await settle(harness);
    let current = harness.output as HookResult;
    assert.deepEqual(current.getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: null, callerEligible: true, busy: false, error: null,
    });

    const first = current.toggleBeerGuy(GAME_ID, TEAM_ID);
    const second = current.toggleBeerGuy(GAME_ID, TEAM_ID);
    harness.render();
    current = harness.output as HookResult;
    assert.equal(claimCalls, 1);
    assert.deepEqual(current.getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: null, callerEligible: true, busy: true, error: null,
    });

    claim.resolve({
      data: { game_id: GAME_ID, team_id: TEAM_ID, outcome: 'claimed', assignment: selfAssignment },
      error: null,
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await settle(harness);
    current = harness.output as HookResult;
    assert.deepEqual(firstResult, { outcome: 'claimed', attendanceStatus: 'confirmed', error: null });
    assert.deepEqual(secondResult, { outcome: 'ignored', attendanceStatus: null, error: null });
    assert.deepEqual(current.getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: selfAssignment, callerEligible: true, busy: false, error: null,
    });
  });

  it('clears a self-assignment through confirmed attendance and refreshes the assignment without demoting attendance', async () => {
    const harness = createHookHarness();
    const stateReplies = [
      { data: gameState(selfAssignment), error: null },
      { data: gameState(null), error: null },
    ];
    const attendanceWrites: Array<[string, string, string]> = [];
    const channel = { on: () => channel, subscribe: () => channel };
    const hook = compileCommonJs<HookModule>(
      new URL('../../src/hooks/useBeerGuyAssignments.ts', import.meta.url),
      {
        react: { ...harness.react, default: harness.react },
        '@react-navigation/native': {
          useFocusEffect: (effect: () => void | (() => void)) => harness.react.useEffect(effect, [effect]),
        },
        '../lib/supabase/beerGuy': {
          getBeerGuyGameState: async () => stateReplies.shift()!,
          claimBeerGuy: async () => { throw new Error('self-clear must not call claim'); },
        },
        '../lib/supabase/checkins': {
          updateCheckin: async (gameId: string, teamId: string, status: string) => {
            attendanceWrites.push([gameId, teamId, status]);
            return { success: true };
          },
        },
        '../lib/supabase/client': {
          supabase: { channel: () => channel, removeChannel: async () => undefined },
        },
      },
    );

    harness.mount(() => hook.useBeerGuyAssignments({
      scopes: [{ gameId: GAME_ID, teamId: TEAM_ID }],
      currentUserId: PLAYER_ID,
      enabled: true,
    }));
    await settle(harness);
    const result = await (harness.output as HookResult).toggleBeerGuy(GAME_ID, TEAM_ID);
    await settle(harness);

    assert.deepEqual(result, { outcome: 'cleared', attendanceStatus: 'confirmed', error: null });
    assert.deepEqual(attendanceWrites, [[GAME_ID, TEAM_ID, 'confirmed']]);
    assert.deepEqual((harness.output as HookResult).getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: null, callerEligible: true, busy: false, error: null,
    });
  });

  it('surfaces the named server winner when a stale unassigned view loses the claim race', async () => {
    const harness = createHookHarness();
    const stateReplies = [
      { data: gameState(null), error: null },
      { data: gameState(otherAssignment), error: null },
    ];
    let claimCalls = 0;
    const channel = { on: () => channel, subscribe: () => channel };
    const hook = compileCommonJs<HookModule>(
      new URL('../../src/hooks/useBeerGuyAssignments.ts', import.meta.url),
      {
        react: { ...harness.react, default: harness.react },
        '@react-navigation/native': {
          useFocusEffect: (effect: () => void | (() => void)) => harness.react.useEffect(effect, [effect]),
        },
        '../lib/supabase/beerGuy': {
          getBeerGuyGameState: async () => stateReplies.shift()!,
          claimBeerGuy: async () => {
            claimCalls += 1;
            return {
              data: { game_id: GAME_ID, team_id: TEAM_ID, outcome: 'taken', assignment: otherAssignment },
              error: null,
            };
          },
        },
        '../lib/supabase/checkins': { updateCheckin: async () => ({ success: true }) },
        '../lib/supabase/client': {
          supabase: { channel: () => channel, removeChannel: async () => undefined },
        },
      },
    );

    harness.mount(() => hook.useBeerGuyAssignments({
      scopes: [{ gameId: GAME_ID, teamId: TEAM_ID }], currentUserId: PLAYER_ID, enabled: true,
    }));
    await settle(harness);
    const result = await (harness.output as HookResult).toggleBeerGuy(GAME_ID, TEAM_ID);
    await settle(harness);

    assert.deepEqual(result, { outcome: 'taken', attendanceStatus: null, error: null });
    assert.equal(claimCalls, 1);
    assert.deepEqual((harness.output as HookResult).getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: otherAssignment, callerEligible: true, busy: false, error: null,
    });
  });

  it('drops stale scope reads and owns scoped realtime invalidation subscriptions through cleanup', async () => {
    const harness = createHookHarness();
    const first = deferred<StateReply>();
    const second = deferred<StateReply>();
    const realtime = deferred<StateReply>();
    const reads = new Map([
      [GAME_ID, [first]],
      [GAME_B_ID, [second, realtime]],
    ]);
    const channels: Array<{
      handlers: Array<(payload: RealtimePayload) => void>;
      channel: TestChannel;
    }> = [];
    const removed: unknown[] = [];
    const hook = compileCommonJs<HookModule>(
      new URL('../../src/hooks/useBeerGuyAssignments.ts', import.meta.url),
      {
        react: { ...harness.react, default: harness.react },
        '@react-navigation/native': {
          useFocusEffect: (effect: () => void | (() => void)) => harness.react.useEffect(effect, [effect]),
        },
        '../lib/supabase/beerGuy': {
          getBeerGuyGameState: async (gameId: string) => reads.get(gameId)!.shift()!.promise,
          claimBeerGuy: async () => { throw new Error('not used'); },
        },
        '../lib/supabase/checkins': { updateCheckin: async () => ({ success: true }) },
        '../lib/supabase/client': {
          supabase: {
            channel: () => {
              const handlers: Array<(payload: RealtimePayload) => void> = [];
              const testChannel: TestChannel = {
                on: (_event, _filter, handler) => { handlers.push(handler); return testChannel; },
                subscribe: () => testChannel,
              };
              channels.push({ handlers, channel: testChannel });
              return testChannel;
            },
            removeChannel: async (channel: unknown) => { removed.push(channel); },
          },
        },
      },
    );

    let scopes = [{ gameId: GAME_ID, teamId: TEAM_ID }];
    harness.mount(() => hook.useBeerGuyAssignments({ scopes, currentUserId: PLAYER_ID, enabled: true }));
    assert.equal(channels.length, 1);

    scopes = [{ gameId: GAME_B_ID, teamId: TEAM_B_ID }];
    harness.render();
    await settle(harness);
    assert.equal(channels.length, 2);
    assert.equal(removed.length, 1);

    first.resolve({ data: scopedGameState(GAME_ID, TEAM_ID, selfAssignment), error: null });
    await settle(harness);
    assert.equal((harness.output as HookResult).getState(GAME_B_ID, TEAM_B_ID).status, 'loading');

    second.resolve({ data: scopedGameState(GAME_B_ID, TEAM_B_ID, null), error: null });
    await settle(harness);
    assert.equal((harness.output as HookResult).getState(GAME_B_ID, TEAM_B_ID).assignment, null);

    assert.equal(channels[1].handlers.length, 2);
    channels[1].handlers[0]({ new: { game_id: GAME_B_ID, team_id: TEAM_B_ID }, old: {} });
    realtime.resolve({ data: scopedGameState(GAME_B_ID, TEAM_B_ID, otherAssignment), error: null });
    await settle(harness);
    assert.equal((harness.output as HookResult).getState(GAME_B_ID, TEAM_B_ID).assignment?.player_name, 'Pat Holder');

    harness.unmount();
    assert.equal(removed.length, 2);
  });

  it('keeps the prior assignment state and exposes the exact server error without false success', async () => {
    const harness = createHookHarness();
    const channel = { on: () => channel, subscribe: () => channel };
    const hook = compileCommonJs<HookModule>(
      new URL('../../src/hooks/useBeerGuyAssignments.ts', import.meta.url),
      {
        react: { ...harness.react, default: harness.react },
        '@react-navigation/native': {
          useFocusEffect: (effect: () => void | (() => void)) => harness.react.useEffect(effect, [effect]),
        },
        '../lib/supabase/beerGuy': {
          getBeerGuyGameState: async () => ({ data: gameState(null), error: null }),
          claimBeerGuy: async () => ({ data: null, error: 'Beer Guy service unavailable' }),
        },
        '../lib/supabase/checkins': { updateCheckin: async () => ({ success: true }) },
        '../lib/supabase/client': {
          supabase: { channel: () => channel, removeChannel: async () => undefined },
        },
      },
    );

    harness.mount(() => hook.useBeerGuyAssignments({
      scopes: [{ gameId: GAME_ID, teamId: TEAM_ID }], currentUserId: PLAYER_ID, enabled: true,
    }));
    await settle(harness);
    const result = await (harness.output as HookResult).toggleBeerGuy(GAME_ID, TEAM_ID);
    await settle(harness);

    assert.deepEqual(result, { outcome: 'error', attendanceStatus: null, error: 'Beer Guy service unavailable' });
    assert.deepEqual((harness.output as HookResult).getState(GAME_ID, TEAM_ID), {
      status: 'ready', assignment: null, callerEligible: true, busy: false, error: 'Beer Guy service unavailable',
    });
  });
});
