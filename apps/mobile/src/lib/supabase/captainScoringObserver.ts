import { supabase } from './client';
import type { ScoringScope } from './captainScoring';
let observerId = 0;
/** Invalidation hints only. SUBSCRIBED does not prove publication; UI polling stays enabled. */
export function watchCaptainScoring(scope: ScoringScope, onInvalidate: () => void, onStatus?: (status: string) => void): () => void {
  let active = true;
  const invalidate = () => { if (active) onInvalidate(); };
  const channel = supabase.channel(`captain-scoring:${scope.gameId}:${scope.teamId}:${++observerId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${scope.gameId}` }, invalidate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${scope.gameId}` }, invalidate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_checkins', filter: `game_id=eq.${scope.gameId}` }, invalidate)
    .subscribe(status => { if (!active) return; onStatus?.(status); if (status === 'SUBSCRIBED') invalidate(); });
  return () => { if (!active) return; active = false; void supabase.removeChannel(channel); };
}
