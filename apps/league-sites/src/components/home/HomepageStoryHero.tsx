'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Newspaper,
  Trophy,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import type { League, LeagueStats, NewsArticle, Season } from '@/lib/types';
import { stripMarkdownLinks } from '@/lib/news/rich-text';
import { EditorialHeroImage } from '@/components/news/EditorialHeroImage';

const HERO_AUTOPLAY_MS = 7000;
const HERO_MANUAL_HOLD_MS = 12000;
const HERO_TICK_MS = 100;
const NO_STORY_HERO_IMAGE = '/rink.png';

export interface HomepageStoryFallback {
  eyebrow: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  href: string;
  cta: string;
}

function HeroStageFallback({
  leagueName,
  leagueLogoUrl,
}: {
  leagueName: string;
  leagueLogoUrl?: string | null;
}) {
  return (
    <div className="relative h-full w-full">
      <img src={NO_STORY_HERO_IMAGE} alt="" className="h-full w-full object-cover" />
      {leagueLogoUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={leagueLogoUrl}
            alt={`${leagueName} logo`}
            className="h-28 w-28 object-contain opacity-[0.22] drop-shadow-[0_24px_48px_rgba(0,0,0,0.42)] sm:h-36 sm:w-36 lg:h-44 lg:w-44"
          />
        </div>
      ) : null}
    </div>
  );
}

interface HomepageStoryHeroProps {
  league: League;
  leagueSlug: string;
  articles: NewsArticle[];
  currentSeason: Season | null;
  registrationSeason?: {
    id?: string;
    name?: string | null;
    registration_closes_at?: string | null;
  } | null;
  stats: LeagueStats;
  photoFallback?: HomepageStoryFallback | null;
  showInfoCard?: boolean;
}

function getArticleLabel(articleType?: string | null) {
  if (articleType === 'game_recap') return 'Game Recap';
  if (articleType === 'weekly_wrap') return 'Weekly Wrap';
  if (articleType === 'announcement') return 'Announcement';
  return 'League Story';
}

function clipText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const clipped = value.slice(0, maxLength).trimEnd();
  const safeBoundary = Math.max(clipped.lastIndexOf(' '), maxLength - 20);
  return `${clipped.slice(0, safeBoundary).trimEnd()}...`;
}

export function deriveSnippet(article: NewsArticle) {
  const excerpt = stripMarkdownLinks(article.excerpt);
  if (excerpt) {
    return clipText(excerpt, 140);
  }

  const content = stripMarkdownLinks(article.content);
  if (content) {
    return clipText(content, 140);
  }

  return 'Fresh current-season league coverage, recaps, and player stories from around the rink.';
}

function getLocationLine(league: League, currentSeason: Season | null) {
  const location = [league.city, league.state].filter(Boolean).join(', ');
  if (location) {
    return location;
  }
  if (currentSeason?.name) {
    return currentSeason.name;
  }
  return 'Current season coverage';
}

function getSeasonNote(currentSeason: Season | null, stats: LeagueStats) {
  if (currentSeason?.name) {
    return `${currentSeason.name} with ${stats.totalTeams} teams, ${stats.totalPlayers} players, and ${stats.upcomingGames} games ahead.`;
  }
  return `${stats.totalTeams} teams, ${stats.totalPlayers} players, and ${stats.upcomingGames} upcoming games.`;
}

function formatStoryDate(article: NewsArticle) {
  return new Date(article.published_at || article.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function HomepageStoryHero({
  league,
  leagueSlug,
  articles,
  currentSeason,
  registrationSeason,
  stats,
  photoFallback,
  showInfoCard = true,
}: HomepageStoryHeroProps) {
  const storySlides = useMemo(
    () =>
      articles.slice(0, 5).map((article) => ({
        id: article.id,
        article,
        title: article.title,
        eyebrow: getArticleLabel(article.type),
        snippet: deriveSnippet(article),
        imageUrl: article.image_url,
        href: `/${leagueSlug}/news/${article.slug || article.id}`,
        cta: 'Read Story',
        dateLabel: formatStoryDate(article),
      })),
    [articles, leagueSlug],
  );

  const fallbackSlide = photoFallback
    ? {
        id: 'photo-fallback',
        title: photoFallback.title,
        eyebrow: photoFallback.eyebrow,
        snippet: photoFallback.subtitle,
        imageUrl: photoFallback.imageUrl,
        href: photoFallback.href,
        cta: photoFallback.cta,
        dateLabel: currentSeason?.name || 'Current Season',
        article: null,
      }
    : {
        id: 'identity-fallback',
        title: league.name,
        eyebrow: 'League Front Page',
        snippet:
          league.description ||
          'Schedules, standings, scores, and the latest league coverage in one place.',
        imageUrl: null,
        href: `/${leagueSlug}/schedule`,
        cta: 'View Schedule',
        dateLabel: currentSeason?.name || 'Current Season',
        article: null,
      };

  const hasStorySlides = storySlides.length > 0;
  const slides = hasStorySlides ? storySlides : [fallbackSlide];
  const hasEditorialStage = hasStorySlides || fallbackSlide.id === 'photo-fallback';
  const hasMultipleSlides = slides.length > 1;
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(hasMultipleSlides ? HERO_AUTOPLAY_MS : 0);
  const [cycleMs, setCycleMs] = useState(hasMultipleSlides ? HERO_AUTOPLAY_MS : 0);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusPaused, setIsFocusPaused] = useState(false);

  // TODO(Pixel): derive cycleMs/remainingMs from slides.length; clamp activeIndex during render
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((previous) => {
      if (slides.length === 0) {
        return 0;
      }
      return previous >= slides.length ? 0 : previous;
    });

    if (slides.length > 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCycleMs(HERO_AUTOPLAY_MS);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemainingMs(HERO_AUTOPLAY_MS);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCycleMs(0);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemainingMs(0);
    }
  }, [slides.length]);

  useEffect(() => {
    if (!hasMultipleSlides || isHovered || isFocusPaused) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setRemainingMs((current) => Math.max(0, current - HERO_TICK_MS));
    }, HERO_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [hasMultipleSlides, isFocusPaused, isHovered]);

  // TODO(Pixel): restructure autoplay advance — consider setInterval + callback pattern instead
  useEffect(() => {
    if (!hasMultipleSlides || isHovered || isFocusPaused || remainingMs > 0) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((current) => (current + 1) % slides.length);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCycleMs(HERO_AUTOPLAY_MS);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemainingMs(HERO_AUTOPLAY_MS);
  }, [hasMultipleSlides, isFocusPaused, isHovered, remainingMs, slides.length]);

  const activeSlide = slides[activeIndex] || fallbackSlide;
  const progress = cycleMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / cycleMs)) : 0;
  const locationLine = getLocationLine(league, currentSeason);
  const seasonNote = getSeasonNote(currentSeason, stats);
  const heroOverlayClass = hasEditorialStage
    ? 'bg-[linear-gradient(90deg,rgba(6,12,22,0.88)_0%,rgba(6,12,22,0.64)_42%,rgba(6,12,22,0.32)_70%,rgba(6,12,22,0.58)_100%)]'
    : 'bg-[linear-gradient(90deg,rgba(8,14,24,0.34)_0%,rgba(8,14,24,0.18)_34%,rgba(8,14,24,0.14)_58%,rgba(8,14,24,0.72)_100%)]';
  const heroGlowClass = hasEditorialStage
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--league-primary)_26%,transparent),transparent_34%)]'
    : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_36%,rgba(4,10,18,0.12)_64%,rgba(4,10,18,0.36)_100%)]';
  const registrationLabel = registrationSeason?.registration_closes_at
    ? new Date(registrationSeason.registration_closes_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  const jumpToSlide = (nextIndex: number) => {
    setActiveIndex((nextIndex + slides.length) % slides.length);
    if (hasMultipleSlides) {
      setCycleMs(HERO_MANUAL_HOLD_MS);
      setRemainingMs(HERO_MANUAL_HOLD_MS);
    }
  };

  const dockPrimaryCta = `/${leagueSlug}/schedule`;
  const dockSecondaryCta = `/${leagueSlug}/standings`;
  const dockTertiaryCta = registrationSeason ? `/${leagueSlug}/register` : `/${leagueSlug}/scores`;
  const dockPrimaryLabel = registrationSeason ? 'Register' : 'Schedule';
  const secondaryActions = registrationSeason
    ? [
        {
          href: `/${leagueSlug}/schedule`,
          label: 'Schedule',
          icon: <Calendar className="h-4 w-4 text-[var(--color-accent)]" />,
        },
        {
          href: dockSecondaryCta,
          label: 'Standings',
          icon: <Trophy className="h-4 w-4 text-[var(--color-accent)]" />,
        },
      ]
    : [
        {
          href: dockSecondaryCta,
          label: 'Standings',
          icon: <Trophy className="h-4 w-4 text-[var(--color-accent)]" />,
        },
        {
          href: dockTertiaryCta,
          label: 'Scores',
          icon: <TrendingUp className="h-4 w-4 text-[var(--color-accent)]" />,
        },
      ];

  return (
    <section
      className="relative isolate overflow-hidden border-b border-[var(--color-border)]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
        <div className="absolute inset-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide.id}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              {hasEditorialStage ? (
                activeSlide.imageUrl ? (
                  <EditorialHeroImage
                    src={activeSlide.imageUrl}
                    alt={activeSlide.title}
                    mode="hero"
                    backgroundClassName="object-cover object-center"
                  />
                ) : (
                  <HeroStageFallback
                    leagueName={league.name}
                    leagueLogoUrl={league.logo_url}
                  />
                )
              ) : (
                <img
                  src={NO_STORY_HERO_IMAGE}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </motion.div>
          </AnimatePresence>
          <div className={`absolute inset-0 ${heroOverlayClass}`} />
          <div className={`absolute inset-0 ${heroGlowClass}`} />
        </div>

        {hasEditorialStage && (
          <Link
            href={activeSlide.href}
            aria-label={activeSlide.title}
            className="absolute inset-0 z-0"
          />
        )}

        <div
          className={`relative mx-auto flex max-w-[1440px] px-4 py-5 sm:px-5 md:px-6 xl:px-8 ${
            hasEditorialStage
              ? 'min-h-[336px] items-end md:min-h-[620px] md:py-8 xl:py-10'
              : 'min-h-[300px] items-center md:min-h-[380px] md:py-5 xl:py-6'
          }`}
        >
          <div
            className={`grid w-full gap-5 ${
            showInfoCard
              ? hasEditorialStage
                ? 'items-end lg:grid-cols-[minmax(0,1.45fr)_340px] xl:grid-cols-[minmax(0,1.55fr)_360px]'
                : 'items-center lg:grid-cols-[minmax(0,1.5fr)_340px] xl:grid-cols-[minmax(0,1.65fr)_360px]'
              : 'items-end'
          }`}
        >
          {hasEditorialStage ? (
            <div className="relative z-20 max-w-4xl">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activeSlide.id}-content`}
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/24 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/84 backdrop-blur-sm">
                    <Newspaper className="h-3.5 w-3.5" />
                    {activeSlide.eyebrow}
                  </div>
                  <div className="mt-4 max-w-3xl md:mt-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60 md:text-xs">
                      {activeSlide.dateLabel}
                    </p>
                    <h1 className="mt-2 max-w-[14ch] text-[2.35rem] font-black leading-[0.94] tracking-[-0.04em] text-white text-balance sm:max-w-3xl sm:text-5xl lg:text-6xl xl:text-[4.35rem]">
                      {activeSlide.title}
                    </h1>
                    <p className="mt-4 hidden max-w-2xl text-sm leading-6 text-white/78 md:block md:text-base md:leading-7">
                      {activeSlide.snippet}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3 md:mt-6">
                    <Link
                      href={activeSlide.href}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-slate-950 transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      {activeSlide.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    {hasStorySlides && (
                      <Link
                        href={`/${leagueSlug}/news`}
                        className="hidden items-center gap-2 rounded-full border border-white/16 bg-black/18 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/82 backdrop-blur-sm transition-colors duration-200 hover:border-white/32 hover:text-white md:inline-flex"
                      >
                        All News
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>

              {hasMultipleSlides && (
                <div
                  className="relative z-20 mt-5 flex flex-col gap-3 md:mt-7"
                  onFocusCapture={() => setIsFocusPaused(true)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setIsFocusPaused(false);
                    }
                  }}
                >
                  <div className="flex items-center gap-3 md:hidden">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">
                      {String(activeIndex + 1).padStart(2, '0')}
                    </span>
                    <span className="relative h-px flex-1 overflow-hidden rounded-full bg-white/18">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-white/72 transition-all duration-200"
                        style={{ width: `${((activeIndex + progress) / slides.length) * 100}%` }}
                      />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">
                      {String(slides.length).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="hidden flex-wrap items-center gap-3 md:flex">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => jumpToSlide(activeIndex - 1)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/14 bg-black/22 text-white/86 backdrop-blur-sm transition-colors duration-200 hover:border-white/30 hover:text-white"
                        aria-label="Previous story"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => jumpToSlide(activeIndex + 1)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/14 bg-black/22 text-white/86 backdrop-blur-sm transition-colors duration-200 hover:border-white/30 hover:text-white"
                        aria-label="Next story"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {slides.map((slide, index) => (
                        <button
                          key={slide.id}
                          type="button"
                          onClick={() => jumpToSlide(index)}
                          className="group inline-flex items-center gap-2"
                          aria-label={`Go to story ${index + 1}`}
                        >
                          <span className="relative h-[3px] w-10 overflow-hidden rounded-full bg-white/18">
                            <span
                              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-200 ${
                                activeIndex === index ? 'bg-white' : 'bg-white/0'
                              }`}
                              style={{
                                width: activeIndex === index ? `${Math.max(progress * 100, 6)}%` : '0%',
                              }}
                            />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative z-20 flex min-h-[180px] items-center justify-center lg:min-h-[250px]">
              <div className="relative flex items-center justify-center drop-shadow-[0_28px_64px_rgba(0,0,0,0.55)]">
                {league.logo_url ? (
                  <img
                    src={league.logo_url}
                    alt={`${league.name} logo`}
                    className="h-28 w-28 object-contain lg:h-40 lg:w-40"
                  />
                ) : (
                  <span className="text-4xl font-black text-slate-950 lg:text-5xl">{league.name.charAt(0)}</span>
                )}
              </div>
            </div>
          )}

          {showInfoCard ? (
            <div className={`relative z-20 ${hasEditorialStage ? 'lg:self-center lg:-translate-y-6 xl:-translate-y-8' : ''}`}>
              <motion.div
                className="overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,rgba(8,15,27,0.78)_0%,rgba(8,15,27,0.9)_100%)] p-5 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.72)] backdrop-blur-xl md:p-6"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.12 }}
              >
                <div className="flex items-start gap-4">
                  {hasEditorialStage && (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-white/12 bg-black/18 p-3">
                      {league.logo_url ? (
                        <img src={league.logo_url} alt={`${league.name} logo`} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-xl font-black text-white">{league.name.charAt(0)}</span>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      {hasEditorialStage ? 'League Central' : 'League Hub'}
                    </p>
                    <h2 className="mt-2 text-3xl font-black leading-none tracking-tight text-white">
                      {league.name}
                    </h2>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-white/72">
                      <MapPin className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                      {locationLine}
                    </p>
                  </div>
                </div>

                <p className="mt-5 text-sm leading-6 text-white/76">{seasonNote}</p>

                {registrationSeason && (
                  <div className="mt-5 rounded-2xl border border-[var(--league-primary-border)] bg-[var(--league-primary-muted)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      Registration Open
                    </p>
                    <p className="mt-2 text-sm text-white/82">
                      {registrationSeason.name || 'Upcoming season'}
                      {registrationLabel ? ` closes ${registrationLabel}.` : ' is open now.'}
                    </p>
                  </div>
                )}

                <div className="mt-6 grid gap-3">
                  <Link
                    href={registrationSeason ? dockTertiaryCta : dockPrimaryCta}
                    className="inline-flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-950 transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <span className="inline-flex items-center gap-2">
                      {registrationSeason ? <UserPlus className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
                      {dockPrimaryLabel}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <div className="grid grid-cols-2 gap-3">
                    {secondaryActions.map((action) => (
                      <Link
                        key={action.label}
                        href={action.href}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white/6 px-4 py-3 text-sm font-semibold text-white/84 transition-colors duration-200 hover:border-white/28 hover:text-white"
                      >
                        {action.icon}
                        {action.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          ) : null}
          </div>
        </div>
      </section>
  );
}

export default HomepageStoryHero;
