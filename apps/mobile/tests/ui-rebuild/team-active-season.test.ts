/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compileCommonJs,
  createElement,
  createHookHarness,
  findNode,
  flattenStyle,
  nodeText,
} from './component-harness';

type Row = Record<string, any>;

const fixtures: Record<string, Row[]> = {
  teams: [{ id: 'team-current', league_id: 'league-a', name: 'North Stars', primary_color: '#22D3EE', secondary_color: '#2563EB', logo_url: null }],
  leagues: [{ id: 'league-a', name: 'Harbour League', slug: 'harbour' }],
  team_standings: [
    { team_id: 'team-current', season_id: 'season-current', wins: 8, losses: 2, ties: 1, points: 17, goals_for: 41, goals_against: 24, games_played: 11 },
    { team_id: 'team-current', season_id: 'season-old', wins: 99, losses: 0, ties: 0, points: 198, goals_for: 999, goals_against: 1, games_played: 99 },
  ],
  seasons: [
    { id: 'season-current', league_id: 'league-a', name: 'Fall 2026', status: 'active', start_date: '2026-09-01' },
    { id: 'season-old', league_id: 'league-a', name: 'Winter 2025', status: 'completed', start_date: '2025-01-01' },
  ],
  team_rosters: [
    { id: 'roster-ended', player_id: 'player-ended', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: '2026-09-11', jersey_number: 1, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-current', player_id: 'player-current', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 12, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-current-duplicate', player_id: 'player-current', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 88, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-returning', player_id: 'player-returning', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 27, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-historical', player_id: 'player-historical', team_id: 'team-current', league_id: 'league-a', season_id: 'season-old', status: 'active', end_date: null, jersey_number: 19, position: 'defense', is_goalie: false, leadership_role: null },
    { id: 'roster-wrong-team', player_id: 'player-wrong-team', team_id: 'team-other', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 2, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-wrong-league', player_id: 'player-wrong-league', team_id: 'team-current', league_id: 'league-b', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 3, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-inactive', player_id: 'player-inactive', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'inactive', end_date: null, jersey_number: 4, position: 'forward', is_goalie: false, leadership_role: null },
    { id: 'roster-null-season', player_id: 'player-null-season', team_id: 'team-current', league_id: 'league-a', season_id: null, status: 'active', end_date: null, jersey_number: 5, position: 'forward', is_goalie: false, leadership_role: null },
  ],
  profiles: [
    { id: 'player-current', full_name: 'Current Casey', email: 'casey@example.invalid' },
    { id: 'player-ended', full_name: 'Ended Evan', email: 'ended@example.invalid' },
    { id: 'player-returning', full_name: 'Returning Riley', email: 'returning@example.invalid' },
    { id: 'player-historical', full_name: 'Historical Harper', email: 'harper@example.invalid' },
    { id: 'player-wrong-team', full_name: 'Other Team Owen', email: 'owen@example.invalid' },
    { id: 'player-wrong-league', full_name: 'Other League Lena', email: 'lena@example.invalid' },
    { id: 'player-inactive', full_name: 'Inactive Izzy', email: 'izzy@example.invalid' },
    { id: 'player-null-season', full_name: 'Seasonless Sam', email: 'sam@example.invalid' },
  ],
  player_stats: [],
  player_season_stats: [
    { player_id: 'player-current', team_id: 'team-current', season_id: 'season-current', games_played: 4, goals: 2, assists: 3, points: 5 },
    { player_id: 'player-current', team_id: 'team-current', season_id: 'season-old', games_played: 20, goals: 40, assists: 50, points: 90 },
    { player_id: 'player-current', team_id: 'team-other', season_id: 'season-current', games_played: 8, goals: 20, assists: 30, points: 50 },
  ],
  games: [
    { id: 'game-current', league_id: 'league-a', season_id: 'season-current', home_team_id: 'team-current', away_team_id: 'opponent-current', scheduled_at: '2026-10-01T23:00:00.000Z', status: 'scheduled', location: 'Current Season Arena', home_score: null, away_score: null, home_team: { name: 'North Stars', primary_color: '#22D3EE' }, away_team: { name: 'Current Opponent', primary_color: '#2563EB' } },
    { id: 'game-old', league_id: 'league-a', season_id: 'season-old', home_team_id: 'team-current', away_team_id: 'opponent-old', scheduled_at: '2025-02-01T23:00:00.000Z', status: 'scheduled', location: 'Historical Arena', home_score: null, away_score: null, home_team: { name: 'North Stars', primary_color: '#22D3EE' }, away_team: { name: 'Historical Opponent', primary_color: '#999999' } },
  ],
};

function fixturesWithSecondRoute(): Record<string, Row[]> {
  return {
    ...fixtures,
    teams: [
      ...fixtures.teams,
      { id: 'team-b', league_id: 'league-b', name: 'Bay Blades', primary_color: '#8E7FFF', secondary_color: '#07111F', logo_url: null },
    ],
    leagues: [...fixtures.leagues, { id: 'league-b', name: 'Lakeside League', slug: 'lakeside' }],
    seasons: [...fixtures.seasons, { id: 'season-b', league_id: 'league-b', name: 'Fall 2026 B', status: 'active', start_date: '2026-09-02', created_at: '2026-08-02' }],
    team_rosters: [
      ...fixtures.team_rosters,
      { id: 'roster-b', player_id: 'player-b', team_id: 'team-b', league_id: 'league-b', season_id: 'season-b', status: 'active', end_date: null, jersey_number: 7, position: 'forward', is_goalie: false, leadership_role: null },
    ],
    profiles: [...fixtures.profiles, { id: 'player-b', full_name: 'Beta Blake', email: 'blake@example.invalid' }],
    player_season_stats: [...fixtures.player_season_stats, { player_id: 'player-b', team_id: 'team-b', season_id: 'season-b', games_played: 2, goals: 1, assists: 1, points: 2 }],
    games: [
      ...fixtures.games,
      { id: 'game-b', league_id: 'league-b', season_id: 'season-b', home_team_id: 'team-b', away_team_id: 'opponent-b', scheduled_at: '2026-10-02T23:00:00.000Z', status: 'scheduled', location: 'Bay Arena', home_score: null, away_score: null, home_team: { name: 'Bay Blades', primary_color: '#8E7FFF' }, away_team: { name: 'Bay Opponent', primary_color: '#22D3EE' } },
    ],
  };
}

function createSupabase(dataset = fixtures, errors: Record<string, { message: string }> = {}, userId: string | null = 'viewer-1') {
  type QueryRecord = {
    table: string;
    filters: Array<{ kind: 'eq' | 'in' | 'is' | 'or'; column?: string; value: unknown }>;
    orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean }>;
  };
  const queryRecords: QueryRecord[] = [];

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private maximum: number | null = null;
    private record: QueryRecord;

    constructor(private table: string) {
      this.record = { table, filters: [], orders: [] };
      queryRecords.push(this.record);
    }

    select() { return this; }
    eq(column: string, value: unknown) {
      this.record.filters.push({ kind: 'eq', column, value });
      this.filters.push((row) => row[column] === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.record.filters.push({ kind: 'in', column, value: [...values] });
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }
    is(column: string, value: unknown) {
      this.record.filters.push({ kind: 'is', column, value });
      this.filters.push((row) => row[column] === value);
      return this;
    }
    or(expression: string) {
      const choices = expression.split(',').map((part) => {
        const [column, , value] = part.split('.');
        return { column, value };
      });
      this.record.filters.push({ kind: 'or', value: expression });
      this.filters.push((row) => choices.some(({ column, value }) => row[column] === value));
      return this;
    }
    order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
      this.record.orders.push({ column, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst ?? false });
      return this;
    }
    limit(value: number) { this.maximum = value; return this; }
    private rows() {
      const rows = (dataset[this.table] ?? [])
        .filter((row) => this.filters.every((filter) => filter(row)))
        .slice()
        .sort((left, right) => {
          for (const order of this.record.orders) {
            const leftValue = left[order.column];
            const rightValue = right[order.column];
            const leftNull = leftValue == null;
            const rightNull = rightValue == null;
            if (leftNull !== rightNull) return leftNull === order.nullsFirst ? -1 : 1;
            if (leftNull) continue;
            const difference = String(leftValue).localeCompare(String(rightValue));
            if (difference !== 0) return order.ascending ? difference : -difference;
          }
          return 0;
        });
      return this.maximum == null ? rows : rows.slice(0, this.maximum);
    }
    async single() { return { data: this.rows()[0] ?? null, error: errors[this.table] ?? null }; }
    async maybeSingle() { return { data: this.rows()[0] ?? null, error: errors[this.table] ?? null }; }
    then(resolve: (value: { data: Row[]; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: this.rows(), error: errors[this.table] ?? null }).then(resolve, reject);
    }
  }

  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => new Query(table),
    queryRecords,
  };
}

function createRuntime({
  dataset = fixtures,
  errors = {},
  routeParams = { teamId: 'team-current', leagueId: 'league-a' },
  captainApi = {},
  width = 390,
  reduceTransparency = false,
  reduceMotion = false,
  userId = 'viewer-1' as string | null,
}: {
  dataset?: Record<string, Row[]>;
  errors?: Record<string, { message: string }>;
  routeParams?: { teamId: string; leagueId: string };
  captainApi?: Record<string, (...args: any[]) => any>;
  width?: number;
  reduceTransparency?: boolean;
  reduceMotion?: boolean;
  userId?: string | null;
} = {}) {
  const harness = createHookHarness();
  const navigationCalls: unknown[][] = [];
  const alerts: unknown[][] = [];
  const supabase = createSupabase(dataset, errors, userId);
  const teamData = compileCommonJs<{ getTeamActiveSeason: (leagueId: string) => Promise<unknown> }>(
    new URL('../../src/lib/supabase/team.ts', import.meta.url),
    { './client': { supabase } },
  );
  const colors = {
    primary: '#22D3EE', bgBase: '#07111F', bgSurface: 'rgba(12, 27, 49, 0.72)',
    bgInteractive: 'rgba(28, 42, 66, 0.84)', bgElevated: 'rgba(10, 22, 40, 0.88)',
    textPrimary: '#F7FBFF', textSecondary: '#A8B4C8', textOnPrimary: '#02111B',
    borderCard: 'rgba(255, 255, 255, 0.1)', glassStrokeStrong: 'rgba(96, 165, 250, 0.28)',
    accentGreen: '#22C55E', accentRed: '#EF4444',
  };

  const TeamDetailScreen = compileCommonJs<{ default: (props: Record<string, any>) => unknown }>(
    new URL('../../src/screens/TeamScreen/TeamDetailScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': {
        ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args: unknown[]) => alerts.push(args) }, Modal: 'Modal',
        Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: { position: 'absolute', inset: 0 }, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width, height: 844 }),
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { Ionicons: 'Ionicon' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'expo-linking': { openURL: async () => {} },
      '../../components/Avatar': (props: Record<string, unknown>) => createElement('Avatar', props),
      '../../components/BrandAtmosphere': (props: Record<string, unknown>) => createElement('BrandAtmosphere', props),
      '../../components/GameCard': (props: Record<string, unknown>) => createElement('GameCard', props),
      '../../components/TeamLogo': (props: Record<string, unknown>) => createElement('TeamLogo', props),
      '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion, reduceTransparency }) },
      '../../lib/supabase/checkins': { getGameCheckinSummary: async () => ({ confirmed: [], tentative: [], out: [], total: 0 }) },
      '../../lib/supabase/captain': {
        clearPlayerCheckinAsCaptain: async () => ({ success: true }), createGoalieRequest: async () => ({ success: true }),
        getCaptainRole: async () => null, getGameCheckinStatusMap: async () => ({}), getLeagueSubPlayers: async () => ({ success: true, data: [] }),
        getOpenGoalieRequest: async () => null, getRecentTeamMessages: async () => [], getTeamSubInvitations: async () => ({ data: [] }),
        inviteSub: async () => ({ success: true }), postTeamMessage: async () => ({ success: true }), updatePlayerCheckinAsCaptain: async () => ({ success: true }),
        ...captainApi,
      },
      '../../lib/supabase/client': { supabase },
      '../../lib/supabase/data': { mapGameStatus: (status: string) => status === 'completed' ? 'Final' : 'Upcoming' },
      '../../lib/supabase/team': { getTeamActiveSeason: teamData.getTeamActiveSeason },
      '../../navigation/playerCard': { navigateToPlayerCard: (...args: unknown[]) => navigationCalls.push(args) },
      '../../theme/colors': { default: colors },
      '../../theme/ui': { ui: { minTouchTarget: 44, radius: { card: 18, panel: 24 } } },
    },
  ).default;

  harness.mount(() => TeamDetailScreen({
    route: { params: routeParams },
    navigation: { goBack: () => {}, navigate: (...args: unknown[]) => navigationCalls.push(args) },
  }));

  return { alerts, harness, navigationCalls, queryRecords: supabase.queryRecords, routeParams };
}

async function settle(runtime: ReturnType<typeof createRuntime>) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    runtime.harness.render();
  }
  return runtime.harness.output;
}

describe('Team active-season data boundary', () => {
  it('excludes historical active-status memberships from the rendered roster', async () => {
    const output = await settle(createRuntime());
    const text = nodeText(output);

    assert.match(text, /Current Casey/);
    assert.doesNotMatch(text, /Historical Harper/);
  });

  it('deduplicates returning-player memberships and rejects every mismatched membership boundary', async () => {
    const runtime = createRuntime();
    const text = nodeText(await settle(runtime));

    assert.equal(text.match(/Current Casey/g)?.length, 1);
    assert.match(text, /Returning RileyF0GP0G0A0PTS/);
    for (const excludedName of ['Ended Evan', 'Other Team Owen', 'Other League Lena', 'Inactive Izzy', 'Seasonless Sam']) {
      assert.doesNotMatch(text, new RegExp(excludedName));
    }
    const rosterQuery = runtime.queryRecords.find((query) => query.table === 'team_rosters');
    assert.ok(rosterQuery?.filters.some((filter) => filter.kind === 'is' && filter.column === 'end_date' && filter.value === null));
  });

  it('shows an explicit empty state when the league has no active season', async () => {
    const dataset = { ...fixtures, seasons: fixtures.seasons.filter((season) => season.status !== 'active') };
    const text = nodeText(await settle(createRuntime({ dataset })));

    assert.match(text, /No active season/);
    assert.match(text, /Roster and schedule/);
    assert.doesNotMatch(text, /Historical Harper/);
  });

  it('keeps the same roster, record, and playoff game visible after auto-advance', async () => {
    const dataset: Record<string, Row[]> = {
      ...fixtures,
      seasons: fixtures.seasons.map((season) =>
        season.id === 'season-current' ? { ...season, status: 'playoffs', name: 'Fall 2026 Playoffs' } : season
      ),
    };
    const text = nodeText(await settle(createRuntime({ dataset })));

    assert.match(text, /Fall 2026 Playoffs/);
    assert.match(text, /8-2-1/);
    assert.match(text, /Current Casey|Returning Riley/);
    assert.match(text, /Current Opponent|Current Season Arena/);
    assert.doesNotMatch(text, /No active season/);
  });

  it('shows a load error rather than an empty success when active-season lookup fails', async () => {
    const text = nodeText(await settle(createRuntime({ errors: { seasons: { message: 'offline fixture failure' } } })));

    assert.match(text, /Unable to load team/);
    assert.match(text, /active season/);
    assert.doesNotMatch(text, /No active season/);
  });

  it('renders roster stats and schedule from the same active season and team only', async () => {
    const text = nodeText(await settle(createRuntime()));

    assert.match(text, /GP/);
    assert.match(text, /Current Casey/);
    assert.match(text, /Current CaseyF4GP2G3A5PTS/);
    assert.match(text, /Current Opponent/);
    assert.match(text, /Current Season Arena/);
    assert.doesNotMatch(text, /Historical Opponent|Historical Arena|90/);
  });

  it('ignores captain data that resolves after the route changes to another team and league', async () => {
    let releaseOldCaptain!: (role: string) => void;
    let markOldCaptainStarted!: () => void;
    const oldCaptainStarted = new Promise<void>((resolve) => { markOldCaptainStarted = resolve; });
    const dataset = fixturesWithSecondRoute();
    const routeParams = { teamId: 'team-current', leagueId: 'league-a' };
    const runtime = createRuntime({
      dataset,
      routeParams,
      captainApi: {
        getCaptainRole: async (teamId: string) => {
          if (teamId !== 'team-current') return null;
          markOldCaptainStarted();
          return new Promise<string>((resolve) => { releaseOldCaptain = resolve; });
        },
        getRecentTeamMessages: async (teamId: string) => teamId === 'team-current' ? [{ id: 'old-message', subject: 'Old Captain Bulletin', message: 'Old team only', createdAt: null, isUrgent: false, sentBy: null }] : [],
      },
    });

    await oldCaptainStarted;
    routeParams.teamId = 'team-b';
    routeParams.leagueId = 'league-b';
    runtime.harness.render();
    await settle(runtime);
    releaseOldCaptain('captain');
    const text = nodeText(await settle(runtime));

    assert.match(text, /Bay Blades|Beta Blake/);
    assert.doesNotMatch(text, /Old Captain Bulletin|Old team only|Captain Center/);
  });

  it('clears open dialogs, drafts, caches, saving state, and public A data when the route becomes B', async () => {
    let releaseBRole!: (role: string) => void;
    let markBRoleStarted!: () => void;
    const bRoleStarted = new Promise<void>((resolve) => { markBRoleStarted = resolve; });
    const routeParams = { teamId: 'team-current', leagueId: 'league-a' };
    const runtime = createRuntime({
      dataset: fixturesWithSecondRoute(),
      routeParams,
      captainApi: {
        getCaptainRole: async (teamId: string) => {
          if (teamId === 'team-current') return 'captain';
          markBRoleStarted();
          return new Promise<string>((resolve) => { releaseBRole = resolve; });
        },
        getLeagueSubPlayers: async () => ({ success: true, data: [{ id: 'sub-a', full_name: 'Alpha Sub', email: 'alpha@example.invalid' }] }),
      },
    });
    let output = await settle(runtime);
    findNode(output, (node) => node.props.testID === 'team-captain-reminder-action')?.props.onPress();
    findNode(output, (node) => node.props.testID === 'team-captain-sub-action')?.props.onPress();
    findNode(output, (node) => node.props.testID === 'team-captain-goalie-action')?.props.onPress();
    output = await settle(runtime);
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Write the reminder to your team...')?.props.onChangeText('A reminder draft');
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Optional message to the player...')?.props.onChangeText('A sub draft');
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Anything the goalie should know...')?.props.onChangeText('A goalie draft');
    runtime.harness.render();

    routeParams.teamId = 'team-b';
    routeParams.leagueId = 'league-b';
    runtime.harness.render();
    await bRoleStarted;
    output = runtime.harness.output;
    assert.doesNotMatch(nodeText(output), /North Stars|Current Casey|A reminder draft|A sub draft|A goalie draft|Alpha Sub/);
    assert.equal(findNode(output, (node) => node.type === 'Modal' && node.props.visible === true), undefined);

    releaseBRole('captain');
    output = await settle(runtime);
    findNode(output, (node) => node.props.testID === 'team-captain-reminder-action')?.props.onPress();
    findNode(output, (node) => node.props.testID === 'team-captain-goalie-action')?.props.onPress();
    output = runtime.harness.render();
    assert.equal(findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Anything the goalie should know...')?.props.value, '');
    assert.equal(findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Example: "Free", "$20", "Beer"')?.props.value, 'Free');
    assert.doesNotMatch(nodeText(output), /A reminder draft|A sub draft|A goalie draft|Alpha Sub/);
  });

  it('ignores delayed A sub candidates and refetches B candidates with clean defaults', async () => {
    let releaseACandidates!: (result: Row) => void;
    let markACandidatesStarted!: () => void;
    const aCandidatesStarted = new Promise<void>((resolve) => { markACandidatesStarted = resolve; });
    const calls: string[][] = [];
    const routeParams = { teamId: 'team-current', leagueId: 'league-a' };
    const runtime = createRuntime({
      dataset: fixturesWithSecondRoute(),
      routeParams,
      captainApi: {
        getCaptainRole: async () => 'captain',
        getLeagueSubPlayers: async (leagueId: string, teamId: string) => {
          calls.push([leagueId, teamId]);
          if (teamId === 'team-current') {
            markACandidatesStarted();
            return new Promise<Row>((resolve) => { releaseACandidates = resolve; });
          }
          return { success: true, data: [{ id: 'sub-b', full_name: 'Beta Sub', email: 'beta@example.invalid' }] };
        },
      },
    });
    let output = await settle(runtime);
    findNode(output, (node) => node.props.testID === 'team-captain-sub-action')?.props.onPress();
    await aCandidatesStarted;
    output = runtime.harness.render();
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Optional message to the player...')?.props.onChangeText('A-only invite');
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Search by name or email...')?.props.onChangeText('Alpha');
    runtime.harness.render();

    routeParams.teamId = 'team-b';
    routeParams.leagueId = 'league-b';
    runtime.harness.render();
    await settle(runtime);
    releaseACandidates({ success: true, data: [{ id: 'sub-a', full_name: 'Alpha Sub', email: 'alpha@example.invalid' }] });
    output = await settle(runtime);
    assert.doesNotMatch(nodeText(output), /Alpha Sub|A-only invite/);

    findNode(output, (node) => node.props.testID === 'team-captain-sub-action')?.props.onPress();
    output = await settle(runtime);
    assert.deepEqual(calls, [['league-a', 'team-current'], ['league-b', 'team-b']]);
    assert.match(nodeText(output), /Beta Sub/);
    assert.equal(findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Optional message to the player...')?.props.value, '');
    assert.equal(findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Search by name or email...')?.props.value, '');
  });

  it('keeps an issued reminder mutation on A and ignores its stale completion after switching to B', async () => {
    let releasePost!: (result: Row) => void;
    let markPostStarted!: () => void;
    const postStarted = new Promise<void>((resolve) => { markPostStarted = resolve; });
    const payloads: Row[] = [];
    const messageReads: string[] = [];
    const routeParams = { teamId: 'team-current', leagueId: 'league-a' };
    const runtime = createRuntime({
      dataset: fixturesWithSecondRoute(),
      routeParams,
      captainApi: {
        getCaptainRole: async () => 'captain',
        getRecentTeamMessages: async (teamId: string) => { messageReads.push(teamId); return []; },
        postTeamMessage: async (payload: Row) => {
          payloads.push(payload);
          markPostStarted();
          return new Promise<Row>((resolve) => { releasePost = resolve; });
        },
      },
    });
    let output = await settle(runtime);
    findNode(output, (node) => node.props.testID === 'team-captain-reminder-action')?.props.onPress();
    output = runtime.harness.render();
    findNode(output, (node) => node.type === 'TextInput' && node.props.placeholder === 'Write the reminder to your team...')?.props.onChangeText('A-only reminder');
    output = runtime.harness.render();
    findNode(output, (node) => node.type === 'Pressable' && nodeText(node) === 'Send Reminder')?.props.onPress();
    await postStarted;

    routeParams.teamId = 'team-b';
    routeParams.leagueId = 'league-b';
    runtime.harness.render();
    await settle(runtime);
    releasePost({ success: true });
    output = await settle(runtime);

    assert.deepEqual(payloads, [{
      teamId: 'team-current',
      seasonId: 'season-current',
      subject: 'Check-in reminder vs Current Opponent',
      message: 'A-only reminder',
      messageType: 'checkin_reminder',
      isUrgent: true,
    }]);
    assert.deepEqual(messageReads, ['team-current', 'team-b']);
    assert.deepEqual(runtime.alerts, []);
    assert.doesNotMatch(nodeText(output), /A-only reminder/);
  });

  it('ignores an A reminder refresh that resolves after B has loaded', async () => {
    let releaseARefresh!: (messages: Row[]) => void;
    let markARefreshStarted!: () => void;
    const aRefreshStarted = new Promise<void>((resolve) => { markARefreshStarted = resolve; });
    let aReads = 0;
    const routeParams = { teamId: 'team-current', leagueId: 'league-a' };
    const runtime = createRuntime({
      dataset: fixturesWithSecondRoute(),
      routeParams,
      captainApi: {
        getCaptainRole: async () => 'captain',
        postTeamMessage: async () => ({ success: true }),
        getRecentTeamMessages: async (teamId: string) => {
          if (teamId !== 'team-current') return [];
          aReads += 1;
          if (aReads === 1) return [];
          markARefreshStarted();
          return new Promise<Row[]>((resolve) => { releaseARefresh = resolve; });
        },
      },
    });
    let output = await settle(runtime);
    findNode(output, (node) => node.props.testID === 'team-captain-reminder-action')?.props.onPress();
    output = runtime.harness.render();
    findNode(output, (node) => node.type === 'Pressable' && nodeText(node) === 'Send Reminder')?.props.onPress();
    await aRefreshStarted;

    routeParams.teamId = 'team-b';
    routeParams.leagueId = 'league-b';
    runtime.harness.render();
    await settle(runtime);
    releaseARefresh([{ id: 'stale-a', subject: 'Stale A Bulletin', message: 'A only', createdAt: null, isUrgent: true, sentBy: null }]);
    output = await settle(runtime);

    assert.doesNotMatch(nodeText(output), /Stale A Bulletin|A only/);
    assert.deepEqual(runtime.alerts, []);
  });

  it('adapts the pinned web Team identity, active-season record, roster, and glass treatment for 320pt native', async () => {
    const output = await settle(createRuntime({ width: 320 }));
    const hero = findNode(output, (node) => node.props.testID === 'team-identity-hero');
    assert.ok(hero);
    assert.match(nodeText(hero), /Harbour League/);
    assert.match(nodeText(hero), /Fall 2026/);
    assert.match(nodeText(hero), /North Stars/);
    assert.match(nodeText(hero), /8-2-1/);
    assert.equal(flattenStyle(hero.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(flattenStyle(hero.props.style).borderColor, 'rgba(125, 190, 255, 0.22)');

    const rosterCard = findNode(output, (node) => node.props.testID === 'team-roster-card');
    assert.ok(rosterCard);
    assert.equal(flattenStyle(rosterCard.props.style).backgroundColor, 'rgba(10, 22, 40, 0.30)');
    assert.equal(findNode(rosterCard, (node) => node.type === 'ScrollView' && node.props.horizontal === true), undefined);

    const playerName = findNode(rosterCard, (node) => node.type === 'Text' && nodeText(node) === 'Current Casey');
    assert.ok(playerName);
    assert.equal(playerName.props.numberOfLines, undefined);
    const nameWrap = findNode(rosterCard, (node) => node.props.testID === 'team-roster-identity-player-current');
    assert.ok(nameWrap);
    assert.equal(flattenStyle(nameWrap.props.style).flexBasis, 'auto');
  });

  it('uses the opaque Team fallback when reduced transparency is enabled', async () => {
    const output = await settle(createRuntime({ reduceTransparency: true, reduceMotion: true }));
    const hero = findNode(output, (node) => node.props.testID === 'team-identity-hero');
    assert.ok(hero);
    assert.equal(flattenStyle(hero.props.style).backgroundColor, '#0C1B31');
    assert.equal(flattenStyle(hero.props.style).borderColor, '#41607F');
    const modal = findNode(output, (node) => node.type === 'Modal');
    assert.ok(modal);
    assert.equal(modal.props.animationType, 'none');
  });

  it('renders explicit active-season empty and missing-team states', async () => {
    const emptyDataset = { ...fixtures, team_rosters: [] };
    const emptyText = nodeText(await settle(createRuntime({ dataset: emptyDataset })));
    assert.match(emptyText, /Active Roster/);
    assert.match(emptyText, /No active players/);

    const missingDataset = { ...fixtures, teams: [] };
    const missingText = nodeText(await settle(createRuntime({ dataset: missingDataset })));
    assert.match(missingText, /Team not found/);
    assert.match(missingText, /selected league/);
  });

  it('retains member, captain, game, chat, and player actions while guests remain read-only', async () => {
    const member = createRuntime({
      userId: 'player-current',
      captainApi: { getCaptainRole: async () => 'captain' },
    });
    const memberOutput = await settle(member);
    for (const testID of [
      'team-open-game-action',
      'team-chat-action',
      'team-captain-reminder-action',
      'team-captain-sub-action',
      'team-captain-goalie-action',
      'team-roster-player-player-current',
    ]) {
      const action = findNode(memberOutput, (node) => node.props.testID === testID);
      assert.ok(action, `Missing preserved action: ${testID}`);
      const style = typeof action.props.style === 'function' ? action.props.style({ pressed: false }) : action.props.style;
      assert.ok((flattenStyle(style).minHeight ?? 0) >= 44, `${testID} must be a 44pt target`);
    }

    findNode(memberOutput, (node) => node.props.testID === 'team-chat-action')?.props.onPress();
    assert.ok(member.navigationCalls.some((call) => call[0] === 'TeamChat'));

    const guest = createRuntime({ userId: null });
    const guestOutput = await settle(guest);
    assert.equal(findNode(guestOutput, (node) => node.props.testID === 'team-chat-action'), undefined);
    assert.equal(findNode(guestOutput, (node) => node.props.testID === 'team-captain-reminder-action'), undefined);
    findNode(guestOutput, (node) => node.props.testID === 'team-roster-player-player-current')?.props.onPress();
    assert.ok(guest.navigationCalls.length > 0, 'Read-only visitors retain player-card navigation');
  });

  it('keeps game-specific substitute check-ins out of active-roster availability counts', async () => {
    const output = await settle(createRuntime({
      captainApi: {
        getCaptainRole: async () => 'captain',
        getGameCheckinStatusMap: async () => ({
          'player-current': 'confirmed',
          'outside-game-sub': 'out',
        }),
      },
    }));

    assert.match(nodeText(output), /1IN0MAYBE0OUT1WAITING/);
  });

  it('opts Team schedule into wrapping GameCard presentation while preserving navigation semantics', async () => {
    const runtime = createRuntime();
    const output = await settle(runtime);
    const gameCard = findNode(output, (node) => node.type === 'GameCard' && node.props.gameId === 'game-current');
    const goBack = findNode(output, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Go back');

    assert.equal(gameCard?.props.visualVariant, 'homeEditorial');
    assert.equal(goBack?.props.accessibilityRole, 'button');

    gameCard?.props.onPress();
    assert.deepEqual(runtime.navigationCalls, [[
      'Schedule',
      { screen: 'GamePreview', params: { gameId: 'game-current' } },
    ]]);
  });

  it('keeps long 320pt identities, jersey zero, goalie and captain labels, and venue data intact', async () => {
    const longPlayerName = 'Alexandria Very Long Goaltender-Captain Name';
    const longVenue = 'Municipal Community Recreation Complex Rink Number Twelve';
    const dataset: Record<string, Row[]> = {
      ...fixtures,
      teams: [{ ...fixtures.teams[0], name: 'North Shore Metropolitan Community Hockey Club' }],
      leagues: [{ ...fixtures.leagues[0], name: 'Greater Harbour Metropolitan Thursday Night Hockey League' }],
      team_rosters: [
        ...fixtures.team_rosters,
        { id: 'roster-zero', player_id: 'player-zero', team_id: 'team-current', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, jersey_number: 0, position: 'goaltender', is_goalie: true, leadership_role: 'captain' },
      ],
      profiles: [...fixtures.profiles, { id: 'player-zero', full_name: longPlayerName, avatar_url: null }],
      games: fixtures.games.map((game) => game.id === 'game-current' ? { ...game, location: longVenue } : game),
    };
    const output = await settle(createRuntime({ dataset, width: 320 }));
    const text = nodeText(output);

    assert.match(text, new RegExp(longPlayerName));
    assert.match(text, /#0/);
    assert.match(text, /G · C/);
    assert.match(text, new RegExp(longVenue));
    assert.ok(text.indexOf('#0') < text.indexOf('#12'), 'Jersey zero sorts before jersey twelve');
    const playerName = findNode(output, (node) => node.type === 'Text' && nodeText(node) === longPlayerName);
    assert.ok(playerName);
    assert.equal(playerName.props.numberOfLines, undefined);
    const gameCard = findNode(output, (node) => node.type === 'GameCard' && node.props.gameId === 'game-current');
    assert.equal(gameCard?.props.location, longVenue);
  });
});
