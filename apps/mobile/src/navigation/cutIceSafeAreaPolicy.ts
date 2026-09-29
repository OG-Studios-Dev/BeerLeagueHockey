import type { Edge } from 'react-native-safe-area-context';

export function cutIceContentEdges(edges: readonly Edge[]): Edge[] {
  return edges.filter((edge) => edge !== 'top');
}
