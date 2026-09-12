import { supabase } from './client';

export type PresentationSeason = {
  id: string; league_id: string; name: string; status: string | null;
  start_date: string | null; end_date: string | null; created_at: string | null;
};
export type HomeArticle = {
  id: string; season_id: string | null; title: string; content: unknown; excerpt: string | null;
  image_url: string | null; slug: string | null; published_at: string | null; created_at: string; type: string | null;
};
export type HomeTeam = {
  id: string; name: string; slug?: string | null; logo_url: string | null; primary_color: string | null;
  secondary_color?: string | null; division_id?: string | null;
};
export type HomeWeeklyGame = {
  id: string; scheduled_at: string; location: string | null; home_score: number | null; away_score: number | null;
  status: string; game_type?: string | null; division_id?: string | null; home_team_id: string; away_team_id: string;
  home_team: HomeTeam | null; away_team: HomeTeam | null;
};
export type HomeLeader = {
  player_id: string; player_name: string; avatar_url: string | null; team_id: string | null; team_name: string;
  display_team_name: string | null; display_team_logo_url: string | null; position: string | null;
  goals: number; assists: number; points: number;
};
export type HomeStanding = {
  team_id: string; team_name: string; logo_url: string | null; primary_color: string | null;
  division_id: string | null; division_name: string | null; team_type: string | null;
  games_played: number; wins: number; losses: number; ties: number; goals_for: number;
  goals_against: number; goal_differential: number; points: number;
};
export type HomeDivision = { id: string; name: string; sort_order?: number };
export type HomePhoto = { id: string; url: string; caption: string | null; gallery_id: string };
export type HomeAlbum = {
  id: string; season_id: string | null; title: string; description: string | null;
  cover_photo_url: string | null; created_at: string;
};
export type HomeSponsor = {
  id: string; name: string; logo_url: string | null; website_url: string | null;
  tier: string | null; display_order: number;
};
export type HomeSocial = { key: string; label: string; url: string };
export type HomeSection<T> = { status: 'ready' | 'error'; data: T; message?: string };
export type HomePublicSnapshot = {
  leagueId: string; leagueSlug: string; presentationSeason: PresentationSeason | null;
  timezone: string | null; weekKey: string | null; divisions: HomeDivision[];
  articles: HomeSection<HomeArticle[]>; weeklyGames: HomeSection<HomeWeeklyGame[]>;
  leaders: HomeSection<HomeLeader[]>; standings: HomeSection<HomeStanding[]>;
  photos: HomeSection<HomePhoto[]>; albums: HomeSection<HomeAlbum[]>;
  community: HomeSection<HomeSocial[]>; sponsors: HomeSection<HomeSponsor[]>;
};

const PRESENTATION_STATUS_PRIORITY: Record<string, number> = {
  active: 0, playoffs: 1, registration: 2, upcoming: 2, draft: 3, completed: 4, archived: 5,
};
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMPANION_BYTES = 256 * 1024;
const MAX_LEADERS = 15;
const MAX_STANDINGS = 200;
const MAX_DIVISIONS = 64;
const GAME_STATUSES = new Set(['scheduled', 'in_progress', 'completed', 'pending_verification', 'postponed', 'cancelled']);

function newestSeasonDate(season: PresentationSeason) {
  return season.start_date ?? season.end_date ?? season.created_at ?? '';
}

export function selectPresentationSeason(rows: PresentationSeason[], leagueId: string) {
  return rows.filter((season) => season.league_id === leagueId).sort((left, right) => {
    const priority = (PRESENTATION_STATUS_PRIORITY[left.status ?? ''] ?? 99)
      - (PRESENTATION_STATUS_PRIORITY[right.status ?? ''] ?? 99);
    if (priority !== 0) return priority;
    const date = newestSeasonDate(right).localeCompare(newestSeasonDate(left));
    return date !== 0 ? date : left.id.localeCompare(right.id);
  })[0] ?? null;
}

function seasonBounds(season: PresentationSeason) {
  return {
    start: season.start_date ? new Date(`${season.start_date}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY,
    end: season.end_date ? new Date(`${season.end_date}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY,
  };
}

function inPresentationSeason(
  row: { season_id?: string | null; published_at?: string | null; created_at?: string | null },
  season: PresentationSeason,
) {
  if (row.season_id) return row.season_id === season.id;
  const value = row.published_at ?? row.created_at;
  if (!value) return false;
  const time = new Date(value).getTime();
  const { start, end } = seasonBounds(season);
  return Number.isFinite(time) && time >= start && time <= end;
}

export function filterArticlesForPresentationSeason<T extends {
  id: string; season_id?: string | null; published_at?: string | null; created_at?: string | null;
}>(rows: T[], season: PresentationSeason | null): T[] {
  if (!season) return rows;
  const filtered = rows.filter((row) => inPresentationSeason(row, season));
  return filtered.length > 0 ? filtered : rows;
}

export function filterAlbumsForPresentationSeason<T extends {
  id: string; season_id?: string | null; created_at?: string | null;
}>(rows: T[], season: PresentationSeason | null): T[] {
  if (!season) return [];
  return rows.filter((row) => inPresentationSeason(row, season));
}

function dateKeyInTimezone(value: Date, timezone: string) {
  if (!Number.isFinite(value.getTime())) throw new TypeError('Invalid date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) throw new TypeError('Invalid timezone date');
  return `${values.year}-${values.month}-${values.day}`;
}

function leagueWeek(timezone: string, now: Date) {
  const today = new Date(`${dateKeyInTimezone(now, timezone)}T00:00:00.000Z`);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { mondayKey: monday.toISOString().slice(0, 10), sundayKey: sunday.toISOString().slice(0, 10) };
}

export function filterGamesToLeagueWeek<T extends { scheduled_at: string }>(games: T[], now: Date, timezone: string): T[] {
  const { mondayKey, sundayKey } = leagueWeek(timezone, now);
  return games.filter((game) => {
    const key = dateKeyInTimezone(new Date(game.scheduled_at), timezone);
    return key >= mondayKey && key <= sundayKey;
  });
}

export function normalizeHomeGameStatus(status: string) {
  if (status === 'completed') return 'Final';
  if (status === 'in_progress') return 'Live';
  if (status === 'pending_verification') return 'Awaiting Review';
  if (status === 'postponed') return 'Postponed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Scheduled';
}

export function toSafeWebUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const BLH_SPONSOR: HomeSponsor = {
  id: 'blh-contract-fallback', name: 'Beer League Hockey', logo_url: null,
  website_url: 'https://beerleaguehockey.ca/', tier: 'platform', display_order: 0,
};

export function selectSponsorStrip(rows: HomeSponsor[]) {
  const withLogos = rows.filter((row) => Boolean(row.logo_url));
  if (withLogos.length === 0) return [BLH_SPONSOR];
  const featured = withLogos.filter((row) => row.tier === 'premier' || row.tier === 'gold');
  return featured.length > 0 ? featured : withLogos;
}

function ready<T>(data: T): HomeSection<T> { return { status: 'ready', data }; }
function failed<T>(data: T, message: string): HomeSection<T> { return { status: 'error', data, message }; }
async function section<T>(fallback: T, message: string, load: () => Promise<T>): Promise<HomeSection<T>> {
  try { return ready(await load()); } catch { return failed(fallback, message); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) throw new TypeError(`Invalid ${field}`);
  return value;
}
function nullableString(value: unknown, field: string, allowEmpty = false): string | null {
  return value === null ? null : string(value, field, allowEmpty);
}
function finite(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${field}`);
  return value;
}
function nullableFinite(value: unknown, field: string): number | null {
  return value === null ? null : finite(value, field);
}
function validDateString(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  const parsed = string(value, field);
  if (!Number.isFinite(new Date(parsed).getTime())) throw new TypeError(`Invalid ${field}`);
  return parsed;
}

function validatePresentationSeason(value: unknown, leagueId: string): PresentationSeason {
  const row = record(value);
  const parsed: PresentationSeason = {
    id: string(row.id, 'season id'), league_id: string(row.league_id, 'season league id'),
    name: string(row.name, 'season name'), status: nullableString(row.status, 'season status'),
    start_date: nullableString(row.start_date, 'season start date'), end_date: nullableString(row.end_date, 'season end date'),
    created_at: nullableString(row.created_at, 'season created date'),
  };
  if (parsed.league_id !== leagueId) throw new TypeError('Season belongs to another league');
  for (const valueToCheck of [parsed.start_date, parsed.end_date, parsed.created_at]) {
    if (valueToCheck !== null && !Number.isFinite(new Date(valueToCheck).getTime())) throw new TypeError('Invalid season date');
  }
  return parsed;
}

function validateTeam(value: unknown): HomeTeam | null {
  if (value === null) return null;
  const source = Array.isArray(value) ? value[0] : value;
  if (source === undefined) return null;
  const row = record(source);
  return {
    id: string(row.id, 'team id'), name: string(row.name, 'team name'),
    slug: row.slug === undefined ? undefined : nullableString(row.slug, 'team slug'),
    logo_url: nullableString(row.logo_url, 'team logo'), primary_color: nullableString(row.primary_color, 'team colour'),
    secondary_color: row.secondary_color === undefined ? undefined : nullableString(row.secondary_color, 'team secondary colour'),
    division_id: row.division_id === undefined ? undefined : nullableString(row.division_id, 'team division id'),
  };
}

function validateArticles(value: unknown, leagueId: string): HomeArticle[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid articles');
  return value.map((item) => {
    const row = record(item);
    if (string(row.league_id, 'article league id') !== leagueId) throw new TypeError('Article belongs to another league');
    return {
      id: string(row.id, 'article id'), season_id: nullableString(row.season_id, 'article season id'),
      title: string(row.title, 'article title'), content: row.content,
      excerpt: nullableString(row.excerpt, 'article excerpt'), image_url: nullableString(row.image_url, 'article image'),
      slug: nullableString(row.slug, 'article slug'), published_at: validDateString(row.published_at, 'article published date', true),
      created_at: validDateString(row.created_at, 'article created date') as string, type: nullableString(row.type, 'article type'),
    };
  });
}

function validateGames(value: unknown, leagueId: string, seasonId: string | null): HomeWeeklyGame[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid games');
  return value.map((item) => {
    const row = record(item);
    if (string(row.league_id, 'game league id') !== leagueId) throw new TypeError('Game belongs to another league');
    if (seasonId !== null && row.season_id !== seasonId) throw new TypeError('Game belongs to another season');
    const homeTeam = validateTeam(row.home_team);
    const awayTeam = validateTeam(row.away_team);
    if (!homeTeam || !awayTeam || homeTeam.id !== row.home_team_id || awayTeam.id !== row.away_team_id) {
      throw new TypeError('Missing or mismatched game team join');
    }
    const status = string(row.status, 'game status');
    if (!GAME_STATUSES.has(status)) throw new TypeError('Invalid game status');
    return {
      id: string(row.id, 'game id'), scheduled_at: validDateString(row.scheduled_at, 'game date') as string,
      location: nullableString(row.location, 'game location'), home_score: nullableFinite(row.home_score, 'home score'),
      away_score: nullableFinite(row.away_score, 'away score'), status,
      game_type: row.game_type === undefined ? undefined : nullableString(row.game_type, 'game type'),
      division_id: row.division_id === undefined ? undefined : nullableString(row.division_id, 'game division id'),
      home_team_id: string(row.home_team_id, 'home team id'), away_team_id: string(row.away_team_id, 'away team id'),
      home_team: homeTeam, away_team: awayTeam,
    };
  });
}

function validatePhotos(value: unknown): HomePhoto[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid photos');
  return value.map((item) => {
    const row = record(item);
    return { id: string(row.id, 'photo id'), url: string(row.url, 'photo URL'),
      caption: nullableString(row.caption, 'photo caption'), gallery_id: string(row.gallery_id, 'photo gallery id') };
  });
}

function validateAlbums(value: unknown, leagueId: string): HomeAlbum[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid albums');
  return value.map((item) => {
    const row = record(item);
    if (string(row.league_id, 'album league id') !== leagueId) throw new TypeError('Album belongs to another league');
    return {
      id: string(row.id, 'album id'), season_id: nullableString(row.season_id, 'album season id'),
      title: string(row.title, 'album title'), description: nullableString(row.description, 'album description'),
      cover_photo_url: nullableString(row.cover_photo_url, 'album cover'),
      created_at: validDateString(row.created_at, 'album created date') as string,
    };
  });
}

function validateSponsors(value: unknown, leagueId: string): HomeSponsor[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid sponsors');
  return value.map((item) => {
    const row = record(item);
    if (string(row.league_id, 'sponsor league id') !== leagueId) throw new TypeError('Sponsor belongs to another league');
    return {
      id: string(row.id, 'sponsor id'), name: string(row.name, 'sponsor name'),
      logo_url: nullableString(row.logo_url, 'sponsor logo'), website_url: nullableString(row.website_url, 'sponsor URL'),
      tier: nullableString(row.tier, 'sponsor tier'), display_order: finite(row.display_order, 'sponsor display order'),
    };
  });
}

function settingsSocials(settings: unknown): HomeSocial[] {
  if (settings === null || settings === undefined) return [];
  const settingsRow = record(settings);
  if (settingsRow.website === null || settingsRow.website === undefined) return [];
  const website = record(settingsRow.website);
  const candidates = [
    ['socialFacebook', 'Facebook'], ['socialTwitter', 'X / Twitter'], ['socialInstagram', 'Instagram'],
    ['socialYoutube', 'YouTube'], ['socialTiktok', 'TikTok'],
  ] as const;
  return candidates.flatMap(([key, label]) => {
    const configured = website[key];
    if (configured === null || configured === undefined || configured === '') return [];
    const url = toSafeWebUrl(string(configured, key));
    if (!url) throw new TypeError(`Invalid ${key}`);
    return [{ key, label, url }];
  });
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
      bytes += 4; index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function validateLeader(value: unknown): HomeLeader {
  const row = record(value);
  return {
    player_id: string(row.player_id, 'leader player id'), player_name: string(row.player_name, 'leader player name'),
    avatar_url: nullableString(row.avatar_url, 'leader avatar'),
    team_id: row.team_id === null ? null : string(row.team_id, 'leader team id', true),
    team_name: string(row.team_name, 'leader team name'),
    display_team_name: nullableString(row.display_team_name, 'leader display team'),
    display_team_logo_url: nullableString(row.display_team_logo_url, 'leader display team logo'),
    position: nullableString(row.position, 'leader position'), goals: finite(row.goals, 'leader goals'),
    assists: finite(row.assists, 'leader assists'), points: finite(row.points, 'leader points'),
  };
}

function validateStanding(value: unknown): HomeStanding {
  const row = record(value);
  return {
    team_id: string(row.team_id, 'standing team id'), team_name: string(row.team_name, 'standing team name'),
    logo_url: nullableString(row.logo_url, 'standing logo'), primary_color: nullableString(row.primary_color, 'standing colour'),
    division_id: nullableString(row.division_id, 'standing division id'),
    division_name: nullableString(row.division_name, 'standing division name'),
    team_type: nullableString(row.team_type, 'standing team type'), games_played: finite(row.games_played, 'games played'),
    wins: finite(row.wins, 'wins'), losses: finite(row.losses, 'losses'), ties: finite(row.ties, 'ties'),
    goals_for: finite(row.goals_for, 'goals for'), goals_against: finite(row.goals_against, 'goals against'),
    goal_differential: finite(row.goal_differential, 'goal differential'), points: finite(row.points, 'standing points'),
  };
}

function validateDivision(value: unknown): HomeDivision {
  const row = record(value);
  return { id: string(row.id, 'division id'), name: string(row.name, 'division name'),
    ...(row.sort_order === undefined ? {} : { sort_order: finite(row.sort_order, 'division sort order') }) };
}

function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${field}`);
}

function validateCompanionPayload(
  value: unknown, expectedLeagueId: string, expectedLeagueSlug: string, expectedSeason: PresentationSeason | null,
) {
  const payload = record(value);
  if (payload.schemaVersion !== 1) throw new TypeError('Unsupported public Home schema');
  if (payload.leagueId !== expectedLeagueId || payload.leagueSlug !== expectedLeagueSlug) throw new TypeError('Public Home tenant mismatch');
  const presentationSeason = payload.presentationSeason === null
    ? null : validatePresentationSeason(payload.presentationSeason, expectedLeagueId);
  if (presentationSeason?.id !== expectedSeason?.id) throw new TypeError('Public Home season mismatch');
  if (!Array.isArray(payload.leaders) || payload.leaders.length > MAX_LEADERS) throw new TypeError('Invalid leaders bound');
  if (!Array.isArray(payload.standings) || payload.standings.length > MAX_STANDINGS) throw new TypeError('Invalid standings bound');
  if (!Array.isArray(payload.divisions) || payload.divisions.length > MAX_DIVISIONS) throw new TypeError('Invalid divisions bound');
  const leaders = payload.leaders.map(validateLeader);
  const standings = payload.standings.map(validateStanding);
  const divisions = payload.divisions.map(validateDivision);
  if (!presentationSeason && (leaders.length > 0 || standings.length > 0)) throw new TypeError('No-season payload contains all-time facts');
  unique(leaders.map((row) => row.player_id), 'leader player id');
  unique(standings.map((row) => row.team_id), 'standing team id');
  unique(divisions.map((row) => row.id), 'division id');
  const divisionIds = new Set(divisions.map((row) => row.id));
  if (standings.some((row) => row.division_id !== null && !divisionIds.has(row.division_id))) {
    throw new TypeError('Standing references unknown division');
  }
  return { leaders, standings, divisions };
}

function homeSiteOrigin(slug: string) {
  if (!SLUG_PATTERN.test(slug) || slug.length > 63) throw new TypeError('Invalid league slug');
  return `https://${slug}.beerleaguehockey.ca`;
}

async function loadUnifiedPublicHome(slug: string, leagueId: string, season: PresentationSeason | null) {
  if (season && !UUID_PATTERN.test(season.id)) throw new TypeError('Invalid expected season id');
  const url = `${homeSiteOrigin(slug)}/api/public/home?leagueSlug=${slug}${season ? `&seasonId=${season.id}` : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Public Home endpoint returned ${response.status}`);
    const text = await response.text();
    if (utf8ByteLength(text) > MAX_COMPANION_BYTES) throw new TypeError('Public Home payload exceeds byte limit');
    return validateCompanionPayload(JSON.parse(text), leagueId, slug, season);
  } finally { clearTimeout(timeout); }
}

function validateLeague(value: unknown, leagueId: string, leagueSlug: string) {
  const row = record(value);
  if (string(row.id, 'league id') !== leagueId || string(row.slug, 'league slug') !== leagueSlug || row.status !== 'active') {
    throw new TypeError('League identity is inactive or mismatched');
  }
  const configuredTimezone = row.timezone === null ? 'America/Toronto' : string(row.timezone, 'league timezone');
  let timezone: string | null = configuredTimezone;
  try { dateKeyInTimezone(new Date(), configuredTimezone); } catch { timezone = null; }
  return { timezone, settings: row.settings };
}

function validateSeasonRows(value: unknown, leagueId: string) {
  if (!Array.isArray(value)) throw new TypeError('Invalid seasons');
  return value.map((row) => validatePresentationSeason(row, leagueId));
}

function allFailedSnapshot(leagueId: string, leagueSlug: string): HomePublicSnapshot {
  return {
    leagueId, leagueSlug, presentationSeason: null, timezone: null, weekKey: null, divisions: [],
    articles: failed([], 'News is temporarily unavailable.'),
    weeklyGames: failed([], 'This week’s games are temporarily unavailable.'),
    leaders: failed([], 'Current-season leaders are temporarily unavailable.'),
    standings: failed([], 'Standings are temporarily unavailable.'),
    photos: failed([], 'League photos are temporarily unavailable.'),
    albums: failed([], 'League albums are temporarily unavailable.'),
    community: failed([], 'Community links are temporarily unavailable.'),
    sponsors: failed(selectSponsorStrip([]), 'Showing the platform partner while league sponsors are unavailable.'),
  };
}

export async function loadHomePublicSnapshot(leagueId: string, leagueSlug: string, now = new Date()): Promise<HomePublicSnapshot> {
  if (!SLUG_PATTERN.test(leagueSlug) || leagueSlug.length > 63) return allFailedSnapshot(leagueId, leagueSlug);
  const [leagueResult, seasonsResult] = await Promise.all([
    supabase.from('leagues').select('id,name,slug,description,logo_url,banner_url,city,state,timezone,status,settings')
      .eq('id', leagueId).eq('status', 'active').maybeSingle(),
    supabase.from('seasons').select('id,league_id,name,status,start_date,end_date,created_at')
      .eq('league_id', leagueId).order('start_date', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  let league: ReturnType<typeof validateLeague>;
  try {
    if (leagueResult.error || !leagueResult.data) throw leagueResult.error ?? new Error('League not found');
    league = validateLeague(leagueResult.data, leagueId, leagueSlug);
  } catch { return allFailedSnapshot(leagueId, leagueSlug); }

  let presentationSeason: PresentationSeason | null = null;
  let seasonLookupFailed = false;
  try {
    if (seasonsResult.error) throw seasonsResult.error;
    presentationSeason = selectPresentationSeason(validateSeasonRows(seasonsResult.data ?? [], leagueId), leagueId);
  } catch { seasonLookupFailed = true; }

  let weekKey: string | null = null;
  if (league.timezone) {
    try {
      const week = leagueWeek(league.timezone, now);
      weekKey = `${week.mondayKey}:${week.sundayKey}`;
    } catch { weekKey = null; }
  }

  const articlePromise = section<HomeArticle[]>([], 'News is temporarily unavailable.', async () => {
    if (seasonLookupFailed) throw new Error('Season unavailable');
    const result = await supabase.from('articles')
      .select('id,league_id,season_id,title,content,excerpt,image_url,slug,published,published_at,created_at,type')
      .eq('league_id', leagueId).eq('published', true).in('type', ['news', 'game_recap', 'weekly_wrap'])
      .order('published_at', { ascending: false }).limit(18);
    if (result.error) throw result.error;
    return filterArticlesForPresentationSeason(validateArticles(result.data ?? [], leagueId), presentationSeason).slice(0, 5);
  });
  const gamesPromise = section<HomeWeeklyGame[]>([], 'This week’s games are temporarily unavailable.', async () => {
    if (seasonLookupFailed || !league.timezone || !weekKey) throw new Error('Weekly game period unavailable');
    const lower = new Date(now.getTime() - 8 * 86400000).toISOString();
    const upper = new Date(now.getTime() + 8 * 86400000).toISOString();
    let query = supabase.from('games').select(`id,league_id,season_id,scheduled_at,location,home_score,away_score,status,game_type,division_id,home_team_id,away_team_id,
      home_team:teams!games_home_team_id_fkey(id,name,slug,logo_url,primary_color,secondary_color,division_id),
      away_team:teams!games_away_team_id_fkey(id,name,slug,logo_url,primary_color,secondary_color,division_id)`)
      .eq('league_id', leagueId).in('status', [...GAME_STATUSES]).gte('scheduled_at', lower).lte('scheduled_at', upper);
    if (presentationSeason) query = query.eq('season_id', presentationSeason.id);
    const result = await query.order('scheduled_at', { ascending: true });
    if (result.error) throw result.error;
    return filterGamesToLeagueWeek(validateGames(result.data ?? [], leagueId, presentationSeason?.id ?? null), now, league.timezone);
  });
  const unifiedPromise = section(
    { leaders: [] as HomeLeader[], standings: [] as HomeStanding[], divisions: [] as HomeDivision[] },
    'Current-season leaders and standings require the league public Home feed.',
    async () => {
      if (seasonLookupFailed) throw new Error('Season unavailable');
      return loadUnifiedPublicHome(leagueSlug, leagueId, presentationSeason);
    },
  );
  const photosPromise = section<HomePhoto[]>([], 'League photos are temporarily unavailable.', async () => {
    const result = await supabase.from('gallery_photos')
      .select('id,url,caption,gallery_id,league_gallery!inner(id,title,league_id,is_published)')
      .eq('league_gallery.league_id', leagueId).eq('league_gallery.is_published', true)
      .order('created_at', { ascending: false }).limit(12);
    if (result.error) throw result.error;
    return validatePhotos(result.data ?? []);
  });
  const albumsPromise = section<HomeAlbum[]>([], 'League albums are temporarily unavailable.', async () => {
    if (seasonLookupFailed) throw new Error('Season unavailable');
    const result = await supabase.from('league_gallery')
      .select('id,league_id,season_id,title,description,cover_photo_url,is_published,created_at,gallery_photos(count)')
      .eq('league_id', leagueId).eq('is_published', true).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return filterAlbumsForPresentationSeason(validateAlbums(result.data ?? [], leagueId), presentationSeason).slice(0, 3);
  });
  const sponsorsPromise = section<HomeSponsor[]>(selectSponsorStrip([]), 'Showing the platform partner while league sponsors are unavailable.', async () => {
    const result = await supabase.from('league_sponsors')
      .select('id,league_id,name,logo_url,website_url,tier,description,display_order,is_active')
      .eq('league_id', leagueId).eq('is_active', true).order('display_order', { ascending: true });
    if (result.error) throw result.error;
    return selectSponsorStrip(validateSponsors(result.data ?? [], leagueId));
  });

  const [articles, weeklyGames, unified, photos, albums, sponsors] = await Promise.all([
    articlePromise, gamesPromise, unifiedPromise, photosPromise, albumsPromise, sponsorsPromise,
  ]);
  const leaders = unified.status === 'ready' ? ready(unified.data.leaders)
    : failed<HomeLeader[]>([], unified.message ?? 'Leaders unavailable.');
  const standings = unified.status === 'ready' ? ready(unified.data.standings)
    : failed<HomeStanding[]>([], unified.message ?? 'Standings unavailable.');
  const divisions = unified.status === 'ready' ? unified.data.divisions : [];

  let community: HomeSection<HomeSocial[]>;
  try {
    const socials = settingsSocials(league.settings);
    if (socials.length === 0) community = ready([]);
    else {
      const origin = homeSiteOrigin(leagueSlug);
      community = ready([
        ...socials,
        ...(articles.data.length > 0 ? [{ key: 'news', label: 'News', url: `${origin}/news` }] : []),
        ...(albums.data.length > 0 ? [{ key: 'photos', label: 'Photos', url: `${origin}/gallery` }] : []),
        { key: 'contact', label: 'Contact', url: `${origin}/contact` },
      ]);
    }
  } catch { community = failed([], 'Community links are temporarily unavailable.'); }

  return {
    leagueId, leagueSlug, presentationSeason, timezone: league.timezone, weekKey, divisions,
    articles, weeklyGames, leaders, standings, photos, albums, community, sponsors,
  };
}
