/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as leaderPresentation from '../../src/lib/leaderPresentation';
import { compileCommonJs } from './component-harness';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const transparentPixel = { uri: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' };
const fixtureNames = [
  'Alexandria-Skye Maximilian Vandenberg-Worthington',
  'Anastasia Montgomery-Smythe',
  'Ada Wing',
  'Alexandra Verylonglastname',
  'Jean-Luc O’Shaughnessy',
] as const;
const scenarios = [320, 390, 430].flatMap((width) => [1, 1.8].flatMap((requestedScale) => (
  ['points', 'goals', 'gaa'] as const
).map((metric) => ({
  id: `w${width}-scale${String(requestedScale).replace('.', '-')}-${metric}`,
  width,
  requestedScale,
  nameScale: Math.min(requestedScale, 1.35),
  scoreScale: Math.min(requestedScale, 1.25),
  metric,
}))));

const leaders = fixtureNames.map((playerName, index) => ({
  playerId: `geometry-${index + 1}`,
  playerName,
  avatarUrl: null,
  displayTeam: { id: `team-${index + 1}`, name: `Team ${index + 1}`, logoUrl: null },
  skater: {
    gamesPlayed: { value: 10, state: 'recorded', sources: ['skater_stats'] },
    goals: { value: 20 - index, state: 'recorded', sources: ['skater_stats'] },
    assists: { value: 30 - index, state: 'recorded', sources: ['skater_stats'] },
    points: { value: 50 - index, state: 'recorded', sources: ['skater_stats'] },
    championships: { value: 0, state: 'recorded', sources: ['skater_stats'] },
  },
  goalie: null,
  rank: index + 1,
  value: { value: 50 - index, state: 'recorded', sources: ['skater_stats'] },
  display: String(50 - index),
}));

type NativeWeb = Record<string, any> & { PixelRatio: Record<string, unknown>; StyleSheet: { getSheet(): { textContent: string } } };

function loadCard(nativeWeb: NativeWeb, fontScale: number) {
  const reactNative = {
    ...nativeWeb,
    PixelRatio: { ...nativeWeb.PixelRatio, getFontScale: () => fontScale },
  };
  const FocusCard = ({ children, style, testID }: any) => React.createElement(nativeWeb.View, { style, testID }, children);
  const TeamLogo = ({ size = 24 }: any) => React.createElement(nativeWeb.View, {
    testID: 'geometry-team-logo',
    style: { width: size, height: size, flexShrink: 0, borderRadius: size / 2, backgroundColor: '#443366' },
  });
  return compileCommonJs<{ default: React.ComponentType<any> }>(new URL('../../src/components/StatsLeadersCard.tsx', import.meta.url), {
    react: React,
    'react-native': reactNative,
    '../../assets/league-leaders/jack-foote.png': transparentPixel,
    '../../assets/league-leaders/neutral-goalie.png': transparentPixel,
    '../../assets/league-leaders/neutral-helmet-player.png': transparentPixel,
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
    '../lib/homeLeagueLeaders': {
      resolveLeaderArtwork: (_leagueId: string, leader: any) => ({
        kind: 'neutral',
        identityKey: leader.player_id,
        artworkId: 'neutral-helmet-v1',
        accessibilityLabel: 'Neutral hockey player artwork',
      }),
    },
    '../lib/playerArtworkManifest': { loadPlayerArtworkManifest: async () => null },
    '../lib/leaderPresentation': leaderPresentation,
    '../lib/supabase/publicStats': { formatPublicMetric: (metric: any) => ({ value: metric.value === null ? '—' : String(metric.value) }) },
    '../theme/ui': { getSurfacePalette: () => ({ surface: '#102030', elevated: '#182838', interactive: '#203040', stroke: '#406080' }) },
    './CardFocus': { FocusCard },
    './SectionHeader': { SECTION_HEADING_TEXT_STYLE: { fontSize: 18, lineHeight: 24, fontWeight: '900' } },
    './TeamLogo': { __esModule: true, default: TeamLogo },
  }).default;
}

function renderedGeometry() {
  const nativeWeb = createRequire(import.meta.url)('react-native-web') as NativeWeb;
  const cards = new Map([
    [1, loadCard(nativeWeb, 1)],
    [1.8, loadCard(nativeWeb, 1.8)],
  ]);
  const markup = renderToStaticMarkup(React.createElement(
    nativeWeb.View,
    { testID: 'geometry-root', style: { alignItems: 'flex-start', backgroundColor: '#03101D' } },
    ...scenarios.map((scenario) => React.createElement(
      nativeWeb.View,
      { key: scenario.id, testID: `geometry-scenario-${scenario.id}`, style: { width: scenario.width, paddingHorizontal: 16 } },
      React.createElement(cards.get(scenario.requestedScale)!, {
        leagueId: 'league-a',
        width: scenario.width,
        metric: scenario.metric,
        leaders,
        status: 'ready',
        onRetry() {},
        onOpenPlayer() {},
      }),
    )),
  ));
  const css = nativeWeb.StyleSheet.getSheet().textContent;
  const probe = `(() => {
    const configs = ${JSON.stringify(scenarios)};
    const directText = (root) => Array.from(root.querySelectorAll('*')).filter((el) => Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.length));
    const rect = (el) => { const value = el.getBoundingClientRect(); return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height }; };
    const ink = (el) => { const range = document.createRange(); range.selectNodeContents(el); const value = range.getBoundingClientRect(); return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height }; };
    const union = (values) => ({
      top: Math.min(...values.map((value) => value.top)),
      right: Math.max(...values.map((value) => value.right)),
      bottom: Math.max(...values.map((value) => value.bottom)),
      left: Math.min(...values.map((value) => value.left)),
    });
    const results = configs.map((config) => {
      const root = document.querySelector('[data-testid="geometry-scenario-' + config.id + '"]');
      const card = root.querySelector('[data-testid="stats-leaders-card"]');
      for (const el of directText(card)) {
        const computed = getComputedStyle(el);
        const baseFontSize = Number.parseFloat(computed.fontSize);
        const baseLineHeight = Number.parseFloat(computed.lineHeight);
        const scale = el.closest('[data-testid^="stats-leader-score-"]') ? config.scoreScale : config.nameScale;
        if (Number.isFinite(baseFontSize)) el.style.setProperty('font-size', (baseFontSize * scale) + 'px', 'important');
        if (Number.isFinite(baseLineHeight)) el.style.setProperty('line-height', (baseLineHeight * scale) + 'px', 'important');
      }
      void root.offsetHeight;
      const rows = Array.from(root.querySelectorAll('[data-testid^="stats-leader-row-"]'));
      const artStage = Array.from(root.querySelectorAll('[role="button"]')).find((el) => el.querySelector('[data-testid="stats-leader-feature-art"]'));
      const art = rect(artStage);
      const composition = rows[0].parentElement.parentElement;
      return {
        ...config,
        composition: rect(composition),
        art,
        rows: rows.map((row, index) => {
          const id = row.getAttribute('data-testid').replace('stats-leader-row-', '');
          const facts = root.querySelector('[data-testid="stats-leader-facts-' + id + '"]') || row.children[2];
          const given = root.querySelector('[data-testid="stats-leader-given-' + id + '"]') || facts.children[0];
          const surname = root.querySelector('[data-testid="stats-leader-surname-' + id + '"]') || facts.children[1];
          const score = root.querySelector('[data-testid="stats-leader-score-' + id + '"]') || facts.children[2];
          const surnameText = directText(surname);
          const scoreText = directText(score);
          const factText = directText(facts);
          const rowRect = rect(row);
          const nextTop = index + 1 < rows.length ? rect(rows[index + 1]).top : rowRect.bottom;
          const blocks = {
            given: { rect: rect(given), ink: ink(given) },
            surname: { rect: rect(surname), ink: union(surnameText.map(ink)) },
            score: { rect: rect(score), ink: union(scoreText.map(ink)) },
          };
          const contentBottom = Math.max(blocks.given.ink.bottom, blocks.surname.ink.bottom, blocks.score.ink.bottom);
          const contentTop = Math.min(blocks.given.ink.top, blocks.surname.ink.top, blocks.score.ink.top);
          const maxTextRight = Math.max(...factText.map((el) => ink(el).right));
          return {
            id,
            ariaLabel: row.getAttribute('aria-label'),
            row: rowRect,
            nextTop,
            blocks,
            contentTop,
            contentBottom,
            gapToNext: nextTop - contentBottom,
            lineTexts: surnameText.map((el) => el.textContent),
            surnameText: surnameText.map((el) => el.textContent).join(''),
            containsEllipsis: factText.some((el) => el.textContent.includes('…') || getComputedStyle(el).textOverflow === 'ellipsis'),
            maxTextRight,
            artGap: art.left - maxTextRight,
          };
        }),
      };
    });
    document.documentElement.setAttribute('data-geometry-results', btoa(unescape(encodeURIComponent(JSON.stringify(results)))));
  })();`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nhtml,body,#root{margin:0;padding:0;background:#03101d;}*{box-sizing:border-box;}</style></head><body><div id="root">${markup}</div><script>${probe}</script></body></html>`;
  const scratch = mkdtempSync(join(tmpdir(), 'stats-leaders-geometry-'));
  try {
    const htmlPath = join(scratch, 'probe.html');
    const profilePath = join(scratch, 'chrome-profile');
    writeFileSync(htmlPath, html);
    const browser = spawnSync(CHROME, [
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-extensions',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-color-profile=srgb',
      '--virtual-time-budget=1000',
      `--user-data-dir=${profilePath}`,
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(browser.status, 0, `Chrome geometry probe failed: ${browser.stderr}`);
    const encoded = browser.stdout.match(/data-geometry-results="([A-Za-z0-9+/=]+)"/)?.[1];
    assert.ok(encoded, `Chrome geometry probe did not return measurements: ${browser.stdout.slice(-1000)}`);
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Array<any>;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('Stats League Leaders rendered browser geometry', () => {
  it('contains five lossless name and score stacks inside their rows at supported widths and text scales', () => {
    const results = renderedGeometry();
    assert.equal(results.length, 18);
    for (const scenario of results) {
      if (scenario.requestedScale === 1) {
        assert.equal(scenario.composition.height, 330, `${scenario.id} preserves the normal-text 330pt composition`);
      }
      assert.equal(scenario.rows.length, 5, `${scenario.id} renders all five leaders`);
      assert.equal(scenario.nameScale, Math.min(scenario.requestedScale, 1.35));
      assert.equal(scenario.scoreScale, Math.min(scenario.requestedScale, 1.25));
      for (const [index, row] of scenario.rows.entries()) {
        assert.equal(row.surnameText, fixtureNames[index].split(' ').slice(1).join(' '), `${scenario.id} ${row.id} preserves every surname character`);
        assert.match(row.ariaLabel, new RegExp(fixtureNames[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(row.containsEllipsis, false, `${scenario.id} ${row.id} has no ellipsis`);
        for (const [blockName, block] of Object.entries(row.blocks) as Array<[string, any]>) {
          assert.ok(block.rect.top >= row.row.top - 0.01, `${scenario.id} ${row.id} ${blockName} block starts inside its row: ${JSON.stringify({ block: block.rect, row })}`);
          assert.ok(block.rect.bottom <= row.row.bottom + 0.01, `${scenario.id} ${row.id} ${blockName} block ends inside its row: ${JSON.stringify({ block: block.rect, row: row.row })}`);
          assert.ok(block.ink.top >= row.row.top - 0.01, `${scenario.id} ${row.id} ${blockName} ink starts inside its row: ${JSON.stringify({ ink: block.ink, row: row.row })}`);
          assert.ok(block.ink.bottom <= row.row.bottom + 0.01, `${scenario.id} ${row.id} ${blockName} ink ends inside its row: ${JSON.stringify({ ink: block.ink, row: row.row })}`);
        }
        assert.ok(row.contentTop >= row.row.top - 0.01, `${scenario.id} ${row.id} content starts inside its row`);
        assert.ok(row.gapToNext > 2, `${scenario.id} ${row.id} leaves a safe positive rendered gap before the next row; measured ${row.gapToNext}`);
        assert.ok(row.artGap >= 0, `${scenario.id} ${row.id} facts remain left of the artwork lane; measured ${row.artGap}`);
      }
      if (scenario.requestedScale > 1) {
        assert.ok(scenario.composition.height > 330, `${scenario.id} grows only for enlarged text; measured ${scenario.composition.height}`);
      }
      assert.equal(scenario.rows[2].lineTexts.length, 1, `${scenario.id} covers a one-line surname`);
      assert.equal(scenario.rows[2].surnameText, 'Wing');
    }

    for (const metric of ['points', 'goals', 'gaa']) {
      const narrowEnlarged = results.find((scenario) => scenario.width === 320 && scenario.requestedScale === 1.8 && scenario.metric === metric)!;
      assert.equal(narrowEnlarged.rows[0].lineTexts.length, 2, `320pt ${metric} at requested 1.8x exercises the exact Vandenberg-Worthington fixture`);
      assert.equal(narrowEnlarged.rows[1].lineTexts.length, 2, `320pt ${metric} at requested 1.8x exercises the prior Montgomery-Smythe two-line fixture`);
    }
  });
});
