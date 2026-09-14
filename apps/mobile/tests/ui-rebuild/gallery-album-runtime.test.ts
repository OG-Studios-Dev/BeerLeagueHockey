/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness';

function findNodes(root: unknown, predicate: (node: TestNode) => boolean): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(child => findNodes(child, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)];
}

const colors = { __esModule: true, default: { primary: '#0ff', bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', bgElevated: '#112', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#001', textInteractive: '#6ef', glassStroke: '#333' } };

describe('virtualized native gallery album', () => {
  it('bounds initial rendering, keeps the tail reachable, and handles viewer image lifecycle', () => {
    const harness = createHookHarness();
    let preferences = { reduceMotion: false, reduceTransparency: false };
    const photos = Array.from({ length: 100 }, (_, index) => ({
      id: `photo-${index + 1}`,
      albumId: 'album-id',
      imageUrl: `https://images.example.test/full-${index + 1}.jpg`,
      thumbnailUrl: `https://images.example.test/thumb-${index + 1}.jpg`,
      caption: `Published caption ${index + 1}`,
      sortOrder: index,
    }));
    const FlatList = ({ data = [], renderItem, initialNumToRender = 10, ListHeaderComponent, ListEmptyComponent, ...props }: Record<string, any>) => createElement(
      'FlatList',
      { ...props, data, renderItem, initialNumToRender, ListHeaderComponent, ListEmptyComponent },
      ListHeaderComponent,
      ...(data.length ? data.slice(0, initialNumToRender).map((item: unknown, index: number) => renderItem({ item, index })) : [ListEmptyComponent]),
    );
    const Modal = ({ visible, children, ...props }: Record<string, any>) => createElement('Modal', { ...props, visible }, visible ? children : null);
    const Screen = compileCommonJs<any>(new URL('../../src/screens/league-pages/GalleryAlbumScreen.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { ActivityIndicator: 'ActivityIndicator', FlatList, Image: 'Image', Modal, Pressable: 'Pressable', StyleSheet: { absoluteFill: { inset: 0 }, create: (value: any) => value }, Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 390, height: 844 }) },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
      '@expo/vector-icons': { Ionicons: 'Icon' },
      '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => preferences },
      '../../theme/colors': colors,
      './LeaguePageCommon': {
        useLeaguePageScope: (scope: unknown) => scope,
        LeaguePageFrame: (props: any) => createElement('LeaguePageFrame', props, props.children),
        PageLoadState: (props: any) => createElement('PageLoadState', props),
      },
      './ContentPageCommon': { useLeagueContent: () => ({ loading: false, error: null, retry() {}, data: {
        schemaVersion: 1, view: 'album', league: { id: 'league-1', slug: 'hockey-life', name: 'Synthetic League', logoUrl: null },
        album: { id: 'album-id', title: 'Published album', description: 'Complete album description.', seasonId: null, seasonName: null, coverUrl: null, photoCount: 100, createdAt: null },
        photos, total: 100,
      } }) },
    }).default;
    const calls: string[] = [];
    const output = harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life', albumId: 'album-id' } }, navigation: { goBack: () => calls.push('back') } }));

    const list = findNode(output, node => node.type === 'FlatList');
    assert.ok(list);
    assert.equal(list.props.testID, 'gallery-grid');
    assert.equal(list.props.numColumns, 2);
    assert.equal(list.props.data.length, 100);
    assert.ok(list.props.initialNumToRender > 0 && list.props.initialNumToRender <= 12);
    assert.ok(findNodes(output, node => node.type === 'Image').length <= 12);
    const firstTile = findNode(output, node => node.props.accessibilityLabel === 'Published caption 1; Open photo 1 of 100');
    assert.equal(flattenStyle(firstTile?.props.style).width, 175);
    const tail = list.props.renderItem({ item: photos[99], index: 99 });
    assert.match(nodeText(tail), /Published caption 100/);
    assert.equal(findNode(tail, node => node.type === 'Image')?.props.source.uri, 'https://images.example.test/thumb-100.jpg');

    findNode(output, node => node.type === 'Image' && node.props.source.uri === 'https://images.example.test/thumb-1.jpg')!.props.onError();
    let refreshed = harness.render();
    assert.match(nodeText(refreshed), /Image unavailable/);
    photos[0] = { ...photos[0]!, thumbnailUrl: 'https://images.example.test/thumb-1-replaced.jpg' };
    refreshed = harness.render();
    assert.equal(findNode(refreshed, node => node.type === 'Image' && node.props.source.uri === 'https://images.example.test/thumb-1-replaced.jpg')?.props.source.uri, 'https://images.example.test/thumb-1-replaced.jpg');

    findNode(refreshed, node => node.props.accessibilityLabel === 'Published caption 1; Open photo 1 of 100')!.props.onPress();
    let viewer = harness.render();
    assert.ok(findNode(viewer, node => node.type === 'ActivityIndicator'));
    let fullImage = findNode(viewer, node => node.type === 'Image' && node.props.resizeMode === 'contain');
    assert.ok(fullImage);
    fullImage.props.onLoad();
    viewer = harness.render();
    assert.equal(findNode(viewer, node => node.type === 'ActivityIndicator'), undefined);

    fullImage = findNode(viewer, node => node.type === 'Image' && node.props.resizeMode === 'contain');
    fullImage!.props.onError();
    viewer = harness.render();
    assert.match(nodeText(viewer), /Image unavailable/);
    findNode(viewer, node => node.props.accessibilityLabel === 'Next photo')!.props.onPress();
    viewer = harness.render();
    assert.ok(findNode(viewer, node => node.type === 'ActivityIndicator'));
    assert.match(nodeText(viewer), /2 of 100/);
    fullImage = findNode(viewer, node => node.type === 'Image' && node.props.resizeMode === 'contain');
    assert.equal(fullImage?.props.source.uri, 'https://images.example.test/full-2.jpg');
    fullImage!.props.onLoadEnd();
    viewer = harness.render();
    assert.equal(findNode(viewer, node => node.type === 'ActivityIndicator'), undefined);

    findNode(viewer, node => node.props.accessibilityLabel === 'Previous photo')!.props.onPress();
    viewer = harness.render();
    assert.match(nodeText(viewer), /1 of 100/);
    findNode(viewer, node => node.props.accessibilityLabel === 'Previous photo')!.props.onPress();
    viewer = harness.render();
    assert.match(nodeText(viewer), /100 of 100/);
    assert.equal(findNode(viewer, node => node.type === 'Image' && node.props.resizeMode === 'contain')?.props.source.uri, 'https://images.example.test/full-100.jpg');

    preferences = { reduceMotion: true, reduceTransparency: true };
    viewer = harness.render();
    assert.equal(findNode(viewer, node => node.type === 'Modal')?.props.animationType, 'none');
    const modalSurface = findNode(viewer, node => node.props.accessibilityLabel === 'Photo viewer');
    assert.equal(flattenStyle(modalSurface?.props.style).backgroundColor, '#000000');
    assert.equal(flattenStyle(findNode(viewer, node => node.props.accessibilityLabel === 'Close photo viewer')?.props.style).top, 55);
    assert.ok(findNode(viewer, node => flattenStyle(node.props.style).bottom === 44));
    assert.equal(flattenStyle(findNode(viewer, node => nodeText(node) === '100 of 100')?.props.style).textAlign, 'center');

    findNode(viewer, node => node.props.accessibilityLabel === 'Close photo viewer')!.props.onPress();
    viewer = harness.render();
    assert.equal(findNode(viewer, node => node.type === 'Modal')?.props.visible, false);
  });
});
