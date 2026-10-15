/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateLeagueLeaderLineWidth } from '../../src/lib/leaderPresentation';
import { buildLeaderRows, type StatsLeaderMetric, type StatsLeaderRow, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

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
  { ...players[0], playerId: 'g3', playerName: 'Goalie Three', skater: null, goalie: { gamesPlayed: metric(2), goalsAgainst: metric(5), goalsAgainstAverage: metric(2.5), championships: metric(0) } },
  { ...players[0], playerId: 'g4', playerName: 'Goalie Four', skater: null, goalie: { gamesPlayed: metric(2), goalsAgainst: metric(6), goalsAgainstAverage: metric(3), championships: metric(0) } },
  { ...players[0], playerId: 'g5', playerName: 'Goalie Five', skater: null, goalie: { gamesPlayed: metric(2), goalsAgainst: metric(7), goalsAgainstAverage: metric(3.5), championships: metric(0) } },
);

function allNodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((node) => allNodes(node, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...allNodes(root.props.children, predicate)];
}

function runtime(
  initialPlayers: StatsScopePlayer[] = players,
  initialStatus: 'loading' | 'ready' | 'error' = 'ready',
  resolveArtwork?: (_league: string, leader: any) => any,
  leaderRows: (rows: readonly StatsScopePlayer[], metric: StatsLeaderMetric) => StatsLeaderRow[] = buildLeaderRows,
  width = 320,
  fontScale = 1,
  reduceTransparency = false,
) {
  const h = createHookHarness();
  const opened: string[] = [];
  let retryCount = 0;
  let currentPlayers = initialPlayers;
  let setMetric: ((metric: StatsLeaderMetric) => void) | null = null;
  const native = {
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    PixelRatio: { getFontScale: () => fontScale },
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
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency }) },
    '../theme/ui': { getSurfacePalette: (reduced: boolean) => reduced
      ? { surface: '#102030', elevated: '#182838', interactive: '#203040', stroke: '#406080' }
      : { surface: 'rgba(16,32,48,0.3)', elevated: 'rgba(24,40,56,0.4)', interactive: 'rgba(32,48,64,0.7)', stroke: 'rgba(64,96,128,0.4)' } },
    './TeamLogo': (props: any) => createElement('TeamLogo', props),
  }).default;
  function Root() {
    const [selected, setSelected] = h.react.useState<StatsLeaderMetric>('points');
    setMetric = setSelected;
    return Card({ leagueId: 'league-a', width, metric: selected, leaders: leaderRows(currentPlayers, selected), status: initialStatus, onRetry: () => { retryCount += 1; }, onOpenPlayer: (id: string) => opened.push(id) });
  }
  h.mount(Root);
  return {
    h,
    opened,
    get retryCount() { return retryCount; },
    selectMetric(metric: StatsLeaderMetric) { setMetric!(metric); h.render(); },
    replacePlayers(next: StatsScopePlayer[]) { currentPlayers = next; h.render(); },
  };
}

function rows(root: any) {
  return allNodes(root, (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('stats-leader-row-'));
}

function percentWidth(value: unknown, parentWidth: number): number {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^\d+(?:\.\d+)?%$/);
  return parentWidth * Number.parseFloat(value as string) / 100;
}

function backgroundAlpha(style: unknown): number {
  const color = flattenStyle(style).backgroundColor;
  if (typeof color !== 'string') return 0;
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

describe('Stats top-five leaders card', () => {
  it('renders no local metric selector and follows the authoritative page metric', () => {
    const result = runtime();
    assert.equal(findNode(result.h.output, (node) => String(node.props.testID ?? '').startsWith('stats-leaders-tab-')), undefined);
    for (const selected of ['points', 'goals', 'assists', 'gaa'] as const) {
      result.selectMetric(selected);
      assert.ok(rows(result.h.output).length > 0, `${selected} leaders render from the page-owned metric`);
      assert.ok(rows(result.h.output).every((row) => row.props.accessibilityLabel.includes(selected)));
    }
  });

  it('renders a compact deterministic top five for the default Points metric', () => {
    const result = runtime();
    assert.deepEqual(rows(result.h.output).map((node) => node.props.testID), ['e', 'a', 'c', 'd', 'f'].map((id) => `stats-leader-row-${id}`));
    assert.ok(findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art'));
    const first = rows(result.h.output)[0];
    const children = first.props.children;
    assert.equal(children.length, 3, 'rank, crest, and facts remain the row structure');
    assert.equal(children[0].type, 'Text');
    assert.equal(children[1].type, 'TeamLogo');
    assert.equal(children[2].type, 'View');
    assert.equal(children[2].props.children.length, 3, 'given name, surname, and metric stay stacked together');
    assert.equal(nodeText(children[2].props.children.slice(0, 2)), 'EliEdge');
    assert.equal(nodeText(children[2].props.children[2]), '61PTS');
  });

  it('makes the fact rail plus loading, error, and empty surfaces opaque only under Reduced Transparency', () => {
    const normal = runtime(players, 'ready', undefined, buildLeaderRows, 320, 1.8, false);
    assert.ok(backgroundAlpha(findNode(normal.h.output, (node) => node.props.testID === 'stats-leaders-rows')?.props.style) < 1);
    assert.equal(flattenStyle(rows(normal.h.output)[0].props.style({ pressed: true })).opacity, 0.72,
      'ordinary leader rows retain their existing translucent pressed feedback');

    const reduced = runtime(players, 'ready', undefined, buildLeaderRows, 320, 1.8, true);
    assert.equal(backgroundAlpha(findNode(reduced.h.output, (node) => node.props.testID === 'stats-leaders-rows')?.props.style), 1);
    for (const row of rows(reduced.h.output)) {
      const resting = flattenStyle(row.props.style({ pressed: false }));
      const pressed = flattenStyle(row.props.style({ pressed: true }));
      assert.equal(pressed.opacity ?? 1, 1, `${row.props.testID} keeps computed opacity 1 while pressed`);
      assert.equal(backgroundAlpha(pressed), 1, `${row.props.testID} keeps an opaque pressed background`);
      assert.ok(
        pressed.backgroundColor !== resting.backgroundColor || pressed.borderColor !== resting.borderColor,
        `${row.props.testID} preserves press feedback with an opaque color or border change`,
      );
    }

    for (const [status, testID] of [
      ['loading', 'stats-leaders-loading'],
      ['error', 'stats-leaders-error'],
      ['ready', 'stats-leaders-empty'],
    ] as const) {
      const state = runtime([], status, undefined, buildLeaderRows, 320, 1.8, true);
      assert.equal(backgroundAlpha(findNode(state.h.output, (node) => node.props.testID === testID)?.props.style), 1, `${status} state is opaque`);
    }
  });

  it('keeps five-row Points and GAA facts out of the artwork lane at every supported phone width', () => {
    for (const width of [320, 390, 430]) {
      for (const selected of ['points', 'gaa'] as const) {
        const result = runtime(players, 'ready', undefined, buildLeaderRows, width);
        if (selected === 'gaa') result.selectMetric('gaa');

        const renderedRows = rows(result.h.output);
        assert.equal(renderedRows.length, 5, `${width}px ${selected} renders the full top five`);
        const contentWidth = width - 32;
        const rowsNode = findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-rows')!;
        const artStage = findNode(result.h.output, (node) => node.props.accessibilityLabel?.startsWith('Open ') && node.props.accessibilityLabel?.endsWith(' player card'))!;
        const rowsWidth = percentWidth(flattenStyle(rowsNode.props.style).width, contentWidth);
        const artWidth = percentWidth(flattenStyle(artStage.props.style).width, contentWidth);
        const artLeft = contentWidth - artWidth;
        assert.ok(
          rowsWidth <= artLeft,
          `${width}px ${selected} fact rail ends at ${rowsWidth.toFixed(2)}px but artwork starts at ${artLeft.toFixed(2)}px (${(rowsWidth - artLeft).toFixed(2)}px overlap)`,
        );

        for (const row of renderedRows) {
          const rowStyle = flattenStyle(row.props.style({ pressed: false }));
          const [rank, crest, facts] = row.props.children;
          const factWidth = rowsWidth
            - Number(flattenStyle(rank.props.style).width)
            - Number(crest.props.size)
            - Number(rowStyle.gap) * 2;
          assert.ok(factWidth >= 96, `${width}px ${selected} keeps at least 96px for the complete split name and metric`);
          assert.ok(
            findNode(facts, (node) => node.props.testID === row.props.testID.replace('stats-leader-row-', 'stats-leader-score-')),
            `${width}px ${selected} stacks the value and unit under the two-line name inside the separated fact rail`,
          );
          const factRight = Number(flattenStyle(rank.props.style).width) + Number(rowStyle.gap)
            + Number(crest.props.size) + Number(rowStyle.gap) + factWidth;
          assert.ok(factRight <= artLeft, `${width}px ${selected} row facts stay left of the artwork lane`);
        }

        const composition = findNode(result.h.output, (node) => flattenStyle(node.props.style).height === 330)!;
        const sample = renderedRows[0];
        const sampleRowStyle = flattenStyle(sample.props.style({ pressed: false }));
        const [, , sampleFacts] = sample.props.children;
        const [given, surnameGroup, sampleScore] = sampleFacts.props.children;
        const surnameLines = allNodes(surnameGroup, (node) => node.type === 'Text');
        const [value, unit] = sampleScore.props.children;
        const enlargedFactHeight = Number(flattenStyle(given.props.style).lineHeight) * Number(given.props.maxFontSizeMultiplier)
          + surnameLines.reduce((total, line) => total + Number(flattenStyle(line.props.style).lineHeight) * Number(line.props.maxFontSizeMultiplier), 0)
          + Math.max(
            Number(flattenStyle(value.props.style).lineHeight) * Number(value.props.maxFontSizeMultiplier),
            Number(flattenStyle(unit.props.style).lineHeight) * Number(unit.props.maxFontSizeMultiplier),
          )
          + Number(sampleRowStyle.paddingVertical) * 2;
        assert.ok(enlargedFactHeight <= Number(flattenStyle(composition.props.style).height) / renderedRows.length,
          `${width}px ${selected} keeps the stacked facts inside each row at the allowed text scale`);
      }
    }
  });

  it('losslessly splits required long surnames into at most two estimator-safe lines at 320px normal and enlarged text', () => {
    const longNamePlayers = players.map((player) => player.playerId === 'e' ? {
      ...player,
      playerName: 'Maximilian Montgomery-Smythe',
    } : player.playerId === 'a' ? {
      ...player,
      playerName: 'Anastasia de la Cruz-Santamaría',
    } : player);
    const expectedSurnames = new Map([['e', 'Montgomery-Smythe'], ['a', 'de la Cruz-Santamaría']]);

    for (const fontScale of [1, 1.8]) {
      const result = runtime(longNamePlayers, 'ready', undefined, buildLeaderRows, 320, fontScale);
      const renderedRows = rows(result.h.output);
      assert.equal(renderedRows.length, 5, `${fontScale} text scale retains all five rows`);
      const rowsNode = findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-rows')!;
      const rowsWidth = percentWidth(flattenStyle(rowsNode.props.style).width, 320 - 32);

      for (const [playerId, expectedSurname] of expectedSurnames) {
        const row = findNode(result.h.output, (node) => node.props.testID === `stats-leader-row-${playerId}`)!;
        const [rank, crest, facts] = row.props.children;
        const rowStyle = flattenStyle(row.props.style({ pressed: false }));
        const actualFactsWidth = rowsWidth
          - Number(flattenStyle(rank.props.style).width)
          - Number(crest.props.size)
          - Number(rowStyle.gap) * 2;
        const surnameBlock = findNode(facts, (node) => node.props.testID === `stats-leader-surname-${playerId}`)!;
        assert.ok(surnameBlock, `${expectedSurname} exposes its deterministic line group`);
        const surnameLines = allNodes(surnameBlock, (node) => node.type === 'Text');
        assert.ok(surnameLines.length >= 1 && surnameLines.length <= 2);
        assert.equal(surnameLines.map(nodeText).join(''), expectedSurname, 'line splitting preserves every surname character');
        for (const line of surnameLines) {
          assert.equal(line.props.numberOfLines, undefined, 'lossless lines never opt into ellipsis');
          assert.equal(line.props.ellipsizeMode, undefined, 'lossless lines never opt into ellipsis');
          const lineStyle = flattenStyle(line.props.style);
          const effectiveScale = Math.min(fontScale, Number(line.props.maxFontSizeMultiplier));
          const requiredWidth = estimateLeagueLeaderLineWidth(nodeText(line), { fontSize: Number(lineStyle.fontSize) * effectiveScale });
          assert.ok(requiredWidth <= actualFactsWidth,
            `${fontScale} text scale ${nodeText(line)} requires ${requiredWidth.toFixed(4)}px but has ${actualFactsWidth.toFixed(4)}px`);
        }
        assert.match(row.props.accessibilityLabel, new RegExp(expectedSurname));
      }
    }
  });

  it('fits the required multi-token name and score inside a five-row 320px fact cell at normal and 1.35 text scale', () => {
    const longNamePlayers = players.map((player) => player.playerId === 'e' ? {
      ...player,
      playerName: 'Maximilian de la Cruz-Santamaría',
    } : player);

    for (const fontScale of [1, 1.35]) {
      const result = runtime(longNamePlayers, 'ready', undefined, buildLeaderRows, 320, fontScale);
      const renderedRows = rows(result.h.output);
      assert.equal(renderedRows.length, 5, `${fontScale} text scale retains all five rows`);
      const row = renderedRows[0];
      const [rank, crest, facts] = row.props.children;
      const [first, surnameGroup, score] = facts.props.children;
      const surnameLines = allNodes(surnameGroup, (node) => node.type === 'Text');
      assert.equal(nodeText(first), 'Maximilian');
      assert.equal(surnameLines.map(nodeText).join(''), 'de la Cruz-Santamaría');
      assert.ok(surnameLines.length <= 2);
      assert.equal(nodeText(score), '61PTS');
      assert.equal(first.props.numberOfLines, undefined);
      assert.ok(surnameLines.every((line) => line.props.numberOfLines === undefined));
      assert.match(row.props.accessibilityLabel, /Maximilian de la Cruz-Santamaría/);

      const rowsNode = findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-rows')!;
      const rowsWidth = percentWidth(flattenStyle(rowsNode.props.style).width, 320 - 32);
      const rowStyle = flattenStyle(row.props.style({ pressed: false }));
      const fixedWidth = Number(flattenStyle(rank.props.style).width) + Number(crest.props.size);
      const actualFactsWidth = rowsWidth - fixedWidth - Number(rowStyle.gap) * 2;
      const requiredWholeSurnameWidth = estimateLeagueLeaderLineWidth('de la Cruz-Santamaría', { fontSize: 9 * Math.min(fontScale, 1.35) });
      const blockedCandidateFactsWidth = rowsWidth - fixedWidth - 5 * 2;
      assert.ok(
        requiredWholeSurnameWidth > blockedCandidateFactsWidth,
        `${fontScale} text scale counterfactual stays sensitive to the blocked 5pt-gap facts width`,
      );
      for (const line of surnameLines) {
        const lineStyle = flattenStyle(line.props.style);
        const requiredLineWidth = estimateLeagueLeaderLineWidth(nodeText(line), { fontSize: Number(lineStyle.fontSize) * Math.min(fontScale, Number(line.props.maxFontSizeMultiplier)) });
        assert.ok(actualFactsWidth >= requiredLineWidth,
          `${fontScale} text scale surname line requires ${requiredLineWidth.toFixed(4)}px but the 320px facts cell provides ${actualFactsWidth.toFixed(4)}px`);
      }
    }
  });

  it('updates actual rankings, supports GAA, and opens native player cards', () => {
    const result = runtime();
    for (const [selected, expected] of [['assists', ['e', 'a', 'c', 'd', 'b']], ['goals', ['f', 'a', 'b', 'c', 'd']], ['gaa', ['g1', 'g2', 'g3', 'g4', 'g5']]] as const) {
      result.selectMetric(selected);
      assert.deepEqual(rows(result.h.output).map((node) => node.props.testID), expected.map((id) => `stats-leader-row-${id}`));
    }
    rows(result.h.output)[0].props.onPress();
    assert.deepEqual(result.opened, ['g1']);
  });

  it('renders Stats League Leader GAA from the raw value to one decimal even when a stale display string has two decimals', () => {
    const result = runtime(players, 'ready', undefined, (scopePlayers, selected) => buildLeaderRows(scopePlayers, selected).map((row) => (
      selected === 'gaa' ? { ...row, display: `${row.value.value?.toFixed(2)}` } : row
    )));
    result.selectMetric('gaa');

    const goalie = rows(result.h.output)[0];
    assert.match(nodeText(goalie), /1\.5GAA/);
    assert.doesNotMatch(nodeText(goalie), /1\.50|~/);
    assert.match(goalie.props.accessibilityLabel, /1\.5 gaa/i);
    assert.doesNotMatch(goalie.props.accessibilityLabel, /1\.50|~/);
  });

  it('shows honest emptiness without placeholder players', () => {
    const result = runtime([]);
    assert.equal(rows(result.h.output).length, 0);
    assert.ok(findNode(result.h.output, (node) => node.props.testID === 'stats-leaders-empty'));
    assert.equal(findNode(result.h.output, (node) => String(node.props.testID ?? '').startsWith('stats-leaders-tab-')), undefined);
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
    assert.deepEqual(art().props.style.transform, [{ scale: 0.8 }]);
  });

  it('scales skater and goalie feature art by exactly twenty percent without changing the feature hit area', () => {
    const result = runtime();
    const art = () => findNode(result.h.output, (node) => node.props.testID === 'stats-leader-feature-art')!;
    const stage = () => findNode(result.h.output, (node) => node.props.accessibilityLabel?.startsWith('Open ') && node.props.accessibilityLabel?.endsWith(' player card'))!;
    assert.deepEqual(art().props.style.transform, [{ scale: 0.8 }]);
    assert.equal(stage().props.style.minHeight, 44);

    result.selectMetric('gaa');
    assert.deepEqual(art().props.style.transform, [{ scale: 0.8 }]);
    assert.equal(stage().props.style.minHeight, 44);
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
