import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adjustNewspaperZoom,
  buildNewspaperViewerHtml,
  calculateNewspaperFitScale,
  clampNewspaperZoom,
  getNewspaperViewerStyle,
  wrapNewspaperPages,
  NewspaperEditionViewer,
} from '../NewspaperEditionViewer';
import type { NewspaperEdition } from '../../../../../../packages/hockey-life-times/src/index';

describe('NewspaperEditionViewer sizing', () => {
  it('renders the independent article display title without mutating the frozen edition payload', () => {
    const fixturePath = path.resolve(__dirname, '../../../../../../packages/hockey-life-times/fixtures/validation-edition.json');
    const edition = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as NewspaperEdition;
    const before = JSON.stringify(edition);
    const displayTitle = 'HLT: Week 1 - Fall 2026';
    const html = renderToStaticMarkup(React.createElement(NewspaperEditionViewer, { edition, displayTitle }));

    expect(html).toContain(`<h1`);
    expect(html).toContain(displayTitle);
    expect(html).toContain(`aria-label="${displayTitle}"`);
    expect(html).toContain(`title="${displayTitle}"`);
    expect(html).toContain('Hockey Life Times · Issue');
    expect(JSON.stringify(edition)).toBe(before);
    expect(edition.title).toBe('Hockey Life Times');
  });

  it('passes the article title from the actual route without rewriting the edition', () => {
    const route = fs.readFileSync(
      path.resolve(__dirname, '../../../app/[leagueSlug]/news/[slug]/page.tsx'),
      'utf8',
    );
    expect(route).toMatch(/<NewspaperEditionViewer\s+edition=\{newspaperEdition\}\s+displayTitle=\{article\.title\}\s*\/>/);
    expect(route).not.toMatch(/newspaperEdition\.(?:title|lead\.headline)\s*=/);
  });

  it('fits the fixed-layout renderer to its iframe without forcing a desktop width', () => {
    const style = getNewspaperViewerStyle(null);

    expect(style).toContain('data-newspaper-viewer-fit');
    expect(style).toContain('min(1,calc((100vw - 24px) / 853px))');
    expect(style).toContain('transform:scale(var(--viewer-scale))');
    expect(style).toContain('height:calc(1280px * var(--viewer-scale))');
    expect(style).toContain('width:calc(853px * var(--viewer-scale))');
    expect(style).toContain('zoom:1!important');
    expect(style).not.toContain('min-width:909px');
    expect(calculateNewspaperFitScale(390)).toBeCloseTo(366 / 853);
    expect(calculateNewspaperFitScale(1440)).toBe(1);
    expect(calculateNewspaperFitScale(0)).toBe(1);
  });

  it('creates a scroll-accessible fixed-layout manual zoom override', () => {
    const style = getNewspaperViewerStyle(1.25);

    expect(style).toContain('--viewer-scale:1.25');
    expect(style).toContain('transform:scale(var(--viewer-scale))');
    expect(style).toContain('height:calc(1280px * var(--viewer-scale))');
    expect(style).toContain('zoom:1!important');
    expect(style).toContain('width:max-content');
    expect(style).not.toContain('min-width:909px');
  });

  it('adds physical wrappers without changing any page bytes or nested sections', () => {
    const first = '<section class="newspaper-page page-1"><main><section>Nested</section></main></section>';
    const second = '<section class="newspaper-page page-2"><main>Second</main></section>';
    const source = `<!doctype html><html><head></head><body><article class="newspaper-edition">${first}${second}</article></body></html>`;
    const wrapped = wrapNewspaperPages(source);

    expect(wrapped).toContain(`<div class="newspaper-page-wrap">${first}</div>`);
    expect(wrapped).toContain(`<div class="newspaper-page-wrap">${second}</div>`);
    expect(wrapped.match(/class="newspaper-page-wrap"/g)).toHaveLength(2);
  });

  it('builds an idempotent five-page viewer document from rendered production HTML', () => {
    const pages = Array.from({ length: 5 }, (_, index) =>
      `<section class="newspaper-page page-${index + 1}" data-newspaper-page="${index + 1}"><main>Page ${index + 1}</main></section>`,
    ).join('');
    const source = `<!doctype html><html><head></head><body><article class="newspaper-edition">${pages}</article></body></html>`;
    const fit = buildNewspaperViewerHtml(source, null);
    const zoom = buildNewspaperViewerHtml(fit, 0.75);

    expect(fit.match(/class="newspaper-page-wrap"/g)).toHaveLength(5);
    expect(zoom.match(/class="newspaper-page-wrap"/g)).toHaveLength(5);
    expect(zoom.match(/data-newspaper-viewer-zoom/g)).toHaveLength(1);
    expect(zoom).not.toContain('data-newspaper-viewer-fit');
  });

  it('clamps manual zoom while allowing useful phone zoom-out and zoom-in', () => {
    expect(clampNewspaperZoom(0)).toBe(0.1);
    expect(clampNewspaperZoom(1.25)).toBe(1.25);
    expect(clampNewspaperZoom(3)).toBe(2);
    expect(adjustNewspaperZoom(null, 0.4, 1)).toBe(0.65);
    expect(adjustNewspaperZoom(0.75, 0.55, 1)).toBe(1);
    expect(adjustNewspaperZoom(null, 0.38, -1)).toBeCloseTo(0.13);
    expect(adjustNewspaperZoom(0.75, 0.3, -1)).toBe(0.5);
  });
});
