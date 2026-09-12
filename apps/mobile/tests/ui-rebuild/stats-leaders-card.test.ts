/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const players = [
  ['a', 'Ada Wing', 15, 45], ['b', 'Ben Blue', 14, 10], ['c', 'Cam Centre', 13, 35],
  ['d', 'Drew Defence', 12, 30], ['e', 'Eli Edge', 11, 50], ['f', 'Finn Finisher', 25, 1],
].map(([id, name, goals, assists]) => ({ player_id: id as string, player_name: name as string,
  team_id: 'team-a', team_name: 'North Stars', team_short_name: 'Stars', goals: goals as number,
  assists: assists as number, points: Number(goals) + Number(assists), games_played: 12,
  position: 'F', is_goalie: false, jersey_number: 12, plus_minus: 0 }));

function nodes(root: any, predicate: (n: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((n) => nodes(n, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...nodes(root.props.children, predicate)];
}

function runtime(getRows?: (...args: any[]) => Promise<any[]>, width = 390) {
  const h = createHookHarness();
  const calls: any[][] = [], navigationCalls: any[][] = [];
  const league: any = { activeLeague: { id: 'league-a', name: 'Harbour League' }, activeDivision: null,
    divisions: [], availableLeagues: [], activeTheme: { backgroundColor: '#07111F', primaryColor: '#22D3EE' }, setActiveDivision: () => {} };
  const native = { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable',
    StyleSheet: { create: (s: any) => s, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width, height: 844, fontScale: 1 }),
    FlatList: (p: any) => createElement('FlatList', p, p.ListHeaderComponent,
      ...(p.data ?? []).map((item: any, index: number) => p.renderItem({ item, index })),
      !p.data?.length ? p.ListEmptyComponent : null),
  };
  const colors = { __esModule: true, default: { primary: '#22D3EE', bgBase: '#07111F', textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', brandGold: '#E4C85A' } };
  const componentPath = new URL('../../src/components/StatsLeadersCard.tsx', import.meta.url);
  const Card = existsSync(fileURLToPath(componentPath.toString())) ? compileCommonJs<{ default: (props: any) => unknown }>(componentPath, {
    react: h.react, 'react-native': native, 'expo-linear-gradient': { LinearGradient: (p: any) => createElement('LinearGradient', p, p.children) },
    '@expo/vector-icons': { Ionicons: 'Ionicon' }, './Avatar': (p: any) => createElement('Avatar', p),
    '../theme/colors': colors, '../theme/ui': { ui: { minTouchTarget: 44 } },
  }).default : () => null;
  const Stats = compileCommonJs<{ default: () => unknown }>(new URL('../../src/screens/StatsScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': native, '@react-navigation/native': { useNavigation: () => ({}) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/StatsLeadersCard': { __esModule: true, default: Card },
    '../components/DivisionFilter': (p: any) => createElement('DivisionFilter', p),
    '../components/GuestBanner': () => null,
    '../components/PillToggle': (p: any) => createElement('PillToggle', p),
    '../components/PlayerRow': (p: any) => createElement('PlayerRow', p, p.name),
    '../components/SectionHeader': (p: any) => createElement('SectionHeader', p, p.title),
    '../context/LeagueContext': { useLeague: () => league },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: false, reduceTransparency: false }) },
    '../navigation/playerCard': { navigateToPlayerCard: (...args: any[]) => navigationCalls.push(args) },
    '../lib/supabase/client': { supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } },
    '../lib/supabase/data': {
      getStatsLeaders: async (...args: any[]) => { calls.push(args); if (getRows) return getRows(...args); return [...players].sort((a: any,b: any) => b[args[1]]-a[args[1]]).slice(0,args[2]); },
      getGoalieLeaders: async () => [],
    },
    '../lib/supabase/publicStats': { getPublicGoalies: async () => ({ presentationSeason: null, source: 'empty', goalies: [] }) },
    '../theme/colors': colors,
  }).default;
  h.mount(() => Stats());
  return { h, calls, navigationCalls, league };
}
async function settle(r: ReturnType<typeof runtime>) { for (let i=0;i<8;i++) { await new Promise<void>(resolve => setImmediate(resolve)); r.h.render(); } return r.h.output; }
function cardRows(root: any) { return nodes(findNode(root, n => n.props.testID === 'stats-leaders-card'), n => typeof n.props.testID === 'string' && n.props.testID.startsWith('stats-leader-row-')); }

describe('Stats top-five leaders card', () => {
  it('exposes each metric button pressed state for browser assistive technology', async () => {
    const r = runtime();
    await settle(r);
    for (const metric of ['goals', 'assists', 'points'] as const) {
      findNode(r.h.output, n => n.props.testID === `stats-leaders-tab-${metric}`)!.props.onPress();
      await settle(r);
      for (const key of ['goals', 'assists', 'points'] as const) {
        const button = findNode(r.h.output, n => n.props.testID === `stats-leaders-tab-${key}`)!;
        assert.equal(button.props.accessibilityRole, 'button');
        assert.equal(button.props['aria-pressed'], key === metric);
        assert.equal(button.props.accessibilityState.selected, key === metric);
      }
    }
  });
  it('mounts above the existing list and requests the top five GOALS, not the points subset', async () => {
    const r = runtime(); const output = await settle(r);
    const card = findNode(output, n => n.props.testID === 'stats-leaders-card');
    assert.ok(card, 'actual Stats screen mounts the leaders card');
    assert.ok(r.calls.some(args => args[0] === 'league-a' && args[1] === 'goals' && args[2] === 5));
    assert.deepEqual(cardRows(output).map(n => n.props.testID), ['f','a','b','c','d'].map(id => `stats-leader-row-${id}`));
    assert.equal(findNode(card, n => n.props.testID === 'stats-leaders-tab-goals')?.props.accessibilityState.selected, true);
    const flat = findNode(output, n => n.type === 'FlatList');
    assert.ok(findNode(flat?.props.ListHeaderComponent, n => n.props.testID === 'stats-leaders-card'));
  });

  it('toggles Goals / Assists / Points, updates actual ranking values, and opens the native player card', async () => {
    const r = runtime(undefined, 320); await settle(r);
    for (const [metric, expected] of [['assists',['e','a','c','d','b']], ['points',['e','a','c','d','f']], ['goals',['f','a','b','c','d']]] as const) {
      findNode(r.h.output, n => n.props.testID === `stats-leaders-tab-${metric}`)?.props.onPress();
      const output = await settle(r);
      assert.deepEqual(cardRows(output).map(n => n.props.testID), expected.map(id => `stats-leader-row-${id}`));
      assert.equal(findNode(output, n => n.props.testID === `stats-leaders-tab-${metric}`)?.props.accessibilityState.selected, true);
    }
    cardRows(r.h.output)[0].props.onPress();
    assert.deepEqual(r.navigationCalls[0][1], { playerId: 'f', leagueId: 'league-a' });
  });

  it('shows an honest empty card instead of creating five placeholder players', async () => {
    const r = runtime(async () => []); const output = await settle(r);
    assert.equal(cardRows(output).length, 0);
    assert.ok(findNode(output, n => n.props.testID === 'stats-leaders-empty'));
  });

  it('shows retryable errors without losing the metric toggle', async () => {
    let failure = true;
    const r = runtime(async (_league, _metric, limit) => { if (limit === 5 && failure) throw new Error('offline stats failure'); return players.slice(0,limit); });
    let output = await settle(r);
    assert.ok(findNode(output, n => n.props.testID === 'stats-leaders-error'));
    assert.ok(findNode(output, n => n.props.testID === 'stats-leaders-tab-assists'));
    failure = false;
    findNode(output, n => n.props.testID === 'stats-leaders-retry')?.props.onPress();
    output = await settle(r);
    assert.equal(cardRows(output).length, 5);
    assert.equal(findNode(output, n => n.props.testID === 'stats-leaders-error'), undefined);
  });

  it('ignores late metric responses and clears old league/division identities before new reads settle', async () => {
    let release!: (rows: any[]) => void;
    const r = runtime(async (league, metric, limit) => {
      if (limit === 5 && metric === 'goals' && league === 'league-a') return new Promise(resolve => { release=resolve; });
      return [...players].sort((a:any,b:any)=>b[metric]-a[metric]).slice(0,limit).map(p=>({...p,player_name:league==='league-b'?'B '+p.player_name:p.player_name}));
    });
    await settle(r); assert.ok(findNode(r.h.output,n=>n.props.testID==='stats-leaders-loading'));
    findNode(r.h.output,n=>n.props.testID==='stats-leaders-tab-assists')?.props.onPress();
    await settle(r); release([{...players[0],player_name:'STALE GOALS PLAYER'}]); await settle(r);
    assert.doesNotMatch(nodeText(findNode(r.h.output,n=>n.props.testID==='stats-leaders-card')),/STALE GOALS PLAYER/);
    r.league.activeLeague={id:'league-b',name:'Bay League'};r.league.activeDivision={id:'division-b',name:'B'};r.h.render();
    assert.equal(cardRows(r.h.output).length,0);
    await settle(r);
    assert.ok(r.calls.some(a=>a[0]==='league-b'&&a[1]==='assists'&&a[2]===5&&a[3]==='division-b'));
    assert.match(nodeText(cardRows(r.h.output)[0]),/B Eli Edge/);
  });
});
