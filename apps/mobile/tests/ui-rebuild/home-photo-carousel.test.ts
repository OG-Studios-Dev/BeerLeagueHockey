import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, type TestNode } from './component-harness.ts';

const homeSource = readFileSync(fileURLToPath(new URL('../../src/screens/HomeScreen.tsx', import.meta.url).toString()), 'utf8');
const modelUrl = new URL('../../src/lib/homePhotoCarousel.ts', import.meta.url);
const componentUrl = new URL('../../src/components/HomePhotoCarousel.tsx', import.meta.url);
const componentSource = readFileSync(fileURLToPath(componentUrl.toString()), 'utf8');

type Photo = { id: string; url: string; caption: string | null; gallery_id: string };
type Album = { id: string; title: string; cover_photo_url: string | null };

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function photos(count: number): Photo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `photo-${index}`,
    url: `https://images.test/photo-${index}.jpg`,
    caption: `Photo ${index}`,
    gallery_id: `gallery-${index}`,
  }));
}

function resolveCardGeometry(card: TestNode, contentWidth: number) {
  const style = flattenStyle(card.props.style);
  const width = typeof style.width === 'string' && style.width.endsWith('%')
    ? contentWidth * Number.parseFloat(style.width) / 100
    : Number(style.width);
  const ratioHeight = width / Number(style.aspectRatio);
  const height = style.minHeight === undefined
    ? ratioHeight
    : Math.max(ratioHeight, Number(style.minHeight));
  return { width, height, ratio: width / height };
}

function mountCarousel(initial: {
  photos?: Photo[];
  albums?: Album[];
  scopeKey?: string;
  reduceMotion?: boolean;
  reduceTransparency?: boolean;
  safeInsets?: Partial<{ top: number; bottom: number; left: number; right: number }>;
}) {
  const harness = createHookHarness();
  const safeInsets = { top: 47, bottom: 34, left: 0, right: 0, ...initial.safeInsets };
  let props = {
    photos: initial.photos ?? [],
    albums: initial.albums ?? [],
    scopeKey: initial.scopeKey ?? 'league-1:season-1',
    reduceMotion: initial.reduceMotion ?? true,
    reduceTransparency: initial.reduceTransparency ?? false,
  };
  const Component = compileCommonJs<{ default: (value: typeof props) => unknown }>(componentUrl, {
    react: harness.react,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      Image: 'Image',
      Modal: (modalProps: { visible?: boolean; children?: unknown; [key: string]: unknown }) => createElement('Modal', modalProps, modalProps.visible ? modalProps.children : null),
      Pressable: 'Pressable',
      StyleSheet: { create: <T,>(value: T) => value, absoluteFillObject: { position: 'absolute', inset: 0 } },
      Text: 'Text',
      View: 'View',
    },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => safeInsets },
    '../theme/colors': { __esModule: true, default: { textPrimary: '#F8FBFF', textSecondary: '#A9B8CC', bgMedia: '#08111E' } },
  }).default;
  const previousRandom = Math.random;
  Math.random = () => 0;
  try {
    harness.mount(() => Component(props));
  } finally {
    Math.random = previousRandom;
  }
  return {
    harness,
    update(next: Partial<typeof props>) {
      props = { ...props, ...next };
      Math.random = () => 0;
      try { harness.render(); } finally { Math.random = previousRandom; }
    },
  };
}

function withFakeIntervals(run: (clock: {
  intervals: Map<number, { callback: () => void; delay: number }>;
  cleared: number[];
}) => void) {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = new Map<number, { callback: () => void; delay: number }>();
  const cleared: number[] = [];
  let nextId = 1;
  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    const id = nextId++;
    intervals.set(id, { callback, delay: Number(delay) });
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    cleared.push(Number(id));
    intervals.delete(Number(id));
  }) as unknown as typeof clearInterval;
  try { run({ intervals, cleared }); } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

function viewerImage(output: unknown): TestNode | undefined {
  return findNode(output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain');
}

describe('Home League Photos carousel', () => {
  it('replaces the horizontal multi-photo rail and visible Gallery header action with one dedicated card', () => {
    assert.match(homeSource, /import HomePhotoCarousel from ['"]\.\.\/components\/HomePhotoCarousel['"]/);
    assert.match(homeSource, /<HomePhotoCarousel\b/);
    assert.doesNotMatch(homeSource, /<SectionHeading title="League Photos"[^>]*action=/);
    assert.doesNotMatch(homeSource, /styles\.photoRail|<ScrollView horizontal[^>]*photoRail/);
  });

  it('selects at most ten unique photos with injected Fisher–Yates randomness without mutating the pool', () => {
    assert.equal(existsSync(fileURLToPath(modelUrl.toString())), true, 'photo selection model must exist');
    const { selectHomePhotoSlides } = compileCommonJs<{
      selectHomePhotoSlides<T extends { id: string }>(items: T[], random?: () => number, limit?: number): T[];
    }>(modelUrl, {});
    const photos = [
      ...Array.from({ length: 12 }, (_, index) => ({ id: String(index), url: `https://images.test/${index}.jpg` })),
      { id: '5', url: 'https://images.test/duplicate-5.jpg' },
    ];
    const before = structuredClone(photos);

    const selected = selectHomePhotoSlides(photos, () => 0);

    assert.deepEqual(selected.map((photo: { id: string }) => photo.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    assert.equal(new Set(selected.map((photo: { id: string }) => photo.id)).size, selected.length);
    assert.deepEqual(photos, before);
    assert.notEqual(selected, photos);
  });

  it('keeps one randomized ten-photo selection stable across ordinary rerenders', () => {
    const fixture = mountCarousel({ photos: photos(12) });
    let card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.ok(card);
    assert.equal(allNodes(fixture.harness.output).filter((node) => node.type === 'Image').length, 1);
    assert.equal(findNode(card, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-1.jpg');
    const next = findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo');
    assert.ok(next);
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '1 of 10');

    next.props.onPress();
    fixture.harness.render();
    card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(findNode(card, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-2.jpg');
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '2 of 10');

    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '2 of 10');
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-2.jpg');
  });

  it('autoplays on a calm interval, loops, and clears the timer on unmount', () => {
    withFakeIntervals(({ intervals, cleared }) => {
      const fixture = mountCarousel({ photos: photos(3), reduceMotion: false });
      assert.equal(intervals.size, 1);
      const [timerId, timer] = [...intervals.entries()][0];
      assert.ok(timer.delay >= 5000 && timer.delay <= 6000);

      for (const expected of ['2 of 3', '3 of 3', '1 of 3']) {
        timer.callback();
        fixture.harness.render();
        assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, expected);
      }

      fixture.harness.unmount();
      assert.deepEqual(cleared, [timerId]);
      assert.equal(intervals.size, 0);
    });
  });

  it('pauses autoplay while the viewer is open and resumes it after close', () => {
    withFakeIntervals(({ intervals, cleared }) => {
      const fixture = mountCarousel({ photos: photos(3), reduceMotion: false });
      const [timerId] = [...intervals.keys()];
      findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
      fixture.harness.render();
      assert.ok(cleared.includes(timerId));
      assert.equal(intervals.size, 0);

      findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
      fixture.harness.render();
      assert.equal(intervals.size, 1);
      assert.equal([...intervals.values()][0]?.delay, 5500);
    });
  });

  it('ignores a pre-open autoplay callback that was already queued when the viewer opens', () => {
    withFakeIntervals(({ intervals }) => {
      const fixture = mountCarousel({ photos: photos(3), reduceMotion: false });
      const oldTimer = [...intervals.values()][0];

      findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
      fixture.harness.render();
      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')!.props.accessibilityValue.text, '1 of 3');

      oldTimer.callback();
      fixture.harness.render();

      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')!.props.accessibilityValue.text, '1 of 3');
    });
  });

  it('fully disables autoplay for Reduce Motion while preserving manual previous and next controls', () => {
    withFakeIntervals(({ intervals }) => {
      const fixture = mountCarousel({ photos: photos(3), reduceMotion: true });
      assert.equal(intervals.size, 0);
      const next = findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo');
      const previous = findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Previous league photo');
      assert.ok(next && previous);

      next.props.onPress();
      fixture.harness.render();
      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '2 of 3');
      previous.props.onPress();
      fixture.harness.render();
      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '1 of 3');
    });
  });

  it('reconciles refreshes and pool shrink, then resets index and identities for a new scope', () => {
    const pool = photos(5);
    const fixture = mountCarousel({ photos: pool });
    for (let index = 0; index < 2; index += 1) {
      findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo')!.props.onPress();
      fixture.harness.render();
    }
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-3.jpg');

    fixture.update({ photos: pool.map((photo) => ({ ...photo })) });
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-3.jpg');

    fixture.update({ photos: [pool[0], pool[1]] });
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '2 of 2');
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-0.jpg');

    const nextScopePhotos = photos(3).map((photo, index) => ({
      ...photo,
      id: `next-${index}`,
      url: `https://images.test/next-${index}.jpg`,
      gallery_id: `next-gallery-${index}`,
    }));
    fixture.update({ scopeKey: 'league-2:season-2', photos: nextScopePhotos });
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '1 of 3');
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/next-1.jpg');
  });

  it('closes the scope-owned viewer before a new league photo can be shown', () => {
    const fixture = mountCarousel({ photos: photos(2) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Modal')?.props.visible, true);

    const nextScopePhotos = photos(2).map((photo, index) => ({
      ...photo,
      id: `scope-next-${index}`,
      url: `https://images.test/scope-next-${index}.jpg`,
      gallery_id: `scope-next-gallery-${index}`,
    }));
    fixture.update({ scopeKey: 'league-next:season-next', photos: nextScopePhotos });

    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Modal')?.props.visible, false);
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain'), undefined);
    assert.match(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'cover')?.props.source.uri, /scope-next/);
  });

  it('resets media failure ownership when the league scope changes', () => {
    const sameIdentity = photos(1);
    const fixture = mountCarousel({ photos: sameIdentity });
    const oldOnError = findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'cover')!.props.onError;
    oldOnError();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.disabled, true);

    fixture.update({ scopeKey: 'league-next:season-next', photos: sameIdentity.map((photo) => ({ ...photo })) });

    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.disabled, false);
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'cover')?.props.source.uri, sameIdentity[0]?.url);

    oldOnError();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.disabled, false);
  });

  it('clears scope-owned autoplay and ignores an already-queued callback from the previous scope', () => {
    withFakeIntervals(({ intervals, cleared }) => {
      const fixture = mountCarousel({ photos: photos(3), reduceMotion: false });
      const [oldTimerId, oldTimer] = [...intervals.entries()][0];
      const nextScopePhotos = photos(3).map((photo, index) => ({
        ...photo,
        id: `scope-b-${index}`,
        url: `https://images.test/scope-b-${index}.jpg`,
      }));

      fixture.update({ scopeKey: 'league-b:season-b', photos: nextScopePhotos });
      assert.ok(cleared.includes(oldTimerId));
      assert.equal(intervals.has(oldTimerId), false);
      assert.equal(intervals.size, 1);
      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '1 of 3');

      oldTimer.callback();
      fixture.harness.render();
      assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '1 of 3');
    });
  });

  it('handles zero, one, ten, and more-than-ten photo states with one current card and complete position semantics', () => {
    const empty = mountCarousel({ photos: [] });
    assert.equal(empty.harness.output, null);

    const single = mountCarousel({ photos: photos(1) });
    const singleCard = findNode(single.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(singleCard?.props.accessibilityLabel, 'Open league photo 1 of 1 viewer: Photo 0');
    assert.equal(findNode(single.harness.output, (node) => node.props.testID === 'home-photo-position'), undefined);

    for (const count of [10, 11]) {
      const fixture = mountCarousel({ photos: photos(count) });
      assert.equal(allNodes(fixture.harness.output).filter((node) => node.props.testID === 'home-photo-card').length, 1);
      const position = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position');
      assert.deepEqual(position?.props.accessibilityValue, { min: 1, max: 10, now: 1, text: '1 of 10' });
      assert.match(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.accessibilityLabel, /^Open league photo 1 of 10 viewer:/);
    }
  });

  it('opens the exact current photo in a native modal instead of handing its gallery to the browser', () => {
    const fixture = mountCarousel({ photos: photos(3) });
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo')!.props.onPress();
    fixture.harness.render();
    const card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(findNode(card, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/photo-2.jpg');

    card!.props.onPress();
    fixture.harness.render();

    const modal = findNode(fixture.harness.output, (node) => node.type === 'Modal');
    assert.equal(modal?.props.visible, true);
    assert.equal(findNode(modal, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')?.props.source.uri, 'https://images.test/photo-2.jpg');
    assert.doesNotMatch(homeSource, /onOpenGallery=\{\(galleryId\)\s*=>\s*openExternal\(/);
    assert.doesNotMatch(componentSource, /onOpenGallery|Linking|openURL/);
  });

  it('supports close, Android requestClose, and accessibility escape on the modal', () => {
    const fixture = mountCarousel({ photos: photos(1) });
    const card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!;
    assert.equal(card.props.accessibilityRole, 'button');
    card.props.onPress();
    fixture.harness.render();

    let modal = findNode(fixture.harness.output, (node) => node.type === 'Modal')!;
    const surface = findNode(modal, (node) => node.props.accessibilityLabel === 'Home photo viewer')!;
    assert.equal(surface.props.accessibilityViewIsModal, true);
    assert.equal(typeof surface.props.onAccessibilityEscape, 'function');
    surface.props.onAccessibilityEscape();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Modal')?.props.visible, false);

    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    modal = findNode(fixture.harness.output, (node) => node.type === 'Modal')!;
    modal.props.onRequestClose();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Modal')?.props.visible, false);

    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Modal')?.props.visible, false);
  });

  it('loops previous and next inside the viewer and keeps the Home selection synchronized', () => {
    const fixture = mountCarousel({ photos: photos(3) });
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();

    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')?.props.accessibilityValue.text, '2 of 3');
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next photo in viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')?.props.accessibilityValue.text, '3 of 3');
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')?.props.source.uri, 'https://images.test/photo-0.jpg');

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next photo in viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')?.props.accessibilityValue.text, '1 of 3');
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Previous photo in viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-position')?.props.accessibilityValue.text, '3 of 3');

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-position')?.props.accessibilityValue.text, '3 of 3');
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card' && Boolean(findNode(node, (child) => child.type === 'Image' && child.props.source.uri === 'https://images.test/photo-0.jpg'))) !== undefined, true);
  });

  it('opens an album cover fallback as a one-image modal', () => {
    const fixture = mountCarousel({ photos: [], albums: [
      { id: 'album-covered', title: 'Championship album', cover_photo_url: 'https://images.test/album-cover.jpg' },
    ] });
    const card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!;
    assert.equal(card.props.accessibilityRole, 'button');
    assert.equal(card.props.accessibilityLabel, 'Open Championship album photo viewer');
    card.props.onPress();
    fixture.harness.render();

    const modal = findNode(fixture.harness.output, (node) => node.type === 'Modal');
    assert.equal(modal?.props.visible, true);
    const image = findNode(modal, (node) => node.type === 'Image' && node.props.resizeMode === 'contain');
    assert.equal(image?.props.source.uri, 'https://images.test/album-cover.jpg');
    assert.equal(image?.props.alt, 'Championship album');
    assert.equal(findNode(modal, (node) => node.props.testID === 'home-photo-viewer-position'), undefined);
  });

  it('honors safe areas, Reduce Motion, Reduced Transparency, and 44-point modal targets', () => {
    const fixture = mountCarousel({ photos: photos(3), reduceMotion: true, reduceTransparency: true });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();

    const modal = findNode(fixture.harness.output, (node) => node.type === 'Modal')!;
    assert.equal(modal.props.animationType, 'none');
    const surface = findNode(modal, (node) => node.props.accessibilityLabel === 'Home photo viewer')!;
    assert.equal(flattenStyle(surface.props.style).backgroundColor, '#000000');
    const close = findNode(modal, (node) => node.props.accessibilityLabel === 'Close photo viewer')!;
    const closeStyle = flattenStyle(close.props.style);
    assert.equal(closeStyle.top, 55);
    assert.ok(closeStyle.width >= 44 && closeStyle.height >= 44);
    assert.ok(findNode(modal, (node) => flattenStyle(node.props.style).bottom === 44));
    for (const label of ['Previous photo in viewer', 'Next photo in viewer']) {
      const style = flattenStyle(findNode(modal, (node) => node.props.accessibilityLabel === label)?.props.style);
      assert.ok(style.width >= 44 && style.height >= 44 && style.minHeight >= 44);
    }
  });

  it('hides readable photo and album names while preserving their accessibility semantics', () => {
    const dirty = mountCarousel({ photos: [{ ...photos(1)[0], caption: '<b>Not safe</b>' }] });
    assert.equal(findNode(dirty.harness.output, (node) => node.type === 'Text' && String(node.props.children).includes('Not safe')), undefined);
    assert.equal(findNode(dirty.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.accessibilityLabel, 'Open league photo 1 of 1 viewer');

    const readable = mountCarousel({ photos: [{ ...photos(1)[0], caption: '  Championship   night  ' }] });
    const readableCard = findNode(readable.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(findNode(readableCard, (node) => node.type === 'Text' && node.props.children === 'Championship night'), undefined);
    assert.equal(readableCard?.props.accessibilityLabel, 'Open league photo 1 of 1 viewer: Championship night');
    const image = findNode(readable.harness.output, (node) => node.type === 'Image');
    assert.equal(image?.props.alt, 'Championship night');
    assert.equal(findNode(readableCard, (node) => node.type === 'LinearGradient'), undefined);
    readableCard!.props.onPress();
    readable.harness.render();
    const photoModal = findNode(readable.harness.output, (node) => node.type === 'Modal');
    assert.equal(findNode(photoModal, (node) => node.type === 'Text' && String(node.props.children).includes('Championship night')), undefined);
    assert.equal(findNode(photoModal, (node) => node.type === 'LinearGradient'), undefined);
    const fullImage = findNode(photoModal, (node) => node.type === 'Image' && node.props.resizeMode === 'contain');
    assert.equal(fullImage?.props.alt, 'Championship night');
    assert.equal(fullImage?.props.accessibilityLabel, 'Championship night');

    const coveredFallback = mountCarousel({ photos: [], albums: [
      { id: 'album-covered', title: 'Championship album', cover_photo_url: 'https://images.test/album-cover.jpg' },
    ], reduceTransparency: true });
    const coveredCard = findNode(coveredFallback.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(findNode(coveredCard, (node) => node.type === 'Text' && node.props.children === 'Championship album'), undefined);
    assert.equal(coveredCard?.props.accessibilityLabel, 'Open Championship album photo viewer');
    assert.equal(findNode(coveredCard, (node) => node.type === 'Image')?.props.alt, 'Championship album');
    assert.equal(findNode(coveredCard, (node) => node.type === 'View' && flattenStyle(node.props.style).backgroundColor === '#06101D'), undefined);
    coveredCard!.props.onPress();
    coveredFallback.harness.render();
    const albumModal = findNode(coveredFallback.harness.output, (node) => node.type === 'Modal');
    assert.equal(findNode(albumModal, (node) => node.type === 'Text' && String(node.props.children).includes('Championship album')), undefined);
    assert.equal(findNode(albumModal, (node) => node.type === 'LinearGradient'), undefined);
    assert.equal(findNode(albumModal, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')?.props.accessibilityLabel, 'Championship album');
  });

  it('exposes failed or missing media honestly and does not open the viewer', () => {
    const readable = mountCarousel({ photos: [{ ...photos(1)[0], caption: '  Championship   night  ' }] });
    const image = findNode(readable.harness.output, (node) => node.type === 'Image');
    image?.props.onError();
    readable.harness.render();
    assert.equal(findNode(readable.harness.output, (node) => node.type === 'Image'), undefined);
    assert.ok(findNode(readable.harness.output, (node) => node.props.testID === 'home-photo-media-unavailable'));
    const failedCard = findNode(readable.harness.output, (node) => node.props.testID === 'home-photo-card')!;
    assert.equal(failedCard.props.accessibilityLabel, 'Photo unavailable: Championship night');
    assert.equal(failedCard.props.disabled, true);
    assert.deepEqual(failedCard.props.accessibilityState, { disabled: true });
    assert.equal(failedCard.props.onPress, undefined);
    assert.equal(findNode(readable.harness.output, (node) => node.type === 'Modal')?.props.visible, false);

    const fallback = mountCarousel({ photos: [], albums: [{ id: 'album-1', title: 'Finals', cover_photo_url: null }] });
    const fallbackCard = findNode(fallback.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.ok(fallbackCard);
    assert.ok(findNode(fallbackCard, (node) => node.props.testID === 'home-photo-media-unavailable'));
    assert.equal(fallbackCard.props.accessibilityLabel, 'Photo unavailable: Finals');
    assert.equal(fallbackCard.props.disabled, true);
    assert.equal(fallbackCard.props.onPress, undefined);
    assert.equal(findNode(fallback.harness.output, (node) => node.type === 'Modal')?.props.visible, false);


    const coveredFallback = mountCarousel({ photos: [], albums: [
      { id: 'album-no-cover', title: 'No cover', cover_photo_url: null },
      { id: 'album-covered', title: 'Championship album', cover_photo_url: 'https://images.test/album-cover.jpg' },
    ] });
    const coveredCard = findNode(coveredFallback.harness.output, (node) => node.props.testID === 'home-photo-card');
    assert.equal(findNode(coveredCard, (node) => node.type === 'Image')?.props.source.uri, 'https://images.test/album-cover.jpg');
    assert.equal(findNode(coveredFallback.harness.output, (node) => node.props.testID === 'home-photo-position'), undefined);
    coveredCard!.props.onPress();
    coveredFallback.harness.render();
    assert.equal(findNode(coveredFallback.harness.output, (node) => node.type === 'Modal')?.props.visible, true);

  });

  it('tracks viewer image loading, load completion, and failure without exposing stale media', () => {
    const fixture = mountCarousel({ photos: photos(1) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));

    let fullImage = findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')!;
    fullImage.props.onLoad();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'), undefined);

    fullImage = findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')!;
    fullImage.props.onError();
    fullImage.props.onLoadEnd();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-unavailable'));
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain'), undefined);

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.disabled, true);
  });

  it('rejects an old card error after A to B to A returns to the same media identity', () => {
    const fixture = mountCarousel({ photos: photos(3) });
    const initialImage = findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'cover')!;
    const oldOnError = initialImage.props.onError;
    const initialUri = initialImage.props.source.uri;

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next league photo')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Previous league photo')!.props.onPress();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'cover')!.props.source.uri, initialUri);

    oldOnError();
    fixture.harness.render();

    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.disabled, false);
  });

  it('rejects an old viewer error after A to B to A returns to the same media identity', () => {
    const fixture = mountCarousel({ photos: photos(3) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    const initialImage = viewerImage(fixture.harness.output)!;
    const oldOnError = initialImage.props.onError;
    const initialUri = initialImage.props.source.uri;

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next photo in viewer')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Previous photo in viewer')!.props.onPress();
    fixture.harness.render();
    assert.equal(viewerImage(fixture.harness.output)!.props.source.uri, initialUri);

    oldOnError();
    fixture.harness.render();

    assert.equal(viewerImage(fixture.harness.output)!.props.source.uri, initialUri);
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-unavailable'), undefined);
  });

  it('rejects an old viewer load-end after A to B to A returns to the same media identity', () => {
    const fixture = mountCarousel({ photos: photos(3) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    const oldOnLoadEnd = viewerImage(fixture.harness.output)!.props.onLoadEnd;

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Next photo in viewer')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Previous photo in viewer')!.props.onPress();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));

    oldOnLoadEnd();
    fixture.harness.render();

    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));
  });

  it('rejects old viewer callbacks from a prior close and reopen lifetime', () => {
    const fixture = mountCarousel({ photos: photos(1) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    const oldImage = viewerImage(fixture.harness.output)!;
    const oldOnError = oldImage.props.onError;
    const oldOnLoadEnd = oldImage.props.onLoadEnd;

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));

    oldOnError();
    oldOnLoadEnd();
    fixture.harness.render();

    assert.ok(viewerImage(fixture.harness.output), 'the reopened current image must ignore callbacks from the prior viewer lifetime');
    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-unavailable'), undefined);
  });

  it('re-enters loading state for every reopened modal image lifetime', () => {
    const fixture = mountCarousel({ photos: photos(1) });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    viewerImage(fixture.harness.output)!.props.onLoad();
    fixture.harness.render();
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'), undefined);

    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    fixture.harness.render();
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();

    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));
  });

  it('keeps every Reduced Transparency modal surface opaque', () => {
    const fixture = mountCarousel({ photos: photos(3), reduceTransparency: true });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();

    const modal = findNode(fixture.harness.output, (node) => node.type === 'Modal')!;
    const surface = findNode(modal, (node) => node.props.accessibilityLabel === 'Home photo viewer')!;
    const close = findNode(modal, (node) => node.props.accessibilityLabel === 'Close photo viewer')!;
    const footer = findNode(modal, (node) => node.type === 'View' && flattenStyle(node.props.style).bottom === 44)!;

    for (const node of [surface, close, footer]) {
      assert.doesNotMatch(String(flattenStyle(node.props.style).backgroundColor), /^rgba\(/);
    }
  });

  it('keeps modal controls inside nonzero left and right safe-area insets', () => {
    const fixture = mountCarousel({
      photos: photos(3),
      safeInsets: { left: 17, right: 21 },
    });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();

    const modal = findNode(fixture.harness.output, (node) => node.type === 'Modal')!;
    const closeStyle = flattenStyle(findNode(modal, (node) => node.props.accessibilityLabel === 'Close photo viewer')!.props.style);
    const footerStyle = flattenStyle(findNode(modal, (node) => node.type === 'View' && flattenStyle(node.props.style).bottom === 44)!.props.style);

    assert.equal(closeStyle.top, 55);
    assert.equal(closeStyle.right, 35);
    assert.equal(footerStyle.left, 75);
    assert.equal(footerStyle.right, 79);
  });

  it('does not let an old URL failure corrupt a refreshed URL for the same selected identity', () => {
    const initial = photos(1);
    const fixture = mountCarousel({ photos: initial });
    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    const oldOnError = viewerImage(fixture.harness.output)!.props.onError;

    fixture.update({ photos: [{ ...initial[0], url: 'https://images.test/photo-0-refreshed.jpg' }] });
    assert.equal(viewerImage(fixture.harness.output)!.props.source.uri, 'https://images.test/photo-0-refreshed.jpg');

    oldOnError();
    fixture.harness.render();

    assert.equal(viewerImage(fixture.harness.output)!.props.source.uri, 'https://images.test/photo-0-refreshed.jpg');
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-viewer-unavailable'), undefined);
  });

  it('retries a refreshed media URL for a retained photo identity after the prior URL fails', () => {
    const initial = photos(1);
    const fixture = mountCarousel({ photos: initial });
    const failedImage = findNode(fixture.harness.output, (node) => node.type === 'Image');
    failedImage!.props.onError();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-media-unavailable'));

    fixture.update({ photos: [{ ...initial[0], url: 'https://images.test/photo-0-refreshed.jpg' }] });

    const refreshedImage = findNode(fixture.harness.output, (node) => node.type === 'Image');
    assert.equal(refreshedImage?.props.source.uri, 'https://images.test/photo-0-refreshed.jpg');
    assert.equal(findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')?.props.disabled, false);

    findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!.props.onPress();
    fixture.harness.render();
    assert.ok(findNode(fixture.harness.output, (node) => node.type === 'ActivityIndicator'));
    assert.equal(findNode(fixture.harness.output, (node) => node.type === 'Image' && node.props.resizeMode === 'contain')?.props.source.uri, 'https://images.test/photo-0-refreshed.jpg');
  });

  it('resolves exact 4:3 card geometry at 320, 390, and 430 points in normal and reduced states', () => {
    const viewports = [
      { width: 320, card: { width: 288, height: 216 } },
      { width: 390, card: { width: 358, height: 268.5 } },
      { width: 430, card: { width: 398, height: 298.5 } },
    ];
    for (const viewport of viewports) {
      for (const reduceTransparency of [false, true]) {
        const fixture = mountCarousel({ photos: photos(3), reduceTransparency });
        const card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!;
        const geometry = resolveCardGeometry(card, viewport.width - 32);

        assert.deepEqual(
          geometry,
          { ...viewport.card, ratio: 4 / 3 },
          `${viewport.width}-point ${reduceTransparency ? 'reduced' : 'normal'} card resolved to ${geometry.width}×${geometry.height}`,
        );
        assert.ok(geometry.height > 44, 'the photo card remains substantially larger than a touch target');
      }
    }
  });

  it('uses responsive large-card geometry without a copy overlay and preserves 44-point controls', () => {
    for (const width of [320, 390, 430]) {
      const fixture = mountCarousel({ photos: photos(3), reduceTransparency: true });
      const card = findNode(fixture.harness.output, (node) => node.props.testID === 'home-photo-card')!;
      const cardStyle = flattenStyle(card.props.style);
      assert.equal(cardStyle.width, '100%', `${width}-point card fills its content column`);
      assert.equal(cardStyle.aspectRatio, 4 / 3);
      assert.equal(cardStyle.backgroundColor, '#0C1B31');
      assert.equal(findNode(card, (node) => node.type === 'LinearGradient'), undefined);
      assert.equal(findNode(card, (node) => node.type === 'View' && flattenStyle(node.props.style).backgroundColor === '#06101D'), undefined);
      assert.equal(findNode(card, (node) => node.type === 'Text' && String(node.props.children).startsWith('Photo ')), undefined);

      for (const label of ['Previous league photo', 'Next league photo']) {
        const control = findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === label)!;
        const style = flattenStyle(control.props.style);
        assert.ok(style.width >= 44 && style.height >= 44 && style.minHeight >= 44);
      }
    }
  });
});
