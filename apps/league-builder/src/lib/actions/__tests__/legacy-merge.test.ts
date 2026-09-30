import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { claimLegacyProfile, getLegacyCandidates, searchClaimablePlayerProfiles } from '../legacy-merge';

describe('legacy merge candidate loading', () => {
  const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
  const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records a selected pending match for admin review without merging it', async () => {
    const rpc = jest.fn();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
    } as never);
    mockCreateServiceRoleClient.mockReturnValue({
      rpc,
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({
              data: { pending_legacy_match_ids: ['legacy-1'] },
              error: null,
            }),
          })),
        })),
      })),
    } as never);

    await expect(claimLegacyProfile('legacy-1')).resolves.toEqual({
      success: true,
      pendingApproval: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('aggregates candidate stats from player_season_stats instead of per-game rows', async () => {
    const authClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1' },
          },
        }),
      },
    };

    const serviceClient = {
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn((columns: string) => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue(
                  columns === 'pending_legacy_match_ids'
                    ? { data: { pending_legacy_match_ids: ['legacy-1'] }, error: null }
                    : { data: { id: 'legacy-1', full_name: 'Alex Legacy' }, error: null }
                ),
              })),
            })),
          };
        }

        if (table === 'team_rosters') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    teams: { name: 'Wolves' },
                    seasons: { name: 'Winter 2025' },
                  },
                ],
                error: null,
              }),
            })),
          };
        }

        if (table === 'player_season_stats') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { games_played: 10, goals: 4, assists: 7, points: 11 },
                  { games_played: 8, goals: 3, assists: 5, points: 8 },
                ],
                error: null,
              }),
            })),
          };
        }

        if (table === 'player_stats') {
          throw new Error('legacy candidate loading should not read player_stats');
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mockCreateClient.mockResolvedValue(authClient as never);
    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never);

    const result = await getLegacyCandidates();

    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'legacy-1',
          fullName: 'Alex Legacy',
          teams: [
            {
              teamName: 'Wolves',
              seasonName: 'Winter 2025',
            },
          ],
          stats: {
            gamesPlayed: 18,
            goals: 7,
            assists: 12,
            points: 19,
          },
        },
      ],
    });
  });
});

describe('signup-time claimable player search', () => {
  const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only returns rostered profiles that are not already attached to auth users', async () => {
    const serviceClient = {
      auth: {
        admin: {
          getUserById: jest.fn((profileId: string) => {
            if (profileId === 'claimed-user') {
              return Promise.resolve({ data: { user: { id: profileId } }, error: null });
            }
            return Promise.resolve({ data: { user: null }, error: { message: 'not found' } });
          }),
        },
      },
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn(() => ({
              or: jest.fn(() => ({
                is: jest.fn(() => ({
                  limit: jest.fn().mockResolvedValue({
                    data: [
                      { id: 'claimable-1', full_name: 'Alex Claim', email: 'alex@example.com', is_legacy_import: true },
                      { id: 'claimed-user', full_name: 'Alex Taken', email: 'taken@example.com', is_legacy_import: false },
                      { id: 'unrostered-1', full_name: 'Alex Bench', email: 'bench@example.com', is_legacy_import: false },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'team_rosters') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn((_column: string, profileId: string) => Promise.resolve({
                data:
                  profileId === 'claimable-1'
                    ? [{ teams: { name: 'Wolves' }, seasons: { name: 'Winter 2025' } }]
                    : [],
                error: null,
              })),
            })),
          };
        }

        if (table === 'player_season_stats') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({
                data: [{ games_played: 12, goals: 5, assists: 6, points: 11 }],
                error: null,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never);

    const result = await searchClaimablePlayerProfiles('Alex');

    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'claimable-1',
          fullName: 'Alex Claim',
          emailHint: 'al••@example.com',
          isLegacyImport: true,
          teams: [{ teamName: 'Wolves', seasonName: 'Winter 2025' }],
          stats: { gamesPlayed: 12, goals: 5, assists: 6, points: 11 },
        },
      ],
    });
  });
});
