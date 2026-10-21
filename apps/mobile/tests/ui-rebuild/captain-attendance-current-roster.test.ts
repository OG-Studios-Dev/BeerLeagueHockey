import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileCommonJs, createHookHarness, findNode, nodeText, type TestNode } from './component-harness';

type Row = Record<string, unknown>;
const league = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const season = { id: 'current', league_id: league, status: 'active', start_date: '2026-09-01' };
const base = { team_id: '10000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', status: 'active', end_date: null, player_type: 'regular', position: 'Forward', is_goalie: false, leadership_role: null };
const rows: Row[] = [
  { ...base, id: 'a', player_id: '30000000-0000-4000-8000-000000000001', jersey_number: 7, leadership_role: 'captain' },
  { ...base, id: 'b', player_id: '30000000-0000-4000-8000-000000000001', jersey_number: null, position: 'Goalie', is_goalie: true },
  { ...base, id: 'c', player_id: 'p2', jersey_number: 96 },
  { ...base, id: 'd', player_id: 'goalie', jersey_number: 1, position: 'Goalie', is_goalie: true },
  { ...base, id: 'e', player_id: 'same-name', jersey_number: 8 },
  ...[
    { player_id: 'history', season_id: 'old' }, { player_id: 'ended', end_date: '2026-10-01' },
    { player_id: 'sub', player_type: 'sub' }, { player_id: 'part', player_type: 'part_time' },
    { player_id: 'inactive', status: 'inactive' }, { player_id: 'other-team', team_id: 'other' },
    { player_id: 'other-league', league_id: 'other' },
  ].map((extra, i) => ({ ...base, id: `excluded-${i}`, jersey_number: 20 + i, ...extra })),
];
const profiles = rows.map(row => ({ id: row.player_id, full_name: row.player_id === '30000000-0000-4000-8000-000000000001' || row.player_id === 'same-name' ? 'Cameron Wallace' : row.player_id === 'p2' ? 'Matt Grossi' : String(row.player_id), avatar_url: null }));
type RpcReply = { data: unknown; error: { message: string } | null };
type Query = { table: string; columns: string; filters: Array<[string, unknown]> };
function provider(options: { errorTable?: string; season?: Row | null; game?: Row; roleError?: boolean; checkins?: Row[]; rosterRows?: Row[]; beerError?: boolean; beerPlayerId?: string | null; rpcOverride?: (name: string, args: Row) => Promise<RpcReply | undefined>; gameRead?: (fallback: RpcReply) => Promise<RpcReply> } = {}) {
  let actorId: string | null = '30000000-0000-4000-8000-000000000001';
  const queries: Query[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  let checkins = [...(options.checkins ?? [])];
  let assignment: Row | null = options.beerPlayerId ? { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: options.beerPlayerId, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } : null;
  const game = options.game ?? { id: '20000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', home_team_id: '10000000-0000-4000-8000-000000000001', away_team_id: 'away', scheduled_at: '2026-10-21T20:00:00Z', home_team: { name: 'Home' }, away_team: { name: 'Away' } };
  const supabase = { rpc: async (name: string, args: Row) => {
    rpcCalls.push({ name, args });
    const override = await options.rpcOverride?.(name, args);
    if (override) return override;
    if (name === 'captain_manage_game_checkin') {
      checkins = checkins.filter(row => row.player_id !== args.p_player_id);
      if (args.p_operation === 'set') checkins.push({ game_id: args.p_game_id, team_id: args.p_team_id, player_id: args.p_player_id, status: args.p_status });
      if (args.p_status !== 'confirmed' && assignment !== null && assignment.player_id === args.p_player_id) assignment = { ...assignment, version: Number(assignment.version) + 1, player_id: null, player_name: null };
      return { data: { outcome: args.p_operation, operation: args.p_operation, status: args.p_status, affected_rows: 1, checkin_id: '50000000-0000-4000-8000-000000000001' }, error: null };
    }
    if (options.beerError) return { data: null, error: { message: 'Beer unavailable' } };
    if (name === 'beer_guy_get_game_state') return { data: { game_id: args.p_game_id, team_id: args.p_team_id, caller_eligible: true, assignment }, error: null };
    assert.equal(name, 'beer_guy_captain_manage');
    if (args.p_player_id) {
      checkins = checkins.filter(row => row.player_id !== args.p_player_id);
      checkins.push({ game_id: args.p_game_id, team_id: args.p_team_id, player_id: args.p_player_id, status: 'confirmed' });
    }
    const previous = assignment;
    assignment = { id: previous?.id ?? '40000000-0000-4000-8000-000000000001', version: Number(previous?.version ?? 0) + 1, player_id: args.p_player_id, player_name: args.p_player_id ? 'Cameron Wallace' : null, player_avatar_url: null, status: 'pending' };
    return { data: { game_id: args.p_game_id, team_id: args.p_team_id, outcome: args.p_player_id ? 'assigned' : 'cleared', assignment }, error: null };
  }, auth: { getUser: async () => ({ data: { user: actorId ? { id: actorId } : null } }) }, from(table: string) {
    const query: Query = { table, columns: '', filters: [] }; queries.push(query);
    let max = Infinity;
    const result = (single = false) => {
      if (table === options.errorTable || (options.roleError && table === 'team_rosters' && query.columns === 'leadership_role')) return { data: null, error: { message: 'denied' } };
      let data: Row[] = table === 'team_rosters' ? options.rosterRows ?? rows : table === 'game_checkins' ? checkins : table === 'profiles' ? profiles : table === 'games' ? [game] : table === 'seasons' ? (options.season === null ? [] : [options.season ?? season]) : [];
      data = data.filter(row => query.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, max);
      // Honor projection: a missing scope field must not accidentally rescue a broken reader.
      const columns = query.columns.split(',').map(x => x.trim());
      data = data.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key) || query.columns.includes(`${key}:`))));
      return { data: single ? data[0] ?? null : data, error: null };
    };
    const builder = {
      select(columns: string) { query.columns = columns; return builder; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      is(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      in(key: string, value: unknown[]) { query.filters.push([key, value]); return builder; },
      order() { return builder; }, limit(value: number) { max = value; return builder; },
      maybeSingle: async () => table === 'games' && options.gameRead ? options.gameRead(result(true)) : result(true),
      then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
    }; return builder;
  } };
  return { supabase, queries, rpcCalls, getUser: () => actorId ? { id: actorId } : null, setUserId: (id: string | null) => { actorId = id; } };
}
async function mount(options: Parameters<typeof provider>[0] = {}) {
  const transport = provider(options); const h = createHookHarness();
  const team = compileCommonJs<typeof import('../../src/lib/supabase/team')>(new URL('../../src/lib/supabase/team.ts', import.meta.url), { './client': transport });
  const beer = compileCommonJs<typeof import('../../src/lib/supabase/beerGuy')>(new URL('../../src/lib/supabase/beerGuy.ts', import.meta.url), { './client': { ...transport, publicSupabase: transport.supabase } });
  const captain = compileCommonJs<typeof import('../../src/lib/supabase/captain')>(new URL('../../src/lib/supabase/captain.ts', import.meta.url), { './client': transport });
  const data = compileCommonJs<typeof import('../../src/lib/supabase/data')>(new URL('../../src/lib/supabase/data.ts', import.meta.url), { './client': transport, './publicStats': {} });
  const Screen = compileCommonJs<{ default: (props: unknown) => unknown }>(new URL('../../src/screens/captain/GameAvailabilityScreen.tsx', import.meta.url), {
    react: h.react, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Modal: () => null, StyleSheet: { create: (s: unknown) => s } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../../components/Avatar': () => null,
    '../../components/SelectableControl': { SelectableControl: 'Control', SelectableControlGroup: 'Group' },
    '../../components/AccessibleChoiceGroup': () => null,
    '../../components/captain/FindSpareModal': (props: Record<string, unknown>) => props.visible ? h.react.createElement('FindSpareBoundary', props) : null,
    '../../context/AuthContext': { useAuth: () => ({ user: transport.getUser() }) },
    '../../config/hockeyLife': { HOCKEY_LIFE_ID: league }, '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (v: unknown) => v },
    '../../theme/colors': { default: {}, __esModule: true }, '../../lib/supabase/client': transport,
    '../../lib/supabase/team': team, '../../lib/supabase/data': data, '../../lib/supabase/beerGuy': beer,
    '../../lib/supabase/captain': { ...captain, getTeamSubInvitations: async () => ({ data: [] }), getOpenGoalieRequest: async () => null },
  }).default;
  let params = { gameId: '20000000-0000-4000-8000-000000000001', teamId: '10000000-0000-4000-8000-000000000001', leagueId: league };
  h.mount(() => Screen({ route: { params }, navigation: { goBack() {} } }));
  for (let i = 0; i < 100; i += 1) { await Promise.resolve(); h.render(); }
  return { h, ...transport, setUser(id: string | null) { transport.setUserId(id); h.render(); }, setParams(next: typeof params) { params = next; h.render(); }, async settle() { for (let i = 0; i < 100; i += 1) { await Promise.resolve(); h.render(); } } };
}
function allNodes(value: unknown): TestNode[] {
  if (Array.isArray(value)) return value.flatMap(allNodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as TestNode; return [node, ...allNodes(node.props.children)];
}
it('removes Captain tools while retaining attendance, Beer Guy, and visible failed-action feedback', async () => {
  const player = '30000000-0000-4000-8000-000000000001';
  const run = await mount({ rpcOverride: async name => name === 'captain_manage_game_checkin'
    ? { data: null, error: { message: 'Attendance update denied' } } : undefined });
  const status = findNode(run.h.output, node => node.props.testID === `captain-status-${player}-out`);
  assert.ok(status); status.props.onPress(); await run.settle();
  const alert = findNode(run.h.output, node => node.props.testID === 'captain-action-error');
  assert.ok(alert); assert.equal(alert.props.accessibilityRole, 'alert');
  assert.match(nodeText(alert), /Attendance update denied/);
  assert.match(nodeText(run.h.output), /vs Away/);
  assert.match(nodeText(run.h.output), /No Response \(4\)/);
  for (const choice of ['confirmed', 'tentative', 'out', 'waiting']) {
    assert.ok(findNode(run.h.output, node => node.props.testID === `captain-status-${player}-${choice}`));
  }
  assert.ok(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`));
  assert.equal(run.rpcCalls.filter(call => call.name === 'captain_manage_game_checkin').length, 1);
  assert.equal(findNode(run.h.output, node => node.props.focusId === `availability:20000000-0000-4000-8000-000000000001:captain`), undefined);
  assert.doesNotMatch(nodeText(run.h.output), /Captain tools|Manage this game for your current Hockey Life team\.|Request Sub|Request Goalie/);
  for (const testID of ['captain-request-sub', 'captain-request-goalie']) {
    assert.equal(findNode(run.h.output, node => node.props.testID === testID), undefined);
  }
  run.h.unmount();
});

it('renders one current regular canonical player per row/count from the production roster provider', async () => {
  const run = await mount();
  const controls = allNodes(run.h.output).filter(node => node.props.testID?.startsWith('captain-status-') && node.props.testID.endsWith('-waiting'));
  assert.deepEqual(controls.map(node => node.props.testID).sort(), ['goalie', '30000000-0000-4000-8000-000000000001', 'p2', 'same-name'].map(id => `captain-status-${id}-waiting`).sort());
  assert.match(nodeText(run.h.output), /No Response \(4\)/);
  assert.equal(allNodes(run.h.output).filter(node => node.type === 'Text' && nodeText(node) === 'Cameron Wallace').length, 2, 'distinct identities with the same name are retained');
  assert.match(nodeText(run.h.output), /Goalie/);
  const roster = run.queries.find(q => q.table === 'team_rosters' && q.columns.includes('player_type'));
  assert.ok(roster); assert.deepEqual(roster.filters, [['team_id', '10000000-0000-4000-8000-000000000001'], ['league_id', league], ['season_id', 'current'], ['status', 'active'], ['end_date', null], ['player_type', 'regular']]);
  const profileQuery = run.queries.find(q => q.table === 'profiles');
  assert.equal(new Set(profileQuery?.filters[0][1] as string[]).size, 4);
  run.h.unmount();
});

it('derives every availability group and count from the same unique accepted roster', async () => {
  const checkins = [
    { player_id: '30000000-0000-4000-8000-000000000001', status: 'confirmed' }, { player_id: 'p2', status: 'confirmed' },
    { player_id: 'goalie', status: 'tentative' }, { player_id: 'history', status: 'confirmed' },
    { player_id: 'sub', status: 'out' },
  ].map(row => ({ ...row, game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001' }));
  const run = await mount({ checkins });
  const text = nodeText(run.h.output);
  assert.match(text, /In \(2\)/); assert.match(text, /Maybe \(1\)/); assert.match(text, /No Response \(1\)/);
  assert.doesNotMatch(text, /Out \(1\)|history|part|inactive/);
  const selected = allNodes(run.h.output).filter(node => node.type === 'Control' && node.props.selected);
  assert.deepEqual(selected.map(node => node.props.testID).sort(), ['captain-status-goalie-tentative', 'captain-status-30000000-0000-4000-8000-000000000001-confirmed', 'captain-status-p2-confirmed', 'captain-status-same-name-waiting'].sort());
  run.h.unmount();
});
it('fails closed on roster/profile/season transport errors instead of rendering historical members', async () => {
  for (const errorTable of ['team_rosters', 'profiles', 'seasons']) {
    const run = await mount({ errorTable });
    assert.match(nodeText(run.h.output), /Unable to load game availability|not in the current Hockey Life season/);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-30000000-0000-4000-8000-000000000001-confirmed'), undefined);
    run.h.unmount();
  }
});
it('rejects missing season and forged game scope before roster/check-in reads', async () => {
  const game = { id: '20000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', home_team_id: '10000000-0000-4000-8000-000000000001', away_team_id: 'away' };
  for (const options of [{ season: null }, { game: { ...game, season_id: 'history' } }, { game: { ...game, league_id: 'other' } }, { game: { ...game, home_team_id: 'other' } }]) {
    const run = await mount(options);
    assert.match(nodeText(run.h.output), /does not belong|not in the current/);
    assert.equal(run.queries.some(query => query.table === 'team_rosters' || query.table === 'game_checkins'), false);
    run.h.unmount();
  }
});
it('runs the exact production captain scope and default-denies a historical role or lookup error', async () => {
  for (const options of [
    { roleError: true },
    { rosterRows: rows.map(row => row.player_id === '30000000-0000-4000-8000-000000000001' ? { ...row, leadership_role: null } : row).concat([{ ...base, id: 'historical-captain', player_id: '30000000-0000-4000-8000-000000000001', season_id: 'old', leadership_role: 'captain' }]) },
  ]) {
    const run = await mount(options);
    assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-30000000-0000-4000-8000-000000000001-confirmed'), undefined);
    assert.equal(run.queries.some(query => query.table === 'game_checkins'), false);
    const role = run.queries.find(query => query.columns === 'leadership_role');
    assert.ok(role);
    assert.deepEqual(role.filters, [['team_id', '10000000-0000-4000-8000-000000000001'], ['player_id', '30000000-0000-4000-8000-000000000001'], ['league_id', league], ['season_id', 'current'], ['status', 'active'], ['end_date', null], ['leadership_role', ['captain', 'alternate_captain']]]);
    run.h.unmount();
  }
});


it('captain Beer Guy assignment uses the real CAS adapter, checks in as In, and clearing keeps In', async () => {
  const player = '30000000-0000-4000-8000-000000000001';
  const run = await mount();
  const beer = () => findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`);
  assert.ok(beer(), 'captain can assign canonical Beer Guy from the attendance row');
  assert.equal(beer()?.props.accessibilityState.checked, false);
  beer()?.props.onPress(); await run.settle();
  assert.equal(beer()?.props.accessibilityState.checked, true);
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-status-${player}-confirmed`)?.props.selected, true);
  const assign = run.rpcCalls.find(call => call.name === 'beer_guy_captain_manage');
  assert.deepEqual(assign?.args, { p_game_id: '20000000-0000-4000-8000-000000000001', p_team_id: '10000000-0000-4000-8000-000000000001', p_player_id: player, p_expected_assignment_id: null, p_expected_version: null });
  beer()?.props.onPress(); await run.settle();
  assert.equal(beer()?.props.accessibilityState.checked, false);
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-status-${player}-confirmed`)?.props.selected, true);
  const clear = run.rpcCalls.filter(call => call.name === 'beer_guy_captain_manage')[1];
  assert.equal(clear.args.p_expected_assignment_id, '40000000-0000-4000-8000-000000000001');
  assert.equal(clear.args.p_expected_version, 1);
  run.h.unmount();
});

it('reconciles Beer Guy after every non-In status and retains the observed cleared-row CAS token', async () => {
  const player = '30000000-0000-4000-8000-000000000001';
  const run = await mount();
  const button = (id: string) => findNode(run.h.output, node => node.props.testID === id);
  for (const status of ['tentative', 'out', 'waiting']) {
    button(`captain-beer-${player}`)?.props.onPress(); await run.settle();
    assert.equal(button(`captain-beer-${player}`)?.props.accessibilityState.checked, true);
    const before = run.rpcCalls.filter(call => call.name === 'beer_guy_get_game_state').length;
    button(`captain-status-${player}-${status}`)?.props.onPress(); await run.settle();
    assert.ok(run.rpcCalls.filter(call => call.name === 'beer_guy_get_game_state').length > before, 'status completion reads canonical assignment again');
    assert.equal(button(`captain-beer-${player}`)?.props.accessibilityState.checked, false);
    assert.equal(button(`captain-status-${player}-${status}`)?.props.selected, true);
  }
  run.h.unmount();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
it('releases the beer write guard when its confirmed result arrives during same-route refresh', async () => {
  const player = '30000000-0000-4000-8000-000000000001';
  const mutation = deferred<RpcReply>(); const read = deferred<RpcReply>(); let reads = 0;
  const run = await mount({ rpcOverride: async (name) => {
    if (name === 'beer_guy_captain_manage') return mutation.promise;
    if (++reads === 2) return read.promise;
    return undefined;
  } });
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  const scroll = findNode(run.h.output, node => node.type === 'ScrollView');
  const refresh = scroll?.props.refreshControl.props.onRefresh(); await run.settle();
  const assignment = { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: player, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' };
  mutation.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', outcome: 'assigned', assignment }, error: null });
  await run.settle();
  read.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', caller_eligible: true, assignment: null }, error: null });
  await refresh; await run.settle();
  const beer = findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`);
  assert.equal(beer?.props.accessibilityState.checked, true, 'confirmed assignment survives older refresh');
  assert.equal(beer?.props.disabled, false, 'settled write guard must not remain pinned after refresh');
  run.h.unmount();
});

it('unpins a beer edit settled before refresh has revalidated the game', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const mutation = deferred<RpcReply>(); const game = deferred<RpcReply>(); let gameReads = 0;
  let currentGame: RpcReply = { data: null, error: null };
  const run = await mount({ gameRead: async fallback => { currentGame = fallback; return ++gameReads === 2 ? game.promise : fallback; }, rpcOverride: async name => name === 'beer_guy_captain_manage' ? mutation.promise : undefined });
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  const refresh = findNode(run.h.output, node => node.type === 'ScrollView')?.props.refreshControl.props.onRefresh(); await run.settle();
  mutation.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', outcome: 'assigned', assignment: { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: player, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } }, error: null });
  await run.settle(); game.resolve(currentGame); await refresh; await run.settle();
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.disabled, false);
  run.h.unmount();
});

it('keeps unknown/error beer visibly unknown and disabled, without guessing from an attendance status', async () => {
  const run = await mount({ beerError: true });
  const beer = findNode(run.h.output, node => node.props.testID === 'captain-beer-30000000-0000-4000-8000-000000000001');
  assert.ok(beer); assert.equal(beer.props.disabled, true); assert.equal(beer.props.accessibilityState.checked, 'mixed');
  assert.match(nodeText(beer), /unavailable/); beer.props.onPress(); await run.settle();
  assert.equal(run.rpcCalls.some(call => call.name === 'beer_guy_captain_manage'), false); run.h.unmount();
});
it('does not count a conflict or rejected captain beer mutation as an In check-in', async () => {
  const player = '30000000-0000-4000-8000-000000000001';
  for (const conflict of [true, false]) {
    const run = await mount({ rpcOverride: async (name, args) => name !== 'beer_guy_captain_manage' ? undefined : conflict ? {
      data: { game_id: args.p_game_id, team_id: args.p_team_id, outcome: 'conflict', assignment: { id: '40000000-0000-4000-8000-000000000001', version: 2, player_id: player, player_name: 'Other captain', player_avatar_url: null, status: 'pending' } }, error: null,
    } : { data: null, error: { message: 'Denied beer change' } } });
    findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
    assert.match(nodeText(run.h.output), conflict ? /Beer Guy changed/ : /Denied beer change/);
    assert.match(nodeText(run.h.output), /No Response \(4\)/);
    assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.accessibilityState.checked, false);
    run.h.unmount();
  }
});
it('serializes the global Beer Guy mutation against all status actions and ignores duplicate taps', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const pending = deferred<RpcReply>();
  const run = await mount({ rpcOverride: async name => name === 'beer_guy_captain_manage' ? pending.promise : undefined });
  const beer = findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`);
  const status = findNode(run.h.output, node => node.props.testID === 'captain-status-p2-out');
  beer?.props.onPress(); beer?.props.onPress(); status?.props.onPress(); await run.settle();
  assert.equal(run.rpcCalls.filter(call => call.name === 'beer_guy_captain_manage').length, 1);
  assert.equal(run.rpcCalls.filter(call => call.name === 'captain_manage_game_checkin').length, 0);
  assert.equal(findNode(run.h.output, node => node.props.testID === 'captain-status-p2-out')?.props.disabled, true);
  pending.resolve({ data: null, error: { message: 'No write' } }); await run.settle(); run.h.unmount();
});
it('suppresses every beer completion state update after unmount', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const pending = deferred<RpcReply>();
  const run = await mount({ rpcOverride: async name => name === 'beer_guy_captain_manage' ? pending.promise : undefined });
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  run.h.unmount(); const count = run.h.stateUpdateCount;
  pending.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', outcome: 'assigned', assignment: { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: player, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } }, error: null });
  await run.settle(); assert.equal(run.h.stateUpdateCount, count);
});
it('reads its successful beer assignment and attendance back through the same provider on reload', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const run = await mount();
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  const refresh = findNode(run.h.output, node => node.type === 'ScrollView')?.props.refreshControl.props.onRefresh(); await refresh; await run.settle();
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.accessibilityState.checked, true);
  assert.match(nodeText(run.h.output), /In \(1\)/); run.h.unmount();
});

it('does not publish a late A beer success into an already validated B game', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const pending = deferred<RpcReply>();
  const game = { id: '20000000-0000-4000-8000-000000000001', league_id: league, season_id: 'current', home_team_id: '10000000-0000-4000-8000-000000000001', away_team_id: 'away', scheduled_at: '2026-10-21T20:00:00Z' };
  const run = await mount({ game, rpcOverride: async name => name === 'beer_guy_captain_manage' ? pending.promise : undefined });
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  game.id = '20000000-0000-4000-8000-000000000002';
  run.setParams({ gameId: game.id, teamId: String(game.home_team_id), leagueId: league }); await run.settle();
  const updates = run.h.stateUpdateCount;
  pending.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', outcome: 'assigned', assignment: { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: player, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } }, error: null });
  await run.settle();
  assert.equal(run.h.stateUpdateCount, updates);
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.accessibilityState.checked, false);
  assert.match(nodeText(run.h.output), /No Response \(4\)/); run.h.unmount();
});
it('rejects beer toggles while a captain status write is pending and restores the previous beer/status after failure', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const pending = deferred<RpcReply>();
  const run = await mount({ beerPlayerId: player, checkins: [{ game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', player_id: player, status: 'confirmed' }], rpcOverride: async name => name === 'captain_manage_game_checkin' ? pending.promise : undefined });
  const beer = findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`);
  findNode(run.h.output, node => node.props.testID === `captain-status-${player}-out`)?.props.onPress();
  beer?.props.onPress(); await run.settle();
  assert.equal(run.rpcCalls.some(call => call.name === 'beer_guy_captain_manage'), false);
  pending.resolve({ data: null, error: { message: 'Rejected attendance' } }); await run.settle();
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.accessibilityState.checked, true);
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-status-${player}-confirmed`)?.props.selected, true); run.h.unmount();
});

it('withholds A beer data after a same-route actor change and ignores its late successful mutation', async () => {
  const player = '30000000-0000-4000-8000-000000000001'; const pending = deferred<RpcReply>();
  const run = await mount({ rpcOverride: async name => name === 'beer_guy_captain_manage' ? pending.promise : undefined });
  findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`)?.props.onPress(); await run.settle();
  run.setUser('p2'); await run.settle();
  assert.equal(findNode(run.h.output, node => node.props.testID === `captain-beer-${player}`), undefined);
  const updates = run.h.stateUpdateCount;
  pending.resolve({ data: { game_id: '20000000-0000-4000-8000-000000000001', team_id: '10000000-0000-4000-8000-000000000001', outcome: 'assigned', assignment: { id: '40000000-0000-4000-8000-000000000001', version: 1, player_id: player, player_name: 'Cameron Wallace', player_avatar_url: null, status: 'pending' } }, error: null });
  await run.settle(); assert.equal(run.h.stateUpdateCount, updates); assert.match(nodeText(run.h.output), /No Response \(4\)/); run.h.unmount();
});
