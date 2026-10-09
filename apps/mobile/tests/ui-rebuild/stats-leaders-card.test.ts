/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLeaderRows, type StatsLeaderMetric, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const metric = (value: number | null): PublicStatMetric => ({ value, state: value === null ? 'unknown' : 'recorded', sources: value === null ? [] : ['skater_stats'] });
const players: StatsScopePlayer[] = [
  ['a', 'Ada Wing', 15, 45], ['b', 'Ben Blue', 14, 10], ['c', 'Cam Centre', 13, 35],
  ['d', 'Drew Defence', 12, 30], ['e', 'Eli Edge', 11, 50], ['f', 'Finn Finisher', 25, 1],
].map(([id, name, goals, assists]) => ({
  playerId: id as string, playerName: name as string, avatarUrl: null,
  displayTeam: { id: '44444444-4444-4444-8444-444444444444', name: 'Stars', logoUrl: null },
  skater: { gamesPlayed: metric(12), goals: metric(goals as number), assists: metric(assists as number), points: metric(Number(goals) + Number(assists)), championships: metric(0) }, goalie: null,
}));
players.push(
  { ...players[0], playerId: 'g1', playerName: 'Goalie One', skater: null, goalie: { gamesPlayed: metric(2), goalsAgainst: metric(3), goalsAgainstAverage: metric(1.5), championships: metric(0) } },
  { ...players[0], playerId: 'g2', playerName: 'Goalie Two', skater: null, goalie: { gamesPlayed: metric(2), goalsAgainst: metric(4), goalsAgainstAverage: metric(2), championships: metric(0) } },
);

function allNodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((node) => allNodes(node, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...allNodes(root.props.children, predicate)];
}

function runtime(initialPlayers: StatsScopePlayer[] = players, initialStatus: 'ready' | 'error' = 'ready', resolveArtwork?: (_league: string, leader: any) => any) {
  const h = createHookHarness();
  const opened: string[] = [];
  let retryCount = 0;
  let currentPlayers = initialPlayers;
  const native = {
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
  };
  const Card = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/components/StatsLeadersCard.tsx', import.meta.url), {
    react: h.react,
    'react-native': native,
    '../../assets/league-leaders/jack-foote.png': { art: 'jack' },
    '../../assets/league-leaders/neutral-goalie.png': { art: 'goalie' },
    '../../assets/league-leaders/neutral-helmet-player.png': { art: 'skater' },
    '../lib/homeLeagueLeaders': { resolveLeaderArtwork: resolveArtwork ?? ((_league: string, leader: any) => ({ kind: 'neutral', identityKey: leader.player_id, artworkId: leader.is_goalie ? 'neutral-goalie-v1' : 'neutral-helmet-v1', accessibilityLabel: 'fallback' })) },
    '../lib/playerArtworkManifest': { loadPlayerArtworkManifest: async () => null },
    './TeamLogo': (props: any) => createElement('TeamLogo', props),
  }).default;
  function Root() {
    const [selected, setSelected] = h.react.useState<StatsLeaderMetric>('points');
    return Card({ leagueId: 'league-a', metric: selected, leaders: buildLeaderRows(currentPlayers, selected), status: initialStatus, onMetricChange: setSelected, onRetry: () => { retryCount += 1; }, onOpenPlayer: (id: string) => opened.push(id) });
  }
  h.mount(Root);
  return { h, opened, get retryCount() { return retryCount; }, replacePlayers(next: StatsScopePlayer[]) { currentPlayers = next; h.render(); } };
}

function rows(root: any) {
  return allNodes(root, (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('stats-leader-row-'));
}

describe('Stats top-five leaders card', () => {
  it('exposes all four approved metric tabs with selected state', () => {
    const result = runtime();
    for (const selected of ['points', 'goals', 'assists', 'gaa'] as const) {
      findNode(result.h.output, (node) => node.props.testID === `stats-leaders-tab-${selected}`)!.props.onPress();
      result.h.render();
      for (const key of ['points', 'goals', 'assists', 'gaa'] as const) {
        const tab = findNode(result.h.output, (node) => node.props.testID === `stats-leaders-tab-${key}`)!;
        assert.equal(tab.props.accessibilityRole, 'tab');
        assert.equal(tab.props['aria-selected'], key === selected);
        assert.equal(tab.props.accessibilityState.selected, key === selected);
      }
    }
  });

  it('renders a compact deterministic top five for the default Points metric', () => {
    const result = runtime();
    assert.deepEqual(rows(result.h.output).map((node) => node.props.testID), ['e', 'a', 'c', 'd', 'f'].map((id) => `stats-leader-row-${id}`));
    assert.equal(findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-tab-points')?.props.accessibilityState.selected, true);
    assert.ok(findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art'));
    const first = rows(result.h.output)[0];
    const children = first.props.children;
    assert.equal(children[0].type, 'Text');
    assert.equal(children[1].type, 'TeamLogo');
    assert.equal(children[2].type, 'View');
    assert.equal(children[3].type, 'View');
    assert.equal(children[2].props.children.length, 2, 'given name and surname stay stacked');
    assert.equal(nodeText(children[2]), 'EliEdge');
  });

  it('updates actual rankings, supports GAA, and opens native player cards', () => {
    const result = runtime();
    for (const [selected, expected] of [['assists', ['e', 'a', 'c', 'd', 'b']], ['goals', ['f', 'a', 'b', 'c', 'd']], ['gaa', ['g1', 'g2']]] as const) {
      findNode(result.h.output, (node) => node.props.testID === `stats-leaders-tab-${selected}`)!.props.onPress();
      result.h.render();
      assert.deepEqual(rows(result.h.output).map((node) => node.props.testID), expected.map((id) => `stats-leader-row-${id}`));
    }
    rows(result.h.output)[0].props.onPress();
    assert.deepEqual(result.opened, ['g1']);
  });

  it('shows honest emptiness without placeholder players', () => {
    const result = runtime([]);
    assert.equal(rows(result.h.output).length, 0);
    assert.ok(findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-empty'));
    assert.ok(findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-tab-gaa'));
  });

  it('keeps retry behavior for an unavailable complete scope', () => {
    const result = runtime([], 'error');
    findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-retry')!.props.onPress();
    assert.equal(result.retryCount, 1);
  });

  it('clears old player identities synchronously when scope data changes', () => {
    const result = runtime();
    result.replacePlayers(players.map((player) => ({ ...player, playerId: `new-${player.playerId}`, playerName: `New ${player.playerName}` })));
    assert.ok(rows(result.h.output).every((node) => node.props.testID.startsWith('stats-leader-row-new-')));
  });

  it('falls back from remote art to bundled art, player photo, then neutral art', () => {
    const result = runtime(players, 'ready', (_league, leader) => ({
      kind: 'remote', identityKey: leader.player_id, uri: 'https://example.test/approved.png',
      bundledFallback: 'jack-foote-v1', fallbackUri: 'https://example.test/photo.png', accessibilityLabel: 'Approved player artwork',
    }));
    const art = () => findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art')!;
    assert.deepEqual(art().props.source, { uri: 'https://example.test/approved.png', cache: 'force-cache' });
    assert.equal(art().props.accessibilityLabel, 'Approved player artwork');
    art().props.onError(); result.h.render(); assert.deepEqual(art().props.source, { art: 'jack' });
    art().props.onError(); result.h.render(); assert.deepEqual(art().props.source, { uri: 'https://example.test/photo.png' });
    art().props.onError(); result.h.render(); assert.deepEqual(art().props.source, { art: 'skater' });
    assert.equal(art().props.style.height, '108%');
    assert.equal(art().props.style.bottom, -5);
  });

  it('ignores a delayed A1 failure after an A to B to A2 artwork sequence', () => {
    const result = runtime(players, 'ready', (_league, leader) => ({
      kind: 'remote', identityKey: leader.player_id, uri: `https://example.test/${leader.player_id}.png`,
      bundledFallback: 'jack-foote-v1', fallbackUri: `https://example.test/${leader.player_id}-photo.png`, accessibilityLabel: leader.player_name,
    }));
    const oldArt = findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art')!;
    const bPlayers = players.map((player) => player.playerId === 'b'
      ? { ...player, skater: { ...player.skater!, points: metric(100) } }
      : player);
    result.replacePlayers(bPlayers);
    assert.match(findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art')!.props.accessibilityLabel, /^Ben /);
    result.replacePlayers(players);
    const newArt = () => findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art')!;
    const currentSource = newArt().props.source;
    oldArt.props.onError();
    result.h.render();
    assert.deepEqual(newArt().props.source, currentSource);
    assert.match(newArt().props.accessibilityLabel, /^Eli /);
  });
});
