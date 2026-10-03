'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Image as ImageIcon,
  List,
  MapPin,
} from 'lucide-react';
import { Card } from '@/components/ui';
import {
  formatLeagueShortWeekdayDate,
  formatLeagueTime,
} from '@/lib/league-timezone';
import type { ScheduleGame } from '@/lib/types';

type WeeklyGamesView = 'cool' | 'compact';
type TeamResult = 'W' | 'L' | null;
type WeeklyGameTeam = ScheduleGame['home_team'] | undefined;

const COOL_HERO_IMAGE_MASK =
  [
    'radial-gradient(140% 132% at 50% 46%, rgba(0,0,0,1) 18%, rgba(0,0,0,0.98) 34%, rgba(0,0,0,0.92) 50%, rgba(0,0,0,0.72) 64%, rgba(0,0,0,0.44) 76%, rgba(0,0,0,0.18) 88%, transparent 100%)',
    'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.18) 6%, rgba(0,0,0,0.58) 18%, rgba(0,0,0,0.9) 32%, rgba(0,0,0,1) 46%, rgba(0,0,0,1) 68%, rgba(0,0,0,0.84) 82%, rgba(0,0,0,0.38) 92%, transparent 100%)',
    'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.24) 7%, rgba(0,0,0,0.68) 18%, rgba(0,0,0,0.98) 30%, rgba(0,0,0,1) 50%, rgba(0,0,0,0.98) 70%, rgba(0,0,0,0.68) 82%, rgba(0,0,0,0.24) 93%, transparent 100%)',
  ].join(',');

type BackgroundPreset = 'none' | 'weekly-games';

interface HomepageWeeklyGamesProps {
  games: ScheduleGame[];
  leagueSlug: string;
  timezone?: string | null;
  eyebrowLabel?: string;
  title?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  showViewToggle?: boolean;
  /** 'team' hides eyebrow, overlay badges, detail team names, status card, and dots */
  variant?: 'homepage' | 'team';
  hideTitle?: boolean;
  teamActions?: ReactNode;
  /** Which background image preset to render (default: 'weekly-games') */
  backgroundPreset?: BackgroundPreset;
}

interface TeamSideProps {
  team: WeeklyGameTeam;
  leagueSlug: string;
  align: 'left' | 'right';
  result: TeamResult;
}

function getGameWinner(game: ScheduleGame): 'home' | 'away' | 'tie' | null {
  if (game.status !== 'completed') {
    return null;
  }

  const homeScore = game.home_score ?? 0;
  const awayScore = game.away_score ?? 0;

  if (homeScore > awayScore) {
    return 'home';
  }

  if (awayScore > homeScore) {
    return 'away';
  }

  return 'tie';
}

function getStatusLabel(status: ScheduleGame['status']) {
  switch (status) {
    case 'completed':
      return 'Final';
    case 'in_progress':
      return 'Live';
    case 'pending_verification':
      return 'Awaiting Review';
    case 'postponed':
      return 'Postponed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Scheduled';
  }
}

function getTeamName(team: WeeklyGameTeam) {
  return team?.name || 'TBD';
}

function getTeamResult(
  game: ScheduleGame,
  side: 'home' | 'away',
): TeamResult {
  const winner = getGameWinner(game);

  if (!winner || winner === 'tie') {
    return null;
  }

  return winner === side ? 'W' : 'L';
}

function formatCenterDisplay(game: ScheduleGame, timezone?: string | null) {
  if (game.status === 'completed') {
    return {
      label: 'Final',
      primary: `${game.away_score ?? 0} - ${game.home_score ?? 0}`,
    };
  }

  if (game.status === 'in_progress') {
    return {
      label: 'Live',
      primary: `${game.away_score ?? 0} - ${game.home_score ?? 0}`,
    };
  }

  return {
    label: getStatusLabel(game.status),
    primary: formatLeagueTime(game.scheduled_at, timezone),
  };
}

function getGameHref(game: ScheduleGame, leagueSlug: string) {
  return `/${leagueSlug}/games/${game.id}`;
}

function getGameAriaLabel(game: ScheduleGame) {
  return `Open matchup details for ${getTeamName(game.away_team)} at ${getTeamName(game.home_team)}`;
}

function TeamLink({
  team,
  leagueSlug,
  className,
}: {
  team: WeeklyGameTeam;
  leagueSlug: string;
  className: string;
}) {
  const teamName = getTeamName(team);

  if (!team?.slug) {
    return <span className={className}>{teamName}</span>;
  }

  return (
    <Link href={`/${leagueSlug}/teams/${team.slug}`} className={className}>
      {teamName}
    </Link>
  );
}

function OutcomeBadge({
  result,
  size = 'lg',
}: {
  result: TeamResult;
  size?: 'sm' | 'lg';
}) {
  if (!result) {
    return null;
  }

  const isWin = result === 'W';
  const sizeClass =
    size === 'sm'
      ? 'text-[1.65rem] sm:text-[1.9rem]'
      : 'text-[2.6rem] sm:text-[3.5rem] md:text-[4.75rem]';

  return (
    <span
      className={`z-20 ${sizeClass} select-none font-black uppercase leading-none drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] ${
        isWin ? 'text-emerald-400' : 'text-red-500'
      }`}
      style={{
        WebkitTextStroke:
          size === 'sm'
            ? '1.5px rgba(255,255,255,0.95)'
            : '2.5px rgba(255,255,255,0.95)',
      }}
    >
      {result}
    </span>
  );
}

function CoolViewTeam({ team, leagueSlug, align, result }: TeamSideProps) {
  void leagueSlug;

  const sidePositionClass =
    align === 'left' ? 'items-start text-left' : 'items-end text-right';
  const badgePositionClass =
    align === 'left'
      ? 'right-[12%] top-[88%] -translate-y-1/2 sm:right-[11%] md:right-[10%]'
      : 'left-[12%] top-[88%] -translate-y-1/2 sm:left-[11%] md:left-[10%]';

  return (
    <div className={`relative flex min-w-0 flex-col ${sidePositionClass} gap-3`}>
      <div className="relative">
        <div className="relative flex h-[156px] w-[156px] items-center justify-center sm:h-[248px] sm:w-[248px] md:h-[360px] md:w-[360px]">
          <div className="relative h-[132px] w-[132px] sm:h-[208px] sm:w-[208px] md:h-[300px] md:w-[300px]">
            <Image
              src={team?.logo || '/blank_team.png'}
              alt={team?.name || 'TBD'}
              width={288}
              height={288}
              className="h-full w-full object-contain drop-shadow-[0_24px_36px_rgba(0,0,0,0.6)]"
            />
            <span className={`absolute ${badgePositionClass}`}>
              <OutcomeBadge result={result} />
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-full">
        <span className="block min-h-[5rem] overflow-hidden text-[1.85rem] font-black leading-[0.98] tracking-tight text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [text-shadow:0_10px_26px_rgba(0,0,0,0.92)] sm:min-h-[6.8rem] sm:text-[2.4rem] md:min-h-[8.6rem] md:text-4xl">
          {getTeamName(team)}
        </span>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/74 sm:text-[11px]">
          {align === 'left' ? 'Away' : 'Home'}
        </p>
      </div>
    </div>
  );
}

function CoolCardTeam({
  team,
  leagueSlug,
  align,
}: {
  team: WeeklyGameTeam;
  leagueSlug: string;
  align: 'left' | 'right';
}) {
  return (
    <div className={align === 'left' ? 'text-left' : 'text-right'}>
      <TeamLink
        team={team}
        leagueSlug={leagueSlug}
        className="block text-balance text-base font-black tracking-tight text-[var(--color-text-primary)] transition-colors duration-200 hover:text-[var(--league-primary)] sm:text-lg"
      />
    </div>
  );
}

function CompactTeam({
  team,
  leagueSlug,
  align,
  result,
}: TeamSideProps) {
  const wrapperClass =
    align === 'left'
      ? 'items-start text-left'
      : 'flex-row-reverse items-end text-right';
  const badgePositionClass =
    align === 'left' ? 'bottom-0 right-0' : 'bottom-0 left-0';

  return (
    <div className={`relative flex ${wrapperClass} gap-3`}>
      <div className="relative shrink-0">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-background-elevated)]/72 shadow-[0_18px_32px_-24px_rgba(0,0,0,0.8)]">
          <Image
            src={team?.logo || '/blank_team.png'}
            alt={team?.name || 'TBD'}
            width={56}
            height={56}
            className="h-11 w-11 object-contain"
          />
        </div>
        <span className={`absolute ${badgePositionClass}`}>
          <OutcomeBadge result={result} size="sm" />
        </span>
      </div>
      <div className="min-w-0">
        <TeamLink
          team={team}
          leagueSlug={leagueSlug}
          className="block text-sm font-bold text-[var(--color-text-primary)] transition-colors duration-200 hover:text-[var(--league-primary)] sm:text-base"
        />
      </div>
    </div>
  );
}

function CoolView({
  games,
  activeIndex,
  onNavigate,
  leagueSlug,
  timezone,
  minimal = false,
  blendToPage = false,
  teamActions,
  backgroundPreset = 'weekly-games',
}: {
  games: ScheduleGame[];
  activeIndex: number;
  onNavigate: (direction: number) => void;
  leagueSlug: string;
  timezone?: string | null;
  minimal?: boolean;
  blendToPage?: boolean;
  teamActions?: ReactNode;
  backgroundPreset?: BackgroundPreset;
}) {
  const game = games[activeIndex];
  const hasControls = games.length > 1;
  const heroHref = getGameHref(game, leagueSlug);
  const heroEdgeColor = blendToPage ? 'var(--color-background)' : 'var(--color-surface)';
  const heroTopGlow = `radial-gradient(circle at top left, color-mix(in srgb, var(--league-primary) 14%, transparent), transparent 46%), linear-gradient(180deg, color-mix(in srgb, ${heroEdgeColor} 44%, transparent) 0%, color-mix(in srgb, ${heroEdgeColor} 12%, transparent) 34%, color-mix(in srgb, ${heroEdgeColor} 70%, transparent) 74%, ${heroEdgeColor} 100%)`;
  const heroCenterFade = `radial-gradient(circle at 50% 42%, transparent 0%, transparent 28%, color-mix(in srgb, ${heroEdgeColor} 18%, transparent) 52%, color-mix(in srgb, ${heroEdgeColor} 62%, transparent) 76%, ${heroEdgeColor} 100%)`;
  const heroBottomFade = `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${heroEdgeColor} 34%, transparent) 24%, color-mix(in srgb, ${heroEdgeColor} 72%, transparent) 54%, ${heroEdgeColor} 100%)`;
  const heroLeftFade = `linear-gradient(90deg, ${heroEdgeColor} 0%, color-mix(in srgb, ${heroEdgeColor} 72%, transparent) 42%, transparent 100%)`;
  const heroRightFade = `linear-gradient(270deg, ${heroEdgeColor} 0%, color-mix(in srgb, ${heroEdgeColor} 72%, transparent) 42%, transparent 100%)`;
  const heroTopFade = `linear-gradient(180deg, ${heroEdgeColor} 0%, color-mix(in srgb, ${heroEdgeColor} 68%, transparent) 42%, transparent 100%)`;

  const renderHeroSlide = (slideGame: ScheduleGame) => (
    <div className="pointer-events-none col-start-1 row-start-1">
      <div className="grid min-h-[310px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-3 px-4 pb-24 pt-14 sm:min-h-[420px] sm:gap-4 sm:px-7 sm:pb-28 md:px-10 lg:min-h-[520px] lg:pb-36">
        <CoolViewTeam
          team={slideGame.away_team}
          leagueSlug={leagueSlug}
          align="left"
          result={getTeamResult(slideGame, 'away')}
        />
        <CoolViewTeam
          team={slideGame.home_team}
          leagueSlug={leagueSlug}
          align="right"
          result={getTeamResult(slideGame, 'home')}
        />
      </div>
    </div>
  );

  const renderDetailsSlide = (slideGame: ScheduleGame) => {
    const centerDisplay = formatCenterDisplay(slideGame, timezone);

    return (
      <div className="col-start-1 row-start-1">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-[var(--league-primary)]" />
            {formatLeagueShortWeekdayDate(slideGame.scheduled_at, timezone)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5 text-[var(--league-primary)]" />
            {formatLeagueTime(slideGame.scheduled_at, timezone)}
          </span>
          {slideGame.venue && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[var(--league-primary)]" />
              {slideGame.venue}
            </span>
          )}
        </div>

        {!minimal && (
          <div className="mt-4 flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <CoolCardTeam
              team={slideGame.away_team}
              leagueSlug={leagueSlug}
              align="left"
            />
            <div
              className="rounded-[18px] border border-white/10 px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--color-background-elevated) 76%, transparent)',
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                {centerDisplay.label}
              </p>
              <p className="mt-1 text-xl font-black tracking-tight text-[var(--color-text-primary)] sm:text-2xl">
                {centerDisplay.primary}
              </p>
            </div>
            <CoolCardTeam
              team={slideGame.home_team}
              leagueSlug={leagueSlug}
              align="right"
            />
          </div>
        )}

        {minimal && teamActions ? <div className="mt-3">{teamActions}</div> : null}
      </div>
    );
  };

  return (
    <div className="mt-6 animate-fade-in">
      <div className="relative">
        <div
          className={`relative overflow-hidden ${
            blendToPage
              ? ''
              : 'rounded-[30px] bg-[var(--color-surface)] shadow-[0_34px_80px_-46px_rgba(0,0,0,0.88)]'
          }`}
        >
          <div
            className="relative"
            style={
              blendToPage
                ? {
                    WebkitMaskImage: COOL_HERO_IMAGE_MASK,
                    maskImage: COOL_HERO_IMAGE_MASK,
                  }
                : undefined
            }
          >
            <div className="absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: heroTopGlow,
                }}
              />
              {backgroundPreset === 'weekly-games' && (
                <div
                  className="absolute inset-0 scale-[1.05] bg-cover bg-center opacity-95"
                  style={{
                    backgroundImage: "url('/homepage/weekly-games-bg.jpg')",
                    ...(blendToPage
                      ? {}
                      : {
                          WebkitMaskImage: COOL_HERO_IMAGE_MASK,
                          maskImage: COOL_HERO_IMAGE_MASK,
                        }),
                  }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 w-20 sm:w-24"
                style={{ backgroundImage: heroLeftFade }}
              />
              <div
                className="absolute inset-y-0 right-0 w-20 sm:w-24"
                style={{ backgroundImage: heroRightFade }}
              />
              <div
                className="absolute inset-x-0 top-0 h-20 sm:h-24"
                style={{ backgroundImage: heroTopFade }}
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: heroCenterFade,
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-56 sm:h-64"
                style={{
                  backgroundImage: heroBottomFade,
                }}
              />
            </div>

            <div className="relative z-20 grid">
              {renderHeroSlide(game)}
            </div>
          </div>

          <Link
            href={heroHref}
            aria-label={getGameAriaLabel(game)}
            className={`absolute inset-0 z-10 block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--league-primary)] focus-visible:ring-offset-4 ${
              blendToPage
                ? 'focus-visible:ring-offset-[var(--color-background)]'
                : 'focus-visible:ring-offset-[var(--color-surface)]'
            }`}
          >
            <span className="sr-only">{getGameAriaLabel(game)}</span>
          </Link>

          {!minimal && (
            <>
              <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-full border border-white/16 bg-black/38 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                {activeIndex + 1} / {games.length}
              </div>
              <div className="pointer-events-none absolute right-4 top-4 z-30 rounded-full border border-white/16 bg-black/38 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                {getStatusLabel(game.status)}
              </div>
            </>
          )}

          {hasControls && (
            <>
              <button
                type="button"
                aria-label="Previous game"
                onClick={() => onNavigate(-1)}
                className="absolute -left-2 top-[38%] z-30 flex -translate-y-1/2 items-center justify-center text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] transition-opacity duration-200 hover:opacity-80 sm:-left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="Next game"
                onClick={() => onNavigate(1)}
                className="absolute -right-2 top-[38%] z-30 flex -translate-y-1/2 items-center justify-center text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] transition-opacity duration-200 hover:opacity-80 sm:-right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>

        <div
          className={`relative z-30 px-3 sm:px-6 ${minimal ? '-mt-10 lg:-mt-14' : '-mt-20 sm:-mt-24 lg:-mt-28'}`}
          style={{
            filter: minimal ? 'none' : 'drop-shadow(0 28px 56px rgba(0,0,0,0.38))',
          }}
        >
          <div
            className="mx-auto max-w-2xl overflow-hidden rounded-[26px] border p-3 sm:p-4"
            style={{
              backgroundColor:
                'color-mix(in srgb, var(--league-secondary) 18%, rgba(255,255,255,0.12))',
              backgroundImage:
                'linear-gradient(180deg, color-mix(in srgb, var(--league-secondary) 24%, rgba(255,255,255,0.26)) 0%, color-mix(in srgb, var(--color-background-elevated) 86%, transparent) 100%)',
              borderColor:
                'color-mix(in srgb, var(--league-primary) 12%, color-mix(in srgb, var(--league-secondary) 18%, rgba(255,255,255,0.18)))',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.16), 0 30px 70px -48px rgba(0,0,0,0.95)',
              backdropFilter: 'blur(24px)',
            }}
          >
            <div className="grid">
              {renderDetailsSlide(game)}
            </div>

            {!minimal && <div className="mt-4 flex items-center justify-center gap-2">
              {games.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Show game ${index + 1}`}
                  aria-pressed={index === activeIndex}
                  onClick={() => onNavigate(index - activeIndex)}
                  className={`h-2.5 rounded-full transition-all duration-200 ${
                    index === activeIndex
                      ? 'w-7 bg-[var(--league-primary)]'
                      : 'w-2.5 bg-[var(--color-border)] hover:bg-[var(--color-text-muted)]'
                  }`}
                />
              ))}
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactView({
  games,
  leagueSlug,
  timezone,
}: {
  games: ScheduleGame[];
  leagueSlug: string;
  timezone?: string | null;
}) {
  return (
    <div className="mt-6 grid gap-3">
      {games.map((game) => {
        const centerDisplay = formatCenterDisplay(game, timezone);

        return (
          <article
            key={game.id}
            className="relative overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-background-elevated)_94%,transparent),color-mix(in_srgb,var(--color-surface)_92%,transparent))] p-4 shadow-[0_26px_60px_-42px_rgba(0,0,0,0.82)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--league-primary-soft,rgba(192,192,192,0.16)),transparent_58%)]" />
            <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <CompactTeam
                team={game.away_team}
                leagueSlug={leagueSlug}
                align="left"
                result={getTeamResult(game, 'away')}
              />

              <div className="min-w-[96px] text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  {centerDisplay.label}
                </p>
                <p className="mt-1 text-lg font-black tracking-tight text-[var(--color-text-primary)] sm:text-xl">
                  {centerDisplay.primary}
                </p>
                <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                  {formatLeagueShortWeekdayDate(game.scheduled_at, timezone)}
                </p>
              </div>

              <CompactTeam
                team={game.home_team}
                leagueSlug={leagueSlug}
                align="right"
                result={getTeamResult(game, 'home')}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
              <span>{formatLeagueTime(game.scheduled_at, timezone)}</span>
              {game.venue && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-[var(--league-primary)]" />
                  {game.venue}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function HomepageWeeklyGames({
  games,
  leagueSlug,
  timezone,
  eyebrowLabel = 'This Week',
  title = "This Week\u2019s Games",
  emptyTitle = 'No games scheduled this week',
  emptyDescription = 'Check the full schedule for the next slate and recent scores.',
  showViewToggle = true,
  variant = 'homepage',
  hideTitle = false,
  teamActions,
  backgroundPreset = 'weekly-games',
}: HomepageWeeklyGamesProps) {
  const isTeamVariant = variant === 'team';
  const shouldBlendHeroToPage = isTeamVariant || variant === 'homepage';
  const [view, setView] = useState<WeeklyGamesView>('cool');
  const [activeIndex, setActiveIndex] = useState(0);
  const isCompactView = view === 'compact';
  const safeIndex = games.length === 0 ? 0 : activeIndex % games.length;

  const handleNavigate = (direction: number) => {
    if (games.length === 0 || direction === 0) {
      return;
    }

    const nextIndex = (safeIndex + direction) % games.length;
    setActiveIndex(nextIndex >= 0 ? nextIndex : games.length + nextIndex);
  };

  return (
    <div>
      {(!hideTitle || showViewToggle) ? (
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            {!hideTitle && !isTeamVariant && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--league-primary)]">
                <Calendar className="h-3.5 w-3.5" />
                {eyebrowLabel}
                <span className="text-[var(--color-text-muted)]">•</span>
                {games.length} {games.length === 1 ? 'game' : 'games'}
              </div>
            )}
            {!hideTitle ? (
              <h2 className={`${isTeamVariant ? '' : 'mt-3 '}flex items-center gap-2 text-2xl font-black tracking-tight text-[var(--color-text-primary)]`}>
                {isTeamVariant && <Calendar className="h-5 w-5 text-[var(--league-primary)]" />}
                {title}
              </h2>
            ) : null}
          </div>

          {showViewToggle ? (
          <button
            type="button"
            aria-label={isCompactView ? 'Switch to cool view' : 'Switch to compact view'}
            aria-pressed={isCompactView}
            onClick={() => setView((current) => (current === 'cool' ? 'compact' : 'cool'))}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/82 text-[var(--league-primary)] shadow-[0_16px_40px_-28px_rgba(0,0,0,0.7)] transition-colors duration-200 hover:border-[var(--league-primary)] hover:text-[var(--color-text-primary)]"
            title={isCompactView ? 'Switch to cool view' : 'Switch to compact view'}
          >
            {isCompactView ? <ImageIcon className="h-5 w-5" /> : <List className="h-5 w-5" />}
          </button>
          ) : null}
        </div>
      ) : null}

      {games.length > 0 ? (
        view === 'cool' ? (
          <CoolView
            games={games}
            activeIndex={safeIndex}
            onNavigate={handleNavigate}
            leagueSlug={leagueSlug}
            timezone={timezone}
            minimal={isTeamVariant}
            blendToPage={shouldBlendHeroToPage}
            teamActions={teamActions}
            backgroundPreset={backgroundPreset}
          />
        ) : (
          <CompactView games={games} leagueSlug={leagueSlug} timezone={timezone} />
        )
      ) : (
        <Card variant="glass" padding="lg" hover={false} className="mt-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--league-primary)]/12 text-[var(--league-primary)]">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">
                {emptyTitle}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {emptyDescription}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
