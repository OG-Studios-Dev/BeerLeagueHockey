import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArticleHeroTitle } from '@/components/news/ArticleHeroTitle';
import {
  ARTICLE_DOCUMENT_PREFIX,
  createArticleDocumentFromContent,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';

describe('ArticleHeroTitle', () => {
  it('applies only validated title treatment and font metadata', () => {
    const document = createArticleDocumentFromContent('Body');
    document.appearance = {
      titleStyle: 'statement',
      titleLayout: 'below-image',
      titleFont: 'serif',
    };

    const html = renderToStaticMarkup(
      React.createElement(ArticleHeroTitle, {
        title: 'Championship night',
        content: serializeArticleDocument(document),
        tone: 'default',
      }),
    );

    expect(html).toContain('font-serif');
    expect(html).toContain('md:text-5xl');
    expect(html).toContain('text-[var(--color-text-primary)]');
  });

  it('uses the legacy default for malformed or unallowlisted metadata', () => {
    const injected = `${ARTICLE_DOCUMENT_PREFIX}${JSON.stringify({
      format: 'beer-league-hockey.news-article',
      version: 1,
      appearance: {
        titleStyle: 'fixed inset-0',
        titleLayout: 'overlay',
        titleFont: 'untrusted-font',
      },
      sections: [],
    })}`;

    const html = renderToStaticMarkup(
      React.createElement(ArticleHeroTitle, {
        title: 'Safe title',
        content: injected,
        tone: 'light',
      }),
    );

    expect(html).toContain('font-sans');
    expect(html).toContain('text-white');
    expect(html).not.toContain('fixed inset-0');
    expect(html).not.toContain('untrusted-font');
  });

  it('drives the public hero layout from validated article appearance metadata', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/[leagueSlug]/news/[slug]/page.tsx'),
      'utf8',
    );

    expect(page).toContain('resolveArticleAppearance(article.content)');
    expect(page).toContain("articleAppearance.titleLayout === 'overlay'");
    expect(page).toContain('<ArticleHeroTitle');
  });
});
