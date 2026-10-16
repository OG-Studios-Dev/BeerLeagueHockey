import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type CheckinsModule = {
  updateCheckin(
    gameId: string,
    teamId: string,
    status: 'confirmed' | 'tentative' | 'out',
    note?: string,
  ): Promise<{ success: boolean; error?: string }>;
};

function loadCheckins(options: {
  data?: unknown;
  error?: { message: string } | null;
  throws?: unknown;
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let directWrites = 0;
  const checkinsModule = compileCommonJs<CheckinsModule>(
    new URL('../../src/lib/supabase/checkins.ts', import.meta.url),
    {
      './client': {
        supabase: {
          auth: { getUser: async () => ({ data: { user: { id: 'player-1' } } }) },
          from: () => {
            directWrites += 1;
            return { upsert: async () => ({ error: null }) };
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            calls.push({ name, args });
            if ('throws' in options) throw options.throws;
            return {
              data: options.data ?? {
                game_id: args.p_game_id,
                team_id: args.p_team_id,
                outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1,
                checkin_id: '60000000-0000-4000-8000-000000000001',
              },
              error: options.error ?? null,
            };
          },
        },
      },
    },
  );
  return { checkinsModule, calls, get directWrites() { return directWrites; } };
}

describe('atomic self check-in boundary', () => {
  it('routes every attendance response through update_my_game_checkin so Beer assignment cleanup is atomic', async () => {
    const run = loadCheckins({
      data: {
        game_id: 'game-1', team_id: 'team-1',
        outcome: 'set', operation: 'set', status: 'tentative', affected_rows: 1,
        checkin_id: '60000000-0000-4000-8000-000000000001',
      },
    });
    assert.deepEqual(
      await run.checkinsModule.updateCheckin('game-1', 'team-1', 'tentative', 'May be late'),
      { success: true },
    );
    assert.deepEqual(run.calls, [{
      name: 'update_my_game_checkin',
      args: {
        p_game_id: 'game-1', p_team_id: 'team-1', p_status: 'tentative', p_note: 'May be late',
      },
    }]);
    assert.equal(run.directWrites, 0);
  });

  it('does not report server errors or malformed acknowledgements as success', async () => {
    const failed = loadCheckins({ error: { message: 'future game required' }, data: null });
    assert.deepEqual(
      await failed.checkinsModule.updateCheckin('game-1', 'team-1', 'out'),
      { success: false, error: 'future game required' },
    );

    const malformed = loadCheckins({ data: { outcome: 'set', affected_rows: 0 } });
    assert.deepEqual(
      await malformed.checkinsModule.updateCheckin('game-1', 'team-1', 'confirmed'),
      { success: false, error: 'Invalid check-in RPC response' },
    );
  });

  it('accepts any canonical PostgreSQL UUID shape returned by the RPC, including UUIDv7', async () => {
    const run = loadCheckins({
      data: {
        game_id: 'game-1', team_id: 'team-1',
        outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1,
        checkin_id: '60000000-0000-7000-8000-000000000007',
      },
    });
    assert.deepEqual(
      await run.checkinsModule.updateCheckin('game-1', 'team-1', 'confirmed'),
      { success: true },
    );
  });

  it('binds exact acknowledgements to the requested game and team', async () => {
    const invalidReplies = [
      {
        game_id: 'other-game', team_id: 'team-1',
        outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1,
        checkin_id: '60000000-0000-4000-8000-000000000001',
      },
      {
        game_id: 'game-1', team_id: 'other-team',
        outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1,
        checkin_id: '60000000-0000-4000-8000-000000000001',
      },
      {
        game_id: 'game-1', team_id: 'team-1',
        outcome: 'set', operation: 'set', status: 'confirmed', affected_rows: 1,
        checkin_id: '60000000-0000-4000-8000-000000000001', extra: true,
      },
    ];

    for (const data of invalidReplies) {
      const run = loadCheckins({ data });
      assert.deepEqual(
        await run.checkinsModule.updateCheckin('game-1', 'team-1', 'confirmed'),
        { success: false, error: 'Invalid check-in RPC response' },
      );
    }
  });
});
