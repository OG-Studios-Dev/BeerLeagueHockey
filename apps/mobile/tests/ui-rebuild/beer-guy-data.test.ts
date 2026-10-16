import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type RpcCall = { client: 'authenticated' | 'public'; name: string; args: Record<string, unknown> };
type BeerGuyModule = {
  claimBeerGuy(gameId: string, teamId: string): Promise<{ data: unknown; error: string | null }>;
  manageBeerGuyAsCaptain(
    gameId: string,
    teamId: string,
    playerId: string | null,
    expectedAssignmentId: string | null,
    expectedVersion: number | null,
  ): Promise<{ data: unknown; error: string | null }>;
  getBeerGuyGameState(gameId: string, teamId: string): Promise<{ data: unknown; error: string | null }>;
  getBeerGuyTracker(teamId: string): Promise<{ data: unknown; error: string | null }>;
  getPublicNextBeerGuyAssignment(gameId: string, teamId: string): Promise<{ data: unknown; error: string | null }>;
};

const UUIDS = {
  game: '50000000-0000-4000-8000-000000000001',
  gameV7: '50000000-0000-7000-8000-000000000007',
  importedGame: '50000000-0000-f000-0000-00000000000f',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000011',
  otherPlayer: '40000000-0000-4000-8000-000000000012',
  assignment: '70000000-0000-4000-8000-000000000011',
  otherAssignment: '70000000-0000-4000-8000-000000000012',
};

function loadBeerGuy(results: Array<{ data: unknown; error: { message: string } | null }> = []) {
  const calls: RpcCall[] = [];
  const makeClient = (client: RpcCall['client']) => ({
    from: () => { throw new Error(`${client} Beer Guy boundary must not use direct table access`); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ client, name, args });
      return results.shift() ?? { data: null, error: null };
    },
  });
  const beerGuyModule = compileCommonJs<BeerGuyModule>(
    new URL('../../src/lib/supabase/beerGuy.ts', import.meta.url),
    { './client': { supabase: makeClient('authenticated'), publicSupabase: makeClient('public') } },
  );
  return { beerGuyModule, calls };
}

const assignment = {
  id: UUIDS.assignment,
  version: 3,
  player_id: UUIDS.player,
  player_name: 'Player Eleven',
  player_avatar_url: null,
  status: 'pending',
};
const mutationScope = { game_id: UUIDS.game, team_id: UUIDS.team };
const gameState = {
  game_id: UUIDS.game,
  team_id: UUIDS.team,
  caller_eligible: true,
  assignment,
};
const tracker = {
  team_id: UUIDS.team,
  season_id: '20000000-0000-4000-8000-000000000001',
  timezone: 'America/Toronto',
  roster: [{
    player_id: UUIDS.player, full_name: 'Player Eleven', avatar_url: null,
    jersey_number: 11, position: 'Forward', is_goalie: false,
  }],
  upcoming_games: [{ game_id: UUIDS.game, scheduled_at: '2026-10-17T00:00:00Z', assignment }],
  history: [{
    assignment_id: UUIDS.assignment, game_id: UUIDS.game, player_id: UUIDS.player,
    player_name: 'Player Eleven', player_deleted: false, game_date: '2026-10-10',
  }],
};

describe('Beer Guy RPC-only mobile data boundary', () => {
  it('maps self-claim and captain CAS mutations to the exact server contract', async () => {
    const claimReply = { ...mutationScope, outcome: 'claimed', assignment: { ...assignment, version: 1 } };
    const captainReply = {
      ...mutationScope,
      outcome: 'cleared',
      assignment: {
        ...assignment, version: 4, player_id: null, player_name: null, player_avatar_url: null,
      },
    };
    const run = loadBeerGuy([{ data: claimReply, error: null }, { data: captainReply, error: null }]);

    assert.deepEqual(await run.beerGuyModule.claimBeerGuy(UUIDS.game, UUIDS.team), { data: claimReply, error: null });
    assert.deepEqual(
      await run.beerGuyModule.manageBeerGuyAsCaptain(UUIDS.game, UUIDS.team, null, UUIDS.assignment, 3),
      { data: captainReply, error: null },
    );
    assert.deepEqual(run.calls, [
      { client: 'authenticated', name: 'beer_guy_claim', args: { p_game_id: UUIDS.game, p_team_id: UUIDS.team } },
      {
        client: 'authenticated', name: 'beer_guy_captain_manage',
        args: {
          p_game_id: UUIDS.game,
          p_team_id: UUIDS.team,
          p_player_id: null,
          p_expected_assignment_id: UUIDS.assignment,
          p_expected_version: 3,
        },
      },
    ]);
  });

  it('rejects unsafe captain versions before RPC and represents an observed empty assignment with null CAS fields', async () => {
    const emptyReply = { ...mutationScope, outcome: 'already_clear', assignment: null };
    const run = loadBeerGuy([{ data: emptyReply, error: null }]);

    assert.deepEqual(
      await run.beerGuyModule.manageBeerGuyAsCaptain(
        UUIDS.game,
        UUIDS.team,
        UUIDS.player,
        UUIDS.assignment,
        Number.MAX_SAFE_INTEGER + 1,
      ),
      { data: null, error: 'Invalid Beer Guy assignment version' },
    );
    assert.deepEqual(
      await run.beerGuyModule.manageBeerGuyAsCaptain(UUIDS.game, UUIDS.team, null, null, null),
      { data: emptyReply, error: null },
    );
    assert.deepEqual(run.calls, [{
      client: 'authenticated',
      name: 'beer_guy_captain_manage',
      args: {
        p_game_id: UUIDS.game,
        p_team_id: UUIDS.team,
        p_player_id: null,
        p_expected_assignment_id: null,
        p_expected_version: null,
      },
    }]);
  });

  it('loads private state/tracker through authenticated RPCs and public projection through the sessionless client', async () => {
    const publicAssignment = { game_id: UUIDS.game, team_id: UUIDS.team, player_id: UUIDS.player };
    const run = loadBeerGuy([
      { data: gameState, error: null },
      { data: tracker, error: null },
      { data: publicAssignment, error: null },
    ]);

    assert.deepEqual(await run.beerGuyModule.getBeerGuyGameState(UUIDS.game, UUIDS.team), { data: gameState, error: null });
    assert.deepEqual(await run.beerGuyModule.getBeerGuyTracker(UUIDS.team), { data: tracker, error: null });
    assert.deepEqual(
      await run.beerGuyModule.getPublicNextBeerGuyAssignment(UUIDS.game, UUIDS.team),
      { data: publicAssignment, error: null },
    );
    assert.deepEqual(run.calls, [
      { client: 'authenticated', name: 'beer_guy_get_game_state', args: { p_game_id: UUIDS.game, p_team_id: UUIDS.team } },
      { client: 'authenticated', name: 'beer_guy_get_tracker', args: { p_team_id: UUIDS.team } },
      { client: 'public', name: 'beer_guy_get_public_next_assignment', args: { p_team_id: UUIDS.team } },
    ]);
  });

  it('preserves server errors and rejects malformed, over-broad, or unsafe-version replies', async () => {
    const malformed = [
      null,
      { ...gameState, caller_eligible: 'yes' },
      { ...gameState, secret_roster: [] },
      { ...gameState, assignment: { ...assignment, version: Number.MAX_SAFE_INTEGER + 1 } },
      { ...gameState, assignment: { ...assignment, status: 'completed' } },
    ];
    for (const data of malformed) {
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await run.beerGuyModule.getBeerGuyGameState(UUIDS.game, UUIDS.team),
        { data: null, error: 'Invalid Beer Guy response' },
      );
    }

    const failed = loadBeerGuy([{ data: null, error: { message: 'stale Beer Guy assignment' } }]);
    assert.deepEqual(
      await failed.beerGuyModule.manageBeerGuyAsCaptain(UUIDS.game, UUIDS.team, UUIDS.player, UUIDS.assignment, 2),
      { data: null, error: 'stale Beer Guy assignment' },
    );
    assert.equal(failed.calls.length, 1);
  });

  it('binds every decoded read to its requested scope and accepts PostgreSQL-compatible UUID versions', async () => {
    const mismatchedReads = [
      {
        call: (api: BeerGuyModule) => api.getBeerGuyGameState(UUIDS.game, UUIDS.team),
        data: { ...gameState, game_id: UUIDS.gameV7 },
      },
      {
        call: (api: BeerGuyModule) => api.getBeerGuyGameState(UUIDS.game, UUIDS.team),
        data: { ...gameState, team_id: UUIDS.otherTeam },
      },
      {
        call: (api: BeerGuyModule) => api.getBeerGuyTracker(UUIDS.team),
        data: { ...tracker, team_id: UUIDS.otherTeam },
      },
      {
        call: (api: BeerGuyModule) => api.getBeerGuyTracker(UUIDS.team),
        data: {
          ...tracker,
          upcoming_games: [{
            ...tracker.upcoming_games[0],
            assignment: { ...assignment, status: 'completed' },
          }],
        },
      },
      {
        call: (api: BeerGuyModule) => api.getPublicNextBeerGuyAssignment(UUIDS.game, UUIDS.team),
        data: { game_id: UUIDS.game, team_id: UUIDS.otherTeam, player_id: UUIDS.player },
      },
      {
        call: (api: BeerGuyModule) => api.getPublicNextBeerGuyAssignment(UUIDS.game, UUIDS.team),
        data: { game_id: 'not-a-postgres-uuid', team_id: UUIDS.team, player_id: UUIDS.player },
      },
      {
        call: (api: BeerGuyModule) => api.getPublicNextBeerGuyAssignment(UUIDS.game, UUIDS.team),
        data: { game_id: UUIDS.gameV7, team_id: UUIDS.team, player_id: UUIDS.player },
      },
    ];

    for (const { call, data } of mismatchedReads) {
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await call(run.beerGuyModule),
        { data: null, error: 'Invalid Beer Guy response' },
      );
    }

    const v7State = { ...gameState, game_id: UUIDS.gameV7 };
    const v7 = loadBeerGuy([{ data: v7State, error: null }]);
    assert.deepEqual(
      await v7.beerGuyModule.getBeerGuyGameState(UUIDS.gameV7, UUIDS.team),
      { data: v7State, error: null },
    );

    const importedState = { ...gameState, game_id: UUIDS.importedGame };
    const imported = loadBeerGuy([{ data: importedState, error: null }]);
    assert.deepEqual(
      await imported.beerGuyModule.getBeerGuyGameState(UUIDS.importedGame, UUIDS.team),
      { data: importedState, error: null },
    );
  });

  it('enforces endpoint-specific mutation outcomes and assignment/null invariants', async () => {
    const invalidSelfReplies = [
      { ...mutationScope, outcome: 'assigned', assignment },
      { ...mutationScope, outcome: 'claimed', assignment: null },
      {
        ...mutationScope,
        outcome: 'taken',
        assignment: { ...assignment, player_id: null, player_name: null, player_avatar_url: null },
      },
      { ...mutationScope, outcome: 'claimed', assignment: { ...assignment, status: 'completed' } },
      { ...mutationScope, game_id: UUIDS.gameV7, outcome: 'claimed', assignment },
      { ...mutationScope, outcome: 'claimed', assignment, extra: true },
    ];
    for (const data of invalidSelfReplies) {
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await run.beerGuyModule.claimBeerGuy(UUIDS.game, UUIDS.team),
        { data: null, error: 'Invalid Beer Guy response' },
      );
    }

    const invalidCaptainReplies = [
      { playerId: UUIDS.player, data: { ...mutationScope, outcome: 'claimed', assignment } },
      { playerId: null, data: { ...mutationScope, outcome: 'cleared', assignment } },
      {
        playerId: UUIDS.player,
        data: {
          ...mutationScope,
          outcome: 'unchanged',
          assignment: { ...assignment, player_id: UUIDS.otherPlayer },
        },
      },
      {
        playerId: UUIDS.player,
        data: { ...mutationScope, outcome: 'conflict', assignment: { ...assignment, status: 'completed' } },
      },
      {
        playerId: UUIDS.player,
        data: { ...mutationScope, outcome: 'reassigned', assignment: { ...assignment, id: UUIDS.otherAssignment } },
      },
      {
        playerId: UUIDS.player,
        data: { ...mutationScope, outcome: 'conflict', assignment },
      },
      {
        playerId: null,
        data: {
          ...mutationScope,
          outcome: 'already_clear',
          assignment: { ...assignment, player_id: null, player_avatar_url: null },
        },
      },
    ];
    for (const { playerId, data } of invalidCaptainReplies) {
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await run.beerGuyModule.manageBeerGuyAsCaptain(
          UUIDS.game,
          UUIDS.team,
          playerId,
          UUIDS.assignment,
          3,
        ),
        { data: null, error: 'Invalid Beer Guy response' },
      );
    }

    const conflict = { ...mutationScope, outcome: 'conflict', assignment: null };
    const validConflict = loadBeerGuy([{ data: conflict, error: null }]);
    assert.deepEqual(
      await validConflict.beerGuyModule.manageBeerGuyAsCaptain(
        UUIDS.game,
        UUIDS.team,
        UUIDS.player,
        UUIDS.assignment,
        3,
      ),
      { data: conflict, error: null },
    );
  });

  it('accepts every protocol-valid claim and captain outcome with its exact CAS relationship', async () => {
    for (const outcome of ['assigned_to_self', 'taken', 'claimed'] as const) {
      const data = { ...mutationScope, outcome, assignment };
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await run.beerGuyModule.claimBeerGuy(UUIDS.game, UUIDS.team),
        { data, error: null },
      );
    }

    const validCaptainReplies = [
      {
        playerId: UUIDS.player,
        expectedAssignmentId: null,
        expectedVersion: null,
        data: { ...mutationScope, outcome: 'assigned', assignment: { ...assignment, version: 1 } },
      },
      {
        playerId: UUIDS.player,
        expectedAssignmentId: UUIDS.assignment,
        expectedVersion: 3,
        data: { ...mutationScope, outcome: 'unchanged', assignment },
      },
      {
        playerId: UUIDS.player,
        expectedAssignmentId: UUIDS.assignment,
        expectedVersion: 3,
        data: { ...mutationScope, outcome: 'reassigned', assignment: { ...assignment, version: 4 } },
      },
      {
        playerId: null,
        expectedAssignmentId: UUIDS.assignment,
        expectedVersion: 3,
        data: {
          ...mutationScope,
          outcome: 'already_clear',
          assignment: {
            ...assignment,
            player_id: null,
            player_name: null,
            player_avatar_url: null,
          },
        },
      },
      {
        playerId: UUIDS.player,
        expectedAssignmentId: UUIDS.assignment,
        expectedVersion: 3,
        data: { ...mutationScope, outcome: 'conflict', assignment: { ...assignment, version: 4 } },
      },
    ];

    for (const { playerId, expectedAssignmentId, expectedVersion, data } of validCaptainReplies) {
      const run = loadBeerGuy([{ data, error: null }]);
      assert.deepEqual(
        await run.beerGuyModule.manageBeerGuyAsCaptain(
          UUIDS.game,
          UUIDS.team,
          playerId,
          expectedAssignmentId,
          expectedVersion,
        ),
        { data, error: null },
      );
    }
  });
});
