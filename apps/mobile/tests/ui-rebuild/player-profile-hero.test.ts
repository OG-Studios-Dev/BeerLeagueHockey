import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { getPlayerProfileHeroLayout, splitPlayerDisplayName } from '../../src/components/PlayerProfile/playerProfileHeroModel';
import { compileCommonJs, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

const heroUrl = new URL('../../src/components/PlayerProfile/PlayerProfileHero.tsx', import.meta.url);
const screenUrl = new URL('../../src/screens/PlayerCardScreen.tsx', import.meta.url);

function mountedReactRuntime() {
  const require = createRequire(import.meta.url);
  const pnpmDirectory = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
  const jsdomEntry = readdirSync(pnpmDirectory).find((entry) => entry.startsWith('jsdom@'));
  assert.ok(jsdomEntry, 'the frozen workspace lockfile must provision jsdom for mounted lifecycle tests');
  const requireJsdom = createRequire(`${pnpmDirectory}${jsdomEntry}/node_modules/jsdom/package.json`);
  return { React: require('react'), createRoot: require('react-dom/client').createRoot, JSDOM: requireJsdom('jsdom').JSDOM };
}

function nativeMock() {
  return {
    Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
  };
}

function renderHero(overrides: Record<string, unknown> = {}) {
  const harness = createHookHarness();
  const skaterArtwork = { uri: 'bundled-neutral-skater-artwork' };
  const goalieArtwork = { uri: 'bundled-neutral-goalie-artwork' };
  const Hero = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(heroUrl, {
    react: harness.react,
    'react-native': nativeMock(),
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../../../assets/league-leaders/neutral-helmet-player.png': skaterArtwork,
    '../../../assets/league-leaders/neutral-goalie.png': goalieArtwork,
    '../TeamLogo': { __esModule: true, default: 'TeamLogo' },
    '../../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', glassStroke: '#333' } },
    '../../theme/contrast': { getContrastTextColor: () => '#000' },
  }).default;

  let props = {
    playerId: 'player-one', photoUrl: null,
    fullName: 'Alexis Marie De La Cruz', jerseyNumber: 19, position: 'Forward', leadership: 'C  Captain',
    team: { id: 'team-one', name: 'Night Owls', logoUrl: null }, awards: [], accent: '#FFD52F',
    isGoalie: false, width: 390, fontScale: 1, reduceTransparency: false, onShare: () => undefined, onOpenTeam: () => undefined,
    ...overrides,
  };
  harness.mount(() => Hero(props));

  return {
    skaterArtwork,
    goalieArtwork,
    harness,
    get output() { return harness.output; },
    rerender(next: Record<string, unknown>) {
      props = { ...props, ...next };
      return harness.render();
    },
  };
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

  it('grows the 390-point hero flow boundary around a measured long-name identity and two-line team control', () => {
    const teamName = 'First General London Hockey Club';
    const rendered = renderHero({
      width: 390,
      fontScale: 1,
      fullName: 'Maximilian Alexander Bartholomew Worthington-Smythe',
      leadership: 'Alternate Captain',
      photoUrl: null,
      team: { id: 'team-one', name: teamName, logoUrl: null },
      awards: [{ key: 'champion', label: 'League Champion', count: 1, imageUrl: null }],
    });
    const layout = getPlayerProfileHeroLayout(390, 1);
    const identity = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-identity');
    const teamControl = findNode(rendered.output, (node) => node.props.accessibilityLabel === `Open ${teamName}`);
    const teamLabel = findNode(teamControl, (node) => node.type === 'Text');

    assert.equal(layout.stacked, false);
    assert.equal(flattenStyle(teamControl?.props.style).minHeight, 48);
    assert.equal(teamLabel?.props.numberOfLines, 2);
    assert.equal(typeof identity?.props.onLayout, 'function', 'the absolute identity must report its real rendered extent to the hero flow');

    const measuredIdentity = { x: 147, y: 84, width: layout.identityWidth, height: 400 };
    identity?.props.onLayout({ nativeEvent: { layout: measuredIdentity } });
    rendered.harness.render();

    const hero = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-hero');
    const awards = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-awards');
    const measuredBottom = measuredIdentity.y + measuredIdentity.height;
    assert.ok(
      flattenStyle(hero?.props.style).minHeight >= measuredBottom,
      'the following surface must start at or below the measured team-control edge',
    );
    assert.ok(
      flattenStyle(awards?.props.style).marginTop >= measuredBottom,
      'awards must remain below the measured identity rather than covering its team control',
    );
  });

  it('derives editorial name lines from the loaded full name without inventing a subject', () => {
    assert.deepEqual(splitPlayerDisplayName('Alexis Marie De La Cruz'), {
      givenNames: 'Alexis Marie De La',
      surname: 'Cruz',
    });
    assert.deepEqual(splitPlayerDisplayName('Cher'), { givenNames: '', surname: 'Cher' });
    assert.deepEqual(splitPlayerDisplayName('  Jordan   Lee  '), { givenNames: 'Jordan', surname: 'Lee' });
  });

  it('selects the identity-neutral League Home skater and goalie artwork without importing the named player likeness', () => {
    const source = readFileSync(fileURLToPath(heroUrl.toString()), 'utf8');
    assert.match(source, /require\('\.\.\/\.\.\/\.\.\/assets\/league-leaders\/neutral-helmet-player\.png'\)/);
    assert.match(source, /require\('\.\.\/\.\.\/\.\.\/assets\/league-leaders\/neutral-goalie\.png'\)/);
    assert.doesNotMatch(source, /jack-foote|Jack Foote/i);

    const skater = renderHero({ isGoalie: false });
    const goalie = renderHero({ isGoalie: true, position: 'Goalie' });
    const shell = findNode(skater.output, (node) => node.props.testID === 'player-profile-artwork-shell');
    const image = findNode(skater.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    const goalieImage = findNode(goalie.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.ok(shell);
    assert.ok(image);
    assert.equal(image.props.source, skater.skaterArtwork);
    assert.equal(goalieImage?.props.source, goalie.goalieArtwork);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.accessible, false);
    assert.equal(image.props.alt, '');
    assert.equal(image.props.accessibilityElementsHidden, true);
    assert.equal(flattenStyle(shell.props.style).overflow, 'visible');
    const hero = findNode(skater.output, (node) => node.props.testID === 'player-profile-rink-ribbon-hero');
    assert.equal(flattenStyle(hero?.props.style).overflow, 'visible');
    assert.ok(flattenStyle(image.props.style).width > 0);
    assert.ok(flattenStyle(image.props.style).height > 0);
  });

  it('renders the loaded player mugshot and receives it from the player screen', () => {
    const photoUrl = 'https://example.test/players/player-one.jpg';
    const portrait = renderHero({ photoUrl });
    const image = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.deepEqual(image?.props.source, { uri: photoUrl });

    const screen = readFileSync(fileURLToPath(screenUrl.toString()), 'utf8');
    assert.match(screen, /playerId=\{data\.playerId\}/);
    assert.match(screen, /photoUrl=\{data\.photoUrl\}/);
  });

  it('uses the role-neutral artwork only after the loaded mugshot fails', () => {
    for (const [isGoalie, expectedFallback] of [[false, 'skater'], [true, 'goalie']] as const) {
      const portrait = renderHero({
        isGoalie,
        position: isGoalie ? 'Goalie' : 'Forward',
        photoUrl: `https://example.test/players/${expectedFallback}.jpg`,
      });
      const remote = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.equal(typeof remote?.props.onError, 'function');
      assert.equal(remote?.props.resizeMode, 'contain');
      assert.equal(remote?.props.accessible, false);
      assert.equal(remote?.props.alt, '');
      assert.equal(remote?.props.accessibilityElementsHidden, true);

      remote?.props.onError();
      portrait.harness.render();

      const fallback = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.equal(fallback?.props.source, isGoalie ? portrait.goalieArtwork : portrait.skaterArtwork);
      assert.equal(fallback?.props.onError, undefined);
    }
  });

  it('ignores stale and repeated errors while retrying portraits after player or photo changes', () => {
    const photoA = 'https://example.test/players/a.jpg';
    const photoB = 'https://example.test/players/b.jpg';
    const photoC = 'https://example.test/players/c.jpg';
    const portrait = renderHero({ playerId: 'player-one', photoUrl: photoA });
    const imageA = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');

    portrait.rerender({ photoUrl: photoB });
    const imageB = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.deepEqual(imageB?.props.source, { uri: photoB });

    imageA?.props.onError();
    portrait.harness.render();
    assert.deepEqual(
      findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      { uri: photoB },
      'a stale photo A error must not replace current photo B',
    );

    imageB?.props.onError();
    portrait.harness.render();
    assert.equal(
      findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      portrait.skaterArtwork,
    );
    const updatesAfterFallback = portrait.harness.stateUpdateCount;
    imageB?.props.onError();
    portrait.harness.render();
    assert.equal(portrait.harness.stateUpdateCount, updatesAfterFallback, 'repeated callbacks after fallback are inert');

    portrait.rerender({ playerId: 'player-two' });
    assert.deepEqual(
      findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      { uri: photoB },
      'a player change retries the current portrait URL',
    );

    const playerTwoImageB = findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    playerTwoImageB?.props.onError();
    portrait.harness.render();
    portrait.rerender({ photoUrl: photoC });
    assert.deepEqual(
      findNode(portrait.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      { uri: photoC },
      'a photo change retries the new URL',
    );
  });

  it('keeps the active portrait through a mounted A-to-B-to-A transition when the old A callback fires', async () => {
    const { React, createRoot, JSDOM } = mountedReactRuntime();
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
      act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    try {
      const renderedPortraits: Array<{ uri: string; onError: () => void }> = [];
      const element = (type: string) => {
        function MockElement({ children, testID, accessibilityLabel }: any) {
          return React.createElement(type, { 'data-testid': testID, 'aria-label': accessibilityLabel }, children);
        }
        MockElement.displayName = `Mock${type}`;
        return MockElement;
      };
      const Image = ({ source, onError, testID }: any) => {
        const uri = source?.uri ?? 'bundled-neutral-artwork';
        if (onError) renderedPortraits.push({ uri, onError });
        return React.createElement('img', { 'data-testid': testID, src: uri });
      };
      const Hero = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(heroUrl, {
        react: React,
        'react-native': {
          Image,
          Pressable: element('button'),
          Text: element('span'),
          View: element('div'),
          StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
        },
        'expo-linear-gradient': { LinearGradient: element('div') },
        '@expo/vector-icons': { Ionicons: element('span') },
        '../../../assets/league-leaders/neutral-helmet-player.png': { uri: 'bundled-neutral-skater-artwork' },
        '../../../assets/league-leaders/neutral-goalie.png': { uri: 'bundled-neutral-goalie-artwork' },
        '../TeamLogo': { __esModule: true, default: element('span') },
        '../../theme/colors': { __esModule: true, default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', glassStroke: '#333' } },
        '../../theme/contrast': { getContrastTextColor: () => '#000' },
      }).default;
      const root = createRoot(dom.window.document.getElementById('root')!);
      const photoA = 'https://example.test/players/a.jpg';
      const photoB = 'https://example.test/players/b.jpg';
      const props = {
        playerId: 'player-one', photoUrl: photoA, fullName: 'Alex Example', jerseyNumber: 19, position: 'Forward', leadership: null,
        team: null, awards: [], accent: '#FFD52F', isGoalie: false, width: 390, fontScale: 1, reduceTransparency: false,
        onShare: () => undefined, onOpenTeam: () => undefined,
      };
      const draw = async () => React.act(async () => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Hero, props)));
      });

      await draw();
      const staleAError = renderedPortraits.find((entry) => entry.uri === photoA)!.onError;
      props.photoUrl = photoB;
      await draw();
      props.photoUrl = photoA;
      await draw();
      await React.act(async () => staleAError());

      assert.equal(
        dom.window.document.querySelector('[data-testid="player-profile-rink-ribbon-artwork"]')?.getAttribute('src'),
        photoA,
        'an error retained from the old A lifetime must not replace the newly active A portrait',
      );
      await React.act(async () => root.unmount());
    } finally {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
  });

  it('uses a vertical surname column at normal widths and a full horizontal surname in stacked layouts', () => {
    const normal = renderHero({ width: 390, fontScale: 1 }).output;
    const normalSurname = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-surname');
    assert.equal(flattenStyle(normalSurname?.props.style).flexDirection, 'column');
    assert.equal(normalSurname?.props.accessibilityLabel, 'Cruz');
    assert.equal(nodeText(normalSurname), 'Cruz');

    const stacked = renderHero({ width: 320, fontScale: 1.3 }).output;
    const stackedSurname = findNode(stacked, (node) => node.props.testID === 'player-profile-rink-ribbon-surname');
    assert.notEqual(flattenStyle(stackedSurname?.props.style).flexDirection, 'column');
    assert.equal(nodeText(stackedSurname), 'Cruz');
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

  it('uses explicit hard-yellow and purple curved rails flowing behind the platform into content', () => {
    const normal = renderHero().output;
    const atmosphere = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-atmosphere');
    const purpleRail = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-purple-rail');
    const yellowRail = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-yellow-rail');
    const contentBed = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-content-bed');
    const fog = findNode(normal, (node) => node.props.testID === 'player-profile-rink-ribbon-fog');
    const layout = getPlayerProfileHeroLayout(390, 1);
    assert.equal(atmosphere?.props.pointerEvents, 'none');
    assert.equal(atmosphere?.props.accessible, false);
    assert.equal(flattenStyle(purpleRail?.props.style).backgroundColor, '#7A3FC3');
    assert.equal(flattenStyle(yellowRail?.props.style).backgroundColor, '#FFD52F');
    assert.ok(flattenStyle(purpleRail?.props.style).borderRadius > 100);
    assert.ok(flattenStyle(yellowRail?.props.style).borderRadius > 100);
    assert.ok(flattenStyle(purpleRail?.props.style).top < layout.stageHeight);
    assert.ok(flattenStyle(purpleRail?.props.style).top + flattenStyle(purpleRail?.props.style).height > layout.stageHeight);
    assert.ok(flattenStyle(contentBed?.props.style).top < layout.stageHeight);
    assert.ok(flattenStyle(contentBed?.props.style).minHeight > layout.platformClearance);
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
    assert.match(screen, /isGoalie=\{data\.isGoalie\}/);
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
