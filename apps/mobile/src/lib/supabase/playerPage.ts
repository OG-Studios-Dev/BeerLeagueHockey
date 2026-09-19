import { HOCKEY_LIFE_ID } from '../../config/hockeyLife';
import { resolvePlayerSeasonSelection } from '../playerPageModel';
import { supabase } from './client';

export type PlayerSeason = { id: string; name: string; start_date: string | null; status: string | null };
export type PlayerMetricValues = Record<string, number | null>;

export type HockeyLifePlayerPage = {
  playerId: string;
  rosterId: string;
  fullName: string;
  photoUrl: string | null;
  position: string | null;
  leadershipRole: string | null;
  jerseyNumber: number | null;
  isGoalie: boolean;
  team: { id: string; name: string; slug: string | null; logoUrl: string | null; primaryColor: string | null } | null;
  seasons: PlayerSeason[];
  selectedSeasonId: string | null;
  selectedSeasonName: string | null;
  isCareer: boolean;
  metrics: PlayerMetricValues | null;
  careerRows: Array<{ seasonId: string; seasonName: string; metrics: PlayerMetricValues }>;
  badges: Array<{ id: string; type: string; seasonId: string | null; seasonName: string | null; teamName: string | null; createdAt: string }>;
  games: Array<{ id: string; date: string; opponent: string; result: string; score: string; metrics: PlayerMetricValues }>;
  matchups: Array<{ id: string; name: string; gamesPlayed: number; goals: number; assists: number; points: number; shots: number; shootingPct: number | null }>;
  articles: Array<{ id: string; slug: string | null; title: string; excerpt: string | null; publishedAt: string | null }>;
};

type RawRoster = {
  id: string;
  player_id: string;
  jersey_number: number | null;
  position: string | null;
  is_goalie?: boolean | null;
  leadership_role: string | null;
  team: unknown;
};

type RawProfile = { full_name?: string | null; avatar_url?: string | null; photo_url?: string | null };
type RawTeam = { id: string; name: string; slug?: string | null; logo_url?: string | null; primary_color?: string | null };
type RawNamedRelation = { name?: string | null; full_name?: string | null };
type RawGame = {
  id: string;
  league_id?: string | null;
  scheduled_at: string;
  home_score?: number | null;
  away_score?: number | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_team?: unknown;
  away_team?: unknown;
};
type RawGameLog = Record<string, unknown> & { team_id?: string | null; game?: unknown };
type RawMatchup = Record<string, unknown> & { player?: unknown; goalie?: unknown };
type RawBadge = Record<string, unknown> & { id: string; badge_type: string; created_at: string; season?: unknown; team?: unknown };
type RawArticle = Record<string, unknown> & { id: string; title: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function knownNumber(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce((total, row) => total + number(row[key]), 0);
}

function sumKnown(rows: Array<Record<string, unknown>>, key: string) {
  const values = rows.flatMap((row) => {
    const value = row[key];
    if (value == null || value === '') return [];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function dataOrThrow<T>(result: { data: T; error: unknown }, context: string): T {
  if (result.error) {
    const detail = typeof result.error === 'object' && result.error && 'message' in result.error
      ? String(result.error.message)
      : String(result.error);
    throw new Error(`${context}: ${detail}`);
  }
  return result.data;
}

function isRosterGoalie(roster: RawRoster) {
  if (typeof roster.is_goalie === 'boolean') return roster.is_goalie;
  const position = roster.position?.trim().toLowerCase();
  return position === 'g' || position === 'goalie';
}

function resultForGame(game: RawGame | null, teamId: string | null) {
  if (!game || game.home_score == null || game.away_score == null || !teamId) return '-';
  const mine = game.home_team_id === teamId ? number(game.home_score) : number(game.away_score);
  const theirs = game.home_team_id === teamId ? number(game.away_score) : number(game.home_score);
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
}

function scoreForGame(game: RawGame | null) {
  return game?.home_score == null || game?.away_score == null ? '-' : `${game.away_score}-${game.home_score}`;
}

function opponentForGame(game: RawGame | null, teamId: string | null) {
  const home = one(game?.home_team as RawNamedRelation | RawNamedRelation[] | null | undefined);
  const away = one(game?.away_team as RawNamedRelation | RawNamedRelation[] | null | undefined);
  return game?.home_team_id === teamId ? away?.name ?? 'TBD' : home?.name ?? 'TBD';
}

export async function loadHockeyLifePlayerPage(
  playerOrRosterId: string,
  requestedSeasonId?: string | null,
): Promise<HockeyLifePlayerPage | null> {
  const rosterSelect = 'id, player_id, jersey_number, position, is_goalie, leadership_role, team:teams!team_rosters_team_id_fkey(id, name, slug, logo_url, primary_color, league_id)';
  let rosterResult = await supabase
    .from('team_rosters')
    .select(rosterSelect)
    .eq('id', playerOrRosterId)
    .eq('league_id', HOCKEY_LIFE_ID)
    .maybeSingle();

  let roster = dataOrThrow(rosterResult, 'Hockey Life roster identity lookup') as RawRoster | null;
  const seasonsResult = await supabase
    .from('seasons')
    .select('id, name, start_date, status')
    .eq('league_id', HOCKEY_LIFE_ID)
    .order('start_date', { ascending: false })
    .order('id', { ascending: true });
  const seasons = (dataOrThrow(seasonsResult, 'Hockey Life seasons lookup') as PlayerSeason[] | null) ?? [];
  const currentSeason = seasons.find((season) => season.status === 'active')
    ?? seasons.find((season) => season.status === 'playoffs')
    ?? null;

  if (!roster) {
    if (!currentSeason) return null;
    rosterResult = await supabase
      .from('team_rosters')
      .select(rosterSelect)
      .eq('player_id', playerOrRosterId)
      .eq('league_id', HOCKEY_LIFE_ID)
      .eq('season_id', currentSeason.id)
      .in('status', ['active', 'injured'])
      .is('end_date', null)
      .order('joined_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    roster = dataOrThrow(rosterResult, 'Hockey Life current roster lookup') as RawRoster | null;
  }
  if (!roster) return null;

  const playerId = roster.player_id;
  const [profileResult, badgesResult, articlesResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name, avatar_url, photo_url').eq('id', playerId).maybeSingle(),
    supabase.from('player_badges').select('id, badge_type, league_id, season_id, team_id, created_at, season:seasons(name), team:teams(name)').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).order('created_at', { ascending: false }).order('id', { ascending: true }),
    supabase.from('articles')
      .select('id, slug, title, excerpt, published_at, created_at, league_id, article_player_tags!inner(player_id)')
      .eq('article_player_tags.player_id', playerId)
      .eq('league_id', HOCKEY_LIFE_ID)
      .eq('published', true)
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(5),
  ]);

  const profile = dataOrThrow(profileResult, 'Player profile lookup') as RawProfile | null;
  const badges = (dataOrThrow(badgesResult, 'Player badges lookup') as RawBadge[] | null) ?? [];
  const articles = (dataOrThrow(articlesResult, 'Player articles lookup') as RawArticle[] | null) ?? [];
  const selection = resolvePlayerSeasonSelection(
    seasons,
    currentSeason?.id ?? null,
    requestedSeasonId === null ? 'all' : requestedSeasonId ?? null,
  );
  const selectedSeasonId = selection.selectedId;
  const seasonIds = new Set(seasons.map((season) => season.id));
  const scopedSeasonIds = [...seasonIds];
  const team = one(roster.team as RawTeam | RawTeam[] | null | undefined);
  const isGoalie = isRosterGoalie(roster);

  let skaterRows: Array<Record<string, unknown>> = [];
  let goalieRows: Array<Record<string, unknown>> = [];
  let careerStatsRows: Array<Record<string, unknown>> = [];
  let careerGoalieRows: Array<Record<string, unknown>> = [];
  let skaterDetailRows: Array<Record<string, unknown>> = [];
  if (scopedSeasonIds.length) {
    let seasonStatsQuery = supabase
      .from('player_season_stats')
      .select('season_id, team_id, team_name, position, games_played, goals, assists, points')
      .eq('player_id', playerId)
      .in('season_id', scopedSeasonIds);
    let goalieStatsQuery = supabase
      .from('goalie_stats')
      .select('season_id, team_id, game_id, saves, goals_against, game_result, shutout')
      .eq('player_id', playerId)
      .eq('league_id', HOCKEY_LIFE_ID)
      .in('season_id', scopedSeasonIds);
    if (selectedSeasonId) {
      seasonStatsQuery = seasonStatsQuery.eq('season_id', selectedSeasonId) as typeof seasonStatsQuery;
      goalieStatsQuery = goalieStatsQuery.eq('season_id', selectedSeasonId) as typeof goalieStatsQuery;
    }

    const [seasonStatsResult, goalieStatsResult, careerStatsResult, careerGoalieResult, skaterDetailResult] = await Promise.all([
      seasonStatsQuery,
      goalieStatsQuery,
      supabase.from('player_season_stats').select('season_id, games_played, goals, assists, points').eq('player_id', playerId).in('season_id', scopedSeasonIds),
      supabase.from('goalie_stats').select('season_id, saves, goals_against, game_result, shutout').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).in('season_id', scopedSeasonIds),
      supabase.from('player_stats').select('season_id, penalty_minutes, plus_minus').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).in('season_id', scopedSeasonIds),
    ]);
    skaterRows = (dataOrThrow(seasonStatsResult, 'Selected skater stats lookup') as Array<Record<string, unknown>> | null) ?? [];
    goalieRows = (dataOrThrow(goalieStatsResult, 'Selected goalie stats lookup') as Array<Record<string, unknown>> | null) ?? [];
    careerStatsRows = (dataOrThrow(careerStatsResult, 'Career skater stats lookup') as Array<Record<string, unknown>> | null) ?? [];
    careerGoalieRows = (dataOrThrow(careerGoalieResult, 'Career goalie stats lookup') as Array<Record<string, unknown>> | null) ?? [];
    skaterDetailRows = (dataOrThrow(skaterDetailResult, 'Skater detail stats lookup') as Array<Record<string, unknown>> | null) ?? [];
  }

  const selectedSkaterDetailRows = selectedSeasonId
    ? skaterDetailRows.filter((row) => row.season_id === selectedSeasonId)
    : skaterDetailRows;
  const metrics: PlayerMetricValues | null = isGoalie
    ? goalieRows.length ? {
        games_played: goalieRows.length,
        wins: goalieRows.filter((row) => row.game_result === 'W').length,
        losses: goalieRows.filter((row) => row.game_result === 'L').length,
        saves: sum(goalieRows, 'saves'),
        goals_against: sum(goalieRows, 'goals_against'),
        save_percentage: (sum(goalieRows, 'saves') + sum(goalieRows, 'goals_against')) > 0
          ? (sum(goalieRows, 'saves') / (sum(goalieRows, 'saves') + sum(goalieRows, 'goals_against'))) * 100 : null,
        goals_against_average: goalieRows.length ? sum(goalieRows, 'goals_against') / goalieRows.length : null,
        shutouts: goalieRows.filter((row) => Boolean(row.shutout)).length,
      } : null
    : skaterRows.length ? {
        games_played: sum(skaterRows, 'games_played'), goals: sum(skaterRows, 'goals'), assists: sum(skaterRows, 'assists'),
        points: sum(skaterRows, 'points'), penalty_minutes: sumKnown(selectedSkaterDetailRows, 'penalty_minutes'), plus_minus: sumKnown(selectedSkaterDetailRows, 'plus_minus'),
      } : null;

  const careerBySeason = new Map<string, Array<Record<string, unknown>>>();
  const careerSource = isGoalie ? careerGoalieRows : careerStatsRows;
  for (const row of careerSource) {
    const seasonId = typeof row.season_id === 'string' ? row.season_id : '';
    if (!seasonIds.has(seasonId)) continue;
    careerBySeason.set(seasonId, [...(careerBySeason.get(seasonId) ?? []), row]);
  }
  const careerRows = seasons.slice().reverse().flatMap((season) => {
    const rows = careerBySeason.get(season.id) ?? [];
    if (!rows.length) return [];
    const values: PlayerMetricValues = isGoalie ? {
      games_played: rows.length, wins: rows.filter((row) => row.game_result === 'W').length,
      save_percentage: (sum(rows, 'saves') + sum(rows, 'goals_against')) > 0 ? (sum(rows, 'saves') / (sum(rows, 'saves') + sum(rows, 'goals_against'))) * 100 : null,
      goals_against_average: rows.length ? sum(rows, 'goals_against') / rows.length : null, saves: sum(rows, 'saves'), shutouts: rows.filter((row) => Boolean(row.shutout)).length,
    } : {
      games_played: sum(rows, 'games_played'), goals: sum(rows, 'goals'), assists: sum(rows, 'assists'), points: sum(rows, 'points'),
      points_per_game: sum(rows, 'games_played') > 0 ? sum(rows, 'points') / sum(rows, 'games_played') : 0,
      penalty_minutes: sumKnown(skaterDetailRows.filter((row) => row.season_id === season.id), 'penalty_minutes'),
      plus_minus: sumKnown(skaterDetailRows.filter((row) => row.season_id === season.id), 'plus_minus'),
    };
    return [{ seasonId: season.id, seasonName: season.name, metrics: values }];
  });

  let games: HockeyLifePlayerPage['games'] = [];
  let matchups: HockeyLifePlayerPage['matchups'] = [];
  if (selectedSeasonId) {
    if (isGoalie) {
      const goalieLog = await supabase.from('goalie_stats').select('game_id, team_id, saves, goals_against, game:games(id, league_id, scheduled_at, home_score, away_score, home_team_id, away_team_id, home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name))').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).eq('season_id', selectedSeasonId).order('created_at', { ascending: false }).order('game_id', { ascending: true }).limit(20);
      const goalieLogRows = (dataOrThrow(goalieLog, 'Goalie game log lookup') as RawGameLog[] | null) ?? [];
      games = goalieLogRows.flatMap((row) => {
        const game = one(row.game as RawGame | RawGame[] | null | undefined);
        if (!game || game.league_id !== HOCKEY_LIFE_ID) return [];
        return [{ id: game.id, date: game.scheduled_at, opponent: opponentForGame(game, row.team_id ?? null), result: resultForGame(game, row.team_id ?? null), score: scoreForGame(game), metrics: { saves: number(row.saves), goals_against: number(row.goals_against), save_percentage: (number(row.saves) + number(row.goals_against)) > 0 ? (number(row.saves) / (number(row.saves) + number(row.goals_against))) * 100 : null } }];
      });
    } else {
      const skaterLog = await supabase.from('player_stats').select('game_id, team_id, goals, assists, penalty_minutes, plus_minus, game:games(id, league_id, scheduled_at, home_score, away_score, home_team_id, away_team_id, home_team:teams!games_home_team_id_fkey(name), away_team:teams!games_away_team_id_fkey(name))').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).eq('season_id', selectedSeasonId).order('created_at', { ascending: false }).order('game_id', { ascending: true }).limit(20);
      const skaterLogRows = (dataOrThrow(skaterLog, 'Skater game log lookup') as RawGameLog[] | null) ?? [];
      games = skaterLogRows.flatMap((row) => {
        const game = one(row.game as RawGame | RawGame[] | null | undefined);
        if (!game || game.league_id !== HOCKEY_LIFE_ID) return [];
        return [{ id: game.id, date: game.scheduled_at, opponent: opponentForGame(game, row.team_id ?? null), result: resultForGame(game, row.team_id ?? null), score: scoreForGame(game), metrics: { goals: number(row.goals), assists: number(row.assists), points: number(row.goals) + number(row.assists), penalty_minutes: knownNumber(row.penalty_minutes), plus_minus: knownNumber(row.plus_minus) } }];
      });
    }

    const matchupResult = isGoalie
      ? await supabase.from('player_goalie_matchups').select('player_id, games_played, goals, assists, points, shots, shooting_percentage, player:profiles!player_goalie_matchups_player_id_fkey(full_name)').eq('goalie_id', playerId).eq('league_id', HOCKEY_LIFE_ID).eq('season_id', selectedSeasonId).order('goals', { ascending: false }).order('player_id', { ascending: true })
      : await supabase.from('player_goalie_matchups').select('goalie_id, games_played, goals, assists, points, shots, shooting_percentage, goalie:profiles!player_goalie_matchups_goalie_id_fkey(full_name)').eq('player_id', playerId).eq('league_id', HOCKEY_LIFE_ID).eq('season_id', selectedSeasonId).order('points', { ascending: false }).order('goalie_id', { ascending: true });
    const matchupRows = dataOrThrow<RawMatchup[] | null>(
      matchupResult as { data: RawMatchup[] | null; error: unknown },
      'Player matchup lookup',
    ) ?? [];
    matchups = matchupRows.map((row) => ({
      id: String(isGoalie ? row.player_id : row.goalie_id),
      name: one((isGoalie ? row.player : row.goalie) as RawNamedRelation | RawNamedRelation[] | null | undefined)?.full_name ?? (isGoalie ? 'Unknown Player' : 'Unknown Goalie'),
      gamesPlayed: number(row.games_played), goals: number(row.goals), assists: number(row.assists), points: number(row.points), shots: number(row.shots),
      shootingPct: row.shooting_percentage == null ? null : number(row.shooting_percentage),
    }));
  }

  return {
    playerId,
    rosterId: roster.id,
    fullName: profile?.full_name ?? 'Unknown Player',
    photoUrl: profile?.photo_url ?? profile?.avatar_url ?? null,
    position: roster.position,
    leadershipRole: roster.leadership_role,
    jerseyNumber: roster.jersey_number,
    isGoalie,
    team: team ? { id: team.id, name: team.name, slug: team.slug ?? null, logoUrl: team.logo_url ?? null, primaryColor: team.primary_color ?? null } : null,
    seasons,
    selectedSeasonId,
    selectedSeasonName: selectedSeasonId ? seasons.find((season) => season.id === selectedSeasonId)?.name ?? null : null,
    isCareer: selection.isCareer,
    metrics,
    careerRows,
    badges: badges.map((badge) => ({ id: badge.id, type: badge.badge_type, seasonId: typeof badge.season_id === 'string' ? badge.season_id : null, seasonName: one(badge.season as RawNamedRelation | RawNamedRelation[] | null | undefined)?.name ?? null, teamName: one(badge.team as RawNamedRelation | RawNamedRelation[] | null | undefined)?.name ?? null, createdAt: badge.created_at })),
    games,
    matchups,
    articles: articles.map((article) => ({ id: article.id, slug: typeof article.slug === 'string' ? article.slug : null, title: article.title, excerpt: typeof article.excerpt === 'string' ? article.excerpt : null, publishedAt: typeof article.published_at === 'string' ? article.published_at : typeof article.created_at === 'string' ? article.created_at : null })),
  };
}
