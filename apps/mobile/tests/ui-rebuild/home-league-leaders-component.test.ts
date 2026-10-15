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
  gaa: null, is_goalie: false, estimated: false,
};
const kyle: HomeLeader = {
  player_id: 'kyle', player_name: 'Kyle Geraghty', avatar_url: null,
  team_id: 'bunny', team_name: 'Bad Bunny', display_team_name: 'Bad Bunny',
  display_team_logo_url: 'https://example.test/bunny.png', position: 'Defense', goals: 0, assists: 2, points: 2,
  gaa: null, is_goalie: false, estimated: false,
};
const trevor: HomeLeader = {
  player_id: 'trevor', player_name: 'Trevor Paterson', avatar_url: 'https://example.test/trevor.png',
  team_id: 'bunny', team_name: 'Bad Bunny', display_team_name: 'Bad Bunny',
  display_team_logo_url: 'https://example.test/bunny.png', position: 'Forward', goals: 2, assists: 1, points: 3,
  gaa: null, is_goalie: false, estimated: false,
};
const steven: HomeLeader = {
  player_id: 'steven', player_name: 'Steven Wild', avatar_url: null,
  team_id: 'goalie-team', team_name: 'Goalie Team', display_team_name: 'Goalie Team',
  display_team_logo_url: null, position: 'Goalie', goals: null, assists: null, points: null,
  gaa: 6 / 11, is_goalie: true, estimated: true,
};
const aaron: HomeLeader = { ...steven, player_id: 'aaron', player_name: 'Aaron Buehler', gaa: 4 };
const cody: HomeLeader = { ...steven, player_id: 'cody', player_name: 'Cody Bolman', gaa: 6 };
const maximilian: HomeLeader = { ...steven, player_id: 'maximilian', player_name: 'Maximilian de la Cruz-Santamaría', gaa: 1.25 };
const fiveRowLeaders: HomeLeader[] = Array.from({ length: 6 }, (_, index) => ({
  ...steven,
  player_id: `leader-${index + 1}`,
  player_name: index === 4 ? 'Maximilian de la Cruz-Santamaría' : `Leader ${index + 1}`,
  team_id: `team-${index + 1}`,
  team_name: `Team ${index + 1}`,
  display_team_name: `Team ${index + 1}`,
  display_team_logo_url: index === 3 ? null : `https://example.test/team-${index + 1}.png`,
  goals: 6 - index,
  assists: 12 - index,
  points: 18 - index,
  gaa: index + 1,
}));

function loadComponent(
  harness: ReturnType<typeof createHookHarness>,
  sourceUrl: URL = new URL('../../src/components/HomeLeagueLeaders.tsx', import.meta.url),
) {
  return compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    sourceUrl,
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
      './SectionHeader': { SECTION_HEADING_TEXT_STYLE: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontStyle: 'normal' } },
      './TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../../assets/league-leaders/jack-foote.png': { asset: 'jack' },
      '../../assets/league-leaders/neutral-helmet-player.png': { asset: 'neutral' },
      '../../assets/league-leaders/neutral-goalie.png': { asset: 'goalie' },
    },
  ).default;
}

describe('Home League Leaders component', () => {
  it('loads remote artwork without blocking facts and owns remote/bundled/photo attempts across A-B-A', async () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const imageSha256 = 'a'.repeat(64);
    const manifest = { schemaVersion: 1 as const, leagueId, styleVersion: 'hl-leader-podium-v1' as const, generatedAt: '2026-10-04T12:00:00.000Z', entries: [{ playerId: jack.player_id, sourcePortraitUrl: jack.avatar_url!, sourcePortraitSha256: 'b'.repeat(64), imageUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/${jack.player_id}/${imageSha256}.png`, imageSha256, width: 631, height: 1050, approvedAt: '2026-10-04T11:00:00.000Z' }] };
    let selected = jack;
    const loader = async () => manifest;
    harness.mount(() => Component({ leagueId, seasonName: null, metric: 'points', leaders: [selected], status: 'ready', width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {}, onOpenPlayer: () => {}, onOpenAllStats: () => {}, manifestLoader: loader }));
    assert.match(nodeText(harness.output), /JackFoote/);
    await Promise.resolve(); harness.render();
    let art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { uri: manifest.entries[0].imageUrl, cache: 'force-cache' });
    const staleAError = art.props.onError;
    selected = { ...trevor, points: 4 }; harness.render();
    selected = jack; harness.render();
    const updates = harness.stateUpdateCount; staleAError(); harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.equal(harness.stateUpdateCount, updates);
    assert.deepEqual(art.props.source, { uri: manifest.entries[0].imageUrl, cache: 'force-cache' });
    art.props.onError(); harness.render();
    assert.deepEqual(findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!.props.source, { asset: 'jack' });
  });

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
    for (const metric of ['goals', 'assists', 'points']) {
      const tab = findNode(harness.output, (node) => node.props.testID === `home-leaders-tab-${metric}`)!;
      assert.equal(tab.props['aria-selected'], metric === 'points');
      assert.equal(tab.props.accessibilityState.selected, metric === 'points');
    }
    const imageStyle = flattenStyle(findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!.props.style);
    assert.equal(imageStyle.width, '100%', 'Override native Image intrinsic width inside the definite stage');
    assert.equal(imageStyle.height, '100%', 'Override native Image intrinsic height inside the definite stage');
    const pointsRow = findNode(harness.output, (node) => node.props.testID === `home-leader-row-${jack.player_id}`)!;
    assert.match(nodeText(pointsRow), /T1JackFoote3/);
    assert.doesNotMatch(nodeText(pointsRow), /POINTS/);

    findNode(harness.output, (node) => node.props.testID === 'home-leaders-tab-assists')!.props.onPress();
    harness.render();
    const feature = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.match(feature.props.accessibilityLabel, /Kyle Geraghty, no player photo available/);
    assert.deepEqual(feature.props.source, { asset: 'neutral' });
    const assistsRow = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-kyle')!;
    assert.match(nodeText(assistsRow), /1KyleGeraghty2/);
    assert.doesNotMatch(nodeText(assistsRow), /ASSISTS/);
    assert.equal(nodeText(harness.output).includes('Jack Foote featured player artwork'), false);

    findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-action')!.props.onPress();
    findNode(harness.output, (node) => node.props.testID === 'home-leader-row-kyle')!.props.onPress();
    assert.deepEqual(opened, ['kyle', 'kyle']);
  });

  it('renders five eligible Home leaders on every metric tab without padding a sixth row', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const Wrapper = () => {
      const [metric, setMetric] = harness.react.useState<leaderModel.HomeLeaderMetric>('points');
      return Component({
        leagueId, seasonName: 'Fall 2026', metric, leaders: fiveRowLeaders, status: 'ready',
        width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: setMetric,
        onRetry: () => {}, onOpenPlayer: () => {}, onOpenAllStats: () => {},
      });
    };
    harness.mount(Wrapper);

    for (const metric of ['goals', 'assists', 'points', 'gaa'] as const) {
      findNode(harness.output, (node) => node.props.testID === `home-leaders-tab-${metric}`)!.props.onPress();
      harness.render();
      for (let index = 1; index <= 5; index += 1) {
        assert.ok(findNode(harness.output, (node) => node.props.testID === `home-leader-row-leader-${index}`), `${metric} row ${index}`);
      }
      const firstRow = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-leader-1')!;
      assert.doesNotMatch(nodeText(firstRow), new RegExp(metric.toUpperCase()), `${metric} label remains tab-only`);
      assert.equal(findNode(harness.output, (node) => node.props.testID === 'home-leader-row-leader-6'), undefined);
    }
  });

  it('orders each Home row as overlapping crest-rank cluster, lossless name, then right-aligned value', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const tiedLeaders = fiveRowLeaders.map((row, index) => ({ ...row, points: [9, 8, 8, 7, 6, 5][index] }));
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: tiedLeaders, status: 'ready',
      width: 320, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));

    const row = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-leader-2')!;
    const rowChildren = row.props.children as Array<{ props: Record<string, unknown> }>;
    assert.deepEqual(rowChildren.map((child) => child.props.testID), [
      'home-leader-crest-cluster-leader-2',
      'home-leader-name-block-leader-2',
      'home-leader-value-leader-2',
    ]);

    const cluster = rowChildren[0];
    const crest = findNode(cluster, (node) => node.props.testID === 'home-leader-crest-leader-2')!;
    const badge = findNode(cluster, (node) => node.props.testID === 'home-leader-rank-badge-leader-2')!;
    const badgeText = findNode(badge, (node) => node.type === 'Text')!;
    const clusterStyle = flattenStyle(cluster.props.style);
    const crestStyle = flattenStyle(crest.props.style);
    const badgeStyle = flattenStyle(badge.props.style);
    assert.ok(Number(clusterStyle.width) >= Number(crestStyle.left) + 30, 'crest cluster bounds the full logo');
    assert.ok(Number(badgeStyle.left) < Number(crestStyle.left), 'badge starts left of the crest');
    assert.ok(Number(badgeStyle.left) + Number(badgeStyle.width) > Number(crestStyle.left), 'badge physically overlaps the crest');
    assert.ok(Number(badgeStyle.zIndex) > Number(crestStyle.zIndex), 'badge sits in front of the crest');
    assert.equal(badgeStyle.width, badgeStyle.height);
    assert.equal(badgeStyle.borderRadius, badgeStyle.width / 2);
    assert.equal(badgeStyle.backgroundColor, '#7C3AED');
    assert.equal(nodeText(badge), 'T2');
    assert.equal(flattenStyle(badgeText.props.style).color, '#FFFFFF');

    const logo = findNode(crest, (node) => node.type === 'TeamLogo')!;
    assert.equal(logo.props.transparentBacking, true);
    assert.equal(logo.props.teamId, 'team-2');
    const nameBlockStyle = flattenStyle(rowChildren[1].props.style);
    const valueStyle = flattenStyle(rowChildren[2].props.style);
    assert.equal(nameBlockStyle.flex, 1);
    assert.equal(nameBlockStyle.minWidth, 0);
    assert.equal(valueStyle.textAlign, 'right');
    assert.match(row.props.accessibilityLabel, /T2\. Leader 2, Team 2, 8 points\. Open player card\./);
    assert.doesNotMatch(nodeText(row), /POINTS/);

    const missingLogoRow = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-leader-4')!;
    const missingLogo = findNode(missingLogoRow, (node) => node.type === 'TeamLogo')!;
    assert.equal(missingLogo.props.logoUrl, null);
    assert.equal(missingLogo.props.transparentBacking, true);
  });

  it('selects the exact GAA tab and renders raw goalie values to one decimal without a visible estimate marker', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const Wrapper = () => {
      const [metric, setMetric] = harness.react.useState<leaderModel.HomeLeaderMetric>('points');
      return Component({
        leagueId, seasonName: 'Fall 2026', metric, leaders: [jack, cody, steven, aaron], status: 'ready',
        width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: setMetric,
        onRetry: () => {}, onOpenPlayer: () => {}, onOpenAllStats: () => {},
      });
    };
    harness.mount(Wrapper);

    const gaaTab = findNode(harness.output, (node) => node.props.testID === 'home-leaders-tab-gaa');
    assert.ok(gaaTab);
    assert.equal(nodeText(gaaTab), 'GAA');
    gaaTab.props.onPress();
    harness.render();

    const selectedGaaTab = findNode(harness.output, (node) => node.props.testID === 'home-leaders-tab-gaa')!;
    assert.equal(selectedGaaTab.props.accessibilityState.selected, true);
    const row = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-steven')!;
    assert.match(nodeText(row), /1StevenWild0\.5/);
    assert.doesNotMatch(nodeText(row), /GAA/);
    assert.doesNotMatch(nodeText(row), /~/);
    assert.match(row.props.accessibilityLabel, /estimated goals against average 0\.5/i);
    assert.match(nodeText(findNode(harness.output, (node) => node.props.testID === 'home-leader-row-aaron')), /2AaronBuehler4\.0/);
    assert.match(nodeText(findNode(harness.output, (node) => node.props.testID === 'home-leader-row-cody')), /3CodyBolman6\.0/);
    const art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { asset: 'goalie' });
    assert.match(art.props.accessibilityLabel, /no goalie photo available/i);
  });

  it('allows the complete Home long-name second segment two lines at every layout while Team stays one line', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const props: Record<string, unknown> = {
      leagueId, seasonName: 'Fall 2026', metric: 'gaa', leaders: [maximilian], status: 'ready',
      width: 320, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    };
    harness.mount(() => Component(props));

    for (const { width, fontScale } of [
      { width: 320, fontScale: 1 },
      { width: 390, fontScale: 1 },
      { width: 320, fontScale: 1.3 },
    ]) {
      props.width = width;
      props.fontScale = fontScale;
      harness.render();
      const row = findNode(harness.output, (node) => node.props.testID === 'home-leader-row-maximilian')!;
      const nameBlock = findNode(row, (node) => node.props.testID === 'home-leader-name-block-maximilian')!;
      const first = findNode(row, (node) => node.type === 'Text' && nodeText(node) === 'Maximilian')!;
      const second = findNode(row, (node) => node.type === 'Text' && nodeText(node) === 'de la Cruz-Santamaría')!;
      assert.equal(first.props.numberOfLines, 1);
      assert.equal(second.props.numberOfLines, 2, `${width}px/fontScale ${fontScale} must wrap instead of one-line ellipsis`);
      assert.equal(first.props.adjustsFontSizeToFit, true);
      assert.equal(second.props.adjustsFontSizeToFit, true);
      assert.equal(nodeText(second), 'de la Cruz-Santamaría');
      assert.ok(Number(flattenStyle(second.props.style).fontSize) >= 9.5);
      if (width === 320) {
        assert.ok(
          Number(flattenStyle(nameBlock.props.style).minHeight) >= (fontScale === 1 ? 54 : Math.ceil(62 * fontScale)),
          `fontScale ${fontScale} name block must grow for all three visible name lines`,
        );
      }
      assert.match(row.props.accessibilityLabel, /Maximilian de la Cruz-Santamaría/);
    }

    const teamHarness = createHookHarness();
    const Presentation = loadComponent(
      teamHarness,
      new URL('../../src/components/LeagueLeadersPresentation.tsx', import.meta.url),
    );
    teamHarness.mount(() => Presentation({
      ...props,
      width: 390,
      fontScale: 1,
      testIDPrefix: 'team',
      focusPrefix: 'team-public:test',
      showAllStats: false,
    }));
    const teamRow = findNode(teamHarness.output, (node) => node.props.testID === 'team-leader-row-maximilian')!;
    const teamSecond = findNode(teamRow, (node) => node.type === 'Text' && nodeText(node) === 'de la Cruz-Santamaría')!;
    assert.equal(teamSecond.props.numberOfLines, 1);
    assert.equal(nodeText(teamSecond), 'de la Cruz-Santamaría');
  });

  it('owns generated, photo and neutral attempts and ignores saved stale callbacks', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: [jack], status: 'ready',
      width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));
    let art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    const staleGeneratedError = art.props.onError;
    staleGeneratedError();
    harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { uri: jack.avatar_url });
    assert.equal(art.props.accessibilityLabel, 'Jack Foote player photo');
    assert.equal(art.props.key, 'photo:1');
    staleGeneratedError();
    harness.render();
    assert.deepEqual(findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!.props.source, { uri: jack.avatar_url });
    art.props.onLoad();
    staleGeneratedError();
    harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { uri: jack.avatar_url });
    art.props.onError();
    harness.render();
    art = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.deepEqual(art.props.source, { asset: 'neutral' });
    assert.match(art.props.accessibilityLabel, /no player photo available/i);
    assert.equal(art.props.key, 'neutral:2');
    const updatesBeforeNeutralError = harness.stateUpdateCount;
    art.props.onError();
    harness.render();
    assert.equal(harness.stateUpdateCount, updatesBeforeNeutralError);
    assert.deepEqual(findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-art')!.props.source, { asset: 'neutral' });
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

  it('preserves baseline ranking and contained-art lanes while fitting five normal-scale rows', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const props: Record<string, unknown> = {
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: fiveRowLeaders, status: 'ready',
      width: 320, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    };
    const baselineByWidth = new Map([
      [320, { rankingWidth: '60%', artLaneWidth: 115.2 }],
      [390, { rankingWidth: '54%', artLaneWidth: 160.68 }],
      [430, { rankingWidth: '54%', artLaneWidth: 179.08 }],
    ]);
    const projectContain = (laneWidth: number, stageHeight: number, sourceWidth: number, sourceHeight: number) => {
      const scale = Math.min(laneWidth / sourceWidth, stageHeight / sourceHeight);
      return { width: sourceWidth * scale, height: sourceHeight * scale };
    };
    harness.mount(() => Component(props));

    for (const width of [320, 390, 430]) {
      props.width = width;
      harness.render();
      const baseline = baselineByWidth.get(width)!;
      const layout = findNode(harness.output, (node) => node.props.testID === 'home-leaders-layout')!;
      const layoutStyle = flattenStyle(layout.props.style);
      assert.equal(layoutStyle.flexDirection, 'row');
      const ranking = findNode(harness.output, (node) => node.props.testID === 'home-leaders-ranking')!;
      const rankingStyle = flattenStyle(ranking.props.style);
      assert.equal(rankingStyle.width, baseline.rankingWidth);

      const contentWidth = width - 32;
      const rankingFraction = Number.parseFloat(String(rankingStyle.width)) / 100;
      const gap = Number(layoutStyle.gap ?? 0);
      const projectedArtLaneWidth = contentWidth - contentWidth * rankingFraction - gap;
      assert.ok(Math.abs(projectedArtLaneWidth - baseline.artLaneWidth) < 0.001, `${width}px artwork lane must equal the baseline allocation`);

      const artAction = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-action')!;
      const artActionStyle = flattenStyle(artAction.props.style({ pressed: false }));
      assert.equal(artActionStyle.height, 326);
      const art = findNode(artAction, (node) => node.props.testID === 'home-leader-feature-art')!;
      const artStyle = flattenStyle(art.props.style);
      assert.equal(art.props.resizeMode, 'contain');
      assert.equal(artStyle.width, '100%');
      assert.equal(artStyle.height, '100%');
      for (const [sourceWidth, sourceHeight] of [[628, 1050], [643, 1050]]) {
        const projected = projectContain(projectedArtLaneWidth, artActionStyle.height, sourceWidth, sourceHeight);
        const baselineProjection = projectContain(baseline.artLaneWidth, 326, sourceWidth, sourceHeight);
        assert.ok(Math.abs(projected.width - baselineProjection.width) < 0.001);
        assert.ok(Math.abs(projected.height - baselineProjection.height) < 0.001);
        assert.ok(projected.width <= projectedArtLaneWidth && projected.height <= 326, 'contain preserves the complete artwork');
      }

      const rows = fiveRowLeaders.slice(0, 5).map((leader) => findNode(
        harness.output,
        (node) => node.props.testID === `home-leader-row-${leader.player_id}`,
      )!);
      const rowStyles = rows.map((row) => flattenStyle(row.props.style({ pressed: false })));
      assert.ok(rowStyles.every((style) => style.height === 65 && style.minHeight === 64));
      assert.ok(rowStyles.reduce((sum, style) => sum + Number(style.height), 0) <= 326);
    }
  });

  it('gives the stacked artwork action definite non-shrinking geometry', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    const width = 320;
    const fontScale = 1.3;
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: fiveRowLeaders, status: 'ready',
      width, fontScale, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));

    assert.equal(flattenStyle(findNode(harness.output, (node) => node.props.testID === 'home-leaders-layout')!.props.style).flexDirection, 'column');
    assert.equal(flattenStyle(findNode(harness.output, (node) => node.props.testID === 'home-leaders-ranking')!.props.style).width, '100%');
    const artAction = findNode(harness.output, (node) => node.props.testID === 'home-leader-feature-action')!;
    const artActionStyle = flattenStyle(artAction.props.style({ pressed: false }));
    const expectedHeight = Math.min(340, Math.max(280, Math.round(width * 0.82)));
    assert.equal(artActionStyle.height, expectedHeight);
    assert.equal(artActionStyle.minHeight, expectedHeight);
    assert.equal(artActionStyle.flexGrow, 0);
    assert.equal(artActionStyle.flexShrink, 0);
    assert.equal(artActionStyle.flexBasis, 'auto');
    assert.notEqual(artActionStyle.flex, 0, 'RN Web must not receive a zero flex basis');
    assert.ok(Number(artActionStyle.minHeight) > 0);
    const art = findNode(artAction, (node) => node.props.testID === 'home-leader-feature-art')!;
    assert.equal(art.props.resizeMode, 'contain');
    assert.equal(flattenStyle(art.props.style).position, 'absolute');
  });

  it('uses a goalie-specific fallback when GAA errors omit a message', () => {
    const harness = createHookHarness();
    const Component = loadComponent(harness);
    harness.mount(() => Component({
      leagueId, seasonName: 'Fall 2026', metric: 'gaa', leaders: [], status: 'error',
      width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {},
    }));

    const error = findNode(harness.output, (node) => node.props.testID === 'home-leaders-error');
    assert.ok(error);
    assert.equal(nodeText(error), 'Current-season goalie GAA is temporarily unavailable.Retry');
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
    assert.deepEqual(tab.props.accessibilityState, { selected: true, disabled: false });
    assert.ok(findNode(harness.output, (node) => node.props.testID === 'home-leaders-loading'));

    props.status = 'error';
    harness.render();
    findNode(harness.output, (node) => node.props.testID === 'home-leaders-retry')!.props.onPress();
    assert.equal(retried, 1);

    props.status = 'ready';
    props.metric = 'gaa';
    harness.render();
    const empty = findNode(harness.output, (node) => node.props.testID === 'home-leaders-empty');
    assert.ok(empty);
    assert.match(nodeText(empty), /goalie GAA/i);
    assert.doesNotMatch(nodeText(empty), /skater totals/i);
    findNode(harness.output, (node) => node.props.testID === 'home-leaders-all-stats')!.props.onPress();
    assert.equal(openedAll, 1);
  });

  it('keeps the shared Team defaults at three leaders with the existing standard row layout', () => {
    const harness = createHookHarness();
    const Presentation = loadComponent(
      harness,
      new URL('../../src/components/LeagueLeadersPresentation.tsx', import.meta.url),
    );
    harness.mount(() => Presentation({
      leagueId, seasonName: 'Fall 2026', metric: 'points', leaders: fiveRowLeaders, status: 'ready',
      width: 390, fontScale: 1, reduceTransparency: false, onMetricChange: () => {}, onRetry: () => {},
      onOpenPlayer: () => {}, onOpenAllStats: () => {}, testIDPrefix: 'team', focusPrefix: 'team-public:test',
      showAllStats: false,
    }));

    for (let index = 1; index <= 3; index += 1) {
      assert.ok(findNode(harness.output, (node) => node.props.testID === `team-leader-row-leader-${index}`));
    }
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'team-leader-row-leader-4'), undefined);
    const firstRow = findNode(harness.output, (node) => node.props.testID === 'team-leader-row-leader-1')!;
    assert.equal((firstRow.props.children as unknown[]).length, 2);
    assert.equal(findNode(firstRow, (node) => node.props.testID === 'team-leader-crest-cluster-leader-1'), undefined);
    assert.match(nodeText(firstRow), /1Leader118POINTS/);
    assert.equal(flattenStyle(firstRow.props.style({ pressed: false })).minHeight, 92);
    const logo = findNode(firstRow, (node) => node.type === 'TeamLogo')!;
    assert.equal(logo.props.size, 36);
    assert.equal(logo.props.transparentBacking, true);
    assert.equal(findNode(harness.output, (node) => node.props.testID === 'team-leaders-all-stats'), undefined);
  });

  it('keys artwork and crest lifetimes to exact changing identities', () => {
    const source = readFileSync(new URL('../../src/components/LeagueLeadersPresentation.tsx', import.meta.url).pathname, 'utf8');
    assert.match(source, /import jackFooteArt from ['"]\.\.\/\.\.\/assets\/league-leaders\/jack-foote\.png['"]/);
    assert.match(source, /import neutralGoalieArt from ['"]\.\.\/\.\.\/assets\/league-leaders\/neutral-goalie\.png['"]/);
    assert.match(source, /import neutralHelmetArt from ['"]\.\.\/\.\.\/assets\/league-leaders\/neutral-helmet-player\.png['"]/);
    assert.match(source, /key=\{artwork\.identityKey\}/);
    assert.match(source, /key=\{`\$\{stage\}:\$\{generation\}`\}/);
    assert.match(source, /key=\{`\$\{leader\.team_id/);
    assert.match(source, /resizeMode="contain"/);
  });
});
