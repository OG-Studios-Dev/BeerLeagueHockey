import {
  getLegacyChampions,
  getStandings,
  getUnifiedGoalieStatsRows,
  getUnifiedSkaterStatsRows,
} from './data';
import { filterVisibleSiteSeasons } from './all-time-stats';
import { createServiceRoleClient } from './supabase/server';
import {
  MAX_SERIALIZED_CONTENT_LENGTH,
  articleContentToPlainText,
  isStructuredArticleContent,
} from '@hockey-life/ui/news-article-format';
import type {
  ArticleResponse,
  ArticleSummary,
  ChampionEntry,
  ContentSeason,
  GalleryAlbum,
  GalleryPhoto,
  HistoryAward,
  HistoryBoard,
  HistoryStanding,
  Mention,
  PublicLeagueEvent,
  PublicLeagueContentSource,
  RelatedGame,
  TaggedPlayer,
} from './public-league-content';

export const SOURCE_PAGE_SIZE = 100;
const MAX_ARTICLES = 500;
const MAX_ALBUMS = 500;
const MAX_PHOTOS = 5000;
const MAX_EVENTS = 5000;

type DataRow = Record<string, unknown>;
type QueryResult = { data: DataRow[] | DataRow | null; error: unknown; count?: number | null };
type QueryBuilder = {
  select(value: string, options?: unknown): QueryBuilder;
  eq(key: string, value: unknown): QueryBuilder;
  in(key: string, values: unknown[]): QueryBuilder;
  lte(key: string, value: unknown): QueryBuilder;
  or(filters: string): QueryBuilder;
  order(key: string, options?: unknown): QueryBuilder;
  limit(value: number): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};
export interface PublicContentDatabase { from(table: string): QueryBuilder }

type LeagueInput = {
  id: string; slug: string; name: string; created_at?: string | null; timezone?: string | null;
  contact_email?: string | null; contact_phone?: string | null; website_url?: string | null;
  address?: string | null; city?: string | null; state?: string | null; state_province?: string | null;
  zip_code?: string | null; postal_code?: string | null;
};
type CanonicalSkaterRow = {
  player_id: string; profile_id?: string | null; profile_id_league_verified?: boolean; player_name: string; team_id?: string | null; team_name?: string | null;
  points?: number | null; goals?: number | null; assists?: number | null;
};
type CanonicalGoalieRow = {
  player_id: string; profile_id?: string | null; profile_id_league_verified?: boolean; player_name: string; team_id?: string | null; team_name?: string | null;
  wins?: number | null; games_played?: number | null; saves?: number | null; goals_against?: number | null;
  shots_against?: number | null; save_percentage?: number | null; goals_against_average?: number | null;
  save_percentage_provenance?: 'measured' | 'estimated' | 'unmeasured';
  goals_against_average_provenance?: 'measured' | 'estimated' | 'unmeasured';
};
type CanonicalStandingRow = {
  team_id: string; team_name: string; team_logo?: string | null; games_played: number;
  wins: number; losses: number; ties: number; points: number;
};
export type CanonicalReaders = {
  skaters(leagueId: string, leagueSlug: string): Promise<CanonicalSkaterRow[]>;
  goalies(leagueId: string, leagueSlug: string): Promise<CanonicalGoalieRow[]>;
  standings?(leagueId: string, seasonId: string): Promise<CanonicalStandingRow[]>;
  legacyChampions(leagueSlug: string): Array<{ year: string; photo: string; teamName?: string }>;
};

const canonicalReaders: CanonicalReaders = {
  skaters: (leagueId, leagueSlug) => getUnifiedSkaterStatsRows(leagueId, null, undefined, leagueSlug, undefined, { strict: true }),
  goalies: (leagueId, leagueSlug) => getUnifiedGoalieStatsRows(leagueId, null, undefined, leagueSlug, undefined, { strict: true }),
  standings: (leagueId, seasonId) => getStandings(leagueId, seasonId, { strict: true }),
  legacyChampions: getLegacyChampions,
};

class PublicContentReadError extends Error {
  constructor(readonly table: string) { super(`Public content read failed: ${table}`); }
}
class PublicContentSourceLimitError extends Error {}
class PublicContentIntegrityError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTICLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function integrity(condition: unknown, label: string): asserts condition {
  if (!condition) throw new PublicContentIntegrityError(`Invalid published ${label}`);
}

function text(value: unknown, label: string, maximum = 500): string {
  integrity(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, label);
  return value;
}

function optionalText(value: unknown, label: string, maximum = 4096): string | null {
  if (value == null) return null;
  return text(value, label, maximum);
}

function uuid(value: unknown, label: string): string {
  integrity(typeof value === 'string' && UUID.test(value), label);
  return value;
}

function assertUniqueIds(rows: DataRow[], label: string) {
  const ids = rows.map((row) => uuid(row.id, `${label} id`));
  integrity(new Set(ids).size === ids.length, `duplicate ${label} id`);
}

async function required(result: PromiseLike<QueryResult> | QueryResult, table: string) {
  const resolved = await result;
  if (resolved.error) throw new PublicContentReadError(table);
  return resolved;
}

async function paginate(table: string, maximum: number, build: () => QueryBuilder): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
    const result = await required(build().range(offset, offset + SOURCE_PAGE_SIZE - 1), table);
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (rows.length > maximum) throw new PublicContentSourceLimitError(`${table} exceeds its complete-source cap`);
    if (page.length < SOURCE_PAGE_SIZE) return rows;
  }
}

function joined<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function safeUrl(value: unknown, leagueSlug: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = value.trim();
  if (url.length > 4096) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return `https://${leagueSlug}.beerleaguehockey.ca${url}`;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function finite(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonnegativeInteger(value: unknown, label: string, fallback?: number): number {
  const number = finite(value, fallback ?? null);
  integrity(number != null && Number.isInteger(number) && number >= 0, label);
  return number;
}

function nullableNonnegativeNumber(value: unknown, label: string): number | null {
  const number = finite(value);
  if (number == null) return null;
  integrity(number >= 0, label);
  return number;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value == null) return null;
  integrity(typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)), label);
  return value;
}

function requiredDate(value: unknown, label: string): string {
  const result = optionalDate(value, label);
  integrity(result, label);
  return result;
}

function canonicalDate(value: unknown, label: string): string {
  return new Date(requiredDate(value, label)).toISOString();
}

function nullableText(value: unknown, label: string, maximum = 4096): string | null {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null;
  integrity(typeof value === 'string' && value.length <= maximum, label);
  return value;
}

function validTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return 'UTC';
  }
}

function contactText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  return normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

function contactAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  integrity(normalized.length <= 1000, 'contact address');
  return /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ? null : normalized;
}

function contactWebsiteUrl(value: unknown, leagueSlug: string): string | null {
  const candidate = safeUrl(value, leagueSlug);
  if (!candidate) return null;
  try {
    const normalized = new URL(candidate).toString();
    return normalized.length <= 4096 ? normalized : null;
  } catch {
    return null;
  }
}

function safeEmail(value: unknown): string | null {
  const email = contactText(value, 320);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function safePhone(value: unknown): string | null {
  const phone = contactText(value, 64);
  return phone && /\d/.test(phone) && /^[+0-9().\-\s#*xXeEtT]+$/.test(phone) ? phone : null;
}

function mapEvent(row: DataRow, leagueId: string, windowStart: number, now: number): PublicLeagueEvent {
  integrity(row.league_id === leagueId, 'event league');
  integrity(row.is_published === true, 'event publication');
  const startTime = canonicalDate(row.start_time, 'event start time');
  const endTime = row.end_time == null ? null : canonicalDate(row.end_time, 'event end time');
  const start = Date.parse(startTime);
  const end = endTime == null ? null : Date.parse(endTime);
  integrity(end == null || end >= start, 'event time range');
  integrity(start >= windowStart || (end != null && end >= now), 'event window');
  return {
    id: uuid(row.id, 'event id'),
    title: text(row.title, 'event title', 500),
    description: nullableText(row.description, 'event description', 12000),
    eventType: text(row.event_type, 'event type', 100),
    location: nullableText(row.location, 'event location', 1000),
    startTime,
    endTime,
  };
}

function articleDate(row: DataRow): string | null {
  const value = row.published_at || row.created_at;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function mapArticle(row: DataRow, leagueSlug: string): ArticleSummary {
  const publishedAt = articleDate(row);
  integrity(publishedAt, 'article date');
  integrity(typeof row.type === 'string' && ['news', 'game_recap', 'weekly_wrap'].includes(row.type), 'article type');
  const articleSlug = text(row.slug, 'article slug', 160);
  integrity(ARTICLE_SLUG.test(articleSlug), 'article slug');
  const author = joined<{ full_name?: string | null }>(row.author as { full_name?: string | null } | Array<{ full_name?: string | null }> | null | undefined);
  return {
    id: uuid(row.id, 'article id'),
    slug: articleSlug,
    title: text(row.title, 'article title', 500),
    excerpt: optionalText(row.excerpt, 'article excerpt', 12000),
    imageUrl: safeUrl(row.image_url, leagueSlug),
    type: row.type as ArticleSummary['type'],
    publishedAt,
    authorName: author?.full_name == null ? null : optionalText(author.full_name, 'article author', 200),
    authorId: author?.full_name && row.author_id != null ? uuid(row.author_id, 'article author id') : null,
  };
}

function mapSeason(row: DataRow): ContentSeason {
  return {
    id: uuid(row.id, 'season id'), name: text(row.name, 'season name'),
    startDate: optionalDate(row.start_date, 'season start date'),
    endDate: optionalDate(row.end_date, 'season end date'),
    status: optionalText(row.status, 'season status', 40),
  };
}

function mapAlbum(row: DataRow, seasonById: Map<string, ContentSeason>, photoCount: number, leagueSlug: string): GalleryAlbum {
  const season = typeof row.season_id === 'string' ? seasonById.get(row.season_id) : null;
  return {
    id: uuid(row.id, 'album id'), title: text(row.title, 'album title'),
    description: optionalText(row.description, 'album description', 12000),
    seasonId: season?.id ?? null, seasonName: season?.name ?? null,
    coverUrl: safeUrl(row.cover_photo_url, leagueSlug), photoCount: nonnegativeInteger(photoCount, 'album photo count'),
    createdAt: optionalDate(row.created_at, 'album created date'),
  };
}

function mapPhoto(row: DataRow, leagueSlug: string): GalleryPhoto {
  const imageUrl = safeUrl(row.url, leagueSlug);
  integrity(imageUrl, 'photo image URL');
  return {
    id: uuid(row.id, 'photo id'), albumId: uuid(row.gallery_id, 'photo album id'), imageUrl,
    thumbnailUrl: safeUrl(row.thumbnail_url, leagueSlug),
    caption: optionalText(row.caption, 'photo caption', 4000),
    sortOrder: nonnegativeInteger(row.display_order, 'photo sort order', 0),
  };
}

function mapRelatedGame(row: DataRow | undefined, teams: Map<string, DataRow>, leagueSlug: string): RelatedGame | null {
  if (!row) return null;
  const home = teams.get(String(row.home_team_id));
  const away = teams.get(String(row.away_team_id));
  if (!row.id || !home || !away) return null;
  return {
    id: uuid(row.id, 'game id'), homeTeamId: uuid(home.id, 'home team id'), homeTeamName: text(home.name, 'home team name'), homeTeamLogoUrl: safeUrl(home.logo_url, leagueSlug),
    awayTeamId: uuid(away.id, 'away team id'), awayTeamName: text(away.name, 'away team name'), awayTeamLogoUrl: safeUrl(away.logo_url, leagueSlug),
    homeScore: row.home_score == null ? null : nonnegativeInteger(row.home_score, 'home score'), awayScore: row.away_score == null ? null : nonnegativeInteger(row.away_score, 'away score'), scheduledAt: requiredDate(row.scheduled_at, 'game date'),
    status: optionalText(row.status, 'game status', 40),
  };
}

function seasonYear(row: DataRow) {
  const start = typeof row.start_date === 'string' ? new Date(row.start_date).getUTCFullYear() : null;
  const end = typeof row.end_date === 'string' ? new Date(row.end_date).getUTCFullYear() : null;
  if (!Number.isFinite(start) && !Number.isFinite(end)) return String(row.name);
  if (start === end || !Number.isFinite(end)) return String(start);
  return `${start}-${String(end).slice(-2)}`;
}

function buildStandings(seasonId: string, games: DataRow[], teams: Map<string, DataRow>, rosterTeamIds: Set<string>, leagueSlug: string): HistoryStanding[] {
  const rows = new Map<string, HistoryStanding>();
  const ensure = (teamId: string) => {
    const team = teams.get(teamId);
    if (!team) return null;
    if (!rows.has(teamId)) rows.set(teamId, { teamId: uuid(teamId, 'standing team id'), teamName: text(team.name, 'standing team name'), teamLogoUrl: safeUrl(team.logo_url, leagueSlug), gamesPlayed: 0, wins: 0, losses: 0, ties: 0, points: 0 });
    return rows.get(teamId)!;
  };
  for (const teamId of rosterTeamIds) ensure(teamId);
  for (const game of games.filter((candidate) => candidate.season_id === seasonId)) {
    const home = ensure(String(game.home_team_id));
    const away = ensure(String(game.away_team_id));
    if (!home || !away) continue;
    const homeScore = nonnegativeInteger(game.home_score, 'completed game home score');
    const awayScore = nonnegativeInteger(game.away_score, 'completed game away score');
    home.gamesPlayed += 1; away.gamesPlayed += 1;
    if (homeScore > awayScore) { home.wins += 1; home.points += 2; away.losses += 1; }
    else if (awayScore > homeScore) { away.wins += 1; away.points += 2; home.losses += 1; }
    else { home.ties += 1; away.ties += 1; home.points += 1; away.points += 1; }
  }
  return [...rows.values()].sort((left, right) => right.points - left.points || right.wins - left.wins || left.teamName.localeCompare(right.teamName) || left.teamId.localeCompare(right.teamId));
}

export function createPublicLeagueContentSource(
  database: PublicContentDatabase,
  league: LeagueInput,
  now: Date,
  canonical: CanonicalReaders = canonicalReaders,
): PublicLeagueContentSource {
  const loadNewsRows = () => paginate('articles', MAX_ARTICLES, () => database
    .from('articles')
    .select('id, league_id, slug, title, excerpt, image_url, type, published, published_at, created_at, author_id, author:profiles!articles_author_id_fkey(full_name)')
    .eq('league_id', league.id)
    .eq('published', true)
    .in('type', ['news', 'game_recap', 'weekly_wrap'])
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }));

  const loadNews = async () => {
    const rows = (await loadNewsRows())
      .map((row) => mapArticle(row, league.slug))
      .filter((row) => Date.parse(row.publishedAt) <= now.getTime());
    integrity(new Set(rows.map((row) => row.id)).size === rows.length, 'duplicate article id');
    return rows.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
  };

  const loadPublishedAlbumRow = async (albumId: string) => {
    const result = await required(database.from('league_gallery')
      .select('id, league_id, season_id, title, description, cover_photo_url, is_published, created_at')
      .eq('league_id', league.id).eq('is_published', true).eq('id', albumId).limit(1).maybeSingle(), 'league_gallery');
    return result.data && !Array.isArray(result.data) ? result.data : result.data?.[0] ?? null;
  };

  const loadPhotos = async (albumIds: string[]) => {
    if (albumIds.length === 0) return [];
    return paginate('gallery_photos', MAX_PHOTOS, () => database.from('gallery_photos')
      .select('id, gallery_id, url, thumbnail_url, caption, display_order')
      .in('gallery_id', albumIds)
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }));
  };

  const loadSeasonRows = async () => {
    const rows = filterVisibleSiteSeasons(await paginate('seasons', 500, () => database.from('seasons')
      .select('id, league_id, name, start_date, end_date, status, champion_team_id, photo_gallery_url, season_summary')
      .eq('league_id', league.id).order('start_date', { ascending: false }).order('id', { ascending: true })));
    assertUniqueIds(rows, 'season');
    return rows;
  };
  const loadSeasons = async () => (await loadSeasonRows()).map(mapSeason);

  const loadEvents = async () => {
    const nowTime = now.getTime();
    integrity(Number.isFinite(nowTime), 'event generation time');
    const generatedAt = now.toISOString();
    const windowStart = new Date(nowTime - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await paginate('league_events', MAX_EVENTS, () => database.from('league_events')
      .select('id, league_id, title, description, event_type, location, start_time, end_time, is_published')
      .eq('league_id', league.id)
      .eq('is_published', true)
      .or(`start_time.gte.${windowStart},end_time.gte.${generatedAt}`)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true }));
    assertUniqueIds(rows, 'event');
    const events = rows.map((row) => mapEvent(row, league.id, Date.parse(windowStart), nowTime))
      .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.id.localeCompare(right.id));
    return { timeZone: validTimeZone(league.timezone), windowStart, events };
  };

  const loadContact = async () => ({
    email: safeEmail(league.contact_email),
    phone: safePhone(league.contact_phone),
    websiteUrl: contactWebsiteUrl(league.website_url, league.slug),
    address: contactAddress(league.address),
    city: contactText(league.city, 200),
    state: contactText(league.state ?? league.state_province, 200),
    zipCode: contactText(league.zip_code ?? league.postal_code, 40),
  });

  return {
    loadNews,
    loadEvents,
    loadContact,
    async loadArticle(slug): Promise<ArticleResponse['article'] | null> {
      const rows = await loadNewsRows();
      const row = rows.find((candidate) => candidate.slug === slug || candidate.id === slug);
      const detailDate = row ? articleDate(row) : null;
      const summary = row && detailDate && Date.parse(detailDate) <= now.getTime() ? mapArticle(row, league.slug) : null;
      if (!row || !summary) return null;
      const detailResult = await required(database.from('articles')
        .select('id, league_id, content, game_id, season_id, published, published_at, created_at')
        .eq('league_id', league.id).eq('published', true).eq('id', row.id).limit(1).maybeSingle(), 'articles');
      const detail = detailResult.data && !Array.isArray(detailResult.data) ? detailResult.data : detailResult.data?.[0] ?? null;
      if (!detail) return null;
      const storedContent = text(
        detail.content,
        'stored article content',
        MAX_SERIALIZED_CONTENT_LENGTH,
      );
      const content = text(
        isStructuredArticleContent(storedContent)
          ? articleContentToPlainText(storedContent)
          : storedContent,
        'article content',
        512 * 1024,
      );
      const [playerTags, teamTags, gameTags, seasonRows] = await Promise.all([
        paginate('article_player_tags', 200, () => database.from('article_player_tags').select('article_id, player_id').eq('article_id', row.id).order('player_id')),
        paginate('article_team_tags', 200, () => database.from('article_team_tags').select('article_id, team_id').eq('article_id', row.id).order('team_id')),
        paginate('article_game_tags', 200, () => database.from('article_game_tags').select('article_id, game_id, is_primary').eq('article_id', row.id).order('is_primary', { ascending: false }).order('game_id')),
        loadSeasonRows(),
      ]);
      const visibleSeasonIds = new Set(seasonRows.map((season) => String(season.id)));
      const articleIsSeasonScoped = typeof detail.season_id === 'string';
      const articleSeasonId = typeof detail.season_id === 'string' && visibleSeasonIds.has(detail.season_id)
        ? detail.season_id
        : null;
      const playerIds = [...new Set(playerTags.map((tag) => String(tag.player_id)).filter(Boolean))];
      const rosterRows = playerIds.length ? await paginate('team_rosters', 1000, () => database.from('team_rosters')
        .select('league_id, season_id, player_id, team_id, profile:profiles!team_rosters_player_id_fkey(id, full_name, avatar_url), team:teams!inner(id, league_id, name)')
        .eq('league_id', league.id).in('player_id', playerIds).order('player_id').order('season_id').order('team_id')) : [];
      const taggedPlayers: TaggedPlayer[] = [];
      for (const playerId of playerIds) {
        const candidates = rosterRows.filter((candidate) => candidate.player_id === playerId);
        const identityRoster = candidates[0];
        const profile = joined<DataRow>(identityRoster?.profile as DataRow | DataRow[] | null | undefined);
        if (!identityRoster || !profile?.id || !profile.full_name) continue;
        const periodRoster = articleIsSeasonScoped
          ? articleSeasonId ? candidates.find((candidate) => candidate.season_id === articleSeasonId) : undefined
          : candidates.find((candidate) => {
              const season = seasonRows.find((value) => value.id === candidate.season_id);
              const instant = Date.parse(summary.publishedAt);
              const start = typeof season?.start_date === 'string' ? Date.parse(season.start_date) : Number.NaN;
              const end = typeof season?.end_date === 'string' ? Date.parse(season.end_date) : Number.NaN;
              return Number.isFinite(start) && start <= instant && (!Number.isFinite(end) || instant <= end);
            });
        const team = joined<DataRow>(periodRoster?.team as DataRow | DataRow[] | null | undefined);
        const validTeam = team?.id && team.league_id === league.id ? team : null;
        taggedPlayers.push({
          id: uuid(profile.id, 'tagged player id'),
          name: text(profile.full_name, 'tagged player name'),
          photoUrl: safeUrl(profile.avatar_url, league.slug),
          teamId: validTeam ? uuid(validTeam.id, 'tagged player team id') : null,
          teamName: validTeam ? text(validTeam.name, 'tagged player team name') : null,
        });
      }
      const explicitTeamIds = [...new Set(teamTags.map((tag) => String(tag.team_id)).filter(Boolean))];
      const gameIds = [...new Set([...gameTags.map((tag) => String(tag.game_id)), detail.game_id ? String(detail.game_id) : ''].filter(Boolean))];
      const [unfilteredTeamRows, gameRows, participationRows] = await Promise.all([
        explicitTeamIds.length ? paginate('teams', 500, () => database.from('teams').select('id, league_id, name, logo_url').eq('league_id', league.id).in('id', explicitTeamIds).order('id')) : [],
        gameIds.length ? paginate('games', 500, () => database.from('games').select('id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, scheduled_at, status').eq('league_id', league.id).in('id', gameIds).order('scheduled_at')) : [],
        articleSeasonId ? paginate('team_rosters', 10000, () => database.from('team_rosters').select('league_id, season_id, team_id').eq('league_id', league.id).eq('season_id', articleSeasonId).order('team_id')) : [],
      ]);
      assertUniqueIds(unfilteredTeamRows, 'team');
      assertUniqueIds(gameRows, 'game');
      const participationTeamIds = new Set(participationRows.map((roster) => String(roster.team_id)));
      for (const game of gameRows.filter((candidate) => candidate.season_id === articleSeasonId)) {
        participationTeamIds.add(String(game.home_team_id));
        participationTeamIds.add(String(game.away_team_id));
      }
      const teamRows = articleIsSeasonScoped
        ? unfilteredTeamRows.filter((team) => participationTeamIds.has(String(team.id)))
        : unfilteredTeamRows;
      const allGameTeamIds = [...new Set(gameRows.flatMap((game) => [String(game.home_team_id), String(game.away_team_id)]))];
      const gameTeamRows = allGameTeamIds.length ? await paginate('teams', 500, () => database.from('teams').select('id, league_id, name, logo_url').eq('league_id', league.id).in('id', allGameTeamIds).order('id')) : [];
      const teams = new Map([...teamRows, ...gameTeamRows].map((team) => [String(team.id), team]));
      const validGames = gameRows.filter((game) => visibleSeasonIds.has(String(game.season_id))
        && (!articleIsSeasonScoped || game.season_id === articleSeasonId)
        && teams.has(String(game.home_team_id)) && teams.has(String(game.away_team_id)));
      const primaryId = gameTags.find((tag) => tag.is_primary)?.game_id || detail.game_id || null;
      const relatedGame = mapRelatedGame(validGames.find((game) => game.id === primaryId), teams, league.slug);
      const mentions: Mention[] = [
        ...taggedPlayers.map((player) => ({ text: player.name, kind: 'player' as const, id: player.id })),
        ...teamRows.map((team) => ({ text: String(team.name), kind: 'team' as const, id: String(team.id) })),
        ...validGames.map((game) => ({ text: text(`${String(teams.get(String(game.away_team_id))!.name)} @ ${String(teams.get(String(game.home_team_id))!.name)}`, 'game mention', 500), kind: 'game' as const, id: uuid(game.id, 'game mention id') })),
      ];
      return { ...summary, content, mentions, taggedPlayers, relatedGame };
    },
    async loadHistory() {
      const [seasonRows, teamRows, gameRows, playoffSeriesRows, rosterRows, awardRows, _skaterProbe, _goalieProbe, skaters, goalies] = await Promise.all([
        loadSeasonRows(),
        paginate('teams', 500, () => database.from('teams').select('id, league_id, name, logo_url').eq('league_id', league.id).order('name').order('id')),
        paginate('games', 10000, () => database.from('games').select('id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, scheduled_at, status, game_type, playoff_series_id').eq('league_id', league.id).eq('status', 'completed').order('scheduled_at').order('id')),
        paginate('playoff_series', 5000, () => database.from('playoff_series').select('id, league_id, season_id, round_number, series_number, high_seed_id, low_seed_id, winner_id, status, division_id').eq('league_id', league.id).order('season_id').order('round_number').order('series_number').order('id')),
        paginate('team_rosters', 10000, () => database.from('team_rosters').select('league_id, season_id, team_id, player_id, jersey_number, position, leadership_role, status, profile:profiles!team_rosters_player_id_fkey(id, full_name)').eq('league_id', league.id).order('season_id').order('team_id').order('player_id')),
        paginate('league_awards', 1000, () => database.from('league_awards').select('id, league_id, season_id, player_id, team_id, award_name, description, image_url, player:profiles(full_name)').eq('league_id', league.id).order('created_at', { ascending: false }).order('id')),
        required(database.from('player_stats').select('id, game:games!inner(league_id)').eq('game.league_id', league.id).limit(1), 'player_stats'),
        required(database.from('goalie_stats').select('id, game:games!inner(league_id)').eq('game.league_id', league.id).limit(1), 'goalie_stats'),
        canonical.skaters(league.id, league.slug),
        canonical.goalies(league.id, league.slug),
      ]);
      assertUniqueIds(teamRows, 'team');
      assertUniqueIds(gameRows, 'game');
      assertUniqueIds(playoffSeriesRows, 'playoff series');
      assertUniqueIds(awardRows, 'award');
      const seasons = seasonRows.map(mapSeason);
      const seasonMap = new Map(seasonRows.map((season) => [String(season.id), season]));
      const teams = new Map(teamRows.map((team) => [String(team.id), team]));
      const rosterTeamsBySeason = new Map<string, Set<string>>();
      for (const roster of rosterRows) {
        const set = rosterTeamsBySeason.get(String(roster.season_id)) || new Set<string>();
        set.add(String(roster.team_id)); rosterTeamsBySeason.set(String(roster.season_id), set);
      }
      const standings = new Map(seasonRows.map((season) => [String(season.id), buildStandings(String(season.id), gameRows, teams, rosterTeamsBySeason.get(String(season.id)) || new Set(), league.slug)]));
      if (canonical.standings) {
        const canonicalStandings = await Promise.all(seasonRows.map((season) => canonical.standings!(league.id, String(season.id))));
        canonicalStandings.forEach((rows, index) => {
          const verifiedRows = rows.filter((row) => teams.has(String(row.team_id))).map((row) => ({
            teamId: uuid(row.team_id, 'standing team id'), teamName: text(row.team_name, 'standing team name'), teamLogoUrl: safeUrl(row.team_logo, league.slug),
            gamesPlayed: nonnegativeInteger(row.games_played, 'standing games played'), wins: nonnegativeInteger(row.wins, 'standing wins'), losses: nonnegativeInteger(row.losses, 'standing losses'),
            ties: nonnegativeInteger(row.ties, 'standing ties'), points: nonnegativeInteger(row.points, 'standing points'),
          })).sort((left, right) => right.points - left.points || right.wins - left.wins || left.teamName.localeCompare(right.teamName) || left.teamId.localeCompare(right.teamId));
          if (verifiedRows.length > 0) standings.set(String(seasonRows[index].id), verifiedRows);
        });
      }
      const champions: ChampionEntry[] = [];
      for (const season of seasonRows) {
        const candidateOfficialTeam = season.champion_team_id ? teams.get(String(season.champion_team_id)) : null;
        const seasonStandings = standings.get(String(season.id)) || [];
        const seasonGames = gameRows.filter((game) => game.season_id === season.id);
        const participated = candidateOfficialTeam && (
          rosterTeamsBySeason.get(String(season.id))?.has(String(candidateOfficialTeam.id))
          || seasonGames.some((game) => game.home_team_id === candidateOfficialTeam.id || game.away_team_id === candidateOfficialTeam.id)
          || seasonStandings.some((candidate) => candidate.teamId === candidateOfficialTeam.id)
        );
        const officialTeam = season.status === 'completed' && participated ? candidateOfficialTeam : null;
        const standing = officialTeam
          ? seasonStandings.find((candidate) => candidate.teamId === officialTeam.id) ?? null
          : !season.champion_team_id && season.status === 'completed'
            ? seasonStandings[0] ?? null
            : null;
        const source = officialTeam ? 'official' as const : standing ? 'standings_leader' as const : null;
        const team = officialTeam || (standing ? teams.get(standing.teamId) : null);
        if (!source || !team) continue;
        const championshipRoster = source === 'official' ? rosterRows
          .filter((roster) => roster.season_id === season.id && roster.team_id === team.id && typeof roster.status === 'string' && ['active', 'injured'].includes(roster.status))
          .map((roster) => {
            const profile = joined<DataRow>(roster.profile as DataRow | DataRow[] | null | undefined);
            return profile?.id && profile.full_name ? {
              id: uuid(profile.id, 'champion player id'),
              name: text(profile.full_name, 'champion player name'),
              jerseyNumber: roster.jersey_number == null ? null : nonnegativeInteger(roster.jersey_number, 'champion jersey number'),
              position: optionalText(roster.position, 'champion player position', 80),
              leadershipRole: optionalText(roster.leadership_role, 'champion leadership role', 80),
            } : null;
          }).filter(Boolean) as ChampionEntry['roster'] : [];
        const seasonSeries = playoffSeriesRows.filter((series) => series.season_id === season.id && series.league_id === league.id);
        const completedWinningSeries = source === 'official' ? seasonSeries.filter((series) => {
          if (series.status !== 'completed' || series.winner_id !== team.id) return false;
          const participants = [series.high_seed_id, series.low_seed_id].filter((id): id is string => typeof id === 'string');
          if (participants.length !== 2 || !participants.includes(String(team.id))) return false;
          const round = finite(series.round_number);
          if (round == null || !Number.isInteger(round) || round < 1) return false;
          const division = series.division_id == null ? null : String(series.division_id);
          const bracketRounds = seasonSeries
            .filter((candidate) => (candidate.division_id == null ? null : String(candidate.division_id)) === division)
            .map((candidate) => finite(candidate.round_number))
            .filter((candidate): candidate is number => candidate != null && Number.isInteger(candidate) && candidate >= 1);
          return bracketRounds.length > 0 && round === Math.max(...bracketRounds);
        }) : [];
        const finalRow = seasonGames
          .filter((game) => completedWinningSeries.some((series) => {
            if (game.game_type !== 'playoff' || game.playoff_series_id !== series.id) return false;
            const seriesTeams = new Set([String(series.high_seed_id), String(series.low_seed_id)]);
            if (seriesTeams.size !== 2 || !seriesTeams.has(String(game.home_team_id)) || !seriesTeams.has(String(game.away_team_id))) return false;
            return (game.home_team_id === team.id && finite(game.home_score)! > finite(game.away_score)!)
              || (game.away_team_id === team.id && finite(game.away_score)! > finite(game.home_score)!);
          }))
          .sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at)) || String(a.id).localeCompare(String(b.id)))[0];
        champions.push({
          id: String(season.id), source, year: text(seasonYear(season), 'champion year', 40), seasonId: String(season.id), seasonName: text(season.name, 'champion season name'),
          teamId: uuid(team.id, 'champion team id'), teamName: text(team.name, 'champion team name'), teamLogoUrl: safeUrl(team.logo_url, league.slug),
          photoUrl: safeUrl(Array.isArray(season.photo_gallery_url) ? season.photo_gallery_url[0] : null, league.slug),
          record: standing ? { wins: standing.wins, losses: standing.losses, ties: standing.ties } : null,
          roster: championshipRoster, finalGame: finalRow ? mapRelatedGame(finalRow, teams, league.slug) : null,
          summary: optionalText(season.season_summary, 'champion summary', 12000), caption: null,
        });
      }
      for (const legacy of canonical.legacyChampions(league.slug)) champions.push({ id: `legacy:${league.slug}:${legacy.year}`, source: 'legacy', year: text(legacy.year, 'legacy champion year', 40), seasonId: null, seasonName: text(`${legacy.year} Season`, 'legacy champion season name'), teamId: null, teamName: text(legacy.teamName || `${legacy.year} Champions`, 'legacy champion team name'), teamLogoUrl: null, photoUrl: safeUrl(legacy.photo, league.slug), record: null, roster: [], finalGame: null, summary: null, caption: optionalText(legacy.teamName, 'legacy champion caption', 2000) });
      const chronology = (entry: ChampionEntry) => {
        const season = entry.seasonId ? seasonMap.get(entry.seasonId) : null;
        const start = typeof season?.start_date === 'string' ? Date.parse(season.start_date) : Number.NaN;
        const end = typeof season?.end_date === 'string' ? Date.parse(season.end_date) : Number.NaN;
        const legacy = Date.UTC(parseInt(entry.year, 10), 0, 1);
        return [Number.isFinite(start) ? start : legacy, Number.isFinite(end) ? end : Number.isFinite(start) ? start : legacy];
      };
      champions.sort((left, right) => chronology(left)[0] - chronology(right)[0] || chronology(left)[1] - chronology(right)[1] || left.id.localeCompare(right.id));
      const titleCounts = new Map<string, number>();
      for (const champion of champions.filter((entry) => entry.source === 'official' && entry.teamId)) titleCounts.set(champion.teamId!, (titleCounts.get(champion.teamId!) || 0) + 1);
      const dynasties = [...titleCounts].map(([teamId, titles]) => ({ teamId, teamName: String(teams.get(teamId)!.name), teamLogoUrl: safeUrl(teams.get(teamId)!.logo_url, league.slug), titles })).sort((a, b) => b.titles - a.titles || a.teamName.localeCompare(b.teamName) || a.teamId.localeCompare(b.teamId));
      const rosterPlayerIds = new Set(rosterRows.map((roster) => String(roster.player_id)));
      const publicProfileId = (row: { player_id: string; profile_id?: string | null; profile_id_league_verified?: boolean }) => row.profile_id_league_verified && row.profile_id && UUID.test(row.profile_id)
        ? row.profile_id
        : rosterPlayerIds.has(String(row.player_id)) && UUID.test(String(row.player_id)) ? String(row.player_id) : null;
      const makeBoard = (metric: 'points' | 'goals' | 'assists', title: string): HistoryBoard => ({ metric, title, limit: 25, entries: [...skaters].sort((a, b) => (finite(b[metric], 0)! - finite(a[metric], 0)!) || String(a.player_name).localeCompare(String(b.player_name)) || String(a.player_id).localeCompare(String(b.player_id))).slice(0, 25).map((row) => ({ id: text(`${metric}:${row.player_id}`, 'leader id', 128), playerId: publicProfileId(row), name: text(row.player_name, 'leader name'), teamId: teams.has(String(row.team_id)) ? uuid(row.team_id, 'leader team id') : null, teamName: optionalText(row.team_name, 'leader team name'), value: nullableNonnegativeNumber(row[metric], 'leader value'), savePercentage: null, goalsAgainstAverage: null, provenance: 'canonical_all_time' })) });
      const goalieBoard: HistoryBoard = {
        metric: 'wins', title: 'Goalie Wins', limit: 25,
        entries: [...goalies]
          .sort((a, b) => (finite(b.wins, 0)! - finite(a.wins, 0)!) || String(a.player_name).localeCompare(String(b.player_name)) || String(a.player_id).localeCompare(String(b.player_id)))
          .slice(0, 25)
          .map((row) => {
            const imported = row.team_name === 'Imported career totals';
            const saveState = row.save_percentage_provenance
              ?? (finite(row.save_percentage) == null || (imported && finite(row.save_percentage) === 0 && finite(row.saves) === 0) ? 'unmeasured' : 'measured');
            const gaaState = row.goals_against_average_provenance
              ?? (finite(row.goals_against_average) == null || (imported && finite(row.goals_against_average) === 0 && finite(row.games_played) === 0) ? 'unmeasured' : 'measured');
            const savePercentage = saveState === 'unmeasured' ? null : nullableNonnegativeNumber(row.save_percentage, 'save percentage');
            const goalsAgainstAverage = gaaState === 'unmeasured' ? null : nullableNonnegativeNumber(row.goals_against_average, 'goals against average');
            return {
              id: text(`wins:${row.player_id}`, 'goalie leader id', 128),
              playerId: publicProfileId(row),
              name: text(row.player_name, 'goalie leader name'),
              teamId: teams.has(String(row.team_id)) ? uuid(row.team_id, 'goalie leader team id') : null,
              teamName: optionalText(row.team_name, 'goalie leader team name'),
              value: nullableNonnegativeNumber(row.wins, 'goalie wins'), savePercentage, goalsAgainstAverage,
              provenance: saveState === 'measured' && gaaState === 'measured'
                ? 'canonical_all_time'
                : saveState === 'unmeasured' && gaaState === 'unmeasured'
                  ? 'canonical_all_time_unmeasured'
                  : `canonical_all_time:sv_${saveState}:gaa_${gaaState}`,
            };
          }),
      };
      const awards: HistoryAward[] = awardRows.map((award) => {
        const validSeason = award.season_id && seasonMap.has(String(award.season_id)) ? seasonMap.get(String(award.season_id)) : null;
        const invalidSeasonReference = Boolean(award.season_id && !validSeason);
        const seasonRosters = invalidSeasonReference ? [] : validSeason ? rosterRows.filter((roster) => roster.season_id === validSeason.id) : rosterRows;
        const candidateTeam = award.team_id && teams.has(String(award.team_id)) ? teams.get(String(award.team_id)) : null;
        const candidatePlayerRows = award.player_id ? seasonRosters.filter((roster) => roster.player_id === award.player_id) : [];
        const coherentWinner = Boolean(award.player_id && candidatePlayerRows.length > 0
          && (!award.team_id || candidatePlayerRows.some((roster) => roster.team_id === award.team_id)));
        const coherentTeam = Boolean(!invalidSeasonReference && candidateTeam && (!validSeason || seasonRosters.some((roster) => roster.team_id === candidateTeam.id))
          && (!award.player_id || coherentWinner));
        const player = coherentWinner ? joined<DataRow>(award.player as DataRow | DataRow[] | null | undefined) : null;
        return { id: uuid(award.id, 'award id'), title: text(award.award_name, 'award title'), description: optionalText(award.description, 'award description', 4000), seasonId: validSeason ? uuid(validSeason.id, 'award season id') : null, seasonName: validSeason ? text(validSeason.name, 'award season name') : null, winnerName: typeof player?.full_name === 'string' ? text(player.full_name, 'award winner name') : null, playerId: coherentWinner ? uuid(award.player_id, 'award player id') : null, teamId: coherentTeam ? uuid(candidateTeam!.id, 'award team id') : null, imageUrl: safeUrl(award.image_url, league.slug) };
      });
      const officialTeamIds = new Set(champions.filter((entry) => entry.source === 'official').map((entry) => entry.teamId).filter(Boolean));
      const founded = league.created_at && Number.isFinite(Date.parse(league.created_at)) ? nonnegativeInteger(new Date(league.created_at).getUTCFullYear(), 'founding year') : null;
      return { foundingYear: founded, seasons, champions, seasonStandings: seasons.map((season) => ({ seasonId: season.id, rows: standings.get(season.id) || [] })), dynasties, boards: [makeBoard('points', 'Points Leaders'), makeBoard('goals', 'Goals Leaders'), makeBoard('assists', 'Assists Leaders'), goalieBoard], awards, stats: { totalSeasons: seasons.length, totalGames: gameRows.length, totalTeams: teamRows.length, uniqueChampions: officialTeamIds.size } };
    },
    async loadGallery() {
      const [seasons, albumRows] = await Promise.all([
        loadSeasons(),
        paginate('league_gallery', MAX_ALBUMS, () => database.from('league_gallery')
          .select('id, league_id, season_id, title, description, cover_photo_url, is_published, created_at')
          .eq('league_id', league.id).eq('is_published', true)
          .order('created_at', { ascending: false }).order('id', { ascending: true })),
      ]);
      const uniqueRows = [...new Map(albumRows.map((row) => [String(row.id), row])).values()];
      const photos = await loadPhotos(uniqueRows.map((row) => String(row.id)));
      const counts = new Map<string, number>();
      const mappedPhotos = photos.map((photo) => mapPhoto(photo, league.slug));
      integrity(new Set(mappedPhotos.map((photo) => photo.id)).size === mappedPhotos.length, 'duplicate photo id');
      for (const photo of mappedPhotos) counts.set(photo.albumId, (counts.get(photo.albumId) || 0) + 1);
      const seasonById = new Map(seasons.map((season) => [season.id, season]));
      integrity(uniqueRows.length === albumRows.length, 'duplicate album id');
      return { seasons, albums: uniqueRows.map((row) => mapAlbum(row, seasonById, counts.get(String(row.id)) || 0, league.slug)) };
    },
    async loadAlbum(albumId) {
      const albumRow = await loadPublishedAlbumRow(albumId);
      if (!albumRow) return null;
      const [seasons, photoRows] = await Promise.all([loadSeasons(), loadPhotos([albumId])]);
      const photos = photoRows.map((photo) => mapPhoto(photo, league.slug));
      integrity(new Set(photos.map((photo) => photo.id)).size === photos.length, 'duplicate photo id');
      return { album: mapAlbum(albumRow, new Map(seasons.map((season) => [season.id, season])), photos.length, league.slug), photos };
    },
  };
}

export function createDefaultPublicLeagueContentSource(league: LeagueInput, now: Date): PublicLeagueContentSource {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasReadKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.SUPABASE_SECRET_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (!hasUrl || !hasReadKey) throw new PublicContentReadError('configuration');
  return createPublicLeagueContentSource(createServiceRoleClient() as unknown as PublicContentDatabase, league, now);
}
