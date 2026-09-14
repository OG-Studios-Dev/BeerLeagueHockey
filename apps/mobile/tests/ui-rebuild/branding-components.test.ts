import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

const colors = {
  bgBase: '#07111F',
  primary: '#22D3EE',
  textInteractive: '#67E8F9',
  textPrimary: '#F7FBFF',
  textSecondary: '#A8B4C8',
  brandRink: '#22D3EE',
};

const reactNative = {
  Image: 'Image',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: <T>(value: T) => value },
};

describe('primary Hockey Life component branding', () => {
  it('uses Hockey Life as the AuthShell default brand and accessible logo name', () => {
    const harness = createHookHarness();
    const AuthShell = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/components/AuthShell.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': reactNative,
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '../../assets/blh-logo.png': 'blh-logo.png',
        '../../assets/hockey-life-logo.png': 'hockey-life-logo.png',
        '../theme/colors': { default: colors },
        '../theme/ui': { ui: { radius: { panel: 24 } } },
        './BrandAtmosphere': () => createElement('BrandAtmosphere', null),
        './GlassSurface': ({ children, ...props }: Record<string, unknown>) => createElement('GlassSurface', props, children),
      },
    ).default;

    harness.mount(() => AuthShell({ title: 'Welcome back', children: createElement('Form', null) }));
    assert.match(nodeText(harness.output), /HOCKEY LIFE/);
    assert.doesNotMatch(nodeText(harness.output), /BEER LEAGUE HOCKEY|\bBLH\b/);
    const logo = findNode(harness.output, (node) => node.type === 'Image');
    assert.equal(logo?.props.alt, 'Hockey Life logo');
    assert.equal(logo?.props.source, 'hockey-life-logo.png');
  });

  it('renders one clean Hockey Life splash title and preserves timer navigation', () => {
    const harness = createHookHarness();
    const replaceCalls: string[] = [];
    let timerCallback: (() => void) | undefined;
    let timerDelay: number | undefined;
    let clearedTimer: unknown;
    const timerToken = { id: 'splash-timer' };
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void, delay: number) => {
      timerCallback = callback;
      timerDelay = delay;
      return timerToken;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: unknown) => { clearedTimer = timer; }) as typeof clearTimeout;

    try {
      const SplashScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
        new URL('../../src/screens/auth/SplashScreen.tsx', import.meta.url),
        {
          react: harness.react,
          'react-native': reactNative,
          '../../../assets/blh-logo.png': 'blh-logo.png',
          '../../../assets/hockey-life-logo.png': 'hockey-life-logo.png',
          '../../components/BrandAtmosphere': () => createElement('BrandAtmosphere', null),
          '../../theme/colors': { default: colors },
        },
      ).default;

      harness.mount(() => SplashScreen({ navigation: { replace: (route: string) => replaceCalls.push(route) } }));
      const copy = nodeText(harness.output);
      assert.equal(copy.match(/Hockey Life/g)?.length, 1);
      assert.doesNotMatch(copy, /BEER LEAGUE HOCKEY|Beer League Hockey|\bBLH\b/);
      const logo = findNode(harness.output, (node) => node.type === 'Image');
      assert.equal(logo?.props.alt, 'Hockey Life logo');
      assert.equal(logo?.props.source, 'hockey-life-logo.png');
      assert.equal(timerDelay, 1500);
      assert.deepEqual(replaceCalls, []);
      assert.ok(timerCallback);
      timerCallback();
      assert.deepEqual(replaceCalls, ['Login']);
      harness.unmount();
      assert.equal(clearedTimer, timerToken);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
