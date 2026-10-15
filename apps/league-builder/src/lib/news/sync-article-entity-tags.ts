import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

export interface ArticleEntityTagUpdate {
  articleId: string;
  linkedPlayerIds?: string[];
  linkedTeamIds?: string[];
  linkedGameIds?: string[];
  primaryGameId?: string | null;
}

function unique(values: string[] | undefined): string[] {
  return [...new Set((values || []).filter(Boolean))];
}

function assertNoError(result: { error?: { message?: string } | null }, operation: string): void {
  if (result.error) throw new Error(`${operation}: ${result.error.message || 'database mutation failed'}`);
}

export async function syncArticleEntityTags(args: ArticleEntityTagUpdate): Promise<void> {
  const service = createServiceRoleClient();

  if (args.linkedPlayerIds !== undefined) {
    const playerIds = unique(args.linkedPlayerIds);
    assertNoError(
      await service.from('article_player_tags').delete().eq('article_id', args.articleId),
      'Failed to replace article player tags',
    );
    if (playerIds.length > 0) {
      assertNoError(await service.from('article_player_tags').insert(
        playerIds.map((playerId) => ({
          article_id: args.articleId,
          player_id: playerId,
          mention_type: 'mentioned',
        })),
      ), 'Failed to insert article player tags');
    }
  }

  if (args.linkedTeamIds !== undefined) {
    const teamIds = unique(args.linkedTeamIds);
    assertNoError(
      await service.from('article_team_tags').delete().eq('article_id', args.articleId),
      'Failed to replace article team tags',
    );
    if (teamIds.length > 0) {
      assertNoError(await service.from('article_team_tags').insert(
        teamIds.map((teamId) => ({ article_id: args.articleId, team_id: teamId })),
      ), 'Failed to insert article team tags');
    }
  }

  const updatesGames = args.linkedGameIds !== undefined || args.primaryGameId !== undefined;
  if (!updatesGames) return;

  let gameIds = unique(args.linkedGameIds);
  if (args.linkedGameIds === undefined) {
    const { data, error } = await service
      .from('article_game_tags')
      .select('game_id')
      .eq('article_id', args.articleId);
    assertNoError({ error }, 'Failed to load article game tags');
    gameIds = unique((data || []).map((row: { game_id: string }) => row.game_id));
  }
  const primaryGameId = args.primaryGameId !== undefined
    ? args.primaryGameId
    : gameIds[0] || null;
  if (primaryGameId && !gameIds.includes(primaryGameId)) gameIds.unshift(primaryGameId);

  assertNoError(
    await service.from('article_game_tags').delete().eq('article_id', args.articleId),
    'Failed to replace article game tags',
  );
  if (gameIds.length > 0) {
    assertNoError(await service.from('article_game_tags').insert(
      gameIds.map((gameId) => ({
        article_id: args.articleId,
        game_id: gameId,
        is_primary: gameId === primaryGameId,
      })),
    ), 'Failed to insert article game tags');
  }

  assertNoError(await service
    .from('articles')
    .update({ game_id: primaryGameId, updated_at: new Date().toISOString() })
    .eq('id', args.articleId), 'Failed to update the article primary game');
}
