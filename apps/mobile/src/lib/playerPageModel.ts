export const PLAYER_SECTION_ORDER = [
  'identity',
  'achievements',
  'season-stats',
  'career-stats',
  'game-log',
  'matchup-stats',
  'in-the-news',
  'season-history',
] as const;

export type PlayerSection = (typeof PLAYER_SECTION_ORDER)[number];

export function visiblePlayerSections(counts: {
  achievements: number;
  careerSeasons: number;
  games: number;
  matchups: number;
  articles: number;
  seasons: number;
}): PlayerSection[] {
  const visible = new Set<PlayerSection>(['identity', 'season-stats']);
  if (counts.achievements > 0) visible.add('achievements');
  if (counts.careerSeasons > 0) visible.add('career-stats');
  if (counts.games > 0) visible.add('game-log');
  if (counts.matchups > 0) visible.add('matchup-stats');
  if (counts.articles > 0) visible.add('in-the-news');
  if (counts.seasons > 1) visible.add('season-history');
  return PLAYER_SECTION_ORDER.filter((section) => visible.has(section));
}

export type PlayerMetricDefinition = { key: string; label: string };

const SKATER_METRICS: PlayerMetricDefinition[] = [
  { key: 'games_played', label: 'GP' },
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'points', label: 'PTS' },
  { key: 'penalty_minutes', label: 'PIM' },
  { key: 'plus_minus', label: '+/-' },
];

const GOALIE_METRICS: PlayerMetricDefinition[] = [
  { key: 'games_played', label: 'GP' },
  { key: 'wins', label: 'W' },
  { key: 'losses', label: 'L' },
  { key: 'save_percentage', label: 'SV%' },
  { key: 'goals_against_average', label: 'GAA' },
  { key: 'shutouts', label: 'SO' },
  { key: 'saves', label: 'SV' },
];

export function getPlayerMetricDefinitions(isGoalie: boolean) {
  return isGoalie ? GOALIE_METRICS : SKATER_METRICS;
}

export function resolvePlayerSeasonSelection<T extends { id: string }>(
  seasons: readonly T[],
  currentSeasonId: string | null,
  requestedSeasonId: string | null,
) {
  if (requestedSeasonId === 'all') return { selectedId: null, isCareer: true };
  const requested = requestedSeasonId && seasons.some((season) => season.id === requestedSeasonId)
    ? requestedSeasonId
    : null;
  const current = currentSeasonId && seasons.some((season) => season.id === currentSeasonId)
    ? currentSeasonId
    : seasons[0]?.id ?? null;
  return { selectedId: requested ?? current, isCareer: false };
}

export function createPlayerRequestGate() {
  let generation = 0;
  return {
    begin: (identity: string) => ({ identity, generation: ++generation }),
    isCurrent: (request: { identity: string; generation: number }, identity: string) =>
      request.generation === generation && request.identity === identity,
    invalidate: () => { generation += 1; },
  };
}
