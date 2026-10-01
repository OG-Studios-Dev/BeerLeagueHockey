import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

const leagueId = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';

describe('mounted Players directory', () => {
  it('mounts a bounded two-column grid and keeps player and team navigation separate', () => {
    const mounted = mountDirectory(390);
    const output = mounted.harness.output;

    const list = findNode(output, (node) => node.type === 'FlatList');
    assert.equal(list?.props.numColumns, 2);
    assert.equal(list?.props.initialNumToRender, 8);
    assert.equal(list?.props.maxToRenderPerBatch, 8);
    assert.match(nodeText(output), /1 player across 1 team/);
    assert.match(nodeText(output), /Casey Long Player Name/);

    const player = findNode(output, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Casey Long Player Name, view player card');
    const team = findNode(output, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Ice Owls, view team');
    player?.props.onPress();
    team?.props.onPress();
    assert.deepEqual(mounted.navigations, [
      ['LeaguePlayerCard', { playerId, leagueId }],
      ['LeagueTeamDetail', { teamId, leagueId }],
    ]);
  });

  it('fits two portrait columns inside 320, 375, and 390 point viewports', () => {
    for (const viewportWidth of [320, 375, 390]) {
      const mounted = mountDirectory(viewportWidth);
      const card = findNode(mounted.harness.output, (node) => node.type === 'FocusCard');
      const width = (card?.props.style as Array<Record<string, number>>)[1].width;
      assert.equal(width, (viewportWidth - 32 - 16) / 2);
      assert.ok((width * 2) + 16 <= viewportWidth - 32);
    }
  });

  it('falls back through the shared placeholder to accessible initials and ignores stale image failures after reset', () => {
    const mounted = mountDirectory(390);
    const originalImage = findNode(mounted.harness.output, (node) => node.type === 'Image');
    assert.equal(originalImage?.props.source.uri, 'https://example.test/player.jpg');
    originalImage?.props.onError();
    mounted.harness.render();

    const placeholderImage = findNode(mounted.harness.output, (node) => node.type === 'Image');
    assert.equal(placeholderImage?.props.source.uri, 'https://example.test/blank.png');
    placeholderImage?.props.onError();
    mounted.harness.render();
    const initials = findNode(mounted.harness.output, (node) => node.props.accessibilityLabel === 'Casey Long Player Name photo');
    assert.equal(initials?.props.accessibilityRole, 'image');
    assert.match(nodeText(initials), /CL/);

    mounted.data.memberships[0] = { ...mounted.data.memberships[0], photoUrl: 'https://example.test/new-player.jpg' };
    mounted.harness.render();
    const resetImage = findNode(mounted.harness.output, (node) => node.type === 'Image');
    assert.equal(resetImage?.props.source.uri, 'https://example.test/new-player.jpg');

    placeholderImage?.props.onError();
    mounted.harness.render();
    assert.equal(findNode(mounted.harness.output, (node) => node.type === 'Image')?.props.source.uri, 'https://example.test/new-player.jpg');
  });
});

function mountDirectory(viewportWidth: number) {
  const harness = createHookHarness();
  const reactNative = {
    Image: 'Image', Modal: ({ children }: { children?: unknown }) => children, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
    StyleSheet: { create: <T,>(value: T) => value }, useWindowDimensions: () => ({ width: viewportWidth, height: 844 }),
  };
  const data = {
    league: { id: leagueId, slug: 'hockey-life', name: 'Hockey Life' },
    teams: [{ id: teamId, name: 'Ice Owls', slug: 'ice-owls', logoUrl: null, divisionId: null, primaryColor: null, teamType: 'standard' }],
    memberships: [{
      rosterId: '44444444-4444-4444-8444-444444444444', id: playerId, fullName: 'Casey Long Player Name', photoUrl: 'https://example.test/player.jpg',
      jerseyNumber: 7, position: 'Defense', leadershipRole: 'captain', teamId, teamName: 'Ice Owls', teamSlug: 'ice-owls',
      teamLogoUrl: null, divisionId: null, teamPrimaryColor: null,
    }],
    omittedOrphanRows: 0,
  };
  type ListProps = {
    ListHeaderComponent?: unknown;
    data?: unknown[];
    renderItem(args: { item: unknown; index: number }): unknown;
  } & Record<string, unknown>;
  const FocusFlatList = (props: ListProps) => createElement('FlatList', props, props.ListHeaderComponent,
    ...(props.data ?? []).map((item, index) => props.renderItem({ item, index })));
  const Screen = compileCommonJs<{ default: (props: {
    route: { params: { leagueId: string; leagueSlug: string } };
    navigation: { navigate(screen: string, params?: unknown): void };
  }) => unknown }>(new URL('../../src/screens/league-pages/PlayersDirectoryScreen.tsx', import.meta.url), {
    react: { ...harness.react, default: harness.react },
    'react-native': reactNative,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../../components/CardFocus': {
      FocusCard: ({ children, ...props }: { children?: unknown } & Record<string, unknown>) => createElement('FocusCard', props, children), FocusFlatList,
    },
    '../../components/TeamLogo': { default: (props: Record<string, unknown>) => createElement('TeamLogo', props) },
    '../../hooks/usePlayersDirectory': { usePlayersDirectory: () => ({ data, loading: false, error: null, retry: () => undefined }) },
    '../../lib/imagePlaceholders': { BLH_DEFAULT_PLAYER_AVATAR_URL: 'https://example.test/blank.png' },
    '../../lib/playersDirectory': {
      buildPlayersDirectoryView: () => ({ players: data.memberships, teamOptions: data.teams, positions: ['Defense'], teamCount: 1 }),
    },
    '../../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', textInteractive: '#0ff', glassStrokeStrong: '#333', glassStroke: '#222', bgInteractive: '#111', brandGold: '#ca0' } },
    './LeaguePageCommon': {
      useLeaguePageScope: (scope: unknown) => scope,
      LeaguePageFrame: ({ children, scrollable }: { children?: unknown; scrollable?: boolean }) => createElement('LeaguePageFrame', { scrollable }, children),
      PageLoadState: 'PageLoadState',
    },
  });
  const navigations: Array<[string, unknown]> = [];
  harness.mount(() => Screen.default({
    route: { params: { leagueId, leagueSlug: 'hockey-life' } },
    navigation: { navigate: (screen, params) => navigations.push([screen, params]) },
  }));
  return { data, harness, navigations };
}
