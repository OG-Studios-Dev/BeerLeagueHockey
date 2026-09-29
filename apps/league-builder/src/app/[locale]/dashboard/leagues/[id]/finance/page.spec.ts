import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setRequestLocale } from 'next-intl/server';
import { getFinancialWorkspaceData } from '@/lib/financial-workspace/get-financial-workspace-data';

jest.mock('next-intl/server', () => ({ setRequestLocale: jest.fn() }));
jest.mock('@/lib/financial-workspace/get-financial-workspace-data', () => ({
  getFinancialWorkspaceData: jest.fn(),
}));
jest.mock('@/components/financials/FinancialWorkspaceShell', () => ({
  FinancialWorkspaceShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('main', { 'data-testid': 'workspace' }, children),
}));
jest.mock('./FinanceDashboard', () => ({
  FinanceDashboard: ({ leagueId }: { leagueId: string }) =>
    React.createElement('section', { 'data-league-id': leagueId }, 'finance dashboard'),
}));

const getWorkspace = jest.mocked(getFinancialWorkspaceData);
let LeagueFinancePage: typeof import('./page').default;

describe('LeagueFinancePage', () => {
  beforeAll(async () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    LeagueFinancePage = (await import('./page')).default;
  });

  beforeEach(() => jest.clearAllMocks());

  it('builds the successful workspace after the async data fetch', async () => {
    getWorkspace.mockResolvedValue({
      common: { requestedSeason: 'season-1' },
      overview: {},
      accounting: {
        data: {}, ledgerRows: [], ledgerTotal: 0, ledgerPage: 1, ledgerLimit: 25,
        ledgerFilters: {}, ledgerError: null, quickBooksStatus: null, quickBooksToast: null,
      },
    } as never);

    const view = await LeagueFinancePage({
      params: Promise.resolve({ locale: 'en', id: 'league-1' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(setRequestLocale).toHaveBeenCalledWith('en');
    expect(getWorkspace).toHaveBeenCalledWith({
      leagueId: 'league-1', locale: 'en', route: 'finance', searchParams: { page: '1' },
    });
    expect(renderToStaticMarkup(view)).toContain('data-league-id="league-1"');
  });

  it('preserves the existing unavailable fallback when data loading rejects', async () => {
    getWorkspace.mockRejectedValue(new Error('finance is offline'));

    const view = await LeagueFinancePage({
      params: Promise.resolve({ locale: 'en', id: 'league-1' }),
    });

    expect(renderToStaticMarkup(view)).toContain(
      'Finance dashboard unavailable</h1><p class="mt-2 text-sm text-neutral-400">finance is offline',
    );
  });
});
