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

const stateRouteNames = ['Home', 'Standings', 'Schedule', 'Stats', 'Team', 'Captain', 'Profile', 'LeaguePages'];

function createDockFixture(initialData: Partial<DockState> = {}, options: { reduceMotion?: boolean; deferAnimations?: boolean; member?: boolean; failLinks?: boolean } = {}) {
  const harness = createHookHarness();
  let retryCount = 0;
  let reportedDockHeight: number | undefined;
  let activeLeague: any = { id: 'league-a', name: 'League A', slug: 'league-a', logoUrl: null };
  let data: DockState = {
    identityKey: 'guest:league-a', isLoading: false, hasError: false, websiteStatus: 'ready',
    seasonId: null, isPlayoffs: false, registrationOpen: false, visiblePages: undefined,
    customNavItems: [], team: null, retry: () => { retryCount += 1; }, ...initialData,
  };
  const openedUrls: string[] = [];
  const publicLinkCalls: string[] = [];
  const alerts: Array<{ title: string; message?: string }> = [];
  const keyboardListeners = new Map<string, Set<() => void>>();
  const animationCompletions: Array<(result: { finished: boolean }) => void> = [];
  let animationStops = 0;
  const focusPauseStates: boolean[] = [];
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
      '@react-navigation/bottom-tabs': {
        BottomTabBarHeightCallbackContext: { current: (height: number) => { reportedDockHeight = height; } },
      },
      '@expo/vector-icons': { Ionicons: (props: Record<string, unknown>) => createElement('Ionicons', props) },
      'expo-linear-gradient': { LinearGradient: (props: Record<string, unknown>) => createElement('LinearGradient', props, props.children) },
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: (title: string, message?: string) => alerts.push({ title, message }) },
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
        Linking: { openURL: async (url: string) => { openedUrls.push(url); if (options.failLinks) throw new Error('synthetic open failure'); } },
        Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
        StyleSheet: { create: <T>(value: T) => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
      },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
      '../components/LeagueLogo': (props: Record<string, unknown>) => createElement('LeagueLogo', props),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: options.reduceMotion ?? true, reduceTransparency: false }) },
      '../context/AuthContext': { useAuth: () => ({ user: options.member ? { id: 'user-a' } : null, isGuest: !options.member }) },
      '../context/LeagueContext': {
        useLeague: () => ({
          activeLeague,
          activeTheme: { primaryColor: '#00ffff', secondaryColor: '#ff00ff' },
          isGuestLeague: !options.member,
        }),
      },
      '../context/FocusPauseContext': { useFocusPauseLease: (active: boolean) => { focusPauseStates.push(active); } },
      '../lib/publicLinks': {
        isApprovedPublicLink: (url: string) => [
          'https://hockey-life.beerleaguehockey.ca/contact',
          'https://beerleaguehockey.ca/privacy',
          'https://beerleaguehockey.ca/terms',
        ].includes(url),
        openPublicLink: async (url: string, opener: (value: string) => Promise<unknown>) => {
          publicLinkCalls.push(url);
          try { await opener(url); return { success: true }; }
          catch { return { success: false, error: 'This link could not be opened. Please try again.' }; }
        },
      },
      '../theme/colors': { default: { primary: '#0ff', brandArena: '#f0f', textSecondary: '#aaa', tabInactive: '#999', textPrimary: '#fff' } },
      './MobileShellDataContext': { useMobileShellData: () => data },
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
    harness, mount, openMore, navigationCalls, emittedEvents, openedUrls, publicLinkCalls, alerts, focusPauseStates,
    retryCount: () => retryCount,
    reportedDockHeight: () => reportedDockHeight,
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
  it('holds the global focus pause for the full mounted More lifecycle, including reopen and route reset', () => {
    const fixture = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    fixture.mount();
    assert.equal(fixture.focusPauseStates.at(-1), false);
    fixture.openMore();
    assert.equal(fixture.focusPauseStates.at(-1), true);
    fixture.finishNextAnimation();
    findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Close more menu')!.props.onPress();
    assert.equal(fixture.focusPauseStates.at(-1), true, 'close animation retains the lease');
    fixture.openMore();
    fixture.finishNextAnimation();
    assert.equal(fixture.focusPauseStates.at(-1), true, 'stale close completion does not unpause reopened More');
    fixture.setFocusedRoute('Stats');
    assert.equal(fixture.focusPauseStates.at(-1), false, 'route reset releases the overlay pause');
  });

  it('renders the expanded More panel as a league-first, bottom-attached row directory', () => {
    const fixture = createDockFixture({
      isPlayoffs: true,
      registrationOpen: true,
      visiblePages: { register: true },
      customNavItems: [{ label: 'Tournament rules and player eligibility', href: 'https://example.com/rules', isExternal: true }],
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456', leadership_role: 'captain' },
    }, { member: true });
    fixture.mount();
    fixture.openMore();

    const sheet = findNode(fixture.harness.output, (node) => node.props.testID === 'more-sheet');
    const sheetStyle = flattenStyle(sheet?.props.style);
    assert.equal(sheetStyle.width, '100%');
    assert.equal(sheetStyle.marginBottom, 0);
    assert.equal(sheetStyle.borderTopLeftRadius, 24);
    assert.equal(sheetStyle.borderBottomLeftRadius, 0);
    assert.equal(sheetStyle.backgroundColor, '#0B192B');
    assert.deepEqual(sheetStyle.transform, []);

    const panelText = nodeText(sheet);
    const groupLabels = ['League', 'Your account', 'Team tools', 'Links'];
    assert.ok(groupLabels.every((label) => panelText.includes(label)));
    for (let index = 1; index < groupLabels.length; index += 1) {
      assert.ok(panelText.indexOf(groupLabels[index - 1]) < panelText.indexOf(groupLabels[index]));
    }
    assert.match(panelText, /^MoreLeague AHomeLeague/);
    assert.doesNotMatch(panelText, /LEAGUE NAVIGATION|Every page, one smooth move away/);

    const teams = findNode(sheet, (node) => node.props.testID === 'more-item-league-teams');
    const teamsStyle = flattenStyle(teams?.props.style({ pressed: false }));
    assert.equal(teamsStyle.minHeight, 56);
    assert.equal(teamsStyle.width, '100%');
    assert.equal(teamsStyle.flexDirection, 'row');
    const teamsLabel = findNode(teams, (node) => node.type === 'Text' && nodeText(node) === 'Teams');
    const labelStyle = flattenStyle(teamsLabel?.props.style);
    assert.equal(labelStyle.fontSize, 16);
    assert.ok(['600', '700'].includes(String(labelStyle.fontWeight)));
    assert.equal(teamsLabel?.props.numberOfLines, undefined);
  });

  it('offers the active Hockey Life identity as a guarded Home target without league switching', () => {
    const fixture = createDockFixture({}, { reduceMotion: true });
    fixture.mount();
    fixture.openMore();

    const leagueHome = findNode(fixture.harness.output, (node) => node.props.testID === 'more-league-home');
    const logo = findNode(leagueHome, (node) => node.type === 'LeagueLogo');
    assert.equal(leagueHome?.props.accessibilityLabel, 'League A home');
    assert.equal(logo?.props.logoUrl, null);
    assert.equal(logo?.props.leagueName, 'League A');
    assert.match(nodeText(leagueHome), /League AHome/);

    leagueHome!.props.onPress();
    assert.deepEqual(fixture.navigationCalls, [['Home']]);

    fixture.openMore();
    assert.equal(findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Switch league'), undefined);
  });

  it('overlays the full scene, reports its measured inset, and clips paint to the capsule only', () => {
    const fixture = createDockFixture();
    fixture.mount();
    const outer = findNode(fixture.harness.output, (node) => node.props.testID === 'mobile-web-dock');
    const surface = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-surface');
    const surfaceFill = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-surface-fill');
    const outerStyle = flattenStyle(outer?.props.style);
    const surfaceStyle = flattenStyle(surface?.props.style);
    const fillStyle = flattenStyle(surfaceFill?.props.style);

    assert.equal(outerStyle.position, 'absolute');
    assert.equal(outerStyle.left, 0);
    assert.equal(outerStyle.right, 0);
    assert.equal(outerStyle.bottom, 0);
    assert.equal(outerStyle.backgroundColor, 'transparent');
    assert.equal(surfaceStyle.backgroundColor, '#080F1C');
    assert.equal(surfaceStyle.overflow, 'visible', 'the raised crest must remain outside the capsule bounds');
    assert.equal(fillStyle.overflow, 'hidden', 'gradient paint must be clipped at the curved capsule');
    assert.equal(fillStyle.borderTopLeftRadius, 23);
    assert.equal(fillStyle.borderBottomLeftRadius, undefined);
    assert.ok(findNode(surfaceFill, (node) => node.type === 'LinearGradient'));

    outer?.props.onLayout({ nativeEvent: { layout: { height: 158 } } });
    assert.equal(fixture.reportedDockHeight(), 158);
  });

  it('uses only the current team colour for the active crest and safely falls back across identity states', () => {
    const fixture = createDockFixture({
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456' },
    }, { member: true });
    fixture.mount();
    fixture.setFocusedRoute('Team');

    const crestStyle = () => flattenStyle(findNode(fixture.harness.output, (node) => node.props.testID === 'dock-team-crest')?.props.style);
    assert.equal(crestStyle().borderColor, '#123456');
    assert.equal(crestStyle().shadowColor, '#123456');

    fixture.setData({ team: { team_id: 'team-b', team_name: 'Team B', logo_url: null, primary_color: '#A1B2C3' } });
    assert.equal(crestStyle().borderColor, '#A1B2C3', 'team identity changes must update the crest accent');
    assert.equal(crestStyle().shadowColor, '#A1B2C3');

    for (const primary_color of [null, '', 'blue-ish', '#12', '#GGGGGG']) {
      fixture.setData({ team: { team_id: 'team-b', team_name: 'Team B', logo_url: null, primary_color } });
      assert.equal(crestStyle().borderColor, '#00ffff');
      assert.equal(crestStyle().shadowColor, '#00ffff');
    }

    fixture.setData({ team: null });
    assert.equal(crestStyle().borderColor, '#00ffff', 'no-team active state uses the safe league accent');
    assert.equal(crestStyle().shadowColor, '#00ffff');

    fixture.setData({ team: { team_id: 'team-b', team_name: 'Team B', logo_url: null, primary_color: '#A1B2C3' } });
    fixture.setFocusedRoute('Schedule');
    assert.equal(crestStyle().borderColor, 'rgba(255,255,255,0.22)');
    assert.equal(crestStyle().shadowColor, '#000000');

    fixture.setFocusedRoute('Standings');
    const standings = findNode(fixture.harness.output, (node) => node.props.testID === 'dock-standings');
    const standingsStyle = flattenStyle(standings?.props.style({ pressed: false }));
    assert.equal(standingsStyle.borderColor, '#00ffff48', 'other active tabs retain league theming');
    assert.equal(standingsStyle.shadowColor, '#00ffff');
  });

  it('renders every eligible action once and reserves the outbound icon for external destinations', () => {
    const fixture = createDockFixture({
      isPlayoffs: true,
      registrationOpen: true,
      visiblePages: { register: true },
      customNavItems: [{ label: 'Long custom league handbook link that must wrap in full', href: 'https://example.com/handbook', isExternal: true }],
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456', leadership_role: 'alternate_captain' },
    }, { member: true });
    fixture.mount();
    fixture.openMore();
    const sheet = findNode(fixture.harness.output, (node) => node.props.testID === 'more-sheet');

    const expected = ['Teams', 'Players', 'Playoffs', 'News', 'History', 'Gallery', 'Events', 'Contact', 'Support', 'Privacy', 'Terms', 'My Page', 'Account', 'Notifications', 'Settings', 'Captain Dashboard', 'Long custom league handbook link that must wrap in full'];
    for (const label of expected) {
      const matches: unknown[] = [];
      const visit = (root: unknown) => {
        if (Array.isArray(root)) return root.forEach(visit);
        if (!root || typeof root !== 'object' || !('props' in root)) return;
        const node = root as { props: Record<string, unknown> };
        if (node.props.accessibilityLabel === label) matches.push(node);
        visit(node.props.children);
      };
      visit(sheet);
      assert.equal(matches.length, 1, `${label} should render exactly once`);
    }
    assert.equal(findNode(sheet, (node) => node.props.testID === 'more-item-app-home'), undefined, 'the league identity row replaces the duplicate catalog Home row');
    assert.ok(findNode(sheet, (node) => node.props.testID === 'more-league-home'));
    assert.equal(findNode(sheet, (node) => node.props.accessibilityLabel === 'Goalies'), undefined);
    assert.equal(findNode(sheet, (node) => node.props.testID === 'more-item-league-teams-external'), undefined);
    assert.equal(findNode(sheet, (node) => node.props.testID === 'more-item-league-register-external'), undefined);
    assert.ok(findNode(sheet, (node) => node.props.testID?.startsWith('more-item-custom-') && node.props.testID.endsWith('-external')));
  });

  it('routes each approved public link through the allowlist and alerts when opening is rejected', async () => {
    const fixture = createDockFixture({}, { failLinks: true });
    fixture.mount();

    for (const itemKey of ['app-support', 'app-privacy', 'app-terms']) {
      fixture.openMore();
      const item = findNode(fixture.harness.output, (node) => node.props.testID === `more-item-${itemKey}`);
      assert.ok(item);
      item.props.onPress();
      await new Promise<void>((resolve) => setImmediate(resolve));
      fixture.harness.render();
    }

    assert.deepEqual(fixture.publicLinkCalls, [
      'https://hockey-life.beerleaguehockey.ca/contact',
      'https://beerleaguehockey.ca/privacy',
      'https://beerleaguehockey.ca/terms',
    ]);
    assert.deepEqual(fixture.alerts, Array.from({ length: 3 }, () => ({
      title: 'Unable to Open Link',
      message: 'This link could not be opened. Please try again.',
    })));
  });

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
    assert.deepEqual(reduced.navigationCalls, [['LeaguePages', {
      screen: 'TeamsDirectory', params: { leagueId: 'league-a', leagueSlug: 'league-a' },
    }]]);

    const regular = createDockFixture({}, { reduceMotion: false, deferAnimations: true });
    regular.mount();
    regular.openMore();
    regular.finishNextAnimation();
    findNode(regular.harness.output, (node) => node.props.accessibilityLabel === 'Teams')!.props.onPress();
    assert.equal(findNode(regular.harness.output, (node) => node.type === 'Modal')?.props.visible, true);
    assert.deepEqual(regular.openedUrls, []);
    regular.finishNextAnimation();
    assert.deepEqual(regular.navigationCalls, [['LeaguePages', {
      screen: 'TeamsDirectory', params: { leagueId: 'league-a', leagueSlug: 'league-a' },
    }]]);
  });

  it('emits preventable tabPress events with route keys and preserves nested stack reselects', () => {
    const fixture = createDockFixture({
      team: { team_id: 'team-a', team_name: 'Team A', logo_url: null, primary_color: '#123456' },
    }, { member: true });
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

    fixture.setFocusedRoute('Team', 'PlayerCard');
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

  it('opens the public Hockey Life teams directory from the guest Team control', () => {
    const fixture = createDockFixture({}, { member: false });
    fixture.mount();

    findNode(fixture.harness.output, (node) => node.props.testID === 'dock-team')!.props.onPress();

    assert.deepEqual(fixture.navigationCalls.at(-1), [
      'LeaguePages',
      {
        screen: 'TeamsDirectory',
        params: { leagueId: 'league-a', leagueSlug: 'league-a' },
      },
    ]);
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
    assert.doesNotMatch(text, /Discover Leagues/);
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
    assert.equal(findNode(fixture.harness.output, (node) => node.props.accessibilityLabel === 'Teams')?.props.accessibilityRole, 'button');

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
