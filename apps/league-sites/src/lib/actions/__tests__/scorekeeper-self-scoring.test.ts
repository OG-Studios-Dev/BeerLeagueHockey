import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

jest.mock('next/server', () => ({
  after: (callback: () => unknown) => callback(),
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
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(
            expect.objectContaining({
              status: 'pending_verification',
              home_captain_verified: true,
              home_verification_token: null,
              home_verification_token_expires_at: null,
            }),
          );
          expect(typeof payload.away_verification_token).toBe('string');
          expect(typeof payload.away_verification_token_expires_at).toBe('string');
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            home_verified_at: '2026-03-30T19:00:00.000Z',
            away_verified_at: null,
          },
          error: null,
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
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(
            expect.objectContaining({
              status: 'pending_verification',
              home_captain_verified: true,
              home_verification_token: null,
              home_verification_token_expires_at: null,
            }),
          );
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            home_verified_at: '2026-03-30T19:10:00.000Z',
            away_verified_at: '2026-03-30T19:00:00.000Z',
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: { status: 'pending_verification' },
          error: null,
        },
      },
      {
        type: 'rpc',
        target: 'rollup_game_stats',
        result: { data: null, error: null },
      },
      {
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(expect.objectContaining({ status: 'completed' }));
          expect(typeof payload.stats_locked_at).toBe('string');
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: { status: 'completed', season_id: null, league_id: null },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'game_events',
        result: { data: [], error: null },
      },
      {
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
      },
    ]);

    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await submitGameForVerification('game-1');

    expect(result.success).toBe(true);
    expect(functions.invoke).toHaveBeenCalledWith('generate-ai-article', {
      body: { action: 'game_recap', game_id: 'game-1' },
    });
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
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(
            expect.objectContaining({
              status: 'pending_verification',
              home_captain_verified: false,
              away_captain_verified: false,
            }),
          );
          expect(typeof payload.home_verification_token).toBe('string');
          expect(typeof payload.away_verification_token).toBe('string');
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
        target: 'validate_captain_token',
        result: {
          data: [{ is_valid: true, game_id: 'game-1', team_type: 'away' }],
          error: null,
        },
        assert: ({ rpcArgs }) => {
          expect(rpcArgs).toEqual({ p_token: 'VERIFYTOKEN' });
        },
      },
      {
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(
            expect.objectContaining({
              away_captain_verified: true,
            }),
          );
          expect(typeof payload.away_verified_at).toBe('string');
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: {
            home_verified_at: '2026-03-30T19:00:00.000Z',
            away_verified_at: '2026-03-30T19:05:00.000Z',
          },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: { status: 'pending_verification' },
          error: null,
        },
      },
      {
        type: 'rpc',
        target: 'rollup_game_stats',
        result: { data: null, error: null },
        assert: ({ rpcArgs }) => {
          expect(rpcArgs).toEqual({ p_game_id: 'game-1' });
        },
      },
      {
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual(
            expect.objectContaining({
              status: 'completed',
            }),
          );
          expect(typeof payload.stats_locked_at).toBe('string');
        },
      },
      {
        type: 'select',
        target: 'games',
        result: {
          data: { status: 'completed', season_id: null, league_id: null },
          error: null,
        },
      },
      {
        type: 'select',
        target: 'game_events',
        result: { data: [], error: null },
      },
      {
        type: 'update',
        target: 'games',
        result: { data: null, error: null },
        assert: ({ payload, filters }) => {
          expect(filters).toContainEqual(['eq', 'id', 'game-1']);
          expect(payload).toEqual({ home_score: 0, away_score: 0 });
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
    expect(functions.invoke).toHaveBeenCalledWith('generate-ai-article', {
      body: { action: 'game_recap', game_id: 'game-1' },
    });
    expect(steps).toHaveLength(0);
  });
});
