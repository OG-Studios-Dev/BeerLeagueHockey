import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { URL } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { readVerticalScrollOffset } from '../../src/components/cardFocusMath.ts';
import { compileCommonJs } from './component-harness.ts';

const require = createRequire(import.meta.url);
const nativeWeb = require('react-native-web') as Record<string, unknown>;

describe('RN-web card focus production boundary', () => {
  it('renders real production focus components through RN-web and invokes the production scroll adapter', () => {
    let capturedScrollProps: Record<string, unknown> | undefined;
    const CapturedWebScrollView = (props: Record<string, unknown>) => {
      capturedScrollProps = props;
      return React.createElement(nativeWeb.ScrollView as React.ComponentType<Record<string, unknown>>, props);
    };
    const runtime = compileCommonJs<Record<'FocusScrollView' | 'FocusCard', React.ComponentType<Record<string, unknown>>>>(new URL('../../src/components/CardFocus.tsx', import.meta.url), {
      react: React,
      'react-native': { ...nativeWeb, ScrollView: CapturedWebScrollView },
      '@react-navigation/native': {
        useIsFocused: () => true,
        useRoute: () => ({ key: 'synthetic-web-route', name: 'SyntheticWeb', params: { leagueId: 'synthetic-league' } }),
      },
      '@react-navigation/bottom-tabs': {
        BottomTabBarHeightContext: React.createContext<number | undefined>(158),
      },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: false }) },
      '../context/FocusPauseContext': { useFocusPaused: () => false },
      '../theme/colors': { default: { primary: '#34d399' } },
      './cardFocusMath': require('../../src/components/cardFocusMath.ts'),
    });
    const observedOffsets: number[] = [];
    const fixture = React.createElement(
      runtime.FocusScrollView,
      {
        testID: 'synthetic-card-focus-scroll',
        focusScopeKey: 'synthetic-tenant',
        contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 34 },
        onScroll: (event: unknown) => observedOffsets.push(readVerticalScrollOffset(event)),
      },
      React.createElement(runtime.FocusCard, { focusId: 'alpha', testID: 'synthetic-card-alpha' }, 'Synthetic Alpha card'),
      React.createElement(runtime.FocusCard, { focusId: 'bravo' }, 'Synthetic Bravo card'),
    );

    const markup = renderToStaticMarkup(fixture);
    assert.match(markup, /synthetic-card-focus-scroll/);
    assert.match(markup, /synthetic-card-alpha-emphasis/);
    assert.match(markup, /focus-card-bravo-emphasis/);
    assert.match(markup, /Synthetic Alpha card/);
    assert.deepEqual(capturedScrollProps?.contentContainerStyle, [
      { paddingHorizontal: 16, paddingBottom: 34 },
      { paddingBottom: 192 },
    ]);

    const productionOnScroll = capturedScrollProps?.onScroll as ((event: unknown) => void) | undefined;
    assert.ok(productionOnScroll);
    productionOnScroll({ nativeEvent: { contentOffset: { x: 0, y: 236 } } });
    assert.deepEqual(observedOffsets, [236]);
  });

  it('keeps malformed or non-finite web offsets readable at the top', () => {
    assert.equal(readVerticalScrollOffset({}), 0);
    assert.equal(readVerticalScrollOffset({ nativeEvent: { contentOffset: { y: Number.NaN } } }), 0);
  });

  it('preserves effective numeric bottom padding across every focus adapter', () => {
    const captured: Record<string, Record<string, unknown> | undefined> = {};
    const capture = (adapter: string) => function CapturedAdapter(props: Record<string, unknown>) {
      captured[adapter] = props;
      return React.createElement('div');
    };
    const runtime = compileCommonJs<Record<'FocusScrollView' | 'FocusFlatList' | 'FocusSectionList', React.ComponentType<Record<string, unknown>>>>(new URL('../../src/components/CardFocus.tsx', import.meta.url), {
      react: React,
      'react-native': {
        ...nativeWeb,
        ScrollView: capture('scroll'),
        FlatList: capture('flat'),
        SectionList: capture('section'),
      },
      '@react-navigation/native': {
        useIsFocused: () => true,
        useRoute: () => ({ key: 'inset-route', name: 'InsetRoute' }),
      },
      '@react-navigation/bottom-tabs': {
        BottomTabBarHeightContext: React.createContext<number | undefined>(158),
      },
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
      '../context/FocusPauseContext': { useFocusPaused: () => false },
      '../theme/colors': { default: { primary: '#34d399' } },
      './cardFocusMath': require('../../src/components/cardFocusMath.ts'),
    });
    const adapters = [
      ['scroll', runtime.FocusScrollView],
      ['flat', runtime.FocusFlatList],
      ['section', runtime.FocusSectionList],
    ] as const;
    const cases = [
      ['paddingBottom', { padding: 7, paddingVertical: 11, paddingBottom: 13 }, 171],
      ['paddingVertical', { padding: 7, paddingVertical: 11 }, 169],
      ['padding', { padding: 7 }, 165],
      ['explicit zero', { padding: 7, paddingVertical: 11, paddingBottom: 0 }, 158],
      ['array override', [{ paddingBottom: 13 }, { paddingVertical: 11 }, { paddingBottom: 3 }], 161],
      ['percentage bottom', { padding: 7, paddingVertical: 11, paddingBottom: '25%' }, 158],
    ] as const;

    for (const [adapterName, Adapter] of adapters) {
      for (const [caseName, contentContainerStyle, expectedPaddingBottom] of cases) {
        renderToStaticMarkup(React.createElement(Adapter, {
          contentContainerStyle,
          data: [],
          renderItem: () => null,
          sections: [],
        }));
        const resolved = captured[adapterName]?.contentContainerStyle;
        assert.ok(Array.isArray(resolved), `${adapterName} ${caseName} should append an inset style`);
        assert.equal((resolved[1] as Record<string, unknown>).paddingBottom, expectedPaddingBottom, `${adapterName} ${caseName}`);
      }
    }
  });
});
