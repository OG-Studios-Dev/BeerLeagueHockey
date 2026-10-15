import type {
  LeaguePageKind,
  PageDivision,
  PagePlayer,
  PageSeason,
  PageSeries,
  PageStanding,
  PageTeam,
  PositioningData,
} from './public-league-pages-contract';
import { resolvePlayerPhotoUrl } from './player-photo';
import { filterPublicStandings, filterPublicTeams } from './publicSiteVisibility';
import {
  buildTeamsDirectoryBumpChartData,
  type TeamCommitmentSnapshot,
  type TeamScoringDepthSnapshot,
} from './teams-directory-bump-chart';
import type { Team, TeamStanding } from './types';
import { resolveSeasonParticipationTeamIds } from './season-team-participation';
import { createServiceRoleClient } from './supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PublicLeaguePageDataError extends Error {}
export class PublicLeaguePageLimitError extends Error {}

export interface PublicRosterSourceRow {
  id: string;
  league_id: string;
  season_id: string;
  team_id: string;
  player_id: string;
  jersey_number: number | null;
  position: string | null;
  leadership_role: string | null;
  status: string;
  joined_at: string | null;
  end_date: string | null;
  player_type?: string | null;
}

export interface PublicProfileSourceRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  photo_url: string | null;
}

export interface PublicTeamSourceRow {
  id: string;
  league_id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  division_id: string | null;
  primary_color: string | null;
  team_type: Team['team_type'];
}

export interface PublicPositioningGameRow {
  id: string;
  league_id: string;
  season_id: string;
  scheduled_at: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
}

export interface PublicAppearanceSignalRow {
  id: string;
  game_id: string;
  team_id: string;
  player_id: string;
  status?: string;
  goals?: number | null;
}

export interface PublicPlayoffSeriesSourceRow {
  id: string;
  league_id: string;
  season_id: string;
  division_id: string | null;
  round_number: number;
  series_number: number;
  high_seed_id: string | null;
  low_seed_id: string | null;
  high_seed_wins: number;
  low_seed_wins: number;
  winner_id: string | null;
  status: string;
}

export interface PublicPlayoffGameSourceRow {
  id: string;
  league_id: string;
  season_id: string;
  playoff_series_id: string | null;
  scheduled_at: string;
  location: string | null;
  status: string;
  game_type: string | null;
  home_team_id: string;
  away_team_id: string;
}

export interface PublicPlayoffConfigSourceRow {
  playoff_teams_total: number | null;
  playoff_teams_per_division: number | null;
  use_division_playoffs: boolean | null;
}

export interface PublicLeaguePageCatalog {
  seasons: Array<PageSeason & { leagueId: string; startDate: string | null; endDate: string | null; createdAt: string | null }>;
  divisions: Array<PageDivision & { leagueId: string }>;
}

export interface PublicLeaguePageSeasonData {
  teams: PageTeam[];
  players: PagePlayer[];
  positioning: PositioningData | null;
  series: PageSeries[];
  standings: PageStanding[];
  previewConfig: {
    playoffTeamsTotal: number | null;
    playoffTeamsPerDivision: number | null;
    useDivisionPlayoffs: boolean | null;
  };
}

type QueryResult = { data: unknown[] | null; count: number | null; error: unknown };
type QueryLike = { range(from: number, to: number): Promise<QueryResult> };

export async function readCompletePages<T>(
  build: () => QueryLike,
  label: string,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new PublicLeaguePageDataError('invalid source page size');
  }
  const first = await build().range(0, pageSize - 1);
  if (first.error) throw new PublicLeaguePageDataError(`${label} source read failed`);
  if (!Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) {
    throw new PublicLeaguePageDataError(`${label} source count missing`);
  }
  const count = first.count as number;
  if (count > maxRows) throw new PublicLeaguePageLimitError(`${label} source row limit exceeded`);
  const rows = [...(first.data ?? [])];
  for (let offset = pageSize; offset < count; offset += pageSize) {
    const page = await build().range(offset, Math.min(offset + pageSize - 1, count - 1));
    if (page.error) throw new PublicLeaguePageDataError(`${label} source page failed`);
    if (page.count !== count) throw new PublicLeaguePageDataError(`${label} source count changed`);
    rows.push(...(page.data ?? []));
  }
  if (rows.length !== count) throw new PublicLeaguePageDataError(`${label} source read incomplete`);
  return rows as T[];
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new PublicLeaguePageDataError(`invalid ${label}`);
}

function assertNonnegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new PublicLeaguePageDataError(`invalid ${label}`);
}

function assertNonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new PublicLeaguePageDataError(`invalid ${label}`);
}

export function buildPublicTeams(input: {
  leagueId: string;
  participantTeamIds: string[];
  divisions: PublicLeaguePageCatalog['divisions'];
  teamRows: PublicTeamSourceRow[];
}): PageTeam[] {
  assertUuid(input.leagueId, 'league ID');
  const participantIds = new Set(input.participantTeamIds);
  for (const id of participantIds) assertUuid(id, 'participant team ID');
  const divisionById = new Map(input.divisions.map((division) => {
    assertUuid(division.id, 'division ID');
    if (division.leagueId !== input.leagueId) throw new PublicLeaguePageDataError('cross-league division');
    return [division.id, division];
  }));

  return filterPublicTeams(input.teamRows)
    .filter((team) => {
      assertUuid(team.id, 'team ID');
      if (team.league_id !== input.leagueId) throw new PublicLeaguePageDataError('cross-league team');
      return participantIds.has(team.id);
    })
    .map((team): PageTeam => {
      const name = team.name.trim();
      const slug = team.slug;
      if (!name) throw new PublicLeaguePageDataError('team name missing');
      if (!slug || slug.length > 100 || !SLUG_PATTERN.test(slug)) {
        throw new PublicLeaguePageDataError('invalid team slug');
      }
      if (team.division_id) assertUuid(team.division_id, 'team division ID');
      const division = team.division_id ? divisionById.get(team.division_id) : null;
      if (team.division_id && !division) throw new PublicLeaguePageDataError('team division missing');
      return {
        id: team.id,
        name,
        slug,
        logoUrl: team.logo_url,
        divisionId: team.division_id,
        divisionName: division?.name ?? null,
        primaryColor: team.primary_color,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'));
}

function rosterEligibleForGame(row: PublicRosterSourceRow, game: PublicPositioningGameRow) {
  if (row.team_id !== game.home_team_id && row.team_id !== game.away_team_id) return false;
  const gameTime = new Date(game.scheduled_at).getTime();
  if (Number.isNaN(gameTime)) throw new PublicLeaguePageDataError('invalid game date');
  if (row.joined_at) {
    const joined = new Date(row.joined_at).getTime();
    if (Number.isNaN(joined)) throw new PublicLeaguePageDataError('invalid roster joined date');
    if (gameTime < joined) return false;
  }
  if (row.end_date) {
    const ended = new Date(row.end_date).getTime();
    if (Number.isNaN(ended)) throw new PublicLeaguePageDataError('invalid roster end date');
    if (gameTime > ended) return false;
  }
  return true;
}

export function buildPublicPositioning(input: {
  leagueId: string;
  seasonId: string;
  teams: PageTeam[];
  standings: TeamStanding[];
  games: PublicPositioningGameRow[];
  rosterRows: PublicRosterSourceRow[];
  checkins: PublicAppearanceSignalRow[];
  availability: PublicAppearanceSignalRow[];
  playerStats: PublicAppearanceSignalRow[];
  goalieStats: PublicAppearanceSignalRow[];
}): PositioningData | null {
  if (input.teams.length === 0) return null;
  const teamIds = new Set(input.teams.map((team) => team.id));
  const games = input.games.filter((game) => {
    assertUuid(game.id, 'game ID');
    if (game.league_id !== input.leagueId || game.season_id !== input.seasonId) {
      throw new PublicLeaguePageDataError('cross-scope positioning game');
    }
    if (!['in_progress', 'pending_verification', 'completed'].includes(game.status)) {
      throw new PublicLeaguePageDataError('invalid positioning game status');
    }
    return teamIds.has(game.home_team_id) || teamIds.has(game.away_team_id);
  });
  const gameById = new Map(games.map((game) => [game.id, game]));
  const regularRosters = input.rosterRows.filter((row) =>
    row.status === 'active' && row.player_type === 'regular' && teamIds.has(row.team_id));
  const rostersByTeam = new Map<string, PublicRosterSourceRow[]>();
  for (const row of regularRosters) {
    const current = rostersByTeam.get(row.team_id) ?? [];
    current.push(row);
    rostersByTeam.set(row.team_id, current);
  }

  const gamesByTeam = new Map<string, PublicPositioningGameRow[]>();
  for (const game of games) {
    for (const teamId of [game.home_team_id, game.away_team_id]) {
      if (!teamIds.has(teamId)) continue;
      gamesByTeam.set(teamId, [...(gamesByTeam.get(teamId) ?? []), game]);
    }
  }

  const possibleByTeam = new Map<string, number>();
  for (const teamId of teamIds) {
    let possible = 0;
    for (const roster of rostersByTeam.get(teamId) ?? []) {
      for (const game of gamesByTeam.get(teamId) ?? []) {
        if (rosterEligibleForGame(roster, game)) possible += 1;
      }
    }
    possibleByTeam.set(teamId, possible);
  }

  const rosterFor = (teamId: string, playerId: string) =>
    (rostersByTeam.get(teamId) ?? []).find((row) => row.player_id === playerId);
  const appearanceKey = (playerId: string, teamId: string, gameId: string) =>
    `${playerId}:${teamId}:${gameId}`;
  const confirmedByTeam = new Map<string, Set<string>>();
  for (const checkin of input.checkins) {
    if (checkin.status !== 'confirmed' || !teamIds.has(checkin.team_id)) continue;
    const game = gameById.get(checkin.game_id);
    const roster = rosterFor(checkin.team_id, checkin.player_id);
    if (!game || !roster || !rosterEligibleForGame(roster, game)) continue;
    const values = confirmedByTeam.get(checkin.team_id) ?? new Set<string>();
    values.add(appearanceKey(checkin.player_id, checkin.team_id, checkin.game_id));
    confirmedByTeam.set(checkin.team_id, values);
  }

  const out = new Set([...input.checkins, ...input.availability]
    .filter((row) => row.status === 'out')
    .map((row) => `${row.player_id}:${row.team_id}:${row.game_id}`));
  const statSignals = new Set([...input.playerStats, ...input.goalieStats]
    .map((row) => `${row.game_id}:${row.team_id}`));
  const fallbackByTeam = new Map<string, Set<string>>();
  for (const roster of regularRosters) {
    for (const game of gamesByTeam.get(roster.team_id) ?? []) {
      if (!rosterEligibleForGame(roster, game)) continue;
      const key = appearanceKey(roster.player_id, roster.team_id, game.id);
      if (out.has(key)) continue;
      const hasScore = game.home_score !== null || game.away_score !== null;
      if (!hasScore && !statSignals.has(`${game.id}:${roster.team_id}`)) continue;
      const values = fallbackByTeam.get(roster.team_id) ?? new Set<string>();
      if (confirmedByTeam.get(roster.team_id)?.has(key)) continue;
      values.add(key);
      fallbackByTeam.set(roster.team_id, values);
    }
  }

  const commitment: TeamCommitmentSnapshot[] = input.teams.map((team) => {
    const confirmed = confirmedByTeam.get(team.id)?.size ?? 0;
    const fallback = fallbackByTeam.get(team.id)?.size ?? 0;
    const possibleAppearances = possibleByTeam.get(team.id) ?? 0;
    const appearances = confirmed + fallback;
    return {
      teamId: team.id,
      attendancePct: possibleAppearances > 0 ? Number(((appearances / possibleAppearances) * 100).toFixed(1)) : 0,
      appearances,
      possibleAppearances,
      confirmedAppearances: confirmed,
      fallbackAppearances: fallback,
      gamesPlayed: gamesByTeam.get(team.id)?.length ?? 0,
    };
  });

  const goalsByTeamPlayer = new Map<string, number>();
  for (const row of input.playerStats) {
    if (!teamIds.has(row.team_id)) continue;
    const goals = row.goals ?? 0;
    assertNonnegativeNumber(goals, 'player goals');
    const key = `${row.team_id}:${row.player_id}`;
    goalsByTeamPlayer.set(key, (goalsByTeamPlayer.get(key) ?? 0) + goals);
  }
  for (const standing of input.standings) {
    for (const [label, value] of [
      ['standing games played', standing.games_played],
      ['standing wins', standing.wins],
      ['standing points', standing.points],
      ['standing goals for', standing.goals_for],
      ['standing goals against', standing.goals_against],
    ] as Array<[string, number]>) assertNonnegativeNumber(value, label);
  }
  const standingsByTeam = new Map(input.standings.map((standing) => [standing.team_id, standing]));
  const scoringDepth: TeamScoringDepthSnapshot[] = input.teams.map((team) => {
    const totalGoals = standingsByTeam.get(team.id)?.goals_for ?? 0;
    const values = [...goalsByTeamPlayer.entries()]
      .filter(([key]) => key.startsWith(`${team.id}:`))
      .map(([, goals]) => goals)
      .sort((left, right) => right - left);
    const topThreeGoals = values.slice(0, 3).reduce((sum, goals) => sum + goals, 0);
    return { teamId: team.id, totalGoals, topThreeGoals, remainingGoals: Math.max(0, totalGoals - topThreeGoals) };
  });

  const chartTeams: Team[] = input.teams.map((team) => ({
    id: team.id,
    name: team.name,
    slug: team.slug,
    logo: team.logoUrl,
    logo_url: team.logoUrl,
    colors: null,
    primary_color: team.primaryColor,
    secondary_color: null,
    league_id: input.leagueId,
    division_id: team.divisionId,
    created_at: '',
  }));
  return buildTeamsDirectoryBumpChartData({
    seasonId: input.seasonId,
    teams: chartTeams,
    standings: input.standings.filter((standing) => teamIds.has(standing.team_id)),
    commitment,
    scoringDepth,
  });
}

export function buildPublicPlayoffs(input: {
  leagueId: string;
  seasonId: string;
  now: Date;
  divisions: PublicLeaguePageCatalog['divisions'];
  teams: PageTeam[];
  seriesRows: PublicPlayoffSeriesSourceRow[];
  gameRows: PublicPlayoffGameSourceRow[];
  standings: TeamStanding[];
  config: PublicPlayoffConfigSourceRow | null;
}): Pick<PublicLeaguePageSeasonData, 'series' | 'standings' | 'previewConfig'> {
  const divisionById = new Map(input.divisions.map((division) => [division.id, division]));
  const teamById = new Map(input.teams.map((team) => {
    assertUuid(team.id, 'playoff team ID');
    const name = team.name.trim();
    if (!name) throw new PublicLeaguePageDataError('playoff team name missing');
    return [team.id, { id: team.id, name, logoUrl: team.logoUrl }];
  }));
  const seriesById = new Map<string, PublicPlayoffSeriesSourceRow>();
  for (const row of input.seriesRows) {
    assertUuid(row.id, 'playoff series ID');
    if (seriesById.has(row.id)) throw new PublicLeaguePageDataError('duplicate playoff series ID');
    seriesById.set(row.id, row);
  }

  const futureGamesBySeries = new Map<string, PublicPlayoffGameSourceRow[]>();
  for (const game of input.gameRows) {
    assertUuid(game.id, 'playoff game ID');
    if (game.league_id !== input.leagueId || game.season_id !== input.seasonId) {
      throw new PublicLeaguePageDataError('cross-scope playoff game');
    }
    if (!game.playoff_series_id || game.game_type !== 'playoff') continue;
    assertUuid(game.playoff_series_id, 'playoff game series ID');
    const relatedSeries = seriesById.get(game.playoff_series_id);
    if (!relatedSeries) throw new PublicLeaguePageDataError('playoff game series missing');
    for (const teamId of [game.home_team_id, game.away_team_id]) {
      assertUuid(teamId, 'playoff game team ID');
      if (!teamById.has(teamId)) {
        throw new PublicLeaguePageDataError('playoff game team is not a selected-season public team');
      }
    }
    const gameParticipantIds = new Set([game.home_team_id, game.away_team_id]);
    const knownSeriesParticipantIds = [relatedSeries.high_seed_id, relatedSeries.low_seed_id]
      .filter((teamId): teamId is string => teamId !== null);
    if (knownSeriesParticipantIds.some((teamId) => !gameParticipantIds.has(teamId))) {
      throw new PublicLeaguePageDataError('playoff game participants do not match series');
    }
    if (!['scheduled', 'in_progress'].includes(game.status)) continue;
    const scheduledAt = new Date(game.scheduled_at).getTime();
    if (Number.isNaN(scheduledAt)) throw new PublicLeaguePageDataError('invalid playoff game date');
    if (scheduledAt < input.now.getTime()) continue;
    futureGamesBySeries.set(game.playoff_series_id, [
      ...(futureGamesBySeries.get(game.playoff_series_id) ?? []),
      game,
    ]);
  }
  for (const games of futureGamesBySeries.values()) {
    games.sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at) || left.id.localeCompare(right.id));
  }

  const series: PageSeries[] = input.seriesRows.map((row) => {
    assertUuid(row.id, 'playoff series ID');
    if (row.league_id !== input.leagueId || row.season_id !== input.seasonId) {
      throw new PublicLeaguePageDataError('cross-scope playoff series');
    }
    if (row.division_id && !divisionById.has(row.division_id)) {
      throw new PublicLeaguePageDataError('playoff series division missing');
    }
    if (!Number.isSafeInteger(row.round_number) || row.round_number < 1
      || !Number.isSafeInteger(row.series_number) || row.series_number < 1) {
      throw new PublicLeaguePageDataError('invalid playoff series position');
    }
    assertNonnegativeInteger(row.high_seed_wins, 'high seed wins');
    assertNonnegativeInteger(row.low_seed_wins, 'low seed wins');
    const mapTeam = (teamId: string | null) => {
      if (!teamId) return null;
      assertUuid(teamId, 'playoff seed ID');
      const team = teamById.get(teamId);
      if (!team) throw new PublicLeaguePageDataError('playoff seed is not a selected-season public team');
      return team;
    };
    if (row.winner_id && row.winner_id !== row.high_seed_id && row.winner_id !== row.low_seed_id) {
      throw new PublicLeaguePageDataError('playoff winner is not a series seed');
    }
    const next = futureGamesBySeries.get(row.id)?.[0] ?? null;
    return {
      id: row.id,
      divisionId: row.division_id,
      divisionName: row.division_id ? divisionById.get(row.division_id)?.name ?? null : null,
      roundNumber: row.round_number,
      seriesNumber: row.series_number,
      highSeed: mapTeam(row.high_seed_id),
      lowSeed: mapTeam(row.low_seed_id),
      highSeedWins: row.high_seed_wins,
      lowSeedWins: row.low_seed_wins,
      winnerId: row.winner_id,
      status: row.status,
      nextGame: next ? { id: next.id, scheduledAt: next.scheduled_at, location: next.location } : null,
    };
  }).sort((left, right) =>
    (left.divisionName ?? '').localeCompare(right.divisionName ?? '', 'en')
    || left.roundNumber - right.roundNumber
    || left.seriesNumber - right.seriesNumber
    || left.id.localeCompare(right.id, 'en'));

  const standings: PageStanding[] = filterPublicStandings(input.standings).map((standing) => {
    assertUuid(standing.team_id, 'standing team ID');
    assertNonnegativeNumber(standing.points, 'standing points');
    if (!teamById.has(standing.team_id)) {
      throw new PublicLeaguePageDataError('standing team is not a selected-season public team');
    }
    if (standing.division_id && !divisionById.has(standing.division_id)) {
      throw new PublicLeaguePageDataError('standing division missing');
    }
    return {
      teamId: standing.team_id,
      teamName: standing.team_name,
      logoUrl: standing.team_logo,
      points: standing.points,
      divisionId: standing.division_id,
      divisionName: standing.division_name,
    };
  }).sort((left, right) => right.points - left.points
    || left.teamName.localeCompare(right.teamName, 'en')
    || left.teamId.localeCompare(right.teamId, 'en'));

  const optionalCount = (value: number | null | undefined, label: string) => {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new PublicLeaguePageDataError(`invalid ${label}`);
    return value;
  };
  return {
    series,
    standings,
    previewConfig: {
      playoffTeamsTotal: optionalCount(input.config?.playoff_teams_total, 'playoff team total'),
      playoffTeamsPerDivision: optionalCount(input.config?.playoff_teams_per_division, 'playoff teams per division'),
      useDivisionPlayoffs: input.config?.use_division_playoffs ?? null,
    },
  };
}

function rosterRecency(row: PublicRosterSourceRow): number {
  if (!row.joined_at) return 0;
  const value = new Date(row.joined_at).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function buildPublicPlayers(input: {
  rosterRows: PublicRosterSourceRow[];
  profiles: PublicProfileSourceRow[];
  teams: PageTeam[];
  currentMembershipOnly: boolean;
}): PagePlayer[] {
  for (const row of input.rosterRows) {
    assertUuid(row.id, 'roster ID');
    assertUuid(row.player_id, 'roster player ID');
    assertUuid(row.team_id, 'roster team ID');
  }
  const teamById = new Map(input.teams.map((team) => {
    assertUuid(team.id, 'team ID');
    return [team.id, team];
  }));
  const profileById = new Map(input.profiles.map((profile) => {
    assertUuid(profile.id, 'profile ID');
    return [profile.id, profile];
  }));
  const memberships = new Map<string, PublicRosterSourceRow>();

  for (const row of input.rosterRows) {
    if (!teamById.has(row.team_id)) continue;
    if (input.currentMembershipOnly && (row.status !== 'active' || row.end_date !== null)) continue;
    if (row.jersey_number !== null && (!Number.isSafeInteger(row.jersey_number) || row.jersey_number < 1 || row.jersey_number > 99)) {
      throw new PublicLeaguePageDataError('invalid roster jersey number');
    }
    const key = `${row.player_id}\u0000${row.team_id}`;
    const existing = memberships.get(key);
    if (!existing
      || rosterRecency(row) > rosterRecency(existing)
      || (rosterRecency(row) === rosterRecency(existing) && row.id.localeCompare(existing.id) > 0)) {
      memberships.set(key, row);
    }
  }

  return [...memberships.values()].map((row): PagePlayer => {
    const team = teamById.get(row.team_id)!;
    const profile = profileById.get(row.player_id);
    if (!profile) throw new PublicLeaguePageDataError('roster profile identity missing');
    const fullName = profile.full_name?.trim();
    if (!fullName) throw new PublicLeaguePageDataError('roster profile name missing');
    return {
      id: profile.id,
      fullName,
      photoUrl: resolvePlayerPhotoUrl(profile),
      jerseyNumber: row.jersey_number,
      position: row.position,
      leadershipRole: row.leadership_role,
      teamId: team.id,
      teamName: team.name,
      teamSlug: team.slug,
      teamLogoUrl: team.logoUrl,
      divisionId: team.divisionId,
    };
  }).sort((left, right) =>
    left.fullName.localeCompare(right.fullName, 'en')
    || left.id.localeCompare(right.id, 'en')
    || left.teamId.localeCompare(right.teamId, 'en'));
}

type SourceClient = {
  from(table: string): { select(columns: string, options?: { count?: 'exact' }): unknown };
  rpc(name: string, args: Record<string, unknown>, options?: { count?: 'exact' }): {
    select(columns: string): unknown;
  };
};

type SourceFilter =
  | ['eq', string, unknown]
  | ['in', string, unknown[]]
  | ['not', string, string, unknown];

function applySourceQuery(
  value: unknown,
  filters: SourceFilter[],
  orderColumns: string[] = ['id'],
): QueryLike {
  let query = value as Record<string, (...args: unknown[]) => unknown>;
  for (const filter of filters) {
    if (typeof query[filter[0]] !== 'function') {
      throw new PublicLeaguePageDataError(`source query method ${filter[0]} missing`);
    }
    query = query[filter[0]](...filter.slice(1)) as typeof query;
  }
  if (typeof query.order !== 'function') throw new PublicLeaguePageDataError('source query ordering missing');
  for (const column of orderColumns) {
    query = query.order(column, { ascending: true }) as typeof query;
  }
  return query as unknown as QueryLike;
}

async function readTable<T>(
  client: SourceClient,
  table: string,
  columns: string,
  filters: SourceFilter[],
  options: { label?: string; maxRows?: number; pageSize?: number; orderColumns?: string[] } = {},
) {
  return readCompletePages<T>(
    () => applySourceQuery(
      client.from(table).select(columns, { count: 'exact' }),
      filters,
      options.orderColumns,
    ),
    options.label ?? table,
    options.pageSize,
    options.maxRows,
  );
}

function assertUniqueIds(rows: Array<{ id: string }>, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    assertUuid(row.id, `${label} ID`);
    if (seen.has(row.id)) throw new PublicLeaguePageDataError(`duplicate ${label} ID`);
    seen.add(row.id);
  }
}

export async function loadPublicLeaguePageCatalogFromClient(
  client: SourceClient,
  leagueId: string,
  pageSize = 1000,
): Promise<PublicLeaguePageCatalog> {
  assertUuid(leagueId, 'league ID');
  const [seasonRows, divisionRows] = await Promise.all([
    readTable<{
      id: string; league_id: string; name: string; status: string | null;
      start_date: string | null; end_date: string | null; created_at: string | null;
    }>(client, 'seasons', 'id, league_id, name, status, start_date, end_date, created_at', [
      ['eq', 'league_id', leagueId],
    ], { maxRows: 256, pageSize, orderColumns: ['start_date', 'id'] }),
    readTable<{ id: string; league_id: string; name: string; sort_order: number }>(
      client,
      'divisions',
      'id, league_id, name, sort_order',
      [['eq', 'league_id', leagueId]],
      { maxRows: 128, pageSize, orderColumns: ['sort_order', 'name', 'id'] },
    ),
  ]);
  assertUniqueIds(seasonRows, 'season');
  assertUniqueIds(divisionRows, 'division');
  if (seasonRows.some((row) => row.league_id !== leagueId)
    || divisionRows.some((row) => row.league_id !== leagueId)) {
    throw new PublicLeaguePageDataError('cross-league catalog row');
  }
  return {
    seasons: [...seasonRows].sort((left, right) => {
      const timestamp = (value: string | null) => {
        const parsed = value ? new Date(value).getTime() : 0;
        return Number.isNaN(parsed) ? 0 : parsed;
      };
      return timestamp(right.start_date) - timestamp(left.start_date)
        || timestamp(right.created_at) - timestamp(left.created_at)
        || left.id.localeCompare(right.id, 'en');
    }).map((row) => {
      const name = row.name.trim();
      if (!name) throw new PublicLeaguePageDataError('season name missing');
      return {
        id: row.id,
        leagueId: row.league_id,
        name,
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
        createdAt: row.created_at,
      };
    }),
    divisions: [...divisionRows].sort((left, right) =>
      left.sort_order - right.sort_order
      || left.name.localeCompare(right.name, 'en')
      || left.id.localeCompare(right.id, 'en')).map((row) => {
      const name = row.name.trim();
      if (!name) throw new PublicLeaguePageDataError('division name missing');
      return { id: row.id, leagueId: row.league_id, name };
    }),
  };
}

function canonicalNumber(value: unknown, label: string, allowNegative = false): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0)) {
    throw new PublicLeaguePageDataError(`invalid ${label}`);
  }
  return parsed;
}

async function readStrictStandings(
  client: SourceClient,
  scope: { leagueId: string; seasonId: string },
  teamRows: PublicTeamSourceRow[],
  selectedTeams: PageTeam[],
  divisions: PublicLeaguePageCatalog['divisions'],
  pageSize: number,
): Promise<TeamStanding[]> {
  const sourceRows = await readCompletePages<Record<string, unknown>>(
    () => {
      const rpc = client.rpc('get_team_standings', {
        check_league_id: scope.leagueId,
        check_season_id: scope.seasonId,
      }, { count: 'exact' });
      if (!rpc || typeof rpc.select !== 'function') {
        throw new PublicLeaguePageDataError('standings source selection missing');
      }
      return applySourceQuery(rpc.select(
        'team_id, games_played, wins, losses, ties, points, goals_for, goals_against, goal_differential',
      ), [], ['team_id']);
    },
    'standings',
    pageSize,
    2000,
  );
  const divisionById = new Map(divisions.map((division) => [division.id, division.name]));
  const publicTeams = filterPublicTeams(teamRows);
  const teamById = new Map(publicTeams.map((team) => [team.id, team]));
  const permitted = new Set(selectedTeams.map((team) => team.id));
  const seen = new Set<string>();
  const standings = sourceRows.flatMap((row): TeamStanding[] => {
    const teamId = typeof row.team_id === 'string' ? row.team_id : '';
    assertUuid(teamId, 'standing team ID');
    if (seen.has(teamId)) throw new PublicLeaguePageDataError('duplicate standing team ID');
    seen.add(teamId);
    const gamesPlayed = canonicalNumber(row.games_played, 'standing games played');
    if (gamesPlayed <= 0 || !permitted.has(teamId)) return [];
    const team = teamById.get(teamId);
    if (!team) throw new PublicLeaguePageDataError('standing team is not a public league team');
    return [{
      team_id: team.id,
      team_name: team.name,
      team_logo: team.logo_url,
      division_id: team.division_id,
      division_name: team.division_id ? divisionById.get(team.division_id) ?? null : null,
      team_type: (team.team_type as Team['team_type']) ?? 'standard',
      games_played: gamesPlayed,
      wins: canonicalNumber(row.wins, 'standing wins'),
      losses: canonicalNumber(row.losses, 'standing losses'),
      ties: canonicalNumber(row.ties, 'standing ties'),
      overtime_losses: 0,
      points: canonicalNumber(row.points, 'standing points'),
      goals_for: canonicalNumber(row.goals_for, 'standing goals for'),
      goals_against: canonicalNumber(row.goals_against, 'standing goals against'),
      goal_differential: canonicalNumber(row.goal_differential, 'standing goal differential', true),
      streak: null,
      last_10: null,
    }];
  });
  return filterPublicStandings(standings).sort((left, right) =>
    right.points - left.points
    || right.wins - left.wins
    || right.goal_differential - left.goal_differential
    || right.goals_for - left.goals_for
    || left.team_name.localeCompare(right.team_name, 'en'));
}

export async function loadPublicLeaguePageSeasonDataFromClient(
  client: SourceClient,
  scope: {
    leagueId: string;
    seasonId: string;
    page: LeaguePageKind;
    isPresentationSeason: boolean;
    currentMembershipOnly: boolean;
    divisions: PublicLeaguePageCatalog['divisions'];
    now: Date;
  },
  pageSize = 1000,
): Promise<PublicLeaguePageSeasonData> {
  const common = { pageSize, maxRows: 50_000 };
  const [teamRows, rosterRows, preferenceRows, registrationRows, gameRows] = await Promise.all([
    readTable<PublicTeamSourceRow>(client, 'teams', 'id, league_id, name, slug, logo_url, division_id, primary_color, team_type', [
      ['eq', 'league_id', scope.leagueId],
    ], { ...common, maxRows: 2000 }),
    readTable<PublicRosterSourceRow>(client, 'team_rosters', 'id, league_id, season_id, team_id, player_id, jersey_number, position, leadership_role, status, player_type, joined_at, end_date', [
      ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
    ], common),
    readTable<{ id: string; league_id: string; season_id: string | null; team_id: string }>(client, 'team_schedule_preferences', 'id, league_id, season_id, team_id', [
      ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
    ], { ...common, maxRows: 10_000 }),
    readTable<{ id: string; league_id: string; season_id: string; team_id: string | null }>(client, 'registration_submissions', 'id, league_id, season_id, team_id', [
      ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
      ['not', 'team_id', 'is', null], ['not', 'submitted_at', 'is', null],
      ['in', 'status', ['pending', 'approved', 'waitlisted']],
    ], { ...common, maxRows: 10_000 }),
    readTable<PublicPositioningGameRow & PublicPlayoffGameSourceRow>(client, 'games', 'id, league_id, season_id, scheduled_at, status, home_team_id, away_team_id, home_score, away_score, playoff_series_id, location, game_type', [
      ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
    ], common),
  ]);
  assertUniqueIds(teamRows, 'team');
  assertUniqueIds(rosterRows, 'roster');
  assertUniqueIds(preferenceRows, 'team schedule preference');
  assertUniqueIds(registrationRows, 'registration submission');
  assertUniqueIds(gameRows, 'game');
  if (rosterRows.some((row) => row.league_id !== scope.leagueId || row.season_id !== scope.seasonId)
    || preferenceRows.some((row) => row.league_id !== scope.leagueId || row.season_id !== scope.seasonId)
    || registrationRows.some((row) => row.league_id !== scope.leagueId || row.season_id !== scope.seasonId)
    || gameRows.some((row) => row.league_id !== scope.leagueId || row.season_id !== scope.seasonId)) {
    throw new PublicLeaguePageDataError('cross-scope participation row');
  }
  const participantTeamIds = resolveSeasonParticipationTeamIds({
    seasonPreferenceTeamIds: preferenceRows.map((row) => row.team_id),
    rosterTeamIds: rosterRows
      .filter((row) => !scope.currentMembershipOnly || row.status === 'active')
      .map((row) => row.team_id),
    registrationTeamIds: registrationRows.map((row) => row.team_id),
    gameTeamIds: gameRows.flatMap((row) => [row.home_team_id, row.away_team_id]),
  });
  const teams = buildPublicTeams({
    leagueId: scope.leagueId,
    participantTeamIds,
    divisions: scope.divisions,
    teamRows,
  });
  let players: PagePlayer[] = [];
  let positioning: PositioningData | null = null;
  let series: PageSeries[] = [];
  let standings: PageStanding[] = [];
  let previewConfig: PublicLeaguePageSeasonData['previewConfig'] = {
    playoffTeamsTotal: null,
    playoffTeamsPerDivision: null,
    useDivisionPlayoffs: null,
  };

  if (scope.page === 'players') {
    const visibleTeamIds = new Set(teams.map((team) => team.id));
    const playerIds = [...new Set(rosterRows
      .filter((row) => visibleTeamIds.has(row.team_id))
      .filter((row) => !scope.currentMembershipOnly || (row.status === 'active' && row.end_date === null))
      .map((row) => row.player_id))];
    const profiles: PublicProfileSourceRow[] = [];
    for (let offset = 0; offset < playerIds.length; offset += 200) {
      profiles.push(...await readTable<PublicProfileSourceRow>(client, 'profiles', 'id, full_name, avatar_url, photo_url', [
        ['in', 'id', playerIds.slice(offset, offset + 200)],
      ], { pageSize, maxRows: 200, label: 'profiles' }));
    }
    assertUniqueIds(profiles, 'profile');
    players = buildPublicPlayers({ rosterRows, profiles, teams, currentMembershipOnly: scope.currentMembershipOnly });
  }

  if (scope.page === 'teams' && scope.isPresentationSeason) {
    const [canonicalStandings, checkins, availability, playerStats, goalieStats] = await Promise.all([
      readStrictStandings(client, scope, teamRows, teams, scope.divisions, pageSize),
      readTable<PublicAppearanceSignalRow>(client, 'game_checkins', 'id, game_id, team_id, player_id, status, game:games!inner(id)', [
        ['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId],
        ['in', 'game.status', ['in_progress', 'pending_verification', 'completed']],
      ], common),
      readTable<PublicAppearanceSignalRow>(client, 'player_availability', 'id, game_id, team_id, player_id, status', [
        ['eq', 'season_id', scope.seasonId], ['eq', 'status', 'out'],
      ], common),
      readTable<PublicAppearanceSignalRow>(client, 'player_stats', 'id, game_id, team_id, player_id, goals', [
        ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
      ], common),
      readTable<PublicAppearanceSignalRow>(client, 'goalie_stats', 'id, game_id, team_id, player_id', [
        ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
      ], common),
    ]);
    assertUniqueIds(checkins, 'checkin');
    assertUniqueIds(availability, 'availability');
    assertUniqueIds(playerStats, 'player stat');
    assertUniqueIds(goalieStats, 'goalie stat');
    positioning = buildPublicPositioning({
      leagueId: scope.leagueId,
      seasonId: scope.seasonId,
      teams,
      standings: canonicalStandings,
      games: gameRows.filter((game) => ['in_progress', 'pending_verification', 'completed'].includes(game.status)),
      rosterRows,
      checkins,
      availability,
      playerStats,
      goalieStats,
    });
  }

  if (scope.page === 'playoffs') {
    const [canonicalStandings, seriesRows, configRows] = await Promise.all([
      readStrictStandings(client, scope, teamRows, teams, scope.divisions, pageSize),
      readTable<PublicPlayoffSeriesSourceRow>(client, 'playoff_series', 'id, league_id, season_id, division_id, round_number, series_number, high_seed_id, low_seed_id, high_seed_wins, low_seed_wins, winner_id, status', [
        ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
      ], { ...common, maxRows: 4096, orderColumns: ['division_id', 'round_number', 'series_number', 'id'] }),
      readTable<PublicPlayoffConfigSourceRow & { id: string }>(client, 'standings_config', 'id, playoff_teams_total, playoff_teams_per_division, use_division_playoffs', [
        ['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId],
      ], { pageSize, maxRows: 2 }),
    ]);
    if (configRows.length > 1) throw new PublicLeaguePageDataError('ambiguous playoff config');
    const playoffs = buildPublicPlayoffs({
      leagueId: scope.leagueId,
      seasonId: scope.seasonId,
      now: scope.now,
      divisions: scope.divisions,
      teams,
      seriesRows,
      gameRows,
      standings: canonicalStandings,
      config: configRows[0] ?? null,
    });
    series = playoffs.series;
    standings = playoffs.standings;
    previewConfig = playoffs.previewConfig;
  }

  return { teams, players, positioning, series, standings, previewConfig };
}

export async function loadPublicLeaguePageCatalog(leagueId: string): Promise<PublicLeaguePageCatalog> {
  return loadPublicLeaguePageCatalogFromClient(createServiceRoleClient() as unknown as SourceClient, leagueId);
}

export async function loadPublicLeaguePageSeasonData(scope: {
  leagueId: string;
  seasonId: string;
  page: LeaguePageKind;
  isPresentationSeason: boolean;
  currentMembershipOnly: boolean;
  divisions: PublicLeaguePageCatalog['divisions'];
  now: Date;
}): Promise<PublicLeaguePageSeasonData> {
  return loadPublicLeaguePageSeasonDataFromClient(
    createServiceRoleClient() as unknown as SourceClient,
    scope,
  );
}
