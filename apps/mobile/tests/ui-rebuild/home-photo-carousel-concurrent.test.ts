/* eslint-disable @typescript-eslint/no-explicit-any -- mounted React Native host harness */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs } from './component-harness.ts';

const albumA = { id: 'album-1', title: 'Finals', cover_photo_url: 'https://images.test/A.jpg' };
const albumB = { ...albumA, cover_photo_url: 'https://images.test/B.jpg' };

function mountedReactRuntime() {
  const require = createRequire(import.meta.url);
  const pnpmDirectory = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
  const jsdomEntry = readdirSync(pnpmDirectory).find((entry) => entry.startsWith('jsdom@'));
  assert.ok(jsdomEntry, 'the frozen workspace dependency tree must provision jsdom for mounted lifecycle tests');
  const requireJsdom = createRequire(`${pnpmDirectory}${jsdomEntry}/node_modules/jsdom/package.json`);
  return {
    React: require('react'),
    createRoot: require('react-dom/client').createRoot,
    JSDOM: requireJsdom('jsdom').JSDOM,
  };
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

async function withSuspendedAlbumRefresh(
  run: (fixture: {
    React: any;
    container: HTMLElement;
    startSpeculativeRefresh(): void;
    speculativeRenderCount(): number;
  }) => Promise<void>,
) {
  const { React, createRoot, JSDOM } = mountedReactRuntime();
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    act: actEnvironment.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  const hostProps = (props: any) => ({ 'aria-label': props.accessibilityLabel, 'data-testid': props.testID });
  const View = ({ children, ...props }: any) => React.createElement('div', hostProps(props), children);
  const Text = ({ children, ...props }: any) => React.createElement('span', hostProps(props), children);
  const Pressable = ({ children, onPress, disabled, ...props }: any) => React.createElement(
    'button',
    { ...hostProps(props), disabled: Boolean(disabled), onClick: onPress },
    children,
  );
  const Image = (props: any) => React.createElement('img', {
    ...hostProps(props),
    alt: props.alt ?? '',
    'data-uri': props.source?.uri,
    'data-resize': props.resizeMode,
    ref: (node: any) => { if (node) node.__nativeProps = props; },
  });
  const Modal = ({ visible, children, ...props }: any) => visible
    ? React.createElement('div', { ...hostProps(props), 'data-modal': 'true' }, children)
    : null;
  const ActivityIndicator = (props: any) => React.createElement(
    'div',
    { ...hostProps(props), 'data-spinner': 'true' },
  );
  const CarouselPager = () => null;
  const Component = compileCommonJs<any>(new URL('../../src/components/HomePhotoCarousel.tsx', import.meta.url), {
    react: React,
    'react-native': {
      ActivityIndicator,
      Image,
      Modal,
      Pressable,
      StyleSheet: { create: (value: any) => value, absoluteFill: {}, absoluteFillObject: {} },
      Text,
      View,
    },
    '@expo/vector-icons': { Ionicons: () => React.createElement('span') },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, right: 21, bottom: 34, left: 17 }) },
    '../lib/homePhotoCarousel': {
      cleanHomePhotoCaption: (value: string | null | undefined) => value?.trim() || null,
      HOME_PHOTO_SLIDE_LIMIT: 10,
      selectHomePhotoSlides: (items: any[], _random?: () => number, limit = 10) => items.slice(0, limit),
    },
    '../theme/colors': { __esModule: true, default: { textSecondary: '#aaa', bgMedia: '#08111E' } },
    './CarouselPager': { __esModule: true, default: CarouselPager },
  }).default;

  const suspended = new Promise<void>(() => {});
  let speculativeRenders = 0;
  function Never() {
    speculativeRenders += 1;
    throw suspended;
  }
  function App() {
    const [album, setAlbum] = React.useState(albumA);
    const [blocked, setBlocked] = React.useState(false);
    const transitionToB = () => React.startTransition(() => {
      setAlbum(albumB);
      setBlocked(true);
    });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('button', { 'data-testid': 'speculative-refresh', onClick: transitionToB }),
      React.createElement(
        React.Suspense,
        { fallback: React.createElement('div', { 'data-fallback': 'true' }) },
        React.createElement(Component, {
          photos: [],
          albums: [album],
          scopeKey: 'league-1:season-1',
          reduceMotion: true,
          reduceTransparency: false,
        }),
        blocked ? React.createElement(Never) : null,
      ),
    );
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    });
    await run({
      React,
      container,
      startSpeculativeRefresh() {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
        (container.querySelector('[data-testid="speculative-refresh"]') as HTMLElement).click();
      },
      speculativeRenderCount: () => speculativeRenders,
    });
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await React.act(async () => root.unmount());
    dom.window.close();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
}

describe('Home photo committed ownership under suspended React renders', () => {
  it('lets the committed viewer A load settle while a speculative album B render is suspended', async () => {
    await withSuspendedAlbumRefresh(async ({ React, container, startSpeculativeRefresh, speculativeRenderCount }) => {
      await React.act(async () => {
        (container.querySelector('[data-testid="home-photo-card"]') as HTMLElement).click();
      });
      await waitFor(
        () => Boolean(container.querySelector('img[data-resize="contain"]')),
        'the committed A viewer must mount',
      );
      const committedImage = container.querySelector('img[data-resize="contain"]') as any;
      assert.equal(committedImage.dataset.uri, albumA.cover_photo_url);
      assert.ok(container.querySelector('[data-spinner="true"]'), 'the viewer must begin in loading state');

      startSpeculativeRefresh();
      await waitFor(() => speculativeRenderCount() > 0, 'the album B work-in-progress tree must render and suspend');
      assert.equal((container.querySelector('img[data-resize="contain"]') as HTMLElement)?.dataset.uri, albumA.cover_photo_url);
      assert.equal(container.querySelector('[data-fallback="true"]'), null, 'the transition must retain committed A');

      committedImage.__nativeProps.onLoad();
      committedImage.__nativeProps.onLoadEnd();
      await waitFor(
        () => !container.querySelector('[data-spinner="true"]'),
        'the still-committed A viewer load callbacks must settle its loading indicator',
      );
    });
  });

  it('lets the committed card A error settle while a speculative album B render is suspended', async () => {
    await withSuspendedAlbumRefresh(async ({ container, startSpeculativeRefresh, speculativeRenderCount }) => {
      const committedImage = container.querySelector('img[data-resize="cover"]') as any;
      assert.equal(committedImage.dataset.uri, albumA.cover_photo_url);

      startSpeculativeRefresh();
      await waitFor(() => speculativeRenderCount() > 0, 'the album B work-in-progress tree must render and suspend');
      assert.equal((container.querySelector('img[data-resize="cover"]') as HTMLElement)?.dataset.uri, albumA.cover_photo_url);
      assert.equal(container.querySelector('[data-fallback="true"]'), null, 'the transition must retain committed A');

      committedImage.__nativeProps.onError();
      await waitFor(
        () => Boolean(container.querySelector('[data-testid="home-photo-media-unavailable"]')),
        'the still-committed A card error must publish its honest unavailable state',
      );
      assert.equal((container.querySelector('[data-testid="home-photo-card"]') as HTMLButtonElement).disabled, true);
    });
  });
});
