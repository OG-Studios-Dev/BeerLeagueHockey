import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

const leagueId = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';

describe('mounted Players directory', () => {
  it('mounts a bounded two-column grid and keeps player and team navigation separate', () => {
    const harness = createHookHarness();
    const reactNative = {
      Image: 'Image', Modal: ({ children }: any) => children, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ width: 390, height: 844 }),
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
    const FocusFlatList = (props: any) => createElement('FlatList', props, props.ListHeaderComponent,
      ...(props.data ?? []).map((item: unknown, index: number) => props.renderItem({ item, index })));
    const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/league-pages/PlayersDirectoryScreen.tsx', import.meta.url), {
      react: { ...harness.react, default: harness.react },
      'react-native': reactNative,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      '../../components/CardFocus': {
        FocusCard: ({ children, ...props }: any) => createElement('FocusCard', props, children), FocusFlatList,
      },
      '../../components/TeamLogo': { default: (props: any) => createElement('TeamLogo', props) },
      '../../hooks/usePlayersDirectory': { usePlayersDirectory: () => ({ data, loading: false, error: null, retry: () => undefined }) },
      '../../lib/imagePlaceholders': { BLH_DEFAULT_PLAYER_AVATAR_URL: 'https://example.test/blank.png' },
      '../../lib/playersDirectory': {
        buildPlayersDirectoryView: () => ({ players: data.memberships, teamOptions: data.teams, positions: ['Defense'], teamCount: 1 }),
      },
      '../../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', textInteractive: '#0ff', glassStrokeStrong: '#333', glassStroke: '#222', bgInteractive: '#111', brandGold: '#ca0' } },
      './LeaguePageCommon': {
        useLeaguePageScope: (scope: unknown) => scope,
        LeaguePageFrame: ({ children, scrollable }: any) => createElement('LeaguePageFrame', { scrollable }, children),
        PageLoadState: 'PageLoadState',
      },
    });
    const navigations: Array<[string, unknown]> = [];
    const output = harness.mount(() => Screen.default({
      route: { params: { leagueId, leagueSlug: 'hockey-life' } },
      navigation: { navigate: (screen: string, params: unknown) => navigations.push([screen, params]) },
    }));

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
    assert.deepEqual(navigations, [
      ['LeaguePlayerCard', { playerId, leagueId }],
      ['LeagueTeamDetail', { teamId, leagueId }],
    ]);
  });
});
