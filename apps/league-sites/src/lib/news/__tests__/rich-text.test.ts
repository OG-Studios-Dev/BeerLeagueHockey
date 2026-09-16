import {
  ARTICLE_DOCUMENT_PREFIX,
  createArticleDocumentFromContent,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';
import {
  getArticleTextSnippet,
  splitRichTextParagraphs,
  stripMarkdownLinks,
} from '@/lib/news/rich-text';

describe('rich text helpers', () => {
  it('returns human-readable structured article text for metadata and snippets', () => {
    const document = createArticleDocumentFromContent('First [linked paragraph](/news/one).\n\nSecond paragraph.');
    document.sections[0].heading = 'Section heading';

    const content = serializeArticleDocument(document);

    expect(stripMarkdownLinks(content)).toBe('Section heading First linked paragraph. Second paragraph.');
    expect(splitRichTextParagraphs(content)).toEqual([
      'Section heading',
      'First [linked paragraph](/news/one).',
      'Second paragraph.',
    ]);
  });

  it('does not expose malformed structured payloads as snippet text', () => {
    expect(stripMarkdownLinks(`${ARTICLE_DOCUMENT_PREFIX}{bad json`)).toBe('');
    expect(splitRichTextParagraphs(`${ARTICLE_DOCUMENT_PREFIX}{bad json`)).toEqual([]);
  });

  it('removes legacy HTML and bounds snippet output', () => {
    const snippet = getArticleTextSnippet(
      '<p>Legacy <strong>story</strong> with more copy than fits.</p>',
      24,
    );

    expect(snippet).toBe('Legacy story with...');
    expect(snippet.length).toBeLessThanOrEqual(24);
    expect(snippet).not.toContain('<');
  });
});
