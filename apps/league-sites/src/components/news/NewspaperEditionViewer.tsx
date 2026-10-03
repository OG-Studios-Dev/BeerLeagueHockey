'use client';

import React from 'react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Share2 } from 'lucide-react';
import {
  renderNewspaperHtml,
  validateNewspaperEdition,
  type NewspaperEdition,
} from '../../../../../packages/hockey-life-times/src/index';

const NEWSPAPER_PAGE_WIDTH = 853;
const FIT_HORIZONTAL_PADDING = 24;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;
const VIEWER_STYLE_RE = /<style\s+data-newspaper-viewer-(?:fit|zoom)\b[^>]*>[\s\S]*?<\/style>/gi;

export function clampNewspaperZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function calculateNewspaperFitScale(viewportWidth: number) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  if (viewportWidth > 900) return 1;
  return Math.min(1, Math.max(0, viewportWidth - FIT_HORIZONTAL_PADDING) / NEWSPAPER_PAGE_WIDTH);
}

export function adjustNewspaperZoom(current: number | null, fitScale: number, direction: -1 | 1) {
  return clampNewspaperZoom((current ?? fitScale) + direction * ZOOM_STEP);
}

export function getNewspaperViewerStyle(manualZoom: number | null) {
  if (manualZoom === null) {
    return `<style data-newspaper-viewer-fit>
      body{padding:12px!important;overflow-x:hidden}
      .newspaper-edition{--viewer-scale:min(1,calc((100vw - 24px) / 853px));align-items:center!important;gap:calc(28px * var(--viewer-scale))!important}
      .newspaper-page-wrap{position:relative;flex:0 0 auto;width:calc(853px * var(--viewer-scale));height:calc(1280px * var(--viewer-scale));overflow:visible}
      .newspaper-page-wrap>.newspaper-page{zoom:1!important;transform:scale(var(--viewer-scale))!important;transform-origin:top left!important;margin:0!important}
    </style>`;
  }
  const scale = clampNewspaperZoom(manualZoom);
  return `<style data-newspaper-viewer-zoom>
    body{padding:12px!important}
    .newspaper-edition{--viewer-scale:${scale};align-items:flex-start!important;gap:calc(28px * var(--viewer-scale))!important;width:max-content;min-width:100%}
    .newspaper-page-wrap{position:relative;flex:0 0 auto;width:calc(853px * var(--viewer-scale));height:calc(1280px * var(--viewer-scale));overflow:visible}
    .newspaper-page-wrap>.newspaper-page{zoom:1!important;transform:scale(var(--viewer-scale))!important;transform-origin:top left!important;margin:0!important}
  </style>`;
}

export function wrapNewspaperPages(html: string) {
  if (html.includes('class="newspaper-page-wrap"')) return html;

  const pages: Array<{ start: number; end: number }> = [];
  const starts = /<section\b[^>]*class=["'][^"']*\bnewspaper-page\b[^"']*["'][^>]*>/gi;
  for (const match of html.matchAll(starts)) {
    let depth = 1;
    const sections = /<section\b[^>]*>|<\/section\s*>/gi;
    sections.lastIndex = (match.index ?? 0) + match[0].length;
    let token: RegExpExecArray | null;
    while ((token = sections.exec(html))) {
      depth += /^<section\b/i.test(token[0]) ? 1 : -1;
      if (depth === 0) {
        pages.push({ start: match.index ?? 0, end: sections.lastIndex });
        break;
      }
    }
  }

  return pages.reduceRight(
    (output, page) => `${output.slice(0, page.start)}<div class="newspaper-page-wrap">${output.slice(page.start, page.end)}</div>${output.slice(page.end)}`,
    html,
  );
}

export function buildNewspaperViewerHtml(renderedHtml: string, manualZoom: number | null) {
  const html = wrapNewspaperPages(renderedHtml.replace(VIEWER_STYLE_RE, ''));
  return html.replace('</head>', `${getNewspaperViewerStyle(manualZoom)}</head>`);
}

export type NewspaperShareOutcome = 'shared' | 'copied' | 'cancelled' | 'manual';

export interface NewspaperShareNavigator {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export function buildCanonicalArticleUrl(origin: string, articlePath: string) {
  const canonicalOrigin = new URL(origin).origin;
  const url = new URL(articlePath, canonicalOrigin);
  if (url.origin !== canonicalOrigin) {
    throw new Error('The newspaper article path must use the current origin.');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function isShareCancellation(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

export async function shareNewspaperArticle(
  shareNavigator: NewspaperShareNavigator,
  title: string,
  canonicalUrl: string,
): Promise<NewspaperShareOutcome> {
  if (typeof shareNavigator.share === 'function') {
    try {
      await shareNavigator.share({ title, url: canonicalUrl });
      return 'shared';
    } catch (error) {
      if (isShareCancellation(error)) return 'cancelled';
    }
  }

  if (typeof shareNavigator.clipboard?.writeText === 'function') {
    try {
      await shareNavigator.clipboard.writeText(canonicalUrl);
      return 'copied';
    } catch {
      // The selectable manual-copy state below is the honest final fallback.
    }
  }

  return 'manual';
}

type ShareState = 'idle' | 'sharing' | NewspaperShareOutcome;

export function NewspaperEditionViewer({
  edition,
  displayTitle,
  newsPath,
  articlePath,
}: {
  edition: NewspaperEdition;
  displayTitle: string;
  newsPath: string;
  articlePath: string;
}) {
  const [shareState, setShareState] = useState<ShareState>('idle');
  const [manualCopyUrl, setManualCopyUrl] = useState('');
  const shareInProgressRef = useRef(false);
  const manualCopyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (shareState !== 'manual') return;
    manualCopyRef.current?.focus();
    manualCopyRef.current?.select();
  }, [shareState]);

  const html = useMemo(() => {
    validateNewspaperEdition(edition);
    return buildNewspaperViewerHtml(renderNewspaperHtml(edition), null);
  }, [edition]);

  const shareLabel = shareState === 'sharing'
    ? 'Sharing…'
    : shareState === 'shared'
      ? 'Shared'
      : shareState === 'copied'
        ? 'Link copied'
        : 'Share';

  const shareFeedback = shareState === 'sharing'
    ? 'Opening share options.'
    : shareState === 'shared'
      ? 'Article shared.'
      : shareState === 'copied'
        ? 'Article link copied to the clipboard.'
        : shareState === 'manual'
          ? 'Automatic sharing is unavailable. Select and copy the article link manually.'
          : '';

  const handleShare = async () => {
    if (shareInProgressRef.current) return;
    shareInProgressRef.current = true;
    setShareState('sharing');
    setManualCopyUrl('');

    const canonicalUrl = buildCanonicalArticleUrl(window.location.origin, articlePath);
    const outcome = await shareNewspaperArticle(window.navigator, displayTitle, canonicalUrl);

    if (outcome === 'cancelled') {
      setShareState('idle');
    } else {
      if (outcome === 'manual') setManualCopyUrl(canonicalUrl);
      setShareState(outcome);
    }
    shareInProgressRef.current = false;
  };

  return (
    <section aria-label={displayTitle}>
      <h1 className="mb-4 text-2xl font-black tracking-tight text-[var(--color-text-primary)] sm:text-3xl">
        {displayTitle}
      </h1>
      <div className="sticky top-3 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-lg backdrop-blur">
        <div>
          <p className="text-sm font-black text-[var(--color-text-primary)]">{displayTitle}</p>
          <p className="text-sm font-black text-[var(--color-text-primary)]">Hockey Life Times · Issue {edition.issueNumber}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{edition.periodStart} to {edition.periodEnd} · Published edition</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Newspaper actions">
          <Link
            href={newsPath}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm font-bold text-[var(--color-text-primary)] transition-colors hover:border-[var(--league-primary)]/40 hover:text-[var(--league-primary)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to News
          </Link>
          <button
            type="button"
            onClick={handleShare}
            disabled={shareState === 'sharing'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--league-primary)] px-3 text-sm font-bold text-[var(--color-accent-text)] transition-opacity disabled:cursor-wait disabled:opacity-70"
          >
            {shareState === 'sharing' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : shareState === 'shared' || shareState === 'copied' ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Share2 className="h-4 w-4" aria-hidden="true" />
            )}
            {shareLabel}
          </button>
          <span className="sr-only" role="status" aria-live="polite">{shareFeedback}</span>
        </div>
      </div>
      {shareState === 'manual' ? (
        <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" role="alert">
          <label htmlFor="newspaper-manual-copy-url" className="mb-2 block text-sm font-bold text-[var(--color-text-primary)]">
            Select and copy this article link
          </label>
          <input
            ref={manualCopyRef}
            id="newspaper-manual-copy-url"
            type="text"
            readOnly
            value={manualCopyUrl}
            onClick={(event) => event.currentTarget.select()}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          />
        </div>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-neutral-800 p-2 sm:p-4">
        <iframe
          title={displayTitle}
          srcDoc={html}
          sandbox=""
          className="block h-[82vh] w-full border-0 bg-neutral-800"
        />
      </div>
    </section>
  );
}
