/* eslint-disable @typescript-eslint/no-explicit-any -- focused native component harness */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';
import { buildPlayoffPicture } from '../../src/lib/standingsModel.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

const standings = ['North', 'Copper', 'Lake', 'Cedar'].map((teamName, index) => ({
  teamId: `team-${index + 1}`, teamName, logoUrl: null, primaryColor: '#2694C4', divisionId: null, divisionName: null,
  wins: 3 - index, losses: index, ties: 0, points: 6 - index * 2, goalsFor: 10 - index, goalsAgainst: 3 + index, gamesPlayed: 3,
}));
const picture = { status: 'ready' as const, groups: [{ key: 'league', name: null, qualifierCount: 4, rounds: [{ roundNumber: 1, label: 'Semifinals' }, { roundNumber: 2, label: 'Championship' }], matchups: [
  { highSeed: standings[0], lowSeed: standings[3], highRank: 1, lowRank: 4 },
  { highSeed: standings[1], lowSeed: standings[2], highRank: 2, lowRank: 3 },
] }] };
const predictor = { status: 'ready', teams: standings.map((team, index) => ({ teamId: team.teamId, firstPlace: [0.86, 0.13, 0.008, 0][index], makePlayoffs: 1 })) };

describe('corrected native standings visuals', () => {
  it('PV1 renders a connected seeded bracket and switches through 44pt controls to the labeled odds table', () => {
    const harness = createHookHarness();
    const panelModule = compileCommonJs<any>(new URL('../../src/components/StandingsPlayoffsPanel.tsx', import.meta.url), {
      react: harness.react,
      'react-native': {
        Image: 'Image', Pressable: 'Pressable', ScrollView: ({ children, ...props }: any) => createElement('ScrollView', props, children),
        StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1, absoluteFillObject: { position: 'absolute', inset: 0 } }, Text: 'Text', View: 'View',
      },
      '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicon', props) },
      './TeamLogo': (props: any) => createElement('TeamLogo', props),
      '../../assets/playoff-trophy.png': 'playoff-trophy.png',
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333' } },
    });
    const Panel = panelModule.default;
    const expectedSegments = [
      [78, 43, 96, 43], [78, 153, 96, 153], [96, 43, 96, 153], [96, 99, 156, 99],
      [78, 287, 96, 287], [78, 397, 96, 397], [96, 287, 96, 397], [96, 343, 156, 343],
      [234, 99, 254, 99], [234, 343, 254, 343], [254, 99, 254, 343], [254, 215, 280, 215], [412, 223, 442, 223],
    ];
    assert.equal(panelModule.CANONICAL_BRACKET_GEOMETRY.width, 520);
    assert.equal(panelModule.CANONICAL_BRACKET_GEOMETRY.height, 446);
    assert.deepEqual(panelModule.CANONICAL_BRACKET_GEOMETRY.segments.map((segment: any) => [segment.x1, segment.y1, segment.x2, segment.y2]), expectedSegments);
    harness.mount(() => Panel({ picture, predictor, standings, accentColor: '#2694C4' }));
    assert.ok(findNode(harness.output, (node) => node.props.testID === 'playoff-connected-bracket'));
    assert.equal(allNodes(harness.output).filter((node) => node.type === 'TeamLogo').length, 4);
    const connectors = allNodes(harness.output).filter((node) => String(node.props.testID).startsWith('bracket-connector-'));
    assert.equal(connectors.length, 13);
    assert.deepEqual(connectors.map((node) => {
      const style = flattenStyle(node.props.style);
      return { left: style.left, top: style.top, width: style.width, height: style.height };
    }), panelModule.CANONICAL_BRACKET_GEOMETRY.segments.map(panelModule.bracketConnectorStyle));
    for (const connector of connectors) {
      const style = flattenStyle(connector.props.style);
      assert.equal(style.backgroundColor, '#8f7a4b');
      assert.equal(style.opacity, 0.95);
      assert.equal(style.borderRadius, 1.125);
      assert.ok(style.width === 2.25 || style.height === 2.25);
    }
    for (const [id, left, top] of [['1', 0, 4], ['4', 0, 114], ['2', 0, 248], ['3', 0, 358], ['semi-1', 156, 60], ['semi-2', 156, 304], ['winner', 442, 184]] as const) {
      const node = findNode(harness.output, (candidate) => candidate.props.testID === `bracket-node-${id}`);
      const style = flattenStyle(node?.props.style);
      assert.deepEqual([style.left, style.top], [left, top]);
      assert.equal(style.backgroundColor, '#16130f');
      assert.equal(style.borderColor, '#8f7a4b');
      assert.equal(style.shadowColor, '#000000');
      assert.equal(style.shadowOpacity, 0.26);
      const inset = findNode(harness.output, (candidate) => candidate.props.testID === `bracket-node-${id}-inset`);
      const insetStyle = flattenStyle(inset?.props.style);
      assert.equal(insetStyle.borderColor, 'rgba(143,122,75,0.26)');
      assert.equal(insetStyle.borderWidth, 1);
    }
    const trophy = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Championship trophy');
    assert.ok(trophy);
    const trophyStyle = flattenStyle(trophy.props.style);
    assert.deepEqual([trophyStyle.left, trophyStyle.top, trophyStyle.width, trophyStyle.height], [292, 154, 120, 120]);
    const oddsButton = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Show playoff odds');
    assert.ok(oddsButton);
    assert.ok((flattenStyle(oddsButton.props.style).minHeight ?? 0) >= 44);
    oddsButton.props.onPress();
    harness.render();
    const text = nodeText(harness.output);
    for (const label of ['Team', 'Record', '1st Place', 'Make Playoffs', '3-0-0', '86%']) assert.match(text, new RegExp(label));
    assert.equal(allNodes(harness.output).filter((node) => node.props.testID === 'playoff-probability-bar').length, 8);
  });

  it('PV1R renders factual model-derived round labels and canonical unresolved shields for 2, 3, and 4 teams', () => {
    const render = (teamCount: number) => {
      const harness = createHookHarness();
      const Panel = compileCommonJs<any>(new URL('../../src/components/StandingsPlayoffsPanel.tsx', import.meta.url), {
        react: harness.react,
        'react-native': { Image: 'Image', Pressable: 'Pressable', ScrollView: ({ children, ...props }: any) => createElement('ScrollView', props, children), StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 }, Text: 'Text', View: 'View' },
        '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicon', props) }, './TeamLogo': (props: any) => createElement('TeamLogo', props),
        '../../assets/playoff-trophy.png': 'playoff-trophy.png', '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#222', borderCard: '#333' } },
      }).default;
      const modelPicture = buildPlayoffPicture(standings.slice(0, teamCount), { playoffTeamsTotal: teamCount, playoffTeamsPerDivision: null, useDivisionPlayoffs: false });
      assert.equal(modelPicture.status, 'ready');
      harness.mount(() => Panel({ picture: modelPicture, predictor, standings, accentColor: '#2694C4' }));
      return harness.output;
    };
    const two = render(2);
    assert.equal(nodeText(findNode(two, (node) => node.props.testID === 'bracket-round-label-1')), 'Championship');
    assert.equal(findNode(two, (node) => node.props.testID === 'bracket-round-label-2'), undefined);
    assert.doesNotMatch(nodeText(two), /BYE/);
    assert.equal(allNodes(two).filter((node) => node.props.accessibilityLabel === 'Unresolved seed').length, 2);
    const three = render(3);
    assert.equal(nodeText(findNode(three, (node) => node.props.testID === 'bracket-round-label-1')), 'Semifinals');
    assert.equal(nodeText(findNode(three, (node) => node.props.testID === 'bracket-round-label-2')), 'Championship');
    assert.doesNotMatch(nodeText(three), /BYE/);
    assert.equal(allNodes(three).filter((node) => node.props.accessibilityLabel === 'Unresolved seed').length, 1);
    const four = render(4);
    assert.equal(nodeText(findNode(four, (node) => node.props.testID === 'bracket-round-label-1')), 'Semifinals');
    assert.equal(nodeText(findNode(four, (node) => node.props.testID === 'bracket-round-label-2')), 'Championship');
    assert.doesNotMatch(nodeText(four), /BYE/);
    assert.equal(allNodes(four).filter((node) => node.props.accessibilityLabel === 'Unresolved next-round team').length, 2);
  });

  it('PV2 retains the exact 800x180 cubic hump source and renders honest zero and playoff-only success states', () => {
    const svg = readFileSync(decodeURIComponent(new URL('../../assets/season-completion-mask-source.svg', import.meta.url).pathname), 'utf8');
    assert.match(svg, /viewBox="0 0 800 180"/);
    assert.match(svg, /M 0 180 C 180 180, 280 10, 400 10 C 520 10, 620 180, 800 180 Z/);

    const harness = createHookHarness();
    const Hump = compileCommonJs<any>(new URL('../../src/components/SeasonCompletionHump.tsx', import.meta.url), {
      react: harness.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: { position: 'absolute', inset: 0 } }, Text: 'Text', View: 'View' },
      '../../assets/season-completion-mask.png': 'season-completion-mask.png',
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#222' } },
    }).default;
    harness.mount(() => Hump({ percentage: 0, playoffMode: false, accentColor: '#2694C4', reduceTransparency: false }));
    assert.match(nodeText(harness.output), /0%/);
    assert.equal(allNodes(harness.output).filter((node) => node.type === 'Image').length, 2);
    assert.equal(findNode(harness.output, (node) => node.props.accessibilityRole === 'progressbar')?.props.accessibilityValue.now, 0);
    harness.unmount();

    const playoffs = createHookHarness();
    const Hump2 = compileCommonJs<any>(new URL('../../src/components/SeasonCompletionHump.tsx', import.meta.url), {
      react: playoffs.react,
      'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: { position: 'absolute', inset: 0 } }, Text: 'Text', View: 'View' },
      '../../assets/season-completion-mask.png': 'season-completion-mask.png',
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgInteractive: '#222' } },
    }).default;
    playoffs.mount(() => Hump2({ percentage: 0, playoffMode: true, accentColor: '#2694C4', reduceTransparency: true }));
    assert.match(nodeText(playoffs.output), /PLAYOFFS/);
  });
});
