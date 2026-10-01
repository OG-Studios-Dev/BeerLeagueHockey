import React from 'react';

import { commitLatestPageResult, createLatestRequestGate } from '../lib/leaguePagesModel';
import { loadPublicPlayersDirectory, type PlayersDirectoryData } from '../lib/playersDirectory';

export function usePlayersDirectory(scope: { leagueId: string; leagueSlug: string }) {
  const { leagueId, leagueSlug } = scope;
  const scopeKey = `${leagueId}:${leagueSlug}`;
  const [retryKey, setRetryKey] = React.useState(0);
  const [gate] = React.useState(createLatestRequestGate);
  const requestScope = `${scopeKey}:${retryKey}`;
  const [result, setResult] = React.useState<{
    requestScope: string;
    data: PlayersDirectoryData | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const current = result?.requestScope === requestScope ? result : null;

  React.useEffect(() => {
    const request = gate.begin(requestScope);
    setResult({ requestScope, data: null, loading: true, error: null });
    void loadPublicPlayersDirectory({ leagueId, leagueSlug })
      .then((data) => commitLatestPageResult(gate, request, requestScope, () => {
        setResult({ requestScope, data, loading: false, error: null });
      }))
      .catch((reason: unknown) => commitLatestPageResult(gate, request, requestScope, () => {
        setResult({ requestScope, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Unable to load Players directory.' });
      }));
    return () => gate.invalidate();
  }, [gate, leagueId, leagueSlug, requestScope]);

  return {
    data: current?.data ?? null,
    loading: current?.loading ?? true,
    error: current?.error ?? null,
    retry: () => setRetryKey((value) => value + 1),
  };
}
