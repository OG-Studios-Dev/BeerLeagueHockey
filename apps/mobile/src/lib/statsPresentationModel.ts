import { formatPublicMetric, type PublicMetricSource, type PublicStatMetric, type PublicTeamRef } from './supabase/publicStats';

export type StatsScopeKind = 'current' | 'single' | 'multiple' | 'all';
export type StatsScopeSelection = { kind: StatsScopeKind; seasonIds?: string[] };
export type StatsSeasonOption = {
  id: string;
  name: string;
  status: string | null;
  startDate: string | null;
};
export type NormalizedStatsScope = {
  kind: StatsScopeKind;
  seasonIds: string[];
  label: string;
  currentSeasonId: string;
};

export type StatsScopePlayer = {
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  displayTeam: (PublicTeamRef & { logoUrl?: string | null }) | null;
  skater: {
    gamesPlayed: PublicStatMetric;
    goals: PublicStatMetric;
    assists: PublicStatMetric;
    points: PublicStatMetric;
    championships: PublicStatMetric;
  } | null;
  goalie: {
    gamesPlayed: PublicStatMetric;
    goalsAgainst: PublicStatMetric;
    goalsAgainstAverage: PublicStatMetric;
    championships: PublicStatMetric;
  } | null;
};

export type StatsTableColumnKey = 'gp' | 'g' | 'a' | 'pts' | 'ga' | 'gaa' | 'ch' | 'gpg' | 'ppg';
export type StatsTableColumn = {
  key: StatsTableColumnKey;
  label: string;
  display: string;
  state: PublicStatMetric['state'];
  accessibilityLabel: string;
};
export type StatsTableRow = StatsScopePlayer & {
  rank: number;
  name: { givenName: string; surname: string };
  columns: StatsTableColumn[];
};
export type StatsLeaderMetric = 'points' | 'goals' | 'assists' | 'gaa';
export type StatsLeaderRow = StatsScopePlayer & { rank: number; value: PublicStatMetric; display: string };

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  active: 0,
  playoffs: 1,
  registration: 2,
  upcoming: 2,
  draft: 3,
  completed: 4,
  archived: 5,
};

function seasonTimestamp(season: StatsSeasonOption): number {
  if (!season.startDate) return 0;
  const parsed = new Date(season.startDate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function orderedSeasons(seasons: readonly StatsSeasonOption[]): StatsSeasonOption[] {
  const ids = new Set<string>();
  for (const season of seasons) {
    if (!season.id || ids.has(season.id)) throw new TypeError('Invalid or duplicate season');
    ids.add(season.id);
  }
  return [...seasons].sort((left, right) => (
    (STATUS_PRIORITY[left.status ?? ''] ?? 99) - (STATUS_PRIORITY[right.status ?? ''] ?? 99)
    || seasonTimestamp(right) - seasonTimestamp(left)
    || left.id.localeCompare(right.id)
  ));
}

export function normalizeStatsScope(
  selection: StatsScopeSelection,
  seasons: readonly StatsSeasonOption[],
): NormalizedStatsScope {
  const ordered = orderedSeasons(seasons);
  const current = ordered[0];
  if (!current) throw new TypeError('No season is available');
  const byId = new Map(ordered.map((season) => [season.id, season]));
  let seasonIds: string[];
  if (selection.kind === 'current') {
    seasonIds = [current.id];
  } else if (selection.kind === 'all') {
    seasonIds = ordered.map((season) => season.id);
  } else {
    const requested = [...new Set(selection.seasonIds ?? [])];
    if ((selection.kind === 'single' && requested.length !== 1) || (selection.kind === 'multiple' && requested.length < 1)) {
      throw new TypeError('The selected season scope is invalid');
    }
    if (requested.some((seasonId) => !byId.has(seasonId))) throw new TypeError('The selected season is unavailable');
    const requestedSet = new Set(requested);
    seasonIds = ordered.filter((season) => requestedSet.has(season.id)).map((season) => season.id);
  }
  const label = selection.kind === 'current'
    ? 'Current season'
    : selection.kind === 'all'
      ? 'All time'
      : selection.kind === 'single'
        ? byId.get(seasonIds[0])!.name
        : `${seasonIds.length} seasons`;
  return { kind: selection.kind, seasonIds, label, currentSeasonId: current.id };
}

export function splitPlayerName(value: string): { givenName: string; surname: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { givenName: parts[0] ?? 'Unknown', surname: parts.slice(1).join(' ') };
}

function display(metric: PublicStatMetric, digits?: number): string {
  return formatPublicMetric(metric, digits).value;
}

const SOURCE_LABELS: Readonly<Record<PublicMetricSource, string>> = {
  attendance: 'attendance records',
  skater_stats: 'game statistics',
  goalie_stats: 'goalie statistics',
  goalie_assignment: 'goalie assignments',
  roster_window: 'roster eligibility',
  accepted_sub: 'accepted substitute records',
  imported: 'imported records',
  override: 'administrative override',
  capture_confirmation: 'championship capture confirmation',
  player_badges: 'player championship badges',
};

function provenanceDescription(metric: PublicStatMetric): string {
  const sources = metric.sources.length > 0
    ? `Sources: ${metric.sources.map((source) => SOURCE_LABELS[source]).join('; ')}.`
    : 'No provenance source was provided.';
  const candidates = metric.candidates
    ? ` Source values: ${(['confirmed', 'recorded', 'estimated'] as const)
      .filter((key) => metric.candidates?.[key] !== undefined)
      .map((key) => `${key} ${metric.candidates![key]}`)
      .join('; ')}.`
    : '';
  return `${sources}${candidates}`;
}

function metricAccessibilityLabel(label: string, metric: PublicStatMetric, digits?: number): string {
  const formatted = formatPublicMetric(metric, digits);
  const spokenValue = metric.state === 'conflicted' || metric.value === null ? 'unavailable' : formatted.value;
  return `${label}, ${spokenValue}. Display value ${formatted.value}. State: ${metric.state}. ${formatted.hint} ${provenanceDescription(metric)}`;
}

function metricColumn(key: StatsTableColumnKey, label: string, metric: PublicStatMetric, digits?: number): StatsTableColumn {
  return {
    key,
    label,
    display: display(metric, digits),
    state: metric.state,
    accessibilityLabel: metricAccessibilityLabel(label, metric, digits),
  };
}

function rateColumn(
  key: 'gpg' | 'ppg',
  label: 'GPG' | 'PPG',
  numerator: PublicStatMetric,
  denominator: PublicStatMetric,
): StatsTableColumn {
  const sources = [...new Set([...numerator.sources, ...denominator.sources])];
  if (numerator.state === 'conflicted' || denominator.state === 'conflicted') {
    const metric: PublicStatMetric = { value: null, state: 'conflicted', sources };
    return {
      ...metricColumn(key, label, metric, 2),
      accessibilityLabel: `${label}, unavailable. Display value Needs review. Conflicting source metrics need review. ${key === 'gpg' ? 'Goals' : 'Points'} source: ${metricAccessibilityLabel(key === 'gpg' ? 'G' : 'PTS', numerator)} Games played source: ${metricAccessibilityLabel('GP', denominator)}`,
    };
  }
  if (numerator.value === null || denominator.value === null || denominator.value <= 0
    || numerator.state === 'unknown' || denominator.state === 'unknown') {
    const metric: PublicStatMetric = { value: null, state: 'unknown', sources };
    return {
      ...metricColumn(key, label, metric, 2),
      accessibilityLabel: `${label}, unavailable because the source total or games played is not recorded. Display value —. ${key === 'gpg' ? 'Goals' : 'Points'} source: ${metricAccessibilityLabel(key === 'gpg' ? 'G' : 'PTS', numerator)} Games played source: ${metricAccessibilityLabel('GP', denominator)}`,
    };
  }
  const states = [numerator.state, denominator.state];
  const state: PublicStatMetric['state'] = states.includes('estimated')
    ? 'estimated'
    : states.includes('reported')
      ? 'reported'
      : states.every((value) => value === 'verified')
        ? 'verified'
        : 'recorded';
  const column = metricColumn(key, label, { value: numerator.value / denominator.value, state, sources }, 2);
  return {
    ...column,
    accessibilityLabel: `${column.accessibilityLabel} Calculated from ${key === 'gpg' ? 'G' : 'PTS'}: ${metricAccessibilityLabel(key === 'gpg' ? 'G' : 'PTS', numerator)} Divided by GP: ${metricAccessibilityLabel('GP', denominator)}`,
  };
}

function deterministicName(left: StatsScopePlayer, right: StatsScopePlayer): number {
  return left.playerName.localeCompare(right.playerName, undefined, { sensitivity: 'base' })
    || left.playerId.localeCompare(right.playerId);
}

export function buildSkaterRows(players: readonly StatsScopePlayer[]): StatsTableRow[] {
  return players.filter((player) => player.skater !== null)
    .sort((left, right) => {
      const leftValue = left.skater!.points.value;
      const rightValue = right.skater!.points.value;
      if (leftValue === null && rightValue !== null) return 1;
      if (rightValue === null && leftValue !== null) return -1;
      return (rightValue ?? 0) - (leftValue ?? 0) || deterministicName(left, right);
    })
    .map((player, index) => {
      const stats = player.skater!;
      return {
        ...player,
        rank: index + 1,
        name: splitPlayerName(player.playerName),
        columns: [
          metricColumn('gp', 'GP', stats.gamesPlayed),
          metricColumn('g', 'G', stats.goals),
          metricColumn('a', 'A', stats.assists),
          metricColumn('pts', 'PTS', stats.points),
          metricColumn('ch', 'CH', stats.championships),
          rateColumn('gpg', 'GPG', stats.goals, stats.gamesPlayed),
          rateColumn('ppg', 'PPG', stats.points, stats.gamesPlayed),
        ],
      };
    });
}

export function buildGoalieRows(players: readonly StatsScopePlayer[]): StatsTableRow[] {
  return players.filter((player) => player.goalie !== null)
    .sort((left, right) => {
      const leftValue = left.goalie!.goalsAgainstAverage.value;
      const rightValue = right.goalie!.goalsAgainstAverage.value;
      if (leftValue === null && rightValue !== null) return 1;
      if (rightValue === null && leftValue !== null) return -1;
      return (leftValue ?? 0) - (rightValue ?? 0) || deterministicName(left, right);
    })
    .map((player, index) => {
      const stats = player.goalie!;
      return {
        ...player,
        rank: index + 1,
        name: splitPlayerName(player.playerName),
        columns: [
          metricColumn('gp', 'GP', stats.gamesPlayed),
          metricColumn('ga', 'GA', stats.goalsAgainst),
          metricColumn('gaa', 'GAA', stats.goalsAgainstAverage, 2),
          metricColumn('ch', 'CH', stats.championships),
        ],
      };
    });
}

export function buildLeaderRows(players: readonly StatsScopePlayer[], metric: StatsLeaderMetric): StatsLeaderRow[] {
  const candidates = players.flatMap((player) => {
    const value = metric === 'gaa' ? player.goalie?.goalsAgainstAverage : player.skater?.[metric];
    return value && value.value !== null && value.state !== 'unknown' && value.state !== 'conflicted'
      ? [{ ...player, value, display: display(value, metric === 'gaa' ? 2 : undefined) }]
      : [];
  });
  candidates.sort((left, right) => {
    const valueOrder = metric === 'gaa'
      ? left.value.value! - right.value.value!
      : right.value.value! - left.value.value!;
    return valueOrder || deterministicName(left, right);
  });
  return candidates.slice(0, 5).map((player, index) => ({ ...player, rank: index + 1 }));
}
