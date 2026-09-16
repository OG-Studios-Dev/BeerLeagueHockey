import {
  isStructuredArticleContent,
  parseArticleDocument,
} from '@hockey-life/ui/news-article-format';

function extractArticleMarkup(text: string | null | undefined): string {
  const document = parseArticleDocument(text);
  if (document) {
    return document.sections
      .flatMap((section) => [section.heading, section.body])
      .filter((value) => value.trim().length > 0)
      .join('\n\n');
  }

  if (isStructuredArticleContent(text)) return '';
  return text || '';
}

export function normalizeRichText(text: string | null | undefined): string {
  return extractArticleMarkup(text)
    .replace(/\r\n/g, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*(\d+)\.\s+/gm, '$1. ');
}

export function stripMarkdownLinks(text: string | null | undefined): string {
  return normalizeRichText(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getArticleTextSnippet(
  text: string | null | undefined,
  maxLength: number,
): string {
  const plainText = stripMarkdownLinks(text);
  if (plainText.length <= maxLength) return plainText;
  if (maxLength <= 3) return '.'.repeat(Math.max(0, maxLength));

  const clipped = plainText.slice(0, maxLength - 3).trimEnd();
  const wordBoundary = clipped.lastIndexOf(' ');
  const end = wordBoundary >= Math.floor(maxLength / 2) ? wordBoundary : clipped.length;
  return `${clipped.slice(0, end).trimEnd()}...`;
}

export function splitRichTextParagraphs(text: string | null | undefined): string[] {
  return normalizeRichText(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}
