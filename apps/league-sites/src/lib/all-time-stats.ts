import type { UnifiedGoalieStatsRow, UnifiedSkaterStatsRow } from './types';

export const IMPORTED_ALL_TIME_TEAM_LABEL = 'Imported career totals';
const HISTORICAL_CAREER_BASELINE_SEASON_PREFIX = 'historical career baseline';

type RawBaselineRow = Record<string, unknown>;

export interface ImportedCareerBaselineRow {
  source_table: string;
  source_row_id: string;
  player_id: string;
  profile_id: string | null;
  profile_id_league_verified?: boolean;
  player_name: string;
  avatar_url: string | null;
  team_id: string;
  team_name: string;
  division_name: string | null;
  position: string | null;
  is_goalie: boolean;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  penalty_minutes: number;
  plus_minus: number;
  power_play_goals: number;
  power_play_assists: number;
  short_handed_goals: number;
  short_handed_assists: number;
  game_winning_goals: number;
  empty_net_goals: number;
  shots: number;
  wins: number;
  losses: number;
  ties: number;
  championships: number;
  saves: number;
  saves_known?: boolean;
  goals_against: number;
  goals_against_known?: boolean;
  shots_against: number;
  shots_against_known?: boolean;
  games_played_known?: boolean;
  shutouts: number;
  save_percentage_ratio: number | null;
  save_percentage_known?: boolean;
  goals_against_average: number | null;
  goals_against_average_known?: boolean;
}

type LeagueScope = {
  leagueId?: string;
  leagueSlug?: string;
};

type NormalizeBaselineOptions = LeagueScope & {
  defaultTeamName?: string;
  sourceTable: string;
};

type MergedSkaterRow = UnifiedSkaterStatsRow;

export type MergedGoalieRow = UnifiedGoalieStatsRow & {
  shots_against: number;
};

const LEAGUE_ID_KEYS = ['league_id', 'source_league_id', 'baseline_league_id', 'leagueId'];
const LEAGUE_SLUG_KEYS = ['league_slug', 'source_league_slug', 'slug', 'leagueSlug'];

function readValue(row: RawBaselineRow, key: string) {
  return row[key];
}

function pickString(row: RawBaselineRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = readValue(row, key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function pickNumber(row: RawBaselineRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = readValue(row, key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function hasNumber(row: RawBaselineRow, keys: string[]): boolean {
  return pickNumber(row, keys) != null;
}

function pickBoolean(row: RawBaselineRow, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = readValue(row, key);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 't' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === 'f' || normalized === 'no' || normalized === 'n' || normalized === '0') {
        return false;
      }
    }
  }

  return null;
}

function toSafeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function roundStatValue(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export function isHistoricalCareerBaselineSeasonName(name?: string | null): boolean {
  return name?.trim().toLowerCase().startsWith(HISTORICAL_CAREER_BASELINE_SEASON_PREFIX) ?? false;
}

export function collectHistoricalCareerBaselineSeasonIds<T extends { id: string; name?: string | null }>(
  seasons: T[],
): Set<string> {
  return new Set(
    seasons
      .filter((season) => isHistoricalCareerBaselineSeasonName(season.name))
      .map((season) => season.id),
  );
}

export function filterVisibleSiteSeasons<T extends { name?: string | null }>(seasons: T[]): T[] {
  return seasons.filter((season) => !isHistoricalCareerBaselineSeasonName(season.name));
}

function normalizeSavePercentageRatio(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

function isGoaliePosition(position?: string | null) {
  const normalized = position?.trim().toLowerCase();
  return normalized === 'g' || normalized === 'goalie' || normalized === 'goaltender';
}

function matchesLeagueScope(row: RawBaselineRow, scope: LeagueScope): boolean {
  const { leagueId, leagueSlug } = scope;

  const rowLeagueId = pickString(row, LEAGUE_ID_KEYS);
  if (leagueId && rowLeagueId) {
    return rowLeagueId === leagueId;
  }

  const rowLeagueSlug = pickString(row, LEAGUE_SLUG_KEYS);
  if (leagueSlug && rowLeagueSlug) {
    return rowLeagueSlug.toLowerCase() === leagueSlug.toLowerCase();
  }

  return true;
}

function getPlayerName(row: RawBaselineRow): string {
  const explicitName = pickString(row, ['player_name', 'full_name', 'name']);
  if (explicitName) {
    return explicitName;
  }

  const firstName = pickString(row, ['first_name', 'firstname', 'given_name']) || '';
  const lastName = pickString(row, ['last_name', 'lastname', 'family_name']) || '';
  const composed = `${firstName} ${lastName}`.trim();
  return composed || 'Unknown Player';
}

function getProfileId(row: RawBaselineRow, sourceTable: string, playerId: string): string | null {
  const explicitProfileId = pickString(row, ['profile_id', 'matched_to_profile_id', 'player_profile_id']);
  if (explicitProfileId) {
    return explicitProfileId;
  }

  return sourceTable === 'legacy_players' ? null : playerId;
}

export function normalizeImportedCareerBaselineRows(
  rows: RawBaselineRow[],
  options: NormalizeBaselineOptions,
): ImportedCareerBaselineRow[] {
  const normalized: ImportedCareerBaselineRow[] = [];
  const defaultTeamName = options.defaultTeamName || IMPORTED_ALL_TIME_TEAM_LABEL;

  for (const row of rows) {
    if (!matchesLeagueScope(row, options)) {
      continue;
    }

    const playerId =
      pickString(row, ['player_id', 'matched_to_profile_id', 'profile_id', 'player_profile_id']) ||
      pickString(row, ['id']);

    if (!playerId) {
      continue;
    }

    const position = pickString(row, ['position', 'player_position', 'role']);
    const isGoalie = pickBoolean(row, ['is_goalie', 'goalie']) ?? isGoaliePosition(position);
    const gamesPlayedKeys = ['games_played', 'gp'];
    const savesKeys = ['saves', 'sv'];
    const goalsAgainstKeys = ['goals_against', 'ga'];
    const shotsAgainstKeys = ['shots_against', 'sa'];
    const savePercentageKeys = ['save_percentage', 'save_pct', 'sv_pct'];
    const gaaKeys = ['goals_against_average', 'gaa'];
    const gamesPlayed = toSafeNumber(pickNumber(row, gamesPlayedKeys));
    const goals = toSafeNumber(pickNumber(row, ['goals', 'g']));
    const assists = toSafeNumber(pickNumber(row, ['assists', 'a']));
    const points = toSafeNumber(pickNumber(row, ['points', 'pts'])) || goals + assists;
    const wins = toSafeNumber(pickNumber(row, ['wins', 'w']));
    const ties = toSafeNumber(pickNumber(row, ['ties', 't']));
    const championships = toSafeNumber(pickNumber(row, ['moosehead_cup_wins', 'championships']));
    const losses =
      toSafeNumber(pickNumber(row, ['losses', 'l'])) ||
      Math.max(gamesPlayed - wins - ties, 0);
    const saves = toSafeNumber(pickNumber(row, savesKeys));
    const goalsAgainst = toSafeNumber(pickNumber(row, goalsAgainstKeys));
    const shotsAgainstKnown = hasNumber(row, shotsAgainstKeys);
    const savesRecorded = hasNumber(row, savesKeys);
    const goalsAgainstRecorded = hasNumber(row, goalsAgainstKeys);
    const rawSavePercentage = pickNumber(row, savePercentageKeys);
    const rawGaa = pickNumber(row, gaaKeys);
    const defaultedImportedGoalieSource = options.sourceTable === 'legacy_players'
      || options.sourceTable === 'player_career_baselines'
      || options.sourceTable === 'league_player_career_baselines';
    const savesKnown = shotsAgainstKnown
      ? savesRecorded
      : defaultedImportedGoalieSource
        ? saves > 0 && goalsAgainstRecorded
        : savesRecorded;
    const shotsAgainst = shotsAgainstKnown
      ? toSafeNumber(pickNumber(row, shotsAgainstKeys))
      : savesKnown && goalsAgainstRecorded ? saves + goalsAgainst : 0;
    const savePercentageKnown = shotsAgainst > 0 && savesKnown;
    const gaaKnown = gamesPlayed > 0 && goalsAgainstRecorded
      || (!defaultedImportedGoalieSource && rawGaa != null);

    normalized.push({
      source_table: options.sourceTable,
      source_row_id: pickString(row, ['id']) || `${options.sourceTable}:${playerId}`,
      player_id: playerId,
      profile_id: getProfileId(row, options.sourceTable, playerId),
      profile_id_league_verified: options.sourceTable === 'player_career_baselines'
        && Boolean(options.leagueId && pickString(row, LEAGUE_ID_KEYS) === options.leagueId),
      player_name: getPlayerName(row),
      avatar_url: pickString(row, ['avatar_url']),
      team_id: pickString(row, ['team_id', 'baseline_team_id']) || '',
      team_name: pickString(row, ['team_name', 'baseline_team_name']) || defaultTeamName,
      division_name: pickString(row, ['division_name']) || null,
      position: position || (isGoalie ? 'G' : null),
      is_goalie: isGoalie,
      games_played: gamesPlayed,
      goals,
      assists,
      points,
      penalty_minutes: toSafeNumber(pickNumber(row, ['penalty_minutes', 'pim'])),
      plus_minus: toSafeNumber(pickNumber(row, ['plus_minus'])),
      power_play_goals: toSafeNumber(pickNumber(row, ['power_play_goals', 'pp_goals'])),
      power_play_assists: toSafeNumber(pickNumber(row, ['power_play_assists', 'pp_assists'])),
      short_handed_goals: toSafeNumber(pickNumber(row, ['short_handed_goals', 'sh_goals'])),
      short_handed_assists: toSafeNumber(pickNumber(row, ['short_handed_assists', 'sh_assists'])),
      game_winning_goals: toSafeNumber(pickNumber(row, ['game_winning_goals', 'gwg'])),
      empty_net_goals: toSafeNumber(pickNumber(row, ['empty_net_goals', 'eng'])),
      shots: toSafeNumber(pickNumber(row, ['shots', 'sog'])),
      wins,
      losses,
      ties,
      championships,
      saves,
      saves_known: savesKnown,
      goals_against: goalsAgainst,
      goals_against_known: goalsAgainstRecorded,
      shots_against: shotsAgainst,
      shots_against_known: shotsAgainstKnown || (savesKnown && goalsAgainstRecorded),
      games_played_known: hasNumber(row, gamesPlayedKeys),
      shutouts: toSafeNumber(pickNumber(row, ['shutouts', 'so'])),
      save_percentage_ratio: savePercentageKnown ? normalizeSavePercentageRatio(rawSavePercentage) : null,
      save_percentage_known: savePercentageKnown,
      goals_against_average: gaaKnown ? rawGaa : null,
      goals_against_average_known: gaaKnown,
    });
  }

  return normalized;
}

type SkaterAccumulator = UnifiedSkaterStatsRow & {
  metadata_priority: number;
};

function upsertPreferredSkaterMetadata(
  current: SkaterAccumulator,
  incoming: {
    player_name: string;
    avatar_url: string | null;
    team_id: string;
    team_name: string;
    division_name: string | null;
    position: string | null;
  },
  priority: number,
) {
  if (priority >= current.metadata_priority) {
    current.player_name = incoming.player_name || current.player_name;
    current.avatar_url = incoming.avatar_url ?? current.avatar_url;
    current.team_id = incoming.team_id;
    current.team_name = incoming.team_name;
    current.division_name = incoming.division_name;
    current.position = incoming.position;
    current.metadata_priority = priority;
  } else if (!current.avatar_url && incoming.avatar_url) {
    current.avatar_url = incoming.avatar_url;
  }
}

export function buildHistoricalBaselineSkaterRows(
  baselineRows: ImportedCareerBaselineRow[],
): UnifiedSkaterStatsRow[] {
  return baselineRows
    .filter((row) => !row.is_goalie)
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      avatar_url: row.avatar_url,
      team_id: row.team_id,
      team_name: row.team_name,
      division_name: row.division_name,
      position: row.position,
      championships: row.championships,
      games_played: row.games_played,
      goals: row.goals,
      assists: row.assists,
      points: row.points,
      points_per_game: row.games_played > 0 ? roundStatValue(row.points / row.games_played) : 0,
      goals_per_game: row.games_played > 0 ? roundStatValue(row.goals / row.games_played) : 0,
      assists_per_game: row.games_played > 0 ? roundStatValue(row.assists / row.games_played) : 0,
      penalty_minutes: row.penalty_minutes,
      plus_minus: row.plus_minus,
      power_play_goals: row.power_play_goals,
      power_play_assists: row.power_play_assists,
      power_play_points: row.power_play_goals + row.power_play_assists,
      short_handed_goals: row.short_handed_goals,
      short_handed_assists: row.short_handed_assists,
      game_winning_goals: row.game_winning_goals,
      empty_net_goals: row.empty_net_goals,
      shots: row.shots,
      shots_per_game: row.games_played > 0 ? roundStatValue(row.shots / row.games_played) : 0,
    }));
}

export function mergeAllTimeSkaterRows(
  baselineRows: ImportedCareerBaselineRow[],
  nativeRows: UnifiedSkaterStatsRow[],
): MergedSkaterRow[] {
  const merged = new Map<string, SkaterAccumulator>();

  const ensure = (playerId: string, seed: Omit<SkaterAccumulator, 'metadata_priority'>, metadataPriority: number) => {
    const existing = merged.get(playerId);
    if (existing) {
      return existing;
    }

    const created: SkaterAccumulator = {
      ...seed,
      metadata_priority: metadataPriority,
    };
    merged.set(playerId, created);
    return created;
  };

  for (const row of baselineRows.filter((entry) => !entry.is_goalie)) {
    const current = ensure(
      row.player_id,
      {
        player_id: row.player_id,
        player_name: row.player_name,
        avatar_url: row.avatar_url,
        team_id: row.team_id,
        team_name: row.team_name,
        division_name: row.division_name,
        position: row.position,
        championships: 0,
        games_played: 0,
        goals: 0,
        assists: 0,
        points: 0,
        points_per_game: 0,
        goals_per_game: 0,
        assists_per_game: 0,
        penalty_minutes: 0,
        plus_minus: 0,
        power_play_goals: 0,
        power_play_assists: 0,
        power_play_points: 0,
        short_handed_goals: 0,
        short_handed_assists: 0,
        game_winning_goals: 0,
        empty_net_goals: 0,
        shots: 0,
        shots_per_game: 0,
      },
      0,
    );

    current.games_played += row.games_played;
    current.championships += row.championships;
    current.goals += row.goals;
    current.assists += row.assists;
    current.penalty_minutes += row.penalty_minutes;
    current.plus_minus += row.plus_minus;
    current.power_play_goals += row.power_play_goals;
    current.power_play_assists += row.power_play_assists;
    current.short_handed_goals += row.short_handed_goals;
    current.short_handed_assists += row.short_handed_assists;
    current.game_winning_goals += row.game_winning_goals;
    current.empty_net_goals += row.empty_net_goals;
    current.shots += row.shots;
  }

  for (const row of nativeRows) {
    const current = ensure(
      row.player_id,
      {
        player_id: row.player_id,
        player_name: row.player_name,
        avatar_url: row.avatar_url,
        team_id: row.team_id,
        team_name: row.team_name,
        division_name: row.division_name,
        position: row.position,
        championships: 0,
        games_played: 0,
        goals: 0,
        assists: 0,
        points: 0,
        points_per_game: 0,
        goals_per_game: 0,
        assists_per_game: 0,
        penalty_minutes: 0,
        plus_minus: 0,
        power_play_goals: 0,
        power_play_assists: 0,
        power_play_points: 0,
        short_handed_goals: 0,
        short_handed_assists: 0,
        game_winning_goals: 0,
        empty_net_goals: 0,
        shots: 0,
        shots_per_game: 0,
      },
      1,
    );

    current.games_played += row.games_played;
    current.championships += row.championships;
    current.goals += row.goals;
    current.assists += row.assists;
    current.penalty_minutes += row.penalty_minutes;
    current.plus_minus += row.plus_minus;
    current.power_play_goals += row.power_play_goals;
    current.power_play_assists += row.power_play_assists;
    current.short_handed_goals += row.short_handed_goals;
    current.short_handed_assists += row.short_handed_assists;
    current.game_winning_goals += row.game_winning_goals;
    current.empty_net_goals += row.empty_net_goals;
    current.shots += row.shots;
    upsertPreferredSkaterMetadata(current, row, 1);
  }

  return Array.from(merged.values()).map((row) => {
    const points = row.goals + row.assists;
    return {
      player_id: row.player_id,
      player_name: row.player_name,
      avatar_url: row.avatar_url,
      team_id: row.team_id,
      team_name: row.team_name,
      division_name: row.division_name,
      position: row.position,
      championships: row.championships,
      games_played: row.games_played,
      goals: row.goals,
      assists: row.assists,
      points,
      points_per_game: row.games_played > 0 ? roundStatValue(points / row.games_played) : 0,
      goals_per_game: row.games_played > 0 ? roundStatValue(row.goals / row.games_played) : 0,
      assists_per_game: row.games_played > 0 ? roundStatValue(row.assists / row.games_played) : 0,
      penalty_minutes: row.penalty_minutes,
      plus_minus: row.plus_minus,
      power_play_goals: row.power_play_goals,
      power_play_assists: row.power_play_assists,
      power_play_points: row.power_play_goals + row.power_play_assists,
      short_handed_goals: row.short_handed_goals,
      short_handed_assists: row.short_handed_assists,
      game_winning_goals: row.game_winning_goals,
      empty_net_goals: row.empty_net_goals,
      shots: row.shots,
      shots_per_game: row.games_played > 0 ? roundStatValue(row.shots / row.games_played) : 0,
    };
  });
}

type GoalieAccumulator = {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  team_id: string;
  team_name: string;
  division_name: string | null;
  position: string | null;
  championships: number;
  games_played: number;
  wins: number;
  losses: number;
  saves: number;
  goals_against: number;
  shots_against: number;
  shutouts: number;
  save_percentage_ratio_fallback: number | null;
  save_percentage_complete: boolean;
  goals_against_average_complete: boolean;
  metadata_priority: number;
};

function upsertPreferredGoalieMetadata(
  current: GoalieAccumulator,
  incoming: {
    player_name: string;
    avatar_url: string | null;
    team_id: string;
    team_name: string;
    division_name: string | null;
    position: string | null;
  },
  priority: number,
) {
  if (priority >= current.metadata_priority) {
    current.player_name = incoming.player_name || current.player_name;
    current.avatar_url = incoming.avatar_url ?? current.avatar_url;
    current.team_id = incoming.team_id;
    current.team_name = incoming.team_name;
    current.division_name = incoming.division_name;
    current.position = incoming.position;
    current.metadata_priority = priority;
  } else if (!current.avatar_url && incoming.avatar_url) {
    current.avatar_url = incoming.avatar_url;
  }
}

function baselineSavePercentageKnown(row: ImportedCareerBaselineRow) {
  if (row.save_percentage_known !== undefined) return row.save_percentage_known;
  return row.shots_against_known === undefined || row.shots_against_known === true;
}

function baselineGaaKnown(row: ImportedCareerBaselineRow) {
  if (row.goals_against_average_known !== undefined) return row.goals_against_average_known;
  const hasKnowledge = row.games_played_known !== undefined || row.goals_against_known !== undefined;
  return !hasKnowledge || (row.games_played_known === true && row.goals_against_known === true);
}

export function buildHistoricalBaselineGoalieRows(
  baselineRows: ImportedCareerBaselineRow[],
): UnifiedGoalieStatsRow[] {
  return baselineRows
    .filter((row) => row.is_goalie)
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      avatar_url: row.avatar_url,
      team_id: row.team_id,
      team_name: row.team_name,
      division_name: row.division_name,
      position: row.position || 'G',
      championships: row.championships,
      games_played: row.games_played,
      wins: row.wins,
      losses: row.losses,
      saves: row.saves,
      goals_against: row.goals_against,
      save_percentage: row.shots_against > 0
        ? roundStatValue((row.saves / row.shots_against) * 100, 1)
        : row.save_percentage_ratio != null
          ? roundStatValue(row.save_percentage_ratio * 100, 1)
          : null,
      save_percentage_provenance: baselineSavePercentageKnown(row) ? 'measured' : 'unmeasured',
      goals_against_average: row.games_played > 0
        ? roundStatValue(row.goals_against / row.games_played)
        : row.goals_against_average != null
          ? roundStatValue(row.goals_against_average)
          : null,
      goals_against_average_provenance: baselineGaaKnown(row) ? 'measured' : 'unmeasured',
      shutouts: row.shutouts,
    }));
}

export function mergeAllTimeGoalieRows(
  baselineRows: ImportedCareerBaselineRow[],
  nativeRows: UnifiedGoalieStatsRow[],
): MergedGoalieRow[] {
  const merged = new Map<string, GoalieAccumulator>();

  const ensure = (playerId: string, seed: GoalieAccumulator) => {
    const existing = merged.get(playerId);
    if (existing) {
      return existing;
    }

    merged.set(playerId, seed);
    return seed;
  };

  for (const row of baselineRows.filter((entry) => entry.is_goalie)) {
    const current = ensure(row.player_id, {
      player_id: row.player_id,
      player_name: row.player_name,
      avatar_url: row.avatar_url,
      team_id: row.team_id,
      team_name: row.team_name,
      division_name: row.division_name,
      position: row.position || 'G',
      championships: 0,
      games_played: 0,
      wins: 0,
      losses: 0,
      saves: 0,
      goals_against: 0,
      shots_against: 0,
      shutouts: 0,
      save_percentage_ratio_fallback: row.save_percentage_ratio,
      save_percentage_complete: true,
      goals_against_average_complete: true,
      metadata_priority: 0,
    });

    current.games_played += row.games_played;
    current.championships += row.championships;
    current.wins += row.wins;
    current.losses += row.losses;
    current.saves += row.saves;
    current.goals_against += row.goals_against;
    current.shots_against += row.shots_against;
    current.shutouts += row.shutouts;
    current.save_percentage_complete = current.save_percentage_complete && baselineSavePercentageKnown(row);
    current.goals_against_average_complete = current.goals_against_average_complete && baselineGaaKnown(row);
    if (current.save_percentage_ratio_fallback == null) {
      current.save_percentage_ratio_fallback = row.save_percentage_ratio;
    }
  }

  for (const row of nativeRows) {
    const current = ensure(row.player_id, {
      player_id: row.player_id,
      player_name: row.player_name,
      avatar_url: row.avatar_url,
      team_id: row.team_id,
      team_name: row.team_name,
      division_name: row.division_name,
      position: row.position,
      championships: 0,
      games_played: 0,
      wins: 0,
      losses: 0,
      saves: 0,
      goals_against: 0,
      shots_against: 0,
      shutouts: 0,
      save_percentage_ratio_fallback: row.save_percentage != null ? row.save_percentage / 100 : null,
      save_percentage_complete: true,
      goals_against_average_complete: true,
      metadata_priority: 1,
    });

    current.games_played += row.games_played;
    current.championships += row.championships;
    current.wins += row.wins;
    current.losses += row.losses;
    current.saves += row.saves;
    current.goals_against += row.goals_against;
    current.shots_against += row.saves + row.goals_against;
    current.shutouts += row.shutouts;
    current.save_percentage_complete = current.save_percentage_complete && row.save_percentage_provenance !== 'unmeasured';
    current.goals_against_average_complete = current.goals_against_average_complete
      && row.goals_against_average_provenance !== 'unmeasured';
    upsertPreferredGoalieMetadata(current, row, 1);
  }

  return Array.from(merged.values()).map((row) => ({
    player_id: row.player_id,
    player_name: row.player_name,
    avatar_url: row.avatar_url,
    team_id: row.team_id,
    team_name: row.team_name,
    division_name: row.division_name,
    position: row.position,
    championships: row.championships,
    games_played: row.games_played,
    wins: row.wins,
    losses: row.losses,
    saves: row.saves,
    goals_against: row.goals_against,
    shots_against: row.shots_against,
    save_percentage: !row.save_percentage_complete ? null : row.shots_against > 0
      ? roundStatValue((row.saves / row.shots_against) * 100, 1)
      : row.save_percentage_ratio_fallback != null
        ? roundStatValue(row.save_percentage_ratio_fallback * 100, 1)
        : null,
    save_percentage_provenance: row.save_percentage_complete ? 'measured' : 'unmeasured',
    goals_against_average: !row.goals_against_average_complete ? null : row.games_played > 0
      ? roundStatValue(row.goals_against / row.games_played)
      : null,
    goals_against_average_provenance: row.goals_against_average_complete ? 'measured' : 'unmeasured',
    shutouts: row.shutouts,
  }));
}
