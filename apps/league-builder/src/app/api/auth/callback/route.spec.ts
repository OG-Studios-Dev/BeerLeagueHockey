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
  exchangeErrorCode?: string;
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
            ? { message: options.exchangeError, code: options.exchangeErrorCode }
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

  it.each(['\t', '\n', '\r'])(
    'rejects a control-character open redirect on provider failure: %p',
    async (control) => {
      const response = await GET(request({
        flow: 'link',
        next: `/${control}/evil.example.test/path`,
        error: 'access_denied',
      }));

      expect(response.headers.get('location')).toBe(
        'https://app.example.test/en/dashboard/settings?oauth_error=consent_canceled'
      );
    }
  );

  it.each(['\t', '\n', '\r'])(
    'rejects a control-character open redirect after successful exchange: %p',
    async (control) => {
      const response = await GET(request({
        code: 'valid-code',
        next: `/${control}/evil.example.test/path`,
      }));

      expect(response.headers.get('location')).toBe(
        'https://app.example.test/en/dashboard'
      );
    }
  );

  it('rejects a redirect that normalizes to a cross-origin destination', async () => {
    const response = await GET(request({
      flow: 'link',
      next: '/%2e%2e//evil.example.test/path',
      error: 'access_denied',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=consent_canceled'
    );
  });

  it('uses an explicit validated French locale for a direct sign-in failure', async () => {
    const response = await GET(request({
      locale: 'fr',
      error: 'access_denied',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/fr/login?oauth_error=consent_canceled'
    );
  });

  it('preserves a sanitized nested continuation for retry after exchange failure', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateServerClient.mockReturnValue(authClient({
      exchangeError: 'expired exchange',
      exchangeErrorCode: 'flow_state_expired',
    }) as never);

    const response = await GET(request({
      code: 'bad-code',
      locale: 'fr',
      next: '/fr/dashboard?tab=billing&panel=invoices',
    }));
    const location = new URL(response.headers.get('location')!);

    expect(location.origin).toBe('https://app.example.test');
    expect(location.pathname).toBe('/fr/login');
    expect(location.searchParams.get('oauth_error')).toBe('oauth_failed');
    expect(location.searchParams.get('redirect')).toBe(
      '/fr/dashboard?tab=billing&panel=invoices'
    );
    consoleError.mockRestore();
  });

  it('shows an allowlisted failure for a bare incomplete linking callback', async () => {
    const response = await GET(request({
      flow: 'link',
      locale: 'fr',
      next: '/fr/dashboard/settings?tab=connections',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/fr/dashboard/settings?tab=connections&oauth_error=oauth_failed'
    );
  });

  it('classifies an error-code-only identity conflict', async () => {
    const response = await GET(request({
      flow: 'link',
      locale: 'fr',
      next: '/fr/dashboard/settings',
      error_code: 'identity_already_exists',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/fr/dashboard/settings?oauth_error=identity_conflict'
    );
  });

  it('gives a structured identity code precedence over a conflicting denial', async () => {
    const response = await GET(request({
      flow: 'link',
      next: '/en/dashboard/settings',
      error: 'access_denied',
      error_code: 'email_exists',
      error_description: 'The user canceled',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=identity_conflict'
    );
  });

  it('maps a structured SDK exchange conflict without exposing provider details', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateServerClient.mockReturnValue(authClient({
      exchangeError: 'private@example.test already exists',
      exchangeErrorCode: 'email_exists',
    }) as never);

    const response = await GET(request({
      code: 'bad-code',
      flow: 'link',
      next: '/en/dashboard/settings',
    }));

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/en/dashboard/settings?oauth_error=identity_conflict'
    );
    expect(response.headers.get('location')).not.toContain('private');
    consoleError.mockRestore();
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
