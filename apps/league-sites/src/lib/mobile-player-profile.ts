import { NextRequest, NextResponse } from 'next/server';

import {
  filterVisiblePlayerCareerTimelineRows,
  generatePlayerCareerHotFacts,
  getCurrentSeason,
  getImportedPlayerCareerAchievements,
  getLeagueBySlug,
  getPlayerArticles,
  getPlayerBadges,
  getPlayerCareerStatsTimeline,
  getPlayerGameLog,
  getSeasons,
  type PlayerCareerSeasonRow,
} from '@/lib/data';
import { countChampionshipBadges, summarizePlayerCareerAchievements } from '@/lib/career-achievements';
import { isAggregateOnlySeasonView } from '@/lib/imported-aggregate-season-overrides';
import { resolvePlayerPhotoUrl } from '@/lib/player-photo';
import { readCareerScope } from '@/lib/public-native-stats';
import {
  aggregatePublicSeasonStats,
  readPublicStatMetricRows,
  type PublicSeasonMetricPlayer,
  type PublicStatMetric,
} from '@/lib/public-stat-metrics';
import { createClient } from '@/lib/supabase/server';
import type { NewsArticle, Player, PlayerBadge, PlayerGameLogEntry, Season } from '@/lib/types';

export const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const HOCKEY_LIFE_SLUG = 'hockey-life';
const SITE_ORIGIN = 'https://hockey-life.beerleaguehockey.ca';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PUBLIC_PROFILE_CANONICAL_SEASONS = 8;

type LeagueIdentity = { id: string; slug: string; status?: string };
type MetricProvenance = { state: PublicStatMetric['state']; sources: string[] };
type MetricProvenanceMap = Record<string, MetricProvenance>;
type MobileCareerMetricRow = {
  seasonId: string;
  seasonName: string;
  teamId: string | null;
  teamName: string | null;
  metrics: Record<string, number | null>;
  metricProvenance?: MetricProvenanceMap | null;
};

export interface MobilePlayerProfileDependencies {
  getLeague(): Promise<LeagueIdentity | null>;
  resolvePlayer(playerOrRosterId: string, leagueId: string): Promise<Player | null>;
  getSeasons(leagueId: string): Promise<Season[]>;
  getCurrentSeason(leagueId: string): Promise<Pick<Season, 'id' | 'name'> | null>;
  getCareerScope(leagueId: string, playerId: string): Promise<{ isEligible: boolean; canonicalSeasonIds?: string[] }>;
  getPublicSeasonPlayer(leagueId: string, seasonId: string, playerId: string): Promise<PublicSeasonMetricPlayer | null>;
  getTimeline(leagueId: string, playerId: string, isGoalie: boolean, includeHistoricalBaseline: boolean): Promise<PlayerCareerSeasonRow[]>;
  getGames(playerId: string, seasonId: string): Promise<PlayerGameLogEntry[]>;
  getBadges(playerId: string): Promise<PlayerBadge[]>;
  getImportedAchievements(playerId: string, leagueId: string): Promise<{ championships: number }>;
  getArticles(playerId: string): Promise<NewsArticle[]>;
  generateHotFacts(input: { playerName: string; seasons: PlayerCareerSeasonRow[]; careerTotalsSeasons: PlayerCareerSeasonRow[]; isGoalie: boolean; distinctSeasonComparisons?: boolean }): Promise<string[]>;
  assertHealthy?(leagueId: string, playerId: string): Promise<void>;
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

function publishableMetric(metric: PublicStatMetric | null | undefined): number | null {
  return metric?.value != null && metric.state !== 'estimated' && metric.state !== 'unknown' && metric.state !== 'conflicted'
    ? metric.value
    : null;
}

function publicMetricProvenance(metric: PublicStatMetric | null | undefined): MetricProvenance {
  return metric
    ? { state: metric.state, sources: [...metric.sources] }
    : { state: 'unknown', sources: [] };
}

function combinedPublicProvenance(...metrics: Array<PublicStatMetric | null | undefined>): MetricProvenance {
  const present = metrics.filter((metric): metric is PublicStatMetric => Boolean(metric));
  const states = present.map((metric) => metric.state);
  const sources = [...new Set(present.flatMap((metric) => metric.sources))];
  const state: MetricProvenance['state'] = present.length !== metrics.length || states.includes('unknown')
    ? 'unknown'
    : states.includes('conflicted')
      ? 'conflicted'
      : states.includes('estimated')
        ? 'estimated'
        : states.includes('reported')
          ? 'reported'
          : states.includes('recorded')
            ? 'recorded'
            : 'verified';
  return { state, sources };
}

function publicSeasonProvenance(player: PublicSeasonMetricPlayer | null, isGoalie: boolean): MetricProvenanceMap | null {
  if (!player) return null;
  const goalie = player.goalie;
  const gamesPlayed = isGoalie ? goalie?.gamesPlayed : player.metrics.gamesPlayed;
  return {
    games_played: publicMetricProvenance(gamesPlayed),
    goals: publicMetricProvenance(player.metrics.goals),
    assists: publicMetricProvenance(player.metrics.assists),
    points: publicMetricProvenance(player.metrics.points),
    penalty_minutes: publicMetricProvenance(player.metrics.penaltyMinutes),
    plus_minus: publicMetricProvenance(null),
    wins: publicMetricProvenance(goalie?.wins),
    losses: publicMetricProvenance(goalie?.losses),
    ties: publicMetricProvenance(null),
    saves: publicMetricProvenance(null),
    goals_against: publicMetricProvenance(goalie?.goalsAgainst),
    goals_against_average: publicMetricProvenance(goalie?.goalsAgainstAverage),
    shutouts: publicMetricProvenance(goalie?.shutouts),
    save_percentage: publicMetricProvenance(null),
    attendance: publicMetricProvenance(null),
    gpg: combinedPublicProvenance(player.metrics.goals, gamesPlayed),
    goals_per_game: combinedPublicProvenance(player.metrics.goals, gamesPlayed),
    ppg: combinedPublicProvenance(player.metrics.points, gamesPlayed),
    points_per_game: combinedPublicProvenance(player.metrics.points, gamesPlayed),
  };
}

function importedMetricProvenance(values: Record<string, number | null> | null): MetricProvenanceMap | null {
  if (!values) return null;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
    state: value === null ? 'unknown' as const : 'recorded' as const,
    sources: value === null || key === 'saves' || key === 'save_percentage' ? [] : ['imported'],
  }]));
}

function publicSeasonCompleteForHotFacts(player: PublicSeasonMetricPlayer | null, isGoalie: boolean): boolean {
  if (!player) return false;
  if (isGoalie) return false;
  const metrics = isGoalie
    ? [
        player.goalie?.gamesPlayed,
        player.goalie?.wins,
        player.goalie?.losses,
        player.goalie?.saves,
        player.goalie?.goalsAgainst,
        player.goalie?.savePercentage,
        player.goalie?.goalsAgainstAverage,
        player.goalie?.shutouts,
      ]
    : [player.metrics.gamesPlayed, player.metrics.goals, player.metrics.assists, player.metrics.points];
  return metrics.every((metric) => publishableMetric(metric) !== null);
}

function timelineRowCompleteForHotFacts(row: PlayerCareerSeasonRow, isGoalie: boolean): boolean {
  if (!isAggregateOnlySeasonView(row.season_id, row.season_name)) return false;
  if (isGoalie) return false;
  if (!isGoalie) return [row.games_played, row.goals, row.assists, row.points].every(Number.isFinite);
  return row.saves_known === true && [
    row.games_played,
    row.wins,
    row.losses,
    row.saves,
    row.goals_against,
    row.save_percentage,
    row.goals_against_average,
    row.shutouts,
  ].every((value) => value !== null && Number.isFinite(value));
}

function publicSeasonMetrics(player: PublicSeasonMetricPlayer | null, isGoalie: boolean): Record<string, number | null> | null {
  if (!player) return null;
  const goalie = player.goalie;
  const gamesPlayed = isGoalie ? publishableMetric(goalie?.gamesPlayed) : publishableMetric(player.metrics.gamesPlayed);
  const goals = publishableMetric(player.metrics.goals);
  const assists = publishableMetric(player.metrics.assists);
  const points = publishableMetric(player.metrics.points);
  return {
    games_played: gamesPlayed,
    goals,
    assists,
    points,
    penalty_minutes: publishableMetric(player.metrics.penaltyMinutes),
    plus_minus: null,
    wins: publishableMetric(goalie?.wins),
    losses: publishableMetric(goalie?.losses),
    ties: null,
    saves: null,
    goals_against: publishableMetric(goalie?.goalsAgainst),
    goals_against_average: publishableMetric(goalie?.goalsAgainstAverage),
    shutouts: publishableMetric(goalie?.shutouts),
    save_percentage: null,
    attendance: null,
    gpg: gamesPlayed != null && gamesPlayed > 0 && goals != null ? goals / gamesPlayed : null,
    goals_per_game: gamesPlayed != null && gamesPlayed > 0 && goals != null ? goals / gamesPlayed : null,
    ppg: gamesPlayed != null && gamesPlayed > 0 && points != null ? points / gamesPlayed : null,
    points_per_game: gamesPlayed != null && gamesPlayed > 0 && points != null ? points / gamesPlayed : null,
  };
}

function timelineMetrics(row: PlayerCareerSeasonRow): Record<string, number | null> {
  return {
    games_played: row.games_played, attendance: null, goals: row.goals, assists: row.assists, points: row.points,
    gpg: row.goals_per_game, goals_per_game: row.goals_per_game, ppg: row.points_per_game, points_per_game: row.points_per_game,
    wins: row.wins, losses: row.losses, ties: row.ties, saves: null, goals_against: row.goals_against,
    save_percentage: null, goals_against_average: row.goals_against_average, shutouts: row.shutouts,
  };
}

function authoritativeHotFactRow(
  metadata: Pick<PlayerCareerSeasonRow, 'season_id' | 'season_name' | 'sort_date' | 'team_id' | 'team_name' | 'position'>,
  metrics: Record<string, number | null>,
  isGoalie: boolean,
): PlayerCareerSeasonRow | null {
  if (isGoalie) return null;
  const required = isGoalie
    ? ['games_played', 'wins', 'losses', 'saves', 'goals_against', 'save_percentage', 'goals_against_average', 'shutouts']
    : ['games_played', 'goals', 'assists', 'points'];
  if (!required.every((key) => typeof metrics[key] === 'number')) return null;

  const gamesPlayed = metrics.games_played as number;
  const goals = isGoalie ? 0 : metrics.goals as number;
  const assists = isGoalie ? 0 : metrics.assists as number;
  const points = isGoalie ? 0 : metrics.points as number;
  return {
    ...metadata,
    position: isGoalie ? 'Goalie' : metadata.position,
    games_played: gamesPlayed,
    team_games: 0,
    attendance_pct: 0,
    attendance_known: typeof metrics.attendance === 'number',
    goals,
    assists,
    points,
    goals_per_game: gamesPlayed > 0 ? goals / gamesPlayed : 0,
    points_per_game: gamesPlayed > 0 ? points / gamesPlayed : 0,
    wins: isGoalie ? metrics.wins as number : 0,
    losses: isGoalie ? metrics.losses as number : 0,
    ties: 0,
    saves: isGoalie ? metrics.saves as number : 0,
    ...(isGoalie ? { saves_known: true } : {}),
    goals_against: isGoalie ? metrics.goals_against as number : 0,
    save_percentage: isGoalie ? metrics.save_percentage : null,
    goals_against_average: isGoalie ? metrics.goals_against_average : null,
    shutouts: isGoalie ? metrics.shutouts as number : 0,
  };
}

const IMPORTED_AGGREGATE_METRIC_KEYS = [
  'games_played', 'goals', 'assists', 'points', 'wins', 'losses', 'ties', 'saves',
  'goals_against', 'save_percentage', 'goals_against_average', 'shutouts',
] as const;

function deduplicateCareerTimelineRows(rows: PlayerCareerSeasonRow[]): PlayerCareerSeasonRow[] {
  const uniqueRows: PlayerCareerSeasonRow[] = [];
  const canonicalKeys = new Set<string>();
  const importedBySeason = new Map<string, PlayerCareerSeasonRow>();

  for (const row of rows) {
    if (!isAggregateOnlySeasonView(row.season_id, row.season_name)) {
      const key = `${row.season_id}:${row.team_id ?? 'unknown'}`;
      if (!canonicalKeys.has(key)) {
        canonicalKeys.add(key);
        uniqueRows.push(row);
      }
      continue;
    }

    const existing = importedBySeason.get(row.season_id);
    if (!existing) {
      importedBySeason.set(row.season_id, row);
      uniqueRows.push(row);
      continue;
    }

    const existingMetrics = timelineMetrics(existing);
    const rowMetrics = timelineMetrics(row);
    const consistent = existing.season_name === row.season_name
      && existing.sort_date === row.sort_date
      && IMPORTED_AGGREGATE_METRIC_KEYS.every((key) => existingMetrics[key] === rowMetrics[key]);
    if (!consistent) throw new Error('inconsistent imported season aggregate');

    const existingTeamKey = `${existing.team_id ?? ''}\u0000${existing.team_name ?? ''}`;
    const rowTeamKey = `${row.team_id ?? ''}\u0000${row.team_name ?? ''}`;
    if (rowTeamKey.localeCompare(existingTeamKey, 'en') < 0) {
      importedBySeason.set(row.season_id, row);
      uniqueRows[uniqueRows.indexOf(existing)] = row;
    }
  }

  return uniqueRows;
}

function combineCareerProvenance(
  rows: Array<{ metrics: Record<string, number | null>; metricProvenance?: MetricProvenanceMap | null }>,
): MetricProvenanceMap | null {
  if (rows.length === 0) return null;
  const keys = new Set(rows.flatMap((row) => Object.keys(row.metrics)));
  return Object.fromEntries([...keys].map((key) => {
    const provenance = rows.map((row) => row.metricProvenance?.[key]).filter((item): item is MetricProvenance => Boolean(item));
    const states = provenance.map((item) => item.state);
    const sources = [...new Set(provenance.flatMap((item) => item.sources))];
    const allValuesKnown = rows.every((row) => typeof row.metrics[key] === 'number');
    const state: MetricProvenance['state'] = states.includes('conflicted')
      ? 'conflicted'
      : states.includes('estimated')
        ? 'estimated'
        : !allValuesKnown || provenance.length !== rows.length || states.includes('unknown')
          ? 'unknown'
          : states.includes('reported')
            ? 'reported'
            : states.includes('recorded')
              ? 'recorded'
              : 'verified';
    return [key, { state, sources }];
  }));
}

function combineCareerMetrics(
  rows: Array<{ metrics: Record<string, number | null> }>,
): Record<string, number | null> | null {
  if (rows.length === 0) return null;
  const sum = (key: string) => rows.every((row) => typeof row.metrics[key] === 'number')
    ? rows.reduce((total, row) => total + (row.metrics[key] ?? 0), 0)
    : null;
  const gamesPlayed = sum('games_played');
  const goals = sum('goals');
  const assists = sum('assists');
  const points = sum('points');
  const goalsAgainst = sum('goals_against');
  return {
    games_played: gamesPlayed,
    goals,
    assists,
    points,
    penalty_minutes: sum('penalty_minutes'),
    plus_minus: null,
    wins: sum('wins'),
    losses: sum('losses'),
    ties: sum('ties'),
    saves: null,
    goals_against: goalsAgainst,
    save_percentage: null,
    goals_against_average: gamesPlayed != null && gamesPlayed > 0 && goalsAgainst != null
      ? goalsAgainst / gamesPlayed
      : null,
    shutouts: sum('shutouts'),
    attendance: null,
    gpg: gamesPlayed != null && gamesPlayed > 0 && goals != null ? goals / gamesPlayed : null,
    goals_per_game: gamesPlayed != null && gamesPlayed > 0 && goals != null ? goals / gamesPlayed : null,
    ppg: gamesPlayed != null && gamesPlayed > 0 && points != null ? points / gamesPlayed : null,
    points_per_game: gamesPlayed != null && gamesPlayed > 0 && points != null ? points / gamesPlayed : null,
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
  getCareerScope: readCareerScope,
  getPublicSeasonPlayer: async (leagueId, seasonId, playerId) => {
    const scope = { leagueId, seasonId, playerId };
    const rows = await readPublicStatMetricRows(scope);
    return aggregatePublicSeasonStats(rows, scope).players.find((candidate) => candidate.playerId === playerId) ?? null;
  },
  getTimeline: (leagueId, playerId, isGoalie, includeHistoricalBaseline) => getPlayerCareerStatsTimeline(leagueId, playerId, isGoalie, { includeHistoricalBaseline, strict: true }),
  getGames: (playerId, seasonId) => getPlayerGameLog(playerId, seasonId, 20, { strict: true }),
  getBadges: (playerId) => getPlayerBadges(playerId, { leagueId: HOCKEY_LIFE_ID, strict: true }),
  getImportedAchievements: (playerId, leagueId) => getImportedPlayerCareerAchievements(playerId, { leagueId, strict: true }),
  getArticles: (playerId) => getPlayerArticles(playerId, 5, { leagueId: HOCKEY_LIFE_ID, strict: true }),
  generateHotFacts: generatePlayerCareerHotFacts,
  assertHealthy: async (leagueId, playerId) => {
    const client = await createClient();
    const queries = [
      client.from('player_badges').select('id', { count: 'exact', head: true }).eq('league_id', leagueId).eq('player_id', playerId),
      client.from('article_player_tags').select('article_id', { count: 'exact', head: true }).eq('player_id', playerId),
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
    const [seasons, currentSeason, careerScope] = await Promise.all([
      deps.getSeasons(league.id),
      deps.getCurrentSeason(league.id),
      deps.getCareerScope(league.id, profileId),
    ]);
    const season = requestedSeason && requestedSeason !== 'all'
      ? seasons.find((candidate) => candidate.id === requestedSeason) ?? null
      : requestedSeason === 'all' ? null : currentSeason;
    if (requestedSeason && requestedSeason !== 'all' && !season) return error(400, 'INVALID_SEASON', 'season is not available in Hockey Life.');
    if (!careerScope.isEligible || !Array.isArray(careerScope.canonicalSeasonIds)) {
      throw new Error('canonical player sources unavailable');
    }
    if (careerScope.canonicalSeasonIds.some((seasonId) => typeof seasonId !== 'string' || !UUID.test(seasonId))) {
      throw new Error('invalid canonical player season scope');
    }
    const catalogCanonicalSeasonIds = new Set(seasons
      .filter((candidate) => !isAggregateOnlySeasonView(candidate.id, candidate.name))
      .map((candidate) => candidate.id));
    const canonicalSeasonIds = [...new Set(careerScope.canonicalSeasonIds)]
      .filter((seasonId) => catalogCanonicalSeasonIds.has(seasonId));
    if (canonicalSeasonIds.length > MAX_PUBLIC_PROFILE_CANONICAL_SEASONS) throw new Error('career metric season work limit exceeded');
    const canonicalSeasonIdSet = new Set(canonicalSeasonIds);
    const isCareer = requestedSeason === 'all';
    const selectedSeasonId = isCareer ? null : season?.id ?? null;
    const selectedSeasonName = isCareer ? 'Career Stats' : season?.name ?? null;
    const aggregateOnly = isCareer || isAggregateOnlySeasonView(selectedSeasonId ?? undefined, selectedSeasonName);
    const isGoalie = player.is_goalie === true || ['g', 'goalie', 'goaltender'].includes(player.position?.trim().toLowerCase() ?? '');
    await deps.assertHealthy?.(league.id, profileId);

    const [timelineWithBaseline, badges, achievements, articles, games] = await Promise.all([
      deps.getTimeline(league.id, profileId, isGoalie, true),
      deps.getBadges(profileId), deps.getImportedAchievements(profileId, league.id), deps.getArticles(profileId),
      !aggregateOnly && selectedSeasonId && canonicalSeasonIdSet.has(selectedSeasonId)
        ? deps.getGames(profileId, selectedSeasonId)
        : Promise.resolve([]),
    ]);
    const leagueSeasonIds = new Set(seasons.map((item) => item.id));
    const visibleTimeline = filterVisiblePlayerCareerTimelineRows(timelineWithBaseline)
      .filter((row) => canonicalSeasonIdSet.has(row.season_id) && !isAggregateOnlySeasonView(row.season_id, row.season_name));
    const totalsTimeline = filterVisiblePlayerCareerTimelineRows(timelineWithBaseline, { includeHistoricalBaseline: true });
    const careerTimelineRows = deduplicateCareerTimelineRows([
      ...visibleTimeline,
      ...totalsTimeline.filter((row) => isAggregateOnlySeasonView(row.season_id, row.season_name)),
    ]);
    const selectedAggregateRow = selectedSeasonId
      ? careerTimelineRows.find((row) => row.season_id === selectedSeasonId && isAggregateOnlySeasonView(row.season_id, row.season_name)) ?? null
      : null;
    const safeBadges = badges.filter((badge) => badge.league_id === league.id && leagueSeasonIds.has(badge.season_id));
    const safeArticles = articles.filter((article) => article.league_id === league.id);
    const achievementSummary = summarizePlayerCareerAchievements({ importedChampionships: achievements.championships, nativeChampionships: countChampionshipBadges(safeBadges) });
    const canonicalPlayers = new Map<string, PublicSeasonMetricPlayer | null>();
    for (const seasonId of canonicalSeasonIds) {
      canonicalPlayers.set(seasonId, await deps.getPublicSeasonPlayer(league.id, seasonId, profileId));
    }
    const authoritativeHotFactRows: PlayerCareerSeasonRow[] = [];
    for (const row of careerTimelineRows.filter((candidate) => isAggregateOnlySeasonView(candidate.season_id, candidate.season_name))) {
      if (!timelineRowCompleteForHotFacts(row, isGoalie)) continue;
      const adapted = authoritativeHotFactRow(row, timelineMetrics(row), isGoalie);
      if (adapted) authoritativeHotFactRows.push(adapted);
    }
    for (const seasonId of canonicalSeasonIds) {
      const canonical = canonicalPlayers.get(seasonId) ?? null;
      if (!publicSeasonCompleteForHotFacts(canonical, isGoalie)) continue;
      const seasonMetadata = seasons.find((item) => item.id === seasonId);
      const timelineMetadata = careerTimelineRows.find((row) => row.season_id === seasonId);
      const adapted = authoritativeHotFactRow({
        season_id: seasonId,
        season_name: seasonMetadata?.name ?? timelineMetadata?.season_name ?? 'Unknown Season',
        sort_date: seasonMetadata?.start_date ?? timelineMetadata?.sort_date ?? null,
        team_id: canonical?.displayTeam?.id ?? timelineMetadata?.team_id ?? null,
        team_name: canonical?.displayTeam?.name ?? timelineMetadata?.team_name ?? null,
        position: isGoalie ? 'Goalie' : timelineMetadata?.position ?? player.position,
      }, publicSeasonMetrics(canonical, isGoalie) ?? {}, isGoalie);
      if (adapted) authoritativeHotFactRows.push(adapted);
    }
    const visibleHotFactRows = filterVisiblePlayerCareerTimelineRows(authoritativeHotFactRows);
    const hotFacts = authoritativeHotFactRows.length > 0
      ? await deps.generateHotFacts({
          playerName: player.profile?.full_name?.trim() || 'Unknown Player',
          seasons: visibleHotFactRows,
          careerTotalsSeasons: authoritativeHotFactRows,
          isGoalie,
          distinctSeasonComparisons: true,
        })
      : [];
    const emittedCanonicalSeasons = new Set<string>();
    const careerRows: MobileCareerMetricRow[] = careerTimelineRows.flatMap((row) => {
      if (isAggregateOnlySeasonView(row.season_id, row.season_name)) {
        const aggregateMetrics = timelineMetrics(row);
        return [{
          seasonId: row.season_id,
          seasonName: row.season_name,
          teamId: row.team_id,
          teamName: row.team_name,
          metrics: aggregateMetrics,
          metricProvenance: importedMetricProvenance(aggregateMetrics),
        }];
      }
      if (emittedCanonicalSeasons.has(row.season_id)) return [];
      emittedCanonicalSeasons.add(row.season_id);
      const canonical = canonicalPlayers.get(row.season_id) ?? null;
      const canonicalMetrics = publicSeasonMetrics(canonical, isGoalie);
      return canonicalMetrics ? [{
        seasonId: row.season_id,
        seasonName: row.season_name,
        teamId: canonical?.displayTeam?.id ?? null,
        teamName: canonical?.displayTeam?.name ?? null,
        metrics: canonicalMetrics,
        metricProvenance: publicSeasonProvenance(canonical, isGoalie),
      }] : [];
    });
    for (const seasonId of canonicalSeasonIds) {
      const season = seasons.find((candidate) => candidate.id === seasonId);
      if (!season || emittedCanonicalSeasons.has(season.id)) continue;
      const canonical = canonicalPlayers.get(season.id) ?? null;
      const canonicalMetrics = publicSeasonMetrics(canonical, isGoalie);
      if (!canonicalMetrics) continue;
      emittedCanonicalSeasons.add(season.id);
      careerRows.push({
        seasonId: season.id,
        seasonName: season.name,
        teamId: canonical?.displayTeam?.id ?? null,
        teamName: canonical?.displayTeam?.name ?? null,
        metrics: canonicalMetrics,
        metricProvenance: publicSeasonProvenance(canonical, isGoalie),
      });
    }
    const selectedMetrics = isCareer
      ? combineCareerMetrics(careerRows)
      : !aggregateOnly && selectedSeasonId
        ? publicSeasonMetrics(canonicalPlayers.get(selectedSeasonId) ?? null, isGoalie)
        : selectedAggregateRow
          ? timelineMetrics(selectedAggregateRow)
          : null;
    const selectedMetricProvenance = isCareer
      ? combineCareerProvenance(careerRows)
      : !aggregateOnly && selectedSeasonId
        ? publicSeasonProvenance(canonicalPlayers.get(selectedSeasonId) ?? null, isGoalie)
        : aggregateOnly
          ? importedMetricProvenance(selectedMetrics)
          : null;

    const data = {
      playerId: profileId, rosterId: player.id, fullName: player.profile?.full_name?.trim() || 'Unknown Player',
      photoUrl: absolutePublicUrl(resolvePlayerPhotoUrl(player.profile)), position: player.position, leadershipRole: player.leadership_role,
      jerseyNumber: player.jersey_number, isGoalie,
      team: player.team ? { id: player.team.id, name: player.team.name, slug: player.team.slug, logoUrl: absolutePublicUrl(player.team.logo_url), primaryColor: player.team.primary_color ?? null } : null,
      seasons: seasons.map((item) => ({ id: item.id, name: item.name, start_date: item.start_date, status: item.status })),
      selectedSeasonId, selectedSeasonName, isCareer,
      metrics: selectedMetrics,
      metricProvenance: selectedMetricProvenance,
      careerRows,
      badges: safeBadges.map((badge) => ({ id: badge.id, type: badge.badge_type, seasonId: badge.season_id, seasonName: badge.season?.name ?? null, teamName: badge.team?.name ?? null, createdAt: badge.created_at })),
      games: games.map((game) => ({
        id: game.game_id,
        date: game.date,
        opponent: game.opponent_name ?? game.opponent ?? null,
        result: game.result,
        score: game.score ?? null,
        metrics: {
          goals: game.metric_availability?.goals === false ? null : numberOrNull(game.goals),
          assists: game.metric_availability?.assists === false ? null : numberOrNull(game.assists),
          points: game.metric_availability?.points === false ? null : numberOrNull(game.points),
          penalty_minutes: game.metric_availability?.penalty_minutes === false ? null : numberOrNull(game.penalty_minutes ?? game.pim),
          plus_minus: game.metric_availability?.plus_minus === false ? null : numberOrNull(game.plus_minus),
          saves: null,
          goals_against: game.metric_availability?.goals_against === false ? null : numberOrNull(game.goals_against),
          save_percentage: null,
        },
      })),
      matchups: [], articles: safeArticles.map((article) => ({ id: article.id, slug: article.slug, title: article.title, excerpt: article.excerpt, publishedAt: article.published_at, imageUrl: absolutePublicUrl(article.image_url), type: article.type ?? null })),
      heroAwards: buildHeroAwards(safeBadges, achievementSummary.championships), aggregateOnly, hotFacts,
    };
    return NextResponse.json({ version: 1, league: { id: league.id, slug: league.slug }, data }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return error(502, 'UPSTREAM_FAILURE', 'Player profile data is temporarily unavailable.');
  }
}
