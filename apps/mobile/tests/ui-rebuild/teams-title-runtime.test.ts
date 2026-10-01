import assert from 'node:assert/strict';
import { it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

it('mounts both the registered Teams navigator title and the handwritten Teams screen title', () => {
  const harness = createHookHarness();
  const passthrough = ({ children }: { children?: unknown }) => children ?? null;
  const teams = Array.from({ length: 4 }, (_, index) => ({
    id: `team-${index + 1}`, name: `Team ${index + 1}`, logoUrl: null, primaryColor: '#6046A8',
  }));
  const TeamsDirectory = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/league-pages/TeamsDirectoryScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: <T>(value: T) => value } },
      '../../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../../theme/colors': { default: { primary: '#03299B', textPrimary: '#fff' } },
      './LeaguePageCommon': {
        LeaguePageFrame: ({ children }: { children?: unknown }) => createElement('LeaguePageFrame', null, children),
        PageLoadState: () => createElement('PageLoadState', null),
        useLeaguePageScope: () => ({ leagueId: 'league-a', leagueSlug: 'league-a' }),
        useLeaguePage: () => ({ loading: false, error: null, retry: () => undefined, data: { league: { id: 'league-a' }, selectedSeason: { id: 'season-a' }, teams } }),
      },
    },
  ).default;

  const descriptor = (props: Record<string, unknown>) => createElement('ScreenDescriptor', props);
  const navigatorFactory = (type: string) => () => ({
    Screen: descriptor,
    Navigator: ({ children }: { children?: unknown }) => createElement(type, null, children),
  });
  const screenModule = { __esModule: true, default: () => null };
  const rootMocks = new Proxy<Record<string, unknown>>({}, {
    has: () => true,
    get: (_target, id: string) => {
      if (id === 'react') return harness.react;
      if (id === 'react-native') return { StyleSheet: { create: <T>(value: T) => value }, View: 'View' };
      if (id === '@react-navigation/bottom-tabs') return { createBottomTabNavigator: navigatorFactory('TabNavigatorRuntime') };
      if (id === '@react-navigation/native-stack') return { createNativeStackNavigator: navigatorFactory('StackNavigatorRuntime') };
      if (id === '../context/AuthContext') return { useAuth: () => ({ isGuest: false, user: { id: 'viewer' } }) };
      if (id === '../context/LeagueContext') return { useLeague: () => ({ activeLeague: { id: 'league-a' }, activeTheme: { backgroundColor: '#000', primaryColor: '#1F6A44' } }) };
      if (id === '../context/FocusPauseContext') return { FocusPauseProvider: passthrough };
      if (id === './GuestBannerLayout') return { __esModule: true, default: passthrough };
      if (id === './MobileShellDataContext') return { MobileShellDataProvider: passthrough };
      if (id === './MobileWebDock') return screenModule;
      if (id === '../components/CutIceTitle') return { __esModule: true, default: (props: Record<string, unknown>) => createElement('CutIceTitle', props) };
      if (id === '../screens/league-pages/TeamsDirectoryScreen') return { __esModule: true, default: TeamsDirectory };
      if (id === '../theme/colors') return { __esModule: true, default: { bgBase: '#000' } };
      return screenModule;
    },
  });
  const RootNavigation = compileCommonJs<{ default: () => unknown }>(new URL('../../src/navigation/index.tsx', import.meta.url), rootMocks).default;
  const root = RootNavigation();
  const leaguePages = findNode(root, (node) => node.type === 'ScreenDescriptor' && node.props.name === 'LeaguePages');
  assert.equal(typeof leaguePages?.props.component, 'function');
  const leagueStack = leaguePages!.props.component();
  const teamsRoute = findNode(leagueStack, (node) => node.type === 'ScreenDescriptor' && node.props.name === 'TeamsDirectory');
  assert.ok(teamsRoute);

  const navigatorHeader = teamsRoute.props.options.header({ navigation: { goBack: () => undefined }, back: undefined });
  assert.equal(findNode(navigatorHeader, (node) => node.type === 'CutIceTitle')?.props.title, 'Teams');

  const screen = teamsRoute.props.component({ route: { params: { leagueId: 'league-a' } }, navigation: { navigate: () => undefined } });
  const handwrittenHeaders = allNodes(screen).filter((node) => node.props.accessibilityRole === 'header' && nodeText(node) === 'Teams');
  assert.equal(handwrittenHeaders.length, 1);
});
