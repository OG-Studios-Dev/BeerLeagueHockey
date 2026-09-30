import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthApiError } from '@supabase/supabase-js';

jest.mock('@/lib/supabase/server', () => ({
  createAuthClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));
jest.mock('@/lib/captain/invite-preview', () => ({ getPublicCaptainInvitePreview: jest.fn() }));

import { createAuthClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getPublicCaptainInvitePreview } from '@/lib/captain/invite-preview';
import { consumeCaptainInvite, createCaptainPlayerInvite } from '../captain-player-invites';

describe('consumeCaptainInvite', () => {
  const mockAuth = createAuthClient as jest.MockedFunction<typeof createAuthClient>;
  const mockService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unauthenticated caller before service access', async () => {
    mockAuth.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);

    await expect(consumeCaptainInvite('invite-1')).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
    expect(mockService).not.toHaveBeenCalled();
  });

  it('derives the current user and leaves an unverified bearer invite pending', async () => {
    const rpc = jest.fn();
    const update = jest.fn();
    mockAuth.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'real-user' } } }) },
    } as never);
    mockService.mockReturnValue({
      rpc,
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: 'invite-1',
                target_player_id: 'source-1',
                consumed_at: null,
                created_at: new Date().toISOString(),
              },
            }),
          })),
        })),
        update,
      })),
    } as never);

    await expect(consumeCaptainInvite('invite-1')).resolves.toEqual({
      success: false,
      pendingApproval: true,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['consumed', { consumed_at: new Date().toISOString(), created_at: new Date().toISOString() }],
    ['expired', { consumed_at: null, created_at: '2020-01-01T00:00:00.000Z' }],
  ])('fails closed for a %s token', async (_label, state) => {
    const rpc = jest.fn();
    mockAuth.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'real-user' } } }) },
    } as never);
    mockService.mockReturnValue({
      rpc,
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'invite-1', target_player_id: 'source-1', ...state },
            }),
          })),
        })),
      })),
    } as never);

    await expect(consumeCaptainInvite('invite-1')).resolves.toEqual({
      success: false,
      error: 'Invite is invalid or no longer available',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('createCaptainPlayerInvite', () => {
  const mockAuth = createAuthClient as jest.MockedFunction<typeof createAuthClient>;
  const mockService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    (getPublicCaptainInvitePreview as jest.MockedFunction<typeof getPublicCaptainInvitePreview>)
      .mockResolvedValue({ inviteId: 'invite-1' } as never);
    mockAuth.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'captain-1' } } }) },
      from: jest.fn(() => {
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn(() => query),
          is: jest.fn(() => query),
          maybeSingle: jest.fn().mockResolvedValue({ data: { leadership_role: 'captain' } }),
        };
        return query;
      }),
    } as never);
  });

  function existingPlayerService(options: {
    authResult?: unknown;
    authThrows?: boolean;
    roster?: Record<string, unknown> | null;
    profile?: Record<string, unknown> | null;
  } = {}) {
    const mutations: Array<{ table: string; operation: 'insert' | 'update' }> = [];
    const filters: Record<string, Array<[string, unknown]>> = {};
    const getUserById = jest.fn(async () => {
      if (options.authThrows) throw new Error('lookup failed');
      return options.authResult ?? {
        data: { user: null },
        error: new AuthApiError('User not found', 404, 'user_not_found'),
      };
    });
    const service = {
      auth: { admin: { getUserById } },
      from: jest.fn((table: string) => {
        filters[table] ||= [];
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn((column: string, value: unknown) => {
            filters[table].push([column, value]);
            return query;
          }),
          is: jest.fn(() => query),
          insert: jest.fn(() => {
            mutations.push({ table, operation: 'insert' });
            return query;
          }),
          update: jest.fn(() => {
            mutations.push({ table, operation: 'update' });
            return query;
          }),
          single: jest.fn(async () => ({
            data: table === 'teams'
              ? { id: 'team-1', league_id: 'league-1', leagues: { slug: 'league' } }
              : { id: 'invite-1' },
            error: null,
          })),
          maybeSingle: jest.fn(async () => ({
            data: table === 'seasons'
              ? { id: 'season-1', league_id: 'league-1' }
              : table === 'team_rosters'
                ? (options.roster === undefined
                  ? { id: 'roster-1', player_id: 'player-1', team_id: 'team-1', season_id: 'season-1', league_id: 'league-1' }
                  : options.roster)
                : (options.profile === undefined
                  ? { id: 'player-1', full_name: 'Player', phone: null, deleted_at: null, legacy_merge_completed_at: null }
                  : options.profile),
            error: null,
          })),
          then: (resolve: (result: { data: null; error: null }) => unknown) => (
            Promise.resolve({ data: null, error: null }).then(resolve)
          ),
        };
        return query;
      }),
    };
    return { service, mutations, filters, getUserById };
  }

  const existingInput = {
    teamId: 'team-1',
    seasonId: 'season-1',
    existingPlayerId: 'player-1',
    existingRosterId: 'roster-1',
    phone: '5551234567',
    isSpare: false,
  };

  it('rejects a season outside the team league before any profile or roster mutation', async () => {
    const mutations: string[] = [];
    mockService.mockReturnValue({
      from: jest.fn((table: string) => {
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn(() => query),
          single: jest.fn().mockResolvedValue({
            data: table === 'teams'
              ? { id: 'team-1', league_id: 'league-1', leagues: { slug: 'league' } }
              : null,
            error: null,
          }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn(() => { mutations.push(table); return query; }),
          update: jest.fn(() => { mutations.push(table); return query; }),
        };
        return query;
      }),
    } as never);

    await expect(createCaptainPlayerInvite({
      teamId: 'team-1', seasonId: 'wrong-season', fullName: 'Guest', isSpare: false,
    })).resolves.toEqual({ success: false, error: 'Season does not belong to this league' });
    expect(mutations).toEqual([]);
  });

  it('fails closed on an upstream auth lookup error before editing an existing player', async () => {
    const mutations: string[] = [];
    const rosterFilters: Array<[string, unknown]> = [];
    mockService.mockReturnValue({
      auth: { admin: { getUserById: jest.fn().mockResolvedValue({ data: null, error: { message: 'network down', status: 503 } }) } },
      from: jest.fn((table: string) => {
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn((column: string, value: unknown) => {
            if (table === 'team_rosters') rosterFilters.push([column, value]);
            return query;
          }),
          is: jest.fn(() => query),
          single: jest.fn().mockResolvedValue({ data: { id: 'team-1', league_id: 'league-1', leagues: { slug: 'league' } }, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({
            data: table === 'seasons'
              ? { id: 'season-1', league_id: 'league-1' }
              : table === 'team_rosters'
                ? { id: 'roster-1', player_id: 'player-1', team_id: 'team-1', season_id: 'season-1', league_id: 'league-1' }
                : { id: 'player-1', full_name: 'Player', deleted_at: null, legacy_merge_completed_at: null },
            error: null,
          }),
          insert: jest.fn(() => { mutations.push(table); return query; }),
          update: jest.fn(() => { mutations.push(table); return query; }),
        };
        return query;
      }),
    } as never);

    await expect(createCaptainPlayerInvite({
      teamId: 'team-1', seasonId: 'season-1', existingPlayerId: 'player-1',
      existingRosterId: 'roster-1', isSpare: false,
    })).resolves.toEqual({ success: false, error: 'Could not verify existing player eligibility' });
    expect(mutations).toEqual([]);
    expect(rosterFilters).toEqual(expect.arrayContaining([
      ['id', 'roster-1'],
      ['player_id', 'player-1'],
      ['team_id', 'team-1'],
      ['season_id', 'season-1'],
      ['league_id', 'league-1'],
    ]));
  });

  it('rejects an upstream error whose message contains not found before mutation', async () => {
    const { service, mutations } = existingPlayerService({
      authResult: {
        data: { user: null },
        error: new AuthApiError('upstream route not found', 503, 'user_not_found'),
      },
    });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Could not verify existing player eligibility',
    });
    expect(mutations).toEqual([]);
  });

  it.each([
    ['an unbranded error', { data: { user: null }, error: { name: 'AuthApiError', status: 404, code: 'user_not_found', message: 'User not found' } }],
    ['missing response data', { error: new AuthApiError('User not found', 404, 'user_not_found') }],
    ['an empty successful lookup', { data: { user: null }, error: null }],
    ['a malformed payload', { data: null, error: null }],
  ])('rejects %s before mutation', async (_label, authResult) => {
    const { service, mutations } = existingPlayerService({ authResult });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Could not verify existing player eligibility',
    });
    expect(mutations).toEqual([]);
  });

  it('allows an existing player only for the installed SDK authoritative not-found response', async () => {
    const { service, mutations, getUserById } = existingPlayerService();
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: true,
      data: { inviteId: 'invite-1' },
    });
    expect(getUserById).toHaveBeenCalledWith('player-1');
    expect(mutations).toEqual([
      { table: 'profiles', operation: 'update' },
      { table: 'captain_player_invites', operation: 'insert' },
      { table: 'captain_player_invites', operation: 'update' },
    ]);
  });

  it('rejects an Auth-backed existing player before mutation', async () => {
    const { service, mutations } = existingPlayerService({
      authResult: { data: { user: { id: 'player-1' } }, error: null },
    });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Existing player already has an account',
    });
    expect(mutations).toEqual([]);
  });

  it.each([
    ['deleted', { deleted_at: '2026-01-01T00:00:00.000Z', legacy_merge_completed_at: null }],
    ['merged', { deleted_at: null, legacy_merge_completed_at: '2026-01-01T00:00:00.000Z' }],
  ])('rejects a %s source profile before Auth lookup or mutation', async (_label, state) => {
    const { service, mutations, getUserById } = existingPlayerService({
      profile: { id: 'player-1', full_name: 'Player', phone: null, ...state },
    });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Existing player not found',
    });
    expect(getUserById).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });

  it('rejects a roster mismatch before profile/Auth lookup or mutation', async () => {
    const { service, mutations, getUserById } = existingPlayerService({ roster: null });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Existing player is not on this team roster',
    });
    expect(getUserById).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });

  it.each([
    ['player only', { existingPlayerId: 'player-1' }],
    ['roster only', { existingRosterId: 'roster-1' }],
  ])('rejects half-specified source IDs (%s) before mutation', async (_label, ids) => {
    const { service, mutations, getUserById } = existingPlayerService();
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite({
      teamId: 'team-1', seasonId: 'season-1', isSpare: false, ...ids,
    })).resolves.toEqual({
      success: false,
      error: 'Existing player and roster must be selected together',
    });
    expect(getUserById).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });

  it('rejects a thrown Auth lookup before mutation', async () => {
    const { service, mutations } = existingPlayerService({ authThrows: true });
    mockService.mockReturnValue(service as never);

    await expect(createCaptainPlayerInvite(existingInput)).resolves.toEqual({
      success: false,
      error: 'Could not verify existing player eligibility',
    });
    expect(mutations).toEqual([]);
  });

  it('creates a new guest and invite after team and league season validation', async () => {
    const inserted: string[] = [];
    (getPublicCaptainInvitePreview as jest.MockedFunction<typeof getPublicCaptainInvitePreview>)
      .mockResolvedValue({ inviteId: 'invite-1' } as never);
    mockService.mockReturnValue({
      from: jest.fn((table: string) => {
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn(() => query),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'season-1', league_id: 'league-1' }, error: null }),
          insert: jest.fn(() => { inserted.push(table); return query; }),
          update: jest.fn(() => query),
          then: (resolve: (result: { data: null; error: null }) => unknown) => (
            Promise.resolve({ data: null, error: null }).then(resolve)
          ),
          single: jest.fn().mockResolvedValue({
            data: table === 'teams'
              ? { id: 'team-1', name: 'Team', league_id: 'league-1', leagues: { slug: 'league' } }
              : { id: table === 'team_rosters' ? 'roster-1' : 'invite-1' },
            error: null,
          }),
        };
        return query;
      }),
    } as never);

    await expect(createCaptainPlayerInvite({
      teamId: 'team-1', seasonId: 'season-1', fullName: 'Guest Player', isSpare: false,
    })).resolves.toEqual({ success: true, data: { inviteId: 'invite-1' } });
    expect(inserted).toEqual(['profiles', 'team_rosters', 'captain_player_invites']);
  });
});
