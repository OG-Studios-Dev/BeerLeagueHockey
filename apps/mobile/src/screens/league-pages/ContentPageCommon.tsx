import React from 'react';

import { getLeagueContent, type ContentRequest, type ContentResponse } from '../../lib/leagueContent';
import { commitLatestPageResult, createLatestRequestGate } from '../../lib/leaguePagesModel';

type Scope = { leagueId: string; leagueSlug: string };
type ViewResult<V extends ContentRequest['view']> = Extract<ContentResponse, { view: V }>;

export function useLeagueContent<V extends ContentRequest['view']>(scope: Scope, request: Extract<ContentRequest, { view: V }>) {
  const detailId = 'articleSlug' in request ? request.articleSlug : 'albumId' in request ? request.albumId : '';
  const identity = `${scope.leagueId}:${scope.leagueSlug}:${request.view}:${detailId}`;
  const [retryKey, setRetryKey] = React.useState(0);
  const requestScope = `${identity}:${retryKey}`;
  const [gate] = React.useState(createLatestRequestGate);
  const [state, setState] = React.useState<{ requestScope: string; data: ViewResult<V> | null; error: string | null; loading: boolean } | null>(null);
  const current = state?.requestScope === requestScope ? state : null;
  const stableRequest = React.useMemo<ContentRequest>(() => request.view === 'article'
    ? { view: 'article', articleSlug: detailId }
    : request.view === 'album' ? { view: 'album', albumId: detailId }
      : { view: request.view }, [detailId, request.view]);

  React.useEffect(() => {
    const pending = gate.begin(requestScope);
    const controller = new AbortController();
    setState({ requestScope, data: null, error: null, loading: true });
    void getLeagueContent(scope.leagueSlug, stableRequest, fetch, controller.signal).then(response => {
      commitLatestPageResult(gate, pending, requestScope, () => {
        if (response.league.id !== scope.leagueId) throw new TypeError('League content route identity mismatch');
        setState({ requestScope, data: response as ViewResult<V>, error: null, loading: false });
      });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      commitLatestPageResult(gate, pending, requestScope, () => setState({ requestScope, data: null, error: reason instanceof Error ? reason.message : 'Unable to load league content.', loading: false }));
    });
    return () => { controller.abort(); gate.invalidate(); };
  }, [gate, requestScope, scope.leagueId, scope.leagueSlug, stableRequest]);

  return { data: current?.data ?? null, error: current?.error ?? null, loading: current?.loading ?? true, retry: () => setRetryKey(value => value + 1), identity };
}
