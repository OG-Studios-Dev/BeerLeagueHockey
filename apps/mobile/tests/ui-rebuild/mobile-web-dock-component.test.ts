import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

type DockState = {
  identityKey: string;
  isLoading: boolean;
  hasError: boolean;
  websiteStatus: 'idle' | 'loading' | 'ready' | 'error';
  seasonId: string | null;
  isPlayoffs: boolean;
  registrationOpen: boolean;
  visiblePages?: Record<string, boolean>;
  customNavItems: any[];
  team: any;
  retry: () => void;
};

const stateRouteNames = ['Home', 'Standings', 'Schedule', 'Discover', 'Stats', 'Team', 'Captain', 'Profile'];

function createDockFixture(initialData: Partial<DockState> = {}, options: { reduceMotion?: boolean; deferAnimations?: boolean } = {}) {
  const harness = createHookHarness();
  let retryCount = 0;
  let activeLeague: any = { id: 'league-a', name: 'League A', slug: 'league-a', logoUrl: null };
  let data: DockState = {
    identityKey: 'guest:league-a', isLoading: false, hasError: false, websiteStatus: 'ready',
    seasonId: null, isPlayoffs: false, registrationOpen: false, visiblePages: undefined,
    customNavItems: [], team: null, retry: () => { retryCount += 1; }, ...initialData,
  };
  const openedUrls: string[] = [];
  const keyboardListeners = new Map<string, Set<() => void>>();
  const animationCompletions: Array<(result: { finished: boolean }) => void> = [];
  let animationStops = 0;
  class AnimatedValue {
    value: number;
    constructor(value: number) { this.value = value; }
    stopAnimation() { animationStops += 1; }
    setValue(value: number) { this.value = value; }
    interpolate() { return this; }
  }
  const immediateAnimation = (_value: unknown, config: { toValue: number }) => ({
    start: (complete: (result: { finished: boolean }) => void) => {
      if (options.deferAnimations) animationCompletions.push(complete);
      else complete({ finished: true });
    },
  });
  const MobileWebDock = compileCommonJs<{ default: (props: Record<string, any>) => unknown }>(
    new URL('../../src/navigation/MobileWebDock.tsx', import.meta.url),
    {
      react: harness.react,
      '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
      'expo-linear-gradient': { LinearGradient: (props: Record<string, unknown>) => createElement('LinearGradient', props, props.children) },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        Animated: { Value: AnimatedValue, View: 'AnimatedView', Image: 'AnimatedImage', spring: immediateAnimation, timing: immediateAnimation },
        Keyboard: {
          addListener: (event: string, listener: () => void) => {
            const listeners = keyboardListeners.get(event) ?? new Set();
            listeners.add(listener);
            keyboardListeners.set(event, listeners);
            return { remove: () => listeners.delete(listener) };
          },
        },
        Platform: { OS: 'ios' },
        Linking: { openURL: async (url: string) => { openedUrls.push(url); } },
        Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(value: T) => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
      },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: options.reduceMotion ?? true, reduceTransparency: false }) },
      '../context/AuthContext': { useAuth: () => ({ user: null, isGuest: true }) },
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague,
          activeTheme: { primaryColor: '#00ffff', secondaryColor: '#ff00ff' },
          isGuestLeague: true,
        }),
      },
      '../theme/colors': { default: { primary: '#0ff', brandArena: '#f0f', textSecondary: '#aaa', tabInactive: '#999', textPrimary: '#fff' } },
      './useMobileDockData': { useMobileDockData: () => data },
    },
  ).default;
  const navigationCalls: unknown[][] = [];
  const emittedEvents: Array<Record<string, any>> = [];
  let preventNextTabPress = false;
  const navigation = {
    navigate: (...args: unknown[]) => navigationCalls.push(args),
    emit: (input: Record<string, unknown>) => {
      const event = {
        ...input,
        defaultPrevented: preventNextTabPress,
        preventDefault() { event.defaultPrevented = true; },
      };
      preventNextTabPress = false;
      emittedEvents.push(event);
      return event;
    },
  };
  const state = {
    index: 2,
    routes: [
      { key: 'Home-key', name: 'Home' },
      { key: 'Standings-key', name: 'Standings' },
      { key: 'Schedule-key', name: 'Schedule' },
      { key: 'Discover-key', name: 'Discover' },
      { key: 'Stats-key', name: 'Stats' },
      { key: 'Team-key', name: 'Team' },
      { key: 'Captain-key', name: 'Captain' },
      { key: 'Profile-key', name: 'Profile' },
    ],
  };
  const mount = () => harness.mount(() => MobileWebDock({ state, navigation, descriptors: {}, insets: {} }));
  const openMore = () => {
    findNode(harness.output, (node) => node.props.testID === 'dock-more')!.props.onPress();
    harness.render();
  };
  return {
    harness, mount, openMore, navigationCalls, emittedEvents, openedUrls,
    retryCount: () => retryCount,
    emitKeyboard: (event: string) => {
      keyboardListeners.get(event)?.forEach((listener) => listener());
      harness.render();
    },
    keyboardListenerCount: () => [...keyboardListeners.values()].reduce((count, listeners) => count + listeners.size, 0),
    finishNextAnimation: (finished = true) => { animationCompletions.shift()?.({ finished }); harness.render(); },
    animationStops: () => animationStops,
    preventNextTabPress: () => { preventNextTabPress = true; },
    setFocusedRoute: (name: string, leafName?: string) => {
      state.index = state.routes.findIndex((route) => route.name === name);
      const route = state.routes[state.index] as any;
      route.state = leafName ? { index: 1, routes: [{ key: `${name}-root`, name: `${name}Root` }, { key: `${leafName}-key`, name: leafName }] } : undefined;
      harness.render();
    },
    setData: (next: Partial<DockState>) => { data = { ...data, ...next }; harness.render(); },
    setLeague: (next: any) => { activeLeague = next; harness.render(); },
  };
}

describe('MobileWebDock component integration', () => {
  it('renders the enlarged crest in a dedicated center column without visible Team text', () => {
    const fixture = createDockFixture({
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456' },
    });
    fixture.mount();

    const teamControl = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-team');
    const crest = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-team-crest');
    const logo = findNode(crest, (node) => node.type === 'TeamLogo');
    const surface = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-surface');

    assert.equal(teamControl?.props.accessibilityLabel, 'Team, Team A');
    const teamStyle = flattenStyle(teamControl?.props.style({ pressed: false }));
    assert.deepEqual(
      {
        flexGrow: teamStyle.flexGrow,
        flexShrink: teamStyle.flexShrink,
        flexBasis: teamStyle.flexBasis,
        width: teamStyle.width,
        minWidth: teamStyle.minWidth,
        maxWidth: teamStyle.maxWidth,
      },
      { flexGrow: 0, flexShrink: 0, flexBasis: 120, width: 120, minWidth: 120, maxWidth: 120 },
    );
    assert.equal(flattenStyle(crest?.props.style).width, 112.5);
    assert.equal(logo?.props.size, 102.5);
    assert.equal(logo?.props.transparentBacking, true);
    assert.doesNotMatch(nodeText(teamControl), /Team/);
    assert.equal(crest?.props.pointerEvents, 'none');
    assert.equal(surface?.props.accessibilityLabel, 'Primary navigation');
  });

  it('cancels deferred More actions on route/leaf changes and on unmount', () => {
    const routeFixture = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    routeFixture.mount();
    routeFixture.openMore();
    routeFixture.finishNextAnimation();
    findNode(routeFixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    routeFixture.setFocusedRoute('Schedule', 'GamePreview');
    routeFixture.finishNextAnimation();
    assert.deepEqual(routeFixture.openedUrls, []);
    assert.equal(findNode(routeFixture.harness.output, (node) => node.type === 'Modal')?.props.visible, false);

    const identityFixture = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    identityFixture.mount();
    identityFixture.openMore();
    identityFixture.finishNextAnimation();
    findNode(identityFixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    identityFixture.setLeague({ id: 'league-b', name: 'League B', slug: 'league-b', logoUrl: null });
    identityFixture.finishNextAnimation();
    assert.deepEqual(identityFixture.openedUrls, []);

    const unmountFixture = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    unmountFixture.mount();
    unmountFixture.openMore();
    unmountFixture.finishNextAnimation();
    findNode(unmountFixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    const updatesBeforeCleanup = unmountFixture.harness.stateUpdateCount;
    const stopsBeforeCleanup = unmountFixture.animationStops();
    unmountFixture.harness.unmount();
    unmountFixture.finishNextAnimation();
    assert.deepEqual(unmountFixture.openedUrls, []);
    assert.equal(unmountFixture.harness.stateUpdateCount, updatesBeforeCleanup);
    assert.ok(unmountFixture.animationStops() > stopsBeforeCleanup);
  });

  it('cancels a pending More action when the keyboard takes over', () => {
    const fixture = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    fixture.mount();
    fixture.openMore();
    fixture.finishNextAnimation();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    fixture.emitKeyboard('keyboardWillShow');
    fixture.finishNextAnimation();
    assert.deepEqual(fixture.openedUrls, []);
    assert.equal(fixture.harness.output, null);
    fixture.emitKeyboard('keyboardWillHide');
    assert.ok(findNode(fixture.harness.output, (node) => node.props.testID === 'mobile-web-dock'));
  });

  it('runs reduced-motion actions immediately but keeps regular close mounted until completion', () => {
    const reduced = createDockFixture({}, { reduceMotion: true });
    reduced.mount();
    reduced.openMore();
    findNode(reduced.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    assert.deepEqual(reduced.openedUrls, ['https://league-a.beerleaguehockey.ca/teams']);

    const regular = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    regular.mount();
    regular.openMore();
    regular.finishNextAnimation();
    findNode(regular.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    assert.equal(findNode(regular.harness.output, (node) => node.type === 'Modal')?.props.visible, true);
    assert.deepEqual(regular.openedUrls, []);
    regular.finishNextAnimation();
    assert.deepEqual(regular.openedUrls, ['https://league-a.beerleaguehockey.ca/teams']);
  });

  it('emits preventable tabPress events with route keys and preserves nested stack reselects', () => {
    const fixture = createDockFixture({
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456' },
    });
    fixture.mount();

    fixture.setFocusedRoute('Schedule', 'GamePreview');
    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-schedule')!.props.onPress();
    assert.deepEqual(
      { type: fixture.emittedEvents.at(-1)?.type, target: fixture.emittedEvents.at(-1)?.target, canPreventDefault: fixture.emittedEvents.at(-1)?.canPreventDefault },
      { type: 'tabPress', target: 'Schedule-key', canPreventDefault: true },
    );
    assert.equal(fixture.navigationCalls.length, 0);

    fixture.setFocusedRoute('Stats', 'CareerStats');
    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-stats')!.props.onPress();
    assert.equal(fixture.emittedEvents.at(-1)?.target, 'Stats-key');
    assert.equal(fixture.navigationCalls.length, 0);

    fixture.preventNextTabPress();
    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-standings')!.props.onPress();
    assert.equal(fixture.emittedEvents.at(-1)?.defaultPrevented, true);
    assert.equal(fixture.navigationCalls.length, 0);

    fixture.setFocusedRoute('Team', 'TeamChat');
    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-team')!.props.onPress();
    assert.equal(fixture.emittedEvents.at(-1)?.target, 'Team-key');
    assert.equal(fixture.emittedEvents.at(-1)?.defaultPrevented, true);
    assert.deepEqual(fixture.navigationCalls.at(-1), [
      'Team',
      { screen: 'TeamDetail', params: { teamId: 'team-a', leagueId: 'league-a' } },
    ]);

    const eventCount = fixture.emittedEvents.length;
    fixture.openMore();
    assert.equal(fixture.emittedEvents.length, eventCount);
    assert.ok(fixture.navigationCalls.every((call) => stateRouteNames.includes(String(call[0]))));
  });

  it('hides and restores the custom dock with public keyboard events and cleans up listeners', () => {
    const fixture = createDockFixture();
    fixture.mount();
    assert.ok(findNode(fixture.harness.output, (node) => node.props.testID === 'mobile-web-dock'));
    assert.equal(fixture.keyboardListenerCount(), 2);

    fixture.emitKeyboard('keyboardWillShow');
    assert.equal(fixture.harness.output, null);
    fixture.emitKeyboard('keyboardWillHide');
    assert.ok(findNode(fixture.harness.output, (node) => node.props.testID === 'mobile-web-dock'));

    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-standings')!.props.onPress();
    assert.deepEqual(fixture.navigationCalls.at(-1), ['Standings']);
    fixture.harness.unmount();
    assert.equal(fixture.keyboardListenerCount(), 0);
  });

  it('shows safe native choices while website metadata is delayed', () => {
    const fixture = createDockFixture({ isLoading: true, websiteStatus: 'loading' });
    fixture.mount();
    fixture.openMore();
    const text = nodeText(fixture.harness.output);

    assert.match(text, /Loading league navigation/);
    assert.match(text, /Home/);
    assert.match(text, /Discover Leagues/);
    assert.match(text, /Account/);
    assert.doesNotMatch(text, /Teams/);
    assert.doesNotMatch(text, /News/);
  });

  it('shows an honest metadata error and provides a working Retry action', () => {
    const fixture = createDockFixture({ hasError: true, websiteStatus: 'error' });
    fixture.mount();
    fixture.openMore();
    assert.match(nodeText(fixture.harness.output), /League navigation unavailable/);
    assert.doesNotMatch(nodeText(fixture.harness.output), /Teams/);

    const retry = findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Retry league navigation');
    assert.ok(retry);
    retry.props.onPress();
    assert.equal(fixture.retryCount(), 1);
  });

  it('defaults absent optional visibility flags only after metadata succeeds', () => {
    const fixture = createDockFixture({ websiteStatus: 'ready', visiblePages: undefined });
    fixture.mount();
    fixture.openMore();
    assert.match(nodeText(fixture.harness.output), /Teams/);
    assert.match(nodeText(fixture.harness.output), /News/);
    assert.equal(findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')?.props.accessibilityRole, 'link');

    fixture.setData({ visiblePages: { news: false }, customNavItems: [{ label: 'Rules', isCustomPage: true, pageSlug: 'rules' }] });
    assert.doesNotMatch(nodeText(fixture.harness.output), /News/);
    assert.match(nodeText(fixture.harness.output), /Rules/);
  });

  it('does not retain successful tenant choices while a new tenant is unresolved', () => {
    const fixture = createDockFixture({ websiteStatus: 'ready', customNavItems: [{ label: 'League A Rules', isCustomPage: true, pageSlug: 'rules' }] });
    fixture.mount();
    fixture.openMore();
    assert.match(nodeText(fixture.harness.output), /League A Rules/);

    fixture.setLeague({ id: 'league-b', name: 'League B', slug: 'league-b', logoUrl: null });
    fixture.setData({ identityKey: 'guest:league-b', isLoading: true, websiteStatus: 'loading', customNavItems: [] });
    fixture.openMore();
    assert.doesNotMatch(nodeText(fixture.harness.output), /League A Rules/);
    assert.doesNotMatch(nodeText(fixture.harness.output), /Teams/);
  });
});
