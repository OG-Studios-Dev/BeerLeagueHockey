import * as Crypto from 'expo-crypto';
import { supabase } from './client';

export type CaptainSubInvitationScope = { gameId: string; teamId: string; leagueId: string };
export type CaptainSubInvitationCandidate = { player_id: string; full_name: string | null; email: string | null; position: string | null; source: 'team' | 'league' };
export type CaptainSubInvitationRecentPlayer = Omit<CaptainSubInvitationCandidate, 'source'> & { source: 'recent'; last_played_at: string | null };
export type CaptainSubInvitationReplacement = { player_id: string; full_name: string | null; jersey_number: number | null; position: string | null };
export type CaptainSubInvitation = { id: string; player_id: string; status: 'pending' | 'accepted' | 'declined' | 'expired'; replaced_player_id: string | null; source: 'team' | 'league' };
export type CaptainSubInvitationContext = { schema_version: 1; game_id: string; team_id: string; league_id: string; season_id: string; replacements: CaptainSubInvitationReplacement[]; candidates: CaptainSubInvitationCandidate[]; recent_players: CaptainSubInvitationRecentPlayer[]; recent_loaded: boolean; invitations: CaptainSubInvitation[] };
export type CaptainSubInvitationCommand = CaptainSubInvitationScope & { requestId: string; kind: 'spare' | 'recent' | 'manual'; playerId?: string | null; replacedPlayerId?: string | null; message?: string | null; confirmed: boolean; manualName?: string | null; manualPosition?: 'Forward' | 'Defense' | 'Goalie' | null; manualJersey?: number | null; saveToTeamSpares: boolean };
export type CaptainSubInvitationCommandResult = { schema_version: 1; game_id: string; team_id: string; league_id: string; season_id: string; request_id: string; outcome: 'pending' | 'confirmed' | 'already_pending' | 'already_confirmed'; invitation: CaptainSubInvitation & { status: 'pending' | 'accepted' }; player: Omit<CaptainSubInvitationCandidate, 'source'>; checkin_status: 'confirmed' | null };
type Reply<T> = { data: T | null; error: string | null; rejected?: true };
type Row = Record<string, unknown>;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const same = (a: unknown, b: unknown) => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
const text = (v: unknown) => v === null || typeof v === 'string';
const nullableUuid = (v: unknown) => v === null || uuid(v);
function row(v: unknown, keys: string): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.split(' ').sort().join(',');
}
const validScope = (s: CaptainSubInvitationScope) => uuid(s.gameId) && uuid(s.teamId) && uuid(s.leagueId);
const scoped = (r: Row, s: CaptainSubInvitationScope) => validScope(s) && r.schema_version === 1 && same(r.game_id, s.gameId) && same(r.team_id, s.teamId) && same(r.league_id, s.leagueId) && uuid(r.season_id);
function candidate(v: unknown, recent = false): boolean {
  return row(v, 'player_id full_name email position source' + (recent ? ' last_played_at' : '')) && uuid(v.player_id) && text(v.full_name) && text(v.email) && text(v.position) && (recent ? v.source === 'recent' && (v.last_played_at === null || typeof v.last_played_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v.last_played_at) && Number.isFinite(Date.parse(v.last_played_at))) : v.source === 'team' || v.source === 'league');
}
function invitationRow(v: unknown): v is Row {
  return row(v, 'id player_id status replaced_player_id source') && uuid(v.id) && uuid(v.player_id) && nullableUuid(v.replaced_player_id) && ['pending', 'accepted', 'declined', 'expired'].includes(v.status as string) && ['team', 'league'].includes(v.source as string);
}
function unique(values: unknown[], key: string): boolean {
  const ids = values.map(v => ((v as Row)[key] as string).toLowerCase());
  return new Set(ids).size === ids.length;
}
/** Strict wire decoder; returns null (never partial data) on a contract mismatch. */
export function parseCaptainSubInvitationContext(value: unknown, scope: CaptainSubInvitationScope, options: { includeRecent?: boolean } = {}): CaptainSubInvitationContext | null {
  if (!row(value, 'schema_version game_id team_id league_id season_id replacements candidates recent_players recent_loaded invitations') || !scoped(value, scope) || value.recent_loaded !== (options.includeRecent ?? false)) return null;
  const { replacements, candidates, recent_players: recent, invitations } = value;
  if (!Array.isArray(replacements) || !replacements.every(v => row(v, 'player_id full_name jersey_number position') && uuid(v.player_id) && text(v.full_name) && text(v.position) && (v.jersey_number === null || Number.isInteger(v.jersey_number))) || !unique(replacements, 'player_id')) return null;
  if (!Array.isArray(candidates) || !candidates.every(v => candidate(v)) || !unique(candidates, 'player_id')) return null;
  if (!Array.isArray(recent) || !recent.every(v => candidate(v, true)) || !unique(recent, 'player_id') || !value.recent_loaded && recent.length > 0) return null;
  if (!Array.isArray(invitations) || !invitations.every(invitationRow) || !unique(invitations, 'id') || !unique(invitations, 'player_id')) return null;
  if (!unique([...replacements, ...candidates], 'player_id') || !unique([...replacements, ...recent], 'player_id')) return null;
  return value as unknown as CaptainSubInvitationContext;
}
const invalid = 'Invite Sub returned an invalid response. Refresh before trying again.';
function rpcError(error: unknown): string {
  if (error && typeof error === 'object' && ['PGRST202', '42883'].includes(String((error as Row).code))) return 'Invite Sub requires a backend update. Please update the backend before trying again.';
  return 'Invite Sub could not be completed. Check your connection and try again with the same request.';
}
export async function getCaptainSubInvitationContext(scope: CaptainSubInvitationScope, replacedPlayerId: string | null = null, includeRecent = false): Promise<Reply<CaptainSubInvitationContext>> {
  if (!validScope(scope) || !nullableUuid(replacedPlayerId) || typeof includeRecent !== 'boolean') return { data: null, error: 'Invalid Invite Sub request.' };
  try {
    const { data, error } = await supabase.rpc('captain_get_sub_invitation_context', { p_game_id: scope.gameId, p_team_id: scope.teamId, p_league_id: scope.leagueId, p_replaced_player_id: replacedPlayerId, p_include_recent: includeRecent });
    if (error) return { data: null, error: rpcError(error) };
    const parsed = parseCaptainSubInvitationContext(data, scope, { includeRecent });
    return { data: parsed, error: parsed ? null : invalid };
  } catch (error) { return { data: null, error: rpcError(error) }; }
}
function validCommand(c: CaptainSubInvitationCommand): boolean {
  if (!validScope(c) || !uuid(c.requestId) || !['spare', 'recent', 'manual'].includes(c.kind) || typeof c.confirmed !== 'boolean' || typeof c.saveToTeamSpares !== 'boolean' || !nullableUuid(c.replacedPlayerId ?? null) || !text(c.message ?? null)) return false;
  if (c.kind === 'manual') return c.playerId == null && typeof c.manualName === 'string' && c.manualName.trim().length > 0 && (c.manualPosition == null || ['Forward', 'Defense', 'Goalie'].includes(c.manualPosition)) && (c.manualJersey == null || Number.isInteger(c.manualJersey) && c.manualJersey >= 1 && c.manualJersey <= 99);
  return uuid(c.playerId) && c.manualName == null && c.manualPosition == null && c.manualJersey == null && c.saveToTeamSpares === false;
}
/** Bind every receipt, including idempotent branches, to the original command. */
export function parseCaptainSubInvitationResult(value: unknown, command: CaptainSubInvitationCommand): CaptainSubInvitationCommandResult | null {
  if (!validCommand(command) || !row(value, 'schema_version game_id team_id league_id season_id request_id outcome invitation player checkin_status') || !scoped(value, command) || !same(value.request_id, command.requestId)) return null;
  if (!invitationRow(value.invitation) || !row(value.player, 'player_id full_name email position') || !uuid(value.player.player_id) || !text(value.player.full_name) || !text(value.player.email) || !text(value.player.position) || !same(value.player.player_id, value.invitation.player_id)) return null;
  if (command.kind !== 'manual' && !same(value.player.player_id, command.playerId)) return null;
  const replacement = command.replacedPlayerId ?? null;
  // Null input preserves stored assignment; idempotent outcomes do not reassign a selected slot.
  if (replacement !== null && (value.outcome === 'pending' || value.outcome === 'confirmed') && !same(replacement, value.invitation.replaced_player_id)) return null;
  if (value.outcome === 'pending' || value.outcome === 'already_pending') {
    if (command.kind === 'manual' || command.confirmed || value.invitation.status !== 'pending' || value.checkin_status !== null) return null;
  } else if (value.outcome === 'confirmed' || value.outcome === 'already_confirmed') {
    if (value.invitation.status !== 'accepted' || value.checkin_status !== 'confirmed' || value.outcome === 'confirmed' && !command.confirmed && command.kind !== 'manual') return null;
  } else return null;
  return value as unknown as CaptainSubInvitationCommandResult;
}
/** Call once per logical UI command. Reuse this ID after an unknown-result retry. */
export function createCaptainSubInvitationRequestId(): string { return Crypto.randomUUID(); }
function rejection(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  switch ((error as Row).code) {
    case 'PGRST202': case '42883': return rpcError(error);
    case '22023': return 'Invite Sub was not saved. Check the player fields and keep the message within 4000 bytes, then try again.';
    case '23505': return 'Invite Sub was not saved. Search available spares to choose an existing player, or refresh to check conflicting invitations.';
    case '28000': case '42501': return 'Invite Sub was not saved. Refresh and check your captain access and player eligibility.';
    case '54000': return 'Invite Sub was not saved because a safe data limit was reached. Ask an administrator for help.';
    default: return null;
  }
}
export async function manageCaptainSubInvitation(command: CaptainSubInvitationCommand): Promise<Reply<CaptainSubInvitationCommandResult>> {
  if (!validCommand(command)) return { data: null, error: 'Invalid Invite Sub request.', rejected: true };
  try {
    const { data, error } = await supabase.rpc('captain_manage_sub_invitation', {
      p_game_id: command.gameId, p_team_id: command.teamId, p_league_id: command.leagueId,
      p_request_id: command.requestId, p_kind: command.kind, p_player_id: command.playerId ?? null,
      p_replaced_player_id: command.replacedPlayerId ?? null, p_message: command.message ?? null,
      p_confirmed: command.confirmed, p_manual_name: command.manualName ?? null,
      p_manual_position: command.manualPosition ?? null, p_manual_jersey: command.manualJersey ?? null,
      p_save_to_team_spares: command.saveToTeamSpares,
    });
    if (error) { const reason = rejection(error); return reason ? { data: null, error: reason, rejected: true } : { data: null, error: rpcError(error) }; }
    const parsed = parseCaptainSubInvitationResult(data, command);
    return { data: parsed, error: parsed ? null : invalid };
  } catch (error) { return { data: null, error: rpcError(error) }; }
}
