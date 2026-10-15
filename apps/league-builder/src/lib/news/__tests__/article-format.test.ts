import {
  ARTICLE_DOCUMENT_PREFIX,
  MAX_ARTICLE_SECTIONS,
  MAX_ARTICLE_TEXT_LENGTH,
  MAX_SECTION_BODY_LENGTH,
  articleContentToPlainText,
  createArticleDocumentFromContent,
  parseArticleDocument,
  serializeArticleDocument,
  validateArticleContentForStorage,
} from '@hockey-life/ui/news-article-format';

describe('news article format', () => {
  it('imports legacy content without changing its text and round-trips a versioned document', () => {
    const legacy = 'Opening paragraph with a [team link](/teams/wolves).\n\nSecond paragraph.';

    const document = createArticleDocumentFromContent(legacy);

    expect(document.sections).toEqual([
      expect.objectContaining({ heading: '', body: legacy }),
    ]);
    expect(parseArticleDocument(serializeArticleDocument(document))).toEqual(document);
  });

  it('rejects malformed, unknown-version, and unallowlisted structured content', () => {
    const valid = createArticleDocumentFromContent('Safe body');
    const unknownVersion = { ...valid, version: 2 };
    const injectedStyle = {
      ...valid,
      sections: [{ ...valid.sections[0], fontFamily: 'url(javascript:alert(1))' }],
    };

    expect(parseArticleDocument(`${ARTICLE_DOCUMENT_PREFIX}{bad json`)).toBeNull();
    expect(parseArticleDocument(`${ARTICLE_DOCUMENT_PREFIX}${JSON.stringify(unknownVersion)}`)).toBeNull();
    expect(parseArticleDocument(`${ARTICLE_DOCUMENT_PREFIX}${JSON.stringify(injectedStyle)}`)).toBeNull();
  });

  it('rejects structured documents beyond section and text bounds', () => {
    const valid = createArticleDocumentFromContent('Safe body');
    const tooManySections = {
      ...valid,
      sections: Array.from({ length: MAX_ARTICLE_SECTIONS + 1 }, (_, index) => ({
        ...valid.sections[0],
        id: `section-${index + 1}`,
      })),
    };
    const oversizedBody = {
      ...valid,
      sections: [{ ...valid.sections[0], body: 'x'.repeat(MAX_SECTION_BODY_LENGTH + 1) }],
    };

    expect(parseArticleDocument(`${ARTICLE_DOCUMENT_PREFIX}${JSON.stringify(tooManySections)}`)).toBeNull();
    expect(() => serializeArticleDocument(oversizedBody)).toThrow('Invalid article document');
  });

  it('serializes escape-heavy content at the total text bound and rejects text beyond it', () => {
    const valid = createArticleDocumentFromContent('Safe body');
    const bounded = {
      ...valid,
      sections: [{
        ...valid.sections[0],
        body: '\\'.repeat(MAX_ARTICLE_TEXT_LENGTH),
      }],
    };
    const overTotal = {
      ...valid,
      sections: [
        { ...valid.sections[0], body: 'x'.repeat(MAX_ARTICLE_TEXT_LENGTH) },
        { ...valid.sections[0], id: 'section-2', body: 'x' },
      ],
    };

    expect(() => serializeArticleDocument(bounded)).not.toThrow();
    expect(() => serializeArticleDocument(overTotal)).toThrow('Invalid article document');
  });

  it('extracts readable text for downstream suggestions and hides invalid envelopes', () => {
    const document = createArticleDocumentFromContent('The [Wolves](/teams/wolves) won.');
    document.sections[0].heading = 'Game report';
    const serialized = serializeArticleDocument(document);

    expect(articleContentToPlainText(serialized)).toBe('Game report\n\nThe Wolves won.');
    expect(articleContentToPlainText('Legacy [story](/news/story).')).toBe('Legacy story.');
    expect(articleContentToPlainText('<p>Legacy <strong>story</strong>.</p>')).toBe('Legacy story.');
    expect(articleContentToPlainText(`${ARTICLE_DOCUMENT_PREFIX}{bad json`)).toBe('');
  });

  it('accepts legacy and validated content for storage but rejects invalid envelopes', () => {
    const document = createArticleDocumentFromContent('Safe body');

    expect(validateArticleContentForStorage('Legacy body')).toBe(true);
    expect(validateArticleContentForStorage('x'.repeat(MAX_ARTICLE_TEXT_LENGTH))).toBe(true);
    expect(validateArticleContentForStorage('x'.repeat(MAX_ARTICLE_TEXT_LENGTH + 1))).toBe(false);
    expect(validateArticleContentForStorage(serializeArticleDocument(document))).toBe(true);
    expect(validateArticleContentForStorage(`${ARTICLE_DOCUMENT_PREFIX}{bad json`)).toBe(false);
  });
});
