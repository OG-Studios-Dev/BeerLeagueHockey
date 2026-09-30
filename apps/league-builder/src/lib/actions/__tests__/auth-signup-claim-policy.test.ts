import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}));
jest.mock('@/i18n/navigation', () => ({
  redirect: jest.fn((target: unknown) => {
    const error = new Error('NEXT_REDIRECT');
    Object.assign(error, { digest: 'NEXT_REDIRECT', target });
    throw error;
  }),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/dist/client/components/redirect-error', () => ({
  isRedirectError: jest.fn((error: unknown) => (
    error instanceof Error && (error as Error & { digest?: string }).digest === 'NEXT_REDIRECT'
  )),
}));
jest.mock('next-intl/server', () => ({ getLocale: jest.fn().mockResolvedValue('en') }));
jest.mock('../legacy-merge', () => ({
  checkLegacyMergeStatus: jest.fn().mockResolvedValue({
    hasPendingMatches: true,
    matchCount: 1,
    isMerged: false,
  }),
}));
jest.mock('@/lib/organizations/access', () => ({ getUserOrganizationsWithAccess: jest.fn() }));

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { redirect } from '@/i18n/navigation';
import { signUp } from '../auth';

describe('signup pending player-history policy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the account once and preserves a forged selection only as a pending hint', async () => {
    const createUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'new-user' } },
      error: null,
    });
    const rpc = jest.fn();
    const deleteUser = jest.fn();
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const insert = jest.fn().mockResolvedValue({ error: null });

    (createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>).mockReturnValue({
      auth: { admin: { createUser, deleteUser } },
      rpc,
      from: jest.fn((table: string) => {
        if (table === 'profiles') return { upsert };
        if (table === 'user_consents') return { insert };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as never);
    (createClient as jest.MockedFunction<typeof createClient>).mockResolvedValue({
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { session: { access_token: 'local-test' } },
          error: null,
        }),
      },
    } as never);

    const form = new FormData();
    form.set('email', 'new@example.com');
    form.set('password', 'Strong!Pass1');
    form.set('fullName', 'New Player');
    form.set('organizationName', '');
    form.set('claimPlayerProfileId', '11111111-1111-4111-8111-111111111111');
    form.set('acceptTerms', 'true');
    form.set('acceptPrivacy', 'true');

    await expect(signUp(form)).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT',
      target: { href: '/claim-history', locale: 'en' },
    });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-user',
        role: 'player',
        pending_legacy_match_ids: ['11111111-1111-4111-8111-111111111111'],
      }),
      { onConflict: 'id' }
    );
    expect(redirect).toHaveBeenCalledWith({ href: '/claim-history', locale: 'en' });
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
