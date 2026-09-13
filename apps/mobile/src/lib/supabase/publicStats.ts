const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 256 * 1024;
const MAX_NUMBER = 10_000_000;
const MAX_LEAGUES = 100;

export const PUBLIC_METRIC_STATES = ['verified', 'recorded', 'reported', 'estimated', 'unknown', 'conflicted'] as const;
export const PUBLIC_METRIC_SOURCES = [
  'attendance', 'skater_stats', 'goalie_stats', 'goalie_assignment', 'roster_window',
  'accepted_sub', 'imported', 'override', 'capture_confirmation',
] as const;
export type PublicMetricState = (typeof PUBLIC_METRIC_STATES)[number];
export type PublicMetricSource = (typeof PUBLIC_METRIC_SOURCES)[number];
export type PublicStatMetric<T extends number = number> = {
  value: T | null;
  state: PublicMetricState;
  sources: PublicMetricSource[];
  candidates?: { confirmed?: number; recorded?: number; estimated?: number };
};
export type PublicMetricDisplay = { value: string; hint: string };
export type PublicTeamRef = { id: string; name: string };
export type PublicGoalieMetrics = {
  gamesPlayed: PublicStatMetric; wins: PublicStatMetric; losses: PublicStatMetric;
  saves: PublicStatMetric; goalsAgainst: PublicStatMetric; savePercentage: PublicStatMetric;
  goalsAgainstAverage: PublicStatMetric; shutouts: PublicStatMetric;
};
export type PublicSeasonPlayer = {
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  displayTeam: PublicTeamRef | null;
  teams: PublicTeamRef[];
  roles: Array<'skater' | 'goalie'>;
  metrics: {
    gamesPlayed: PublicStatMetric; goals: PublicStatMetric; assists: PublicStatMetric;
    points: PublicStatMetric; penaltyMinutes: PublicStatMetric;
  };
  goalie: PublicGoalieMetrics | null;
};
export type PublicSeasonStats = {
  schemaVersion: 2;
  leagueId: string;
  leagueSlug: string;
  presentationSeason: { id: string; name: string; league_id: string; status: string | null };
  divisionId: string | null;
  players: PublicSeasonPlayer[];
  coverage: { participation: PublicMetricState[]; penalties: PublicMetricState[]; goalies: PublicMetricState[] };
};
export type PublicGoalieV2 = {
  playerId: string; playerName: string; avatarUrl: string | null;
  displayTeam: PublicTeamRef | null; teams: PublicTeamRef[]; metrics: PublicGoalieMetrics;
};
export type PublicGoaliesV2 = {
  schemaVersion: 2; leagueId: string; leagueSlug: string;
  presentationSeason: PublicSeasonStats['presentationSeason']; divisionId: string | null;
  goalies: PublicGoalieV2[]; coverage: { goalies: PublicMetricState[] };
};
export type CareerSeasonV2 = {
  seasonId: string | null; sourceId: string | null; seasonName: string; sortDate: string | null;
  teams: PublicTeamRef[]; roles: Array<'skater' | 'goalie'>; metrics: PublicSeasonPlayer['metrics'];
  goalie: PublicGoalieMetrics | null;
};
export type PublicCareerV2 = {
  schemaVersion: 2; leagueId: string; leagueSlug: string;
  player: { id: string; name: string; avatarUrl: string | null };
  totals: { roles: Array<'skater' | 'goalie'>; metrics: PublicSeasonPlayer['metrics']; goalie: PublicGoalieMetrics | null };
  seasons: CareerSeasonV2[];
};
export type CanonicalCareerV2 = {
  player: PublicCareerV2['player'] | null;
  totals: PublicCareerV2['totals'];
  leagues: Array<PublicLeagueSeed & { seasonCount: number; seasons: CareerSeasonV2[] }>;
};

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export type PublicLeagueSeed = { id: string; name: string; slug: string };
export type PublicGoalie = {
  player_id: string; player_name: string; team_id: string | null; team_name: string; avatar_url: string | null;
  games_played: number; wins: number; losses: number; save_percentage: number | null;
  goals_against_average: number | null; shutouts: number; saves: number | null; goals_against: number; estimated: boolean;
};
export type PublicGoalies = {
  leagueId: string; leagueSlug: string; presentationSeason: { id: string; name: string; league_id: string; status: string | null } | null;
  divisionId: string | null; source: 'recorded' | 'estimated' | 'empty'; goalies: PublicGoalie[];
};
export type CareerSeason = {
  seasonId: string | null; sourceId?: string; seasonName: string; teamId: string | null; teamName: string | null; sortDate: string | null;
  gamesPlayed: number; goals: number; assists: number; points: number; penaltyMinutes: number | null; source: 'recorded' | 'imported';
};
export type CanonicalCareer = {
  player: { id: string; name: string; avatarUrl: string | null } | null;
  totals: { gamesPlayed: number; goals: number; assists: number; points: number; penaltyMinutes: number | null };
  leagues: Array<PublicLeagueSeed & { seasonCount: number; seasons: CareerSeason[] }>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`Invalid ${label}`);
  return value;
}
function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label, 2048);
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 36);
  if (!UUID.test(result)) throw new TypeError(`Invalid ${label}`);
  return result;
}
function number(value: unknown, label: string, maximum = MAX_NUMBER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw new TypeError(`Invalid ${label}`);
  return value;
}
function integer(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isInteger(result)) throw new TypeError(`Invalid ${label}`);
  return result;
}
function nullableNumber(value: unknown, label: string, maximum = MAX_NUMBER): number | null {
  return value === null ? null : number(value, label, maximum);
}
function validateInputs(slug: string, leagueId: string) {
  if (!SLUG.test(slug) || slug.length > 63) throw new TypeError('Invalid league slug');
  id(leagueId, 'league id');
}
function unique(keys: string[], label: string) {
  if (new Set(keys).size !== keys.length) throw new TypeError(`Duplicate ${label}`);
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Invalid ${label} shape`);
  }
}

function exactOptionalKeys(value: Record<string, unknown>, required: string[], optional: string[], label: string) {
  const actual = Object.keys(value);
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new TypeError(`Invalid ${label} shape`);
  }
}

function publicMetric(value: unknown, label: string): PublicStatMetric {
  const raw = object(value, label);
  exactOptionalKeys(raw, ['value', 'state', 'sources'], ['candidates'], label);
  if (!PUBLIC_METRIC_STATES.includes(raw.state as PublicMetricState)) throw new TypeError(`Invalid ${label} state`);
  const state = raw.state as PublicMetricState;
  if (!Array.isArray(raw.sources) || raw.sources.length > PUBLIC_METRIC_SOURCES.length) throw new TypeError(`Invalid ${label} sources`);
  const sources = raw.sources.map((source) => {
    if (!PUBLIC_METRIC_SOURCES.includes(source as PublicMetricSource)) throw new TypeError(`Invalid ${label} source`);
    return source as PublicMetricSource;
  });
  unique(sources, `${label} source`);
  const metricValue = raw.value === null ? null : number(raw.value, `${label} value`);
  if ((state === 'unknown' || state === 'conflicted') && metricValue !== null) throw new TypeError(`Invalid ${label} ${state} metric value`);
  if (state !== 'unknown' && state !== 'conflicted' && metricValue === null) throw new TypeError(`Invalid ${label} ${state} metric value`);
  let candidates: PublicStatMetric['candidates'];
  if (raw.candidates !== undefined) {
    const candidate = object(raw.candidates, `${label} candidates`);
    exactOptionalKeys(candidate, [], ['confirmed', 'recorded', 'estimated'], `${label} candidates`);
    candidates = {};
    for (const key of ['confirmed', 'recorded', 'estimated'] as const) {
      if (candidate[key] !== undefined) candidates[key] = integer(candidate[key], `${label} ${key} candidate`);
    }
    if (Object.keys(candidates).length === 0) throw new TypeError(`Invalid ${label} candidates`);
  }
  return { value: metricValue, state, sources, ...(candidates ? { candidates } : {}) };
}

function publicTeam(value: unknown, label: string): PublicTeamRef {
  const raw = object(value, label);
  exactKeys(raw, ['id', 'name'], label);
  return { id: id(raw.id, `${label} id`), name: text(raw.name, `${label} name`) };
}

function publicGoalieMetrics(value: unknown, label: string): PublicGoalieMetrics {
  const raw = object(value, label);
  const keys = ['gamesPlayed', 'wins', 'losses', 'saves', 'goalsAgainst', 'savePercentage', 'goalsAgainstAverage', 'shutouts'];
  exactKeys(raw, keys, label);
  const result = Object.fromEntries(keys.map((key) => [key, publicMetric(raw[key], `${label} ${key}`)])) as PublicGoalieMetrics;
  if (result.gamesPlayed.value !== null && result.wins.value !== null && result.losses.value !== null
    && result.wins.value + result.losses.value > result.gamesPlayed.value) throw new TypeError(`Invalid ${label} game reconciliation`);
  return result;
}

function metricHint(metric: PublicStatMetric): string {
  if (metric.state === 'conflicted') return 'Conflicting records need review.';
  if (metric.state === 'unknown') return 'Not recorded.';
  if (metric.state === 'estimated') {
    if (metric.sources.includes('roster_window')) return 'Estimated from roster eligibility.';
    if (metric.sources.includes('accepted_sub')) return 'Estimated from accepted substitute records.';
    return 'Estimated.';
  }
  if (metric.state === 'verified') return 'Verified.';
  if (metric.state === 'reported') return metric.sources.includes('imported')
    ? 'Reported from imported records.' : 'Reported.';
  if (metric.sources.includes('skater_stats')) return 'Recorded from game statistics.';
  if (metric.sources.includes('goalie_stats')) return 'Recorded from goalie statistics.';
  if (metric.sources.includes('goalie_assignment')) return 'Recorded from goalie assignments.';
  return 'Recorded.';
}

export function formatPublicMetric(metric: PublicStatMetric, digits?: number): PublicMetricDisplay {
  const hint = metricHint(metric);
  if (metric.state === 'conflicted') return { value: 'Needs review', hint };
  if (metric.value === null) return { value: '—', hint };
  const rendered = digits === undefined ? String(metric.value) : metric.value.toFixed(digits);
  return { value: `${metric.state === 'estimated' ? '~' : ''}${rendered}`, hint };
}
function byteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
async function publicJson(path: string, fetchImpl: FetchLike, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(path, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Public stats endpoint returned ${response.status}`);
    const body = await response.text();
    if (byteLength(body) > MAX_BYTES) throw new TypeError('Public stats payload exceeds byte limit');
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Public stats request timed out (timeout)');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPublicGoalies(
  slug: string, leagueId: string, seasonId: string | null = null, divisionId: string | null = null,
  fetchImpl: FetchLike = fetch, timeoutMs = 8000,
): Promise<PublicGoalies> {
  validateInputs(slug, leagueId);
  if (seasonId !== null) id(seasonId, 'season id');
  if (divisionId !== null) id(divisionId, 'division id');
  const query = new URLSearchParams({ leagueSlug: slug });
  if (seasonId) query.set('seasonId', seasonId);
  if (divisionId) query.set('divisionId', divisionId);
  const raw = object(await publicJson(`https://${slug}.beerleaguehockey.ca/api/public/goalies?${query}`, fetchImpl, timeoutMs), 'goalie payload');
  if (raw.schemaVersion !== 1) throw new TypeError('Invalid goalie schema version');
  if (raw.leagueId !== leagueId || raw.leagueSlug !== slug) throw new TypeError('Goalie response identity mismatch');
  const responseDivision = raw.divisionId === null ? null : id(raw.divisionId, 'response division id');
  if (responseDivision !== divisionId) throw new TypeError('Goalie division identity mismatch');
  const source = raw.source;
  if (source !== 'recorded' && source !== 'estimated' && source !== 'empty') throw new TypeError('Invalid goalie source');
  let presentationSeason: PublicGoalies['presentationSeason'] = null;
  if (raw.presentationSeason !== null) {
    const season = object(raw.presentationSeason, 'presentation season');
    presentationSeason = { id: id(season.id, 'presentation season id'), name: text(season.name, 'season name'),
      league_id: id(season.league_id, 'season league id'), status: season.status === null ? null : text(season.status, 'season status', 40) };
    if (presentationSeason.league_id !== leagueId || (seasonId && presentationSeason.id !== seasonId)) throw new TypeError('Goalie season identity mismatch');
  }
  if (seasonId && !presentationSeason) throw new TypeError('Goalie season identity mismatch');
  if (!Array.isArray(raw.goalies) || raw.goalies.length > 200) throw new TypeError('Invalid goalie row bound');
  const goalies = raw.goalies.map((value, index): PublicGoalie => {
    const row = object(value, `goalie ${index}`);
    const estimated = row.estimated;
    if (typeof estimated !== 'boolean') throw new TypeError('Invalid goalie estimate flag');
    if ((source === 'estimated') !== estimated) throw new TypeError('Goalie estimate provenance mismatch');
    const result = { player_id: id(row.player_id, 'goalie player id'), player_name: text(row.player_name, 'goalie player name'),
      team_id: row.team_id === null ? null : id(row.team_id, 'goalie team id'), team_name: text(row.team_name, 'goalie team name'),
      avatar_url: nullableText(row.avatar_url, 'goalie avatar'), games_played: integer(row.games_played, 'games played'),
      wins: integer(row.wins, 'wins'), losses: integer(row.losses, 'losses'),
      save_percentage: nullableNumber(row.save_percentage, 'save percentage', 100),
      goals_against_average: nullableNumber(row.goals_against_average, 'goals against average'),
      shutouts: integer(row.shutouts, 'shutouts'), saves: row.saves === null ? null : integer(row.saves, 'saves'),
      goals_against: integer(row.goals_against, 'goals against'), estimated };
    if (result.wins + result.losses > result.games_played || result.shutouts > result.games_played) {
      throw new TypeError('Invalid goalie game reconciliation');
    }
    if (result.save_percentage !== null) {
      if (result.saves === null || result.saves + result.goals_against === 0) throw new TypeError('Invalid goalie save reconciliation');
      const expected = Math.round((result.saves / (result.saves + result.goals_against)) * 1000) / 10;
      if (Math.abs(result.save_percentage - expected) > 0.0500001) throw new TypeError('Invalid goalie save reconciliation');
    }
    if (result.goals_against_average !== null) {
      if (result.games_played === 0) throw new TypeError('Invalid goalie GAA reconciliation');
      const expected = Math.round((result.goals_against / result.games_played) * 100) / 100;
      if (Math.abs(result.goals_against_average - expected) > 0.0050001) throw new TypeError('Invalid goalie GAA reconciliation');
    }
    return result;
  });
  if ((!presentationSeason || source === 'empty') && goalies.length) throw new TypeError('Empty goalie scope contains rows');
  if (goalies.length === 0 && source !== 'empty') throw new TypeError('Empty goalie rows require empty source');
  unique(goalies.map((row) => `${row.player_id}:${row.team_id}`), 'goalie row');
  return { leagueId, leagueSlug: slug, presentationSeason, divisionId: responseDivision, source,
    goalies: goalies.map((row) => ({ ...row, save_percentage: row.save_percentage === null ? null : row.save_percentage / 100 })) };
}

export async function getPublicPlayerCareer(slug: string, leagueId: string, playerId: string, fetchImpl: FetchLike = fetch, timeoutMs = 8000) {
  validateInputs(slug, leagueId);
  id(playerId, 'player id');
  const query = new URLSearchParams({ leagueSlug: slug, playerId });
  const raw = object(await publicJson(`https://${slug}.beerleaguehockey.ca/api/public/player-career?${query}`, fetchImpl, timeoutMs), 'career payload');
  return validateCareer(raw, { id: leagueId, name: '', slug }, playerId);
}

function validateCareer(rawValue: unknown, league: PublicLeagueSeed, playerId: string) {
  const raw = object(rawValue, 'career payload');
  if (raw.schemaVersion !== 1 || raw.leagueId !== league.id || raw.leagueSlug !== league.slug) throw new TypeError('Career response identity mismatch');
  const player = object(raw.player, 'career player');
  if (id(player.id, 'career player id') !== playerId) throw new TypeError('Career player identity mismatch');
  const totals = object(raw.totals, 'career totals');
  if (!Array.isArray(raw.seasons) || raw.seasons.length > 500) throw new TypeError('Invalid career row bound');
  const seasons = raw.seasons.map((value, index): CareerSeason => {
    const row = object(value, `career season ${index}`);
    if (row.source !== 'recorded' && row.source !== 'imported') throw new TypeError('Invalid career source');
    const seasonId = row.season_id === null ? null : id(row.season_id, 'career season id');
    const sourceId = seasonId === null ? id(row.source_id, 'imported source id') : undefined;
    if (seasonId === null && row.source !== 'imported') throw new TypeError('Only imported history may lack a season');
    const season: CareerSeason = { seasonId, ...(sourceId ? { sourceId } : {}), seasonName: text(row.season_name, 'career season name'),
      teamId: row.team_id === null ? null : id(row.team_id, 'career team id'), teamName: nullableText(row.team_name, 'career team name'),
      sortDate: nullableText(row.sort_date, 'career sort date'), gamesPlayed: integer(row.games_played, 'career games played'),
      goals: integer(row.goals, 'career goals'), assists: integer(row.assists, 'career assists'), points: integer(row.points, 'career points'),
      penaltyMinutes: row.penalty_minutes === null ? null : number(row.penalty_minutes, 'career penalty minutes'), source: row.source };
    if (season.goals + season.assists !== season.points) throw new TypeError('Invalid career season points reconciliation');
    return season;
  });
  unique(seasons.map((row) => `${row.seasonId ?? row.sourceId}:${row.teamId ?? ''}`), 'career row');
  const validatedTotals = { gamesPlayed: integer(totals.games_played, 'career total games'), goals: integer(totals.goals, 'career total goals'),
      assists: integer(totals.assists, 'career total assists'), points: integer(totals.points, 'career total points'),
      penaltyMinutes: totals.penalty_minutes === null ? null : number(totals.penalty_minutes, 'career total penalty minutes') };
  if (validatedTotals.goals + validatedTotals.assists !== validatedTotals.points) throw new TypeError('Invalid career total points reconciliation');
  const summed = seasons.reduce((sum, season) => ({ gamesPlayed: sum.gamesPlayed + season.gamesPlayed,
    goals: sum.goals + season.goals, assists: sum.assists + season.assists, points: sum.points + season.points }),
  { gamesPlayed: 0, goals: 0, assists: 0, points: 0 });
  if (summed.gamesPlayed !== validatedTotals.gamesPlayed || summed.goals !== validatedTotals.goals
    || summed.assists !== validatedTotals.assists || summed.points !== validatedTotals.points) {
    throw new TypeError('Invalid career total reconciliation');
  }
  const seasonPim = seasons.length === 0 || seasons.some((season) => season.penaltyMinutes === null)
    ? null : seasons.reduce((sum, season) => sum + (season.penaltyMinutes ?? 0), 0);
  if (seasonPim !== validatedTotals.penaltyMinutes) throw new TypeError('Invalid career PIM reconciliation');
  return { player: { id: playerId, name: text(player.name, 'career player name'), avatarUrl: nullableText(player.avatar_url, 'career avatar') },
    totals: validatedTotals, seasons };
}

export async function loadCanonicalCareer(playerId: string, leagueSeeds: PublicLeagueSeed[], fetchImpl: FetchLike = fetch): Promise<CanonicalCareer> {
  id(playerId, 'player id');
  const leagues = [...new Map(leagueSeeds.map((league) => [league.id, league])).values()];
  if (leagues.length > MAX_LEAGUES) throw new TypeError('Career league bound exceeded');
  leagues.forEach((league) => validateInputs(league.slug, league.id));
  const results = await Promise.all(leagues.map((league) => getPublicPlayerCareer(league.slug, league.id, playerId, fetchImpl)));
  let pim: number | null = 0;
  const totals = results.reduce((sum, result) => {
    if (result.totals.penaltyMinutes === null) pim = null;
    else if (pim !== null) pim += result.totals.penaltyMinutes;
    sum.gamesPlayed += result.totals.gamesPlayed; sum.goals += result.totals.goals;
    sum.assists += result.totals.assists; sum.points += result.totals.points;
    return sum;
  }, { gamesPlayed: 0, goals: 0, assists: 0, points: 0 });
  Object.entries(totals).forEach(([label, value]) => number(value, `aggregate ${label}`));
  if (pim !== null) number(pim, 'aggregate penalty minutes');
  return { player: results[0]?.player ?? null, totals: { ...totals, penaltyMinutes: pim },
    leagues: leagues.map((league, index) => ({ ...league, seasons: results[index].seasons,
      seasonCount: new Set(results[index].seasons.map((row) => row.seasonId).filter((value) => value !== null)).size })) };
}

export async function discoverCareerLeagues(
  playerId: string, _seeds: PublicLeagueSeed[], fetchImpl: FetchLike = fetch, timeoutMs = 8000,
): Promise<PublicLeagueSeed[]> {
  id(playerId, 'player id');
  const query = new URLSearchParams({ playerId });
  const raw = object(await publicJson(`https://api.beerleaguehockey.ca/api/public/career-leagues?${query}`, fetchImpl, timeoutMs), 'career league payload');
  exactKeys(raw, ['schemaVersion', 'playerId', 'leagues'], 'career league payload');
  if (raw.schemaVersion !== 1 || raw.playerId !== playerId) throw new TypeError('Career league response scope mismatch');
  if (!Array.isArray(raw.leagues) || raw.leagues.length > MAX_LEAGUES) throw new TypeError('Career league bound exceeded');
  const leagues = raw.leagues.map((value, index): PublicLeagueSeed => {
    const league = object(value, `career league ${index}`);
    exactKeys(league, ['id', 'name', 'slug'], `career league ${index}`);
    const result = { id: id(league.id, 'career league id'), name: text(league.name, 'career league name'),
      slug: text(league.slug, 'career league slug', 63) };
    if (!SLUG.test(result.slug) || result.slug === 'demo') throw new TypeError('Invalid career league slug');
    return result;
  });
  unique(leagues.map((league) => league.id), 'career league id');
  unique(leagues.map((league) => league.slug), 'career league slug');
  return leagues;
}

function parsePresentationSeason(value: unknown, leagueId: string, expectedSeasonId: string, label: string): PublicSeasonStats['presentationSeason'] {
  const raw = object(value, label);
  exactKeys(raw, ['id', 'name', 'league_id', 'status'], label);
  const result = {
    id: id(raw.id, `${label} id`),
    name: text(raw.name, `${label} name`),
    league_id: id(raw.league_id, `${label} league id`),
    status: raw.status === null ? null : text(raw.status, `${label} status`, 40),
  };
  if (result.id !== expectedSeasonId || result.league_id !== leagueId) throw new TypeError('Season stats response identity mismatch');
  return result;
}

function parseCoverage(value: unknown, label: string): PublicMetricState[] {
  if (!Array.isArray(value) || value.length > PUBLIC_METRIC_STATES.length) throw new TypeError(`Invalid ${label}`);
  const states = value.map((state) => {
    if (!PUBLIC_METRIC_STATES.includes(state as PublicMetricState)) throw new TypeError(`Invalid ${label}`);
    return state as PublicMetricState;
  });
  unique(states, label);
  return states;
}

export function parsePublicSeasonStatsV2(
  rawValue: unknown,
  expected: { slug: string; leagueId: string; seasonId: string; divisionId: string | null; teamId?: string | null },
): PublicSeasonStats {
  const raw = object(rawValue, 'season stats payload');
  exactKeys(raw, ['schemaVersion', 'leagueId', 'leagueSlug', 'presentationSeason', 'divisionId', 'players', 'coverage'], 'season stats payload');
  if (raw.schemaVersion !== 2) throw new TypeError('Invalid season stats schema version; contractVersion=2 is required');
  if (raw.leagueId !== expected.leagueId || raw.leagueSlug !== expected.slug) throw new TypeError('Season stats response identity mismatch');
  const divisionId = raw.divisionId === null ? null : id(raw.divisionId, 'season stats division id');
  if (divisionId !== expected.divisionId) throw new TypeError('Season stats division identity mismatch');
  const presentationSeason = parsePresentationSeason(raw.presentationSeason, expected.leagueId, expected.seasonId, 'presentation season');
  if (!Array.isArray(raw.players) || raw.players.length > 2_000) throw new TypeError('Invalid season stats player bound');
  const players = raw.players.map((value, index): PublicSeasonPlayer => {
    const row = object(value, `season stats player ${index}`);
    exactKeys(row, ['playerId', 'playerName', 'avatarUrl', 'displayTeam', 'teams', 'roles', 'metrics', 'goalie'], `season stats player ${index}`);
    if (!Array.isArray(row.teams) || row.teams.length > 100) throw new TypeError('Invalid season stats teams');
    const teams = row.teams.map((team, teamIndex) => publicTeam(team, `season stats player ${index} team ${teamIndex}`));
    unique(teams.map((team) => team.id), `season stats player ${index} team`);
    const displayTeam = row.displayTeam === null ? null : publicTeam(row.displayTeam, `season stats player ${index} display team`);
    if (displayTeam && !teams.some((team) => team.id === displayTeam.id && team.name === displayTeam.name)) throw new TypeError('Season stats display team is outside player teams');
    if (!Array.isArray(row.roles) || row.roles.length === 0 || row.roles.length > 2
      || row.roles.some((role) => role !== 'skater' && role !== 'goalie')) throw new TypeError('Invalid season stats roles');
    const roles = row.roles as Array<'skater' | 'goalie'>;
    unique(roles, `season stats player ${index} role`);
    const metricsRaw = object(row.metrics, `season stats player ${index} metrics`);
    const metricKeys = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes'];
    exactKeys(metricsRaw, metricKeys, `season stats player ${index} metrics`);
    const metrics = Object.fromEntries(metricKeys.map((key) => [key, publicMetric(metricsRaw[key], `season stats player ${index} ${key}`)])) as PublicSeasonPlayer['metrics'];
    if (metrics.goals.value !== null && metrics.assists.value !== null && metrics.points.value !== metrics.goals.value + metrics.assists.value) {
      throw new TypeError('Invalid season stats points reconciliation');
    }
    const goalie = row.goalie === null ? null : publicGoalieMetrics(row.goalie, `season stats player ${index} goalie`);
    if ((goalie !== null) !== roles.includes('goalie')) throw new TypeError('Season stats goalie role mismatch');
    return {
      playerId: id(row.playerId, 'season stats player id'),
      playerName: text(row.playerName, 'season stats player name'),
      avatarUrl: nullableText(row.avatarUrl, 'season stats avatar'), displayTeam, teams, roles, metrics, goalie,
    };
  });
  unique(players.map((player) => player.playerId), 'season stats player');
  if (expected.teamId && players.some((player) => player.teams.length !== 1
    || player.teams[0].id !== expected.teamId
    || (player.displayTeam !== null && player.displayTeam.id !== expected.teamId))) {
    throw new TypeError('Season stats team scope mismatch');
  }
  const coverageRaw = object(raw.coverage, 'season stats coverage');
  exactKeys(coverageRaw, ['participation', 'penalties', 'goalies'], 'season stats coverage');
  return {
    schemaVersion: 2, leagueId: expected.leagueId, leagueSlug: expected.slug, presentationSeason, divisionId,
    players,
    coverage: {
      participation: parseCoverage(coverageRaw.participation, 'participation coverage'),
      penalties: parseCoverage(coverageRaw.penalties, 'penalty coverage'),
      goalies: parseCoverage(coverageRaw.goalies, 'goalie coverage'),
    },
  };
}

export async function getPublicSeasonStats(
  slug: string,
  leagueId: string,
  seasonId: string,
  divisionId: string | null = null,
  teamId: string | null = null,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8000,
): Promise<PublicSeasonStats> {
  validateInputs(slug, leagueId);
  id(seasonId, 'season id');
  if (divisionId !== null) id(divisionId, 'division id');
  if (teamId !== null) id(teamId, 'team id');
  const query = new URLSearchParams({ leagueSlug: slug, seasonId, contractVersion: '2' });
  if (divisionId) query.set('divisionId', divisionId);
  if (teamId) query.set('teamId', teamId);
  const raw = await publicJson(`https://${slug}.beerleaguehockey.ca/api/public/season-stats?${query}`, fetchImpl, timeoutMs);
  return parsePublicSeasonStatsV2(raw, { slug, leagueId, seasonId, divisionId, teamId });
}

export function toPlayerStatRows(
  payload: PublicSeasonStats,
  metric: 'points' | 'goals' | 'assists' | 'penalty_minutes',
  limit = 20,
) {
  const metricKey = metric === 'penalty_minutes' ? 'penaltyMinutes' : metric;
  return payload.players
    .filter((player) => player.roles.includes('skater') && player.metrics[metricKey].value !== null)
    .map((player) => ({
      player_id: player.playerId,
      player_name: player.playerName,
      team_id: player.displayTeam?.id ?? '',
      team_name: player.displayTeam?.name ?? 'Unknown team',
      team_short_name: player.displayTeam?.name ?? 'Unknown team',
      position: null,
      is_goalie: false,
      jersey_number: null,
      goals: player.metrics.goals.value,
      assists: player.metrics.assists.value,
      points: player.metrics.points.value,
      plus_minus: 0,
      games_played: player.metrics.gamesPlayed.value,
      games_played_state: player.metrics.gamesPlayed.state,
      penalty_minutes: player.metrics.penaltyMinutes.value,
      penalty_minutes_state: player.metrics.penaltyMinutes.state,
      avatar_url: player.avatarUrl,
      metrics: player.metrics,
    }))
    .sort((left, right) => {
      const primary = (right[metric] ?? -Infinity) - (left[metric] ?? -Infinity);
      return primary || (right.points ?? -Infinity) - (left.points ?? -Infinity)
        || (right.goals ?? -Infinity) - (left.goals ?? -Infinity)
        || left.player_name.localeCompare(right.player_name) || left.player_id.localeCompare(right.player_id);
    })
    .slice(0, Math.max(0, limit));
}

function parseRoles(value: unknown, label: string): Array<'skater' | 'goalie'> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2
    || value.some((role) => role !== 'skater' && role !== 'goalie')) throw new TypeError(`Invalid ${label}`);
  const roles = value as Array<'skater' | 'goalie'>;
  unique(roles, label);
  return roles;
}

function parseSkaterMetrics(value: unknown, label: string): PublicSeasonPlayer['metrics'] {
  const raw = object(value, label);
  const keys = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes'];
  exactKeys(raw, keys, label);
  const metrics = Object.fromEntries(keys.map((key) => [key, publicMetric(raw[key], `${label} ${key}`)])) as PublicSeasonPlayer['metrics'];
  if (metrics.goals.value !== null && metrics.assists.value !== null && metrics.points.value !== metrics.goals.value + metrics.assists.value) {
    throw new TypeError(`Invalid ${label} points reconciliation`);
  }
  return metrics;
}

export function parsePublicGoaliesV2(
  rawValue: unknown,
  expected: { slug: string; leagueId: string; seasonId: string; divisionId: string | null },
): PublicGoaliesV2 {
  const raw = object(rawValue, 'goalies v2 payload');
  exactKeys(raw, ['schemaVersion', 'leagueId', 'leagueSlug', 'presentationSeason', 'divisionId', 'goalies', 'coverage'], 'goalies v2 payload');
  if (raw.schemaVersion !== 2) throw new TypeError('Invalid goalie schema version; contractVersion=2 is required');
  if (raw.leagueId !== expected.leagueId || raw.leagueSlug !== expected.slug) throw new TypeError('Goalie response identity mismatch');
  const divisionId = raw.divisionId === null ? null : id(raw.divisionId, 'goalie division id');
  if (divisionId !== expected.divisionId) throw new TypeError('Goalie division identity mismatch');
  const presentationSeason = parsePresentationSeason(raw.presentationSeason, expected.leagueId, expected.seasonId, 'goalie presentation season');
  if (!Array.isArray(raw.goalies) || raw.goalies.length > 200) throw new TypeError('Invalid goalie row bound');
  const goalies = raw.goalies.map((value, index): PublicGoalieV2 => {
    const row = object(value, `goalie ${index}`);
    exactKeys(row, ['playerId', 'playerName', 'avatarUrl', 'displayTeam', 'teams', 'metrics'], `goalie ${index}`);
    if (!Array.isArray(row.teams) || row.teams.length > 100) throw new TypeError(`Invalid goalie ${index} teams`);
    const teams = row.teams.map((team, teamIndex) => publicTeam(team, `goalie ${index} team ${teamIndex}`));
    unique(teams.map((team) => team.id), `goalie ${index} team`);
    const displayTeam = row.displayTeam === null ? null : publicTeam(row.displayTeam, `goalie ${index} display team`);
    if (displayTeam && !teams.some((team) => team.id === displayTeam.id && team.name === displayTeam.name)) throw new TypeError('Goalie display team is outside teams');
    return {
      playerId: id(row.playerId, 'goalie player id'), playerName: text(row.playerName, 'goalie player name'),
      avatarUrl: nullableText(row.avatarUrl, 'goalie avatar'), displayTeam, teams,
      metrics: publicGoalieMetrics(row.metrics, `goalie ${index} metrics`),
    };
  });
  unique(goalies.map((goalie) => goalie.playerId), 'goalie player');
  const coverage = object(raw.coverage, 'goalie coverage');
  exactKeys(coverage, ['goalies'], 'goalie coverage');
  return { schemaVersion: 2, leagueId: expected.leagueId, leagueSlug: expected.slug, presentationSeason, divisionId,
    goalies, coverage: { goalies: parseCoverage(coverage.goalies, 'goalie coverage') } };
}

export async function getPublicGoaliesV2(
  slug: string, leagueId: string, seasonId: string, divisionId: string | null = null,
  fetchImpl: FetchLike = fetch, timeoutMs = 8000,
): Promise<PublicGoaliesV2> {
  validateInputs(slug, leagueId); id(seasonId, 'season id');
  if (divisionId !== null) id(divisionId, 'division id');
  const query = new URLSearchParams({ leagueSlug: slug, seasonId, contractVersion: '2' });
  if (divisionId) query.set('divisionId', divisionId);
  const raw = await publicJson(`https://${slug}.beerleaguehockey.ca/api/public/goalies?${query}`, fetchImpl, timeoutMs);
  return parsePublicGoaliesV2(raw, { slug, leagueId, seasonId, divisionId });
}

function parseCareerV2Row(value: unknown, label: string): CareerSeasonV2 {
  const row = object(value, label);
  exactKeys(row, ['seasonId', 'sourceId', 'seasonName', 'sortDate', 'teams', 'roles', 'metrics', 'goalie'], label);
  const seasonId = row.seasonId === null ? null : id(row.seasonId, `${label} season id`);
  const sourceId = row.sourceId === null ? null : id(row.sourceId, `${label} source id`);
  if ((seasonId === null) === (sourceId === null)) throw new TypeError(`Invalid ${label} season/source identity`);
  if (!Array.isArray(row.teams) || row.teams.length > 100) throw new TypeError(`Invalid ${label} teams`);
  const teams = row.teams.map((team, index) => publicTeam(team, `${label} team ${index}`));
  unique(teams.map((team) => team.id), `${label} team`);
  const roles = parseRoles(row.roles, `${label} roles`);
  const goalie = row.goalie === null ? null : publicGoalieMetrics(row.goalie, `${label} goalie`);
  if ((goalie !== null) !== roles.includes('goalie')) throw new TypeError(`${label} goalie role mismatch`);
  return { seasonId, sourceId, seasonName: text(row.seasonName, `${label} season name`),
    sortDate: nullableText(row.sortDate, `${label} sort date`), teams, roles,
    metrics: parseSkaterMetrics(row.metrics, `${label} metrics`), goalie };
}

export function parsePublicCareerV2(rawValue: unknown, expected: { slug: string; leagueId: string; playerId: string }): PublicCareerV2 {
  const raw = object(rawValue, 'career v2 payload');
  exactKeys(raw, ['schemaVersion', 'leagueId', 'leagueSlug', 'player', 'totals', 'seasons'], 'career v2 payload');
  if (raw.schemaVersion !== 2) throw new TypeError('Invalid career schema version; contractVersion=2 is required');
  if (raw.leagueId !== expected.leagueId || raw.leagueSlug !== expected.slug) throw new TypeError('Career response identity mismatch');
  const playerRaw = object(raw.player, 'career player');
  exactKeys(playerRaw, ['id', 'name', 'avatarUrl'], 'career player');
  if (id(playerRaw.id, 'career player id') !== expected.playerId) throw new TypeError('Career player identity mismatch');
  const totalsRaw = object(raw.totals, 'career totals');
  exactKeys(totalsRaw, ['roles', 'metrics', 'goalie'], 'career totals');
  const roles = parseRoles(totalsRaw.roles, 'career total roles');
  const goalie = totalsRaw.goalie === null ? null : publicGoalieMetrics(totalsRaw.goalie, 'career total goalie');
  if ((goalie !== null) !== roles.includes('goalie')) throw new TypeError('Career total goalie role mismatch');
  if (!Array.isArray(raw.seasons) || raw.seasons.length > 500) throw new TypeError('Invalid career row bound');
  const seasons = raw.seasons.map((row, index) => parseCareerV2Row(row, `career season ${index}`));
  unique(seasons.map((row) => `${row.seasonId ?? row.sourceId}`), 'career season');
  return { schemaVersion: 2, leagueId: expected.leagueId, leagueSlug: expected.slug,
    player: { id: expected.playerId, name: text(playerRaw.name, 'career player name'), avatarUrl: nullableText(playerRaw.avatarUrl, 'career avatar') },
    totals: { roles, metrics: parseSkaterMetrics(totalsRaw.metrics, 'career total metrics'), goalie }, seasons };
}

export async function getPublicPlayerCareerV2(
  slug: string, leagueId: string, playerId: string, fetchImpl: FetchLike = fetch, timeoutMs = 8000,
): Promise<PublicCareerV2> {
  validateInputs(slug, leagueId); id(playerId, 'player id');
  const query = new URLSearchParams({ leagueSlug: slug, playerId, contractVersion: '2' });
  const raw = await publicJson(`https://${slug}.beerleaguehockey.ca/api/public/player-career?${query}`, fetchImpl, timeoutMs);
  return parsePublicCareerV2(raw, { slug, leagueId, playerId });
}

function combineMetrics(metrics: PublicStatMetric[]): PublicStatMetric {
  if (metrics.length === 0) return { value: null, state: 'unknown', sources: [] };
  const sources = Array.from(new Set(metrics.flatMap((metric) => metric.sources)));
  const conflicted = metrics.some((metric) => metric.state === 'conflicted');
  if (conflicted) return { value: null, state: 'conflicted', sources };
  const unknown = metrics.some((metric) => metric.state === 'unknown' || metric.value === null);
  if (unknown) return { value: null, state: 'unknown', sources };
  const certainty: PublicMetricState[] = ['verified', 'recorded', 'reported', 'estimated'];
  const state = metrics.reduce((weakest, metric) => certainty.indexOf(metric.state) > certainty.indexOf(weakest) ? metric.state : weakest, 'verified' as PublicMetricState);
  return { value: metrics.reduce((sum, metric) => sum + (metric.value ?? 0), 0), state, sources };
}

function deriveGoalieRate(
  goalies: PublicGoalieMetrics[],
  rate: 'savePercentage' | 'goalsAgainstAverage',
): PublicStatMetric {
  const inputs = rate === 'savePercentage'
    ? goalies.flatMap((goalie) => [goalie.saves, goalie.goalsAgainst])
    : goalies.flatMap((goalie) => [goalie.goalsAgainst, goalie.gamesPlayed]);
  const sources = Array.from(new Set(inputs.flatMap((metric) => metric.sources)));
  if (inputs.some((metric) => metric.state === 'conflicted')) return { value: null, state: 'conflicted', sources };
  if (inputs.some((metric) => metric.state === 'unknown' || metric.value === null)) return { value: null, state: 'unknown', sources };
  const certainty: PublicMetricState[] = ['verified', 'recorded', 'reported', 'estimated'];
  const state = inputs.reduce((weakest, metric) => certainty.indexOf(metric.state) > certainty.indexOf(weakest) ? metric.state : weakest, 'verified' as PublicMetricState);
  const saves = goalies.reduce((sum, goalie) => sum + (goalie.saves.value ?? 0), 0);
  const goalsAgainst = goalies.reduce((sum, goalie) => sum + (goalie.goalsAgainst.value ?? 0), 0);
  const denominator = rate === 'savePercentage'
    ? saves + goalsAgainst
    : goalies.reduce((sum, goalie) => sum + (goalie.gamesPlayed.value ?? 0), 0);
  if (denominator === 0) return { value: null, state: 'unknown', sources };
  return { value: (rate === 'savePercentage' ? saves : goalsAgainst) / denominator, state, sources };
}

export async function loadCanonicalCareerV2(
  playerId: string, leagueSeeds: PublicLeagueSeed[], fetchImpl: FetchLike = fetch,
): Promise<CanonicalCareerV2> {
  id(playerId, 'player id');
  const leagues = [...new Map(leagueSeeds.map((league) => [league.id, league])).values()];
  if (leagues.length > MAX_LEAGUES) throw new TypeError('Career league bound exceeded');
  leagues.forEach((league) => validateInputs(league.slug, league.id));
  const results = await Promise.all(leagues.map((league) => getPublicPlayerCareerV2(league.slug, league.id, playerId, fetchImpl)));
  const roles = Array.from(new Set(results.flatMap((result) => result.totals.roles))) as Array<'skater' | 'goalie'>;
  const metricKeys = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes'] as const;
  const metrics = Object.fromEntries(metricKeys.map((key) => [key, combineMetrics(results.map((result) => result.totals.metrics[key]))])) as PublicSeasonPlayer['metrics'];
  const goalieResults = results.map((result) => result.totals.goalie).filter((goalie): goalie is PublicGoalieMetrics => goalie !== null);
  const goalieKeys = ['gamesPlayed', 'wins', 'losses', 'saves', 'goalsAgainst', 'shutouts'] as const;
  let goalie: PublicGoalieMetrics | null = null;
  if (goalieResults.length > 0) {
    const combined = Object.fromEntries(goalieKeys.map((key) => [key, combineMetrics(goalieResults.map((row) => row[key]))])) as Partial<PublicGoalieMetrics>;
    goalie = {
      ...combined as Omit<PublicGoalieMetrics, 'savePercentage' | 'goalsAgainstAverage'>,
      savePercentage: goalieResults.length === 1 ? goalieResults[0].savePercentage : deriveGoalieRate(goalieResults, 'savePercentage'),
      goalsAgainstAverage: goalieResults.length === 1 ? goalieResults[0].goalsAgainstAverage : deriveGoalieRate(goalieResults, 'goalsAgainstAverage'),
    };
  }
  return {
    player: results[0]?.player ?? null,
    totals: { roles, metrics, goalie },
    leagues: leagues.map((league, index) => ({ ...league, seasons: results[index].seasons,
      seasonCount: new Set(results[index].seasons.map((row) => row.seasonId).filter((value) => value !== null)).size })),
  };
}
