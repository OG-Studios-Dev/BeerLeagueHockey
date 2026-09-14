export type PlayerCardParams = {
  playerId: string;
  leagueId?: string | null;
};

export type ScheduleStackParamList = {
  ScheduleList: undefined;
  GamePreview: { gameId: string };
  GameRecap: { gameId: string };
};

export type TeamStackParamList = {
  TeamList: undefined;
  TeamDetail: { teamId: string; leagueId: string };
  PlayerCard: PlayerCardParams;
  TeamChat: { teamId: string; leagueId: string; teamName: string };
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  EditProfile: undefined;
  NotificationsFeed: undefined;
  NotificationSettings: undefined;
  LeagueMarketplace: undefined;
  PlayerCard: PlayerCardParams;
  CareerStats: undefined;
};

export type DiscoverStackParamList = {
  DiscoverMain: undefined;
  LeagueDetail: { leagueId: string };
};

export type StatsStackParamList = {
  StatsMain: undefined;
  Leaderboards: undefined;
  CareerStats: undefined;
};

export type CaptainStackParamList = {
  CaptainDashboard: undefined;
  GameAvailability: { gameId: string; teamId: string; leagueId: string };
  InvitePlayers: { teamId: string; leagueId: string; teamName: string };
  LineupNotes: { gameId: string; teamId: string; opponentName?: string };
  TeamChat: { teamId: string; leagueId: string; teamName: string };
};

export type LeaguePageScopeParams = { leagueId: string; leagueSlug: string };

export type LeaguePagesStackParamList = {
  TeamsDirectory: LeaguePageScopeParams;
  PlayersDirectory: LeaguePageScopeParams;
  PlayoffsDirectory: LeaguePageScopeParams;
  NewsFeed: LeaguePageScopeParams;
  NewsArticle: LeaguePageScopeParams & { articleSlug: string };
  LeagueHistory: LeaguePageScopeParams;
  GalleryAlbums: LeaguePageScopeParams;
  GalleryAlbum: LeaguePageScopeParams & { albumId: string };
  LeagueTeamDetail: { teamId: string; leagueId: string };
  LeaguePlayerCard: PlayerCardParams;
  LeagueGamePreview: { gameId: string };
  TeamChat: { teamId: string; leagueId: string; teamName: string };
};
