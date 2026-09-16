'use server';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { verifyLeagueOwnerAccess } from './permissions';
import { syncArticleEntityTags } from './article-entities';
import { validateArticleContentForStorage } from '@hockey-life/ui/news-article-format';

const isDevelopment = process.env.NODE_ENV !== 'production';

// ==============================================================================
// TYPES
// ==============================================================================

export interface NewsArticle {
  id: string;
  league_id: string;
  title: string;
  content: string | null;
  excerpt: string | null;
  slug: string | null;
  image_url: string | null;
  type: string;
  article_type?: string;
  published: boolean;
  author_id: string | null;
  season_id: string | null;
  game_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNewsArticleParams {
  leagueId: string;
  title: string;
  content?: string;
  excerpt?: string;
  imageUrl?: string;
  slug?: string;
  seasonId?: string | null;
  linkedPlayerIds?: string[];
  linkedTeamIds?: string[];
  linkedGameIds?: string[];
  primaryGameId?: string | null;
}

export interface UpdateNewsArticleParams {
  title?: string;
  content?: string;
  excerpt?: string;
  imageUrl?: string;
  slug?: string;
  published?: boolean;
  seasonId?: string | null;
  linkedPlayerIds?: string[];
  linkedTeamIds?: string[];
  linkedGameIds?: string[];
  primaryGameId?: string | null;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// ==============================================================================
// HELPERS
// ==============================================================================

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

function normalizeNewsArticle(article: any): NewsArticle {
  return {
    ...article,
    type: article.type,
    article_type: article.type,
    published: Boolean(article.published),
    season_id: article.season_id || null,
    game_id: article.game_id || null,
  };
}

// ==============================================================================
// READ OPERATIONS
// ==============================================================================

/**
 * Get all news articles for a league
 */
export async function getNewsArticles(leagueId: string): Promise<ActionResult<NewsArticle[]>> {
  const supabase = await createClient();

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('*')
      .eq('league_id', leagueId)
      .eq('type', 'news')
      .order('created_at', { ascending: false });

    if (error) {
      if (isDevelopment) {
        console.error('Error fetching news articles:', error);
      }
      return { success: false, error: 'Failed to fetch articles' };
    }

    return { success: true, data: (articles || []).map(normalizeNewsArticle) };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in getNewsArticles:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get a single news article by ID
 */
export async function getNewsArticle(articleId: string): Promise<ActionResult<NewsArticle>> {
  const supabase = createServiceRoleClient();

  try {
    const { data: article, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();

    if (error || !article) {
      if (isDevelopment) {
        console.error('Error fetching article:', error);
      }
      return { success: false, error: 'Article not found' };
    }

    const access = await verifyLeagueOwnerAccess(article.league_id);
    if (!access.authorized) {
      return { success: false, error: access.error || 'Not authorized' };
    }

    return { success: true, data: normalizeNewsArticle(article) };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in getNewsArticle:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get all articles for a league (all types, for admin dashboard)
 */
export async function getAllLeagueArticles(leagueId: string): Promise<ActionResult<NewsArticle[]>> {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    return { success: false, error: access.error || 'Not authorized' };
  }

  const supabase = createServiceRoleClient();

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('*')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isDevelopment) {
        console.error('Error fetching all articles:', error);
      }
      return { success: false, error: 'Failed to fetch articles' };
    }

    return { success: true, data: (articles || []).map(normalizeNewsArticle) };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in getAllLeagueArticles:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}

// ==============================================================================
// CREATE OPERATIONS
// ==============================================================================

/**
 * Create a new news article
 */
export async function createNewsArticle(params: CreateNewsArticleParams): Promise<ActionResult<NewsArticle>> {
  const {
    leagueId,
    title,
    content,
    excerpt,
    imageUrl,
    slug,
    seasonId,
    linkedPlayerIds,
    linkedTeamIds,
    linkedGameIds,
    primaryGameId,
  } = params;

  // Verify access
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    return { success: false, error: access.error || 'Not authorized' };
  }
  if (!validateArticleContentForStorage(content)) {
    return { success: false, error: 'Invalid article content format' };
  }

  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();

  try {
    // Get current user for author_id
    const { data: { user } } = await supabase.auth.getUser();

    const articleSlug = slug || generateSlug(title);

    const { data: article, error } = await (serviceSupabase
      .from('articles') as any)
      .insert({
        league_id: leagueId,
        title,
        content: content || null,
        excerpt: excerpt || null,
        image_url: imageUrl || null,
        slug: articleSlug,
        type: 'news',
        published: false,
        author_id: user?.id || null,
        season_id: seasonId || null,
      })
      .select()
      .single();

    if (error) {
      if (isDevelopment) {
        console.error('Error creating article:', error);
      }
      return { success: false, error: 'Failed to create article' };
    }

    await syncArticleEntityTags({
      articleId: article.id,
      linkedPlayerIds,
      linkedTeamIds,
      linkedGameIds,
      primaryGameId,
    });

    revalidatePath(`/dashboard/leagues/${leagueId}/news`);
    return { success: true, data: normalizeNewsArticle(article) };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in createNewsArticle:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}

// ==============================================================================
// UPDATE OPERATIONS
// ==============================================================================

/**
 * Update an existing news article
 */
export async function updateNewsArticle(
  articleId: string,
  updates: UpdateNewsArticleParams
): Promise<ActionResult<NewsArticle>> {
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();

  try {
    // Get article to verify league ownership
    const { data: existingArticle, error: fetchError } = await serviceSupabase
      .from('articles')
      .select('league_id, type')
      .eq('id', articleId)
      .single();

    if (fetchError || !existingArticle) {
      return { success: false, error: 'Article not found' };
    }

    // Verify access
    const access = await verifyLeagueOwnerAccess(existingArticle.league_id);
    if (!access.authorized) {
      return { success: false, error: access.error || 'Not authorized' };
    }
    if (
      updates.content !== undefined &&
      !validateArticleContentForStorage(updates.content)
    ) {
      return { success: false, error: 'Invalid article content format' };
    }

    // Build update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.excerpt !== undefined) updateData.excerpt = updates.excerpt;
    if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
    if (updates.slug !== undefined) updateData.slug = updates.slug;
    if (updates.published !== undefined) updateData.published = updates.published;
    if (updates.seasonId !== undefined) updateData.season_id = updates.seasonId;

    const { data: article, error } = await serviceSupabase
      .from('articles')
      .update(updateData)
      .eq('id', articleId)
      .select()
      .single();

    if (error) {
      if (isDevelopment) {
        console.error('Error updating article:', error);
      }
      return { success: false, error: 'Failed to update article' };
    }

    await syncArticleEntityTags({
      articleId,
      linkedPlayerIds: updates.linkedPlayerIds,
      linkedTeamIds: updates.linkedTeamIds,
      linkedGameIds: updates.linkedGameIds,
      primaryGameId: updates.primaryGameId,
    });

    revalidatePath(`/dashboard/leagues/${existingArticle.league_id}/news`);
    return { success: true, data: normalizeNewsArticle(article) };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in updateNewsArticle:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Publish a news article
 */
export async function publishNewsArticle(articleId: string): Promise<ActionResult<NewsArticle>> {
  return updateNewsArticle(articleId, { published: true });
}

/**
 * Unpublish a news article
 */
export async function unpublishNewsArticle(articleId: string): Promise<ActionResult<NewsArticle>> {
  return updateNewsArticle(articleId, { published: false });
}

// ==============================================================================
// DELETE OPERATIONS
// ==============================================================================

/**
 * Delete a news article
 */
export async function deleteNewsArticle(articleId: string): Promise<ActionResult<void>> {
  const supabase = createServiceRoleClient();

  try {
    // Get article to verify league ownership
    const { data: article, error: fetchError } = await supabase
      .from('articles')
      .select('league_id')
      .eq('id', articleId)
      .single();

    if (fetchError || !article) {
      return { success: false, error: 'Article not found' };
    }

    // Verify access
    const access = await verifyLeagueOwnerAccess(article.league_id);
    if (!access.authorized) {
      return { success: false, error: access.error || 'Not authorized' };
    }

    const { error } = await supabase
      .from('articles')
      .delete()
      .eq('id', articleId);

    if (error) {
      if (isDevelopment) {
        console.error('Error deleting article:', error);
      }
      return { success: false, error: 'Failed to delete article' };
    }

    revalidatePath(`/dashboard/leagues/${article.league_id}/news`);
    return { success: true, data: undefined };
  } catch (error) {
    if (isDevelopment) {
      console.error('Unexpected error in deleteNewsArticle:', error);
    }
    return { success: false, error: 'An unexpected error occurred' };
  }
}
