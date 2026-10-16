import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness.ts';

const GAME_ID = '50000000-0000-4000-8000-000000000001';
const TEAM_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002';
const PLAYER_ID = '40000000-0000-4000-8000-000000000011';
const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';

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

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

describe('Notifications pending-card Beer Guy', () => {
  it('shows Beer only on an unanswered card and removes it after the server confirms a Beer claim attendance response', async () => {
    const harness = createHookHarness();
    const claim = deferred<BeerGuyToggleResult>();
    const hookInputs: BeerGuyHookInput[] = [];
    const futureGame = {
      id: GAME_ID,
      league_id: LEAGUE_ID,
      scheduled_at: '2099-10-20T22:00:00.000Z',
      location: 'Rink A',
      status: 'scheduled',
      home_score: null,
      away_score: null,
      home_team_id: TEAM_ID,
      away_team_id: OTHER_TEAM_ID,
      home_team: { id: TEAM_ID, name: 'Home', logo_url: null, primary_color: '#112233' },
      away_team: { id: OTHER_TEAM_ID, name: 'Away', logo_url: null, primary_color: '#445566' },
    };
    class Query {
      status: string | null = null;
      constructor(private table: string) {}
      select() { return this; }
      in() { return this; }
      gte() { return this; }
      order() { return this; }
      limit() { return this; }
      eq(column: string, value: string) { if (column === 'status') this.status = value; return this; }
      then(resolve: (value: unknown) => void) {
        if (this.table === 'team_rosters') {
          resolve({ data: [{
            team_id: TEAM_ID,
            league_id: LEAGUE_ID,
            team: { id: TEAM_ID, name: 'Home', logo_url: null, primary_color: '#112233' },
            league: { id: LEAGUE_ID, name: 'Hockey Life', slug: 'hockey-life', primary_color: '#22D3EE' },
          }], error: null });
          return;
        }
        if (this.table === 'games') {
          resolve({ data: this.status === 'scheduled' ? [futureGame] : [], error: null });
          return;
        }
        resolve({ data: [], error: null });
      }
    }
    const passthrough = ({ children, ...props }: Record<string, unknown>) => createElement('View', props, children);
    const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
      new URL('../../src/screens/NotificationsFeedScreen.tsx', import.meta.url),
      {
        react: harness.react,
        'react-native': {
          ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
          ScrollView: passthrough, Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 390 }),
          StyleSheet: { create: <T>(value: T) => value, absoluteFillObject: {}, hairlineWidth: 1 },
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '@expo/vector-icons': { Ionicons: 'Ionicons' },
        'expo-linear-gradient': { LinearGradient: passthrough },
        'expo-linking': { openURL: async () => undefined },
        'expo-haptics': { ImpactFeedbackStyle: { Light: 'light' }, impactAsync: async () => undefined },
        '../components/QuickCheckinActions': (props: Record<string, unknown>) => createElement('QuickCheckinActions', props),
        '../components/RevealView': passthrough,
        '../components/ScheduleConflictList': () => null,
        '../components/SectionHeader': ({ title }: { title: string }) => createElement('Text', null, title),
        '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
        '../config/hockeyLife': { HOCKEY_LIFE_ID: LEAGUE_ID },
        '../context/LeagueContext': { useLeague: () => ({ activeLeague: { id: LEAGUE_ID, name: 'Hockey Life' } }) },
        '../hooks/useBeerGuyAssignments': {
          useBeerGuyAssignments: (input: BeerGuyHookInput) => {
            hookInputs.push(input);
            return {
              getState: () => ({ status: 'ready', assignment: null, callerEligible: true, busy: false, error: null }),
              toggleBeerGuy: async () => claim.promise,
              refresh: async () => undefined,
            };
          },
        },
        '../lib/calendar': { addGameToCalendar: async () => undefined },
        '../lib/scheduleConflicts': { getScheduleConflicts: () => [] },
        '../lib/supabase/checkins': {
          getMyCheckinsForTeams: async () => ({}), updateCheckin: async () => ({ success: true }),
        },
        '../lib/supabase/client': {
          supabase: {
            auth: { getUser: async () => ({ data: { user: { id: PLAYER_ID } } }) },
            from: (table: string) => new Query(table),
          },
        },
        '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
        '../navigation/playerCard': { navigateToPlayerCard: () => undefined },
        '../theme/colors': { default: {
          primary: '#0ff', bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
          bgSurface: '#111', bgInteractive: '#222', bgElevated: '#333', borderCard: '#333', glassStroke: '#444',
          glassStrokeStrong: '#555', glassHighlight: '#222', accentGreen: '#0f0', accentRed: '#f00', brandRink: '#0ff',
        } },
      },
    ).default;

    harness.mount(() => Screen({ navigation: { navigate: () => undefined, goBack: () => undefined } }));
    await settle(harness);

    const initialHookInput = hookInputs.at(-1);
    assert.ok(initialHookInput);
    assert.deepEqual(initialHookInput.scopes, [{ gameId: GAME_ID, teamId: TEAM_ID }]);
    let actions = findNode(harness.output, (node) => node.type === 'QuickCheckinActions')!;
    assert.ok(actions?.props.beerGuy);
    actions.props.beerGuy.onToggle();
    harness.render();
    assert.ok(findNode(harness.output, (node) => node.type === 'QuickCheckinActions'));

    claim.resolve({ outcome: 'claimed', attendanceStatus: 'confirmed', error: null });
    await settle(harness);
    actions = findNode(harness.output, (node) => node.type === 'QuickCheckinActions')!;
    assert.equal(actions, undefined);
    assert.match(nodeText(harness.output), /No open actions/);
    const finalHookInput = hookInputs.at(-1);
    assert.ok(finalHookInput);
    assert.deepEqual(finalHookInput.scopes, []);
  });
});
