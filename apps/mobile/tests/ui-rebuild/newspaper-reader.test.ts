/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const browserCalls: string[] = [];
const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), {
  'expo-web-browser': { openBrowserAsync: async (url: string) => { browserCalls.push(url); return { type: 'opened' }; } },
  './supabase/client': { supabase: {} },
});

const leagueId = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const articleId = '11111111-1111-4111-8111-111111111111';
const articleSlug = 'synthetic-published-edition';
const expected = { articleId, articleSlug, leagueId, leagueSlug: 'hockey-life' };
const published = { article_id: articleId, league_id: leagueId, status: 'published', published_at: '2026-09-27T12:00:00.000Z' };

describe('native newspaper reader bridge', () => {
  it('loads only an exact published article association and builds the canonical public URL', async () => {
    // SYNTHETIC FIXTURE: contract-shaped association, not a claim of a live edition.
    let queryArgs: unknown[] = [];
    const target = await reader.loadPublishedNewspaperReaderTarget(expected, async (...args: unknown[]) => {
      queryArgs = args;
      return { data: published, error: null };
    });
    assert.deepEqual(queryArgs, [articleId, leagueId]);
    assert.deepEqual(target, { articleId, articleSlug, leagueId, url: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/synthetic-published-edition' });
  });

  it('fails safely for draft, foreign, null, missing-table, and legacy-news results', async () => {
    // SYNTHETIC FIXTURES: negative association states only.
    assert.equal(reader.decodePublishedNewspaperAssociation({ ...published, status: 'draft' }, expected), null);
    assert.equal(reader.decodePublishedNewspaperAssociation({ ...published, league_id: '22222222-2222-4222-8222-222222222222' }, expected), null);
    assert.equal(reader.decodePublishedNewspaperAssociation(null, expected), null);
    assert.equal(await reader.loadPublishedNewspaperReaderTarget(expected, async () => ({ data: null, error: { code: '42P01', message: 'synthetic missing table' } })), null);
    assert.equal(await reader.loadPublishedNewspaperReaderTarget(expected, async () => ({ data: null, error: null })), null, 'legacy news remains a normal native article');
    assert.equal(await reader.loadPublishedNewspaperReaderTarget({ ...expected, leagueId: '22222222-2222-4222-8222-222222222222' }, async () => { throw new Error('must not query'); }), null);
  });

  it('rejects malformed slugs and forged URLs without normalization', async () => {
    assert.throws(() => reader.buildHockeyLifeNewspaperUrl('../foreign'), /invalid newspaper article slug/i);
    const target = reader.decodePublishedNewspaperAssociation(published, expected);
    await assert.rejects(reader.openNewspaperReader({ ...target, url: 'https://evil.example/news/story' }, async () => undefined), /invalid newspaper reader target/i);
  });

  it('calls the in-app browser with the canonical URL and reports open failures for retry', async () => {
    browserCalls.length = 0;
    const target = reader.decodePublishedNewspaperAssociation(published, expected);
    await reader.openNewspaperReader(target);
    assert.deepEqual(browserCalls, ['https://hockey-life.beerleaguehockey.ca/hockey-life/news/synthetic-published-edition']);
    await assert.rejects(reader.openNewspaperReader(target, async () => { throw new Error('synthetic browser failure'); }), /Couldn.t open the full newspaper/);
  });

  it('treats a resolved locked browser as retryable while ordinary results remain successful', async () => {
    const target = reader.decodePublishedNewspaperAssociation(published, expected);
    for (const type of ['opened', 'cancel', 'dismiss']) {
      await reader.openNewspaperReader(target, async () => ({ type }));
    }
    await assert.rejects(reader.openNewspaperReader(target, async () => ({ type: 'locked' })), /Couldn.t open the full newspaper/);
  });
});

type Deferred = { promise: Promise<void>; resolve(): void; reject(reason: Error): void };
function deferred(): Deferred {
  let resolve!: () => void; let reject!: (reason: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

type AssociationDeferred = {
  promise: Promise<any>;
  resolve(value: any): void;
};
function deferredAssociation(): AssociationDeferred {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(ok => { resolve = ok; });
  return { promise, resolve };
}

function focusController(initial: boolean) {
  let focused = initial;
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  return {
    isFocused: () => focused,
    addListener(event: 'focus' | 'blur', listener: () => void) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    setFocused(next: boolean) {
      if (focused === next) return;
      focused = next;
      for (const listener of listeners[next ? 'focus' : 'blur']) listener();
    },
    goBack() {},
  };
}

function retainedReader(key: string, initialFocus: boolean, shared: {
  lookups: Record<string, AssociationDeferred[]>;
  opens: string[];
}) {
  const harness = createHookHarness();
  const navigation = focusController(initialFocus);
  const target = { articleId: key, articleSlug: key.toLowerCase(), leagueId, url: `https://synthetic.invalid/${key}` };
  const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': { Image: 'Image', Linking: { openURL: async () => undefined }, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } },
    '../../components/Avatar': { __esModule: true, default: 'Avatar' },
    '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
    '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null },
    '../../lib/newspaperReader': {
      loadPublishedNewspaperReaderTarget: () => {
        const lookup = deferredAssociation();
        (shared.lookups[key] ??= []).push(lookup);
        return lookup.promise;
      },
      openNewspaperReader: () => { shared.opens.push(key); return Promise.resolve(); },
    },
    '../../theme/colors': { __esModule: true, default: {} },
    './LeaguePageCommon': {
      useLeaguePageScope: (value: unknown) => value,
      LeaguePageFrame: (props: any) => createElement('Frame', props, props.children),
      PageLoadState: 'Loading',
      commonStyles: { secondaryButton: {}, secondaryButtonText: {} },
    },
    './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: {
      id: key, slug: key.toLowerCase(), title: key, publishedAt: '2026-09-27T00:00:00Z', content: '', mentions: [], taggedPlayers: [], relatedGame: null,
    } } }) },
  }).default;
  harness.mount(() => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: key.toLowerCase() } }, navigation }));
  return { harness, navigation, target };
}

function mountedReader() {
  const harness = createHookHarness();
  const pending: Record<string, Deferred[]> = {};
  const opens: string[] = [];
  let current = 'A';
  const target = (key: string) => ({ articleId: key, articleSlug: key.toLowerCase(), leagueId, url: `https://synthetic.invalid/${key}` });
  const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': { Image: 'Image', Linking: { openURL: async () => undefined }, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } },
    '../../components/Avatar': { __esModule: true, default: 'Avatar' },
    '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
    '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null },
    '../../lib/newspaperReader': {
      loadPublishedNewspaperReaderTarget: async ({ articleId: key }: { articleId: string }) => target(key),
      openNewspaperReader: ({ articleId: key }: { articleId: string }) => {
        opens.push(key);
        const operation = deferred();
        (pending[key] ??= []).push(operation);
        return operation.promise;
      },
    },
    '../../theme/colors': { __esModule: true, default: {} },
    './LeaguePageCommon': {
      useLeaguePageScope: (value: unknown) => value,
      LeaguePageFrame: (props: any) => createElement('Frame', props, props.children),
      PageLoadState: 'Loading',
      commonStyles: { secondaryButton: {}, secondaryButtonText: {} },
    },
    './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: {
      id: current, slug: current.toLowerCase(), title: current, publishedAt: '2026-09-27T00:00:00Z', content: '', mentions: [], taggedPlayers: [], relatedGame: null,
    } } }) },
  }).default;
  const navigation = { isFocused: () => true, addListener: () => () => {}, goBack() {} };
  const root = () => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: current.toLowerCase() } }, navigation });
  harness.mount(root);
  return { harness, opens, pending, setCurrent(value: string) { current = value; harness.render(); } };
}

describe('mounted native newspaper reader lifecycle', () => {
  it('does not open A when its delayed association resolves beneath focused B', async () => {
    const shared = { lookups: {} as Record<string, AssociationDeferred[]>, opens: [] as string[] };
    const a = retainedReader('A', true, shared);
    a.navigation.setFocused(false); a.harness.render();
    const b = retainedReader('B', true, shared);
    shared.lookups.A[0].resolve(a.target); await flush(); a.harness.render(); b.harness.render();
    assert.deepEqual(shared.opens, []);
    shared.lookups.B[0].resolve(b.target); await flush(); a.harness.render(); b.harness.render();
    assert.deepEqual(shared.opens, ['B']);
  });

  it('invalidates old A and B lookups across A-to-B-to-A focus changes', async () => {
    const shared = { lookups: {} as Record<string, AssociationDeferred[]>, opens: [] as string[] };
    const a = retainedReader('A', true, shared);
    a.navigation.setFocused(false); a.harness.render();
    const b = retainedReader('B', true, shared);
    b.navigation.setFocused(false); b.harness.render();
    a.navigation.setFocused(true); a.harness.render();
    assert.equal(shared.lookups.A.length, 2);
    shared.lookups.A[0].resolve(a.target);
    shared.lookups.B[0].resolve(b.target);
    await flush(); a.harness.render(); b.harness.render();
    assert.deepEqual(shared.opens, []);
    shared.lookups.A[1].resolve(a.target); await flush(); a.harness.render(); b.harness.render();
    assert.deepEqual(shared.opens, ['A']);
  });

  it('does not open after unmount when association lookup is delayed', async () => {
    const shared = { lookups: {} as Record<string, AssociationDeferred[]>, opens: [] as string[] };
    const a = retainedReader('A', true, shared);
    a.harness.unmount();
    shared.lookups.A[0].resolve(a.target); await flush();
    assert.deepEqual(shared.opens, []);
  });

  it('ignores delayed A failure while B remains opening until B settles', async () => {
    const view = mountedReader(); await flush(); view.harness.render();
    view.setCurrent('B'); await flush(); view.harness.render();
    assert.deepEqual(view.opens, ['A', 'B']);
    view.pending.A[0].reject(new Error('STALE_A_BROWSER_FAILURE')); await flush(); view.harness.render();
    assert.match(nodeText(view.harness.output), /Opening newspaper/);
    assert.doesNotMatch(nodeText(view.harness.output), /STALE_A_BROWSER_FAILURE|Retry full newspaper/);
    assert.equal(findNode(view.harness.output, node => node.type === 'Pressable')?.props.disabled, true);
    view.pending.B[0].resolve(); await flush(); view.harness.render();
    assert.match(nodeText(view.harness.output), /Open full newspaper/);
  });

  it('ignores delayed A success while B remains opening', async () => {
    const view = mountedReader(); await flush(); view.harness.render();
    view.setCurrent('B'); await flush(); view.harness.render();
    view.pending.A[0].resolve(); await flush(); view.harness.render();
    assert.match(nodeText(view.harness.output), /Opening newspaper/);
    assert.equal(findNode(view.harness.output, node => node.type === 'Pressable')?.props.disabled, true);
    view.pending.B[0].resolve(); await flush();
  });

  it('invalidates pending updates on unmount', async () => {
    const view = mountedReader(); await flush(); view.harness.render();
    view.harness.unmount();
    const updates = view.harness.stateUpdateCount;
    view.pending.A[0].reject(new Error('AFTER_UNMOUNT')); await flush();
    assert.equal(view.harness.stateUpdateCount, updates);
  });

  it('keeps retries single-flight and supports ordinary error recovery', async () => {
    const view = mountedReader(); await flush(); view.harness.render();
    view.pending.A[0].reject(new Error('EXPECTED_OPEN_FAILURE')); await flush(); view.harness.render();
    assert.match(nodeText(view.harness.output), /EXPECTED_OPEN_FAILURE.*Retry full newspaper/);
    const retry = findNode(view.harness.output, node => node.type === 'Pressable');
    assert.ok(retry);
    retry.props.onPress(); retry.props.onPress();
    assert.deepEqual(view.opens, ['A', 'A']);
    view.harness.render();
    assert.match(nodeText(view.harness.output), /Opening newspaper/);
    view.pending.A[1].resolve(); await flush(); view.harness.render();
    assert.match(nodeText(view.harness.output), /Open full newspaper/);
    assert.doesNotMatch(nodeText(view.harness.output), /EXPECTED_OPEN_FAILURE|Retry full newspaper/);
  });
});
