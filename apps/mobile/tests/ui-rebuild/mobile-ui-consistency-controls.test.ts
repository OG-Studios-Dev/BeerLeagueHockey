/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';


import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';
import {
  estimateLeagueLeaderLineWidth,
  fitLeagueLeaderNameLine,
  splitLeagueLeaderName,
} from '../../src/lib/leaderPresentation.ts';

const src = (relative: string) => readFileSync(new URL(`../../src/${relative}`, import.meta.url).pathname, 'utf8');
const pagerUrl = new URL('../../src/components/CarouselPager.tsx', import.meta.url);
const selectableUrl = new URL('../../src/components/SelectableControl.tsx', import.meta.url);

function nodes(root: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(root)) return root.flatMap((child) => nodes(child, predicate));
  if (!root?.props) return [];
  return [...(predicate(root) ? [root] : []), ...nodes(root.props.children, predicate)];
}

describe('shared mobile carousel pager', () => {
  it('provides bounded dots, 44-point unboxed arrows, endpoint state, and adjustable accessibility', () => {
    assert.equal(existsSync(pagerUrl.pathname), true, 'CarouselPager shared primitive must exist');
    const harness = createHookHarness();
    const pagerModule = compileCommonJs<any>(pagerUrl, {
      react: harness.react,
      'react-native': {
        Pressable: 'Pressable', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
    });
    const previous: number[] = [];
    const next: number[] = [];
    harness.mount(() => pagerModule.default({
      currentIndex: 6,
      pageCount: 12,
      onPrevious: () => previous.push(1),
      onNext: () => next.push(1),
      previousLabel: 'Previous item',
      nextLabel: 'Next item',
      positionLabel: 'Items position',
      testID: 'fixture-pager',
    }));

    assert.deepEqual(pagerModule.getPagerDotWindow(12, 6), [3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(pagerModule.getPagerDotWindow(12, 0), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(pagerModule.getPagerDotWindow(3, 1), [0, 1, 2]);
    const previousButton = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Previous item')!;
    const nextButton = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Next item')!;
    const position = findNode(harness.output, (node) => node.props.testID === 'fixture-pager-position')!;
    assert.ok(Number(flattenStyle(previousButton.props.style).minHeight) >= 44);
    assert.ok(Number(flattenStyle(previousButton.props.style).width) >= 44);
    assert.ok(Number(flattenStyle(nextButton.props.style).width) >= 44);
    assert.equal(flattenStyle(previousButton.props.style).backgroundColor, undefined, 'pager arrows stay unboxed');
    assert.equal(flattenStyle(previousButton.props.style).borderWidth, undefined, 'pager arrows stay unboxed');
    assert.equal(position.props.accessibilityRole, 'adjustable');
    assert.deepEqual(position.props.accessibilityValue, { min: 1, max: 12, now: 7, text: '7 of 12' });
    assert.equal(position.props['aria-valuemin'], 1);
    assert.equal(position.props['aria-valuemax'], 12);
    assert.equal(position.props['aria-valuenow'], 7);
    assert.equal(position.props['aria-valuetext'], '7 of 12');
    const nativeWeb = createRequire(import.meta.url)('react-native-web') as Record<string, React.ComponentType<Record<string, unknown>>>;
    const { children: _children, ...positionProps } = position.props;
    const markup = renderToStaticMarkup(React.createElement(nativeWeb.View, positionProps));
    assert.match(markup, /role="slider"/);
    assert.match(markup, /aria-valuemin="1"/);
    assert.match(markup, /aria-valuemax="12"/);
    assert.match(markup, /aria-valuenow="7"/);
    assert.match(markup, /aria-valuetext="7 of 12"/);
    assert.deepEqual(position.props.accessibilityActions, [
      { name: 'increment', label: 'Next item' },
      { name: 'decrement', label: 'Previous item' },
    ]);
    assert.equal(nodes(position, (node) => node.props.testID?.startsWith('fixture-pager-dot-')).length, 7);
    const active = findNode(position, (node) => node.props.testID === 'fixture-pager-dot-6')!;
    const inactive = findNode(position, (node) => node.props.testID === 'fixture-pager-dot-5')!;
    assert.equal(flattenStyle(active.props.style).width, 24);
    assert.equal(flattenStyle(active.props.style).backgroundColor, '#C8B8FF');
    assert.equal(flattenStyle(inactive.props.style).backgroundColor, '#536276');
    previousButton.props.onPress();
    position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    assert.deepEqual(previous, [1]);
    assert.deepEqual(next, [1]);
    assert.equal(nodeText(position), '', 'pager does not expose a visible text counter');
  });

  it('disables finite endpoints while preserving optional looping behavior', () => {
    const harness = createHookHarness();
    const Pager = compileCommonJs<any>(pagerUrl, {
      react: harness.react,
      'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: <T>(styles: T) => styles } },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
    }).default;
    const finite: number[] = [];
    let props: Record<string, unknown> = {
      currentIndex: 0, pageCount: 3, onPrevious: () => finite.push(-1), onNext: () => finite.push(1),
      previousLabel: 'Previous', nextLabel: 'Next', positionLabel: 'Position', testID: 'finite',
    };
    harness.mount(() => Pager(props));
    let previous = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Previous')!;
    assert.equal(previous.props.disabled, true);
    assert.deepEqual(previous.props.accessibilityState, { disabled: true });
    assert.ok(flattenStyle(previous.props.style).opacity < 1);
    previous.props.onPress();
    const finitePosition = findNode(harness.output, (node) => node.props.testID === 'finite-position')!;
    finitePosition.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    assert.deepEqual(finite, []);

    props = { ...props, loop: true };
    harness.render();
    previous = findNode(harness.output, (node) => node.props.accessibilityLabel === 'Previous')!;
    assert.equal(previous.props.disabled, false);
    previous.props.onPress();
    const loopingPosition = findNode(harness.output, (node) => node.props.testID === 'finite-position')!;
    loopingPosition.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    assert.deepEqual(finite, [-1, -1]);
  });

  it('is the only pager control used by all five audited carousel consumers', () => {
    const consumers = [
      ['screens/HomeScreen.tsx', /<CarouselPager[\s\S]*?testID="home-story"/],
      ['components/HomeMatchupCarousel.tsx', /<CarouselPager[\s\S]*?testID="home-matchup"/],
      ['screens/TeamScreen/TeamPublicPage.tsx', /<CarouselPager[\s\S]*?testID="team-rival"/],
      ['screens/league-pages/GalleryAlbumScreen.tsx', /<CarouselPager[\s\S]*?testID="gallery-photo"/],
      ['components/PlayerProfile/CareerTrendChart.tsx', /<CarouselPager[\s\S]*?testID="career-hot-take"/],
    ] as const;
    for (const [file, usage] of consumers) {
      const contents = src(file);
      assert.match(contents, /import CarouselPager from ['"][^'"]*CarouselPager['"]/, file);
      assert.match(contents, usage, file);
      assert.doesNotMatch(contents, />\s*\{?\w*(?:Index|index)[^<\n]*\/?\s*\{?[^<\n]*(?:length|total)[^<\n]*</, `${file} must not render a legacy text counter`);
    }
    assert.doesNotMatch(src('screens/HomeScreen.tsx'), /storyCount|storyNavigationButton/);
    assert.doesNotMatch(src('screens/TeamScreen/TeamPublicPage.tsx'), /carouselButton|carouselDots/);
    assert.doesNotMatch(src('screens/league-pages/GalleryAlbumScreen.tsx'), /styles\.(?:nav|counter)|styles\.(?:prev|next)/);
    assert.doesNotMatch(src('components/PlayerProfile/CareerTrendChart.tsx'), /factButton|factArrow/);
  });
});

describe('canonical selectable-control foundation', () => {
  it('provides tab/radio semantics, 44-point targets, non-color selection, pressed/focus/disabled states, and overflow', () => {
    assert.equal(existsSync(selectableUrl.pathname), true, 'SelectableControl shared primitive must exist');
    const harness = createHookHarness();
    const controls = compileCommonJs<any>(selectableUrl, {
      react: harness.react,
      'react-native': {
        Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '../theme/colors': { __esModule: true, default: { bgInteractive: '#101827', glassStrokeStrong: '#475569', textPrimary: '#fff', textSecondary: '#94a3b8' } },
    });
    const changes: string[] = [];
    harness.mount(() => controls.SelectableControlGroup({
      role: 'tablist',
      accessibilityLabel: 'Fixture tabs',
      testID: 'fixture-group',
      children: [
        controls.SelectableControl({ testID: 'fixture-selected', role: 'tab', label: 'Selected', accessibilityLabel: 'Selected tab', selected: true, onPress: () => changes.push('selected') }),
        controls.SelectableControl({ testID: 'fixture-disabled', role: 'tab', label: 'Disabled', accessibilityLabel: 'Disabled tab', selected: false, disabled: true, onPress: () => changes.push('disabled') }),
        controls.SelectableControl({ testID: 'fixture-radio', role: 'radio', label: 'Division', selected: true, onPress: () => undefined }),
      ],
    }));
    const group = findNode(harness.output, (node) => node.props.testID === 'fixture-group')!;
    const selected = findNode(group, (node) => node.props.testID === 'fixture-selected')!;
    const disabled = findNode(group, (node) => node.props.testID === 'fixture-disabled')!;
    const radio = findNode(group, (node) => node.props.testID === 'fixture-radio')!;
    assert.equal(group.type, 'ScrollView');
    assert.equal(group.props.horizontal, true);
    assert.equal(group.props.accessibilityRole, 'tablist');
    assert.equal(selected.props.accessibilityRole, 'tab');
    assert.deepEqual(selected.props.accessibilityState, { selected: true, disabled: false });
    assert.equal(selected.props['aria-selected'], true);
    assert.ok(Number(flattenStyle(selected.props.style({ pressed: false })).minHeight) >= 44);
    assert.equal(flattenStyle(selected.props.style({ pressed: false })).borderRadius, 999);
    assert.ok(findNode(selected, (node) => node.props.testID === 'fixture-selected-selected-mark'), 'selected state has a visible checkmark');
    assert.ok(flattenStyle(selected.props.style({ pressed: true })).opacity < 1);
    selected.props.onFocus();
    harness.render();
    const focused = findNode(harness.output, (node) => node.props.testID === 'fixture-selected')!;
    assert.ok(flattenStyle(focused.props.style({ pressed: false })).borderWidth >= 2);
    assert.deepEqual(disabled.props.accessibilityState, { selected: false, disabled: true });
    assert.deepEqual(radio.props.accessibilityState, { selected: true, disabled: false, checked: true });
    assert.equal(radio.props['aria-checked'], true);
    assert.ok(flattenStyle(disabled.props.style({ pressed: false })).opacity < 1);
    disabled.props.onPress();
    assert.deepEqual(changes, []);
  });

  it('keeps canonical selected, focus, pressed, disabled, and text contrast states above consumer geometry styles', () => {
    const harness = createHookHarness();
    const controls = compileCommonJs<any>(selectableUrl, {
      react: harness.react,
      'react-native': {
        Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles },
      },
      '../theme/colors': { __esModule: true, default: { bgInteractive: '#101827', glassStrokeStrong: '#475569', textPrimary: '#fff', textSecondary: '#94a3b8' } },
    });
    harness.mount(() => [
      controls.SelectableControl({
        testID: 'consumer-selected', role: 'radio', label: 'Selected', selected: true, onPress: () => undefined,
        style: { width: 123, borderRadius: 12, paddingHorizontal: 3, backgroundColor: '#ff0000', borderColor: '#ff0000', borderWidth: 0, opacity: 1 },
        textStyle: { color: '#000000' },
      }),
      controls.SelectableControl({
        testID: 'consumer-disabled', role: 'radio', label: 'Disabled', selected: false, disabled: true, onPress: () => undefined,
        style: { opacity: 1 },
      }),
    ]);

    let selected = findNode(harness.output, (node) => node.props.testID === 'consumer-selected')!;
    const normalStyle = flattenStyle(selected.props.style({ pressed: false }));
    assert.equal(normalStyle.backgroundColor, 'rgba(142,127,255,0.28)');
    assert.equal(normalStyle.borderColor, '#A78BFA');
    assert.equal(normalStyle.borderWidth, 1);
    assert.equal(normalStyle.width, 123);
    assert.equal(normalStyle.borderRadius, 12);
    assert.equal(normalStyle.paddingHorizontal, 3);
    assert.equal(flattenStyle(selected.props.style({ pressed: true })).opacity, 0.7);
    const selectedLabel = findNode(selected, (node) => node.type === 'Text' && nodeText(node) === 'Selected')!;
    assert.equal(flattenStyle(selectedLabel.props.style).color, '#fff');

    selected.props.onFocus();
    harness.render();
    selected = findNode(harness.output, (node) => node.props.testID === 'consumer-selected')!;
    assert.equal(flattenStyle(selected.props.style({ pressed: false })).borderWidth, 2);
    assert.equal(flattenStyle(selected.props.style({ pressed: false })).borderColor, '#C8B8FF');

    const disabled = findNode(harness.output, (node) => node.props.testID === 'consumer-disabled')!;
    assert.equal(flattenStyle(disabled.props.style({ pressed: false })).opacity, 0.4);
  });

  it('is reused by every in-scope selectable tab, chip, segmented control, and check-in group', () => {
    const directConsumers = [
      'components/PillToggle.tsx',
      'components/DivisionFilter.tsx',
      'components/LeagueLeadersPresentation.tsx',
      'components/StatsLeadersCard.tsx',
      'components/StatsTimelineFilter.tsx',
      'components/PlayerProfile/CareerTrendChart.tsx',
      'components/StandingsPlayoffsPanel.tsx',
      'components/AccessibleChoiceGroup.tsx',
      'components/QuickCheckinActions.tsx',
      'components/LeagueMarketplace.tsx',
      'screens/HomeScreen.tsx',
      'screens/TeamScreen/TeamPublicPage.tsx',
      'screens/league-pages/LeaguePageCommon.tsx',
      'screens/league-pages/NewsFeedScreen.tsx',
      'screens/captain/GameAvailabilityScreen.tsx',
      'screens/GamePreviewScreen.tsx',
      'screens/NotificationsFeedScreen.tsx',
      'screens/EditProfileScreen.tsx',
    ];
    for (const file of directConsumers) {
      const contents = src(file);
      assert.match(contents, /SelectableControl/, `${file} must use the shared selectable-control foundation`);
    }
    assert.doesNotMatch(src('components/PillToggle.tsx'), /LinearGradient|brandRink|brandArena/);
    assert.doesNotMatch(src('components/DivisionFilter.tsx'), /backgroundColor:\s*primaryColor/);
    assert.doesNotMatch(src('components/StatsLeadersCard.tsx'), /toggleSelected:\s*\{\s*backgroundColor:\s*'#61DDE2'/);
    assert.match(src('screens/TeamScreen/TeamPublicPage.tsx'), /<SelectableControl[^>]+testID="team-roster-jersey-toggle"/);
    assert.match(src('screens/TeamScreen/TeamPublicPage.tsx'), /<SelectableControl[^>]+testID="team-roster-list-toggle"/);
    assert.match(src('screens/StatsScreen.tsx'), /<PillToggle[^>]*role="tab"[^>]*accessibilityLabel="Player type"/);
    assert.match(src('screens/stats/LeaderboardsScreen.tsx'), /<PillToggle[^>]*role="radio"[^>]*accessibilityLabel="Leaderboard category"/);
    assert.match(src('screens/EditProfileScreen.tsx'), /<SelectableControlGroup[^>]*role="radiogroup"[^>]*accessibilityLabel="Position options"/);
    assert.match(src('screens/EditProfileScreen.tsx'), /<SelectableControlGroup[^>]*role="radiogroup"[^>]*accessibilityLabel="League Match Level options"/);
  });
});

describe('League Leaders presentation consistency', () => {
  it('keeps the first token above every remaining token and fits the required long second line within bounded readable sizes', () => {
    const name = splitLeagueLeaderName('  Maximilian   de la Cruz-Santamaría  ');
    assert.deepEqual(name, {
      fullName: 'Maximilian de la Cruz-Santamaría',
      firstLine: 'Maximilian',
      secondLine: 'de la Cruz-Santamaría',
    });

    const homeFit = fitLeagueLeaderNameLine(name.secondLine, {
      availableWidth: 142,
      baseFontSize: 14,
      minimumFontSize: 9.5,
    });
    const statsFit = fitLeagueLeaderNameLine(name.secondLine, {
      availableWidth: 133,
      baseFontSize: 11,
      minimumFontSize: 10,
    });
    assert.ok(homeFit.fontSize >= 9.5 && homeFit.fontSize <= 14);
    assert.ok(statsFit.fontSize >= 10 && statsFit.fontSize <= 11);
    assert.ok(estimateLeagueLeaderLineWidth(name.secondLine, homeFit) <= 142);
    assert.ok(estimateLeagueLeaderLineWidth(name.secondLine, statsFit) <= 133);
  });

  it('uses one lossless name helper on Home, Stats leaders, stats tables, and full leaderboards', () => {
    const helper = src('lib/leaderPresentation.ts');
    assert.match(helper, /export function splitLeagueLeaderName/);
    for (const file of [
      'components/LeagueLeadersPresentation.tsx',
      'components/StatsLeadersCard.tsx',
      'lib/statsPresentationModel.ts',
      'screens/stats/LeaderboardsScreen.tsx',
    ]) assert.match(src(file), /splitLeagueLeaderName/, file);
    for (const file of ['components/LeagueLeadersPresentation.tsx', 'components/StatsLeadersCard.tsx', 'screens/stats/LeaderboardsScreen.tsx']) {
      const contents = src(file);
      assert.match(contents, /firstLine/);
      assert.match(contents, /secondLine/);
      assert.match(contents, /fullName/);
    }
  });
});
