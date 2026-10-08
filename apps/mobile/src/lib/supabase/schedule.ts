import { supabase } from './client';
import { getOperationalSeason, getSchedule, type GameRow, type Season } from './data';

const DEFAULT_HOCKEY_TIMEZONE = 'America/Toronto';

export type ScheduleSnapshot =
  | { kind: 'ready'; scopeKey: string; season: Season; timezone: string | null; games: GameRow[] }
  | { kind: 'no-season'; scopeKey: string; season: null; timezone: null; games: [] };

export function scheduleScopeKey(leagueId: string, seasonId: string | null, divisionId: string | null) {
  return `${leagueId}:${seasonId ?? 'no-season'}:${divisionId ?? 'all'}`;
}

function validateTimezone(value: unknown): string | null {
  const timezone = value === null ? DEFAULT_HOCKEY_TIMEZONE : typeof value === 'string' ? value.trim() : '';
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return null;
  }
}

async function loadLeagueTimezone(leagueId: string) {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, status, timezone')
    .eq('id', leagueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.id !== leagueId || data.status !== 'active') {
    throw new Error('Schedule league identity is inactive or mismatched');
  }
  return validateTimezone(data.timezone);
}

export async function loadScheduleSnapshot(leagueId: string, divisionId: string | null): Promise<ScheduleSnapshot> {
  const season = await getOperationalSeason(leagueId);
  if (!season) {
    return {
      kind: 'no-season',
      scopeKey: scheduleScopeKey(leagueId, null, divisionId),
      season: null,
      timezone: null,
      games: [],
    };
  }
  const timezone = await loadLeagueTimezone(leagueId);
  const games = await getSchedule(leagueId, season.id, divisionId, { complete: true, throwOnError: true });
  return {
    kind: 'ready',
    scopeKey: scheduleScopeKey(leagueId, season.id, divisionId),
    season,
    timezone,
    games,
  };
}
