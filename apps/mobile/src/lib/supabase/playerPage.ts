import { HOCKEY_LIFE_ID, HOCKEY_LIFE_SLUG } from '../../config/hockeyLife';

const ENDPOINT = 'https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 512_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export type PlayerSeason = { id: string; name: string; start_date: string | null; status: string | null };
export type PlayerMetricValues = Record<string, number | null>;
export type HockeyLifePlayerPage = {
  playerId: string; rosterId: string; fullName: string; photoUrl: string | null; position: string | null;
  leadershipRole: string | null; jerseyNumber: number | null; isGoalie: boolean;
  team: { id: string; name: string; slug: string | null; logoUrl: string | null; primaryColor: string | null } | null;
  seasons: PlayerSeason[]; selectedSeasonId: string | null; selectedSeasonName: string | null; isCareer: boolean;
  metrics: PlayerMetricValues | null;
  careerRows: Array<{ seasonId: string; seasonName: string; teamId?: string | null; teamName?: string | null; metrics: PlayerMetricValues }>;
  badges: Array<{ id: string; type: string; seasonId: string | null; seasonName: string | null; teamName: string | null; createdAt: string }>;
  games: Array<{ id: string; date: string; opponent: string | null; result: string | null; score: string | null; metrics: PlayerMetricValues }>;
  matchups: Array<{ id: string; name: string; gamesPlayed: number; goals: number; assists: number; points: number; shots: number; shootingPct: number | null }>;
  articles: Array<{ id: string; slug: string | null; title: string; excerpt: string | null; publishedAt: string | null; imageUrl: string | null; type: string | null }>;
  heroAwards: Array<{ key: string; label: string; count: number; imageUrl: string | null }>;
  aggregateOnly: boolean; hotFacts: string[];
};
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type LoadOptions = { fetchImpl?: FetchLike; timeoutMs?: number };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`Invalid ${label} bound`);
  return value;
}
function string(value: unknown, label: string, maximum = 240) {
  if (typeof value !== 'string' || value.trim() !== value || !value.length || value.length > maximum) throw new TypeError(`Invalid ${label}`);
  return value;
}
function nullableString(value: unknown, label: string, maximum = 240) { return value === null ? null : string(value, label, maximum); }
function uuid(value: unknown, label: string) {
  const result = string(value, label, 36);
  if (!UUID_PATTERN.test(result)) throw new TypeError(`Invalid ${label} UUID`);
  return result;
}
function nullableUuid(value: unknown, label: string) { return value === null ? null : uuid(value, label); }
function bool(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`);
  return value;
}
function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${label} number`);
  return value;
}
function nullableNumber(value: unknown, label: string) { return value === null ? null : finiteNumber(value, label); }
function nonnegativeInteger(value: unknown, label: string) {
  const result = finiteNumber(value, label);
  if (!Number.isInteger(result) || result < 0) throw new TypeError(`Invalid ${label} number`);
  return result;
}
function mediaUrl(value: unknown, label: string) {
  if (value === null) return null;
  const candidate = string(value, label, 2048);
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new TypeError(`Invalid ${label} media URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError(`Invalid ${label} media URL`);
  return candidate;
}
function metrics(value: unknown, label: string): PlayerMetricValues {
  const row = object(value, label);
  if (Object.keys(row).length > 64) throw new TypeError(`Invalid ${label} bound`);
  return Object.fromEntries(Object.entries(row).map(([key, item]) => [string(key, `${label} key`, 64), nullableNumber(item, `${label}.${key}`)]));
}
function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

export function decodeHockeyLifePlayerProfileEnvelope(value: unknown, requestedPlayerId: string, requestedSeasonId?: string | null): HockeyLifePlayerPage {
  uuid(requestedPlayerId, 'requested player');
  if (typeof requestedSeasonId === 'string') uuid(requestedSeasonId, 'requested season');
  const envelope = object(value, 'player profile envelope');
  if (envelope.version !== 1) throw new TypeError('Invalid player profile version');
  const league = object(envelope.league, 'player profile league');
  if (league.id !== HOCKEY_LIFE_ID || league.slug !== HOCKEY_LIFE_SLUG) throw new TypeError('Player profile league mismatch');
  const data = object(envelope.data, 'player profile data');
  const playerId = uuid(data.playerId, 'player identity');
  const rosterId = uuid(data.rosterId, 'roster identity');
  if (requestedPlayerId !== playerId && requestedPlayerId !== rosterId) throw new TypeError('Player profile identity mismatch');
  const seasons = array(data.seasons, 'seasons', 64).map((value) => {
    const row = object(value, 'season');
    return { id: uuid(row.id, 'season id'), name: string(row.name, 'season name'), start_date: nullableString(row.start_date, 'season start date'), status: nullableString(row.status, 'season status', 48) };
  });
  const seasonIds = new Set(seasons.map((season) => season.id));
  if (seasonIds.size !== seasons.length) throw new TypeError('Duplicate season identity');
  const selectedSeasonId = nullableUuid(data.selectedSeasonId, 'selected season');
  if (selectedSeasonId && !seasonIds.has(selectedSeasonId)) throw new TypeError('Selected season is not in visible seasons');
  const isCareer = bool(data.isCareer, 'career state');
  if (isCareer && selectedSeasonId !== null) throw new TypeError('Invalid selected season career state');
  if (requestedSeasonId === null && !isCareer) throw new TypeError('Requested career season mismatch');
  if (typeof requestedSeasonId === 'string' && selectedSeasonId !== requestedSeasonId) throw new TypeError('Requested selected season mismatch');
  const team = data.team === null ? null : (() => {
    const row = object(data.team, 'team');
    const primaryColor = nullableString(row.primaryColor, 'team primary color', 16);
    if (primaryColor && !/^#[0-9a-f]{6}$/i.test(primaryColor)) throw new TypeError('Invalid team primary color');
    return { id: uuid(row.id, 'team id'), name: string(row.name, 'team name'), slug: nullableString(row.slug, 'team slug'), logoUrl: mediaUrl(row.logoUrl, 'team logo'), primaryColor };
  })();
  const careerRows = array(data.careerRows, 'career rows', 256).map((value) => {
    const row = object(value, 'career row');
    return { seasonId: uuid(row.seasonId, 'career season id'), seasonName: string(row.seasonName, 'career season name'), teamId: row.teamId === undefined ? undefined : nullableUuid(row.teamId, 'career team id'), teamName: row.teamName === undefined ? undefined : nullableString(row.teamName, 'career team name'), metrics: metrics(row.metrics, 'career metrics') };
  });
  const badges = array(data.badges, 'badges', 128).map((value) => {
    const row = object(value, 'badge');
    return { id: uuid(row.id, 'badge id'), type: string(row.type, 'badge type'), seasonId: nullableUuid(row.seasonId, 'badge season id'), seasonName: nullableString(row.seasonName, 'badge season name'), teamName: nullableString(row.teamName, 'badge team name'), createdAt: string(row.createdAt, 'badge creation date') };
  });
  const games = array(data.games, 'games', 100).map((value) => {
    const row = object(value, 'game');
    return { id: uuid(row.id, 'game id'), date: string(row.date, 'game date'), opponent: nullableString(row.opponent ?? null, 'game opponent'), result: nullableString(row.result ?? null, 'game result', 12), score: nullableString(row.score ?? null, 'game score', 32), metrics: metrics(row.metrics, 'game metrics') };
  });
  const matchups = array(data.matchups, 'matchups', 100).map((value) => {
    const row = object(value, 'matchup');
    return { id: uuid(row.id, 'matchup id'), name: string(row.name, 'matchup name'), gamesPlayed: nonnegativeInteger(row.gamesPlayed, 'matchup games played'), goals: nonnegativeInteger(row.goals, 'matchup goals'), assists: nonnegativeInteger(row.assists, 'matchup assists'), points: nonnegativeInteger(row.points, 'matchup points'), shots: nonnegativeInteger(row.shots, 'matchup shots'), shootingPct: nullableNumber(row.shootingPct, 'matchup shooting percentage') };
  });
  const articles = array(data.articles, 'articles', 20).map((value) => {
    const row = object(value, 'article');
    return { id: uuid(row.id, 'article id'), slug: nullableString(row.slug, 'article slug'), title: string(row.title, 'article title'), excerpt: nullableString(row.excerpt, 'article excerpt', 4000), publishedAt: nullableString(row.publishedAt, 'article publish date'), imageUrl: mediaUrl(row.imageUrl ?? null, 'article image'), type: nullableString(row.type ?? null, 'article type', 80) };
  });
  const heroAwards = array(data.heroAwards, 'hero awards', 20).map((value) => {
    const row = object(value, 'hero award');
    return { key: string(row.key, 'hero award key', 80), label: string(row.label, 'hero award label', 120), count: nonnegativeInteger(row.count, 'hero award count'), imageUrl: mediaUrl(row.imageUrl, 'hero award image') };
  });
  const hotFacts = array(data.hotFacts, 'hot facts', 5).map((value) => string(value, 'hot fact', 500));
  const jerseyNumber = nullableNumber(data.jerseyNumber, 'jersey');
  if (jerseyNumber !== null && (!Number.isInteger(jerseyNumber) || jerseyNumber < 0 || jerseyNumber > 999)) throw new TypeError('Invalid jersey number');
  return {
    playerId, rosterId, fullName: string(data.fullName, 'player name'), photoUrl: mediaUrl(data.photoUrl, 'player photo'), position: nullableString(data.position, 'position', 80),
    leadershipRole: nullableString(data.leadershipRole, 'leadership role', 80), jerseyNumber, isGoalie: bool(data.isGoalie, 'goalie state'), team, seasons, selectedSeasonId,
    selectedSeasonName: nullableString(data.selectedSeasonName, 'selected season name'), isCareer, metrics: data.metrics === null ? null : metrics(data.metrics, 'selected metrics'),
    careerRows, badges, games, matchups, articles, heroAwards, aggregateOnly: bool(data.aggregateOnly, 'aggregate-only state'), hotFacts,
  };
}

export async function loadHockeyLifePlayerPage(playerOrRosterId: string, requestedSeasonId?: string | null, options: LoadOptions = {}): Promise<HockeyLifePlayerPage | null> {
  uuid(playerOrRosterId, 'player');
  if (typeof requestedSeasonId === 'string') uuid(requestedSeasonId, 'season');
  const url = new URL(ENDPOINT);
  url.searchParams.set('playerId', playerOrRosterId);
  if (requestedSeasonId !== undefined) url.searchParams.set('season', requestedSeasonId ?? 'all');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new TypeError('Invalid player profile timeout');
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), { headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal });
    const body = await response.text();
    if (utf8ByteLength(body) > MAX_BODY_BYTES) throw new TypeError('Player profile response body exceeds limit');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Player profile endpoint returned ${response.status}`);
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new TypeError('Invalid player profile response body'); }
    return decodeHockeyLifePlayerProfileEnvelope(payload, playerOrRosterId, requestedSeasonId);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Player profile request timed out');
    throw error;
  } finally { clearTimeout(timeout); }
}
