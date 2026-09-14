const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 512 * 1024;

export type ContentView = 'news' | 'article' | 'history' | 'gallery' | 'album' | 'events' | 'contact';
export interface ContentLeague { id: string; slug: string; name: string; logoUrl: string | null }
export interface ArticleSummary { id: string; slug: string; title: string; excerpt: string | null; imageUrl: string | null; type: 'news' | 'game_recap' | 'weekly_wrap'; publishedAt: string; authorName: string | null; authorId: string | null }
export interface Mention { text: string; kind: 'player' | 'team' | 'game'; id: string }
export interface RelatedGame { id: string | null; homeTeamId: string | null; homeTeamName: string; homeTeamLogoUrl: string | null; awayTeamId: string | null; awayTeamName: string; awayTeamLogoUrl: string | null; homeScore: number | null; awayScore: number | null; scheduledAt: string; status: string | null }
export interface TaggedPlayer { id: string; name: string; photoUrl: string | null; teamId: string | null; teamName: string | null }
export interface NewsResponse { schemaVersion: 1; view: 'news'; league: ContentLeague; articles: ArticleSummary[]; total: number }
export interface ArticleResponse { schemaVersion: 1; view: 'article'; league: ContentLeague; article: ArticleSummary & { content: string; mentions: Mention[]; taggedPlayers: TaggedPlayer[]; relatedGame: RelatedGame | null } }
export interface ContentSeason { id: string; name: string; startDate: string | null; endDate: string | null; status: string | null }
export interface ChampionEntry { id: string; source: 'official' | 'standings_leader' | 'legacy'; year: string; seasonId: string | null; seasonName: string; teamId: string | null; teamName: string; teamLogoUrl: string | null; photoUrl: string | null; record: { wins: number; losses: number; ties: number } | null; roster: Array<{ id: string; name: string; jerseyNumber: number | null; position: string | null; leadershipRole: string | null }>; finalGame: RelatedGame | null; summary: string | null; caption: string | null }
export interface HistoryLeader { id: string; playerId: string | null; name: string; teamId: string | null; teamName: string | null; value: number | null; savePercentage: number | null; goalsAgainstAverage: number | null; provenance: string | null }
export interface HistoryBoard { metric: 'points' | 'goals' | 'assists' | 'wins'; title: string; entries: HistoryLeader[]; limit: 25 }
export interface HistoryAward { id: string; title: string; description: string | null; seasonId: string | null; seasonName: string | null; winnerName: string | null; playerId: string | null; teamId: string | null; imageUrl: string | null }
export interface HistoryStanding { teamId: string; teamName: string; teamLogoUrl: string | null; gamesPlayed: number; wins: number; losses: number; ties: number; points: number }
export interface HistoryResponse { schemaVersion: 1; view: 'history'; league: ContentLeague; foundingYear: number | null; seasons: ContentSeason[]; champions: ChampionEntry[]; seasonStandings: Array<{ seasonId: string; rows: HistoryStanding[] }>; dynasties: Array<{ teamId: string; teamName: string; teamLogoUrl: string | null; titles: number }>; boards: HistoryBoard[]; awards: HistoryAward[]; stats: { totalSeasons: number; totalGames: number; totalTeams: number; uniqueChampions: number } }
export interface GalleryAlbum { id: string; title: string; description: string | null; seasonId: string | null; seasonName: string | null; coverUrl: string | null; photoCount: number; createdAt: string | null }
export interface GalleryPhoto { id: string; albumId: string; imageUrl: string; thumbnailUrl: string | null; caption: string | null; sortOrder: number }
export interface GalleryResponse { schemaVersion: 1; view: 'gallery'; league: ContentLeague; seasons: ContentSeason[]; albums: GalleryAlbum[]; total: number }
export interface AlbumResponse { schemaVersion: 1; view: 'album'; league: ContentLeague; album: GalleryAlbum; photos: GalleryPhoto[]; total: number }
export interface LeagueEvent { id: string; title: string; description: string | null; eventType: string; location: string | null; startTime: string; endTime: string | null }
export interface EventsResponse { schemaVersion: 1; view: 'events'; league: ContentLeague; timeZone: string; generatedAt: string; windowStart: string; events: LeagueEvent[]; total: number }
export interface LeagueContact { email: string | null; phone: string | null; websiteUrl: string | null; address: string | null; city: string | null; state: string | null; zipCode: string | null }
export interface ContactResponse { schemaVersion: 1; view: 'contact'; league: ContentLeague; contact: LeagueContact }
export type ContentResponse = NewsResponse | ArticleResponse | HistoryResponse | GalleryResponse | AlbumResponse | EventsResponse | ContactResponse;
export type ContentRequest = { view: 'news' } | { view: 'history' } | { view: 'gallery' } | { view: 'events' } | { view: 'contact' } | { view: 'article'; articleSlug: string } | { view: 'album'; albumId: string };

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
type R = Record<string, unknown>;
const rec = (v: unknown, label: string): R => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`Invalid ${label}`); return v as R; };
const str = (v: unknown, label: string, max = 500): string => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new TypeError(`Invalid ${label}`); return v; };
const nullableStr = (v: unknown, label: string, max = 4096): string | null => v === null ? null : str(v, label, max);
const httpUrl = (v: unknown, label: string): string => { const value = str(v, label, 4096); try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return parsed.toString(); } catch { throw new TypeError(`Invalid ${label}`); } };
const nullableHttpUrl = (v: unknown, label: string): string | null => v === null ? null : httpUrl(v, label);
const id = (v: unknown, label: string): string => { const x = str(v, label, 128); if (!UUID.test(x)) throw new TypeError(`Invalid ${label}`); return x; };
const nullableId = (v: unknown, label: string): string | null => v === null ? null : id(v, label);
const num = (v: unknown, label: string, integer = false): number => { if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v))) throw new TypeError(`Invalid ${label}`); return v; };
const nonnegative = (v: unknown, label: string): number => { const x = num(v, label, true); if (x < 0) throw new TypeError(`Invalid ${label}`); return x; };
const nullableNum = (v: unknown, label: string): number | null => v === null ? null : num(v, label);
const arr = (v: unknown, label: string, max: number): unknown[] => { if (!Array.isArray(v) || v.length > max) throw new TypeError(`Invalid ${label}`); return v; };
const date = (v: unknown, label: string): string => { const x = str(v, label, 64); if (!Number.isFinite(Date.parse(x))) throw new TypeError(`Invalid ${label}`); return x; };
const isoDate = (v: unknown, label: string): string => { const x = date(v, label); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)) throw new TypeError(`Invalid ${label}`); return x; };
const nullableDate = (v: unknown, label: string): string | null => v === null ? null : date(v, label);
const unique = (xs: string[], label: string) => { if (new Set(xs).size !== xs.length) throw new TypeError(`Duplicate ${label}`); };

function league(v: unknown, expectedSlug: string): ContentLeague {
  const x = rec(v, 'league');
  const slug = str(x.slug, 'league slug', 63);
  if (slug !== expectedSlug) throw new TypeError('League content tenant identity mismatch');
  return { id: id(x.id, 'league id'), slug, name: str(x.name, 'league name'), logoUrl: nullableHttpUrl(x.logoUrl, 'league logo URL') };
}
function summary(v: unknown, label: string): ArticleSummary {
  const x = rec(v, label); const type = x.type;
  if (type !== 'news' && type !== 'game_recap' && type !== 'weekly_wrap') throw new TypeError(`Invalid ${label} type`);
  const slug = str(x.slug, `${label} slug`, 160); if (!SLUG.test(slug)) throw new TypeError(`Invalid ${label} slug`);
  return { id: id(x.id, `${label} id`), slug, title: str(x.title, `${label} title`, 500), excerpt: nullableStr(x.excerpt, `${label} excerpt`, 12000), imageUrl: nullableHttpUrl(x.imageUrl, `${label} image URL`), type, publishedAt: date(x.publishedAt, `${label} published date`), authorName: nullableStr(x.authorName, `${label} author`, 200), authorId: nullableId(x.authorId, `${label} author id`) };
}
function game(v: unknown, label: string): RelatedGame | null {
  if (v === null) return null; const x = rec(v, label);
  return { id: nullableId(x.id, `${label} id`), homeTeamId: nullableId(x.homeTeamId, `${label} home team id`), homeTeamName: str(x.homeTeamName, `${label} home team`), homeTeamLogoUrl: nullableStr(x.homeTeamLogoUrl, `${label} home logo`), awayTeamId: nullableId(x.awayTeamId, `${label} away team id`), awayTeamName: str(x.awayTeamName, `${label} away team`), awayTeamLogoUrl: nullableStr(x.awayTeamLogoUrl, `${label} away logo`), homeScore: nullableNum(x.homeScore, `${label} home score`), awayScore: nullableNum(x.awayScore, `${label} away score`), scheduledAt: date(x.scheduledAt, `${label} date`), status: nullableStr(x.status, `${label} status`, 40) };
}
function season(v: unknown, label: string): ContentSeason { const x = rec(v, label); return { id: id(x.id, `${label} id`), name: str(x.name, `${label} name`), startDate: nullableDate(x.startDate, `${label} start`), endDate: nullableDate(x.endDate, `${label} end`), status: nullableStr(x.status, `${label} status`, 40) }; }
function album(v: unknown, label: string): GalleryAlbum { const x = rec(v, label); return { id: id(x.id, `${label} id`), title: str(x.title, `${label} title`), description: nullableStr(x.description, `${label} description`, 12000), seasonId: nullableId(x.seasonId, `${label} season id`), seasonName: nullableStr(x.seasonName, `${label} season name`), coverUrl: nullableHttpUrl(x.coverUrl, `${label} cover URL`), photoCount: nonnegative(x.photoCount, `${label} photo count`), createdAt: nullableDate(x.createdAt, `${label} created`) }; }
function decode(rawValue: unknown, expected: ContentView, expectedSlug: string): ContentResponse {
  const raw = rec(rawValue, 'league content response');
  if (raw.schemaVersion !== 1 || raw.view !== expected) throw new TypeError('League content response contract mismatch');
  const base = { schemaVersion: 1 as const, league: league(raw.league, expectedSlug) };
  if (expected === 'news') {
    const articles = arr(raw.articles, 'articles', 5000).map((x, i) => summary(x, `article ${i}`)); unique(articles.map(x => x.id), 'article');
    const total = nonnegative(raw.total, 'news total'); if (total !== articles.length) throw new TypeError('Incomplete news response');
    return { ...base, view: 'news', articles, total };
  }
  if (expected === 'article') {
    const x = rec(raw.article, 'article'); const baseArticle = summary(x, 'article');
    const mentions = arr(x.mentions, 'mentions', 5000).map((v, i) => { const m = rec(v, `mention ${i}`); if (!['player', 'team', 'game'].includes(String(m.kind))) throw new TypeError('Invalid mention kind'); return { text: str(m.text, 'mention text'), kind: m.kind as Mention['kind'], id: id(m.id, 'mention id') }; });
    const taggedPlayers = arr(x.taggedPlayers, 'tagged players', 5000).map((v, i) => { const p = rec(v, `tagged player ${i}`); return { id: id(p.id, 'tagged player id'), name: str(p.name, 'tagged player name'), photoUrl: nullableStr(p.photoUrl, 'tagged player photo'), teamId: nullableId(p.teamId, 'tagged player team id'), teamName: nullableStr(p.teamName, 'tagged player team') }; });
    return { ...base, view: 'article', article: { ...baseArticle, content: str(x.content, 'article content', MAX_BYTES), mentions, taggedPlayers, relatedGame: game(x.relatedGame, 'related game') } };
  }
  if (expected === 'gallery') {
    const seasons = arr(raw.seasons, 'seasons', 500).map((x, i) => season(x, `season ${i}`)); const albums = arr(raw.albums, 'albums', 5000).map((x, i) => album(x, `album ${i}`));
    unique(albums.map(x => x.id), 'album'); const seasonIds = new Set(seasons.map(x => x.id)); if (albums.some(x => x.seasonId && !seasonIds.has(x.seasonId))) throw new TypeError('Album references unknown season');
    const total = nonnegative(raw.total, 'gallery total'); if (total !== albums.length) throw new TypeError('Incomplete gallery response');
    return { ...base, view: 'gallery', seasons, albums, total };
  }
  if (expected === 'album') {
    const selected = album(raw.album, 'album'); const photos = arr(raw.photos, 'photos', 10000).map((v, i) => { const p = rec(v, `photo ${i}`); const albumId = id(p.albumId, 'photo album id'); if (albumId !== selected.id) throw new TypeError('Photo album identity mismatch'); return { id: id(p.id, 'photo id'), albumId, imageUrl: httpUrl(p.imageUrl, 'photo image URL'), thumbnailUrl: nullableHttpUrl(p.thumbnailUrl, 'photo thumbnail URL'), caption: nullableStr(p.caption, 'photo caption', 4000), sortOrder: nonnegative(p.sortOrder, 'photo sort order') }; });
    unique(photos.map(x => x.id), 'photo'); const total = nonnegative(raw.total, 'album total'); if (total !== photos.length || selected.photoCount !== total) throw new TypeError('Incomplete album response');
    return { ...base, view: 'album', album: selected, photos, total };
  }
  if (expected === 'events') {
    const generatedAt = isoDate(raw.generatedAt, 'events generated date');
    const windowStart = isoDate(raw.windowStart, 'events window start');
    if (Date.parse(windowStart) > Date.parse(generatedAt)) throw new TypeError('Invalid events window range');
    const events = arr(raw.events, 'events', 10000).map((value, index): LeagueEvent => {
      const x = rec(value, `event ${index}`);
      const startTime = isoDate(x.startTime, `event ${index} start`);
      const endTime = x.endTime === null ? null : isoDate(x.endTime, `event ${index} end`);
      if (endTime && Date.parse(endTime) < Date.parse(startTime)) throw new TypeError(`Invalid event ${index} date range`);
      return {
        id: id(x.id, `event ${index} id`),
        title: str(x.title, `event ${index} title`, 500),
        description: nullableStr(x.description, `event ${index} description`, 12000),
        eventType: str(x.eventType, `event ${index} type`, 100),
        location: nullableStr(x.location, `event ${index} location`, 1000),
        startTime,
        endTime,
      };
    });
    unique(events.map(event => event.id), 'event');
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1]!;
      const current = events[index]!;
      const previousTime = Date.parse(previous.startTime); const currentTime = Date.parse(current.startTime);
      if (previousTime > currentTime || (previousTime === currentTime && previous.id > current.id)) {
        throw new TypeError('Events response is not deterministically ordered');
      }
    }
    const total = nonnegative(raw.total, 'events total');
    if (total !== events.length) throw new TypeError('Incomplete events response');
    return { ...base, view: 'events', timeZone: str(raw.timeZone, 'events time zone', 100), generatedAt, windowStart, events, total };
  }
  if (expected === 'contact') {
    const x = rec(raw.contact, 'contact');
    return { ...base, view: 'contact', contact: {
      email: nullableStr(x.email, 'contact email', 320),
      phone: nullableStr(x.phone, 'contact phone', 100),
      websiteUrl: nullableStr(x.websiteUrl, 'contact website', 4096),
      address: nullableStr(x.address, 'contact address', 1000),
      city: nullableStr(x.city, 'contact city', 300),
      state: nullableStr(x.state, 'contact state', 300),
      zipCode: nullableStr(x.zipCode, 'contact postal code', 40),
    } };
  }
  const seasons = arr(raw.seasons, 'seasons', 500).map((x, i) => season(x, `season ${i}`)); const seasonIds = new Set(seasons.map(x => x.id));
  const champions = arr(raw.champions, 'champions', 1000).map((v, i): ChampionEntry => { const x = rec(v, `champion ${i}`); if (!['official', 'standings_leader', 'legacy'].includes(String(x.source))) throw new TypeError('Invalid champion source'); const roster = arr(x.roster, 'champion roster', 500).map(v => { const p = rec(v, 'champion player'); return { id: id(p.id, 'champion player id'), name: str(p.name, 'champion player name'), jerseyNumber: p.jerseyNumber === null ? null : nonnegative(p.jerseyNumber, 'jersey number'), position: nullableStr(p.position, 'position', 80), leadershipRole: nullableStr(p.leadershipRole, 'leadership role', 80) }; }); const record = x.record === null ? null : (() => { const r = rec(x.record, 'champion record'); return { wins: nonnegative(r.wins, 'wins'), losses: nonnegative(r.losses, 'losses'), ties: nonnegative(r.ties, 'ties') }; })(); return { id: str(x.id, 'champion id', 128), source: x.source as ChampionEntry['source'], year: str(x.year, 'champion year', 40), seasonId: nullableId(x.seasonId, 'champion season id'), seasonName: str(x.seasonName, 'champion season name'), teamId: nullableId(x.teamId, 'champion team id'), teamName: str(x.teamName, 'champion team name'), teamLogoUrl: nullableStr(x.teamLogoUrl, 'champion logo'), photoUrl: nullableStr(x.photoUrl, 'champion photo'), record, roster, finalGame: game(x.finalGame, 'championship final'), summary: nullableStr(x.summary, 'champion summary', 12000), caption: nullableStr(x.caption, 'champion caption', 2000) }; });
  if (champions.some(x => x.seasonId && !seasonIds.has(x.seasonId))) throw new TypeError('Champion references unknown season');
  const seasonStandings = arr(raw.seasonStandings, 'season standings', 500).map((v, i) => { const x = rec(v, `season standings ${i}`); const seasonId = id(x.seasonId, 'standings season id'); if (!seasonIds.has(seasonId)) throw new TypeError('Standings references unknown season'); const rows = arr(x.rows, 'standing rows', 5000).map(v => { const s = rec(v, 'standing'); return { teamId: id(s.teamId, 'standing team id'), teamName: str(s.teamName, 'standing team'), teamLogoUrl: nullableStr(s.teamLogoUrl, 'standing logo'), gamesPlayed: nonnegative(s.gamesPlayed, 'games played'), wins: nonnegative(s.wins, 'wins'), losses: nonnegative(s.losses, 'losses'), ties: nonnegative(s.ties, 'ties'), points: nonnegative(s.points, 'points') }; }); return { seasonId, rows }; });
  const dynasties = arr(raw.dynasties, 'dynasties', 1000).map(v => { const x = rec(v, 'dynasty'); return { teamId: id(x.teamId, 'dynasty team id'), teamName: str(x.teamName, 'dynasty team'), teamLogoUrl: nullableStr(x.teamLogoUrl, 'dynasty logo'), titles: nonnegative(x.titles, 'dynasty titles') }; });
  const boards = arr(raw.boards, 'boards', 4).map((v, i): HistoryBoard => { const x = rec(v, `board ${i}`); if (!['points', 'goals', 'assists', 'wins'].includes(String(x.metric)) || x.limit !== 25) throw new TypeError('Invalid history board'); const entries = arr(x.entries, 'board entries', 25).map(v => { const e = rec(v, 'leader'); return { id: str(e.id, 'leader id', 128), playerId: nullableId(e.playerId, 'leader player id'), name: str(e.name, 'leader name'), teamId: nullableId(e.teamId, 'leader team id'), teamName: nullableStr(e.teamName, 'leader team'), value: nullableNum(e.value, 'leader value'), savePercentage: nullableNum(e.savePercentage, 'save percentage'), goalsAgainstAverage: nullableNum(e.goalsAgainstAverage, 'goals against average'), provenance: nullableStr(e.provenance, 'leader provenance', 500) }; }); return { metric: x.metric as HistoryBoard['metric'], title: str(x.title, 'board title'), entries, limit: 25 }; });
  const awards = arr(raw.awards, 'awards', 5000).map(v => { const x = rec(v, 'award'); return { id: str(x.id, 'award id', 128), title: str(x.title, 'award title'), description: nullableStr(x.description, 'award description', 4000), seasonId: nullableId(x.seasonId, 'award season id'), seasonName: nullableStr(x.seasonName, 'award season'), winnerName: nullableStr(x.winnerName, 'award winner'), playerId: nullableId(x.playerId, 'award player id'), teamId: nullableId(x.teamId, 'award team id'), imageUrl: nullableStr(x.imageUrl, 'award image') }; });
  const sx = rec(raw.stats, 'history stats'); const stats = { totalSeasons: nonnegative(sx.totalSeasons, 'total seasons'), totalGames: nonnegative(sx.totalGames, 'total games'), totalTeams: nonnegative(sx.totalTeams, 'total teams'), uniqueChampions: nonnegative(sx.uniqueChampions, 'unique champions') };
  return { ...base, view: 'history', foundingYear: raw.foundingYear === null ? null : nonnegative(raw.foundingYear, 'founding year'), seasons, champions, seasonStandings, dynasties, boards, awards, stats };
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}|./g, 'x').length;
}

function validateMediaUrls(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(validateMediaUrls); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as R)) {
    if (key.endsWith('Url') && nested !== null) httpUrl(nested, key);
    else validateMediaUrls(nested);
  }
}

function abortError() {
  const error = new Error('League content request aborted');
  error.name = 'AbortError';
  return error;
}

export async function getLeagueContent(slug: string, request: ContentRequest, fetcher: FetchLike = fetch, signal?: AbortSignal, timeoutMs = 8000): Promise<ContentResponse> {
  if (!SLUG.test(slug)) throw new TypeError('Invalid league slug');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid league content timeout');
  const params = new URLSearchParams({ leagueSlug: slug, view: request.view });
  if (request.view === 'article') { if (!SLUG.test(request.articleSlug)) throw new TypeError('Invalid article slug'); params.set('articleSlug', request.articleSlug); }
  if (request.view === 'album') { id(request.albumId, 'album id'); params.set('albumId', request.albumId); }
  const controller = new AbortController();
  let rejectExternal: ((reason: Error) => void) | undefined;
  const externalAbort = new Promise<never>((_resolve, reject) => { rejectExternal = reject; });
  const onExternalAbort = () => { rejectExternal?.(abortError()); controller.abort(); };
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('League content request timed out'));
      controller.abort();
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetcher(`https://api.beerleaguehockey.ca/api/public/league-content?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const body = await response.text(); if (byteLength(body) > MAX_BYTES) throw new Error('League content payload exceeds byte limit');
    let parsed: unknown; try { parsed = JSON.parse(body); } catch { throw new Error('League content returned invalid JSON'); }
    if (!response.ok) { const error = rec(parsed, 'league content error').error; const detail = rec(error, 'league content error detail'); throw new Error(typeof detail.message === 'string' ? detail.message : `League content request failed (${response.status})`); }
    const decoded = decode(parsed, request.view, slug);
    if (request.view === 'article' && (decoded.view !== 'article' || decoded.article.slug !== request.articleSlug)) {
      throw new TypeError('Article identity mismatch');
    }
    if (request.view === 'album' && (decoded.view !== 'album' || decoded.album.id !== request.albumId)) {
      throw new TypeError('Album identity mismatch');
    }
    validateMediaUrls(decoded);
    return decoded;
  })();
  try {
    return await Promise.race([operation, timedOut, externalAbort]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
