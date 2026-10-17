/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimateLeagueLeaderLineWidth } from '../../src/lib/leaderPresentation';
import { buildGoalieRows, buildRankedRows, buildSkaterRows, type StatsScopePlayer } from '../../src/lib/statsPresentationModel';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness';

const metric = (
  value: number | null,
  state: PublicStatMetric['state'] = value === null ? 'unknown' : 'recorded',
  sources: PublicStatMetric['sources'] = value === null ? [] : ['skater_stats'],
): PublicStatMetric => ({ value, state, sources });

function player(playerName = 'Avery Player'): StatsScopePlayer {
  return {
    playerId: 'player-a', playerName, avatarUrl: null,
    displayTeam: { id: 'team-a', name: 'Owls', logoUrl: null },
    skater: {
      gamesPlayed: metric(4), goals: metric(2), assists: metric(3), points: metric(5), championships: metric(2, 'verified', ['player_badges']),
    },
    goalie: {
      gamesPlayed: metric(3, 'reported', ['goalie_stats']), goalsAgainst: metric(7, 'recorded', ['goalie_stats']),
      goalsAgainstAverage: metric(7 / 3, 'recorded', ['goalie_stats']), championships: metric(9, 'estimated', ['player_badges']),
    },
  };
}

function runtime(metricName: 'goals' | 'assists' | 'points' | 'gaa', showChampionships: boolean, reduceTransparency = false, playerName?: string) {
  const h = createHookHarness();
  const opened: string[] = [];
  const Row = compileCommonJs<any>(new URL('../../src/components/StatsRankedRow.tsx', import.meta.url), {
    react: h.react,
    'react-native': {
      Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
    },
    './Avatar': (props: any) => createElement('Avatar', props),
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency }) },
    '../lib/statsPresentationModel': { buildGoalieRows, buildSkaterRows },
    '../theme/ui': { getSurfacePalette: () => ({ surface: '#102030', interactive: '#203040', stroke: '#406080' }) },
  }).default;
  const row = buildRankedRows([player(playerName)], metricName)[0];
  h.mount(() => Row({ row, metric: metricName, showChampionships, onOpenPlayer: (id: string) => opened.push(id) }));
  return { h, opened };
}

describe('Stats ranked row metrics', () => {
  it('losslessly fits the exact pathological identity to a measured narrow name lane', () => {
    const identity = 'Alexandra-Mae Fixture-Sutherland-Winterbourne';
    const laneWidth = 139;
    const { h } = runtime('points', false, false, identity);
    const nameBlock = findNode(h.output, (node) => node.props.testID === 'stats-ranked-name-block-player-a');
    assert.ok(nameBlock, 'the mounted ranked row must expose and measure its actual name lane');
    assert.equal(typeof nameBlock.props.onLayout, 'function');

    nameBlock.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: laneWidth, height: 34 } } });
    h.render();

    const measuredBlock = findNode(h.output, (node) => node.props.testID === 'stats-ranked-name-block-player-a')!;
    const explicitLines = (Array.isArray(measuredBlock.props.children) ? measuredBlock.props.children.flat() : [measuredBlock.props.children])
      .filter((child): child is TestNode => Boolean(child && typeof child === 'object' && 'props' in child));
    const givenLines = explicitLines.filter((line) => line.props.testID === 'stats-ranked-given-player-a');
    const surnameLines = explicitLines.filter((line) => String(line.props.testID).startsWith('stats-ranked-surname-player-a-'));

    assert.equal(givenLines.length, 1, 'given name must be one explicit Text line');
    assert.ok(surnameLines.length >= 1 && surnameLines.length <= 2, 'surname must use one or two explicit Text lines');
    for (const line of [...givenLines, ...surnameLines]) {
      const style = flattenStyle(line.props.style);
      assert.equal(line.type, 'Text');
      assert.equal(line.props.numberOfLines, 1, `${line.props.testID} must be constrained to one rendered line`);
      assert.equal(line.props.adjustsFontSizeToFit, true);
      assert.equal(line.props.ellipsizeMode, undefined, `${line.props.testID} must not request ellipsis`);
      assert.ok(style.fontSize >= 9.5, `${line.props.testID} must keep the readable 9.5pt floor`);
      assert.ok(style.fontSize * line.props.minimumFontScale >= 9.5 - 0.01, `${line.props.testID} fit floor must remain readable`);
      assert.ok(estimateLeagueLeaderLineWidth(nodeText(line), { fontSize: style.fontSize }) <= laneWidth + 0.01, `${line.props.testID} must fit the measured lane`);
    }
    assert.equal(nodeText(givenLines[0]), 'Alexandra-Mae');
    assert.equal(surnameLines.map(nodeText).join(''), 'Fixture-Sutherland-Winterbourne');

    const row = findNode(h.output, (node) => node.props.testID === 'stats-ranked-row-player-a')!;
    assert.equal(
      row.props.accessibilityLabel,
      'Rank 1. Alexandra-Mae Fixture-Sutherland-Winterbourne, Owls. GP 4, G 2, A 3, PTS 5, GPG 0.50, PPG 1.25. Open player card.',
    );
  });

  it('shows every requested skater metric with two-decimal rates and scope-gated Champs', () => {
    const { h } = runtime('points', true);
    const row = findNode(h.output, (node) => node.props.testID === 'stats-ranked-row-player-a')!;
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-primary-player-a')), '5PTS');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-gp')), '4GP');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-g')), '2G');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-a')), '3A');
    assert.equal(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-pts'), undefined, 'selected PTS remains visible as the primary metric instead of being duplicated');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-gpg')), '0.50GPG');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-ppg')), '1.25PPG');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-ch')), '2Champs');

    const hidden = runtime('points', false).h.output;
    assert.equal(findNode(hidden, (node) => node.props.testID === 'stats-ranked-metric-player-a-ch'), undefined);
  });

  it('keeps authoritative goalie GP and GA visible beside ranked GAA while unavailable Champs stays blank', () => {
    const { h } = runtime('gaa', true);
    const row = findNode(h.output, (node) => node.props.testID === 'stats-ranked-row-player-a')!;
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-primary-player-a')), '2.3GAA');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-gp')), '3GP');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-ga')), '7GA');
    assert.equal(nodeText(findNode(row, (node) => node.props.testID === 'stats-ranked-metric-player-a-ch')), '—Champs');
    assert.match(row.props.accessibilityLabel, /GP 3.*GA 7.*GAA 2\.3.*Champs unavailable/i);
    assert.doesNotMatch(row.props.accessibilityLabel, /estimated|\b9\b/i);
  });
});
