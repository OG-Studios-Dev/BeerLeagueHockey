// Versioned public wire contract for native Teams, Players, and Playoffs pages.
export type LeaguePageKind = 'teams' | 'players' | 'playoffs';

export interface PageSeason {
  id: string;
  name: string;
  status: string | null;
}

export interface PageDivision {
  id: string;
  name: string;
}

export interface PageTeam {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  divisionId: string | null;
  divisionName: string | null;
  primaryColor: string | null;
}

export type PositionMetric = 'overall' | 'offense' | 'defense' | 'scoringDepth' | 'commitment';

export interface PositionMetricValue {
  rank: number;
  value: number;
  valueLabel: string;
}

export interface PositioningData {
  seasonId: string;
  totalTeams: number;
  attendanceSource: 'confirmed-plus-fallback-roster-appearances';
  teams: Array<{
    teamId: string;
    teamName: string;
    teamSlug: string;
    logoUrl: string | null;
    primaryColor: string;
    divisionId: string | null;
    metrics: Record<PositionMetric, PositionMetricValue>;
  }>;
}

export interface PagePlayer {
  id: string;
  fullName: string;
  photoUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  leadershipRole: string | null;
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamLogoUrl: string | null;
  divisionId: string | null;
}

export interface PageSeriesTeam {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface PageSeries {
  id: string;
  divisionId: string | null;
  divisionName: string | null;
  roundNumber: number;
  seriesNumber: number;
  highSeed: PageSeriesTeam | null;
  lowSeed: PageSeriesTeam | null;
  highSeedWins: number;
  lowSeedWins: number;
  winnerId: string | null;
  status: string;
  nextGame: { id: string; scheduledAt: string; location: string | null } | null;
}

export interface PageStanding {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  points: number;
  divisionId: string | null;
  divisionName: string | null;
}

export interface LeaguePageBase {
  schemaVersion: 1;
  page: LeaguePageKind;
  league: { id: string; slug: string; name: string };
  seasons: PageSeason[];
  selectedSeason: PageSeason | null;
  divisions: PageDivision[];
  teams: PageTeam[];
}

export interface TeamsPageResponse extends LeaguePageBase {
  page: 'teams';
  positioning: PositioningData | null;
}

export interface PlayersPageResponse extends LeaguePageBase {
  page: 'players';
  players: PagePlayer[];
}

export interface PlayoffsPageResponse extends LeaguePageBase {
  page: 'playoffs';
  series: PageSeries[];
  standings: PageStanding[];
  previewConfig: {
    playoffTeamsTotal: number | null;
    playoffTeamsPerDivision: number | null;
    useDivisionPlayoffs: boolean | null;
  };
}

export type LeaguePageResponse = TeamsPageResponse | PlayersPageResponse | PlayoffsPageResponse;

const WIRE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WIRE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function wireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`invalid ${label}`);
  return value as Record<string, unknown>;
}

function wireExact(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`invalid ${label} shape`);
  }
}

function wireString(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`invalid ${label}`);
  return value;
}

function wireNullableString(value: unknown, label: string, max = 2048): string | null {
  return value === null ? null : wireString(value, label, max);
}

function wireUuid(value: unknown, label: string): string {
  const result = wireString(value, label, 36);
  if (!WIRE_UUID.test(result)) throw new TypeError(`invalid ${label}`);
  return result;
}

function wireNumber(value: unknown, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new TypeError(`invalid ${label}`);
  }
  return value;
}

function wireRows(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`invalid ${label}`);
  return value;
}

function wireUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new TypeError(`duplicate ${label}`);
}

function validateSeason(value: unknown, label: string): PageSeason {
  const row = wireRecord(value, label);
  wireExact(row, ['id', 'name', 'status'], label);
  return {
    id: wireUuid(row.id, `${label} ID`),
    name: wireString(row.name, `${label} name`),
    status: wireNullableString(row.status, `${label} status`, 40),
  };
}

function validateTeam(value: unknown, label: string): PageTeam {
  const row = wireRecord(value, label);
  wireExact(row, ['id', 'name', 'slug', 'logoUrl', 'divisionId', 'divisionName', 'primaryColor'], label);
  const slug = wireString(row.slug, `${label} slug`, 100);
  if (!WIRE_SLUG.test(slug)) throw new TypeError(`invalid ${label} slug`);
  return {
    id: wireUuid(row.id, `${label} ID`),
    name: wireString(row.name, `${label} name`),
    slug,
    logoUrl: wireNullableString(row.logoUrl, `${label} logo URL`),
    divisionId: row.divisionId === null ? null : wireUuid(row.divisionId, `${label} division ID`),
    divisionName: wireNullableString(row.divisionName, `${label} division name`),
    primaryColor: wireNullableString(row.primaryColor, `${label} primary color`, 64),
  };
}

export function assertValidLeaguePageResponse(
  value: unknown,
  expectedLeagueSlug?: string,
): asserts value is LeaguePageResponse {
  const raw = wireRecord(value, 'league page response');
  const page = raw.page;
  if (page !== 'teams' && page !== 'players' && page !== 'playoffs') throw new TypeError('invalid league page');
  const pageKeys: Record<LeaguePageKind, string[]> = {
    teams: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'positioning'],
    players: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'players'],
    playoffs: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'series', 'standings', 'previewConfig'],
  };
  wireExact(raw, pageKeys[page], 'league page response');
  if (raw.schemaVersion !== 1) throw new TypeError('invalid schema version');

  const league = wireRecord(raw.league, 'league');
  wireExact(league, ['id', 'slug', 'name'], 'league');
  wireUuid(league.id, 'league ID');
  const leagueSlug = wireString(league.slug, 'league slug', 63);
  if (!WIRE_SLUG.test(leagueSlug)) throw new TypeError('invalid league slug');
  if (expectedLeagueSlug !== undefined && leagueSlug !== expectedLeagueSlug) {
    throw new TypeError('league slug mismatch');
  }
  wireString(league.name, 'league name');

  const seasons = wireRows(raw.seasons, 'seasons', 500).map((row, index) => validateSeason(row, `season ${index}`));
  wireUnique(seasons.map((season) => season.id), 'season ID');
  const selectedSeason = raw.selectedSeason === null ? null : validateSeason(raw.selectedSeason, 'selected season');
  if (selectedSeason && !seasons.some((season) => season.id === selectedSeason.id)) {
    throw new TypeError('selected season missing from catalog');
  }
  const divisions = wireRows(raw.divisions, 'divisions', 500).map((value, index): PageDivision => {
    const row = wireRecord(value, `division ${index}`);
    wireExact(row, ['id', 'name'], `division ${index}`);
    return { id: wireUuid(row.id, `division ${index} ID`), name: wireString(row.name, `division ${index} name`) };
  });
  wireUnique(divisions.map((division) => division.id), 'division ID');
  const divisionIds = new Set(divisions.map((division) => division.id));
  const teams = wireRows(raw.teams, 'teams', 5000).map((row, index) => validateTeam(row, `team ${index}`));
  wireUnique(teams.map((team) => team.id), 'team ID');
  if (teams.some((team) => team.divisionId && !divisionIds.has(team.divisionId))) {
    throw new TypeError('team division missing');
  }
  if (!selectedSeason && teams.length) throw new TypeError('no-season response contains teams');
  const teamById = new Map(teams.map((team) => [team.id, team]));

  if (page === 'teams') {
    if (raw.positioning === null) return;
    const positioning = wireRecord(raw.positioning, 'positioning');
    wireExact(positioning, ['seasonId', 'totalTeams', 'attendanceSource', 'teams'], 'positioning');
    if (!selectedSeason || wireUuid(positioning.seasonId, 'positioning season ID') !== selectedSeason.id) {
      throw new TypeError('positioning season mismatch');
    }
    if (positioning.attendanceSource !== 'confirmed-plus-fallback-roster-appearances') {
      throw new TypeError('invalid positioning attendance source');
    }
    const positioningTeams = wireRows(positioning.teams, 'positioning teams', 5000);
    if (wireNumber(positioning.totalTeams, 'positioning total teams', true) !== positioningTeams.length) {
      throw new TypeError('positioning total mismatch');
    }
    const metricNames: PositionMetric[] = ['overall', 'offense', 'defense', 'scoringDepth', 'commitment'];
    const positioningIds = positioningTeams.map((value, index) => {
      const row = wireRecord(value, `positioning team ${index}`);
      wireExact(row, ['teamId', 'teamName', 'teamSlug', 'logoUrl', 'primaryColor', 'divisionId', 'metrics'], `positioning team ${index}`);
      const teamId = wireUuid(row.teamId, `positioning team ${index} ID`);
      const canonical = teamById.get(teamId);
      if (!canonical) throw new TypeError('positioning team missing');
      const slug = wireString(row.teamSlug, `positioning team ${index} slug`, 100);
      if (!WIRE_SLUG.test(slug)) throw new TypeError(`invalid positioning team ${index} slug`);
      wireString(row.teamName, `positioning team ${index} name`);
      wireNullableString(row.logoUrl, `positioning team ${index} logo URL`);
      wireString(row.primaryColor, `positioning team ${index} primary color`, 64);
      const divisionId = row.divisionId === null ? null : wireUuid(row.divisionId, `positioning team ${index} division ID`);
      if (divisionId && !divisionIds.has(divisionId)) throw new TypeError('positioning division missing');
      const metrics = wireRecord(row.metrics, `positioning team ${index} metrics`);
      wireExact(metrics, metricNames, `positioning team ${index} metrics`);
      for (const metricName of metricNames) {
        const metric = wireRecord(metrics[metricName], `${metricName} metric`);
        wireExact(metric, ['rank', 'value', 'valueLabel'], `${metricName} metric`);
        wireNumber(metric.rank, `${metricName} rank`, true);
        wireNumber(metric.value, `${metricName} value`);
        wireString(metric.valueLabel, `${metricName} value label`);
      }
      if (canonical.name !== row.teamName || canonical.slug !== slug || canonical.logoUrl !== row.logoUrl
        || canonical.divisionId !== divisionId) throw new TypeError('positioning team metadata mismatch');
      return teamId;
    });
    wireUnique(positioningIds, 'positioning team ID');
    return;
  }

  if (page === 'players') {
    const memberships = wireRows(raw.players, 'players', 20000).map((value, index) => {
      const row = wireRecord(value, `player ${index}`);
      wireExact(row, ['id', 'fullName', 'photoUrl', 'jerseyNumber', 'position', 'leadershipRole', 'teamId', 'teamName', 'teamSlug', 'teamLogoUrl', 'divisionId'], `player ${index}`);
      wireUuid(row.id, `player ${index} ID`);
      wireString(row.fullName, `player ${index} name`);
      wireNullableString(row.photoUrl, `player ${index} photo URL`);
      if (row.jerseyNumber !== null) wireNumber(row.jerseyNumber, `player ${index} jersey number`, true);
      wireNullableString(row.position, `player ${index} position`, 80);
      wireNullableString(row.leadershipRole, `player ${index} leadership role`, 80);
      const teamId = wireUuid(row.teamId, `player ${index} team ID`);
      const canonical = teamById.get(teamId);
      if (!canonical) throw new TypeError('player team missing');
      const teamSlug = wireString(row.teamSlug, `player ${index} team slug`, 100);
      if (!WIRE_SLUG.test(teamSlug)) throw new TypeError(`invalid player ${index} team slug`);
      const divisionId = row.divisionId === null ? null : wireUuid(row.divisionId, `player ${index} division ID`);
      if (canonical.name !== row.teamName || canonical.slug !== teamSlug || canonical.logoUrl !== row.teamLogoUrl
        || canonical.divisionId !== divisionId) throw new TypeError('player team metadata mismatch');
      return `${row.id}:${teamId}`;
    });
    if (!selectedSeason && memberships.length) throw new TypeError('no-season response contains players');
    wireUnique(memberships, 'player membership');
    return;
  }

  const seriesIds = wireRows(raw.series, 'series', 5000).map((value, index) => {
    const row = wireRecord(value, `series ${index}`);
    wireExact(row, ['id', 'divisionId', 'divisionName', 'roundNumber', 'seriesNumber', 'highSeed', 'lowSeed', 'highSeedWins', 'lowSeedWins', 'winnerId', 'status', 'nextGame'], `series ${index}`);
    const id = wireUuid(row.id, `series ${index} ID`);
    const divisionId = row.divisionId === null ? null : wireUuid(row.divisionId, `series ${index} division ID`);
    if (divisionId && !divisionIds.has(divisionId)) throw new TypeError('series division missing');
    wireNullableString(row.divisionName, `series ${index} division name`);
    wireNumber(row.roundNumber, `series ${index} round number`, true);
    wireNumber(row.seriesNumber, `series ${index} series number`, true);
    const participantIds = [row.highSeed, row.lowSeed].map((value, seedIndex) => {
      if (value === null) return null;
      const seed = wireRecord(value, `series ${index} seed ${seedIndex}`);
      wireExact(seed, ['id', 'name', 'logoUrl'], `series ${index} seed ${seedIndex}`);
      const teamId = wireUuid(seed.id, `series ${index} seed ${seedIndex} ID`);
      const canonical = teamById.get(teamId);
      if (!canonical) throw new TypeError('series team missing');
      if (canonical.name !== seed.name || canonical.logoUrl !== seed.logoUrl
        || (divisionId && canonical.divisionId !== divisionId)) throw new TypeError('series team metadata mismatch');
      return teamId;
    });
    wireNumber(row.highSeedWins, `series ${index} high seed wins`, true);
    wireNumber(row.lowSeedWins, `series ${index} low seed wins`, true);
    const winnerId = row.winnerId === null ? null : wireUuid(row.winnerId, `series ${index} winner ID`);
    if (winnerId && !participantIds.includes(winnerId)) throw new TypeError('series winner is not a participant');
    wireString(row.status, `series ${index} status`, 40);
    if (row.nextGame !== null) {
      const game = wireRecord(row.nextGame, `series ${index} next game`);
      wireExact(game, ['id', 'scheduledAt', 'location'], `series ${index} next game`);
      wireUuid(game.id, `series ${index} next game ID`);
      const scheduledAt = wireString(game.scheduledAt, `series ${index} next game time`, 50);
      if (!Number.isFinite(Date.parse(scheduledAt))) throw new TypeError('invalid next game time');
      wireNullableString(game.location, `series ${index} next game location`);
    }
    return id;
  });
  wireUnique(seriesIds, 'series ID');
  const standingIds = wireRows(raw.standings, 'standings', 5000).map((value, index) => {
    const row = wireRecord(value, `standing ${index}`);
    wireExact(row, ['teamId', 'teamName', 'logoUrl', 'points', 'divisionId', 'divisionName'], `standing ${index}`);
    const teamId = wireUuid(row.teamId, `standing ${index} team ID`);
    const canonical = teamById.get(teamId);
    if (!canonical) throw new TypeError('standing team missing');
    wireNumber(row.points, `standing ${index} points`);
    const divisionId = row.divisionId === null ? null : wireUuid(row.divisionId, `standing ${index} division ID`);
    if (canonical.name !== row.teamName || canonical.logoUrl !== row.logoUrl || canonical.divisionId !== divisionId) {
      throw new TypeError('standing team metadata mismatch');
    }
    wireNullableString(row.divisionName, `standing ${index} division name`);
    return teamId;
  });
  wireUnique(standingIds, 'standing team ID');
  const config = wireRecord(raw.previewConfig, 'preview config');
  wireExact(config, ['playoffTeamsTotal', 'playoffTeamsPerDivision', 'useDivisionPlayoffs'], 'preview config');
  for (const key of ['playoffTeamsTotal', 'playoffTeamsPerDivision'] as const) {
    if (config[key] !== null) wireNumber(config[key], key, true);
  }
  if (config.useDivisionPlayoffs !== null && typeof config.useDivisionPlayoffs !== 'boolean') {
    throw new TypeError('invalid division playoff flag');
  }
  if (!selectedSeason && (seriesIds.length || standingIds.length)) throw new TypeError('no-season response contains playoff rows');
}
