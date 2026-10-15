'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { verifyLeagueOwnerAccess } from './permissions';
import {
  isNewspaperLinkedArticle,
  NEWSPAPER_ARTICLE_FROZEN_ERROR,
} from '@/lib/news/newspaper-article-guard';

const isDevelopment = process.env.NODE_ENV !== 'production';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

interface AiGenerationLogEntry {
  id: string;
  league_id: string;
  article_type: string;
  status: string;
  game_id: string | null;
  division_id: string | null;
  article_id: string | null;
  tokens_used: number | null;
  model_used: string | null;
  generation_time_ms: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

async function getFunctionInvokeErrorMessage(error: unknown): Promise<string> {
  if (typeof error === 'object' && error && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const responseText = await context.clone().text();
        if (responseText) {
          try {
            const payload = JSON.parse(responseText) as { error?: unknown; message?: unknown };
            if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
            if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
          } catch {
            return responseText.slice(0, 500);
          }
        }
      } catch {
        // Fall back to the SDK error below if the response body cannot be read.
      }
    }
  }

  return getErrorMessage(error, 'Failed to regenerate recap');
}

/**
 * Regenerate a game recap article
 */
export async function regenerateGameRecap(
  gameId: string,
  leagueId: string
): Promise<ActionResult> {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    return { success: false, error: access.error || 'Not authorized' };
  }

  const supabase = createServiceRoleClient();

  try {
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('league_id, status, leagues(slug)')
      .eq('id', gameId)
      .eq('league_id', leagueId)
      .single();

    if (gameError) {
      if (gameError.code === 'PGRST116') {
        return { success: false, error: 'Game not found' };
      }
      return {
        success: false,
        error: `Failed to load game: ${getErrorMessage(gameError, 'database query failed')}`,
      };
    }

    if (!game || game.league_id !== leagueId) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== 'completed') {
      return { success: false, error: 'Game must be completed before generating a recap' };
    }

    const { data, error } = await supabase.functions.invoke('generate-ai-article', {
      body: { action: 'game_recap', game_id: gameId, force: true },
    });

    if (error) {
      if (isDevelopment) console.error('Regenerate recap error:', error);
      return { success: false, error: await getFunctionInvokeErrorMessage(error) };
    }

    if (!data || data.success === false) {
      return {
        success: false,
        error: typeof data?.error === 'string' ? data.error : 'Failed to regenerate recap',
      };
    }

    const leagueRelation = Array.isArray(game.leagues) ? game.leagues[0] : game.leagues;
    const leagueSlug = leagueRelation?.slug;

    revalidatePath(`/dashboard/leagues/${leagueId}/games`);
    revalidatePath(`/dashboard/leagues/${leagueId}/games/${gameId}`);
    revalidatePath(`/dashboard/leagues/${leagueId}/news`);
    if (leagueSlug) {
      revalidatePath(`/${leagueSlug}/games/${gameId}`);
      revalidatePath(`/${leagueSlug}/news`);
    }

    return { success: true, data: undefined };
  } catch (error) {
    if (isDevelopment) console.error('Unexpected error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Update article image
 */
export async function updateArticleImage(
  articleId: string,
  imageUrl: string
): Promise<ActionResult> {
  const supabase = await createClient();

  try {
    // Get article to verify league ownership
    const { data: article } = await supabase
      .from('articles')
      .select('league_id')
      .eq('id', articleId)
      .single();

    if (!article) {
      return { success: false, error: 'Article not found' };
    }

    const access = await verifyLeagueOwnerAccess(article.league_id);
    if (!access.authorized) {
      return { success: false, error: access.error || 'Not authorized' };
    }

    const serviceSupabase = createServiceRoleClient();
    if (await isNewspaperLinkedArticle(serviceSupabase as never, articleId)) {
      return { success: false, error: NEWSPAPER_ARTICLE_FROZEN_ERROR };
    }

    const { error } = await supabase
      .from('articles')
      .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
      .eq('id', articleId);

    if (error) {
      return { success: false, error: 'Failed to update image' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    if (isDevelopment) console.error('Update image error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get AI generation history for a league
 */
export async function getAiGenerationHistory(
  leagueId: string
): Promise<ActionResult<AiGenerationLogEntry[]>> {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    return { success: false, error: access.error || 'Not authorized' };
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from('ai_generation_log')
      .select('*')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return { success: false, error: 'Failed to fetch generation history' };
    }

    return { success: true, data: (data || []) as AiGenerationLogEntry[] };
  } catch (error) {
    if (isDevelopment) console.error('Fetch history error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
