import colors from './colors';

export type LeagueTheme = {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  logoUrl: string | null;
  leagueName: string;
};

export const BLH_THEME: LeagueTheme = {
  primaryColor: colors.brandRink,
  secondaryColor: colors.brandArena,
  backgroundColor: colors.bgBase,
  cardColor: colors.bgSurface,
  textColor: colors.textPrimary,
  logoUrl: null,
  leagueName: 'Hockey Life',
};

export const SAMPLE_LEAGUE_THEME: LeagueTheme = {
  primaryColor: colors.brandGold,
  secondaryColor: colors.brandArena,
  backgroundColor: colors.bgBase,
  cardColor: colors.bgSurface,
  textColor: colors.textPrimary,
  logoUrl: null,
  leagueName: 'Woodbridge Old Timers',
};
