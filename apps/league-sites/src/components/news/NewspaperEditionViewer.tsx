'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
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

export function NewspaperEditionViewer({
  edition,
  displayTitle,
}: {
  edition: NewspaperEdition;
  displayTitle: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const updateFitScale = () => setFitScale(calculateNewspaperFitScale(iframe.clientWidth));
    updateFitScale();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(iframe);
    return () => observer.disconnect();
  }, []);

  const adjustZoom = useCallback((direction: -1 | 1) => {
    setManualZoom((current) => adjustNewspaperZoom(current, fitScale, direction));
  }, [fitScale]);

  const html = useMemo(() => {
    validateNewspaperEdition(edition);
    return buildNewspaperViewerHtml(renderNewspaperHtml(edition), manualZoom);
  }, [edition, manualZoom]);

  const displayedScale = manualZoom ?? fitScale;

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
        <div className="flex items-center gap-2" role="group" aria-label="Newspaper zoom controls">
          <button type="button" onClick={() => adjustZoom(-1)} disabled={manualZoom !== null && manualZoom <= MIN_ZOOM} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] p-2 disabled:opacity-50" aria-label="Zoom out"><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <output className="min-w-16 text-center text-xs font-bold" aria-live="polite">{manualZoom === null ? 'Fit · ' : ''}{Math.round(displayedScale * 100)}%</output>
          <button type="button" onClick={() => setManualZoom(null)} aria-pressed={manualZoom === null} className="min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-xs font-bold">Fit</button>
          <button type="button" onClick={() => adjustZoom(1)} disabled={manualZoom !== null && manualZoom >= MAX_ZOOM} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] p-2 disabled:opacity-50" aria-label="Zoom in"><Plus className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-neutral-800 p-2 sm:p-4">
        <iframe
          ref={iframeRef}
          title={displayTitle}
          srcDoc={html}
          sandbox=""
          className="block h-[82vh] w-full border-0 bg-neutral-800"
        />
      </div>
    </section>
  );
}
