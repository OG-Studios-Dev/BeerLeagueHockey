/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileCommonJs, createElement, createHookHarness, findNode, flattenStyle, nodeText } from './component-harness';

const testDirectory = dirname(fileURLToPath(import.meta.url));

const TEAM_ID = '30000000-0000-4000-8000-000000000001';
const TEAM_B = '30000000-0000-4000-8000-000000000002';
const SEASON_ID = '20000000-0000-4000-8000-000000000001';
const LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const GAME_NEXT = '50000000-0000-4000-8000-000000000001';
const GAME_LATER = '50000000-0000-4000-8000-000000000002';
const PLAYER_GOALIE = '40000000-0000-4000-8000-000000000001';
const PLAYER_SKATER = '40000000-0000-4000-8000-000000000002';
const PLAYER_DELETED = '40000000-0000-4000-8000-000000000003';
const ASSIGNMENT_ID = '70000000-0000-4000-8000-000000000001';

async function settle(harness: ReturnType<typeof createHookHarness>) {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
    harness.render();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function nativeMock() {
  return {
    ActivityIndicator: 'ActivityIndicator',
    ImageBackground: 'ImageBackground',
    Modal: ({ visible, children, ...props }: any) => visible ? createElement('Modal', props, children) : null,
    Pressable: 'Pressable',
    RefreshControl: 'RefreshControl',
    ScrollView: (props: any) => createElement('ScrollView', props, props.children),
    Text: 'Text',
    View: 'View',
    Alert: { alert() {} },
    Linking: { openURL: async () => undefined },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {}, absoluteFillObject: {} },
  };
}

function resultBuilder(result: any) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    or: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function mountDashboard() {
  const harness = createHookHarness();
  const navigate: any[][] = [];
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': nativeMock(),
      '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../assets/team-page/weekly-games-bg.jpg': 'weekly-games-bg',
      '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (value: any) => value },
      '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceTransparency: false }) },
      '../../context/AuthContext': { useAuth: () => ({ user: { id: 'captain-1' } }) },
      '../../config/hockeyLife': { HOCKEY_LIFE_ID: LEAGUE_ID },
      '../../config/publicLinks': {
        HOCKEY_LIFE_CAPTAIN_URL: 'https://hockey-life.example/captain',
        HOCKEY_LIFE_CAPTAIN_FEES_URL: 'https://hockey-life.example/fees',
        buildHockeyLifeCaptainLineupUrl: () => 'https://hockey-life.example/lineup',
      },
      '../../lib/publicLinks': { openPublicLink: async () => ({ success: true }) },
      '../../lib/supabase/team': { getTeamActiveSeason: async () => ({
        season: { id: SEASON_ID, status: 'active' }, error: null,
      }) },
      '../../lib/supabase/client': { supabase: { from: (table: string) => table === 'team_rosters'
        ? resultBuilder({ data: [{
          team_id: TEAM_ID,
          league_id: LEAGUE_ID,
          leadership_role: 'alternate_captain',
          team: { id: TEAM_ID, name: 'Owls', primary_color: '#123456' },
          league: { id: LEAGUE_ID, name: 'Hockey Life', timezone: 'America/Toronto' },
        }], error: null })
        : resultBuilder({ data: null, error: null }) } },
      '../../theme/colors': { __esModule: true, default: {
        bgBase: '#000', bgSurface: '#111', bgElevated: '#181818', bgInteractive: '#222',
        textPrimary: '#fff', textSecondary: '#aaa', primary: '#06f', brandGold: '#fc0',
        accentViolet: '#a0f', glassStroke: '#333', glassHighlight: '#191919',
      } },
    },
  ).default;

  harness.mount(() => Screen({ navigation: {
    navigate: (...args: any[]) => navigate.push(args),
    goBack() {},
  } }));
  return { harness, navigate };
}

const assignedGoalie = {
  id: ASSIGNMENT_ID,
  version: 4,
  player_id: PLAYER_GOALIE,
  status: 'pending' as const,
  player_name: 'Goalie Gina',
  player_avatar_url: null,
};

const trackerFixture = {
  team_id: TEAM_ID,
  season_id: SEASON_ID,
  timezone: 'America/Toronto',
  roster: [
    { player_id: PLAYER_GOALIE, full_name: 'Goalie Gina', avatar_url: null, jersey_number: null, position: null, is_goalie: true },
    { player_id: PLAYER_SKATER, full_name: 'Regular Ron', avatar_url: null, jersey_number: 11, position: 'Forward', is_goalie: false },
  ],
  upcoming_games: [
    { game_id: GAME_LATER, scheduled_at: '2026-10-24T23:00:00.000Z', assignment: null },
    { game_id: GAME_NEXT, scheduled_at: '2026-10-17T23:00:00.000Z', assignment: assignedGoalie },
  ],
  history: [],
};

function mountTracker(options: {
  tracker?: (...args: any[]) => Promise<any>;
  manage?: (...args: any[]) => Promise<any>;
  params?: { teamId: string; seasonId: string };
} = {}) {
  const harness = createHookHarness();
  let params = options.params ?? { teamId: TEAM_ID, seasonId: SEASON_ID };
  const calls: { tracker: any[][]; manage: any[][]; back: any[][] } = { tracker: [], manage: [], back: [] };
  const Screen = compileCommonJs<{ default: (props: any) => unknown }>(
    new URL('../../src/screens/captain/BeerTrackerModal.tsx', import.meta.url),
    {
      react: harness.react,
      'react-native': nativeMock(),
      '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true, reduceTransparency: false }) },
      '../../lib/supabase/beerGuy': {
        getBeerGuyTracker: async (...args: any[]) => {
          calls.tracker.push(args);
          return options.tracker ? options.tracker(...args) : { data: trackerFixture, error: null };
        },
        manageBeerGuyAsCaptain: async (...args: any[]) => {
          calls.manage.push(args);
          return options.manage ? options.manage(...args) : { data: null, error: 'not configured' };
        },
        getPublicNextBeerGuyAssignment: () => { throw new Error('private tracker must never load public history'); },
      },
      '../../theme/colors': { __esModule: true, default: {
        bgBase: '#000', bgSurface: '#111', bgElevated: '#181818', bgInteractive: '#222', bgModal: '#080f1c',
        bgControlOpaque: '#1c2a42', textPrimary: '#fff', textSecondary: '#aaa', textOnPrimary: '#001',
        primary: '#22d3ee', accentGreen: '#0f0', accentRed: '#f00', brandGold: '#fc0',
        glassStroke: '#333', glassStrokeStrong: '#555', glassHighlight: '#191919',
      } },
    },
  ).default;

  harness.mount(() => Screen({
    route: { params },
    navigation: { goBack: (...args: any[]) => calls.back.push(args) },
  }));
  return {
    harness,
    calls,
    setParams(next: { teamId: string; seasonId: string }) { params = next; harness.render(); },
  };
}

describe('Captain Beer Tracker entry and route', () => {
  it('opens the team-and-season-owned modal route from the gated Season Tools dashboard', async () => {
    const mounted = mountDashboard();
    await settle(mounted.harness);

    const tracker = findNode(mounted.harness.output, node => node.props.testID === 'captain-beer-tracker');
    assert.ok(tracker, 'authorized captain or alternate sees Beer Tracker');
    assert.equal(tracker.props.accessibilityRole, 'button');
    tracker.props.onPress();
    assert.deepEqual(mounted.navigate, [['BeerTracker', { teamId: TEAM_ID, seasonId: SEASON_ID }]]);

    const navigation = readFileSync(resolve(testDirectory, '../../src/navigation/index.tsx'), 'utf8');
    const types = readFileSync(resolve(testDirectory, '../../src/navigation/types.ts'), 'utf8');
    assert.match(navigation, /CaptainStack\.Screen name="BeerTracker"/);
    assert.match(navigation, /presentation:\s*['"]modal['"]/);
    assert.match(types, /BeerTracker:\s*\{\s*teamId:\s*string;\s*seasonId:\s*string\s*\};/);
  });
});

describe('Captain Beer Tracker upcoming assignment presentation', () => {
  it('loads the private tracker, defaults to the chronological next game, and renders only its server roster', async () => {
    const mounted = mountTracker();
    assert.ok(findNode(mounted.harness.output, node => node.type === 'ActivityIndicator'));
    await settle(mounted.harness);

    assert.deepEqual(mounted.calls.tracker, [[TEAM_ID]]);
    const nextGame = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_NEXT}`);
    const laterGame = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_LATER}`);
    assert.equal(nextGame?.props.accessibilityRole, 'tab');
    assert.deepEqual(nextGame?.props.accessibilityState, { selected: true });
    assert.deepEqual(laterGame?.props.accessibilityState, { selected: false });

    const holder = findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder');
    assert.match(nodeText(holder), /Current Beer Guy.*Goalie Gina/);
    const goalie = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_GOALIE}`);
    const skater = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`);
    assert.match(nodeText(goalie), /Goalie Gina.*Goalie.*No jersey number/);
    assert.match(nodeText(skater), /Regular Ron.*Forward.*#11/);
    assert.ok(flattenStyle(goalie?.props.style).minHeight >= 44);
    assert.deepEqual(goalie?.props.accessibilityState, { disabled: true, selected: true });
    assert.doesNotMatch(nodeText(mounted.harness.output), /sub|part.?time/i);
  });

  it('switches the selected upcoming game and exposes its unassigned state', async () => {
    const mounted = mountTracker();
    await settle(mounted.harness);

    findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_LATER}`)?.props.onPress();
    mounted.harness.render();

    assert.deepEqual(
      findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_LATER}`)?.props.accessibilityState,
      { selected: true },
    );
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Unassigned/);
    assert.deepEqual(
      findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_GOALIE}`)?.props.accessibilityState,
      { disabled: false, selected: false },
    );
  });

  it('fails a denied private tracker read closed and retries without exposing controls', async () => {
    let reads = 0;
    const mounted = mountTracker({
      tracker: async () => ++reads === 1
        ? { data: null, error: 'permission denied' }
        : { data: trackerFixture, error: null },
    });
    await settle(mounted.harness);

    const alert = findNode(mounted.harness.output, node => node.props.accessibilityRole === 'alert');
    assert.match(nodeText(alert), /Unable to load Beer Tracker/);
    assert.equal(findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_GOALIE}`), undefined);
    const retry = findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-retry');
    assert.equal(retry?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(retry?.props.style).minHeight >= 44);

    retry?.props.onPress();
    await settle(mounted.harness);
    assert.deepEqual(mounted.calls.tracker, [[TEAM_ID], [TEAM_ID]]);
    assert.ok(findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_GOALIE}`));
  });
});

describe('Captain Beer Tracker assignment controls', () => {
  it('assigns an unassigned game with null CAS fields and prevents a duplicate submit', async () => {
    const pending = deferred<any>();
    const mounted = mountTracker({ manage: async () => pending.promise });
    await settle(mounted.harness);
    findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_LATER}`)?.props.onPress();
    mounted.harness.render();

    const assign = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`);
    assign?.props.onPress();
    assign?.props.onPress();
    mounted.harness.render();
    assert.deepEqual(mounted.calls.manage, [[GAME_LATER, TEAM_ID, PLAYER_SKATER, null, null]]);
    assert.equal(
      findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_GOALIE}`)?.props.accessibilityState.disabled,
      true,
    );

    pending.resolve({ data: {
      game_id: GAME_LATER,
      team_id: TEAM_ID,
      outcome: 'assigned',
      assignment: { ...assignedGoalie, id: '70000000-0000-4000-8000-000000000002', version: 1, player_id: PLAYER_SKATER, player_name: 'Regular Ron' },
    }, error: null });
    await settle(mounted.harness);
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Regular Ron/);
    assert.deepEqual(
      findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.accessibilityState,
      { disabled: true, selected: true },
    );
  });

  it('reassigns and clears with the exact observed assignment id and version without attendance writes', async () => {
    let mutation = 0;
    const mounted = mountTracker({
      manage: async (_gameId, _teamId, playerId) => {
        mutation += 1;
        if (mutation === 1) return { data: {
          game_id: GAME_NEXT,
          team_id: TEAM_ID,
          outcome: 'reassigned',
          assignment: { ...assignedGoalie, version: 5, player_id: playerId, player_name: 'Regular Ron' },
        }, error: null };
        return { data: {
          game_id: GAME_NEXT,
          team_id: TEAM_ID,
          outcome: 'cleared',
          assignment: { ...assignedGoalie, version: 6, player_id: null, player_name: null, player_avatar_url: null },
        }, error: null };
      },
    });
    await settle(mounted.harness);

    findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.onPress();
    await settle(mounted.harness);
    assert.deepEqual(mounted.calls.manage[0], [GAME_NEXT, TEAM_ID, PLAYER_SKATER, ASSIGNMENT_ID, 4]);
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Regular Ron/);

    const clear = findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-clear');
    assert.equal(clear?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(clear?.props.style).minHeight >= 44);
    clear?.props.onPress();
    await settle(mounted.harness);
    assert.deepEqual(mounted.calls.manage[1], [GAME_NEXT, TEAM_ID, null, ASSIGNMENT_ID, 5]);
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Unassigned/);

    const source = readFileSync(resolve(testDirectory, '../../src/screens/captain/BeerTrackerModal.tsx'), 'utf8');
    assert.doesNotMatch(source, /checkin|attendance/i);
  });

  it('refreshes on a CAS conflict and never applies the requested reassignment locally', async () => {
    let reads = 0;
    const refreshed = {
      ...trackerFixture,
      upcoming_games: trackerFixture.upcoming_games.map((game) => game.game_id === GAME_NEXT
        ? { ...game, assignment: { ...assignedGoalie, version: 5, player_name: 'Updated Goalie Gina' } }
        : game),
    };
    const mounted = mountTracker({
      tracker: async () => ({ data: ++reads === 1 ? trackerFixture : refreshed, error: null }),
      manage: async () => ({ data: {
        game_id: GAME_NEXT,
        team_id: TEAM_ID,
        outcome: 'conflict',
        assignment: { ...assignedGoalie, version: 5, player_name: 'Conflict snapshot' },
      }, error: null }),
    });
    await settle(mounted.harness);

    findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.onPress();
    await settle(mounted.harness);

    assert.deepEqual(mounted.calls.manage, [[GAME_NEXT, TEAM_ID, PLAYER_SKATER, ASSIGNMENT_ID, 4]]);
    assert.deepEqual(mounted.calls.tracker, [[TEAM_ID], [TEAM_ID]]);
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Updated Goalie Gina/);
    assert.doesNotMatch(nodeText(mounted.harness.output), /Conflict snapshot/);
    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-action-message')), /changed.*refreshed/i);
  });

  it('fails a denied captain mutation closed without leaking backend details or changing the holder', async () => {
    const mounted = mountTracker({
      manage: async () => ({ data: null, error: 'permission denied for function beer_guy_captain_manage' }),
    });
    await settle(mounted.harness);

    findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.onPress();
    await settle(mounted.harness);

    assert.match(nodeText(findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-current-holder')), /Goalie Gina/);
    const message = findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-action-message');
    assert.equal(nodeText(message), 'Unable to update Beer Guy. Refresh and try again.');
    assert.equal(message?.props.accessibilityRole, 'alert');
    assert.equal(
      findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.accessibilityState.disabled,
      false,
    );
  });
});

describe('Captain Beer Tracker completed history', () => {
  it('groups one tappable mug per completed assignment and exposes the league-local game date', async () => {
    const history = [
      { assignment_id: '70000000-0000-4000-8000-000000000011', game_id: '50000000-0000-4000-8000-000000000011', player_id: PLAYER_GOALIE, player_name: 'Goalie Gina', player_deleted: false, game_date: '2026-10-03' },
      { assignment_id: '70000000-0000-4000-8000-000000000012', game_id: '50000000-0000-4000-8000-000000000012', player_id: PLAYER_GOALIE, player_name: 'Goalie Gina', player_deleted: false, game_date: '2026-10-10' },
      { assignment_id: '70000000-0000-4000-8000-000000000013', game_id: '50000000-0000-4000-8000-000000000013', player_id: PLAYER_DELETED, player_name: '', player_deleted: true, game_date: '2026-09-26' },
    ];
    const mounted = mountTracker({ tracker: async () => ({ data: { ...trackerFixture, history }, error: null }) });
    await settle(mounted.harness);

    const goalieHistory = findNode(mounted.harness.output, node => node.props.testID === `beer-history-player-${PLAYER_GOALIE}`);
    const deletedHistory = findNode(mounted.harness.output, node => node.props.testID === `beer-history-player-${PLAYER_DELETED}`);
    assert.match(nodeText(goalieHistory), /Goalie Gina/);
    assert.match(nodeText(deletedHistory), /Former player/);
    const firstMug = findNode(goalieHistory, node => node.props.testID === 'beer-history-assignment-70000000-0000-4000-8000-000000000011');
    const secondMug = findNode(goalieHistory, node => node.props.testID === 'beer-history-assignment-70000000-0000-4000-8000-000000000012');
    assert.equal(firstMug?.props.accessibilityRole, 'button');
    assert.ok(flattenStyle(firstMug?.props.style).minHeight >= 44);
    assert.match(secondMug?.props.accessibilityLabel, /Goalie Gina.*Saturday, October 10, 2026/);
    assert.equal(findNode(mounted.harness.output, node => node.props.testID === `beer-history-assignment-${ASSIGNMENT_ID}`), undefined, 'upcoming assignment is not completed history');

    secondMug?.props.onPress();
    mounted.harness.render();
    const dialog = findNode(mounted.harness.output, node => node.props.testID === 'beer-history-date-dialog');
    assert.equal(dialog?.props.accessibilityViewIsModal, true);
    assert.match(nodeText(dialog), /Saturday, October 10, 2026/);
    findNode(dialog, node => node.props.testID === 'beer-history-date-close')?.props.onPress();
    mounted.harness.render();
    assert.equal(findNode(mounted.harness.output, node => node.props.testID === 'beer-history-date-dialog'), undefined);
  });

  it('renders truthful empty states without manufacturing eligible players or history', async () => {
    const mounted = mountTracker({ tracker: async () => ({ data: {
      ...trackerFixture,
      roster: [],
      upcoming_games: [],
      history: [],
    }, error: null }) });
    await settle(mounted.harness);

    const rendered = nodeText(mounted.harness.output);
    assert.match(rendered, /No upcoming scheduled games/);
    assert.match(rendered, /No eligible regular players are available/);
    assert.match(rendered, /No completed Beer Guy assignments yet/);
    assert.equal(findNode(mounted.harness.output, node => String(node.props.testID ?? '').startsWith('beer-tracker-player-')), undefined);
  });
});

describe('Captain Beer Tracker scope lifecycle', () => {
  it('rejects retained A actions, suppresses B after A-to-B-to-A, and invalidates actions on close', async () => {
    const pendingB = deferred<any>();
    const pendingSecondA = deferred<any>();
    let aReads = 0;
    const currentA = {
      ...trackerFixture,
      roster: trackerFixture.roster.map((player) => player.player_id === PLAYER_SKATER ? { ...player, full_name: 'Current A Player' } : player),
    };
    const staleB = {
      ...trackerFixture,
      team_id: TEAM_B,
      roster: trackerFixture.roster.map((player) => player.player_id === PLAYER_SKATER ? { ...player, full_name: 'Stale B Player' } : player),
    };
    const mounted = mountTracker({
      tracker: async (teamId) => {
        if (teamId === TEAM_B) return pendingB.promise;
        aReads += 1;
        return aReads === 1 ? { data: trackerFixture, error: null } : pendingSecondA.promise;
      },
    });
    await settle(mounted.harness);
    const retainedAAction = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.onPress;

    mounted.setParams({ teamId: TEAM_B, seasonId: SEASON_ID });
    await settle(mounted.harness);
    retainedAAction?.();
    assert.deepEqual(mounted.calls.manage, [], 'retained A action is inert after B commits');

    mounted.setParams({ teamId: TEAM_ID, seasonId: SEASON_ID });
    await settle(mounted.harness);
    pendingB.resolve({ data: staleB, error: null });
    await settle(mounted.harness);
    assert.doesNotMatch(nodeText(mounted.harness.output), /Stale B Player/);

    pendingSecondA.resolve({ data: currentA, error: null });
    await settle(mounted.harness);
    assert.match(nodeText(mounted.harness.output), /Current A Player/);
    const currentAction = findNode(mounted.harness.output, node => node.props.testID === `beer-tracker-player-${PLAYER_SKATER}`)?.props.onPress;
    findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-close')?.props.onPress();
    currentAction?.();
    assert.deepEqual(mounted.calls.back, [[]]);
    assert.deepEqual(mounted.calls.manage, [], 'close invalidates retained current actions before native unmount');
  });

  it('rejects retained close callbacks after a route scope changes', async () => {
    const historyEntry = {
      assignment_id: '70000000-0000-4000-8000-000000000020',
      game_id: '50000000-0000-4000-8000-000000000020',
      player_id: PLAYER_GOALIE,
      player_name: 'Goalie Gina',
      player_deleted: false,
      game_date: '2026-10-10',
    };
    const mounted = mountTracker({
      tracker: async (teamId: string) => ({
        data: { ...trackerFixture, team_id: teamId, history: [historyEntry] },
        error: null,
      }),
    });
    await settle(mounted.harness);
    const retainedTrackerClose = findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-close')?.props.onPress;
    findNode(mounted.harness.output, node => node.props.testID === `beer-history-assignment-${historyEntry.assignment_id}`)?.props.onPress();
    mounted.harness.render();
    const retainedHistoryClose = findNode(mounted.harness.output, node => node.type === 'Modal')?.props.onRequestClose;

    mounted.setParams({ teamId: TEAM_B, seasonId: SEASON_ID });
    await settle(mounted.harness);
    mounted.setParams({ teamId: TEAM_ID, seasonId: SEASON_ID });
    await settle(mounted.harness);
    findNode(mounted.harness.output, node => node.props.testID === `beer-history-assignment-${historyEntry.assignment_id}`)?.props.onPress();
    mounted.harness.render();
    assert.ok(findNode(mounted.harness.output, node => node.props.testID === 'beer-history-date-dialog'));

    retainedHistoryClose();
    mounted.harness.render();
    assert.ok(findNode(mounted.harness.output, node => node.props.testID === 'beer-history-date-dialog'), 'old tooltip close is inert');
    retainedTrackerClose();
    assert.deepEqual(mounted.calls.back, [], 'old tracker close is inert');
    findNode(mounted.harness.output, node => node.props.testID === 'beer-tracker-close')?.props.onPress();
    assert.deepEqual(mounted.calls.back, [[]]);
  });

  it('cleans up pending reads and reopens with fresh default selection and tooltip state', async () => {
    const historyEntry = {
      assignment_id: '70000000-0000-4000-8000-000000000021',
      game_id: '50000000-0000-4000-8000-000000000021',
      player_id: PLAYER_GOALIE,
      player_name: 'Goalie Gina',
      player_deleted: false,
      game_date: '2026-10-10',
    };
    const data = { ...trackerFixture, history: [historyEntry] };
    const first = mountTracker({ tracker: async () => ({ data, error: null }) });
    await settle(first.harness);
    findNode(first.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_LATER}`)?.props.onPress();
    first.harness.render();
    findNode(first.harness.output, node => node.props.testID === `beer-history-assignment-${historyEntry.assignment_id}`)?.props.onPress();
    first.harness.render();
    assert.ok(findNode(first.harness.output, node => node.props.testID === 'beer-history-date-dialog'));
    findNode(first.harness.output, node => node.props.testID === 'beer-tracker-close')?.props.onPress();
    first.harness.unmount();

    const reopened = mountTracker({ tracker: async () => ({ data, error: null }) });
    assert.ok(findNode(reopened.harness.output, node => node.type === 'ActivityIndicator'));
    await settle(reopened.harness);
    assert.deepEqual(
      findNode(reopened.harness.output, node => node.props.testID === `beer-tracker-game-${GAME_NEXT}`)?.props.accessibilityState,
      { selected: true },
    );
    assert.equal(findNode(reopened.harness.output, node => node.props.testID === 'beer-history-date-dialog'), undefined);

    const pending = deferred<any>();
    const closing = mountTracker({ tracker: async () => pending.promise });
    await settle(closing.harness);
    const updatesBeforeUnmount = closing.harness.stateUpdateCount;
    closing.harness.unmount();
    pending.resolve({ data, error: null });
    await settle(closing.harness);
    assert.equal(closing.harness.stateUpdateCount, updatesBeforeUnmount);
  });
});
