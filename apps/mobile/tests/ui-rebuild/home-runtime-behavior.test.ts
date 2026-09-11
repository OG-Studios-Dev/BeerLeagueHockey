import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compileCommonJs,
  createElement,
  createHookHarness,
  findNode,
  flattenStyle,
  nodeText,
  type TestNode,
} from './component-harness';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

const league = {
  id: 'league-1',
  name: 'Northumberland County Recreational Hockey Association — Winter Division',
  slug: 'harbour-hockey',
};

const userTeam = {
  id: 'wolves',
  name: 'Harbour Wolves With A Long Team Name',
  logo_url: null,
  primary_color: '#34D399',
  secondary_color: null,
};

const awayTeam = {
  id: 'otters',
  name: 'River Otters With A Long Team Name',
  logo_url: null,
  primary_color: null,
};

const nextGame = {
  id: 'next-1',
  league_id: league.id,
  scheduled_at: '2026-09-18T20:30:00-04:00',
  location: 'North Community Forum',
  status: 'scheduled',
  home_team_id: userTeam.id,
  away_team_id: awayTeam.id,
  home_team: userTeam,
  away_team: awayTeam,
};

const finals = [
  {
    id: 'final-old', scheduled_at: '2026-09-01T20:00:00-04:00', status: 'completed',
    location: 'West Rink', home_team_id: 'a', away_team_id: 'b', home_score: 2, away_score: 1,
    home_team: { id: 'a', name: 'Old Home' }, away_team: { id: 'b', name: 'Old Away' },
  },
  {
    id: 'final-new', scheduled_at: '2026-09-10T21:00:00-04:00', status: 'completed',
    location: 'East Rink', home_team_id: 'c', away_team_id: 'd', home_score: 5, away_score: 4,
    home_team: { id: 'c', name: 'New Home' }, away_team: { id: 'd', name: 'New Away' },
  },
];

function createRuntime({
  guest = false,
  width = 375,
  updateResults = [] as Array<{ success: boolean }>,
} = {}) {
  const harness = createHookHarness();
  const roster = deferred<{ data: { team: typeof userTeam } | null }>();
  const navigationCalls: unknown[][] = [];
  const leagueSelections: unknown[] = [];
  const linkCalls: string[] = [];
  const checkinCalls: unknown[][] = [];

  const chain = (result: () => Promise<unknown>) => {
    const value: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'or', 'order', 'limit']) {
      value[method] = () => value;
    }
    value.maybeSingle = result;
    return value;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'player-1' } } }) },
    from: (table: string) => table === 'team_rosters'
      ? chain(() => roster.promise)
      : chain(async () => ({ data: nextGame })),
  };

  const colors = {
    primary: '#22D3EE', bgBase: '#07111F', bgSurface: 'rgba(12,27,49,.72)',
    bgInteractive: 'rgba(28,42,66,.84)', textPrimary: '#F8FBFF', textSecondary: '#A9B8CC',
    textOnPrimary: '#02111B', glassStroke: 'rgba(255,255,255,.12)',
    glassStrokeStrong: 'rgba(96,165,250,.28)', glassHighlight: 'rgba(255,255,255,.08)',
    brandRink: '#22D3EE', borderCard: 'rgba(255,255,255,.1)', accentGreen: '#22C55E',
    accentRed: '#EF4444', bgElevated: '#0A1628',
  };

  const HomeScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/HomeScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
        RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: {
          create: <T>(styles: T) => styles,
          absoluteFill: { position: 'absolute', inset: 0 },
          absoluteFillObject: { position: 'absolute', inset: 0 },
          hairlineWidth: 1,
        },
        useWindowDimensions: () => ({ width, height: 812 }),
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => {} },
      'expo-linking': { openURL: async (url: string) => { linkCalls.push(url); } },
      '../../assets/blh-logo.png': 'blh-logo.png',
      '../components/GameCard': (props: Record<string, unknown>) => createElement('GameCard', props),
      '../components/GuestBanner': () => createElement('GuestBanner', null),
      '../components/LeagueMarketplace': (props: Record<string, unknown>) => createElement('LeagueMarketplace', props),
      '../components/QuickCheckinActions': () => null,
      '../components/RevealView': ({ children, ...props }: Record<string, unknown>) => createElement('RevealView', props, children),
      '../components/ScheduleConflictList': () => null,
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/AccessibilityPreferencesContext': {
        useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }),
      },
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague: league,
          activeTheme: {
            primaryColor: '#34D399', secondaryColor: '#0A1628',
            backgroundColor: '#07111F', textColor: '#F8FBFF',
          },
          availableLeagues: [league],
          isGuestLeague: guest,
          setActiveLeague: async (selected: unknown) => { leagueSelections.push(selected); },
        }),
      },
      '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
      '../lib/supabase/checkins': {
        getGameCheckinSummary: async () => ({
          confirmed: Array.from({ length: 11 }), tentative: Array.from({ length: 2 }), out: [],
        }),
        getMyCheckins: async () => ({}),
        getMyCheckinsForTeams: async () => ({}),
        updateCheckin: async (...args: unknown[]) => {
          checkinCalls.push(args);
          return updateResults.shift() ?? { success: true };
        },
      },
      '../lib/supabase/client': { supabase },
      '../lib/supabase/data': {
        getLeagueGames: async () => finals,
        mapGameStatus: (status: string) => status === 'completed' ? 'Final' : 'Upcoming',
      },
      '../theme/colors': { default: colors },
      '../theme/ui': { ui: { minTouchTarget: 44, radius: { card: 18, panel: 24 } } },
    },
  ).default;

  harness.mount(() => HomeScreen({
    navigation: { navigate: (...args: unknown[]) => navigationCalls.push(args) },
  }));

  return { checkinCalls, harness, leagueSelections, linkCalls, navigationCalls, roster };
}

async function renderResolved(runtime: ReturnType<typeof createRuntime>) {
  runtime.roster.resolve({ data: { team: userTeam } });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    runtime.harness.render();
    if (findNode(runtime.harness.output, (node) => node.props.testID === 'home-next-game-panel')) break;
  }
  return runtime.harness.output;
}

describe('Home runtime behavior equivalence', () => {
  it('hydrates the pinned translucent stage over a fixed clipped arena atmosphere', async () => {
    const runtime = createRuntime();
    const output = await renderResolved(runtime);
    const arena = findNode(output, (node) => node.props.testID === 'home-arena-backdrop');
    assert.ok(arena);
    assert.equal(flattenStyle(arena.props.style).position, 'absolute');
    assert.equal(flattenStyle(arena.props.style).overflow, 'hidden');
    assert.ok(findNode(arena, (node) => node.props.testID === 'home-atmospheric-glow'));
    assert.ok(findNode(arena, (node) => node.props.testID === 'home-rink-lines'));

    const nextPanel = findNode(output, (node) => node.props.testID === 'home-next-game-panel');
    assert.ok(nextPanel);
    assert.equal(flattenStyle(nextPanel.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(flattenStyle(nextPanel.props.style).borderColor, 'rgba(125, 190, 255, 0.22)');
    const stageGradient = findNode(nextPanel, (node) => node.props.testID === 'home-stage-glass-gradient');
    assert.ok(stageGradient);
    assert.deepEqual(stageGradient.props.colors, [
      'rgba(12, 27, 49, 0.38)',
      'rgba(7, 17, 31, 0.24)',
    ]);
  });

  it('keeps compact hydrated league, team, and venue identities fully wrappable', async () => {
    const runtime = createRuntime({ width: 320 });
    const output = await renderResolved(runtime);

    const leagueTitle = findNode(output, (node) => node.type === 'Text' && nodeText(node) === league.name);
    assert.ok(leagueTitle);
    assert.ok(flattenStyle(leagueTitle.props.style).fontSize <= 20);

    const matchupTeams = findNode(output, (node) => node.props.testID === 'home-matchup-teams');
    assert.ok(matchupTeams);
    assert.equal(flattenStyle(matchupTeams.props.style).flexDirection, 'column');

    for (const value of [awayTeam.name, userTeam.name, nextGame.location]) {
      const label = findNode(output, (node) => node.type === 'Text' && nodeText(node) === value);
      assert.ok(label, `Missing full compact label: ${value}`);
      assert.equal(label.props.numberOfLines, undefined, `Compact label must wrap without clipping: ${value}`);
    }
  });

  it('lets each compact team row contribute its full wrapped intrinsic height', async () => {
    const runtime = createRuntime({ width: 320 });
    const output = await renderResolved(runtime);
    const matchupTeams = findNode(output, (node) => node.props.testID === 'home-matchup-teams');
    assert.ok(matchupTeams);

    const teamNames = new Set([awayTeam.name, userTeam.name]);
    const teamBlocks = allNodes(matchupTeams).filter((node) => {
      if (node.type !== 'View') return false;
      const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
      return children.some((child) => (
        child
        && typeof child === 'object'
        && 'type' in child
        && (child as TestNode).type === 'Text'
        && teamNames.has(nodeText(child as TestNode))
      ));
    });

    assert.equal(teamBlocks.length, 2);
    for (const block of teamBlocks) {
      const style = flattenStyle(block.props.style);
      assert.equal(style.flex, undefined, 'compact team rows must not retain RNW flex shorthand');
      assert.equal(style.flexGrow, 0);
      assert.equal(style.flexShrink, 0);
      assert.equal(style.flexBasis, 'auto');
    }
  });

  it('opts only Home recent results into the restrained editorial card variant', async () => {
    const runtime = createRuntime();
    const output = await renderResolved(runtime);
    const gameCards = allNodes(output).filter((node) => node.type === 'GameCard');
    assert.equal(gameCards.length, 2);
    assert.ok(gameCards.every((node) => node.props.visualVariant === 'homeEditorial'));
    assert.ok(gameCards.every((node) => node.props.status === 'Final' && node.props.onPress === undefined));
  });

  it('commits each check-in selection and rolls a failed selection back after final rerenders', async () => {
    const runtime = createRuntime({
      updateResults: [{ success: true }, { success: true }, { success: false }],
    });
    await renderResolved(runtime);

    const press = async (label: string) => {
      const button = findNode(runtime.harness.output, (node) => node.props.accessibilityLabel === label);
      assert.ok(button);
      await button.props.onPress();
      runtime.harness.render();
    };
    const isSelected = (label: string) => findNode(
      runtime.harness.output,
      (node) => node.props.accessibilityLabel === label,
    )?.props.accessibilityState?.selected;

    await press('Check in for next game');
    assert.equal(isSelected('Check in for next game'), true);
    assert.match(nodeText(runtime.harness.output), /12 In · 2 Maybe · 0 Out/);

    await press('Mark next game as maybe');
    assert.equal(isSelected('Mark next game as maybe'), true);
    assert.match(nodeText(runtime.harness.output), /11 In · 3 Maybe · 0 Out/);

    await press('Decline next game');
    assert.equal(isSelected('Decline next game'), false);
    assert.equal(isSelected('Mark next game as maybe'), true);
    assert.match(nodeText(runtime.harness.output), /11 In · 3 Maybe · 0 Out/);
    assert.deepEqual(runtime.checkinCalls, [
      ['next-1', 'wolves', 'confirmed'],
      ['next-1', 'wolves', 'tentative'],
      ['next-1', 'wolves', 'out'],
    ]);
  });

  it('announces loading, then preserves data-bearing game, destination, check-in and score actions', async () => {
    const runtime = createRuntime();
    const loading = findNode(runtime.harness.output, (node) => node.props.testID === 'home-loading-panel');
    assert.ok(loading);
    assert.equal(loading.props.accessibilityRole, 'progressbar');
    assert.match(nodeText(loading), /Loading league home/);

    const output = await renderResolved(runtime);
    const nextPanel = findNode(output, (node) => node.props.testID === 'home-next-game-panel');
    assert.ok(nextPanel);
    assert.match(nextPanel.props.accessibilityLabel, /River Otters With A Long Team Name/);
    assert.match(nextPanel.props.accessibilityLabel, /Harbour Wolves With A Long Team Name/);
    assert.match(nextPanel.props.accessibilityLabel, /North Community Forum/);
    assert.match(nextPanel.props.accessibilityLabel, /11 In · 2 Maybe · 0 Out/);

    nextPanel.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Open full schedule')?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Updates, 1 unread')?.props.onPress();
    await findNode(output, (node) => node.props.accessibilityLabel === `Open ${league.name} website`)?.props.onPress();
    findNode(output, (node) => node.props.accessibilityLabel === 'Check in for next game')?.props.onPress();

    assert.deepEqual(runtime.leagueSelections, [league]);
    assert.deepEqual(runtime.navigationCalls, [
      ['Schedule', { screen: 'GamePreview', params: { gameId: 'next-1' } }],
      ['Schedule'],
      ['Profile', { screen: 'NotificationsFeed' }],
    ]);
    assert.deepEqual(runtime.linkCalls, ['https://harbour-hockey.beerleaguehockey.ca']);
    assert.deepEqual(runtime.checkinCalls, [['next-1', 'wolves', 'confirmed']]);

    const gameCards = allNodes(output).filter((node) => node.type === 'GameCard');
    assert.equal(gameCards.length, 2);
    assert.deepEqual(
      gameCards.map((node) => [node.props.awayTeam, node.props.awayScore, node.props.homeTeam, node.props.homeScore]),
      [
        ['New Away', 4, 'New Home', 5],
        ['Old Away', 1, 'Old Home', 2],
      ],
    );
  });

  it('keeps guest matchup navigation while gating member-only actions at compact width', async () => {
    const runtime = createRuntime({ guest: true, width: 320 });
    const output = await renderResolved(runtime);

    assert.equal(findNode(output, (node) => node.props.testID === 'home-quick-actions'), undefined);
    assert.equal(findNode(output, (node) => node.props.accessibilityLabel === 'Check in for next game'), undefined);
    assert.match(nodeText(output), /Join this league to check in/);

    const nextPanel = findNode(output, (node) => node.props.testID === 'home-next-game-panel');
    assert.ok(nextPanel);
    assert.match(nextPanel.props.accessibilityLabel, /Join this league to check in/);
    assert.ok((flattenStyle(nextPanel.props.style).minHeight ?? 0) >= 44);
    nextPanel.props.onPress();
    assert.deepEqual(runtime.navigationCalls, [
      ['Schedule', { screen: 'GamePreview', params: { gameId: 'next-1' } }],
    ]);
    assert.deepEqual(runtime.checkinCalls, []);
  });
});
