/* eslint-disable @typescript-eslint/no-explicit-any -- focused installed-consumer and mounted lifecycle regression */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness.ts';

function installedIosShare(nativeOptions: Record<string, unknown>[]) {
  const mobileDirectory = fileURLToPath(new URL('../../', import.meta.url).href);
  const appRequire = createRequire(path.join(mobileDirectory, 'package.json'));
  const babelRequire = createRequire(appRequire.resolve('babel-preset-expo/package.json'));
  const sdkPath = path.join(path.dirname(appRequire.resolve('react-native/package.json')), 'Libraries/Share/Share.js');
  const compiled = babelRequire('@babel/core').transformSync(readFileSync(sdkPath, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: [babelRequire.resolve('@babel/plugin-transform-flow-strip-types'), babelRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const exports: any = {};
  const mocks: Record<string, unknown> = {
    '../ActionSheetIOS/NativeActionSheetManager': { default: { showShareActionSheetWithOptions(options: Record<string, unknown>, _fail: unknown, complete: (completed: boolean, activity: string | null) => void) { nativeOptions.push(options); complete(false, null); } }, __esModule: true },
    './NativeShareModule': { default: {}, __esModule: true },
    '../StyleSheet/processColor': { default: (value: unknown) => value },
    '../Utilities/Platform': { default: { OS: 'ios' } },
    invariant: (value: unknown, message: string) => { if (!value) throw new Error(message); },
  };
  new Function('require', 'exports', compiled)((id: string) => { if (!(id in mocks)) throw new Error(id); return mocks[id]; }, exports);
  return exports.default;
}

function screenWith(react: any, share: (payload: any) => Promise<unknown>) {
  const host = (type: string) => function TestHost(props: any) { return createElement(type, props, props.children); };
  return compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
    react,
    'react-native': { ActivityIndicator: host('ActivityIndicator'), Image: host('Image'), Linking: {}, Platform: { OS: 'ios' }, Share: { share }, Pressable: host('Pressable'), Text: host('Text'), View: host('View'), StyleSheet: { create: (value: unknown) => value } },
    '../../components/CardFocus': { FocusCard: host('FocusCard') }, '../../components/NativeNewspaperEdition': { default: host('NativeEdition'), __esModule: true }, '../../components/TeamLogo': { default: host('TeamLogo'), __esModule: true },
    '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null, publicArticleUrl: (leagueSlug: string, articleSlug: string) => `https://${leagueSlug}.beerleaguehockey.ca/${leagueSlug}/news/${articleSlug}` },
    '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => ({ status: 'unavailable' }) }, '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#123456' }) }, '../../theme/colors': { default: {}, __esModule: true },
    './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: host('Frame'), PageLoadState: host('LoadState'), commonStyles: {} },
    './ContentPageCommon': { useLeagueContent: () => ({ data: { article: { id: 'article-a', slug: 'article-a', title: 'A current title', publishedAt: '2026-01-01', content: '', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
  }).default;
}

it('forwards the current iOS article title through the installed React Native Share consumer', async () => {
  const nativeOptions: Record<string, unknown>[] = [];
  const installedShare = installedIosShare(nativeOptions);
  const harness = createHookHarness();
  const Screen = screenWith(harness.react, installedShare.share);
  harness.mount(() => Screen({ route: { params: { leagueId: 'league', leagueSlug: 'hockey-life', articleSlug: 'article-a' } }, navigation: {} }));
  findNode(harness.output, node => node.props.accessibilityLabel === 'Share article')!.props.onPress();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(nativeOptions.length, 1);
  assert.equal(nativeOptions[0]!.message, 'A current title');
  assert.equal(nativeOptions[0]!.url, 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article-a');
});

it('keeps a newer same-article share locked when the previous visit settles', async () => {
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const pnpmDirectory = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
  const jsdomEntry = readdirSync(pnpmDirectory).find(entry => entry.startsWith('jsdom@'))!;
  const { JSDOM } = createRequire(`${pnpmDirectory}${jsdomEntry}/node_modules/jsdom/package.json`)('jsdom');
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls: any[] = [];
  const pending: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
  const shareHandlers: Array<() => Promise<void>> = [];
  const listeners = new Map<string, () => void>();
  let current = { id: 'a', slug: 'a', title: 'A current title' };
  const host = (tag: string) => function TestHost({ children, onPress, accessibilityLabel }: any) {
    if (accessibilityLabel === 'Share article') shareHandlers.push(onPress);
    return React.createElement(tag, { onClick: onPress, 'aria-label': accessibilityLabel }, children);
  };
  const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
    react: React,
    'react-native': { ActivityIndicator: host('i'), Image: host('i'), Linking: {}, Platform: { OS: 'ios' }, Share: { share(payload: any) { calls.push(payload); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } }, Pressable: host('button'), Text: host('span'), View: host('div'), StyleSheet: { create: (value: unknown) => value } },
    '../../components/CardFocus': { FocusCard: host('div') }, '../../components/NativeNewspaperEdition': { default: host('article'), __esModule: true }, '../../components/TeamLogo': { default: host('i'), __esModule: true },
    '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null, publicArticleUrl: (leagueSlug: string, articleSlug: string) => `https://${leagueSlug}.beerleaguehockey.ca/${leagueSlug}/news/${articleSlug}` },
    '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => ({ status: 'unavailable' }) }, '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#123456' }) }, '../../theme/colors': { default: {}, __esModule: true },
    './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: host('main'), PageLoadState: host('i'), commonStyles: {} },
    './ContentPageCommon': { useLeagueContent: () => ({ data: { article: { ...current, publishedAt: '2026-01-01', content: '', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
  }).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  const navigation = { addListener(event: string, callback: () => void) { listeners.set(event, callback); return () => listeners.delete(event); } };
  const render = async () => React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Screen, { route: { params: { leagueId: 'league', leagueSlug: 'hockey-life', articleSlug: current.slug } }, navigation }))));
  const click = async () => React.act(async () => (dom.window.document.querySelector('button') as HTMLElement).click());
  try {
    await render(); const obsoleteAHandler = shareHandlers.at(-1)!; await click();
    current = { id: 'b', slug: 'b', title: 'B current title' }; await render();
    current = { id: 'a', slug: 'a', title: 'A current title' }; await render(); await click();
    assert.equal(calls.length, 2);
    await React.act(async () => obsoleteAHandler());
    assert.equal(calls.length, 2);
    await React.act(async () => pending[0]!.resolve({ action: 'dismissedAction' }));
    await click();
    assert.equal(calls.length, 2);
    await React.act(async () => pending[1]!.resolve({ action: 'dismissedAction' }));
    const currentAHandler = shareHandlers.at(-1)!;
    listeners.get('blur')!();
    await React.act(async () => currentAHandler());
    assert.equal(calls.length, 2);
    listeners.get('focus')!();
    void currentAHandler();
    assert.equal(calls.length, 3);
    await React.act(async () => root.unmount());
    await React.act(async () => currentAHandler());
    assert.equal(calls.length, 3);
    pending.forEach(operation => operation.resolve({ action: 'dismissedAction' }));
  } finally {
    dom.window.close();
    Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});
