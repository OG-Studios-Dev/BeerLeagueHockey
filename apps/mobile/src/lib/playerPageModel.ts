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
  { key: 'ties', label: 'T' },
  { key: 'save_percentage', label: 'SV%' },
  { key: 'goals_against_average', label: 'GAA' },
  { key: 'shutouts', label: 'SO' },
  { key: 'saves', label: 'SV' },
];

const SKATER_CAREER_METRICS: PlayerMetricDefinition[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'points', label: 'Points' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'goals_per_game', label: 'GPG' },
  { key: 'points_per_game', label: 'PPG' },
];

const GOALIE_CAREER_METRICS: PlayerMetricDefinition[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'save_percentage', label: 'SV%' },
  { key: 'goals_against_average', label: 'GAA' },
  { key: 'saves', label: 'Saves' },
  { key: 'shutouts', label: 'Shutouts' },
  { key: 'attendance', label: 'Attendance' },
];

export function getPlayerMetricDefinitions(isGoalie: boolean) {
  return isGoalie ? GOALIE_METRICS : SKATER_METRICS;
}

export function getCareerMetricDefinitions(isGoalie: boolean) {
  return isGoalie ? GOALIE_CAREER_METRICS : SKATER_CAREER_METRICS;
}

export function lineChartGeometry(values: readonly (number | null)[], width: number, height: number) {
  const known = values.flatMap((value, index) => value == null || !Number.isFinite(value) ? [] : [{ value, index }]);
  if (!known.length || width <= 0 || height <= 0) {
    return { points: [] as Array<{ x: number; y: number; value: number; index: number }>, minimum: null, maximum: null, linePath: '', areaPath: '' };
  }
  const minimum = Math.min(...known.map((point) => point.value));
  const maximum = Math.max(...known.map((point) => point.value));
  const span = maximum - minimum || 1;
  const divisor = Math.max(values.length - 1, 1);
  const points = known.map(({ value, index }) => ({ value, index, x: (index / divisor) * width, y: height - ((value - minimum) / span) * height }));
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${points.at(-1)!.x.toFixed(2)},${height.toFixed(2)} L${points[0]!.x.toFixed(2)},${height.toFixed(2)} Z`;
  return { points, minimum, maximum, linePath, areaPath };
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
