import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthRedirect } from '../AuthRedirect';

const mockReplace = jest.fn();
let mockLeagueSlug = 'alpha';
let mockAuthState: { user: { id: string } | null; isLoading: boolean } = { user: null, isLoading: true };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => ({ leagueSlug: mockLeagueSlug }),
}));
jest.mock('@/hooks/useUser', () => ({ useUser: () => mockAuthState }));

describe('AuthRedirect', () => {
  beforeEach(() => mockReplace.mockClear());

  it.each([
    ['loading', { user: null, isLoading: true }, 'alpha'],
    ['guest', { user: null, isLoading: false }, 'alpha'],
    ['authenticated', { user: { id: 'user-1' }, isLoading: false }, 'beta'],
  ])('renders hydration-safe empty markup for a %s session', (_name, authState, leagueSlug) => {
    mockAuthState = authState;
    mockLeagueSlug = leagueSlug;
    expect(renderToStaticMarkup(React.createElement(AuthRedirect))).toBe('');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
