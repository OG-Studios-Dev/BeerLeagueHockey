import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { GET } from './route';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}));

const mockCreateServerClient = jest.mocked(createServerClient);

function authClient(options?: {
  exchangeError?: string;
  setCookieDuringExchange?: boolean;
}) {
  return {
    auth: {
      exchangeCodeForSession: jest.fn(async () => {
        if (options?.setCookieDuringExchange) {
          const cookieAdapter = mockCreateServerClient.mock.calls.at(-1)?.[2].cookies;
          if (!cookieAdapter?.setAll) {
            throw new Error('Expected callback cookie adapter');
          }
          cookieAdapter.setAll([
            { name: 'sb-auth-token', value: '', options: { path: '/' } },
          ]);
        }
        return {
          data: { session: null, user: null },
          error: options?.exchangeError
            ? { message: options.exchangeError }
            : null,
        };
      }),
      getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      verifyOtp: jest.fn(async () => ({ data: {}, error: null })),
    },
  };
}

function request(query: Record<string, string>) {
  const url = new URL('https://app.example.test/api/auth/callback');
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return new NextRequest(url);
}

describe('OAuth callback recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServerClient.mockReturnValue(authClient() as never);
  });

  it('returns canceled linking to settings when the provider supplies no code', async () => {
    const response = await GET(request({
      flow: 'link',
      next: '/en/dashboard/settings',
      error: 'access_denied',
      error_description: 'The user denied access for private@example.test',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=consent_canceled'
    );
    expect(response.headers.get('location')).not.toContain('private%40example.test');
  });

  it('distinguishes an identity conflict without exposing provider details', async () => {
    const response = await GET(request({
      flow: 'link',
      next: '/en/dashboard/settings',
      error: 'server_error',
      error_description: 'Identity for private@example.test is already linked to another user',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=identity_conflict'
    );
    expect(response.headers.get('location')).not.toContain('private');
  });

  it('does not reflect raw provider HTML for a generic failure', async () => {
    const response = await GET(request({
      error: 'server_error',
      error_description: '<img src=x onerror=alert(1)> private@example.test',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/login?oauth_error=oauth_failed'
    );
    expect(response.headers.get('location')).not.toContain('img');
    expect(response.headers.get('location')).not.toContain('private');
  });

  it('keeps the canonical session cookies on a failed linking exchange', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateServerClient.mockReturnValue(authClient({
      exchangeError: 'provider included private@example.test in its failure',
      setCookieDuringExchange: true,
    }) as never);

    const response = await GET(request({
      flow: 'link',
      next: '/en/dashboard/settings',
      code: 'bad-code',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=oauth_failed'
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith('[Auth Callback] Code exchange failed');
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('private@example.test')
    );
    consoleError.mockRestore();
  });

  it('rejects a backslash-based open redirect on a successful OAuth callback', async () => {
    const response = await GET(request({
      code: 'valid-code',
      next: '/\\evil.example.test/path',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard'
    );
  });

  it.each(['google', 'apple'])('keeps normal %s OAuth success behavior', async (provider) => {
    const response = await GET(request({
      code: 'valid-code',
      provider,
      next: '/en/dashboard?welcome=1',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard?welcome=1'
    );
  });

  it('keeps normal email verification success behavior', async () => {
    const response = await GET(request({
      token_hash: 'valid-token',
      type: 'email',
      next: '/fr/dashboard',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/fr/dashboard'
    );
  });
});
