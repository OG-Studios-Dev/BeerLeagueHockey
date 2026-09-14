import assert from 'node:assert/strict';
import { it } from 'node:test';
import { URL } from 'node:url';
import { compileCommonJs, createHookHarness, findNode, forwardTestRef, type TestFocusModule, type TestFocusCoordinator, type TestProps } from './component-harness.ts';
import * as math from '../../src/components/cardFocusMath.ts';

class Value {
  constructor(public value: number) {}
  setValue(value: number) { this.value = value; }
}
type Completion = (x: number, y: number, width: number, height: number) => void;

// Only React/native interfaces are synthetic; the complete current production module executes.
function fixture() {
  const harness = createHookHarness();
  const contexts: ReturnType<typeof harness.react.createContext>[] = [];
  const callbacks: Completion[] = [];
  const frames: Array<() => void> = [];
  const react = {
    ...harness.react,
    createContext: () => { const context = harness.react.createContext(); contexts.push(context); return context; },
    forwardRef: forwardTestRef,
    createElement: (type: unknown, props: TestProps | null, ...children: unknown[]) => {
      const ref = props?.ref;
      if (type === 'View' && ref && typeof ref === 'object' && 'current' in ref) {
        ref.current = { measureInWindow: (cb: Completion) => callbacks.push(cb) };
      }
      return harness.react.createElement(type, props, ...children);
    },
  };
  const production = compileCommonJs<TestFocusModule>(new URL('../../src/components/CardFocus.tsx', import.meta.url), {
    react,
    'react-native': {
      Animated: { Value, View: 'AnimatedView', timing: (value: Value, config: { toValue: number }) => ({ start: () => value.setValue(config.toValue), stop() {} }) },
      View: 'View', FlatList: 'FlatList', ScrollView: 'ScrollView', SectionList: 'SectionList',
      StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
    },
    '@react-navigation/native': { useIsFocused: () => true, useRoute: () => ({ key: 'route' }) },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
    // This isolated geometry fixture has no overlay; real pause integration stays in focus-pause.test.ts.
    '../context/FocusPauseContext': { useFocusPaused: () => false },
    '../theme/colors': { default: { primary: '#abc' } },
    './cardFocusMath': math,
  });
  const coordinator = production.createCardFocusCoordinator({
    requestFrame: (cb: () => void) => { frames.push(cb); return frames.length; }, cancelFrame() {},
  });
  coordinator.setReduceMotion(true);
  coordinator.setViewportHeight(400);
  const flush = () => {
    let count = 0;
    while (frames.length && count++ < 20) frames.splice(0).forEach((cb) => cb());
    assert.equal(frames.length, 0, 'recovery must stop scheduling frames');
  };
  const card = () => {
    contexts[0].current = coordinator;
    const tree = harness.mount(() => production.FocusCard({ focusId: 'x', children: 'content' }));
    const wrapper = findNode(tree, (node) => node.type === 'View')!;
    const progress = findNode(tree, (node) => node.type === 'AnimatedView')!.props.style[1].opacity as Value;
    return { wrapper, progress };
  };
  const surface = (getHost: () => { measureInWindow(callback: Completion): void } | null) => {
    const oldRequest = globalThis.requestAnimationFrame;
    const oldCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { frames.push(() => cb(0)); return frames.length; };
    globalThis.cancelAnimationFrame = () => {};
    const tree = harness.mount(() => production.FocusFlatList({ data: [], renderItem: () => null }));
    const list = findNode(tree, (node) => node.type === 'FlatList')!;
    list.props.ref({ getNativeScrollRef: getHost });
    list.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
    return {
      coordinator: (contexts[0].current as { coordinator: TestFocusCoordinator }).coordinator,
      close() {
        harness.unmount();
        flush();
        globalThis.requestAnimationFrame = oldRequest;
        globalThis.cancelAnimationFrame = oldCancel;
      },
    };
  };
  return { coordinator, callbacks, frames, flush, card, harness, surface };
}

it('M2: scroll-invalidated initial/onLayout measurements recover without another user event', () => {
  const f = fixture();
  f.coordinator.setSurfacePageY(0);
  let cleanMeasures = 0;
  f.coordinator.register('clean', new Value(0), () => { cleanMeasures += 1; });
  f.coordinator.updateLayout('clean', 1000, 100);
  const { wrapper, progress } = f.card();
  wrapper.props.onLayout();
  f.coordinator.setScrollOffset(10);
  f.callbacks.slice().forEach((cb) => cb(0, 20, 300, 100));
  f.flush();
  assert.ok(f.callbacks.length > 2, 'invalidated native measurements must be retried');
  assert.ok(f.callbacks.length <= 4, 'recovery is bounded');
  f.callbacks.at(-1)!(0, 20, 300, 100);
  f.flush();
  assert.equal(progress.value, 1);
  assert.equal(cleanMeasures, 1, 'scroll recovery must not remeasure clean mounted cards');
  f.harness.unmount();
  f.coordinator.dispose();
});

it('M2: queued recovery is cancelled after unmount, release, or scope replacement', () => {
  for (const boundary of ['unmount', 'release', 'scope']) {
    const f = fixture();
    f.coordinator.setSurfacePageY(0);
    const release = f.coordinator.acquire();
    const { wrapper, progress } = f.card();
    wrapper.props.onLayout();
    f.coordinator.setScrollOffset(10);
    if (boundary === 'unmount') f.harness.unmount();
    if (boundary === 'release') release();
    if (boundary === 'scope') f.coordinator.setScopeKey('replacement');
    f.callbacks.slice().forEach((cb) => cb(0, 20, 300, 100));
    f.flush();
    assert.equal(f.callbacks.length, 2);
    assert.equal(progress.value, 0);
    f.harness.unmount();
    f.coordinator.dispose();
  }
});

it('M3: unknown surface origin cannot invent a zero-origin winner', () => {
  const f = fixture();
  const { progress } = f.card();
  f.callbacks[0](0, 300, 300, 100);
  f.flush();
  assert.equal(progress.value, 0);
  f.harness.unmount();
  f.coordinator.dispose();
});

it('M3: latest nonzero viewport origin spanning internal scroll selects the correct card', () => {
  const f = fixture();
  const older = f.coordinator.captureSurfaceMeasurement();
  const latest = f.coordinator.captureSurfaceMeasurement();
  f.coordinator.setScrollOffset(10);
  latest(0, 300);
  older(0, 0);
  const a = new Value(0), b = new Value(0);
  f.coordinator.register('a', a, (token: number) => f.coordinator.captureMeasurement('a', token)(0, 290, 300, 100));
  f.coordinator.register('b', b, (token: number) => f.coordinator.captureMeasurement('b', token)(0, 410, 300, 100));
  f.flush();
  assert.deepEqual([a.value, b.value], [0, 1]);
  f.coordinator.dispose();
});

it('M3: actual public host becoming available recovers nonzero selection with bounded work', () => {
  const f = fixture();
  let available = false;
  let measures = 0;
  const surface = f.surface(() => available ? { measureInWindow: (cb: Completion) => { measures += 1; cb(0, 300, 320, 400); } } : null);
  try {
    const a = new Value(0), b = new Value(0);
    surface.coordinator.register('a', a, (token: number) => surface.coordinator.captureMeasurement('a', token)(0, 300, 300, 100));
    surface.coordinator.register('b', b, (token: number) => surface.coordinator.captureMeasurement('b', token)(0, 420, 300, 100));
    assert.deepEqual([a.value, b.value], [0, 0]);
    available = true;
    f.flush();
    assert.deepEqual([a.value, b.value], [0, 1]);
    assert.equal(measures, 1);
  } finally { surface.close(); f.coordinator.dispose(); }
});

it('M3: unavailable public host retries are bounded and cancelled by unmount', () => {
  for (const unmount of [false, true]) {
    const f = fixture();
    let reads = 0;
    const surface = f.surface(() => { reads += 1; return null; });
    const before = reads;
    try {
      if (unmount) f.harness.unmount();
      f.flush();
      assert.ok(reads <= before + 2, 'no runaway native-host polling');
      if (unmount) assert.equal(reads, before);
    } finally { surface.close(); f.coordinator.dispose(); }
  }
});

it('M1: actual same-registration onLayout supersedes its older initial native callback', () => {
  const f = fixture();
  f.coordinator.setSurfacePageY(0);
  const { wrapper, progress } = f.card();
  wrapper.props.onLayout();
  assert.equal(f.callbacks.length, 2);
  f.callbacks[1](0, 1000, 300, 100);
  f.callbacks[0](0, 0, 300, 100);
  f.flush();
  assert.equal(progress.value, 0, 'older y=0 must not overwrite newer offscreen y=1000');
  f.harness.unmount();
  f.coordinator.dispose();
});
