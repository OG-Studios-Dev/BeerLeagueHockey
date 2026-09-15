import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness.ts';

type NodeLike = {
  type: unknown;
  props: Record<string, unknown> & {
    component?: (props: Record<string, unknown>) => unknown;
    name?: unknown;
  };
};

function nodes(root: unknown): NodeLike[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as NodeLike;
  return [node, ...nodes(node.props.children)];
}

describe('full App mobile dock composition', () => {
  it('keeps contrasting route content as the full scene behind a transparent overlay dock', () => {
    const harness = createHookHarness();
    let reportedDockHeight: number | undefined;
    const passthrough = ({ children }: { children?: unknown }) => children ?? null;
    const dockHeightContext = {
      current: (height: number) => { reportedDockHeight = height; },
    };
    const MobileWebDock = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/navigation/MobileWebDock.tsx', import.meta.url),
      {
        react: harness.react,
        '@react-navigation/bottom-tabs': { BottomTabBarHeightCallbackContext: dockHeightContext },
        '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
        'expo-linear-gradient': { LinearGradient: (props: Record<string, unknown>) => createElement('LinearGradient', props) },
        'react-native': {
          ActivityIndicator: 'ActivityIndicator',
          Animated: {
            Value: class { stopAnimation() {} setValue() {} interpolate() { return this; } },
            View: 'AnimatedView',
            spring: () => ({ start: (done: (value: { finished: boolean }) => void) => done({ finished: true }) }),
            timing: () => ({ start: (done: (value: { finished: boolean }) => void) => done({ finished: true }) }),
          },
          Keyboard: { addListener: () => ({ remove() {} }) },
          Linking: { openURL: async () => undefined },
          Modal: 'Modal', Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
          StyleSheet: { create: <T>(value: T) => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
          useWindowDimensions: () => ({ width: 390, height: 844 }),
        },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
        '../components/LeagueLogo': 'LeagueLogo',
        '../components/TeamLogo': 'TeamLogo',
        '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true, reduceTransparency: false }) },
        '../context/AuthContext': { useAuth: () => ({ user: { id: 'member-a' }, isGuest: false }) },
        '../context/FocusPauseContext': { useFocusPauseLease: () => undefined },
        '../context/LeagueContext': {
          useLeague: () => ({
            activeLeague: { id: 'league-a', name: 'League A', slug: 'league-a', logoUrl: null },
            activeTheme: { primaryColor: '#00ffff', secondaryColor: '#ff00ff' },
            isGuestLeague: false,
          }),
        },
        '../theme/colors': { default: { primary: '#0ff', brandArena: '#f0f', textSecondary: '#aaa', textPrimary: '#fff' } },
        './useMobileDockData': {
          useMobileDockData: () => ({
            identityKey: 'member-a:league-a', isLoading: false, hasError: false, websiteStatus: 'ready', seasonId: 'season-a',
            isPlayoffs: false, registrationOpen: false, visiblePages: {}, customNavItems: [], team: null, retry: () => undefined,
          }),
        },
      },
    ).default;

    const ContrastingPage = () => createElement(
      'ScrollView',
      { testID: 'contrasting-route-content', style: { flex: 1 } },
      createElement('View', { testID: 'route-content-top', style: { height: 640, backgroundColor: '#F43F5E' } }, 'top'),
      createElement('View', { testID: 'route-content-bottom', style: { height: 320, backgroundColor: '#22C55E' } }, 'bottom'),
    );
    const descriptor = (props: Record<string, unknown>) => createElement('ScreenDescriptor', props);
    const stackFactory = () => ({
      Screen: descriptor,
      Navigator: ({ children }: { children?: unknown }) => {
        const screens = nodes(children).filter((node) => node.type === 'ScreenDescriptor');
        const selected = screens.find((node) => node.props.name === 'Main') ?? screens[0];
        return selected?.props.component ? selected.props.component(selected.props) : null;
      },
    });
    const tabFactory = () => ({
      Screen: descriptor,
      Navigator: ({ children, tabBar }: { children?: unknown; tabBar: (props: Record<string, unknown>) => unknown }) => {
        const screens = nodes(children).filter((node) => node.type === 'ScreenDescriptor');
        const state = {
          index: 0,
          routes: screens.map((screen, index) => ({ key: `${String(screen.props.name)}-${index}`, name: screen.props.name })),
        };
        const scene = screens[0]?.props.component ? screens[0].props.component(screens[0].props) : null;
        return createElement(
          'TabLayout',
          { testID: 'full-app-tab-layout', style: { flex: 1 } },
          createElement('SceneContainer', { testID: 'full-app-scene', style: { flex: 1 } }, scene),
          tabBar({ state, descriptors: {}, navigation: { navigate() {}, emit: () => ({ defaultPrevented: false, preventDefault() {} }) }, insets: {} }),
        );
      },
    });
    const screenModule = { __esModule: true, default: ContrastingPage };
    const rootMocks = new Proxy<Record<string, unknown>>({}, {
      has: () => true,
      get: (_target, id: string) => {
        if (id === 'react') return harness.react;
        if (id === 'react-native') return { StyleSheet: { create: <T>(value: T) => value }, View: 'View' };
        if (id === '@react-navigation/bottom-tabs') return { createBottomTabNavigator: tabFactory };
        if (id === '@react-navigation/native-stack') return { createNativeStackNavigator: stackFactory };
        if (id === '../context/AuthContext') return { useAuth: () => ({ isGuest: false }) };
        if (id === '../context/LeagueContext') return { useLeague: () => ({ activeTheme: { backgroundColor: '#07111F' } }) };
        if (id === '../context/FocusPauseContext') return { FocusPauseProvider: passthrough };
        if (id === './MobileWebDock') return { __esModule: true, default: MobileWebDock };
        if (id === './GuestBannerLayout') return { __esModule: true, default: passthrough };
        if (id === '../theme/colors') return { __esModule: true, default: { bgBase: '#07111F' } };
        return screenModule;
      },
    });
    const RootNavigation = compileCommonJs<{ default: () => unknown }>(new URL('../../src/navigation/index.tsx', import.meta.url), rootMocks).default;

    const appMocks = new Proxy<Record<string, unknown>>({}, {
      has: () => true,
      get: (_target, id: string) => {
        if (id === 'react') return harness.react;
        if (id === '@react-navigation/native') return {
          NavigationContainer: ({ children, ...props }: Record<string, unknown>) => createElement('NavigationContainer', props, children),
          DarkTheme: { dark: true, colors: {}, fonts: {} },
        };
        if (id === '@react-navigation/native-stack') return { createNativeStackNavigator: stackFactory };
        if (id === 'react-native') return { ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: <T>(value: T) => value }, View: 'View' };
        if (id === 'react-native-safe-area-context') return { SafeAreaProvider: passthrough };
        if (id === './src/context/AuthContext') return { AuthProvider: passthrough, useAuth: () => ({ session: { user: { id: 'member-a' } }, isLoading: false, isGuest: false }) };
        if (id === './src/context/LeagueContext') return { LeagueProvider: passthrough, useLeague: () => ({ membershipDiagnostics: null, membershipStatus: 'ready', retryMemberships: () => undefined }) };
        if (id === './src/context/AccessibilityPreferencesContext') return { AccessibilityPreferencesProvider: passthrough };
        if (id === './src/navigation') return { __esModule: true, default: RootNavigation };
        return screenModule;
      },
    });
    const App = compileCommonJs<{ default: () => unknown }>(new URL('../../App.tsx', import.meta.url), appMocks).default;

    harness.mount(App);
    assert.ok(findNode(harness.output, (node) => node.type === 'NavigationContainer'));
    const scene = findNode(harness.output, (node) => node.props.testID === 'full-app-scene');
    const page = findNode(scene, (node) => node.props.testID === 'contrasting-route-content');
    assert.equal(flattenStyle(scene?.props.style).flex, 1);
    assert.equal(flattenStyle(page?.props.style).flex, 1);
    assert.equal(flattenStyle(findNode(page, (node) => node.props.testID === 'route-content-top')?.props.style).backgroundColor, '#F43F5E');
    assert.equal(flattenStyle(findNode(page, (node) => node.props.testID === 'route-content-bottom')?.props.style).backgroundColor, '#22C55E');
    assert.equal(nodeText(page), 'topbottom');

    const dock = findNode(harness.output, (node) => node.props.testID === 'mobile-web-dock');
    const dockStyle = flattenStyle(dock?.props.style);
    assert.equal(dockStyle.position, 'absolute', 'the dock must overlay instead of shortening the full-height scene');
    assert.equal(dockStyle.backgroundColor, 'transparent');
    dock?.props.onLayout({ nativeEvent: { layout: { height: 158 } } });
    assert.equal(reportedDockHeight, 158);
  });
});
