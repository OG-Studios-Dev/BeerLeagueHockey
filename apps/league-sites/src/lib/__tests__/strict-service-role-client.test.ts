const mockedCreateServerClient = jest.fn(() => ({ kind: 'strict-service-role-client' }));
const mockedCreateBrowserClient = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockedCreateServerClient(...args),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockedCreateBrowserClient(...args),
}));
jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import * as strictClients from '@/lib/supabase/strict-service-role';

type StrictServiceRoleFactory = () => unknown;

function strictFactory(): StrictServiceRoleFactory | undefined {
  return (strictClients as typeof strictClients & {
    createStrictServiceRoleClient?: StrictServiceRoleFactory;
  }).createStrictServiceRoleClient;
}

describe('strict server-only Supabase service-role client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://strict-service-role-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
    };
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exists and fails closed instead of using the anonymous key when no server key is configured', () => {
    expect(strictFactory()).toBeDefined();
    expect(() => strictFactory()!()).toThrow(/service role.*not configured/i);
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
    expect(mockedCreateBrowserClient).not.toHaveBeenCalled();
  });

  it('does not accept a NEXT_PUBLIC service-role variable as a server credential', () => {
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = 'synthetic-public-service-key';
    expect(() => strictFactory()!()).toThrow(/service role.*not configured/i);
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
    expect(mockedCreateBrowserClient).not.toHaveBeenCalled();
  });

  it('constructs the cookie-free server client with the server-only service-role key', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-server-only-service-key';

    expect(strictFactory()!()).toEqual({ kind: 'strict-service-role-client' });
    expect(mockedCreateServerClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateServerClient.mock.calls[0]?.[0]).toBe('https://strict-service-role-test.supabase.co');
    expect(mockedCreateServerClient.mock.calls[0]?.[1]).toBe('synthetic-server-only-service-key');
    expect(mockedCreateServerClient.mock.calls[0]?.[1]).not.toBe('synthetic-anon-key');
    expect(mockedCreateBrowserClient).not.toHaveBeenCalled();
  });
});