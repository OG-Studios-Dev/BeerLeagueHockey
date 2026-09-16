import Link from 'next/link';
import { ArrowUpRight, Camera, Shield, Sparkles, TrendingUp } from 'lucide-react';
import type {
  GalleryAlbum,
  GoalieStats,
  LeagueAward,
  NewsArticle,
  PlayerStatsWithAvatar,
} from '@/lib/types';
import { getArticleTextSnippet } from '@/lib/news/rich-text';

interface LeagueAliveBandProps {
  leagueSlug: string;
  newsArticles: NewsArticle[];
  scoringLeaders: PlayerStatsWithAvatar[];
  goalieLeaders: GoalieStats[];
  albums: GalleryAlbum[];
  awards: LeagueAward[];
}

interface AliveImageCard {
  kind: 'image';
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  imageUrl: string | null;
}

interface AliveSpotlightCard {
  kind: 'spotlight';
  eyebrow: string;
  title: string;
  description: string;
  metric: string;
  href: string;
  cta: string;
  imageUrl: string | null;
  icon: 'trending' | 'shield' | 'sparkles';
}

type AliveCard = AliveImageCard | AliveSpotlightCard;

function getArticleEyebrow(type: string) {
  if (type === 'game_recap') return 'Latest Recap';
  if (type === 'weekly_wrap') return 'Weekly Wrap';
  return 'League Story';
}

function getIcon(card: AliveSpotlightCard) {
  if (card.icon === 'shield') return <Shield className="h-4 w-4" />;
  if (card.icon === 'trending') return <TrendingUp className="h-4 w-4" />;
  return <Sparkles className="h-4 w-4" />;
}

export function LeagueAliveBand({
  leagueSlug,
  newsArticles,
  scoringLeaders,
  goalieLeaders,
  albums,
  awards,
}: LeagueAliveBandProps) {
  const featuredStory = newsArticles.find((article) => article.image_url) || newsArticles[0] || null;
  const gallerySpotlight = albums.find((album) => album.cover_photo_url) || albums[0] || null;
  const awardSpotlight =
    awards.find((award) => award.player?.avatar_url || award.team?.logo_url || award.image_url) || awards[0] || null;

  const cards: AliveCard[] = [];

  if (featuredStory) {
    cards.push({
      kind: 'image',
      eyebrow: getArticleEyebrow(featuredStory.type),
      title: featuredStory.title,
      description: getArticleTextSnippet(featuredStory.excerpt || featuredStory.content, 180) || 'Fresh reporting, recaps, and league momentum right from the homepage.',
      href: `/${leagueSlug}/news/${featuredStory.slug || featuredStory.id}`,
      cta: 'Read Story',
      imageUrl: featuredStory.image_url,
    });
  } else if (gallerySpotlight) {
    cards.push({
      kind: 'image',
      eyebrow: 'Community Lens',
      title: gallerySpotlight.title,
      description:
        gallerySpotlight.description ||
        'Pull visual league energy above the fold with real photos instead of another plain utility block.',
      href: `/${leagueSlug}/gallery/${gallerySpotlight.id}`,
      cta: 'Open Album',
      imageUrl: gallerySpotlight.cover_photo_url,
    });
  }

  if (scoringLeaders[0]) {
    const player = scoringLeaders[0];
    cards.push({
      kind: 'spotlight',
      eyebrow: 'Top Performer',
      title: player.player_name,
      description: `${player.team_name} is driving the pace right now.`,
      metric: `${player.points} pts`,
      href: `/${leagueSlug}/players/${player.player_id}`,
      cta: 'View Player',
      imageUrl: player.avatar_url,
      icon: 'trending',
    });
  }

  if (goalieLeaders[0]) {
    const goalie = goalieLeaders[0];
    cards.push({
      kind: 'spotlight',
      eyebrow: 'Brick Wall',
      title: goalie.player_name,
      description: `${goalie.team_name || 'Goalie leader'} is anchoring games in net.`,
      metric: `${goalie.wins}W | ${goalie.save_percentage}% SV`,
      href: `/${leagueSlug}/players/${goalie.player_id}`,
      cta: 'Goalie Profile',
      imageUrl: goalie.avatar_url || null,
      icon: 'shield',
    });
  }

  if (gallerySpotlight) {
    cards.push({
      kind: 'image',
      eyebrow: 'Gallery Spotlight',
      title: gallerySpotlight.title,
      description:
        gallerySpotlight.description ||
        `${gallerySpotlight.photo_count || 0} photo${gallerySpotlight.photo_count === 1 ? '' : 's'} keeping the season visible between games.`,
      href: `/${leagueSlug}/gallery/${gallerySpotlight.id}`,
      cta: 'View Photos',
      imageUrl: gallerySpotlight.cover_photo_url,
    });
  } else if (awardSpotlight) {
    cards.push({
      kind: 'spotlight',
      eyebrow: 'Season Spotlight',
      title: awardSpotlight.award_name,
      description:
        awardSpotlight.player?.full_name ||
        awardSpotlight.team?.name ||
        awardSpotlight.description ||
        'Recognition deserves more presence on the homepage.',
      metric: awardSpotlight.category.replace(/_/g, ' ').toUpperCase(),
      href: `/${leagueSlug}/news`,
      cta: 'See More',
      imageUrl: awardSpotlight.player?.avatar_url || awardSpotlight.team?.logo_url || awardSpotlight.image_url,
      icon: 'sparkles',
    });
  }

  if (cards.length === 0) {
    return null;
  }

  const displayCards = cards.slice(0, 4);

  return (
    <section className="container mx-auto px-4 pt-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--league-primary)]">
            League Alive
          </p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--color-text-primary)]">
            Current people. Current stories. Current energy.
          </h2>
        </div>
        <Link
          href={`/${leagueSlug}/news`}
          className="hidden items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-primary)] transition-all duration-200 hover:border-[var(--league-primary)] hover:text-[var(--league-primary)] md:inline-flex"
        >
          Full Coverage
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {displayCards.map((card, index) => (
          <Link
            key={`${card.title}-${index}`}
            href={card.href}
            className={`group overflow-hidden rounded-3xl border border-[var(--color-border)] transition-all duration-300 hover:-translate-y-1 hover:border-[var(--league-primary)] ${
              index === 0 ? 'md:col-span-2' : ''
            }`}
          >
            {card.kind === 'image' ? (
              <div className="relative h-full min-h-[250px]">
                {card.imageUrl ? (
                  <img
                    src={card.imageUrl}
                    alt={card.title}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--league-primary)_28%,transparent),transparent_62%),linear-gradient(145deg,color-mix(in_srgb,var(--league-primary)_18%,transparent),var(--color-surface))]" />
                )}
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.52)_48%,rgba(0,0,0,0.88)_100%)]" />
                <div className="relative flex h-full flex-col justify-end p-6">
                  <div className="inline-flex w-fit items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    <Camera className="h-3.5 w-3.5" />
                    {card.eyebrow}
                  </div>
                  <h3 className="mt-4 text-2xl font-black leading-tight text-white">{card.title}</h3>
                  <p className="mt-2 max-w-xl text-sm text-white/75">{card.description}</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                    {card.cta}
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative flex h-full min-h-[250px] flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--league-primary)_22%,transparent),transparent_58%),linear-gradient(160deg,color-mix(in_srgb,var(--color-surface)_94%,transparent),color-mix(in_srgb,var(--league-primary)_14%,transparent))] p-5">
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--league-primary)]/12 blur-3xl" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--league-primary)]">
                      {getIcon(card)}
                      {card.eyebrow}
                    </div>
                    <span className="rounded-full bg-[var(--league-primary)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-text)]">
                      {card.metric}
                    </span>
                  </div>
                  <div className="mt-6 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-2xl font-black leading-tight text-[var(--color-text-primary)]">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{card.description}</p>
                    </div>
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/85">
                      {card.imageUrl ? (
                        <img
                          src={card.imageUrl}
                          alt={card.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[var(--league-primary)]/10 text-2xl font-black text-[var(--league-primary)]">
                          {card.title.charAt(0)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="relative mt-6 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--league-primary)]">
                  {card.cta}
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default LeagueAliveBand;
