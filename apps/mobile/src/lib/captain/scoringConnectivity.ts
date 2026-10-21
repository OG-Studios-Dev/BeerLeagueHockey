import { getNetworkStateAsync, addNetworkStateListener, type NetworkState } from 'expo-network';

export type ScoringConnectivity = 'online' | 'offline' | 'unknown';
function connection(state: NetworkState): ScoringConnectivity {
  // Android UNKNOWN can carry negative flags without proving disconnection.
  if (state.type === 'UNKNOWN' && (state.isConnected === false || state.isInternetReachable === false)) return 'unknown';
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  return state.isConnected === true ? 'online' : 'unknown';
}
// A connection indication is not proof that the scoring server is reachable.
export function watchScoringConnectivity(publish: (state: ScoringConnectivity) => void): () => void {
  let live = true, eventSeen = false;
  let listener: { remove(): void } | undefined;
  try { listener = addNetworkStateListener(state => { eventSeen = true; if (live) publish(connection(state)); }); }
  catch { publish('unknown'); }
  const unavailable = () => { if (live && !eventSeen) publish('unknown'); };
  try { void getNetworkStateAsync().then(state => { if (live && !eventSeen) publish(connection(state)); }, unavailable); }
  catch { unavailable(); }
  return () => { live = false; listener?.remove(); };
}
