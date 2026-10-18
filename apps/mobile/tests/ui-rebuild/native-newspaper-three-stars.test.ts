/* eslint-disable @typescript-eslint/no-explicit-any -- focused component style contract */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

function edition() {
  const longReason = 'Every verified scoring detail remains complete while the card grows naturally without clipping or ellipsis.';
  return {
    schemaVersion: 1, title: 'Hockey Life Times', issueNumber: '45', leagueId: 'league', leagueName: 'Hockey Life', seasonId: 'season', seasonName: 'Fall 2026',
    periodStart: '2026-10-12', periodEnd: '2026-10-18', issuedAt: '2026-10-18T12:00:00-04:00', timezone: 'America/Toronto', stage: 'regular', status: 'published',
    lead: { headline: 'Lead', dek: 'Dek', body: ['Lead body.'] },
    games: [{ gameId: 'game', homeTeam: { id: 'home', name: 'Home' }, awayTeam: { id: 'away', name: 'Away' }, homeScore: 4, awayScore: 3, headline: 'Final', body: ['Game body remains compact.'], contributors: [] }],
    stars: [
      { playerId: 'one', name: 'Alexandria-Montgomery Van Der Hockey', teamName: 'Liuna Premier Club', goals: 4, assists: 3, points: 7, reason: longReason },
      { playerId: 'two', name: 'Christopher Jean-Baptiste MacGillivray', teamName: 'First General London', goals: 3, assists: 2, points: 5, reason: longReason },
      { playerId: 'three', name: 'Maximilian O’Shaughnessy-Smythe', teamName: 'Bad Bunny Hockey Club', goals: 2, assists: 4, points: 6, reason: longReason },
    ],
    numbers: [{ label: 'Finished games', value: '2', detail: 'Complete.' }],
    standings: [{ teamId: 'home', name: 'Home', gp: 1, w: 1, l: 0, otl: 0, t: 0, pts: 2, gf: 4, ga: 3 }],
    standingsNote: 'Current.', hot: [{ headline: 'Compact brief', body: 'Brief body remains complete and compact.' }], cold: [], upcoming: [], upcomingNote: 'No fixtures.', aroundRink: [],
    source: { gameIds: ['game'], verifiedAt: '2026-10-18T12:00:00-04:00', warnings: [] },
  };
}

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function renderEdition(value = edition()) {
  const harness = createHookHarness();
  const NativeEdition = compileCommonJs<any>(new URL('../../src/components/NativeNewspaperEdition.tsx', import.meta.url), {
    react: harness.react,
    'react-native': { Image: 'Image', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
    '../theme/colors': { __esModule: true, default: { bgMedia: '#111' } },
  }).default;
  return harness.mount(() => NativeEdition({ edition: value }));
}

describe('compact native newspaper Three Stars page', () => {
  it('uses exactly three equal shrinkable non-wrapping columns with stable geometry hooks', () => {
    const tree = renderEdition();
    const page = findNode(tree, (node) => node.props.testID === 'newspaper-page-3')!;
    const grid = findNode(page, (node) => node.props.testID === 'three-stars-row')!;
    assert.ok(grid, 'page 3 exposes the Three Stars row');
    const gridStyle = flattenStyle(grid.props.style);
    assert.equal(gridStyle.flexDirection, 'row');
    assert.notEqual(gridStyle.flexWrap, 'wrap');
    assert.equal(gridStyle.alignItems, 'flex-start');

    const cards = [1, 2, 3].map((rank) => findNode(grid, (node) => node.props.testID === `three-star-${rank}`)!);
    assert.equal(cards.filter(Boolean).length, 3);
    for (const card of cards) {
      const style = flattenStyle(card.props.style);
      assert.equal(style.minWidth, 0);
      assert.equal(style.flexBasis, 0);
      assert.equal(style.flexGrow, 1);
      assert.equal(style.flexShrink, 1);
      assert.equal(style.overflow, 'visible');
    }
    assert.ok(findNode(page, (node) => node.props.testID === 'newspaper-numbers-section'));
  });

  it('uses singular goal and assist labels only for a count of one while retaining plural labels', () => {
    const value = edition();
    value.stars[0] = { ...value.stars[0], goals: 1, assists: 2, points: 3 };
    value.stars[1] = { ...value.stars[1], goals: 3, assists: 1, points: 4 };
    const tree = renderEdition(value);
    const first = nodeText(findNode(tree, (node) => node.props.testID === 'three-star-1'));
    const second = nodeText(findNode(tree, (node) => node.props.testID === 'three-star-2'));

    assert.match(first, /1 goal.*2 assists.*3 points/s);
    assert.doesNotMatch(first, /1 goals/);
    assert.match(second, /3 goals.*1 assist.*4 points/s);
    assert.doesNotMatch(second, /1 assists/);
  });

  it('keeps complete long names, stats, and reasons with Dynamic Type enabled and compact region-specific copy', () => {
    const tree = renderEdition();
    const page = findNode(tree, (node) => node.props.testID === 'newspaper-page-3')!;
    const expectedNames = ['ALEXANDRIA-MONTGOMERY VAN DER HOCKEY', 'CHRISTOPHER JEAN-BAPTISTE MACGILLIVRAY', 'MAXIMILIAN O’SHAUGHNESSY-SMYTHE'];
    for (const [index, expectedName] of expectedNames.entries()) {
      const card = findNode(page, (node) => node.props.testID === `three-star-${index + 1}`)!;
      assert.match(nodeText(card), new RegExp(expectedName));
      assert.match(nodeText(card), new RegExp(`${edition().stars[index]!.goals} goals.*${edition().stars[index]!.assists} assists.*${edition().stars[index]!.points} points`, 's'));
      assert.match(nodeText(card), /Every verified scoring detail remains complete/);
      for (const text of allNodes(card).filter((node) => node.type === 'Text')) {
        assert.equal(text.props.numberOfLines, undefined);
        assert.equal(text.props.ellipsizeMode, undefined);
        assert.notEqual(text.props.allowFontScaling, false);
        assert.equal(text.props.maxFontSizeMultiplier, undefined);
      }
    }

    const copyNodes = [
      findNode(tree, (node) => node.props.testID === 'newspaper-game-copy'),
      findNode(page, (node) => node.props.testID === 'three-star-reason-1'),
      findNode(tree, (node) => node.props.testID === 'newspaper-upcoming-note'),
    ];
    copyNodes.forEach((node) => assert.ok(node, 'each compact newspaper region exposes a focused copy node'));
    for (const node of copyNodes) {
      const style = flattenStyle(node!.props.style);
      assert.ok(style.fontSize < 14, `fontSize ${style.fontSize} must be materially below the old 14pt copy`);
      assert.ok(style.lineHeight < 21, `lineHeight ${style.lineHeight} must be materially below the old 21pt leading`);
    }
    assert.ok(flattenStyle(findNode(page, (node) => node.props.testID === 'three-star-name-1')!.props.style).fontSize <= 14);
    assert.ok(flattenStyle(findNode(page, (node) => node.props.testID === 'three-star-kicker-1')!.props.style).fontSize <= 8);
  });

  it('uses compact region-specific typography for newspaper briefs', () => {
    const tree = renderEdition();
    const brief = findNode(tree, (node) => node.props.testID === 'newspaper-brief-copy-0');
    assert.ok(brief, 'brief copy exposes a focused typography node');
    assert.equal(nodeText(brief), 'Brief body remains complete and compact.');
    const style = flattenStyle(brief.props.style);
    assert.ok(style.fontSize < 14);
    assert.ok(style.lineHeight < 21);
    assert.notEqual(brief.props.allowFontScaling, false);
    assert.equal(brief.props.numberOfLines, undefined);
    assert.equal(brief.props.ellipsizeMode, undefined);
  });
});
