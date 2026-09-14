import { NextRequest, NextResponse } from 'next/server';

import { getLeagueBySlug, hasPlatformSubscription } from '@/lib/data';
import { createDefaultPublicLeagueContentSource } from '@/lib/public-league-content-source';

export type ContentView = 'news' | 'article' | 'history' | 'gallery' | 'album';
export interface ContentLeague { id: string; slug: string; name: string; logoUrl: string | null }
export interface ContentBase { schemaVersion: 1; view: ContentView; league: ContentLeague }
export interface ArticleSummary { id: string; slug: string; title: string; excerpt: string | null; imageUrl: string | null; type: 'news' | 'game_recap' | 'weekly_wrap'; publishedAt: string; authorName: string | null; authorId: string | null }
export interface Mention { text: string; kind: 'player' | 'team' | 'game'; id: string }
export interface RelatedGame { id: string | null; homeTeamId: string | null; homeTeamName: string; homeTeamLogoUrl: string | null; awayTeamId: string | null; awayTeamName: string; awayTeamLogoUrl: string | null; homeScore: number | null; awayScore: number | null; scheduledAt: string; status: string | null }
export interface TaggedPlayer { id: string; name: string; photoUrl: string | null; teamId: string | null; teamName: string | null }
export interface NewsResponse extends ContentBase { view: 'news'; articles: ArticleSummary[]; total: number }
export interface ArticleResponse extends ContentBase { view: 'article'; article: ArticleSummary & { content: string; mentions: Mention[]; taggedPlayers: TaggedPlayer[]; relatedGame: RelatedGame | null } }
export interface ContentSeason { id: string; name: string; startDate: string | null; endDate: string | null; status: string | null }
export interface ChampionEntry { id: string; source: 'official' | 'standings_leader' | 'legacy'; year: string; seasonId: string | null; seasonName: string; teamId: string | null; teamName: string; teamLogoUrl: string | null; photoUrl: string | null; record: { wins: number; losses: number; ties: number } | null; roster: Array<{ id: string; name: string; jerseyNumber: number | null; position: string | null; leadershipRole: string | null }>; finalGame: RelatedGame | null; summary: string | null; caption: string | null }
export interface HistoryLeader { id: string; playerId: string | null; name: string; teamId: string | null; teamName: string | null; value: number | null; savePercentage: number | null; goalsAgainstAverage: number | null; provenance: string | null }
export interface HistoryBoard { metric: 'points' | 'goals' | 'assists' | 'wins'; title: string; entries: HistoryLeader[]; limit: 25 }
export interface HistoryAward { id: string; title: string; description: string | null; seasonId: string | null; seasonName: string | null; winnerName: string | null; playerId: string | null; teamId: string | null; imageUrl: string | null }
export interface HistoryStanding { teamId: string; teamName: string; teamLogoUrl: string | null; gamesPlayed: number; wins: number; losses: number; ties: number; points: number }
export interface HistoryResponse extends ContentBase { view: 'history'; foundingYear: number | null; seasons: ContentSeason[]; champions: ChampionEntry[]; seasonStandings: Array<{ seasonId: string; rows: HistoryStanding[] }>; dynasties: Array<{ teamId: string; teamName: string; teamLogoUrl: string | null; titles: number }>; boards: HistoryBoard[]; awards: HistoryAward[]; stats: { totalSeasons: number; totalGames: number; totalTeams: number; uniqueChampions: number } }
export interface GalleryAlbum { id: string; title: string; description: string | null; seasonId: string | null; seasonName: string | null; coverUrl: string | null; photoCount: number; createdAt: string | null }
export interface GalleryPhoto { id: string; albumId: string; imageUrl: string; thumbnailUrl: string | null; caption: string | null; sortOrder: number }
export interface GalleryResponse extends ContentBase { view: 'gallery'; seasons: ContentSeason[]; albums: GalleryAlbum[]; total: number }
export interface AlbumResponse extends ContentBase { view: 'album'; album: GalleryAlbum; photos: GalleryPhoto[]; total: number }
export type ContentResponse = NewsResponse | ArticleResponse | HistoryResponse | GalleryResponse | AlbumResponse;

export type ContentHistory = Omit<HistoryResponse, keyof ContentBase | 'view'>;
export interface PublicLeagueContentSource {
  loadNews(): Promise<ArticleSummary[]>;
  loadArticle(slug: string): Promise<ArticleResponse['article'] | null>;
  loadHistory(): Promise<ContentHistory>;
  loadGallery(): Promise<{ seasons: ContentSeason[]; albums: GalleryAlbum[] }>;
  loadAlbum(albumId: string): Promise<{ album: GalleryAlbum; photos: GalleryPhoto[] } | null>;
}

type LeagueSource = {
  id: string; slug: string; name: string; logo_url?: string | null; status?: string | null;
  created_at?: string | null; custom_domain?: string | null; custom_domain_verified?: boolean | null;
};

export interface PublicLeagueContentDependencies {
  now(): Date;
  getLeagueBySlug(slug: string): Promise<LeagueSource | null>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
  createSource(league: LeagueSource, now: Date): PublicLeagueContentSource;
}

const defaultDependencies: PublicLeagueContentDependencies = {
  now: () => new Date(),
  getLeagueBySlug: async (slug) => getLeagueBySlug(slug),
  hasPlatformSubscription,
  createSource: (league, now) => createDefaultPublicLeagueContentSource(league, now),
};

const MAX_RESPONSE_BYTES = 512 * 1024;
const ALLOWED = new Set(['leagueSlug', 'view', 'articleSlug', 'albumId']);
const VIEWS = new Set<ContentView>(['news', 'article', 'history', 'gallery', 'album']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTICLE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PayloadLimitError extends Error {}

function publicMediaUrl(value: string | null | undefined, leagueSlug: string): string | null {
  if (!value?.trim()) return null;
  if (value.trim().length > 4096) return null;
  const candidate = value.trim().startsWith('/') && !value.trim().startsWith('//')
    ? `https://${leagueSlug}.beerleaguehockey.ca${value.trim()}`
    : value.trim();
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function tenantHost(hostHeader: string | null): { kind: 'slug'; value: string } | { kind: 'custom'; value: string } | { kind: 'unbound' } {
  if (!hostHeader) return { kind: 'unbound' };
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return { kind: 'unbound' };
  if (host === 'beerleaguehockey.ca' || host === 'api.beerleaguehockey.ca' || host === 'www.beerleaguehockey.ca') return { kind: 'unbound' };
  if (!host.endsWith('.beerleaguehockey.ca')) return { kind: 'custom', value: host.replace(/^www\./, '') };
  let candidate = host.slice(0, -'.beerleaguehockey.ca'.length);
  if (candidate.endsWith('.sites')) candidate = candidate.slice(0, -'.sites'.length);
  return candidate.includes('.') || !SLUG.test(candidate) ? { kind: 'unbound' } : { kind: 'slug', value: candidate };
}

function validate(request: NextRequest): { leagueSlug: string; view: ContentView; articleSlug?: string; albumId?: string } | NextResponse {
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) if (!ALLOWED.has(key)) return jsonError(400, 'INVALID_QUERY', 'Only contract query parameters are allowed.');
  for (const key of ALLOWED) if (params.getAll(key).length > 1) return jsonError(400, 'INVALID_QUERY', `${key} must appear once.`);
  const leagueSlug = params.get('leagueSlug');
  const viewValue = params.get('view');
  if (!leagueSlug || leagueSlug.length > 63 || !SLUG.test(leagueSlug) || !viewValue || !VIEWS.has(viewValue as ContentView)) {
    return jsonError(400, 'INVALID_QUERY', 'leagueSlug and a valid view are required.');
  }
  const view = viewValue as ContentView;
  const articleSlug = params.get('articleSlug') ?? undefined;
  const albumId = params.get('albumId') ?? undefined;
  if ((view === 'article') !== Boolean(articleSlug) || (view === 'album') !== Boolean(albumId) || (view !== 'article' && articleSlug) || (view !== 'album' && albumId)) {
    return jsonError(400, 'INVALID_QUERY', 'Detail arguments must match their view exactly.');
  }
  if (articleSlug && !ARTICLE_SLUG.test(articleSlug)) return jsonError(400, 'INVALID_ARTICLE_SLUG', 'articleSlug is invalid.');
  if (albumId && !UUID.test(albumId)) return jsonError(400, 'INVALID_ALBUM_ID', 'albumId must be a UUID.');
  return { leagueSlug, view, articleSlug, albumId };
}

export async function handlePublicLeagueContentRequest(
  request: NextRequest,
  dependencies: PublicLeagueContentDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const query = validate(request);
  if (query instanceof NextResponse) return query;
  const host = tenantHost(request.headers.get('host'));
  if (host.kind === 'slug' && host.value !== query.leagueSlug) return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');

  try {
    const league = await dependencies.getLeagueBySlug(query.leagueSlug);
    if (!league || league.status !== 'active') return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    if (host.kind === 'custom') {
      const domain = league.custom_domain_verified ? league.custom_domain?.toLowerCase().replace(/^www\./, '') : null;
      if (domain !== host.value) return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
    }
    if (!(await dependencies.hasPlatformSubscription(league.id))) return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');

    if (!UUID.test(league.id) || league.slug !== query.leagueSlug || !league.name.trim() || league.name.length > 500) {
      throw new Error('Invalid public league identity');
    }
    const source = dependencies.createSource(league, dependencies.now());
    const base: ContentBase = { schemaVersion: 1, view: query.view, league: { id: league.id, slug: league.slug, name: league.name, logoUrl: publicMediaUrl(league.logo_url, league.slug) } };
    let payload: ContentResponse | null;
    if (query.view === 'news') {
      const articles = await source.loadNews();
      payload = { ...base, view: 'news', articles, total: articles.length };
    } else if (query.view === 'article') {
      const article = await source.loadArticle(query.articleSlug!);
      payload = article ? { ...base, view: 'article', article } : null;
    } else if (query.view === 'history') {
      payload = { ...base, view: 'history', ...(await source.loadHistory()) };
    } else if (query.view === 'gallery') {
      const gallery = await source.loadGallery();
      payload = { ...base, view: 'gallery', ...gallery, total: gallery.albums.length };
    } else {
      const album = await source.loadAlbum(query.albumId!);
      payload = album ? { ...base, view: 'album', ...album, total: album.photos.length } : null;
    }
    if (!payload) return jsonError(404, 'CONTENT_NOT_FOUND', 'Published content not found.');
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_RESPONSE_BYTES) throw new PayloadLimitError();
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof PayloadLimitError) return jsonError(503, 'PAYLOAD_LIMIT_EXCEEDED', 'Public content exceeds the complete response limit.');
    console.error('[public-league-content] public read failed', { leagueSlug: query.leagueSlug, view: query.view, errorType: error instanceof Error ? error.name : 'unknown' });
    return jsonError(503, 'CONTENT_DATA_UNAVAILABLE', 'Public content is temporarily unavailable.');
  }
}
