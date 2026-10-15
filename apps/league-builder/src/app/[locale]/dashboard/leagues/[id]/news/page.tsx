import { setRequestLocale } from 'next-intl/server';
import { redirect as nextRedirect, notFound } from 'next/navigation';
import { getAllLeagueArticles } from '@/lib/actions/news';
import Link from 'next/link';
import { cn } from '@hockey-life/ui';
import {
  ArrowLeft,
  Plus,
  Newspaper,
  Eye,
  EyeOff,
  Calendar,
} from 'lucide-react';
import { NewsArticleActions } from './NewsArticleActions';
import { AnnouncementComposerButton } from '@/components/news/AnnouncementComposerButton';
import { requireLeagueDashboardAccess } from '@/lib/auth/league-dashboard-access';
import { getHockeyLifeTimesSetup } from '@/lib/actions/hockey-life-times';
import { HockeyLifeTimesGenerator } from '@/components/news/HockeyLifeTimesGenerator';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function LeagueNewsPage({ params }: Props) {
  const awaited = await params;
  const { locale, id: leagueId } = awaited;
  setRequestLocale(locale);

  const { supabase } = await requireLeagueDashboardAccess({ leagueId, locale });

  // Get league details
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, name')
    .eq('id', leagueId)
    .single();

  if (leagueError || !league) {
    notFound();
  }

  // Get news articles
  const result = await getAllLeagueArticles(leagueId);
  const articles = result.success ? result.data : [];
  const newspaperSetup = await getHockeyLifeTimesSetup(leagueId);

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/${locale}/dashboard/leagues/${leagueId}`}
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-rink-500 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {league.name}
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">News & Articles</h1>
              <p className="text-neutral-400 mt-1">
                Manage news articles for {league.name}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <AnnouncementComposerButton leagueId={leagueId} leagueName={league.name} />
              <Link
                href={`/${locale}/dashboard/leagues/${leagueId}/news/new`}
                className={cn(
                  'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm',
                  'bg-gradient-to-r from-rink-500 to-arena-500 text-black',
                  'hover:shadow-lg hover:shadow-rink-500/20 transition-all'
                )}
              >
                <Plus className="w-4 h-4" />
                New Article
              </Link>
            </div>
          </div>
        </div>

        {newspaperSetup.success && newspaperSetup.data.enabled && (
          <HockeyLifeTimesGenerator leagueId={leagueId} seasons={newspaperSetup.data.seasons} />
        )}

        {/* Articles List */}
        {articles.length > 0 ? (
          <div className="space-y-3">
            {articles.map((article) => (
              <div
                key={article.id}
                className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-xl p-5 hover:border-white/20 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-white truncate">
                        {article.title}
                      </h3>
                      <span
                        className={cn(
                          'px-2.5 py-0.5 text-xs font-semibold rounded-full border shrink-0',
                          article.published
                            ? 'bg-green-500/10 text-green-500 border-green-500/30'
                            : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30'
                        )}
                      >
                        {article.published ? (
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" /> Published
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <EyeOff className="w-3 h-3" /> Draft
                          </span>
                        )}
                      </span>
                      {article.article_type !== 'news' && (
                        <span
                          className={cn(
                            'px-2.5 py-0.5 text-xs font-semibold rounded-full border shrink-0',
                            article.article_type === 'game_recap'
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                              : 'bg-purple-500/10 text-purple-500 border-purple-500/30'
                          )}
                        >
                          {article.article_type === 'game_recap' ? 'Game Recap' : 'Weekly Wrap'}
                        </span>
                      )}
                    </div>
                    {article.excerpt && (
                      <p className="text-sm text-neutral-400 truncate">{article.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-neutral-500">
                      <Calendar className="w-3 h-3" />
                      {new Date(article.created_at).toLocaleDateString()}
                      {article.slug && (
                        <span className="text-neutral-600">/{article.slug}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/${locale}/dashboard/leagues/${leagueId}/news/${article.id}`}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium',
                        'bg-rink-500/10 text-rink-500 border border-rink-500/30',
                        'hover:bg-rink-500/20 transition-colors'
                      )}
                    >
                      Edit
                    </Link>
                    <NewsArticleActions
                      articleId={article.id}
                      published={article.published}
                      gameId={article.article_type === 'game_recap' ? article.game_id : null}
                      leagueId={leagueId}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
            <Newspaper className="w-12 h-12 text-rink-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No Articles Yet</h3>
            <p className="text-neutral-400 mb-6">
              Create your first article to share news with your league!
            </p>
            <Link
              href={`/${locale}/dashboard/leagues/${leagueId}/news/new`}
              className={cn(
                'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm',
                'bg-gradient-to-r from-rink-500 to-arena-500 text-black',
                'hover:shadow-lg hover:shadow-rink-500/20 transition-all'
              )}
            >
              <Plus className="w-4 h-4" />
              Create Article
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
