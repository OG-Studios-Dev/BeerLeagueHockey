import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { HomeWeeklyGame } from '../../src/lib/supabase/home';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const homeModel = compileCommonJs<Record<string, any>>(
  new URL('../../src/lib/supabase/home.ts', import.meta.url),
  { './client': { supabase: {} } },
);

const componentUrl = new URL('../../src/components/HomeMatchupCarousel.tsx', import.meta.url);
const baseGame = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, scheduled_at: '2026-10-08T02:15:00.000Z', location: 'Chick-Fil-A Community Ice Centre — Championship Rink',
  home_score: null, away_score: null, status: 'scheduled', home_team_id: `home-${id}`, away_team_id: `away-${id}`,
  home_team: { id: `home-${id}`, name: `Home ${id}`, logo_url: `https://example.test/home-${id}.png`, primary_color: '#B000FF' },
  away_team: { id: `away-${id}`, name: `Away ${id}`, logo_url: `https://example.test/away-${id}.png`, primary_color: '#FF6500' },
  ...overrides,
}) as HomeWeeklyGame;

function load(harness: ReturnType<typeof createHookHarness>) {
  return compileCommonJs<{ default: (props: Record<string, any>) => unknown }>(componentUrl, {
    react: harness.react,
    'react-native': {
      Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute' }, hairlineWidth: 1 },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    '../lib/supabase/home': homeModel,
    '../theme/home': { HOME_VISUAL_TOKENS: { text: '#F8FBFF', textSecondary: '#A9B8CC', stroke: 'rgba(125,190,255,.22)', minTouchTarget: 44 } },
    './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
    '../../assets/matchup/arena-base.png': { asset: 'base' },
    '../../assets/matchup/arena-left-mask.png': { asset: 'left' },
    '../../assets/matchup/arena-right-mask.png': { asset: 'right' },
  }).default;
}

describe('Home matchup carousel component', () => {
  it('renders one cinematic card with league-local facts, enlarged crests, color masks and no visible team captions', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const opened: string[] = [];
    harness.mount(() => Component({
      games: [baseGame('a'), baseGame('b')], scopeKey: 'league:week-1', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: false, onOpenGame: (id: string) => opened.push(id),
    }));

    const card = findNode(harness.output, (node) => node.props.testID === 'home-matchup-card-a')!;
    assert.ok(card);
    assert.match(card.props.accessibilityLabel, /Away a at Home a/);
    assert.match(card.props.accessibilityLabel, /Oct 7.*10:15 PM/);
    assert.match(card.props.accessibilityLabel, /Chick-Fil-A Community Ice Centre/);
    assert.equal(nodeText(card).includes('Away a'), false);
    assert.equal(nodeText(card).includes('Home a'), false);
    assert.match(nodeText(card), /Oct 7/);
    assert.match(nodeText(card), /Chick-Fil-A Community Ice Centre — Championship Rink/);
    assert.match(nodeText(card), /10:15 PM/);
    const factRow = findNode(card, (node) => node.props.testID === 'home-matchup-fact-row')!;
    assert.equal(flattenStyle(factRow.props.style).minHeight, 36);
    const date = findNode(card, (node) => node.props.testID === 'home-matchup-date')!;
    const location = findNode(card, (node) => node.props.testID === 'home-matchup-location')!;
    const time = findNode(card, (node) => node.props.testID === 'home-matchup-time')!;
    assert.equal(flattenStyle(date.props.style).width, flattenStyle(time.props.style).width);
    assert.equal(flattenStyle(location.props.style).fontSize, 13);

    const away = findNode(card, (node) => node.type === 'TeamLogo' && node.props.teamId === 'away-a')!;
    const home = findNode(card, (node) => node.type === 'TeamLogo' && node.props.teamId === 'home-a')!;
    assert.equal(away.props.size, 124.8);
    assert.equal(home.props.size, 122.4);
    assert.equal(away.props.transparentBacking, true);
    assert.equal(home.props.transparentBacking, true);

    for (const [testID, source, tintColor] of [
      ['home-matchup-arena-base', { asset: 'base' }, undefined],
      ['home-matchup-arena-left-mask', { asset: 'left' }, '#FF6500'],
      ['home-matchup-arena-right-mask', { asset: 'right' }, '#B000FF'],
    ] as const) {
      const image = findNode(card, (node) => node.props.testID === testID)!;
      assert.deepEqual(image.props.source, source);
      assert.equal(image.props.tintColor, tintColor);
      const style = flattenStyle(image.props.style);
      assert.equal(style.width, 358);
      assert.equal(typeof style.height, 'number');
      assert.ok(style.top >= 18, 'scene art must retain a quiet ceiling above the rink');
    }
    const awayStage = findNode(card, (node) => node.props.testID === 'home-matchup-away-stage')!;
    assert.ok(flattenStyle(awayStage.props.style).height < flattenStyle(findNode(card, (node) => node.props.testID === 'home-matchup-scene')!.props.style).height);
    assert.equal(flattenStyle(awayStage.props.style).justifyContent, 'flex-end');
    card.props.onPress();
    assert.deepEqual(opened, ['a']);
  });

  it('uses a manual one-page pager, meaningful 44dp controls, and ignores stale scope callbacks', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const opened: string[] = [];
    const props: Record<string, any> = {
      games: [baseGame('a'), baseGame('b'), baseGame('c')], scopeKey: 'league:week-1', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: true, onOpenGame: (id: string) => opened.push(id),
    };
    harness.mount(() => Component(props));
    const pager = findNode(harness.output, (node) => node.props.testID === 'home-matchup-pager')!;
    assert.equal(pager.props.horizontal, true);
    assert.equal(pager.props.pagingEnabled, true);
    assert.equal(pager.props.onScroll, undefined);
    const staleSwipe = pager.props.onMomentumScrollEnd;
    const firstCard = findNode(harness.output, (node) => node.props.testID === 'home-matchup-card-a')!;
    pager.props.onScrollBeginDrag();
    pager.props.onScrollEndDrag();
    firstCard.props.onPress();
    assert.deepEqual(opened, [], 'release press is suppressed');
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    try { firstCard.props.onPress(); } finally { Date.now = realNow; }
    assert.deepEqual(opened, ['a'], 'a later intentional tap is not stuck behind the drag guard');

    const next = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Next game')!;
    assert.equal(flattenStyle(next.props.style).minHeight, 44);
    next.props.onPress(); harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '2 of 3');

    props.scopeKey = 'league:week-2';
    props.games = [baseGame('x'), baseGame('y')];
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');
    staleSwipe({ nativeEvent: { layoutMeasurement: { width: 358 }, contentOffset: { x: 358 } } });
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');

    props.scopeKey = 'league:week-1';
    props.games = [baseGame('a'), baseGame('b')];
    harness.render();
    staleSwipe({ nativeEvent: { layoutMeasurement: { width: 358 }, contentOffset: { x: 358 } } });
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!.props.accessibilityValue.text, '1 of 2');
  });

  it('supports adjustable increment/decrement and disables both control endpoints without boundary callbacks', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const games = [baseGame('a'), baseGame('b'), baseGame('c')];
    harness.mount(() => Component({
      games, scopeKey: 'league:week', timezone: 'America/Toronto',
      leagueColor: '#22D3EE', width: 390, reduceMotion: true, onOpenGame: () => {},
    }));

    const readControls = () => ({
      previous: findNode(harness.output, (node) => node.props.accessibilityLabel === 'Previous game')!,
      position: findNode(harness.output, (node) => node.props.testID === 'home-matchup-position')!,
      next: findNode(harness.output, (node) => node.props.accessibilityLabel === 'Next game')!,
    });
    let { previous, position, next } = readControls();
    assert.deepEqual(position.props.accessibilityActions, [
      { name: 'increment', label: 'Next game' },
      { name: 'decrement', label: 'Previous game' },
    ]);
    assert.equal(previous.props.disabled, true);
    assert.deepEqual(previous.props.accessibilityState, { disabled: true });
    assert.ok(flattenStyle(previous.props.style).opacity < 1, 'disabled Previous must have a clear visual state');
    assert.equal(flattenStyle(previous.props.style).minHeight, 44);
    assert.equal(next.props.disabled, false);
    assert.deepEqual(next.props.accessibilityState, { disabled: false });

    const startUpdates = harness.stateUpdateCount;
    previous.props.onPress();
    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    harness.render();
    assert.equal(harness.stateUpdateCount, startUpdates, 'Previous/decrement must not select beyond the first game');
    assert.equal(readControls().position.props.accessibilityValue.text, '1 of 3');

    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    harness.render();
    assert.equal(readControls().position.props.accessibilityValue.text, '2 of 3');
    ({ previous, position, next } = readControls());
    assert.equal(previous.props.disabled, false);
    assert.equal(next.props.disabled, false);

    next.props.onPress();
    harness.render();
    ({ previous, position, next } = readControls());
    assert.equal(position.props.accessibilityValue.text, '3 of 3');
    assert.equal(next.props.disabled, true);
    assert.deepEqual(next.props.accessibilityState, { disabled: true });
    assert.ok(flattenStyle(next.props.style).opacity < 1, 'disabled Next must have a clear visual state');
    assert.equal(flattenStyle(next.props.style).minHeight, 44);

    const endUpdates = harness.stateUpdateCount;
    next.props.onPress();
    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    harness.render();
    assert.equal(harness.stateUpdateCount, endUpdates, 'Next/increment must not select beyond the final game');
    assert.equal(readControls().position.props.accessibilityValue.text, '3 of 3');

    readControls().position.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    harness.render();
    assert.equal(readControls().position.props.accessibilityValue.text, '2 of 3');
  });

  it('renders truthful visible and accessibility facts for every supported status, including zero and null scores', () => {
    assert.ok(existsSync(componentUrl.pathname), 'HomeMatchupCarousel must exist');
    const harness = createHookHarness();
    const Component = load(harness);
    const cases = [
      { name: 'Scheduled', id: 'scheduled', status: 'scheduled', awayScore: 0, homeScore: null, visibleStatus: 'Scheduled', visibleScores: [] },
      { name: 'Live', id: 'live', status: 'in_progress', awayScore: 0, homeScore: null, visibleStatus: 'Live', visibleScores: ['0', '—'] },
      { name: 'Final', id: 'final', status: 'completed', awayScore: null, homeScore: 0, visibleStatus: 'Final', visibleScores: ['—', '0'] },
      { name: 'Postponed', id: 'postponed', status: 'postponed', awayScore: 0, homeScore: null, visibleStatus: 'Postponed', visibleScores: [] },
      { name: 'Cancelled', id: 'cancelled', status: 'cancelled', awayScore: 0, homeScore: null, visibleStatus: 'Cancelled', visibleScores: [] },
      { name: 'Pending Verification', id: 'review', status: 'pending_verification', awayScore: 0, homeScore: null, visibleStatus: 'Awaiting Review', visibleScores: [] },
    ] as const;
    const games = cases.map((entry) => baseGame(entry.id, {
      status: entry.status, away_score: entry.awayScore, home_score: entry.homeScore,
    }));
    harness.mount(() => Component({
      games, scopeKey: 'league:week', timezone: 'America/Toronto', leagueColor: '#22D3EE', width: 390,
      reduceMotion: true, onOpenGame: () => {},
    }));

    for (const entry of cases) {
      const card = findNode(harness.output, (node) => node.props.testID === `home-matchup-card-${entry.id}`)!;
      assert.ok(card, `${entry.name} card must render`);
      const visible = nodeText(card);
      assert.match(visible, new RegExp(entry.visibleStatus), `${entry.name} must show its truthful status`);
      assert.match(visible, /Oct 7/);
      assert.match(visible, /Chick-Fil-A Community Ice Centre — Championship Rink/);
      assert.match(visible, /10:15 PM/);
      assert.match(card.props.accessibilityLabel, new RegExp(`^${entry.visibleStatus}\\.`));
      assert.match(card.props.accessibilityLabel, /Oct 7.*10:15 PM.*Chick-Fil-A Community Ice Centre/);

      if (entry.visibleScores.length) {
        for (const score of entry.visibleScores) {
          assert.ok(
            findNode(card, (node) => node.type === 'Text' && node.props.children === score),
            `${entry.name} must visibly preserve score ${score}`,
          );
        }
        if (entry.id === 'live') assert.match(card.props.accessibilityLabel, /Away live 0.*Home live score unavailable/);
        if (entry.id === 'final') assert.match(card.props.accessibilityLabel, /Away final score unavailable.*Home final 0/);
      } else {
        assert.equal(
          findNode(card, (node) => node.type === 'Text' && (node.props.children === '0' || node.props.children === '—')),
          undefined,
          `${entry.name} must not display scores`,
        );
        assert.match(card.props.accessibilityLabel, new RegExp(`Away ${entry.id} at Home ${entry.id}`));
        assert.doesNotMatch(card.props.accessibilityLabel, /score unavailable/);
      }
    }
  });
});
