export const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
export const HOCKEY_LIFE_SLUG = 'hockey-life';
export const HOCKEY_LIFE_NAME = 'Hockey Life';
export const HOCKEY_LIFE_PRIMARY = '#03299B';
export const HOCKEY_LIFE_SECONDARY = '#FFFFFF';

type HockeyLifeCandidate = {
  id: string;
  slug?: string | null;
};

export function isHockeyLifeLeague(league: HockeyLifeCandidate | null | undefined) {
  return league?.id === HOCKEY_LIFE_ID;
}

export function selectHockeyLifeMembership<T extends HockeyLifeCandidate>(
  memberships: readonly T[],
  persistedLeagueId: string | null,
) {
  const active = memberships.find(isHockeyLifeLeague) ?? null;
  return {
    active,
    available: active ? [active] : [],
    accessState: active ? 'ready' as const : 'hockey-life-membership-required' as const,
    shouldClearPersistedSelection: Boolean(persistedLeagueId && persistedLeagueId !== HOCKEY_LIFE_ID),
  };
}
