const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 512 * 1024;

export type LeaguePageKind = 'teams' | 'players' | 'playoffs';
export type PageSeason = { id: string; name: string; status: string | null };
export type PageDivision = { id: string; name: string };
export type PageTeam = {
  id: string; name: string; slug: string; logoUrl: string | null; divisionId: string | null;
  divisionName: string | null; primaryColor: string | null;
};
export type PositionMetric = 'overall' | 'offense' | 'defense' | 'scoringDepth' | 'commitment';
export type PositionMetricValue = { rank: number; value: number; valueLabel: string };
export type PositioningData = {
  seasonId: string;
  totalTeams: number;
  attendanceSource: 'confirmed-plus-fallback-roster-appearances';
  teams: Array<{
    teamId: string; teamName: string; teamSlug: string; logoUrl: string | null; primaryColor: string;
    divisionId: string | null; metrics: Record<PositionMetric, PositionMetricValue>;
  }>;
};
export type PagePlayer = {
  id: string; fullName: string; photoUrl: string | null; jerseyNumber: number | null; position: string | null;
  leadershipRole: string | null; teamId: string; teamName: string; teamSlug: string;
  teamLogoUrl: string | null; divisionId: string | null;
};
export type PageSeriesTeam = { id: string; name: string; logoUrl: string | null };
export type PageSeries = {
  id: string; divisionId: string | null; divisionName: string | null; roundNumber: number; seriesNumber: number;
  highSeed: PageSeriesTeam | null; lowSeed: PageSeriesTeam | null; highSeedWins: number; lowSeedWins: number;
  winnerId: string | null; status: string; nextGame: { id: string; scheduledAt: string; location: string | null } | null;
};
export type PageStanding = {
  teamId: string; teamName: string; logoUrl: string | null; points: number;
  divisionId: string | null; divisionName: string | null;
};
export type LeaguePageBase = {
  schemaVersion: 1; page: LeaguePageKind; league: { id: string; slug: string; name: string };
  seasons: PageSeason[]; selectedSeason: PageSeason | null; divisions: PageDivision[]; teams: PageTeam[];
};
export type TeamsPageResponse = LeaguePageBase & { page: 'teams'; positioning: PositioningData | null };
export type PlayersPageResponse = LeaguePageBase & { page: 'players'; players: PagePlayer[] };
export type PlayoffsPageResponse = LeaguePageBase & {
  page: 'playoffs'; series: PageSeries[]; standings: PageStanding[];
  previewConfig: { playoffTeamsTotal: number | null; playoffTeamsPerDivision: number | null; useDivisionPlayoffs: boolean | null };
};
export type LeaguePageResponse = TeamsPageResponse | PlayersPageResponse | PlayoffsPageResponse;

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Invalid ${label} shape`);
  }
}
function string(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid ${label}`);
  return value;
}
function nullableString(value: unknown, label: string, max = 2048): string | null {
  return value === null ? null : string(value, label, max);
}
function uuid(value: unknown, label: string): string {
  const result = string(value, label, 36);
  if (!UUID.test(result)) throw new TypeError(`Invalid ${label}`);
  return result;
}
function finite(value: unknown, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}
function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : finite(value, label, true);
}
function rows(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`Invalid ${label}`);
  return value;
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}`);
}

function season(value: unknown, label: string): PageSeason {
  const raw = record(value, label);
  exact(raw, ['id', 'name', 'status'], label);
  return { id: uuid(raw.id, `${label} id`), name: string(raw.name, `${label} name`), status: nullableString(raw.status, `${label} status`, 40) };
}
function division(value: unknown, label: string): PageDivision {
  const raw = record(value, label);
  exact(raw, ['id', 'name'], label);
  return { id: uuid(raw.id, `${label} id`), name: string(raw.name, `${label} name`) };
}
function team(value: unknown, label: string): PageTeam {
  const raw = record(value, label);
  exact(raw, ['id', 'name', 'slug', 'logoUrl', 'divisionId', 'divisionName', 'primaryColor'], label);
  const teamSlug = string(raw.slug, `${label} slug`, 100);
  if (!SLUG.test(teamSlug)) throw new TypeError(`Invalid ${label} slug`);
  const primaryColor = nullableString(raw.primaryColor, `${label} primary color`, 64);
  return {
    id: uuid(raw.id, `${label} id`), name: string(raw.name, `${label} name`), slug: teamSlug,
    logoUrl: nullableString(raw.logoUrl, `${label} logo URL`), divisionId: raw.divisionId === null ? null : uuid(raw.divisionId, `${label} division id`),
    divisionName: nullableString(raw.divisionName, `${label} division name`), primaryColor,
  };
}
function seriesTeam(value: unknown, label: string): PageSeriesTeam | null {
  if (value === null) return null;
  const raw = record(value, label);
  exact(raw, ['id', 'name', 'logoUrl'], label);
  return { id: uuid(raw.id, `${label} id`), name: string(raw.name, `${label} name`), logoUrl: nullableString(raw.logoUrl, `${label} logo URL`) };
}

function decodeBase(raw: Record<string, unknown>, expectedPage: LeaguePageKind, expectedSlug: string): LeaguePageBase {
  if (raw.schemaVersion !== 1 || raw.page !== expectedPage) throw new TypeError('League page response contract mismatch');
  const league = record(raw.league, 'league');
  exact(league, ['id', 'slug', 'name'], 'league');
  const leagueSlug = string(league.slug, 'league slug', 63);
  if (leagueSlug !== expectedSlug) throw new TypeError('League page tenant identity mismatch');
  const seasons = rows(raw.seasons, 'seasons', 500).map((entry, index) => season(entry, `season ${index}`));
  unique(seasons.map((entry) => entry.id), 'season');
  const selectedSeason = raw.selectedSeason === null ? null : season(raw.selectedSeason, 'selected season');
  if (selectedSeason && !seasons.some((entry) => entry.id === selectedSeason.id)) throw new TypeError('Selected season is not in season catalog');
  const divisions = rows(raw.divisions, 'divisions', 500).map((entry, index) => division(entry, `division ${index}`));
  unique(divisions.map((entry) => entry.id), 'division');
  const teams = rows(raw.teams, 'teams', 5000).map((entry, index) => team(entry, `team ${index}`));
  unique(teams.map((entry) => entry.id), 'team');
  const divisionIds = new Set(divisions.map((entry) => entry.id));
  if (teams.some((entry) => entry.divisionId && !divisionIds.has(entry.divisionId))) throw new TypeError('Team references unknown division');
  if (!selectedSeason && teams.length) throw new TypeError('No-season response contains teams');
  return {
    schemaVersion: 1, page: expectedPage,
    league: { id: uuid(league.id, 'league id'), slug: leagueSlug, name: string(league.name, 'league name') },
    seasons, selectedSeason, divisions, teams,
  };
}

function positioning(value: unknown, selectedSeason: PageSeason | null, teams: PageTeam[]): PositioningData | null {
  if (value === null) return null;
  const raw = record(value, 'positioning');
  exact(raw, ['seasonId', 'totalTeams', 'attendanceSource', 'teams'], 'positioning');
  if (raw.attendanceSource !== 'confirmed-plus-fallback-roster-appearances') throw new TypeError('Invalid positioning attendance source');
  const metrics = ['overall', 'offense', 'defense', 'scoringDepth', 'commitment'] as const;
  const knownTeamIds = new Set(teams.map((entry) => entry.id));
  const decodedTeams = rows(raw.teams, 'positioning teams', 5000).map((value, index) => {
    const row = record(value, `positioning team ${index}`);
    exact(row, ['teamId', 'teamName', 'teamSlug', 'logoUrl', 'primaryColor', 'divisionId', 'metrics'], `positioning team ${index}`);
    const metricRecord = record(row.metrics, `positioning team ${index} metrics`);
    exact(metricRecord, [...metrics], `positioning team ${index} metrics`);
    const decodedMetrics = Object.fromEntries(metrics.map((key) => {
      const metric = record(metricRecord[key], `${key} metric`);
      exact(metric, ['rank', 'value', 'valueLabel'], `${key} metric`);
      return [key, { rank: finite(metric.rank, `${key} rank`, true), value: finite(metric.value, `${key} value`), valueLabel: string(metric.valueLabel, `${key} value label`) }];
    })) as Record<PositionMetric, PositionMetricValue>;
    const teamId = uuid(row.teamId, 'positioning team id');
    if (!knownTeamIds.has(teamId)) throw new TypeError('Positioning references unknown team');
    const primaryColor = string(row.primaryColor, 'positioning primary color', 64);
    return {
      teamId, teamName: string(row.teamName, 'positioning team name'), teamSlug: string(row.teamSlug, 'positioning team slug', 100),
      logoUrl: nullableString(row.logoUrl, 'positioning logo URL'), primaryColor,
      divisionId: row.divisionId === null ? null : uuid(row.divisionId, 'positioning division id'), metrics: decodedMetrics,
    };
  });
  unique(decodedTeams.map((entry) => entry.teamId), 'positioning team');
  const seasonId = uuid(raw.seasonId, 'positioning season id');
  if (!selectedSeason || seasonId !== selectedSeason.id) throw new TypeError('Positioning season identity mismatch');
  const totalTeams = finite(raw.totalTeams, 'positioning total teams', true);
  if (totalTeams !== decodedTeams.length) throw new TypeError('Positioning total mismatch');
  return { seasonId, totalTeams, attendanceSource: raw.attendanceSource, teams: decodedTeams };
}

export function decodeLeaguePage(value: unknown, expectedPage: LeaguePageKind, expectedSlug: string): LeaguePageResponse {
  const raw = record(value, 'league page payload');
  const pageKeys: Record<LeaguePageKind, string[]> = {
    teams: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'positioning'],
    players: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'players'],
    playoffs: ['schemaVersion', 'page', 'league', 'seasons', 'selectedSeason', 'divisions', 'teams', 'series', 'standings', 'previewConfig'],
  };
  exact(raw, pageKeys[expectedPage], 'league page payload');
  const base = decodeBase(raw, expectedPage, expectedSlug);
  if (expectedPage === 'teams') return { ...base, page: 'teams', positioning: positioning(raw.positioning, base.selectedSeason, base.teams) };
  if (expectedPage === 'players') {
    const knownTeams = new Map(base.teams.map((entry) => [entry.id, entry]));
    const players = rows(raw.players, 'players', 20000).map((value, index): PagePlayer => {
      const row = record(value, `player ${index}`);
      exact(row, ['id', 'fullName', 'photoUrl', 'jerseyNumber', 'position', 'leadershipRole', 'teamId', 'teamName', 'teamSlug', 'teamLogoUrl', 'divisionId'], `player ${index}`);
      const teamId = uuid(row.teamId, 'player team id');
      const canonicalTeam = knownTeams.get(teamId);
      if (!canonicalTeam) throw new TypeError('Player references unknown team');
      const decoded = {
        id: uuid(row.id, 'player id'), fullName: string(row.fullName, 'player full name'), photoUrl: nullableString(row.photoUrl, 'player photo URL'),
        jerseyNumber: nullableInteger(row.jerseyNumber, 'player jersey number'), position: nullableString(row.position, 'player position', 80),
        leadershipRole: nullableString(row.leadershipRole, 'player leadership role', 80), teamId,
        teamName: string(row.teamName, 'player team name'), teamSlug: string(row.teamSlug, 'player team slug', 100),
        teamLogoUrl: nullableString(row.teamLogoUrl, 'player team logo URL'), divisionId: row.divisionId === null ? null : uuid(row.divisionId, 'player division id'),
      };
      if (decoded.teamName !== canonicalTeam.name || decoded.teamSlug !== canonicalTeam.slug
        || decoded.teamLogoUrl !== canonicalTeam.logoUrl || decoded.divisionId !== canonicalTeam.divisionId) {
        throw new TypeError('Player team metadata mismatch');
      }
      return decoded;
    });
    if (!base.selectedSeason && players.length) throw new TypeError('No-season response contains players');
    unique(players.map((entry) => `${entry.id}:${entry.teamId}`), 'player membership');
    return { ...base, page: 'players', players };
  }
  const playoffTeams = new Map(base.teams.map((entry) => [entry.id, entry]));
  const series = rows(raw.series, 'series', 5000).map((value, index): PageSeries => {
    const row = record(value, `series ${index}`);
    exact(row, ['id', 'divisionId', 'divisionName', 'roundNumber', 'seriesNumber', 'highSeed', 'lowSeed', 'highSeedWins', 'lowSeedWins', 'winnerId', 'status', 'nextGame'], `series ${index}`);
    const highSeed = seriesTeam(row.highSeed, 'high seed');
    const lowSeed = seriesTeam(row.lowSeed, 'low seed');
    const winnerId = row.winnerId === null ? null : uuid(row.winnerId, 'winner id');
    if (winnerId && winnerId !== highSeed?.id && winnerId !== lowSeed?.id) throw new TypeError('Series winner is not a participant');
    let nextGame: PageSeries['nextGame'] = null;
    if (row.nextGame !== null) {
      const game = record(row.nextGame, 'next game');
      exact(game, ['id', 'scheduledAt', 'location'], 'next game');
      const scheduledAt = string(game.scheduledAt, 'next game time', 50);
      if (!Number.isFinite(Date.parse(scheduledAt))) throw new TypeError('Invalid next game time');
      nextGame = { id: uuid(game.id, 'next game id'), scheduledAt, location: nullableString(game.location, 'next game location') };
    }
    const divisionId = row.divisionId === null ? null : uuid(row.divisionId, 'series division id');
    for (const participant of [highSeed, lowSeed]) {
      if (!participant) continue;
      const canonicalTeam = playoffTeams.get(participant.id);
      if (!canonicalTeam) throw new TypeError('Series references unknown team');
      if (participant.name !== canonicalTeam.name || participant.logoUrl !== canonicalTeam.logoUrl
        || (divisionId && canonicalTeam.divisionId !== divisionId)) throw new TypeError('Series team metadata mismatch');
    }
    return {
      id: uuid(row.id, 'series id'), divisionId,
      divisionName: nullableString(row.divisionName, 'series division name'), roundNumber: finite(row.roundNumber, 'round number', true),
      seriesNumber: finite(row.seriesNumber, 'series number', true), highSeed, lowSeed,
      highSeedWins: finite(row.highSeedWins, 'high seed wins', true), lowSeedWins: finite(row.lowSeedWins, 'low seed wins', true),
      winnerId, status: string(row.status, 'series status', 40), nextGame,
    };
  });
  unique(series.map((entry) => entry.id), 'series');
  const standings = rows(raw.standings, 'standings', 5000).map((value, index): PageStanding => {
    const row = record(value, `standing ${index}`);
    exact(row, ['teamId', 'teamName', 'logoUrl', 'points', 'divisionId', 'divisionName'], `standing ${index}`);
    const decoded = {
      teamId: uuid(row.teamId, 'standing team id'), teamName: string(row.teamName, 'standing team name'),
      logoUrl: nullableString(row.logoUrl, 'standing logo URL'), points: finite(row.points, 'standing points'),
      divisionId: row.divisionId === null ? null : uuid(row.divisionId, 'standing division id'), divisionName: nullableString(row.divisionName, 'standing division name'),
    };
    const canonicalTeam = playoffTeams.get(decoded.teamId);
    if (!canonicalTeam) throw new TypeError('Standing references unknown team');
    if (decoded.teamName !== canonicalTeam.name || decoded.logoUrl !== canonicalTeam.logoUrl || decoded.divisionId !== canonicalTeam.divisionId) {
      throw new TypeError('Standing team metadata mismatch');
    }
    return decoded;
  });
  unique(standings.map((entry) => entry.teamId), 'standing team');
  const config = record(raw.previewConfig, 'preview config');
  exact(config, ['playoffTeamsTotal', 'playoffTeamsPerDivision', 'useDivisionPlayoffs'], 'preview config');
  const useDivisionPlayoffs = config.useDivisionPlayoffs;
  if (useDivisionPlayoffs !== null && typeof useDivisionPlayoffs !== 'boolean') throw new TypeError('Invalid division playoff flag');
  if (!base.selectedSeason && (series.length || standings.length)) throw new TypeError('No-season response contains playoff rows');
  return {
    ...base, page: 'playoffs', series, standings,
    previewConfig: {
      playoffTeamsTotal: nullableInteger(config.playoffTeamsTotal, 'playoff team total'),
      playoffTeamsPerDivision: nullableInteger(config.playoffTeamsPerDivision, 'playoff teams per division'),
      useDivisionPlayoffs,
    },
  };
}

function byteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export async function getLeaguePage<P extends LeaguePageKind>(
  leagueSlug: string,
  page: P,
  seasonId: string | null = null,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8000,
): Promise<Extract<LeaguePageResponse, { page: P }>> {
  if (!SLUG.test(leagueSlug) || leagueSlug.length > 63) throw new TypeError('Invalid league slug');
  if (!['teams', 'players', 'playoffs'].includes(page)) throw new TypeError('Invalid league page');
  if (seasonId !== null) uuid(seasonId, 'season id');
  const query = new URLSearchParams({ leagueSlug, page });
  if (seasonId) query.set('seasonId', seasonId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.beerleaguehockey.ca/api/public/league-pages?${query}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    const body = await response.text();
    if (byteLength(body) > MAX_BYTES) throw new TypeError('League page payload exceeds byte limit');
    if (!response.ok) {
      let message = `League page endpoint returned ${response.status}`;
      try {
        const failure = record(JSON.parse(body), 'error response');
        const detail = record(failure.error, 'error detail');
        if (typeof detail.message === 'string' && detail.message) message = detail.message;
      } catch { /* retain bounded status message */ }
      throw new Error(message);
    }
    const decoded = decodeLeaguePage(JSON.parse(body), page, leagueSlug) as Extract<LeaguePageResponse, { page: P }>;
    if (seasonId && decoded.selectedSeason?.id !== seasonId) throw new TypeError('League page season identity mismatch');
    return decoded;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('League page request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
