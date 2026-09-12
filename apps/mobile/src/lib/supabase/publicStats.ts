const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 256 * 1024;
const MAX_NUMBER = 10_000_000;
const MAX_LEAGUES = 100;

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
