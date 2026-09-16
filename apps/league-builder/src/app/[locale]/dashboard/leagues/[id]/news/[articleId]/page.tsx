'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getNewsArticle, updateNewsArticle, deleteNewsArticle } from '@/lib/actions/news';
import { getArticleEntityEditorContext, suggestArticleEntities } from '@/lib/actions/article-entities';
import { uploadNewsImage, deleteNewsImage } from '@/lib/actions/image-upload';
import { ArticleEntityLinksEditor } from '@/components/news/ArticleEntityLinksEditor';
import { ArticleFormatEditor } from '@/components/news/ArticleFormatEditor';
import { serializeArticleEditorContent } from '@/lib/news/article-format-editor';
import Link from 'next/link';
import { cn } from '@hockey-life/ui';
import { ArrowLeft, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { LogoUploader } from '@/components/ui/logo-uploader';
import type {
  ArticleEditorSeasonOption,
  ArticleEntityGameOption,
  ArticleEntityPlayerOption,
  ArticleEntityTeamOption,
} from '@/lib/news/article-entity-types';

function generateSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

function filterIds<T extends { id: string }>(ids: string[], options: T[]) {
  const validIds = new Set(options.map((option) => option.id));
  return ids.filter((id) => validIds.has(id));
}

export default function EditNewsArticlePage() {
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;
  const leagueId = params.id as string;
  const articleId = params.articleId as string;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [articleType, setArticleType] = useState('news');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null);
  const [seasonOptions, setSeasonOptions] = useState<ArticleEditorSeasonOption[]>([]);
  const [playerOptions, setPlayerOptions] = useState<ArticleEntityPlayerOption[]>([]);
  const [teamOptions, setTeamOptions] = useState<ArticleEntityTeamOption[]>([]);
  const [gameOptions, setGameOptions] = useState<ArticleEntityGameOption[]>([]);
  const [linkedPlayerIds, setLinkedPlayerIds] = useState<string[]>([]);
  const [linkedTeamIds, setLinkedTeamIds] = useState<string[]>([]);
  const [linkedGameIds, setLinkedGameIds] = useState<string[]>([]);
  const [primaryGameId, setPrimaryGameId] = useState<string | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [suggestingLinks, setSuggestingLinks] = useState(false);

  async function loadArticle(nextSeasonId?: string | null, preserveSelection = false) {
    setLoading(true);
    setLoadingLinks(true);
    setError(null);

    try {
      const [articleResult, context] = await Promise.all([
        getNewsArticle(articleId),
        getArticleEntityEditorContext({
          leagueId,
          articleId,
          seasonId: nextSeasonId,
        }),
      ]);

      if (!articleResult.success) {
        setError(articleResult.error);
        return;
      }

      const article = articleResult.data;
      const resolvedSeasonId = nextSeasonId ?? context.seasonId ?? context.resolvedSeasonId ?? null;

      setTitle(article.title);
      setSlug(article.slug || '');
      setContent(article.content || '');
      setExcerpt(article.excerpt || '');
      setImageUrl(article.image_url || '');
      setArticleType(article.type || 'news');
      setSeasonOptions(context.seasons);
      setActiveSeasonId(context.activeSeasonId);
      setSeasonId(resolvedSeasonId);
      setPlayerOptions(context.players);
      setTeamOptions(context.teams);
      setGameOptions(context.games);

      const basePlayerIds = preserveSelection ? linkedPlayerIds : context.linkedPlayerIds;
      const baseTeamIds = preserveSelection ? linkedTeamIds : context.linkedTeamIds;
      const baseGameIds = preserveSelection ? linkedGameIds : context.linkedGameIds;
      const basePrimaryGameId = preserveSelection ? primaryGameId : context.primaryGameId;

      const nextPlayerIds = filterIds(basePlayerIds, context.players);
      const nextTeamIds = filterIds(baseTeamIds, context.teams);
      const nextGameIds = filterIds(baseGameIds, context.games);
      const nextPrimaryGameId =
        nextGameIds.includes(basePrimaryGameId || '') ? basePrimaryGameId : nextGameIds[0] || null;

      setLinkedPlayerIds(nextPlayerIds);
      setLinkedTeamIds(nextTeamIds);
      setLinkedGameIds(nextGameIds);
      setPrimaryGameId(nextPrimaryGameId);

      if (!preserveSelection && article.type !== 'news' && nextPlayerIds.length === 0) {
        const suggestion = await suggestArticleEntities({
          leagueId,
          seasonId: resolvedSeasonId,
          title: article.title,
          excerpt: article.excerpt,
          content: article.content,
          preferredGameId: nextPrimaryGameId,
        });

        setLinkedPlayerIds(suggestion.linkedPlayerIds);
        setLinkedTeamIds(suggestion.linkedTeamIds);
        setLinkedGameIds(suggestion.linkedGameIds);
        setPrimaryGameId(suggestion.primaryGameId);
      }
    } catch {
      setError('Failed to load article.');
    } finally {
      setLoading(false);
      setLoadingLinks(false);
    }
  }

  async function runAutoSuggest() {
    if (!title && !excerpt && !content) return;

    setSuggestingLinks(true);
    setError(null);

    try {
      const suggestion = await suggestArticleEntities({
        leagueId,
        seasonId,
        title,
        excerpt,
        content,
        preferredGameId: primaryGameId,
      });

      if (!seasonId && suggestion.seasonId) {
        setSeasonId(suggestion.seasonId);
      }
      setLinkedPlayerIds(suggestion.linkedPlayerIds);
      setLinkedTeamIds(suggestion.linkedTeamIds);
      setLinkedGameIds(suggestion.linkedGameIds);
      setPrimaryGameId(suggestion.primaryGameId);
    } catch {
      setError('Failed to auto-detect linked entities.');
    } finally {
      setSuggestingLinks(false);
    }
  }

  useEffect(() => {
    void loadArticle();
  }, [articleId, leagueId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await updateNewsArticle(articleId, {
      title: title.trim(),
      content: serializeArticleEditorContent(content),
      excerpt: excerpt.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      slug: (slug.trim() || generateSlug(title)).trim(),
      seasonId,
      linkedPlayerIds,
      linkedTeamIds,
      linkedGameIds,
      primaryGameId,
    });

    if (result.success) {
      router.push(`/${locale}/dashboard/leagues/${leagueId}/news`);
      return;
    }

    setError(result.error);
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this article? This action cannot be undone.')) {
      return;
    }

    setSaving(true);
    setError(null);

    const result = await deleteNewsArticle(articleId);
    if (result.success) {
      router.push(`/${locale}/dashboard/leagues/${leagueId}/news`);
      return;
    }

    setError(result.error);
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="inline-flex items-center gap-2 text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading article...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            href={`/${locale}/dashboard/leagues/${leagueId}/news`}
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-rink-500 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to News
          </Link>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">Edit Article</h1>
              <p className="mt-1 text-neutral-400">
                Update this {articleType.replace('_', ' ')} article and control which entities link on the public story.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Article Type</p>
                <p className="mt-1 text-white font-semibold">
                  {articleType === 'game_recap' ? 'Game Recap' : articleType === 'weekly_wrap' ? 'Weekly Wrap' : 'News'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runAutoSuggest()}
                disabled={saving || suggestingLinks || loadingLinks}
                className="inline-flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-semibold text-purple-200 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {suggestingLinks ? 'Detecting...' : 'Auto-Detect Links'}
              </button>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-neutral-300 mb-2">
                Title *
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-rink-500/50 focus:border-rink-500"
                required
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-neutral-300 mb-2">
                URL Slug
              </label>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="url-slug"
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-rink-500/50 focus:border-rink-500"
              />
            </div>

            <div>
              <label htmlFor="excerpt" className="block text-sm font-medium text-neutral-300 mb-2">
                Excerpt
              </label>
              <textarea
                id="excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Brief summary for article cards..."
                rows={2}
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-rink-500/50 focus:border-rink-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-2">
                Featured Image
              </label>
              <LogoUploader
                value={imageUrl}
                onChange={(url) => setImageUrl(url)}
                onUpload={async (file) => {
                  const result = await uploadNewsImage(leagueId, file);
                  if (!result.success) throw new Error(result.error);
                  return result.data;
                }}
                onRemove={async () => {
                  if (imageUrl) {
                    await deleteNewsImage(leagueId, imageUrl);
                    setImageUrl('');
                  }
                }}
                aspectRatio={16 / 9}
                outputSize={1600}
                outputHeight={900}
                maxSizeBytes={5 * 1024 * 1024}
                placeholder="Upload Featured Image"
                shape="square"
              />
            </div>
          </div>

          <ArticleFormatEditor
            value={content}
            onChange={setContent}
            title={title}
            disabled={saving}
          />

          <ArticleEntityLinksEditor
            seasons={seasonOptions}
            seasonId={seasonId}
            activeSeasonId={activeSeasonId}
            players={playerOptions}
            teams={teamOptions}
            games={gameOptions}
            linkedPlayerIds={linkedPlayerIds}
            linkedTeamIds={linkedTeamIds}
            linkedGameIds={linkedGameIds}
            primaryGameId={primaryGameId}
            onSeasonChange={(nextSeasonId) => {
              void loadArticle(nextSeasonId, true);
            }}
            onLinkedPlayerIdsChange={setLinkedPlayerIds}
            onLinkedTeamIdsChange={setLinkedTeamIds}
            onLinkedGameIdsChange={setLinkedGameIds}
            onPrimaryGameIdChange={setPrimaryGameId}
            onAutoSuggest={() => {
              void runAutoSuggest();
            }}
            suggesting={suggestingLinks || loadingLinks}
            disabled={saving || loadingLinks}
          />

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/${locale}/dashboard/leagues/${leagueId}/news`}
              className="px-5 py-2.5 rounded-xl font-medium text-sm text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm',
                'bg-gradient-to-r from-rink-500 to-arena-500 text-black',
                'hover:shadow-lg hover:shadow-rink-500/20 transition-all',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Article'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
