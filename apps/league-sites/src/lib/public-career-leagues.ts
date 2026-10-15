import { NextRequest, NextResponse } from 'next/server';

import { hasPlatformSubscription } from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export const PUBLIC_CAREER_LEAGUES_SCHEMA_VERSION = 1 as const;
export const MAX_PUBLIC_CAREER_LEAGUES = 100;
export const MAX_PUBLIC_CAREER_LEAGUES_RESPONSE_BYTES = 256 * 1024;

const SOURCE_PAGE_SIZE = 1000;
const MAX_SOURCE_ROWS_PER_TABLE = 50_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const SOURCE_TABLES = ['player_stats', 'goalie_stats', 'team_rosters'] as const;

type QueryResult = { data: unknown[] | null; count: number | null; error: unknown };
type QueryBuilder = {
  select(columns: string, options: { count: 'exact' }): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  in(column: string, values: string[]): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  range(from: number, to: number): Promise<QueryResult>;
};
type QueryClient = { from(table: string): QueryBuilder };

export type PublicCareerLeagueSource = {
  id: string;
  name: string;
  slug: string;
  status: string;
  custom_domain?: string | null;
  custom_domain_verified?: boolean | null;
  [key: string]: unknown;
};

export interface PublicCareerLeagueDependencies {
  readPlayerLeagueIds(playerId: string): Promise<string[]>;
  readPublicLeagues(ids: string[]): Promise<PublicCareerLeagueSource[]>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
}

class DiscoveryDataError extends Error {}
class DiscoveryLimitError extends Error {}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, {
    status,
    headers: {
      'Cache-Control': ERROR_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function jsonSuccess(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > MAX_PUBLIC_CAREER_LEAGUES_RESPONSE_BYTES) {
    throw new DiscoveryLimitError('response exceeds byte limit');
  }
  return NextResponse.json(payload, { headers: {
    'Cache-Control': SUCCESS_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function readPagedLeagueIds(
  client: QueryClient,
  table: string,
  playerId: string,
): Promise<string[]> {
  const build = () => client
    .from(table)
    .select('league_id', { count: 'exact' })
    .eq('player_id', playerId)
    .order('league_id', { ascending: true });
  const first = await build().range(0, SOURCE_PAGE_SIZE - 1);
  if (first.error || !Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) {
    throw new DiscoveryDataError(`${table} source read failed`);
  }
  const count = first.count as number;
  if (count > MAX_SOURCE_ROWS_PER_TABLE) throw new DiscoveryLimitError(`${table} source limit exceeded`);
  const rows = [...(first.data ?? [])];
  for (let offset = SOURCE_PAGE_SIZE; offset < count; offset += SOURCE_PAGE_SIZE) {
    const page = await build().range(offset, offset + SOURCE_PAGE_SIZE - 1);
    if (page.error || page.count !== count) throw new DiscoveryDataError(`${table} source changed`);
    rows.push(...(page.data ?? []));
  }
  if (rows.length !== count) throw new DiscoveryDataError(`${table} source incomplete`);
  return rows.map((value) => {
    const leagueId = (value as { league_id?: unknown }).league_id;
    if (typeof leagueId !== 'string' || !UUID_PATTERN.test(leagueId)) {
      throw new DiscoveryDataError(`${table} source has invalid league id`);
    }
    return leagueId;
  });
}

export async function readPlayerLeagueIds(playerId: string): Promise<string[]> {
  const publicClient = await createClient() as unknown as QueryClient;
  const publicIds: string[] = [];
  // Finish all RLS/public player-scoped reads before creating the privileged client.
  for (const table of SOURCE_TABLES) {
    publicIds.push(...await readPagedLeagueIds(publicClient, table, playerId));
  }
  const serviceClient = createServiceRoleClient() as unknown as QueryClient;
  const baselineIds = await readPagedLeagueIds(serviceClient, 'player_career_baselines', playerId);
  return [...new Set([...publicIds, ...baselineIds])].sort();
}

export async function readPublicLeagues(ids: string[]): Promise<PublicCareerLeagueSource[]> {
  if (ids.length === 0) return [];
  const client = await createClient() as unknown as QueryClient;
  const result = await client
    .from('leagues')
    .select('id, name, slug, status, custom_domain, custom_domain_verified', { count: 'exact' })
    .in('id', ids)
    .eq('status', 'active')
    .order('id', { ascending: true })
    .range(0, MAX_PUBLIC_CAREER_LEAGUES);
  if (result.error || result.count === null || result.data === null) {
    throw new DiscoveryDataError('league metadata read failed');
  }
  if (result.count > MAX_PUBLIC_CAREER_LEAGUES || result.data.length !== result.count) {
    throw new DiscoveryLimitError('league metadata incomplete');
  }
  return result.data as PublicCareerLeagueSource[];
}

const defaultDependencies: PublicCareerLeagueDependencies = {
  readPlayerLeagueIds,
  readPublicLeagues,
  hasPlatformSubscription,
};

type RequestHost = { kind: 'shared' } | { kind: 'tenant'; slug: string } | { kind: 'custom'; hostname: string };

function classifyHost(hostHeader: string | null): RequestHost | null {
  if (!hostHeader) return null;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return { kind: 'shared' };
  if (host === 'beerleaguehockey.ca' || host === 'api.beerleaguehockey.ca') return { kind: 'shared' };
  const suffix = '.beerleaguehockey.ca';
  if (!host.endsWith(suffix)) return { kind: 'custom', hostname: host.replace(/^www\./, '') };
  let slug = host.slice(0, -suffix.length);
  if (slug.endsWith('.sites')) slug = slug.slice(0, -'.sites'.length);
  return !slug.includes('.') && SLUG_PATTERN.test(slug) ? { kind: 'tenant', slug } : null;
}

function validateQuery(request: NextRequest): string | NextResponse {
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) {
    if (key !== 'playerId') return jsonError(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
  }
  if (params.getAll('playerId').length !== 1) {
    return jsonError(400, 'INVALID_QUERY', 'playerId must appear exactly once.');
  }
  const playerId = params.get('playerId');
  if (!playerId || !UUID_PATTERN.test(playerId)) {
    return jsonError(400, 'INVALID_PLAYER_ID', 'playerId must be a UUID.');
  }
  return playerId;
}

export async function handlePublicCareerLeaguesRequest(
  request: NextRequest,
  deps: PublicCareerLeagueDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const playerId = validateQuery(request);
  if (playerId instanceof NextResponse) return playerId;
  const host = classifyHost(request.headers.get('host'));
  if (!host) return jsonError(400, 'INVALID_HOST', 'This endpoint is not available on this host.');

  try {
    const ids = [...new Set(await deps.readPlayerLeagueIds(playerId))].sort();
    if (ids.some((id) => !UUID_PATTERN.test(id))) throw new DiscoveryDataError('invalid candidate league id');
    if (ids.length > MAX_PUBLIC_CAREER_LEAGUES) throw new DiscoveryLimitError('career league limit exceeded');

    if (ids.length === 0 && host.kind === 'shared') {
      return jsonSuccess({ schemaVersion: PUBLIC_CAREER_LEAGUES_SCHEMA_VERSION, playerId, leagues: [] });
    }

    const resolved = await deps.readPublicLeagues(ids);
    const seen = new Set<string>();
    for (const league of resolved) {
      if (!ids.includes(league.id) || seen.has(league.id)) throw new DiscoveryDataError('invalid resolved league identity');
      seen.add(league.id);
      if (!UUID_PATTERN.test(league.id) || typeof league.name !== 'string' || league.name.trim().length === 0 ||
          league.name.length > 200 || typeof league.slug !== 'string' || league.slug.length > 63 ||
          !SLUG_PATTERN.test(league.slug)) {
        throw new DiscoveryDataError('invalid resolved league metadata');
      }
    }
    const active = resolved.filter((league) => league.status === 'active' && league.slug !== 'demo');
    const eligible: Array<{ id: string; name: string; slug: string }> = [];
    for (const league of active) {
      if (await deps.hasPlatformSubscription(league.id)) {
        eligible.push({ id: league.id, name: league.name, slug: league.slug });
      }
    }
    const hostIsBound = host.kind === 'shared' || eligible.some((league) => {
      const source = active.find((candidate) => candidate.id === league.id);
      if (host.kind === 'tenant') return league.slug === host.slug;
      const customDomain = source?.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
      return source?.custom_domain_verified === true && customDomain === host.hostname;
    });
    if (!hostIsBound) return jsonError(400, 'INVALID_HOST', 'This endpoint is not available on this host.');
    eligible.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id));
    return jsonSuccess({ schemaVersion: PUBLIC_CAREER_LEAGUES_SCHEMA_VERSION, playerId, leagues: eligible });
  } catch (error) {
    console.error('[public-career-leagues] public discovery failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    const code = error instanceof DiscoveryLimitError ? 'CAREER_LEAGUES_LIMIT_EXCEEDED' : 'CAREER_LEAGUES_UNAVAILABLE';
    const message = error instanceof DiscoveryLimitError
      ? 'Career league discovery exceeds the complete response limit.'
      : 'Career league discovery is temporarily unavailable.';
    return jsonError(503, code, message);
  }
}
