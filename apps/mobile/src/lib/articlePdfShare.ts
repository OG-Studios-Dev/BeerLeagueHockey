import { renderNewspaperHtml, type NewspaperEdition as PrintableNewspaperEdition } from '@hockey-life/hockey-life-times';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export interface OrdinaryArticlePdfInput {
  title: string;
  authorName?: string | null;
  publishedAt: string;
  content: string;
  canonicalUrl: string;
}

export type LoadedArticlePdfSource = {
  kind: 'newspaper';
  title: string;
  edition: PrintableNewspaperEdition;
} | {
  kind: 'article';
  article: OrdinaryArticlePdfInput;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function articleParagraphs(content: string) {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

const ARTICLE_CSS = 'html,body{margin:0;color:#171715;background:#fff;font-family:Georgia,"Times New Roman",serif}body{padding:48px}article{max-width:720px;margin:0 auto}header{border-top:5px double #171715;border-bottom:2px solid #171715;padding:18px 0}.kicker{margin:0 0 8px;color:#a4161a;font:700 11px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase}h1{margin:0;font:900 34px/1.05 Arial,sans-serif}.byline{margin:12px 0 0;color:#5b554b;font:700 11px Arial,sans-serif}main{padding:22px 0}main p{margin:0 0 14px;font-size:13px;line-height:1.55}footer{border-top:1px solid #746e62;padding-top:10px;font:10px Arial,sans-serif;overflow-wrap:anywhere}a{color:#171715}';

export function renderArticlePdfHtml(article: OrdinaryArticlePdfInput) {
  const author = article.authorName?.trim() || 'Hockey Life';
  const body = articleParagraphs(article.content);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.title)}</title><style>${ARTICLE_CSS}</style></head><body><article><header><p class="kicker">Hockey Life</p><h1>${escapeHtml(article.title)}</h1><p class="byline">By ${escapeHtml(author)} · ${escapeHtml(article.publishedAt)}</p></header><main>${body}</main><footer><a href="${escapeHtml(article.canonicalUrl)}">${escapeHtml(article.canonicalUrl)}</a></footer></article></body></html>`;
}

function safeDialogTitle(title: string) {
  const safeTitle = title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Hockey Life article';
  return `${safeTitle} — PDF`;
}

export async function shareLoadedArticlePdf(source: LoadedArticlePdfSource, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return 'superseded' as const;
  if (!(await Sharing.isAvailableAsync())) throw new Error('Native file sharing is unavailable.');
  if (!isCurrent()) return 'superseded' as const;

  const html = source.kind === 'newspaper' ? renderNewspaperHtml(source.edition) : renderArticlePdfHtml(source.article);
  const result = await Print.printToFileAsync({ html });
  if (!isCurrent()) return 'superseded' as const;
  if (source.kind === 'newspaper' && result.numberOfPages !== 5) throw new Error('The newspaper PDF must contain exactly five pages.');
  if (typeof result.uri !== 'string' || !result.uri.trim()) throw new Error('The PDF printer did not return a local file.');

  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: safeDialogTitle(source.kind === 'newspaper' ? source.title : source.article.title),
  });
  if (!isCurrent()) return 'superseded' as const;
  return 'shared' as const;
}
