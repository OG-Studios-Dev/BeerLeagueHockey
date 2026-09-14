/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

const league = { id: '11111111-1111-4111-8111-111111111111', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null };
const rn = {
  Linking: { openURL: async () => undefined }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
};
const common = (react: ReturnType<typeof createHookHarness>['react'], page: () => unknown) => ({
  LeaguePageFrame: ({ children }: { children?: unknown }) => createElement('Frame', null, children),
  PageHeader: ({ title, detail }: { title: string; detail: string }) => createElement('Header', null, title, detail),
  PageLoadState: ({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) => createElement('LoadState', { loading, error, onPress: retry }, loading ? 'Loading' : error ?? ''),
  useLeaguePageScope: (scope: unknown) => scope,
  commonStyles: { card: {}, section: {}, sectionTitle: {}, primaryButton: {}, primaryButtonText: {} },
  useLeagueContent: page,
  react,
});

describe('native Events screen runtime', () => {
  it('renders loaded groups and preserves empty/error/retry states', () => {
    const harness = createHookHarness(); let retryCalls = 0;
    let state: any = { loading: false, error: null, retry: () => { retryCalls += 1; }, data: {
      schemaVersion: 1, view: 'events', league, timeZone: 'America/Toronto', generatedAt: '2026-09-14T12:00:00Z', windowStart: '2026-09-07T12:00:00Z', total: 3,
      events: [
        { id: '1', title: 'Synthetic happening', description: null, eventType: 'unknown-kind', location: null, startTime: '2026-09-14T11:00:00Z', endTime: '2026-09-14T13:00:00Z' },
        { id: '2', title: 'Synthetic upcoming', description: null, eventType: 'social', location: 'Test rink', startTime: '2026-09-15T12:00:00Z', endTime: null },
        { id: '3', title: 'Synthetic recent', description: null, eventType: 'meeting', location: null, startTime: '2026-09-13T12:00:00Z', endTime: null },
      ],
    } };
    const mocks = common(harness.react, () => state);
    const screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/league-pages/EventsScreen.tsx', import.meta.url), {
      react: harness.react, 'react-native': rn, '@expo/vector-icons': { Ionicons: 'Icon' }, './LeaguePageCommon': mocks, './ContentPageCommon': mocks,
    });
    harness.mount(() => screen.default({ route: { params: { leagueId: league.id, leagueSlug: league.slug } }, navigation: { goBack() {} } }));
    assert.match(nodeText(harness.output), /Happening now.*unknown-kind.*Synthetic happening.*Upcoming.*Synthetic upcoming.*Recent.*Synthetic recent/s);
    assert.match(nodeText(harness.output), /Location not provided/);

    state = { ...state, data: { ...state.data, total: 0, events: [] } }; harness.render();
    assert.match(nodeText(harness.output), /No published events/);
    state = { loading: false, data: null, error: 'Synthetic source error', retry: state.retry }; harness.render();
    const load = findNode(harness.output, node => node.type === 'LoadState');
    assert.equal(load?.props.error, 'Synthetic source error'); load?.props.onPress(); assert.equal(retryCalls, 1);
  });
});

describe('native Contact screen handlers', () => {
  function setup(
    writer: (input: any) => Promise<{ success: boolean; error: string | null }>,
    options: { openURL?: (url: string) => Promise<void>; contact?: Record<string, string | null>; replayMountEffects?: boolean } = {},
  ) {
    const harness = createHookHarness(); let authUser: { id: string } | null = null; let scope = { leagueId: league.id, leagueSlug: league.slug };
    let deferEffects = false; let replayedMount = false; const queuedEffects: Array<() => void | (() => void)> = []; const originalEffect = harness.react.useEffect;
    harness.react.useEffect = (effect, dependencies) => originalEffect(() => {
      if (deferEffects) { queuedEffects.push(effect); return; }
      const cleanup = effect();
      if (options.replayMountEffects && !replayedMount) {
        replayedMount = true;
        if (typeof cleanup === 'function') cleanup();
        return effect();
      }
      return cleanup;
    }, dependencies);
    const state = { loading: false, error: null, retry() {}, data: { schemaVersion: 1, view: 'contact', league, contact: { email: null, phone: null, websiteUrl: 'javascript:bad', address: null, city: null, state: null, zipCode: null, ...options.contact } } };
    const mocks = common(harness.react, () => state);
    const screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/league-pages/ContactScreen.tsx', import.meta.url), {
      react: harness.react, 'react-native': { ...rn, Linking: { openURL: options.openURL ?? rn.Linking.openURL } }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../context/AuthContext': { useAuth: () => ({ user: authUser }) },
      '../../lib/supabase/contact': { submitContactSubmission: writer }, './LeaguePageCommon': { ...mocks, useLeaguePageScope: () => scope }, './ContentPageCommon': mocks,
    });
    const render = () => screen.default({ route: { params: scope }, navigation: { goBack() {} } });
    harness.mount(render);
    const field = (name: string) => findNode(harness.output, node => node.props.testID === `contact-${name}`)!;
    const fill = () => { for (const [name, value] of [['name', 'Test Person'], ['email', 'test@example.test'], ['subject', 'Question'], ['message', 'Synthetic body']]) { field(name).props.onChangeText(value); harness.render(); } };
    const press = () => findNode(harness.output, node => node.props.testID === 'contact-submit')!.props.onPress();
    return {
      harness, fill, press, field,
      setScope(next: typeof scope, defer = false) { scope = next; deferEffects = defer; harness.render(); },
      setUser(next: typeof authUser, defer = false) { authUser = next; deferEffects = defer; harness.render(); },
      flushEffects() { deferEffects = false; for (const effect of queuedEffects.splice(0)) effect(); harness.render(); },
    };
  }

  it('remains editable after a mount effect cleanup/setup replay', async () => {
    let calls = 0;
    const view = setup(async () => { calls += 1; return { success: true, error: null }; }, { replayMountEffects: true });
    view.fill();
    assert.equal(view.field('name').props.value, 'Test Person');
    view.press();
    assert.equal(calls, 1);
    await new Promise<void>(done => setImmediate(done));
    view.harness.render();
    assert.match(nodeText(view.harness.output), /Your message was accepted/);
  });

  it('shows missing/unsafe details explicitly and validates before writing', async () => {
    let calls = 0; const view = setup(async () => { calls += 1; return { success: true, error: null }; });
    assert.match(nodeText(view.harness.output), /Not provided/);
    assert.match(nodeText(view.harness.output), /javascript:bad · Link unavailable/);
    view.press(); view.harness.render();
    assert.equal(calls, 0); assert.match(nodeText(view.harness.output), /Enter your name.*Enter a valid email address.*Enter a subject.*Enter a message/s);
  });

  it('single-flights rapid taps and shows accepted only after the real promise resolves', async () => {
    let calls = 0; let resolve!: (value: { success: boolean; error: string | null }) => void;
    const view = setup(async () => { calls += 1; return new Promise(done => { resolve = done; }); }); view.fill();
    view.press(); view.press(); assert.equal(calls, 1); assert.doesNotMatch(nodeText(view.harness.output), /message was accepted/i);
    resolve({ success: true, error: null }); await new Promise<void>(done => setImmediate(done)); view.harness.render();
    assert.match(nodeText(view.harness.output), /message was accepted.*does not confirm email delivery/is);
  });

  it('retains the draft on error and ignores stale success after league or auth changes', async () => {
    let resolve!: (value: { success: boolean; error: string | null }) => void;
    const view = setup(async () => new Promise(done => { resolve = done; })); view.fill(); view.press();
    resolve({ success: false, error: 'Synthetic denied' }); await new Promise<void>(done => setImmediate(done)); view.harness.render();
    assert.match(nodeText(view.harness.output), /Message not accepted: Synthetic denied/s);
    assert.equal(findNode(view.harness.output, node => node.props.testID === 'contact-message')?.props.value, 'Synthetic body');

    let staleResolve!: (value: { success: boolean; error: string | null }) => void;
    const stale = setup(async () => new Promise(done => { staleResolve = done; })); stale.fill(); stale.press();
    stale.setScope({ leagueId: '22222222-2222-4222-8222-222222222222', leagueSlug: 'other-league' }); stale.setUser({ id: 'user-2' });
    staleResolve({ success: true, error: null }); await new Promise<void>(done => setImmediate(done)); stale.harness.render();
    assert.doesNotMatch(nodeText(stale.harness.output), /message was accepted/i); assert.doesNotMatch(nodeText(stale.harness.output), /Synthetic body/);
  });

  it('makes obsolete edit/submit callbacks inert across render, effects, ABA reuse, and unmount', async () => {
    const calls: any[] = []; const pending: Array<(value: { success: boolean; error: string | null }) => void> = [];
    const view = setup(async (input) => { calls.push(input); return new Promise(done => pending.push(done)); });
    view.fill();
    const oldPress = findNode(view.harness.output, node => node.props.testID === 'contact-submit')!.props.onPress;
    const oldEdit = view.field('message').props.onChangeText;
    view.setUser({ id: 'new-user' }, true);
    oldPress(); oldEdit('obsolete'); view.harness.render();
    assert.equal(calls.length, 0);
    view.fill(); oldEdit('obsolete again'); view.harness.render();
    assert.equal(view.field('message').props.value, 'Synthetic body');
    view.flushEffects(); oldPress();
    assert.equal(calls.length, 0);
    view.fill(); view.press();
    assert.equal(calls.length, 1);

    view.setUser(null);
    oldPress(); oldEdit('ABA obsolete');
    assert.equal(calls.length, 1);
    view.setUser({ id: 'new-user' });

    let leagueCalls = 0;
    const leagueChange = setup(async () => { leagueCalls += 1; return { success: true, error: null }; });
    leagueChange.fill(); const oldLeaguePress = findNode(leagueChange.harness.output, node => node.props.testID === 'contact-submit')!.props.onPress;
    leagueChange.setScope({ leagueId: '22222222-2222-4222-8222-222222222222', leagueSlug: 'other-league' });
    oldLeaguePress(); assert.equal(leagueCalls, 0);
    leagueChange.fill(); leagueChange.press(); await new Promise<void>(done => setImmediate(done));
    assert.equal(leagueCalls, 1);

    const leagueBeforeEffect = setup(async () => { leagueCalls += 1; return { success: true, error: null }; });
    leagueBeforeEffect.fill(); const preEffectLeaguePress = findNode(leagueBeforeEffect.harness.output, node => node.props.testID === 'contact-submit')!.props.onPress;
    leagueBeforeEffect.setScope({ leagueId: '33333333-3333-4333-8333-333333333333', leagueSlug: 'third-league' }, true);
    preEffectLeaguePress(); assert.equal(leagueCalls, 1); leagueBeforeEffect.flushEffects();

    const afterUnmount = setup(async (input) => { calls.push(input); return { success: true, error: null }; });
    afterUnmount.fill(); const queued = findNode(afterUnmount.harness.output, node => node.props.testID === 'contact-submit')!.props.onPress;
    const queuedEdit = afterUnmount.field('message').props.onChangeText;
    afterUnmount.harness.unmount(); queued(); queuedEdit('obsolete');
    await new Promise<void>(done => setImmediate(done));
    assert.equal(calls.length, 1);
  });

  it('keeps generation latches isolated when an authorized old write completes late', async () => {
    const calls: any[] = []; const pending: Array<(value: { success: boolean; error: string | null }) => void> = [];
    const view = setup(async (input) => { calls.push(input); return new Promise(done => pending.push(done)); });
    view.fill(); view.press();
    view.setScope({ leagueId: '22222222-2222-4222-8222-222222222222', leagueSlug: 'other-league' });
    view.fill(); view.press();
    assert.equal(calls.length, 2);
    pending[0]!({ success: true, error: null }); await new Promise<void>(done => setImmediate(done));
    view.press(); assert.equal(calls.length, 2);
    pending[1]!({ success: true, error: null }); await new Promise<void>(done => setImmediate(done)); view.harness.render();
    assert.match(nodeText(view.harness.output), /message was accepted/i);

    const staleError = setup(async (input) => { calls.push(input); return new Promise(done => pending.push(done)); });
    staleError.fill(); staleError.press();
    staleError.setUser({ id: 'error-scope' });
    pending[2]!({ success: false, error: 'obsolete error' }); await new Promise<void>(done => setImmediate(done)); staleError.harness.render();
    assert.doesNotMatch(nodeText(staleError.harness.output), /obsolete error/i);
    staleError.fill(); staleError.press(); assert.equal(calls.length, 4);

    const unmounted = setup(async (input) => { calls.push(input); return new Promise(done => pending.push(done)); });
    unmounted.fill(); unmounted.press(); const updatesBeforeUnmount = unmounted.harness.stateUpdateCount; unmounted.harness.unmount();
    pending[4]!({ success: true, error: null }); await new Promise<void>(done => setImmediate(done));
    assert.equal(unmounted.harness.stateUpdateCount, updatesBeforeUnmount);
  });

  it('consumes sync and async native link failures with scoped actionable feedback', async () => {
    for (const [label, failure] of [
      ['Email', () => Promise.reject(new Error('no email app'))],
      ['Phone', () => { throw new Error('no phone app'); }],
      ['Website', () => Promise.reject(new Error('browser unavailable'))],
    ] as const) {
      const view = setup(async () => ({ success: true, error: null }), {
        openURL: failure as (url: string) => Promise<void>,
        contact: { email: 'league@example.test', phone: '+1 519 555 0100', websiteUrl: 'https://example.test' },
      });
      findNode(view.harness.output, node => node.props.accessibilityLabel === `Open ${label.toLowerCase()}`)!.props.onPress();
      await new Promise<void>(done => setImmediate(done)); view.harness.render();
      assert.match(nodeText(view.harness.output), new RegExp(`Could not open ${label.toLowerCase()}`, 'i'));
      assert.ok(view.field('message'));
    }

    let reject!: (reason: Error) => void;
    const stale = setup(async () => ({ success: true, error: null }), {
      openURL: () => new Promise((_, fail) => { reject = fail; }), contact: { email: 'league@example.test' },
    });
    findNode(stale.harness.output, node => node.props.accessibilityLabel === 'Open email')!.props.onPress();
    stale.setUser({ id: 'another-user' }); reject(new Error('late failure'));
    await new Promise<void>(done => setImmediate(done)); stale.harness.render();
    assert.doesNotMatch(nodeText(stale.harness.output), /Could not open email/i);
  });
});
