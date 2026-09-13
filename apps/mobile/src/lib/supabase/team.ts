import { supabase } from './client';

export type TeamActiveSeason = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at?: string | null;
};

export type TeamAssignment = {
  team_id: string;
  team_name: string;
  primary_color: string | null;
  logo_url: string | null;
  leadership_role: string | null;
};

export type TeamRosterMember = {
  avatar_url: string | null;
  id: string;
  player_id: string;
  team_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean;
  leadership_role?: string | null;
  player_name: string;
};

export type ActiveTeamMembership = {
  leagueId: string;
  leagueName: string;
  leagueCity: string | null;
  seasonId: string;
  seasonName: string;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  jerseyNumber: number | null;
  position: string | null;
};

type LeagueIdentity = { id: string; name: string; city?: string | null };

type TeamRosterDbRow = {
  id: string;
  player_id: string;
  team_id: string;
  league_id: string;
  season_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean | null;
  leadership_role: string | null;
};

type ProfileDbRow = { id: string; full_name: string | null; avatar_url: string | null };
type ActiveSeasonDbRow = TeamActiveSeason & { league_id: string; created_at?: string | null };
type MembershipTeamRow = { id: string; name: string | null; logo_url: string | null; primary_color: string | null };
type MembershipDbRow = Pick<TeamRosterDbRow, 'id' | 'team_id' | 'league_id' | 'season_id' | 'jersey_number' | 'position'> & {
  team: MembershipTeamRow | MembershipTeamRow[] | null;
};

const TEAM_CURRENT_SEASON_STATUSES = ['active', 'playoffs'] as const;
const METRICS_OPERATIONAL_SEASON_PRIORITY: Readonly<Record<string, number>> = {
  active: 0,
  playoffs: 1,
  registration: 2,
  upcoming: 2,
  draft: 3,
  completed: 4,
  archived: 5,
};

function compareNewestNullable(left: string | null | undefined, right: string | null | undefined) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right.localeCompare(left);
}

function compareTeamCurrentSeasons(left: ActiveSeasonDbRow, right: ActiveSeasonDbRow) {
  const statusDifference =
    TEAM_CURRENT_SEASON_STATUSES.indexOf(left.status as (typeof TEAM_CURRENT_SEASON_STATUSES)[number]) -
    TEAM_CURRENT_SEASON_STATUSES.indexOf(right.status as (typeof TEAM_CURRENT_SEASON_STATUSES)[number]);
  if (statusDifference !== 0) return statusDifference;

  const startDifference = compareNewestNullable(left.start_date, right.start_date);
  if (startDifference !== 0) return startDifference;

  const createdDifference = compareNewestNullable(left.created_at, right.created_at);
  return createdDifference !== 0 ? createdDifference : left.id.localeCompare(right.id);
}

function selectTeamCurrentSeason(rows: ActiveSeasonDbRow[], leagueId: string) {
  return rows
    .filter(
      (season) =>
        season.league_id === leagueId &&
        TEAM_CURRENT_SEASON_STATUSES.includes(season.status as (typeof TEAM_CURRENT_SEASON_STATUSES)[number]),
    )
    .sort(compareTeamCurrentSeasons)[0] ?? null;
}

function compareRosterRows<T extends { id: string; jersey_number: number | null }>(left: T, right: T) {
  const jerseyDifference =
    (left.jersey_number ?? Number.MAX_SAFE_INTEGER) -
    (right.jersey_number ?? Number.MAX_SAFE_INTEGER);
  if (jerseyDifference !== 0) return jerseyDifference;
  return String(left.id).localeCompare(String(right.id));
}

export function dedupeTeamRosterRows<T extends { id: string; player_id: string; jersey_number: number | null }>(rows: T[]): T[] {
  const rowsByPlayer = new Map<string, T>();
  for (const row of [...rows].sort(compareRosterRows)) {
    if (!rowsByPlayer.has(row.player_id)) rowsByPlayer.set(row.player_id, row);
  }
  return Array.from(rowsByPlayer.values());
}

export async function getTeamActiveSeason(
  leagueId: string,
): Promise<{ season: TeamActiveSeason | null; error: string | null }> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, league_id, name, start_date, end_date, status, created_at')
    .eq('league_id', leagueId)
    .in('status', [...TEAM_CURRENT_SEASON_STATUSES])
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true });

  if (error) {
    return { season: null, error: 'We could not determine the active season for this league.' };
  }

  const season = selectTeamCurrentSeason(
    (data as unknown as ActiveSeasonDbRow[] | null) ?? [],
    leagueId,
  );
  return { season, error: null };
}

/** Deterministic presentation-season resolver shared by every new v2 metrics consumer. */
export async function getMetricsOperationalSeason(
  leagueId: string,
): Promise<{ season: TeamActiveSeason | null; error: string | null }> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, league_id, name, start_date, end_date, status, created_at')
    .eq('league_id', leagueId);
  if (error) return { season: null, error: 'We could not determine the operational season for this league.' };
  const timestamp = (season: ActiveSeasonDbRow) => {
    const value = season.start_date ?? season.end_date ?? season.created_at ?? null;
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const rows = ((data as unknown as ActiveSeasonDbRow[] | null) ?? [])
    .filter((season) => season.league_id === leagueId)
    .sort((left, right) => {
      const status = (METRICS_OPERATIONAL_SEASON_PRIORITY[left.status] ?? 99)
        - (METRICS_OPERATIONAL_SEASON_PRIORITY[right.status] ?? 99);
      return status || timestamp(right) - timestamp(left) || left.id.localeCompare(right.id);
    });
  return { season: rows[0] ?? null, error: null };
}

export async function getActiveSeasonTeamForUser(
  userId: string,
  leagueId: string,
  seasonId: string,
): Promise<TeamAssignment | null> {
  const { data, error } = await supabase
    .from('team_rosters')
    .select('id, team_id, league_id, season_id, joined_at, leadership_role, team:teams!team_rosters_team_id_fkey(id, name, primary_color, logo_url)')
    .eq('player_id', userId)
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('status', 'active')
    .is('end_date', null)
    .order('joined_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('Unable to load the active team assignment.');
  if (!data || data.league_id !== leagueId || data.season_id !== seasonId) return null;

  const team = Array.isArray(data.team) ? data.team[0] : data.team;
  if (!team || team.id !== data.team_id) return null;

  return {
    team_id: data.team_id,
    team_name: team.name ?? 'Unknown team',
    primary_color: team.primary_color ?? null,
    logo_url: team.logo_url ?? null,
    leadership_role: data.leadership_role ?? null,
  };
}

export async function getActiveSeasonRoster(
  teamId: string,
  leagueId: string,
  seasonId: string,
): Promise<TeamRosterMember[]> {
  const { data, error } = await supabase
    .from('team_rosters')
    .select('id, player_id, team_id, league_id, season_id, jersey_number, position, is_goalie, leadership_role')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('status', 'active')
    .is('end_date', null);

  if (error) throw new Error('Unable to load the active-season roster.');

  const rosterRows = dedupeTeamRosterRows((data as unknown as TeamRosterDbRow[] | null) ?? []);
  if (rosterRows.length === 0) return [];

  const playerIds = rosterRows.map((row) => row.player_id);
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', playerIds);

  if (profileError) throw new Error('Unable to load active roster profiles.');

  const profiles = new Map(
    ((profileData as unknown as ProfileDbRow[] | null) ?? []).map((profile) => [
      profile.id,
      { name: profile.full_name ?? 'Unknown', avatarUrl: profile.avatar_url ?? null },
    ]),
  );

  return rosterRows
    .map((row) => ({
      id: row.id,
      player_id: row.player_id,
      team_id: row.team_id,
      jersey_number: row.jersey_number ?? null,
      position: row.position ?? null,
      is_goalie: row.is_goalie ?? false,
      leadership_role: row.leadership_role ?? null,
      player_name: profiles.get(row.player_id)?.name ?? 'Unknown',
      avatar_url: profiles.get(row.player_id)?.avatarUrl ?? null,
    }))
    .sort((left, right) => {
      const jerseyDifference =
        (left.jersey_number ?? Number.MAX_SAFE_INTEGER) -
        (right.jersey_number ?? Number.MAX_SAFE_INTEGER);
      if (jerseyDifference !== 0) return jerseyDifference;
      const nameDifference = left.player_name.localeCompare(right.player_name);
      return nameDifference !== 0 ? nameDifference : left.player_id.localeCompare(right.player_id);
    });
}

export async function getActiveSeasonMembershipsForUser(
  userId: string,
  leagues: LeagueIdentity[],
): Promise<{ data: ActiveTeamMembership[]; error: string | null }> {
  if (leagues.length === 0) return { data: [], error: null };

  const leagueIds = leagues.map((league) => league.id);
  const { data: seasonsData, error: seasonsError } = await supabase
    .from('seasons')
    .select('id, league_id, name, start_date, end_date, status, created_at')
    .in('league_id', leagueIds)
    .in('status', [...TEAM_CURRENT_SEASON_STATUSES])
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true });

  if (seasonsError) {
    return { data: [], error: 'We could not determine active seasons for My Teams.' };
  }

  const activeSeasonByLeague = new Map<string, ActiveSeasonDbRow>();
  const seasonRows = (seasonsData as unknown as ActiveSeasonDbRow[] | null) ?? [];
  for (const leagueId of leagueIds) {
    const season = selectTeamCurrentSeason(seasonRows, leagueId);
    if (season) activeSeasonByLeague.set(leagueId, season);
  }

  const seasonIds = Array.from(activeSeasonByLeague.values()).map((season) => season.id);
  if (seasonIds.length === 0) return { data: [], error: null };

  const { data: rosterData, error: rosterError } = await supabase
    .from('team_rosters')
    .select('id, team_id, league_id, season_id, jersey_number, position, team:teams!team_rosters_team_id_fkey(id, name, logo_url, primary_color)')
    .eq('player_id', userId)
    .eq('status', 'active')
    .is('end_date', null)
    .in('league_id', leagueIds)
    .in('season_id', seasonIds)
    .order('joined_at', { ascending: false })
    .order('id', { ascending: true });

  if (rosterError) return { data: [], error: 'We could not load active team assignments.' };

  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const cardsByMembership = new Map<string, ActiveTeamMembership>();

  for (const row of (rosterData as unknown as MembershipDbRow[] | null) ?? []) {
    const season = activeSeasonByLeague.get(row.league_id);
    const league = leagueById.get(row.league_id);
    const team = Array.isArray(row.team) ? row.team[0] : row.team;
    if (!season || !league || !team) continue;
    if (row.season_id !== season.id || row.team_id !== team.id) continue;

    const key = `${row.league_id}:${row.team_id}`;
    if (cardsByMembership.has(key)) continue;
    cardsByMembership.set(key, {
      leagueId: row.league_id,
      leagueName: league.name,
      leagueCity: league.city ?? null,
      seasonId: season.id,
      seasonName: season.name,
      teamId: row.team_id,
      teamName: team.name ?? 'Unknown team',
      teamLogoUrl: team.logo_url ?? null,
      teamPrimaryColor: team.primary_color ?? null,
      jerseyNumber: row.jersey_number ?? null,
      position: row.position ?? null,
    });
  }

  return {
    data: Array.from(cardsByMembership.values()).sort((left, right) => {
      const leagueDifference = left.leagueName.localeCompare(right.leagueName);
      return leagueDifference !== 0 ? leagueDifference : left.teamName.localeCompare(right.teamName);
    }),
    error: null,
  };
}
