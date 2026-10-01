/* eslint-disable @typescript-eslint/no-explicit-any -- focused native data/component harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

const leagueId = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const articleId = '11111111-1111-4111-8111-111111111111';
const expected = { articleId, articleSlug: 'hockey-life-times-2026-09-21-1df8f917', leagueId, leagueSlug: 'hockey-life' };

function edition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, title: 'Hockey Life Times', issueNumber: '42', leagueId, leagueName: 'Hockey Life', seasonId: 'season-1', seasonName: 'Fall 2026',
    periodStart: '2026-09-14', periodEnd: '2026-09-21', issuedAt: '2026-09-21T12:00:00-04:00', timezone: 'America/Toronto', stage: 'regular', status: 'published',
    lead: { headline: 'A long factual lead headline that reflows', dek: 'Every supplied fact remains readable.', body: ['Lead paragraph one.', 'Lead paragraph two.'], imageUrl: 'https://images.test/lead.jpg', caption: 'Lead caption.' },
    games: [{ gameId: 'game-1', homeTeam: { id: 'home', name: 'Home Club', logoUrl: 'https://images.test/home.png' }, awayTeam: { id: 'away', name: 'Away Club' }, homeScore: 9, awayScore: 3, headline: 'Recorded final', body: ['Game paragraph.'], imageUrl: 'https://images.test/game.jpg', contributors: [{ playerId: 'p1', name: 'Player One', teamName: 'Home Club', goals: 2, assists: 1, points: 3 }] }],
    stars: [1, 2, 3].map((rank) => ({ playerId: `star-${rank}`, name: `Star ${rank}`, teamName: 'Home Club', goals: rank, assists: 0, points: rank, reason: `Reason ${rank}.`, photoUrl: rank === 1 ? 'https://images.test/star.jpg' : undefined })),
    numbers: [{ label: 'Goals scored', value: '12', detail: 'Across the recorded games.' }],
    standings: [{ teamId: 'home', name: 'Home Club', logoUrl: 'https://images.test/home.png', gp: 4, w: 3, l: 1, otl: 0, t: 0, pts: 6, gf: 20, ga: 11 }],
    standingsNote: 'Official supplied table.', hot: [{ headline: 'The heater', body: 'Hot body.', imageUrl: 'https://images.test/hot.jpg' }], cold: [{ headline: 'The cold tub', body: 'Cold body.' }],
    upcoming: [{ gameId: 'next-1', homeName: 'Home Club', awayName: 'Away Club', scheduledAt: '2026-09-28T20:00:00-04:00', venue: 'Rink One', headline: 'Next test', body: 'Upcoming body.' }], upcomingNote: '',
    aroundRink: [{ headline: 'Around the rink', body: 'Around body.' }], source: { gameIds: ['game-1'], verifiedAt: '2026-09-21T12:00:00-04:00', standingsAsOf: '2026-09-21', warnings: ['One disclosed warning.'] },
    ...overrides,
  };
}

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

describe('published newspaper structured read contract', () => {
  it('queries the exact published association and validates the complete canonical payload', async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const query: any = {
      select(value: string) { calls.push(['select', value]); return query; },
      eq(column: string, value: string) { calls.push(['eq', column, value]); return query; },
      maybeSingle: async () => ({ data: { article_id: articleId, league_id: leagueId, status: 'published', published_at: '2026-09-21T12:00:00Z', edition_json: edition() }, error: null }),
    };
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': {
      get supabase() { throw new Error('session client must not be accessed'); },
      publicSupabase: { from(table: string) { calls.push(['from', table]); return query; } },
    } });
    const result = await reader.loadPublishedNewspaperEdition(expected);
    assert.equal(result.status, 'ready');
    assert.equal(result.edition.lead.body[1], 'Lead paragraph two.');
    assert.deepEqual(calls, [['from', 'newspaper_editions'], ['select', 'article_id,league_id,status,published_at,edition_json'], ['eq', 'article_id', articleId], ['eq', 'league_id', leagueId], ['eq', 'status', 'published']]);
  });

  it('distinguishes no edition from lookup failure and rejects malformed, draft, cross-league, and unsafe-media payloads', async () => {
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
    assert.deepEqual(await reader.loadPublishedNewspaperEdition(expected, async () => ({ data: null, error: null })), { status: 'unavailable' });
    assert.equal((await reader.loadPublishedNewspaperEdition(expected, async () => ({ data: null, error: { message: 'read denied' } }))).status, 'error');
    for (const row of [
      { article_id: articleId, league_id: leagueId, status: 'draft', published_at: null, edition_json: edition({ status: 'draft' }) },
      { article_id: articleId, league_id: '22222222-2222-4222-8222-222222222222', status: 'published', published_at: '2026-09-21T12:00:00Z', edition_json: edition() },
      { article_id: articleId, league_id: leagueId, status: 'published', published_at: '2026-09-21T12:00:00Z', edition_json: edition({ lead: { ...(edition().lead as object), imageUrl: 'javascript:alert(1)' } }) },
      { article_id: articleId, league_id: leagueId, status: 'published', published_at: '2026-09-21T12:00:00Z', edition_json: { title: 'partial' } },
    ]) assert.equal((await reader.loadPublishedNewspaperEdition(expected, async () => ({ data: row, error: null }))).status, 'error');
    let queried = false;
    assert.deepEqual(await reader.loadPublishedNewspaperEdition({ ...expected, leagueId: '22222222-2222-4222-8222-222222222222' }, async () => { queried = true; return { data: null, error: null }; }), { status: 'unavailable' });
    assert.equal(queried, false);
  });
});

describe('native newspaper edition composition', () => {
  it('renders the full ordered edition with responsive media and no browser/PDF controls', () => {
    const harness = createHookHarness();
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgElevated: '#222', glassStroke: '#333' } },
    }).default;
    const tree = harness.mount(() => NativeEdition({ edition: edition(), accentColor: '#1F6A44' }));
    const text = nodeText(tree);
    const ordered = ['ISSUE 42', 'Hockey Life Times', 'A long factual lead headline that reflows', 'Lead paragraph one.', 'This Week on the Ice', 'Recorded final', 'Three Stars of the Week', 'Star 3', 'This Week by the Numbers', 'Standings', 'Official supplied table.', 'The Heater', 'Hot body.', 'The Cold Tub', 'Cold body.', 'Next Week', 'Upcoming body.', 'Around the Rink', 'Around body.', 'Source Notes', 'One disclosed warning.'];
    let cursor = -1;
    for (const value of ordered) { const next = text.indexOf(value); assert.ok(next > cursor, `${value} stays in source order`); cursor = next; }
    assert.equal(allNodes(tree).filter((node) => node.type === 'Image').length, 6);
    const wideMedia = allNodes(tree).filter((node) => node.type === 'Image' && node.props.source?.uri !== 'https://images.test/home.png');
    assert.equal(wideMedia.length, 4);
    for (const image of wideMedia) assert.equal(flattenStyle(image.props.style).aspectRatio > 0, true);
    assert.doesNotMatch(text, /Zoom|Download|Print|Page \d+ of|Open.*browser/i);
  });
});

describe('mounted native article reader state', () => {
  it('never invokes an OS/browser opener and ignores stale A after route B wins', async () => {
    const harness = createHookHarness();
    const pending = new Map<string, (value: unknown) => void>();
    let current = 'A'; const browserCalls: string[] = [];
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Linking: { openURL: async (url: string) => { browserCalls.push(url); } }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
      '../../components/NativeNewspaperEdition': { __esModule: true, default: ({ edition: value }: any) => createElement('NativeEdition', { edition: value }, value.lead.headline) },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'fallback body' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: ({ articleId: id }: any) => new Promise((resolve) => pending.set(id, resolve)) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) },
      '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: current, slug: current.toLowerCase(), title: current, publishedAt: '2026-09-21T12:00:00Z', content: 'fallback body', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
    }).default;
    const navigation = { goBack() {}, navigate() {}, push() {} };
    const root = () => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: current.toLowerCase() } }, navigation });
    harness.mount(root);
    current = 'B'; harness.render();
    pending.get('A')?.({ status: 'ready', edition: edition({ lead: { ...(edition().lead as object), headline: 'STALE A' } }) });
    await new Promise<void>((resolve) => setImmediate(resolve)); harness.render();
    assert.doesNotMatch(nodeText(harness.output), /STALE A/);
    pending.get('B')?.({ status: 'ready', edition: edition({ lead: { ...(edition().lead as object), headline: 'CURRENT B' } }) });
    await new Promise<void>((resolve) => setImmediate(resolve)); harness.render();
    assert.match(nodeText(harness.output), /CURRENT B/);
    assert.deepEqual(browserCalls, []);
    harness.unmount();
  });

  it('renders a lookup failure, retries explicitly, and falls back to article text only after success says unavailable', async () => {
    const harness = createHookHarness();
    let attempts = 0;
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Linking: { openURL: async () => { throw new Error('not called'); } }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
      '../../components/NativeNewspaperEdition': { __esModule: true, default: 'NativeEdition' },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'Complete fallback article body.' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => (++attempts === 1 ? { status: 'error', message: 'Edition lookup failed.' } : { status: 'unavailable' }) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) },
      '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: articleId, slug: expected.articleSlug, title: 'Fallback title', publishedAt: '2026-09-21T12:00:00Z', content: 'Complete fallback article body.', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
    }).default;
    const root = () => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: expected.articleSlug } }, navigation: { goBack() {}, navigate() {}, push() {} } });
    harness.mount(root);
    await new Promise<void>((resolve) => setImmediate(resolve));
    let output = harness.render();
    assert.match(nodeText(output), /Edition lookup failed/);
    assert.doesNotMatch(nodeText(output), /Complete fallback article body/);
    findNode(output, (node) => node.props.accessibilityLabel === 'Retry newspaper edition')!.props.onPress();
    harness.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    output = harness.render();
    assert.equal(attempts, 2);
    assert.match(nodeText(output), /Complete fallback article body/);
  });

  it('does not commit a pending edition after unmount', async () => {
    const harness = createHookHarness();
    let release!: (value: unknown) => void;
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Linking: { openURL: async () => undefined }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' }, '../../components/NativeNewspaperEdition': { __esModule: true, default: 'NativeEdition' },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: () => new Promise((resolve) => { release = resolve; }) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: articleId, slug: expected.articleSlug, title: 'Unmounted', publishedAt: '2026-09-21T12:00:00Z', content: '', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
    }).default;
    harness.mount(() => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: expected.articleSlug } }, navigation: { goBack() {}, navigate() {}, push() {} } }));
    const updatesBeforeUnmount = harness.stateUpdateCount;
    harness.unmount();
    release({ status: 'ready', edition: edition() });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
