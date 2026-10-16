import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/seasons/operational', () => ({ pickOperationalSeason: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({
  createAuthClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));
jest.mock('@/lib/actions/game-lineups', () => ({ getCaptainGameLineupEditorData: jest.fn() }));
jest.mock('@/lib/player-photo', () => ({ resolvePlayerPhotoUrl: jest.fn(() => null) }));

import { createAuthClient, createServiceRoleClient } from '@/lib/supabase/server';
import { updateCaptainGameAttendanceStatus } from '../game-day';

type GameFixture = {
  id: string;
  league_id: string;
  season_id: string;
  scheduled_at: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
};

type Filter = [column: string, value: unknown];

function setupAttendanceAction(game: GameFixture, rpcResult: {
  data: unknown;
  error: { message: string } | null;
} = {
  data: {
    outcome: 'set',
    operation: 'set',
    status: 'confirmed',
    affected_rows: 1,
    checkin_id: '60000000-0000-4000-8000-000000000001',
  },
  error: null,
}) {
  const authRpc = jest.fn(async () => rpcResult);
  const filters: Record<string, Filter[]> = {};
  const mutations: Array<{ table: string; operation: string; payload?: unknown }> = [];

  const authClient = {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'captain-1' } } })) },
    rpc: authRpc,
  };
  (createAuthClient as jest.MockedFunction<typeof createAuthClient>)
    .mockResolvedValue(authClient as never);

  const service = {
    from: jest.fn((table: string) => {
      filters[table] ||= [];
      const query = {
        select: jest.fn(() => query),
        eq: jest.fn((column: string, value: unknown) => {
          filters[table].push([column, value]);
          return query;
        }),
        is: jest.fn((column: string, value: unknown) => {
          filters[table].push([column, value]);
          return query;
        }),
        limit: jest.fn(() => query),
        maybeSingle: jest.fn(async () => ({
          data: table === 'team_rosters'
            ? { player_id: 'captain-1', leadership_role: 'captain' }
            : table === 'games'
              ? game
              : null,
          error: null,
        })),
        delete: jest.fn(() => {
          mutations.push({ table, operation: 'delete' });
          return query;
        }),
        upsert: jest.fn((payload: unknown) => {
          mutations.push({ table, operation: 'upsert', payload });
          return query;
        }),
        update: jest.fn((payload: unknown) => {
          mutations.push({ table, operation: 'update', payload });
          return query;
        }),
        then: (resolve: (result: { data: null; error: null }) => unknown) => (
          Promise.resolve({ data: null, error: null }).then(resolve)
        ),
      };
      return query;
    }),
  };
  (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>)
    .mockReturnValue(service as never);

  return { authRpc, filters, mutations };
}

const input = {
  gameId: 'game-1',
  teamId: 'team-1',
  playerId: 'player-1',
  status: 'confirmed' as const,
  leagueSlug: 'demo',
};

const baseGame = {
  id: 'game-1',
  league_id: 'league-1',
  season_id: 'season-1',
  scheduled_at: '2099-01-01T00:00:00.000Z',
  status: 'scheduled',
  home_team_id: 'team-1',
  away_team_id: 'team-2',
};

describe('captain game-day attendance authority', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes a future scheduled response through the authenticated captain RPC without a service check-in write', async () => {
    const { authRpc, mutations } = setupAttendanceAction(baseGame);

    await expect(updateCaptainGameAttendanceStatus(input)).resolves.toEqual({ success: true });
    expect(authRpc).toHaveBeenCalledWith('captain_manage_game_checkin', {
      p_game_id: 'game-1',
      p_team_id: 'team-1',
      p_player_id: 'player-1',
      p_operation: 'set',
      p_status: 'confirmed',
    });
    expect(mutations.filter((row) => row.table === 'game_checkins')).toEqual([]);
  });

  it.each(['in_progress', 'pending_verification'])('routes the %s path through authenticated database authority without a service check-in write', async (status) => {
    const { authRpc, mutations } = setupAttendanceAction({
      ...baseGame,
      status,
      scheduled_at: '2026-10-16T00:00:00.000Z',
    });

    await expect(updateCaptainGameAttendanceStatus(input)).resolves.toEqual({ success: true });
    expect(authRpc).toHaveBeenCalledWith('captain_manage_game_checkin', {
      p_game_id: 'game-1',
      p_team_id: 'team-1',
      p_player_id: 'player-1',
      p_operation: 'set',
      p_status: 'confirmed',
    });
    expect(mutations.filter((row) => row.table === 'game_checkins')).toEqual([]);
  });

  it('rejects a past scheduled game instead of bypassing the future-only RPC through service role', async () => {
    const { authRpc, mutations } = setupAttendanceAction({
      ...baseGame,
      scheduled_at: '2020-01-01T00:00:00.000Z',
    });

    await expect(updateCaptainGameAttendanceStatus(input)).resolves.toEqual({
      success: false,
      error: 'Attendance can only be edited for a future scheduled or active game.',
    });
    expect(authRpc).not.toHaveBeenCalled();
    expect(mutations.filter((row) => row.table === 'game_checkins')).toEqual([]);
  });

  it('fails closed when the authoritative RPC returns a malformed acknowledgement', async () => {
    const { mutations } = setupAttendanceAction(baseGame, {
      data: { outcome: 'set', operation: 'set', affected_rows: 0 },
      error: null,
    });

    await expect(updateCaptainGameAttendanceStatus(input)).resolves.toEqual({
      success: false,
      error: 'Invalid captain check-in RPC response',
    });
    expect(mutations.filter((row) => row.table === 'game_checkins')).toEqual([]);
  });

  it('routes no-response through the RPC reset contract and accepts an idempotent empty result', async () => {
    const { authRpc, mutations } = setupAttendanceAction(baseGame, {
      data: {
        outcome: 'already_waiting', operation: 'reset', status: null,
        affected_rows: 0, checkin_id: null,
      },
      error: null,
    });

    await expect(updateCaptainGameAttendanceStatus({
      ...input,
      status: 'no_response',
    })).resolves.toEqual({ success: true });
    expect(authRpc).toHaveBeenCalledWith('captain_manage_game_checkin', {
      p_game_id: 'game-1',
      p_team_id: 'team-1',
      p_player_id: 'player-1',
      p_operation: 'reset',
      p_status: null,
    });
    expect(mutations.filter((row) => row.table === 'game_checkins')).toEqual([]);
  });
});
