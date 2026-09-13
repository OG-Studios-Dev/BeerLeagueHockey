import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }));

import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { addGameEvent, deleteGameEvent, recalculateGameStats } from '../stat-corrections';

const GAME_ID = '00000000-0000-4000-8000-000000000001';
const LEAGUE_ID = '00000000-0000-4000-8000-000000000002';
const SEASON_ID = '00000000-0000-4000-8000-000000000003';
const ADMIN_ID = '00000000-0000-4000-8000-000000000004';

function chain(result: unknown) {
  const query: any = {
    select: jest.fn(() => query), eq: jest.fn(() => query),
    maybeSingle: jest.fn(async () => result), single: jest.fn(async () => result),
  };
  return query;
}

function installAdminAuth() {
  const authClient = {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: ADMIN_ID } }, error: null })) },
    from: jest.fn((table: string) => {
      if (table === 'leagues') return chain({ data: { created_by: 'other', organizations: null }, error: null });
      if (table === 'league_memberships') return chain({ data: { role: 'admin' }, error: null });
      throw new Error(`Unexpected auth table: ${table}`);
    }),
  };
  (createClient as jest.MockedFunction<typeof createClient>).mockResolvedValue(authClient as never);
}

describe('recalculateGameStats atomic writer', () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    jest.clearAllMocks();
    installAdminAuth();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleErrorSpy.mockRestore());

  it('returns failure, records the primary database error, and never falls back to partial writes', async () => {
    const failureAudit = jest.fn(async () => ({ error: null }));
    const rpc = jest.fn(async () => ({ data: null, error: {
      code: '42P10', message: 'no unique constraint', details: 'do not persist this',
    } }));
    const serviceClient = {
      rpc,
      from: jest.fn((table: string) => {
        if (table === 'games') return chain({ data: { league_id: LEAGUE_ID, season_id: SEASON_ID }, error: null });
        if (table === 'game_audit_log') return { insert: failureAudit };
        throw new Error(`Unexpected service table: ${table}`);
      }),
    };
    (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>).mockReturnValue(serviceClient as never);

    await expect(recalculateGameStats(GAME_ID)).resolves.toEqual({ success: false, error: 'Failed to recalculate stats' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('recalculate_game_stats_atomic', {
      p_game_id: GAME_ID, p_changed_by: ADMIN_ID,
    });
    expect(failureAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stat_correction_recalculate_failed',
      new_data: { primary_error: { code: '42P10', message: 'no unique constraint' } },
    }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns the atomic RPC result without a fallback or duplicate success audit', async () => {
    const rpc = jest.fn(async () => ({ data: { game_id: GAME_ID, home_score: 2, away_score: 1 }, error: null }));
    const serviceClient = {
      rpc,
      from: jest.fn((table: string) => {
        if (table === 'games') return chain({ data: { league_id: LEAGUE_ID, season_id: SEASON_ID }, error: null });
        throw new Error(`Unexpected service table: ${table}`);
      }),
    };
    (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>).mockReturnValue(serviceClient as never);

    await expect(recalculateGameStats(GAME_ID)).resolves.toEqual({ success: true, data: { homeScore: 2, awayScore: 1 } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('routes add through the single transactional correction RPC', async () => {
    const rpc = jest.fn(async () => ({ data: { event_id: GAME_ID }, error: null }));
    const serviceClient = { rpc, from: jest.fn((table: string) => {
      if (table === 'games') return chain({ data: { league_id: LEAGUE_ID }, error: null });
      throw new Error(`Unexpected direct write table: ${table}`);
    }) };
    (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>).mockReturnValue(serviceClient as never);
    await expect(addGameEvent({ gameId: GAME_ID, eventType: 'goal', period: 1, teamId: LEAGUE_ID,
      teamType: 'home', playerId: ADMIN_ID })).resolves.toEqual({ success: true, data: { eventId: GAME_ID } });
    expect(rpc).toHaveBeenCalledWith('correct_game_event_atomic', expect.objectContaining({
      p_operation: 'add', p_game_id: GAME_ID, p_changed_by: ADMIN_ID,
    }));
  });

  it('routes soft delete and audit/rebuild through the same transactional RPC', async () => {
    const rpc = jest.fn(async () => ({ data: { event_id: GAME_ID }, error: null }));
    const serviceClient = { rpc, from: jest.fn((table: string) => {
      if (table === 'game_events') return chain({ data: { id: GAME_ID, game_id: GAME_ID, event_type: 'goal', player_id: ADMIN_ID, period: 1 }, error: null });
      if (table === 'games') return chain({ data: { league_id: LEAGUE_ID }, error: null });
      throw new Error(`Unexpected direct write table: ${table}`);
    }) };
    (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>).mockReturnValue(serviceClient as never);
    await expect(deleteGameEvent(GAME_ID, 'fix')).resolves.toEqual({ success: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith('correct_game_event_atomic', expect.objectContaining({
      p_operation: 'delete', p_event_id: GAME_ID, p_game_id: GAME_ID, p_reason: 'fix',
    }));
  });
});
