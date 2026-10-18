/* eslint-disable @typescript-eslint/no-explicit-any -- focused native adapter contract */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

function loadModule(overrides: Record<string, unknown> = {}) {
  return compileCommonJs<any>(new URL('../../src/lib/articlePdfShare.ts', import.meta.url), {
    '@hockey-life/hockey-life-times': { renderNewspaperHtml: () => '<html>newspaper</html>' },
    'expo-print': { printToFileAsync: async () => ({ uri: 'file:///edition.pdf', numberOfPages: 5 }) },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => undefined },
    ...overrides,
  });
}

describe('article PDF sharing', () => {
  it('renders deterministic ordinary-article HTML with hostile text fully escaped', () => {
    const pdf = loadModule();
    const article = {
      title: 'Week <Final> & "Quotes"',
      authorName: `O'Connor </title><script>alert("x")</script>`,
      publishedAt: '2026-10-17T12:34:56.000Z',
      content: `First & foremost.\r\nSecond <line>.\r\n\r\n</style><script>globalThis.pwned=true</script> ' "`,
      canonicalUrl: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/week-final?a=1&b=2',
    };
    const first = pdf.renderArticlePdfHtml(article);
    const second = pdf.renderArticlePdfHtml({ ...article });

    assert.equal(first, second);
    assert.match(first, /^<!doctype html><html lang="en">/);
    assert.match(first, /Week &lt;Final&gt; &amp; &quot;Quotes&quot;/);
    assert.match(first, /O&#39;Connor &lt;\/title&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.match(first, /First &amp; foremost\.<br>Second &lt;line&gt;\./);
    assert.match(first, /&lt;\/style&gt;&lt;script&gt;globalThis\.pwned=true&lt;\/script&gt; &#39; &quot;/);
    assert.match(first, /week-final\?a=1&amp;b=2/);
    assert.doesNotMatch(first, /<script>|<\/style><script>|globalThis\.pwned=true<\/script>/);
  });

  it('renders a loaded newspaper, requires five generated pages, and shares the local PDF with native PDF metadata', async () => {
    const edition = { title: 'Hockey Life Times', issueNumber: 45 };
    const rendered: unknown[] = [];
    const printCalls: unknown[] = [];
    const shareCalls: unknown[] = [];
    const pdf = loadModule({
      '@hockey-life/hockey-life-times': { renderNewspaperHtml(value: unknown) { rendered.push(value); return '<html>five-page-edition</html>'; } },
      'expo-print': { async printToFileAsync(options: unknown) { printCalls.push(options); return { uri: 'file:///cache/hockey-life-times.pdf', numberOfPages: 5 }; } },
      'expo-sharing': { async isAvailableAsync() { return true; }, async shareAsync(uri: string, options: unknown) { shareCalls.push({ uri, options }); } },
    });

    const result = await pdf.shareLoadedArticlePdf({ kind: 'newspaper', title: 'Hockey Life Times: Issue 45', edition }, () => true);

    assert.equal(result, 'shared');
    assert.deepEqual(rendered, [edition]);
    assert.deepEqual(printCalls, [{ html: '<html>five-page-edition</html>' }]);
    assert.deepEqual(shareCalls, [{
      uri: 'file:///cache/hockey-life-times.pdf',
      options: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Hockey Life Times: Issue 45 — PDF' },
    }]);
  });

  it('prints and shares an ordinary loaded article without enforcing the newspaper page count', async () => {
    const printCalls: Array<{ html: string }> = [];
    const shareCalls: unknown[] = [];
    const pdf = loadModule({
      'expo-print': { async printToFileAsync(options: { html: string }) { printCalls.push(options); return { uri: 'file:///cache/article.pdf', numberOfPages: 2 }; } },
      'expo-sharing': { async isAvailableAsync() { return true; }, async shareAsync(uri: string, options: unknown) { shareCalls.push({ uri, options }); } },
    });
    const article = {
      title: 'Ordinary article', authorName: 'Hockey Life', publishedAt: '2026-10-17', content: 'Complete body.', canonicalUrl: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/ordinary',
    };

    const result = await pdf.shareLoadedArticlePdf({ kind: 'article', article }, () => true);

    assert.equal(result, 'shared');
    assert.equal(printCalls.length, 1);
    assert.equal(printCalls[0]!.html, pdf.renderArticlePdfHtml(article));
    assert.deepEqual(shareCalls, [{
      uri: 'file:///cache/article.pdf',
      options: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Ordinary article — PDF' },
    }]);
  });

  it('rejects a newspaper print result unless it contains exactly five pages', async () => {
    const shareCalls: unknown[] = [];
    const pdf = loadModule({
      'expo-print': { async printToFileAsync() { return { uri: 'file:///cache/wrong.pdf', numberOfPages: 4 }; } },
      'expo-sharing': { async isAvailableAsync() { return true; }, async shareAsync(...args: unknown[]) { shareCalls.push(args); } },
    });

    await assert.rejects(
      pdf.shareLoadedArticlePdf({ kind: 'newspaper', title: 'Issue', edition: {} }, () => true),
      /exactly five pages/,
    );
    assert.deepEqual(shareCalls, []);
  });

  it('rejects an ordinary article print result without a non-empty local file URI', async () => {
    const shareCalls: unknown[] = [];
    const pdf = loadModule({
      'expo-print': { async printToFileAsync() { return { uri: '   ', numberOfPages: 1 }; } },
      'expo-sharing': { async isAvailableAsync() { return true; }, async shareAsync(...args: unknown[]) { shareCalls.push(args); } },
    });
    const article = { title: 'Article', publishedAt: '2026-10-17', content: 'Body', canonicalUrl: 'https://example.test/article' };

    await assert.rejects(
      pdf.shareLoadedArticlePdf({ kind: 'article', article }, () => true),
      /local file/,
    );
    assert.deepEqual(shareCalls, []);
  });

  it('does not render or print when native file sharing is unavailable', async () => {
    const printCalls: unknown[] = [];
    const pdf = loadModule({
      'expo-print': { async printToFileAsync(...args: unknown[]) { printCalls.push(args); return { uri: 'file:///cache/article.pdf', numberOfPages: 1 }; } },
      'expo-sharing': { async isAvailableAsync() { return false; }, async shareAsync() { throw new Error('must not share'); } },
    });
    const article = { title: 'Article', publishedAt: '2026-10-17', content: 'Body', canonicalUrl: 'https://example.test/article' };

    await assert.rejects(
      pdf.shareLoadedArticlePdf({ kind: 'article', article }, () => true),
      /unavailable/,
    );
    assert.deepEqual(printCalls, []);
  });

  it('honours operation ownership after availability and printing before opening the file share', async () => {
    let resolveAvailability!: (available: boolean) => void;
    let current = true;
    const firstPrintCalls: unknown[] = [];
    const availabilityPdf = loadModule({
      'expo-print': { async printToFileAsync(...args: unknown[]) { firstPrintCalls.push(args); return { uri: 'file:///cache/article.pdf', numberOfPages: 1 }; } },
      'expo-sharing': { isAvailableAsync: () => new Promise<boolean>((resolve) => { resolveAvailability = resolve; }), async shareAsync() { throw new Error('must not share'); } },
    });
    const article = { title: 'Article', publishedAt: '2026-10-17', content: 'Body', canonicalUrl: 'https://example.test/article' };
    const afterAvailability = availabilityPdf.shareLoadedArticlePdf({ kind: 'article', article }, () => current);
    await new Promise<void>((resolve) => setImmediate(resolve));
    current = false;
    resolveAvailability(true);
    assert.equal(await afterAvailability, 'superseded');
    assert.deepEqual(firstPrintCalls, []);

    let resolvePrint!: (result: { uri: string; numberOfPages: number }) => void;
    current = true;
    const fileShareCalls: unknown[] = [];
    const printingPdf = loadModule({
      'expo-print': { printToFileAsync: () => new Promise((resolve) => { resolvePrint = resolve; }) },
      'expo-sharing': { async isAvailableAsync() { return true; }, async shareAsync(...args: unknown[]) { fileShareCalls.push(args); } },
    });
    const afterPrint = printingPdf.shareLoadedArticlePdf({ kind: 'article', article }, () => current);
    await new Promise<void>((resolve) => setImmediate(resolve));
    current = false;
    resolvePrint({ uri: 'file:///cache/article.pdf', numberOfPages: 1 });
    assert.equal(await afterPrint, 'superseded');
    assert.deepEqual(fileShareCalls, []);
  });

  it('reports superseded when ownership changes while the native share sheet is pending', async () => {
    let resolveShare!: () => void;
    let current = true;
    const pdf = loadModule({
      'expo-sharing': {
        async isAvailableAsync() { return true; },
        shareAsync: () => new Promise<void>((resolve) => { resolveShare = resolve; }),
      },
    });
    const article = { title: 'Article', publishedAt: '2026-10-17', content: 'Body', canonicalUrl: 'https://example.test/article' };

    const sharing = pdf.shareLoadedArticlePdf({ kind: 'article', article }, () => current);
    await new Promise<void>((resolve) => setImmediate(resolve));
    current = false;
    resolveShare();

    assert.equal(await sharing, 'superseded');
  });
});
