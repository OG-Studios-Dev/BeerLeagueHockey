import { supabase } from './client';
import { getMetricsOperationalSeason } from './team';
import { getPublicSeasonStats, type PublicGoalieMetrics, type PublicSeasonPlayer, type PublicSeasonStats } from './publicStats';
import type { PublicStatMetric } from './publicStats';

export type TeamLeaderMetric = 'points' | 'goals' | 'assists' | 'penaltyMinutes';
export type TeamStatProvenance = 'authoritative' | 'estimated' | null;

export type TeamPageIdentity = {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
};

export type TeamPageRosterPlayer = {
  rosterId: string;
  playerId: string;
  name: string;
  photoUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  isGoalie: boolean;
  leadershipRole: string | null;
  playerType: string | null;
  gamesPlayed: number | null;
  gamesPlayedProvenance: TeamStatProvenance;
  gamesPlayedMetric?: PublicStatMetric;
  goals: number | null;
  assists: number | null;
  points: number | null;
  penaltyMinutes: number | null;
  goalieGamesPlayed: number | null;
  goalieGamesPlayedProvenance: TeamStatProvenance;
  goalsAgainstAverage: number | null;
  goalsAgainstAverageProvenance: TeamStatProvenance;
  publicMetrics?: PublicSeasonPlayer['metrics'];
  publicGoalieMetrics?: PublicGoalieMetrics | null;
};

export type TeamPageLeader = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  jerseyNumber: number | null;
  gamesPlayed: number | null;
  gamesPlayedProvenance: TeamStatProvenance;
  gamesPlayedMetric?: PublicStatMetric;
  value: number;
};

export type TeamPageGame = {
  id: string;
  scheduledAt: string;
  status: string | null;
  location: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: TeamPageIdentity;
  awayTeam: TeamPageIdentity;
};

export type TeamPageStanding = {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  gamesPlayed: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifferential: number | null;
};

export type TeamPageRivalSide = TeamPageIdentity & {
  overallRecord: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifferential: number | null;
  strength: 'offense' | 'defence' | 'goaltending' | 'balanced';
  weakness: 'offense' | 'defence' | 'goaltending' | 'balanced';
  sniper: { name: string; goals: number | null };
  playmaker: { name: string; assists: number | null };
  tendy: { name: string; gamesPlayed: number | null; gamesPlayedProvenance: TeamStatProvenance; goalsAgainstAverage: number | null; goalsAgainstAverageProvenance: TeamStatProvenance };
};

export type TeamPageRival = {
  team: TeamPageRivalSide;
  rival: TeamPageRivalSide;
  h2hRecord: string;
  h2hRecordRival: string;
  gamesPlayed: number;
};

export type TeamPageSnapshot = {
  season: { id: string; name: string; status: string; startDate: string | null; endDate: string | null };
  team: TeamPageIdentity;
  league: { id: string; name: string; slug: string | null; primaryColor: string | null; timezone: string };
  standing: TeamPageStanding | null;
  standings: TeamPageStanding[];
  rank: number | null;
  record: string;
  streak: string | null;
  hero: { winPercentage: number | null };
  roster: TeamPageRosterPlayer[];
  leaders: Record<TeamLeaderMetric, TeamPageLeader[]>;
  games: TeamPageGame[];
  collapsedSchedule: TeamPageGame[];
  nextGame: TeamPageGame | null;
  rivals: TeamPageRival[];
  championships: { count: number; latestTitleSeasonName: string | null; latestTitleLabel: string | null; titleSeasonIds: string[] };
  captain: TeamPageRosterPlayer | null;
  publishedLineup: unknown | null;
  acceptedSubstitutions: Array<{ id: string; subPlayerId: string; subPlayerName: string; replacedPlayerId: string | null; replacedPlayerName: string | null }>;
  sponsors: Array<{ id: string; name: string; logoUrl: string | null; websiteUrl: string | null; tier: string | null }>;
};

export type TeamPageSnapshotInput = {
  teamId: string;
  leagueId: string;
  season: Record<string, unknown>;
  team: Record<string, unknown>;
  league: Record<string, unknown>;
  teams: Array<Record<string, unknown>>;
  standings: Array<Record<string, unknown>>;
  rosters: Array<Record<string, unknown>>;
  leagueRosters?: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  seasonStats: Array<Record<string, unknown>>;
  playerStats: Array<Record<string, unknown>>;
  goalieStats: Array<Record<string, unknown>>;
  checkins?: Array<Record<string, unknown>>;
  availability?: Array<Record<string, unknown>>;
  games: Array<Record<string, unknown>>;
  seasons: Array<Record<string, unknown>>;
  historicalStandings: Array<Record<string, unknown>>;
  publishedLineup: unknown | null;
  acceptedSubstitutions?: Array<Record<string, unknown>>;
  sponsors: Array<Record<string, unknown>>;
  publicSeasonStats?: PublicSeasonStats;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function identity(row: Record<string, unknown> | null | undefined): TeamPageIdentity {
  return {
    id: stringValue(row?.id) ?? '',
    name: stringValue(row?.name) ?? 'Team',
    slug: stringValue(row?.slug),
    logoUrl: stringValue(row?.logo_url) ?? stringValue(row?.logo),
    primaryColor: stringValue(row?.primary_color),
    secondaryColor: stringValue(row?.secondary_color),
  };
}

function hasStats(row: Record<string, unknown> | undefined): boolean {
  return Boolean(row) && ['games_played', 'goals', 'assists', 'points'].some((key) => row?.[key] !== null && row?.[key] !== undefined);
}

function compareStandings(left: TeamPageStanding, right: TeamPageStanding): number {
  const numeric = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;
  return (
    numeric(right.points) - numeric(left.points) ||
    numeric(right.wins) - numeric(left.wins) ||
    numeric(right.goalDifferential) - numeric(left.goalDifferential) ||
    numeric(right.goalsFor) - numeric(left.goalsFor) ||
    left.teamName.localeCompare(right.teamName) ||
    left.teamId.localeCompare(right.teamId)
  );
}

function recordLabel(standing: TeamPageStanding | null): string {
  if (!standing || standing.gamesPlayed == null || standing.gamesPlayed <= 0) return 'No games yet';
  return `${standing.wins ?? 0}-${standing.losses ?? 0}-${standing.ties ?? 0}`;
}

function shortRecord(standing: TeamPageStanding | undefined): string {
  if (!standing || standing.gamesPlayed == null || standing.gamesPlayed <= 0) return '—';
  return `${standing.wins ?? 0}-${standing.losses ?? 0}-${standing.ties ?? 0}`;
}

function resolvePhoto(row: Record<string, unknown> | undefined): string | null {
  return stringValue(row?.photo_url) ?? stringValue(row?.avatar_url);
}

function isGoalie(position: string | null, explicit: boolean): boolean {
  const value = position?.trim().toLowerCase() ?? '';
  return explicit || value === 'g' || value === 'goalie' || value === 'goaltender';
}

function buildStatsByPlayer(input: TeamPageSnapshotInput) {
  const candidates = new Map<string, Record<string, unknown>>();
  for (const row of input.seasonStats) {
    if (row.team_id !== input.teamId || row.season_id !== input.season.id || typeof row.player_id !== 'string') continue;
    const current = candidates.get(row.player_id);
    if (!current) {
      candidates.set(row.player_id, row);
      continue;
    }
    const score = (candidate: Record<string, unknown>) =>
      (numberValue(candidate.points) ?? -1) * 1_000_000 + (numberValue(candidate.games_played) ?? -1) * 1_000 + (numberValue(candidate.goals) ?? -1);
    if (score(row) > score(current)) candidates.set(row.player_id, row);
  }

  const rawByPlayer = new Map<string, { gameIds: Set<string>; goals: number; assists: number; penaltyMinutes: number | null }>();
  const seenStatKeys = new Set<string>();
  for (const row of input.playerStats) {
    if (row.team_id !== input.teamId || row.season_id !== input.season.id || typeof row.player_id !== 'string') continue;
    const key = `${row.player_id}:${stringValue(row.game_id) ?? stringValue(row.id) ?? JSON.stringify(row)}`;
    if (seenStatKeys.has(key)) continue;
    seenStatKeys.add(key);
    const entry = rawByPlayer.get(row.player_id) ?? { gameIds: new Set<string>(), goals: 0, assists: 0, penaltyMinutes: 0 };
    const gameId = stringValue(row.game_id);
    if (gameId) entry.gameIds.add(gameId);
    entry.goals += numberValue(row.goals) ?? 0;
    entry.assists += numberValue(row.assists) ?? 0;
    const pim = numberValue(row.penalty_minutes);
    entry.penaltyMinutes = entry.penaltyMinutes == null || pim == null ? null : entry.penaltyMinutes + pim;
    rawByPlayer.set(row.player_id, entry);
  }

  return { candidates, rawByPlayer };
}

function buildEstimatedAppearanceGameIds(input: TeamPageSnapshotInput): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (playerId: string, gameId: string) => {
    const ids = result.get(playerId) ?? new Set<string>();
    ids.add(gameId);
    result.set(playerId, ids);
  };
  const completedGames = input.games.filter((game) =>
    game.league_id === input.leagueId &&
    game.season_id === input.season.id &&
    game.status === 'completed' &&
    typeof game.id === 'string',
  );

  for (const roster of input.rosters) {
    if (roster.team_id !== input.teamId || roster.league_id !== input.leagueId || roster.season_id !== input.season.id || roster.status !== 'active' || typeof roster.player_id !== 'string') continue;
    const joinedAt = stringValue(roster.joined_at);
    const endDate = stringValue(roster.end_date);
    for (const game of completedGames) {
      const gameId = String(game.id);
      if (game.home_team_id !== input.teamId && game.away_team_id !== input.teamId) continue;
      const scheduledAt = stringValue(game.scheduled_at);
      if (joinedAt && scheduledAt && new Date(scheduledAt).getTime() < new Date(joinedAt).getTime()) continue;
      if (endDate && scheduledAt && new Date(scheduledAt).getTime() > new Date(endDate).getTime()) continue;
      add(roster.player_id, gameId);
    }
  }
  return result;
}

function buildGoalieStats(input: TeamPageSnapshotInput) {
  const byPlayer = new Map<string, { gameIds: Set<string>; goalsAgainst: number; explicitGaa: number | null }>();
  for (const row of input.goalieStats) {
    if (row.team_id !== input.teamId || row.season_id !== input.season.id || typeof row.player_id !== 'string') continue;
    const entry = byPlayer.get(row.player_id) ?? { gameIds: new Set<string>(), goalsAgainst: 0, explicitGaa: null };
    const gameId = stringValue(row.game_id);
    if (gameId) entry.gameIds.add(gameId);
    entry.goalsAgainst += numberValue(row.goals_against) ?? 0;
    const explicit = numberValue(row.goals_against_average);
    if (explicit != null) entry.explicitGaa = explicit;
    byPlayer.set(row.player_id, entry);
  }
  return byPlayer;
}

function buildFallbackGoalieStats(input: TeamPageSnapshotInput): Map<string, { gamesPlayed: number; goalsAgainst: number }> {
  const result = new Map<string, { gamesPlayed: number; goalsAgainst: number }>();
  if (input.goalieStats.some((row) => row.season_id === input.season.id)) return result;

  const goalieByTeam = new Map<string, string[]>();
  for (const row of input.leagueRosters ?? input.rosters) {
    if (row.league_id !== input.leagueId || row.season_id !== input.season.id || row.status !== 'active' || row.end_date !== null || typeof row.team_id !== 'string' || typeof row.player_id !== 'string') continue;
    if (!isGoalie(stringValue(row.position), booleanValue(row.is_goalie))) continue;
    goalieByTeam.set(row.team_id, [...(goalieByTeam.get(row.team_id) ?? []), row.player_id]);
  }
  const singleGoalieByTeam = new Map(
    Array.from(goalieByTeam.entries())
      .filter(([, playerIds]) => new Set(playerIds).size === 1)
      .map(([teamId, playerIds]) => [teamId, playerIds[0]]),
  );
  const add = (teamId: unknown, goalsAgainst: unknown) => {
    if (typeof teamId !== 'string') return;
    const playerId = singleGoalieByTeam.get(teamId);
    const ga = numberValue(goalsAgainst);
    if (!playerId || ga == null) return;
    const current = result.get(playerId) ?? { gamesPlayed: 0, goalsAgainst: 0 };
    current.gamesPlayed += 1;
    current.goalsAgainst += ga;
    result.set(playerId, current);
  };
  for (const game of input.games) {
    if (game.league_id !== input.leagueId || game.season_id !== input.season.id || game.status !== 'completed') continue;
    add(game.home_team_id, game.away_score);
    add(game.away_team_id, game.home_score);
  }
  return result;
}

function standingsFrom(input: TeamPageSnapshotInput): TeamPageStanding[] {
  const teamMap = new Map(input.teams.map((row) => [String(row.id), row]));
  return input.standings
    .filter((row) => row.season_id === input.season.id && teamMap.has(String(row.team_id)))
    .map((row) => {
      const team = teamMap.get(String(row.team_id));
      const gf = numberValue(row.goals_for);
      const ga = numberValue(row.goals_against);
      return {
        teamId: String(row.team_id),
        teamName: stringValue(team?.name) ?? stringValue(row.name) ?? 'Team',
        logoUrl: stringValue(team?.logo_url) ?? stringValue(row.logo_url),
        primaryColor: stringValue(team?.primary_color) ?? stringValue(row.primary_color),
        gamesPlayed: numberValue(row.games_played),
        wins: numberValue(row.wins),
        losses: numberValue(row.losses),
        ties: numberValue(row.ties),
        points: numberValue(row.points),
        goalsFor: gf,
        goalsAgainst: ga,
        goalDifferential: numberValue(row.goal_differential) ?? (gf != null && ga != null ? gf - ga : null),
      };
    })
    .sort(compareStandings);
}

function buildGames(input: TeamPageSnapshotInput): TeamPageGame[] {
  const teamMap = new Map(input.teams.map((row) => [String(row.id), row]));
  return input.games
    .filter((row) =>
      row.league_id === input.leagueId &&
      row.season_id === input.season.id &&
      (row.home_team_id === input.teamId || row.away_team_id === input.teamId),
    )
    .map((row) => ({
      id: String(row.id),
      scheduledAt: String(row.scheduled_at),
      status: stringValue(row.status),
      location: stringValue(row.location) ?? stringValue(row.venue),
      homeScore: numberValue(row.home_score),
      awayScore: numberValue(row.away_score),
      homeTeam: identity(teamMap.get(String(row.home_team_id)) ?? (row.home_team as Record<string, unknown> | undefined)),
      awayTeam: identity(teamMap.get(String(row.away_team_id)) ?? (row.away_team as Record<string, unknown> | undefined)),
    }))
    .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime());
}

export function toPodiumOrder(leaders: TeamPageLeader[]): TeamPageLeader[] {
  if (leaders.length <= 1) return [...leaders];
  if (leaders.length === 2) return [leaders[1], leaders[0]];
  return [leaders[1], leaders[0], leaders[2]];
}

function buildLeaders(roster: TeamPageRosterPlayer[], publicPlayers?: PublicSeasonPlayer[]): Record<TeamLeaderMetric, TeamPageLeader[]> {
  const metrics: TeamLeaderMetric[] = ['points', 'goals', 'assists', 'penaltyMinutes'];
  const candidates = publicPlayers
    ? publicPlayers.filter((player) => player.roles.includes('skater')).map((player) => {
      const current = roster.find((row) => row.playerId === player.playerId);
      return {
        playerId: player.playerId,
        name: player.playerName,
        photoUrl: player.avatarUrl ?? current?.photoUrl ?? null,
        jerseyNumber: current?.jerseyNumber ?? null,
        gamesPlayed: player.metrics.gamesPlayed.value,
        gamesPlayedProvenance: player.metrics.gamesPlayed.state === 'estimated' ? 'estimated' as const : player.metrics.gamesPlayed.value !== null ? 'authoritative' as const : null,
        gamesPlayedMetric: player.metrics.gamesPlayed,
        goals: player.metrics.goals.value,
        assists: player.metrics.assists.value,
        points: player.metrics.points.value,
        penaltyMinutes: player.metrics.penaltyMinutes.value,
      };
    })
    : roster.filter((player) => !player.isGoalie);
  return Object.fromEntries(metrics.map((metric) => [metric, candidates
    .filter((player) => player[metric] != null)
    .map((player) => ({
      playerId: player.playerId,
      name: player.name,
      photoUrl: player.photoUrl,
      jerseyNumber: player.jerseyNumber,
      gamesPlayed: player.gamesPlayed,
      gamesPlayedProvenance: player.gamesPlayedProvenance,
      gamesPlayedMetric: player.gamesPlayedMetric,
      value: player[metric] as number,
    }))
    .sort((left, right) => {
      const primary = right.value - left.value;
      if (primary !== 0) return primary;
      const leftPlayer = candidates.find((row) => row.playerId === left.playerId);
      const rightPlayer = candidates.find((row) => row.playerId === right.playerId);
      return (rightPlayer?.points ?? 0) - (leftPlayer?.points ?? 0) ||
        (rightPlayer?.goals ?? 0) - (leftPlayer?.goals ?? 0) ||
        left.name.localeCompare(right.name) || left.playerId.localeCompare(right.playerId);
    })
    .slice(0, 3)])) as Record<TeamLeaderMetric, TeamPageLeader[]>;
}

function rankValue(standings: TeamPageStanding[], teamId: string, key: 'goalsFor' | 'goalsAgainst', direction: 'asc' | 'desc'): number | null {
  const eligible = standings.filter((row) => row[key] != null).sort((left, right) => {
    const difference = (left[key] ?? 0) - (right[key] ?? 0);
    if (difference !== 0) return direction === 'asc' ? difference : -difference;
    return (right.points ?? 0) - (left.points ?? 0);
  });
  const index = eligible.findIndex((row) => row.teamId === teamId);
  return index < 0 ? null : index + 1;
}

function strengthWeakness(standings: TeamPageStanding[], teamId: string) {
  if (standings.length <= 1) return { strength: 'balanced' as const, weakness: 'balanced' as const };
  const offenseRank = rankValue(standings, teamId, 'goalsFor', 'desc');
  const defenseRank = rankValue(standings, teamId, 'goalsAgainst', 'asc');
  if (offenseRank == null || defenseRank == null) return { strength: 'balanced' as const, weakness: 'balanced' as const };
  const offPct = (offenseRank - 1) / (standings.length - 1);
  const defPct = (defenseRank - 1) / (standings.length - 1);
  if (Math.abs(offPct - defPct) <= 0.15) return { strength: 'balanced' as const, weakness: 'balanced' as const };
  const defensiveLabel = (pct: number) => pct <= 0.4 ? 'goaltending' as const : 'defence' as const;
  return offPct < defPct
    ? { strength: 'offense' as const, weakness: defensiveLabel(defPct) }
    : { strength: defensiveLabel(defPct), weakness: 'offense' as const };
}

function buildRivals(
  input: TeamPageSnapshotInput,
  games: TeamPageGame[],
  standings: TeamPageStanding[],
): TeamPageRival[] {
  const teamMap = new Map(input.teams.map((row) => [String(row.id), identity(row)]));
  const counts = new Map<string, { wins: number; losses: number; ties: number; latestMeeting: number }>();
  for (const game of games) {
    if (game.status !== 'completed' || game.homeScore == null || game.awayScore == null) continue;
    const isHome = game.homeTeam.id === input.teamId;
    const opponentId = isHome ? game.awayTeam.id : game.homeTeam.id;
    if (!opponentId) continue;
    const mine = isHome ? game.homeScore : game.awayScore;
    const theirs = isHome ? game.awayScore : game.homeScore;
    const entry = counts.get(opponentId) ?? { wins: 0, losses: 0, ties: 0, latestMeeting: Number.NEGATIVE_INFINITY };
    if (mine > theirs) entry.wins += 1;
    else if (mine < theirs) entry.losses += 1;
    else entry.ties += 1;
    entry.latestMeeting = Math.max(entry.latestMeeting, new Date(game.scheduledAt).getTime());
    counts.set(opponentId, entry);
  }

  const standingMap = new Map(standings.map((row) => [row.teamId, row]));
  const profileMap = new Map(input.profiles.map((row) => [String(row.id), row]));
  // Match the web unified producer: completed-season totals by player, attributed
  // to the team with most appearances. Stats-only players are not roster members.
  const completedIds = new Set(input.games.filter((game) => game.league_id === input.leagueId && game.season_id === input.season.id && game.status === 'completed').map((game) => String(game.id)));
  const memberships = (input.leagueRosters ?? input.rosters).filter((row) => row.league_id === input.leagueId && row.season_id === input.season.id && row.status === 'active' && row.end_date === null);
  type RivalTotals = { playerId: string; teamId: string; name: string; goals: number; assists: number; goalsAgainst: number; gameIds: Set<string>; teamGames: Map<string, Set<string>>; bestTeamGames: number; goalie: boolean; fallbackGames?: number };
  const create = (playerId: string, teamId: string): RivalTotals => {
    const membership = memberships.find((row) => row.player_id === playerId && row.team_id === teamId);
    return { playerId, teamId, name: stringValue(profileMap.get(playerId)?.full_name) ?? 'Unknown Player', goals: 0, assists: 0, goalsAgainst: 0, gameIds: new Set(), teamGames: new Map(), bestTeamGames: 0, goalie: isGoalie(stringValue(membership?.position), booleanValue(membership?.is_goalie)) };
  };
  const addAppearance = (entry: RivalTotals, teamId: string, gameId: string, updateRole: boolean) => {
    entry.gameIds.add(gameId);
    const ids = entry.teamGames.get(teamId) ?? new Set<string>();
    ids.add(gameId);
    entry.teamGames.set(teamId, ids);
    if (ids.size > entry.bestTeamGames) {
      entry.teamId = teamId;
      entry.bestTeamGames = ids.size;
      if (updateRole) {
        const membership = memberships.find((row) => row.player_id === entry.playerId && row.team_id === teamId);
        entry.goalie = isGoalie(stringValue(membership?.position), booleanValue(membership?.is_goalie));
      }
    }
  };
  const aggregate = (rows: Array<Record<string, unknown>>) => {
    const totals = new Map<string, RivalTotals>();
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.season_id !== input.season.id || !completedIds.has(String(row.game_id)) || !teamMap.has(String(row.team_id)) || typeof row.player_id !== 'string') continue;
      const key = `${row.player_id}:${row.team_id}:${row.game_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = totals.get(row.player_id) ?? create(row.player_id, String(row.team_id));
      entry.goals += numberValue(row.goals) ?? 0;
      entry.assists += numberValue(row.assists) ?? 0;
      entry.goalsAgainst += numberValue(row.goals_against) ?? 0;
      addAppearance(entry, String(row.team_id), String(row.game_id), true);
      totals.set(row.player_id, entry);
    }
    return totals;
  };
  const skaterTotals = aggregate(input.playerStats);
  for (const row of memberships) {
    if (typeof row.player_id !== 'string' || typeof row.team_id !== 'string' || isGoalie(stringValue(row.position), booleanValue(row.is_goalie)) || skaterTotals.has(row.player_id)) continue;
    skaterTotals.set(row.player_id, create(row.player_id, row.team_id));
  }
  for (const teamId of teamMap.keys()) {
    const appearances = buildEstimatedAppearanceGameIds({ ...input, teamId, rosters: memberships });
    for (const [playerId, gameIds] of appearances) {
      const entry = skaterTotals.get(playerId);
      if (entry) for (const gameId of gameIds) addAppearance(entry, teamId, gameId, false);
    }
  }
  const goalieTotals = aggregate(input.goalieStats);
  if (goalieTotals.size === 0) {
    const fallback = buildFallbackGoalieStats({ ...input, goalieStats: [] });
    for (const [playerId, row] of fallback) {
      const membership = memberships.find((candidate) => candidate.player_id === playerId && isGoalie(stringValue(candidate.position), booleanValue(candidate.is_goalie)));
      if (!membership) continue;
      const entry = create(playerId, String(membership.team_id));
      entry.goalsAgainst = row.goalsAgainst;
      entry.fallbackGames = row.gamesPlayed;
      goalieTotals.set(playerId, entry);
    }
  }
  const goalieGp = (entry: RivalTotals) => entry.fallbackGames ?? entry.gameIds.size;
  const gaa = (entry: RivalTotals) => goalieGp(entry) > 0 ? Math.round(entry.goalsAgainst / goalieGp(entry) * 100) / 100 : null;
  const compareSkaters = (metric: 'goals' | 'assists') => (a: RivalTotals, b: RivalTotals) => b[metric] - a[metric] || (b.goals + b.assists) - (a.goals + a.assists) || b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name);
  const side = (teamId: string): TeamPageRivalSide | null => {
    const standing = standingMap.get(teamId);
    const team = teamMap.get(teamId);
    if (!standing || !team) return null;
    const skaters = Array.from(skaterTotals.values()).filter((row) => row.teamId === teamId && !row.goalie);
    const sniper = [...skaters].sort(compareSkaters('goals'))[0];
    const playmaker = [...skaters].sort(compareSkaters('assists'))[0];
    const goalie = Array.from(goalieTotals.values()).filter((row) => row.teamId === teamId).sort((a, b) => goalieGp(b) - goalieGp(a) || (gaa(a) ?? Infinity) - (gaa(b) ?? Infinity) || a.name.localeCompare(b.name))[0];
    const sw = strengthWeakness(standings, teamId);
    return {
      ...team,
      overallRecord: shortRecord(standing),
      goalsFor: standing.goalsFor,
      goalsAgainst: standing.goalsAgainst,
      goalDifferential: standing.goalDifferential,
      strength: sw.strength,
      weakness: sw.weakness,
      sniper: { name: sniper?.name ?? 'No data', goals: sniper?.goals ?? 0 },
      playmaker: { name: playmaker?.name ?? 'No data', assists: playmaker?.assists ?? 0 },
      tendy: {
        name: goalie && goalieGp(goalie) > 0 ? goalie.name : 'No data',
        gamesPlayed: goalie ? goalieGp(goalie) : 0,
        gamesPlayedProvenance: goalie ? 'estimated' : null,
        goalsAgainstAverage: goalie ? gaa(goalie) : null,
        goalsAgainstAverageProvenance: goalie && gaa(goalie) != null ? 'estimated' : null,
      },
    };
  };

  return Array.from(counts.entries())
    .sort(([, left], [, right]) =>
      (right.wins + right.losses + right.ties) - (left.wins + left.losses + left.ties) ||
      right.latestMeeting - left.latestMeeting,
    )
    .slice(0, 4)
    .flatMap(([opponentId, record]) => {
      const viewed = side(input.teamId);
      const rival = side(opponentId);
      if (!viewed || !rival) return [];
      const suffix = record.ties > 0 ? `-${record.ties}` : '';
      return [{
        team: viewed,
        rival,
        h2hRecord: `${record.wins}-${record.losses}${suffix}`,
        h2hRecordRival: `${record.losses}-${record.wins}${suffix}`,
        gamesPlayed: record.wins + record.losses + record.ties,
      }];
    });
}

function championshipSummary(input: TeamPageSnapshotInput, now: Date) {
  const teamIds = new Set(input.teams.map((row) => String(row.id)));
  const historyBySeason = new Map<string, TeamPageStanding[]>();
  for (const row of input.historicalStandings) {
    if (!teamIds.has(String(row.team_id)) || typeof row.season_id !== 'string') continue;
    const team = input.teams.find((candidate) => candidate.id === row.team_id);
    const gf = numberValue(row.goals_for);
    const ga = numberValue(row.goals_against);
    const mapped: TeamPageStanding = {
      teamId: String(row.team_id), teamName: stringValue(team?.name) ?? 'Team', logoUrl: stringValue(team?.logo_url), primaryColor: stringValue(team?.primary_color),
      gamesPlayed: numberValue(row.games_played), wins: numberValue(row.wins), losses: numberValue(row.losses), ties: numberValue(row.ties), points: numberValue(row.points), goalsFor: gf, goalsAgainst: ga,
      goalDifferential: numberValue(row.goal_differential) ?? (gf != null && ga != null ? gf - ga : null),
    };
    historyBySeason.set(row.season_id, [...(historyBySeason.get(row.season_id) ?? []), mapped]);
  }

  const titles = input.seasons
    .filter((season) => season.league_id === input.leagueId && stringValue(season.end_date) != null && new Date(String(season.end_date)).getTime() < now.getTime() && season.status !== 'active')
    .filter((season) => {
      const explicit = stringValue(season.champion_team_id);
      if (explicit) return explicit === input.teamId;
      const leader = [...(historyBySeason.get(String(season.id)) ?? [])].sort(compareStandings)[0];
      return leader?.teamId === input.teamId;
    })
    .sort((left, right) => new Date(String(right.end_date)).getTime() - new Date(String(left.end_date)).getTime());
  const latest = titles[0];
  const label = latest ? formatSeasonSpan(stringValue(latest.start_date), stringValue(latest.end_date)) : null;
  return {
    count: titles.length,
    latestTitleSeasonName: latest ? stringValue(latest.name) : null,
    latestTitleLabel: label,
    titleSeasonIds: titles.map((season) => String(season.id)),
  };
}

function formatSeasonSpan(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const startYear = new Date(start).getFullYear();
  const endYear = new Date(end).getFullYear();
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return startYear === endYear ? String(startYear) : `${startYear}-${String(endYear).slice(-2)}`;
}

function computeStreak(games: TeamPageGame[], teamId: string): string | null {
  const completed = games.filter((game) => game.status === 'completed' && game.homeScore != null && game.awayScore != null).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  let kind: 'W' | 'L' | 'T' | null = null;
  let count = 0;
  for (const game of completed) {
    const isHome = game.homeTeam.id === teamId;
    const mine = isHome ? game.homeScore! : game.awayScore!;
    const theirs = isHome ? game.awayScore! : game.homeScore!;
    const result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
    if (kind == null) { kind = result; count = 1; }
    else if (kind === result) count += 1;
    else break;
  }
  return kind ? `${kind}${count}` : null;
}

export function buildTeamPageSnapshot(input: TeamPageSnapshotInput, now = new Date()): TeamPageSnapshot {
  const profileMap = new Map(input.profiles.map((row) => [String(row.id), row]));
  const { candidates, rawByPlayer } = buildStatsByPlayer(input);
  const goalieByPlayer = buildGoalieStats(input);
  const appearancesByPlayer = buildEstimatedAppearanceGameIds(input);
  const publicByPlayer = new Map((input.publicSeasonStats?.players ?? []).map((player) => [player.playerId, player]));
  const rosterRows = input.rosters
    .filter((row) => row.team_id === input.teamId && row.league_id === input.leagueId && row.season_id === input.season.id && row.status === 'active' && row.end_date === null)
    .sort((left, right) => (numberValue(left.jersey_number) ?? Number.MAX_SAFE_INTEGER) - (numberValue(right.jersey_number) ?? Number.MAX_SAFE_INTEGER) || String(left.id).localeCompare(String(right.id)));
  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of rosterRows) if (!deduped.has(String(row.player_id))) deduped.set(String(row.player_id), row);
  const roster = Array.from(deduped.values()).map((row): TeamPageRosterPlayer => {
    const playerId = String(row.player_id);
    const profile = profileMap.get(playerId);
    const stat = candidates.get(playerId);
    const statsAvailable = hasStats(stat);
    const raw = rawByPlayer.get(playerId);
    const goals = raw ? raw.goals : statsAvailable ? numberValue(stat?.goals) : null;
    const assists = raw ? raw.assists : statsAvailable ? numberValue(stat?.assists) : null;
    const goalieTotals = goalieByPlayer.get(playerId);
    const goalieGames = goalieTotals?.gameIds.size ?? null;
    const overrideGamesPlayed = numberValue(row.games_played_override);
    const estimatedGamesPlayed = appearancesByPlayer.get(playerId)?.size;
    const canonical = publicByPlayer.get(playerId);
    const canonicalMetrics = canonical?.metrics ?? (input.publicSeasonStats ? {
      gamesPlayed: { value: null, state: 'unknown' as const, sources: [] }, goals: { value: null, state: 'unknown' as const, sources: [] },
      assists: { value: null, state: 'unknown' as const, sources: [] }, points: { value: null, state: 'unknown' as const, sources: [] },
      penaltyMinutes: { value: null, state: 'unknown' as const, sources: [] },
    } : undefined);
    const canonicalGoalie = canonical?.goalie ?? null;
    const useCanonicalGoalie = Boolean(input.publicSeasonStats);
    return {
      rosterId: String(row.id), playerId,
      name: stringValue(profile?.full_name) ?? 'Unknown Player', photoUrl: resolvePhoto(profile),
      jerseyNumber: numberValue(row.jersey_number), position: stringValue(row.position),
      isGoalie: isGoalie(stringValue(row.position), booleanValue(row.is_goalie)),
      leadershipRole: stringValue(row.leadership_role), playerType: stringValue(row.player_type),
      gamesPlayed: canonicalMetrics ? canonicalMetrics.gamesPlayed.value : overrideGamesPlayed ?? estimatedGamesPlayed ?? null,
      gamesPlayedProvenance: canonicalMetrics ? (canonicalMetrics.gamesPlayed.state === 'estimated' ? 'estimated' : canonicalMetrics.gamesPlayed.value !== null ? 'authoritative' : null) : overrideGamesPlayed != null ? 'authoritative' : estimatedGamesPlayed != null ? 'estimated' : null,
      goals: canonicalMetrics ? canonicalMetrics.goals.value : goals,
      assists: canonicalMetrics ? canonicalMetrics.assists.value : assists,
      points: canonicalMetrics ? canonicalMetrics.points.value : raw ? raw.goals + raw.assists : statsAvailable ? numberValue(stat?.points) ?? (goals != null && assists != null ? goals + assists : null) : null,
      penaltyMinutes: canonicalMetrics ? canonicalMetrics.penaltyMinutes.value : raw ? raw.penaltyMinutes : null,
      goalieGamesPlayed: useCanonicalGoalie ? canonicalGoalie?.gamesPlayed.value ?? null : goalieGames,
      goalieGamesPlayedProvenance: useCanonicalGoalie ? (canonicalGoalie?.gamesPlayed.state === 'estimated' ? 'estimated' : canonicalGoalie?.gamesPlayed.value != null ? 'authoritative' : null) : goalieGames != null ? 'estimated' : null,
      goalsAgainstAverage: useCanonicalGoalie ? canonicalGoalie?.goalsAgainstAverage.value ?? null : goalieTotals?.explicitGaa ?? (goalieTotals && goalieGames && goalieGames > 0 ? goalieTotals.goalsAgainst / goalieGames : null),
      goalsAgainstAverageProvenance: useCanonicalGoalie ? (canonicalGoalie?.goalsAgainstAverage.state === 'estimated' ? 'estimated' : canonicalGoalie?.goalsAgainstAverage.value != null ? 'authoritative' : null) : goalieTotals && (goalieTotals.explicitGaa != null || (goalieGames != null && goalieGames > 0)) ? 'estimated' : null,
      publicMetrics: canonicalMetrics,
      publicGoalieMetrics: canonicalGoalie,
    };
  });

  const standings = standingsFrom(input);
  const standing = standings.find((row) => row.teamId === input.teamId) ?? null;
  const games = buildGames(input);
  const past = games.filter((game) => game.status === 'completed' || game.status === 'pending_verification').sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  const upcoming = games.filter((game) => game.status === 'in_progress' || game.status === 'scheduled');
  const nextGame = [...upcoming].sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.id.localeCompare(b.id))[0] ?? null;
  const rank = standings.findIndex((row) => row.teamId === input.teamId);
  const winPercentage = standing?.gamesPlayed && standing.gamesPlayed > 0 && standing.wins != null ? standing.wins / standing.gamesPlayed : null;
  const championships = championshipSummary(input, now);
  return {
    season: { id: String(input.season.id), name: stringValue(input.season.name) ?? 'Current Season', status: stringValue(input.season.status) ?? 'active', startDate: stringValue(input.season.start_date), endDate: stringValue(input.season.end_date) },
    team: identity(input.team),
    league: { id: String(input.league.id), name: stringValue(input.league.name) ?? 'League', slug: stringValue(input.league.slug), primaryColor: stringValue(input.league.primary_color), timezone: stringValue(input.league.timezone) ?? 'America/Toronto' },
    standing, standings, rank: rank < 0 ? null : rank + 1, record: recordLabel(standing), streak: computeStreak(games, input.teamId), hero: { winPercentage },
    roster, leaders: buildLeaders(roster, input.publicSeasonStats?.players), games,
    collapsedSchedule: [...past.slice(0, 2).reverse(), ...upcoming.slice(0, 2)],
    nextGame,
    rivals: buildRivals(input, games, standings),
    championships,
    captain: roster.find((player) => player.leadershipRole === 'captain') ?? null,
    publishedLineup: input.publishedLineup,
    acceptedSubstitutions: (input.acceptedSubstitutions ?? []).flatMap((row) => {
      const id = stringValue(row.id);
      const subPlayerId = stringValue(row.invited_player_id) ?? stringValue(row.subPlayerId);
      if (!id || !subPlayerId) return [];
      return [{
        id,
        subPlayerId,
        subPlayerName: stringValue(row.sub_player_name) ?? stringValue(row.subPlayerName) ?? 'Sub',
        replacedPlayerId: stringValue(row.replaced_player_id) ?? stringValue(row.replacedPlayerId),
        replacedPlayerName: stringValue(row.replaced_player_name) ?? stringValue(row.replacedPlayerName),
      }];
    }),
    sponsors: input.sponsors.map((row) => ({ id: String(row.id), name: stringValue(row.name) ?? 'Partner', logoUrl: stringValue(row.logo_url), websiteUrl: stringValue(row.website_url), tier: stringValue(row.tier) })),
  };
}

async function queryRows(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>, label: string): Promise<Array<Record<string, unknown>>> {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message ?? 'query failed'}`);
  return Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
}

type RowsResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;

async function queryAllRows(build: () => { range(from: number, to: number): RowsResult }, label: string) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await queryRows(build().range(offset, offset + pageSize - 1), label);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// Bound IN lists as well as result pages: a full season can exceed URL/header limits.
async function queryIdBatches(ids: string[], load: (batch: string[]) => Promise<Array<Record<string, unknown>>>) {
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < ids.length; offset += 100) rows.push(...await load(ids.slice(offset, offset + 100)));
  return rows;
}

function joinedProfileName(value: unknown): string | null {
  const profile = Array.isArray(value) ? value[0] : value;
  return profile && typeof profile === 'object' ? stringValue((profile as Record<string, unknown>).full_name) : null;
}

/**
 * Public Team-page read boundary. It performs read-only, active-season-scoped queries and
 * returns an honest empty/error result instead of falling back to a historical season.
 */
export async function loadTeamPageSnapshot(
  teamId: string,
  leagueId: string,
  now: Date = new Date(),
  expectedSeasonId?: string,
): Promise<{ data: TeamPageSnapshot | null; error: string | null }> {
  try {
    const active = await getMetricsOperationalSeason(leagueId);
    if (active.error) return { data: null, error: active.error };
    if (!active.season) return { data: null, error: null };
    const season = active.season as unknown as Record<string, unknown>;
    const seasonId = String(season.id);
    if (expectedSeasonId && seasonId !== expectedSeasonId) {
      return { data: null, error: 'The active season changed while loading. Retry the Team page.' };
    }

    const rosterColumns = 'id,player_id,team_id,league_id,season_id,status,end_date,joined_at,jersey_number,position,is_goalie,leadership_role,player_type,games_played_override';
    const [teamResult, leagueResult, teams, rosters, standings, games, seasons, sponsors, playerStats, goalieStats] = await Promise.all([
      supabase.from('teams').select('id,league_id,name,slug,logo_url,primary_color,secondary_color').eq('id', teamId).eq('league_id', leagueId).maybeSingle(),
      supabase.from('leagues').select('id,name,slug,primary_color,timezone').eq('id', leagueId).maybeSingle(),
      queryAllRows(() => supabase.from('teams').select('id,league_id,name,slug,logo_url,primary_color,secondary_color,team_type').eq('league_id', leagueId).order('id'), 'teams'),
      queryAllRows(() => supabase.from('team_rosters').select(rosterColumns).eq('team_id', teamId).eq('league_id', leagueId).eq('season_id', seasonId).eq('status', 'active').is('end_date', null).order('id'), 'roster'),
      queryAllRows(() => supabase.from('team_standings').select('team_id,season_id,games_played,wins,losses,ties,points,goals_for,goals_against').eq('season_id', seasonId).order('team_id'), 'standings'),
      queryAllRows(() => supabase.from('games').select('id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status,location,home_score,away_score,game_type').eq('league_id', leagueId).eq('season_id', seasonId).order('scheduled_at').order('id'), 'games'),
      queryAllRows(() => supabase.from('seasons').select('id,league_id,name,status,start_date,end_date,champion_team_id').eq('league_id', leagueId).order('end_date', { ascending: false }).order('id'), 'seasons'),
      queryAllRows(() => supabase.from('league_sponsors').select('id,league_id,name,logo_url,website_url,tier,display_order,is_active').eq('league_id', leagueId).eq('is_active', true).order('display_order').order('id'), 'sponsors'),
      queryAllRows(() => supabase.from('player_stats').select('id,league_id,player_id,game_id,team_id,season_id,goals,assists,penalty_minutes').eq('league_id', leagueId).eq('season_id', seasonId).order('id'), 'player stats'),
      queryAllRows(() => supabase.from('goalie_stats').select('id,league_id,player_id,game_id,team_id,season_id,goals_against,saves,shots_against,game_result,shutout').eq('league_id', leagueId).eq('season_id', seasonId).order('id'), 'goalie stats'),
    ]);
    if (teamResult.error) throw new Error(`team: ${teamResult.error.message}`);
    if (!teamResult.data) return { data: null, error: 'Team is not part of the selected league.' };
    if (leagueResult.error) throw new Error(`league: ${leagueResult.error.message}`);
    if (!leagueResult.data) return { data: null, error: 'League could not be loaded.' };

    const leagueSlug = stringValue((leagueResult.data as Record<string, unknown>).slug);
    if (!leagueSlug) return { data: null, error: 'League public stats slug is unavailable.' };
    const publicSeasonStats = await getPublicSeasonStats(leagueSlug, leagueId, seasonId, null, teamId);

    const teamIds = teams.map((row) => String(row.id));
    const completedSeasonIds = seasons.filter((row) => row.status !== 'active' && stringValue(row.end_date) != null && new Date(String(row.end_date)).getTime() < now.getTime()).map((row) => String(row.id));
    const [leagueRosters, historicalStandings] = await Promise.all([
      queryIdBatches(teamIds, (ids) => queryAllRows(() => supabase.from('team_rosters').select(rosterColumns).eq('league_id', leagueId).eq('season_id', seasonId).in('team_id', ids).eq('status', 'active').is('end_date', null).order('id'), 'league roster')),
      queryIdBatches(completedSeasonIds, (ids) => queryAllRows(() => supabase.from('team_standings').select('team_id,season_id,games_played,wins,losses,ties,points,goals_for,goals_against').in('season_id', ids).order('season_id').order('team_id'), 'historical standings')),
    ]);
    const playerIds = Array.from(new Set([...leagueRosters, ...rosters, ...playerStats, ...goalieStats].map((row) => stringValue(row.player_id)).filter((id): id is string => id !== null)));
    const profiles = await queryIdBatches(playerIds, (ids) => queryAllRows(() => supabase.from('profiles').select('id,full_name,photo_url,avatar_url,position').in('id', ids).order('id'), 'profiles'));

    const nextGameRow = games.filter((row) => (row.home_team_id === teamId || row.away_team_id === teamId) && (row.status === 'scheduled' || row.status === 'in_progress')).sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || new Date(String(a.scheduled_at)).getTime() - new Date(String(b.scheduled_at)).getTime() || String(a.id).localeCompare(String(b.id)))[0];
    let publishedLineup: unknown | null = null;
    let acceptedSubstitutions: Array<Record<string, unknown>> = [];
    if (nextGameRow) {
      const [result, substitutions] = await Promise.all([
        supabase.from('game_team_lineups').select('id,game_id,team_id,status,formation,layout_json,published_at,updated_at').eq('game_id', nextGameRow.id).eq('team_id', teamId).eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false }).order('id').limit(1).maybeSingle(),
        queryAllRows(() => supabase.from('sub_invitations').select('id,invited_player_id,replaced_player_id,invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(full_name),replaced_player_profile:profiles!sub_invitations_replaced_player_id_fkey(full_name)').eq('game_id', nextGameRow.id).eq('team_id', teamId).eq('status', 'accepted').order('responded_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).order('id'), 'accepted substitutions; retry Team page'),
      ]);
      if (result.error) throw new Error(`published lineup; retry Team page: ${result.error.message}`);
      publishedLineup = result.data ?? null;
      acceptedSubstitutions = substitutions.map((row) => ({
        ...row,
        sub_player_name: joinedProfileName(row.invited_player_profile) ?? 'Sub',
        replaced_player_name: joinedProfileName(row.replaced_player_profile),
      }));
    }

    return {
      data: buildTeamPageSnapshot({
        teamId, leagueId, season,
        team: teamResult.data as Record<string, unknown>, league: leagueResult.data as Record<string, unknown>,
        teams, standings, rosters, leagueRosters, profiles, seasonStats: [], playerStats, goalieStats, games, seasons, historicalStandings, publishedLineup, acceptedSubstitutions, sponsors, publicSeasonStats,
      }, now),
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Team page data could not be loaded.' };
  }
}
