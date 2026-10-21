import type { ScoringRosterPlayer, ScoringSnapshot } from '../supabase/captainScoring';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UUID equality only; never normalize the identifiers sent to the server. */
export function sameScoringIdentity(a: string, b: string): boolean { return uuid.test(a) && uuid.test(b) && a.toLowerCase() === b.toLowerCase(); }
export function scoringPlayerName(player: ScoringRosterPlayer): string { return player.full_name === null || player.full_name === '' ? 'Unnamed player' : player.full_name; }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function eligibleScoringPlayers(snapshot: ScoringSnapshot, excludeIds: readonly string[] = []): ScoringRosterPlayer[] {
  return snapshot.roster.filter(player => player.eligible_for_goal === true && !excludeIds.some(id => sameScoringIdentity(id, player.player_id))).sort((a,b) => scoringPlayerName(a).localeCompare(scoringPlayerName(b), 'en', { sensitivity: 'base' }) || compare(a.player_id.toLowerCase(), b.player_id.toLowerCase()));
}
