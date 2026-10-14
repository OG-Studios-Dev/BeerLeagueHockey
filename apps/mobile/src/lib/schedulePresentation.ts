import type { GameRow } from './supabase/data';

export type ScheduleTeamOption = {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
};

function canonicalTeamOption(
  teamId: string,
  team: GameRow['home_team'] | GameRow['away_team'],
): ScheduleTeamOption | null {
  if (!team || team.id !== teamId || !team.name.trim()) return null;
  return {
    id: teamId,
    name: team.name,
    logoUrl: team.logo_url ?? null,
    primaryColor: team.primary_color ?? null,
  };
}

export function buildScheduleTeamOptions(games: GameRow[]): ScheduleTeamOption[] {
  const byId = new Map<string, ScheduleTeamOption>();
  for (const game of games) {
    for (const option of [
      canonicalTeamOption(game.home_team_id, game.home_team),
      canonicalTeamOption(game.away_team_id, game.away_team),
    ]) {
      if (option && !byId.has(option.id)) byId.set(option.id, option);
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function filterScheduleGamesByTeam(games: GameRow[], teamId: string | null): GameRow[] {
  if (!teamId) return games;
  return games.filter((game) => game.home_team_id === teamId || game.away_team_id === teamId);
}

type TeamScheduleGame = Pick<GameRow, 'id' | 'scheduled_at' | 'status'>;

function scheduledTime(game: TeamScheduleGame): number | null {
  const value = new Date(game.scheduled_at).getTime();
  return Number.isFinite(value) ? value : null;
}

export function selectTeamScheduleGames<T extends TeamScheduleGame>(games: T[]): T[] {
  const valid = games.filter((game) => scheduledTime(game) !== null);
  const recent = valid
    .filter((game) => game.status === 'completed' || game.status === 'pending_verification')
    .sort((left, right) => scheduledTime(right)! - scheduledTime(left)! || left.id.localeCompare(right.id))
    .slice(0, 2);
  const next = valid
    .filter((game) => game.status === 'in_progress')
    .sort((left, right) => scheduledTime(left)! - scheduledTime(right)! || left.id.localeCompare(right.id))[0]
    ?? valid
      .filter((game) => game.status === 'scheduled')
      .sort((left, right) => scheduledTime(left)! - scheduledTime(right)! || left.id.localeCompare(right.id))[0]
    ?? null;
  return [...recent, ...(next ? [next] : [])]
    .sort((left, right) => scheduledTime(left)! - scheduledTime(right)! || left.id.localeCompare(right.id));
}

export type ScheduleTeamSelection = { scopeKey: string; teamId: string | null };

export function resolveScheduleTeamSelection(
  selection: ScheduleTeamSelection,
  scopeKey: string,
  _options: ScheduleTeamOption[],
): string | null {
  if (selection.scopeKey !== scopeKey || !selection.teamId) return null;
  return selection.teamId;
}

export type SchedulePresentationRow =
  | { type: 'date'; id: string; title: string }
  | { type: 'game'; id: string; game: GameRow };

function scheduleDateGroup(scheduledAt: string, timezone: string) {
  const instant = new Date(scheduledAt);
  if (!Number.isFinite(instant.getTime())) return { key: 'unavailable', title: 'Date unavailable' };
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'long',
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const year = read('year');
    const month = read('month');
    const day = read('day');
    const weekday = read('weekday');
    if (!year || !month || !day || !weekday) return { key: 'unavailable', title: 'Date unavailable' };
    return { key: `${year}-${month}-${day}`, title: `${weekday}, ${month} ${day}` };
  } catch {
    return { key: 'unavailable', title: 'Date unavailable' };
  }
}

export function buildScheduleRows(games: GameRow[], timezone: string): SchedulePresentationRow[] {
  const ordered = [...games].sort((left, right) => {
    const leftTime = new Date(left.scheduled_at).getTime();
    const rightTime = new Date(right.scheduled_at).getTime();
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return safeLeft - safeRight || left.id.localeCompare(right.id);
  });
  const rows: SchedulePresentationRow[] = [];
  let currentGroup = '';
  for (const game of ordered) {
    const group = scheduleDateGroup(game.scheduled_at, timezone);
    if (group.key !== currentGroup) {
      currentGroup = group.key;
      rows.push({ type: 'date', id: `date:${group.key}`, title: group.title });
    }
    rows.push({ type: 'game', id: `game:${game.id}`, game });
  }
  return rows;
}
