/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileCommonJs } from './component-harness';
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const pnpm = fileURLToPath(new URL('../../../../node_modules/.pnpm/', import.meta.url).href);
const jsdom = readdirSync(pnpm).find(p => p.startsWith('jsdom@'))!;
const { JSDOM } = createRequire(`${pnpm}${jsdom}/node_modules/jsdom/package.json`)('jsdom');
const scope = { gameId: 'game-1', teamId: 'team-1', leagueId: 'd6e55507-6eae-4d94-978c-47c6c30a36f1' };
const context = (s = scope, recent = false) => ({ schema_version: 1, game_id: s.gameId, team_id: s.teamId, league_id: s.leagueId, season_id: 'season-1',
  replacements: [{ player_id: 'out-f', full_name: 'Alex Out', position: 'Forward', jersey_number: 17 }, { player_id: 'out-g', full_name: 'Goalie Out', position: 'Goalie', jersey_number: 30 }],
  candidates: [{ player_id: 'sub-1', full_name: 'Jordán Demo', email: 'jordan@example.invalid', position: 'Forward', source: 'team' }, { player_id: 'sub-g', full_name: 'Goalie Demo', email: null, position: 'Goalie', source: 'league' }],
  recent_players: recent ? [{ player_id: 'recent-1', full_name: 'Recent Demo', email: null, position: 'Forward', source: 'recent', last_played_at: '2026-10-01T20:00:00Z' }] : [], recent_loaded: recent, invitations: [] });
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
async function mount(options: any = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const props = new Map<string, any>(); const calls = { reads: [] as any[], writes: [] as any[], legacy: [] as any[] };
  const host = (tag: string) => function Host(p: any) { if (p.testID) props.set(p.testID, p); return React.createElement(tag, { 'data-testid': p.testID, onClick: p.onPress, disabled: p.disabled, 'aria-label': p.accessibilityLabel, role: p.accessibilityRole === 'alert' ? 'alert' : undefined }, p.children); };
  const native = { ImageBackground: host('div'), View: host('div'), Text: host('span'), Pressable: host('button'), TextInput: host('div'), ScrollView: host('section'), KeyboardAvoidingView: host('div'), ActivityIndicator: host('i'), RefreshControl: host('i'), Modal: (p: any) => p.visible ? React.createElement('aside', { 'data-testid': 'native-modal' }, p.children) : null, Platform: { OS: 'ios' }, StyleSheet: { create: (s: any) => s }, Alert: { alert() {} } };
  const builder = (data: any) => { const b: any = { select: () => b, eq: () => b, is: () => b, in: () => b, or: () => b, gte: () => b, order: () => b, limit: () => b, maybeSingle: async () => ({ data, error: null }), then: (yes: any) => Promise.resolve({ data, error: null }).then(yes) }; return b; };
  let actor = 'captain-1'; let params: any = { ...scope, intent: 'invite-sub' };
  const game = { id: scope.gameId, league_id: scope.leagueId, season_id: 'season-1', scheduled_at: '2026-10-22T20:30:00Z', home_team_id: scope.teamId, away_team_id: 'team-2', home_team: { name: 'Home' }, away_team: { name: 'Away' } };
  const mocks: any = { react: React, 'react-native': native, '@expo/vector-icons': { Ionicons: host('i'), MaterialCommunityIcons: host('i') }, 'expo-linear-gradient': { LinearGradient: host('div') }, 'react-native-safe-area-context': { SafeAreaView: host('main'), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useIsFocused: () => options.focused !== false },
    '../../components/CardFocus': { FocusCard: host('div'), FocusScrollView: host('section') }, '../../components/Avatar': () => null, '../../components/TeamLogo': () => null, '../../assets/team-page/weekly-games-bg.jpg': 'fixture',
    '../../components/SectionHeader': { SECTION_HEADING_TEXT_STYLE: {} }, '../../components/AccessibleChoiceGroup': () => null, '../../components/SelectableControl': { SelectableControl: host('button'), SelectableControlGroup: host('div') },
    '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (v: any) => v }, '../../context/AuthContext': { useAuth: () => ({ user: actor ? { id: actor } : null }) }, '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true, reduceTransparency: true }) }, '../../config/hockeyLife': { HOCKEY_LIFE_ID: scope.leagueId },
    '../../config/publicLinks': { buildHockeyLifeCaptainLineupUrl: () => null }, '../../lib/publicLinks': {},
    '../../lib/supabase/client': { supabase: { from: (table: string) => builder(table === 'games' ? { ...game, id: params.gameId, home_team_id: params.teamId } : [{ team_id: scope.teamId, league_id: scope.leagueId, leadership_role: 'captain', team: { name: 'Home', id: scope.teamId }, league: { timezone: 'America/Toronto' } }]) } },
    '../../lib/supabase/team': { getTeamActiveSeason: async () => ({ season: { id: 'season-1', status: 'active' }, error: null }), getActiveSeasonRoster: async () => [] },
    '../../lib/supabase/captain': { getCaptainRoleForSeason: async () => options.role === undefined ? 'captain' : options.role, getGameCheckinStatusMap: async () => ({}), getTeamSubInvitations: async () => ({ data: [] }), getOpenGoalieRequest: async () => null, getLeagueSubPlayers: async (...args: any[]) => { calls.legacy.push(args); return { success: true, data: [] }; } },
    '../../lib/supabase/beerGuy': { getBeerGuyGameState: async () => ({ data: { assignment: null }, error: null }) },
    '../../lib/supabase/subInvitations': { getCaptainSubInvitationContext: async (...args: any[]) => { calls.reads.push(args); return options.read ? options.read(...args) : { data: context(args[0], args[2]), error: null }; }, manageCaptainSubInvitation: async (command: any) => { calls.writes.push(command); return options.write ? options.write(command) : { data: null, error: 'offline unknown result' }; }, createCaptainSubInvitationRequestId: () => `request-${calls.writes.length + 1}` },
    '../../theme/colors': { __esModule: true, default: { bgModal: '#08121f', bgInteractive: '#10223b', glassStroke: '#263b50', textPrimary: '#fff', textSecondary: '#a8b4c8', primary: '#22d3ee', accentGreen: '#34d399', accentRed: '#f87171' } } };
  const Screen = compileCommonJs<any>(new URL('../../src/screens/captain/GameAvailabilityScreen.tsx', import.meta.url), mocks).default;
  const Modal = options.modalOnly ? compileCommonJs<any>(new URL('../../src/components/captain/FindSpareModal.tsx', import.meta.url), mocks).default : null;
  const root = createRoot(dom.window.document.getElementById('root')); let visible = true;
  const Dashboard = options.dashboard ? compileCommonJs<any>(new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url), mocks).default : null;
  let dashboard = Boolean(options.dashboard);
  const navigation = { goBack() {}, navigate(_route: string, next: any) { params = next; dashboard = false; void render(); } };
  const render = async () => { await React.act(async () => { root.render(React.createElement(React.StrictMode, null, dashboard ? React.createElement(Dashboard, { navigation }) : options.modalOnly ? React.createElement(Modal, { scope: params, actorId: actor, visible, onClose() { visible = false; void render(); } }) : React.createElement(Screen, { route: { params }, navigation: { goBack() {} } }))); }); };
  await render();
  return { calls, props, dom, render, text: () => dom.window.document.body.textContent ?? '',
    async press(id: string) { const node = dom.window.document.querySelector(`[data-testid="${id}"]`) as HTMLElement; assert.ok(node, `missing ${id}`); await React.act(async () => { node.click(); }); },
    async edit(id: string, value: string) { assert.ok(props.get(id), `missing ${id}`); await React.act(async () => props.get(id).onChangeText(value)); },
    async change(p: any) { params = p; await render(); }, async actor(id: string) { actor = id; await render(); }, async visibility(v: boolean) { visible = v; await render(); },
    async close() { await React.act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); } };
}
it('opens native Find Spare from the authorized dashboard route intent without legacy reads or tools', async () => {
  const run = await mount({ dashboard: true }); try { await run.press('captain-invite-sub'); assert.match(run.text(), /Find Spare/); assert.equal(run.calls.legacy.length, 0); assert.ok(run.calls.reads.length > 0); assert.doesNotMatch(run.text(), /Captain tools|Request Sub|Request Goalie/); await run.press('find-spare-done'); assert.doesNotMatch(run.text(), /Find Spare/); } finally { await run.close(); }
});

it('keeps website replacement/message/search ordering and filters available spares by canonical role', async () => {
  const run = await mount({ modalOnly: true }); try {
    assert.equal(run.props.get('find-spare-replacement')?.accessibilityLabel, 'Replacing Alex Out');
    assert.ok(run.props.has('find-spare-confirmed'));
    assert.match(run.text(), /Sub already confirmed in/);
    assert.match(run.text(), /Jordán Demo/); assert.doesNotMatch(run.text(), /Goalie Demo/);
    await run.edit('find-spare-search', 'jordan'); assert.match(run.text(), /Jordán Demo/);
    await run.press('find-spare-replacement'); await run.press('find-spare-replace-out-g');
    assert.equal(run.props.get('find-spare-search').value, '');
    assert.match(run.text(), /Goalie Demo/); assert.doesNotMatch(run.text(), /Jordán Demo/);
    await run.press('find-spare-confirmed');
    await run.press('find-spare-replacement'); await run.press('find-spare-replace-none');
    assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-confirmed"]'), null);
    assert.match(run.text(), /Jordán Demo/); assert.match(run.text(), /Goalie Demo/);
    await run.edit('find-spare-search', 'nobody'); assert.match(run.text(), /No matching spares/);
  } finally { await run.close(); }
});

it('uses atomic receipts, disables double presses and retries unknown results with the identical request', async () => {
  let writes = 0; const held = deferred();
  const run = await mount({ modalOnly: true, write: async (c: any) => {
    writes += 1; if (writes === 1) return held.promise;
    return { data: { ...context(), request_id: c.requestId, outcome: 'confirmed', invitation: { id: 'invite-1', player_id: c.playerId, status: 'accepted', replaced_player_id: c.replacedPlayerId, source: 'team' }, player: { player_id: c.playerId }, checkin_status: 'confirmed' }, error: null };
  } }); try {
    await run.edit('find-spare-message', 'Called yesterday'); await run.press('find-spare-confirmed');
    assert.match(run.text(), /Invite \+ Mark In/);
    const stale = run.props.get('find-spare-action-sub-1')?.onPress;
    assert.equal(typeof stale, 'function');
    await React.act(async () => { stale(); stale(); }); assert.equal(run.calls.writes.length, 1);
    await React.act(async () => held.resolve({ data: null, error: 'Result unknown' }));
    assert.match(run.text(), /Result unknown/); await run.press('find-spare-retry');
    assert.equal(run.calls.writes.length, 2); assert.deepEqual(run.calls.writes[1], run.calls.writes[0]);
    assert.equal(run.calls.writes[0].message, 'Called yesterday'); assert.equal(run.calls.writes[0].replacedPlayerId, 'out-f');
    assert.match(run.text(), /Confirmed In/); assert.ok(run.calls.reads.length >= 2);
    await React.act(async () => stale()); assert.equal(run.calls.writes.length, 2);
  } finally { await run.close(); }
});

it('lazily reads authorized recent players and clears mode/role-owned search and results', async () => {
  const run = await mount({ modalOnly: true }); try {
    assert.ok(run.calls.reads.every(args => args[2] !== true));
    await run.edit('find-spare-search', 'old search'); await run.press('find-spare-mode-recent');
    assert.equal(run.props.get('find-spare-search').value, ''); assert.match(run.text(), /Recent Demo/);
    assert.ok(run.calls.reads.some(args => args[1] === 'out-f' && args[2] === true));
    await run.press('find-spare-action-recent-1');
    assert.equal(run.calls.writes[0].kind, 'recent'); assert.equal(run.calls.writes[0].saveToTeamSpares, false);
  } finally { await run.close(); }
});

it('adds one-game manual subs with role-restricted position, optional jersey and explicit spare saving', async () => {
  const run = await mount({ modalOnly: true }); try {
    await run.press('find-spare-mode-manual'); assert.match(run.text(), /ONE GAME/);
    assert.equal(run.props.get('find-spare-save-to-spares').accessibilityState.checked, false);
    assert.equal(run.props.get('find-spare-manual-submit').disabled, true);
    await run.edit('find-spare-manual-name', 'Sam New'); await run.edit('find-spare-manual-jersey', '1000');
    assert.equal(run.props.get('find-spare-manual-submit').disabled, true);
    await run.edit('find-spare-manual-jersey', '19'); await run.press('find-spare-manual-position'); await run.press('find-spare-position-Defense');
    assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-position-Goalie"]'), null);
    await run.press('find-spare-save-to-spares'); await run.press('find-spare-manual-submit');
    assert.deepEqual(run.calls.writes[0], { ...scope, requestId: 'request-1', kind: 'manual', manualName: 'Sam New', manualPosition: 'Defense', manualJersey: 19, replacedPlayerId: 'out-f', message: null, confirmed: true, saveToTeamSpares: true });
    assert.match(run.text(), /offline unknown result/); await run.press('find-spare-retry');
    assert.deepEqual(run.calls.writes[1], run.calls.writes[0]);
  } finally { await run.close(); }
});

it('owns callbacks and unknown writes across close, actor and A-B-A committed lifetimes without replay', async () => {
  const held = deferred(); let n = 0;
  const run = await mount({ modalOnly: true, write: async () => ++n === 1 ? held.promise : { data: null, error: 'retry result unknown' } }); try {
    const oldEdit = run.props.get('find-spare-message').onChangeText;
    const oldSubmit = run.props.get('find-spare-action-sub-1').onPress;
    await React.act(async () => oldSubmit()); assert.equal(run.calls.writes.length, 1);
    await run.change({ ...scope, teamId: 'team-b' }); await run.change(scope);
    await React.act(async () => { oldEdit('stale'); oldSubmit(); });
    assert.equal(run.props.get('find-spare-message').value, ''); assert.equal(run.calls.writes.length, 1);
    await React.act(async () => held.resolve({ data: null, error: 'old failure' }));
    assert.doesNotMatch(run.text(), /old failure/);
    await run.press('find-spare-retry'); assert.equal(run.calls.writes.length, 2);
    assert.equal(run.calls.writes[0].requestId, run.calls.writes[1].requestId);
    const oldCurrent = run.props.get('find-spare-action-sub-1').onPress;
    await run.actor('other-captain'); await React.act(async () => oldCurrent()); assert.equal(run.calls.writes.length, 2);
    await run.visibility(false); await React.act(async () => oldCurrent()); assert.equal(run.calls.writes.length, 2);
  } finally { await run.close(); }
});

it('retries a failed recent read in the same replacement and shows last-played metadata', async () => {
  let reads = 0;
  const run = await mount({ modalOnly: true, read: async (s: any, _id: any, recent: boolean) => recent && ++reads === 1 ? { data: null, error: 'Recent unavailable' } : { data: context(s, recent), error: null } }); try {
    await run.press('find-spare-mode-recent'); assert.match(run.text(), /Recent unavailable/);
    await run.press('find-spare-retry'); assert.match(run.text(), /Recent Demo/); assert.match(run.text(), /Last played/);
    assert.equal(run.calls.reads.at(-1)[1], 'out-f'); assert.equal(run.calls.reads.at(-1)[2], true);
  } finally { await run.close(); }
});

it('retains all canonical receipts when a later readback is older than multiple saved invitations', async () => {
  const run = await mount({ modalOnly: true, read: async () => { const d = context(); d.candidates.push({ ...d.candidates[0], player_id: 'sub-2', full_name: 'Second Demo' }); return { data: d, error: null }; }, write: async (c: any) => ({ data: { request_id: c.requestId, outcome: 'confirmed', invitation: { id: `i-${c.playerId}`, player_id: c.playerId, status: 'accepted', replaced_player_id: c.replacedPlayerId, source: 'team' }, player: { player_id: c.playerId }, checkin_status: 'confirmed' }, error: null }) }); try {
    await run.press('find-spare-confirmed'); await run.press('find-spare-action-sub-1'); await run.press('find-spare-action-sub-2');
    assert.match(run.dom.window.document.querySelector('[data-testid="find-spare-action-sub-1"]').textContent, /Confirmed In/);
    assert.match(run.dom.window.document.querySelector('[data-testid="find-spare-action-sub-2"]').textContent, /Confirmed In/);
  } finally { await run.close(); }
});

it('fails route authorization closed for noncaptains and the wrong league', async () => {
  const denied = await mount({ role: null }); try { assert.doesNotMatch(denied.text(), /Find Spare/); assert.equal(denied.calls.reads.length, 0); } finally { await denied.close(); }
  const wrong = await mount(); try { const before = wrong.calls.reads.length; await wrong.change({ ...scope, leagueId: 'wrong-league', intent: 'invite-sub' }); assert.doesNotMatch(wrong.text(), /Find Spare/); assert.equal(wrong.calls.reads.length, before); } finally { await wrong.close(); }
});
it('shows update-required errors inside the sheet and Retry re-reads without any legacy writes', async () => {
  let n = 0; const run = await mount({ modalOnly: true, read: async () => ++n <= 2 ? { data: null, error: 'Requires a backend update' } : { data: context(), error: null } }); try {
    assert.match(run.text(), /backend update/); assert.ok(run.dom.window.document.querySelector('[data-testid="find-spare-sheet"] [data-testid="find-spare-error"]'));
    await run.press('find-spare-retry'); assert.match(run.text(), /Jordán Demo/); assert.equal(run.calls.legacy.length, 0); assert.equal(run.calls.writes.length, 0);
  } finally { await run.close(); }
});
it('keeps no-Out confirmation hidden and labels every prior invitation status truthfully', async () => {
  const run = await mount({ modalOnly: true, read: async () => { const d: any = context(); d.replacements = []; d.candidates = ['pending', 'accepted', 'declined', 'expired'].map(status => ({ ...d.candidates[0], player_id: status, full_name: status })); d.invitations = d.candidates.map((p: any) => ({ id: p.player_id, player_id: p.player_id, status: p.player_id, source: 'team', replaced_player_id: null })); return { data: d, error: null }; } }); try {
    assert.match(run.text(), /Mark a player Out first/); assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-confirmed"]'), null);
    for (const status of ['pending', 'declined', 'expired']) assert.match(run.dom.window.document.querySelector(`[data-testid="find-spare-action-${status}"]`).textContent, /Mark In/);
    assert.match(run.dom.window.document.querySelector('[data-testid="find-spare-action-accepted"]').textContent, /Confirmed In/);
    await run.press('find-spare-action-declined'); assert.equal(run.calls.writes[0].confirmed, true); assert.equal(run.calls.writes[0].replacedPlayerId, null);
  } finally { await run.close(); }
});
it('does not replay a saved mutation when authoritative readback fails', async () => {
  let saved = false; const run = await mount({ modalOnly: true, read: async () => saved ? { data: null, error: 'readback offline' } : { data: context(), error: null }, write: async (c: any) => { saved = true; return { data: { invitation: { id: 'i', player_id: c.playerId, status: 'pending', replaced_player_id: 'out-f', source: 'team' }, player: { player_id: c.playerId }, checkin_status: null, outcome: 'pending', request_id: c.requestId }, error: null }; } }); try {
    await run.press('find-spare-action-sub-1'); assert.match(run.text(), /Saved. Unable to refresh/); assert.doesNotMatch(run.text(), /Confirmed In/);
    await run.press('find-spare-retry'); assert.equal(run.calls.writes.length, 1);
  } finally { await run.close(); }
});
it('ignores deferred reads after close and reloads the retained scope after focus returns', async () => {
  const pending = deferred(); const options: any = { modalOnly: true, read: async (s: any) => s.teamId === 'pending' ? pending.promise : { data: context(s), error: null } };
  const run = await mount(options); try {
    await run.change({ ...scope, teamId: 'pending' }); await run.visibility(false);
    await React.act(async () => pending.resolve({ data: context(), error: null })); assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-sheet"]'), null);
    await run.change(scope); await run.visibility(true); const before = run.calls.reads.length;
    options.focused = false; await run.render(); assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-sheet"]'), null);
    options.focused = true; await run.render(); assert.ok(run.calls.reads.length > before);
  } finally { await run.close(); }
});

it('rejects a retained Retry callback after its recent mode has been left', async () => {
  const run = await mount({ modalOnly: true, read: async (s: any, _id: any, recent: boolean) => recent ? { data: null, error: 'Recent unavailable' } : { data: context(s), error: null } }); try {
    await run.press('find-spare-mode-recent'); const oldRetry = run.props.get('find-spare-retry').onPress;
    await run.press('find-spare-mode-available'); const before = run.calls.reads.length;
    await React.act(async () => oldRetry()); assert.equal(run.calls.reads.length, before); assert.doesNotMatch(run.text(), /Recent unavailable/);
  } finally { await run.close(); }
});

const wireScope = { gameId: '10000000-0000-4000-8000-000000000001', teamId: '10000000-0000-4000-8000-000000000002', leagueId: 'd6e55507-6eae-4d94-978c-47c6c30a36f1' };
const wireContext = (s = wireScope, recent = false) => ({ schema_version: 1, game_id: s.gameId, team_id: s.teamId, league_id: s.leagueId, season_id: '10000000-0000-4000-8000-000000000003',
  replacements: [{ player_id: '10000000-0000-4000-8000-000000000004', full_name: 'Alex Out', position: 'Forward', jersey_number: 17 }, { player_id: '10000000-0000-4000-8000-000000000005', full_name: 'Goalie Out', position: 'Goalie', jersey_number: 30 }],
  candidates: [{ player_id: '10000000-0000-4000-8000-000000000006', full_name: 'Jordán Demo', email: 'jordan@example.invalid', position: 'Forward', source: 'team' }, { player_id: '10000000-0000-4000-8000-000000000007', full_name: 'Goalie Demo', email: null, position: 'Goalie', source: 'league' }],
  recent_players: recent ? [{ player_id: '10000000-0000-4000-8000-000000000008', full_name: 'Recent Demo', email: null, position: 'Forward', source: 'recent', last_played_at: '2026-10-01T20:00:00Z' }] : [], recent_loaded: recent, invitations: [] });
async function mountWire(options: any = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const props = new Map<string, any>(); const calls = { reads: [] as any[], writes: [] as any[], legacy: [] as any[] };
  const host = (tag: string) => function Host(p: any) { if (p.testID) props.set(p.testID, p); return React.createElement(tag, { 'data-testid': p.testID, onClick: p.onPress, disabled: p.disabled, 'aria-label': p.accessibilityLabel, role: p.accessibilityRole === 'alert' ? 'alert' : undefined }, p.children); };
  const native = { ImageBackground: host('div'), View: host('div'), Text: host('span'), Pressable: host('button'), TextInput: host('div'), ScrollView: host('section'), KeyboardAvoidingView: host('div'), ActivityIndicator: host('i'), RefreshControl: host('i'), Modal: (p: any) => p.visible ? React.createElement('aside', { 'data-testid': 'native-modal' }, p.children) : null, Platform: { OS: 'ios' }, StyleSheet: { create: (s: any) => s }, Alert: { alert() {} } };
  const builder = (data: any) => { const b: any = { select: () => b, eq: () => b, is: () => b, in: () => b, or: () => b, gte: () => b, order: () => b, limit: () => b, maybeSingle: async () => ({ data, error: null }), then: (yes: any) => Promise.resolve({ data, error: null }).then(yes) }; return b; };
  let actor = 'captain-1'; let params: any = { ...wireScope, intent: 'invite-sub' };
  const game = { id: wireScope.gameId, league_id: wireScope.leagueId, season_id: '10000000-0000-4000-8000-000000000003', scheduled_at: '2026-10-22T20:30:00Z', home_team_id: wireScope.teamId, away_team_id: 'team-2', home_team: { name: 'Home' }, away_team: { name: 'Away' } };
  const mocks: any = { react: React, 'react-native': native, '@expo/vector-icons': { Ionicons: host('i'), MaterialCommunityIcons: host('i') }, 'expo-linear-gradient': { LinearGradient: host('div') }, 'react-native-safe-area-context': { SafeAreaView: host('main'), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useIsFocused: () => options.focused !== false },
    '../../components/CardFocus': { FocusCard: host('div'), FocusScrollView: host('section') }, '../../components/Avatar': () => null, '../../components/TeamLogo': () => null, '../../assets/team-page/weekly-games-bg.jpg': 'fixture',
    '../../components/SectionHeader': { SECTION_HEADING_TEXT_STYLE: {} }, '../../components/AccessibleChoiceGroup': () => null, '../../components/SelectableControl': { SelectableControl: host('button'), SelectableControlGroup: host('div') },
    '../../navigation/cutIceSafeAreaPolicy': { cutIceContentEdges: (v: any) => v }, '../../context/AuthContext': { useAuth: () => ({ user: actor ? { id: actor } : null }) }, '../../context/AccessibilityPreferencesContext': { useAccessibilityPreferences: () => ({ reduceMotion: true, reduceTransparency: true }) }, '../../config/hockeyLife': { HOCKEY_LIFE_ID: wireScope.leagueId },
    '../../config/publicLinks': { buildHockeyLifeCaptainLineupUrl: () => null }, '../../lib/publicLinks': {},
    '../../lib/supabase/client': { supabase: { from: (table: string) => builder(table === 'games' ? { ...game, id: params.gameId, home_team_id: params.teamId } : [{ team_id: wireScope.teamId, league_id: wireScope.leagueId, leadership_role: 'captain', team: { name: 'Home', id: wireScope.teamId }, league: { timezone: 'America/Toronto' } }]) } },
    '../../lib/supabase/team': { getTeamActiveSeason: async () => ({ season: { id: '10000000-0000-4000-8000-000000000003', status: 'active' }, error: null }), getActiveSeasonRoster: async () => [] },
    '../../lib/supabase/captain': { getCaptainRoleForSeason: async () => options.role === undefined ? 'captain' : options.role, getGameCheckinStatusMap: async () => ({}), getTeamSubInvitations: async () => ({ data: [] }), getOpenGoalieRequest: async () => null, getLeagueSubPlayers: async (...args: any[]) => { calls.legacy.push(args); return { success: true, data: [] }; } },
    '../../lib/supabase/beerGuy': { getBeerGuyGameState: async () => ({ data: { assignment: null }, error: null }) },
    '../../lib/supabase/subInvitations': { getCaptainSubInvitationContext: async (...args: any[]) => { calls.reads.push(args); return options.read ? options.read(...args) : { data: wireContext(args[0], args[2]), error: null }; }, manageCaptainSubInvitation: async (command: any) => { calls.writes.push(command); return options.write ? options.write(command) : { data: null, error: 'offline unknown result' }; }, createCaptainSubInvitationRequestId: () => `request-${calls.writes.length + 1}` },
    '../../theme/colors': { __esModule: true, default: { bgModal: '#08121f', bgInteractive: '#10223b', glassStroke: '#263b50', textPrimary: '#fff', textSecondary: '#a8b4c8', primary: '#22d3ee', accentGreen: '#34d399', accentRed: '#f87171' } } };
  let req = 0;
  const adapter = compileCommonJs<any>(new URL('../../src/lib/supabase/subInvitations.ts', import.meta.url), {
    'expo-crypto': { randomUUID: () => `20000000-0000-4000-8000-${String(++req).padStart(12,'0')}` },
    './client': { supabase: { rpc: async (name: string, p: any) => {
      if (name === 'captain_get_sub_invitation_context') { calls.reads.push(p); const d = wireContext(wireScope, p.p_include_recent); if (options.filterRead && p.p_replaced_player_id) d.candidates = d.candidates.filter(c => c.position === (p.p_replaced_player_id.endsWith('5') ? 'Goalie' : 'Forward')); return {data: d, error: null}; }
      calls.writes.push(p); return options.rpc(p);
    } } }
  });
  if (options.rpc) mocks['../../lib/supabase/subInvitations'] = adapter;
  const Screen = compileCommonJs<any>(new URL('../../src/screens/captain/GameAvailabilityScreen.tsx', import.meta.url), mocks).default;
  const Modal = options.modalOnly ? compileCommonJs<any>(new URL('../../src/components/captain/FindSpareModal.tsx', import.meta.url), mocks).default : null;
  const root = createRoot(dom.window.document.getElementById('root')); let visible = true;
  const Dashboard = options.dashboard ? compileCommonJs<any>(new URL('../../src/screens/captain/CaptainDashboardScreen.tsx', import.meta.url), mocks).default : null;
  let dashboard = Boolean(options.dashboard);
  const navigation = { goBack() {}, navigate(_route: string, next: any) { params = next; dashboard = false; void render(); } };
  const render = async () => { await React.act(async () => { root.render(React.createElement(React.StrictMode, null, dashboard ? React.createElement(Dashboard, { navigation }) : options.modalOnly ? React.createElement(Modal, { scope: params, actorId: actor, visible, onClose() { visible = false; void render(); } }) : React.createElement(Screen, { route: { params }, navigation: { goBack() {} } }))); }); };
  await render();
  return { calls, props, dom, render, text: () => dom.window.document.body.textContent ?? '',
    async press(id: string) { const node = dom.window.document.querySelector(`[data-testid="${id}"]`) as HTMLElement; assert.ok(node, `missing ${id}`); await React.act(async () => { node.click(); }); },
    async edit(id: string, value: string) { assert.ok(props.get(id), `missing ${id}`); await React.act(async () => props.get(id).onChangeText(value)); },
    async change(p: any) { params = p; await render(); }, async actor(id: string) { actor = id; await render(); }, async visibility(v: boolean) { visible = v; await render(); },
    async close() { await React.act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); } };
}
const wireSub = '10000000-0000-4000-8000-000000000006';
const wireReceipt = (p: any) => ({schema_version:1,game_id:p.p_game_id,team_id:p.p_team_id,league_id:p.p_league_id,season_id:'10000000-0000-4000-8000-000000000003',request_id:p.p_request_id,outcome:'confirmed',invitation:{id:'30000000-0000-4000-8000-000000000001',player_id:wireSub,status:'accepted',replaced_player_id:p.p_replaced_player_id,source:'team'},player:{player_id:wireSub,full_name:p.p_manual_name ?? 'Demo',email:null,position:'Forward'},checkin_status:'confirmed'});

it('releases only definitive raw SQL rejection so corrected input creates a new logical request', async () => {
  for (const code of ['22023', '23505']) {
    const run = await mountWire({ modalOnly: true, rpc: async () => ({ data: null, error: { code, message: 'private SQL details' } }) });
    try {
      await run.edit('find-spare-message', 'x'.repeat(4001)); await run.press(`find-spare-action-${wireSub}`);
      await run.edit('find-spare-message', 'corrected'); assert.equal(run.props.get('find-spare-message').value, 'corrected');
      assert.doesNotMatch(run.text(), /private SQL details/);
      await run.press(`find-spare-action-${wireSub}`); assert.equal(run.calls.writes.length, 2);
      assert.notEqual(run.calls.writes[0].p_request_id, run.calls.writes[1].p_request_id);
      await run.press('find-spare-mode-manual'); await run.visibility(false); await run.visibility(true);
      await run.edit('find-spare-message', 'after reopen'); assert.equal(run.props.get('find-spare-message').value, 'after reopen');
    } finally { await run.close(); }
  }
});

it('keeps complete available roles after a role-filtering server readback', async () => {
  const run = await mountWire({ modalOnly: true, filterRead: true, rpc: async (p: any) => ({ data: wireReceipt(p), error: null }) });
  try {
    await run.press('find-spare-confirmed'); await run.press(`find-spare-action-${wireSub}`);
    assert.equal(run.calls.reads.at(-1).p_replaced_player_id, null);
    await run.press('find-spare-replacement'); await run.press('find-spare-replace-10000000-0000-4000-8000-000000000005');
    assert.match(run.text(), /Goalie Demo/);
    await run.press('find-spare-replacement'); await run.press('find-spare-replace-none');
    assert.match(run.text(), /Goalie Demo/); assert.match(run.text(), /Jordán Demo/);
  } finally { await run.close(); }
});

it('resets only manual name position jersey after confirmed success and retains spare opt-in and receipt', async () => {
  const run = await mountWire({ modalOnly: true, rpc: async (p: any) => ({ data: wireReceipt(p), error: null }) });
  try {
    await run.edit('find-spare-message', 'keep message'); await run.press('find-spare-mode-manual');
    await run.edit('find-spare-manual-name', 'First Person'); await run.edit('find-spare-manual-jersey', '19');
    await run.press('find-spare-manual-position'); await run.press('find-spare-position-Forward');
    await run.press('find-spare-save-to-spares'); await run.press('find-spare-manual-submit');
    assert.equal(run.props.get('find-spare-manual-name').value, ''); assert.equal(run.props.get('find-spare-manual-jersey').value, '');
    assert.equal(run.props.get('find-spare-save-to-spares').accessibilityState.checked, true);
    assert.match(run.text(), /First Person — Confirmed In/); assert.equal(run.props.get('find-spare-message').value, 'keep message');
    await run.edit('find-spare-manual-name', 'Second Person'); await run.press('find-spare-manual-submit');
    assert.equal(run.calls.writes[1].p_manual_position, null); assert.equal(run.calls.writes[1].p_manual_jersey, null);
    assert.equal(run.calls.writes[1].p_save_to_team_spares, true);
  } finally { await run.close(); }
});

it('keeps unknown raw RPC outcomes pinned to identical UUID and payload without automatic replay', async () => {
  for (const rpc of [async () => ({ data: null, error: { code: '08006' } }), async () => { throw { code: '22023' }; }, async () => ({ data: { malformed: true }, error: null })]) {
    const run = await mountWire({ modalOnly: true, rpc });
    try {
      await run.edit('find-spare-message', 'original'); await run.press(`find-spare-action-${wireSub}`);
      await run.edit('find-spare-message', 'must not replace'); assert.equal(run.props.get('find-spare-message').value, 'original');
      await run.visibility(false); await run.visibility(true); assert.equal(run.calls.writes.length, 1);
      await run.press('find-spare-retry'); assert.equal(run.calls.writes.length, 2); assert.deepEqual(run.calls.writes[1], run.calls.writes[0]);
    } finally { await run.close(); }
  }
});
it('recovers raw manual ambiguity to available mode and editable reopen without replaying rejected command', async () => {
  const run = await mountWire({ modalOnly: true, rpc: async () => ({ data: null, error: { code: '23505' } }) });
  try {
    await run.press('find-spare-mode-manual'); await run.edit('find-spare-manual-name', 'Duplicate Identity'); await run.press('find-spare-manual-submit');
    await run.press('find-spare-mode-available'); assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-manual-form"]'), null);
    await run.visibility(false); await run.visibility(true); await run.edit('find-spare-message', 'corrected after reopen');
    assert.equal(run.props.get('find-spare-message').value, 'corrected after reopen'); assert.equal(run.calls.writes.length, 1);
    assert.equal(run.dom.window.document.querySelector('[data-testid="find-spare-retry"]'), null);
    await run.press(`find-spare-action-${wireSub}`); assert.notEqual(run.calls.writes[1].p_request_id, run.calls.writes[0].p_request_id);
  } finally { await run.close(); }
});

it('bounds optional manual jersey to live 1..99 in the mounted sheet', async () => {
  const run = await mount({ modalOnly: true }); try {
    await run.press('find-spare-mode-manual'); await run.edit('find-spare-manual-name', 'Bound Player');
    for (const value of ['100', '999', '0', '-1', '1.5']) {
      await run.edit('find-spare-manual-jersey', value);
      assert.equal(run.props.get('find-spare-manual-submit').disabled, true, `jersey ${value} must disable submit`);
    }
    for (const value of ['', '1', '99']) {
      await run.edit('find-spare-manual-jersey', value);
      assert.equal(run.props.get('find-spare-manual-submit').disabled, false);
    }
    assert.equal(run.props.get('find-spare-manual-jersey').accessibilityLabel, 'Jersey number, optional, 1 to 99');
    assert.equal(run.calls.writes.length, 0);
  } finally { await run.close(); }
});
