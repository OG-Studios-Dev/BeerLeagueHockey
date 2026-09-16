import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Calendar, ChevronDown, Swords, User } from 'lucide-react';
import { SubscriptionWall } from '@/components/shared';
import { TeamLogo } from '@/components/shared/TeamLogo';
import { LeagueNewsFallbackArtwork } from '@/components/news/LeagueNewsFallbackArtwork';
import { RichArticleContent } from '@/components/news/RichArticleContent';
import { EditorialHeroImage } from '@/components/news/EditorialHeroImage';
import { ArticleHeroTitle } from '@/components/news/ArticleHeroTitle';
import { buildArticleMentions } from '@/lib/articles/linkify';
import { getArticleLinkContext, getArticlePlayerTags, getGamePreview, getLeagueBySlug, getNewsArticleBySlug } from '@/lib/data';
import { getArticleTextSnippet } from '@/lib/news/rich-text';
import { resolveArticleAppearance } from '@hockey-life/ui/news-article-format';

/** Extract the primary color from a "primary,secondary" colors string. */
function getPrimaryColor(colors: string | null): string | null {
  if (!colors) return null;
  return colors.split(',')[0] || null;
}

/** Pick white or black text based on a hex background color for readability. */
function readableTextColor(hex: string | null): string {
  if (!hex) return '#ffffff';
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  // Relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

interface ArticlePageProps {
  params: Promise<{ leagueSlug: string; slug: string }>;
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { leagueSlug, slug } = await params;
  const league = await getLeagueBySlug(leagueSlug);
  if (!league) return { title: 'Article Not Found' };

  const article = await getNewsArticleBySlug(league.id, slug);
  if (!article) return { title: 'Article Not Found' };

  const safeExcerpt = getArticleTextSnippet(article.excerpt || article.content, 180);

  return {
    title: `${article.title} - ${league.name}`,
    description: safeExcerpt || `Read "${article.title}" on ${league.name}`,
    openGraph: {
      title: article.title,
      description: safeExcerpt || undefined,
      images: article.image_url ? [article.image_url] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { leagueSlug, slug } = await params;

  const league = await getLeagueBySlug(leagueSlug);
  if (!league) return notFound();

  const article = await getNewsArticleBySlug(league.id, slug);
  if (!article) return notFound();

  const articleLinkContext = await getArticleLinkContext(article.id, league.id, article.game_id);
  const primaryGameId = articleLinkContext.primaryGame?.id || article.game_id || null;
  const [taggedPlayers, relatedGame] = await Promise.all([
    getArticlePlayerTags(article.id),
    primaryGameId ? getGamePreview(primaryGameId) : Promise.resolve(null),
  ]);
  const articleMentions = buildArticleMentions({
    leagueSlug,
    players: articleLinkContext.players,
    teams: articleLinkContext.teams,
    games: articleLinkContext.games,
  });

  const publishedDate = article.published_at || article.created_at;
  const formattedDate = new Date(publishedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const articleAppearance = resolveArticleAppearance(article.content);
  const titleIsOverlay = articleAppearance.titleLayout === 'overlay';
  const articleTitleBlock = (
    <>
      <div className="mb-4 inline-flex items-center rounded-full bg-[var(--league-primary)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
        {article.type === 'game_recap' ? 'Game recap' : article.type === 'weekly_wrap' ? 'Weekly wrap' : 'News'}
      </div>
      <ArticleHeroTitle
        title={article.title}
        content={article.content}
        tone={titleIsOverlay ? 'light' : 'default'}
      />
      <div className={`mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${
        titleIsOverlay ? 'text-white/72' : 'text-[var(--color-text-secondary)]'
      }`}>
        <div className="flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          <time dateTime={publishedDate}>{formattedDate}</time>
        </div>
        {article.author && (
          <div className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            {article.author_id ? (
              <Link
                href={`/${leagueSlug}/players/${article.author_id}`}
                className={titleIsOverlay
                  ? 'transition-colors hover:text-white'
                  : 'transition-colors hover:text-[var(--league-primary)]'}
              >
                {article.author.full_name}
              </Link>
            ) : (
              <span>{article.author.full_name}</span>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <SubscriptionWall>
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-7xl">
        {/* Back Link */}
        <Link
          href={`/${leagueSlug}/news`}
          className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--league-primary)] transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to News
        </Link>

        {/* Article */}
        <article className="league-reading-panel overflow-hidden rounded-[32px]">
          <div className="relative aspect-[4/3] sm:aspect-[16/7.2] min-h-[280px]">
            {article.image_url ? (
              <>
                {/* Mobile: simple full-bleed image */}
                <div className="absolute inset-0 sm:hidden">
                  <img src={article.image_url} alt={article.title} className="h-full w-full object-cover" />
                </div>
                {/* Desktop: layered editorial treatment */}
                <div className="absolute inset-0 hidden sm:block">
                  <EditorialHeroImage
                    src={article.image_url}
                    alt={article.title}
                    foregroundClassName="object-contain object-right"
                    backgroundClassName="object-cover opacity-24"
                  />
                </div>
              </>
            ) : (
              <LeagueNewsFallbackArtwork
                leagueName={league.name}
                leagueLogoUrl={league.logo_url}
                articleType={article.type}
                emphasis="hero"
              />
            )}
            <div className={`absolute inset-0 ${article.image_url ? 'bg-gradient-to-t from-black/92 via-black/40 to-transparent' : 'bg-gradient-to-t from-slate-950/88 via-slate-950/34 to-transparent'}`} />
            {articleAppearance.titleLayout === 'overlay' ? (
              <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
                {articleTitleBlock}
              </div>
            ) : null}
          </div>

          {!titleIsOverlay ? (
            <div className="border-t border-[var(--color-border)] px-6 py-7 md:px-8 md:py-9">
              {articleTitleBlock}
            </div>
          ) : null}

          <div className="border-t border-[var(--color-border)] p-6 md:p-8 lg:grid lg:grid-cols-[minmax(0,720px)_320px] lg:justify-center lg:gap-10">
            <aside className="lg:order-2 lg:sticky lg:top-24 lg:self-start">
            {/* Tagged players */}
            {taggedPlayers.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Tagged players
                </p>
                {taggedPlayers.length <= 2 ? (
                  <div className="flex flex-wrap gap-2.5">
                    {taggedPlayers.map((tag) => (
                      <Link
                        key={tag.id}
                        href={`/${leagueSlug}/players/${tag.player?.id}`}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/88 px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/35 hover:text-[var(--league-primary)]"
                      >
                        {tag.player?.avatar_url ? (
                          <img
                            src={tag.player.avatar_url}
                            alt={tag.player.full_name}
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--league-primary)]/12 text-xs font-black text-[var(--league-primary)]">
                            {tag.player?.full_name.charAt(0)}
                          </span>
                        )}
                        <span>{tag.player?.full_name}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div className="flex flex-wrap gap-2.5">
                      {taggedPlayers.slice(0, 2).map((tag) => (
                        <Link
                          key={tag.id}
                          href={`/${leagueSlug}/players/${tag.player?.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/88 px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/35 hover:text-[var(--league-primary)]"
                        >
                          {tag.player?.avatar_url ? (
                            <img
                              src={tag.player.avatar_url}
                              alt={tag.player.full_name}
                              className="h-7 w-7 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--league-primary)]/12 text-xs font-black text-[var(--league-primary)]">
                              {tag.player?.full_name.charAt(0)}
                            </span>
                          )}
                          <span>{tag.player?.full_name}</span>
                        </Link>
                      ))}
                    </div>
                    <details className="group mt-2.5">
                      <summary className="inline-flex list-none cursor-pointer items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/88 px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                        <span className="group-open:hidden">+{taggedPlayers.length - 2} more</span>
                        <span className="hidden group-open:inline">Show less</span>
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="mt-2.5 flex flex-wrap gap-2.5">
                        {taggedPlayers.slice(2).map((tag) => (
                          <Link
                            key={tag.id}
                            href={`/${leagueSlug}/players/${tag.player?.id}`}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/88 px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/35 hover:text-[var(--league-primary)]"
                          >
                            {tag.player?.avatar_url ? (
                              <img
                                src={tag.player.avatar_url}
                                alt={tag.player.full_name}
                                className="h-7 w-7 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--league-primary)]/12 text-xs font-black text-[var(--league-primary)]">
                                {tag.player?.full_name.charAt(0)}
                              </span>
                            )}
                            <span>{tag.player?.full_name}</span>
                          </Link>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}

            {/* Game summary */}
            {relatedGame && (
              <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/82 p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Game summary
                </p>
                <Link
                  href={`/${leagueSlug}/games/${relatedGame.id}`}
                  className="flex items-center justify-center gap-4 sm:gap-6"
                >
                  {/* Away team */}
                  <div className="flex flex-col items-center gap-2 min-w-0">
                    <TeamLogo
                      logoUrl={relatedGame.away_team?.logo ?? null}
                      teamName={relatedGame.away_team?.name || 'Away'}
                      size="lg"
                    />
                    <span
                      className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide truncate max-w-[120px]"
                      style={{
                        backgroundColor: getPrimaryColor(relatedGame.away_team?.colors ?? null) || 'var(--color-surface)',
                        color: readableTextColor(getPrimaryColor(relatedGame.away_team?.colors ?? null)),
                      }}
                    >
                      {relatedGame.away_team?.name || 'Away'}
                    </span>
                  </div>

                  {/* Score */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-baseline gap-2 text-3xl font-black tabular-nums text-[var(--color-text-primary)] sm:text-4xl">
                      <span>{relatedGame.away_score ?? '–'}</span>
                      <span className="text-lg text-[var(--color-text-muted)]">:</span>
                      <span>{relatedGame.home_score ?? '–'}</span>
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                      {relatedGame.status === 'completed' || relatedGame.status === 'pending_verification'
                        ? 'Final'
                        : relatedGame.status === 'in_progress'
                          ? 'Live'
                          : relatedGame.status === 'postponed'
                            ? 'Postponed'
                            : 'Upcoming'}
                    </span>
                  </div>

                  {/* Home team */}
                  <div className="flex flex-col items-center gap-2 min-w-0">
                    <TeamLogo
                      logoUrl={relatedGame.home_team?.logo ?? null}
                      teamName={relatedGame.home_team?.name || 'Home'}
                      size="lg"
                    />
                    <span
                      className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide truncate max-w-[120px]"
                      style={{
                        backgroundColor: getPrimaryColor(relatedGame.home_team?.colors ?? null) || 'var(--color-surface)',
                        color: readableTextColor(getPrimaryColor(relatedGame.home_team?.colors ?? null)),
                      }}
                    >
                      {relatedGame.home_team?.name || 'Home'}
                    </span>
                  </div>
                </Link>
                <div className="mt-3 text-center">
                  <Link
                    href={`/${leagueSlug}/games/${relatedGame.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--league-primary)] hover:underline"
                  >
                    <Swords className="h-4 w-4" />
                    View game page
                  </Link>
                </div>
              </div>
            )}

            <div className="mb-6 hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/72 p-5 lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                Story links
              </p>
              <div className="mt-4 space-y-2">
                <Link
                  href={`/${leagueSlug}/news`}
                  className="block rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/35 hover:text-[var(--league-primary)]"
                >
                  More league news
                </Link>
                {relatedGame ? (
                  <Link
                    href={`/${leagueSlug}/games/${relatedGame.id}`}
                    className="block rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/35 hover:text-[var(--league-primary)]"
                  >
                    Open related game
                  </Link>
                ) : null}
              </div>
            </div>
            </aside>

            {/* Article body */}
            <div className="lg:order-1 lg:max-w-[720px]">
              <RichArticleContent content={article.content} mentions={articleMentions} />
            </div>
          </div>
        </article>

        {/* Back to News */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)]">
          <Link
            href={`/${leagueSlug}/news`}
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--league-primary)] hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to All News
          </Link>
        </div>
      </div>
    </div>
    </SubscriptionWall>
  );
}
