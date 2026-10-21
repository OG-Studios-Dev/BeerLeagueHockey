export type SubPositionRole = 'goalie' | 'skater';

export interface SearchableSubCandidate {
  full_name?: string | null;
  email?: string | null;
  position?: string | null;
}

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getSubPositionRole(position: string | null | undefined): SubPositionRole | null {
  const normalized = normalizeText(position);
  if (!normalized) return null;

  if (
    normalized === 'g' ||
    normalized === 'goalie' ||
    normalized === 'goaltender' ||
    normalized.includes('goalie') ||
    normalized.includes('goaltender')
  ) {
    return 'goalie';
  }

  if (
    normalized === 'skater' ||
    normalized === 'f' ||
    normalized === 'forward' ||
    normalized === 'forwards' ||
    normalized === 'c' ||
    normalized === 'center' ||
    normalized === 'centre' ||
    normalized === 'lw' ||
    normalized === 'rw' ||
    normalized.includes('wing') ||
    normalized === 'd' ||
    normalized === 'defense' ||
    normalized === 'defence' ||
    normalized.includes('defense') ||
    normalized.includes('defence')
  ) {
    return 'skater';
  }

  return null;
}

export function filterSubCandidatesByReplacementRole<T extends { position?: string | null }>(
  candidates: T[],
  replacementPosition: string | null | undefined,
): T[] {
  const replacementRole = getSubPositionRole(replacementPosition);
  if (!replacementRole) return candidates;

  return candidates.filter((candidate) => getSubPositionRole(candidate.position) === replacementRole);
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function tokenMatches(candidateToken: string, queryToken: string) {
  if (candidateToken.includes(queryToken)) return true;
  if (queryToken.length < 5 || candidateToken.length < 5) return false;
  return levenshteinDistance(candidateToken, queryToken) <= 1;
}

export function matchesSubCandidateSearch(
  candidate: SearchableSubCandidate,
  query: string,
): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeText([
    candidate.full_name,
    candidate.email,
    candidate.position,
  ].filter(Boolean).join(' '));

  if (!haystack) return false;
  if (haystack.includes(normalizedQuery)) return true;

  const candidateTokens = haystack.split(' ').filter(Boolean);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => tokenMatches(candidateToken, queryToken)),
  );
}
