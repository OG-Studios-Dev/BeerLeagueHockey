import type {
  ArticleAppearance,
  ArticleDocument,
  ArticleSection,
} from '@hockey-life/ui/news-article-format';
import {
  MAX_ARTICLE_SECTIONS,
  createArticleDocumentFromContent,
  isArticleDocument,
  isStructuredArticleContent,
  parseArticleDocument,
  serializeArticleDocument,
} from '@hockey-life/ui/news-article-format';

export type ArticleDocumentAction =
  | { type: 'update-appearance'; patch: Partial<ArticleAppearance> }
  | { type: 'update-section'; index: number; patch: Partial<ArticleSection> }
  | { type: 'add-section' }
  | { type: 'duplicate-section'; index: number }
  | { type: 'remove-section'; index: number }
  | { type: 'move-section'; index: number; direction: -1 | 1 };

const EMPTY_SECTION: Omit<ArticleSection, 'id'> = {
  heading: '',
  body: '',
  headingStyle: 'section',
  fontFamily: 'sans',
  align: 'left',
};

function createSection(document: ArticleDocument): ArticleSection {
  const existingIds = new Set(document.sections.map((section) => section.id));
  let sequence = document.sections.length + 1;
  while (existingIds.has(`section-${sequence}`)) sequence += 1;
  return { id: `section-${sequence}`, ...EMPTY_SECTION };
}

function keepIfValid(current: ArticleDocument, next: ArticleDocument): ArticleDocument {
  return isArticleDocument(next) ? next : current;
}

export function serializeArticleEditorContent(content: string): string | undefined {
  if (!content.trim()) return undefined;
  const parsed = parseArticleDocument(content);
  if (parsed) return serializeArticleDocument(parsed);
  if (isStructuredArticleContent(content)) return content;
  return serializeArticleDocument(createArticleDocumentFromContent(content));
}

export function reduceArticleDocument(
  document: ArticleDocument,
  action: ArticleDocumentAction,
): ArticleDocument {
  switch (action.type) {
    case 'update-appearance':
      return keepIfValid(document, {
        ...document,
        appearance: { ...document.appearance, ...action.patch },
      });
    case 'update-section':
      if (!document.sections[action.index]) return document;
      return keepIfValid(document, {
        ...document,
        sections: document.sections.map((section, index) =>
          index === action.index ? { ...section, ...action.patch } : section,
        ),
      });
    case 'add-section':
      if (document.sections.length >= MAX_ARTICLE_SECTIONS) return document;
      return keepIfValid(document, {
        ...document,
        sections: [...document.sections, createSection(document)],
      });
    case 'duplicate-section': {
      const section = document.sections[action.index];
      if (!section || document.sections.length >= MAX_ARTICLE_SECTIONS) return document;
      const sections = [...document.sections];
      sections.splice(action.index + 1, 0, {
        ...section,
        id: createSection(document).id,
      });
      return keepIfValid(document, { ...document, sections });
    }
    case 'remove-section':
      if (document.sections.length <= 1 || !document.sections[action.index]) return document;
      return keepIfValid(document, {
        ...document,
        sections: document.sections.filter((_, index) => index !== action.index),
      });
    case 'move-section': {
      const destination = action.index + action.direction;
      if (
        !document.sections[action.index] ||
        destination < 0 ||
        destination >= document.sections.length
      ) {
        return document;
      }
      const sections = [...document.sections];
      const [section] = sections.splice(action.index, 1);
      sections.splice(destination, 0, section);
      return keepIfValid(document, { ...document, sections });
    }
  }
}
