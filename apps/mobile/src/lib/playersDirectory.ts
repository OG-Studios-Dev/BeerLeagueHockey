import { publicSupabase } from './supabase/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_PAGE_SIZE = 500;
const MAX_TEAMS = 5_000;
const MAX_MEMBERSHIPS = 20_000;
const TEAM_PROJECTION = 'id,league_id,name,slug,logo_url,division_id,primary_color,team_type';
const ROSTER_PROJECTION = `id,league_id,team_id,player_id,jersey_number,position,leadership_role,
  profile:profiles(id,full_name,avatar_url,photo_url),
  team:teams(id,league_id,name,slug,logo_url,division_id,primary_color,team_type)`;

type Raw = Record<string, unknown>;
type QueryResult = { data: unknown[] | null; error: { message?: string } | null };

export type DirectoryTeam = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  divisionId: string | null;
  primaryColor: string | null;
  teamType: string | null;
};

export type DirectoryMembership = {
  rosterId: string;
  id: string;
  fullName: string;
  photoUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  leadershipRole: string | null;
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamLogoUrl: string | null;
  divisionId: string | null;
  teamPrimaryColor: string | null;
};

export type PlayersDirectoryData = {
  league: { id: string; slug: string; name: string };
  teams: DirectoryTeam[];
  memberships: DirectoryMembership[];
  omittedOrphanRows: number;
};

export type DirectoryFilters = {
  search: string;
  teamId: string | null;
  divisionId: string | null;
  position: string | null;
};

function object(value: unknown, label: string): Raw {
  const single = Array.isArray(value) ? value[0] : value;
  if (!single || typeof single !== 'object' || Array.isArray(single)) throw new TypeError(`Invalid ${label}`);
  return single as Raw;
}

function text(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Invalid ${label}`);
  return value.trim();
}

function id(value: unknown, label: string): string {
  const result = text(value, label) as string;
  if (!UUID.test(result)) throw new TypeError(`Invalid ${label}`);
  return result;
}

function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : id(value, label);
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function isPublicTeam(team: { name: string; teamType: string | null }) {
  const normalized = team.name.trim().toLowerCase().replace(/\s+/g, ' ');
  return team.teamType !== 'free_agents'
    && team.teamType !== 'placeholder'
    && !new Set(['free agent', 'free agents', 'unassigned free agent', 'unassigned free agents']).has(normalized);
}

function decodeTeam(value: unknown, leagueId: string): DirectoryTeam {
  const row = object(value, 'team');
  if (id(row.league_id, 'team league id') !== leagueId) throw new TypeError('Players directory tenant mismatch');
  const slug = text(row.slug, 'team slug') as string;
  if (!SLUG.test(slug)) throw new TypeError('Invalid team slug');
  return {
    id: id(row.id, 'team id'),
    name: text(row.name, 'team name') as string,
    slug,
    logoUrl: text(row.logo_url, 'team logo URL', true),
    divisionId: nullableId(row.division_id, 'team division id'),
    primaryColor: text(row.primary_color, 'team primary color', true),
    teamType: text(row.team_type, 'team type', true),
  };
}

async function allPages(
  build: (from: number, to: number) => PromiseLike<QueryResult>,
  pageSize: number,
  limit: number,
  label: string,
) {
  const output: unknown[] = [];
  for (let from = 0; from <= limit; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to load public ${label}: ${error.message || 'query failed'}`);
    if (!Array.isArray(data)) throw new TypeError(`Invalid public ${label} response`);
    output.push(...data);
    if (output.length > limit) throw new RangeError(`Public ${label} exceeds ${limit} row safety limit`);
    if (data.length < pageSize) return output;
  }
  throw new RangeError(`Public ${label} exceeds ${limit} row safety limit`);
}

function rosterOrder(left: Raw, right: Raw) {
  const leftJersey = left.jersey_number;
  const rightJersey = right.jersey_number;
  if (leftJersey === null && rightJersey !== null) return 1;
  if (leftJersey !== null && rightJersey === null) return -1;
  if (typeof leftJersey === 'number' && typeof rightJersey === 'number' && leftJersey !== rightJersey) return leftJersey - rightJersey;
  return String(left.id).localeCompare(String(right.id));
}

export async function loadPublicPlayersDirectory({
  leagueId,
  leagueSlug,
  pageSize = DEFAULT_PAGE_SIZE,
}: { leagueId: string; leagueSlug: string; pageSize?: number }): Promise<PlayersDirectoryData> {
  if (!UUID.test(leagueId) || !SLUG.test(leagueSlug)) throw new TypeError('Invalid Players directory identity');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new RangeError('Invalid Players directory page size');

  const leagueQuery = await publicSupabase
    .from('leagues')
    .select('id,name,slug')
    .eq('id', leagueId)
    .eq('slug', leagueSlug)
    .maybeSingle();
  if (leagueQuery.error) throw new Error(`Unable to verify Players directory identity: ${leagueQuery.error.message}`);
  if (!leagueQuery.data) throw new TypeError('Players directory identity mismatch');
  const league = object(leagueQuery.data, 'league');
  if (id(league.id, 'league id') !== leagueId || text(league.slug, 'league slug') !== leagueSlug) {
    throw new TypeError('Players directory identity mismatch');
  }

  const rawTeams = await allPages(
    (from, to) => publicSupabase.from('teams').select(TEAM_PROJECTION).eq('league_id', leagueId)
      .order('name', { ascending: true }).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<QueryResult>,
    pageSize,
    MAX_TEAMS,
    'directory teams',
  );
  const allTeams = rawTeams.map((row) => decodeTeam(row, leagueId));
  if (new Set(allTeams.map((team) => team.id)).size !== allTeams.length) throw new TypeError('Duplicate Players directory team');
  allTeams.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const teamById = new Map(allTeams.map((team) => [team.id, team]));

  const rawRosters = await allPages(
    (from, to) => publicSupabase.from('team_rosters').select(ROSTER_PROJECTION).eq('league_id', leagueId)
      .order('jersey_number', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<QueryResult>,
    pageSize,
    MAX_MEMBERSHIPS,
    'directory rosters',
  );
  rawRosters.sort((left, right) => rosterOrder(object(left, 'roster'), object(right, 'roster')));

  let omittedOrphanRows = 0;
  const memberships: DirectoryMembership[] = [];
  for (const value of rawRosters) {
    const row = object(value, 'roster');
    if (id(row.league_id, 'roster league id') !== leagueId) throw new TypeError('Players directory roster tenant mismatch');
    const rosterId = id(row.id, 'roster id');
    if (row.profile === null || row.player_id === null) {
      omittedOrphanRows += 1;
      continue;
    }
    const profile = object(row.profile, 'roster profile');
    const teamRow = object(row.team, 'roster team');
    const teamId = id(row.team_id, 'roster team id');
    const playerId = id(row.player_id, 'roster player id');
    const canonicalTeam = teamById.get(teamId);
    if (!canonicalTeam || id(teamRow.id, 'joined team id') !== teamId || id(teamRow.league_id, 'joined team league id') !== leagueId) {
      throw new TypeError('Players directory roster references a cross-tenant team');
    }
    if (id(profile.id, 'profile id') !== playerId) throw new TypeError('Players directory roster profile identity mismatch');
    let fullName: string;
    try {
      fullName = text(profile.full_name, 'profile name') as string;
    } catch {
      omittedOrphanRows += 1;
      continue;
    }
    const avatar = text(profile.avatar_url, 'profile avatar URL', true);
    const photo = text(profile.photo_url, 'profile photo URL', true);
    memberships.push({
      rosterId,
      id: playerId,
      fullName,
      photoUrl: avatar || photo,
      jerseyNumber: nullableInteger(row.jersey_number, 'jersey number'),
      position: text(row.position, 'position', true),
      leadershipRole: text(row.leadership_role, 'leadership role', true),
      teamId,
      teamName: canonicalTeam.name,
      teamSlug: canonicalTeam.slug,
      teamLogoUrl: canonicalTeam.logoUrl,
      divisionId: canonicalTeam.divisionId,
      teamPrimaryColor: canonicalTeam.primaryColor,
    });
  }

  return {
    league: { id: leagueId, slug: leagueSlug, name: text(league.name, 'league name') as string },
    teams: allTeams.filter(isPublicTeam),
    memberships,
    omittedOrphanRows,
  };
}

export function buildPlayersDirectoryView(data: PlayersDirectoryData, filters: DirectoryFilters) {
  const matchingMemberships = data.memberships.filter((row) => (
    (!filters.divisionId || row.divisionId === filters.divisionId)
    && (!filters.teamId || row.teamId === filters.teamId)
    && (!filters.position || row.position === filters.position)
  ));
  const deduped = new Map<string, DirectoryMembership>();
  for (const row of matchingMemberships) if (!deduped.has(row.id)) deduped.set(row.id, row);
  const search = filters.search.trim().toLocaleLowerCase();
  const players = [...deduped.values()].filter((row) => !search
    || row.fullName.toLocaleLowerCase().includes(search)
    || (row.jerseyNumber !== null && String(row.jerseyNumber).includes(search)));
  const teamOptions = data.teams.filter((team) => !filters.divisionId || team.divisionId === filters.divisionId);
  const positions = [...new Set(players.map((row) => row.position).filter((value): value is string => Boolean(value)))];
  return { players, teamOptions, positions, teamCount: teamOptions.length };
}
