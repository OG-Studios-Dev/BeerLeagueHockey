import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { middleware } from './middleware';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('next-intl/middleware', () => ({
  __esModule: true,
  default: jest.fn(() => () => NextResponse.next()),
}));

const mockCreateServerClient = jest.mocked(createServerClient);

describe('legacy privacy policy route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServerClient.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as never);
  });

  it.each([
    ['/privacy-policy', '/en/privacy'],
    ['/en/privacy-policy', '/en/privacy'],
    ['/fr/privacy-policy', '/fr/privacy'],
  ])('allows and redirects public %s to %s', async (source, target) => {
    const response = await middleware(
      new NextRequest(`https://app.example.test${source}`)
    );

    expect(response.headers.get('location')).toBe(
      `https://app.example.test${target}`
    );
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });
});
