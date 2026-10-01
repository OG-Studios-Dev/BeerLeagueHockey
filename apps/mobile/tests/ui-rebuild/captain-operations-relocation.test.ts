/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs, createElement, createHookHarness, findNode, nodeText } from './component-harness';

const HOCKEY_LIFE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const routeParams = { gameId: 'game-1', teamId: 'team-1', leagueId: HOCKEY_LIFE_ID };
const roster = [{
  id: 'roster-1', player_id: 'player-1', team_id: 'team-1', jersey_number: 9,
  position: 'F', is_goalie: false, player_name: 'Alex Skater', avatar_url: null,
}];
const validGame = {
  id: 'game-1', league_id: HOCKEY_LIFE_ID, scheduled_at: '2026-10-10T20:00:00.000Z',
  location: 'Rink A', home_team_id: 'team-1', away_team_id: 'team-2',
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

function nativeMock(onAlert: (...args: any[]) => void = () => {}) {
  return {
    ActivityIndicator: 'ActivityIndicator', Modal: ({ visible, children }: any) => visible ? createElement('Modal', {}, children) : null,
    Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: (p: any) => createElement('ScrollView', p, p.children),
    Text: 'Text', TextInput: 'TextInput', View: 'View', Alert: { alert: onAlert },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
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
  statusResult?: any; statusResults?: any[]; inviteResult?: any; goalieResult?: any;
  getSubs?: (...args: any[]) => Promise<any>; invite?: (...args: any[]) => Promise<any>;
  goalie?: (...args: any[]) => Promise<any>; invitations?: (...args: any[]) => Promise<any>;
  goalieLoad?: (...args: any[]) => Promise<any>;
  getRole?: (...args: any[]) => Promise<'captain' | 'alternate_captain' | null>;
} = {}) {
  const h = createHookHarness();
  let currentParams = options.params ?? routeParams;
  let authUser = options.user === undefined ? { id: 'captain-1' } : options.user;
  const calls: Record<string, any[]> = {
    roster: [], role: [], checkins: [], subs: [], invitations: [], goalieLoad: [], status: [], clear: [], invite: [], goalie: [], back: [], alert: [],
  };
  const services = {
    getCaptainRole: async (...args: any[]) => { calls.role.push(args); return options.getRole ? options.getRole(...args) : options.role === undefined ? 'captain' : options.role; },
    getGameCheckinStatusMap: async (...args: any[]) => { calls.checkins.push(args); return { 'player-1': 'confirmed' }; },
    getLeagueSubPlayers: async (...args: any[]) => { calls.subs.push(args); return options.getSubs ? options.getSubs(...args) : { success: true, error: null, data: [{ id: 'sub-7', full_name: 'Sam Sub', email: 'sam@example.test' }] }; },
    getTeamSubInvitations: async (...args: any[]) => { calls.invitations.push(args); return options.invitations ? options.invitations(...args) : { success: true, error: null, data: [] }; },
    getOpenGoalieRequest: async (...args: any[]) => { calls.goalieLoad.push(args); return options.goalieLoad ? options.goalieLoad(...args) : null; },
    updatePlayerCheckinAsCaptain: async (...args: any[]) => { calls.status.push(args); return options.statusResults?.shift() ?? options.statusResult ?? { success: true }; },
    clearPlayerCheckinAsCaptain: async (...args: any[]) => { calls.clear.push(args); return { success: true }; },
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
    '../../lib/supabase/client': { supabase: { from: (table: string) => {
      assert.equal(table, 'games');
      return resultBuilder({ data: options.game === undefined ? validGame : options.game, error: null });
    } } },
    '../../lib/supabase/data': { getTeamRoster: async (...args: any[]) => { calls.roster.push(args); return roster; } },
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

describe('private captain operations relocation', () => {
  it('navigates from the real captain dashboard and mounts operations only after exact route authorization', async () => {
    const dashboard = createHookHarness();
    const dashboardUser = { id: 'captain-1' };
    const navigationCalls: any[][] = [];
    let teamRosterCalls = 0;
    const Dashboard = compileCommonJs<{ default: (props: any) => unknown }>(new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url), {
      react: dashboard.react, 'react-native': nativeMock(), '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
      'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (value: any) => value },
      '../../components/BrandAtmosphere': () => null, '../../components/SectionHeader': ({ title }: any) => createElement('Text', {}, title),
      '../../components/TeamLogo': () => null, '../../context/AuthContext': { useAuth: () => ({ user: dashboardUser }) },
      '../../config/hockeyLife': { HOCKEY_LIFE_ID },
      '../../lib/supabase/client': { supabase: { from: (table: string) => {
        if (table === 'games') return resultBuilder({ data: validGame, error: null });
        teamRosterCalls += 1;
        return resultBuilder(teamRosterCalls === 1 ? { data: [{
          team_id: 'team-1', league_id: HOCKEY_LIFE_ID, leadership_role: 'captain',
          team: { id: 'team-1', name: 'Owls', logo_url: null, primary_color: '#123456' },
          league: { id: HOCKEY_LIFE_ID, name: 'Hockey Life' },
        }] } : { count: 12 });
      } } },
      '../../theme/colors': { __esModule: true, default: { bgBase: '#000', textPrimary: '#fff', textSecondary: '#aaa', primary: '#06f', brandGold: '#fc0', bgSurface: '#111', glassStroke: '#333', bgInteractive: '#222' } },
    }).default;
    dashboard.mount(() => Dashboard({ navigation: { navigate: (...args: any[]) => navigationCalls.push(args), goBack() {} } }));
    await settle(dashboard);
    const availability = findNode(dashboard.output, node => /Availability/.test(nodeText(node)) && typeof node.props.onPress === 'function');
    assert.ok(availability, `captain dashboard exposes its existing Availability destination; rendered ${nodeText(dashboard.output)}`);
    availability.props.onPress();
    assert.deepEqual(navigationCalls, [['GameAvailability', routeParams]]);

    const authorized = mountAvailability();
    await settle(authorized.h);
    assert.deepEqual(authorized.calls.role, [['team-1']]);
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
    assert.deepEqual(mounted.calls.role.at(-1), ['team-1']);

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
