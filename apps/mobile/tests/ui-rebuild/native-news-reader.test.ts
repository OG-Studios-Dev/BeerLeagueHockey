/* eslint-disable @typescript-eslint/no-explicit-any -- focused native data/component harness */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

const leagueId = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const articleId = '11111111-1111-4111-8111-111111111111';
const expected = { articleId, articleSlug: 'hockey-life-times-2026-09-21-1df8f917', leagueId, leagueSlug: 'hockey-life' };
const publicRow = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/newspaper-public-edition-row.json', import.meta.url).href), 'utf8'));
const screenManifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/rebuild/screen-manifest.json', import.meta.url).href), 'utf8'));

function mountedReactRuntime() {
  const require = createRequire(import.meta.url);
  const pnpmDirectory = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
  const jsdomEntry = readdirSync(pnpmDirectory).find((entry) => entry.startsWith('jsdom@'));
  assert.ok(jsdomEntry, 'the frozen workspace lockfile must provision jsdom for mounted lifecycle tests');
  const requireJsdom = createRequire(`${pnpmDirectory}${jsdomEntry}/node_modules/jsdom/package.json`);
  return { React: require('react'), createRoot: require('react-dom/client').createRoot, JSDOM: requireJsdom('jsdom').JSDOM };
}

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
      abortSignal(signal: AbortSignal) { calls.push(['abortSignal', signal.aborted]); return query; },
      maybeSingle: async () => ({ data: { article_id: articleId, league_id: leagueId, status: 'published', published_at: '2026-09-21T12:00:00Z', edition_json: edition() }, error: null }),
    };
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': {
      get supabase() { throw new Error('session client must not be accessed'); },
      publicSupabase: { from(table: string) { calls.push(['from', table]); return query; } },
    } });
    const result = await reader.loadPublishedNewspaperEdition(expected);
    assert.equal(result.status, 'ready');
    assert.equal(result.edition.lead.body[1], 'Lead paragraph two.');
    assert.deepEqual(calls, [['from', 'newspaper_editions'], ['select', 'article_id,league_id,status,published_at,edition_json'], ['eq', 'article_id', articleId], ['eq', 'league_id', leagueId], ['eq', 'status', 'published'], ['abortSignal', false]]);
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

  it('enforces the 512 KiB ceiling in UTF-8 bytes with and without TextEncoder', () => {
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
    const exact = 'a'.repeat(reader.MAX_PAYLOAD_BYTES - 2);
    assert.equal(reader.serializedUtf8ByteLength(exact), reader.MAX_PAYLOAD_BYTES);
    assert.equal(reader.serializedUtf8ByteLength(`${exact}a`), reader.MAX_PAYLOAD_BYTES + 1);
    assert.equal(reader.utf8ByteLength('😀é', null), 6);
    const boundary = structuredClone(publicRow.edition_json);
    boundary.lead.body = Array.from({ length: 11 }, () => 'x');
    let remaining = reader.MAX_PAYLOAD_BYTES - reader.serializedUtf8ByteLength(boundary);
    for (let index = 0; remaining > 0; index += 1) {
      const addition = Math.min(49999, remaining);
      boundary.lead.body[index] += 'a'.repeat(addition); remaining -= addition;
    }
    assert.equal(reader.serializedUtf8ByteLength(boundary), reader.MAX_PAYLOAD_BYTES);
    assert.doesNotThrow(() => reader.validatePublishedNewspaperEdition(boundary, leagueId));
    boundary.lead.body[10] += 'b';
    assert.throws(() => reader.validatePublishedNewspaperEdition(boundary, leagueId), /size limit/);
    const oversized = structuredClone(publicRow.edition_json);
    oversized.lead.body = Array.from({ length: 6 }, () => '😀'.repeat(22000));
    assert.throws(() => reader.validatePublishedNewspaperEdition(oversized, leagueId), /size limit/);
  });

  it('accepts the actual producer payload and resolves trusted root-relative media only', () => {
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
    const actual = structuredClone(publicRow.edition_json);
    actual.lead.imageUrl = '/approved/relative.png';
    const decoded = reader.validatePublishedNewspaperEdition(actual, leagueId);
    assert.equal(decoded.lead.imageUrl, 'https://hockey-life.beerleaguehockey.ca/approved/relative.png');
    for (const unsafe of ['//evil.test/image.png', 'javascript:alert(1)', '/\\evil.test/image.png']) {
      const payload = structuredClone(publicRow.edition_json); payload.lead.imageUrl = unsafe;
      assert.throws(() => reader.validatePublishedNewspaperEdition(payload, leagueId), /media URL/);
    }
  });

  it('times out an unsettled lookup, absorbs late completion, and permits a fresh retry', async () => {
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
    let lateResolve!: (value: any) => void;
    const hanging = new Promise(resolve => { lateResolve = resolve; });
    const timedOut = await reader.loadPublishedNewspaperEdition(expected, () => hanging, { timeoutMs: 5 });
    assert.equal(timedOut.status, 'error');
    lateResolve({ data: publicRow, error: null });
    await new Promise<void>(resolve => setImmediate(resolve));
    const external = new AbortController(); let transportSignal: AbortSignal | undefined;
    const cancelled = reader.loadPublishedNewspaperEdition(expected, (_article: string, _league: string, signal: AbortSignal) => { transportSignal = signal; return new Promise(() => {}); }, { timeoutMs: 1000, signal: external.signal });
    external.abort();
    assert.equal((await cancelled).status, 'error'); assert.equal(transportSignal?.aborted, true);
    const publicExpected = { ...expected, articleId: publicRow.article_id };
    const retried = await reader.loadPublishedNewspaperEdition(publicExpected, async () => ({ data: publicRow, error: null }), { timeoutMs: 50 });
    assert.equal(retried.status, 'ready');
  });
});

describe('news article evidence contract', () => {
  it('names every independently confirmed visual blocker in the manifest gate', () => {
    const newsArticle = screenManifest.screens.find((screen: any) => screen.id === 'news-article');
    assert.ok(newsArticle);
    assert.equal(newsArticle.status, 'review');
    assert.deepEqual(newsArticle.evidence, { sourceImplemented: true, browserReviewed: true, iosDeviceAccepted: false });
    for (const assertion of [
      'page-five direct-section flow has no sibling or descendant overlap at 320, 390, and 430 points plus enlarged long content',
      'reader-safe Source Notes omit raw IDs, hashes, timestamps, schema fields, and warning payloads',
      'article title keeps whole words and a 44-point Share action at normal and narrow enlarged text',
      'drop-cap exposes one complete paragraph label without duplicate fragment announcements',
      'browser evidence binds all changed source hashes and the complete candidate diff including untracked source',
    ]) assert.ok(newsArticle.acceptanceTests.includes(assertion), `manifest must require: ${assertion}`);
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
    const ordered = ['ISSUE 42', 'Hockey Life Times', 'A LONG FACTUAL LEAD HEADLINE THAT REFLOWS', 'Lead paragraph one.', 'RECORDED FINAL', 'THIS WEEK ON THE ICE', 'Names on the scoresheet', 'THREE STARS OF THE WEEK', 'STAR 3', 'THIS WEEK BY THE NUMBERS', 'STANDINGS', 'Official supplied table.', 'THE HEATER', 'Hot body.', 'THE COLD TUB', 'Cold body.', 'NEXT WEEK', 'Upcoming body.', 'Around body.', 'SOURCE NOTES', '1 source-review note was reviewed.'];
    let cursor = -1;
    for (const value of ordered) { const next = text.indexOf(value); assert.ok(next > cursor, `${value} stays in source order`); cursor = next; }
    assert.equal(allNodes(tree).filter((node) => node.type === 'Image').length, 7);
    const wideMedia = allNodes(tree).filter((node) => node.type === 'Image' && node.props.source?.uri !== 'https://images.test/home.png');
    assert.equal(wideMedia.length, 4);
    for (const image of wideMedia) assert.equal(flattenStyle(image.props.style).aspectRatio > 0, true);
    assert.doesNotMatch(text, /Zoom|Download|Print|Open.*browser/i);
  });

  it('composes the validated facts as five sharp newspaper sheets with a complete front page', () => {
    const harness = createHookHarness();
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Platform: { select: (value: Record<string, unknown>) => value.ios ?? value.default }, StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../theme/colors': { __esModule: true, default: { bgMedia: '#111' } },
    }).default;
    const tree = harness.mount(() => NativeEdition({ edition: edition(), accentColor: '#1F6A44' }));
    const pages = allNodes(tree).filter((node) => /^newspaper-page-[1-5]$/.test(node.props.testID ?? ''));
    assert.equal(pages.length, 5);
    pages.forEach((page, index) => {
      assert.equal(page.props.accessibilityLabel, `Newspaper page ${index + 1} of 5`);
      assert.equal(flattenStyle(page.props.style).backgroundColor, '#252522');
      const paper = findNode(page, (node) => node.props.testID === `newspaper-page-paper-${index + 1}`)!;
      assert.equal(flattenStyle(paper.props.style).backgroundColor, '#F2EAD8');
      assert.equal(flattenStyle(paper.props.style).borderRadius ?? 0, 0);
      assert.match(nodeText(page), new RegExp(`PAGE ${index + 1} OF 5`));
    });

    const front = pages[0]!;
    const frontText = nodeText(front);
    for (const fact of [
      'ISSUE 42', 'THE LEAGUE’S INDEPENDENT RECORD', '2026-09-14 — 2026-09-21', 'Hockey Life Times',
      'BEER LEAGUE NEWS · FROZEN FACTS · HOT TAKES', 'HOCKEY LIFE', 'FALL 2026', 'THE WEEK ON ICE',
      'STARS & SCARS', 'NUMBERS THAT HURT', 'AROUND THE RINK', 'EXTRA',
      'A LONG FACTUAL LEAD HEADLINE THAT REFLOWS', 'Every supplied fact remains readable.', 'THE BIG STORY',
      'Lead paragraph one.', 'RECORDED FINAL', 'IN THIS ISSUE', 'HOCKEY LIFE · FALL 2026',
    ]) assert.match(frontText, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(allNodes(front).filter((node) => node.props.testID === 'front-score-teaser').length, 1);
    assert.ok(findNode(front, (node) => node.props.testID === 'page-1-lead-paragraph-0'));

    const remaining = pages.slice(1).map(nodeText);
    assert.match(remaining[0]!, /THIS WEEK ON THE ICE.*RECORDED FINAL.*Names on the scoresheet.*Player One/s);
    assert.match(remaining[1]!, /THREE STARS OF THE WEEK.*STAR 3.*THIS WEEK BY THE NUMBERS.*GOALS SCORED/s);
    assert.match(remaining[2]!, /STANDINGS.*Home Club.*THE HEATER.*Hot body.*THE COLD TUB.*Cold body/s);
    assert.match(remaining[3]!, /NEXT WEEK.*Upcoming body.*AROUND THE RINK.*Around body.*SOURCE NOTES.*Verified against 1 finalized game record\..*1 source-review note was reviewed\./s);
    assert.doesNotMatch(JSON.stringify(allNodes(tree).map((node) => flattenStyle(node.props.style))), /#1F6A44/i);
    for (const node of allNodes(tree).filter((candidate) => candidate.type === 'Text')) {
      assert.equal(node.props.numberOfLines, undefined);
      assert.equal(node.props.ellipsizeMode, undefined);
    }
  });

  it('lets page-five Around the Rink grow in natural flow before Source Notes', () => {
    const harness = createHookHarness();
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../theme/colors': { __esModule: true, default: { bgMedia: '#111' } },
    }).default;
    const longBody = 'Every Around the Rink detail remains readable and takes the natural height it needs. '.repeat(12);
    const value = edition({
      aroundRink: [
        { headline: 'A long first rink brief', body: longBody },
        { headline: 'A long second rink brief', body: longBody },
      ],
    });
    const tree = harness.mount(() => NativeEdition({ edition: value }));
    const pageBody = findNode(tree, (node) => node.props.testID === 'newspaper-page-body-5');
    const around = findNode(tree, (node) => node.props.testID === 'page-5-around-rink');
    const sourceNotes = findNode(tree, (node) => node.props.testID === 'page-5-source-notes');
    assert.ok(pageBody, 'page 5 exposes its direct-section flow boundary for geometry acceptance');
    assert.ok(around, 'Around the Rink has a page-specific natural-flow container');
    assert.ok(sourceNotes, 'Source Notes is the following page-5 section');
    const aroundStyle = flattenStyle(around.props.style);
    assert.equal(aroundStyle.flexBasis, undefined);
    assert.equal(aroundStyle.flexGrow ?? 0, 0);
    assert.equal(aroundStyle.flexShrink ?? 0, 0);
    assert.equal(aroundStyle.width, '100%');
    assert.match(nodeText(around), /A LONG FIRST RINK BRIEF.*A LONG SECOND RINK BRIEF/s);
    const directChildren = Array.isArray(pageBody.props.children) ? pageBody.props.children : [pageBody.props.children];
    assert.ok(directChildren.indexOf(around) < directChildren.indexOf(sourceNotes));
  });

  it('renders only a reader-safe data-driven source summary', () => {
    const harness = createHookHarness();
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../theme/colors': { __esModule: true, default: { bgMedia: '#111' } },
    }).default;
    const fixtureEdition: any = structuredClone(publicRow.edition_json);
    let tree = harness.mount(() => NativeEdition({ edition: fixtureEdition }));
    let text = nodeText(tree);
    assert.match(text, /Verified against 2 finalized game records\./);
    assert.match(text, /9 source-review notes were reviewed\./);
    for (const rawValue of [
      ...fixtureEdition.source.gameIds,
      fixtureEdition.source.factPackDigest,
      fixtureEdition.source.verifiedAt,
      ...fixtureEdition.source.warnings,
      'scorekeeper_verified=false',
      'champion_team_id',
      'goalie_stats',
      'lock timestamps null',
    ]) assert.doesNotMatch(text, new RegExp(String(rawValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

    fixtureEdition.source.standingsAsOf = '2026-09-27';
    tree = harness.mount(() => NativeEdition({ edition: fixtureEdition }));
    text = nodeText(tree);
    assert.match(text, /Standings current to 2026-09-27\./);
    assert.doesNotMatch(text, /2026-09-27T14:40:16\.653538\+00:00/);
  });

  it('owns every dimension and native-error callback for exactly one mounted URI lifetime', async () => {
    const { React, createRoot, JSDOM } = mountedReactRuntime();
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      type Pending = { success(width: number, height: number): void; failure(): void };
      const pending = new Map<string, Pending[]>(); const rendered = new Map<string, any[]>();
      const Image = Object.assign((props: any) => {
        const values = rendered.get(props.source.uri) ?? []; values.push(props); rendered.set(props.source.uri, values);
        const style = flattenStyle(props.style);
        return React.createElement('img', { 'aria-label': props.accessibilityLabel, 'data-uri': props.source.uri, 'data-ratio': String(style.aspectRatio), 'data-resize': props.resizeMode });
      }, { getSize: (uri: string, success: Pending['success'], failure: Pending['failure']) => pending.set(uri, [...(pending.get(uri) ?? []), { success, failure }]) });
      const component = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
        react: React, 'react-native': { Image, StyleSheet: { create: <T>(value: T) => value }, Text: ({ children }: any) => React.createElement('span', null, children), View: ({ children, accessibilityLabel }: any) => React.createElement('div', { 'aria-label': accessibilityLabel }, children) }, '../theme/colors': { __esModule: true, default: { bgElevated: '#222' } },
      });
      const container = dom.window.document.getElementById('root')!; const root = createRoot(container);
      let uri: string | undefined = 'https://images.test/A.jpg'; let label = 'Editorial art';
      const draw = () => React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(component.Artwork, { uri, label }))));
      const settle = (callback: () => void) => React.act(async () => { callback(); await Promise.resolve(); });
      const image = () => container.querySelector('img') as HTMLElement | null;
      const ratio = () => Number(image()!.dataset.ratio);
      const unavailable = () => /UNAVAILABLE/.test(container.textContent ?? '');

      await draw(); assert.equal(ratio(), 1); assert.equal(image()!.dataset.resize, 'contain');
      const oldARequest = pending.get(uri)!.at(-1)!; const oldAError = rendered.get(uri)!.at(-1)!.onError;
      await settle(() => oldARequest.success(1254, 1254)); assert.equal(ratio(), 1);
      label = 'Same URI'; await draw(); assert.equal(ratio(), 1);

      uri = 'https://images.test/B.jpg'; await draw(); const bRequest = pending.get(uri)!.at(-1)!;
      await settle(() => bRequest.success(3, 4)); assert.equal(ratio(), 3 / 4);
      await settle(oldAError); assert.equal(ratio(), 3 / 4); assert.equal(image()!.dataset.uri, uri);
      const bError = rendered.get(uri)!.at(-1)!.onError; await settle(bError); assert.equal(unavailable(), true);
      await settle(() => bRequest.success(5, 4)); assert.equal(unavailable(), true);
      await settle(oldAError); assert.equal(unavailable(), true);

      uri = 'https://images.test/failure-then-success.jpg'; await draw(); const failureFirst = pending.get(uri)!.at(-1)!;
      await settle(failureFirst.failure); await settle(() => failureFirst.success(4, 3)); assert.equal(unavailable(), true);
      uri = 'https://images.test/success-then-error.jpg'; await draw(); const successFirst = pending.get(uri)!.at(-1)!;
      await settle(() => successFirst.success(4, 3)); assert.equal(ratio(), 4 / 3);
      await settle(rendered.get(uri)!.at(-1)!.onError); assert.equal(unavailable(), true);

      uri = 'https://images.test/invalid.jpg'; await draw(); const invalid = pending.get(uri)!.at(-1)!;
      await settle(() => invalid.success(0, 4)); assert.equal(ratio(), 1);
      await settle(() => invalid.success(Number.NaN, 4)); assert.equal(ratio(), 1);

      uri = 'https://images.test/A.jpg'; await draw(); const newARequest = pending.get(uri)!.at(-1)!;
      await settle(() => newARequest.success(2, 1)); assert.equal(ratio(), 2);
      await settle(() => { oldAError(); oldARequest.success(1, 9); oldARequest.failure(); }); assert.equal(ratio(), 2);
      const newAError = rendered.get(uri)!.at(-1)!.onError; await settle(newAError); assert.equal(unavailable(), true);
      await settle(oldAError); assert.equal(unavailable(), true);

      uri = undefined; await draw(); assert.match(container.textContent ?? '', /HOCKEY LIFETIMES/); assert.equal(image(), null);
      uri = 'https://images.test/future.jpg'; await draw(); assert.equal(ratio(), 1);
      const futureRequest = pending.get(uri)!.at(-1)!; const futureError = rendered.get(uri)!.at(-1)!.onError;
      await settle(() => futureRequest.success(4, 1)); assert.equal(ratio(), 4);
      await React.act(async () => root.unmount());
      await settle(() => { futureRequest.failure(); futureRequest.success(1, 4); futureError(); });
      assert.equal(container.childNodes.length, 0);
    } finally {
      dom.window.close(); Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
  });

  it('keeps early artwork errors terminal before passive initialization on mount and URI transition', async () => {
    const { React, createRoot, JSDOM } = mountedReactRuntime();
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const early = new Set<string>();
      const dimensions = new Map<string, { success(width: number, height: number): void; failure(): void }>();
      const Image = Object.assign((props: any) => {
        const imageUri = props.source.uri; const onError = props.onError;
        React.useLayoutEffect(() => { if (early.has(imageUri)) onError(); }, [imageUri, onError]);
        return React.createElement('img', { 'data-uri': imageUri });
      }, { getSize: (uri: string, success: (width: number, height: number) => void, failure: () => void) => dimensions.set(uri, { success, failure }) });
      const component = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
        react: React, 'react-native': { Image, StyleSheet: { create: <T>(value: T) => value }, Text: ({ children }: any) => React.createElement('span', null, children), View: ({ children, accessibilityLabel }: any) => React.createElement('div', { 'aria-label': accessibilityLabel }, children) }, '../theme/colors': { __esModule: true, default: { bgElevated: '#222' } },
      });
      let uri = 'https://images.test/initial.jpg';
      const root = createRoot(dom.window.document.getElementById('root')!);
      const draw = () => React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(component.Artwork, { uri, label: 'Art' }))));
      early.add(uri); await draw(); assert.match(dom.window.document.body.textContent ?? '', /UNAVAILABLE/);
      early.clear(); uri = 'https://images.test/good.jpg'; await draw();
      await React.act(async () => { dimensions.get(uri)?.success(1, 1); await Promise.resolve(); });
      uri = 'https://images.test/transition.jpg'; early.add(uri); await draw();
      assert.match(dom.window.document.body.textContent ?? '', /UNAVAILABLE/);
      await React.act(async () => root.unmount());
    } finally {
      dom.window.close(); Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
  });

  it('formats fixtures with the edition timezone across the New Year and DST boundaries', () => {
    const component = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: createHookHarness().react, 'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' }, '../theme/colors': { __esModule: true, default: {} },
    });
    assert.equal(component.formatEditionScheduled('2026-01-01T01:30:00Z', 'America/Toronto'), 'Dec 31, 2025 · 20:30');
    assert.equal(component.formatEditionScheduled('2026-03-08T07:30:00Z', 'America/Toronto'), 'Mar 8, 2026 · 03:30');
  });

  it('exposes each drop-cap paragraph as one complete accessible sentence', () => {
    const harness = createHookHarness();
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../theme/colors': { __esModule: true, default: { bgMedia: '#111' } },
    }).default;
    const fixtureEdition: any = structuredClone(publicRow.edition_json);
    const completeParagraph = fixtureEdition.lead.body[0];
    const tree = harness.mount(() => NativeEdition({ edition: fixtureEdition }));
    const paragraph = findNode(tree, (node) => node.props.testID === 'page-1-lead-paragraph-0')!;
    assert.ok(paragraph);
    assert.equal(paragraph.props.accessible, true);
    assert.equal(paragraph.props.accessibilityLabel, completeParagraph);
    assert.equal(nodeText(paragraph), completeParagraph);
    const letter = findNode(paragraph, (node) => node.props.testID === 'page-1-lead-drop-cap-0')!;
    const remainder = findNode(paragraph, (node) => node.props.testID === 'page-1-lead-remainder-0')!;
    for (const fragment of [letter, remainder]) {
      assert.ok(fragment);
      assert.equal(fragment.props.accessible, false);
      assert.equal(fragment.props.accessibilityElementsHidden, true);
      assert.equal(fragment.props['aria-hidden'], true);
      assert.equal(fragment.props.importantForAccessibility, 'no-hide-descendants');
      assert.equal(fragment.props.accessibilityLabel, undefined);
    }
  });

  it('keeps the complete article copy mounted when editorial image loading fails', () => {
    const harness = createHookHarness();
    const Image = Object.assign((props: any) => createElement('Image', props), { getSize() {} });
    const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
      react: harness.react, 'react-native': { Image, StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' }, '../theme/colors': { __esModule: true, default: { bgElevated: '#222' } },
    }).default;
    let output = harness.mount(() => NativeEdition({ edition: edition(), accentColor: '#1F6A44' }));
    findNode(output, node => node.type === 'Image' && node.props.accessibilityLabel === 'A long factual lead headline that reflows')!.props.onError();
    output = harness.render();
    assert.match(nodeText(output), /Lead paragraph one.*Lead paragraph two.*1 source-review note was reviewed\./s);
    assert.ok(findNode(output, node => node.props.accessibilityLabel === 'A long factual lead headline that reflows; artwork unavailable'));
  });
});

describe('responsive article title and Share header', () => {
  function renderHeader(width: number, fontScale: number) {
    const harness = createHookHarness();
    const Header = compileCommonJs<any>(new URL('../../src/components/NewsArticleHeader.tsx', import.meta.url), {
      react: harness.react,
      '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicons', props) },
      'react-native': {
        Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View',
        useWindowDimensions: () => ({ width, height: 844, fontScale, scale: 1 }),
      },
      '../theme/colors': { __esModule: true, default: { buttonDefault: '#22D3EE', textOnPrimary: '#02111B', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8' } },
    }).default;
    return harness.mount(() => Header({
      title: 'HLT: Week 2 - Fall 2026 — Complete Long-Headline Accessibility Edition',
      publishedAt: '2026-10-05T12:00:00-04:00',
      authorName: 'Hockey Life',
      shareUrl: 'https://hockey-life.example/article',
      onShare() {},
    }));
  }

  it('stacks Share for narrow enlarged text while preserving the normal same-row header', () => {
    const normal = renderHeader(320, 1);
    const normalHeader = findNode(normal, (node) => node.props.testID === 'article-newspaper-header')!;
    const normalShare = findNode(normal, (node) => node.props.accessibilityLabel === 'Share article')!;
    assert.equal(flattenStyle(normalHeader.props.style).flexDirection, 'row');
    assert.equal(flattenStyle(normalShare.props.style).alignSelf, undefined);

    for (const width of [320, 390]) {
      const enlarged = renderHeader(width, 1.3);
      const header = findNode(enlarged, (node) => node.props.testID === 'article-newspaper-header')!;
      const title = findNode(enlarged, (node) => node.props.testID === 'article-title')!;
      const share = findNode(enlarged, (node) => node.props.accessibilityLabel === 'Share article')!;
      assert.equal(flattenStyle(header.props.style).flexDirection, 'column');
      assert.equal(flattenStyle(share.props.style).alignSelf, 'flex-end');
      assert.equal(title.props.numberOfLines, undefined);
      assert.equal(title.props.ellipsizeMode, undefined);
      assert.ok(flattenStyle(share.props.style).minWidth >= 44);
      assert.ok(flattenStyle(share.props.style).minHeight >= 44);
      assert.match(nodeText(share), /Share/);
      assert.ok(findNode(share, (node) => node.type === 'Ionicons' && node.props.name === 'share-outline'));
    }
  });
});

describe('mounted native article reader state', () => {
  it('shares the loaded article with platform-correct canonical payloads and one sheet per article', async () => {
    const harness = createHookHarness();
    const platform = { OS: 'ios' };
    const shareCalls: Array<{ title?: string; message?: string; url?: string }> = [];
    const pending: Array<{ resolve: (value: unknown) => void; reject: (reason: Error) => void }> = [];
    const share = (payload: { title?: string; message?: string; url?: string }) => {
      shareCalls.push(payload);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    let current: { id: string; slug: string; title: string } | null = null;
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicons', props) },
      'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Linking: { openURL: async () => undefined }, Platform: platform, Share: { share }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' },
      '../../components/NativeNewspaperEdition': { __esModule: true, default: (props: any) => createElement('NativeEdition', props) },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null, publicArticleUrl: (leagueSlug: string, articleSlug: string) => `https://${leagueSlug}.beerleaguehockey.ca/${leagueSlug}/news/${articleSlug}` },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => ({ status: 'ready', edition: edition() }) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: { buttonDefault: '#22D3EE', textOnPrimary: '#02111B', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8' } },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => current
        ? ({ loading: false, error: null, retry() {}, data: { article: { ...current, publishedAt: '2026-09-28T12:00:00Z', content: '', mentions: [], taggedPlayers: [], relatedGame: null } } })
        : ({ loading: true, error: null, retry() {}, data: null }) },
    }).default;
    const navigation = { goBack() {}, navigate() {}, push() {} };
    const root = () => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: current?.slug ?? expected.articleSlug } }, navigation });
    harness.mount(root);
    assert.equal(findNode(harness.output, (node) => node.props.accessibilityLabel === 'Share article'), undefined);
    current = { id: articleId, slug: 'hockey-life-times-2026-09-28-145ac7ee', title: 'Hockey Life Times' };
    harness.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    let output = harness.render();
    const header = findNode(output, (node) => node.props.testID === 'article-newspaper-header');
    const title = findNode(output, (node) => node.props.testID === 'article-title');
    const titleBlock = findNode(output, (node) => node.props.testID === 'article-title-block');
    const button = findNode(output, (node) => node.props.accessibilityLabel === 'Share article');
    assert.ok(header);
    assert.ok(title);
    assert.equal(nodeText(title!), 'Hockey Life Times');
    assert.equal(title!.props.numberOfLines, undefined);
    assert.equal(flattenStyle(header!.props.style).flexDirection, 'row');
    assert.equal(flattenStyle(titleBlock!.props.style).flex, 1);
    assert.equal(flattenStyle(titleBlock!.props.style).minWidth, 0);
    assert.ok(button);
    assert.ok((flattenStyle(button.props.style).minHeight ?? flattenStyle(button.props.style).height) >= 44);
    assert.ok((flattenStyle(button.props.style).minWidth ?? flattenStyle(button.props.style).width) >= 44);
    assert.equal(flattenStyle(button.props.style).backgroundColor, '#22D3EE');
    assert.equal(flattenStyle(button.props.style).flexShrink, 0);
    assert.ok(findNode(button, (node) => node.type === 'Ionicons' && node.props.name === 'share-outline'));
    assert.match(nodeText(button), /Share/);
    assert.doesNotMatch(nodeText(header!), /\bBack\b/);
    assert.ok(allNodes(output).findIndex((node) => node === button) < allNodes(output).findIndex((node) => node.type === 'NativeEdition'));
    button.props.onPress();
    button.props.onPress();
    assert.deepEqual(shareCalls, [{ title: 'Hockey Life Times', message: 'Hockey Life Times', url: 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/hockey-life-times-2026-09-28-145ac7ee' }]);

    current = { id: '22222222-2222-4222-8222-222222222222', slug: 'second-story', title: 'Second Story' };
    harness.render();
    platform.OS = 'android';
    output = harness.output;
    findNode(output, (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
    assert.deepEqual(shareCalls[1], { title: 'Second Story', message: 'Second Story\nhttps://hockey-life.beerleaguehockey.ca/hockey-life/news/second-story' });

    pending[0]!.resolve({ action: 'dismissedAction' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
    assert.equal(shareCalls.length, 2);
    pending[1]!.reject(new Error('native share rejected'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    findNode(harness.render(), (node) => node.props.accessibilityLabel === 'Share article')!.props.onPress();
    assert.equal(shareCalls.length, 3);
    pending[2]!.resolve({ action: 'dismissedAction' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.unmount();
  });

  it('removes footer people sections while retaining inline article names and Related Game', async () => {
    const harness = createHookHarness();
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Linking: { openURL: async () => undefined }, Platform: { OS: 'ios' }, Share: { share: async () => ({ action: 'dismissedAction' }) }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' }, '../../components/NativeNewspaperEdition': { __esModule: true, default: 'NativeEdition' },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'Inline Player remains in the story.' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/story' },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: async () => ({ status: 'unavailable' }) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: {
        id: articleId, slug: 'story', title: 'Story', publishedAt: '2026-09-28T12:00:00Z', content: 'Inline Player remains in the story.',
        mentions: [{ kind: 'player', id: 'player-1', text: 'Mention Footer' }], taggedPlayers: [{ id: 'player-1', name: 'Tagged Footer', photoUrl: null, teamName: 'Home Club' }],
        relatedGame: { id: 'game-1', homeTeamId: 'home', homeTeamName: 'Home Club', homeTeamLogoUrl: null, awayTeamId: 'away', awayTeamName: 'Away Club', awayTeamLogoUrl: null, homeScore: 4, awayScore: 3 },
      } } }) },
    }).default;
    harness.mount(() => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: 'story' } }, navigation: { goBack() {}, navigate() {}, push() {} } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const text = nodeText(harness.render());
    assert.match(text, /Inline Player remains in the story/);
    assert.match(text, /Related Game.*Home Club.*Away Club/s);
    assert.doesNotMatch(text, /Mentioned in this story|Players in this story|Mention Footer|Tagged Footer/);
  });

  it('recovers an actual React StrictMode mount from never-settling transports without accepting late results', async () => {
    const { React, createRoot, JSDOM } = mountedReactRuntime();
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const element = (tag: string) => function TestElement({ children, accessibilityLabel, onPress, testID }: any) { return React.createElement(tag, { 'aria-label': accessibilityLabel, 'data-testid': testID, onClick: onPress }, children); };
      const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
      const late: Array<(value: unknown) => void> = []; let attempts = 0;
      const load = (identity: any, _query: unknown, options: { signal?: AbortSignal }) => reader.loadPublishedNewspaperEdition(identity, () => {
        attempts += 1;
        if (attempts <= 2) return new Promise(resolve => late.push(resolve));
        return Promise.resolve({ data: publicRow, error: null });
      }, { ...options, timeoutMs: 5 });
      const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
        react: React, 'react-native': { ActivityIndicator: element('i'), Image: element('img'), Linking: { openURL: async () => { throw new Error('not called'); } }, Pressable: element('button'), StyleSheet: { create: <T>(value: T) => value }, Text: element('span'), View: element('div') },
        '../../components/Avatar': { __esModule: true, default: element('span') }, '../../components/TeamLogo': { __esModule: true, default: element('span') }, '../../components/NativeNewspaperEdition': { __esModule: true, default: ({ edition: value }: any) => React.createElement('article', null, value.lead.headline) }, '../../components/CardFocus': { FocusCard: element('div') },
        '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'FULL BODY' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article' }, '../../lib/newspaperReader': { loadPublishedNewspaperEdition: load }, '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: {} },
        './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: element('main'), PageLoadState: element('div'), commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } }, './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: publicRow.article_id, slug: expected.articleSlug, title: 'Article', publishedAt: publicRow.published_at, content: 'FULL BODY', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
      }).default;
      const container = dom.window.document.getElementById('root')!; const root = createRoot(container);
      await React.act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Screen, { route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: expected.articleSlug } }, navigation: { goBack() {}, navigate() {}, push() {} } }))); });
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      const retry = container.querySelector('[aria-label="Retry newspaper edition"]') as HTMLElement; assert.ok(retry);
      await React.act(async () => retry.click());
      await React.act(async () => { await Promise.resolve(); });
      assert.match(container.textContent ?? '', /ECO METAL TURNS PREMIER INTO SCRAP/);
      for (const resolve of late) resolve({ data: publicRow, error: null });
      await React.act(async () => { await Promise.resolve(); }); assert.match(container.textContent ?? '', /ECO METAL TURNS PREMIER INTO SCRAP/);
      await React.act(async () => root.unmount());
    } finally {
      dom.window.close(); Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
  });

  it('turns an actual never-settling production lookup into mounted retry and complete-text recovery', async () => {
    const reader = compileCommonJs<any>(new URL('../../src/lib/newspaperReader.ts', import.meta.url), { './supabase/client': { publicSupabase: {} } });
    const harness = createHookHarness();
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Linking: { openURL: async () => { throw new Error('not called'); } }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' }, '../../components/NativeNewspaperEdition': { __esModule: true, default: 'NativeEdition' },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'FULL BODY FIRST and FULL BODY LAST' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article' },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: (identity: any, _query: unknown, options: { signal?: AbortSignal }) => reader.loadPublishedNewspaperEdition(identity, () => new Promise(() => {}), { ...options, timeoutMs: 5 }) },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: articleId, slug: expected.articleSlug, title: 'Timeout', publishedAt: '2026-09-21T12:00:00Z', content: 'FULL BODY FIRST and FULL BODY LAST', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
    }).default;
    harness.mount(() => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: expected.articleSlug } }, navigation: { goBack() {}, navigate() {}, push() {} } }));
    await new Promise<void>(resolve => setTimeout(resolve, 15));
    let output = harness.render();
    assert.ok(findNode(output, node => node.props.accessibilityLabel === 'Retry newspaper edition'));
    findNode(output, node => node.props.accessibilityLabel === 'Read article text instead')!.props.onPress();
    output = harness.render();
    assert.match(nodeText(output), /FULL BODY FIRST.*FULL BODY LAST/);
  });

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
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'fallback body' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article' },
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
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [{ kind: 'paragraph', text: 'Complete fallback article body.' }], parseInlineMarkdown: (value: string) => [{ text: value }], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article' },
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
    let requestSignal: AbortSignal | undefined;
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/NewsArticleScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', Linking: { openURL: async () => undefined }, Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../../components/Avatar': { __esModule: true, default: 'Avatar' }, '../../components/TeamLogo': { __esModule: true, default: 'TeamLogo' }, '../../components/NativeNewspaperEdition': { __esModule: true, default: 'NativeEdition' },
      '../../components/CardFocus': { FocusCard: (props: any) => createElement('FocusCard', props, props.children) },
      '../../lib/leagueContentModel': { parseArticleBlocks: () => [], parseInlineMarkdown: () => [], classifyArticleHref: () => null, publicArticleUrl: () => 'https://hockey-life.beerleaguehockey.ca/hockey-life/news/article' },
      '../../lib/newspaperReader': { loadPublishedNewspaperEdition: (_identity: unknown, _query: unknown, options: { signal?: AbortSignal }) => { requestSignal = options.signal; return new Promise((resolve) => { release = resolve; }); } },
      '../../navigation/MobileShellDataContext': { useMobileShellData: () => ({ focusAccent: '#1F6A44' }) }, '../../theme/colors': { __esModule: true, default: {} },
      './LeaguePageCommon': { useLeaguePageScope: (value: unknown) => value, LeaguePageFrame: (props: any) => createElement('Frame', props, props.children), PageLoadState: 'Loading', commonStyles: { section: {}, sectionTitle: {}, card: {}, secondaryButton: {}, secondaryButtonText: {} } },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: { article: { id: articleId, slug: expected.articleSlug, title: 'Unmounted', publishedAt: '2026-09-21T12:00:00Z', content: '', mentions: [], taggedPlayers: [], relatedGame: null } } }) },
    }).default;
    harness.mount(() => Screen({ route: { params: { leagueId, leagueSlug: 'hockey-life', articleSlug: expected.articleSlug } }, navigation: { goBack() {}, navigate() {}, push() {} } }));
    const updatesBeforeUnmount = harness.stateUpdateCount;
    harness.unmount();
    assert.equal(requestSignal?.aborted, true);
    release({ status: 'ready', edition: edition() });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
