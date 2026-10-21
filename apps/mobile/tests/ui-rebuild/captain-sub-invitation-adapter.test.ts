import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { compileCommonJs } from './component-harness.ts';
import type * as Adapter from '../../src/lib/supabase/subInvitations';

const scope = { gameId: 'AAAAAAAA-0000-0000-0000-000000000001', teamId: 'bbbbbbbb-0000-7000-0000-000000000002', leagueId: 'cccccccc-0000-0000-0000-000000000003' };
const player = 'dddddddd-0000-0000-0000-000000000004';
const season = 'eeeeeeee-0000-0000-0000-000000000005';
const requestId = 'ffffffff-0000-0000-0000-000000000006';
const invitation = { id: requestId, player_id: player, status: 'pending', replaced_player_id: null, source: 'team' };
const context = () => ({ schema_version: 1, game_id: scope.gameId.toLowerCase(), team_id: scope.teamId, league_id: scope.leagueId, season_id: season, replacements: [], candidates: [{ player_id: player, full_name: 'Émile', email: null, position: 'F', source: 'team' }], recent_players: [], recent_loaded: false, invitations: [invitation] });
function load(data: unknown, error: unknown = null, thrown?: unknown) {
  const url = new URL('../../src/lib/supabase/subInvitations.ts', import.meta.url);
  assert.ok(existsSync(fileURLToPath(url.toString())), 'native Invite Sub adapter must exist');
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const api = compileCommonJs<typeof Adapter>(url, {
    './client': { supabase: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); if (thrown) throw thrown; return { data, error }; }, from: () => { throw Error('No direct tables'); } } },
    'expo-crypto': { randomUUID: () => requestId },
  });
  return { api, calls };
}
it('reads request-bound strict context through raw RPC with explicit option defaults and original UUID bytes', async () => {
  const { api, calls } = load(context());
  assert.deepEqual(await api.getCaptainSubInvitationContext(scope), { data: context(), error: null });
  assert.deepEqual(calls, [{ name: 'captain_get_sub_invitation_context', args: { p_game_id: scope.gameId, p_team_id: scope.teamId, p_league_id: scope.leagueId, p_replaced_player_id: null, p_include_recent: false } }]);
  for (const bad of [
    { ...context(), schema_version: 2 }, { ...context(), extra: true }, { ...context(), team_id: player },
    { ...context(), candidates: [{ ...context().candidates[0], source: 'recent' }] },
    { ...context(), candidates: [...context().candidates, ...context().candidates] },
    { ...context(), invitations: [{ ...invitation, status: 'waiting' }] },
    { ...context(), recent_loaded: true }, { ...context(), season_id: ' '+season },
    { ...context(), replacements: [{ player_id: player, full_name: null, position: null, jersey_number: 1.5 }] },
    { ...context(), recent_players: [{ ...context().candidates[0], source: 'recent', last_played_at: 'yesterday' }] },
  ]) assert.equal(api.parseCaptainSubInvitationContext(bad, scope), null);
  const malformed = await load({ ...context(), game_id: player }).api.getCaptainSubInvitationContext(scope);
  assert.equal(malformed.data, null); assert.ok(malformed.error);
  assert.equal((await api.getCaptainSubInvitationContext({ ...scope, gameId: ' '+scope.gameId })).data, null);
  assert.equal(calls.length, 1, 'malformed source UUID must not reach transport');
});
it('accepts a league spare in both candidate and recent modes while retaining per-list and roster exclusions', async () => {
  const spare = { ...context().candidates[0], source: 'league' };
  const recent = { ...spare, source: 'recent', last_played_at: '2026-10-15T23:00:00Z' };
  const value = { ...context(), candidates: [spare], recent_players: [recent], recent_loaded: true };
  const { api } = load(value);
  assert.deepEqual(api.parseCaptainSubInvitationContext(value, scope, { includeRecent: true }), value);
  assert.deepEqual(await api.getCaptainSubInvitationContext(scope, null, true), { data: value, error: null });
  const uppercaseSpare = { ...spare, player_id: player.toUpperCase() };
  assert.deepEqual(api.parseCaptainSubInvitationContext({ ...value, candidates: [uppercaseSpare] }, scope, { includeRecent: true }), { ...value, candidates: [uppercaseSpare] });
  const replacement = { player_id: player.toUpperCase(), full_name: null, jersey_number: null, position: null };
  for (const bad of [
    { ...value, candidates: [spare, uppercaseSpare] },
    { ...value, recent_players: [recent, { ...recent, player_id: player.toUpperCase() }] },
    { ...value, replacements: [replacement] },
    { ...value, replacements: [replacement], candidates: [] },
    { ...value, replacements: [replacement], recent_players: [] },
    { ...value, replacements: [replacement, { ...replacement, player_id: player }], candidates: [], recent_players: [] },
  ]) assert.equal(api.parseCaptainSubInvitationContext(bad, scope, { includeRecent: true }), null);
});
it('retains canonical web goalie/skater aliases and accent, typo, multi-token search', () => {
  const url = new URL('../../src/lib/captain/subRoleFilter.ts', import.meta.url);
  assert.ok(existsSync(fileURLToPath(url.toString())), 'canonical native role/search helper must exist');
  const helper = compileCommonJs<typeof import('../../src/lib/captain/subRoleFilter')>(url, {});
  for (const alias of ['G', 'Goalie', 'Goaltender', 'backup goalie']) assert.equal(helper.getSubPositionRole(alias), 'goalie');
  for (const alias of ['F', 'Forward', 'Forwards', 'C', 'Center', 'Centre', 'LW', 'RW', 'Wing', 'D', 'Defense', 'Defence', 'Skater']) assert.equal(helper.getSubPositionRole(alias), 'skater');
  assert.equal(helper.getSubPositionRole('unknown'), null);
  const players = [{ full_name: 'Émile Bélanger', email: 'emile@example.test', position: 'Forward' }, { full_name: 'Goal Person', position: 'G' }];
  assert.deepEqual(helper.filterSubCandidatesByReplacementRole(players, 'goaltender'), [players[1]]);
  assert.deepEqual(helper.filterSubCandidatesByReplacementRole(players, null), players);
  for (const query of ['emile belanger', 'belangr', 'bélanger forward', 'example emile', '   ']) assert.equal(helper.matchesSubCandidateSearch(players[0], query), true, query);
  assert.equal(helper.matchesSubCandidateSearch(players[0], 'emile goalie'), false);
  assert.equal(helper.matchesSubCandidateSearch({}, 'x'), false);
});

const command: Adapter.CaptainSubInvitationCommand = { ...scope, requestId, kind: 'spare', playerId: player, confirmed: false, saveToTeamSpares: false };
// Synthetic identities; receipt shape mirrors PostgreSQL producer commands 7/8 (Mark In/retry).
const storedReplacement = '11111111-0000-4000-8000-000000000011';
it('preserves authoritative stored replacement on null-input Mark In and retry receipts', async () => {
  for (const outcome of ['confirmed', 'already_confirmed']) {
    const value = { ...receipt(), outcome, invitation: { ...invitation, status: 'accepted', replaced_player_id: storedReplacement }, checkin_status: 'confirmed' };
    const run = load(value);
    assert.deepEqual(await run.api.manageCaptainSubInvitation({ ...command, replacedPlayerId: null, confirmed: true }), { data: value, error: null });
    assert.equal(run.calls[0].args.p_replaced_player_id, null);
    assert.equal(value.invitation.replaced_player_id, storedReplacement);
  }
});
const receipt = () => ({ schema_version: 1, game_id: scope.gameId.toLowerCase(), team_id: scope.teamId, league_id: scope.leagueId, season_id: season, request_id: requestId, outcome: 'pending', invitation, player: { player_id: player, full_name: null, email: null, position: 'F' }, checkin_status: null });
it('keeps unchanged idempotent assignments rather than claiming a newly selected slot', async () => {
  for (const outcome of ['already_pending', 'already_confirmed']) {
    for (const stored of [storedReplacement, null]) {
      const accepted = outcome === 'already_confirmed';
      const value = { ...receipt(), outcome, invitation: { ...invitation, status: accepted ? 'accepted' : 'pending', replaced_player_id: stored }, checkin_status: accepted ? 'confirmed' : null };
      const run = load(value);
      assert.deepEqual(await run.api.manageCaptainSubInvitation({ ...command, replacedPlayerId: season }), { data: value, error: null });
      assert.equal(run.calls[0].args.p_replaced_player_id, season);
      assert.equal(value.invitation.replaced_player_id, stored);
    }
  }
});
it('rejects provided nonnull replacement misbinding on fresh pending and confirmed receipts', () => {
  const { api } = load(null);
  for (const outcome of ['pending', 'confirmed']) {
    const confirmed = outcome === 'confirmed';
    for (const stored of [null, storedReplacement, ' '+season]) {
      const value = { ...receipt(), outcome, invitation: { ...invitation, status: confirmed ? 'accepted' : 'pending', replaced_player_id: stored }, checkin_status: confirmed ? 'confirmed' : null };
      assert.equal(api.parseCaptainSubInvitationResult(value, { ...command, replacedPlayerId: season, confirmed }), null);
    }
    const matching = { ...receipt(), outcome, invitation: { ...invitation, status: confirmed ? 'accepted' : 'pending', replaced_player_id: season.toUpperCase() }, checkin_status: confirmed ? 'confirmed' : null };
    assert.deepEqual(api.parseCaptainSubInvitationResult(matching, { ...command, replacedPlayerId: season, confirmed }), matching);
  }
});
it('serializes commands with stable request identity and requires atomic request-bound confirmation receipts', async () => {
  const { api, calls } = load(receipt());
  assert.equal(typeof api.manageCaptainSubInvitation, 'function', 'command adapter must exist');
  assert.equal(api.createCaptainSubInvitationRequestId(), requestId);
  assert.deepEqual(await api.manageCaptainSubInvitation(command), { data: receipt(), error: null });
  await api.manageCaptainSubInvitation(command);
  assert.deepEqual(calls[0], { name: 'captain_manage_sub_invitation', args: { p_game_id: scope.gameId, p_team_id: scope.teamId, p_league_id: scope.leagueId, p_request_id: requestId, p_kind: 'spare', p_player_id: player, p_replaced_player_id: null, p_message: null, p_confirmed: false, p_manual_name: null, p_manual_position: null, p_manual_jersey: null, p_save_to_team_spares: false } });
  assert.deepEqual(calls[1], calls[0]);
  for (const bad of [
    { ...receipt(), request_id: season }, { ...receipt(), game_id: player }, { ...receipt(), extra: true },
    { ...receipt(), player: { ...receipt().player, player_id: season } },
    { ...receipt(), invitation: { ...invitation, replaced_player_id: ' '+season } },
    { ...receipt(), invitation: { ...invitation, status: 'accepted' } },
    { ...receipt(), outcome: 'confirmed', invitation: { ...invitation, status: 'accepted' } },
    { ...receipt(), outcome: 'already_pending', checkin_status: 'confirmed' },
    { ...receipt(), outcome: 'mystery' }, { ...receipt(), invitation: { ...invitation, source: 'recent' } },
  ]) assert.equal(api.parseCaptainSubInvitationResult(bad, command), null);
  const confirmed = { ...receipt(), outcome: 'confirmed', invitation: { ...invitation, status: 'accepted' }, checkin_status: 'confirmed' };
  assert.ok(api.parseCaptainSubInvitationResult(confirmed, { ...command, confirmed: true }));
  assert.equal(api.parseCaptainSubInvitationResult(receipt(), { ...command, confirmed: true }), null);
  assert.ok(api.parseCaptainSubInvitationResult({ ...confirmed, outcome: 'already_confirmed' }, command));
  assert.ok(api.parseCaptainSubInvitationResult({ ...receipt(), outcome: 'already_pending' }, command));
  assert.equal((await load(confirmed).api.manageCaptainSubInvitation({ ...command, kind: 'manual', playerId: null, manualName: ' Émile ', manualPosition: 'Forward', manualJersey: 99, confirmed: false, saveToTeamSpares: true })).error, null);
  assert.equal((await load(receipt()).api.manageCaptainSubInvitation({ ...command, kind: 'recent' })).error, null);
  const missing = await load(null, { code: 'PGRST202', message: 'sensitive server details' }).api.manageCaptainSubInvitation(command);
  assert.match(missing.error ?? '', /backend update/i); assert.doesNotMatch(missing.error ?? '', /sensitive/);
  assert.equal((await load(receipt(), null, Error('offline')).api.manageCaptainSubInvitation(command)).data, null);
  assert.equal((await load({ ...receipt(), request_id: season }).api.manageCaptainSubInvitation(command)).data, null);
  for (const bad of [{ ...command, requestId: ' '+requestId }, { ...command, kind: 'bogus' }, { ...command, manualName: 'wrong branch' }, { ...command, kind: 'manual', playerId: null, manualName: 'x', manualJersey: 1000 }]) {
    const run = load(receipt());
    assert.equal((await run.api.manageCaptainSubInvitation(bad as Adapter.CaptainSubInvitationCommand)).data, null);
    assert.equal(run.calls.length, 0);
  }
});

it('marks only known no-effect raw RPC rejections as rejected without leaking server details', async () => {
  for (const code of ['22023', '23505', '42501', '54000', 'PGRST202', '42883']) {
    const reply = await load(null, { code, message: 'private SQL credentials' }).api.manageCaptainSubInvitation(command);
    assert.equal((reply as { rejected?: boolean }).rejected, true, code);
    assert.doesNotMatch(reply.error ?? '', /private SQL credentials/);
  }
  for (const run of [load(null, { code: '08006' }), load(null, null, { code: '22023' }), load({ bad: true })]) {
    assert.equal((await run.api.manageCaptainSubInvitation(command) as { rejected?: boolean }).rejected, undefined);
  }
});

it('rejects manual jersey above live 1..99 before transport and preserves optional blank', async () => {
  for (const manualJersey of [100, 999, 0, -1, 1.5]) {
    const run = load(null);
    const result = await run.api.manageCaptainSubInvitation({ ...command, kind: 'manual', playerId: null, manualName: 'Bound Player', manualJersey });
    assert.equal(run.calls.length, 0, `jersey ${manualJersey} must not reach RPC`);
    assert.equal(result.rejected, true);
  }
  for (const manualJersey of [null, 1, 99]) {
    const value = { ...receipt(), outcome: 'confirmed', invitation: { ...invitation, status: 'accepted' }, checkin_status: 'confirmed' };
    const run = load(value);
    const input = { ...command, kind: 'manual' as const, playerId: null, manualName: 'Bound Player', manualJersey };
    assert.equal((await run.api.manageCaptainSubInvitation(input)).error, null);
    await run.api.manageCaptainSubInvitation(input);
    assert.equal(run.calls.length, 2); assert.deepEqual(run.calls[0], run.calls[1]);
    assert.equal(run.calls[0].args.p_manual_jersey, manualJersey);
  }
});
