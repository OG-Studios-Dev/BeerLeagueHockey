import { NextRequest, NextResponse } from 'next/server';

import { filterVisibleSiteSeasons } from './all-time-stats';
import { getLeagueBySlug, hasPlatformSubscription } from './data';
import {
  loadPublicLeaguePageCatalog,
  loadPublicLeaguePageSeasonData,
  type PublicLeaguePageCatalog,
  type PublicLeaguePageSeasonData,
  PublicLeaguePageLimitError,
} from './public-league-pages-loader';
import {
  assertValidLeaguePageResponse,
  type LeaguePageKind,
  type LeaguePageResponse,
  type PageSeason,
} from './public-league-pages-contract';
import { assertRequiredPrivilegedMetricConfig } from './public-stat-metrics';
import { pickOperationalSeason } from './seasons/operational';

export * from './public-league-pages-contract';

export const PUBLIC_LEAGUE_PAGES_SCHEMA_VERSION = 1 as const;
export const MAX_PUBLIC_LEAGUE_PAGES_RESPONSE_BYTES = 512 * 1024;

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const ALLOWED_QUERY_PARAMETERS = new Set(['leagueSlug', 'page', 'seasonId']);
const PAGE_KINDS = new Set<LeaguePageKind>(['teams', 'players', 'playoffs']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_DOMAIN = 'beerleaguehockey.ca';
const DEV_DOMAINS = ['localhost', '127.0.0.1', '.local'];
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'builder', 'auth', 'cdn', 'static', 'assets',
]);

type PublicLeague = {
  id: string;
  slug: string;
  name: string;
  status: string;
  custom_domain?: string | null;
  custom_domain_verified?: boolean | null;
};

export interface PublicLeaguePagesDependencies {
  getLeagueBySlug(slug: string): Promise<PublicLeague | null>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
  requirePrivilegedAccess(): void;
  loadCatalog(leagueId: string): Promise<PublicLeaguePageCatalog>;
  loadSeasonData(scope: {
    leagueId: string;
    seasonId: string;
    page: LeaguePageKind;
    isPresentationSeason: boolean;
    currentMembershipOnly: boolean;
    divisions: PublicLeaguePageCatalog['divisions'];
    now: Date;
  }): Promise<PublicLeaguePageSeasonData>;
  now(): Date;
}

const defaultDependencies: PublicLeaguePagesDependencies = {
  getLeagueBySlug: getLeagueBySlug as PublicLeaguePagesDependencies['getLeagueBySlug'],
  hasPlatformSubscription,
  requirePrivilegedAccess: assertRequiredPrivilegedMetricConfig,
  loadCatalog: loadPublicLeaguePageCatalog,
  loadSeasonData: loadPublicLeaguePageSeasonData,
  now: () => new Date(),
};

class PayloadLimitError extends Error {}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': ERROR_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' } },
  );
}

function jsonSuccess(payload: LeaguePageResponse, expectedLeagueSlug: string) {
  assertValidLeaguePageResponse(payload, expectedLeagueSlug);
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_PUBLIC_LEAGUE_PAGES_RESPONSE_BYTES) {
    throw new PayloadLimitError('serialized response limit exceeded');
  }
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' },
  });
}

type TenantHost =
  | { kind: 'slug'; slug: string }
  | { kind: 'custom'; hostname: string }
  | { kind: 'unbound' };

function getTenantHost(hostHeader: string | null): TenantHost {
  if (!hostHeader) return { kind: 'unbound' };
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  if (DEV_DOMAINS.some((dev) => host === dev || host.endsWith(dev))) {
    const parts = host.split('.');
    const candidate = parts.length > 1 && parts[0] !== 'www' ? parts[0] : null;
    return candidate && SLUG_PATTERN.test(candidate) ? { kind: 'slug', slug: candidate } : { kind: 'unbound' };
  }
  if (host !== PRODUCTION_DOMAIN && !host.endsWith(`.${PRODUCTION_DOMAIN}`)) {
    return { kind: 'custom', hostname: host.replace(/^www\./, '') };
  }
  if (host === PRODUCTION_DOMAIN) return { kind: 'unbound' };
  let candidate = host.slice(0, -`.${PRODUCTION_DOMAIN}`.length);
  if (candidate.endsWith('.sites')) candidate = candidate.slice(0, -'.sites'.length);
  if (candidate.includes('.') || RESERVED_SUBDOMAINS.has(candidate)) return { kind: 'unbound' };
  return SLUG_PATTERN.test(candidate) ? { kind: 'slug', slug: candidate } : { kind: 'unbound' };
}

function validateQuery(request: NextRequest):
  | { leagueSlug: string; page: LeaguePageKind; seasonId?: string }
  | NextResponse {
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      return jsonError(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
    }
  }
  for (const key of ALLOWED_QUERY_PARAMETERS) {
    if (params.getAll(key).length > 1) {
      return jsonError(400, 'INVALID_QUERY', `Query parameter ${key} must appear once.`);
    }
  }
  const leagueSlug = params.get('leagueSlug');
  if (leagueSlug === null) return jsonError(400, 'INVALID_QUERY', 'leagueSlug is required.');
  if (leagueSlug.length > 63 || !SLUG_PATTERN.test(leagueSlug)) {
    return jsonError(400, 'INVALID_LEAGUE_SLUG', 'leagueSlug must be a lowercase ASCII host slug.');
  }
  const page = params.get('page');
  if (page === null) return jsonError(400, 'INVALID_QUERY', 'page is required.');
  if (!PAGE_KINDS.has(page as LeaguePageKind)) {
    return jsonError(400, 'INVALID_PAGE', 'page must be teams, players, or playoffs.');
  }
  const seasonId = params.get('seasonId') ?? undefined;
  if (seasonId !== undefined && !UUID_PATTERN.test(seasonId)) {
    return jsonError(400, 'INVALID_SEASON_ID', 'seasonId must be a UUID.');
  }
  return { leagueSlug, page: page as LeaguePageKind, seasonId };
}

function mapSeason(season: PublicLeaguePageCatalog['seasons'][number]): PageSeason {
  return { id: season.id, name: season.name, status: season.status };
}

function emptyPayload(
  page: LeaguePageKind,
  league: PublicLeague,
  seasons: PageSeason[],
  divisions: PublicLeaguePageCatalog['divisions'],
): LeaguePageResponse {
  const base = {
    schemaVersion: PUBLIC_LEAGUE_PAGES_SCHEMA_VERSION,
    page,
    league: { id: league.id, slug: league.slug, name: league.name },
    seasons,
    selectedSeason: null,
    divisions: divisions.map(({ id, name }) => ({ id, name })),
    teams: [],
  };
  if (page === 'teams') return { ...base, page, positioning: null };
  if (page === 'players') return { ...base, page, players: [] };
  return {
    ...base,
    page,
    series: [],
    standings: [],
    previewConfig: { playoffTeamsTotal: null, playoffTeamsPerDivision: null, useDivisionPlayoffs: null },
  };
}

export async function handlePublicLeaguePagesRequest(
  request: NextRequest,
  deps: PublicLeaguePagesDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const validated = validateQuery(request);
  if (validated instanceof NextResponse) return validated;
  const { leagueSlug, page, seasonId } = validated;
  const tenantHost = getTenantHost(request.headers.get('host'));
  if (tenantHost.kind === 'slug' && tenantHost.slug !== leagueSlug) {
    return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
  }

  try {
    const league = await deps.getLeagueBySlug(leagueSlug);
    if (!league || league.status !== 'active') return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    if (tenantHost.kind === 'custom') {
      const verifiedDomain = league.custom_domain_verified
        ? league.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') ?? null
        : null;
      if (verifiedDomain !== tenantHost.hostname) {
        return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
      }
    }
    if (!(await deps.hasPlatformSubscription(league.id))) {
      return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    }

    deps.requirePrivilegedAccess();
    const catalog = await deps.loadCatalog(league.id);
    const visibleSeasons = filterVisibleSiteSeasons(catalog.seasons);
    const presentationSeason = pickOperationalSeason(visibleSeasons.map((season) => ({
      ...season,
      start_date: season.startDate,
      end_date: season.endDate,
      created_at: season.createdAt,
    })));
    const selectedSeason = seasonId
      ? visibleSeasons.find((season) => season.id === seasonId) ?? null
      : presentationSeason;
    if (seasonId && !selectedSeason) {
      return jsonError(400, 'SEASON_NOT_IN_LEAGUE', 'seasonId does not belong to this league.');
    }
    const seasons = visibleSeasons.map(mapSeason);
    if (!selectedSeason) return jsonSuccess(emptyPayload(page, league, seasons, catalog.divisions), leagueSlug);

    const seasonData = await deps.loadSeasonData({
      leagueId: league.id,
      seasonId: selectedSeason.id,
      page,
      isPresentationSeason: selectedSeason.id === presentationSeason?.id,
      currentMembershipOnly: !['completed', 'archived'].includes(selectedSeason.status ?? ''),
      divisions: catalog.divisions,
      now: deps.now(),
    });
    const base = {
      schemaVersion: PUBLIC_LEAGUE_PAGES_SCHEMA_VERSION,
      page,
      league: { id: league.id, slug: league.slug, name: league.name },
      seasons,
      selectedSeason: mapSeason(selectedSeason),
      divisions: catalog.divisions.map(({ id, name }) => ({ id, name })),
      teams: seasonData.teams,
    };
    if (page === 'teams') return jsonSuccess({ ...base, page, positioning: seasonData.positioning }, leagueSlug);
    if (page === 'players') return jsonSuccess({ ...base, page, players: seasonData.players }, leagueSlug);
    return jsonSuccess({
      ...base,
      page,
      series: seasonData.series,
      standings: seasonData.standings,
      previewConfig: seasonData.previewConfig,
    }, leagueSlug);
  } catch (error) {
    if (error instanceof PayloadLimitError || error instanceof PublicLeaguePageLimitError) {
      return jsonError(503, 'PAYLOAD_LIMIT_EXCEEDED', 'Public league-page data exceeds the complete response limit.');
    }
    console.error('[public-league-pages] public read failed', {
      leagueSlug,
      page,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return jsonError(503, 'LEAGUE_PAGE_DATA_UNAVAILABLE', 'Public league-page data is temporarily unavailable.');
  }
}
