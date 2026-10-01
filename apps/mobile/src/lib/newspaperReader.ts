import { publicSupabase } from './supabase/client';

export const HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
export const HOCKEY_LIFE_NEWSPAPER_LEAGUE_SLUG = 'hockey-life';
export const HOCKEY_LIFE_PUBLIC_ORIGIN = 'https://hockey-life.beerleaguehockey.ca';
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export const NEWSPAPER_LOOKUP_TIMEOUT_MS = 8000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface NewspaperTeam { id: string; name: string; logoUrl?: string }
export interface NewspaperContributor { playerId: string; name: string; teamName: string; goals: number; assists: number; points: number }
export interface NewspaperGame { gameId: string; homeTeam: NewspaperTeam; awayTeam: NewspaperTeam; homeScore: number; awayScore: number; headline: string; body: string[]; imageUrl?: string; contributors: NewspaperContributor[] }
export interface NewspaperStar { playerId: string; name: string; teamName: string; goals: number; assists: number; points: number; reason: string; photoUrl?: string; illustrationUrl?: string }
export interface NewspaperNumber { label: string; value: string; detail?: string }
export interface NewspaperStanding { teamId: string; name: string; logoUrl?: string; gp: number; w: number; l: number; otl: number; t: number; pts: number; gf: number; ga: number }
export interface NewspaperBrief { headline: string; body: string; imageUrl?: string }
export interface NewspaperUpcoming { gameId: string; homeName: string; awayName: string; scheduledAt: string; venue?: string; headline: string; body: string }
export interface NewspaperEdition {
  schemaVersion: 1; title: 'Hockey Life Times'; issueNumber: string | number; leagueId: string; leagueName: string; seasonId: string; seasonName: string;
  periodStart: string; periodEnd: string; issuedAt: string; timezone: 'America/Toronto'; stage: 'regular' | 'playoffs' | 'offseason'; status: 'published';
  lead: { headline: string; dek: string; body: string[]; imageUrl?: string; caption?: string };
  games: NewspaperGame[]; stars: NewspaperStar[]; numbers: NewspaperNumber[]; standings: NewspaperStanding[]; standingsNote: string;
  hot: NewspaperBrief[]; cold: NewspaperBrief[]; upcoming: NewspaperUpcoming[]; upcomingNote: string; aroundRink?: NewspaperBrief[];
  source: { gameIds: string[]; verifiedAt: string; standingsAsOf?: string; factPackDigest?: string; warnings: string[] };
}

export type PublishedEditionResult = { status: 'ready'; edition: NewspaperEdition } | { status: 'unavailable' } | { status: 'error'; message: string };
export type NewspaperEditionQuery = (articleId: string, leagueId: string, signal?: AbortSignal) => Promise<{ data: unknown; error: unknown }>;
type QueryBuilder = { select(columns: string): QueryBuilder; eq(column: string, value: string): QueryBuilder; abortSignal?(signal: AbortSignal): QueryBuilder; maybeSingle(): Promise<{ data: unknown; error: unknown }> };

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 50000) throw new TypeError(`${path} must be a valid string`);
  return value;
}
function number(value: unknown, path: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`);
  return value;
}
function optionalString(value: unknown, path: string) { return value === undefined ? undefined : string(value, path); }
function media(value: unknown, path: string) {
  if (value === undefined) return undefined;
  const raw = string(value, path);
  const isTrustedRelative = raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\');
  let parsed: URL;
  try { parsed = isTrustedRelative ? new URL(raw, HOCKEY_LIFE_PUBLIC_ORIGIN) : new URL(raw); } catch { throw new TypeError(`${path} must be a safe media URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError(`${path} must be a safe HTTP media URL`);
  if (raw.startsWith('/') && (!isTrustedRelative || parsed.origin !== HOCKEY_LIFE_PUBLIC_ORIGIN)) throw new TypeError(`${path} must be a safe media URL`);
  return parsed.toString();
}
function strings(value: unknown, path: string, options: { min?: number; max?: number } = {}) {
  if (!Array.isArray(value) || value.length < (options.min ?? 0) || value.length > (options.max ?? 100)) throw new TypeError(`${path} has an invalid item count`);
  return value.map((item, index) => string(item, `${path}[${index}]`));
}
function list<T>(value: unknown, path: string, min: number, max: number, decode: (value: unknown, path: string) => T) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new TypeError(`${path} has an invalid item count`);
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}
function date(value: unknown, path: string) { const result = string(value, path); if (!DATE.test(result)) throw new TypeError(`${path} must use YYYY-MM-DD`); return result; }
function timestamp(value: unknown, path: string) { const result = string(value, path); if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${path} must be a timestamp`); return result; }
function team(value: unknown, path: string): NewspaperTeam { const row = record(value, path); return { id: string(row.id, `${path}.id`), name: string(row.name, `${path}.name`), logoUrl: media(row.logoUrl, `${path}.logoUrl`) }; }
function contributor(value: unknown, path: string): NewspaperContributor { const row = record(value, path); return { playerId: string(row.playerId, `${path}.playerId`), name: string(row.name, `${path}.name`), teamName: string(row.teamName, `${path}.teamName`), goals: number(row.goals, `${path}.goals`), assists: number(row.assists, `${path}.assists`), points: number(row.points, `${path}.points`) }; }
function brief(value: unknown, path: string): NewspaperBrief { const row = record(value, path); return { headline: string(row.headline, `${path}.headline`), body: string(row.body, `${path}.body`), imageUrl: media(row.imageUrl, `${path}.imageUrl`) }; }

type TextEncoderConstructor = new () => { encode(value: string): { byteLength: number } };

export function utf8ByteLength(value: string, Encoder: TextEncoderConstructor | null = typeof TextEncoder === 'undefined' ? null : TextEncoder) {
  if (Encoder) return new Encoder().encode(value).byteLength;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const point = value.codePointAt(index)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (point > 0xffff) index += 1;
  }
  return bytes;
}

export function serializedUtf8ByteLength(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('edition cannot be serialized');
  return utf8ByteLength(serialized);
}

export function validatePublishedNewspaperEdition(value: unknown, expectedLeagueId: string): NewspaperEdition {
  if (serializedUtf8ByteLength(value) > MAX_PAYLOAD_BYTES) throw new TypeError('edition exceeds the native reader size limit');
  const row = record(value, 'edition');
  if (row.schemaVersion !== 1 || row.title !== 'Hockey Life Times') throw new TypeError('edition schema or title is invalid');
  const issueNumber = typeof row.issueNumber === 'number' ? number(row.issueNumber, 'edition.issueNumber') : string(row.issueNumber, 'edition.issueNumber');
  const leagueId = string(row.leagueId, 'edition.leagueId'); if (leagueId !== expectedLeagueId) throw new TypeError('edition league identity mismatch');
  if (row.timezone !== 'America/Toronto' || !['regular', 'playoffs', 'offseason'].includes(String(row.stage)) || row.status !== 'published') throw new TypeError('edition publication metadata is invalid');
  const lead = record(row.lead, 'edition.lead');
  const games = list(row.games, 'edition.games', 1, 2, (value, path): NewspaperGame => { const game = record(value, path); return { gameId: string(game.gameId, `${path}.gameId`), homeTeam: team(game.homeTeam, `${path}.homeTeam`), awayTeam: team(game.awayTeam, `${path}.awayTeam`), homeScore: number(game.homeScore, `${path}.homeScore`), awayScore: number(game.awayScore, `${path}.awayScore`), headline: string(game.headline, `${path}.headline`), body: strings(game.body, `${path}.body`, { min: 1 }), imageUrl: media(game.imageUrl, `${path}.imageUrl`), contributors: list(game.contributors, `${path}.contributors`, 0, 100, contributor) }; });
  const stars = list(row.stars, 'edition.stars', 3, 3, (value, path): NewspaperStar => { const star = record(value, path); return { playerId: string(star.playerId, `${path}.playerId`), name: string(star.name, `${path}.name`), teamName: string(star.teamName, `${path}.teamName`), goals: number(star.goals, `${path}.goals`), assists: number(star.assists, `${path}.assists`), points: number(star.points, `${path}.points`), reason: string(star.reason, `${path}.reason`), photoUrl: media(star.photoUrl, `${path}.photoUrl`), illustrationUrl: media(star.illustrationUrl, `${path}.illustrationUrl`) }; });
  const numbers = list(row.numbers, 'edition.numbers', 1, 10, (value, path): NewspaperNumber => { const item = record(value, path); return { label: string(item.label, `${path}.label`), value: string(item.value, `${path}.value`), detail: optionalString(item.detail, `${path}.detail`) }; });
  const standings = list(row.standings, 'edition.standings', 1, 14, (value, path): NewspaperStanding => { const item = record(value, path); return { teamId: string(item.teamId, `${path}.teamId`), name: string(item.name, `${path}.name`), logoUrl: media(item.logoUrl, `${path}.logoUrl`), gp: number(item.gp, `${path}.gp`), w: number(item.w, `${path}.w`), l: number(item.l, `${path}.l`), otl: number(item.otl, `${path}.otl`), t: number(item.t, `${path}.t`), pts: number(item.pts, `${path}.pts`), gf: number(item.gf, `${path}.gf`), ga: number(item.ga, `${path}.ga`) }; });
  const upcoming = list(row.upcoming, 'edition.upcoming', 0, 4, (value, path): NewspaperUpcoming => { const item = record(value, path); return { gameId: string(item.gameId, `${path}.gameId`), homeName: string(item.homeName, `${path}.homeName`), awayName: string(item.awayName, `${path}.awayName`), scheduledAt: timestamp(item.scheduledAt, `${path}.scheduledAt`), venue: optionalString(item.venue, `${path}.venue`), headline: string(item.headline, `${path}.headline`), body: string(item.body, `${path}.body`) }; });
  const upcomingNote = string(row.upcomingNote, 'edition.upcomingNote', true); if (!upcoming.length && !upcomingNote.trim()) throw new TypeError('edition.upcomingNote is required without fixtures');
  const source = record(row.source, 'edition.source');
  return {
    schemaVersion: 1, title: 'Hockey Life Times', issueNumber, leagueId, leagueName: string(row.leagueName, 'edition.leagueName'), seasonId: string(row.seasonId, 'edition.seasonId'), seasonName: string(row.seasonName, 'edition.seasonName'),
    periodStart: date(row.periodStart, 'edition.periodStart'), periodEnd: date(row.periodEnd, 'edition.periodEnd'), issuedAt: timestamp(row.issuedAt, 'edition.issuedAt'), timezone: 'America/Toronto', stage: row.stage as NewspaperEdition['stage'], status: 'published',
    lead: { headline: string(lead.headline, 'edition.lead.headline'), dek: string(lead.dek, 'edition.lead.dek'), body: strings(lead.body, 'edition.lead.body', { min: 1 }), imageUrl: media(lead.imageUrl, 'edition.lead.imageUrl'), caption: optionalString(lead.caption, 'edition.lead.caption') },
    games, stars, numbers, standings, standingsNote: string(row.standingsNote, 'edition.standingsNote', true), hot: list(row.hot, 'edition.hot', 0, 3, brief), cold: list(row.cold, 'edition.cold', 0, 3, brief), upcoming, upcomingNote,
    aroundRink: row.aroundRink === undefined ? undefined : list(row.aroundRink, 'edition.aroundRink', 0, 4, brief),
    source: { gameIds: strings(source.gameIds, 'edition.source.gameIds', { min: 1 }), verifiedAt: timestamp(source.verifiedAt, 'edition.source.verifiedAt'), standingsAsOf: source.standingsAsOf === undefined ? undefined : date(source.standingsAsOf, 'edition.source.standingsAsOf'), factPackDigest: optionalString(source.factPackDigest, 'edition.source.factPackDigest'), warnings: strings(source.warnings, 'edition.source.warnings') },
  };
}

async function queryPublishedEdition(articleId: string, leagueId: string, signal?: AbortSignal) {
  let query = (publicSupabase as unknown as { from(table: string): QueryBuilder }).from('newspaper_editions')
    .select('article_id,league_id,status,published_at,edition_json')
    .eq('article_id', articleId).eq('league_id', leagueId).eq('status', 'published');
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
  return query.maybeSingle();
}

export async function loadPublishedNewspaperEdition(expected: { articleId: string; leagueId: string; leagueSlug: string; articleSlug: string }, query: NewspaperEditionQuery = queryPublishedEdition, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PublishedEditionResult> {
  if (!UUID.test(expected.articleId) || !UUID.test(expected.leagueId) || !SLUG.test(expected.articleSlug) || !SLUG.test(expected.leagueSlug)) return { status: 'error', message: 'Invalid newspaper article identity.' };
  if (expected.leagueId !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID || expected.leagueSlug !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_SLUG) return { status: 'unavailable' };
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const timeoutMs = options.timeoutMs ?? NEWSPAPER_LOOKUP_TIMEOUT_MS;
  let rejectCancellation: ((reason: Error) => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const onExternalAbort = () => { controller?.abort(); rejectCancellation?.(new Error('newspaper lookup cancelled')); };
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (options.signal?.aborted) onExternalAbort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller?.abort(); reject(new Error('newspaper lookup timed out')); }, timeoutMs);
    });
    const { data, error } = await Promise.race([query(expected.articleId, expected.leagueId, controller?.signal ?? options.signal), timeout, cancelled]);
    if (error) return { status: 'error', message: 'The published edition could not be checked. Retry, or read the article text.' };
    if (data === null) return { status: 'unavailable' };
    const row = record(data, 'newspaper edition row');
    if (row.article_id !== expected.articleId || row.league_id !== expected.leagueId || row.status !== 'published' || typeof row.published_at !== 'string' || !Number.isFinite(Date.parse(row.published_at))) throw new TypeError('newspaper edition association mismatch');
    return { status: 'ready', edition: validatePublishedNewspaperEdition(row.edition_json, expected.leagueId) };
  } catch (error) {
    return { status: 'error', message: error instanceof Error && error.message === 'newspaper lookup timed out' ? 'The published edition took too long to load. Retry, or read the article text.' : 'The published edition is unavailable because its data could not be safely validated.' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
