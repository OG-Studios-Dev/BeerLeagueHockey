import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase/client';

export const HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
export const HOCKEY_LIFE_NEWSPAPER_LEAGUE_SLUG = 'hockey-life';
export const HOCKEY_LIFE_PUBLIC_ORIGIN = 'https://hockey-life.beerleaguehockey.ca';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type NewspaperReaderTarget = { articleId: string; leagueId: typeof HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID; articleSlug: string; url: string };
export type NewspaperAssociationQuery = (articleId: string, leagueId: string) => Promise<{ data: unknown; error: unknown }>;
type NewspaperQueryBuilder = {
  select(columns: string): NewspaperQueryBuilder;
  eq(column: string, value: string): NewspaperQueryBuilder;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
};

function validId(value: string, label: string) { if (!UUID.test(value)) throw new TypeError(`Invalid ${label}`); return value; }
function validSlug(value: string, label: string) { if (!SLUG.test(value)) throw new TypeError(`Invalid ${label}`); return value; }

export function buildHockeyLifeNewspaperUrl(articleSlug: string): string {
  const slug = validSlug(articleSlug, 'newspaper article slug');
  const url = new URL(`/${HOCKEY_LIFE_NEWSPAPER_LEAGUE_SLUG}/news/${slug}`, HOCKEY_LIFE_PUBLIC_ORIGIN);
  if (url.origin !== HOCKEY_LIFE_PUBLIC_ORIGIN || url.username || url.password || url.search || url.hash) throw new TypeError('Unsafe newspaper reader URL');
  return url.toString();
}

export function decodePublishedNewspaperAssociation(value: unknown, expected: { articleId: string; leagueId: string; articleSlug: string }): NewspaperReaderTarget | null {
  validId(expected.articleId, 'newspaper article id'); validId(expected.leagueId, 'newspaper league id'); validSlug(expected.articleSlug, 'newspaper article slug');
  if (expected.leagueId !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID || value === null || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.article_id !== expected.articleId || row.league_id !== expected.leagueId || row.status !== 'published' || typeof row.published_at !== 'string' || !Number.isFinite(Date.parse(row.published_at))) return null;
  return { articleId: expected.articleId, leagueId: HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID, articleSlug: expected.articleSlug, url: buildHockeyLifeNewspaperUrl(expected.articleSlug) };
}

async function queryPublishedAssociation(articleId: string, leagueId: string) {
  // Generated types intentionally lag this not-yet-deployed migration.
  return (supabase as unknown as { from(table: string): NewspaperQueryBuilder }).from('newspaper_editions').select('article_id,league_id,status,published_at').eq('article_id', articleId).eq('league_id', leagueId).eq('status', 'published').maybeSingle();
}

export async function loadPublishedNewspaperReaderTarget(expected: { articleId: string; leagueId: string; leagueSlug: string; articleSlug: string }, query: NewspaperAssociationQuery = queryPublishedAssociation): Promise<NewspaperReaderTarget | null> {
  validId(expected.articleId, 'newspaper article id'); validId(expected.leagueId, 'newspaper league id'); validSlug(expected.articleSlug, 'newspaper article slug'); validSlug(expected.leagueSlug, 'newspaper league slug');
  if (expected.leagueId !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID || expected.leagueSlug !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_SLUG) return null;
  try { const { data, error } = await query(expected.articleId, expected.leagueId); return error ? null : decodePublishedNewspaperAssociation(data, expected); }
  catch { return null; } // Missing migration and public lookup failures preserve legacy news.
}

export type NewspaperBrowserOpener = (url: string) => Promise<WebBrowser.WebBrowserResult>;
export async function openNewspaperReader(target: NewspaperReaderTarget, opener: NewspaperBrowserOpener = (url) => WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close', enableBarCollapsing: true })): Promise<void> {
  const canonicalUrl = buildHockeyLifeNewspaperUrl(target.articleSlug);
  validId(target.articleId, 'newspaper article id');
  if (target.leagueId !== HOCKEY_LIFE_NEWSPAPER_LEAGUE_ID || target.url !== canonicalUrl) throw new TypeError('Invalid newspaper reader target');
  try {
    const result = await opener(canonicalUrl);
    if (result.type === 'locked') throw new Error('Browser presentation is locked');
  }
  catch { throw new Error('Couldn\u2019t open the full newspaper. Check your connection and try again.'); }
}
