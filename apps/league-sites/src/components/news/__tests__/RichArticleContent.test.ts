import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichArticleContent } from '@/components/news/RichArticleContent';
import {
  ARTICLE_DOCUMENT_PREFIX,
  createArticleDocumentFromContent,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';

describe('RichArticleContent', () => {
  it('keeps legacy paragraph and inline-link rendering backward compatible', () => {
    const html = renderToStaticMarkup(
      React.createElement(RichArticleContent, {
        content: 'Opening with [schedule](/winter/schedule).\n\nSecond paragraph.',
      }),
    );

    expect(html).not.toContain('<section');
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('href="/winter/schedule"');
    expect(html).toContain('Second paragraph.');
  });

  it('renders validated sections with semantic headings, paragraph spacing, links, and mentions', () => {
    const document = createArticleDocumentFromContent('Opening paragraph.\n\nThe Wolves advance.');
    document.sections[0] = {
      ...document.sections[0],
      heading: 'Playoff update',
      headingStyle: 'eyebrow',
      fontFamily: 'serif',
      align: 'center',
    };
    document.sections.push({
      id: 'section-2',
      heading: 'What comes next',
      body: 'See the [schedule](/winter/schedule).',
      headingStyle: 'section',
      fontFamily: 'sans',
      align: 'left',
    });

    const html = renderToStaticMarkup(
      React.createElement(RichArticleContent, {
        content: serializeArticleDocument(document),
        mentions: [
          { text: 'Wolves', href: '/winter/teams/wolves', kind: 'team', priority: 3 },
        ],
      }),
    );

    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(html).toContain('Playoff update');
    expect(html).toContain('font-serif');
    expect(html).toContain('text-center');
    expect(html).toContain('href="/winter/teams/wolves"');
    expect(html).toContain('href="/winter/schedule"');
  });

  it('applies the paragraph limit across structured sections', () => {
    const document = createArticleDocumentFromContent('First paragraph.\n\nSecond paragraph.');
    document.sections.push({
      id: 'section-2',
      heading: 'Later section',
      body: 'Third paragraph.',
      headingStyle: 'section',
      fontFamily: 'sans',
      align: 'left',
    });

    const html = renderToStaticMarkup(
      React.createElement(RichArticleContent, {
        content: serializeArticleDocument(document),
        maxParagraphs: 2,
      }),
    );

    expect(html).toContain('First paragraph.');
    expect(html).toContain('Second paragraph.');
    expect(html).not.toContain('Third paragraph.');
  });

  it('falls back safely for malformed structured content and unsafe markdown URLs', () => {
    const invalidHtml = renderToStaticMarkup(
      React.createElement(RichArticleContent, {
        content: `${ARTICLE_DOCUMENT_PREFIX}{bad json`,
      }),
    );
    const unsafeDocument = createArticleDocumentFromContent(
      '[Relative](schedule) [Parent](../news) [Backslash](/\\\\evil.example/path) [Do not run](javascript:alert(1))',
    );
    const unsafeHtml = renderToStaticMarkup(
      React.createElement(RichArticleContent, {
        content: serializeArticleDocument(unsafeDocument),
      }),
    );

    expect(invalidHtml).toContain('No content available.');
    expect(invalidHtml).not.toContain(ARTICLE_DOCUMENT_PREFIX);
    expect(unsafeHtml).toContain('href="schedule"');
    expect(unsafeHtml).toContain('href="../news"');
    expect(unsafeHtml).toContain('Backslash');
    expect(unsafeHtml).not.toContain('evil.example');
    expect(unsafeHtml).toContain('Do not run');
    expect(unsafeHtml).not.toContain('javascript:');
  });
});
