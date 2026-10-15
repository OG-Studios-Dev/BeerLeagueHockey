import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, type BrowserType } from '@playwright/test';
import { buildNewspaperViewerHtml } from '../../apps/league-sites/src/components/news/NewspaperEditionViewer';

const input = process.argv[2];
if (!input) throw new Error('Usage: tsx e2e/scripts/newspaper-viewer-geometry.ts <frozen-srcdoc.html>');

async function verify(browserType: BrowserType, name: string, frozen: string) {
  const browser = await browserType.launch();
  try {
    for (const [mode, scale] of [['fit', null], ['zoom', 0.65]] as const) {
      const srcdoc = buildNewspaperViewerHtml(frozen, scale);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent('<iframe title="Hockey Life Times source-bound fixture" sandbox="" style="display:block;width:368px;height:716px;border:0"></iframe>');
      await page.locator('iframe').evaluate((frame, value) => { (frame as HTMLIFrameElement).srcdoc = value; }, srcdoc);
      assert.equal(await page.locator('iframe').getAttribute('srcdoc'), srcdoc, `${name} ${mode}: srcdoc stable`);
      const frame = page.frames()[1];
      await frame.waitForSelector('.newspaper-page-wrap:nth-child(5)');
      const geometry = await frame.locator('.newspaper-page-wrap').evaluateAll((wrappers) => wrappers.map((wrapper) => {
        const page = wrapper.firstElementChild as HTMLElement;
        const wrapperRect = wrapper.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        return {
          page: page.dataset.newspaperPage,
          wrapper: { top: wrapperRect.top, bottom: wrapperRect.bottom, width: wrapperRect.width, height: wrapperRect.height },
          rendered: { top: pageRect.top, bottom: pageRect.bottom, width: pageRect.width, height: pageRect.height },
          overflow: getComputedStyle(wrapper).overflow,
        };
      }));

      assert.equal(geometry.length, 5, `${name} ${mode}: page count`);
      assert.deepEqual(geometry.map((item) => item.page), ['1', '2', '3', '4', '5'], `${name} ${mode}: navigation order`);
      for (const item of geometry) {
        assert(item.wrapper.width > 0 && item.wrapper.height > 0, `${name} ${mode}: nonzero wrapper`);
        assert(item.rendered.width > 0 && item.rendered.height > 0, `${name} ${mode}: nonzero rendered page`);
        assert(Math.abs(item.wrapper.width - item.rendered.width) < 0.1, `${name} ${mode}: width not clipped`);
        assert(Math.abs(item.wrapper.height - item.rendered.height) < 0.1, `${name} ${mode}: height not clipped`);
        assert.equal(item.overflow, 'visible', `${name} ${mode}: wrapper overflow`);
      }
      const gaps = geometry.slice(1).map((item, index) => item.wrapper.top - geometry[index].wrapper.bottom);
      assert(gaps.every((gap) => gap > 0), `${name} ${mode}: positive page gaps`);
      assert(Math.max(...gaps) - Math.min(...gaps) < 0.1, `${name} ${mode}: stable page gaps`);
      const expectedScale = scale ?? 344 / 853;
      assert(Math.abs(geometry[0].wrapper.width - 853 * expectedScale) < 0.1, `${name} ${mode}: scale width`);
      assert(Math.abs(geometry[0].wrapper.height - 1280 * expectedScale) < 0.1, `${name} ${mode}: physical flow height`);
      assert.equal(await page.locator('iframe').getAttribute('sandbox'), '', `${name} ${mode}: opaque sandbox`);
      await page.close();
      process.stdout.write(`${name} ${mode}: 5 pages, ${geometry[0].wrapper.width.toFixed(2)}x${geometry[0].wrapper.height.toFixed(2)}, gap ${gaps[0].toFixed(2)}\n`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const frozen = await readFile(input, 'utf8');
  const expectedPageText = [...frozen.matchAll(/<section class="newspaper-page[\s\S]*?<\/section>/g)].length;
  assert.equal(expectedPageText, 5, 'frozen input must contain all five newspaper pages');
  await verify(chromium, 'chromium', frozen);
  if (process.argv.includes('--webkit')) await verify(webkit, 'webkit', frozen);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
