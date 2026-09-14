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

    const productionOnScroll = capturedScrollProps?.onScroll as ((event: unknown) => void) | undefined;
    assert.ok(productionOnScroll);
    productionOnScroll({ nativeEvent: { contentOffset: { x: 0, y: 236 } } });
    assert.deepEqual(observedOffsets, [236]);
  });

  it('keeps malformed or non-finite web offsets readable at the top', () => {
    assert.equal(readVerticalScrollOffset({}), 0);
    assert.equal(readVerticalScrollOffset({ nativeEvent: { contentOffset: { y: Number.NaN } } }), 0);
  });
});
