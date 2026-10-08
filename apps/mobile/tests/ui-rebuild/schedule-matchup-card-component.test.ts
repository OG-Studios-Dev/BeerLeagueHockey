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
