import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GameRow } from '../../src/lib/supabase/data.ts';
import * as gamePresentation from '../../src/lib/gamePresentation.ts';
import { compileCommonJs, createElement, findNode, flattenStyle, nodeText, type TestNode } from './component-harness.ts';

const baseGame = (overrides: Partial<GameRow> = {}): GameRow => ({
  id: 'game-a',
  home_team_id: 'home-id',
  away_team_id: 'away-id',
  home_score: null,
  away_score: 0,
  scheduled_at: '2026-10-08T02:15:00.000Z',
  status: 'in_progress',
  location: 'Chick-Fil-A Community Ice Centre — Championship Rink',
  season_id: 'season-a',
  home_team: { id: 'home-id', name: 'Home Team With A Long Unclipped Name', primary_color: '#B000FF', logo_url: 'https://example.test/home.png' },
  away_team: { id: 'away-id', name: 'Away Team With A Long Unclipped Name', primary_color: '#FF6500', logo_url: 'https://example.test/away.png' },
  ...overrides,
});

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function load() {
  return compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/ScheduleMatchupCard.tsx', import.meta.url),
    {
      react: { createElement },
      'react-native': {
        Pressable: 'Pressable',
        StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 },
        Text: 'Text',
        View: 'View',
      },
      '../lib/gamePresentation': gamePresentation,
      '../theme/home': {
        HOME_VISUAL_TOKENS: {
          text: '#F8FBFF', textSecondary: '#A9B8CC', textMuted: '#8293AA', stroke: 'rgba(125,190,255,.22)',
          strokeOpaque: '#41607F', surface: 'rgba(10,22,40,.3)', surfaceOpaque: '#0C1B31', minTouchTarget: 44, cardRadius: 18,
        },
        getHomeVisualPreferences: (reduceTransparency: boolean) => ({
          surface: reduceTransparency ? '#0C1B31' : 'rgba(10,22,40,.3)',
          stroke: reduceTransparency ? '#41607F' : 'rgba(125,190,255,.22)',
        }),
      },
      './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
    },
  ).default;
}

const compactMaxFontSizeMultiplier = 1.2;
const compactCardWidthAt320 = 320 - (16 * 2);
const measuredCompactFactWidthsAt10 = {
  'Oct 7': 27.779953002929688,
  '10:15 PM': 48.33984375,
  'Awaiting Review': 87.52604675292969,
  'Status unavailable': 99.0625,
} as const;

function renderCompactStatus(status: string | null) {
  const Card = load();
  return {
    Card,
    tree: Card({
      game: baseGame({ status, away_score: null, home_score: null }),
      timezone: 'America/Toronto',
      leagueColor: '#22D3EE',
      reduceTransparency: true,
      compact: true,
      onOpenGame: () => undefined,
    }),
  };
}

function compactParts(tree: unknown) {
  const body = findNode(tree, (node) => node.props.testID === 'schedule-matchup-card-body-game-a')!;
  const facts = findNode(body, (node) => node.props.testID === 'schedule-matchup-facts')!;
  const matchup = findNode(body, (node) => node.props.testID === 'schedule-compact-matchup-row')!;
  const factTexts = allNodes(facts).filter((node) => node.type === 'Text');
  return { body, facts, matchup, factTexts };
}

function assertCompactStatusFits(tree: unknown, expectedStatus: 'Awaiting Review' | 'Status unavailable') {
  const { body, facts, matchup, factTexts } = compactParts(tree);
  assert.deepEqual(factTexts.map(nodeText), ['Oct 7', expectedStatus, '10:15 PM']);
  assert.match(nodeText(tree), new RegExp(expectedStatus));
  assert.match(body.props.accessibilityLabel, new RegExp(expectedStatus));
  assert.match(body.props.accessibilityLabel, /Oct 7.*10:15 PM/);

  const factsStyle = flattenStyle(facts.props.style);
  const factStyle = flattenStyle(factTexts[0].props.style);
  const factsWidth = Number(factsStyle.width);
  const fontSize = Number(factStyle.fontSize);
  for (const factText of factTexts) {
    const label = nodeText(factText) as keyof typeof measuredCompactFactWidthsAt10;
    const requiredWidth = measuredCompactFactWidthsAt10[label] * fontSize / 10 * compactMaxFontSizeMultiplier;
    assert.ok(
      requiredWidth <= factsWidth,
      `${label} needs ${requiredWidth.toFixed(2)}pt at the supported compact text scale but the facts lane is ${factsWidth}pt`,
    );
  }

  for (const factText of factTexts) {
    assert.equal(factText.props.numberOfLines, undefined, `${nodeText(factText)} must not use a truncating line limit`);
    assert.equal(factText.props.ellipsizeMode, undefined, `${nodeText(factText)} must not ellipsize`);
    assert.equal(factText.props.maxFontSizeMultiplier, compactMaxFontSizeMultiplier);
    assert.notEqual(factText.props.allowFontScaling, false);
  }

  const bodyStyleValue = typeof body.props.style === 'function' ? body.props.style({ pressed: false }) : body.props.style;
  const bodyStyle = flattenStyle(bodyStyleValue);
  const matchupStyle = flattenStyle(matchup.props.style);
  const factStackHeight = factTexts.reduce((height, text) => (
    height + (Number(flattenStyle(text.props.style).lineHeight) * compactMaxFontSizeMultiplier)
  ), 0);
  const logos = allNodes(matchup).filter((node) => node.props.teamId === 'away-id' || node.props.teamId === 'home-id');
  assert.deepEqual(logos.map((logo) => logo.props.size), [36, 36]);

  const scored = renderCompactStatus('in_progress').tree;
  const scoredMatchup = compactParts(scored).matchup;
  const scoredChildren = Array.isArray(scoredMatchup.props.children) ? scoredMatchup.props.children : [scoredMatchup.props.children];
  const scoreGroup = scoredChildren.find((node) => findNode(node, (candidate) => candidate.props.testID === 'schedule-team-score-away'))!;
  const scoreGroupWidth = Number(flattenStyle(scoreGroup.props.style).minWidth);
  const versus = findNode(matchup, (node) => node.props.testID === 'schedule-matchup-versus')!;
  const versusWidth = Number(flattenStyle(versus.props.style).minWidth);
  const matchupGap = Number(matchupStyle.gap);
  const requiredMatchupWidth = logos.reduce((width, logo) => width + Number(logo.props.size), 0)
    + Math.max(scoreGroupWidth, versusWidth)
    + (matchupGap * 2);
  const availableMatchupWidth = compactCardWidthAt320
    - (Number(bodyStyle.paddingHorizontal) * 2)
    - factsWidth
    - Number(bodyStyle.gap);
  assert.ok(availableMatchupWidth >= requiredMatchupWidth, `${availableMatchupWidth}pt remains for a ${requiredMatchupWidth}pt logo-score-logo row`);

  const projectedBodyHeight = Math.max(Number(bodyStyle.minHeight), factStackHeight, ...logos.map((logo) => Number(logo.props.size)));
  assert.equal(projectedBodyHeight, 64);
  assert.ok(projectedBodyHeight >= 44 && projectedBodyHeight <= 68);
}

describe('compact Schedule matchup card', () => {
  it('renders complete vertical matchup facts and opens the exact game without pager UI', () => {
    const Card = load();
    const opened: string[] = [];
    const tree = Card({
      game: baseGame(),
      timezone: 'America/Toronto',
      leagueColor: '#22D3EE',
      reduceTransparency: true,
      onOpenGame: (gameId: string) => opened.push(gameId),
    });

    const root = findNode(tree, (node) => node.props.testID === 'schedule-matchup-card-game-a')!;
    const body = findNode(root, (node) => node.props.testID === 'schedule-matchup-card-body-game-a')!;
    assert.ok(root);
    assert.ok(body);
    assert.equal(flattenStyle(root.props.style).backgroundColor, '#0C1B31');
    assert.match(nodeText(root), /Away Team With A Long Unclipped Name/);
    assert.match(nodeText(root), /Home Team With A Long Unclipped Name/);
    assert.match(nodeText(root), /Oct 7/);
    assert.match(nodeText(root), /10:15 PM/);
    assert.match(nodeText(root), /Chick-Fil-A Community Ice Centre — Championship Rink/);
    assert.match(nodeText(root), /Live/);
    assert.ok(findNode(root, (node) => node.type === 'Text' && node.props.children === '0'));
    assert.ok(findNode(root, (node) => node.type === 'Text' && node.props.children === '—'));
    assert.match(body.props.accessibilityLabel, /^Live\./);
    assert.match(body.props.accessibilityLabel, /Away Team With A Long Unclipped Name 0/);
    assert.match(body.props.accessibilityLabel, /Home Team With A Long Unclipped Name score unavailable/);
    assert.match(body.props.accessibilityLabel, /Oct 7.*10:15 PM.*Chick-Fil-A/);

    const logos = allNodes(root).filter((node) => node.props.teamId === 'away-id' || node.props.teamId === 'home-id');
    assert.equal(logos.length, 2);
    assert.ok(logos.every((logo) => logo.props.decorative === true && logo.props.size >= 40));
    const names = allNodes(root).filter((node) => node.props.testID?.startsWith('schedule-team-name-'));
    assert.equal(names.length, 2);
    assert.ok(names.every((name) => name.props.numberOfLines === undefined && flattenStyle(name.props.style).flexShrink === 1));

    assert.equal(allNodes(root).some((node) => node.type === 'ScrollView' || node.props.horizontal || node.props.pagingEnabled), false);
    assert.doesNotMatch(nodeText(root), /Previous game|Next game| of \d/);
    body.props.onPress();
    assert.deepEqual(opened, ['game-a']);
  });

  it('renders the Team compact presentation as one 44-to-68 point logo matchup without visible names or venue', () => {
    const Card = load();
    const tree = Card({
      game: baseGame(),
      timezone: 'America/Toronto',
      leagueColor: '#22D3EE',
      reduceTransparency: true,
      compact: true,
      onOpenGame: () => undefined,
    });

    const root = findNode(tree, (node) => node.props.testID === 'schedule-matchup-card-game-a')!;
    const body = findNode(root, (node) => node.props.testID === 'schedule-matchup-card-body-game-a')!;
    const matchup = findNode(body, (node) => node.props.testID === 'schedule-compact-matchup-row')!;
    const bodyStyle = typeof body.props.style === 'function' ? body.props.style({ pressed: false }) : body.props.style;
    assert.ok(body);
    assert.ok(matchup);
    assert.ok(flattenStyle(bodyStyle).minHeight >= 44);
    assert.ok(flattenStyle(bodyStyle).minHeight <= 68);
    assert.equal(flattenStyle(matchup.props.style).flexDirection, 'row');

    const visible = nodeText(root);
    assert.doesNotMatch(visible, /Away Team With A Long Unclipped Name/);
    assert.doesNotMatch(visible, /Home Team With A Long Unclipped Name/);
    assert.doesNotMatch(visible, /Chick-Fil-A Community Ice Centre/);
    assert.match(visible, /Oct 7/);
    assert.match(visible, /10:15 PM/);
    assert.match(visible, /Live/);
    assert.equal(nodeText(findNode(matchup, (node) => node.props.testID === 'schedule-team-score-away')), '0');
    assert.equal(nodeText(findNode(matchup, (node) => node.props.testID === 'schedule-team-score-home')), '—');

    const logos = allNodes(matchup).filter((node) => node.props.teamId === 'away-id' || node.props.teamId === 'home-id');
    assert.equal(logos.length, 2);
    assert.deepEqual(logos.map((logo) => ({
      teamId: logo.props.teamId,
      logoUrl: logo.props.logoUrl,
      teamName: logo.props.teamName,
      transparentBacking: logo.props.transparentBacking,
    })), [
      { teamId: 'away-id', logoUrl: 'https://example.test/away.png', teamName: 'Away Team With A Long Unclipped Name', transparentBacking: true },
      { teamId: 'home-id', logoUrl: 'https://example.test/home.png', teamName: 'Home Team With A Long Unclipped Name', transparentBacking: true },
    ]);
    assert.match(body.props.accessibilityLabel, /Away Team With A Long Unclipped Name 0/);
    assert.match(body.props.accessibilityLabel, /Home Team With A Long Unclipped Name score unavailable/);
    assert.match(body.props.accessibilityLabel, /Chick-Fil-A Community Ice Centre — Championship Rink/);
  });

  it('uses a compact VS treatment instead of inventing a score for an unscored game', () => {
    const Card = load();
    const tree = Card({
      game: baseGame({ status: 'scheduled', away_score: null, home_score: null }),
      timezone: 'America/Toronto',
      leagueColor: '#22D3EE',
      reduceTransparency: false,
      compact: true,
      onOpenGame: () => undefined,
    });
    const matchup = findNode(tree, (node) => node.props.testID === 'schedule-compact-matchup-row')!;
    assert.equal(nodeText(findNode(matchup, (node) => node.props.testID === 'schedule-matchup-versus')), 'VS');
    assert.equal(findNode(matchup, (node) => node.props.testID?.startsWith('schedule-team-score-')), undefined);
  });

  it('keeps the complete Awaiting Review facts visible at 320 points under the maximum compact text scale', () => {
    assertCompactStatusFits(renderCompactStatus('pending_verification').tree, 'Awaiting Review');
  });

  it('keeps the complete Status unavailable facts visible at 320 points under the maximum compact text scale', () => {
    assertCompactStatusFits(renderCompactStatus('mystery').tree, 'Status unavailable');
  });

  it('caps every compact Text without disabling font scaling or requesting ellipsis', () => {
    const pending = compactParts(renderCompactStatus('pending_verification').tree).body;
    const scored = compactParts(renderCompactStatus('in_progress').tree).body;
    const compactTexts = [...allNodes(pending), ...allNodes(scored)].filter((node) => node.type === 'Text');
    assert.ok(compactTexts.length >= 8);
    for (const text of compactTexts) {
      assert.equal(text.props.numberOfLines, undefined, `${nodeText(text)} must not use numberOfLines`);
      assert.equal(text.props.ellipsizeMode, undefined, `${nodeText(text)} must not ellipsize`);
      assert.equal(text.props.maxFontSizeMultiplier, compactMaxFontSizeMultiplier, `${nodeText(text)} must use the compact font scale cap`);
      assert.notEqual(text.props.allowFontScaling, false, `${nodeText(text)} must keep font scaling enabled`);
    }
  });

  it('shows scores and calendar actions only for authoritative statuses and never copies a team UUID', () => {
    const Card = load();
    const cases = [
      ['scheduled', false],
      ['in_progress', true],
      ['completed', true],
      ['pending_verification', false],
      ['postponed', false],
      ['cancelled', false],
      [null, false],
    ] as const;
    for (const [status, showScore] of cases) {
      const tree = Card({
        game: baseGame({ id: `game-${status ?? 'unknown'}`, status, away_score: 0, home_score: null }),
        timezone: 'America/Toronto',
        leagueColor: '#22D3EE',
        reduceTransparency: false,
        onOpenGame: () => undefined,
        onAddToCalendar: () => undefined,
      });
      assert.equal(Boolean(findNode(tree, (node) => node.props.testID === 'schedule-team-score-away')), showScore);
      assert.equal(Boolean(findNode(tree, (node) => node.props.testID?.startsWith('schedule-calendar-'))), status === 'scheduled');
    }

    const calendarCalls: string[] = [];
    const scheduled = Card({
      game: baseGame({ id: 'scheduled-game', status: 'scheduled' }),
      timezone: 'America/Toronto', leagueColor: '#22D3EE', reduceTransparency: false,
      onOpenGame: () => undefined,
      onAddToCalendar: (game: GameRow) => calendarCalls.push(game.id),
    });
    const body = findNode(scheduled, (node) => node.props.testID === 'schedule-matchup-card-body-scheduled-game')!;
    const calendar = findNode(scheduled, (node) => node.props.testID === 'schedule-calendar-scheduled-game')!;
    assert.equal(findNode(body, (node) => node.props.testID === 'schedule-calendar-scheduled-game'), undefined);
    const calendarStyle = typeof calendar.props.style === 'function' ? calendar.props.style({ pressed: false }) : calendar.props.style;
    assert.ok(flattenStyle(calendarStyle).minHeight >= 44);
    calendar.props.onPress();
    assert.deepEqual(calendarCalls, ['scheduled-game']);

    const missing = Card({
      game: baseGame({ home_team_id: 'raw-home-uuid', away_team_id: 'raw-away-uuid', home_team: null, away_team: null }),
      timezone: 'America/Toronto', leagueColor: '#22D3EE', reduceTransparency: false, onOpenGame: () => undefined,
    });
    assert.match(nodeText(missing), /Team unavailable/);
    assert.doesNotMatch(nodeText(missing), /raw-home-uuid|raw-away-uuid/);
    const missingBody = findNode(missing, (node) => node.props.testID === 'schedule-matchup-card-body-game-a')!;
    assert.doesNotMatch(missingBody.props.accessibilityLabel, /raw-home-uuid|raw-away-uuid/);
  });
});
