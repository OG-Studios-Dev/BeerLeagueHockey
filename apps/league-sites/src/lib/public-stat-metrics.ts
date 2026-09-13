import { NextRequest, NextResponse } from 'next/server';

import { getDivisions, getLeagueBySlug, hasPlatformSubscription } from '@/lib/data';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export const PUBLIC_STAT_METRICS_SCHEMA_VERSION = 2 as const;
export const PUBLIC_METRIC_STATES = ['verified', 'recorded', 'reported', 'estimated', 'unknown', 'conflicted'] as const;
export const PUBLIC_METRIC_SOURCES = [
  'attendance', 'skater_stats', 'goalie_stats', 'goalie_assignment', 'roster_window',
  'accepted_sub', 'imported', 'override', 'capture_confirmation',
] as const;

export type PublicMetricState = (typeof PUBLIC_METRIC_STATES)[number];
export type PublicMetricSource = (typeof PUBLIC_METRIC_SOURCES)[number];
export type PublicStatMetric = {
  value: number | null;
  state: PublicMetricState;
  sources: PublicMetricSource[];
  candidates?: { confirmed?: number; recorded?: number; estimated?: number };
};
export type PublicTeamRef = { id: string; name: string };
export type PublicGoalieMetricGroup = {
  gamesPlayed: PublicStatMetric;
  wins: PublicStatMetric;
  losses: PublicStatMetric;
  saves: PublicStatMetric;
  goalsAgainst: PublicStatMetric;
  savePercentage: PublicStatMetric;
  goalsAgainstAverage: PublicStatMetric;
  shutouts: PublicStatMetric;
};
export type PublicSeasonMetricPlayer = {
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  displayTeam: PublicTeamRef | null;
  teams: PublicTeamRef[];
  roles: Array<'skater' | 'goalie'>;
  metrics: {
    gamesPlayed: PublicStatMetric;
    goals: PublicStatMetric;
    assists: PublicStatMetric;
    points: PublicStatMetric;
    penaltyMinutes: PublicStatMetric;
  };
  goalie: PublicGoalieMetricGroup | null;
};
export type PublicSeasonMetricPayload = {
  players: PublicSeasonMetricPlayer[];
  coverage: { participation: PublicMetricState[]; penalties: PublicMetricState[]; goalies: PublicMetricState[] };
};

type CaptureStatus = 'complete' | 'not_recorded' | null;
export type PublicMetricGameRow = {
  id: string; league_id: string; season_id: string; status: string;
  home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null;
  scheduled_at: string; penalty_capture_status: CaptureStatus; goalie_capture_status: CaptureStatus;
  skater_capture_status?: CaptureStatus;
};
export type PublicMetricTeamRow = {
  id: string; league_id: string; season_id?: string | null; division_id: string | null; name: string;
};
export type PublicMetricProfileRow = {
  id: string; full_name: string | null; avatar_url: string | null; photo_url: string | null;
};
export type PublicMetricRosterRow = {
  id: string; player_id: string; team_id: string; league_id: string; season_id: string;
  start_date: string | null; end_date: string | null; is_goalie: boolean | null; position: string | null;
  status?: string; player_type?: string; games_played_override?: number | null;
};
export type PublicMetricCheckinRow = {
  id: string; game_id: string; player_id: string; team_id: string; status: string;
};
export type PublicMetricAcceptedSubRow = {
  id: string; game_id: string; invited_player_id: string; team_id: string; status: string;
};
export type PublicMetricPlayerStatRow = {
  id: string; game_id: string; player_id: string; team_id: string; league_id: string; season_id: string;
  goals: number | null; assists: number | null; penalty_minutes: number | null;
  scorekeeping_provenance?: 'event_derived' | null;
};
export type PublicMetricGoalieStatRow = {
  id: string; game_id: string; player_id: string; team_id: string; league_id: string; season_id: string;
  wins?: number | null; losses?: number | null; game_result?: string | null;
  saves: number | null; shots_against: number | null; goals_against: number | null; shutout: boolean | null;
  scorekeeping_provenance?: 'event_derived' | null;
};
export type PublicMetricGoalieAppearanceRow = {
  game_id: string; player_id: string; team_id: string; team_type: 'home' | 'away';
};
export type PublicStatMetricRows = {
  games: PublicMetricGameRow[];
  teams: PublicMetricTeamRow[];
  profiles: PublicMetricProfileRow[];
  rosters: PublicMetricRosterRow[];
  checkins: PublicMetricCheckinRow[];
  acceptedSubs: PublicMetricAcceptedSubRow[];
  playerStats: PublicMetricPlayerStatRow[];
  goalieStats: PublicMetricGoalieStatRow[];
  goalieAppearances: PublicMetricGoalieAppearanceRow[];
};

export type MetricScope = { leagueId: string; seasonId: string; divisionId?: string | null; teamId?: string | null; playerId?: string };
type Appearance = {
  playerId: string; gameId: string; teamIds: Set<string>;
  confirmed: boolean; out: boolean; skater: boolean; goalie: boolean; goalieAssigned: boolean; roster: boolean; acceptedSub: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SOURCE_ROWS = 50_000;
const DEFAULT_PAGE_SIZE = 1000;
const SUCCESS_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE = 'no-store';
const STATE_ORDER: PublicMetricState[] = ['verified', 'recorded', 'reported', 'estimated', 'unknown', 'conflicted'];
const SOURCE_ORDER = new Map(PUBLIC_METRIC_SOURCES.map((source, index) => [source, index]));

class PublicMetricDataError extends Error {}
class PublicMetricLimitError extends Error {}

function finite(value: number | null | undefined, label: string): number {
  const parsed = value ?? 0;
  if (!Number.isFinite(parsed) || parsed < 0) throw new PublicMetricDataError(`invalid ${label}`);
  return parsed;
}

function nullableSum(values: Array<number | null | undefined>, label: string): number | null {
  if (values.length === 0 || values.some((value) => value === null || value === undefined)) return null;
  return values.reduce<number>((sum, value) => sum + finite(value, label), 0);
}

function sources(values: Iterable<PublicMetricSource>): PublicMetricSource[] {
  return [...new Set(values)].sort((left, right) => (SOURCE_ORDER.get(left) ?? 99) - (SOURCE_ORDER.get(right) ?? 99));
}

function unknown(metricSources: PublicMetricSource[] = []): PublicStatMetric {
  return { value: null, state: 'unknown', sources: sources(metricSources) };
}

function known(value: number, state: PublicMetricState, metricSources: PublicMetricSource[]): PublicStatMetric {
  return { value: finite(value, 'metric value'), state, sources: sources(metricSources) };
}

function combineState(states: PublicMetricState[]): PublicMetricState {
  return states.reduce((weakest, state) => STATE_ORDER.indexOf(state) > STATE_ORDER.indexOf(weakest) ? state : weakest, 'verified');
}

function isGoalieRole(row: Pick<PublicMetricRosterRow, 'is_goalie' | 'position'>): boolean {
  const position = row.position?.trim().toLowerCase();
  return row.is_goalie === true || position === 'g' || position === 'goalie';
}

function rosterEligible(row: PublicMetricRosterRow, game: PublicMetricGameRow): boolean {
  if (row.team_id !== game.home_team_id && row.team_id !== game.away_team_id) return false;
  if (row.status !== undefined && row.status !== 'active') return false;
  if (row.player_type !== undefined && row.player_type !== 'regular') return false;
  const gameDate = game.scheduled_at.slice(0, 10);
  return (!row.start_date || row.start_date.slice(0, 10) <= gameDate)
    && (!row.end_date || row.end_date.slice(0, 10) >= gameDate);
}

function appearanceState(appearance: Appearance): PublicMetricState | null {
  const direct = appearance.skater || appearance.goalie || appearance.goalieAssigned;
  if (appearance.out && (appearance.confirmed || direct)) return 'conflicted';
  if (direct) return 'recorded';
  if (appearance.confirmed) return 'reported';
  if (!appearance.out && (appearance.acceptedSub || appearance.roster)) return 'estimated';
  return null;
}

function appearanceSources(appearance: Appearance): PublicMetricSource[] {
  const result: PublicMetricSource[] = [];
  if (appearance.confirmed || appearance.out) result.push('attendance');
  if (appearance.skater) result.push('skater_stats');
  if (appearance.goalie) result.push('goalie_stats');
  if (appearance.goalieAssigned) result.push('goalie_assignment');
  if (appearance.roster) result.push('roster_window');
  if (appearance.acceptedSub) result.push('accepted_sub');
  return sources(result);
}

function participationMetric(appearances: Appearance[]): PublicStatMetric {
  const classified = appearances.map((appearance) => ({ appearance, state: appearanceState(appearance) }))
    .filter((entry): entry is { appearance: Appearance; state: PublicMetricState } => entry.state !== null);
  if (classified.length === 0) return unknown();
  const state = combineState(classified.map((entry) => entry.state));
  const metricSources = sources(classified.flatMap((entry) => appearanceSources(entry.appearance)));
  if (state === 'conflicted') {
    const confirmed = classified.filter(({ appearance }) => appearance.confirmed).length;
    const recorded = classified.filter(({ appearance }) => appearance.skater || appearance.goalie).length;
    const estimated = classified.filter(({ state: itemState }) => itemState === 'estimated').length;
    return {
      value: null,
      state,
      sources: metricSources,
      candidates: {
        ...(confirmed ? { confirmed } : {}),
        ...(recorded ? { recorded } : {}),
        ...(estimated ? { estimated } : {}),
      },
    };
  }
  return known(classified.length, state, metricSources);
}

function rosterOverrideMetric(rows: PublicMetricRosterRow[]): PublicStatMetric | null {
  const byTeam = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.status !== undefined && row.status !== 'active') continue;
    if (row.player_type !== undefined && row.player_type !== 'regular') continue;
    if (row.games_played_override === null || row.games_played_override === undefined) continue;
    const value = finite(row.games_played_override, 'games played override');
    byTeam.set(row.team_id, new Set([...(byTeam.get(row.team_id) ?? []), value]));
  }
  if (byTeam.size === 0) return null;
  if ([...byTeam.values()].some((values) => values.size !== 1)) {
    return { value: null, state: 'conflicted', sources: ['override'] };
  }
  return known([...byTeam.values()].reduce((sum, values) => sum + [...values][0], 0), 'reported', ['override']);
}

function validateInputRows(rows: PublicStatMetricRows, scope: MetricScope) {
  const collections: Array<[string, Array<{ id: string }>]> = [
    ['game', rows.games], ['team', rows.teams], ['profile', rows.profiles], ['roster', rows.rosters],
    ['checkin', rows.checkins], ['accepted sub', rows.acceptedSubs], ['player stat', rows.playerStats], ['goalie stat', rows.goalieStats],
  ];
  for (const [label, collection] of collections) {
    if (collection.length > MAX_SOURCE_ROWS) throw new PublicMetricLimitError(`${label} row limit exceeded`);
    const ids = new Set<string>();
    for (const row of collection) {
      if (!UUID.test(row.id)) throw new PublicMetricDataError(`invalid ${label} id`);
      if (ids.has(row.id)) throw new PublicMetricDataError(`duplicate ${label} id`);
      ids.add(row.id);
    }
  }
  if (rows.games.some((game) => game.league_id !== scope.leagueId || game.season_id !== scope.seasonId)) {
    throw new PublicMetricDataError('cross-scope game row');
  }
  for (const row of [...rows.playerStats, ...rows.goalieStats]) {
    if (row.league_id !== scope.leagueId || row.season_id !== scope.seasonId) throw new PublicMetricDataError('cross-scope stat row');
  }
  const appearanceKeys = new Set<string>();
  for (const row of rows.goalieAppearances) {
    const key = `${row.game_id}\u0000${row.player_id}`;
    if (![row.game_id, row.player_id, row.team_id].every((id) => UUID.test(id)) || appearanceKeys.has(key)) {
      throw new PublicMetricDataError('invalid goalie appearance row');
    }
    appearanceKeys.add(key);
  }
}

export function aggregatePublicSeasonStats(rows: PublicStatMetricRows, scope: MetricScope): PublicSeasonMetricPayload {
  validateInputRows(rows, scope);
  const permittedTeams = new Map(rows.teams
    .filter((team) => team.league_id === scope.leagueId)
    .filter((team) => !scope.divisionId || team.division_id === scope.divisionId)
    .filter((team) => !scope.teamId || team.id === scope.teamId)
    .map((team) => [team.id, team]));
  const games = new Map(rows.games
    .filter((game) => game.status === 'completed')
    .filter((game) => permittedTeams.has(game.home_team_id) || permittedTeams.has(game.away_team_id))
    .map((game) => [game.id, game]));
  const teamAllowed = (teamId: string) => permittedTeams.has(teamId) && (!scope.teamId || teamId === scope.teamId);
  const appearanceMap = new Map<string, Appearance>();
  const getAppearance = (playerId: string, gameId: string, teamId: string) => {
    const key = `${playerId}\u0000${gameId}`;
    let appearance = appearanceMap.get(key);
    if (!appearance) {
      appearance = { playerId, gameId, teamIds: new Set(), confirmed: false, out: false, skater: false, goalie: false, goalieAssigned: false, roster: false, acceptedSub: false };
      appearanceMap.set(key, appearance);
    }
    appearance.teamIds.add(teamId);
    return appearance;
  };

  for (const roster of rows.rosters) {
    if (roster.league_id !== scope.leagueId || roster.season_id !== scope.seasonId || !teamAllowed(roster.team_id)) continue;
    for (const game of games.values()) {
      if (!rosterEligible(roster, game)) continue;
      const appearance = getAppearance(roster.player_id, game.id, roster.team_id);
      appearance.roster = true;
    }
  }
  for (const checkin of rows.checkins) {
    if (!games.has(checkin.game_id) || !teamAllowed(checkin.team_id)) continue;
    const appearance = getAppearance(checkin.player_id, checkin.game_id, checkin.team_id);
    appearance.confirmed ||= checkin.status === 'confirmed';
    appearance.out ||= checkin.status === 'out';
  }
  for (const sub of rows.acceptedSubs) {
    if (sub.status !== 'accepted' || !games.has(sub.game_id) || !teamAllowed(sub.team_id)) continue;
    getAppearance(sub.invited_player_id, sub.game_id, sub.team_id).acceptedSub = true;
  }
  const playerStats = rows.playerStats.filter((row) => games.has(row.game_id) && teamAllowed(row.team_id));
  for (const stat of playerStats) getAppearance(stat.player_id, stat.game_id, stat.team_id).skater = true;
  const goalieStats = rows.goalieStats.filter((row) => games.has(row.game_id) && teamAllowed(row.team_id));
  for (const stat of goalieStats) getAppearance(stat.player_id, stat.game_id, stat.team_id).goalie = true;
  const goalieAssignments = rows.goalieAppearances.filter((row) => games.has(row.game_id) && teamAllowed(row.team_id));
  for (const assignment of goalieAssignments) {
    const game = games.get(assignment.game_id)!;
    const expectedTeam = assignment.team_type === 'home' ? game.home_team_id : game.away_team_id;
    if (assignment.team_id !== expectedTeam) throw new PublicMetricDataError('goalie assignment team conflict');
    getAppearance(assignment.player_id, assignment.game_id, assignment.team_id).goalieAssigned = true;
  }

  const rostersByPlayer = new Map<string, PublicMetricRosterRow[]>();
  for (const roster of rows.rosters.filter((row) => teamAllowed(row.team_id)
    && (row.status === undefined || row.status === 'active')
    && (row.player_type === undefined || row.player_type === 'regular'))) {
    rostersByPlayer.set(roster.player_id, [...(rostersByPlayer.get(roster.player_id) ?? []), roster]);
  }
  const appearancesByPlayer = new Map<string, Appearance[]>();
  for (const appearance of appearanceMap.values()) {
    if (appearanceState(appearance) === null) continue;
    appearancesByPlayer.set(appearance.playerId, [...(appearancesByPlayer.get(appearance.playerId) ?? []), appearance]);
  }
  const profileMap = new Map(rows.profiles.map((profile) => [profile.id, profile]));
  const overridePlayerIds = [...rostersByPlayer.entries()]
    .filter(([, rosterRows]) => rosterOverrideMetric(rosterRows) !== null)
    .map(([playerId]) => playerId);
  const playerIds = [...new Set([...appearancesByPlayer.keys(), ...overridePlayerIds])];

  const players = playerIds.map((playerId): PublicSeasonMetricPlayer => {
    const appearances = appearancesByPlayer.get(playerId) ?? [];
    const skaterRows = playerStats.filter((row) => row.player_id === playerId);
    const goalieRows = goalieStats.filter((row) => row.player_id === playerId);
    const rosterRows = rostersByPlayer.get(playerId) ?? [];
    const skaterRole = skaterRows.length > 0 || rosterRows.some((row) => !isGoalieRole(row));
    const assignedRows = goalieAssignments.filter((row) => row.player_id === playerId);
    const goalieRole = goalieRows.length > 0 || assignedRows.length > 0 || rosterRows.some(isGoalieRole);
    const roles: Array<'skater' | 'goalie'> = [...(skaterRole ? ['skater' as const] : []), ...(goalieRole ? ['goalie' as const] : [])];
    if (roles.length === 0) roles.push('skater');

    const scoringMetric = (field: 'goals' | 'assists'): PublicStatMetric => {
      const fieldSources: PublicMetricSource[] = skaterRows.length ? ['skater_stats'] : [];
      const captured = skaterRows.length > 0 && skaterRows.every((row) =>
        row.scorekeeping_provenance === 'event_derived' && games.get(row.game_id)?.skater_capture_status === 'complete');
      if (captured) fieldSources.push('capture_confirmation');
      const value = nullableSum(skaterRows.map((row) => row[field]), field);
      return value === null ? unknown(fieldSources) : known(value, captured ? 'verified' : 'recorded', fieldSources);
    };
    const goals = scoringMetric('goals');
    const assists = scoringMetric('assists');
    const points = goals.value === null || assists.value === null
      ? unknown(sources([...goals.sources, ...assists.sources]))
      : known(goals.value + assists.value, combineState([goals.state, assists.state]), sources([...goals.sources, ...assists.sources]));

    const participationGames = appearances.map((appearance) => games.get(appearance.gameId)!).filter(Boolean);
    const pimComplete = participationGames.length > 0 && participationGames.every((game) => game.penalty_capture_status === 'complete');
    const pimSources: PublicMetricSource[] = skaterRows.length ? ['skater_stats'] : [];
    if (pimComplete) pimSources.push('capture_confirmation');
    const pimValue = nullableSum(skaterRows.map((row) => row.penalty_minutes), 'penalty minutes');
    const pimEventDerived = skaterRows.length > 0 && skaterRows.every((row) => row.scorekeeping_provenance === 'event_derived');
    const penaltyMinutes = !pimComplete || pimValue === null
      ? unknown(pimSources)
      : known(pimValue, pimEventDerived ? 'verified' : 'recorded', pimSources);

    const teamAppearanceCounts = new Map<string, number>();
    for (const appearance of appearances) {
      for (const teamId of appearance.teamIds) {
        if (teamAllowed(teamId)) teamAppearanceCounts.set(teamId, (teamAppearanceCounts.get(teamId) ?? 0) + 1);
      }
    }
    const teamIds = [...new Set([...teamAppearanceCounts.keys(), ...rosterRows.map((row) => row.team_id)])]
      .filter(teamAllowed);
    const teams = teamIds.map((teamId) => ({ id: teamId, name: permittedTeams.get(teamId)?.name ?? 'Unknown team' }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'));
    const displayTeam = [...teams].sort((left, right) =>
      (teamAppearanceCounts.get(right.id) ?? 0) - (teamAppearanceCounts.get(left.id) ?? 0)
      || left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'))[0] ?? null;

    let goalie: PublicGoalieMetricGroup | null = null;
    if (goalieRole) {
      const goalieAppearances = appearances.filter((appearance) => appearance.goalie
        || appearance.goalieAssigned
        || rosterRows.some((roster) => {
          const game = games.get(appearance.gameId);
          return Boolean(game && isGoalieRole(roster) && appearance.teamIds.has(roster.team_id) && rosterEligible(roster, game));
        }));
      const assignmentKeys = new Set(assignedRows.map((row) => `${row.game_id}\u0000${row.team_id}`));
      const captureConflict = goalieRows.some((row) => row.scorekeeping_provenance === 'event_derived'
        && games.get(row.game_id)?.goalie_capture_status === 'complete'
        && !assignmentKeys.has(`${row.game_id}\u0000${row.team_id}`));
      const rowCaptured = (row: PublicMetricGoalieStatRow) => row.scorekeeping_provenance === 'event_derived'
        && games.get(row.game_id)?.goalie_capture_status === 'complete'
        && assignmentKeys.has(`${row.game_id}\u0000${row.team_id}`);
      const goalieField = (values: Array<number | null | undefined>, label: string): PublicStatMetric => {
        const fieldSources: PublicMetricSource[] = goalieRows.length ? ['goalie_stats'] : [];
        const captured = goalieRows.length > 0 && goalieRows.every(rowCaptured);
        if (captured) fieldSources.push('goalie_assignment', 'capture_confirmation');
        if (captureConflict) return { value: null, state: 'conflicted', sources: sources([...fieldSources, 'goalie_assignment', 'capture_confirmation']) };
        const value = nullableSum(values, label);
        return value === null ? unknown(fieldSources) : known(value, captured ? 'verified' : 'recorded', fieldSources);
      };
      const resultValue = (row: PublicMetricGoalieStatRow, kind: 'win' | 'loss'): number | null => {
        const explicit = kind === 'win' ? row.wins : row.losses;
        if (explicit !== null && explicit !== undefined) return finite(explicit, `goalie ${kind}s`);
        if (row.game_result === null || row.game_result === undefined) return null;
        const result = row.game_result.trim().toUpperCase();
        const wins = new Set(['W', 'WIN']);
        const losses = new Set(['L', 'LOSS', 'OTL', 'SOL']);
        const ties = new Set(['T']);
        if (!wins.has(result) && !losses.has(result) && !ties.has(result)) throw new PublicMetricDataError('invalid goalie result');
        return kind === 'win' ? Number(wins.has(result)) : Number(losses.has(result));
      };
      const wins = goalieField(goalieRows.map((row) => resultValue(row, 'win')), 'goalie wins');
      const losses = goalieField(goalieRows.map((row) => resultValue(row, 'loss')), 'goalie losses');
      const saves = goalieField(goalieRows.map((row) => row.saves), 'goalie saves');
      const goalsAgainst = goalieField(goalieRows.map((row) => row.goals_against), 'goals against');
      const shotsAgainst = goalieField(goalieRows.map((row) => row.shots_against), 'shots against');
      const shutouts = goalieField(goalieRows.map((row) => row.shutout === null ? null : Number(row.shutout)), 'shutouts');
      let gp = participationMetric(goalieAppearances);
      if (captureConflict) gp = { value: null, state: 'conflicted', sources: sources([...gp.sources, 'goalie_assignment', 'capture_confirmation']) };
      const assignedOnly = goalieAppearances.length > 0 && goalieAppearances.every((appearance) =>
        appearance.goalieAssigned && !appearance.out && games.get(appearance.gameId)?.goalie_capture_status === 'complete');
      if (assignedOnly && gp.state === 'recorded') {
        gp = known(goalieAppearances.length, 'verified', ['goalie_assignment', 'capture_confirmation']);
      }
      const rateMetric = (value: number, parts: PublicStatMetric[]) => {
        const state = combineState(parts.map((part) => part.state));
        const rateSources = sources(parts.flatMap((part) => part.sources));
        return state === 'conflicted' ? { value: null, state, sources: rateSources } : known(value, state, rateSources);
      };
      goalie = {
        gamesPlayed: gp,
        wins,
        losses,
        saves,
        goalsAgainst,
        savePercentage: shotsAgainst.value && saves.value !== null ? rateMetric(saves.value / shotsAgainst.value, [saves, shotsAgainst]) : unknown(sources([...saves.sources, ...shotsAgainst.sources])),
        goalsAgainstAverage: gp.value && goalsAgainst.value !== null ? rateMetric(goalsAgainst.value / gp.value, [goalsAgainst, gp]) : gp.state === 'conflicted'
          ? { value: null, state: 'conflicted', sources: sources([...goalsAgainst.sources, ...gp.sources]) }
          : unknown(sources([...goalsAgainst.sources, ...gp.sources])),
        shutouts,
      };
    }
    const profile = profileMap.get(playerId);
    return {
      playerId,
      playerName: profile?.full_name?.trim() || 'Unknown Player',
      avatarUrl: profile?.avatar_url ?? profile?.photo_url ?? null,
      displayTeam,
      teams,
      roles,
      metrics: {
        gamesPlayed: rosterOverrideMetric(rosterRows) ?? participationMetric(appearances),
        goals,
        assists,
        points,
        penaltyMinutes,
      },
      goalie,
    };
  }).sort((left, right) => {
    const pointDelta = (right.metrics.points.value ?? -1) - (left.metrics.points.value ?? -1);
    return pointDelta || left.playerName.localeCompare(right.playerName, 'en') || left.playerId.localeCompare(right.playerId, 'en');
  });

  const coverage = (states: PublicMetricState[]) => [...new Set(states)].sort((left, right) => STATE_ORDER.indexOf(left) - STATE_ORDER.indexOf(right));
  return {
    players,
    coverage: {
      participation: coverage(players.map((player) => player.metrics.gamesPlayed.state)),
      penalties: coverage(players.map((player) => player.metrics.penaltyMinutes.state)),
      goalies: coverage(players.flatMap((player) => player.goalie ? Object.values(player.goalie).map((metric) => metric.state) : [])),
    },
  };
}

type QueryResult = { data: unknown[] | null; count: number | null; error: unknown };
type QueryLike = { range(from: number, to: number): Promise<QueryResult> };
type ClientLike = { from(table: string): { select(columns: string, options?: { count?: 'exact' }): unknown } };
type SourceName = keyof PublicStatMetricRows;

async function readPages(build: () => QueryLike, label: string, pageSize: number): Promise<unknown[]> {
  const first = await build().range(0, pageSize - 1);
  if (first.error) throw new PublicMetricDataError(`${label} source read failed`);
  if (!Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) throw new PublicMetricDataError(`${label} source count missing`);
  const count = first.count as number;
  if (count > MAX_SOURCE_ROWS) throw new PublicMetricLimitError(`${label} source row limit exceeded`);
  const result = [...(first.data ?? [])];
  for (let offset = pageSize; offset < count; offset += pageSize) {
    const page = await build().range(offset, Math.min(offset + pageSize - 1, count - 1));
    if (page.error) throw new PublicMetricDataError(`${label} source page failed`);
    if (page.count !== count) throw new PublicMetricDataError(`${label} source count changed`);
    result.push(...(page.data ?? []));
  }
  if (result.length !== count) throw new PublicMetricDataError(`${label} source read incomplete`);
  return result;
}

function applyFilters(queryValue: unknown, filters: Array<['eq' | 'in', string, unknown]>, orderColumns: string[] = ['id']): QueryLike {
  let query = queryValue as Record<string, (...args: unknown[]) => unknown>;
  for (const [method, column, value] of filters) {
    if (typeof query[method] === 'function') query = query[method](column, value) as typeof query;
  }
  if (typeof query.order === 'function') {
    for (const column of orderColumns) query = query.order(column, { ascending: true }) as typeof query;
  }
  return query as unknown as QueryLike;
}

export async function loadPublicStatMetricRows(
  client: ClientLike,
  scope: MetricScope,
  options: { pageSize?: number; tables?: SourceName[] } = {},
): Promise<PublicStatMetricRows> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new PublicMetricDataError('invalid page size');
  const selected = new Set<SourceName>(options.tables ?? ['games', 'teams', 'rosters', 'checkins', 'acceptedSubs', 'playerStats', 'goalieStats', 'goalieAppearances']);
  const playerFilter = scope.playerId ? [['eq', 'player_id', scope.playerId] as ['eq', string, unknown]] : [];
  const tableConfig: Record<Exclude<SourceName, 'profiles'>, { table: string; columns: string; filters: Array<['eq' | 'in', string, unknown]>; orderColumns?: string[] }> = {
    games: { table: 'games', columns: 'id, league_id, season_id, status, home_team_id, away_team_id, home_score, away_score, scheduled_at, penalty_capture_status, goalie_capture_status, skater_capture_status', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'status', 'completed']] },
    teams: { table: 'teams', columns: 'id, league_id, season_id, division_id, name', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ...(scope.divisionId ? [['eq', 'division_id', scope.divisionId] as ['eq', string, unknown]] : []), ...(scope.teamId ? [['eq', 'id', scope.teamId] as ['eq', string, unknown]] : [])] },
    rosters: { table: 'team_rosters', columns: 'id, player_id, team_id, league_id, season_id, start_date, end_date, is_goalie, position, status, player_type, games_played_override', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ...playerFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    checkins: { table: 'game_checkins', columns: 'id, game_id, player_id, team_id, status, game:games!inner(id)', filters: [['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    acceptedSubs: { table: 'sub_invitations', columns: 'id, game_id, invited_player_id, team_id, status, game:games!inner(id)', filters: [['eq', 'status', 'accepted'], ['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...(scope.playerId ? [['eq', 'invited_player_id', scope.playerId] as ['eq', string, unknown]] : []), ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    playerStats: { table: 'player_stats', columns: 'id, game_id, player_id, team_id, league_id, season_id, goals, assists, penalty_minutes, scorekeeping_provenance, game:games!inner(id)', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    goalieStats: { table: 'goalie_stats', columns: 'id, game_id, player_id, team_id, league_id, season_id, game_result, saves, shots_against, goals_against, shutout, scorekeeping_provenance, game:games!inner(id)', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    goalieAppearances: { table: 'game_goalie_appearances', columns: 'game_id, player_id, team_id, team_type, game:games!inner(id)', filters: [['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])], orderColumns: ['game_id', 'player_id'] },
  };
  const output: PublicStatMetricRows = { games: [], teams: [], profiles: [], rosters: [], checkins: [], acceptedSubs: [], playerStats: [], goalieStats: [], goalieAppearances: [] };
  for (const name of Object.keys(tableConfig) as Array<Exclude<SourceName, 'profiles'>>) {
    if (!selected.has(name)) continue;
    const config = tableConfig[name];
    output[name] = await readPages(
      () => applyFilters(client.from(config.table).select(config.columns, { count: 'exact' }), config.filters, config.orderColumns),
      name,
      pageSize,
    ) as never;
  }
  const playerIds = [...new Set([
    ...output.rosters.map((row) => row.player_id), ...output.checkins.map((row) => row.player_id),
    ...output.acceptedSubs.map((row) => row.invited_player_id), ...output.playerStats.map((row) => row.player_id),
    ...output.goalieStats.map((row) => row.player_id), ...output.goalieAppearances.map((row) => row.player_id),
  ])];
  if (selected.has('profiles') && (options.tables || playerIds.length === 0)) {
    output.profiles = await readPages(
      () => applyFilters(client.from('profiles').select('id, full_name, avatar_url, photo_url', { count: 'exact' }), playerIds.length ? [['in', 'id', playerIds]] : []),
      'profiles', pageSize,
    ) as PublicMetricProfileRow[];
  } else if (!options.tables && playerIds.length) {
    const profileBatchSize = 200;
    for (let offset = 0; offset < playerIds.length; offset += profileBatchSize) {
      const batch = playerIds.slice(offset, offset + profileBatchSize);
      output.profiles.push(...await readPages(
        () => applyFilters(client.from('profiles').select('id, full_name, avatar_url, photo_url', { count: 'exact' }), [['in', 'id', batch]]),
        'profiles', pageSize,
      ) as PublicMetricProfileRow[]);
    }
  }
  return output;
}

export async function readPublicStatMetricRows(scope: MetricScope): Promise<PublicStatMetricRows> {
  assertRequiredPrivilegedMetricConfig();
  return loadPublicStatMetricRows(createServiceRoleClient() as unknown as ClientLike, scope);
}

export function assertRequiredPrivilegedMetricConfig(): void {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL
    && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY));
  if (!configured) throw new PublicMetricDataError('privileged metric source is not configured');
}

type PublicLeague = { id: string; slug: string; status: string; custom_domain?: string | null; custom_domain_verified?: boolean | null };
type PublicSeason = { id: string; league_id: string; name: string; status: string | null };
type PublicDivision = { id: string; league_id: string };
type PublicTeam = { id: string; league_id: string; season_id?: string | null; division_id: string | null; name: string };
export interface PublicStatMetricsDependencies {
  getLeagueBySlug(slug: string): Promise<PublicLeague | null>;
  hasPlatformSubscription(leagueId: string): Promise<boolean>;
  readSeason(leagueId: string, seasonId: string): Promise<PublicSeason | null>;
  getDivisions(leagueId: string): Promise<PublicDivision[]>;
  readTeam(leagueId: string, seasonId: string, teamId: string): Promise<PublicTeam | null>;
  requirePrivilegedAccess(): void;
  loadRows(scope: MetricScope): Promise<PublicStatMetricRows>;
}

export async function readMetricSeason(leagueId: string, seasonId: string): Promise<PublicSeason | null> {
  const client = await createClient();
  const result = await client.from('seasons').select('id, league_id, name, status').eq('league_id', leagueId).eq('id', seasonId).maybeSingle();
  if (result.error) throw new PublicMetricDataError('season source read failed');
  return result.data as PublicSeason | null;
}

export async function readMetricTeam(leagueId: string, seasonId: string, teamId: string): Promise<PublicTeam | null> {
  const client = await createClient();
  const result = await client.from('teams').select('id, league_id, season_id, division_id, name').eq('league_id', leagueId).eq('season_id', seasonId).eq('id', teamId).maybeSingle();
  if (result.error) throw new PublicMetricDataError('team source read failed');
  return result.data as PublicTeam | null;
}

const defaultDependencies: PublicStatMetricsDependencies = {
  getLeagueBySlug,
  hasPlatformSubscription,
  readSeason: readMetricSeason,
  getDivisions,
  readTeam: readMetricTeam,
  requirePrivilegedAccess: assertRequiredPrivilegedMetricConfig,
  loadRows: readPublicStatMetricRows,
};

function error(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...details } }, { status, headers: { 'Cache-Control': ERROR_CACHE, 'X-Content-Type-Options': 'nosniff' } });
}

function success(payload: unknown) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_RESPONSE_BYTES) throw new PublicMetricLimitError('response limit exceeded');
  return NextResponse.json(payload, { headers: { 'Cache-Control': SUCCESS_CACHE, 'X-Content-Type-Options': 'nosniff' } });
}

function exactQuery(request: NextRequest, allowed: string[]): NextResponse | null {
  for (const key of request.nextUrl.searchParams.keys()) if (!allowed.includes(key)) return error(400, 'INVALID_QUERY', `Unknown query parameter ${key}.`);
  for (const key of allowed) if (request.nextUrl.searchParams.getAll(key).length > 1) return error(400, 'INVALID_QUERY', `Query parameter ${key} must appear once.`);
  return null;
}

type MetricTenantHost = { kind: 'slug'; slug: string } | { kind: 'custom'; hostname: string } | { kind: 'unbound' };

function metricTenantHost(request: NextRequest): MetricTenantHost {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === 'beerleaguehockey.ca') return { kind: 'unbound' };
  if (host.endsWith('.beerleaguehockey.ca')) {
    const candidate = host.slice(0, -'.beerleaguehockey.ca'.length).replace(/\.sites$/, '');
    const reserved = new Set(['www', 'app', 'api', 'admin', 'dashboard', 'builder', 'auth', 'cdn', 'static', 'assets']);
    return candidate && !candidate.includes('.') && !reserved.has(candidate) ? { kind: 'slug', slug: candidate } : { kind: 'unbound' };
  }
  return { kind: 'custom', hostname: host.replace(/^www\./, '') };
}

export async function handlePublicSeasonStatsRequest(
  request: NextRequest,
  deps: PublicStatMetricsDependencies = defaultDependencies,
): Promise<NextResponse> {
  if (request.method !== 'GET') {
    const response = error(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const queryError = exactQuery(request, ['leagueSlug', 'seasonId', 'divisionId', 'teamId', 'contractVersion']);
  if (queryError) return queryError;
  const slug = request.nextUrl.searchParams.get('leagueSlug');
  const seasonId = request.nextUrl.searchParams.get('seasonId');
  const divisionId = request.nextUrl.searchParams.get('divisionId');
  const teamId = request.nextUrl.searchParams.get('teamId');
  const version = request.nextUrl.searchParams.get('contractVersion');
  if (!slug || slug.length > 63 || !SLUG.test(slug)) return error(400, 'INVALID_LEAGUE_SLUG', 'leagueSlug must be a lowercase ASCII host slug.');
  if (!seasonId || !UUID.test(seasonId)) return error(400, 'INVALID_SEASON_ID', 'seasonId must be a UUID.');
  if (divisionId !== null && !UUID.test(divisionId)) return error(400, 'INVALID_DIVISION_ID', 'divisionId must be a UUID.');
  if (teamId !== null && !UUID.test(teamId)) return error(400, 'INVALID_TEAM_ID', 'teamId must be a UUID.');
  if (version !== '2') return error(400, 'UNSUPPORTED_CONTRACT_VERSION', 'contractVersion=2 is required.');
  const tenantHost = metricTenantHost(request);
  if (tenantHost.kind === 'slug' && tenantHost.slug !== slug) return error(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
  try {
    deps.requirePrivilegedAccess();
    const league = await deps.getLeagueBySlug(slug);
    if (!league || league.status !== 'active' || !(await deps.hasPlatformSubscription(league.id))) return error(404, 'LEAGUE_NOT_FOUND', 'League not found.');
    if (tenantHost.kind === 'custom') {
      const verifiedDomain = league.custom_domain_verified
        ? league.custom_domain?.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '') ?? null
        : null;
      if (verifiedDomain !== tenantHost.hostname) return error(400, 'TENANT_MISMATCH', 'leagueSlug does not match the tenant host.');
    }
    const [season, divisions] = await Promise.all([deps.readSeason(league.id, seasonId), deps.getDivisions(league.id)]);
    if (!season || season.league_id !== league.id) return error(409, 'SEASON_MISMATCH', 'The requested season does not belong to this league.', { presentationSeasonId: null });
    if (divisionId && !divisions.some((division) => division.id === divisionId && division.league_id === league.id)) {
      return error(400, 'DIVISION_NOT_IN_LEAGUE', 'divisionId does not belong to this league.');
    }
    if (teamId) {
      const team = await deps.readTeam(league.id, season.id, teamId);
      if (!team || team.league_id !== league.id || (divisionId && team.division_id !== divisionId)) {
        return error(400, 'TEAM_NOT_IN_SCOPE', 'teamId does not belong to this league, season, and division.');
      }
    }
    const scope = { leagueId: league.id, seasonId: season.id, divisionId, teamId };
    const aggregate = aggregatePublicSeasonStats(await deps.loadRows(scope), scope);
    return success({
      schemaVersion: 2,
      leagueId: league.id,
      leagueSlug: league.slug,
      presentationSeason: { id: season.id, name: season.name, league_id: season.league_id, status: season.status ?? null },
      divisionId,
      ...aggregate,
    });
  } catch (caught) {
    console.error('[public-season-stats] public read failed', { leagueSlug: slug, errorType: caught instanceof Error ? caught.name : 'unknown' });
    return error(503, caught instanceof PublicMetricLimitError ? 'PAYLOAD_LIMIT_EXCEEDED' : 'SEASON_STATS_UNAVAILABLE', 'Season statistics are temporarily unavailable.');
  }
}
