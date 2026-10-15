import { NextRequest, NextResponse } from 'next/server';

import {
  filterVisiblePlayerCareerTimelineRows,
  generatePlayerCareerHotFacts,
  getCurrentSeason,
  getGoaliePlayerMatchups,
  getImportedPlayerCareerAchievements,
  getLeagueBySlug,
  getPlayerArticles,
  getPlayerBadges,
  getPlayerCareerStats,
  getPlayerCareerStatsTimeline,
  getPlayerGameLog,
  getPlayerGoalieMatchups,
  getSeasons,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { countChampionshipBadges, summarizePlayerCareerAchievements } from '@/lib/career-achievements';
import { isAggregateOnlySeasonView, isImportedAggregateSeasonId } from '@/lib/imported-aggregate-season-overrides';
import { resolvePlayerPhotoUrl } from '@/lib/player-photo';
import { readCareerScope } from '@/lib/public-native-stats';
import { createClient } from '@/lib/supabase/server';
import type { NewsArticle, Player, PlayerBadge, PlayerGameLogEntry, PlayerStats, Season } from '@/lib/types';

export const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const HOCKEY_LIFE_SLUG = 'hockey-life';
const SITE_ORIGIN = 'https://hockey-life.beerleaguehockey.ca';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeagueIdentity = { id: string; slug: string; status?: string };
type Matchup = { id: string; name: string; gamesPlayed: number; goals: number; assists: number; points: number; shots: number; shootingPct: number | null };

export interface MobilePlayerProfileDependencies {
  getLeague(): Promise<LeagueIdentity | null>;
  resolvePlayer(playerOrRosterId: string, leagueId: string): Promise<Player | null>;
  getSeasons(leagueId: string): Promise<Season[]>;
  getCurrentSeason(leagueId: string): Promise<Pick<Season, 'id' | 'name'> | null>;
  getStats(playerId: string, seasonId: string | null, leagueId: string, isGoalie: boolean): Promise<Partial<PlayerStats> | null>;
  getTimeline(leagueId: string, playerId: string, isGoalie: boolean, includeHistoricalBaseline: boolean): Promise<PlayerCareerSeasonRow[]>;
  getGames(playerId: string, seasonId: string): Promise<PlayerGameLogEntry[]>;
  getBadges(playerId: string): Promise<PlayerBadge[]>;
  getImportedAchievements(playerId: string, leagueId: string): Promise<{ championships: number }>;
  getArticles(playerId: string): Promise<NewsArticle[]>;
  getMatchups(playerId: string, seasonId: string, isGoalie: boolean): Promise<Matchup[]>;
  generateHotFacts(input: { playerName: string; seasons: PlayerCareerSeasonRow[]; careerTotalsSeasons: PlayerCareerSeasonRow[]; isGoalie: boolean; distinctSeasonComparisons?: boolean }): Promise<string[]>;
  assertHealthy?(leagueId: string, playerId: string, seasonId: string | null): Promise<void>;
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function absolutePublicUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return `${SITE_ORIGIN}${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metrics(stats: Partial<PlayerStats> | null, isGoalie: boolean, goalieProvenance: 'ordinary-ratio' | 'percent'): Record<string, number | null> | null {
  if (!stats) return null;
  const result: Record<string, number | null> = {
    games_played: numberOrNull(stats.games_played), goals: numberOrNull(stats.goals), assists: numberOrNull(stats.assists),
    points: numberOrNull(stats.points), penalty_minutes: numberOrNull(stats.penalty_minutes), plus_minus: numberOrNull(stats.plus_minus),
    wins: numberOrNull(stats.wins), losses: numberOrNull(stats.losses), ties: numberOrNull(stats.ties), saves: numberOrNull(stats.saves),
    goals_against: numberOrNull(stats.goals_against), goals_against_average: numberOrNull(stats.goals_against_average),
    shutouts: numberOrNull(stats.shutouts), save_percentage: numberOrNull(stats.save_percentage),
  };
  if (isGoalie && result.save_percentage !== null && goalieProvenance === 'ordinary-ratio') result.save_percentage *= 100;
  return result;
}

function timelineMetrics(row: PlayerCareerSeasonRow): Record<string, number | null> {
  return {
    games_played: row.games_played, attendance: row.attendance_pct, goals: row.goals, assists: row.assists, points: row.points,
    gpg: row.goals_per_game, goals_per_game: row.goals_per_game, ppg: row.points_per_game, points_per_game: row.points_per_game,
    wins: row.wins, losses: row.losses, ties: row.ties, saves: row.saves, goals_against: row.goals_against,
    save_percentage: row.save_percentage, goals_against_average: row.goals_against_average, shutouts: row.shutouts,
  };
}

function buildHeroAwards(badges: PlayerBadge[], championships: number) {
  const items: Array<{ key: string; label: string; count: number; imageUrl: string | null }> = [];
  if (championships > 0) items.push({ key: 'championships', label: 'Championships', count: championships, imageUrl: `${SITE_ORIGIN}/awards/championship-trophy.png` });
  for (const [key, label, image] of [
    ['top_scorer', 'Top Scorer', 'top-scorer-trophy.png'],
    ['points_leader', 'Points Leader', 'points-leader-trophy.png'],
  ] as const) {
    const count = badges.filter((badge) => badge.badge_type === key).length;
    if (count > 0) items.push({ key, label, count, imageUrl: `${SITE_ORIGIN}/awards/${image}` });
  }
  return items;
}

export async function resolveScopedPlayer(playerOrRosterId: string, leagueId: string): Promise<Player | null> {
  const client = await createClient();
  const select = 'id, player_id, team_id, season_id, jersey_number, position, leadership_role, is_goalie, joined_at, profile:profiles!team_rosters_player_id_fkey(id, full_name, avatar_url, photo_url), team:teams!team_rosters_team_id_fkey(id, name, slug, logo_url, primary_color, secondary_color, league_id)';
  const exact = await client.from('team_rosters').select(select).eq('league_id', leagueId).eq('id', playerOrRosterId).maybeSingle();
  if (exact.error) throw new Error('scoped player membership read failed');
  let row = exact.data;
  if (!row) {
    const fallback = await client.from('team_rosters').select(select).eq('league_id', leagueId).eq('player_id', playerOrRosterId).order('joined_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (fallback.error) throw new Error('scoped player membership read failed');
    row = fallback.data;
  }
  if (!row) return null;
  const raw = row as unknown as Player;
  const team = Array.isArray(raw.team) ? raw.team[0] : raw.team;
  const profile = Array.isArray(raw.profile) ? raw.profile[0] : raw.profile;
  if (!team || team.league_id !== leagueId || !profile) return null;
  return { ...raw, profile, team: { ...team, logo: team.logo_url ?? null, colors: team.primary_color ?? null } };
}

export const mobilePlayerProfileDependencies: MobilePlayerProfileDependencies = {
  getLeague: () => getLeagueBySlug(HOCKEY_LIFE_SLUG, { strict: true }),
  resolvePlayer: resolveScopedPlayer,
  getSeasons: (leagueId) => getSeasons(leagueId, { strict: true }),
  getCurrentSeason: (leagueId) => getCurrentSeason(leagueId, { strict: true }),
  getStats: (playerId, seasonId, leagueId, isGoalie) => getPlayerCareerStats(playerId, seasonId, { leagueId, isGoalie, strict: true }),
  getTimeline: (leagueId, playerId, isGoalie, includeHistoricalBaseline) => getPlayerCareerStatsTimeline(leagueId, playerId, isGoalie, { includeHistoricalBaseline, strict: true }),
  getGames: (playerId, seasonId) => getPlayerGameLog(playerId, seasonId, 20, { strict: true }),
  getBadges: (playerId) => getPlayerBadges(playerId, { leagueId: HOCKEY_LIFE_ID, strict: true }),
  getImportedAchievements: (playerId, leagueId) => getImportedPlayerCareerAchievements(playerId, { leagueId, strict: true }),
  getArticles: (playerId) => getPlayerArticles(playerId, 5, { leagueId: HOCKEY_LIFE_ID, strict: true }),
  getMatchups: async (playerId, seasonId, isGoalie) => {
    if (isGoalie) {
      return (await getGoaliePlayerMatchups(playerId, seasonId, { leagueId: HOCKEY_LIFE_ID, strict: true })).map((row) => ({
        id: row.playerId, name: row.playerName, gamesPlayed: row.gamesPlayed, goals: row.goals,
        assists: row.assists, points: row.points, shots: row.shots, shootingPct: row.shootingPct,
      }));
    }
    return (await getPlayerGoalieMatchups(playerId, seasonId, { leagueId: HOCKEY_LIFE_ID, strict: true })).map((row) => ({
      id: row.goalieId, name: row.goalieName, gamesPlayed: row.gamesPlayed, goals: row.goals,
      assists: row.assists, points: row.points, shots: row.shots, shootingPct: row.shootingPct,
    }));
  },
  generateHotFacts: generatePlayerCareerHotFacts,
  assertHealthy: async (leagueId, playerId, seasonId) => {
    const scope = await readCareerScope(leagueId, playerId);
    if (!scope.isEligible) throw new Error('canonical player sources unavailable');
    const client = await createClient();
    const queries = [
      client.from('player_badges').select('id', { count: 'exact', head: true }).eq('league_id', leagueId).eq('player_id', playerId),
      client.from('article_player_tags').select('article_id', { count: 'exact', head: true }).eq('player_id', playerId),
      seasonId
        ? client.from('player_goalie_matchups').select('season_id', { count: 'exact', head: true }).eq('season_id', seasonId).or(`player_id.eq.${playerId},goalie_id.eq.${playerId}`)
        : Promise.resolve({ error: null }),
    ];
    const results = await Promise.all(queries);
    if (results.some((result) => result.error)) throw new Error('canonical public content source read failed');
  },
};

export async function handleMobilePlayerProfileRequest(request: NextRequest, deps: MobilePlayerProfileDependencies = mobilePlayerProfileDependencies) {
  const params = request.nextUrl.searchParams;
  for (const key of params.keys()) if (key !== 'playerId' && key !== 'season') return error(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
  if (params.getAll('playerId').length !== 1 || params.getAll('season').length > 1) return error(400, 'INVALID_QUERY', 'Query parameters must appear once.');
  const requestedId = params.get('playerId');
  const requestedSeason = params.get('season');
  if (!requestedId || !UUID.test(requestedId)) return error(400, 'INVALID_PLAYER_ID', 'playerId must be a UUID.');
  if (requestedSeason !== null && requestedSeason !== 'all' && !UUID.test(requestedSeason)) return error(400, 'INVALID_SEASON', 'season must be a UUID or all.');

  try {
    const league = await deps.getLeague();
    if (!league || league.id !== HOCKEY_LIFE_ID || league.slug !== HOCKEY_LIFE_SLUG || league.status !== 'active') return error(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    const player = await deps.resolvePlayer(requestedId, league.id);
    if (!player || player.team?.league_id !== league.id) return error(404, 'PLAYER_NOT_FOUND', 'Player not found.');

    const profileId = player.player_id;
    const [seasons, currentSeason] = await Promise.all([deps.getSeasons(league.id), deps.getCurrentSeason(league.id)]);
    const season = requestedSeason && requestedSeason !== 'all'
      ? seasons.find((candidate) => candidate.id === requestedSeason) ?? null
      : requestedSeason === 'all' ? null : currentSeason;
    if (requestedSeason && requestedSeason !== 'all' && !season) return error(400, 'INVALID_SEASON', 'season is not available in Hockey Life.');
    const isCareer = requestedSeason === 'all';
    const selectedSeasonId = isCareer ? null : season?.id ?? null;
    const selectedSeasonName = isCareer ? 'Career Stats' : season?.name ?? null;
    const aggregateOnly = isCareer || isAggregateOnlySeasonView(selectedSeasonId ?? undefined, selectedSeasonName);
    const isGoalie = player.is_goalie === true || ['g', 'goalie', 'goaltender'].includes(player.position?.trim().toLowerCase() ?? '');
    await deps.assertHealthy?.(league.id, profileId, selectedSeasonId);

    const [stats, timeline, timelineWithBaseline, badges, achievements, articles, games, matchups] = await Promise.all([
      deps.getStats(profileId, selectedSeasonId, league.id, isGoalie),
      deps.getTimeline(league.id, profileId, isGoalie, false),
      deps.getTimeline(league.id, profileId, isGoalie, true),
      deps.getBadges(profileId), deps.getImportedAchievements(profileId, league.id), deps.getArticles(profileId),
      !aggregateOnly && selectedSeasonId ? deps.getGames(profileId, selectedSeasonId) : Promise.resolve([]),
      !aggregateOnly && selectedSeasonId ? deps.getMatchups(profileId, selectedSeasonId, isGoalie) : Promise.resolve([]),
    ]);
    const leagueSeasonIds = new Set(seasons.map((item) => item.id));
    const visibleTimeline = filterVisiblePlayerCareerTimelineRows(timeline).filter((row) => leagueSeasonIds.has(row.season_id));
    const totalsTimeline = filterVisiblePlayerCareerTimelineRows(timelineWithBaseline, { includeHistoricalBaseline: true });
    const safeBadges = badges.filter((badge) => badge.league_id === league.id && leagueSeasonIds.has(badge.season_id));
    const safeArticles = articles.filter((article) => article.league_id === league.id);
    const achievementSummary = summarizePlayerCareerAchievements({ importedChampionships: achievements.championships, nativeChampionships: countChampionshipBadges(safeBadges) });
    const hotFacts = await deps.generateHotFacts({ playerName: player.profile?.full_name?.trim() || 'Unknown Player', seasons: visibleTimeline, careerTotalsSeasons: totalsTimeline, isGoalie, distinctSeasonComparisons: true });
    const ordinaryRatio = isCareer || !isImportedAggregateSeasonId(selectedSeasonId ?? undefined);

    const data = {
      playerId: profileId, rosterId: player.id, fullName: player.profile?.full_name?.trim() || 'Unknown Player',
      photoUrl: absolutePublicUrl(resolvePlayerPhotoUrl(player.profile)), position: player.position, leadershipRole: player.leadership_role,
      jerseyNumber: player.jersey_number, isGoalie,
      team: player.team ? { id: player.team.id, name: player.team.name, slug: player.team.slug, logoUrl: absolutePublicUrl(player.team.logo_url), primaryColor: player.team.primary_color ?? null } : null,
      seasons: seasons.map((item) => ({ id: item.id, name: item.name, start_date: item.start_date, status: item.status })),
      selectedSeasonId, selectedSeasonName, isCareer,
      metrics: metrics(stats, isGoalie, ordinaryRatio ? 'ordinary-ratio' : 'percent'),
      careerRows: visibleTimeline.map((row) => ({ seasonId: row.season_id, seasonName: row.season_name, teamId: row.team_id, teamName: row.team_name, metrics: timelineMetrics(row) })),
      badges: safeBadges.map((badge) => ({ id: badge.id, type: badge.badge_type, seasonId: badge.season_id, seasonName: badge.season?.name ?? null, teamName: badge.team?.name ?? null, createdAt: badge.created_at })),
      games: games.map((game) => ({ id: game.game_id, date: game.date, opponent: game.opponent_name ?? game.opponent ?? null, result: game.result, score: game.score ?? null, metrics: { goals: numberOrNull(game.goals), assists: numberOrNull(game.assists), points: numberOrNull(game.points), penalty_minutes: numberOrNull(game.penalty_minutes ?? game.pim), plus_minus: numberOrNull(game.plus_minus), saves: numberOrNull(game.saves), goals_against: numberOrNull(game.goals_against), save_percentage: isGoalie && numberOrNull(game.save_percentage) !== null ? (game.save_percentage as number) * 100 : null } })),
      matchups, articles: safeArticles.map((article) => ({ id: article.id, slug: article.slug, title: article.title, excerpt: article.excerpt, publishedAt: article.published_at, imageUrl: absolutePublicUrl(article.image_url), type: article.type ?? null })),
      heroAwards: buildHeroAwards(safeBadges, achievementSummary.championships), aggregateOnly, hotFacts,
    };
    return NextResponse.json({ version: 1, league: { id: league.id, slug: league.slug }, data }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return error(502, 'UPSTREAM_FAILURE', 'Player profile data is temporarily unavailable.');
  }
}
