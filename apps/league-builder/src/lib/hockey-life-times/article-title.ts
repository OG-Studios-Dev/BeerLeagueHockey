import { addLocalDays, assertLocalDate } from './domain';

export interface HockeyLifeTimesTitleGame {
  gameType?: string | null;
  roundNumber: number | null;
  bracketRoundCount: number | null;
}

export interface HockeyLifeTimesBracketGame {
  id: string;
  gameType?: string | null;
  roundNumber: number | null;
  playoffSeriesId: string | null;
}

export interface HockeyLifeTimesPlayoffSeries {
  id: string;
  divisionId: string | null;
  roundNumber: number;
}

export function bindHockeyLifeTimesBracketFacts(
  games: HockeyLifeTimesBracketGame[],
  seriesRows: HockeyLifeTimesPlayoffSeries[],
): HockeyLifeTimesTitleGame[] {
  const roundCountByScope = new Map<string, number>();
  const seriesById = new Map<string, HockeyLifeTimesPlayoffSeries>();
  for (const series of seriesRows) {
    if (!Number.isInteger(series.roundNumber) || series.roundNumber < 1 || seriesById.has(series.id)) {
      throw new Error('HLT title playoff bracket facts are invalid.');
    }
    seriesById.set(series.id, series);
    const scope = series.divisionId || 'overall';
    roundCountByScope.set(scope, Math.max(roundCountByScope.get(scope) || 0, series.roundNumber));
  }

  return games.map((game) => {
    if (game.gameType !== 'playoff') {
      return { gameType: game.gameType, roundNumber: null, bracketRoundCount: null };
    }
    const series = game.playoffSeriesId ? seriesById.get(game.playoffSeriesId) : null;
    if (!series || game.roundNumber !== series.roundNumber) {
      throw new Error(`HLT title game ${game.id} is not bound to an authoritative playoff series round.`);
    }
    return {
      gameType: game.gameType,
      roundNumber: series.roundNumber,
      bracketRoundCount: roundCountByScope.get(series.divisionId || 'overall') || null,
    };
  });
}

function mondayContaining(localDate: string): string {
  assertLocalDate(localDate);
  const date = new Date(`${localDate}T12:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addLocalDays(localDate, -daysSinceMonday);
}

function seasonLabel(name: string, startDate: string): string {
  let normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('HLT title requires a season name.');
  assertLocalDate(startDate);
  const year = startDate.slice(0, 4);
  const standardSeason = normalized.match(/^(spring|summer|fall|autumn|winter)(?:\s+((?:19|20)\d{2}))?$/i);
  if (standardSeason) {
    const seasonWord = standardSeason[1].toLowerCase();
    normalized = `${seasonWord[0].toUpperCase()}${seasonWord.slice(1)}${standardSeason[2] ? ` ${standardSeason[2]}` : ''}`;
  }
  return /\b(?:19|20)\d{2}\b/.test(normalized) ? normalized : `${normalized} ${year}`;
}

export function buildHockeyLifeTimesArticleTitle(input: {
  seasonName: string;
  seasonStart: string;
  periodStart: string;
  games: HockeyLifeTimesTitleGame[];
  playoffPhase?: 'Semis' | 'Championships';
}): string {
  const season = seasonLabel(input.seasonName, input.seasonStart);
  if (input.games.length === 0) throw new Error('HLT title requires at least one authoritative game.');

  const stages = new Set(input.games.map((game) => {
    if (game.gameType === 'playoff') return 'playoffs';
    if (game.gameType == null || game.gameType === 'regular') return 'regular';
    throw new Error(`HLT title cannot classify game type ${game.gameType}.`);
  }));
  if (stages.size !== 1) throw new Error('HLT title cannot represent mixed regular-season and playoff games.');

  if (stages.has('regular')) {
    const seasonWeekStart = mondayContaining(input.seasonStart);
    const periodWeekStart = mondayContaining(input.periodStart);
    const elapsedDays = Math.round(
      (Date.parse(`${periodWeekStart}T12:00:00Z`) - Date.parse(`${seasonWeekStart}T12:00:00Z`)) / 86_400_000,
    );
    if (elapsedDays < 0 || elapsedDays % 7 !== 0) {
      throw new Error('HLT title period does not map to a valid season schedule week.');
    }
    return `HLT: Week ${(elapsedDays / 7) + 1} - ${season}`;
  }

  if (input.playoffPhase) return `HLT: ${input.playoffPhase} - ${season}`;

  const labels = new Set(input.games.map((game) => {
    if (
      !Number.isInteger(game.roundNumber) || !Number.isInteger(game.bracketRoundCount)
      || game.roundNumber! < 1 || game.bracketRoundCount! < 1
      || game.roundNumber! > game.bracketRoundCount!
    ) {
      throw new Error('HLT title requires authoritative playoff bracket rounds.');
    }
    const roundsFromEnd = game.bracketRoundCount! - game.roundNumber! + 1;
    if (roundsFromEnd === 1) return 'Championships';
    if (roundsFromEnd === 2) return 'Semis';
    throw new Error('HLT title supports only semifinal or championship playoff editions.');
  }));
  if (labels.size !== 1) throw new Error('HLT title cannot represent mixed playoff rounds.');
  return `HLT: ${[...labels][0]} - ${season}`;
}
