import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleFormatEditor } from '@/components/news/ArticleFormatEditor';
import {
  reduceArticleDocument,
  serializeArticleEditorContent,
} from '@/lib/news/article-format-editor';
import {
  ARTICLE_DOCUMENT_PREFIX,
  MAX_ARTICLE_TEXT_LENGTH,
  MAX_ARTICLE_SECTIONS,
  createArticleDocumentFromContent,
  parseArticleDocument,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';

describe('ArticleFormatEditor', () => {
  it('supports adding, duplicating, moving, and removing bounded sections', () => {
    const initial = createArticleDocumentFromContent('First body');
    const added = reduceArticleDocument(initial, { type: 'add-section' });
    const duplicated = reduceArticleDocument(added, { type: 'duplicate-section', index: 0 });
    const moved = reduceArticleDocument(duplicated, { type: 'move-section', index: 2, direction: -1 });
    const removed = reduceArticleDocument(moved, { type: 'remove-section', index: 0 });

    expect(added.sections).toHaveLength(2);
    expect(duplicated.sections[1].body).toBe('First body');
    expect(new Set(duplicated.sections.map((section) => section.id)).size).toBe(3);
    expect(moved.sections[1].body).toBe('');
    expect(moved.sections[1].id).toBe(added.sections[1].id);
    expect(removed.sections).toHaveLength(2);

    const full = {
      ...initial,
      sections: Array.from({ length: MAX_ARTICLE_SECTIONS }, (_, index) => ({
        ...initial.sections[0],
        id: `section-${index + 1}`,
        body: `Section ${index + 1}`,
      })),
    };
    expect(reduceArticleDocument(full, { type: 'add-section' })).toBe(full);

    const nearTextLimit = createArticleDocumentFromContent(
      'x'.repeat(Math.floor(MAX_ARTICLE_TEXT_LENGTH / 2) + 1),
    );
    expect(
      reduceArticleDocument(nearTextLimit, { type: 'duplicate-section', index: 0 }),
    ).toBe(nearTextLimit);
  });

  it('renders accessible appearance, section, and live-preview controls for legacy content', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArticleFormatEditor, {
        value: 'Legacy body with [Wolves](/teams/wolves).',
        onChange: () => undefined,
      }),
    );

    expect(html).toContain('Article appearance');
    expect(html).toContain('Title treatment');
    expect(html).toContain('Headline font');
    expect(html).toContain('Section 1 heading');
    expect(html).toContain('Section 1 body');
    expect(html).toContain('Add section');
    expect(html).toContain('Live preview');
    expect(html).toContain('Legacy body with');
    expect(html).toContain('Wolves');
  });

  it('previews below-image titles outside the image and matches public display body typography', () => {
    const document = createArticleDocumentFromContent('Display body');
    document.appearance.titleLayout = 'below-image';
    document.sections[0].fontFamily = 'display';
    const html = renderToStaticMarkup(
      React.createElement(ArticleFormatEditor, {
        value: serializeArticleDocument(document),
        onChange: () => undefined,
        title: 'Below title preview',
      }),
    );

    expect(html).toMatch(
      /aria-label="Preview image area"[^>]*><\/div><div[^>]*><h4[^>]*>Below title preview/,
    );
    expect(html).toContain('font-sans font-medium tracking-wide text-left');
  });

  it('serializes AI and legacy editor values for the form payload', () => {
    const serialized = serializeArticleEditorContent('AI generated plain content.');
    const recovered = parseArticleDocument(serialized);
    const invalidEnvelope = `${ARTICLE_DOCUMENT_PREFIX}{bad json`;

    expect(recovered?.sections[0].body).toBe('AI generated plain content.');
    expect(serializeArticleEditorContent(invalidEnvelope)).toBe(invalidEnvelope);
    expect(serializeArticleEditorContent('   ')).toBeUndefined();
  });

  it('imports and serializes legacy articles larger than the former textarea limit', () => {
    const legacy = 'x'.repeat(100_001);
    const serialized = serializeArticleEditorContent(legacy);

    expect(parseArticleDocument(serialized)?.sections[0].body).toBe(legacy);
  });
});
