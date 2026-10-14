import type { TeamPageSnapshot } from '../../lib/supabase/teamPage';
import { resolveFocusAccent } from '../../theme/focusAccent';

export type BroadcastTeamHeroSnapshot = {
  team: Pick<TeamPageSnapshot['team'], 'name' | 'primaryColor' | 'secondaryColor'>;
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
  tickerColors: [string, string];
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

export function buildBroadcastTeamHeroModel(snapshot: BroadcastTeamHeroSnapshot): BroadcastTeamHeroModel {
  const { team, standing } = snapshot;
  const accent = resolveFocusAccent(team.primaryColor, snapshot.league.primaryColor);
  const secondaryAccent = resolveFocusAccent(team.secondaryColor, accent);
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
    tickerColors: [accent, secondaryAccent],
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
