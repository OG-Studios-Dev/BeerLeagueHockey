/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle } from './component-harness.ts';

const positioning = {
  seasonId: 'season-a',
  totalTeams: 1,
  attendanceSource: 'confirmed-plus-fallback-roster-appearances',
  teams: [{
    teamId: 'team-a',
    teamName: 'Owls',
    logoUrl: null,
    primaryColor: '#22D3EE',
    metrics: Object.fromEntries(['overall', 'offense', 'defense', 'discipline', 'commitment'].map((key) => [key, { rank: 1, valueLabel: '1' }])),
  }],
};

function renderPositioning(reduceTransparency: boolean) {
  const harness = createHookHarness();
  const TeamPositioningChart = compileCommonJs<any>(new URL('../../src/components/TeamPositioningChart.tsx', import.meta.url), {
    react: harness.react,
    'react-native': {
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (styles: any) => styles, flatten: (style: any) => style, hairlineWidth: 1, absoluteFillObject: {} },
    },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency }) },
    '../lib/leaguePagesModel': {
      POSITION_METRICS: [
        { key: 'overall', label: 'Overall' },
        { key: 'offense', label: 'Offense' },
        { key: 'defense', label: 'Defense' },
        { key: 'discipline', label: 'Discipline' },
        { key: 'commitment', label: 'Commitment' },
      ],
      buildBumpChartSegment: () => ({ center: { x: 0, y: 0 }, length: 0, angleRadians: 0 }),
    },
    '../theme/colors': { __esModule: true, default: {
      bgSurface: 'rgba(10, 22, 40, 0.30)',
      bgInteractive: '#1C2A42',
      glassStroke: 'rgba(125, 190, 255, 0.22)',
      textInteractive: '#67E8F9',
      textPrimary: '#F7FBFF',
      textSecondary: '#A8B4C8',
    } },
    '../theme/ui': { getSurfacePalette: (reduce: boolean) => ({
      surface: reduce ? '#0C1B31' : 'rgba(10, 22, 40, 0.30)',
      elevated: reduce ? '#0A1628' : 'rgba(12, 27, 49, 0.38)',
      stroke: reduce ? '#41607F' : 'rgba(125, 190, 255, 0.22)',
    }) },
    './TeamLogo': (props: any) => createElement('TeamLogo', props),
  }).default;
  harness.mount(() => TeamPositioningChart({ positioning }));
  return harness.output;
}

describe('composite surface accessibility', () => {
  it('keeps Team positioning translucent normally and makes the real composite opaque for Reduce Transparency', () => {
    const normal = findNode(renderPositioning(false), (node) => node.props.accessibilityRole === 'summary');
    const reduced = findNode(renderPositioning(true), (node) => node.props.accessibilityRole === 'summary');
    const target = findNode(renderPositioning(true), (node) => node.props.testID === 'team-positioning-team-a-overall');

    assert.equal(flattenStyle(normal?.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(flattenStyle(reduced?.props.style).backgroundColor, '#0C1B31');
    assert.equal(flattenStyle(target?.props.style).backgroundColor, '#1C2A42');
  });

  it('announces commitment value and rank without calling policy-reported participation estimated', () => {
    const commitment = findNode(
      renderPositioning(false),
      (node) => node.props.testID === 'team-positioning-team-a-commitment',
    );

    assert.equal(commitment?.props.accessibilityLabel, 'Owls, rank 1 of 1 in Commitment, 1');
    assert.doesNotMatch(String(commitment?.props.accessibilityLabel), /estimat/i);
  });
});
