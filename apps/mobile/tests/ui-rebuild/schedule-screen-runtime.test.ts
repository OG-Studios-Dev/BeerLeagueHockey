import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GameRow } from '../../src/lib/supabase/data.ts';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText, type TestNode } from './component-harness.ts';

const league = { id: 'league-a', name: 'Hockey Life', slug: 'hockey-life', logoUrl: null, city: 'London', theme: { backgroundColor: '#07111F', primaryColor: '#22D3EE' } };
const leagueB = { ...league, id: 'league-b', name: 'League B', slug: 'league-b' };
const season = { id: 'season-a', name: 'Winter', start_date: '2026-01-01', end_date: null, status: 'active' };
const statuses = ['scheduled', 'in_progress', 'completed', 'pending_verification', 'postponed', 'cancelled', null] as const;
const games: GameRow[] = statuses.map((status, index) => ({
  id: `game-${index}`,
  home_team_id: index === 0 ? 'team-filter' : `home-${index}`,
  away_team_id: `away-${index}`,
  home_score: status === 'completed' ? 2 : null,
  away_score: status === 'in_progress' ? 0 : null,
  scheduled_at: `2026-10-${String(index + 1).padStart(2, '0')}T22:00:00.000Z`,
  status,
  location: `Rink ${index}`,
  season_id: season.id,
  home_team: { id: index === 0 ? 'team-filter' : `home-${index}`, name: `Home ${index}`, primary_color: '#112233', logo_url: null },
  away_team: { id: `away-${index}`, name: `Away ${index}`, primary_color: '#445566', logo_url: null },
}));

function allNodes(root: unknown): TestNode[] {
  if (Array.isArray(root)) return root.flatMap(allNodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as TestNode;
  return [node, ...allNodes(node.props.children)];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

type RuntimeOptions = {
  isGuestLeague?: boolean;
  rosterTeamIds?: string[];
  updateCheckin?: (gameId: string, teamId: string, status: string) => Promise<{ success: boolean }>;
};

function createRuntime(
  loadScheduleSnapshot: (leagueId: string, divisionId: string | null) => Promise<unknown>,
  options: RuntimeOptions = {},
) {
  const harness = createHookHarness();
  const navigationCalls: Array<[string, unknown]> = [];
  let standingsReads = 0;
  let currentLeague = league;
  let currentDivision: { id: string; name: string } | null = null;
  const rosterQuery = {
    select: () => rosterQuery,
    eq: () => rosterQuery,
    is: async () => ({ data: (options.rosterTeamIds ?? []).map((team_id) => ({ team_id })), error: null }),
  };
  const reactNative = {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }: Record<string, any>) =>
      createElement('FlatList', props, ListHeaderComponent, ...data.map((item: unknown, index: number) => renderItem({ item, index }))),
    Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 }, Text: 'Text', View: 'View',
  };
  const Screen = compileCommonJs<{ default: (props: Record<string, unknown>) => unknown }>(
    new URL('../../src/screens/ScheduleScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': reactNative,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      'expo-haptics': { impactAsync: () => undefined, ImpactFeedbackStyle: { Light: 'light' } },
      '../components/DivisionFilter': (props: Record<string, unknown>) => createElement('DivisionFilter', props),
      '../components/GuestBanner': () => createElement('GuestBanner', null),
      '../components/GameCard': (props: Record<string, unknown>) => createElement('LegacyGameCard', props),
      '../components/PillToggle': () => createElement('Text', null, 'Legacy toggle Upcoming Scores Standings'),
      '../components/QuickCheckinActions': (props: Record<string, unknown>) => createElement('QuickCheckinActions', props),
      '../components/ScheduleMatchupCard': (props: Record<string, any>) => createElement('ScheduleMatchupCard', props, createElement('Text', null, props.game.id)),
      '../components/ScheduleTeamFilter': (props: Record<string, unknown>) => createElement('ScheduleTeamFilter', props),
      '../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false, reduceMotion: false }) },
      '../context/LeagueContext': { useLeague: () => ({ activeLeague: currentLeague, activeTheme: currentLeague.theme, activeDivision: currentDivision, setActiveDivision: (division: typeof currentDivision) => { currentDivision = division; }, divisions: [], isGuestLeague: options.isGuestLeague ?? true }) },
      '../lib/calendar': { addGameToCalendar: async () => undefined },
      '../lib/supabase/checkins': {
        getMyCheckins: async () => ({}),
        getMyCheckinsForTeams: async () => ({}),
        updateCheckin: options.updateCheckin ?? (async () => ({ success: true })),
      },
      '../lib/supabase/client': {
        supabase: {
          auth: { getUser: async () => ({ data: { user: options.isGuestLeague === false ? { id: 'player-a' } : null } }) },
          from: () => rosterQuery,
        },
      },
      '../lib/supabase/data': {
        getCurrentSeason: async () => season,
        getSchedule: async () => games,
        getStandings: async () => { standingsReads += 1; return []; },
        mapGameStatus: (status: string | null) => status === 'completed' ? 'Final' : status === 'in_progress' ? 'Live' : 'Upcoming',
      },
      '../lib/supabase/schedule': { loadScheduleSnapshot },
      '../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (edges: unknown) => edges },
      '../theme/colors': { default: { textPrimary: '#fff', textSecondary: '#aaa', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', glassStroke: '#444' } },
    },
  ).default;
  harness.mount(() => Screen({ navigation: { navigate: (route: string, params: unknown) => navigationCalls.push([route, params]) } }));
  return {
    harness,
    navigationCalls,
    standingsReads: () => standingsReads,
    switchLeague: (next: typeof league) => { currentLeague = next; harness.render(); },
    switchDivision: (next: typeof currentDivision) => { currentDivision = next; harness.render(); },
  };
}

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

describe('Schedule screen runtime', () => {
  it('removes local modes and standings reads while rendering every status in one vertical list', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games,
    }));
    await settle(runtime.harness);

    assert.equal(runtime.standingsReads(), 0);
    assert.doesNotMatch(nodeText(runtime.harness.output), /Legacy toggle|Upcoming|Scores|Standings/);
    const list = findNode(runtime.harness.output, (node) => node.type === 'FlatList')!;
    assert.ok(list);
    assert.notEqual(list.props.horizontal, true);
    const cards = allNodes(runtime.harness.output).filter((node) => node.type === 'ScheduleMatchupCard');
    assert.deepEqual(cards.map((card) => card.props.game.id), games.map((game) => game.id));
    for (const game of games) assert.ok(findNode(runtime.harness.output, (node) => node.props.testID === `focus-card-schedule:game:${game.id}`));
    cards[3].props.onOpenGame(cards[3].props.game.id);
    assert.deepEqual(runtime.navigationCalls, [['GamePreview', { gameId: 'game-3' }]]);
  });

  it('filters by canonical team ID and restores the complete scoped schedule', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games,
    }));
    await settle(runtime.harness);
    const filter = findNode(runtime.harness.output, (node) => Array.isArray(node.props.options) && typeof node.props.onSelect === 'function')!;
    assert.ok(filter.props.options.some((option: { id: string }) => option.id === 'team-filter'));
    filter.props.onSelect('team-filter');
    runtime.harness.render();
    let cards = allNodes(runtime.harness.output).filter((node) => node.type === 'ScheduleMatchupCard');
    assert.deepEqual(cards.map((card) => card.props.game.id), ['game-0']);

    const selectedFilter = findNode(runtime.harness.output, (node) => Array.isArray(node.props.options) && node.props.selectedTeamId === 'team-filter')!;
    selectedFilter.props.onSelect(null);
    runtime.harness.render();
    cards = allNodes(runtime.harness.output).filter((node) => node.type === 'ScheduleMatchupCard');
    assert.deepEqual(cards.map((card) => card.props.game.id), games.map((game) => game.id));
  });

  it('renders filtered-empty separately without exposing a missing team UUID', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games,
    }));
    await settle(runtime.harness);
    const filter = findNode(runtime.harness.output, (node) => Array.isArray(node.props.options) && typeof node.props.onSelect === 'function')!;
    filter.props.onSelect('team-no-longer-scheduled');
    runtime.harness.render();

    assert.match(nodeText(runtime.harness.output), /No games for Team unavailable in this schedule/);
    assert.doesNotMatch(nodeText(runtime.harness.output), /team-no-longer-scheduled|No games scheduled for Winter/);
    assert.equal(allNodes(runtime.harness.output).filter((node) => node.type === 'ScheduleMatchupCard').length, 0);
  });

  it('rolls back a rejected check-in and disables every visible check-in while the write is pending', async () => {
    const write = deferred<{ success: boolean }>();
    let writes = 0;
    const scheduledGames = [
      { ...games[0], id: 'checkin-a', home_team_id: 'team-filter', home_team: { ...games[0].home_team!, id: 'team-filter' } },
      { ...games[0], id: 'checkin-b', scheduled_at: '2026-10-09T22:00:00.000Z', home_team_id: 'team-filter', home_team: { ...games[0].home_team!, id: 'team-filter' } },
    ];
    const runtime = createRuntime(
      async () => ({ kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games: scheduledGames }),
      {
        isGuestLeague: false,
        rosterTeamIds: ['team-filter'],
        updateCheckin: async () => { writes += 1; return write.promise; },
      },
    );
    await settle(runtime.harness);
    let actions = allNodes(runtime.harness.output).filter((node) => node.type === 'QuickCheckinActions');
    assert.equal(actions.length, 2);
    assert.deepEqual(actions.map((action) => action.props.disabled), [false, false]);

    actions[0].props.onChange('confirmed');
    runtime.harness.render();
    actions = allNodes(runtime.harness.output).filter((node) => node.type === 'QuickCheckinActions');
    assert.equal(writes, 1);
    assert.deepEqual(actions.map((action) => action.props.disabled), [true, true]);
    assert.equal(actions[0].props.value, 'confirmed');

    write.reject(new Error('offline'));
    await settle(runtime.harness);
    actions = allNodes(runtime.harness.output).filter((node) => node.type === 'QuickCheckinActions');
    assert.deepEqual(actions.map((action) => action.props.disabled), [false, false]);
    assert.equal(actions[0].props.value, null);
  });

  it('generation-guards league responses and clears prior-scope facts immediately', async () => {
    const leagueARequest = deferred<any>();
    const leagueBRequest = deferred<any>();
    const calls: string[] = [];
    const runtime = createRuntime(async (leagueId) => {
      calls.push(leagueId);
      return leagueId === league.id ? leagueARequest.promise : leagueBRequest.promise;
    });
    await Promise.resolve();
    runtime.switchLeague(leagueB);
    assert.doesNotMatch(nodeText(runtime.harness.output), /game-0/);

    const bGame = { ...games[0], id: 'game-b', home_team_id: 'team-b', home_team: { ...games[0].home_team!, id: 'team-b', name: 'Blue Blades' } };
    leagueBRequest.resolve({ kind: 'ready', scopeKey: 'league-b:season-b:all', season: { ...season, id: 'season-b' }, timezone: 'America/Toronto', games: [bGame] });
    await settle(runtime.harness);
    assert.match(nodeText(runtime.harness.output), /game-b/);

    leagueARequest.resolve({ kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games });
    await settle(runtime.harness);
    assert.match(nodeText(runtime.harness.output), /game-b/);
    assert.doesNotMatch(nodeText(runtime.harness.output), /game-0/);
    assert.deepEqual(calls, ['league-a', 'league-b']);
  });

  it('renders distinct loading, no-season, error, and unfiltered-empty states', async () => {
    const pending = deferred<any>();
    const loading = createRuntime(async () => pending.promise);
    assert.match(nodeText(loading.harness.output), /Loading schedule/);

    const noSeason = createRuntime(async () => ({ kind: 'no-season', scopeKey: 'league-a:no-season:all', season: null, timezone: null, games: [] }));
    await settle(noSeason.harness);
    assert.match(nodeText(noSeason.harness.output), /No current season is available/);
    assert.doesNotMatch(nodeText(noSeason.harness.output), /No games scheduled/);

    let attempts = 0;
    const error = createRuntime(async () => { attempts += 1; throw new Error('sensitive transport detail'); });
    await settle(error.harness);
    assert.match(nodeText(error.harness.output), /Couldn’t load schedule/);
    assert.doesNotMatch(nodeText(error.harness.output), /sensitive transport detail/);
    const retry = findNode(error.harness.output, (node) => node.type === 'Pressable' && node.props.accessibilityRole === 'button' && nodeText(node) === 'Retry')!;
    retry.props.onPress();
    await settle(error.harness);
    assert.equal(attempts, 2);

    const empty = createRuntime(async () => ({ kind: 'ready', scopeKey: 'league-a:season-a:all', season, timezone: 'America/Toronto', games: [] }));
    await settle(empty.harness);
    assert.match(nodeText(empty.harness.output), /No games scheduled for Winter/);
    assert.doesNotMatch(nodeText(empty.harness.output), /No current season is available|Couldn’t load schedule/);
  });
});
