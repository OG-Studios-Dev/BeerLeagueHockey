import { HOCKEY_LIFE_PRIMARY } from '../config/hockeyLife';
import type { RegisteredUserScreen } from '../navigation/screenRegistry';

export const CUT_ICE_EXCLUDED_ROUTES = ['Home', 'TeamDetail', 'LeagueTeamDetail'] as const;

export const CUT_ICE_ROUTE_TITLES: Partial<Record<RegisteredUserScreen, string>> = {
  Splash: 'Hockey Life', Login: 'Sign In', ForgotPassword: 'Reset Password', SignUp: 'Create Account',
  Standings: 'Standings', Schedule: 'Schedule', TeamList: 'Teams', PlayerCard: 'Player Profile',
  ProfileMain: 'My Profile', EditProfile: 'Edit Profile', NotificationsFeed: 'Notifications', NotificationSettings: 'Notification Settings', CareerStats: 'Career Stats',
  StatsMain: 'Stats', Leaderboards: 'Leaderboards', CaptainDashboard: 'Captain Dashboard', GameAvailability: 'Game Availability', InvitePlayers: 'Invite Players', LineupNotes: 'Lineup Notes',
  TeamsDirectory: 'Teams', PlayersDirectory: 'Players', PlayoffsDirectory: 'Playoffs', NewsFeed: 'News', NewsArticle: 'News Article',
  LeagueHistory: 'League History', GalleryAlbums: 'Gallery', GalleryAlbum: 'Gallery Album', Events: 'Events', Contact: 'Contact', GamePreview: 'Game Preview', GameRecap: 'Game Recap',
  LeaguePlayerCard: 'Player Profile', LeagueGamePreview: 'Game Preview',
};

export function resolveCutIceAccent(teamPrimaryColor: unknown) {
  if (typeof teamPrimaryColor !== 'string') return HOCKEY_LIFE_PRIMARY;
  const value = teamPrimaryColor.trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : HOCKEY_LIFE_PRIMARY;
}

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const value = hex.slice(1);
  return (0.2126 * channel(Number.parseInt(value.slice(0, 2), 16)))
    + (0.7152 * channel(Number.parseInt(value.slice(2, 4), 16)))
    + (0.0722 * channel(Number.parseInt(value.slice(4, 6), 16)));
}

function contrast(left: string, right: string) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mixWithWhite(hex: string, amount: number) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `#${channels.map((value) => Math.round(value + ((255 - value) * amount)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function resolveCutIcePalette(teamPrimaryColor: unknown) {
  const source = resolveCutIceAccent(teamPrimaryColor);
  const background = '#06131C';
  let readable = source;
  for (let step = 0; contrast(readable, background) < 4.5 && step < 10; step += 1) {
    readable = mixWithWhite(source, (step + 1) / 10);
  }
  return { source, readable, textContrast: contrast(readable, background) };
}

export function splitCutIceTitle(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const accent = words.pop() ?? '';
  return { base: words.join(' '), accent };
}
