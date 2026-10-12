import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { getPlayerProfileHeroLayout, splitPlayerDisplayName } from '../../src/components/PlayerProfile/playerProfileHeroModel';
import { compileCommonJs, createElement, findNode, flattenStyle, nodeText } from './component-harness.ts';

const heroUrl = new URL('../../src/components/PlayerProfile/PlayerProfileHero.tsx', import.meta.url);
const screenUrl = new URL('../../src/screens/PlayerCardScreen.tsx', import.meta.url);

function nativeMock() {
  return {
    Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
  };
}

function renderHero(overrides: Record<string, unknown> = {}) {
  const artwork = { uri: 'bundled-rink-ribbon-artwork' };
  const Hero = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(heroUrl, {
    react: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => createElement(type, props, ...children) },
    'react-native': nativeMock(),
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../../../assets/league-leaders/jack-foote.png': artwork,
    '../TeamLogo': { __esModule: true, default: 'TeamLogo' },
    '../../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', glassStroke: '#333' } },
    '../../theme/contrast': { getContrastTextColor: () => '#000' },
  }).default;

  return { artwork, output: Hero({
    fullName: 'Alexis Marie De La Cruz', jerseyNumber: 19, position: 'Forward', leadership: 'C  Captain',
    team: { id: 'team-one', name: 'Night Owls', logoUrl: null }, awards: [], accent: '#FFD52F',
    width: 390, fontScale: 1, reduceTransparency: false, onShare: () => undefined, onOpenTeam: () => undefined,
    ...overrides,
  }) };
}

describe('Rink Ribbon player profile hero', () => {
  it('keeps the complete platform above following content from 320 to 430 points and stacks for enlarged text', () => {
    for (const width of [320, 375, 390, 430]) {
      const layout = getPlayerProfileHeroLayout(width, 1);
      assert.ok(layout.artWidth > 0);
      assert.ok(layout.artHeight > layout.artWidth);
      assert.ok(layout.artTop + layout.artHeight + layout.platformClearance <= layout.stageHeight);
      assert.ok(layout.identityWidth >= 112);
      assert.equal(layout.stacked, width < 350);
      if (layout.stacked) assert.equal(layout.identityWidth, layout.canvasWidth);
    }

    const enlarged = getPlayerProfileHeroLayout(320, 1.3);
    assert.equal(enlarged.stacked, true);
    assert.equal(enlarged.identityWidth, enlarged.canvasWidth);
    assert.ok(enlarged.artHeight + enlarged.platformClearance <= enlarged.stageHeight);
  });

  it('derives editorial name lines from the loaded full name without inventing a subject', () => {
    assert.deepEqual(splitPlayerDisplayName('Alexis Marie De La Cruz'), {
      givenNames: 'Alexis Marie De La',
      surname: 'Cruz',
    });
    assert.deepEqual(splitPlayerDisplayName('Cher'), { givenNames: '', surname: 'Cher' });
    assert.deepEqual(splitPlayerDisplayName('  Jordan   Lee  '), { givenNames: 'Jordan', surname: 'Lee' });
  });

  it('renders the exact League Home artwork as a decorative, fully contained, non-clipped image', () => {
    const source = readFileSync(fileURLToPath(heroUrl.toString()), 'utf8');
    assert.match(source, /require\('\.\.\/\.\.\/\.\.\/assets\/league-leaders\/jack-foote\.png'\)/);

    const { artwork, output } = renderHero();
    const shell = findNode(output, (node) => node.props.testID === 'player-profile-artwork-shell');
    const image = findNode(output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.ok(shell);
    assert.ok(image);
    assert.equal(image.props.source, artwork);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.accessible, false);
    assert.equal(image.props.alt, '');
    assert.equal(image.props.accessibilityElementsHidden, true);
    assert.equal(flattenStyle(shell.props.style).overflow, 'visible');
    assert.ok(flattenStyle(image.props.style).width > 0);
    assert.ok(flattenStyle(image.props.style).height > 0);
  });

  it('renders only loaded identity facts and keeps Share and team actions accessible', () => {
    let shared = 0;
    let openedTeam = 0;
    const { output } = renderHero({
      onShare: () => { shared += 1; },
      onOpenTeam: () => { openedTeam += 1; },
    });

    assert.match(nodeText(output), /Alexis Marie De La/);
    assert.match(nodeText(output), /Cruz/);
    assert.match(nodeText(output), /#19/);
    assert.match(nodeText(output), /Forward/i);
    assert.match(nodeText(output), /Captain/i);
    assert.match(nodeText(output), /Night Owls/);
    assert.doesNotMatch(nodeText(output), /Jack Foote|demo values|sample milestone|preview only/i);

    const share = findNode(output, (node) => node.props.accessibilityLabel === 'Share player card');
    assert.equal(share?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(share?.props.style).minWidth >= 44);
    assert.ok(flattenStyle(share?.props.style).minHeight >= 44);
    share?.props.onPress();
    assert.equal(shared, 1);

    const team = findNode(output, (node) => node.props.accessibilityLabel === 'Open Night Owls');
    assert.equal(team?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(team?.props.style).minHeight >= 44);
    team?.props.onPress();
    assert.equal(openedTeam, 1);
  });

  it('uses layered native ribbon, ice-glow and fog surfaces with an opaque transparency fallback', () => {
    const normal = renderHero().output;
    const atmosphere = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-atmosphere');
    const ribbon = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-curve');
    const glint = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-glint');
    const fog = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-fog');
    assert.equal(atmosphere?.props.pointerEvents, 'none');
    assert.equal(atmosphere?.props.accessible, false);
    assert.ok(flattenStyle(ribbon?.props.style).borderRadius > 100);
    assert.ok(flattenStyle(glint?.props.style).height >= 1);
    assert.ok(flattenStyle(fog?.props.style).opacity > 0);

    const opaqueOutput = renderHero({
      reduceTransparency: true,
      awards: [{ key: 'champion', label: 'League Champion', count: 2, imageUrl: null }],
    }).output;
    const opaque = findNode(opaqueOutput, (node) => node.props.testID === 'player-profile-rink-ribbon-atmosphere');
    const opaqueAward = findNode(opaqueOutput, (node) => node.props.accessibilityLabel === 'League Champion, 2');
    assert.equal(flattenStyle(opaque?.props.style).backgroundColor, '#10091D');
    assert.equal(flattenStyle(opaqueAward?.props.style).backgroundColor, '#180F28');
  });

  it('switches narrow or enlarged text to a non-overlapping flow without truncating identity', () => {
    for (const dimensions of [{ width: 320, fontScale: 1 }, { width: 390, fontScale: 1.3 }]) {
      const output = renderHero(dimensions).output;
      const identity = findNode(output, (node) => node.props.testID === 'player-profile-rink-ribbon-identity');
      const artwork = findNode(output, (node) => node.props.testID === 'player-profile-artwork-shell');
      const surname = findNode(output, (node) => node.props.testID === 'player-profile-rink-ribbon-surname');
      assert.equal(flattenStyle(identity?.props.style).position, 'relative');
      assert.equal(flattenStyle(identity?.props.style).width, dimensions.width);
      assert.equal(flattenStyle(artwork?.props.style).position, 'relative');
      assert.equal(surname?.props.numberOfLines, undefined);
    }
  });

  it('shows only real positive award data below the protected artwork stage', () => {
    const output = renderHero({
      awards: [
        { key: 'champion', label: 'League Champion', count: 2, imageUrl: 'https://example.test/cup.png' },
        { key: 'zero', label: 'Never Earned', count: 0, imageUrl: null },
      ],
    }).output;
    const awards = findNode(output, (node) => node.props.testID === 'player-profile-rink-ribbon-awards');
    assert.ok(awards);
    assert.ok(flattenStyle(awards.props.style).marginTop >= getPlayerProfileHeroLayout(390, 1).stageHeight);
    assert.match(nodeText(awards), /League Champion/);
    assert.match(nodeText(awards), /×2/);
    assert.doesNotMatch(nodeText(awards), /Never Earned/);
  });

  it('replaces the centered portrait card while preserving loaded facts, navigation and accessibility escape', () => {
    const screen = readFileSync(fileURLToPath(screenUrl.toString()), 'utf8');
    assert.match(screen, /<PlayerProfileHero/);
    assert.match(screen, /fullName=\{data\.fullName\}/);
    assert.match(screen, /jerseyNumber=\{data\.jerseyNumber\}/);
    assert.match(screen, /position=\{data\.position\}/);
    assert.match(screen, /leadership=\{leadership\}/);
    assert.match(screen, /team=\{data\.team\}/);
    assert.match(screen, /awards=\{heroAwards\}/);
    assert.match(screen, /reduceTransparency=\{reduceTransparency\}/);
    assert.match(screen, /navigateToTeamDetail/);
    assert.match(screen, /onAccessibilityEscape=\{navigation\.goBack\}/);
    assert.match(screen, /<FocusCard[^>]+style=\{styles\.heroBleed\}/);
    assert.doesNotMatch(screen, /<PlayerPortrait|styles\.hero\b|overflow: 'hidden'/);
  });
});
