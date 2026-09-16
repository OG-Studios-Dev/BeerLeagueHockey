import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { deriveSnippet } from '@/components/home/HomepageStoryHero';
import type { NewsArticle } from '@/lib/types';
import {
  createArticleDocumentFromContent,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';

function structuredContent() {
  const document = createArticleDocumentFromContent('The [Wolves](/teams/wolves) won the final.');
  document.sections[0].heading = 'Championship report';
  return serializeArticleDocument(document);
}

describe('structured article snippets', () => {
  it('uses readable article text in the homepage story hero', () => {
    const article: NewsArticle = {
      id: 'article-1',
      title: 'Final recap',
      content: structuredContent(),
      excerpt: null,
      image_url: null,
      slug: 'final-recap',
      author_id: null,
      published: true,
      published_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      type: 'news',
      league_id: 'league-1',
    };

    expect(deriveSnippet(article)).toBe('Championship report The Wolves won the final.');
  });

  it('uses readable article text in the announcement banner', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnnouncementBanner, {
        announcement: {
          id: 'article-1',
          title: 'Final recap',
          excerpt: null,
          content: structuredContent(),
          publishedAt: '2026-01-01T00:00:00Z',
          slug: 'final-recap',
        },
        leagueSlug: 'winter',
      }),
    );

    expect(html).toContain('Championship report The Wolves won the final.');
    expect(html).not.toContain('BLH_RICH_ARTICLE');
  });

  it('uses readable content fallbacks for metadata and homepage feature copy', () => {
    const articlePage = readFileSync(
      join(process.cwd(), 'src/app/[leagueSlug]/news/[slug]/page.tsx'),
      'utf8',
    );
    const aliveBand = readFileSync(
      join(process.cwd(), 'src/components/home/LeagueAliveBand.tsx'),
      'utf8',
    );

    expect(articlePage).toContain('getArticleTextSnippet(article.excerpt || article.content, 180)');
    expect(aliveBand).toContain('getArticleTextSnippet(featuredStory.excerpt || featuredStory.content, 180)');
  });
});
