/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-compatible test double */
import { compileCommonJs } from './component-harness.ts';

// Relevant projection columns transcribed from the parent-provided LIVE catalog
// artifact home-catalog.json. This fixture is intentionally self-contained so CI
// never depends on that external evidence path.
const LIVE_HOME_COLUMNS: Record<string, ReadonlySet<string>> = {
  articles: new Set([
    'id', 'league_id', 'season_id', 'title', 'content', 'excerpt', 'image_url',
    'slug', 'published', 'published_at', 'created_at', 'type',
  ]),
  gallery_photos: new Set(['id', 'gallery_id', 'url', 'caption', 'created_at']),
  games: new Set([
    'id', 'league_id', 'season_id', 'scheduled_at', 'location', 'home_score',
    'away_score', 'status', 'game_type', 'division_id', 'home_team_id', 'away_team_id',
  ]),
  league_gallery: new Set([
    'id', 'league_id', 'season_id', 'title', 'description', 'cover_photo_url',
    'is_published', 'created_at',
  ]),
  league_sponsors: new Set([
    'id', 'league_id', 'name', 'logo_url', 'website_url', 'tier', 'description',
    'display_order', 'is_active',
  ]),
  leagues: new Set([
    'id', 'name', 'slug', 'description', 'logo_url', 'banner_url', 'city',
    'state_province', 'timezone', 'status', 'settings',
  ]),
  seasons: new Set(['id', 'league_id', 'name', 'status', 'start_date', 'end_date', 'created_at']),
  teams: new Set(['id', 'name', 'slug', 'logo_url', 'primary_color', 'secondary_color', 'division_id']),
};

export type SchemaSelectionError = {
  code: '42703';
  table: string;
  column: string;
  message: string;
};

type QueryResult = { data: unknown; error: SchemaSelectionError | null };

function splitProjection(projection: string) {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < projection.length; index += 1) {
    if (projection[index] === '(') depth += 1;
    else if (projection[index] === ')') depth -= 1;
    else if (projection[index] === ',' && depth === 0) {
      fields.push(projection.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(projection.slice(start).trim());
  return fields.filter(Boolean);
}

function selectedColumnErrors(table: string, projection: string): SchemaSelectionError[] {
  const allowed = LIVE_HOME_COLUMNS[table];
  if (!allowed) throw new Error(`Schema fixture has no catalog entry for ${table}`);

  return splitProjection(projection).flatMap((field) => {
    const relationStart = field.indexOf('(');
    if (relationStart >= 0) {
      const relation = field.slice(0, relationStart).trim();
      const target = (relation.includes(':') ? relation.slice(relation.indexOf(':') + 1) : relation).split('!')[0];
      const nested = field.slice(relationStart + 1, -1);
      if (nested === 'count') return [];
      return selectedColumnErrors(target, nested);
    }

    const column = field.split(':').at(-1)?.trim() ?? field;
    if (allowed.has(column)) return [];
    return [{
      code: '42703' as const,
      table,
      column,
      message: `column ${table}.${column} does not exist`,
    }];
  });
}

export function createHomeSchemaAwareBoundary() {
  const leagueId = '10000000-0000-4000-8000-000000000001';
  const leagueSlug = 'harbour-hockey';
  const schemaErrors: SchemaSelectionError[] = [];
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const rows: Record<string, unknown> = {
    leagues: { id: leagueId, slug: leagueSlug, timezone: 'America/Toronto', status: 'active', settings: {} },
    seasons: [],
    articles: [],
    games: [],
    gallery_photos: [],
    league_gallery: [],
    league_sponsors: [],
  };

  const query = (table: string) => {
    let queryError: SchemaSelectionError | null = null;
    const chain: Record<string, any> = {};
    chain.select = (projection: string) => {
      calls.push({ table, method: 'select', args: [projection] });
      const errors = selectedColumnErrors(table, projection);
      schemaErrors.push(...errors);
      queryError ??= errors[0] ?? null;
      return chain;
    };
    for (const method of ['eq', 'in', 'gte', 'lte', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    const result = (): QueryResult => ({ data: queryError ? null : rows[table] ?? [], error: queryError });
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (value: QueryResult) => void) => resolve(result());
    return chain;
  };

  const loader = compileCommonJs<any>(new URL('../../src/lib/supabase/home.ts', import.meta.url), {
    './client': { supabase: { from: (table: string) => query(table) } },
  });

  const load = async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      schemaVersion: 1,
      leagueId,
      leagueSlug,
      presentationSeason: null,
      leaders: [],
      standings: [],
      divisions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    try {
      return await loader.loadHomePublicSnapshot(leagueId, leagueSlug, new Date('2026-09-11T12:00:00Z'));
    } finally {
      globalThis.fetch = previousFetch;
    }
  };

  return { calls, leagueId, leagueSlug, load, schemaErrors };
}
