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
  tickerTextColors: [string, string, string, string];
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

function interpolateHexColor(start: string, end: string, ratio: number): string {
  const channel = (offset: number) => Math.round(
    parseInt(start.slice(offset, offset + 2), 16)
      + (parseInt(end.slice(offset, offset + 2), 16) - parseInt(start.slice(offset, offset + 2), 16)) * ratio,
  ).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

function guaranteedContrastTextColor(background: string): '#000000' | '#FFFFFF' {
  const channels = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}

export function buildBroadcastTeamHeroModel(snapshot: BroadcastTeamHeroSnapshot): BroadcastTeamHeroModel {
  const { team, standing } = snapshot;
  const accent = resolveFocusAccent(team.primaryColor, snapshot.league.primaryColor);
  const secondaryAccent = resolveFocusAccent(team.secondaryColor, accent);
  const tickerTextColors = [0.125, 0.375, 0.625, 0.875].map((ratio) =>
    guaranteedContrastTextColor(interpolateHexColor(accent, secondaryAccent, ratio)),
  ) as [string, string, string, string];
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
    tickerTextColors,
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
