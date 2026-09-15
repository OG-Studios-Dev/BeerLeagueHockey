/* eslint-disable @typescript-eslint/no-explicit-any -- purpose-built native animation harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const CANONICAL_HOCKEY_LIFE_LOGO = 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/league-logos/wizard-add94b26-b344-459f-9727-8cddae9783de-1773170120557.jpg';

function createRuntime({
  id = HOCKEY_LIFE_ID,
  name = 'HockeyLife',
  logoUrl = CANONICAL_HOCKEY_LIFE_LOGO as string | null,
  reduceMotion = false,
  reduceTransparency = false,
  focused = true,
  appState = 'active' as string | null,
  updatesAction = undefined as unknown,
} = {}) {
  const harness = createHookHarness();
  const timingCalls: Array<{ value: FakeValue; config: Record<string, unknown> }> = [];
  const sequenceCalls: any[][] = [];
  const parallelCalls: any[][] = [];
  const animations: any[] = [];
  const delayedStops: Array<() => void> = [];
  let stateHandler: ((state: string) => void) | undefined;
  let currentAppState = appState;
  let currentFocused = focused;
  class FakeValue {
    current: number;
    constructor(value: number) { this.current = value; }
    setValue(value: number) { this.current = value; }
    interpolate(config: Record<string, unknown>) { return { value: this, config }; }
    stopAnimation(callback?: (value: number) => void) {
      if (callback) delayedStops.push(() => callback(this.current));
    }
  }
  const animation = (children: any[] = [], value?: FakeValue, config?: Record<string, any>) => {
    let completion: ((result: { finished: boolean }) => void) | undefined;
    const entry = {
      children, value, config,
      start(callback?: (result: { finished: boolean }) => void) { completion = callback; },
      stop() { if (completion) delayedStops.push(() => completion?.({ finished: false })); },
      finish() {
        if (value && config) value.setValue(config.toValue);
        children.forEach((child) => child.finish?.());
        completion?.({ finished: true });
      },
    };
    animations.push(entry);
    return entry;
  };
  const Animated = {
    Value: FakeValue,
    View: 'AnimatedView',
    timing: (value: FakeValue, config: Record<string, unknown>) => {
      timingCalls.push({ value, config });
      return animation([], value, config);
    },
    parallel: (children: any[]) => { parallelCalls.push(children); return animation(children); },
    sequence: (children: any[]) => { sequenceCalls.push(children); return animation(children); },
    delay: (duration: number) => ({ kind: 'delay', duration, ...animation() }),
  };
  const heroModule = compileCommonJs<any>(new URL('../../src/components/HomeLeagueHero.tsx', import.meta.url), {
    react: harness.react,
    'react-native': {
      Animated,
      AppState: {
        get currentState() { return currentAppState; },
        addEventListener: (_event: string, handler: (state: string) => void) => {
          stateHandler = handler;
          return { remove: () => { stateHandler = undefined; } };
        },
      },
      Easing: { out: (value: unknown) => value, cubic: 'cubic' },
      Image: 'Image', StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: { position: 'absolute', inset: 0 } },
      Text: 'Text', View: 'View',
    },
    '@react-navigation/native': { useIsFocused: () => currentFocused },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '../../assets/hockey-life-logo.png': 'transparent-hockey-life-logo.png',
  });
  let props = { leagueId: id, leagueName: name, logoUrl, primaryColor: '#34D399', secondaryColor: '#60A5FA', reduceMotion, reduceTransparency, width: 390, height: 844, updatesAction };
  harness.mount(() => heroModule.default(props));
  return {
    heroModule, harness, timingCalls, sequenceCalls, parallelCalls,
    image: () => findNode(harness.output, (node) => node.props.testID === 'home-league-hero-image'),
    load() { this.image()?.props.onLoad(); harness.render(); },
    fail() { this.image()?.props.onError(); harness.render(); },
    background(state: string) { currentAppState = state; stateHandler?.(state); harness.render(); },
    focus(value: boolean) { currentFocused = value; harness.render(); },
    finishLast() { animations.at(-1)?.finish(); harness.render(); },
    flushDelayedStops() { delayedStops.splice(0).forEach((callback) => callback()); harness.render(); },
    update(next: Partial<typeof props>) { props = { ...props, ...next }; harness.render(); },
  };
}

describe('HomeLeagueHero identity', () => {
  it('keeps image completion callbacks stable for the same request after load and rerender', () => {
    const runtime = createRuntime({ id: 'foreign', logoUrl: 'https://cdn.test/square.png' });
    const initial = runtime.image();
    runtime.load();
    runtime.update({ leagueName: 'Renamed foreign league' });
    assert.equal(runtime.image()?.props.onLoad, initial?.props.onLoad);
    assert.equal(runtime.image()?.props.onError, initial?.props.onError);
  });

  it('fits full-frame remote artwork and entrance travel inside its clipping stage', () => {
    const runtime = createRuntime({ id: 'foreign', logoUrl: 'https://cdn.test/square.png' });
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 768, height: 1024 }]) {
      runtime.update(size);
      const stage = findNode(runtime.harness.output, (node) => flattenStyle(node.props.style).overflow === 'hidden');
      const image = runtime.image();
      assert.ok(Number(flattenStyle(stage?.props.style).height) >= Number(flattenStyle(image?.props.style).height) + 44);
      assert.ok(Number(flattenStyle(stage?.props.style).width) >= Number(flattenStyle(image?.props.style).width));
    }
  });

  it('binds only the verified HockeyLife identity or canonical URL to the transparent bundle', () => {
    const heroModule = createRuntime().heroModule;
    assert.equal(heroModule.resolveHomeLeagueLogoSource(HOCKEY_LIFE_ID, null), 'transparent-hockey-life-logo.png');
    assert.equal(heroModule.resolveHomeLeagueLogoSource('another-league', CANONICAL_HOCKEY_LIFE_LOGO), 'transparent-hockey-life-logo.png');
    assert.deepEqual(heroModule.resolveHomeLeagueLogoSource('another-league', 'https://cdn.test/league.jpg'), { uri: 'https://cdn.test/league.jpg' });
    assert.equal(heroModule.resolveHomeLeagueLogoSource('another-league', null), null);
  });

  it('uses a large uncropped image and a named initials fallback after a current-source failure', () => {
    const runtime = createRuntime({ id: 'another-league', name: 'Harbour Hockey', logoUrl: 'https://cdn.test/league.jpg' });
    const image = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image');
    assert.ok(image);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.accessibilityLabel, 'Harbour Hockey logo');
    assert.ok(flattenStyle(image.props.style).width >= 215);
    image.props.onError();
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image'), undefined);
    assert.match(nodeText(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-fallback')), /HH/);
  });

  it('does not let a stale failed image suppress a newly selected league', () => {
    const runtime = createRuntime({ id: 'league-a', name: 'Alpha Hockey', logoUrl: 'https://cdn.test/a.jpg' });
    const staleImage = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image');
    runtime.update({ leagueId: 'league-b', leagueName: 'Beta Hockey', logoUrl: 'https://cdn.test/b.jpg' });
    staleImage?.props.onError();
    runtime.harness.render();
    const currentImage = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image');
    assert.deepEqual(currentImage?.props.source, { uri: 'https://cdn.test/b.jpg' });
  });

  it('keeps an inert initials underlay until only the current remote image reports loaded', () => {
    const runtime = createRuntime({ id: 'league-a', name: 'Alpha Hockey', logoUrl: 'https://cdn.test/a.jpg' });
    const staleImage = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image');
    const loadingFallback = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback');
    assert.ok(loadingFallback);
    assert.equal(loadingFallback.props.accessible, false);

    runtime.update({ leagueId: 'league-b', leagueName: 'Beta Hockey', logoUrl: 'https://cdn.test/b.jpg' });
    staleImage?.props.onLoad();
    runtime.harness.render();
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'));

    findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-image')?.props.onLoad();
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'), undefined);
  });

  it('isolates late load completion after the current request has loaded', () => {
    const runtime = createRuntime({ id: 'league-a', name: 'Alpha Hockey', logoUrl: 'https://cdn.test/a.jpg' });
    const staleImage = runtime.image();
    runtime.update({ leagueId: 'league-b', leagueName: 'Beta Hockey', logoUrl: 'https://cdn.test/b.jpg' });
    runtime.load();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'), undefined);
    staleImage?.props.onLoad();
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'), undefined);
  });

  it('isolates late errors after the current request has failed', () => {
    const runtime = createRuntime({ id: 'league-a', name: 'Alpha Hockey', logoUrl: 'https://cdn.test/a.jpg' });
    const staleImage = runtime.image();
    runtime.update({ leagueId: 'league-b', leagueName: 'Beta Hockey', logoUrl: 'https://cdn.test/b.jpg' });
    runtime.fail();
    assert.equal(runtime.image(), undefined);
    staleImage?.props.onError();
    runtime.harness.render();
    assert.equal(runtime.image(), undefined);
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-fallback'));
  });

  it('isolates a late completion from an old URL for the same league', () => {
    const runtime = createRuntime({ id: 'league-a', logoUrl: 'https://cdn.test/a-v1.jpg' });
    const staleImage = runtime.image();
    runtime.update({ logoUrl: 'https://cdn.test/a-v2.jpg' });
    runtime.load();
    staleImage?.props.onLoad();
    runtime.harness.render();
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'), undefined);
  });

  it('isolates A1 callbacks after an A to B to A2 request sequence', () => {
    const runtime = createRuntime({ id: 'league-a', logoUrl: 'https://cdn.test/a.jpg' });
    const staleA1 = runtime.image();
    runtime.update({ leagueId: 'league-b', logoUrl: 'https://cdn.test/b.jpg' });
    runtime.update({ leagueId: 'league-a', logoUrl: 'https://cdn.test/a.jpg' });
    runtime.load();
    staleA1?.props.onError();
    runtime.harness.render();
    assert.ok(runtime.image());
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'), undefined);
  });

  it('keeps valid string and array ReactNode Updates actions inside the real hero', () => {
    const runtime = createRuntime({ updatesAction: 'Updates text' });
    assert.match(nodeText(runtime.harness.output), /Updates text/);
    runtime.update({ updatesAction: ['First update', 'Second update'] });
    assert.match(nodeText(runtime.harness.output), /First updateSecond update/);
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero'));
  });
});

describe('HomeLeagueHero motion and atmosphere', () => {
  it('schedules one bounded native-driver entrance with a light sweep', () => {
    const runtime = createRuntime();
    assert.equal(runtime.timingCalls.length, 0);
    runtime.load();
    assert.equal(runtime.sequenceCalls.length, 1);
    assert.ok(runtime.parallelCalls.length >= 1);
    assert.ok(runtime.timingCalls.length >= 4);
    assert.ok(runtime.timingCalls.every((call) => call.config.useNativeDriver === true));
    assert.ok(runtime.timingCalls.every((call) => Number(call.config.duration) <= 800));
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-sweep'));
  });

  it('uses opacity only for reduced motion and removes atmospheric layers for reduced transparency', () => {
    const runtime = createRuntime({ reduceMotion: true, reduceTransparency: true });
    runtime.load();
    assert.equal(runtime.sequenceCalls.length, 0);
    assert.equal(runtime.timingCalls.length, 1);
    assert.equal(runtime.timingCalls[0]?.config.toValue, 1);
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-sweep'), undefined);
    assert.equal(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-halo'), undefined);
  });

  it('settles visibly when the app backgrounds and removes its listener on unmount', () => {
    const runtime = createRuntime();
    runtime.load();
    const logo = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-motion');
    runtime.background('background');
    assert.equal((logo?.props.style[0].opacity as { current: number }).current, 1);
    runtime.harness.unmount();
    assert.doesNotThrow(() => runtime.background('active'));
  });

  it('waits for the first active state and image readiness before consuming the entrance', () => {
    for (const initialState of [null, 'background'] as const) {
      const runtime = createRuntime({ appState: initialState });
      assert.equal(runtime.timingCalls.length, 0);
      runtime.background('active');
      assert.equal(runtime.timingCalls.length, 0);
      runtime.load();
      assert.equal(runtime.sequenceCalls.length, 1);
      assert.equal(runtime.timingCalls.length, 4);
    }
  });

  it('keeps a visible loading fallback and reserves the entrance for a slow image', () => {
    const runtime = createRuntime({ id: 'league-a', logoUrl: 'https://cdn.test/slow.jpg' });
    assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-loading-fallback'));
    assert.equal(runtime.timingCalls.length, 0);
    runtime.load();
    assert.equal(runtime.sequenceCalls.length, 1);
    assert.equal(runtime.timingCalls.length, 4);
  });

  it('does not replay after refresh, refocus, or foreground once consumed', () => {
    const runtime = createRuntime();
    runtime.load();
    const timingCount = runtime.timingCalls.length;
    runtime.update({ leagueName: 'HockeyLife refreshed' });
    runtime.focus(false);
    runtime.focus(true);
    runtime.background('background');
    runtime.background('active');
    assert.equal(runtime.timingCalls.length, timingCount);
  });

  it('guards a new entrance from delayed cancellation callbacks', () => {
    const runtime = createRuntime({ id: 'league-a', logoUrl: 'https://cdn.test/a.jpg' });
    runtime.load();
    runtime.update({ leagueId: 'league-b', leagueName: 'Beta Hockey', logoUrl: 'https://cdn.test/b.jpg' });
    runtime.load();
    const motion = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-motion');
    assert.equal((flattenStyle(motion?.props.style).opacity as { current: number }).current, 0);
    runtime.flushDelayedStops();
    assert.equal((flattenStyle(motion?.props.style).opacity as { current: number }).current, 0);
  });

  it('uses a large visible mark without a solid halo capsule and compacts short phones', () => {
    const runtime = createRuntime();
    const image = runtime.image();
    const frame390 = Number(flattenStyle(image?.props.style).width);
    const visible390 = frame390 * 450 / 512;
    assert.ok(visible390 >= 210 && visible390 <= 240);
    const haloStyle = flattenStyle(findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero-halo')?.props.style);
    assert.equal(haloStyle.backgroundColor, undefined);

    runtime.update({ width: 320, height: 568 });
    const shortImage = runtime.image();
    const shortFrame = Number(flattenStyle(shortImage?.props.style).width);
    const masthead = findNode(runtime.harness.output, (node) => node.props.testID === 'home-league-hero');
    assert.ok(shortFrame * 450 / 512 >= 165);
    assert.ok(Number(flattenStyle(masthead?.props.style).height) <= 190);
  });
});
