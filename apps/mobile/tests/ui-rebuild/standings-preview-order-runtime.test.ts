/* eslint-disable @typescript-eslint/no-explicit-any -- focused mounted-screen harness */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, type TestNode } from './component-harness.ts';

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

const canonicalOrder = ['Bravo', 'Alpha', 'Able', 'Zulu'];
const standings = [
  { team_id: 'team-z', team_name: 'Zulu', goals_for: 10, goals_against: 6, division_id: 'east' },
  { team_id: 'team-a', team_name: 'Bravo', goals_for: 14, goals_against: 10, division_id: 'west' },
  { team_id: 'team-y', team_name: 'Alpha', goals_for: 12, goals_against: 8, division_id: 'east' },
  { team_id: 'team-b', team_name: 'Able', goals_for: 10, goals_against: 6, division_id: 'west' },
].map((row) => ({ ...row, logo_url: null, primary_color: null, division_name: row.division_id, wins: 4, losses: 1, ties: 0, points: 8, games_played: 5 }));

async function mountScreen(rows: typeof standings) {
  const harness = createHookHarness();
  const league: any = { activeDivision: null };
  const activeLeague = { id: 'league-1', slug: 'hockey-life' };
  const activeTheme = { backgroundColor: '#000', primaryColor: '#8f7a4b' };
  const Screen = compileCommonJs<any>(new URL('../../src/screens/StandingsScreen.tsx', import.meta.url), {
    react: harness.react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/CardFocus': { FocusCard: ({ children, ...props }: any) => createElement('FocusCard', props, children), FocusScrollView: ({ children, ...props }: any) => createElement('FocusScrollView', props, children) },
    '../components/DivisionFilter': (props: any) => createElement('DivisionFilter', props),
    '../components/GuestBanner': () => null,
    '../components/SeasonCompletionHump': (props: any) => createElement('SeasonCompletionHump', props),
    '../components/StandingsPlayoffsPanel': (props: any) => createElement('StandingsPlayoffsPanel', props),
    '../components/TeamLogo': (props: any) => createElement('TeamLogo', props),
    '../components/TeamPositioningChart': () => null,
    '../context/LeagueContext': { useLeague: () => ({ activeLeague, activeTheme, activeDivision: league.activeDivision, setActiveDivision: (division: any) => { league.activeDivision = division; }, divisions: [{ id: 'east', name: 'east' }, { id: 'west', name: 'west' }] }) },
    '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
    '../lib/leaguePages': { getLeaguePage: async (_slug: string, page: string) => page === 'playoffs' ? { previewConfig: { playoffTeamsTotal: 4, playoffTeamsPerDivision: 2, useDivisionPlayoffs: false } } : { positioning: null } },
    '../lib/leaguePagesModel': { filterAndRerankPositioning: () => null },
    '../lib/standingsModel': await import('../../src/lib/standingsModel.ts'),
    '../lib/supabase/data': { getOperationalSeason: async () => ({ id: 'season-1', name: 'Current' }), getStandings: async () => rows, getSchedule: async () => [] },
    '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
    '../theme/colors': { default: { bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', glassStroke: '#444', textPrimary: '#fff', textSecondary: '#aaa' } },
  }).default;
  harness.mount(() => Screen({ navigation: { navigate: () => undefined } }));
  for (let index = 0; index < 8; index += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); harness.render(); }
  return { harness, league };
}

describe('StandingsScreen canonical preview ordering', () => {
  it('keeps mounted preview seeds aligned to the canonical visible ranking across shuffled transport and division display scope', async () => {
    for (const rows of [standings, [standings[2], standings[0], standings[3], standings[1]]]) {
      const { harness, league } = await mountScreen(rows);
      const labels = allNodes(harness.output).filter((node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes(' points')).map((node) => node.props.accessibilityLabel.split(',')[0]);
      assert.deepEqual(labels, canonicalOrder);
      const panel = allNodes(harness.output).find((node) => node.type === 'StandingsPlayoffsPanel');
      assert.deepEqual(panel?.props.picture.groups[0].matchups.map((matchup: any) => [matchup.highSeed.teamName, matchup.lowSeed.teamName]), [['Bravo', 'Zulu'], ['Alpha', 'Able']]);

      league.activeDivision = { id: 'east', name: 'east' };
      harness.render();
      const scopedPanel = allNodes(harness.output).find((node) => node.type === 'StandingsPlayoffsPanel');
      assert.deepEqual(scopedPanel?.props.picture.groups[0].matchups.map((matchup: any) => [matchup.highSeed.teamName, matchup.lowSeed.teamName]), [['Bravo', 'Zulu'], ['Alpha', 'Able']]);
      harness.unmount();
    }
  });
});
