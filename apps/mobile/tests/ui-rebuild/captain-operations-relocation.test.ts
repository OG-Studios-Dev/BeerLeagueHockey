/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const routeParams = { gameId: 'game-1', teamId: 'team-1', leagueId: HOCKEY_LIFE_ID };
const roster = [{
  id: 'roster-1', player_id: 'player-1', team_id: 'team-1', jersey_number: 9,
  position: 'F', is_goalie: false, player_name: 'Alex Skater', avatar_url: null,
}];
const validGame = {
  id: 'game-1', league_id: HOCKEY_LIFE_ID, scheduled_at: '2026-10-10T20:00:00.000Z',
  season_id: 'fall-2026', location: 'Rink A', home_team_id: 'team-1', away_team_id: 'team-2',
  home_team: { name: 'Owls' }, away_team: { name: 'Foxes' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(h: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
    h.render();
  }
}

function nativeMock(onAlert: (...args: any[]) => void = () => {}, onOpenUrl: (url: string) => unknown = async () => undefined) {
  return {
    ActivityIndicator: 'ActivityIndicator', ImageBackground: 'ImageBackground', Modal: ({ visible, children }: any) => visible ? createElement('Modal', {}, children) : null,
    Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: (p: any) => createElement('ScrollView', p, p.children),
    Text: 'Text', TextInput: 'TextInput', View: 'View', Alert: { alert: onAlert }, Linking: { openURL: onOpenUrl },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {}, absoluteFillObject: {} },
  };
}

function resultBuilder(result: any) {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder, is: () => builder,
    neq: () => builder, or: () => builder, gte: () => builder, order: () => builder,
    limit: () => builder, maybeSingle: async () => result, single: async () => result,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

type DashboardQueryCall = {
  table: string;
  select?: { columns: string; options?: any };
  predicates: Array<{ method: 'eq' | 'in' | 'is' | 'or' | 'gte'; column?: string; value: any }>;
  orders: Array<{ column: string; options?: any }>;
  limit?: number;
};

const activeSeason = {
  id: 'fall-2026', name: 'Fall 2026', start_date: '2026-09-01', end_date: null,
  status: 'active', created_at: '2026-08-01T00:00:00.000Z',
};

const dashboardRosterRows = [
  {
    team_id: 'team-current', league_id: HOCKEY_LIFE_ID, season_id: activeSeason.id,
    leadership_role: 'captain', status: 'active', end_date: null,
    team: { id: 'team-current', name: 'Bad Bunny', logo_url: null, primary_color: '#123456' },
    league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Vancouver' },
  },
  {
    team_id: 'team-completed', league_id: HOCKEY_LIFE_ID, season_id: 'winter-2025',
    leadership_role: 'captain', status: 'active', end_date: null,
    team: { id: 'team-completed', name: 'Completed Captains', logo_url: null, primary_color: '#654321' },
    league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
  },
  {
    team_id: 'team-archived', league_id: HOCKEY_LIFE_ID, season_id: 'summer-2024',
    leadership_role: 'alternate_captain', status: 'active', end_date: null,
    team: { id: 'team-archived', name: 'Archived Alternates', logo_url: null, primary_color: '#abcdef' },
    league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
  },
];

function dashboardBuilder(call: DashboardQueryCall, resolveResult: () => any) {
  const builder: any = {
    select: (columns: string, options?: any) => { call.select = { columns, options }; return builder; },
    eq: (column: string, value: any) => { call.predicates.push({ method: 'eq', column, value }); return builder; },
    in: (column: string, value: any) => { call.predicates.push({ method: 'in', column, value }); return builder; },
    is: (column: string, value: any) => { call.predicates.push({ method: 'is', column, value }); return builder; },
    or: (value: string) => { call.predicates.push({ method: 'or', value }); return builder; },
    gte: (column: string, value: any) => { call.predicates.push({ method: 'gte', column, value }); return builder; },
    order: (column: string, options?: any) => { call.orders.push({ column, options }); return builder; },
    limit: (value: number) => { call.limit = value; return builder; },
    maybeSingle: async () => resolveResult(),
    then: (resolve: any, reject: any) => Promise.resolve(resolveResult()).then(resolve, reject),
  };
  return builder;
}

function mountDashboard(options: {
  user?: any;
  seasonLoader?: (...args: any[]) => Promise<any>;
  resolveQuery?: (call: DashboardQueryCall, fallback: any) => any;
  reduceTransparency?: boolean;
  openUrl?: (url: string) => unknown;
} = {}) {
  const h = createHookHarness();
  let dashboardUser = options.user ?? { id: 'captain-1' };
  const calls: { season: any[][]; queries: DashboardQueryCall[]; navigate: any[][]; openedUrls: string[]; alerts: any[][] } = {
    season: [], queries: [], navigate: [], openedUrls: [], alerts: [],
  };
  const currentGame = {
    ...validGame,
    id: 'game-current',
    home_team_id: 'team-current',
    season_id: activeSeason.id,
  };
  const hasPredicate = (call: DashboardQueryCall, method: string, column: string, value: any) =>
    call.predicates.some(predicate => predicate.method === method && predicate.column === column && predicate.value === value);

  const openUrl = (url: string) => {
    calls.openedUrls.push(url);
    return options.openUrl ? options.openUrl(url) : Promise.resolve();
  };
  const publicLinkMock = {
    openPublicLink: async (url: string, opener: (approvedUrl: string) => Promise<unknown>) => {
      try { await opener(url); return { success: true }; } catch { return { success: false, error: 'This link could not be opened. Please try again.' }; }
    },
  };
  const captainLinkMock = {
    HOCKEY_LIFE_CAPTAIN_URL: 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain',
    HOCKEY_LIFE_CAPTAIN_FEES_URL: 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/fees',
    buildHockeyLifeCaptainLineupUrl: (gameId: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(gameId)
      ? `https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/${encodeURIComponent(gameId)}?mode=lineup`
      : null,
  };

  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url), {
    react: h.react,
    'react-native': nativeMock((...args: any[]) => calls.alerts.push(args), openUrl),
    '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../assets/team-page/weekly-games-bg.jpg': 'weekly-games-bg',
    '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (value: any) => value },
    '../../components/TeamLogo': () => null,
    '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: options.reduceTransparency ?? false }) },
    '../../context/AuthContext': { useAuth: () => ({ user: dashboardUser }) },
    '../../config/hockeyLife': { HOCKEY_LIFE_ID },
    '../../config/publicLinks': captainLinkMock,
    '../../lib/publicLinks': publicLinkMock,
    '../../lib/supabase/team': {
      getTeamActiveSeason: async (...args: any[]) => {
        calls.season.push(args);
        if (options.seasonLoader) return options.seasonLoader(...args);
        return { season: activeSeason, error: null };
      },
    },
    '../../lib/supabase/client': { supabase: { from: (table: string) => {
      const call: DashboardQueryCall = { table, predicates: [], orders: [] };
      calls.queries.push(call);
      return dashboardBuilder(call, () => {
        let fallback: any;
        if (table === 'games') fallback = { data: currentGame, error: null };
        else if (call.select?.options?.head) fallback = { count: 12, error: null };
        else {
          const hasSeasonScope = hasPredicate(call, 'eq', 'season_id', activeSeason.id);
          fallback = {
            data: hasSeasonScope
              ? dashboardRosterRows.filter(row => row.season_id === activeSeason.id)
              : dashboardRosterRows,
            error: null,
          };
        }
        return options.resolveQuery ? options.resolveQuery(call, fallback) : fallback;
      });
    } } },
    '../../theme/colors': { __esModule: true, default: {
      bgBase: '#000', bgSurface: '#111', bgElevated: '#181818', bgInteractive: '#222',
      textPrimary: '#fff', textSecondary: '#aaa', primary: '#06f', brandGold: '#fc0',
      accentViolet: '#a0f', glassStroke: '#333', glassHighlight: '#191919',
    } },
  }).default;

  h.mount(() => Screen({ navigation: { navigate: (...args: any[]) => calls.navigate.push(args), goBack() {} } }));
  return {
    h,
    calls,
    setUser(user: any) {
      dashboardUser = user;
      h.render();
    },
    setUserBeforeEffects(user: any) {
      dashboardUser = user;
      const useEffect = h.react.useEffect;
      h.react.useEffect = ((_effect: () => void | (() => void), _dependencies?: readonly unknown[]) => {
        h.react.useRef(null);
      }) as typeof useEffect;
      try {
        return h.render();
      } finally {
        h.react.useEffect = useEffect;
      }
    },
  };
}

describe('captain dashboard active-season scoping', () => {
  it('renders the exact two-section dashboard from the current active-season team and removes roster-count work', async () => {
    const run = mountDashboard();
    await settle(run.h);
    await settle(run.h);

    const rendered = nodeText(run.h.output);
    const gameDay = findNode(run.h.output, node => node.props.testID === 'captain-game-day-section');
    const seasonTools = findNode(run.h.output, node => node.props.testID === 'captain-season-tools-section');
    assert.ok(gameDay);
    assert.ok(seasonTools);
    assert.match(nodeText(gameDay), /Game Day/);
    assert.match(nodeText(gameDay), /vs Foxes/);
    assert.match(nodeText(gameDay), /Sat, Oct 10/);
    assert.match(nodeText(gameDay), /1:00 p\.m\./);
    assert.match(nodeText(gameDay), /Rink A/);
    assert.match(nodeText(seasonTools), /Season Tools/);
    assert.match(nodeText(seasonTools), /Team fees/);
    assert.doesNotMatch(rendered, /Completed Captains|Archived Alternates|Your Teams|\bRoster\b|Next Game|Our Lineup/);

    const actionLabels = ['Edit attendance', 'Invite sub', 'Set lineup', 'Score game'];
    const actionNodes = actionLabels.map(label => findNode(gameDay, node => node.props.accessibilityLabel === label));
    assert.equal(actionNodes.every(Boolean), true, `missing action in ${nodeText(gameDay)}`);
    assert.deepEqual(actionNodes.map(node => node?.props.testID), [
      'captain-edit-attendance', 'captain-invite-sub', 'captain-set-lineup', 'captain-score-game',
    ]);

    assert.deepEqual(run.calls.season, [[HOCKEY_LIFE_ID]]);
    const leadership = run.calls.queries.find(call => call.table === 'team_rosters');
    assert.ok(leadership);
    assert.match(leadership.select?.columns ?? '', /league:leagues[^)]*timezone/);
    assert.deepEqual(leadership.predicates, [
      { method: 'eq', column: 'player_id', value: 'captain-1' },
      { method: 'eq', column: 'league_id', value: HOCKEY_LIFE_ID },
      { method: 'eq', column: 'season_id', value: activeSeason.id },
      { method: 'eq', column: 'status', value: 'active' },
      { method: 'is', column: 'end_date', value: null },
      { method: 'in', column: 'leadership_role', value: ['captain', 'alternate_captain'] },
    ]);
    assert.equal(run.calls.queries.filter(call => call.table === 'team_rosters').length, 1, 'roster-count query is removed');

    const nextGame = run.calls.queries.find(call => call.table === 'games');
    assert.ok(nextGame);
    assert.deepEqual(nextGame.predicates.slice(0, 4), [
      { method: 'eq', column: 'league_id', value: HOCKEY_LIFE_ID },
      { method: 'eq', column: 'season_id', value: activeSeason.id },
      { method: 'or', value: 'home_team_id.eq.team-current,away_team_id.eq.team-current' },
      { method: 'eq', column: 'status', value: 'scheduled' },
    ]);
    assert.equal(nextGame.predicates[4]?.method, 'gte');
    assert.equal(nextGame.predicates[4]?.column, 'scheduled_at');
    assert.equal(Number.isFinite(Date.parse(nextGame.predicates[4]?.value)), true);
    assert.deepEqual(nextGame.orders, [
      { column: 'scheduled_at', options: { ascending: true } },
      { column: 'id', options: { ascending: true } },
    ]);
    assert.equal(nextGame.limit, 1);
  });

  it('renders visible Rink TBD metadata before actions when the scheduled game location is null', async () => {
    const run = mountDashboard({
      resolveQuery: (call, fallback) => call.table === 'games'
        ? { data: { ...validGame, id: 'game-current', home_team_id: 'team-current', location: null }, error: null }
        : fallback,
    });
    await settle(run.h);

    const gameDay = findNode(run.h.output, node => node.props.testID === 'captain-game-day-section');
    const metadata = findNode(gameDay, node => node.props.testID === 'captain-game-metadata');
    const actions = findNode(gameDay, node => node.props.testID === 'captain-game-actions');
    assert.ok(gameDay && metadata && actions);
    assert.match(nodeText(metadata), /Rink TBD/);
    assert.ok(gameDay.props.children.indexOf(gameDay.props.children.find((child: any) => findNode(child, node => node.props.testID === 'captain-game-metadata'))) < gameDay.props.children.indexOf(actions));
  });

  it('selects one global upcoming game by scheduled time, team name, team ID, and game ID', async () => {
    const row = (teamId: string, teamName: string) => ({
      team_id: teamId, league_id: HOCKEY_LIFE_ID, season_id: activeSeason.id,
      leadership_role: 'captain', status: 'active', end_date: null,
      team: { id: teamId, name: teamName, primary_color: '#123456' },
      league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
    });
    const rows = [
      row('team-late', 'Aardvarks'), row('team-z', 'Zulu'), row('team-b', 'Alpha'),
      row('team-a', 'Alpha'), row('team-a', 'Alpha'),
    ];
    const game = (teamId: string, id: string, scheduledAt: string, opponent: string) => ({
      id, scheduled_at: scheduledAt, location: 'Selection Rink', home_team_id: teamId, away_team_id: `opponent-${id}`,
      home_team: { name: 'Captain Team' }, away_team: { name: opponent },
    });
    const gamesByTeam: Record<string, any[]> = {
      'team-late': [game('team-late', 'game-late', '2026-10-21T20:00:00.000Z', 'Later Opponent')],
      'team-z': [game('team-z', 'game-zulu', '2026-10-20T20:00:00.000Z', 'Zulu Opponent')],
      'team-b': [game('team-b', 'game-team-b', '2026-10-20T20:00:00.000Z', 'Team B Opponent')],
      'team-a': [
        game('team-a', 'game-z', '2026-10-20T20:00:00.000Z', 'Game ID Loser'),
        game('team-a', 'game-a', '2026-10-20T20:00:00.000Z', 'Game ID Winner'),
      ],
    };
    const run = mountDashboard({
      resolveQuery: (call, fallback) => {
        if (call.table === 'team_rosters') return { data: rows, error: null };
        if (call.table !== 'games') return fallback;
        const scope = call.predicates.find(predicate => predicate.method === 'or')?.value as string;
        const teamId = scope.match(/home_team_id\.eq\.([^,]+)/)?.[1] ?? '';
        return { data: gamesByTeam[teamId]?.shift() ?? null, error: null };
      },
    });
    await settle(run.h);
    await settle(run.h);

    assert.match(nodeText(run.h.output), /vs Game ID Winner/);
    assert.doesNotMatch(nodeText(run.h.output), /Later Opponent|Zulu Opponent|Team B Opponent|Game ID Loser/);
    findNode(run.h.output, node => node.props.testID === 'captain-edit-attendance')?.props.onPress();
    assert.deepEqual(run.calls.navigate, [['GameAvailability', {
      gameId: 'game-a', teamId: 'team-a', leagueId: HOCKEY_LIFE_ID,
    }]]);
  });

  it('chooses the first authorized team deterministically for Season Tools when no game exists', async () => {
    const row = (teamId: string, teamName: string) => ({
      team_id: teamId, league_id: HOCKEY_LIFE_ID, season_id: activeSeason.id,
      leadership_role: 'alternate_captain', status: 'active', end_date: null,
      team: { id: teamId, name: teamName, primary_color: '#123456' },
      league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
    });
    const run = mountDashboard({
      resolveQuery: (call, fallback) => call.table === 'team_rosters'
        ? { data: [row('team-z', 'Zulu'), row('team-b', 'Alpha'), row('team-a', 'Alpha')], error: null }
        : call.table === 'games' ? { data: null, error: null } : fallback,
    });
    await settle(run.h);
    await settle(run.h);

    const rendered = nodeText(run.h.output);
    assert.match(rendered, /No upcoming game/);
    for (const testID of ['captain-edit-attendance', 'captain-invite-sub', 'captain-set-lineup', 'captain-score-game']) {
      assert.equal(findNode(run.h.output, node => node.props.testID === testID), undefined, testID);
    }
    const fees = findNode(run.h.output, node => node.props.testID === 'captain-team-fees');
    assert.ok(fees);
    assert.equal(fees.props.accessibilityHint, 'Open season fees for Alpha');
  });

  it('uses a dedicated opaque no-game surface under Reduce Transparency', async () => {
    const mountNoGame = async (reduceTransparency: boolean) => {
      const run = mountDashboard({
        reduceTransparency,
        resolveQuery: (call, fallback) => call.table === 'games' ? { data: null, error: null } : fallback,
      });
      await settle(run.h);
      const gameDay = findNode(run.h.output, node => node.props.testID === 'captain-game-day-section');
      const panel = findNode(gameDay, node => node.type === 'View'
        && nodeText(node).includes('No upcoming game')
        && Boolean(flattenStyle(node.props.style).backgroundColor));
      assert.ok(panel);
      return flattenStyle(panel.props.style).backgroundColor;
    };

    assert.equal(await mountNoGame(false), 'rgba(10,22,40,.82)');
    assert.equal(await mountNoGame(true), '#0B1728');
  });

  it('binds the four game actions and Team fees to exact native or allowlisted web destinations', async () => {
    const run = mountDashboard();
    await settle(run.h);

    const grid = findNode(run.h.output, node => node.props.testID === 'captain-game-actions');
    assert.ok(grid);
    assert.deepEqual(grid.props.children.map((child: any) => child.props.testID), [
      'captain-edit-attendance', 'captain-invite-sub', 'captain-set-lineup', 'captain-score-game',
    ]);
    for (const testID of [...grid.props.children.map((child: any) => child.props.testID), 'captain-team-fees']) {
      findNode(run.h.output, node => node.props.testID === testID)?.props.onPress();
    }
    await settle(run.h);

    assert.deepEqual(run.calls.navigate, [
      ['GameAvailability', { gameId: 'game-current', teamId: 'team-current', leagueId: HOCKEY_LIFE_ID }],
      ['GameAvailability', { gameId: 'game-current', teamId: 'team-current', leagueId: HOCKEY_LIFE_ID, intent: 'invite-sub' }],
    ]);
    assert.deepEqual(run.calls.openedUrls, [
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/game-current?mode=lineup',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/fees',
    ]);
  });

  it('alerts on synchronous and rejected link failures and never opens an unsafe lineup ID', async () => {
    for (const openUrl of [
      () => { throw new Error('sync failure'); },
      async () => { throw new Error('rejected failure'); },
    ]) {
      const failed = mountDashboard({ openUrl });
      await settle(failed.h);
      findNode(failed.h.output, node => node.props.testID === 'captain-team-fees')?.props.onPress();
      await settle(failed.h);
      assert.deepEqual(failed.calls.alerts, [[
        'Unable to open link', 'This link could not be opened. Please try again.',
      ]]);
    }

    const unsafe = mountDashboard({
      resolveQuery: (call, fallback) => call.table === 'games'
        ? { data: { ...validGame, id: '../scorekeeper', home_team_id: 'team-current' }, error: null }
        : fallback,
    });
    await settle(unsafe.h);
    findNode(unsafe.h.output, node => node.props.testID === 'captain-set-lineup')?.props.onPress();
    await settle(unsafe.h);
    assert.deepEqual(unsafe.calls.openedUrls, []);
    assert.deepEqual(unsafe.calls.alerts, [[
      'Unable to open link', 'This link is not available in Hockey Life.',
    ]]);
  });

  it('uses readable opaque surfaces under Reduce Transparency while retaining 44-point targets and game facts', async () => {
    const run = mountDashboard({ reduceTransparency: true });
    await settle(run.h);

    const card = findNode(run.h.output, node => node.props.testID === 'captain-game-card');
    assert.ok(card);
    assert.match(card.props.accessibilityLabel, /Foxes.*Sat, Oct 10.*1:00 p\.m\..*Rink A/);
    const metadata = findNode(run.h.output, node => node.props.testID === 'captain-game-metadata');
    assert.equal(flattenStyle(metadata?.props.style).backgroundColor, '#0B1728');
    for (const testID of ['captain-edit-attendance', 'captain-invite-sub', 'captain-set-lineup', 'captain-score-game', 'captain-team-fees']) {
      const action = findNode(run.h.output, node => node.props.testID === testID);
      assert.ok(action);
      const resolvedStyle = typeof action.props.style === 'function' ? action.props.style({ pressed: false }) : action.props.style;
      const style = flattenStyle(resolvedStyle);
      assert.ok(style.minHeight >= 44, testID);
      assert.equal(style.backgroundColor, '#10223B', testID);
    }
  });

  it('fails closed with an honest error when a dependent next-game query fails', async () => {
    const run = mountDashboard({
      resolveQuery: (call, fallback) => call.table === 'games'
        ? { data: null, error: { message: 'game query failed' } }
        : fallback,
    });
    await settle(run.h);

    const rendered = nodeText(run.h.output);
    assert.doesNotMatch(rendered, /Bad Bunny/);
    assert.match(rendered, /Unable to load captain duties/);
    assert.match(rendered, /Captain duties are temporarily unavailable/);
  });

  it('binds the first committed A-to-B render to B loading before passive effects run', async () => {
    const replacementRow = {
      ...dashboardRosterRows[0],
      team_id: 'team-replacement',
      team: { ...dashboardRosterRows[0].team, id: 'team-replacement', name: 'Replacement Rabbits' },
    };
    const run = mountDashboard({
      resolveQuery: (call, fallback) => {
        if (call.table === 'games') {
          const scope = call.predicates.find(predicate => predicate.method === 'or')?.value;
          return scope?.includes('team-replacement')
            ? { data: { ...validGame, id: 'game-replacement', home_team_id: 'team-replacement', away_team: { name: 'Replacement Opponent' } }, error: null }
            : fallback;
        }
        if (call.table !== 'team_rosters') return fallback;
        const playerId = call.predicates.find(predicate => predicate.method === 'eq' && predicate.column === 'player_id')?.value;
        return playerId === 'captain-2' ? { data: [replacementRow], error: null } : fallback;
      },
    });
    await settle(run.h);
    assert.match(nodeText(run.h.output), /Foxes/);

    const firstReplacementRender = run.setUserBeforeEffects({ id: 'captain-2' });
    const rendered = nodeText(firstReplacementRender);
    assert.doesNotMatch(rendered, /Foxes/);
    assert.doesNotMatch(rendered, /No captain duties|Unable to load captain duties/);
    assert.ok(findNode(firstReplacementRender, node => node.type === 'ActivityIndicator'), 'replacement user gets an honest loading state immediately');

    await settle(run.h);
    assert.match(nodeText(run.h.output), /Replacement Opponent/);
  });

  it('suppresses every pending current-request state effect after unmount', async () => {
    const pending = deferred<any>();
    const run = mountDashboard({
      resolveQuery: (call, fallback) => call.table === 'team_rosters' && !call.select?.options?.head
        ? pending.promise
        : fallback,
    });
    await settle(run.h);
    assert.ok(run.calls.queries.some(call => call.table === 'team_rosters' && !call.select?.options?.head), 'current request is pending before unmount');

    const updatesBeforeUnmount = run.h.stateUpdateCount;
    const warnings: any[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => { warnings.push(args); };
    try {
      run.h.unmount();
      pending.resolve({ data: [dashboardRosterRows[0]], error: null });
      await settle(run.h);
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(run.h.stateUpdateCount, updatesBeforeUnmount);
    assert.deepEqual(warnings, []);
  });

  it('keeps the newest overlapping refresh pending when the older refresh settles first', async () => {
    const olderRoster = deferred<any>();
    const newestRoster = deferred<any>();
    const olderRow = {
      ...dashboardRosterRows[0],
      team_id: 'team-older-refresh',
      team: { ...dashboardRosterRows[0].team, id: 'team-older-refresh', name: 'Older Refresh Owls' },
    };
    const newestRow = {
      ...dashboardRosterRows[0],
      team_id: 'team-newest-refresh',
      team: { ...dashboardRosterRows[0].team, id: 'team-newest-refresh', name: 'Newest Refresh Narwhals' },
    };
    let leadershipReads = 0;
    const run = mountDashboard({
      resolveQuery: (call, fallback) => {
        if (call.table === 'games') {
          const scope = call.predicates.find(predicate => predicate.method === 'or')?.value;
          if (scope?.includes('team-older-refresh')) return { data: { ...validGame, home_team_id: 'team-older-refresh', away_team: { name: 'Older Refresh Opponent' } }, error: null };
          if (scope?.includes('team-newest-refresh')) return { data: { ...validGame, home_team_id: 'team-newest-refresh', away_team: { name: 'Newest Refresh Opponent' } }, error: null };
          return fallback;
        }
        if (call.table !== 'team_rosters') return fallback;
        leadershipReads += 1;
        if (leadershipReads === 2) return olderRoster.promise;
        if (leadershipReads === 3) return newestRoster.promise;
        return fallback;
      },
    });
    await settle(run.h);
    assert.match(nodeText(run.h.output), /Foxes/);

    const initialScroll = findNode(run.h.output, node => node.type === 'ScrollView');
    assert.ok(initialScroll?.props.refreshControl);
    const olderRefresh = initialScroll.props.refreshControl.props.onRefresh();
    await settle(run.h);
    assert.equal(leadershipReads, 2);

    const refreshingScroll = findNode(run.h.output, node => node.type === 'ScrollView');
    const newestRefresh = refreshingScroll?.props.refreshControl.props.onRefresh();
    await settle(run.h);
    assert.equal(leadershipReads, 3);
    assert.equal(findNode(run.h.output, node => node.type === 'ScrollView')?.props.refreshControl.props.refreshing, true);

    olderRoster.resolve({ data: [olderRow], error: null });
    await olderRefresh;
    await settle(run.h);
    assert.equal(findNode(run.h.output, node => node.type === 'ScrollView')?.props.refreshControl.props.refreshing, true, 'older completion cannot clear the newest refresh indicator');
    assert.doesNotMatch(nodeText(run.h.output), /Older Refresh Opponent/);

    newestRoster.resolve({ data: [newestRow], error: null });
    await newestRefresh;
    await settle(run.h);
    const rendered = nodeText(run.h.output);
    assert.equal(findNode(run.h.output, node => node.type === 'ScrollView')?.props.refreshControl.props.refreshing, false);
    assert.match(rendered, /Newest Refresh Opponent/);
    assert.doesNotMatch(rendered, /Older Refresh Opponent/);
  });

  it('does not let a stale user load replace the next user dashboard', async () => {
    const firstUser = deferred<any>();
    const replacementRow = {
      ...dashboardRosterRows[0],
      team_id: 'team-replacement',
      team: { ...dashboardRosterRows[0].team, id: 'team-replacement', name: 'Replacement Rabbits' },
    };
    const run = mountDashboard({
      resolveQuery: (call, fallback) => {
        if (call.table === 'games') {
          const scope = call.predicates.find(predicate => predicate.method === 'or')?.value;
          return scope?.includes('team-replacement')
            ? { data: { ...validGame, id: 'game-replacement', home_team_id: 'team-replacement', away_team: { name: 'Replacement Opponent' } }, error: null }
            : fallback;
        }
        if (call.table !== 'team_rosters') return fallback;
        const playerId = call.predicates.find(predicate => predicate.method === 'eq' && predicate.column === 'player_id')?.value;
        return playerId === 'captain-1'
          ? firstUser.promise
          : { data: [replacementRow], error: null };
      },
    });
    await settle(run.h);

    run.setUser({ id: 'captain-2' });
    await settle(run.h);
    assert.match(nodeText(run.h.output), /Replacement Opponent/);

    firstUser.resolve({ data: [dashboardRosterRows[0]], error: null });
    await settle(run.h);
    const rendered = nodeText(run.h.output);
    assert.match(rendered, /Replacement Opponent/);
    assert.doesNotMatch(rendered, /Foxes/);
  });
});

async function refresh(run: ReturnType<typeof mountAvailability>) {
  const scroll = findNode(run.h.output, node => node.type === 'ScrollView');
  assert.ok(scroll?.props.refreshControl);
  const refreshPromise = scroll.props.refreshControl.props.onRefresh();
  await settle(run.h);
  await refreshPromise;
  await settle(run.h);
}

function mountAvailability(options: {
  user?: any; game?: any; role?: 'captain' | 'alternate_captain' | null; params?: any;
  season?: any; seasonLoader?: (...args: any[]) => Promise<any>;
  statusResult?: any; statusResults?: any[]; inviteResult?: any; goalieResult?: any;
  getSubs?: (...args: any[]) => Promise<any>; invite?: (...args: any[]) => Promise<any>;
  goalie?: (...args: any[]) => Promise<any>; invitations?: (...args: any[]) => Promise<any>;
  goalieLoad?: (...args: any[]) => Promise<any>;
  getRole?: (...args: any[]) => Promise<'captain' | 'alternate_captain' | null>;
  status?: (...args: any[]) => Promise<any>; clear?: (...args: any[]) => Promise<any>;
  rosterData?: any[]; checkins?: (...args: any[]) => Promise<Record<string, any>>;
  gameLoader?: (params: any) => Promise<any>;
} = {}) {
  const h = createHookHarness();
  let currentParams = options.params ?? routeParams;
  let authUser = options.user === undefined ? { id: 'captain-1' } : options.user;
  const calls: Record<string, any[]> = {
    season: [], roster: [], role: [], checkins: [], subs: [], invitations: [], goalieLoad: [], status: [], clear: [], invite: [], goalie: [], back: [], alert: [],
  };
  const getScopedRole = async (...args: any[]) => { calls.role.push(args); return options.getRole ? options.getRole(...args) : options.role === undefined ? 'captain' : options.role; };
  const services = {
    getCaptainRole: getScopedRole,
    getCaptainRoleForSeason: getScopedRole,
    getGameCheckinStatusMap: async (...args: any[]) => { calls.checkins.push(args); return options.checkins ? options.checkins(...args) : { 'player-1': 'confirmed' }; },
    getLeagueSubPlayers: async (...args: any[]) => { calls.subs.push(args); return options.getSubs ? options.getSubs(...args) : { success: true, error: null, data: [{ id: 'sub-7', full_name: 'Sam Sub', email: 'sam@example.test' }] }; },
    getTeamSubInvitations: async (...args: any[]) => { calls.invitations.push(args); return options.invitations ? options.invitations(...args) : { success: true, error: null, data: [] }; },
    getOpenGoalieRequest: async (...args: any[]) => { calls.goalieLoad.push(args); return options.goalieLoad ? options.goalieLoad(...args) : null; },
    updatePlayerCheckinAsCaptain: async (...args: any[]) => { calls.status.push(args); return options.status ? options.status(...args) : options.statusResults?.shift() ?? options.statusResult ?? { success: true }; },
    clearPlayerCheckinAsCaptain: async (...args: any[]) => { calls.clear.push(args); return options.clear ? options.clear(...args) : { success: true }; },
    inviteSub: async (...args: any[]) => { calls.invite.push(args); return options.invite ? options.invite(...args) : options.inviteResult ?? { success: true }; },
    createGoalieRequest: async (...args: any[]) => { calls.goalie.push(args); return options.goalie ? options.goalie(...args) : options.goalieResult ?? { success: true, notifiedGoalies: 2 }; },
  };
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/captain/GameAvailabilityScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': nativeMock((...args: any[]) => calls.alert.push(args)), '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (value: any) => value },
    '../../components/Avatar': () => null,
    '../../components/AccessibleChoiceGroup': (p: any) => createElement('ChoiceGroup', p),
    '../../context/AuthContext': { useAuth: () => ({ user: authUser }) },
    '../../config/hockeyLife': { HOCKEY_LIFE_ID },
    '../../lib/supabase/team': { getTeamActiveSeason: async (...args: any[]) => {
      calls.season.push(args);
      if (options.seasonLoader) return options.seasonLoader(...args);
      return { season: options.season === undefined ? activeSeason : options.season, error: null };
    } },
    '../../lib/supabase/client': { supabase: { from: (table: string) => {
      assert.equal(table, 'games');
      const builder = resultBuilder({ data: options.game === undefined ? validGame : options.game, error: null });
      if (options.gameLoader) builder.maybeSingle = () => options.gameLoader!(currentParams);
      return builder;
    } } },
    '../../lib/supabase/data': { getTeamRoster: async (...args: any[]) => { calls.roster.push(args); return options.rosterData ?? roster; } },
    '../../lib/supabase/captain': services,
    '../../theme/colors': { __esModule: true, default: {
      bgBase: '#000', bgSurface: '#111', bgInteractive: '#222', borderCard: '#333', glassStroke: '#444',
      textPrimary: '#fff', textSecondary: '#aaa', primary: '#06f', accentGreen: '#0f0', accentRed: '#f00',
    } },
  }).default;
  const navigation = { goBack: (...args: any[]) => calls.back.push(args) };
  h.mount(() => Screen({ route: { params: currentParams }, navigation }));
  return {
    h, calls,
    setParams(params: any) { currentParams = params; h.render(); },
    setUser(user: any) { authUser = user; h.render(); },
  };
}

describe('Invite sub route intent lifecycle', () => {
  it('opens the existing Request Sub flow once only after the current route is authorized', async () => {
    const run = mountAvailability({ params: { ...routeParams, intent: 'invite-sub' } });
    await settle(run.h);

    assert.deepEqual(run.calls.role, [['team-1', HOCKEY_LIFE_ID, activeSeason.id]]);
    assert.deepEqual(run.calls.subs, [[HOCKEY_LIFE_ID, 'team-1']]);
    assert.ok(findNode(run.h.output, node => node.props.testID === 'captain-sub-search'));
    findNode(run.h.output, node => node.props.testID === 'captain-close-sub-modal')?.props.onPress();
    await settle(run.h);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-sub-search'), undefined);

    await refresh(run);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-sub-search'), undefined, 'refresh does not consume the same intent again');
    assert.equal(run.calls.subs.length, 1);
  });

  it('does not open before canMutate and suppresses the intent for a noncaptain', async () => {
    const pendingRole = deferred<'captain' | null>();
    const pending = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      getRole: async () => pendingRole.promise,
    });
    await settle(pending.h);
    assert.equal(pending.calls.subs.length, 0);
    assert.equal(findNode(pending.h.output, node => node.props.testID === 'captain-sub-search'), undefined);

    pendingRole.resolve('captain');
    await settle(pending.h);
    assert.equal(pending.calls.subs.length, 1);
    assert.ok(findNode(pending.h.output, node => node.props.testID === 'captain-sub-search'));

    const rejected = mountAvailability({ params: { ...routeParams, intent: 'invite-sub' }, role: null });
    await settle(rejected.h);
    assert.equal(rejected.calls.subs.length, 0);
    assert.equal(findNode(rejected.h.output, node => node.props.testID === 'captain-sub-search'), undefined);
  });

  it('consumes independently after an A-to-B route change and ignores A candidate completion', async () => {
    const pendingA = deferred<any>();
    const run = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      getSubs: async (_leagueId, teamId) => teamId === 'team-1'
        ? pendingA.promise
        : { success: true, error: null, data: [{ id: 'sub-b', full_name: 'Route B Sub', email: null }] },
    });
    await settle(run.h);
    assert.deepEqual(run.calls.subs, [[HOCKEY_LIFE_ID, 'team-1']]);

    run.setParams({ gameId: 'game-2', teamId: 'team-2', leagueId: HOCKEY_LIFE_ID, intent: 'invite-sub' });
    await settle(run.h);
    assert.deepEqual(run.calls.subs, [[HOCKEY_LIFE_ID, 'team-1'], [HOCKEY_LIFE_ID, 'team-2']]);
    assert.match(nodeText(run.h.output), /Route B Sub/);

    pendingA.resolve({ success: true, error: null, data: [{ id: 'sub-a', full_name: 'Stale Route A Sub', email: null }] });
    await settle(run.h);
    assert.match(nodeText(run.h.output), /Route B Sub/);
    assert.doesNotMatch(nodeText(run.h.output), /Stale Route A Sub/);
  });

  it('suppresses intent completion after unmount and leaves ordinary availability unopened', async () => {
    const candidates = deferred<any>();
    const intentRun = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      getSubs: async () => candidates.promise,
    });
    await settle(intentRun.h);
    assert.equal(intentRun.calls.subs.length, 1);
    const updatesBeforeUnmount = intentRun.h.stateUpdateCount;
    intentRun.h.unmount();
    candidates.resolve({ success: true, error: null, data: [{ id: 'late', full_name: 'Late Sub', email: null }] });
    await settle(intentRun.h);
    assert.equal(intentRun.h.stateUpdateCount, updatesBeforeUnmount);

    const ordinary = mountAvailability();
    await settle(ordinary.h);
    assert.equal(ordinary.calls.subs.length, 0);
    assert.equal(findNode(ordinary.h.output, node => node.props.testID === 'captain-sub-search'), undefined);
  });
});

type CaptainRolePredicate = { method: 'eq' | 'is' | 'in'; column: string; value: any };

function loadProductionCaptainRole(options: { rows?: any[]; error?: any } = {}) {
  const predicates: CaptainRolePredicate[] = [];
  let selectColumns = '';
  let limitValue: number | null = null;
  const builder: any = {
    select(columns: string) { selectColumns = columns; return builder; },
    eq(column: string, value: any) { predicates.push({ method: 'eq', column, value }); return builder; },
    is(column: string, value: any) { predicates.push({ method: 'is', column, value }); return builder; },
    in(column: string, value: any) { predicates.push({ method: 'in', column, value }); return builder; },
    limit(value: number) { limitValue = value; return builder; },
    async maybeSingle() {
      if (options.error) return { data: null, error: options.error };
      const filtered = (options.rows ?? []).filter((row) => predicates.every((predicate) => {
        if (predicate.method === 'in') return predicate.value.includes(row[predicate.column]);
        return row[predicate.column] === predicate.value;
      }));
      return { data: filtered[0] ?? null, error: null };
    },
  };
  const captain = compileCommonJs<any>(new URL('../../src/lib/supabase/captain.ts', import.meta.url), {
    './checkins': {},
    './client': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'current-user' } } }) },
      from: (table: string) => { assert.equal(table, 'team_rosters'); return builder; },
    } },
  });
  return { captain, predicates, get selectColumns() { return selectColumns; }, get limitValue() { return limitValue; } };
}

describe('GameAvailability exact operational-season authorization', () => {
  it('uses the production scoped captain predicate and excludes an active historical row', async () => {
    const current = {
      team_id: 'team-1', player_id: 'current-user', league_id: HOCKEY_LIFE_ID,
      season_id: activeSeason.id, status: 'active', end_date: null, leadership_role: 'alternate_captain',
    };
    const historical = { ...current, season_id: 'winter-2025', leadership_role: 'captain' };
    const run = loadProductionCaptainRole({ rows: [historical, current] });

    assert.equal(typeof run.captain.getCaptainRoleForSeason, 'function');
    assert.equal(await run.captain.getCaptainRoleForSeason('team-1', HOCKEY_LIFE_ID, activeSeason.id), 'alternate_captain');
    assert.equal(run.selectColumns, 'leadership_role');
    assert.deepEqual(run.predicates, [
      { method: 'eq', column: 'team_id', value: 'team-1' },
      { method: 'eq', column: 'player_id', value: 'current-user' },
      { method: 'eq', column: 'league_id', value: HOCKEY_LIFE_ID },
      { method: 'eq', column: 'season_id', value: activeSeason.id },
      { method: 'eq', column: 'status', value: 'active' },
      { method: 'is', column: 'end_date', value: null },
      { method: 'in', column: 'leadership_role', value: ['captain', 'alternate_captain'] },
    ]);
    assert.equal(run.limitValue, 1);
  });

  it('fails the production scoped captain lookup closed on query error', async () => {
    const run = loadProductionCaptainRole({ error: { message: 'synthetic role failure' } });
    assert.equal(typeof run.captain.getCaptainRoleForSeason, 'function');
    assert.equal(await run.captain.getCaptainRoleForSeason('team-1', HOCKEY_LIFE_ID, activeSeason.id), null);
  });

  it('rejects a directly routed historical game before role, roster, attendance, or invite reads', async () => {
    const run = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      game: { ...validGame, season_id: 'winter-2025' },
      getRole: async () => 'captain',
    });
    await settle(run.h);

    assert.deepEqual(run.calls.season, [[HOCKEY_LIFE_ID]]);
    assert.equal(run.calls.role.length, 0);
    assert.equal(run.calls.roster.length, 0);
    assert.equal(run.calls.checkins.length, 0);
    assert.equal(run.calls.subs.length, 0);
    assert.match(nodeText(run.h.output), /current Hockey Life season/i);
  });

  it('fails closed on operational-season lookup error and a scoped role query error', async () => {
    const seasonFailure = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      seasonLoader: async () => ({ season: null, error: 'season lookup failed' }),
    });
    await settle(seasonFailure.h);
    assert.equal(seasonFailure.calls.role.length, 0);
    assert.equal(seasonFailure.calls.roster.length, 0);
    assert.equal(seasonFailure.calls.subs.length, 0);

    const roleFailure = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      getRole: async () => null,
    });
    await settle(roleFailure.h);
    assert.deepEqual(roleFailure.calls.role, [['team-1', HOCKEY_LIFE_ID, activeSeason.id]]);
    assert.deepEqual(roleFailure.calls.roster, [['team-1', HOCKEY_LIFE_ID]], 'ordinary roster remains readable only after exact route/season checks');
    assert.equal(roleFailure.calls.checkins.length, 0);
    assert.equal(roleFailure.calls.subs.length, 0);
    assert.equal(findNode(roleFailure.h.output, node => node.props.testID === 'captain-request-sub'), undefined);
  });

  it('authorizes exact current and playoff operational seasons with the scoped role', async () => {
    for (const season of [activeSeason, { ...activeSeason, id: 'playoffs-2026', status: 'playoffs' }]) {
      const run = mountAvailability({
        params: { ...routeParams, intent: 'invite-sub' },
        season,
        game: { ...validGame, season_id: season.id },
      });
      await settle(run.h);
      assert.deepEqual(run.calls.role, [['team-1', HOCKEY_LIFE_ID, season.id]]);
      assert.equal(run.calls.subs.length, 1);
      assert.ok(findNode(run.h.output, node => node.props.testID === 'captain-sub-search'));
    }
  });

  it('owns one-time invite intent independently across A-to-B-to-A route lifecycles', async () => {
    const run = mountAvailability({
      params: { ...routeParams, intent: 'invite-sub' },
      gameLoader: async (params) => ({ data: {
        ...validGame,
        id: params.gameId,
        home_team_id: params.teamId,
        away_team_id: `opponent-${params.teamId}`,
        away_team: { name: `Opponent ${params.teamId}` },
      }, error: null }),
      getSubs: async (_leagueId, teamId) => ({ success: true, error: null, data: [{ id: `sub-${teamId}`, full_name: `Sub ${teamId}`, email: null }] }),
    });
    await settle(run.h);
    findNode(run.h.output, node => node.props.testID === 'captain-close-sub-modal')?.props.onPress();
    await settle(run.h);

    run.setParams({ gameId: 'game-2', teamId: 'team-2', leagueId: HOCKEY_LIFE_ID, intent: 'invite-sub' });
    await settle(run.h);
    findNode(run.h.output, node => node.props.testID === 'captain-close-sub-modal')?.props.onPress();
    await settle(run.h);

    run.setParams({ ...routeParams, intent: 'invite-sub' });
    await settle(run.h);
    assert.deepEqual(run.calls.subs, [[HOCKEY_LIFE_ID, 'team-1'], [HOCKEY_LIFE_ID, 'team-2']]);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-sub-search'), undefined, 'returning to consumed A does not reopen its intent');
    assert.deepEqual(run.calls.role, [
      ['team-1', HOCKEY_LIFE_ID, activeSeason.id],
      ['team-2', HOCKEY_LIFE_ID, activeSeason.id],
      ['team-1', HOCKEY_LIFE_ID, activeSeason.id],
    ]);
  });
});

describe('private captain operations relocation', () => {
  it('navigates from the real captain dashboard and mounts operations only after exact route authorization', async () => {
    const dashboard = createHookHarness();
    const dashboardUser = { id: 'captain-1' };
    const navigationCalls: any[][] = [];
    let teamRosterCalls = 0;
    const Dashboard = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url), {
      react: dashboard.react, 'react-native': nativeMock(), '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../assets/team-page/weekly-games-bg.jpg': 'weekly-games-bg',
      '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (value: any) => value },
      '../../components/BrandAtmosphere': () => null, '../../components/SectionHeader': ({ title }: any) => createElement('Text', {}, title),
      '../../components/TeamLogo': () => null,
      '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
      '../../context/AuthContext': { useAuth: () => ({ user: dashboardUser }) },
      '../../config/hockeyLife': { HOCKEY_LIFE_ID },
      '../../config/publicLinks': {
        HOCKEY_LIFE_CAPTAIN_URL: 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain',
        HOCKEY_LIFE_CAPTAIN_FEES_URL: 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/fees',
        buildHockeyLifeCaptainLineupUrl: (gameId: string) => `https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/${gameId}?mode=lineup`,
      },
      '../../lib/publicLinks': { openPublicLink: async () => ({ success: true }) },
      '../../lib/supabase/team': { getTeamActiveSeason: async () => ({ season: activeSeason, error: null }) },
      '../../lib/supabase/client': { supabase: { from: (table: string) => {
        if (table === 'games') return resultBuilder({ data: validGame, error: null });
        teamRosterCalls += 1;
        return resultBuilder(teamRosterCalls === 1 ? { data: [{
          team_id: 'team-1', league_id: HOCKEY_LIFE_ID, leadership_role: 'captain',
          team: { id: 'team-1', name: 'Owls', logo_url: null, primary_color: '#123456' },
          league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
        }] } : { count: 12 });
      } } },
      '../../theme/colors': { __esModule: true, default: { bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', primary: '#06f', brandGold: '#fc0', bgSurface: '#111', glassStroke: '#333', bgInteractive: '#222' } },
    }).default;
    dashboard.mount(() => Dashboard({ navigation: { navigate: (...args: any[]) => navigationCalls.push(args), goBack() {} } }));
    await settle(dashboard);
    const availability = findNode(dashboard.output, node => node.props.testID === 'captain-edit-attendance');
    assert.ok(availability, `captain dashboard exposes Edit attendance; rendered ${nodeText(dashboard.output)}`);
    availability.props.onPress();
    assert.deepEqual(navigationCalls, [['GameAvailability', routeParams]]);

    const authorized = mountAvailability();
    await settle(authorized.h);
    assert.deepEqual(authorized.calls.role, [['team-1', HOCKEY_LIFE_ID, activeSeason.id]]);
    assert.deepEqual(authorized.calls.roster, [['team-1', HOCKEY_LIFE_ID]]);
    assert.ok(findNode(authorized.h.output, node => node.props.testID === 'captain-request-sub'));
    assert.ok(findNode(authorized.h.output, node => node.props.testID === 'captain-request-goalie'));
    assert.ok(findNode(authorized.h.output, node => node.props.testID === 'captain-status-player-1-tentative'));

    const alternate = mountAvailability({ role: 'alternate_captain' });
    await settle(alternate.h);
    assert.ok(findNode(alternate.h.output, node => node.props.testID === 'captain-request-sub'), 'alternate captains retain the same protected tools');

    for (const rejected of [
      mountAvailability({ user: null }),
      mountAvailability({ params: { ...routeParams, leagueId: 'other-league' } }),
      mountAvailability({ game: { ...validGame, home_team_id: 'team-x', away_team_id: 'team-y' } }),
      mountAvailability({ role: null }),
    ]) {
      await settle(rejected.h);
      assert.equal(findNode(rejected.h.output, node => node.props.testID === 'captain-request-sub'), undefined);
      assert.equal(rejected.calls.checkins.length, 0, 'rejected route does not fetch privileged check-ins');
      assert.equal(rejected.calls.subs.length, 0, 'rejected route does not fetch sub candidates');
      assert.equal(rejected.calls.goalieLoad.length, 0, 'rejected route does not fetch goalie requests');
    }
    const nonCaptain = mountAvailability({ role: null });
    await settle(nonCaptain.h);
    assert.deepEqual(nonCaptain.calls.roster, [['team-1', HOCKEY_LIFE_ID]], 'noncaptains keep prior read-only roster behavior');
    assert.match(nodeText(nonCaptain.h.output), /Alex Skater/);
  });

  it('settles captain check-in errors, prevents duplicate writes, supports clear, and returns accessibly', async () => {
    const mounted = mountAvailability({ statusResult: { success: false, error: 'Check-in failed' } });
    await settle(mounted.h);
    const tentative = findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-tentative');
    assert.ok(tentative);
    tentative.props.onPress();
    tentative.props.onPress();
    assert.deepEqual(mounted.calls.status, [['game-1', 'team-1', 'player-1', 'tentative']], 'pending action invokes the service exactly once');
    await settle(mounted.h);
    assert.match(nodeText(findNode(mounted.h.output, node => node.props.testID === 'captain-action-error')), /Check-in failed/);
    const waiting = findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-waiting');
    waiting?.props.onPress();
    await settle(mounted.h);
    assert.deepEqual(mounted.calls.clear, [['game-1', 'team-1', 'player-1']]);
    const shell = findNode(mounted.h.output, node => node.type === 'SafeAreaView');
    shell?.props.onAccessibilityEscape();
    assert.equal(mounted.calls.back.length, 1);
  });

  it('clears pending action UI when the validated team route changes and ignores the stale result', async () => {
    let resolveFirst!: (value: any) => void;
    const firstResult = new Promise((resolve) => { resolveFirst = resolve; });
    const mounted = mountAvailability({ statusResults: [firstResult, { success: true }] });
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-tentative')?.props.onPress();
    assert.equal(mounted.calls.status.length, 1);
    mounted.setParams({ ...routeParams, teamId: 'team-2' });
    await settle(mounted.h);
    const nextRouteAction = findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-out');
    assert.equal(nextRouteAction?.props.disabled, false, 'newly authorized team route is not stuck in the old pending state');
    nextRouteAction?.props.onPress();
    assert.deepEqual(mounted.calls.status[1], ['game-1', 'team-2', 'player-1', 'out']);
    resolveFirst({ success: false, error: 'stale failure' });
    await settle(mounted.h);
    assert.doesNotMatch(nodeText(mounted.h.output), /stale failure/);
  });

  it('invites the selected league sub exactly once and settles transport errors', async () => {
    const mounted = mountAvailability();
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(mounted.h);
    assert.deepEqual(mounted.calls.subs, [[HOCKEY_LIFE_ID, 'team-1']]);
    const invite = findNode(mounted.h.output, node => node.props.testID === 'captain-invite-sub-sub-7');
    assert.match(nodeText(invite), /Invite/);
    assert.match(nodeText(mounted.h.output), /Sam Sub/);
    invite?.props.onPress();
    invite?.props.onPress();
    assert.deepEqual(mounted.calls.invite, [['game-1', 'team-1', 'sub-7']]);
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    await settle(mounted.h);
    assert.equal(mounted.calls.invite.length, 1, 'a completed invitation is not retried even if refresh is eventually consistent');
    assert.deepEqual(mounted.calls.invitations.at(-1), ['team-1', ['game-1']]);

    const failed = mountAvailability({ inviteResult: { success: false, error: 'Invite failed' } });
    await settle(failed.h);
    findNode(failed.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(failed.h);
    findNode(failed.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    await settle(failed.h);
    assert.match(nodeText(findNode(failed.h.output, node => node.props.testID === 'captain-action-error')), /Invite failed/);
    assert.equal(findNode(failed.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.disabled, false);
  });

  it('posts the fixed goalie request exactly once and settles transport errors', async () => {
    const mounted = mountAvailability();
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress();
    mounted.h.render();
    const submit = findNode(mounted.h.output, node => node.props.testID === 'captain-submit-goalie-request');
    submit?.props.onPress();
    submit?.props.onPress();
    assert.deepEqual(mounted.calls.goalie, [[
      'game-1', 'team-1', HOCKEY_LIFE_ID,
      { skillLevelNeeded: 'intermediate', compensation: 'Free', notes: null },
    ]]);
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress();
    mounted.h.render();
    findNode(mounted.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.onPress();
    await settle(mounted.h);
    assert.equal(mounted.calls.goalie.length, 1, 'a completed goalie request is not retried if refresh is eventually consistent');
    assert.deepEqual(mounted.calls.goalieLoad.at(-1), ['game-1', 'team-1']);

    const failed = mountAvailability({ goalieResult: { success: false, error: 'Goalie request failed' } });
    await settle(failed.h);
    findNode(failed.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress();
    failed.h.render();
    findNode(failed.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.onPress();
    await settle(failed.h);
    assert.match(nodeText(findNode(failed.h.output, node => node.props.testID === 'captain-action-error')), /Goalie request failed/);
    assert.equal(findNode(failed.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.disabled, false);
  });

  it('resets exclusion-scoped sub state and lets the next validated route load while the old request is pending', async () => {
    const pendingA = deferred<any>();
    const mounted = mountAvailability({
      getSubs: async (_leagueId, excludedTeamId) => excludedTeamId === 'team-1'
        ? pendingA.promise
        : { success: true, error: null, data: [{ id: 'sub-team-2', full_name: 'Team Two Sub', email: null }] },
    });
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-sub-search')?.props.onChangeText('old team search');
    mounted.setParams({ ...routeParams, teamId: 'team-2' });
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(mounted.h);
    assert.deepEqual(mounted.calls.subs, [[HOCKEY_LIFE_ID, 'team-1'], [HOCKEY_LIFE_ID, 'team-2']]);
    assert.match(nodeText(mounted.h.output), /Team Two Sub/);
    assert.doesNotMatch(nodeText(mounted.h.output), /Sam Sub/);
    assert.equal(findNode(mounted.h.output, node => node.props.testID === 'captain-sub-search')?.props.value, '');
    pendingA.resolve({ success: true, error: null, data: [{ id: 'stale-a', full_name: 'Stale A', email: null }] });
    await settle(mounted.h);
    assert.doesNotMatch(nodeText(mounted.h.output), /Stale A/);

    const draftRun = mountAvailability();
    await settle(draftRun.h);
    findNode(draftRun.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress(); draftRun.h.render();
    findNode(draftRun.h.output, node => node.props.accessibilityLabel === 'Goalie skill level needed')?.props.onSelect('expert');
    findNode(draftRun.h.output, node => node.props.accessibilityLabel === 'Goalie compensation')?.props.onSelect('Paid');
    draftRun.setParams({ ...routeParams, teamId: 'team-2' }); await settle(draftRun.h);
    findNode(draftRun.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress(); draftRun.h.render();
    assert.equal(findNode(draftRun.h.output, node => node.props.accessibilityLabel === 'Goalie skill level needed')?.props.selectedValue, 'intermediate');
    assert.equal(findNode(draftRun.h.output, node => node.props.accessibilityLabel === 'Goalie compensation')?.props.selectedValue, 'Free');
  });

  it('retains pinned invite and goalie guards across refresh without retrying issued writes', async () => {
    const invitePending = deferred<any>();
    const inviteRun = mountAvailability({ invite: async () => invitePending.promise });
    await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    await refresh(inviteRun);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress();
    await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    assert.equal(inviteRun.calls.invite.length, 1);
    invitePending.resolve({ success: true });
    await settle(inviteRun.h);

    const goaliePending = deferred<any>();
    const goalieRun = mountAvailability({ goalie: async () => goaliePending.promise });
    await settle(goalieRun.h);
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress(); goalieRun.h.render();
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.onPress();
    await refresh(goalieRun);
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress(); goalieRun.h.render();
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.onPress();
    assert.equal(goalieRun.calls.goalie.length, 1);
    goaliePending.resolve({ success: true, notifiedGoalies: 1 });
    await settle(goalieRun.h);
  });

  it('retains same-identity action guards across A-B-A navigation until original writes settle', async () => {
    const invitePending = deferred<any>();
    const mounted = mountAvailability({ invite: async () => invitePending.promise });
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress(); await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    mounted.setParams({ ...routeParams, teamId: 'team-2' }); await settle(mounted.h);
    mounted.setParams(routeParams); await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress(); await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    assert.equal(mounted.calls.invite.length, 1);
    invitePending.resolve({ success: true });
    await settle(mounted.h);
  });

  it('retains the exact pending status write guard across refresh', async () => {
    const pending = deferred<any>();
    const mounted = mountAvailability({ statusResults: [pending.promise, { success: true }] });
    await settle(mounted.h);
    findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-tentative')?.props.onPress();
    await refresh(mounted);
    findNode(mounted.h.output, node => node.props.testID === 'captain-status-player-1-tentative')?.props.onPress();
    assert.equal(mounted.calls.status.length, 1);
    pending.resolve({ success: true });
    await settle(mounted.h);
  });

  it('settles refresh UI when an unexpected loader promise rejects', async () => {
    let roleLoads = 0;
    const mounted = mountAvailability({ getRole: async () => {
      roleLoads += 1;
      if (roleLoads > 1) throw new Error('transport exploded');
      return 'captain';
    } });
    await settle(mounted.h);
    await assert.doesNotReject(() => refresh(mounted));
    assert.doesNotMatch(nodeText(mounted.h.output), /ActivityIndicator/);
  });

  it('invalidates loaded captain data and controls synchronously when identity changes on the same route', async () => {
    const mounted = mountAvailability();
    await settle(mounted.h);
    assert.ok(findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub'));
    mounted.setUser({ id: 'replacement-user' });
    assert.equal(findNode(mounted.h.output, node => node.props.testID === 'captain-request-sub'), undefined);
    assert.doesNotMatch(nodeText(mounted.h.output), /Alex Skater/);
    await settle(mounted.h);
    assert.deepEqual(mounted.calls.role.at(-1), ['team-1', HOCKEY_LIFE_ID, activeSeason.id]);

    const pending = deferred<any>();
    const reentry = mountAvailability({ invite: async () => pending.promise });
    await settle(reentry.h);
    findNode(reentry.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress(); await settle(reentry.h);
    findNode(reentry.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    reentry.setUser({ id: 'other-account' }); await settle(reentry.h);
    reentry.setUser({ id: 'captain-1' }); await settle(reentry.h);
    findNode(reentry.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress(); await settle(reentry.h);
    findNode(reentry.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    assert.equal(reentry.calls.invite.length, 1, 'component-local identity keys preserve the original guard without blocking another account');
    pending.resolve({ success: true }); await settle(reentry.h);
  });

  it('settles rejected action promises, preserves confirmed writes across rejected readback, and suppresses stale alerts', async () => {
    let inviteAttempts = 0;
    let invitationReads = 0;
    const inviteRun = mountAvailability({
      invite: async () => {
        inviteAttempts += 1;
        if (inviteAttempts === 1) throw new Error('unexpected invite rejection');
        return { success: true };
      },
      invitations: async () => {
        invitationReads += 1;
        if (invitationReads > 1) throw new Error('readback rejected');
        return { success: true, error: null, data: [] };
      },
    });
    await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-request-sub')?.props.onPress(); await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress(); await settle(inviteRun.h);
    assert.match(nodeText(inviteRun.h.output), /Unable to invite this sub/);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress(); await settle(inviteRun.h);
    findNode(inviteRun.h.output, node => node.props.testID === 'captain-invite-sub-sub-7')?.props.onPress();
    assert.equal(inviteRun.calls.invite.length, 2, 'failed write is retryable, confirmed write with rejected readback is not');

    const pendingGoalie = deferred<any>();
    const goalieRun = mountAvailability({ goalie: async () => pendingGoalie.promise });
    await settle(goalieRun.h);
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-request-goalie')?.props.onPress(); goalieRun.h.render();
    findNode(goalieRun.h.output, node => node.props.testID === 'captain-submit-goalie-request')?.props.onPress();
    goalieRun.setParams({ ...routeParams, teamId: 'team-2' }); await settle(goalieRun.h);
    pendingGoalie.resolve({ success: true, notifiedGoalies: 3 }); await settle(goalieRun.h);
    assert.equal(goalieRun.calls.alert.length, 0, 'route A completion does not alert or navigate route B');
  });
});

function press(run: ReturnType<typeof mountAvailability>, testID: string) {
  const node = findNode(run.h.output, candidate => candidate.props.testID === testID);
  assert.ok(node, `missing ${testID}`);
  assert.notEqual(node.props.disabled, true, `${testID} should be enabled`);
  node.props.onPress();
}

describe('captain attendance lifecycle correction v3', () => {
  it('supports repeated successful In/Out and Waiting/Out cycles without duplicate pending writes', async () => {
    const run = mountAvailability();
    await settle(run.h);
    for (const status of ['confirmed', 'out', 'confirmed', 'out', 'confirmed']) {
      press(run, `captain-status-player-1-${status}`);
      await settle(run.h);
    }
    assert.deepEqual(run.calls.status.map(args => args[3]), ['confirmed', 'out', 'confirmed', 'out', 'confirmed']);

    press(run, 'captain-status-player-1-waiting'); await settle(run.h);
    press(run, 'captain-status-player-1-out'); await settle(run.h);
    press(run, 'captain-status-player-1-waiting'); await settle(run.h);
    assert.equal(run.calls.clear.length, 2);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-player-1-waiting')?.props.accessibilityState.selected, true);

    let attempts = 0;
    const retry = mountAvailability({ status: async () => ++attempts === 1 ? { success: false, error: 'retry me' } : { success: true } });
    await settle(retry.h);
    press(retry, 'captain-status-player-1-out'); await settle(retry.h);
    press(retry, 'captain-status-player-1-out'); await settle(retry.h);
    assert.equal(retry.calls.status.length, 2);
    assert.equal(findNode(retry.h.output, node => node.props.testID === 'captain-status-player-1-out')?.props.accessibilityState.selected, true);
  });

  it('settles a candidate read invalidated during same-route refresh and allows a fresh reopen query', async () => {
    const candidate = deferred<any>();
    const refreshedGame = deferred<any>();
    let gameReads = 0;
    let subReads = 0;
    const run = mountAvailability({
      gameLoader: async () => ++gameReads === 1 ? { data: validGame, error: null } : refreshedGame.promise,
      getSubs: async () => ++subReads === 1
        ? candidate.promise
        : { success: true, error: null, data: [{ id: 'fresh-sub', full_name: 'Fresh Sub', email: null }] },
    });
    await settle(run.h);
    press(run, 'captain-request-sub'); await settle(run.h);
    const scroll = findNode(run.h.output, node => node.type === 'ScrollView');
    const refreshPromise = scroll?.props.refreshControl.props.onRefresh();
    await settle(run.h);
    candidate.resolve({ success: true, error: null, data: [{ id: 'old-sub', full_name: 'Old Sub', email: null }] });
    await settle(run.h);
    refreshedGame.resolve({ data: validGame, error: null });
    await refreshPromise; await settle(run.h);
    press(run, 'captain-request-sub'); await settle(run.h);
    assert.equal(run.calls.subs.length, 2);
    assert.match(nodeText(run.h.output), /Fresh Sub/);
    assert.doesNotMatch(nodeText(run.h.output), /Old Sub/);
  });

  it('reloads candidates when the invalidated read finishes before or after same-route validation', async () => {
    for (const timing of ['before', 'after'] as const) {
      const oldRead = deferred<any>();
      let subReads = 0;
      const run = mountAvailability({
        getSubs: async () => ++subReads === 1
          ? oldRead.promise
          : { success: true, error: null, data: [{ id: `fresh-${timing}`, full_name: `Fresh ${timing}`, email: null }] },
      });
      await settle(run.h);
      press(run, 'captain-request-sub'); await settle(run.h);
      if (timing === 'before') { oldRead.resolve({ success: true, error: null, data: [{ id: 'old', full_name: 'Old', email: null }] }); await settle(run.h); }
      await refresh(run);
      if (timing === 'after') { oldRead.resolve({ success: true, error: null, data: [{ id: 'old', full_name: 'Old', email: null }] }); await settle(run.h); }
      press(run, 'captain-request-sub'); await settle(run.h);
      assert.equal(run.calls.subs.length, 2);
      assert.match(nodeText(run.h.output), new RegExp(`Fresh ${timing}`));
    }
  });

  it('merges parallel per-player success and failure in both completion orders', async () => {
    const rosterTwo = [
      ...roster,
      { id: 'roster-2', player_id: 'player-2', team_id: 'team-1', jersey_number: 10, position: 'D', is_goalie: false, player_name: 'Blake Defender', avatar_url: null },
    ];
    for (const outcome of ['both-success', 'second-failure'] as const) for (const order of ['second-first', 'first-first'] as const) {
      const first = deferred<any>();
      const second = deferred<any>();
      const run = mountAvailability({
        rosterData: rosterTwo,
        checkins: async () => ({ 'player-1': 'confirmed', 'player-2': 'confirmed' }),
        status: async (_gameId, _teamId, playerId) => playerId === 'player-1' ? first.promise : second.promise,
      });
      await settle(run.h);
      press(run, 'captain-status-player-1-out');
      press(run, 'captain-status-player-2-out');
      if (order === 'second-first') {
        second.resolve(outcome === 'both-success' ? { success: true } : { success: false, error: 'player two failed' }); await settle(run.h);
        first.resolve({ success: true });
      } else {
        first.resolve({ success: true }); await settle(run.h);
        second.resolve(outcome === 'both-success' ? { success: true } : { success: false, error: 'player two failed' });
      }
      await settle(run.h);
      assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-player-1-out')?.props.accessibilityState.selected, true);
      assert.equal(findNode(run.h.output, node => node.props.testID === `captain-status-player-2-${outcome === 'both-success' ? 'out' : 'confirmed'}`)?.props.accessibilityState.selected, true);
    }
  });

  it('does not let an older refresh status read overwrite a write confirmed after that read began', async () => {
    const staleRefresh = deferred<Record<string, any>>();
    const pendingWrite = deferred<any>();
    let checkinReads = 0;
    const run = mountAvailability({
      checkins: async () => ++checkinReads === 1 ? { 'player-1': 'confirmed' } : staleRefresh.promise,
      status: async () => pendingWrite.promise,
    });
    await settle(run.h);
    press(run, 'captain-status-player-1-out');
    const scroll = findNode(run.h.output, node => node.type === 'ScrollView');
    const refreshPromise = scroll?.props.refreshControl.props.onRefresh();
    await settle(run.h);
    pendingWrite.resolve({ success: true }); await settle(run.h);
    staleRefresh.resolve({ 'player-1': 'confirmed' });
    await refreshPromise; await settle(run.h);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-player-1-out')?.props.accessibilityState.selected, true);
    assert.equal(run.calls.status.length, 1);
  });

  it('does not publish a stale successful status result into another validated entity', async () => {
    const oldWrite = deferred<any>();
    const run = mountAvailability({ status: async () => oldWrite.promise });
    await settle(run.h);
    press(run, 'captain-status-player-1-out');
    run.setParams({ ...routeParams, teamId: 'team-2' }); await settle(run.h);
    oldWrite.resolve({ success: true }); await settle(run.h);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-player-1-confirmed')?.props.accessibilityState.selected, true);
    assert.equal(run.calls.status.length, 1);
  });
});

function selectedStatus(run: ReturnType<typeof mountAvailability>) {
  for (const status of ['confirmed', 'tentative', 'out', 'waiting']) {
    if (findNode(run.h.output, node => node.props.testID === `captain-status-player-1-${status}`)?.props.accessibilityState.selected) return status;
  }
  return null;
}

describe('captain attendance lifecycle correction v4', () => {
  for (const failure of ['returned', 'rejected'] as const) {
    it(`lets authoritative refresh win when a ${failure} write settles during route revalidation`, async () => {
      const firstWrite = deferred<any>();
      const heldGame = deferred<any>();
      let gameReads = 0;
      let writes = 0;
      const run = mountAvailability({
        gameLoader: async () => ++gameReads === 2 ? heldGame.promise : { data: validGame, error: null },
        checkins: async () => ({ 'player-1': 'confirmed' }),
        status: async () => ++writes === 1 ? firstWrite.promise : { success: true },
      });
      await settle(run.h);
      press(run, 'captain-status-player-1-out');
      const scroll = findNode(run.h.output, node => node.type === 'ScrollView');
      const refreshPromise = scroll?.props.refreshControl.props.onRefresh();
      await settle(run.h);
      if (failure === 'returned') firstWrite.resolve({ success: false, error: 'denied' });
      else firstWrite.reject(new Error('transport rejected'));
      await settle(run.h);
      heldGame.resolve({ data: validGame, error: null });
      await refreshPromise; await settle(run.h);

      assert.equal(selectedStatus(run), 'confirmed');
      assert.notEqual(findNode(run.h.output, node => node.props.testID === 'captain-status-player-1-out')?.props.disabled, true);
      assert.equal(run.calls.status.length, 1);
      press(run, 'captain-status-player-1-out'); await settle(run.h);
      assert.equal(run.calls.status.length, 2, 'the settled failure remains deliberately retryable');
    });
  }

  it('keeps intervening B status out of A when an A write fails during A re-entry', async () => {
    const pendingWrite = deferred<any>();
    const heldReentry = deferred<any>();
    let gameReads = 0;
    const run = mountAvailability({
      gameLoader: async () => ++gameReads === 3 ? heldReentry.promise : { data: validGame, error: null },
      checkins: async (_gameId, teamId) => teamId === 'team-1' ? { 'player-1': 'confirmed' } : { 'player-1': 'tentative' },
      status: async () => pendingWrite.promise,
    });
    await settle(run.h);
    press(run, 'captain-status-player-1-out');
    run.setParams({ ...routeParams, teamId: 'team-2' }); await settle(run.h);
    assert.equal(selectedStatus(run), 'tentative');
    run.setParams(routeParams); await settle(run.h);
    pendingWrite.resolve({ success: false, error: 'denied' }); await settle(run.h);
    heldReentry.resolve({ data: validGame, error: null }); await settle(run.h);

    assert.equal(selectedStatus(run), 'confirmed');
    assert.equal(run.calls.status.length, 1);
  });

  it('preserves an A success that settles during A re-entry over the older A read', async () => {
    const pendingWrite = deferred<any>();
    const heldReentry = deferred<any>();
    let gameReads = 0;
    const run = mountAvailability({
      gameLoader: async () => ++gameReads === 3 ? heldReentry.promise : { data: validGame, error: null },
      checkins: async (_gameId, teamId) => teamId === 'team-1' ? { 'player-1': 'confirmed' } : { 'player-1': 'tentative' },
      status: async () => pendingWrite.promise,
    });
    await settle(run.h);
    press(run, 'captain-status-player-1-out');
    run.setParams({ ...routeParams, teamId: 'team-2' }); await settle(run.h);
    run.setParams(routeParams); await settle(run.h);
    pendingWrite.resolve({ success: true }); await settle(run.h);
    heldReentry.resolve({ data: validGame, error: null }); await settle(run.h);

    assert.equal(selectedStatus(run), 'out');
    assert.equal(run.calls.status.length, 1);
  });
});
