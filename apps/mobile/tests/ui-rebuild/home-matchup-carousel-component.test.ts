import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { HomeWeeklyGame } from '../../src/lib/supabase/home';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const homeModel = compileCommonJs<Record<string, any>>(
  new URL('../../src/lib/supabase/home.ts', import.meta.url),
  { './client': { supabase: {} } },
);

const componentUrl = new URL('../../src/components/HomeMatchupCarousel.tsx', import.meta.url);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX_CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
] as const;

type ChromeExecutableResolverOptions = {
  platform: NodeJS.Platform;
  chromeBin: string | undefined;
  isExecutableFile?: (candidate: string) => boolean;
};

function isExecutableRegularFile(candidate: string) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveChromeExecutable({
  platform,
  chromeBin,
  isExecutableFile = isExecutableRegularFile,
}: ChromeExecutableResolverOptions) {
  const platformCandidates = platform === 'darwin'
    ? [CHROME]
    : platform === 'linux'
      ? LINUX_CHROME_CANDIDATES
      : [];
  const candidates = chromeBin ? [chromeBin, ...platformCandidates] : platformCandidates;
  const executable = candidates.find(isExecutableFile);
  if (!executable) {
    throw new Error(
      'No executable Chrome or Chromium browser was found for the geometry regression. '
      + 'Set CHROME_BIN to an executable browser file or install Chrome/Chromium in a standard location.',
    );
  }
  return executable;
}

const baseGame = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, scheduled_at: '2026-10-08T02:15:00.000Z', location: 'Chick-Fil-A Community Ice Centre — Championship Rink',
  home_score: null, away_score: null, status: 'scheduled', home_team_id: `home-${id}`, away_team_id: `away-${id}`,
  home_team: { id: `home-${id}`, name: `Home ${id}`, logo_url: `https://example.test/home-${id}.png`, primary_color: '#B000FF' },
  away_team: { id: `away-${id}`, name: `Away ${id}`, logo_url: `https://example.test/away-${id}.png`, primary_color: '#FF6500' },
  ...overrides,
}) as HomeWeeklyGame;

function load(harness: ReturnType<typeof createHookHarness>) {
  return compileCommonJs<{ default: (props: Record<string, any>) => unknown }>(componentUrl, {
    react: harness.react,
    'react-native': {
      Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute' }, hairlineWidth: 1 },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    '../lib/supabase/home': homeModel,
    '../theme/home': { HOME_VISUAL_TOKENS: { text: '#F8FBFF', textSecondary: '#A9B8CC', stroke: 'rgba(125,190,255,.22)', minTouchTarget: 44 } },
    './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
    '../../assets/matchup/arena-base.png': { asset: 'base' },
    '../../assets/matchup/arena-left-mask.png': { asset: 'left' },
    '../../assets/matchup/arena-right-mask.png': { asset: 'right' },
  }).default;
}

type NativeWeb = Record<string, unknown> & {
  Text: React.ElementType;
  StyleSheet: { getSheet(): { textContent: string } };
};
type GeometryRect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
type RenderedTimeGeometry = {
  requestedWidth: number;
  requestedFontScale: number;
  effectiveFontScale: number;
  maximumFontSizeMultiplier: number | null;
  minimumFontScale: number;
  fitScale: number;
  text: string;
  accessibilityLabel: string;
  lane: GeometryRect;
  naturalInk: GeometryRect;
  finalInk: GeometryRect;
  lines: GeometryRect[];
};
type MetadataTextProps = Record<string, unknown> & {
  maxFontSizeMultiplier?: number;
  minimumFontScale?: number;
  adjustsFontSizeToFit?: boolean;
  dataSet?: Record<string, string>;
};

function renderedEnlargedTimeGeometry(
  browserOptions: ChromeExecutableResolverOptions = {
    platform: process.platform,
    chromeBin: process.env.CHROME_BIN,
  },
) {
  const chrome = resolveChromeExecutable(browserOptions);
  const nativeWeb = createRequire(import.meta.url)('react-native-web') as NativeWeb;
  const MetadataText = ({
    maxFontSizeMultiplier,
    minimumFontScale,
    adjustsFontSizeToFit,
    ...props
  }: MetadataTextProps) => React.createElement(nativeWeb.Text, {
    ...props,
    dataSet: {
      ...props.dataSet,
      maxFontSizeMultiplier: maxFontSizeMultiplier === undefined ? '' : String(maxFontSizeMultiplier),
      minimumFontScale: minimumFontScale === undefined ? '' : String(minimumFontScale),
      adjustsFontSizeToFit: adjustsFontSizeToFit ? 'true' : 'false',
    },
  });
  const Component = compileCommonJs<{ default: React.ComponentType<Record<string, unknown>> }>(componentUrl, {
    react: React,
    'react-native': { ...nativeWeb, Text: MetadataText },
    '@expo/vector-icons': { Ionicons: () => null },
    '../lib/supabase/home': homeModel,
    '../theme/home': { HOME_VISUAL_TOKENS: { text: '#F8FBFF', textSecondary: '#A9B8CC', stroke: 'rgba(125,190,255,.22)', minTouchTarget: 44 } },
    './CarouselPager': () => null,
    './TeamLogo': () => null,
    '../../assets/matchup/arena-base.png': { uri: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' },
    '../../assets/matchup/arena-left-mask.png': { uri: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' },
    '../../assets/matchup/arena-right-mask.png': { uri: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' },
  }).default;
  const markup = renderToStaticMarkup(React.createElement(Component, {
    games: [baseGame('geometry')],
    scopeKey: 'league:week',
    timezone: 'America/Toronto',
    leagueColor: '#22D3EE',
    width: 320,
    reduceMotion: true,
    onOpenGame() {},
  }));
  const probe = `(() => {
    const requestedFontScale = 1.8;
    const time = document.querySelector('[data-testid="home-matchup-time"]');
    const card = document.querySelector('[data-testid="home-matchup-card-geometry"]');
    const computed = getComputedStyle(time);
    const baseFontSize = Number.parseFloat(computed.fontSize);
    const baseLineHeight = Number.parseFloat(computed.lineHeight);
    const maximum = Number.parseFloat(time.dataset.maxFontSizeMultiplier);
    const effectiveFontScale = Number.isFinite(maximum) ? Math.min(requestedFontScale, maximum) : requestedFontScale;
    const minimumFontScale = Number.parseFloat(time.dataset.minimumFontScale);
    const range = document.createRange();
    range.selectNodeContents(time);
    const rect = (value) => ({ top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height });
    const measureInk = () => rect(range.getBoundingClientRect());
    time.style.setProperty('font-size', (baseFontSize * effectiveFontScale) + 'px', 'important');
    time.style.setProperty('line-height', (baseLineHeight * effectiveFontScale) + 'px', 'important');
    void time.offsetWidth;
    const lane = rect(time.getBoundingClientRect());
    const naturalInk = measureInk();
    const fitScale = time.dataset.adjustsFontSizeToFit === 'true' && naturalInk.width > lane.width
      ? minimumFontScale
      : 1;
    time.style.setProperty('font-size', (baseFontSize * effectiveFontScale * fitScale) + 'px', 'important');
    time.style.setProperty('line-height', (baseLineHeight * effectiveFontScale * fitScale) + 'px', 'important');
    void time.offsetWidth;
    const finalLane = rect(time.getBoundingClientRect());
    const finalInk = measureInk();
    const lines = Array.from(range.getClientRects()).map(rect).filter((line, index, values) => (
      values.findIndex((candidate) => Math.abs(candidate.top - line.top) < 0.01 && Math.abs(candidate.bottom - line.bottom) < 0.01) === index
    ));
    const result = {
      requestedWidth: 320,
      requestedFontScale,
      effectiveFontScale,
      maximumFontSizeMultiplier: Number.isFinite(maximum) ? maximum : null,
      minimumFontScale,
      fitScale,
      text: time.textContent,
      accessibilityLabel: card.getAttribute('aria-label'),
      lane: finalLane,
      naturalInk,
      finalInk,
      lines,
    };
    document.documentElement.setAttribute('data-geometry-result', btoa(unescape(encodeURIComponent(JSON.stringify(result)))));
  })();`;
  const css = nativeWeb.StyleSheet.getSheet().textContent;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nhtml,body,#root{margin:0;padding:0;}*{box-sizing:border-box;}</style></head><body><div id="root">${markup}</div><script>${probe}</script></body></html>`;
  const scratch = mkdtempSync(join(tmpdir(), 'home-matchup-time-geometry-'));
  try {
    const htmlPath = join(scratch, 'probe.html');
    writeFileSync(htmlPath, html);
    const browser = spawnSync(chrome, [
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
      `--user-data-dir=${join(scratch, 'chrome-profile')}`,
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(browser.status, 0, `Chrome geometry probe failed: ${browser.stderr}`);
    const encoded = browser.stdout.match(/data-geometry-result="([A-Za-z0-9+/=]+)"/)?.[1];
    assert.ok(encoded, `Chrome geometry probe did not return measurements: ${browser.stdout.slice(-1000)}`);
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as RenderedTimeGeometry;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('Home matchup carousel component', () => {
  it('selects a validated Linux Chrome executable for the geometry regression', () => {
    const executable = resolveChromeExecutable({
      platform: 'linux',
      chromeBin: undefined,
      isExecutableFile: (candidate) => candidate === '/usr/bin/google-chrome-stable',
    });

    assert.equal(executable, '/usr/bin/google-chrome-stable');
  });

  it('selects the validated macOS Chrome executable for the geometry regression', () => {
    const executable = resolveChromeExecutable({
      platform: 'darwin',
      chromeBin: undefined,
      isExecutableFile: (candidate) => candidate === CHROME,
    });

    assert.equal(executable, CHROME);
  });

  it('prefers a validated CHROME_BIN override for the geometry regression', () => {
    const checked: string[] = [];
    const executable = resolveChromeExecutable({
      platform: 'linux',
      chromeBin: '/controlled/chrome',
      isExecutableFile: (candidate) => {
        checked.push(candidate);
        return candidate === '/controlled/chrome';
      },
    });

    assert.equal(executable, '/controlled/chrome');
    assert.deepEqual(checked, ['/controlled/chrome']);
  });

  it('validates CHROME_BIN as an executable regular file by default', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'home-matchup-browser-resolver-'));
    try {
      const executableFile = join(scratch, 'chrome');
      const nonExecutableFile = join(scratch, 'chrome-no-execute');
      const directory = join(scratch, 'chrome-directory');
      writeFileSync(executableFile, 'browser');
      chmodSync(executableFile, 0o755);
      writeFileSync(nonExecutableFile, 'browser');
      chmodSync(nonExecutableFile, 0o644);
      mkdirSync(directory);

      assert.equal(resolveChromeExecutable({ platform: 'win32', chromeBin: executableFile }), executableFile);
      assert.throws(
        () => resolveChromeExecutable({ platform: 'win32', chromeBin: nonExecutableFile }),
        /No executable Chrome or Chromium browser was found/,
      );
      assert.throws(
        () => resolveChromeExecutable({ platform: 'win32', chromeBin: directory }),
        /No executable Chrome or Chromium browser was found/,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('launches the geometry probe with the resolved browser executable', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'home-matchup-browser-launch-'));
    try {
      const executableFile = join(scratch, 'controlled-browser');
      const encoded = Buffer.from(JSON.stringify({ requestedWidth: 777 }), 'utf8').toString('base64');
      writeFileSync(
        executableFile,
        `#!/bin/sh\nprintf '%s\\n' '<html data-geometry-result="${encoded}"></html>'\n`,
      );
      chmodSync(executableFile, 0o755);

      const geometry = renderedEnlargedTimeGeometry({
        platform: 'linux',
        chromeBin: executableFile,
      });

      assert.equal(geometry.requestedWidth, 777);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps the complete game time inside its rendered lane at 320pt and requested 1.8x text', () => {
    const geometry = renderedEnlargedTimeGeometry();
    assert.equal(geometry.requestedWidth, 320);
    assert.equal(geometry.requestedFontScale, 1.8);
    assert.equal(geometry.text, '10:15 PM');
    assert.match(geometry.accessibilityLabel, /10:15 PM/);
    assert.equal(geometry.lines.length, 1, `time must occupy one rendered line: ${JSON.stringify(geometry)}`);
    assert.ok(
      geometry.finalInk.left >= geometry.lane.left - 0.01 && geometry.finalInk.right <= geometry.lane.right + 0.01,
      `complete rendered time must fit its visible lane: ${JSON.stringify(geometry)}`,
    );
    assert.equal(geometry.maximumFontSizeMultiplier, 1.8, 'time scaling is explicitly bounded to the supported 1.8x contract');
    assert.ok(geometry.minimumFontScale >= 0.8, 'fit adjustment must retain the readable 0.8 floor');
  });

  it('renders one cinematic card with league-local facts, enlarged crests, color masks and no visible team captions', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const opened: string[] = [];
    harness.mount(() => Component({
      games: [baseGame('a'), baseGame('b')], scopeKey: 'league:week-1', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: false, onOpenGame: (id: string) => opened.push(id),
    }));

    const card = findNode(harness.output, (node) => node.props.testID === 'home-matchup-card-a')!;
    assert.ok(card);
    assert.match(card.props.accessibilityLabel, /Away a at Home a/);
    assert.match(card.props.accessibilityLabel, /Oct 7.*10:15 PM/);
    assert.match(card.props.accessibilityLabel, /Chick-Fil-A Community Ice Centre/);
    assert.equal(nodeText(card).includes('Away a'), false);
    assert.equal(nodeText(card).includes('Home a'), false);
    assert.match(nodeText(card), /Oct 7/);
    assert.match(nodeText(card), /Chick-Fil-A Community Ice Centre — Championship Rink/);
    assert.match(nodeText(card), /10:15 PM/);
    const factRow = findNode(card, (node) => node.props.testID === 'home-matchup-fact-row')!;
    assert.equal(flattenStyle(factRow.props.style).minHeight, 36);
    const date = findNode(card, (node) => node.props.testID === 'home-matchup-date')!;
    const location = findNode(card, (node) => node.props.testID === 'home-matchup-location')!;
    const time = findNode(card, (node) => node.props.testID === 'home-matchup-time')!;
    assert.ok(flattenStyle(time.props.style).width > flattenStyle(date.props.style).width);
    assert.equal(flattenStyle(location.props.style).fontSize, 13);

    const away = findNode(card, (node) => node.type === 'TeamLogo' && node.props.teamId === 'away-a')!;
    const home = findNode(card, (node) => node.type === 'TeamLogo' && node.props.teamId === 'home-a')!;
    assert.equal(away.props.size, 124.8);
    assert.equal(home.props.size, 122.4);
    assert.equal(away.props.transparentBacking, true);
    assert.equal(home.props.transparentBacking, true);

    for (const [testID, source, tintColor] of [
      ['home-matchup-arena-base', { asset: 'base' }, undefined],
      ['home-matchup-arena-left-mask', { asset: 'left' }, '#FF6500'],
      ['home-matchup-arena-right-mask', { asset: 'right' }, '#B000FF'],
    ] as const) {
      const image = findNode(card, (node) => node.props.testID === testID)!;
      assert.deepEqual(image.props.source, source);
      assert.equal(image.props.tintColor, tintColor);
      const style = flattenStyle(image.props.style);
      assert.equal(style.width, 358);
      assert.equal(typeof style.height, 'number');
      assert.ok(style.top >= 18, 'scene art must retain a quiet ceiling above the rink');
    }
    const awayStage = findNode(card, (node) => node.props.testID === 'home-matchup-away-stage')!;
    assert.ok(flattenStyle(awayStage.props.style).height < flattenStyle(findNode(card, (node) => node.props.testID === 'home-matchup-scene')!.props.style).height);
    assert.equal(flattenStyle(awayStage.props.style).justifyContent, 'flex-end');
    card.props.onPress();
    assert.deepEqual(opened, ['a']);
  });

  it('uses a manual one-page pager, meaningful 44dp controls, and ignores stale scope callbacks', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const opened: string[] = [];
    const props: Record<string, any> = {
      games: [baseGame('a'), baseGame('b'), baseGame('c')], scopeKey: 'league:week-1', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: true, onOpenGame: (id: string) => opened.push(id),
    };
    harness.mount(() => Component(props));
    const pager = findNode(harness.output, (node) => node.props.testID === 'home-matchup-pager')!;
    assert.equal(pager.props.horizontal, true);
    assert.equal(pager.props.pagingEnabled, true);
    assert.equal(pager.props.onScroll, undefined);
    const staleSwipe = pager.props.onMomentumScrollEnd;
    const firstCard = findNode(harness.output, (node) => node.props.testID === 'home-matchup-card-a')!;
    pager.props.onScrollBeginDrag();
    pager.props.onScrollEndDrag();
    firstCard.props.onPress();
    assert.deepEqual(opened, [], 'release press is suppressed');
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    try { firstCard.props.onPress(); } finally { Date.now = realNow; }
    assert.deepEqual(opened, ['a'], 'a later intentional tap is not stuck behind the drag guard');

    const next = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Next game')!;
    assert.equal(flattenStyle(next.props.style).minHeight, 44);
    next.props.onPress(); harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '2 of 3');

    props.scopeKey = 'league:week-2';
    props.games = [baseGame('x'), baseGame('y')];
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');
    staleSwipe({ nativeEvent: { layoutMeasurement: { width: 358 }, contentOffset: { x: 358 } } });
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');

    props.scopeKey = 'league:week-1';
    props.games = [baseGame('a'), baseGame('b')];
    harness.render();
    staleSwipe({ nativeEvent: { layoutMeasurement: { width: 358 }, contentOffset: { x: 358 } } });
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');
  });

  it('supports adjustable increment/decrement and disables both control endpoints without boundary callbacks', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const games = [baseGame('a'), baseGame('b'), baseGame('c')];
    harness.mount(() => Component({
      games, scopeKey: 'league:week', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: true, onOpenGame: () => {},
    }));

    const readControls = () => ({
      previous: findNode(harness.output, (node) => node.props.accessibilityLabel === 'Previous game')!,
      position: findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!,
      next: findNode(harness.output, (node) => node.props.accessibilityLabel === 'Next game')!,
    });
    let { previous, position, next } = readControls();
    assert.deepEqual(position.props.accessibilityActions, [
      { name: 'increment', label: 'Next game' },
      { name: 'decrement', label: 'Previous game' },
    ]);
    assert.equal(previous.props.disabled, true);
    assert.deepEqual(previous.props.accessibilityState, { disabled: true });
    assert.ok(flattenStyle(previous.props.style).opacity < 1, 'disabled Previous must have a clear visual state');
    assert.equal(flattenStyle(previous.props.style).minHeight, 44);
    assert.equal(next.props.disabled, false);
    assert.deepEqual(next.props.accessibilityState, { disabled: false });

    const startUpdates = harness.stateUpdateCount;
    previous.props.onPress();
    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    harness.render();
    assert.equal(harness.stateUpdateCount, startUpdates, 'Previous/decrement must not select beyond the first game');
    assert.equal(readControls().position.props.accessibilityValue.text, '1 of 3');

    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    harness.render();
    assert.equal(readControls().position.props.accessibilityValue.text, '2 of 3');
    ({ previous, position, next } = readControls());
    assert.equal(previous.props.disabled, false);
    assert.equal(next.props.disabled, false);

    next.props.onPress();
    harness.render();
    ({ previous, position, next } = readControls());
    assert.equal(position.props.accessibilityValue.text, '3 of 3');
    assert.equal(next.props.disabled, true);
    assert.deepEqual(next.props.accessibilityState, { disabled: true });
    assert.ok(flattenStyle(next.props.style).opacity < 1, 'disabled Next must have a clear visual state');
    assert.equal(flattenStyle(next.props.style).minHeight, 44);

    const endUpdates = harness.stateUpdateCount;
    next.props.onPress();
    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    harness.render();
    assert.equal(harness.stateUpdateCount, endUpdates, 'Next/increment must not select beyond the final game');
    assert.equal(readControls().position.props.accessibilityValue.text, '3 of 3');

    readControls().position.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    harness.render();
    assert.equal(readControls().position.props.accessibilityValue.text, '2 of 3');
  });

  it('keeps time on one line, omits Scheduled, and preserves every meaningful game status and score', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const cases = [
      { name: 'Scheduled', id: 'scheduled', status: 'scheduled', awayScore: 0, homeScore: null, visibleStatus: null, visibleScores: [] },
      { name: 'Live', id: 'live', status: 'in_progress', awayScore: 0, homeScore: null, visibleStatus: 'Live', visibleScores: ['0', '—'] },
      { name: 'Final', id: 'final', status: 'completed', awayScore: null, homeScore: 0, visibleStatus: 'Final', visibleScores: ['—', '0'] },
      { name: 'Postponed', id: 'postponed', status: 'postponed', awayScore: 0, homeScore: null, visibleStatus: 'Postponed', visibleScores: [] },
      { name: 'Cancelled', id: 'cancelled', status: 'cancelled', awayScore: 0, homeScore: null, visibleStatus: 'Cancelled', visibleScores: [] },
      { name: 'Pending Verification', id: 'review', status: 'pending_verification', awayScore: 0, homeScore: null, visibleStatus: 'Awaiting Review', visibleScores: [] },
    ] as const;
    const games = cases.map((entry) => baseGame(entry.id, {
      status: entry.status, away_score: entry.awayScore, home_score: entry.homeScore,
    }));
    harness.mount(() => Component({
      games, scopeKey: 'league:week', timezone: 'America/Toronto', leagueColor: '#22D3EE', width: 390,
      reduceMotion: true, onOpenGame: () => {},
    }));

    for (const entry of cases) {
      const card = findNode(harness.output, (node) => node.props.testID === `home-matchup-card-${entry.id}`)!;
      assert.ok(card, `${entry.name} card must render`);
      const visible = nodeText(card);
      if (entry.visibleStatus) {
        assert.match(visible, new RegExp(entry.visibleStatus), `${entry.name} must show its truthful status`);
        assert.match(card.props.accessibilityLabel, new RegExp(`^${entry.visibleStatus}\\.`));
      } else {
        assert.doesNotMatch(visible, /\bScheduled\b/, 'scheduled cards rely on their date and time instead of a redundant status');
        assert.doesNotMatch(card.props.accessibilityLabel, /\bScheduled\b/);
        assert.match(card.props.accessibilityLabel, /^Away scheduled at Home scheduled\./);
      }
      assert.match(visible, /Oct 7/);
      assert.match(visible, /Chick-Fil-A Community Ice Centre — Championship Rink/);
      assert.match(visible, /10:15 PM/);
      assert.match(card.props.accessibilityLabel, /Oct 7.*10:15 PM.*Chick-Fil-A Community Ice Centre/);

      const time = findNode(card, (node) => node.props.testID === 'home-matchup-time')!;
      assert.equal(time.props.numberOfLines, 1);
      assert.equal(time.props.adjustsFontSizeToFit, true);
      assert.equal(time.props.minimumFontScale, 0.8);
      assert.equal(time.props.maxFontSizeMultiplier, 1.8);

      if (entry.visibleScores.length) {
        for (const score of entry.visibleScores) {
          assert.ok(
            findNode(card, (node) => node.type === 'Text' && node.props.children === score),
            `${entry.name} must visibly preserve score ${score}`,
          );
        }
        if (entry.id === 'live') assert.match(card.props.accessibilityLabel, /Away live 0.*Home live score unavailable/);
        if (entry.id === 'final') assert.match(card.props.accessibilityLabel, /Away final score unavailable.*Home final 0/);
      } else {
        assert.equal(
          findNode(card, (node) => node.type === 'Text' && (node.props.children === '0' || node.props.children === '—')),
          undefined,
          `${entry.name} must not display scores`,
        );
        assert.match(card.props.accessibilityLabel, new RegExp(`Away ${entry.id} at Home ${entry.id}`));
        assert.doesNotMatch(card.props.accessibilityLabel, /score unavailable/);
      }
    }
  });
});
