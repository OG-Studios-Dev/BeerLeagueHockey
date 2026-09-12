import { NextRequest, NextResponse } from 'next/server';

import {
  getCurrentSeason,
  getDivisions,
  getLeagueBySlug,
  getStandings,
  getUnifiedSkaterStatsRows,
  hasPlatformSubscription,
} from '@/lib/data';
import type {
  Division,
  TeamStanding,
  UnifiedSkaterStatsRow,
} from '@/lib/types';

export const PUBLIC_HOME_SCHEMA_VERSION = 1 as const;
export const MAX_LEADERS_PER_METRIC = 5;
export const MAX_STANDINGS_ROWS = 200;
export const MAX_DIVISION_ROWS = 64;
export const MAX_RESPONSE_BYTES = 256 * 1024;

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const ALLOWED_QUERY_PARAMETERS = new Set(['leagueSlug', 'seasonId', 'divisionId']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_DOMAIN = 'beerleaguehockey.ca';
const DEV_DOMAINS = ['localhost', '127.0.0.1', '.local'];
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'builder',
  'auth',
  'cdn',
  'static',
  'assets',
]);

type PresentationSeasonSource = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
};

export type PublicHomeLeader = {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  team_id: string;
  team_name: string;
  display_team_name: string | null;
  display_team_logo_url: string | null;
  position: string | null;
  goals: number;
  assists: number;
  points: number;
};

export type PublicHomeStanding = {
  team_id: string;
  team_name: string;
  logo_url: string | null;
  primary_color: string | null;
  division_id: string | null;
  division_name: string | null;
  team_type: string | null;
  games_played: number;
  wins: number;
  losses: number;
  ties: number;
  goals_for: number;
  goals_against: number;
  goal_differential: number;
  points: number;
};

class PayloadLimitError extends Error {}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: { code, message, ...details } },
    {
      status,
      headers: {
        'Cache-Control': ERROR_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function finiteNumber(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Invalid canonical numeric value');
  }
  return value;
}

function mapLeader(row: UnifiedSkaterStatsRow): PublicHomeLeader {
  return {
    player_id: row.player_id,
    player_name: row.player_name,
    avatar_url: row.avatar_url ?? null,
    team_id: row.team_id,
    team_name: row.team_name,
    display_team_name: row.display_team_name ?? null,
    display_team_logo_url: row.display_team_logo_url ?? null,
    position: row.position ?? null,
    goals: finiteNumber(row.goals),
    assists: finiteNumber(row.assists),
    points: finiteNumber(row.points),
  };
}

/**
 * Produces the canonical-player-ID union of the web Home top-five lists.
 * Input rows already carry the canonical producer's goalie exclusions and
 * current display-team resolution; this adapter deliberately does not infer or
 * merge identities from player names.
 */
export function buildPublicHomeLeaders(
  rows: UnifiedSkaterStatsRow[],
): PublicHomeLeader[] {
  const metrics: Array<keyof Pick<UnifiedSkaterStatsRow, 'goals' | 'assists' | 'points'>> = [
    'goals',
    'assists',
    'points',
  ];
  const selected = new Map<string, PublicHomeLeader>();

  for (const metric of metrics) {
    const topRows = [...rows]
      .filter((row) => finiteNumber(row[metric]) > 0)
      .sort((left, right) => {
        const valueDelta = finiteNumber(right[metric]) - finiteNumber(left[metric]);
        if (valueDelta !== 0) return valueDelta;
        const nameDelta = left.player_name.localeCompare(right.player_name, 'en');
        if (nameDelta !== 0) return nameDelta;
        return left.player_id.localeCompare(right.player_id, 'en');
      })
      .slice(0, MAX_LEADERS_PER_METRIC);

    for (const row of topRows) {
      if (!selected.has(row.player_id)) {
        selected.set(row.player_id, mapLeader(row));
      }
    }
  }

  return [...selected.values()];
}

function mapStanding(row: TeamStanding): PublicHomeStanding {
  return {
    team_id: row.team_id,
    team_name: row.team_name,
    logo_url: row.team_logo ?? null,
    // The canonical web standing type does not currently carry team colour.
    // Keep the native DTO stable without adding a second team lookup/source.
    primary_color: null,
    division_id: row.division_id ?? null,
    division_name: row.division_name ?? null,
    team_type: row.team_type ?? null,
    games_played: finiteNumber(row.games_played),
    wins: finiteNumber(row.wins),
    losses: finiteNumber(row.losses),
    ties: finiteNumber(row.ties),
    goals_for: finiteNumber(row.goals_for),
    goals_against: finiteNumber(row.goals_against),
    goal_differential: finiteNumber(row.goal_differential),
    points: finiteNumber(row.points),
  };
}

function mapDivision(division: Division) {
  return {
    id: division.id,
    name: division.name,
    ...(typeof division.sort_order === 'number' ? { sort_order: division.sort_order } : {}),
  };
}

function mapPresentationSeason(season: PresentationSeasonSource) {
  return {
    id: season.id,
    league_id: season.league_id,
    name: season.name,
    status: season.status,
    start_date: season.start_date ?? null,
    end_date: season.end_date ?? null,
    created_at: season.created_at ?? null,
  };
}

type TenantHost =
  | { kind: 'slug'; slug: string }
  | { kind: 'custom'; hostname: string }
  | { kind: 'unbound' };

function getTenantHost(hostHeader: string | null): TenantHost {
  if (!hostHeader) return { kind: 'unbound' };
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');

  const isDevHost = DEV_DOMAINS.some((dev) => host === dev || host.endsWith(dev));
  if (isDevHost) {
    const parts = host.split('.');
    const candidate = parts.length > 1 && parts[0] !== 'www' ? parts[0] : null;
    return candidate && SLUG_PATTERN.test(candidate)
      ? { kind: 'slug', slug: candidate }
      : { kind: 'unbound' };
  }

  if (host !== PRODUCTION_DOMAIN && !host.endsWith(`.${PRODUCTION_DOMAIN}`)) {
    return { kind: 'custom', hostname: host.replace(/^www\./, '') };
  }

  if (host === PRODUCTION_DOMAIN) return { kind: 'unbound' };

  let candidate = host.slice(0, -`.${PRODUCTION_DOMAIN}`.length);
  if (candidate.endsWith('.sites')) {
    candidate = candidate.slice(0, -'.sites'.length);
  }

  if (candidate.includes('.') || RESERVED_SUBDOMAINS.has(candidate)) return { kind: 'unbound' };
  return SLUG_PATTERN.test(candidate)
    ? { kind: 'slug', slug: candidate }
    : { kind: 'unbound' };
}

function validateQuery(request: NextRequest):
  | { leagueSlug: string; seasonId?: string; divisionId?: string }
  | NextResponse {
  const params = request.nextUrl.searchParams;

  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      return jsonError(400, 'INVALID_QUERY', 'Only leagueSlug, seasonId, and divisionId are allowed.');
    }
  }

  for (const key of ALLOWED_QUERY_PARAMETERS) {
    if (params.getAll(key).length > 1) {
      return jsonError(400, 'INVALID_QUERY', `Query parameter ${key} must appear once.`);
    }
  }

  const leagueSlug = params.get('leagueSlug');
  if (leagueSlug === null) {
    return jsonError(400, 'INVALID_QUERY', 'leagueSlug is required.');
  }
  if (leagueSlug.length > 63 || !SLUG_PATTERN.test(leagueSlug)) {
    return jsonError(400, 'INVALID_LEAGUE_SLUG', 'leagueSlug must be a lowercase ASCII host slug.');
  }

  const seasonId = params.get('seasonId') ?? undefined;
  if (seasonId !== undefined && !UUID_PATTERN.test(seasonId)) {
    return jsonError(400, 'INVALID_SEASON_ID', 'seasonId must be a UUID.');
  }

  const divisionId = params.get('divisionId') ?? undefined;
  if (divisionId !== undefined && !UUID_PATTERN.test(divisionId)) {
    return jsonError(400, 'INVALID_DIVISION_ID', 'divisionId must be a UUID.');
  }

  return { leagueSlug, seasonId, divisionId };
}

export async function handlePublicHomeRequest(request: NextRequest): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }

  const validated = validateQuery(request);
  if (validated instanceof NextResponse) return validated;

  const { leagueSlug, seasonId: expectedSeasonId, divisionId } = validated;
  const tenantHost = getTenantHost(request.headers.get('host'));
  if (tenantHost.kind === 'slug' && tenantHost.slug !== leagueSlug) {
    return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
  }

  try {
    // getLeagueBySlug is the public-page resolver and already restricts this
    // lookup to status=active.
    const league = await getLeagueBySlug(leagueSlug);
    if (!league) {
      return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    }

    if (tenantHost.kind === 'custom') {
      const domainLeague = league as typeof league & {
        custom_domain?: string | null;
        custom_domain_verified?: boolean | null;
      };
      const verifiedDomain = domainLeague.custom_domain_verified
        ? domainLeague.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') ?? null
        : null;
      if (verifiedDomain !== tenantHost.hostname) {
        return jsonError(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
      }
    }

    // Match the public website's existing access policy. Return the same public
    // not-found shape for blocked and absent tenants.
    if (!(await hasPlatformSubscription(league.id))) {
      return jsonError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    }

    const presentationSeason = await getCurrentSeason(league.id) as PresentationSeasonSource | null;
    const divisions = await getDivisions(league.id);

    if (divisions.length > MAX_DIVISION_ROWS) {
      throw new PayloadLimitError('division row limit exceeded');
    }

    if (divisionId) {
      const divisionBelongsToLeague = divisions.some(
        (division) => division.id === divisionId && division.league_id === league.id,
      );
      if (!divisionBelongsToLeague) {
        return jsonError(400, 'DIVISION_NOT_IN_LEAGUE', 'divisionId does not belong to this league.');
      }
    }

    if (expectedSeasonId && presentationSeason?.id !== expectedSeasonId) {
      return jsonError(
        409,
        'SEASON_MISMATCH',
        'The presentation season changed; refresh league Home data.',
        { presentationSeasonId: presentationSeason?.id ?? null },
      );
    }

    let leaders: PublicHomeLeader[] = [];
    let standings: PublicHomeStanding[] = [];

    // Never pass null/undefined to the unified producer: those values select
    // all-time data. A league without an operational season has factual empties.
    if (presentationSeason) {
      const [canonicalLeaderRows, canonicalStandingRows] = await Promise.all([
        getUnifiedSkaterStatsRows(
          league.id,
          presentationSeason.id,
          divisionId,
          league.slug,
          presentationSeason.name,
        ),
        getStandings(league.id, presentationSeason.id),
      ]);

      leaders = buildPublicHomeLeaders(canonicalLeaderRows);
      const selectedStandings = divisionId
        ? canonicalStandingRows.filter((standing) => standing.division_id === divisionId)
        : canonicalStandingRows;

      if (selectedStandings.length > MAX_STANDINGS_ROWS) {
        throw new PayloadLimitError('standing row limit exceeded');
      }
      standings = selectedStandings.map(mapStanding);
    }

    const payload = {
      schemaVersion: PUBLIC_HOME_SCHEMA_VERSION,
      leagueId: league.id,
      leagueSlug: league.slug,
      presentationSeason: presentationSeason
        ? mapPresentationSeason(presentationSeason)
        : null,
      leaders,
      standings,
      divisions: divisions.map(mapDivision),
    };

    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_RESPONSE_BYTES) {
      throw new PayloadLimitError('serialized response limit exceeded');
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': SUCCESS_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof PayloadLimitError) {
      return jsonError(
        503,
        'PAYLOAD_LIMIT_EXCEEDED',
        'Public Home data exceeds the complete response limit.',
      );
    }

    // Do not return or log provider messages, query text, or credentials.
    console.error('[public-home] public read failed', {
      leagueSlug,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return jsonError(
      503,
      'HOME_DATA_UNAVAILABLE',
      'Public Home data is temporarily unavailable.',
    );
  }
}
