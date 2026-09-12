import { supabase } from './client';

// Deduplicate players by player_id (keep highest points row)
function dedupByPlayerId<T extends { player_id: string; points?: number; games_played?: number }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const existing = map.get(row.player_id);
    if (!existing || (row.points ?? 0) > (existing.points ?? 0)) {
      map.set(row.player_id, row);
    }
  }
  return Array.from(map.values());
}


// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string;
  status: string | null;
  location: string | null;
  season_id: string;
  division_id?: string | null;
  home_team?: { id: string; name: string; primary_color: string | null; logo_url?: string | null } | null;
  away_team?: { id: string; name: string; primary_color: string | null; logo_url?: string | null } | null;
};

export type StandingRow = {
  team_id: string | null;
  team_name: string | null;
  short_name?: string | null;
  primary_color: string | null;
  logo_url?: string | null;
  division_id?: string | null;
  division_name?: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points: number | null;
  goals_for: number | null;
  goals_against: number | null;
  games_played: number | null;
};

export type PlayerStatRow = {
  player_id: string;
  team_id: string;
  player_name: string;
  team_short_name: string;
  team_name?: string;
  position: string | null;
  is_goalie: boolean;
  jersey_number: number | null;
  goals: number;
  assists: number;
  points: number;
  plus_minus: number;
  games_played: number;
  penalty_minutes?: number;
};

export type GoalieStatRow = {
  player_id: string;
  player_name: string;
  team_id: string;
  team_name: string;
  games_played: number;
  wins: number;
  losses: number;
  save_percentage: number;
  goals_against_average: number;
  shutouts: number;
  saves?: number;
  goals_against?: number;
  avatar_url?: string | null;
};

export type RosterMemberRow = {
  avatar_url?: string | null;
  id: string;
  player_id: string;
  team_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie: boolean;
  player_name: string;
};

export type Division = {
  id: string;
  name: string;
  sort_order?: number | null;
};

export type Season = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: string;
};

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

export function mapGameStatus(status: string | null): 'Upcoming' | 'Live' | 'Final' {
  if (status === 'completed') return 'Final';
  if (status === 'in_progress') return 'Live';
  return 'Upcoming';
}

// ─────────────────────────────────────────
// Seasons
// ─────────────────────────────────────────

export async function getCurrentSeason(leagueId: string): Promise<Season | null> {
  for (const status of ['active', 'upcoming', 'completed'] as const) {
    const { data } = await supabase
      .from('seasons')
      .select('id, name, start_date, end_date, status')
      .eq('league_id', leagueId)
      .eq('status', status)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as Season;
  }
  const { data } = await supabase
    .from('seasons')
    .select('id, name, start_date, end_date, status')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Season) ?? null;
}

export async function getActiveSeason(leagueId: string): Promise<Season | null> {
  return getCurrentSeason(leagueId);
}

// ─────────────────────────────────────────
// Divisions
// ─────────────────────────────────────────

export async function getDivisions(leagueId: string): Promise<Division[]> {
  const { data, error } = await supabase
    .from('divisions')
    .select('id, name, sort_order')
    .eq('league_id', leagueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error || !data) return [];
  return data as Division[];
}

// ─────────────────────────────────────────
// Standings
// ─────────────────────────────────────────

export async function getStandings(leagueId: string, seasonId?: string): Promise<StandingRow[]> {
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, short_name, logo_url, primary_color, division_id, divisions(id, name)')
    .eq('league_id', leagueId);

  const teamInfoMap = new Map(
    (teams ?? []).map((t: any) => {
      const div = Array.isArray(t.divisions) ? t.divisions[0] : t.divisions;
      return [t.id, {
        name: t.name,
        short_name: t.short_name,
        logo_url: t.logo_url,
        primary_color: t.primary_color,
        division_id: div?.id || t.division_id,
        division_name: div?.name,
      }];
    })
  );

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_team_standings', {
    check_league_id: leagueId,
    check_season_id: seasonId || null,
  });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return rpcData
      .filter((s: any) => Number(s.games_played) > 0)
      .map((s: any) => {
        const info = teamInfoMap.get(s.team_id);
        return {
          team_id: s.team_id,
          team_name: info?.name ?? 'Unknown Team',
          short_name: info?.short_name ?? null,
          primary_color: info?.primary_color ?? null,
          logo_url: info?.logo_url ?? null,
          division_id: info?.division_id ?? null,
          division_name: info?.division_name ?? null,
          games_played: Number(s.games_played) || 0,
          wins: Number(s.wins) || 0,
          losses: Number(s.losses) || 0,
          ties: Number(s.ties) || 0,
          points: Number(s.points) || 0,
          goals_for: Number(s.goals_for) || 0,
          goals_against: Number(s.goals_against) || 0,
        } as StandingRow;
      });
  }

  let query = supabase
    .from('team_standings')
    .select('*')
    .order('points', { ascending: false });
  if (seasonId) query = query.eq('season_id', seasonId);

  const { data: standings, error } = await query;
  if (error || !standings) return [];

  return standings.map((s: any) => {
    const info = teamInfoMap.get(s.team_id);
    return {
      team_id: s.team_id,
      team_name: info?.name ?? s.name ?? 'Unknown Team',
      short_name: info?.short_name ?? s.short_name ?? null,
      primary_color: info?.primary_color ?? s.primary_color ?? null,
      logo_url: info?.logo_url ?? s.logo_url ?? null,
      division_id: info?.division_id ?? null,
      division_name: info?.division_name ?? null,
      games_played: Number(s.games_played) || 0,
      wins: Number(s.wins) || 0,
      losses: Number(s.losses) || 0,
      ties: Number(s.ties) || 0,
      points: Number(s.points) || 0,
      goals_for: Number(s.goals_for) || 0,
      goals_against: Number(s.goals_against) || 0,
    } as StandingRow;
  });
}

export async function getLeagueStandings(leagueId: string, seasonId?: string): Promise<StandingRow[]> {
  return getStandings(leagueId, seasonId);
}

// ─────────────────────────────────────────
// Stats Leaders
// ─────────────────────────────────────────

export async function getStatsLeaders(
  leagueId: string,
  statType: 'points' | 'goals' | 'assists' = 'points',
  limit = 20,
  divisionId?: string | null,
  seasonId?: string | null,
  options: { throwOnError?: boolean } = {},
): Promise<PlayerStatRow[]> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_stats_leaders', {
    p_league_id: leagueId,
    p_stat_type: statType,
    p_limit: limit,
    p_division_id: divisionId ?? null,
  });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return dedupByPlayerId((rpcData as any[]).map((s) => ({
      player_id: s.player_id,
      player_name: s.player_name ?? s.full_name ?? 'Unknown',
      team_id: s.team_id ?? '',
      team_name: s.team_name ?? 'Unknown',
      team_short_name: s.team_short_name ?? s.team_name ?? '???',
      position: s.position ?? null,
      is_goalie: false,
      jersey_number: s.jersey_number ?? null,
      goals: Number(s.goals) || 0,
      assists: Number(s.assists) || 0,
      points: Number(s.points) || 0,
      plus_minus: Number(s.plus_minus) || 0,
      games_played: Number(s.games_played) || 0,
      penalty_minutes: Number(s.penalty_minutes) || 0,
    }))).slice(0, limit);
  }

  const season = seasonId ? { id: seasonId } : await getCurrentSeason(leagueId);
  if (!season) return [];

  let query = supabase
    .from('player_season_stats')
    .select('*')
    .eq('season_id', season.id);

  if (divisionId) query = query.eq('division_id', divisionId);

  const { data: stats, error } = await query
    .order(statType, { ascending: false })
    .limit(limit);

  if (error) {
    if (options.throwOnError) throw new Error(error.message);
    return [];
  }
  if (!stats) return [];

  return dedupByPlayerId((stats as any[]).map((s) => ({
    player_id: s.player_id,
    player_name: s.full_name ?? 'Unknown',
    team_id: s.team_id ?? '',
    team_name: s.team_name ?? 'Unknown',
    team_short_name: s.team_name ?? '???',
    position: s.position ?? null,
    is_goalie: false,
    jersey_number: null,
    goals: Number(s.goals) || 0,
    assists: Number(s.assists) || 0,
    points: Number(s.points) || 0,
    plus_minus: 0,
    games_played: Number(s.games_played) || 0,
    penalty_minutes: 0,
  }))).slice(0, limit);
}

// ─────────────────────────────────────────
// Goalie Leaders
// ─────────────────────────────────────────

export async function getGoalieLeaders(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string | null,
  limit = 20,
): Promise<GoalieStatRow[]> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_goalie_season_stats', {
    check_league_id: leagueId,
    check_season_id: seasonId ?? null,
    check_division_id: divisionId ?? null,
  });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return (rpcData as any[]).slice(0, limit).map((row) => ({
      player_id: row.player_id,
      player_name: row.full_name ?? 'Unknown',
      team_id: row.team_id ?? '',
      team_name: row.team_name ?? 'Unknown',
      games_played: row.games_played || 0,
      wins: row.wins || 0,
      losses: row.losses || 0,
      save_percentage: row.save_percentage || 0,
      goals_against_average: row.goals_against_average || 0,
      shutouts: row.shutouts || 0,
      saves: row.total_saves || row.saves || 0,
      goals_against: row.total_goals_against || row.goals_against || 0,
      avatar_url: row.avatar_url ?? null,
    }));
  }

  const season = seasonId ? { id: seasonId } : await getCurrentSeason(leagueId);
  if (!season) return [];

  let query = supabase
    .from('player_season_stats')
    .select('*')
    .eq('season_id', season.id)
    .eq('position', 'G');

  if (divisionId) query = query.eq('division_id', divisionId);

  const { data, error } = await query.order('wins', { ascending: false }).limit(limit);
  if (error || !data) return [];

  return (data as any[]).map((s) => ({
    player_id: s.player_id,
    player_name: s.full_name ?? 'Unknown',
    team_id: s.team_id ?? '',
    team_name: s.team_name ?? 'Unknown',
    games_played: Number(s.games_played) || 0,
    wins: Number(s.wins) || 0,
    losses: Number(s.losses) || 0,
    save_percentage: Number(s.save_percentage) || 0,
    goals_against_average: Number(s.goals_against_average) || 0,
    shutouts: Number(s.shutouts) || 0,
    saves: Number(s.saves) || 0,
    goals_against: Number(s.goals_against) || 0,
    avatar_url: null,
  }));
}

// ─────────────────────────────────────────
// Schedule / Games
// ─────────────────────────────────────────

export async function getSchedule(
  leagueId: string,
  seasonId?: string | null,
  divisionId?: string | null,
): Promise<GameRow[]> {
  let query = supabase
    .from('games')
    .select(
      `id, home_team_id, away_team_id, home_score, away_score,
       scheduled_at, status, location, season_id, division_id,
       home_team:teams!games_home_team_id_fkey(id, name, primary_color, logo_url),
       away_team:teams!games_away_team_id_fkey(id, name, primary_color, logo_url)`,
    )
    .eq('league_id', leagueId)
    .order('scheduled_at', { ascending: true });

  if (seasonId) query = query.eq('season_id', seasonId);
  if (divisionId) query = query.eq('division_id', divisionId);

  const { data, error } = await query;
  if (error) {
    console.error('getSchedule error:', error);
    return [];
  }
  return (data as any[]) ?? [];
}

export async function getLeagueGames(leagueId: string, seasonId?: string): Promise<GameRow[]> {
  return getSchedule(leagueId, seasonId ?? null, null);
}

// ─────────────────────────────────────────
// Game Preview
// ─────────────────────────────────────────

export async function getGamePreview(gameId: string) {
  const { data, error } = await supabase
    .from('games')
    .select(
      `*,
       home_team:teams!games_home_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division:divisions(id, name)),
       away_team:teams!games_away_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, division:divisions(id, name))`,
    )
    .eq('id', gameId)
    .single();

  if (error || !data) return null;

  const transformTeam = (team: any) => {
    if (!team) return null;
    const raw = Array.isArray(team) ? team[0] : team;
    if (!raw) return null;
    return {
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      logo: raw.logo_url ?? null,
      colors: [raw.primary_color, raw.secondary_color].filter(Boolean).join(',') || null,
      division: Array.isArray(raw.division) ? raw.division[0] : raw.division,
    };
  };

  return {
    ...(data as any),
    venue: (data as any).location ?? null,
    home_team: transformTeam((data as any).home_team),
    away_team: transformTeam((data as any).away_team),
  };
}

export async function getSeasonSeries(homeTeamId: string, awayTeamId: string, leagueId: string) {
  const { data } = await supabase
    .from('games')
    .select('id, scheduled_at, home_score, away_score, status, home_team_id, away_team_id')
    .eq('league_id', leagueId)
    .eq('status', 'completed')
    .or(
      `and(home_team_id.eq.${homeTeamId},away_team_id.eq.${awayTeamId}),and(home_team_id.eq.${awayTeamId},away_team_id.eq.${homeTeamId})`,
    )
    .order('scheduled_at', { ascending: false })
    .limit(5);
  return data ?? [];
}

export async function getTopPlayers(homeTeamId: string, awayTeamId: string, seasonId: string) {
  const { data } = await supabase
    .from('player_season_stats')
    .select('player_id, full_name, goals, assists, points, games_played, team_id')
    .in('team_id', [homeTeamId, awayTeamId])
    .eq('season_id', seasonId)
    .order('points', { ascending: false })
    .limit(10);
  return data ?? [];
}

export async function getGoalieStats(homeTeamId: string, awayTeamId: string, seasonId: string) {
  const { data } = await supabase
    .from('player_season_stats')
    .select('player_id, full_name, games_played, goals, assists, points, team_id, position')
    .in('team_id', [homeTeamId, awayTeamId])
    .eq('position', 'G')
    .eq('season_id', seasonId);
  return data ?? [];
}

export async function getGameGoalScorers(gameId: string) {
  const { data: stats } = await supabase
    .from('player_stats')
    .select('player_id, goals, assists, team_id')
    .eq('game_id', gameId)
    .gt('goals', 0)
    .order('goals', { ascending: false });

  if (!stats || stats.length === 0) return [];

  const playerIds = stats.map((s) => s.player_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', playerIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return stats.map((s) => ({
    ...s,
    full_name: profileMap.get(s.player_id) ?? 'Unknown',
  }));
}

// ─────────────────────────────────────────
// Team Detail
// ─────────────────────────────────────────

export async function getTeamDetail(teamId: string, leagueId: string) {
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('*, division:divisions(id, name)')
    .eq('id', teamId)
    .single();

  if (teamError || !team) return null;

  const { data: rosterRows } = await supabase
    .from('team_rosters')
    .select('id, player_id, jersey_number, position, is_goalie, status, profile:profiles(id, full_name, avatar_url)')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('status', 'active');

  const roster = (rosterRows ?? []).map((r: any) => {
    const profile = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    return {
      id: r.id,
      player_id: r.player_id,
      jersey_number: r.jersey_number,
      position: r.position,
      is_goalie: r.is_goalie ?? false,
      player_name: profile?.full_name ?? 'Unknown',
      avatar_url: profile?.avatar_url ?? null,
    };
  }).sort((a: any, b: any) => (a.jersey_number ?? 99) - (b.jersey_number ?? 99));

  const rawTeam = team as any;
  return {
    id: rawTeam.id,
    name: rawTeam.name,
    slug: rawTeam.slug,
    logo_url: rawTeam.logo_url,
    primary_color: rawTeam.primary_color,
    secondary_color: rawTeam.secondary_color,
    division: Array.isArray(rawTeam.division) ? rawTeam.division[0] : rawTeam.division,
    roster,
  };
}

// ─────────────────────────────────────────
// Roster
// ─────────────────────────────────────────

export async function getTeamRoster(teamId: string, leagueId: string): Promise<RosterMemberRow[]> {
  const { data, error } = await supabase
    .from('team_rosters')
    .select('id, player_id, team_id, jersey_number, position, is_goalie')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('status', 'active');

  if (error) {
    console.error('getTeamRoster error:', error);
    return [];
  }

  const rows = (data ?? []) as any[];
  const playerIds = rows.map((r: any) => r.player_id);

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', playerIds);

  const profileMap = new Map<string, { name: string; avatar_url: string | null }>();
  for (const p of (profileData ?? []) as any[]) {
    profileMap.set(p.id, { name: p.full_name ?? 'Unknown', avatar_url: p.avatar_url ?? null });
  }

  return rows
    .map((r: any) => {
      const profile = profileMap.get(r.player_id);
      return {
        id: r.id,
        player_id: r.player_id,
        team_id: r.team_id,
        jersey_number: r.jersey_number,
        position: r.position,
        is_goalie: r.is_goalie ?? false,
        player_name: profile?.name ?? 'Unknown',
        avatar_url: profile?.avatar_url ?? null,
      };
    })
    .sort((a: any, b: any) => (a.jersey_number ?? 99) - (b.jersey_number ?? 99));
}

// ─────────────────────────────────────────
// User Team
// ─────────────────────────────────────────

export async function getUserTeamInLeague(
  userId: string,
  leagueId: string,
): Promise<{ team_id: string; team_name: string; short_name: string; primary_color: string | null; logo_url: string | null } | null> {
  const { data, error } = await supabase
    .from('team_rosters')
    .select('team_id, team:teams!team_rosters_team_id_fkey(name, short_name, primary_color, logo_url)')
    .eq('player_id', userId)
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as any;
  return {
    team_id: row.team_id,
    team_name: row.team?.name ?? 'Unknown',
    short_name: row.team?.short_name ?? '???',
    primary_color: row.team?.primary_color ?? null,
    logo_url: row.team?.logo_url ?? null,
  };
}

// ─────────────────────────────────────────
// Legacy getLeaguePlayers (compat)
// ─────────────────────────────────────────

export async function getLeaguePlayers(leagueId: string): Promise<PlayerStatRow[]> {
  return getStatsLeaders(leagueId, 'points', 50, null, null);
}

// ─────────────────────────────────────────
// BLH Global Stats
// ─────────────────────────────────────────

export type BLHGlobalStats = {
  totalLeagues: number;
  totalActivePlayers: number;
  totalGamesThisSeason: number;
};

export async function getBLHGlobalStats(): Promise<BLHGlobalStats> {
  const [leaguesRes, playersRes, gamesRes] = await Promise.all([
    supabase.from('leagues').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('games').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
  ]);

  return {
    totalLeagues: leaguesRes.count ?? 0,
    totalActivePlayers: playersRes.count ?? 0,
    totalGamesThisSeason: gamesRes.count ?? 0,
  };
}
