import Link from 'next/link';
import React from 'react';
import { Megaphone, ChevronRight } from 'lucide-react';
import { stripMarkdownLinks } from '@/lib/news/rich-text';

interface AnnouncementBannerProps {
  announcement: {
    id: string;
    title: string;
    excerpt: string | null;
    content: string;
    publishedAt: string;
    slug: string | null;
  };
  leagueSlug: string;
}

export function AnnouncementBanner({ announcement, leagueSlug }: AnnouncementBannerProps) {
  const displayText = stripMarkdownLinks(announcement.excerpt || announcement.content).slice(0, 200);
  const timeAgo = getTimeAgo(announcement.publishedAt);
  const href = announcement.slug
    ? `/${leagueSlug}/news/${announcement.slug}`
    : `/${leagueSlug}/news`;

  return (
    <Link href={href} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--league-primary-border)] bg-[var(--league-primary-muted)] px-5 py-4 transition-all hover:border-[var(--league-primary-strong)] hover:bg-[var(--league-primary-soft)]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--league-primary-soft)]">
            <Megaphone className="h-4.5 w-4.5 text-[var(--color-accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                Announcement
              </span>
              {timeAgo && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {timeAgo}
                </span>
              )}
            </div>
            <h3 className="font-bold text-[var(--color-text-primary)] transition-colors group-hover:text-[var(--color-accent)]">
              {announcement.title}
            </h3>
            {displayText && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-1 line-clamp-2">
                {displayText}
              </p>
            )}
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-accent)]" />
        </div>
      </div>
    </Link>
  );
}

function getTimeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
