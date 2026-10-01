/* eslint-disable @typescript-eslint/no-explicit-any -- focused component harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, nodeText, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

const teams = [
  ['team-1', 'First General London'],
  ['team-2', 'FitzRays Flyers'],
  ['team-3', 'FitzRays Premier'],
  ['team-4', 'London Eco-Metal'],
].map(([id, name]) => ({ id, name, slug: id, logoUrl: `https://images.test/${id}.png`, divisionId: null, divisionName: null, primaryColor: '#8F7A4B' }));

function renderTeamsDirectory() {
  const harness = createHookHarness();
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/league-pages/TeamsDirectoryScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': {
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    },
    '../../components/CardFocus': { FocusCard: ({ children, ...props }: any) => createElement('FocusCard', props, children) },
    '../../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
    '../../lib/leaguePagesModel': {
      POSITION_METRICS: [],
      buildTeamsDirectoryView: () => ({ count: 4, groups: [{ id: null, name: 'All Teams', teams }], positioning: null }),
    },
    '../../theme/colors': { default: { primary: '#8F7A4B', textPrimary: '#fff' } },
    './LeaguePageCommon': {
      LeaguePageFrame: ({ children }: any) => createElement('LeaguePageFrame', null, children),
      PageHeader: ({ title }: any) => createElement('PageHeader', null, title),
      PageLoadState: () => createElement('PageLoadState', null),
      SeasonPicker: () => null,
      DivisionPicker: () => null,
      commonStyles: { section: {}, sectionTitle: {}, card: {} },
      useLeaguePageScope: (scope: any) => scope,
      useLeaguePage: () => ({
        data: { page: 'teams', league: { id: 'league-1', name: 'Hockey Life' }, selectedSeason: { id: 'season-1', name: 'Winter' }, seasons: [], divisions: [], teams, positioning: null },
        loading: false, error: null, retry: () => undefined,
      }),
    },
  }).default;
  harness.mount(() => Screen({ route: { params: { leagueId: 'league-1', leagueSlug: 'hockey-life' } }, navigation: { navigate: () => undefined } }));
  return harness.output;
}

async function renderStandings() {
  const harness = createHookHarness();
  const activeLeague = { id: 'league-1', slug: 'hockey-life' };
  const activeTheme = { backgroundColor: '#000', primaryColor: '#8F7A4B' };
  const rows = teams.map((team, index) => ({
    team_id: team.id, team_name: team.name, logo_url: team.logoUrl, primary_color: team.primaryColor,
    division_id: null, division_name: null, wins: 4 - index, losses: index, ties: 0,
    points: 8 - index * 2, goals_for: 20 - index, goals_against: 10 + index, games_played: 4,
  }));
  const games = [
    { id: 'played', home_team_id: 'team-1', away_team_id: 'team-2', status: 'completed', game_type: 'regular' },
    { id: 'next', home_team_id: 'team-3', away_team_id: 'team-4', status: 'scheduled', game_type: 'regular' },
  ];
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/StandingsScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicon' },
    '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
    '../components/CardFocus': { FocusCard: ({ children, ...props }: any) => createElement('FocusCard', props, children), FocusScrollView: ({ children, ...props }: any) => createElement('FocusScrollView', props, children) },
    '../components/DivisionFilter': () => null,
    '../components/GuestBanner': () => null,
    '../components/SeasonCompletionHump': (props: any) => createElement('SeasonCompletionHump', props),
    '../components/StandingsPlayoffsPanel': (props: any) => createElement('StandingsPlayoffsPanel', props, createElement('Text', null, 'Playoffs')),
    '../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
    '../components/TeamPositioningChart': (props: any) => createElement('TeamPositioningChart', props),
    '../context/LeagueContext': { useLeague: () => ({ activeLeague, activeTheme, activeDivision: null, setActiveDivision: () => undefined, divisions: [] }) },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }) },
    '../lib/leaguePages': { getLeaguePage: async (_slug: string, page: string) => page === 'teams'
      ? { page: 'teams', selectedSeason: { id: 'season-1' }, teams, divisions: [], positioning: { seasonId: 'season-1', totalTeams: 4, attendanceSource: 'confirmed-plus-fallback-roster-appearances', teams: [] } }
      : { page: 'playoffs', selectedSeason: { id: 'season-1' }, standings: [], series: [], teams, divisions: [], previewConfig: { playoffTeamsTotal: 4, playoffTeamsPerDivision: null, useDivisionPlayoffs: false } } },
    '../lib/leaguePagesModel': { filterAndRerankPositioning: (value: unknown) => value },
    '../lib/standingsModel': await import('../../src/lib/standingsModel.ts'),
    '../lib/supabase/data': { getOperationalSeason: async () => ({ id: 'season-1', name: 'Winter' }), getStandings: async () => rows, getSchedule: async () => games },
    '../theme/colors': { default: { bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', glassStroke: '#333', textPrimary: '#fff', textSecondary: '#aaa', primary: '#8F7A4B' } },
    './ScheduleScreen': () => createElement('ScheduleScreen', null),
  }).default;
  harness.mount(() => Screen({ navigation: { navigate: () => undefined } }));
  for (let index = 0; index < 8; index += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); harness.render(); }
  return harness.output;
}

describe('league page polish runtime', () => {
  it('renders Teams as four canonical accessible logo destinations only', () => {
    const output = renderTeamsDirectory();
    assert.equal(nodeText(output), 'Teams');
    const destinations = allNodes(output).filter((node) => node.props.accessibilityRole === 'button');
    assert.equal(destinations.length, 4);
    assert.deepEqual(destinations.map((node) => node.props.accessibilityLabel), teams.map((team) => team.name));
    assert.equal(allNodes(output).filter((node) => node.type === 'TeamLogo').length, 4);
  });

  it('renders standings with playoff picture, honest predictor, completion chart, and the single positioning chart', async () => {
    const output = await renderStandings();
    const text = nodeText(output);
    for (const title of ['Standings', 'Playoffs', 'Season Completion', 'Team Positioning']) assert.match(text, new RegExp(title));
    assert.equal(allNodes(output).filter((node) => node.type === 'StandingsPlayoffsPanel').length, 1);
    assert.equal(allNodes(output).filter((node) => node.type === 'TeamPositioningChart').length, 1);
    assert.doesNotMatch(text, /Compare each team|Estimated from confirmed|available only for/i);
  });
});
