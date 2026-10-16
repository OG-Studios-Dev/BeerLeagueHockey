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
type GoalieResolution = {
  playerId: string;
  gameId: string;
  teamId: string;
  goalsAgainst: number | null;
  state: 'recorded' | 'reported' | 'conflicted';
  sources: PublicMetricSource[];
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

export class PublicMetricDataError extends Error {}
export class PublicMetricLimitError extends Error {}

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
  if (!appearance.out && appearance.roster) return 'reported';
  if (!appearance.out && appearance.acceptedSub) return 'reported';
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
  const metricSources = sources(appearances.flatMap(appearanceSources));
  if (classified.length === 0) {
    return appearances.some((appearance) => appearance.out && (appearance.roster || appearance.acceptedSub))
      ? known(0, 'reported', metricSources)
      : unknown(metricSources);
  }
  const state = combineState(classified.map((entry) => entry.state));
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
  if (rows.teams.some((team) => team.league_id !== scope.leagueId
    || (team.season_id !== undefined && team.season_id !== null && team.season_id !== scope.seasonId))) {
    throw new PublicMetricDataError('cross-scope team row');
  }
  if (rows.rosters.some((roster) => roster.league_id !== scope.leagueId || roster.season_id !== scope.seasonId)) {
    throw new PublicMetricDataError('cross-scope roster row');
  }
  const teamIds = new Set(rows.teams.map((team) => team.id));
  if (rows.rosters.some((roster) => !teamIds.has(roster.team_id))) {
    throw new PublicMetricDataError('roster references missing team');
  }
  const gamesById = new Map(rows.games.map((game) => [game.id, game]));
  const validateGameTeams = (
    collection: Array<{ game_id: string; team_id: string }>,
    label: string,
  ) => {
    for (const row of collection) {
      const game = gamesById.get(row.game_id);
      if (!game) throw new PublicMetricDataError(`${label} references missing game`);
      if (row.team_id !== game.home_team_id && row.team_id !== game.away_team_id) {
        throw new PublicMetricDataError(`${label} team is not in game`);
      }
    }
  };
  validateGameTeams(rows.checkins, 'checkin');
  validateGameTeams(rows.acceptedSubs, 'accepted substitute');
  validateGameTeams(rows.playerStats, 'player stat');
  validateGameTeams(rows.goalieStats, 'goalie stat');
  validateGameTeams(rows.goalieAppearances, 'goalie appearance');
  for (const row of [...rows.playerStats, ...rows.goalieStats]) {
    if (row.league_id !== scope.leagueId || row.season_id !== scope.seasonId) throw new PublicMetricDataError('cross-scope stat row');
  }
  const appearanceKeys = new Set<string>();
  for (const row of rows.goalieAppearances) {
    const key = `${row.game_id}\u0000${row.player_id}\u0000${row.team_id}`;
    if (![row.game_id, row.player_id, row.team_id].every((id) => UUID.test(id)) || appearanceKeys.has(key)) {
      throw new PublicMetricDataError('invalid goalie appearance row');
    }
    const game = gamesById.get(row.game_id)!;
    const expectedTeam = row.team_type === 'home' ? game.home_team_id : game.away_team_id;
    if (row.team_id !== expectedTeam) throw new PublicMetricDataError('goalie assignment team conflict');
    appearanceKeys.add(key);
  }
}

export function aggregatePublicSeasonStats(rows: PublicStatMetricRows, scope: MetricScope): PublicSeasonMetricPayload {
  validateInputRows(rows, scope);
  const permittedTeams = new Map<string, PublicMetricTeamRow>();
  for (const team of rows.teams) {
    if (team.league_id !== scope.leagueId) continue;
    if (scope.divisionId && team.division_id !== scope.divisionId) continue;
    if (scope.teamId && team.id !== scope.teamId) continue;
    permittedTeams.set(team.id, team);
  }
  const teamAllowed = (teamId: string) => permittedTeams.has(teamId) && (!scope.teamId || teamId === scope.teamId);
  const addToIndex = <K, V>(index: Map<K, V[]>, key: K, value: V) => {
    const existing = index.get(key);
    if (existing) existing.push(value);
    else index.set(key, [value]);
  };
  const appearanceKey = (playerId: string, gameId: string, teamId: string) =>
    `${playerId}\u0000${gameId}\u0000${teamId}`;
  const gameTeamKey = (gameId: string, teamId: string) => `${gameId}\u0000${teamId}`;

  const games = new Map<string, PublicMetricGameRow>();
  const completedGamesByTeam = new Map<string, PublicMetricGameRow[]>();
  for (const game of rows.games) {
    if (game.status !== 'completed') continue;
    if (!permittedTeams.has(game.home_team_id) && !permittedTeams.has(game.away_team_id)) continue;
    games.set(game.id, game);
    for (const teamId of new Set([game.home_team_id, game.away_team_id])) {
      addToIndex(completedGamesByTeam, teamId, game);
    }
  }

  const appearanceMap = new Map<string, Appearance>();
  const getAppearance = (playerId: string, gameId: string, teamId: string) => {
    const key = appearanceKey(playerId, gameId, teamId);
    let appearance = appearanceMap.get(key);
    if (!appearance) {
      appearance = { playerId, gameId, teamIds: new Set(), confirmed: false, out: false, skater: false, goalie: false, goalieAssigned: false, roster: false, acceptedSub: false };
      appearanceMap.set(key, appearance);
    }
    appearance.teamIds.add(teamId);
    return appearance;
  };

  const rostersByPlayer = new Map<string, PublicMetricRosterRow[]>();
  const goalieRosterRowsByTeam = new Map<string, PublicMetricRosterRow[]>();
  for (const roster of rows.rosters) {
    const activeRegular = (roster.status === undefined || roster.status === 'active')
      && (roster.player_type === undefined || roster.player_type === 'regular');
    if (teamAllowed(roster.team_id) && activeRegular) {
      addToIndex(rostersByPlayer, roster.player_id, roster);
    }
    if (roster.league_id !== scope.leagueId || roster.season_id !== scope.seasonId || !teamAllowed(roster.team_id)) continue;
    if (activeRegular && isGoalieRole(roster)) addToIndex(goalieRosterRowsByTeam, roster.team_id, roster);
    for (const game of completedGamesByTeam.get(roster.team_id) ?? []) {
      if (!rosterEligible(roster, game)) continue;
      getAppearance(roster.player_id, game.id, roster.team_id).roster = true;
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

  const playerStatsByPlayer = new Map<string, PublicMetricPlayerStatRow[]>();
  for (const stat of rows.playerStats) {
    if (!games.has(stat.game_id) || !teamAllowed(stat.team_id)) continue;
    addToIndex(playerStatsByPlayer, stat.player_id, stat);
    getAppearance(stat.player_id, stat.game_id, stat.team_id).skater = true;
  }
  const goalieStatsByPlayer = new Map<string, PublicMetricGoalieStatRow[]>();
  const directGoalieStatsByAppearance = new Map<string, PublicMetricGoalieStatRow[]>();
  for (const stat of rows.goalieStats) {
    if (!games.has(stat.game_id) || !teamAllowed(stat.team_id)) continue;
    addToIndex(goalieStatsByPlayer, stat.player_id, stat);
    addToIndex(directGoalieStatsByAppearance, appearanceKey(stat.player_id, stat.game_id, stat.team_id), stat);
    getAppearance(stat.player_id, stat.game_id, stat.team_id).goalie = true;
  }
  const goalieAssignmentsByPlayer = new Map<string, PublicMetricGoalieAppearanceRow[]>();
  const goalieAssignmentsByGameTeam = new Map<string, PublicMetricGoalieAppearanceRow[]>();
  for (const assignment of rows.goalieAppearances) {
    if (!games.has(assignment.game_id) || !teamAllowed(assignment.team_id)) continue;
    addToIndex(goalieAssignmentsByPlayer, assignment.player_id, assignment);
    addToIndex(goalieAssignmentsByGameTeam, gameTeamKey(assignment.game_id, assignment.team_id), assignment);
    getAppearance(assignment.player_id, assignment.game_id, assignment.team_id).goalieAssigned = true;
  }

  const goalieResolutionsByPlayer = new Map<string, GoalieResolution[]>();
  const goalieIncompleteSourcesByPlayer = new Map<string, Set<PublicMetricSource>>();
  const goaliePolicySourcesByPlayer = new Map<string, Set<PublicMetricSource>>();
  const addGoalieSources = (
    index: Map<string, Set<PublicMetricSource>>,
    playerId: string,
    metricSources: PublicMetricSource[],
  ) => {
    let current = index.get(playerId);
    if (!current) {
      current = new Set<PublicMetricSource>();
      index.set(playerId, current);
    }
    for (const source of metricSources) current.add(source);
  };
  const addPolicySources = (playerId: string, metricSources: PublicMetricSource[]) => {
    addGoalieSources(goaliePolicySourcesByPlayer, playerId, metricSources);
  };
  const markGoalieIncomplete = (playerId: string, metricSources: PublicMetricSource[]) => {
    addGoalieSources(goalieIncompleteSourcesByPlayer, playerId, metricSources);
  };
  const addGoalieResolution = (resolution: GoalieResolution) => {
    addToIndex(goalieResolutionsByPlayer, resolution.playerId, resolution);
    addPolicySources(resolution.playerId, resolution.sources);
  };
  for (const game of games.values()) {
    for (const teamId of new Set([game.home_team_id, game.away_team_id])) {
      if (!teamAllowed(teamId)) continue;
      const rosterGoalieIds = [...new Set((goalieRosterRowsByTeam.get(teamId) ?? [])
        .filter((row) => rosterEligible(row, game))
        .map((row) => row.player_id))];
      const assignments = goalieAssignmentsByGameTeam.get(gameTeamKey(game.id, teamId)) ?? [];
      for (const playerId of rosterGoalieIds) {
        addPolicySources(playerId, assignments.length ? ['roster_window', 'goalie_assignment'] : ['roster_window']);
      }
      if (assignments.length === 1) {
        const assignment = assignments[0];
        const appearance = appearanceMap.get(appearanceKey(assignment.player_id, game.id, teamId));
        const conflicted = Boolean(appearance?.out);
        addGoalieResolution({
          playerId: assignment.player_id,
          gameId: game.id,
          teamId,
          goalsAgainst: teamId === game.home_team_id ? game.away_score : game.home_score,
          state: conflicted ? 'conflicted' : 'recorded',
          sources: sources(['goalie_assignment', ...(conflicted ? ['attendance' as const] : [])]),
        });
        for (const playerId of rosterGoalieIds) {
          if (playerId === assignment.player_id) continue;
          const suppressedAppearance = appearanceMap.get(appearanceKey(playerId, game.id, teamId));
          const suppressionSources = sources([
            'roster_window',
            'goalie_assignment',
            ...(suppressedAppearance?.out ? ['attendance' as const] : []),
          ]);
          markGoalieIncomplete(playerId, suppressionSources);
          if (!suppressedAppearance?.out
            || !directGoalieStatsByAppearance.has(appearanceKey(playerId, game.id, teamId))) continue;
          addGoalieResolution({
            playerId,
            gameId: game.id,
            teamId,
            goalsAgainst: teamId === game.home_team_id ? game.away_score : game.home_score,
            state: 'conflicted',
            sources: ['attendance', 'goalie_stats', 'roster_window'],
          });
        }
        continue;
      }
      if (assignments.length > 1) {
        for (const playerId of new Set(assignments.map((row) => row.player_id))) {
          const appearance = appearanceMap.get(appearanceKey(playerId, game.id, teamId));
          markGoalieIncomplete(playerId, sources(['goalie_assignment', ...(appearance?.out ? ['attendance' as const] : [])]));
        }
        for (const playerId of rosterGoalieIds) markGoalieIncomplete(playerId, ['roster_window', 'goalie_assignment']);
        continue;
      }
      const eligibleGoalieIds = rosterGoalieIds.filter((playerId) =>
        !appearanceMap.get(appearanceKey(playerId, game.id, teamId))?.out);
      const directOutGoalieIds = new Set(rosterGoalieIds.filter((playerId) => {
        const appearance = appearanceMap.get(appearanceKey(playerId, game.id, teamId));
        return Boolean(appearance?.out
          && directGoalieStatsByAppearance.has(appearanceKey(playerId, game.id, teamId)));
      }));
      for (const playerId of directOutGoalieIds) {
        addGoalieResolution({
          playerId,
          gameId: game.id,
          teamId,
          goalsAgainst: teamId === game.home_team_id ? game.away_score : game.home_score,
          state: 'conflicted',
          sources: ['attendance', 'goalie_stats', 'roster_window'],
        });
      }
      if (eligibleGoalieIds.length === 1) {
        addGoalieResolution({
          playerId: eligibleGoalieIds[0],
          gameId: game.id,
          teamId,
          goalsAgainst: teamId === game.home_team_id ? game.away_score : game.home_score,
          state: 'reported',
          sources: ['roster_window'],
        });
        continue;
      }
      for (const playerId of rosterGoalieIds) {
        if (directOutGoalieIds.has(playerId)) continue;
        const appearance = appearanceMap.get(appearanceKey(playerId, game.id, teamId));
        markGoalieIncomplete(playerId, sources(['roster_window', ...(appearance?.out ? ['attendance' as const] : [])]));
      }
    }
  }

  const appearancesByPlayer = new Map<string, Appearance[]>();
  for (const appearance of appearanceMap.values()) {
    if (appearanceState(appearance) === null && !(appearance.out && (appearance.roster || appearance.acceptedSub))) continue;
    addToIndex(appearancesByPlayer, appearance.playerId, appearance);
  }
  const profileMap = new Map<string, PublicMetricProfileRow>();
  for (const profile of rows.profiles) profileMap.set(profile.id, profile);
  const overridePlayerIds = [...rostersByPlayer.entries()]
    .filter(([, rosterRows]) => rosterOverrideMetric(rosterRows) !== null)
    .map(([playerId]) => playerId);
  const playerIds = [...new Set([...appearancesByPlayer.keys(), ...overridePlayerIds])]
    .filter((playerId) => !scope.playerId || playerId === scope.playerId);

  const players = playerIds.map((playerId): PublicSeasonMetricPlayer => {
    const appearances = appearancesByPlayer.get(playerId) ?? [];
    const skaterRows = playerStatsByPlayer.get(playerId) ?? [];
    const goalieRows = goalieStatsByPlayer.get(playerId) ?? [];
    const rosterRows = rostersByPlayer.get(playerId) ?? [];
    const skaterRole = skaterRows.length > 0 || rosterRows.some((row) => !isGoalieRole(row));
    const assignedRows = goalieAssignmentsByPlayer.get(playerId) ?? [];
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
    const participationGamesPlayed = participationMetric(appearances);
    const overrideGamesPlayed = rosterOverrideMetric(rosterRows);
    const gamesPlayed = participationGamesPlayed.state === 'conflicted'
      ? participationGamesPlayed
      : overrideGamesPlayed ?? participationGamesPlayed;

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
      const goalieResolutions = goalieResolutionsByPlayer.get(playerId) ?? [];
      const incompleteGoalieSources = sources(goalieIncompleteSourcesByPlayer.get(playerId) ?? []);
      const goaliePolicySources = sources(goaliePolicySourcesByPlayer.get(playerId) ?? []);
      const resolutionByKey = new Map(goalieResolutions.map((resolution) => [
        `${resolution.gameId}\u0000${resolution.teamId}`,
        resolution,
      ]));
      const directGoalieRowKeys = goalieRows.map((row) => `${row.game_id}\u0000${row.team_id}`);
      const duplicateGoalieRows = new Set(directGoalieRowKeys).size !== directGoalieRowKeys.length;
      const unresolvedGoalieRows = goalieRows.some((row) =>
        !resolutionByKey.has(`${row.game_id}\u0000${row.team_id}`));
      const captureConflict = goalieRows.some((row) => row.scorekeeping_provenance === 'event_derived'
        && games.get(row.game_id)?.goalie_capture_status === 'complete'
        && !resolutionByKey.has(`${row.game_id}\u0000${row.team_id}`));
      const rowCaptured = (row: PublicMetricGoalieStatRow) => row.scorekeeping_provenance === 'event_derived'
        && games.get(row.game_id)?.goalie_capture_status === 'complete'
        && resolutionByKey.has(`${row.game_id}\u0000${row.team_id}`);
      const resolvedGoalieSources = sources(goalieResolutions.flatMap((resolution) => resolution.sources));
      const goalieIdentitySources = sources([
        ...resolvedGoalieSources,
        ...incompleteGoalieSources,
        ...goaliePolicySources,
        ...(goalieRows.length ? ['goalie_stats' as const] : []),
      ]);
      const goalieConflict = goalieResolutions.some((resolution) => resolution.state === 'conflicted');
      const goalieField = (values: Array<number | null | undefined>, label: string): PublicStatMetric => {
        const fieldSources: PublicMetricSource[] = goalieRows.length ? ['goalie_stats'] : [];
        const captured = goalieRows.length > 0 && goalieRows.every(rowCaptured);
        if (captured) {
          fieldSources.push(
            ...goalieRows.flatMap((row) => resolutionByKey.get(`${row.game_id}\u0000${row.team_id}`)?.sources ?? []),
            'capture_confirmation',
          );
        }
        if (captureConflict) {
          return {
            value: null,
            state: 'conflicted',
            sources: sources([...fieldSources, ...goaliePolicySources, 'capture_confirmation']),
          };
        }
        if (duplicateGoalieRows) {
          return { value: null, state: 'conflicted', sources: sources([...fieldSources, ...goalieIdentitySources]) };
        }
        if (goalieConflict) {
          return { value: null, state: 'conflicted', sources: sources([...fieldSources, ...goalieIdentitySources]) };
        }
        if (unresolvedGoalieRows) {
          return unknown(sources([...fieldSources, ...incompleteGoalieSources, ...goaliePolicySources]));
        }
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
      const saves = unknown();
      const shutouts = goalieField(goalieRows.map((row) => row.shutout === null ? null : Number(row.shutout)), 'shutouts');
      let gp: PublicStatMetric;
      if (goalieConflict) {
        gp = { value: null, state: 'conflicted', sources: goalieIdentitySources };
      } else if (incompleteGoalieSources.length > 0) {
        gp = unknown(goalieIdentitySources);
      } else if (goalieResolutions.length > 0) {
        gp = known(
          goalieResolutions.length,
          combineState(goalieResolutions.map((resolution) => resolution.state)),
          resolvedGoalieSources,
        );
      } else if (goaliePolicySources.length > 0) {
        gp = known(0, 'reported', goaliePolicySources);
      } else {
        gp = unknown();
      }
      const assignedOnly = incompleteGoalieSources.length === 0
        && goalieResolutions.length > 0
        && goalieResolutions.every((resolution) => resolution.state === 'recorded'
          && resolution.sources.includes('goalie_assignment')
          && games.get(resolution.gameId)?.goalie_capture_status === 'complete');
      if (assignedOnly) {
        gp = known(goalieResolutions.length, 'verified', ['goalie_assignment', 'capture_confirmation']);
      }
      let goalsAgainst: PublicStatMetric;
      if (goalieConflict) {
        goalsAgainst = { value: null, state: 'conflicted', sources: goalieIdentitySources };
      } else if (incompleteGoalieSources.length > 0) {
        goalsAgainst = unknown(goalieIdentitySources);
      } else if (goalieResolutions.some((resolution) => resolution.goalsAgainst === null)) {
        goalsAgainst = unknown(resolvedGoalieSources);
      } else if (goalieResolutions.length > 0) {
        goalsAgainst = known(
          goalieResolutions.reduce(
            (sum, resolution) => sum + finite(resolution.goalsAgainst, 'final score goals against'),
            0,
          ),
          combineState(goalieResolutions.map((resolution) => resolution.state)),
          resolvedGoalieSources,
        );
      } else if (goaliePolicySources.length > 0) {
        goalsAgainst = known(0, 'reported', goaliePolicySources);
      } else {
        goalsAgainst = unknown();
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
        savePercentage: unknown(),
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
        gamesPlayed,
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

async function readPages(
  build: () => QueryLike,
  label: string,
  pageSize: number,
  maxRows = MAX_SOURCE_ROWS,
): Promise<unknown[]> {
  if (maxRows < 1) throw new PublicMetricLimitError('metric source total row limit exceeded');
  const first = await build().range(0, Math.min(pageSize, maxRows) - 1);
  if (first.error) throw new PublicMetricDataError(`${label} source read failed`);
  if (!Number.isSafeInteger(first.count) || (first.count ?? -1) < 0) throw new PublicMetricDataError(`${label} source count missing`);
  const count = first.count as number;
  if (count > MAX_SOURCE_ROWS || count > maxRows) {
    throw new PublicMetricLimitError(count > MAX_SOURCE_ROWS
      ? `${label} source row limit exceeded`
      : 'metric source total row limit exceeded');
  }
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
  options: { pageSize?: number; tables?: SourceName[]; maxTotalRows?: number } = {},
): Promise<PublicStatMetricRows> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new PublicMetricDataError('invalid page size');
  if (options.maxTotalRows !== undefined
    && (!Number.isSafeInteger(options.maxTotalRows) || options.maxTotalRows < 1 || options.maxTotalRows > MAX_SOURCE_ROWS)) {
    throw new PublicMetricDataError('invalid total row limit');
  }
  const maxTotalRows = options.maxTotalRows;
  const selected = new Set<SourceName>(options.tables ?? ['games', 'teams', 'rosters', 'checkins', 'acceptedSubs', 'playerStats', 'goalieStats', 'goalieAppearances']);
  const playerStatFilter = scope.playerId ? [['eq', 'player_id', scope.playerId] as ['eq', string, unknown]] : [];
  const tableConfig: Record<Exclude<SourceName, 'profiles'>, { table: string; columns: string; filters: Array<['eq' | 'in', string, unknown]>; orderColumns?: string[] }> = {
    games: { table: 'games', columns: 'id, league_id, season_id, status, home_team_id, away_team_id, home_score, away_score, scheduled_at, penalty_capture_status, goalie_capture_status, skater_capture_status', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'status', 'completed']] },
    teams: { table: 'teams', columns: 'id, league_id, division_id, name', filters: [['eq', 'league_id', scope.leagueId], ...(scope.divisionId ? [['eq', 'division_id', scope.divisionId] as ['eq', string, unknown]] : []), ...(scope.teamId ? [['eq', 'id', scope.teamId] as ['eq', string, unknown]] : [])] },
    rosters: { table: 'team_rosters', columns: 'id, player_id, team_id, league_id, season_id, start_date, end_date, is_goalie, position, status, player_type, games_played_override', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    checkins: { table: 'game_checkins', columns: 'id, game_id, player_id, team_id, status, game:games!inner(id)', filters: [['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    acceptedSubs: { table: 'sub_invitations', columns: 'id, game_id, invited_player_id, team_id, status, game:games!inner(id)', filters: [['eq', 'status', 'accepted'], ['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...(scope.playerId ? [['eq', 'invited_player_id', scope.playerId] as ['eq', string, unknown]] : []), ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    playerStats: { table: 'player_stats', columns: 'id, game_id, player_id, team_id, league_id, season_id, goals, assists, penalty_minutes, scorekeeping_provenance, game:games!inner(id)', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerStatFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    goalieStats: { table: 'goalie_stats', columns: 'id, game_id, player_id, team_id, league_id, season_id, game_result, saves, shots_against, goals_against, shutout, scorekeeping_provenance, game:games!inner(id)', filters: [['eq', 'league_id', scope.leagueId], ['eq', 'season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...playerStatFilter, ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])] },
    goalieAppearances: { table: 'game_goalie_appearances', columns: 'game_id, player_id, team_id, team_type, game:games!inner(id)', filters: [['eq', 'game.league_id', scope.leagueId], ['eq', 'game.season_id', scope.seasonId], ['eq', 'game.status', 'completed'], ...(scope.teamId ? [['eq', 'team_id', scope.teamId] as ['eq', string, unknown]] : [])], orderColumns: ['game_id', 'player_id'] },
  };
  const output: PublicStatMetricRows = { games: [], teams: [], profiles: [], rosters: [], checkins: [], acceptedSubs: [], playerStats: [], goalieStats: [], goalieAppearances: [] };
  let totalRows = 0;
  const addRows = (count: number) => {
    totalRows += count;
    if (maxTotalRows !== undefined && totalRows > maxTotalRows) {
      throw new PublicMetricLimitError('metric source total row limit exceeded');
    }
  };
  const remainingRows = () => maxTotalRows === undefined ? MAX_SOURCE_ROWS : maxTotalRows - totalRows;
  for (const name of Object.keys(tableConfig) as Array<Exclude<SourceName, 'profiles'>>) {
    if (!selected.has(name)) continue;
    const config = tableConfig[name];
    const divisionRosterTeamIds = name === 'rosters' && scope.divisionId && !scope.teamId && selected.has('teams')
      ? output.teams.map((team) => team.id)
      : null;
    if (divisionRosterTeamIds?.length === 0) continue;
    const filters = divisionRosterTeamIds
      ? [...config.filters, ['in', 'team_id', divisionRosterTeamIds] as ['in', string, unknown]]
      : config.filters;
    const loaded = await readPages(
      () => applyFilters(client.from(config.table).select(config.columns, { count: 'exact' }), filters, config.orderColumns),
      name,
      pageSize,
      Math.min(MAX_SOURCE_ROWS, remainingRows()),
    );
    output[name] = loaded as never;
    addRows(loaded.length);
  }
  const contextualPlayerIds = [...new Set([
    ...output.rosters.map((row) => row.player_id), ...output.checkins.map((row) => row.player_id),
    ...output.acceptedSubs.map((row) => row.invited_player_id), ...output.playerStats.map((row) => row.player_id),
    ...output.goalieStats.map((row) => row.player_id), ...output.goalieAppearances.map((row) => row.player_id),
  ])];
  const playerIds = scope.playerId ? [scope.playerId] : contextualPlayerIds;
  if (selected.has('profiles') && (options.tables || playerIds.length === 0)) {
    output.profiles = await readPages(
      () => applyFilters(client.from('profiles').select('id, full_name, avatar_url, photo_url', { count: 'exact' }), playerIds.length ? [['in', 'id', playerIds]] : []),
      'profiles', pageSize,
      Math.min(MAX_SOURCE_ROWS, remainingRows()),
    ) as PublicMetricProfileRow[];
    addRows(output.profiles.length);
  } else if (!options.tables && playerIds.length) {
    const profileBatchSize = 200;
    for (let offset = 0; offset < playerIds.length; offset += profileBatchSize) {
      const batch = playerIds.slice(offset, offset + profileBatchSize);
      const profiles = await readPages(
        () => applyFilters(client.from('profiles').select('id, full_name, avatar_url, photo_url', { count: 'exact' }), [['in', 'id', batch]]),
        'profiles', pageSize,
        Math.min(MAX_SOURCE_ROWS, remainingRows()),
      ) as PublicMetricProfileRow[];
      addRows(profiles.length);
      output.profiles.push(...profiles);
    }
  }
  return output;
}

export async function readPublicStatMetricRows(
  scope: MetricScope,
  options: { maxTotalRows?: number } = {},
): Promise<PublicStatMetricRows> {
  assertRequiredPrivilegedMetricConfig();
  return loadPublicStatMetricRows(createServiceRoleClient() as unknown as ClientLike, scope, options);
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

export async function readMetricTeam(leagueId: string, _seasonId: string, teamId: string): Promise<PublicTeam | null> {
  const client = await createClient();
  const result = await client.from('teams').select('id, league_id, division_id, name').eq('league_id', leagueId).eq('id', teamId).maybeSingle();
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

export type PublicStatsTenantHost = { kind: 'slug'; slug: string } | { kind: 'custom'; hostname: string } | { kind: 'unbound' };

export function getPublicStatsTenantHost(request: NextRequest): PublicStatsTenantHost {
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
  const tenantHost = getPublicStatsTenantHost(request);
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
