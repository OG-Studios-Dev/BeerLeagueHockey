import type { TeamPageSnapshot } from '../../lib/supabase/teamPage';
import { resolveFocusAccent } from '../../theme/focusAccent';

export type BroadcastTeamHeroSnapshot = {
  team: Pick<TeamPageSnapshot['team'], 'name' | 'primaryColor'>;
  league: Pick<TeamPageSnapshot['league'], 'primaryColor'>;
  standing: Pick<NonNullable<TeamPageSnapshot['standing']>, 'goalsFor' | 'goalsAgainst' | 'goalDifferential'> | null;
  rank: number | null;
  record: string | null;
  streak: string | null;
  hero: TeamPageSnapshot['hero'];
  championships: {
    count: number | null;
    latestTitleSeasonName: string | null;
    latestTitleLabel: string | null;
  };
};

export type BroadcastTeamHeroModel = {
  accent: string;
  primaryName: string;
  secondaryName: string | null;
  record: string;
  championshipDisplay: string;
  championshipLabel: string;
  latestChampionship: string | null;
  heroLabel: string;
  callouts: Array<[string, string]>;
  ticker: Array<[string, string]>;
};

function nullableDisplay(value: number | null | undefined, prefix = ''): string {
  return value == null ? '—' : `${prefix}${value}`;
}

function splitBroadcastTeamName(name: string): [string, string | null] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [words[0] ?? 'Team', null];

  let boundary = 1;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const firstLength = words.slice(0, index).join(' ').length;
    const secondLength = words.slice(index).join(' ').length;
    const difference = Math.abs(firstLength - secondLength);
    if (difference < smallestDifference) {
      boundary = index;
      smallestDifference = difference;
    }
  }
  return [words.slice(0, boundary).join(' '), words.slice(boundary).join(' ')];
}

export function buildBroadcastTeamHeroModel(snapshot: BroadcastTeamHeroSnapshot): BroadcastTeamHeroModel {
  const { team, standing } = snapshot;
  const accent = resolveFocusAccent(team.primaryColor, snapshot.league.primaryColor);
  const [primaryName, secondaryName] = splitBroadcastTeamName(team.name);
  const rank = snapshot.rank == null ? '—' : `#${snapshot.rank}`;
  const winPercentage = snapshot.hero.winPercentage == null ? '—' : `${Math.round(snapshot.hero.winPercentage * 100)}%`;
  const streak = snapshot.streak ?? '—';
  const goalsFor = nullableDisplay(standing?.goalsFor);
  const goalsAgainst = nullableDisplay(standing?.goalsAgainst);
  const differential = standing?.goalDifferential == null
    ? '—'
    : nullableDisplay(standing.goalDifferential, standing.goalDifferential > 0 ? '+' : '');
  const record = typeof snapshot.record === 'string' && snapshot.record.trim() && snapshot.record !== 'No games yet'
    ? snapshot.record
    : '—';
  const championshipCount = typeof snapshot.championships.count === 'number' && Number.isFinite(snapshot.championships.count)
    ? snapshot.championships.count
    : null;
  const championshipDisplay = championshipCount == null ? 'x—' : `x${championshipCount}`;
  const championshipLabel = championshipCount == null
    ? 'Championship count unavailable'
    : `${championshipCount} ${championshipCount === 1 ? 'championship' : 'championships'}`;
  const latestChampionship = snapshot.championships.latestTitleSeasonName
    ? `${snapshot.championships.latestTitleSeasonName}${snapshot.championships.latestTitleLabel ? ` (${snapshot.championships.latestTitleLabel})` : ''}`
    : null;
  const heroLabel = [
    team.name,
    record === '—' ? 'record unavailable' : `record ${record}`,
    `rank ${snapshot.rank ?? 'unavailable'}`,
    `streak ${snapshot.streak ?? 'unavailable'}`,
    `win percentage ${winPercentage === '—' ? 'unavailable' : winPercentage}`,
    goalsFor === '—' ? 'goals for unavailable' : `${goalsFor} goals for`,
    goalsAgainst === '—' ? 'goals against unavailable' : `${goalsAgainst} goals against`,
    differential === '—' ? 'goal differential unavailable' : `goal differential ${differential}`,
    championshipLabel,
    latestChampionship ? `latest championship ${latestChampionship}` : null,
  ].filter(Boolean).join(', ');

  return {
    accent,
    primaryName,
    secondaryName,
    record,
    championshipDisplay,
    championshipLabel,
    latestChampionship,
    heroLabel,
    callouts: [
      ['RANK', rank],
      ['STREAK', streak],
      ['WIN PERCENTAGE', winPercentage],
    ],
    ticker: [
      ['GF', goalsFor],
      ['GA', goalsAgainst],
      ['DIFF', differential],
      ['WIN', winPercentage],
    ],
  };
}
