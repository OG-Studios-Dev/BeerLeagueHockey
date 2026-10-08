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
