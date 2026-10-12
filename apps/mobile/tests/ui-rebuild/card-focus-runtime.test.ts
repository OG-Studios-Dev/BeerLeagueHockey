import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URL } from 'node:url';

import { compileCommonJs, createHookHarness, findNode, forwardTestRef, type TestFocusModule } from './component-harness.ts';

function compileCardLayoutRuntime(bottomTabHeight = 0) {
  const harness = createHookHarness();
  const exports = compileCommonJs<TestFocusModule>(new URL('../../src/components/CardFocus.tsx', import.meta.url), {
    react: { ...harness.react, forwardRef: forwardTestRef },
    'react-native': {
      FlatList: 'FlatList',
      ScrollView: 'ScrollView',
      SectionList: 'SectionList',
      View: 'View',
      StyleSheet: {
        create: <T>(value: T) => value,
        flatten: (value: unknown) => Array.isArray(value)
          ? Object.assign({}, ...value.map((entry) => entry ?? {}))
          : value,
      },
    },
    '@react-navigation/bottom-tabs': { BottomTabBarHeightContext: { current: bottomTabHeight } },

  });
  return { exports, harness };
}

describe('card layout wrappers without scroll-past emphasis', () => {
  it('preserves the FocusCard wrapper contract without animation, registration, or measurement', () => {
    const { exports, harness } = compileCardLayoutRuntime();
    const output = harness.mount(() => exports.FocusCard({
      focusId: 'alpha',
      testID: 'supplied-card',
      style: { width: 220 },
      accentColor: '#B31B34',
      children: 'content',
    }));
    const wrapper = findNode(output, (node) => node.type === 'View');
    assert.equal(wrapper?.props.testID, 'supplied-card');
    assert.deepEqual(wrapper?.props.style, { width: 220 });
    assert.equal(wrapper?.props.collapsable, false);
    assert.equal(wrapper?.props.onLayout, undefined);
    assert.equal(findNode(output, (node) => node.type === 'AnimatedView'), undefined);
    assert.doesNotMatch(JSON.stringify(output), /emphasis|measureInWindow|borderColor|shadowColor/);
  });


  it('preserves caller scroll handlers and refs without injecting tracking handlers', () => {
    const { exports, harness } = compileCardLayoutRuntime();
    const onLayout = () => undefined;
    const onScroll = () => undefined;
    const onContentSizeChange = () => undefined;
    const output = harness.mount(() => exports.FocusScrollView({
      children: 'cards',
      onLayout,
      onScroll,
      onContentSizeChange,
      scrollEventThrottle: 16,
    }));
    const scroll = findNode(output, (node) => node.type === 'ScrollView');
    assert.equal(scroll?.props.onLayout, onLayout);
    assert.equal(scroll?.props.onScroll, onScroll);
    assert.equal(scroll?.props.onContentSizeChange, onContentSizeChange);
    assert.equal(scroll?.props.scrollEventThrottle, 16);
  });

  it('keeps list item wrappers and deterministic wrapper test IDs without visual overlays', () => {
    const { exports, harness } = compileCardLayoutRuntime();
    const output = harness.mount(() => exports.FocusFlatList({
      data: [{ id: 'game-a' }],
      keyExtractor: (item: { id: string }) => item.id,
      renderItem: ({ item }: { item: { id: string } }) => item.id,
    }));
    const list = findNode(output, (node) => node.type === 'FlatList');
    const rendered = list?.props.renderItem({ item: { id: 'game-a' }, index: 0 });
    assert.equal(rendered.props.testID, 'focus-card-list:game-a');
    assert.equal(rendered.props.children, 'game-a');
    assert.equal(findNode(rendered, (node) => node.type === 'AnimatedView'), undefined);
  });

  it('retains bottom-tab content inset behavior for scroll and virtualized adapters', () => {
    const { exports, harness } = compileCardLayoutRuntime(80);
    for (const [type, render] of [
      ['ScrollView', () => exports.FocusScrollView({ contentContainerStyle: { paddingBottom: 12 }, children: null })],
      ['FlatList', () => exports.FocusFlatList({ contentContainerStyle: { paddingBottom: 12 }, data: [], renderItem: () => null })],
      ['SectionList', () => exports.FocusSectionList!({ contentContainerStyle: { paddingBottom: 12 }, sections: [], renderItem: () => null })],
    ] as const) {
      const output = harness.mount(render);
      const adapter = findNode(output, (node) => node.type === type);
      assert.deepEqual(adapter?.props.contentContainerStyle, [{ paddingBottom: 12 }, { paddingBottom: 92 }]);
      harness.unmount();
    }
  });
});
