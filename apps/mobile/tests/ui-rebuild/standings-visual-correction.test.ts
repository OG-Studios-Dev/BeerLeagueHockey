/* eslint-disable @typescript-eslint/no-explicit-any -- focused native component harness */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

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
const picture = { status: 'ready', groups: [{ key: 'league', name: null, qualifierCount: 4, matchups: [
  { highSeed: standings[0], lowSeed: standings[3], highRank: 1, lowRank: 4 },
  { highSeed: standings[1], lowSeed: standings[2], highRank: 2, lowRank: 3 },
] }] };
const predictor = { status: 'ready', teams: standings.map((team, index) => ({ teamId: team.teamId, firstPlace: [0.86, 0.13, 0.008, 0][index], makePlayoffs: 1 })) };

describe('corrected native standings visuals', () => {
  it('PV1 renders a connected seeded bracket and switches through 44pt controls to the labeled odds table', () => {
    const harness = createHookHarness();
    const Panel = compileCommonJs<any>(new URL('../../src/components/StandingsPlayoffsPanel.tsx', import.meta.url), {
      react: harness.react,
      'react-native': {
        Image: 'Image', Pressable: 'Pressable', ScrollView: ({ children, ...props }: any) => createElement('ScrollView', props, children),
        StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1, absoluteFillObject: { position: 'absolute', inset: 0 } }, Text: 'Text', View: 'View',
      },
      '@expo/vector-icons': { Ionicons: (props: any) => createElement('Ionicon', props) },
      './TeamLogo': (props: any) => createElement('TeamLogo', props),
      '../../assets/playoff-trophy.png': 'playoff-trophy.png',
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333' } },
    }).default;
    harness.mount(() => Panel({ picture, predictor, standings, accentColor: '#2694C4' }));
    assert.ok(findNode(harness.output, (node) => node.props.testID === 'playoff-connected-bracket'));
    assert.equal(allNodes(harness.output).filter((node) => node.type === 'TeamLogo').length, 4);
    assert.ok(allNodes(harness.output).filter((node) => node.props.testID === 'bracket-connector').length >= 4);
    assert.ok(findNode(harness.output, (node) => node.props.accessibilityLabel === 'Championship trophy'));
    const oddsButton = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Show playoff odds');
    assert.ok(oddsButton);
    assert.ok((flattenStyle(oddsButton.props.style).minHeight ?? 0) >= 44);
    oddsButton.props.onPress();
    harness.render();
    const text = nodeText(harness.output);
    for (const label of ['Team', 'Record', '1st Place', 'Make Playoffs', '3-0-0', '86%']) assert.match(text, new RegExp(label));
    assert.equal(allNodes(harness.output).filter((node) => node.props.testID === 'playoff-probability-bar').length, 8);
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
