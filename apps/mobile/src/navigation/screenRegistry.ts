export const REGISTERED_USER_SCREENS = [
  'Splash', 'Login', 'ForgotPassword', 'SignUp',
  'Home', 'Standings', 'Schedule', 'TeamList', 'TeamDetail', 'PlayerCard',
  'ProfileMain', 'EditProfile', 'NotificationsFeed', 'NotificationSettings', 'CareerStats',
  'StatsMain', 'Leaderboards', 'CaptainDashboard', 'GameAvailability',
  'TeamsDirectory', 'PlayersDirectory', 'PlayoffsDirectory', 'NewsFeed', 'NewsArticle',
  'LeagueHistory', 'GalleryAlbums', 'GalleryAlbum', 'Events', 'Contact', 'GamePreview', 'GameRecap',
  'LeagueTeamDetail', 'LeaguePlayerCard', 'LeagueGamePreview',
] as const;

export type RegisteredUserScreen = (typeof REGISTERED_USER_SCREENS)[number];
