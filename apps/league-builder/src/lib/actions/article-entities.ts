'use server';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { verifyLeagueOwnerAccess } from './permissions';
import { articleContentToPlainText } from '@hockey-life/ui/news-article-format';
import type {
  ArticleEditorSeasonOption,
  ArticleEntityEditorContext,
  ArticleEntityGameOption,
  ArticleEntityPlayerOption,
  ArticleEntitySelection,
  ArticleEntityTeamOption,
  SuggestArticleEntitiesInput,
} from '@/lib/news/article-entity-types';

function normalizeText(value: string | null | undefined) {
  return (value || '').trim().replace(/\s+/g, ' ');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(haystack: string, phrase: string) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedPhrase)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  return regex.test(haystack);
}

function getGamePhrases(game: ArticleEntityGameOption) {
  const home = normalizeText(game.homeTeamName);
  const away = normalizeText(game.awayTeamName);

  return [
    `${away} @ ${home}`,
    `${away} at ${home}`,
    `${home} vs ${away}`,
    `${home} vs. ${away}`,
    `${home} v ${away}`,
    `${home} v. ${away}`,
    `${home} versus ${away}`,
    `${home} against ${away}`,
    `${away} against ${home}`,
  ];
}

async function requireAccess(leagueId: string) {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    throw new Error(access.error || 'Not authorized');
  }
}

async function getSeasonOptions(service: ReturnType<typeof createServiceRoleClient>, leagueId: string) {
  const { data } = await service
    .from('seasons')
    .select('id, name, status, start_date')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false });

  const seasons = (data || []).map((season: any) => ({
    id: season.id as string,
    name: season.name as string,
    status: (season.status as string | null) || null,
  }));

  const activeSeason = seasons.find((season) => season.status === 'active') || null;

  return {
    seasons,
    activeSeasonId: activeSeason?.id || seasons[0]?.id || null,
  };
}

async function getTeamOptions(
  service: ReturnType<typeof createServiceRoleClient>,
  leagueId: string,
): Promise<ArticleEntityTeamOption[]> {
  const { data } = await (service as any)
    .from('teams')
    .select(`
      id,
      name,
      slug,
      division:division_id(name)
    `)
    .eq('league_id', leagueId)
    .order('name', { ascending: true });

  return (data || []).map((team: any) => ({
    id: team.id,
    name: team.name,
    slug: team.slug || null,
    divisionName: team.division?.name || null,
  }));
}

async function getPlayerOptions(
  service: ReturnType<typeof createServiceRoleClient>,
  leagueId: string,
  seasonScopeId: string | null,
): Promise<ArticleEntityPlayerOption[]> {
  async function runQuery(scopeSeasonId: string | null) {
    let query = (service as any)
      .from('team_rosters')
      .select(`
        player_id,
        jersey_number,
        player:player_id(id, full_name, avatar_url),
        team:team_id(id, name, division:division_id(name))
      `)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false });

    if (scopeSeasonId) {
      query = query.eq('season_id', scopeSeasonId);
    }

    const { data } = await query;
    return data || [];
  }

  let rows = await runQuery(seasonScopeId);
  if (rows.length === 0 && seasonScopeId) {
    rows = await runQuery(null);
  }

  const playerMap = new Map<string, ArticleEntityPlayerOption>();

  for (const row of rows) {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    const team = Array.isArray(row.team) ? row.team[0] : row.team;
    if (!player?.id || !player.full_name || playerMap.has(player.id)) continue;

    playerMap.set(player.id, {
      id: player.id,
      fullName: player.full_name,
      avatarUrl: player.avatar_url || null,
      teamName: team?.name || null,
      divisionName: team?.division?.name || null,
      jerseyNumber: row.jersey_number ? String(row.jersey_number) : null,
    });
  }

  return [...playerMap.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
}

async function getGameOptions(
  service: ReturnType<typeof createServiceRoleClient>,
  leagueId: string,
  seasonScopeId: string | null,
): Promise<ArticleEntityGameOption[]> {
  async function runQuery(scopeSeasonId: string | null) {
    let query = (service as any)
      .from('games')
      .select(`
        id,
        scheduled_at,
        home_team_id,
        away_team_id,
        division:division_id(name),
        home_team:home_team_id(id, name),
        away_team:away_team_id(id, name)
      `)
      .eq('league_id', leagueId)
      .order('scheduled_at', { ascending: false })
      .limit(120);

    if (scopeSeasonId) {
      query = query.eq('season_id', scopeSeasonId);
    }

    const { data } = await query;
    return data || [];
  }

  let rows = await runQuery(seasonScopeId);
  if (rows.length === 0 && seasonScopeId) {
    rows = await runQuery(null);
  }

  return rows.map((game: any) => ({
    id: game.id,
    scheduledAt: game.scheduled_at || null,
    homeTeamId: game.home_team_id || null,
    awayTeamId: game.away_team_id || null,
    homeTeamName: game.home_team?.name || 'Home',
    awayTeamName: game.away_team?.name || 'Away',
    divisionName: game.division?.name || null,
  }));
}

async function getExistingArticleLinks(
  service: ReturnType<typeof createServiceRoleClient>,
  articleId: string,
) {
  const [{ data: article }, { data: playerRows }, { data: teamRows }, { data: gameRows }] = await Promise.all([
    service
      .from('articles')
      .select('season_id, game_id')
      .eq('id', articleId)
      .single(),
    service
      .from('article_player_tags')
      .select('player_id')
      .eq('article_id', articleId),
    service
      .from('article_team_tags')
      .select('team_id')
      .eq('article_id', articleId),
    service
      .from('article_game_tags')
      .select('game_id, is_primary')
      .eq('article_id', articleId)
      .order('is_primary', { ascending: false }),
  ]);

  const linkedGameIds = [...new Set((gameRows || []).map((row: any) => row.game_id).filter(Boolean))];
  const primaryGameId =
    (gameRows || []).find((row: any) => row.is_primary)?.game_id ||
    article?.game_id ||
    linkedGameIds[0] ||
    null;

  if (primaryGameId && !linkedGameIds.includes(primaryGameId)) {
    linkedGameIds.unshift(primaryGameId);
  }

  const linkedTeamIds = [...new Set((teamRows || []).map((row: any) => row.team_id).filter(Boolean))];

  if (linkedTeamIds.length === 0 && primaryGameId) {
    const { data: primaryGame } = await service
      .from('games')
      .select('home_team_id, away_team_id')
      .eq('id', primaryGameId)
      .maybeSingle();

    if (primaryGame?.home_team_id) {
      linkedTeamIds.push(primaryGame.home_team_id);
    }
    if (primaryGame?.away_team_id && !linkedTeamIds.includes(primaryGame.away_team_id)) {
      linkedTeamIds.push(primaryGame.away_team_id);
    }
  }

  return {
    seasonId: article?.season_id || null,
    linkedPlayerIds: [...new Set((playerRows || []).map((row: any) => row.player_id).filter(Boolean))],
    linkedTeamIds,
    linkedGameIds,
    primaryGameId,
  };
}

export async function getArticleEntityEditorContext(args: {
  leagueId: string;
  articleId?: string;
  seasonId?: string | null;
}): Promise<ArticleEntityEditorContext> {
  await requireAccess(args.leagueId);
  const service = createServiceRoleClient();
  const { seasons, activeSeasonId } = await getSeasonOptions(service, args.leagueId);
  const existingLinks = args.articleId
    ? await getExistingArticleLinks(service, args.articleId)
    : {
        seasonId: null,
        linkedPlayerIds: [],
        linkedTeamIds: [],
        linkedGameIds: [],
        primaryGameId: null,
      };

  const seasonId = args.seasonId ?? existingLinks.seasonId ?? null;
  const resolvedSeasonId = seasonId || activeSeasonId || null;
  const [players, teams, games] = await Promise.all([
    getPlayerOptions(service, args.leagueId, resolvedSeasonId),
    getTeamOptions(service, args.leagueId),
    getGameOptions(service, args.leagueId, resolvedSeasonId),
  ]);

  return {
    seasons,
    activeSeasonId,
    resolvedSeasonId,
    seasonId,
    players,
    teams,
    games,
    linkedPlayerIds: existingLinks.linkedPlayerIds,
    linkedTeamIds: existingLinks.linkedTeamIds,
    linkedGameIds: existingLinks.linkedGameIds,
    primaryGameId: existingLinks.primaryGameId,
  };
}

export async function suggestArticleEntities(
  input: SuggestArticleEntitiesInput,
): Promise<ArticleEntitySelection> {
  await requireAccess(input.leagueId);
  const context = await getArticleEntityEditorContext({
    leagueId: input.leagueId,
    seasonId: input.seasonId ?? null,
  });

  const haystack = normalizeText(
    [input.title, input.excerpt, articleContentToPlainText(input.content)].filter(Boolean).join(' '),
  );

  const linkedPlayerIds = context.players
    .filter((player) => containsWholePhrase(haystack, player.fullName))
    .map((player) => player.id);

  const linkedTeamIds = context.teams
    .filter((team) => containsWholePhrase(haystack, team.name))
    .map((team) => team.id);

  const matchedGames = context.games.filter((game) =>
    getGamePhrases(game).some((phrase) => containsWholePhrase(haystack, phrase)),
  );

  const selectedGames = context.games.filter((game) =>
    matchedGames.some((matchedGame) => matchedGame.id === game.id) ||
    game.id === input.preferredGameId,
  );

  const linkedGameIds = [...new Set(selectedGames.map((game) => game.id))];

  const gameTeamIds = selectedGames.flatMap((game) => [
    game.homeTeamId,
    game.awayTeamId,
  ]).filter(Boolean) as string[];

  const mergedTeamIds = [...new Set([...linkedTeamIds, ...gameTeamIds])];
  const primaryGameId =
    (input.preferredGameId && linkedGameIds.includes(input.preferredGameId) ? input.preferredGameId : null) ||
    linkedGameIds[0] ||
    null;

  return {
    seasonId: input.seasonId ?? context.resolvedSeasonId ?? null,
    linkedPlayerIds,
    linkedTeamIds: mergedTeamIds,
    linkedGameIds,
    primaryGameId,
  };
}

export async function syncArticleEntityTags(args: {
  articleId: string;
  linkedPlayerIds?: string[];
  linkedTeamIds?: string[];
  linkedGameIds?: string[];
  primaryGameId?: string | null;
}): Promise<void> {
  const service = createServiceRoleClient();
  const linkedPlayerIds = [...new Set((args.linkedPlayerIds || []).filter(Boolean))];
  const linkedTeamIds = [...new Set((args.linkedTeamIds || []).filter(Boolean))];
  const linkedGameIds = [...new Set((args.linkedGameIds || []).filter(Boolean))];
  const primaryGameId = args.primaryGameId || linkedGameIds[0] || null;

  if (primaryGameId && !linkedGameIds.includes(primaryGameId)) {
    linkedGameIds.unshift(primaryGameId);
  }

  await Promise.all([
    service.from('article_player_tags').delete().eq('article_id', args.articleId),
    service.from('article_team_tags').delete().eq('article_id', args.articleId),
    service.from('article_game_tags').delete().eq('article_id', args.articleId),
  ]);

  if (linkedPlayerIds.length > 0) {
    await service.from('article_player_tags').insert(
      linkedPlayerIds.map((playerId) => ({
        article_id: args.articleId,
        player_id: playerId,
        mention_type: 'mentioned',
      })),
    );
  }

  if (linkedTeamIds.length > 0) {
    await service.from('article_team_tags').insert(
      linkedTeamIds.map((teamId) => ({
        article_id: args.articleId,
        team_id: teamId,
      })),
    );
  }

  if (linkedGameIds.length > 0) {
    await service.from('article_game_tags').insert(
      linkedGameIds.map((gameId) => ({
        article_id: args.articleId,
        game_id: gameId,
        is_primary: gameId === primaryGameId,
      })),
    );
  }

  await service
    .from('articles')
    .update({
      game_id: primaryGameId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.articleId);
}
