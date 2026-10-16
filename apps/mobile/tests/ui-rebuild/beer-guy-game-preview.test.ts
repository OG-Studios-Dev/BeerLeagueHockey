import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, type TestNode } from './component-harness.ts';

const GAME_ID = '50000000-0000-4000-8000-000000000001';
const TEAM_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002';
const PLAYER_ID = '40000000-0000-4000-8000-000000000011';

type BeerGuyHookInput = {
  scopes: Array<{ gameId: string; teamId: string }>;
  currentUserId: string | null;
  enabled: boolean;
};
type BeerGuyToggleResult = {
  outcome: 'claimed' | 'cleared' | 'taken' | 'error' | 'ignored';
  attendanceStatus: 'confirmed' | null;
  error: string | null;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

describe('Game Preview Beer Guy', () => {
  it('uses the exact future game/team scope, waits for server claim truth, and refreshes Beer after attendance writes', async () => {
    const harness = createHookHarness();
    const claim = deferred<BeerGuyToggleResult>();
    const hookInputs: BeerGuyHookInput[] = [];
    const attendanceWrites: Array<[string, string, string]> = [];
    let beerRefreshes = 0;
    let summaryReads = 0;
    const game = {
      id: GAME_ID,
      league_id: '10000000-0000-4000-8000-000000000001',
      season_id: '20000000-0000-4000-8000-000000000001',
      home_team_id: TEAM_ID,
      away_team_id: OTHER_TEAM_ID,
      home_score: null,
      away_score: null,
      scheduled_at: '2099-10-20T22:00:00.000Z',
      status: 'scheduled',
      location: 'Rink A',
      home_team: { name: 'Home', primary_color: '#112233', logo_url: null },
      away_team: { name: 'Away', primary_color: '#445566', logo_url: null },
    };
    const gameQuery = {
      select: () => gameQuery,
      eq: () => gameQuery,
      single: async () => ({ data: game, error: null }),
    };
    const rosterQuery = {
      select: () => rosterQuery,
      eq: () => rosterQuery,
      then: (resolve: (value: unknown) => void) => resolve({ data: [{ team_id: TEAM_ID }], error: null }),
    };
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/GamePreviewScreen.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          ActivityIndicator: 'ActivityIndicator',
          Animated: {
            Value: class { constructor(_value: number) {} },
            loop: () => ({ start: () => undefined, stop: () => undefined }),
            sequence: () => ({}), timing: () => ({}), View: 'AnimatedView',
          },
          Easing: { inOut: () => undefined, ease: 'ease' },
          Linking: { openURL: async () => undefined },
          Pressable: 'Pressable', ScrollView: 'ScrollView',
          StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 }, Text: 'Text', View: 'View',
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        'expo-haptics': { impactAsync: async () => undefined, ImpactFeedbackStyle: { Medium: 'medium' } },
        '../components/Avatar': (props: Record<string, unknown>) => createElement('Avatar', props),
        '../components/CardFocus': {
          FocusCard: ({ children, ...props }: Record<string, unknown>) => createElement('FocusCard', props, children),
          FocusScrollView: ({ children, ...props }: Record<string, unknown>) => createElement('FocusScrollView', props, children),
        },
        '../components/QuickCheckinActions': (props: Record<string, unknown>) => createElement('QuickCheckinActions', props),
        '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
        '../context/LeagueContext': { useLeague: () => ({ isGuestLeague: false }) },
        '../hooks/useBeerGuyAssignments': {
          useBeerGuyAssignments: (input: BeerGuyHookInput) => {
            hookInputs.push(input);
            return {
              getState: () => ({ status: 'ready', assignment: null, callerEligible: true, busy: false, error: null }),
              toggleBeerGuy: async () => claim.promise,
              refresh: async () => { beerRefreshes += 1; },
            };
          },
        },
        '../lib/calendar': { addGameToCalendar: async () => undefined },
        '../lib/supabase/checkins': {
          getMyCheckins: async () => ({}),
          getGameCheckinSummary: async () => { summaryReads += 1; return { confirmed: [], tentative: [], out: [], total: 0 }; },
          updateCheckin: async (gameId: string, teamId: string, status: string) => {
            attendanceWrites.push([gameId, teamId, status]);
            return { success: true };
          },
        },
        '../lib/supabase/client': {
          supabase: {
            auth: { getUser: async () => ({ data: { user: { id: PLAYER_ID } } }) },
            from: (table: string) => table === 'games' ? gameQuery : rosterQuery,
          },
        },
        '../lib/supabase/data': {
          getGameGoalScorers: async () => [], getGoalieStats: async () => [], getSeasonSeries: async () => [],
          getTopPlayers: async () => [], getTeamRoster: async () => [], mapGameStatus: () => 'Upcoming',
        },
        '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
        '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
        '../theme/colors': { default: {
          primary: '#0ff', accentViolet: '#80f', accentGreen: '#0f0', accentRed: '#f00', textPrimary: '#fff',
          textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', textOnPrimary: '#000',
          badgeUpcomingBg: '#222', badgeUpcomingText: '#fff',
        } },
      },
    ).default;

    harness.mount(() => Screen({
      route: { params: { gameId: GAME_ID } },
      navigation: { goBack: () => undefined, navigate: () => undefined },
    }));
    await settle(harness);

    const latestHookInput = hookInputs.at(-1);
    assert.ok(latestHookInput);
    assert.deepEqual(latestHookInput.scopes, [{ gameId: GAME_ID, teamId: TEAM_ID }]);
    let actions = findNode(harness.output, (node) => node.type === 'QuickCheckinActions')!;
    assert.ok(actions);
    assert.equal(actions.props.value, null);
    assert.ok(actions.props.beerGuy);

    actions.props.beerGuy.onToggle();
    harness.render();
    assert.equal(findNode(harness.output, (node) => node.type === 'QuickCheckinActions')?.props.value, null);
    claim.resolve({ outcome: 'claimed', attendanceStatus: 'confirmed', error: null });
    await settle(harness);
    actions = findNode(harness.output, (node) => node.type === 'QuickCheckinActions')!;
    assert.equal(actions.props.value, 'confirmed');
    assert.equal(summaryReads, 2);

    actions.props.onChange('out');
    await settle(harness);
    assert.deepEqual(attendanceWrites, [[GAME_ID, TEAM_ID, 'out']]);
    assert.equal(beerRefreshes, 1);
    assert.equal(summaryReads, 3);
    assert.equal(allNodes(harness.output).filter((node) => node.type === 'QuickCheckinActions').length, 1);
  });
});
