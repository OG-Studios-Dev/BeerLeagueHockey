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
const supabase = { auth: { getUser: failNetwork }, from: failNetwork };
const data = load('../../src/lib/supabase/data.ts', { './client': { supabase } });

function renderHome({
  game = nextGame as typeof nextGame | null,
  games = [] as GameRow[],
  guest = false,
} = {}) {
  // Seed the component's state slots in declaration order; do not execute data
  // loading effects. useMemo and callbacks remain real, including recentFinals.
  const state = [
    games, homeTeam, game, false, // games, userTeam, nextGame, loadingLeague
    [], [], false, {}, null, // global roster/games/loading/checkins/saving
    false, null, // refreshing, lastUpdatedAt
    'confirmed', { confirmed: 11, tentative: 2, out: 0 }, false, // check-in state
  ];
  let stateIndex = 0;
  const navigationCalls: unknown[][] = [];
  const leagueSelections: unknown[] = [];
  const checkinCalls: unknown[][] = [];
  const HomeScreen = load<{ default: (props: object) => Tree }>('../../src/screens/HomeScreen.tsx', {
    react: {
      useState: () => {
        assert.ok(stateIndex < state.length, 'Unexpected HomeScreen state slot');
        return [state[stateIndex++], () => {}];
      },
      useEffect: () => {},
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => {} },
    'expo-linking': { openURL: failNetwork },
    '../../assets/blh-logo.png': 'logo.png',
    '../context/LeagueContext': {
      useLeague: () => ({
        activeLeague: league, availableLeagues: [league], isGuestLeague: guest,
        setActiveLeague: (value: unknown) => { leagueSelections.push(value); },
        activeTheme: { primaryColor: '#22D3EE', secondaryColor: '#6366F1', backgroundColor: '#000000', textColor: '#FFFFFF' },
      }),
    },
    '../lib/supabase/client': { supabase },
    '../lib/supabase/data': data,
    '../lib/supabase/checkins': {
      getGameCheckinSummary: failNetwork, getMyCheckins: failNetwork, getMyCheckinsForTeams: failNetwork,
      updateCheckin: async (...args: unknown[]) => { checkinCalls.push(args); return { success: true }; },
    },
    '../components/GameCard': GameCard,
    // Peripheral presentation is outside the two label regressions. Keep
    // wrappers' children intact; team names still come from real HomeScreen Text.
    ...Object.fromEntries(['BrandAtmosphere', 'GuestBanner', 'LeagueMarketplace', 'QuickCheckinActions',
      'RevealView', 'ScheduleConflictList', 'SectionHeader', 'TeamLogo'].map((name) => [`../components/${name}`, name])),
  }).default;
  const tree = render(HomeScreen({ navigation: { navigate: (...args: unknown[]) => { navigationCalls.push(args); } } }));
  assert.equal(stateIndex, state.length, 'HomeScreen state fixture matches all hook slots');
  return { tree, navigationCalls, leagueSelections, checkinCalls };
}

function nextGameCard(tree: Tree): Element {
  const card = elements(tree).find((node) => node.type === 'Pressable' && visibleText(node).startsWith('NEXT GAME '));
  assert.ok(card, 'Expected the rendered next-game card');
  return card;
}

describe('HomeScreen game accessibility', () => {
  it('announces next-game teams, date/time, venue and availability instead of only the detail instruction', async () => {
    const { tree, navigationCalls, leagueSelections, checkinCalls } = renderHome();
    const card = nextGameCard(tree);
    assert.equal(card.props.accessibilityRole, 'button');
    assert.equal(visibleText(card), 'NEXT GAME Tue Sep 8 · 8:30 PM River Otters VS Harbour Wolves North Forum In Maybe Out 11 In · 2 Maybe · 0 Out');
    expectAnnounced(card, ['River Otters', 'Harbour Wolves', 'Sep 8', '8:30 PM', 'North Forum', '11 In · 2 Maybe · 0 Out']);
    assert.equal(card.props.accessibilityHint, 'Open next game details');
    card.props.onPress?.();
    assert.deepEqual(navigationCalls, [['Schedule', { screen: 'GamePreview', params: { gameId: 'next-game-1' } }]]);
    assert.deepEqual(leagueSelections, [league]);

    const controls = elements(card).filter((node) => node.type === 'Pressable' && node !== card);
    assert.deepEqual(controls.map((node) => [node.props.accessibilityRole, node.props.accessibilityLabel, node.props.accessibilityState?.selected]), [
      ['button', 'Check in for next game', true],
      ['button', 'Mark next game as maybe', false],
      ['button', 'Decline next game', false],
    ]);
    for (const control of controls) await control.props.onPress?.();
    assert.deepEqual(checkinCalls, [
      ['next-game-1', 'home-1', 'confirmed'], ['next-game-1', 'home-1', 'tentative'], ['next-game-1', 'home-1', 'out'],
    ]);
  });

  it('retains the guest next-game join message in the accessible name', () => {
    const { tree } = renderHome({ guest: true });
    const card = nextGameCard(tree);
    expectAnnounced(card, ['River Otters', 'Harbour Wolves', 'North Forum', 'Sep 8', '8:30 PM', 'Join this league to check in']);
    assert.equal(elements(card).filter((node) => node.type === 'Pressable').length, 1);
  });

  it('keeps Recent Results scores and venue readable without inventing a detail action', () => {
    const { tree } = renderHome({ game: null, games: [{
      ...nextGame, id: 'recent-game-1', season_id: 'season-1', status: 'completed', home_score: 4, away_score: 0,
    }] });
    const result = elements(tree).find((node) => node.type === 'Pressable' && visibleText(node).includes('Final'));
    assert.ok(result);
    assert.equal(result.props.onPress, undefined);
    assert.equal(result.props.disabled, true);
    assert.equal(result.props.accessibilityRole, undefined);
    assert.equal(result.props.accessibilityHint, undefined);
    expectAnnounced(result, ['Final', 'North Forum', 'River Otters 0', 'Harbour Wolves 4']);
  });
});
