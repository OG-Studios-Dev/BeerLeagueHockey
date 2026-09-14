import type { ArticleSummary, ContentSeason, GalleryAlbum } from './leagueContent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type NewsCategory = 'All' | 'Recaps' | 'News';

export function filterArticles(articles: ArticleSummary[], category: NewsCategory) {
  if (category === 'All') return articles;
  if (category === 'Recaps') return articles.filter(article => article.type === 'game_recap' || article.type === 'weekly_wrap');
  return articles.filter(article => article.type === 'news');
}

export function categoryCount(articles: ArticleSummary[], category: NewsCategory) {
  return filterArticles(articles, category).length;
}

export function groupAlbums(albums: GalleryAlbum[], seasons: ContentSeason[]) {
  const unique = [...new Map(albums.map(item => [item.id, item])).values()];
  const known = new Set(seasons.map(item => item.id));
  const groups = seasons.flatMap(season => {
    const rows = unique.filter(album => album.seasonId === season.id);
    return rows.length ? [{ key: season.id, label: season.name, albums: rows }] : [];
  });
  const other = unique.filter(album => !album.seasonId || !known.has(album.seasonId));
  return other.length ? [...groups, { key: 'other', label: 'Other', albums: other }] : groups;
}

export function splitRichTextParagraphs(content: string) {
  return content.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map(value => value.trim()).filter(Boolean);
}

export type ArticleBlock = { kind: 'heading' | 'paragraph' | 'bullet'; text: string };
export function parseArticleBlocks(content: string): ArticleBlock[] {
  return content.replace(/\r\n?/g, '\n').split('\n').flatMap((raw): ArticleBlock[] => {
    const line = raw.trim();
    if (!line) return [];
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) return [{ kind: 'heading', text: heading[1] ?? '' }];
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) return [{ kind: 'bullet', text: bullet[1] ?? '' }];
    return [{ kind: 'paragraph', text: line }];
  });
}

export type ArticleLinkTarget =
  | { kind: 'player' | 'team' | 'game'; id: string }
  | { kind: 'article'; slug: string }
  | { kind: 'external'; url: string };

export function classifyArticleHref(value: string, leagueSlug: string): ArticleLinkTarget | null {
  try {
    const tenantHost = `${leagueSlug}.beerleaguehockey.ca`;
    const url = new URL(value, `https://${tenantHost}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.host === tenantHost) {
      const parts = url.pathname.split('/').filter(Boolean);
      const kind = parts[0]; const identity = parts[1];
      if ((kind === 'players' || kind === 'games') && parts.length === 2 && identity && UUID.test(identity)) return { kind: kind === 'players' ? 'player' : 'game', id: identity };
      if (kind === 'teams' && parts[1] === 'id' && parts.length === 3 && parts[2] && UUID.test(parts[2])) return { kind: 'team', id: parts[2] };
      if (kind === 'news' && parts.length === 2 && identity && SLUG.test(identity)) return { kind: 'article', slug: identity };
    }
    return { kind: 'external', url: url.toString() };
  } catch { return null; }
}

export type InlineToken = { text: string; href: string | null; strong: boolean };
export function parseInlineMarkdown(value: string): InlineToken[] {
  const tokens: InlineToken[] = []; const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g; let start = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > start) tokens.push({ text: value.slice(start, match.index), href: null, strong: false });
    tokens.push(match[1] !== undefined
      ? { text: match[1], href: match[2] ?? null, strong: false }
      : { text: match[3] ?? '', href: null, strong: true });
    start = pattern.lastIndex;
  }
  if (start < value.length) tokens.push({ text: value.slice(start), href: null, strong: false });
  return tokens.length ? tokens : [{ text: value, href: null, strong: false }];
}
