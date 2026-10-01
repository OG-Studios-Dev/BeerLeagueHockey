import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type RpcCall = {
  name: string;
  args: Record<string, unknown>;
};

type CaptainCheckinModule = {
  updatePlayerCheckinAsCaptain(
    gameId: string,
    teamId: string,
    playerId: string,
    status: 'confirmed' | 'tentative' | 'out',
  ): Promise<{ success: boolean; error?: string }>;
  clearPlayerCheckinAsCaptain(
    gameId: string,
    teamId: string,
    playerId: string,
  ): Promise<{ success: boolean; error?: string }>;
};

function rosterRoleBuilder(role: 'captain' | 'alternate_captain' | null) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    is: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    limit: () => builder,
    maybeSingle: async () => ({ data: role ? { leadership_role: role } : null, error: null }),
  };
  return { builder, filters };
}

function loadCaptainClient(options: {
  role?: 'captain' | 'alternate_captain' | null;
  rpcResults?: Array<{ data: unknown; error: { message: string } | null }>;
  rpcThrows?: unknown[];
} = {}) {
  const calls: RpcCall[] = [];
  const tables: string[] = [];
  const roster = rosterRoleBuilder(options.role === undefined ? 'captain' : options.role);
  const rpcResults = options.rpcResults ?? [{
    data: {
      outcome: 'set', operation: 'set', status: 'tentative', affected_rows: 1,
      checkin_id: '60000000-0000-4000-8000-000000000001',
    },
    error: null,
  }];
  const rpcThrows = options.rpcThrows ?? [];

  const captainClient = compileCommonJs<CaptainCheckinModule>(
    new URL('../../src/lib/supabase/captain.ts', import.meta.url),
    {
      './checkins': {},
      './client': {
        supabase: {
          auth: { getUser: async () => ({ data: { user: { id: 'captain-user' } } }) },
          from: (table: string) => {
            tables.push(table);
            if (table !== 'team_rosters') {
              throw new Error(`direct table access is forbidden for captain check-in mutation: ${table}`);
            }
            return roster.builder;
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            calls.push({ name, args });
            if (rpcThrows.length) throw rpcThrows.shift();
            return rpcResults.shift() ?? { data: null, error: null };
          },
        },
      },
    },
  );

  return { captainClient, calls, tables, rosterFilters: roster.filters };
}

describe('captain check-in RPC adapter', () => {
  it('keeps the captain UI role gate and sends a set operation only to the reviewed RPC', async () => {
    const run = loadCaptainClient({ role: 'alternate_captain' });
    const result = await run.captainClient.updatePlayerCheckinAsCaptain(
      'game-1',
      'team-1',
      'player-1',
      'tentative',
    );

    assert.deepEqual(result, { success: true });
    assert.deepEqual(run.calls, [{
      name: 'captain_manage_game_checkin',
      args: {
        p_game_id: 'game-1',
        p_team_id: 'team-1',
        p_player_id: 'player-1',
        p_operation: 'set',
        p_status: 'tentative',
      },
    }]);
    assert.deepEqual(run.tables, ['team_rosters']);
    assert.deepEqual(run.rosterFilters, [
      ['team_id', 'team-1'],
      ['player_id', 'captain-user'],
      ['status', 'active'],
      ['end_date', null],
    ]);
  });

  it('maps Waiting to an explicit reset operation with no direct delete fallback', async () => {
    const run = loadCaptainClient({ rpcResults: [{
      data: {
        outcome: 'already_waiting', operation: 'reset', status: null,
        affected_rows: 0, checkin_id: null,
      },
      error: null,
    }] });
    const result = await run.captainClient.clearPlayerCheckinAsCaptain('game-2', 'team-2', 'player-2');

    assert.deepEqual(result, { success: true });
    assert.deepEqual(run.calls, [{
      name: 'captain_manage_game_checkin',
      args: {
        p_game_id: 'game-2',
        p_team_id: 'team-2',
        p_player_id: 'player-2',
        p_operation: 'reset',
        p_status: null,
      },
    }]);
    assert.deepEqual(run.tables, ['team_rosters']);
  });

  it('accepts the exact one-row reset variant', async () => {
    const run = loadCaptainClient({ rpcResults: [{
      data: {
        outcome: 'reset', operation: 'reset', status: null, affected_rows: 1,
        checkin_id: '60000000-0000-4000-8000-000000000002',
      },
      error: null,
    }] });
    assert.deepEqual(
      await run.captainClient.clearPlayerCheckinAsCaptain('game-1', 'team-1', 'player-1'),
      { success: true },
    );
  });

  it('propagates RPC failures and never reports a failed set or reset as success', async () => {
    const run = loadCaptainClient({
      rpcResults: [
        { data: null, error: { message: 'captain set rejected' } },
        { data: null, error: { message: 'zero-row reset rejected' } },
      ],
    });

    assert.deepEqual(
      await run.captainClient.updatePlayerCheckinAsCaptain('game-1', 'team-1', 'player-1', 'out'),
      { success: false, error: 'captain set rejected' },
    );
    assert.deepEqual(
      await run.captainClient.clearPlayerCheckinAsCaptain('game-1', 'team-1', 'player-1'),
      { success: false, error: 'zero-row reset rejected' },
    );
    assert.equal(run.calls.length, 2);
  });

  it('normalizes thrown Error and non-Error failures for both operations', async () => {
    const setRun = loadCaptainClient({ rpcThrows: [new Error('network set failure')] });
    assert.deepEqual(
      await setRun.captainClient.updatePlayerCheckinAsCaptain('game-1', 'team-1', 'player-1', 'out'),
      { success: false, error: 'network set failure' },
    );
    const resetRun = loadCaptainClient({ rpcThrows: [{ code: 'offline' }] });
    assert.deepEqual(
      await resetRun.captainClient.clearPlayerCheckinAsCaptain('game-1', 'team-1', 'player-1'),
      { success: false, error: 'Captain check-in request failed' },
    );
  });

  it('rejects null, malformed, extra-key, mismatched, and false write replies', async () => {
    const invalidSetReplies = [
      null,
      { affected_rows: 1 },
      { outcome: 'set', operation: 'set', status: 'out', affected_rows: 0, checkin_id: '60000000-0000-4000-8000-000000000001' },
      { outcome: 'set', operation: 'reset', status: 'out', affected_rows: 1, checkin_id: '60000000-0000-4000-8000-000000000001' },
      { outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1, checkin_id: 'not-a-uuid' },
      { outcome: 'set', operation: 'set', status: 'out', affected_rows: 1, checkin_id: '60000000-0000-4000-8000-000000000001', extra: true },
    ];
    for (const data of invalidSetReplies) {
      const run = loadCaptainClient({ rpcResults: [{ data, error: null }] });
      assert.deepEqual(
        await run.captainClient.updatePlayerCheckinAsCaptain('game-1', 'team-1', 'player-1', 'out'),
        { success: false, error: 'Invalid captain check-in RPC response' },
      );
    }

    const invalidResetReplies = [
      null,
      { outcome: 'already_waiting', operation: 'reset', status: null, affected_rows: 1, checkin_id: null },
      { outcome: 'reset', operation: 'reset', status: null, affected_rows: 0, checkin_id: null },
      { outcome: 'reset', operation: 'reset', status: 'out', affected_rows: 1, checkin_id: '60000000-0000-4000-8000-000000000001' },
    ];
    for (const data of invalidResetReplies) {
      const run = loadCaptainClient({ rpcResults: [{ data, error: null }] });
      assert.deepEqual(
        await run.captainClient.clearPlayerCheckinAsCaptain('game-1', 'team-1', 'player-1'),
        { success: false, error: 'Invalid captain check-in RPC response' },
      );
    }
  });

  it('does not call the RPC when the existing local captain role check fails', async () => {
    const run = loadCaptainClient({ role: null });

    assert.deepEqual(
      await run.captainClient.updatePlayerCheckinAsCaptain('game-1', 'team-1', 'player-1', 'confirmed'),
      { success: false, error: 'Captain access required' },
    );
    assert.deepEqual(
      await run.captainClient.clearPlayerCheckinAsCaptain('game-1', 'team-1', 'player-1'),
      { success: false, error: 'Captain access required' },
    );
    assert.deepEqual(run.calls, []);
  });
});
