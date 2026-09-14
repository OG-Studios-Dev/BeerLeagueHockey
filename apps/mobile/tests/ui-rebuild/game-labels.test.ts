import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

import type GameCardComponent from '../../src/components/GameCard';
import type { GameRow } from '../../src/lib/supabase/data';

type Element = {
  type: string | ((props: Props) => Tree);
  props: Props;
};
type Tree = Element | Tree[] | string | number | boolean | null | undefined;
type Props = {
  children?: Tree;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: string;
  accessibilityState?: { selected?: boolean };
  disabled?: boolean;
  onPress?: () => unknown;
  [key: string]: unknown;
};

const jsx = (type: Element['type'], props: Props): Element => ({ type, props });
const native = {
  ...Object.fromEntries(['Pressable', 'Text', 'View', 'Image', 'ScrollView', 'RefreshControl', 'ActivityIndicator']
    .map((name) => [name, name])),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
};
const preferences = { useAccessibilityPreferences: () => ({ reduceTransparency: false }) };

// Execute the real TSX and local theme modules. Replace only native/external
// boundaries; the JSX tree retains every rendered prop and Text value.
function load<T>(path: string, imports: Record<string, unknown> = {}): T {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (Object.hasOwn(imports, id)) return imports[id];
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (id === 'react-native') return native;
    if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (id === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
    if (id === '../context/AccessibilityPreferencesContext') return preferences;
    return require(id.startsWith('.') ? `${id}.ts` : id);
  }, exports);
  return exports as T;
}

const GlassSurface = load<{ default: Element['type'] }>('../../src/components/GlassSurface.tsx').default;
const calendarEvents: unknown[] = [];
const GameCard = load<{ default: typeof GameCardComponent }>('../../src/components/GameCard.tsx', {
  './GlassSurface': GlassSurface,
  '../lib/calendar': { addGameToCalendar: async (event: unknown) => { calendarEvents.push(event); } },
}).default;

function render(tree: Tree): Tree {
  if (Array.isArray(tree)) return tree.map(render);
  if (!tree || typeof tree !== 'object') return tree;
  if (typeof tree.type === 'function') return render(tree.type(tree.props));
  return { ...tree, props: { ...tree.props, children: render(tree.props.children) } };
}

function elements(tree: Tree): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...elements(tree.props.children)];
}

function rawText(tree: Tree): string {
  if (Array.isArray(tree)) return tree.map(rawText).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return rawText(tree.props.children);
}

function visibleText(tree: Tree): string {
  return elements(tree).filter((node) => node.type === 'Text')
    .map((node) => rawText(node.props.children)).join(' ').replace(/\s+/g, ' ').trim();
}

// Model RN's relevant naming contract, not a complete VoiceOver/TalkBack engine:
// an explicit group label replaces descendant Text aggregation; hints do not.
function accessibleName(node: Element): string {
  return node.props.accessibilityLabel ?? visibleText(node);
}

function expectAnnounced(node: Element, facts: string[]) {
  const name = accessibleName(node);
  assert.deepEqual(facts.filter((fact) => !name.includes(fact)), [], `Missing game facts in accessible name: ${name}`);
  for (const child of elements(node)) {
    assert.notEqual(child.props.accessibilityElementsHidden, true);
    assert.notEqual(child.props.importantForAccessibility, 'no-hide-descendants');
  }
}

function renderGame(props: Parameters<typeof GameCardComponent>[0]): Element {
  const tree = render(GameCard(props) as unknown as Tree);
  const card = elements(tree)[0];
  assert.equal(card.type, 'Pressable');
  return card;
}

const gameProps = {
  homeTeam: 'Harbour Wolves',
  awayTeam: 'River Otters',
  dateLabel: 'Sep 8',
  timeLabel: '8:30 PM',
  rinkName: 'North Forum',
};

describe('GameCard data-bearing accessibility', () => {
  it('announces the venue and both final scores on a compact result with no detail action', () => {
    const card = renderGame({ ...gameProps, status: 'Final', awayScore: 0, homeScore: 4, compact: true });
    assert.equal(card.props.onPress, undefined);
    assert.equal(card.props.disabled, true);
    assert.equal(card.props.accessibilityRole, undefined);
    assert.equal(card.props.accessibilityHint, undefined);
    assert.equal(visibleText(card), 'Sep 8 8:30 PM Final North Forum River Otters 0 Harbour Wolves 4');
    expectAnnounced(card, ['Sep 8', '8:30 PM', 'Final', 'North Forum', 'River Otters 0', 'Harbour Wolves 4']);
  });

  it('announces the venue and both live scores while preserving the detail action', () => {
    let opened = 0;
    const card = renderGame({ ...gameProps, status: 'Live', awayScore: 3, homeScore: 7, onPress: () => { opened += 1; } });
    assert.equal(card.props.accessibilityRole, 'button');
    assert.equal(card.props.disabled, false);
    card.props.onPress?.();
    assert.equal(opened, 1);
    expectAnnounced(card, ['Live', 'North Forum', 'River Otters 3', 'Harbour Wolves 7']);
  });

  it('preserves upcoming information and the nested calendar action without announcing unused scores', async () => {
    const scheduledAt = '2026-09-09T00:30:00Z';
    const card = renderGame({ ...gameProps, status: 'Upcoming', scheduledAt, location: 'North Forum', awayScore: 8, homeScore: 9 });
    const calendar = elements(card).find((node) => node.props.accessibilityLabel === 'Add River Otters at Harbour Wolves to calendar');
    assert.ok(calendar);
    assert.equal(calendar.props.accessibilityRole, 'button');
    assert.equal(visibleText(card), 'Sep 8 8:30 PM Upcoming North Forum River Otters Harbour Wolves Add to Calendar');
    await calendar.props.onPress?.();
    assert.deepEqual(calendarEvents.at(-1), {
      homeTeam: 'Harbour Wolves', awayTeam: 'River Otters', scheduledAt, location: 'North Forum',
    });
    expectAnnounced(card, ['Upcoming', 'North Forum', 'River Otters', 'Harbour Wolves', 'Sep 8', '8:30 PM']);
  });
});

const league = { id: 'league-1', name: 'Harbour League', slug: 'harbour' };
const homeTeam = { id: 'home-1', name: 'Harbour Wolves', logo_url: null, primary_color: null };
const awayTeam = { id: 'away-1', name: 'River Otters', logo_url: null, primary_color: null };
const nextGame = {
  id: 'next-game-1', league_id: league.id, scheduled_at: '2026-09-08T20:30:00',
  status: 'scheduled', location: 'North Forum', home_team_id: homeTeam.id, away_team_id: awayTeam.id,
  home_team: homeTeam, away_team: awayTeam,
};
const failNetwork = () => { throw new Error('The render harness must not call Supabase'); };

function renderHome({
  game = nextGame as typeof nextGame | null,
  games = [] as GameRow[],
  guest = false,
} = {}) {
  const publicHome = {
    leagueId: league.id, leagueSlug: league.slug,
    presentationSeason: { id: 'season-1' }, timezone: 'America/Toronto', weekKey: '2026-09-07:2026-09-13', divisions: [],
    articles: { status: 'ready', data: [] },
    weeklyGames: { status: 'ready', data: games },
    leaders: { status: 'error', data: [], message: 'Unavailable' },
    standings: { status: 'ready', data: [] }, photos: { status: 'ready', data: [] },
    albums: { status: 'ready', data: [] }, community: { status: 'ready', data: [] },
    sponsors: { status: 'ready', data: [{ id: 'blh-contract-fallback', name: 'Beer League Hockey', logo_url: null, website_url: 'https://beerleaguehockey.ca/', tier: 'platform', display_order: 0 }] },
  };
  // Seed the v2 component's state slots in declaration order; loading effects
  // stay disabled so this remains a pure accessibility-name test.
  const state = [
    publicHome,
    { status: 'ready', team: homeTeam, game },
    false, 'goals', null, 0,
    'confirmed', { confirmed: 11, tentative: 2, out: 0 }, false,
  ];
  let stateIndex = 0;
  const navigationCalls: unknown[][] = [];
  const checkinCalls: unknown[][] = [];
  const HomeScreen = load<{ default: (props: object) => Tree }>('../../src/screens/HomeScreen.tsx', {
    react: {
      Fragment: 'Fragment',
      useState: () => {
        assert.ok(stateIndex < state.length, 'Unexpected HomeScreen state slot');
        return [state[stateIndex++], () => {}];
      },
      useEffect: () => {},
      useCallback: (callback: unknown) => callback,
      useRef: (value: unknown) => ({ current: value }),
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => {} },
    'expo-linking': { openURL: failNetwork },
    '../../assets/blh-logo.png': 'logo.png',
    '../../assets/hockey-life-logo.png': 'hockey-life-logo.png',
    '../context/LeagueContext': {
      useLeague: () => ({
        activeLeague: league, isGuestLeague: guest,
        activeTheme: { primaryColor: '#22D3EE', secondaryColor: '#6366F1', backgroundColor: '#000000', textColor: '#FFFFFF' },
      }),
    },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'player-1' }, isGuest: false }) },
    '../lib/supabase/client': { supabase: { from: failNetwork } },
    '../lib/supabase/home': {
      loadHomePublicSnapshot: failNetwork,
      normalizeHomeGameStatus: (status: string) => status === 'completed' ? 'Final' : 'Scheduled',
      toSafeWebUrl: (value: string) => value,
    },
    '../lib/supabase/team': { getTeamActiveSeason: failNetwork, getActiveSeasonTeamForUser: failNetwork },
    '../navigation/playerCard': { navigateToPlayerCard: () => {} },
    '../lib/supabase/checkins': {
      getGameCheckinSummary: failNetwork, getMyCheckins: failNetwork,
      updateCheckin: async (...args: unknown[]) => { checkinCalls.push(args); return { success: true }; },
    },
    // Peripheral presentation is outside the two label regressions. Keep
    // wrappers' children intact; team names still come from real HomeScreen Text.
    ...Object.fromEntries(['GuestBanner', 'LeagueMarketplace', 'RevealView', 'TeamLogo'].map((name) => [`../components/${name}`, name])),
  }).default;
  const tree = render(HomeScreen({ navigation: { navigate: (...args: unknown[]) => { navigationCalls.push(args); } } }));
  assert.equal(stateIndex, state.length, 'HomeScreen state fixture matches all hook slots');
  return { tree, navigationCalls, checkinCalls };
}

function nextGameCard(tree: Tree): Element {
  const card = elements(tree).find((node) => node.props.testID === 'home-next-game-panel');
  assert.ok(card, 'Expected the rendered next-game card');
  return card;
}

describe('HomeScreen game accessibility', () => {
  it('announces next-game teams, date/time, venue and availability instead of only the detail instruction', async () => {
    const { tree, navigationCalls, checkinCalls } = renderHome();
    const card = nextGameCard(tree);
    assert.equal(card.type, 'View');
    assert.equal(card.props.accessibilityRole, undefined);
    assert.equal(visibleText(card), 'Tue, Sep 8 · 8:30 PM River Otters VS Harbour Wolves North Forum In Maybe Out 11 In · 2 Maybe · 0 Out');
    const detail = elements(card).find((node) => node.props.testID === 'home-next-game-details');
    assert.ok(detail);
    assert.equal(detail.props.accessibilityRole, 'button');
    expectAnnounced(detail, ['River Otters', 'Harbour Wolves', 'Sep 8', '8:30 PM', 'North Forum', '11 In · 2 Maybe · 0 Out']);
    assert.equal(detail.props.accessibilityHint, 'Open next game details');

    const controls = elements(card).filter((node) => node.type === 'Pressable' && node !== detail);
    assert.equal(elements(detail).filter((node) => node.type === 'Pressable' && node !== detail).length, 0);
    assert.deepEqual(controls.map((node) => [node.props.accessibilityRole, node.props.accessibilityLabel, node.props.accessibilityState?.selected]), [
      ['button', 'Check in for next game', true],
      ['button', 'Mark next game as maybe', false],
      ['button', 'Decline next game', false],
    ]);
    for (const control of controls) await control.props.onPress?.();
    assert.deepEqual(navigationCalls, [], 'check-in controls must never navigate to game details');
    detail.props.onPress?.();
    assert.deepEqual(navigationCalls, [['Schedule', { screen: 'GamePreview', initial: false, params: { gameId: 'next-game-1' } }]]);
    assert.deepEqual(checkinCalls, [
      ['next-game-1', 'home-1', 'confirmed'], ['next-game-1', 'home-1', 'tentative'], ['next-game-1', 'home-1', 'out'],
    ]);
  });

  it('retains the guest next-game join message in the accessible name', () => {
    const { tree } = renderHome({ guest: true });
    const card = nextGameCard(tree);
    const detail = elements(card).find((node) => node.props.testID === 'home-next-game-details');
    assert.ok(detail);
    expectAnnounced(detail, ['River Otters', 'Harbour Wolves', 'North Forum', 'Sep 8', '8:30 PM', 'Join this league to check in']);
    assert.equal(elements(card).filter((node) => node.type === 'Pressable').length, 1);
  });

  it('keeps weekly final scores and venue readable on the native game destination', () => {
    const { tree } = renderHome({ game: null, games: [{
      ...nextGame, id: 'recent-game-1', season_id: 'season-1', status: 'completed', home_score: 4, away_score: 0,
    }] });
    const result = elements(tree).find((node) => node.type === 'Pressable' && visibleText(node).includes('Final'));
    assert.ok(result);
    assert.equal(typeof result.props.onPress, 'function');
    assert.equal(result.props.accessibilityRole, 'button');
    assert.equal(result.props.accessibilityHint, undefined);
    expectAnnounced(result, ['Final', 'North Forum', 'River Otters 0', 'Harbour Wolves 4']);
  });
});
