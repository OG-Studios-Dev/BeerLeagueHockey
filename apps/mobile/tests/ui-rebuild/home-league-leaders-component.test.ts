import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { HomeLeader } from '../../src/lib/supabase/home';
import * as leaderModel from '../../src/lib/homeLeagueLeaders';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const leagueId = leaderModel.JACK_FOOTE_ART_IDENTITY.leagueId;
const jack: HomeLeader = {
  player_id: leaderModel.JACK_FOOTE_ART_IDENTITY.playerId,
  player_name: 'Jack Foote',
  avatar_url: leaderModel.JACK_FOOTE_ART_IDENTITY.avatarUrl,
  team_id: 'flyers', team_name: 'FitzRays Flyers', display_team_name: 'FitzRays Flyers',
  display_team_logo_url: 'https://example.test/flyers.png', position: 'Forward', goals: 2, assists: 1, points: 3,
};
const kyle: HomeLeader = {
  player_id: 'kyle', player_name: 'Kyle Geraghty', avatar_url: null,
  team_id: 'bunny', team_name: 'Bad Bunny', display_team_name: 'Bad Bunny',
  display_team_logo_url: 'https://example.test/bunny.png', position: 'Defense', goals: 0, assists: 2, points: 2,
};
const trevor: HomeLeader = {
  player_id: 'trevor', player_name: 'Trevor Paterson', avatar_url: 'https://example.test/trevor.png',
  team_id: 'bunny', team_name: 'Bad Bunny', display_team_name: 'Bad Bunny',
  display_team_logo_url: 'https://example.test/bunny.png', position: 'Forward', goals: 2, assists: 1, points: 3,
};

function loadComponent(harness: ReturnType<typeof createHookHarness>) {
  return compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/components/HomeLeagueLeaders.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: { position: 'absolute' }, hairlineWidth: 1 },
      },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      '../lib/homeLeagueLeaders': leaderModel,
      '../theme/home': { HOME_VISUAL_TOKENS: { text: '#fff', textSecondary: '#aaa', stroke: 'rgba(1,2,3,.2)', strokeOpaque: '#345', minTouchTarget: 44 } },
      './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../../assets/league-leaders/jack-foote.png': { asset: 'jack' },
      '../../assets/league-leaders/neutral-helmet-player.png': { asset: 'neutral' },
    },
  ).default;
}

describe('Home League Leaders component', () => {
  it('defaults to Points and switches rows, values, ranks and hero identity together', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const opened: string[] = [];
    const Wrapper = () => {
      const [metric, setMetric] = harness.react.useState<leaderModel.HomeLeaderMetric>('points');
      return Component({
        leagueId, seasonName: 'Fall 2026', metric, leaders: [kyle, trevor, jack], status: 'ready',
        width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: setMetric,
        onRetry: () => {}, onOpenPlayer: (id: string) => opened.push(id), onOpenAllStats: () => {},
      });
    };
    harness.mount(Wrapper);

    assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!.props.accessibilityLabel, 'Jack Foote featured player artwork');
    assert.match(nodeText(findNode(harness.output, (node) => node.props.testID === `home-leader-row-${jack.player_id}`)), /T1Jack Foote3POINTS/);

    findNode(harness.output, (node) => node.props.testID === 'home-leaders-tab-assists')!.props.onPress();
    harness.render();
    const feature = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.match(feature.props.accessibilityLabel, /Kyle Geraghty, no player photo available/);
    assert.deepEqual(feature.props.source, { asset: 'neutral' });
    assert.match(nodeText(findNode(harness.output, (node) => node.props.testID === 'home-leader-row-kyle')), /1Kyle Geraghty2ASSISTS/);
    assert.equal(nodeText(harness.output).includes('Jack Foote featured player artwork'), false);

    findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-action')!.props.onPress();
    findNode(harness.output, (node) => node.props.testID === 'home-leader-row-kyle')!.props.onPress();
    assert.deepEqual(opened, ['kyle', 'kyle']);
  });

  it('falls from failed generated art to the genuine photo and then identity-neutral art', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: [jack], status: 'ready',
      width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));
    let art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    art.props.onError();
    harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { uri: jack.avatar_url });
    assert.equal(art.props.accessibilityLabel, 'Jack Foote player photo');
    art.props.onError();
    harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { asset: 'neutral' });
    assert.match(art.props.accessibilityLabel, /no player photo available/i);
  });

  it('renders crests without separate visible team names and exposes team identity in row labels', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: [jack, trevor], status: 'ready',
      width: 320, fontScale: 1.5, reduceTransparency: true, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));
    const jackRow = findNode(harness.output, (node) => node.props.testID === `home-leader-row-${jack.player_id}`)!;
    assert.match(jackRow.props.accessibilityLabel, /FitzRays Flyers/);
    assert.ok(findNode(jackRow, (node) => node.type === 'TeamLogo'));
    assert.equal(findNode(jackRow, (node) => node.type === 'Text' && nodeText(node) === 'FitzRays Flyers'), undefined);
    assert.equal(flattenStyle(findNode(harness.output, (node) => node.props.testID === 'home-leaders-layout')!.props.style).flexDirection, 'column');
  });

  it('keeps tabs at least 44px and supplies loading, error, empty and all-stats actions', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    let retried = 0;
    let openedAll = 0;
    const props: Record<string, unknown> = {
      leagueId, seasonName: null, metric: 'points', leaders: [], status: 'loading', width: 390, fontScale: 1,
      reduceTransparency: false, onMetricChange: () => {}, onRetry: () => { retried += 1; },
      onOpenPlayer: () => {}, onOpenAllStats: () => { openedAll += 1; },
    };
    harness.mount(() => Component(props));
    const tab = findNode(harness.output, (node) => node.props.testID === 'home-leaders-tab-points')!;
    assert.equal(flattenStyle(tab.props.style({ pressed: false })).minHeight, 44);
    assert.deepEqual(tab.props.accessibilityState, { selected: true });
    assert.ok(findNode(harness.output, (node) => node.props.testID === 'home-leaders-loading'));

    props.status = 'error';
    harness.render();
    findNode(harness.output, (node) => node.props.testID === 'home-leaders-retry')!.props.onPress();
    assert.equal(retried, 1);

    props.status = 'ready';
    harness.render();
    assert.ok(findNode(harness.output, (node) => node.props.testID === 'home-leaders-empty'));
    findNode(harness.output, (node) => node.props.testID === 'home-leaders-all-stats')!.props.onPress();
    assert.equal(openedAll, 1);
  });

  it('keys artwork and crest lifetimes to exact changing identities', () => {
    const source = readFileSync(new URL('../../src/components/HomeLeagueLeaders.tsx', import.meta.url).pathname, 'utf8');
    assert.match(source, /import jackFooteArt from ['"]\.\.\/\.\.\/assets\/league-leaders\/jack-foote\.png['"]/);
    assert.match(source, /import neutralHelmetArt from ['"]\.\.\/\.\.\/assets\/league-leaders\/neutral-helmet-player\.png['"]/);
    assert.match(source, /key=\{artwork\.identityKey\}/);
    assert.match(source, /key=\{`\$\{leader\.team_id/);
    assert.match(source, /resizeMode="contain"/);
  });
});
