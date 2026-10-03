import { setRequestLocale } from 'next-intl/server';
import { FinancialWorkspaceShell } from '@/components/financials/FinancialWorkspaceShell';
import { getFinancialWorkspaceData } from '@/lib/financial-workspace/get-financial-workspace-data';
import { FinanceDashboard } from './FinanceDashboard';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function LeagueFinancePage({ params, searchParams }: Props) {
  const awaited = await params;
  const { locale, id: leagueId } = awaited;
  setRequestLocale(locale);

  let workspace: Awaited<ReturnType<typeof getFinancialWorkspaceData>>;
  try {
    workspace = await getFinancialWorkspaceData({
      leagueId,
      locale,
      route: 'finance',
      searchParams: await searchParams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown finance error';
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
        <div className="max-w-lg rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
          <h1 className="text-2xl font-bold text-white">Finance dashboard unavailable</h1>
          <p className="mt-2 text-sm text-neutral-400">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <FinancialWorkspaceShell common={workspace.common} overview={workspace.overview}>
      {workspace.accounting ? (
        <FinanceDashboard
          locale={locale}
          leagueId={leagueId}
          requestedSeason={workspace.common.requestedSeason}
          data={workspace.accounting.data}
          ledgerRows={workspace.accounting.ledgerRows}
          ledgerTotal={workspace.accounting.ledgerTotal}
          ledgerPage={workspace.accounting.ledgerPage}
          ledgerLimit={workspace.accounting.ledgerLimit}
          ledgerFilters={workspace.accounting.ledgerFilters}
          ledgerError={workspace.accounting.ledgerError}
          quickBooksStatus={workspace.accounting.quickBooksStatus}
          quickBooksToast={workspace.accounting.quickBooksToast}
        />
      ) : null}
    </FinancialWorkspaceShell>
  );
}
