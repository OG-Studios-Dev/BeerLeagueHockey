/* eslint-disable @typescript-eslint/no-explicit-any -- focused mounted share lifecycle */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode } from './component-harness.ts';

const edition = { title: 'Hockey Life Times', issueNumber: 45, marker: 'already-loaded-edition' };
const article = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'week-45', title: 'Week 45', authorName: 'Hockey Life', publishedAt: '2026-10-17T12:00:00Z', content: 'Complete article body.', mentions: [], taggedPlayers: [], relatedGame: null,
};

function screenWith(options: {
  platform?: string;
  readerResult?: unknown;
  pdfShare(source: unknown, isCurrent: () => boolean): Promise<unknown>;
  textShare(payload: unknown): Promise<unknown>;
}) {
  const harness = createHookHarness();
  let readerCalls = 0;
  const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator', Image: 'Image', Linking: { openURL: async () => undefined }, Platform: { OS: options.platform ?? 'ios' }, Share: { share: options.textShare }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View',
    },
    '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
    '../../components/NativeNewspaperEdition': { __esModule: true, default: (props: any) => createElement('NativeEdition', props) },
    '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
    '../../lib/articlePdfShare': { shareLoadedArticlePdf: options.pdfShare },
    '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null, publicArticleUrl: (leagueSlug: string, slug: string) => `https://${leagueSlug}.beerleaguehockey.ca/${leagueSlug}/news/${slug}` },
    '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => { readerCalls += 1; return options.readerResult ?? ({ status: 'ready', edition }); } },
    '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#123456' }) },
    '../../theme/colors': { __esModule: true, default: {} },
    './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'LoadState', commonStyles: {} },
    './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article } }) },
  }).default;
  const navigation = { addListener() { return () => {}; }, navigate() {}, push() {}, goBack() {} };
  harness.mount(() => Screen({ route: { params: { leagueId: 'league', leagueSlug: 'hockey-life', articleSlug: article.slug } }, navigation }));
  return { harness, navigation, readerCalls: () => readerCalls };
}

function pdfShareFailure(failure: string, calls: unknown[]) {
  const pdf = compileCommonJs<any>(new URL('../../src/lib/articlePdfShare.ts', import.meta.url), {
    '@hockey-life/hockey-life-times': {
      renderNewspaperHtml() {
        if (failure === 'renderer failed') throw new Error(failure);
        return '<html><body>five-sheet newspaper</body></html>';
      },
    },
    'expo-print': {
      async printToFileAsync() {
        if (failure === 'print failed') throw new Error(failure);
        return {
          uri: failure === 'blank local uri' ? '   ' : 'file:///cache/issue-45.pdf',
          numberOfPages: failure === 'wrong page count' ? 4 : 5,
        };
      },
    },
    'expo-sharing': {
      async isAvailableAsync() { return failure !== 'sharing unavailable'; },
      async shareAsync() { if (failure === 'file share rejected') throw new Error(failure); },
    },
  });
  return async (source: unknown, isCurrent: () => boolean) => {
    calls.push(source);
    return pdf.shareLoadedArticlePdf(source, isCurrent);
  };
}

it('shares the already-loaded validated newspaper as a PDF and does not open text fallback after a resolved file share', async () => {
  const pdfCalls: Array<{ source: any; isCurrent: () => boolean }> = [];
  const textCalls: unknown[] = [];
  let ownedDuringPdfShare = false;
  const { harness, readerCalls } = screenWith({
    async pdfShare(source, isCurrent) { ownedDuringPdfShare = isCurrent(); pdfCalls.push({ source, isCurrent }); return 'shared'; },
    async textShare(payload) { textCalls.push(payload); return { action: 'sharedAction' }; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const button = findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!;

  button.props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(pdfCalls.length, 1);
  assert.equal(pdfCalls[0]!.source.kind, 'newspaper');
  assert.equal(pdfCalls[0]!.source.edition, edition);
  assert.equal(pdfCalls[0]!.source.title, article.title);
  assert.equal(ownedDuringPdfShare, true);
  assert.equal(pdfCalls[0]!.isCurrent(), false);
  assert.deepEqual(textCalls, []);
  assert.equal(readerCalls(), 1);
});

it('shares an unavailable-edition article from loaded memory as an ordinary PDF without refetch or text fallback', async () => {
  const pdfCalls: any[] = [];
  const textCalls: unknown[] = [];
  const { harness, readerCalls } = screenWith({
    readerResult: { status: 'unavailable' },
    async pdfShare(source) { pdfCalls.push(source); return 'shared'; },
    async textShare(payload) { textCalls.push(payload); return { action: 'sharedAction' }; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(pdfCalls.length, 1);
  assert.deepEqual(pdfCalls[0], {
    kind: 'article',
    article: {
      title: article.title,
      authorName: article.authorName,
      publishedAt: article.publishedAt,
      content: article.content,
      canonicalUrl: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/week-45',
    },
  });
  assert.deepEqual(textCalls, []);
  assert.equal(readerCalls(), 1);
});

it('shares the loaded ordinary article while the reader is in its explicit error text-fallback state', async () => {
  const pdfCalls: any[] = [];
  const textCalls: unknown[] = [];
  const { harness, readerCalls } = screenWith({
    readerResult: { status: 'error', message: 'Edition lookup failed.' },
    async pdfShare(source) { pdfCalls.push(source); return 'shared'; },
    async textShare(payload) { textCalls.push(payload); return { action: 'sharedAction' }; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Read article text instead')!.props.onPress();
  findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(pdfCalls.length, 1);
  assert.equal(pdfCalls[0].kind, 'article');
  assert.equal(pdfCalls[0].article.content, article.content);
  assert.deepEqual(textCalls, []);
  assert.equal(readerCalls(), 1);
});

it('opens the canonical text fallback exactly once for every native PDF failure branch', async () => {
  for (const failure of ['sharing unavailable', 'renderer failed', 'print failed', 'wrong page count', 'blank local uri', 'file share rejected']) {
    const pdfCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    const { harness } = screenWith({
      pdfShare: pdfShareFailure(failure, pdfCalls),
      async textShare(payload) { textCalls.push(payload); throw new Error('text share rejected'); },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(pdfCalls.length, 1, failure);
    assert.deepEqual(textCalls, [{
      title: article.title,
      message: article.title,
      url: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/week-45',
    }], failure);
  }
});

it('uses the unchanged canonical URL and text share on web without preparing a PDF', async () => {
  const pdfCalls: unknown[] = [];
  const textCalls: unknown[] = [];
  const { harness } = screenWith({
    platform: 'web',
    async pdfShare(source) { pdfCalls.push(source); return 'shared'; },
    async textShare(payload) { textCalls.push(payload); return { action: 'dismissedAction' }; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(pdfCalls, []);
  assert.deepEqual(textCalls, [{
    title: article.title,
    message: `${article.title}\nhttps://hockey-life.beerleaguehockey.ca/hockey-life/news/week-45`,
  }]);
});
