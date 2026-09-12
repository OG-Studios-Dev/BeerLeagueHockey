/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const row = (playerId = 'enforcer', pim = 88) => ({
  player_id: playerId, player_name: playerId === 'user-a' ? 'Current User' : 'Hidden Enforcer', avatar_url: null,
  team_id: 'real-team', team_name: 'Real Team', team_short_name: 'Real', position: null, is_goalie: false,
  jersey_number: null, goals: 0, assists: 1, points: 1, plus_minus: 0, games_played: 12, penalty_minutes: pim,
});

function runtime(
  getPenaltyLeaders: (...args: any[]) => Promise<any> = async () => ({ status: 'ready', leaders: [row()], unavailablePlayerCount: 0 }),
  getStatsLeaders: (...args: any[]) => Promise<any> = async () => [],
) {
  const h = createHookHarness();
  const pimCalls: any[][] = []; const statsCalls: any[][] = []; const playerCalls: any[][] = [];
  const navigation = { goBack() {} };
  const auth: any = { user: { id: 'user-a' } };
  const league: any = { activeLeague: { id: 'league-a', name: 'League A' }, activeTheme: { backgroundColor: '#000', primaryColor: '#0ff' } };
  const native = {
    ActivityIndicator: 'ActivityIndicator', FlatList: (p: any) => createElement('FlatList', p, ...(p.data ?? []).map((item: any) => p.renderItem({ item }))),
    Pressable: 'Pressable', StyleSheet: { create: (styles: any) => styles }, Text: 'Text', View: 'View',
  };
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/stats/LeaderboardsScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicons' }, '../../components/Avatar': (p: any) => createElement('Avatar', p),
    '../../components/PillToggle': (p: any) => createElement('PillToggle', p), '../../components/SectionHeader': () => null,
    '../../context/AuthContext': { useAuth: () => auth }, '../../context/LeagueContext': { useLeague: () => league },
    '../../lib/supabase/client': { supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } },
    '../../lib/supabase/data': { getStatsLeaders: async (...args: any[]) => { statsCalls.push(args); return getStatsLeaders(...args); }, getCurrentSeason: async () => null },
    '../../lib/supabase/penaltyLeaders': { getPenaltyLeaders: async (...args: any[]) => { pimCalls.push(args); return getPenaltyLeaders(...args); } },
    '../../navigation/playerCard': { navigateToPlayerCard: (...args: any[]) => playerCalls.push(args) },
    '../../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', brandGold: '#fc0', bgBase: '#000', borderCard: '#222' } },
  }).default;
  h.mount(() => Screen({ navigation }));
  return { h, auth, league, navigation, pimCalls, statsCalls, playerCalls };
}

async function settle(r: ReturnType<typeof runtime>) { for (let i=0;i<8;i++) { await new Promise<void>(resolve => setImmediate(resolve)); r.h.render(); } return r.h.output; }
function selectPim(r: ReturnType<typeof runtime>) { findNode(r.h.output, node => node.type === 'PillToggle')?.props.onChange('PIM'); }

describe('PIM leaderboard screen state', () => {
  it('opens an accessible leaderboard row with its real player id', async () => {
    const r = runtime(); await settle(r); selectPim(r); const output = await settle(r);
    const player = findNode(output, node => node.props.testID === 'leaderboard-player-enforcer');
    assert.equal(player?.props.accessibilityRole, 'button');
    player?.props.onPress();
    assert.deepEqual(r.playerCalls, [[r.navigation, { playerId: 'enforcer', leagueId: 'league-a' }]]);
  });

  it('uses the authoritative PIM reader rather than a points-truncated stats request', async () => {
    const r = runtime(); await settle(r); selectPim(r); const output = await settle(r);
    assert.deepEqual(r.pimCalls, [['league-a', 50]]);
    assert.equal(r.statsCalls.filter(call => call[1] === 'points').length, 1, 'only the initial Points tab requests points');
    assert.match(nodeText(output), /Hidden Enforcer/);
    assert.match(nodeText(output), /88PIM/);
    assert.doesNotMatch(nodeText(output), /12 GP|0G|1A/, 'raw event counts and secondary scoring are not PIM facts');
  });

  it('discloses excluded PIM players only while the matching partial result is bound', async () => {
    const r = runtime(
      async () => ({ status: 'ready', leaders: [row()], unavailablePlayerCount: 2 }),
      async () => [row('other', 7)],
    );
    await settle(r); selectPim(r); let output = await settle(r);
    assert.match(nodeText(output), /2 players excluded: PIM unavailable/);

    findNode(output, node => node.type === 'PillToggle')?.props.onChange('Points');
    output = r.h.render();
    assert.doesNotMatch(nodeText(output), /players excluded/);
    output = await settle(r);
    assert.match(nodeText(output), /12 GP/);
    assert.match(nodeText(output), /0G1A/);
    assert.doesNotMatch(nodeText(output), /players excluded/);
  });

  it('shows read errors with retry and distinguishes no-season, unavailable, and empty results', async () => {
    let attempt = 0;
    const r = runtime(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('PIM source failed');
      if (attempt === 2) return { status: 'no-season', leaders: [], unavailablePlayerCount: 0 };
      return { status: 'empty', leaders: [], unavailablePlayerCount: 0 };
    });
    await settle(r); selectPim(r); let output = await settle(r);
    assert.ok(findNode(output, node => node.props.testID === 'pim-leaders-error'));
    findNode(output, node => node.props.testID === 'pim-leaders-retry')?.props.onPress();
    output = await settle(r); assert.match(nodeText(output), /No current season/);
    findNode(r.h.output, node => node.type === 'PillToggle')?.props.onChange('Goals'); await settle(r);
    selectPim(r); output = await settle(r); assert.match(nodeText(output), /No PIM recorded/);
  });

  it('never lets a late response overwrite a new category or stale user rank', async () => {
    let release!: (value: any) => void; let calls = 0;
    const r = runtime(async () => { calls += 1; if (calls === 1) return new Promise(resolve => { release = resolve; }); return { status: 'ready', leaders: [row('other', 4)], unavailablePlayerCount: 0 }; });
    await settle(r); selectPim(r); await settle(r);
    r.auth.user = { id: 'user-b' }; r.h.render();
    assert.doesNotMatch(nodeText(r.h.output), /Your rank/);
    await settle(r);
    release({ status: 'ready', leaders: [row('user-a', 99)], unavailablePlayerCount: 0 });
    const output = await settle(r);
    assert.doesNotMatch(nodeText(output), /Current User|Your rank/);
    findNode(output, node => node.type === 'PillToggle')?.props.onChange('Goals'); await settle(r);
    assert.doesNotMatch(nodeText(r.h.output), /Hidden Enforcer/);
  });

  it('invalidates an in-flight request when the screen unmounts', async () => {
    let release!: (value: any) => void;
    const r = runtime(() => new Promise(resolve => { release = resolve; }));
    await settle(r); selectPim(r); await settle(r);
    const updatesBeforeUnmount = r.h.stateUpdateCount;
    r.h.unmount();
    release({ status: 'ready', leaders: [row()], unavailablePlayerCount: 3 });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(r.h.stateUpdateCount, updatesBeforeUnmount);
  });
});
