#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { renderNewspaperHtml, renderNewspaperText, validateNewspaperEdition } from '../src/index.ts';

const chromePath = process.env.HLT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write('Usage: node scripts/export-newspaper.mjs --edition <json> --output <dir> [--illustrations <json>]\n');
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') usage();
    if (token === '--edition' || token === '--output' || token === '--illustrations') {
      if (!argv[i + 1]) usage(`Missing value for ${token}`);
      result[token.slice(2)] = argv[++i];
    } else usage(`Unknown argument: ${token}`);
  }
  if (!result.edition || !result.output) usage('Both --edition and --output are required');
  return result;
}

function applyIllustrations(edition, overrides) {
  const result = structuredClone(edition);
  if (overrides.leadImageUrl) result.lead.imageUrl = overrides.leadImageUrl;
  for (const game of result.games) {
    if (overrides.gameImageUrls?.[game.gameId]) game.imageUrl = overrides.gameImageUrls[game.gameId];
  }
  for (const star of result.stars) {
    if (overrides.playerIllustrationUrls?.[star.playerId]) star.illustrationUrl = overrides.playerIllustrationUrls[star.playerId];
  }
  for (const brief of [...result.hot, ...result.cold, ...(result.aroundRink || [])]) {
    if (overrides.briefImageUrls?.[brief.headline]) brief.imageUrl = overrides.briefImageUrls[brief.headline];
  }
  return result;
}

function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extension];
}

async function hydrateLocalImages(value, editionDir, key = '') {
  if (Array.isArray(value)) return Promise.all(value.map((item) => hydrateLocalImages(item, editionDir)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([childKey, child]) => [childKey, await hydrateLocalImages(child, editionDir, childKey)]));
    return Object.fromEntries(entries);
  }
  if (typeof value !== 'string' || !key.endsWith('Url') || /^(https?:|data:|blob:|file:)/i.test(value)) return value;
  const filePath = path.isAbsolute(value) ? value : path.resolve(editionDir, value);
  const mime = mimeFor(filePath);
  if (!mime || !existsSync(filePath)) return value;
  const buffer = await readFile(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const target = process.env.HLT_PLAYWRIGHT_PATH || 'playwright';
  try {
    return require(target);
  } catch (error) {
    throw new Error(`Playwright could not be loaded from ${target}. Install it normally or set HLT_PLAYWRIGHT_PATH to its package directory. ${error.message}`);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const args = parseArgs(process.argv.slice(2));
const editionPath = path.resolve(args.edition);
const outputDir = path.resolve(args.output);
const raw = JSON.parse(await readFile(editionPath, 'utf8'));
validateNewspaperEdition(raw);
const overrides = args.illustrations ? JSON.parse(await readFile(path.resolve(args.illustrations), 'utf8')) : {};
const illustrated = applyIllustrations(raw, overrides);
const edition = await hydrateLocalImages(illustrated, args.illustrations ? path.dirname(path.resolve(args.illustrations)) : path.dirname(editionPath));
const html = renderNewspaperHtml(edition);
const text = renderNewspaperText(edition);
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'edition.html'), html);
await writeFile(path.join(outputDir, 'edition.txt'), `${text}\n`);

const { chromium } = loadPlaywright();
const launchOptions = { headless: true };
if (existsSync(chromePath)) launchOptions.executablePath = chromePath;
let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (error) {
  const diagnostic = {
    stage: 'browser-launch',
    capability: 'pdf-and-page-image-export',
    passed: false,
    executable: launchOptions.executablePath || 'Playwright bundled browser',
    message: error.message,
  };
  await writeFile(path.join(outputDir, 'export-diagnostics.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
  throw new Error(`Chromium launch failed (${diagnostic.executable}): ${error.message}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1320 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const brokenImages = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (img) => img.complete ? undefined : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })));
    return Array.from(document.images)
      .filter((img) => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0)
      .map((img) => ({ alt: img.alt, src: img.currentSrc.slice(0, 180), complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
  });
  if (brokenImages.length) {
    const diagnostic = {
      stage: 'image-load',
      capability: 'pdf-and-page-image-export',
      passed: false,
      count: brokenImages.length,
      images: brokenImages,
    };
    await writeFile(path.join(outputDir, 'export-diagnostics.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
    throw new Error(`Image resource check failed for ${brokenImages.length} image(s); inspect export-diagnostics.json`);
  }

  const overflow = await page.evaluate(() => {
    const findings = [];
    const pages = [...document.querySelectorAll('[data-newspaper-page]')];
    for (const sheet of pages) {
      const pageRect = sheet.getBoundingClientRect();
      const footerTop = sheet.querySelector('footer')?.getBoundingClientRect().top ?? pageRect.bottom;
      const candidates = sheet.querySelectorAll('main,article,section,aside,figure,h1,h2,h3,p,li,th,td,figcaption,img');
      for (const element of candidates) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const outside = rect.left < pageRect.left - 1 || rect.right > pageRect.right + 1 || rect.top < pageRect.top - 1 || rect.bottom > pageRect.bottom + 1;
        const clipped = (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2);
        const footerOverlap = element.matches('h1,h2,h3,p,li,th,td,figcaption,img') && !element.closest('footer') && rect.bottom > footerTop + 1;
        if (outside || clipped || footerOverlap) findings.push({
          page: Number(sheet.getAttribute('data-newspaper-page')),
          element: element.tagName.toLowerCase(),
          className: element.className || '',
          outside,
          clipped,
          footerOverlap,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        });
      }
    }
    return findings;
  });

  const pages = page.locator('[data-newspaper-page]');
  const pageCount = await pages.count();
  if (pageCount !== 5) throw new Error(`Renderer produced ${pageCount} pages; expected 5`);
  const files = [];
  for (let index = 0; index < pageCount; index += 1) {
    const fileName = `page-${index + 1}.png`;
    const buffer = await pages.nth(index).screenshot({ path: path.join(outputDir, fileName), type: 'png' });
    const box = await pages.nth(index).boundingBox();
    files.push({ file: fileName, page: index + 1, cssWidth: box?.width, cssHeight: box?.height, pixelWidth: buffer.readUInt32BE(16), pixelHeight: buffer.readUInt32BE(20), sha256: sha256(buffer) });
  }

  await page.emulateMedia({ media: 'print' });
  const pdfPath = path.join(outputDir, 'hockey-life-times.pdf');
  const pdf = await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  files.push({ file: 'hockey-life-times.pdf', pages: pageCount, sha256: sha256(pdf) });
  const manifest = {
    schemaVersion: 1,
    renderer: '@hockey-life/hockey-life-times',
    edition: { issueNumber: edition.issueNumber, leagueId: edition.leagueId, seasonId: edition.seasonId, periodStart: edition.periodStart, periodEnd: edition.periodEnd, status: edition.status },
    generatedAt: new Date().toISOString(),
    browser: await browser.version(),
    pageCount,
    files,
    overflow: { passed: overflow.length === 0, count: overflow.length, findings: overflow },
  };
  await writeFile(path.join(outputDir, 'screenshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (overflow.length) throw new Error(`Overflow check failed with ${overflow.length} finding(s); inspect screenshot-manifest.json`);
  process.stdout.write(`Exported ${pageCount} pages to ${outputDir}\nOverflow check: passed\n`);
} finally {
  await browser.close();
}
