import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

function mountGuestLayout(isGuest: boolean) {
  const harness = createHookHarness();
  const Layout = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/navigation/GuestBannerLayout.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': { StyleSheet: { create: <T>(styles: T) => styles }, View: 'View' },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }) },
      '../components/AuthGuestBanner': () => createElement('AuthGuestBanner', null, 'A much longer localized guest message that must be allowed to wrap without overlapping page content.'),
    },
  ).default;
  harness.mount(() => Layout({ isGuest, children: createElement('Page', null, 'content') }));
  return { harness };
}

describe('guest banner safe-area composition', () => {
  it('places a measured wrapping guest banner after the OS inset and offsets tab content once', () => {
    const { harness } = mountGuestLayout(true);
    const banner = findNode(harness.output, (node) => node.props.testID === 'guest-banner-host');
    assert.equal(flattenStyle(banner?.props.style).top, 47);
    assert.match(nodeText(banner), /longer localized guest message/);
    banner?.props.onLayout({ nativeEvent: { layout: { height: 68 } } });
    harness.render();
    const content = findNode(harness.output, (node) => node.props.testID === 'main-tab-container');
    assert.equal(flattenStyle(content?.props.style).paddingTop, 68);
  });

  it('adds no banner or top padding for members', () => {
    const { harness } = mountGuestLayout(false);
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'guest-banner-host'), undefined);
    const content = findNode(harness.output, (node) => node.props.testID === 'main-tab-container');
    assert.equal(flattenStyle(content?.props.style).paddingTop, undefined);
  });
});
