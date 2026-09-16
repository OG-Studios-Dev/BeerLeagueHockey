export const ARTICLE_DOCUMENT_PREFIX = 'BLH_RICH_ARTICLE:';
export const ARTICLE_DOCUMENT_VERSION = 1 as const;
export const MAX_ARTICLE_SECTIONS = 20;
export const MAX_ARTICLE_TEXT_LENGTH = 700_000;
export const MAX_SECTION_HEADING_LENGTH = 160;
export const MAX_SECTION_BODY_LENGTH = MAX_ARTICLE_TEXT_LENGTH;
export const MAX_SERIALIZED_CONTENT_LENGTH = 4_400_000;

export type ArticleTitleStyle = 'classic' | 'statement' | 'compact';
export type ArticleTitleLayout = 'overlay' | 'below-image';
export type ArticleFontFamily = 'sans' | 'serif' | 'display';
export type ArticleHeadingStyle = 'section' | 'subheading' | 'eyebrow';
export type ArticleTextAlign = 'left' | 'center';

export interface ArticleAppearance {
  titleStyle: ArticleTitleStyle;
  titleLayout: ArticleTitleLayout;
  titleFont: ArticleFontFamily;
}

export interface ArticleSection {
  id: string;
  heading: string;
  body: string;
  headingStyle: ArticleHeadingStyle;
  fontFamily: ArticleFontFamily;
  align: ArticleTextAlign;
}

export interface ArticleDocument {
  format: 'beer-league-hockey.news-article';
  version: typeof ARTICLE_DOCUMENT_VERSION;
  appearance: ArticleAppearance;
  sections: ArticleSection[];
}

const TITLE_STYLES: readonly ArticleTitleStyle[] = ['classic', 'statement', 'compact'];
const TITLE_LAYOUTS: readonly ArticleTitleLayout[] = ['overlay', 'below-image'];
const FONT_FAMILIES: readonly ArticleFontFamily[] = ['sans', 'serif', 'display'];
const HEADING_STYLES: readonly ArticleHeadingStyle[] = ['section', 'subheading', 'eyebrow'];
const TEXT_ALIGNS: readonly ArticleTextAlign[] = ['left', 'center'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isAllowedValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function isWithinSerializedContentLimit(value: unknown): boolean {
  try {
    return (
      ARTICLE_DOCUMENT_PREFIX.length + JSON.stringify(value).length <=
      MAX_SERIALIZED_CONTENT_LENGTH
    );
  } catch {
    return false;
  }
}

function isArticleAppearance(value: unknown): value is ArticleAppearance {
  if (!isRecord(value) || !hasOnlyKeys(value, ['titleStyle', 'titleLayout', 'titleFont'])) {
    return false;
  }

  return (
    isAllowedValue(value.titleStyle, TITLE_STYLES) &&
    isAllowedValue(value.titleLayout, TITLE_LAYOUTS) &&
    isAllowedValue(value.titleFont, FONT_FAMILIES)
  );
}

function isArticleSection(value: unknown): value is ArticleSection {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'heading', 'body', 'headingStyle', 'fontFamily', 'align'])
  ) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(value.id) &&
    typeof value.heading === 'string' &&
    value.heading.length <= MAX_SECTION_HEADING_LENGTH &&
    typeof value.body === 'string' &&
    value.body.length <= MAX_SECTION_BODY_LENGTH &&
    isAllowedValue(value.headingStyle, HEADING_STYLES) &&
    isAllowedValue(value.fontFamily, FONT_FAMILIES) &&
    isAllowedValue(value.align, TEXT_ALIGNS)
  );
}

export function isArticleDocument(value: unknown): value is ArticleDocument {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['format', 'version', 'appearance', 'sections']) ||
    value.format !== 'beer-league-hockey.news-article' ||
    value.version !== ARTICLE_DOCUMENT_VERSION ||
    !isArticleAppearance(value.appearance) ||
    !Array.isArray(value.sections) ||
    value.sections.length < 1 ||
    value.sections.length > MAX_ARTICLE_SECTIONS
  ) {
    return false;
  }

  if (!value.sections.every(isArticleSection)) return false;

  const textLength = value.sections.reduce(
    (total, section) => total + section.heading.length + section.body.length,
    0,
  );
  return (
    textLength <= MAX_ARTICLE_TEXT_LENGTH &&
    new Set(value.sections.map((section) => section.id)).size === value.sections.length &&
    isWithinSerializedContentLimit(value)
  );
}

function createDefaultArticleDocument(body: string): ArticleDocument {
  return {
    format: 'beer-league-hockey.news-article',
    version: ARTICLE_DOCUMENT_VERSION,
    appearance: {
      titleStyle: 'classic',
      titleLayout: 'overlay',
      titleFont: 'sans',
    },
    sections: [
      {
        id: 'section-1',
        heading: '',
        body,
        headingStyle: 'section',
        fontFamily: 'sans',
        align: 'left',
      },
    ],
  };
}

export function isStructuredArticleContent(content: string | null | undefined): boolean {
  return Boolean(content?.startsWith(ARTICLE_DOCUMENT_PREFIX));
}

export function parseArticleDocument(content: string | null | undefined): ArticleDocument | null {
  if (
    !isStructuredArticleContent(content) ||
    !content ||
    content.length > MAX_SERIALIZED_CONTENT_LENGTH
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(content.slice(ARTICLE_DOCUMENT_PREFIX.length));
    return isArticleDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createArticleDocumentFromContent(content: string | null | undefined): ArticleDocument {
  const parsed = parseArticleDocument(content);
  if (parsed) return parsed;

  return createDefaultArticleDocument(isStructuredArticleContent(content) ? '' : content || '');
}

export function resolveArticleAppearance(
  content: string | null | undefined,
): ArticleAppearance {
  return parseArticleDocument(content)?.appearance || createDefaultArticleDocument('').appearance;
}

export function validateArticleContentForStorage(
  content: string | null | undefined,
): boolean {
  if (!content) return true;
  if (!isStructuredArticleContent(content)) {
    return content.length <= MAX_ARTICLE_TEXT_LENGTH;
  }
  return (
    content.length <= MAX_SERIALIZED_CONTENT_LENGTH &&
    parseArticleDocument(content) !== null
  );
}

export function serializeArticleDocument(document: unknown): string {
  if (!isArticleDocument(document)) {
    throw new Error('Invalid article document');
  }

  const serialized = `${ARTICLE_DOCUMENT_PREFIX}${JSON.stringify(document)}`;
  if (serialized.length > MAX_SERIALIZED_CONTENT_LENGTH) {
    throw new Error('Invalid article document');
  }
  return serialized;
}

function markdownToPlainText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function articleContentToPlainText(content: string | null | undefined): string {
  const parsed = parseArticleDocument(content);
  if (parsed) {
    return parsed.sections
      .flatMap((section) => [section.heading.trim(), section.body.trim()])
      .filter(Boolean)
      .map(markdownToPlainText)
      .filter(Boolean)
      .join('\n\n');
  }

  if (isStructuredArticleContent(content)) return '';
  return markdownToPlainText(content || '');
}
