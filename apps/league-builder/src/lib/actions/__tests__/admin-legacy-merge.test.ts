import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }));
jest.mock('@/lib/actions/auth', () => ({ getCurrentUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/actions/auth';
import { revalidatePath } from 'next/cache';
import { executeAdminMerge } from '../admin-legacy-merge';

describe('executeAdminMerge', () => {
  const mockService = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
  const mockCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser.mockResolvedValue({
      user: { id: 'admin-1' },
      profile: { is_platform_admin: true },
    } as never);
  });

  it('uses the validated platform admin as actor for the guarded RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { success: true, total_reassigned: 7 },
      error: null,
    });
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
    expect(revalidatePath).toHaveBeenCalledTimes(1);
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
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('wrong-target', 'source-1')).resolves.toEqual({
      success: false,
      error: 'Target profile is not active',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['missing payload', null],
    ['boolean false', { success: false }],
    ['null success', { success: null }],
    ['string success', { success: 'false', total_reassigned: 7 }],
    ['numeric success', { success: 1, total_reassigned: 7 }],
  ])('rejects %s without revalidating', async (_label, data) => {
    const rpc = jest.fn().mockResolvedValue({ data, error: null });
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('target-1', 'source-1')).resolves.toEqual(
      expect.objectContaining({ success: false })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['string', '7'],
    ['negative', -1],
    ['infinite', Infinity],
    ['not-a-number', NaN],
  ])('rejects a %s total_reassigned count without revalidating', async (_label, totalReassigned) => {
    const rpc = jest.fn().mockResolvedValue({
      data: { success: true, total_reassigned: totalReassigned },
      error: null,
    });
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('target-1', 'source-1')).resolves.toEqual({
      success: false,
      error: 'Merge RPC returned invalid response',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a transport error without revalidating', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'transport down' },
    });
    mockService.mockReturnValue({ rpc } as never);

    await expect(executeAdminMerge('target-1', 'source-1')).resolves.toEqual({
      success: false,
      error: 'Merge failed: transport down',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
