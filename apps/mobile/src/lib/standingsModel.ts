export type StandingsFact = {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  divisionId: string | null;
  divisionName: string | null;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  gamesPlayed: number;
};

export type StandingsGameFact = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  status: string | null;
  gameType: string | null;
};

export type PlayoffConfig = {
  playoffTeamsTotal: number | null;
  playoffTeamsPerDivision: number | null;
  useDivisionPlayoffs: boolean | null;
};

export function rankStandings(rows: StandingsFact[]) {
  return [...rows].sort((left, right) => (
    right.points - left.points
    || right.wins - left.wins
    || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst)
    || right.goalsFor - left.goalsFor
    || left.teamName.localeCompare(right.teamName)
    || left.teamId.localeCompare(right.teamId)
  ));
}

function rankOddsStandings<T extends StandingsFact>(rows: T[]) {
  return [...rows].sort((left, right) => (
    right.points - left.points
    || right.wins - left.wins
    || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst)
    || right.goalsFor - left.goalsFor
    || left.teamId.localeCompare(right.teamId)
  ));
}

function configured(config: PlayoffConfig) {
  return Boolean(
    config.useDivisionPlayoffs
      ? (config.playoffTeamsPerDivision ?? 0) >= 2
      : (config.playoffTeamsTotal ?? 0) >= 2,
  );
}

function playoffGroups(rows: StandingsFact[], config: PlayoffConfig) {
  if (!config.useDivisionPlayoffs) return [{ key: 'league', name: null, rows: rankOddsStandings(rows), limit: config.playoffTeamsTotal ?? 0 }];
  const divisions = new Map<string, { name: string | null; rows: StandingsFact[] }>();
  for (const row of rows) {
    const key = row.divisionId ?? '__unassigned__';
    const group = divisions.get(key) ?? { name: row.divisionName, rows: [] };
    group.rows.push(row);
    divisions.set(key, group);
  }
  return [...divisions.entries()]
    .sort((left, right) => (left[1].name ?? '').localeCompare(right[1].name ?? ''))
    .map(([key, group]) => ({ key, name: group.name, rows: rankOddsStandings(group.rows), limit: config.playoffTeamsPerDivision ?? 0 }));
}

function previewGroups(rows: StandingsFact[], config: PlayoffConfig) {
  const byPoints = (items: StandingsFact[]) => [...items].sort((left, right) => right.points - left.points);
  if (!config.useDivisionPlayoffs) return [{ key: 'league', name: null, rows: byPoints(rows), limit: config.playoffTeamsTotal ?? 0 }];
  const divisions = new Map<string, { name: string | null; rows: StandingsFact[] }>();
  for (const row of rows) {
    const key = row.divisionId ?? '__unassigned__';
    const group = divisions.get(key) ?? { name: row.divisionName, rows: [] };
    group.rows.push(row);
    divisions.set(key, group);
  }
  return [...divisions.entries()]
    .sort((left, right) => (left[1].name ?? '').localeCompare(right[1].name ?? ''))
    .map(([key, group]) => ({ key, name: group.name, rows: byPoints(group.rows), limit: config.playoffTeamsPerDivision ?? 0 }));
}

function playoffRoundLabel(roundNumber: number, totalRounds: number) {
  const roundsFromEnd = totalRounds - roundNumber + 1;
  if (roundsFromEnd === 1) return 'Championship';
  if (roundsFromEnd === 2) return 'Semifinals';
  if (roundsFromEnd === 3) return 'Quarterfinals';
  return `Round ${roundNumber}`;
}

export function buildPlayoffPicture(rows: StandingsFact[], config: PlayoffConfig) {
  if (!configured(config)) return { status: 'unavailable' as const, reason: 'Playoff qualification settings are not published.', groups: [] };
  if (rows.length < 2) return { status: 'unavailable' as const, reason: 'Standings are not available yet.', groups: [] };
  const groups = previewGroups(rows, config).map((group) => {
    const qualifiers = group.rows.slice(0, Math.min(group.limit, group.rows.length));
    const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(qualifiers.length, 2)));
    const totalRounds = Math.log2(bracketSize);
    const matchups = Array.from({ length: bracketSize / 2 }, (_, index) => ({
      highSeed: qualifiers[index]!,
      lowSeed: qualifiers[bracketSize - 1 - index] ?? null,
      highRank: index + 1,
      lowRank: qualifiers[bracketSize - 1 - index] ? bracketSize - index : null,
    })).filter((matchup) => matchup.highSeed);
    const rounds = Array.from({ length: totalRounds }, (_, index) => ({
      roundNumber: index + 1,
      label: playoffRoundLabel(index + 1, totalRounds),
    }));
    return { key: group.key, name: group.name, qualifierCount: qualifiers.length, rounds, matchups };
  }).filter((group) => group.qualifierCount >= 2);
  return groups.length
    ? { status: 'ready' as const, groups }
    : { status: 'unavailable' as const, reason: 'At least two teams with standings are required.', groups: [] };
}

function isRegular(game: StandingsGameFact) {
  return !game.gameType || game.gameType === 'regular' || game.gameType === 'regular_season';
}

export function buildSeasonCompletion(games: StandingsGameFact[]) {
  const regular = games.filter((game) => !game.gameType || game.gameType === 'regular');
  const completedRegular = regular.filter((game) => game.status === 'completed' || game.status === 'pending_verification').length;
  return {
    totalRegular: regular.length,
    completedRegular,
    percentage: regular.length ? Math.round((completedRegular / regular.length) * 100) : 0,
    playoffMode: games.some((game) => game.gameType === 'playoff' || game.gameType === 'playoffs'),
  };
}

type SimulationTeam = StandingsFact & { strength: number };

function qualifierIds(rows: SimulationTeam[], config: PlayoffConfig) {
  const ids = new Set<string>();
  for (const group of playoffGroups(rows, config)) {
    group.rows.slice(0, Math.min(group.limit, group.rows.length)).forEach((team) => ids.add(team.teamId));
  }
  return ids;
}

function seedFor(rows: SimulationTeam[], games: StandingsGameFact[], iteration: number) {
  const value = [iteration, ...rows.map((row) => `${row.teamId}:${row.points}:${row.wins}:${row.goalsFor - row.goalsAgainst}`), ...games.map((game) => `${game.id}:${game.homeTeamId}:${game.awayTeamId}`)].join('|');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: number) {
  let state = seed || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function seasonProgress(rows: StandingsFact[], games: StandingsGameFact[]) {
  const appearances = new Map<string, number>();
  for (const game of games.filter(isRegular)) {
    appearances.set(game.homeTeamId, (appearances.get(game.homeTeamId) ?? 0) + 1);
    appearances.set(game.awayTeamId, (appearances.get(game.awayTeamId) ?? 0) + 1);
  }
  const samples = rows.map((row) => {
    const scheduled = appearances.get(row.teamId) ?? 0;
    return scheduled > 0 ? row.gamesPlayed / scheduled : null;
  }).filter((value): value is number => value !== null);
  return samples.length ? clamp(samples.reduce((sum, value) => sum + value, 0) / samples.length, 0, 1) : 1;
}

function baselinePlayoffOdds(rows: StandingsFact[], config: PlayoffConfig) {
  if (!config.useDivisionPlayoffs) return clamp((config.playoffTeamsTotal ?? rows.length) / rows.length, 0, 1);
  const divisionSizes = new Map<string, number>();
  for (const row of rows) divisionSizes.set(row.divisionId ?? '__unassigned__', (divisionSizes.get(row.divisionId ?? '__unassigned__') ?? 0) + 1);
  return clamp(rows.reduce((sum, row) => {
    const size = divisionSizes.get(row.divisionId ?? '__unassigned__') ?? rows.length;
    return sum + Math.min(config.playoffTeamsPerDivision ?? 0, size) / size;
  }, 0) / rows.length, 0, 1);
}

type Bounds = { firstPlace: { min: number; max: number }; playoffs: { min: number; max: number } };

function outcomeBounds(rows: SimulationTeam[], remaining: StandingsGameFact[], config: PlayoffConfig) {
  const remainingCounts = new Map<string, number>();
  for (const game of remaining) {
    remainingCounts.set(game.homeTeamId, (remainingCounts.get(game.homeTeamId) ?? 0) + 1);
    remainingCounts.set(game.awayTeamId, (remainingCounts.get(game.awayTeamId) ?? 0) + 1);
  }
  const maxPoints = new Map(rows.map((row) => [row.teamId, row.points + (remainingCounts.get(row.teamId) ?? 0) * 2]));
  const maxWins = new Map(rows.map((row) => [row.teamId, row.wins + (remainingCounts.get(row.teamId) ?? 0)]));
  const guaranteedAhead = (row: StandingsFact, opponentPoints: number, opponentWins: number) => row.points !== opponentPoints ? row.points > opponentPoints : row.wins > opponentWins;
  const canReach = (points: number, wins: number, opponent: StandingsFact) => points !== opponent.points ? points > opponent.points : wins >= opponent.wins;
  const bounds = new Map<string, Bounds>();
  for (const row of rows) {
    const others = rows.filter((other) => other.teamId !== row.teamId);
    bounds.set(row.teamId, {
      firstPlace: {
        min: others.every((other) => guaranteedAhead(row, maxPoints.get(other.teamId) ?? other.points, maxWins.get(other.teamId) ?? other.wins)) ? 1 : 0,
        max: others.every((other) => !guaranteedAhead(other, maxPoints.get(row.teamId) ?? row.points, maxWins.get(row.teamId) ?? row.wins)) ? 1 : 0,
      },
      playoffs: { min: 0, max: 1 },
    });
  }
  for (const group of playoffGroups(rows, config)) {
    const spots = Math.min(Math.max(group.limit, 0), group.rows.length);
    for (const row of group.rows) {
      const current = bounds.get(row.teamId);
      if (!current) continue;
      if (spots >= group.rows.length) { current.playoffs = { min: 1, max: 1 }; continue; }
      if (spots <= 0) { current.playoffs = { min: 0, max: 0 }; continue; }
      const others = group.rows.filter((other) => other.teamId !== row.teamId);
      const alreadyAhead = others.filter((other) => guaranteedAhead(other, maxPoints.get(row.teamId) ?? row.points, maxWins.get(row.teamId) ?? row.wins)).length;
      const canPass = others.filter((other) => canReach(maxPoints.get(other.teamId) ?? other.points, maxWins.get(other.teamId) ?? other.wins, row)).length;
      current.playoffs = { min: canPass < spots ? 1 : 0, max: alreadyAhead < spots ? 1 : 0 };
    }
  }
  return bounds;
}

export function calculatePlayoffPredictor(rows: StandingsFact[], games: StandingsGameFact[], config: PlayoffConfig) {
  if (!configured(config)) return { status: 'unavailable' as const, reason: 'Playoff qualification settings are not published.' };
  if (!rows.length) return { status: 'unavailable' as const, reason: 'Standings are unavailable, so playoff chances cannot be calculated.' };
  if (!games.length) return { status: 'unavailable' as const, reason: 'Schedule data is unavailable, so playoff chances cannot be calculated.' };

  const teamIds = new Set(rows.map((row) => row.teamId));
  const remaining = games.filter((game) => isRegular(game)
    && (game.status === 'scheduled' || game.status === 'postponed')
    && teamIds.has(game.homeTeamId) && teamIds.has(game.awayTeamId));
  const teamGamesPlayed = rows.reduce((sum, row) => sum + row.gamesPlayed, 0);
  const averagePpg = teamGamesPlayed > 0 ? rows.reduce((sum, row) => sum + row.points, 0) / teamGamesPlayed : 1;
  const averageGoalDiff = teamGamesPlayed > 0
    ? Math.max(1.5, rows.reduce((sum, row) => sum + Math.abs((row.goalsFor - row.goalsAgainst) / Math.max(1, row.gamesPlayed)), 0) / rows.length)
    : 1;
  const tieRate = Math.min(0.35, Math.max(0, teamGamesPlayed > 0 ? rows.reduce((sum, row) => sum + row.ties, 0) / teamGamesPlayed : 0.08));
  const base: SimulationTeam[] = rows.map((row) => {
    const reliability = row.gamesPlayed / (row.gamesPlayed + 8);
    const pointsStrength = averagePpg > 0 ? (row.points / Math.max(1, row.gamesPlayed) - averagePpg) / averagePpg : 0;
    const goalStrength = ((row.goalsFor - row.goalsAgainst) / Math.max(1, row.gamesPlayed)) / averageGoalDiff;
    const winStrength = (row.wins + row.ties * 0.5) / Math.max(1, row.gamesPlayed) - 0.5;
    return { ...row, strength: (pointsStrength * 0.8 + goalStrength * 0.25 + winStrength * 0.35) * reliability };
  });

  if (!remaining.length) {
    const ranked = rankOddsStandings(base);
    const qualified = qualifierIds(base, config);
    return { status: 'ready' as const, teams: ranked.map((team, index) => ({ teamId: team.teamId, firstPlace: index === 0 ? 1 : 0, makePlayoffs: qualified.has(team.teamId) ? 1 : 0 })) };
  }

  const simulations = 5000;
  const firstCounts = new Map<string, number>();
  const playoffCounts = new Map<string, number>();
  for (let iteration = 0; iteration < simulations; iteration += 1) {
    const next = base.map((team) => ({ ...team }));
    const map = new Map(next.map((team) => [team.teamId, team]));
    const rng = random(seedFor(base, remaining, iteration));
    for (const game of remaining) {
      const home = map.get(game.homeTeamId);
      const away = map.get(game.awayTeamId);
      if (!home || !away) continue;
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
      const decisiveHomeShare = Math.min(0.8, Math.max(0.2, 1 / (1 + Math.exp(-(home.strength - away.strength) * 0.7))));
      const roll = rng();
      if (roll < tieRate) {
        home.ties += 1; away.ties += 1; home.points += 1; away.points += 1;
      } else if (roll < tieRate + (1 - tieRate) * decisiveHomeShare) {
        home.wins += 1; away.losses += 1; home.points += 2;
      } else {
        away.wins += 1; home.losses += 1; away.points += 2;
      }
    }
    const ranked = rankOddsStandings(next);
    if (ranked[0]) firstCounts.set(ranked[0].teamId, (firstCounts.get(ranked[0].teamId) ?? 0) + 1);
    for (const id of qualifierIds(next, config)) playoffCounts.set(id, (playoffCounts.get(id) ?? 0) + 1);
  }
  const progress = seasonProgress(rows, games);
  const firstBaseline = 1 / rows.length;
  const playoffBaseline = baselinePlayoffOdds(rows, config);
  const bounds = outcomeBounds(base, remaining, config);
  return {
    status: 'ready' as const,
    teams: rankOddsStandings(base).map((team) => ({
      teamId: team.teamId,
      firstPlace: clamp(firstBaseline + (((firstCounts.get(team.teamId) ?? 0) / simulations) - firstBaseline) * progress, bounds.get(team.teamId)?.firstPlace.min ?? 0, bounds.get(team.teamId)?.firstPlace.max ?? 1),
      makePlayoffs: clamp(playoffBaseline + (((playoffCounts.get(team.teamId) ?? 0) / simulations) - playoffBaseline) * progress, bounds.get(team.teamId)?.playoffs.min ?? 0, bounds.get(team.teamId)?.playoffs.max ?? 1),
    })),
  };
}
