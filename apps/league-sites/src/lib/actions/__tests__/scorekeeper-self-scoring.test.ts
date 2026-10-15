import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  createAuthClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));

import { cookies, headers } from 'next/headers';
import {
  createAuthClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import {
  getOrCreateCaptainScorekeeperSession,
  finalizeGameStats,
  updateGameStatus,
  submitGameForVerification,
  verifyCaptainStats,
} from '../scorekeeper';

type MockStep = {
  type: 'select' | 'update' | 'insert' | 'rpc';
  target: string;
  result: any;
  assert?: (state: {
    payload?: any;
    columns?: string;
    filters: Array<[string, ...any[]]>;
    rpcArgs?: any;
  }) => void;
};

function createMockClient(steps: MockStep[]) {
  const functions = {
    invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
  };

  const makeBuilder = (step: MockStep, state: {
    payload?: any;
    columns?: string;
    filters: Array<[string, ...any[]]>;
    rpcArgs?: any;
  }) => {
    let finalized = false;

    const finalize = async () => {
      if (!finalized) {
        step.assert?.(state);
        finalized = true;
      }
      return step.result;
    };

    const builder: any = {
      select: jest.fn((columns: string) => {
        state.columns = columns;
        return builder;
      }),
      eq: jest.fn((field: string, value: any) => {
        state.filters.push(['eq', field, value]);
        return builder;
      }),
      gt: jest.fn((field: string, value: any) => {
        state.filters.push(['gt', field, value]);
        return builder;
      }),
      in: jest.fn((field: string, value: any) => {
        state.filters.push(['in', field, value]);
        return builder;
      }),
      is: jest.fn((field: string, value: any) => {
        state.filters.push(['is', field, value]);
        return builder;
      }),
      ilike: jest.fn((field: string, value: any) => {
        state.filters.push(['ilike', field, value]);
        return builder;
      }),
      or: jest.fn((value: any) => {
        state.filters.push(['or', value]);
        return builder;
      }),
      order: jest.fn((field: string, value: any) => {
        state.filters.push(['order', field, value]);
        return builder;
      }),
      limit: jest.fn((value: number) => {
        state.filters.push(['limit', value]);
        return builder;
      }),
      maybeSingle: jest.fn(finalize),
      single: jest.fn(finalize),
      then: (onFulfilled: any, onRejected: any) => finalize().then(onFulfilled, onRejected),
    };

    return builder;
  };

  const from = jest.fn((table: string) => ({
    select: jest.fn((columns: string) => {
      const step = steps.shift();
      expect(step?.type).toBe('select');
      expect(step?.target).toBe(table);

      return makeBuilder(step!, {
        columns,
        filters: [],
      });
    }),
    update: jest.fn((payload: any) => {
      const step = steps.shift();
      expect(step?.type).toBe('update');
      expect(step?.target).toBe(table);

      return makeBuilder(step!, {
        payload,
        filters: [],
      });
    }),
    insert: jest.fn((payload: any) => {
      const step = steps.shift();
      expect(step?.type).toBe('insert');
      expect(step?.target).toBe(table);

      return makeBuilder(step!, {
        payload,
        filters: [],
      });
    }),
  }));

  const client: any = {
    from,
    functions,
    rpc: jest.fn((fnName: string, rpcArgs: any) => {
      const step = steps.shift();
      expect(step?.type).toBe('rpc');
      expect(step?.target).toBe(fnName);
      step?.assert?.({ filters: [], rpcArgs });
      return Promise.resolve(step?.result);
    }),
  };

  return { client, from, functions, steps };
}

describe('captain self-scoring', () => {
  const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
  const mockHeaders = headers as jest.MockedFunction<typeof headers>;
  const mockCreateAuthClient = createAuthClient as jest.MockedFunction<typeof createAuthClient>;
  const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
  const hoursFromNowIso = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();

    mockHeaders.mockResolvedValue({
      get: jest.fn().mockReturnValue(null),
    } as any);

    mockCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: 'SESSIONTOKEN' }),
      set: jest.fn(),
      delete: jest.fn(),
    } as any);
  });

  it('allows start only through an atomic session-bound transition', async () => {
    const { client, steps } = createMockClient([
      { type: 'select', target: 'scorekeeper_sessions', result: { data: {
        id: 'session-1', game_id: 'game-1', league_id: 'league-1', session_type: 'single',
        is_active: true, expires_at: hoursFromNowIso(2), created_by: 'user-1',
      }, error: null } },
      { type: 'rpc', target: 'start_scorekeeper_game_atomic', result: { data: {}, error: null },
        assert: ({ rpcArgs }) => expect(rpcArgs).toEqual({ p_game_id: 'game-1', p_session_id: 'session-1' }) },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);
    expect(await updateGameStatus('game-1', 'in_progress')).toEqual({ success: true });
    expect(steps).toHaveLength(0);
  });

  it.each(['completed', 'pending_verification', 'scheduled', 'cancelled', 'postponed'])('rejects arbitrary status %s before any service mutation', async (status) => {
    const { client, from } = createMockClient([]);
    mockCreateServiceRoleClient.mockReturnValue(client);
    expect((await updateGameStatus('game-1', status)).success).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('creates a captain self-score session with initiating team metadata', async () => {
    const authClient: any = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'captain-1' } } }),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => ({
                  single: jest.fn().mockResolvedValue({
                    data: { leadership_role: 'captain' },
                  }),
                })),
              })),
            })),
          })),
        })),
      })),
    };

    mockCreateAuthClient.mockResolvedValue(authClient);

    const { client, steps } = createMockClient([
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            id: 'game-1',
            league_id: 'league-1',
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            scheduled_at: '2026-03-30T19:00:00.000Z',
            status: 'scheduled',
            leagues: { slug: 'hlhl', settings: { self_scorekeeper_enabled: true } },
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: { data: null, error: null },
      },
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: { data: null, error: null },
      },
      {
        type: 'insert',
        target: 'scorekeeper_sessions',
        result: { data: { id: 'session-1' }, error: null },
        assert: ({ payload }) => {
          expect(payload).toEqual(
            expect.objectContaining({
              game_id: 'game-1',
              league_id: 'league-1',
              created_by: 'captain-1',
              scorekeeper_id: 'captain-1',
              session_type: 'single',
              session_origin: 'captain_self_score',
              initiating_team_id: 'team-home',
              initiating_team_type: 'home',
              initiating_captain_id: 'captain-1',
              is_active: true,
            }),
          );
          expect(typeof payload.token).toBe('string');
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await getOrCreateCaptainScorekeeperSession('game-1', 'team-home');

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        leagueSlug: 'hlhl',
      }),
    );
    expect(typeof result.token).toBe('string');
    expect(steps).toHaveLength(0);
  });

  it('accepts legacy self-scoring league settings when the new flag is missing', async () => {
    const authClient: any = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'captain-1' } } }),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => ({
                  single: jest.fn().mockResolvedValue({
                    data: { leadership_role: 'captain' },
                  }),
                })),
              })),
            })),
          })),
        })),
      })),
    };

    mockCreateAuthClient.mockResolvedValue(authClient);

    const { client, steps } = createMockClient([
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            id: 'game-1',
            league_id: 'league-1',
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            scheduled_at: '2026-03-30T19:00:00.000Z',
            status: 'scheduled',
            leagues: { slug: 'hlhl', settings: { scorekeepingMode: 'self_scorekeeping' } },
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: { data: null, error: null },
      },
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: { data: null, error: null },
      },
      {
        type: 'insert',
        target: 'scorekeeper_sessions',
        result: { data: { id: 'session-1' }, error: null },
        assert: ({ payload }) => {
          expect(payload).toEqual(
            expect.objectContaining({
              game_id: 'game-1',
              league_id: 'league-1',
              created_by: 'captain-1',
              scorekeeper_id: 'captain-1',
              session_origin: 'captain_self_score',
              initiating_team_id: 'team-home',
              initiating_team_type: 'home',
              initiating_captain_id: 'captain-1',
            }),
          );
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await getOrCreateCaptainScorekeeperSession('game-1', 'team-home');

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        leagueSlug: 'hlhl',
      }),
    );
    expect(steps).toHaveLength(0);
  });

  it('reuses an existing active captain session for the same game', async () => {
    const scheduledAtIso = hoursFromNowIso(2);
    const existingSessionExpiresAtIso = hoursFromNowIso(6);

    const authClient: any = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'captain-1' } } }),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => ({
                  single: jest.fn().mockResolvedValue({
                    data: { leadership_role: 'alternate_captain' },
                  }),
                })),
              })),
            })),
          })),
        })),
      })),
    };

    mockCreateAuthClient.mockResolvedValue(authClient);

    const { client, from, steps } = createMockClient([
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            id: 'game-1',
            league_id: 'league-1',
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            scheduled_at: scheduledAtIso,
            status: 'in_progress',
            leagues: { slug: 'hlhl', settings: { self_scorekeeper_enabled: true } },
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: {
          data: { token: 'EXISTINGTOKEN', expires_at: existingSessionExpiresAtIso },
          error: null,
        },
        assert: ({ filters }) => {
          expect(filters).toContainEqual(['eq', 'game_id', 'game-1']);
          expect(filters).toContainEqual(['eq', 'session_origin', 'captain_self_score']);
          expect(filters).toContainEqual(['eq', 'initiating_team_id', 'team-away']);
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await getOrCreateCaptainScorekeeperSession('game-1', 'team-away');

    expect(result).toEqual({
      success: true,
      token: 'EXISTINGTOKEN',
      leagueSlug: 'hlhl',
    });
    expect(from).toHaveBeenCalledTimes(2);
    expect(steps).toHaveLength(0);
  });

  it('auto-verifies the initiating captain team and issues only the opponent link', async () => {
    const futureIso = hoursFromNowIso(2);

    const { client, steps } = createMockClient([
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: {
          data: {
            id: 'session-1',
            created_by: 'captain-1',
            game_id: 'game-1',
            league_id: 'league-1',
            expires_at: futureIso,
            access_count: 0,
            session_type: 'single',
            session_origin: 'captain_self_score',
            initiating_team_id: 'team-home',
            initiating_team_type: 'home',
            initiating_captain_id: 'captain-1',
            games: {
              status: 'in_progress',
              scheduled_at: futureIso,
              home_team: { name: 'Home Team' },
              away_team: { name: 'Away Team' },
            },
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            id: 'game-1',
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            leagues: { name: null, slug: null },
          },
          error: null,
        },
      },
      {
        type: 'rpc',
        target: 'submit_game_for_verification_atomic',
        result: { data: { status: 'pending_verification' }, error: null },
        assert: ({ rpcArgs }) => {
          expect(rpcArgs).toEqual(expect.objectContaining({
            p_game_id: 'game-1',
            p_session_id: 'session-1',
            p_mode: 'opponent_only',
            p_initiating_team_type: 'home',
            p_penalty_capture_status: null,
            p_goalie_capture_status: null,
          }));
          expect(rpcArgs.p_home_token).toBeNull();
          expect(typeof rpcArgs.p_away_token).toBe('string');
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await submitGameForVerification('game-1');

    expect(result.success).toBe(true);
    expect(result.verificationMode).toBe('opponent_only');
    expect(result.autoVerifiedTeamType).toBe('home');
    expect(result.homeToken).toBeUndefined();
    expect(typeof result.awayToken).toBe('string');
    expect(steps).toHaveLength(0);
  });

  it('finalizes when the second captain submits through their own self-score session', async () => {
    const futureIso = hoursFromNowIso(2);

    const { client, functions, steps } = createMockClient([
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: {
          data: {
            id: 'session-1',
            created_by: 'captain-home',
            game_id: 'game-1',
            league_id: 'league-1',
            expires_at: futureIso,
            access_count: 0,
            session_type: 'single',
            session_origin: 'captain_self_score',
            initiating_team_id: 'team-home',
            initiating_team_type: 'home',
            initiating_captain_id: 'captain-home',
            games: {
              status: 'pending_verification',
              scheduled_at: futureIso,
              home_team: { name: 'Home Team' },
              away_team: { name: 'Away Team' },
            },
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            id: 'game-1',
            home_team_id: 'team-home',
            away_team_id: 'team-away',
            leagues: { name: null, slug: null },
          },
          error: null,
        },
      },
      {
        type: 'rpc',
        target: 'submit_game_for_verification_atomic',
        result: { data: { status: 'completed' }, error: null },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await submitGameForVerification('game-1');

    expect(result.success).toBe(true);
    expect(functions.invoke).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });

  it('keeps assigned scorekeeper flow on two-captain verification', async () => {
    const futureIso = hoursFromNowIso(2);

    const { client, steps } = createMockClient([
      {
        type: 'select',
        target: 'scorekeeper_sessions',
        result: {
          data: {
            id: 'session-1',
            created_by: 'scorekeeper-1',
            game_id: 'game-1',
            league_id: 'league-1',
            expires_at: futureIso,
            access_count: 0,
            session_type: 'single',
            session_origin: 'assigned_scorekeeper',
            initiating_team_id: null,
            initiating_team_type: null,
            initiating_captain_id: null,
            games: {
              status: 'in_progress',
              scheduled_at: futureIso,
              home_team: { name: 'Home Team' },
              away_team: { name: 'Away Team' },
            },
          },
          error: null,
        },
      },
      {
        type: 'rpc',
        target: 'submit_game_for_verification_atomic',
        result: { data: { status: 'pending_verification' }, error: null },
        assert: ({ rpcArgs }) => {
          expect(rpcArgs).toEqual(expect.objectContaining({
            p_game_id: 'game-1', p_session_id: 'session-1', p_mode: 'both_captains',
            p_penalty_capture_status: null, p_goalie_capture_status: null,
          }));
          expect(typeof rpcArgs.p_home_token).toBe('string');
          expect(typeof rpcArgs.p_away_token).toBe('string');
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await submitGameForVerification('game-1');

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        verificationMode: 'both_captains',
      }),
    );
    expect(typeof result.homeToken).toBe('string');
    expect(typeof result.awayToken).toBe('string');
    expect(steps).toHaveLength(0);
  });

  it('finalizes the game after the opposing captain verifies the last pending side', async () => {
    const { client, functions, steps } = createMockClient([
      {
        type: 'rpc',
        target: 'verify_and_finalize_game_stats_atomic',
        result: { data: { game_id: 'game-1', team_type: 'away', status: 'completed' }, error: null },
        assert: ({ rpcArgs }) => {
          expect(rpcArgs).toEqual({ p_token: 'VERIFYTOKEN' });
        },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await verifyCaptainStats('VERIFYTOKEN');

    expect(result).toEqual({
      success: true,
      gameId: 'game-1',
      teamType: 'away',
    });
    expect(functions.invoke).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });

  it('never gives the exported scorekeeper finalizer the unverified override', async () => {
    const futureIso = hoursFromNowIso(2);
    const { client, steps } = createMockClient([
      { type: 'select', target: 'scorekeeper_sessions', result: { data: {
        id: 'session-1', created_by: 'scorekeeper-1', game_id: 'game-1', league_id: 'league-1',
        expires_at: futureIso, access_count: 0, session_type: 'single', session_origin: 'assigned_scorekeeper',
        initiating_team_id: null, initiating_team_type: null, initiating_captain_id: null,
        games: { status: 'pending_verification', scheduled_at: futureIso, home_team: { name: 'Home' }, away_team: { name: 'Away' } },
      }, error: null } },
      { type: 'select', target: 'games', result: { data: { status: 'pending_verification', league_id: 'league-1', leagues: null }, error: null } },
      { type: 'rpc', target: 'finalize_game_stats_atomic', result: { data: null, error: { message: 'Both captain verifications are required' } },
        assert: ({ rpcArgs }) => expect(rpcArgs).toEqual({ p_game_id: 'game-1', p_allow_unverified: false }) },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);
    await expect(finalizeGameStats('game-1')).resolves.toEqual({ success: false, error: 'Failed to finalize stats' });
    expect(steps).toHaveLength(0);
  });

  it('returns a retryable finalization error without claiming the captain token is invalid', async () => {
    const { client } = createMockClient([{ type: 'rpc', target: 'verify_and_finalize_game_stats_atomic', result: {
      data: null, error: { message: 'forced standings failure' },
    } }]);
    mockCreateServiceRoleClient.mockReturnValue(client);
    await expect(verifyCaptainStats('VERIFYTOKEN')).resolves.toEqual({
      success: false,
      error: 'Verification was saved but finalization failed. Please retry with the same link.',
    });
  });
});
