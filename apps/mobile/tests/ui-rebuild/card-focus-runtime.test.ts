import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URL } from 'node:url';

import { compileCommonJs, createHookHarness, findNode, forwardTestRef, type TestFocusModule } from './component-harness.ts';
import * as focusMath from '../../src/components/cardFocusMath.ts';

class AnimatedValue {
  value: number;
  constructor(value: number) { this.value = value; }
  setValue(value: number) { this.value = value; }
  interpolate() { return this; }
}

function compileFocusRuntime(isFocused = true, isGloballyPaused = false) {
  const harness = createHookHarness();
  const timingCalls: Array<{ value: AnimatedValue; config: Record<string, unknown>; stopped: boolean }> = [];
  const react = {
    ...harness.react,
    forwardRef: forwardTestRef,
  };
  const native = {
    Animated: {
      Value: AnimatedValue,
      View: 'AnimatedView',
      timing: (value: AnimatedValue, config: Record<string, unknown>) => {
        const call = { value, config, stopped: false };
        timingCalls.push(call);
        return {
          start: () => { value.setValue(config.toValue as number); },
          stop: () => { call.stopped = true; },
        };
      },
    },
    FlatList: 'FlatList',
    ScrollView: 'ScrollView',
    SectionList: 'SectionList',
    View: 'View',
    StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  };
  const exports = compileCommonJs<TestFocusModule>(new URL('../../src/components/CardFocus.tsx', import.meta.url), {
    react,
    'react-native': native,
    '@react-navigation/native': {
      useIsFocused: () => isFocused,
      useRoute: () => ({ key: 'synthetic-route', name: 'SyntheticRoute', params: { leagueId: 'synthetic-league' } }),
    },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: false }) },
    '../context/FocusPauseContext': { useFocusPaused: () => isGloballyPaused },
    '../theme/colors': { default: { primary: '#34d399' } },
    './cardFocusMath': focusMath,
  });
  return { exports, harness, timingCalls };
}

describe('compiled card focus scroll adapter', () => {
  it('mounts the real ScrollView adapter and preserves caller handlers while tracking scroll', () => {
    const { exports, harness } = compileFocusRuntime();
    const calls: string[] = [];
    const output = harness.mount(() => exports.FocusScrollView({
      children: 'cards',
      onLayout: () => calls.push('layout'),
      onScroll: () => calls.push('scroll'),
      onContentSizeChange: () => calls.push('content'),
    }));
    const scroll = findNode(output, (node) => node.type === 'ScrollView');
    assert.ok(scroll);
    assert.equal(scroll.props.scrollEventThrottle, 32);

    scroll.props.onLayout({ nativeEvent: { layout: { height: 480 } } });
    scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 240 } } });
    scroll.props.onContentSizeChange(320, 1200);
    assert.deepEqual(calls, ['layout', 'scroll', 'content']);
    harness.unmount();
  });

  it('preserves an explicit scroll throttle and deactivates when its route is not focused', () => {
    const { exports, harness } = compileFocusRuntime(false);
    const output = harness.mount(() => exports.FocusScrollView({ children: null, scrollEventThrottle: 16 }));
    const scroll = findNode(output, (node) => node.type === 'ScrollView');
    assert.equal(scroll?.props.scrollEventThrottle, 16);
    assert.doesNotThrow(() => scroll?.props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } }));
    harness.unmount();
  });

  it('combines the global overlay pause with the surface focusEnabled gate', () => {
    const active = compileFocusRuntime(true, false);
    assert.ok(findNode(active.harness.mount(() => active.exports.FocusScrollView({ children: null, focusEnabled: true })), (node) => node.type === 'ScrollView'));
    active.harness.unmount();

    const paused = compileFocusRuntime(true, true);
    assert.ok(findNode(paused.harness.mount(() => paused.exports.FocusScrollView({ children: null, focusEnabled: true })), (node) => node.type === 'ScrollView'));
    paused.harness.unmount();
  });

  it('measures the native host exposed by FlatList and preserves a nonzero page origin', () => {
    const { exports, harness } = compileFocusRuntime();
    let measureCalls = 0;
    const output = harness.mount(() => exports.FocusFlatList({ data: [], renderItem: () => null }));
    const list = findNode(output, (node) => node.type === 'FlatList');
    assert.ok(list);
    list.props.ref({
      getNativeScrollRef: () => ({
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
          measureCalls += 1;
          callback(0, 96, 320, 480);
        },
      }),
    });
    list.props.onLayout({ nativeEvent: { layout: { height: 480 } } });
    assert.equal(measureCalls, 1);
    harness.unmount();
  });
});

describe('focus coordinator animation lifecycle', () => {
  it('animates only the old and new winner and resets/cancels on reduced motion or disposal', () => {
    const { exports, timingCalls } = compileFocusRuntime();
    const frames: Array<() => void> = [];
    const coordinator = exports.createCardFocusCoordinator({
      requestFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    });
    const a = new AnimatedValue(0);
    const b = new AnimatedValue(0);
    coordinator.register('a', a, () => {});
    coordinator.register('b', b, () => {});
    coordinator.updateLayout('a', 0, 180);
    coordinator.updateLayout('b', 220, 180);
    coordinator.setViewportHeight(400);
    frames.shift()?.();
    assert.equal(a.value, 1);
    assert.equal(b.value, 0);

    coordinator.setScrollOffset(180);
    frames.shift()?.();
    assert.equal(a.value, 0);
    assert.equal(b.value, 1);
    assert.equal(timingCalls.length, 3);

    coordinator.setReduceMotion(true);
    assert.equal(b.value, 1);
    coordinator.setActive(false);
    assert.equal(b.value, 0);
    coordinator.dispose();
    assert.ok(timingCalls.every((call) => call.stopped));
  });

  it('reacquires safely after an effect-style cleanup without accepting the stale lease', () => {
    const { exports } = compileFocusRuntime();
    const frames: Array<() => void> = [];
    const coordinator = exports.createCardFocusCoordinator({
      requestFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    });
    const firstRelease = coordinator.acquire('route-a:league-a');
    firstRelease();
    const secondRelease = coordinator.acquire('route-a:league-a');
    firstRelease();
    const progress = new AnimatedValue(0);
    const registration = coordinator.register('card', progress, () => {});
    coordinator.updateLayout('card', 0, 180, registration.token);
    coordinator.setViewportHeight(400);
    frames.splice(0).forEach((callback) => callback());
    assert.equal(progress.value, 1);
    secondRelease();
    assert.equal(progress.value, 0);
  });

  it('rejects stale registration and scroll-epoch measurements and transfers a reused winner', () => {
    const { exports } = compileFocusRuntime();
    const frames: Array<() => void> = [];
    const coordinator = exports.createCardFocusCoordinator({
      requestFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    });
    coordinator.setReduceMotion(true);
    coordinator.setViewportHeight(400);

    const oldValue = new AnimatedValue(0);
    const oldRegistration = coordinator.register('same', oldValue, () => {});
    const staleCompletion = coordinator.captureMeasurement('same', oldRegistration.token);
    oldRegistration();

    const replacement = new AnimatedValue(0);
    const replacementRegistration = coordinator.register('same', replacement, () => {});
    coordinator.updateLayout('same', 1000, 100, replacementRegistration.token);
    staleCompletion(0, 0, 300, 100);
    frames.splice(0).forEach((callback) => callback());
    assert.equal(replacement.value, 0);

    const scrollStale = coordinator.captureMeasurement('same', replacementRegistration.token);
    coordinator.setScrollOffset(500);
    scrollStale(0, 100, 300, 100);
    frames.splice(0).forEach((callback) => callback());
    assert.equal(replacement.value, 0);

    coordinator.setScrollOffset(0);
    coordinator.updateLayout('same', 0, 100, replacementRegistration.token);
    frames.splice(0).forEach((callback) => callback());
    assert.equal(replacement.value, 1);
    const replacementAgain = new AnimatedValue(0);
    coordinator.register('same', replacementAgain, () => {});
    assert.equal(oldValue.value, 0);
    assert.equal(replacementAgain.value, 1);
  });

  it('renders only an animated emphasis overlay with deterministic observational IDs', () => {
    const { exports, harness } = compileFocusRuntime();
    const output = harness.mount(() => exports.FocusCard({ focusId: 'alpha', testID: 'supplied-card', style: { width: 220 }, children: 'content' }));
    const wrapper = findNode(output, (node) => node.type === 'View');
    const emphasis = findNode(output, (node) => node.type === 'AnimatedView');
    assert.equal(wrapper?.props.testID, 'supplied-card');
    assert.deepEqual(wrapper?.props.style, { width: 220 });
    assert.equal(emphasis?.props.testID, 'supplied-card-emphasis');
    assert.equal(emphasis?.props.pointerEvents, 'none');
    assert.doesNotMatch(JSON.stringify(output), /translateY|scale/);
    harness.unmount();
  });
});
