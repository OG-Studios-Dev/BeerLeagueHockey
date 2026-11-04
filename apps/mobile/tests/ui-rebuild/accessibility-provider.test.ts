import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

import type { VisualPreferences } from '../../src/theme/ui.ts';

// Run the real provider effect without a native renderer. Only the React hook
// boundary and platform API are replaced; local preference code stays real.
function mountPreferences(accessibilityInfo: object) {
  const providerUrl = new URL('../../src/context/AccessibilityPreferencesContext.tsx', import.meta.url);
  const require = createRequire(providerUrl);
  const updates: VisualPreferences[] = [];
  let cleanup: (() => void) | undefined;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: () => null,
    useState: (initial: VisualPreferences) => [initial, (value: VisualPreferences) => updates.push(value)],
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
  };
  const compiled = ts.transpileModule(readFileSync(providerUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {} as { AccessibilityPreferencesProvider: (props: { children: null }) => unknown };
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'react') return react;
    if (id === 'react-native') return { AccessibilityInfo: accessibilityInfo };
    return require(id.startsWith('.') ? `${id}.ts` : id);
  }, exports);
  exports.AccessibilityPreferencesProvider({ children: null });
  return { updates, unmount: () => cleanup?.() };
}

const flushPreferences = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AccessibilityPreferencesProvider platform bridge', () => {
  it('boots without a transparency query and preserves the available reduced-motion preference', async () => {
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => true,
      // RN web omits isReduceTransparencyEnabled and can return no subscription.
      addEventListener: () => undefined,
    });
    await flushPreferences();

    assert.deepEqual(provider.updates.at(-1), {
      reduceMotion: true,
      reduceTransparency: false,
      revealDuration: 0,
      surfaceMode: 'glass',
    });
    assert.doesNotThrow(provider.unmount);
  });

  it('preserves the motion query result when the transparency query rejects', async () => {
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => true,
      isReduceTransparencyEnabled: async () => { throw new Error('Unsupported query'); },
      addEventListener: () => undefined,
    });
    await flushPreferences();

    assert.equal(provider.updates.at(-1)?.reduceMotion, true);
    assert.equal(provider.updates.at(-1)?.reduceTransparency, false);
    provider.unmount();
  });

  it('keeps querying preferences when the subscription API is missing', async () => {
    const provider = mountPreferences({ isReduceMotionEnabled: async () => true });
    await flushPreferences();

    assert.equal(provider.updates.at(-1)?.reduceMotion, true);
    assert.doesNotThrow(provider.unmount);
  });

  it('keeps the motion listener when subscribing to transparency throws', async () => {
    let onMotion: ((enabled: boolean) => void) | undefined;
    let removed = false;
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => false,
      addEventListener: (event: string, listener: (enabled: boolean) => void) => {
        if (event === 'reduceTransparencyChanged') throw new Error('Unsupported event');
        onMotion = listener;
        return { remove: () => { removed = true; } };
      },
    });
    await flushPreferences();
    assert.equal(provider.updates.at(-1)?.reduceMotion, false);

    assert.ok(onMotion);
    onMotion(true);
    assert.equal(provider.updates.at(-1)?.reduceMotion, true);
    assert.equal(provider.updates.at(-1)?.revealDuration, 0);
    provider.unmount();
    assert.equal(removed, true);
  });

  it('boots with the installed react-native-web AccessibilityInfo module', async () => {
    const require = createRequire(import.meta.url);
    const webAccessibilityInfo = require('react-native-web/dist/cjs/exports/AccessibilityInfo');
    assert.equal(webAccessibilityInfo.isReduceTransparencyEnabled, undefined);
    const expectedMotion = await webAccessibilityInfo.isReduceMotionEnabled();
    const provider = mountPreferences(webAccessibilityInfo);
    await flushPreferences();

    assert.equal(provider.updates.at(-1)?.reduceMotion, expectedMotion);
    assert.equal(provider.updates.at(-1)?.reduceTransparency, false);
    assert.doesNotThrow(provider.unmount);
  });

  it('contains synchronous query errors without discarding motion', async () => {
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => true,
      isReduceTransparencyEnabled: () => { throw new Error('Native query unavailable'); },
    });
    await flushPreferences();

    assert.equal(provider.updates.at(-1)?.reduceMotion, true);
    assert.equal(provider.updates.at(-1)?.reduceTransparency, false);
    provider.unmount();
  });

  it('preserves transparency when the motion query rejects', async () => {
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => { throw new Error('Motion query unavailable'); },
      isReduceTransparencyEnabled: async () => true,
    });
    await flushPreferences();

    assert.equal(provider.updates.at(-1)?.reduceMotion, false);
    assert.equal(provider.updates.at(-1)?.reduceTransparency, true);
    assert.equal(provider.updates.at(-1)?.surfaceMode, 'opaque');
    provider.unmount();
  });

  it('preserves native current preferences, live changes, and subscription cleanup', async () => {
    const listeners = new Map<string, (enabled: boolean) => void>();
    const removed: string[] = [];
    const provider = mountPreferences({
      isReduceMotionEnabled: async () => true,
      isReduceTransparencyEnabled: async () => true,
      addEventListener: (event: string, listener: (enabled: boolean) => void) => {
        listeners.set(event, listener);
        return { remove: () => removed.push(event) };
      },
    });
    await flushPreferences();
    assert.deepEqual(provider.updates.at(-1), {
      reduceMotion: true, reduceTransparency: true, revealDuration: 0, surfaceMode: 'opaque',
    });
    const motion = listeners.get('reduceMotionChanged');
    const transparency = listeners.get('reduceTransparencyChanged');
    assert.ok(motion);
    assert.ok(transparency);
    motion(false);
    assert.deepEqual(provider.updates.at(-1), {
      reduceMotion: false, reduceTransparency: true, revealDuration: 380, surfaceMode: 'opaque',
    });
    transparency(false);
    assert.deepEqual(provider.updates.at(-1), {
      reduceMotion: false, reduceTransparency: false, revealDuration: 380, surfaceMode: 'glass',
    });

    provider.unmount();
    assert.deepEqual(removed, ['reduceMotionChanged', 'reduceTransparencyChanged']);
    const count = provider.updates.length;
    motion(true);
    transparency(true);
    assert.equal(provider.updates.length, count);
  });

  it('does not publish query results after unmount', async () => {
    let resolveMotion!: (enabled: boolean) => void;
    const motion = new Promise<boolean>((resolve) => { resolveMotion = resolve; });
    const provider = mountPreferences({ isReduceMotionEnabled: () => motion });
    await flushPreferences();
    provider.unmount();
    resolveMotion(true);
    await flushPreferences();

    assert.deepEqual(provider.updates, []);
  });
});
