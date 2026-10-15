import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { PLAYER_ARTWORK_LEAGUE_ID, PLAYER_ARTWORK_STYLE_VERSION, resolvePlayerProfileArtwork, type PlayerArtworkManifest } from '../../src/lib/playerArtworkManifest';
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

function renderHero(
  overrides: Record<string, unknown> = {},
  options: { loadManifest?: (options?: { signal?: AbortSignal }) => Promise<PlayerArtworkManifest | null> } = {},
) {
  const harness = createHookHarness();
  const skaterArtwork = { uri: 'bundled-neutral-skater-artwork' };
  const goalieArtwork = { uri: 'bundled-neutral-goalie-artwork' };
  const loadManifest = options.loadManifest ?? (() => new Promise<PlayerArtworkManifest | null>(() => {}));
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
    '../../lib/playerArtworkManifest': {
      PLAYER_ARTWORK_LEAGUE_ID,
      loadPlayerArtworkManifest: loadManifest,
      resolvePlayerProfileArtwork,
    },
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

function approvedManifest(playerId: string, photoUrl: string, width: 631 | 628 | 643 = 631): PlayerArtworkManifest {
  const imageSha256 = 'a'.repeat(64);
  return {
    schemaVersion: 1,
    leagueId: PLAYER_ARTWORK_LEAGUE_ID,
    styleVersion: PLAYER_ARTWORK_STYLE_VERSION,
    generatedAt: '2026-10-06T18:13:23.235Z',
    entries: [{
      playerId,
      sourcePortraitUrl: photoUrl,
      sourcePortraitSha256: 'b'.repeat(64),
      imageUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/${playerId}/${imageSha256}.png`,
      imageSha256,
      width,
      height: 1050,
      approvedAt: '2026-10-06T18:12:55.000Z',
    }],
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

  it('renders the role-correct complete platform immediately instead of the standalone portrait', () => {
    const photoUrl = 'https://example.test/players/player-one.jpg';
    for (const isGoalie of [false, true]) {
      const rendered = renderHero({ isGoalie, photoUrl });
      const image = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.equal(image?.props.source, isGoalie ? rendered.goalieArtwork : rendered.skaterArtwork);
      assert.notDeepEqual(image?.props.source, { uri: photoUrl });
    }

    const screen = readFileSync(fileURLToPath(screenUrl.toString()), 'utf8');
    assert.match(screen, /playerId=\{data\.playerId\}/);
    assert.match(screen, /photoUrl=\{data\.photoUrl\}/);
    assert.match(screen, /isGoalie=\{data\.isGoalie\}/);
  });

  it('does not attach a failure path to a raw portrait that must never enter the hero', () => {
    const rendered = renderHero({ photoUrl: 'https://example.test/players/player-one.jpg' });
    const image = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.equal(image?.props.source, rendered.skaterArtwork);
    assert.equal(image?.props.onError, undefined);
    assert.equal(image?.props.resizeMode, 'contain');
    assert.equal(image?.props.accessible, false);
    assert.equal(image?.props.alt, '');
    assert.equal(image?.props.accessibilityElementsHidden, true);
  });

  it('transitions from immediate neutral art only to an exact approved role-compatible composite', async () => {
    const playerId = '11111111-1111-4111-8111-111111111111';
    const photoUrl = 'https://example.test/players/current.png';
    const manifest = approvedManifest(playerId, photoUrl, 631);
    const rendered = renderHero(
      { playerId, photoUrl, isGoalie: false },
      { loadManifest: async () => manifest },
    );
    const initial = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.equal(initial?.props.source, rendered.skaterArtwork);
    assert.equal(initial?.props.onError, undefined);

    await Promise.resolve();
    await Promise.resolve();
    rendered.harness.render();

    const approved = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
    assert.deepEqual(approved?.props.source, { uri: manifest.entries[0].imageUrl, cache: 'force-cache' });
    assert.equal(typeof approved?.props.onError, 'function');
    assert.notDeepEqual(approved?.props.source, { uri: photoUrl });
  });

  it('keeps missing, failed, stale-photo and role-mismatched manifest states on immediate role-neutral art', async () => {
    const playerId = '11111111-1111-4111-8111-111111111111';
    const photoUrl = 'https://example.test/players/current.png';
    const cases: Array<{
      label: string;
      isGoalie: boolean;
      load: () => Promise<PlayerArtworkManifest | null>;
    }> = [
      { label: 'missing', isGoalie: false, load: async () => null },
      { label: 'failed', isGoalie: true, load: async () => { throw new Error('offline'); } },
      { label: 'stale portrait', isGoalie: false, load: async () => approvedManifest(playerId, `${photoUrl}?old=1`, 631) },
      { label: 'role mismatch', isGoalie: true, load: async () => approvedManifest(playerId, photoUrl, 631) },
    ];

    for (const state of cases) {
      const rendered = renderHero(
        { playerId, photoUrl, isGoalie: state.isGoalie },
        { loadManifest: state.load },
      );
      await Promise.resolve();
      await Promise.resolve();
      rendered.harness.render();
      const image = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.equal(image?.props.source, state.isGoalie ? rendered.goalieArtwork : rendered.skaterArtwork, state.label);
      assert.equal(image?.props.onError, undefined, state.label);
      assert.notDeepEqual(image?.props.source, { uri: photoUrl }, state.label);
    }
  });

  it('falls directly from failed approved composites to role-correct neutral art and makes repeated failures inert', async () => {
    for (const [isGoalie, width] of [[false, 631], [true, 643]] as const) {
      const playerId = isGoalie ? '33333333-3333-4333-8333-333333333333' : '11111111-1111-4111-8111-111111111111';
      const photoUrl = `https://example.test/players/${isGoalie ? 'goalie' : 'skater'}.png`;
      const manifest = approvedManifest(playerId, photoUrl, width);
      const rendered = renderHero({ playerId, photoUrl, isGoalie }, { loadManifest: async () => manifest });
      await Promise.resolve();
      await Promise.resolve();
      rendered.harness.render();

      const remote = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.deepEqual(remote?.props.source, { uri: manifest.entries[0].imageUrl, cache: 'force-cache' });
      remote?.props.onError();
      rendered.harness.render();

      const fallback = findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork');
      assert.equal(fallback?.props.source, isGoalie ? rendered.goalieArtwork : rendered.skaterArtwork);
      assert.notDeepEqual(fallback?.props.source, { uri: photoUrl });
      assert.equal(fallback?.props.onError, undefined);
      const updatesAfterFallback = rendered.harness.stateUpdateCount;
      remote?.props.onError();
      rendered.harness.render();
      assert.equal(rendered.harness.stateUpdateCount, updatesAfterFallback, 'repeated callbacks after neutral fallback are inert');
    }
  });

  it('ignores stale manifest completions across player and portrait A-to-B-to-A changes', async () => {
    const playerA = '11111111-1111-4111-8111-111111111111';
    const playerB = '22222222-2222-4222-8222-222222222222';
    const photoA = 'https://example.test/players/a.png';
    const photoB = 'https://example.test/players/b.png';
    const requests: Array<(manifest: PlayerArtworkManifest | null) => void> = [];
    const rendered = renderHero(
      { playerId: playerA, photoUrl: photoA },
      { loadManifest: () => new Promise((resolve) => requests.push(resolve)) },
    );
    rendered.rerender({ playerId: playerB, photoUrl: photoB });
    rendered.rerender({ playerId: playerA, photoUrl: photoA });
    assert.equal(requests.length, 3);

    requests[0](approvedManifest(playerA, photoA));
    requests[1](approvedManifest(playerB, photoB));
    await Promise.resolve();
    await Promise.resolve();
    rendered.harness.render();
    assert.equal(
      findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      rendered.skaterArtwork,
      'late manifests from obsolete A and B lifetimes must not promote or demote current A',
    );

    const currentA = approvedManifest(playerA, photoA);
    requests[2](currentA);
    await Promise.resolve();
    await Promise.resolve();
    rendered.harness.render();
    assert.deepEqual(
      findNode(rendered.output, (node) => node.props.testID === 'player-profile-rink-ribbon-artwork')?.props.source,
      { uri: currentA.entries[0].imageUrl, cache: 'force-cache' },
    );
  });

  it('keeps the active approved composite through mounted A-to-B-to-A when an old A error fires', async () => {
    const { React, createRoot, JSDOM } = mountedReactRuntime();
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
      act: actEnvironment.IS_REACT_ACT_ENVIRONMENT,
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      const renderedRemotes: Array<{ uri: string; onError: () => void }> = [];
      const element = (type: string) => {
        function MockElement({ children, testID, accessibilityLabel }: { children?: unknown; testID?: string; accessibilityLabel?: string }) {
          return React.createElement(type, { 'data-testid': testID, 'aria-label': accessibilityLabel }, children);
        }
        MockElement.displayName = `Mock${type}`;
        return MockElement;
      };
      const Image = ({ source, onError, testID }: { source?: { uri?: string }; onError?: () => void; testID?: string }) => {
        const uri = source?.uri ?? 'bundled-neutral-artwork';
        if (onError) renderedRemotes.push({ uri, onError });
        return React.createElement('img', { 'data-testid': testID, src: uri });
      };
      let manifest: PlayerArtworkManifest;
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
        '../../lib/playerArtworkManifest': {
          PLAYER_ARTWORK_LEAGUE_ID,
          loadPlayerArtworkManifest: async () => manifest,
          resolvePlayerProfileArtwork,
        },
      }).default;
      const root = createRoot(dom.window.document.getElementById('root')!);
      const playerA = '11111111-1111-4111-8111-111111111111';
      const playerB = '22222222-2222-4222-8222-222222222222';
      const photoA = 'https://example.test/players/a.png';
      const photoB = 'https://example.test/players/b.png';
      const manifestA = approvedManifest(playerA, photoA);
      const manifestB = approvedManifest(playerB, photoB);
      manifest = manifestA;
      const props = {
        playerId: playerA, photoUrl: photoA, fullName: 'Alex Example', jerseyNumber: 19, position: 'Forward', leadership: null,
        team: null, awards: [], accent: '#FFD52F', isGoalie: false, width: 390, fontScale: 1, reduceTransparency: false,
        onShare: () => undefined, onOpenTeam: () => undefined,
      };
      const draw = async () => React.act(async () => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Hero, props)));
        await Promise.resolve();
        await Promise.resolve();
      });

      await draw();
      const staleAError = renderedRemotes.find((entry) => entry.uri === manifestA.entries[0].imageUrl)!.onError;
      props.playerId = playerB;
      props.photoUrl = photoB;
      manifest = manifestB;
      await draw();
      props.playerId = playerA;
      props.photoUrl = photoA;
      manifest = manifestA;
      await draw();
      await React.act(async () => staleAError());

      assert.equal(
        dom.window.document.querySelector('[data-testid="player-profile-rink-ribbon-artwork"]')?.getAttribute('src'),
        manifestA.entries[0].imageUrl,
        'an error retained from the old A lifetime must not replace the newly active A composite',
      );
      await React.act(async () => root.unmount());
    } finally {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous.document });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous.act;
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
