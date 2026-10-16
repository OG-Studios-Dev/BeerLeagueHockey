import { supabase } from './client';

export type CheckinStatus = 'confirmed' | 'tentative' | 'out';
export type GameCheckinPlayer = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type GameCheckinEntry = {
  status: CheckinStatus;
  player: GameCheckinPlayer | null;
};

type GameCheckinRow = {
  game_id: string;
  status: CheckinStatus;
};

type GameCheckinSummaryRow = {
  status: CheckinStatus;
  player: GameCheckinPlayer | GameCheckinPlayer[] | null;
};

type SelfCheckinRpcReply = {
  game_id: string;
  team_id: string;
  outcome: 'set';
  operation: 'set';
  status: CheckinStatus;
  affected_rows: 1;
  checkin_id: string;
};

// Match PostgreSQL's canonical uuid input shape without restricting version bits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSelfCheckinRpcReply(
  value: unknown,
  expectedGameId: string,
  expectedTeamId: string,
  expectedStatus: CheckinStatus,
): value is SelfCheckinRpcReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  const keys = Object.keys(reply).sort();
  const expectedKeys = ['affected_rows', 'checkin_id', 'game_id', 'operation', 'outcome', 'status', 'team_id'];
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && reply.game_id === expectedGameId
    && reply.team_id === expectedTeamId
    && reply.outcome === 'set'
    && reply.operation === 'set'
    && reply.status === expectedStatus
    && reply.affected_rows === 1
    && typeof reply.checkin_id === 'string'
    && UUID.test(reply.checkin_id);
}

export async function updateCheckin(gameId: string, teamId: string, status: CheckinStatus, note?: string) {
  try {
    const { data, error } = await (supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>)(
      'update_my_game_checkin',
      { p_game_id: gameId, p_team_id: teamId, p_status: status, p_note: note ?? null },
    );
    if (error) return { success: false, error: error.message };
    if (!isSelfCheckinRpcReply(data, gameId, teamId, status)) {
      return { success: false, error: 'Invalid check-in RPC response' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Check-in request failed',
    };
  }
}

export async function getMyCheckins(teamId: string): Promise<Record<string, CheckinStatus>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase.from('game_checkins').select('game_id, status').eq('player_id', user.id).eq('team_id', teamId);
  return ((data ?? []) as GameCheckinRow[]).reduce(
    (acc: Record<string, CheckinStatus>, row) => ({ ...acc, [row.game_id]: row.status }),
    {},
  );
}

export async function getMyCheckinsForTeams(teamIds: string[]): Promise<Record<string, CheckinStatus>> {
  const normalizedTeamIds = [...new Set(teamIds.filter(Boolean))];
  if (normalizedTeamIds.length === 0) return {};

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const { data } = await supabase
    .from('game_checkins')
    .select('game_id, status')
    .eq('player_id', user.id)
    .in('team_id', normalizedTeamIds);

  return ((data ?? []) as GameCheckinRow[]).reduce(
    (acc: Record<string, CheckinStatus>, row) => ({ ...acc, [row.game_id]: row.status }),
    {},
  );
}

export async function getGameCheckinSummary(gameId: string, teamId: string) {
  const { data } = await supabase.from('game_checkins')
    .select('status, player:profiles!player_id(id, full_name, avatar_url)')
    .eq('game_id', gameId).eq('team_id', teamId);
  const rows = ((data ?? []) as GameCheckinSummaryRow[]).map((row) => ({
    status: row.status,
    player: Array.isArray(row.player) ? row.player[0] ?? null : row.player ?? null,
  })) as GameCheckinEntry[];
  const confirmed = rows.filter((row) => row.status === 'confirmed');
  const tentative = rows.filter((row) => row.status === 'tentative');
  const out = rows.filter((row) => row.status === 'out');
  return { confirmed, tentative, out, total: rows.length };
}
