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

type League = { id: string; name: string; slug: string };

const league: League = {
  id: 'league-1',
  name: 'Harbour City Thursday Night Hockey League',
  slug: 'harbour-city-thursday',
};

const native = {
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: {
    create: <T>(styles: T) => styles,
    absoluteFill: { position: 'absolute', inset: 0 },
    absoluteFillObject: { position: 'absolute', inset: 0 },
    hairlineWidth: 1,
  },
};

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function makeScreen({
  activeLeague = league as League | null,
  width = 320,
  reduceTransparency = true,
  reduceMotion = true,
  isGuestLeague = false,
} = {}) {
  const harness = createHookHarness();
  const navigationCalls: unknown[][] = [];
  const marketplaceCalls: Record<string, unknown>[] = [];

  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null }),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'player-1' } } }) },
    from: () => chain,
  };

  const passthrough = ({ children, ...props }: Record<string, unknown>) =>
    createElement('RevealView', props, children);

  const HomeScreen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/HomeScreen.tsx', import.meta.url),
    {
      react: { ...harness.react, useEffect: () => {} },
      'react-native': { ...native, useWindowDimensions: () => ({ width, height: 700 }) },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: () => {} },
      'expo-linking': { openURL: async () => {} },
      '../../assets/blh-logo.png': 'blh-logo.png',
      '../components/BrandAtmosphere': (props: Record<string, unknown>) => createElement('BrandAtmosphere', props),
      '../components/GameCard': (props: Record<string, unknown>) => createElement('GameCard', props),
      '../components/GuestBanner': () => createElement('GuestBanner', null),
      '../components/LeagueMarketplace': (props: Record<string, unknown>) => {
        marketplaceCalls.push(props);
        return createElement('LeagueMarketplace', props);
      },
      '../components/QuickCheckinActions': () => null,
      '../components/RevealView': passthrough,
      '../components/ScheduleConflictList': () => null,
      '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/AccessibilityPreferencesContext': {
        useAccessibilityPreferences: () => ({ reduceTransparency, reduceMotion }),
      },
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague,
          activeTheme: {
            primaryColor: '#34D399',
            secondaryColor: '#0A1628',
            backgroundColor: '#001122',
            textColor: '#F8FBFF',
          },
          availableLeagues: activeLeague ? [activeLeague] : [],
          isGuestLeague,
          setActiveLeague: async () => {},
        }),
      },
      '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
      '../lib/supabase/checkins': {
        getGameCheckinSummary: async () => ({ confirmed: [], tentative: [], out: [] }),
        getMyCheckins: async () => ({}),
        getMyCheckinsForTeams: async () => ({}),
        updateCheckin: async () => ({ success: true }),
      },
      '../lib/supabase/client': { supabase },
      '../lib/supabase/data': {
        getLeagueGames: async () => [],
        mapGameStatus: (status: string) => status === 'completed' ? 'Final' : 'Upcoming',
      },
      '../theme/colors': {
        default: {
          primary: '#22D3EE', bgBase: '#07111F', bgSurface: 'rgba(12,27,49,.72)',
          bgInteractive: 'rgba(28,42,66,.84)', textPrimary: '#F8FBFF', textSecondary: '#A9B8CC',
          textOnPrimary: '#02111B', glassStroke: 'rgba(255,255,255,.12)',
          glassStrokeStrong: 'rgba(96,165,250,.28)', glassHighlight: 'rgba(255,255,255,.08)',
          brandRink: '#22D3EE', borderCard: 'rgba(255,255,255,.1)', accentGreen: '#22C55E',
          accentRed: '#EF4444', bgElevated: '#0A1628',
        },
      },
      '../theme/ui': {
        ui: { minTouchTarget: 44, radius: { card: 18, panel: 24 } },
        getSurfacePalette: () => ({ surface: '#OLD-SURFACE', stroke: '#OLD-STROKE' }),
      },
    },
  ).default;

  const output = harness.mount(() => HomeScreen({
    navigation: { navigate: (...args: unknown[]) => navigationCalls.push(args) },
  }));

  return { harness, marketplaceCalls, navigationCalls, output };
}

describe('Home editorial native render', () => {
  it('renders the compact opaque Home stage with native target and motion guarantees', () => {
    const { output } = makeScreen();
    const nodes = allNodes(output);

    const safeArea = findNode(output, (node) => node.type === 'SafeAreaView');
    assert.ok(safeArea);
    assert.equal(flattenStyle(safeArea.props.style).backgroundColor, '#07111F');

    const header = findNode(output, (node) => node.props.testID === 'home-editorial-header');
    assert.ok(header);
    assert.match(nodeText(header), /LEAGUE HOME/);
    assert.match(nodeText(header), /Harbour City Thursday Night Hockey League/);

    const quickActions = findNode(output, (node) => node.props.testID === 'home-quick-actions');
    assert.ok(quickActions);
    assert.equal(flattenStyle(quickActions.props.style).flexDirection, 'column');

    for (const label of ['Updates', 'Open full schedule', `Open ${league.name} website`]) {
      const target = findNode(output, (node) => node.props.accessibilityLabel === label);
      assert.ok(target, `Missing target: ${label}`);
      const style = flattenStyle(target.props.style);
      assert.ok((style.minHeight ?? style.height) >= 44, `${label} must be at least 44 points tall`);
      assert.equal(style.backgroundColor, '#0C1B31');
      assert.equal(style.borderColor, '#41607F');
    }

    const reveals = nodes.filter((node) => node.type === 'RevealView');
    assert.ok(reveals.length >= 2);
    assert.ok(reveals.every((node) => node.props.duration === 0));
    assert.equal(nodes.some((node) => node.props.testID === 'home-atmospheric-glow'), false);

    const emptyPanel = findNode(output, (node) => node.props.testID === 'home-empty-game-panel');
    assert.ok(emptyPanel);
    assert.equal(flattenStyle(emptyPanel.props.style).backgroundColor, '#0C1B31');
  });

  it('preserves the exact no-active-league marketplace return contract', () => {
    const { output, marketplaceCalls } = makeScreen({ activeLeague: null });
    assert.equal((output as TestNode).type, 'LeagueMarketplace');
    assert.ok(marketplaceCalls.length >= 1);
    assert.deepEqual(
      {
        title: marketplaceCalls[0].title,
        subtitle: marketplaceCalls[0].subtitle,
        showJoinedLeagues: marketplaceCalls[0].showJoinedLeagues,
        includeTopInset: marketplaceCalls[0].includeTopInset,
      },
      {
        title: 'BLH Overview',
        subtitle: 'Nearby leagues, fit, and difficulty across Beer League Hockey.',
        showJoinedLeagues: true,
        includeTopInset: false,
      },
    );
  });
});
