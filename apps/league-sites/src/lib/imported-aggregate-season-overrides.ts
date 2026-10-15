import { isHistoricalCareerBaselineSeasonName } from './all-time-stats';
import type { UnifiedGoalieStatsRow, UnifiedSkaterStatsRow } from './types';

export const HLHL_WINTER_2026_SEASON_ID = '30ee2c0b-5981-4df4-b0cc-d7cae05b9e37';

export type ImportedAggregateSkaterSeed = {
  playerName: string;
  teamName: string | null;
  gamesPlayed: number;
  goals: number;
  assists: number;
};

type ImportedAggregateGoalieRawSeed = {
  playerName: string;
  teamName: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  shutouts: number;
  goalsAgainst: number;
};

export type ImportedAggregateGoalieSeed = ImportedAggregateGoalieRawSeed & {
  saves: number;
};

const HLHL_WINTER_2026_SKATERS: ImportedAggregateSkaterSeed[] = [
  { playerName: 'Steve Almond', teamName: 'FitzRays Flyers', gamesPlayed: 10, goals: 2, assists: 5 },
  { playerName: 'Mitch Bedard', teamName: 'First General London', gamesPlayed: 10, goals: 7, assists: 4 },
  { playerName: 'Craig Bettridge', teamName: 'FitzRays Flyers', gamesPlayed: 11, goals: 4, assists: 9 },
  { playerName: 'Jim Bloxam', teamName: 'FitzRays Flyers', gamesPlayed: 11, goals: 0, assists: 1 },
  { playerName: 'Jonathan Brougham', teamName: 'FitzRays Flyers', gamesPlayed: 9, goals: 10, assists: 3 },
  { playerName: 'Lyndon Bulda', teamName: 'London Eco Metal', gamesPlayed: 11, goals: 8, assists: 14 },
  { playerName: 'Vince Carducci', teamName: 'FitzRays Premier', gamesPlayed: 8, goals: 0, assists: 6 },
  { playerName: 'Andre Carruthers', teamName: 'First General London', gamesPlayed: 6, goals: 0, assists: 0 },
  { playerName: 'Cris Cervoni', teamName: 'First General London', gamesPlayed: 8, goals: 5, assists: 11 },
  { playerName: 'Terry Drew', teamName: 'FitzRays Flyers', gamesPlayed: 9, goals: 1, assists: 6 },
  { playerName: 'Paul Gibson', teamName: 'London Eco Metal', gamesPlayed: 10, goals: 6, assists: 7 },
  { playerName: 'Matt Grossi', teamName: 'FitzRays Flyers', gamesPlayed: 10, goals: 12, assists: 7 },
  { playerName: 'Sam Haight', teamName: 'FitzRays Flyers', gamesPlayed: 9, goals: 8, assists: 7 },
  { playerName: 'Marty Hanke', teamName: 'FitzRays Premier', gamesPlayed: 10, goals: 4, assists: 7 },
  { playerName: 'Eric Hartley', teamName: 'FitzRays Premier', gamesPlayed: 8, goals: 2, assists: 4 },
  { playerName: 'Adrian Hartley', teamName: 'FitzRays Premier', gamesPlayed: 8, goals: 5, assists: 5 },
  { playerName: 'Cooper Hatfield', teamName: 'FitzRays Premier', gamesPlayed: 11, goals: 1, assists: 5 },
  { playerName: 'Tristan Hatfield', teamName: 'FitzRays Premier', gamesPlayed: 11, goals: 14, assists: 5 },
  { playerName: 'Dhurim Ismaili', teamName: 'FitzRays Premier', gamesPlayed: 7, goals: 2, assists: 1 },
  { playerName: 'Marek Klimowicz', teamName: 'FitzRays Premier', gamesPlayed: 10, goals: 0, assists: 10 },
  { playerName: 'Adam Klimowicz', teamName: 'First General London', gamesPlayed: 11, goals: 9, assists: 14 },
  { playerName: 'Stefan Kowlessar', teamName: 'London Eco Metal', gamesPlayed: 11, goals: 2, assists: 7 },
  { playerName: 'Adrian Kwasek', teamName: 'FitzRays Premier', gamesPlayed: 11, goals: 1, assists: 8 },
  { playerName: 'Jeff Lobodzinski', teamName: 'First General London', gamesPlayed: 11, goals: 6, assists: 8 },
  { playerName: 'Dan MacGillivray', teamName: 'FitzRays Premier', gamesPlayed: 9, goals: 12, assists: 4 },
  { playerName: 'Garrett Mcinerney', teamName: 'London Eco Metal', gamesPlayed: 11, goals: 8, assists: 6 },
  { playerName: 'David Miskus', teamName: 'First General London', gamesPlayed: 10, goals: 11, assists: 11 },
  { playerName: 'Eric Mortson', teamName: 'London Eco Metal', gamesPlayed: 10, goals: 11, assists: 6 },
  { playerName: 'Cory Nott', teamName: 'First General London', gamesPlayed: 11, goals: 0, assists: 1 },
  { playerName: 'Trevor Paterson', teamName: 'London Eco Metal', gamesPlayed: 9, goals: 1, assists: 4 },
  { playerName: 'Daryl Patterson', teamName: 'FitzRays Flyers', gamesPlayed: 9, goals: 0, assists: 4 },
  { playerName: 'Adam Raphael', teamName: 'FitzRays Flyers', gamesPlayed: 2, goals: 1, assists: 1 },
  { playerName: 'Hayden Reginier', teamName: 'London Eco Metal', gamesPlayed: 9, goals: 0, assists: 4 },
  { playerName: 'Andrew Sawchuk', teamName: 'First General London', gamesPlayed: 9, goals: 1, assists: 3 },
  { playerName: 'Cameron Sheppard', teamName: 'First General London', gamesPlayed: 11, goals: 2, assists: 7 },
  { playerName: 'Sonny Teale', teamName: 'FitzRays Flyers', gamesPlayed: 11, goals: 1, assists: 8 },
  { playerName: 'Sean Teasdale', teamName: 'London Eco Metal', gamesPlayed: 9, goals: 0, assists: 1 },
  { playerName: 'Cameron Wallace', teamName: 'London Eco Metal', gamesPlayed: 11, goals: 6, assists: 9 },
  { playerName: 'David Watson', teamName: 'First General London', gamesPlayed: 10, goals: 0, assists: 5 },
  { playerName: 'Nathan Zaplatar', teamName: 'London Eco Metal', gamesPlayed: 5, goals: 0, assists: 1 },
  { playerName: 'Ben Austin', teamName: null, gamesPlayed: 1, goals: 0, assists: 0 },
  { playerName: 'Max Bowman', teamName: null, gamesPlayed: 2, goals: 0, assists: 0 },
  { playerName: 'Caleb Cook', teamName: null, gamesPlayed: 3, goals: 1, assists: 3 },
  { playerName: 'Cameron DeBoer', teamName: null, gamesPlayed: 3, goals: 1, assists: 1 },
  { playerName: 'Jack Foote', teamName: null, gamesPlayed: 1, goals: 2, assists: 2 },
  { playerName: 'Eric Gagliardi', teamName: null, gamesPlayed: 2, goals: 0, assists: 1 },
  { playerName: 'Kyle Geraghty', teamName: null, gamesPlayed: 4, goals: 0, assists: 2 },
  { playerName: 'Daniel Jackson', teamName: null, gamesPlayed: 1, goals: 0, assists: 0 },
  { playerName: 'Jeremy Jennison', teamName: null, gamesPlayed: 5, goals: 1, assists: 2 },
  { playerName: 'Randy Killburn', teamName: null, gamesPlayed: 2, goals: 0, assists: 2 },
  { playerName: 'Steve Lobodzinski', teamName: null, gamesPlayed: 1, goals: 0, assists: 1 },
  { playerName: 'Steve Mati', teamName: null, gamesPlayed: 2, goals: 0, assists: 3 },
  { playerName: 'Ash Moore', teamName: null, gamesPlayed: 4, goals: 6, assists: 5 },
  { playerName: 'Matt Morden', teamName: null, gamesPlayed: 2, goals: 0, assists: 0 },
  { playerName: 'Aidan Murphy', teamName: null, gamesPlayed: 4, goals: 4, assists: 3 },
  { playerName: 'Troy Murphy', teamName: null, gamesPlayed: 2, goals: 0, assists: 0 },
  { playerName: 'Jared Myatte', teamName: null, gamesPlayed: 1, goals: 0, assists: 0 },
  { playerName: 'Blake Neufeld', teamName: null, gamesPlayed: 1, goals: 0, assists: 0 },
  { playerName: 'John Pilon', teamName: null, gamesPlayed: 2, goals: 0, assists: 1 },
  { playerName: 'Torey Robinson', teamName: null, gamesPlayed: 3, goals: 1, assists: 2 },
  { playerName: 'Kelly Schuh', teamName: null, gamesPlayed: 4, goals: 4, assists: 2 },
  { playerName: 'Casey Simon', teamName: null, gamesPlayed: 2, goals: 0, assists: 1 },
];

const HLHL_WINTER_2026_GOALIE_RAW: ImportedAggregateGoalieRawSeed[] = [
  { playerName: 'Cody Bolman', teamName: 'FitzRays Premier', gamesPlayed: 8, wins: 4, losses: 4, ties: 0, shutouts: 0, goalsAgainst: 37 },
  { playerName: 'Aaron Buehler', teamName: 'London Eco Metal', gamesPlayed: 11, wins: 5, losses: 5, ties: 1, shutouts: 0, goalsAgainst: 43 },
  { playerName: 'Shawn Fucile', teamName: null, gamesPlayed: 1, wins: 0, losses: 1, ties: 0, shutouts: 0, goalsAgainst: 8 },
  { playerName: 'Connor Geraghty', teamName: 'FitzRays Flyers', gamesPlayed: 7, wins: 3, losses: 3, ties: 1, shutouts: 0, goalsAgainst: 36 },
  { playerName: 'JC Keenleyside-Richter', teamName: null, gamesPlayed: 1, wins: 0, losses: 1, ties: 0, shutouts: 0, goalsAgainst: 2 },
  { playerName: 'Erik Leipala', teamName: null, gamesPlayed: 4, wins: 2, losses: 2, ties: 0, shutouts: 0, goalsAgainst: 18 },
  { playerName: 'Leaf Lunnen', teamName: null, gamesPlayed: 1, wins: 0, losses: 0, ties: 1, shutouts: 0, goalsAgainst: 3 },
  { playerName: 'Vince Mitalas', teamName: null, gamesPlayed: 1, wins: 1, losses: 0, ties: 0, shutouts: 0, goalsAgainst: 1 },
  { playerName: 'Steven Wild', teamName: 'First General London', gamesPlayed: 10, wins: 5, losses: 4, ties: 1, shutouts: 0, goalsAgainst: 33 },
];

function estimateGoalieSaves(goalsAgainst: number, wins: number, gamesPlayed: number) {
  if (wins >= gamesPlayed) {
    return Math.max(gamesPlayed * 25 - goalsAgainst, 0);
  }
  const winRatio = wins / Math.max(gamesPlayed, 1);
  const estimated = Math.round((goalsAgainst / (1 - winRatio)) * wins);
  if (Number.isFinite(estimated) && estimated > 0) {
    return estimated;
  }

  return Math.max(gamesPlayed * 25 - goalsAgainst, 0);
}

const HLHL_WINTER_2026_GOALIES: ImportedAggregateGoalieSeed[] = HLHL_WINTER_2026_GOALIE_RAW.map((goalie) => ({
  ...goalie,
  saves: estimateGoalieSaves(goalie.goalsAgainst, goalie.wins, goalie.gamesPlayed),
}));

function normalizePlayerName(name?: string | null) {
  return name?.trim().toLowerCase() ?? '';
}

const skaterSeedsByName = new Map(
  HLHL_WINTER_2026_SKATERS.map((skater) => [normalizePlayerName(skater.playerName), skater]),
);

const goalieSeedsByName = new Map(
  HLHL_WINTER_2026_GOALIES.map((goalie) => [normalizePlayerName(goalie.playerName), goalie]),
);

export function isImportedAggregateSeasonId(seasonId?: string | null) {
  return seasonId === HLHL_WINTER_2026_SEASON_ID;
}

export function isAggregateOnlySeasonView(seasonId?: string | null, seasonName?: string | null) {
  return isImportedAggregateSeasonId(seasonId) || isHistoricalCareerBaselineSeasonName(seasonName);
}

export function getImportedAggregateSkaterSeed(
  seasonId: string | null | undefined,
  playerName?: string | null,
) {
  if (!isImportedAggregateSeasonId(seasonId)) {
    return null;
  }

  return skaterSeedsByName.get(normalizePlayerName(playerName)) ?? null;
}

export function getImportedAggregateGoalieSeed(
  seasonId: string | null | undefined,
  playerName?: string | null,
) {
  if (!isImportedAggregateSeasonId(seasonId)) {
    return null;
  }

  return goalieSeedsByName.get(normalizePlayerName(playerName)) ?? null;
}

export function getImportedAggregateSkaterSeeds(seasonId?: string | null) {
  return isImportedAggregateSeasonId(seasonId) ? HLHL_WINTER_2026_SKATERS : [];
}

export function getImportedAggregateGoalieSeeds(seasonId?: string | null) {
  return isImportedAggregateSeasonId(seasonId) ? HLHL_WINTER_2026_GOALIES : [];
}

export function getImportedAggregateSkaterGamesPlayed(seasonId: string | null | undefined, playerName?: string | null) {
  return getImportedAggregateSkaterSeed(seasonId, playerName)?.gamesPlayed ?? null;
}

export function getImportedAggregateGoalieOverride(seasonId: string | null | undefined, playerName?: string | null) {
  const goalie = getImportedAggregateGoalieSeed(seasonId, playerName);
  if (!goalie) {
    return null;
  }

  return {
    games_played: goalie.gamesPlayed,
    wins: goalie.wins,
    losses: goalie.losses,
  };
}

export function applyImportedAggregateSkaterOverride(
  row: UnifiedSkaterStatsRow,
  seasonId?: string | null,
): UnifiedSkaterStatsRow {
  const seed = getImportedAggregateSkaterSeed(seasonId, row.player_name);
  if (!seed || seed.gamesPlayed === row.games_played) {
    return row;
  }

  return {
    ...row,
    games_played: seed.gamesPlayed,
    points_per_game: seed.gamesPlayed > 0 ? Number((row.points / seed.gamesPlayed).toFixed(2)) : 0,
    goals_per_game: seed.gamesPlayed > 0 ? Number((row.goals / seed.gamesPlayed).toFixed(2)) : 0,
    assists_per_game: seed.gamesPlayed > 0 ? Number((row.assists / seed.gamesPlayed).toFixed(2)) : 0,
    shots_per_game: seed.gamesPlayed > 0 ? Number((row.shots / seed.gamesPlayed).toFixed(2)) : 0,
  };
}

export function applyImportedAggregateGoalieOverride(
  row: UnifiedGoalieStatsRow,
  seasonId?: string | null,
): UnifiedGoalieStatsRow {
  const seed = getImportedAggregateGoalieSeed(seasonId, row.player_name);
  if (!seed) {
    return row;
  }

  return {
    ...row,
    games_played: seed.gamesPlayed,
    wins: seed.wins,
    losses: seed.losses,
    saves: seed.saves,
    goals_against: seed.goalsAgainst,
    save_percentage:
      seed.saves + seed.goalsAgainst > 0
        ? Number(((seed.saves / (seed.saves + seed.goalsAgainst)) * 100).toFixed(1))
        : row.save_percentage,
    goals_against_average:
      seed.gamesPlayed > 0
        ? Number((seed.goalsAgainst / seed.gamesPlayed).toFixed(2))
        : row.goals_against_average,
  };
}
