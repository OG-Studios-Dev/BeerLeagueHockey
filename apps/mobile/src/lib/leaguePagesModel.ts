import type {
  PagePlayer,
  PageSeries,
  PageStanding,
  PageTeam,
  PlayoffsPageResponse,
  PositioningData,
  PositionMetric,
  TeamsPageResponse,
} from './leaguePages';

export type PlayerFilters = {
  search?: string;
  teamId?: string | null;
  divisionId?: string | null;
  position?: string | null;
};

export function filterPlayerMemberships(rows: PagePlayer[], filters: PlayerFilters): PagePlayer[] {
  const search = filters.search?.trim().toLocaleLowerCase() ?? '';
  return rows.filter((row) => {
    if (filters.teamId && row.teamId !== filters.teamId) return false;
    if (filters.divisionId && row.divisionId !== filters.divisionId) return false;
    if (filters.position && row.position !== filters.position) return false;
    if (search) {
      const jersey = row.jerseyNumber === null ? '' : String(row.jerseyNumber);
      if (!row.fullName.toLocaleLowerCase().includes(search) && !jersey.includes(search)) return false;
    }
    return true;
  });
}

export function filterPlayers(rows: PagePlayer[], filters: PlayerFilters): PagePlayer[] {
  const filteredMemberships = filterPlayerMemberships(rows, filters);

  filteredMemberships.sort((left, right) => (
    left.fullName.localeCompare(right.fullName)
    || left.id.localeCompare(right.id)
    || left.teamName.localeCompare(right.teamName)
    || left.teamId.localeCompare(right.teamId)
  ));
  const unique = new Map<string, PagePlayer>();
  for (const row of filteredMemberships) if (!unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()];
}

export function reconcilePlayerFilters(rows: PagePlayer[], filters: PlayerFilters): Required<PlayerFilters> {
  const divisionIds = new Set(rows.map((row) => row.divisionId).filter((value): value is string => value !== null));
  const divisionId = filters.divisionId && divisionIds.has(filters.divisionId) ? filters.divisionId : null;
  const divisionRows = divisionId ? rows.filter((row) => row.divisionId === divisionId) : rows;
  const teamId = filters.teamId && divisionRows.some((row) => row.teamId === filters.teamId) ? filters.teamId : null;
  const teamRows = teamId ? divisionRows.filter((row) => row.teamId === teamId) : divisionRows;
  const position = filters.position && teamRows.some((row) => row.position === filters.position) ? filters.position : null;
  return { divisionId, teamId, position, search: filters.search ?? '' };
}

export const POSITION_METRICS: Array<{ key: PositionMetric; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'scoringDepth', label: 'Scoring Depth' },
  { key: 'commitment', label: 'Commitment' },
];

export function buildBumpChartSegment(from: { x: number; y: number }, to: { x: number; y: number }) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  return {
    center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    length: Math.hypot(deltaX, deltaY),
    angleRadians: Math.atan2(deltaY, deltaX),
  };
}

export function filterAndRerankPositioning(data: PositioningData | null, divisionId: string | null): PositioningData | null {
  if (!data) return null;
  const teams = divisionId ? data.teams.filter((team) => team.divisionId === divisionId) : data.teams;
  if (!teams.length) return null;
  if (!divisionId) return data;
  const rankByMetric = new Map<PositionMetric, Map<string, number>>();
  for (const metric of POSITION_METRICS) {
    const ordered = [...teams].sort((left, right) => (
      left.metrics[metric.key].rank - right.metrics[metric.key].rank
      || left.teamName.localeCompare(right.teamName)
    ));
    rankByMetric.set(metric.key, new Map(ordered.map((team, index) => [team.teamId, index + 1])));
  }
  return {
    ...data,
    totalTeams: teams.length,
    teams: teams.map((team) => ({
      ...team,
      metrics: Object.fromEntries(POSITION_METRICS.map(({ key }) => [key, {
        ...team.metrics[key], rank: rankByMetric.get(key)?.get(team.teamId) ?? team.metrics[key].rank,
      }])) as typeof team.metrics,
    })),
  };
}

export function positioningNarrative(
  team: PositioningData['teams'][number],
  metricKey: PositionMetric,
  totalTeams: number,
): string {
  const metric = team.metrics[metricKey];
  const label = POSITION_METRICS.find((entry) => entry.key === metricKey)?.label ?? metricKey;
  const value = metricKey === 'commitment' ? `${metric.valueLabel} estimated attendance` : metric.valueLabel;
  return `${team.teamName} ranks #${metric.rank} of ${totalTeams} in ${label} with ${value}.`;
}

export function buildTeamsDirectoryView(data: TeamsPageResponse, divisionId: string | null, defaultSeasonId: string | null) {
  const filtered = divisionId ? data.teams.filter((team) => team.divisionId === divisionId) : data.teams;
  const groups: Array<{ id: string | null; name: string; teams: PageTeam[] }> = [];
  if (divisionId) {
    const selected = data.divisions.find((entry) => entry.id === divisionId);
    if (filtered.length) groups.push({ id: divisionId, name: selected?.name ?? 'Division', teams: filtered });
  } else if (data.divisions.length) {
    for (const division of data.divisions) {
      const teams = filtered.filter((team) => team.divisionId === division.id);
      if (teams.length) groups.push({ id: division.id, name: division.name, teams });
    }
    const unassigned = filtered.filter((team) => !team.divisionId);
    if (unassigned.length) groups.push({ id: null, name: 'Unassigned', teams: unassigned });
  } else if (filtered.length) {
    groups.push({ id: null, name: 'All Teams', teams: filtered });
  }
  const positioning = data.selectedSeason?.id === defaultSeasonId
    ? filterAndRerankPositioning(data.positioning, divisionId) : null;
  return { count: filtered.length, groups, positioning };
}

export type PreviewTeam = {
  teamId: string; teamName: string; logoUrl: string | null; points: number; rank: number;
  divisionId: string | null; divisionName: string | null;
};
export type PreviewSeries = { seriesNumber: number; highSeed: PreviewTeam | null; lowSeed: PreviewTeam | null };
export type PreviewRound = { roundNumber: number; label: string; series: PreviewSeries[] };
export type PlayoffPreview = {
  bracketSize: number; totalRounds: number; playoffTeamCount: number; firstRound: PreviewSeries[]; rounds: PreviewRound[];
  useDivisionPlayoffs: boolean; divisionId: string | null; divisionName: string | null;
};
export type PlayoffPreviewConfig = {
  playoffTeamsTotal: number | null; playoffTeamsPerDivision: number | null; useDivisionPlayoffs: boolean | null;
};

function roundLabel(roundNumber: number, totalRounds: number) {
  const fromEnd = totalRounds - roundNumber + 1;
  if (fromEnd === 1) return 'Championship';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round ${roundNumber}`;
}

export function buildPlayoffPreviewContext(standings: PageStanding[]) {
  const map = new Map<string, { id: string; name: string; teamCount: number }>();
  for (const row of standings) {
    if (!row.divisionId) continue;
    const item = map.get(row.divisionId);
    if (item) item.teamCount += 1;
    else map.set(row.divisionId, { id: row.divisionId, name: row.divisionName || 'Unnamed Division', teamCount: 1 });
  }
  const availableDivisions = [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
  return { availableDivisions, requiresDivisionSelection: availableDivisions.length > 1, totalTeams: standings.length };
}

export function buildPlayoffPreview(
  standings: PageStanding[], config: PlayoffPreviewConfig, divisionId?: string | null,
): { success: true; data: PlayoffPreview } | { success: false; error: string } {
  const sorted = [...standings].sort((left, right) => right.points - left.points || left.teamName.localeCompare(right.teamName));
  const context = buildPlayoffPreviewContext(sorted);
  if (!sorted.length) return { success: false, error: 'No standings data available yet — games need to be played first.' };
  if (context.requiresDivisionSelection && !divisionId) return { success: false, error: 'Select a division to preview playoff seeding.' };
  const selectedDivision = divisionId ? context.availableDivisions.find((entry) => entry.id === divisionId) ?? null : null;
  if (divisionId && !selectedDivision) return { success: false, error: 'Selected division was not found in the current standings.' };
  const scoped = selectedDivision ? sorted.filter((row) => row.divisionId === selectedDivision.id) : sorted;
  const limit = selectedDivision
    ? config.playoffTeamsPerDivision ?? config.playoffTeamsTotal ?? Math.min(8, scoped.length)
    : config.playoffTeamsTotal ?? Math.min(8, scoped.length);
  const teams: PreviewTeam[] = scoped.slice(0, limit).map((row, index) => ({
    ...row, rank: index + 1,
  }));
  if (teams.length < 2) {
    const prefix = selectedDivision ? `${selectedDivision.name} needs` : 'Need';
    return { success: false, error: `${prefix} at least 2 teams with standings to preview seeding.` };
  }
  const bracketSize = 2 ** Math.ceil(Math.log2(teams.length));
  const totalRounds = Math.log2(bracketSize);
  const firstRound: PreviewSeries[] = Array.from({ length: bracketSize / 2 }, (_, index) => ({
    seriesNumber: index + 1,
    highSeed: teams[index] ?? null,
    lowSeed: teams[bracketSize - 1 - index] ?? null,
  }));
  const rounds: PreviewRound[] = [{ roundNumber: 1, label: roundLabel(1, totalRounds), series: firstRound }];
  let matchups = firstRound.length;
  for (let roundNumber = 2; roundNumber <= totalRounds; roundNumber += 1) {
    matchups = Math.max(1, matchups / 2);
    rounds.push({
      roundNumber,
      label: roundLabel(roundNumber, totalRounds),
      series: Array.from({ length: matchups }, (_, index) => ({ seriesNumber: index + 1, highSeed: null, lowSeed: null })),
    });
  }
  return {
    success: true,
    data: {
      bracketSize, totalRounds, playoffTeamCount: teams.length, firstRound, rounds,
      useDivisionPlayoffs: Boolean(selectedDivision) || Boolean(config.useDivisionPlayoffs),
      divisionId: selectedDivision?.id ?? null, divisionName: selectedDivision?.name ?? null,
    },
  };
}

export type PlayoffSection = {
  key: string; divisionId: string | null; divisionName: string | null; totalRounds: number;
  rounds: Array<{ roundNumber: number; label: string; series: PageSeries[] }>;
  champion: PageSeries['highSeed'] | PageSeries['lowSeed'] | null;
};

export function groupOfficialPlayoffs(series: PageSeries[]): PlayoffSection[] {
  const grouped = new Map<string, PageSeries[]>();
  for (const item of series) grouped.set(item.divisionId ?? 'overall', [...(grouped.get(item.divisionId ?? 'overall') ?? []), item]);
  return [...grouped.entries()].map(([key, entries]) => {
    const totalRounds = Math.max(...entries.map((entry) => entry.roundNumber));
    const roundNumbers = [...new Set(entries.map((entry) => entry.roundNumber))].sort((a, b) => a - b);
    const finalWinner = entries.find((entry) => entry.roundNumber === totalRounds && entry.status === 'completed' && entry.winnerId);
    return {
      key,
      divisionId: entries[0]?.divisionId ?? null,
      divisionName: entries[0]?.divisionName ?? null,
      totalRounds,
      rounds: roundNumbers.map((number) => ({
        roundNumber: number,
        label: roundLabel(number, totalRounds),
        series: entries.filter((entry) => entry.roundNumber === number).sort((a, b) => a.seriesNumber - b.seriesNumber),
      })),
      champion: finalWinner && finalWinner.winnerId === finalWinner.highSeed?.id ? finalWinner.highSeed
        : finalWinner && finalWinner.winnerId === finalWinner.lowSeed?.id ? finalWinner.lowSeed : null,
    };
  }).sort((left, right) => (left.divisionName ?? '').localeCompare(right.divisionName ?? ''));
}

export function emptySeedLabel(series: Pick<PageSeries, 'highSeed' | 'lowSeed' | 'status'>, side: 'high' | 'low') {
  const target = side === 'high' ? series.highSeed : series.lowSeed;
  const opponent = side === 'high' ? series.lowSeed : series.highSeed;
  if (target) return target.name;
  return series.status === 'bye' && opponent ? 'BYE' : 'TBD';
}

export function buildPlayoffsDirectoryView(data: PlayoffsPageResponse, divisionId: string | null = null) {
  const officialSeries = divisionId ? data.series.filter((entry) => entry.divisionId === divisionId) : data.series;
  return {
    officialSeriesCount: officialSeries.length,
    sections: groupOfficialPlayoffs(officialSeries),
    previewContext: buildPlayoffPreviewContext(data.standings),
    seedLabel: emptySeedLabel,
    generatePreview: (divisionId: string | null) => buildPlayoffPreview(data.standings, data.previewConfig, divisionId),
  };
}

export function createLatestRequestGate() {
  let generation = 0;
  return {
    begin(scope: string) {
      const requestGeneration = ++generation;
      return { scope, requestGeneration };
    },
    invalidate() { generation += 1; },
    isCurrent(request: { scope: string; requestGeneration: number }, scope: string) {
      return request.requestGeneration === generation && request.scope === scope;
    },
  };
}

export function commitLatestPageResult(
  gate: ReturnType<typeof createLatestRequestGate>,
  request: { scope: string; requestGeneration: number },
  scope: string,
  commit: () => void,
) {
  if (!gate.isCurrent(request, scope)) return false;
  commit();
  return true;
}
