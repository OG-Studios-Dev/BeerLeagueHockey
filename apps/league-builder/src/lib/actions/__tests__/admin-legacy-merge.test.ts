import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }));
jest.mock('@/lib/actions/auth', () => ({ getCurrentUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/actions/auth';
import { executeAdminMerge } from '../admin-legacy-merge';

describe('executeAdminMerge', () => {
  const mockService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
  const mockCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>;

  beforeEach(() => jest.clearAllMocks());

  it('uses the validated platform admin as actor for the guarded RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { success: true, total_reassigned: 7 },
      error: null,
    });
    mockCurrentUser.mockResolvedValue({
      user: { id: 'admin-1' },
      profile: { is_platform_admin: true },
    } as never);
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('target-1', 'source-1')).resolves.toEqual({
      success: true,
      data: { totalReassigned: 7 },
    });
    expect(rpc).toHaveBeenCalledWith('admin_merge_legacy_profile', {
      p_actor_profile_id: 'admin-1',
      p_target_profile_id: 'target-1',
      p_source_profile_id: 'source-1',
    });
  });

  it('denies an unauthenticated or non-admin caller before creating a service client', async () => {
    mockCurrentUser.mockResolvedValue(null as never);
    await expect(executeAdminMerge('target-1', 'source-1')).rejects.toThrow('Unauthorized');
    expect(mockService).not.toHaveBeenCalled();

    mockCurrentUser.mockResolvedValue({
      user: { id: 'ordinary-user' },
      profile: { is_platform_admin: false },
    } as never);
    await expect(executeAdminMerge('target-1', 'source-1')).rejects.toThrow('Unauthorized');
    expect(mockService).not.toHaveBeenCalled();
  });

  it('fails closed when the guarded RPC rejects an invalid target', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { success: false, error: 'Target profile is not active' },
      error: null,
    });
    mockCurrentUser.mockResolvedValue({
      user: { id: 'admin-1' },
      profile: { is_platform_admin: true },
    } as never);
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('wrong-target', 'source-1')).resolves.toEqual({
      success: false,
      error: 'Target profile is not active',
    });
  });
});
