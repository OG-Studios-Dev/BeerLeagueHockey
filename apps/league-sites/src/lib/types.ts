/**
 * Platform 2 (League Sites) Type Definitions
 *
 * Types for public-facing league website data
 */

/**
 * Social links configuration stored in league settings
 */
export interface SocialLinks {
  facebook?: string | null;
  twitter?: string | null;
  instagram?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
}

export type ThemePreset = 'dark' | 'light' | 'custom';

/** Selectable background image presets for the public league site */
export type BackgroundPreset = 'none' | 'weekly-games';

/**
 * Website settings stored in league.settings.website
 */
export interface WebsiteSettings {
  themePreset?: ThemePreset;
  backgroundPreset?: BackgroundPreset;
  bannerUrl?: string | null;
  socialFacebook?: string | null;
  socialTwitter?: string | null;
  socialInstagram?: string | null;
  socialYoutube?: string | null;
  socialTiktok?: string | null;
  visiblePages?: Record<string, boolean>;
  seoTitle?: string;
  seoDescription?: string;
  showCaptainPhone?: boolean;
}

/**
 * League settings JSONB structure
 */
export interface LeagueSettings {
  website?: WebsiteSettings;
  fees?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface League {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  description: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  banner_url: string | null;
  font_family: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  timezone: string | null;
  status: 'draft' | 'active' | 'archived';
  organization_id: string;
  created_at: string;
  settings?: LeagueSettings | null;
}

export interface LeagueTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  primaryStrong: string;
  primarySoft: string;
  primaryBorder: string;
  primaryMuted: string;
  secondarySafe: string;
  onPrimary: string;
  onSecondary: string;
  surfaceTint: string;
  surfaceTintStrong: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  fontFamily: string;
  templateVariant: ThemePreset;
}

export interface Season {
  id: string;
  name: string;
  league_id: string;
  start_date: string;
  end_date: string;
  status: 'upcoming' | 'active' | 'playoffs' | 'completed';
  is_current: boolean;
  champion_team_id?: string | null;
  playoff_teams_total?: number | null;
  playoff_teams_per_division?: number | null;
  use_division_playoffs?: boolean | null;
}

export interface Division {
  id: string;
  name: string;
  league_id: string;
  sort_order?: number;
}

export type TeamType = 'standard' | 'free_agents' | 'placeholder' | 'exhibition';

export interface Team {
  id: string;
  name: string;
  slug: string;
  // Color fields - DB uses primary_color/secondary_color, some code uses 'colors'
  colors: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  // Logo fields - DB uses logo_url, some code uses 'logo'
  logo: string | null;
  logo_url?: string | null;
  // Team info
  league_id: string;
  division_id: string | null;
  team_type?: TeamType | null;
  created_at: string;
  // Contact info
  contact_email?: string | null;
  contact_phone?: string | null;
  captain_id?: string | null;
  // Joined data
  division?: Division;
}

export interface TeamStanding {
  team_id: string;
  team_name: string;
  team_logo: string | null;
  division_id: string | null;
  division_name: string | null;
  team_type?: TeamType | null;
  games_played: number;
  wins: number;
  losses: number;
  ties: number;
  overtime_losses: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_differential: number;
  streak: string | null;
  last_10: string | null;
}

export interface Game {
  id: string;
  league_id: string;
  season_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_verification' | 'postponed' | 'cancelled';
  period: number | null;
  period_time: string | null;
  game_type?: string | null;
  created_at: string;
  // Joined data
  home_team?: Team;
  away_team?: Team;
}

export interface Player {
  id: string;
  player_id: string;
  team_id: string;
  jersey_number: number | null;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G' | 'Forward' | 'Defense' | 'Goalie' | null;
  leadership_role: 'captain' | 'alternate_captain' | null;
  is_goalie?: boolean;
  /**
   * Roster membership classification from `team_rosters.player_type`.
   * Only 'regular' counts as a real roster slot on the team page lineup view;
   * 'sub', 'spare', and 'part_time' are treated as spares (see the sort in
   * `splitRosterByRole` and the jersey-slot filter in `TeamLineupView`).
   * Synthetic entries (players found via stats but no roster row) leave this
   * undefined and are also treated as spares.
   */
  player_type?: string | null;
  // Computed properties for backwards compatibility
  is_captain?: boolean;
  is_alternate?: boolean;
  // Joined data
  profile?: {
    id?: string;
    full_name: string | null;
    avatar_url: string | null;
    photo_url?: string | null;
    phone?: string | null;
  };
  team?: Team & {
    league_id: string;
  };
}

export interface PlayerStats {
  player_id: string;
  player_name: string;
  team_name: string;
  team_id: string;
  position: string | null;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  penalty_minutes: number;
  plus_minus: number;
  // Goalie stats
  wins?: number;
  losses?: number;
  ties?: number;
  saves?: number;
  goals_against?: number;
  save_percentage?: number;
  goals_against_average?: number;
  shutouts?: number;
}

export interface PlayerStatsWithAvatar extends PlayerStats {
  avatar_url: string | null;
}

export interface HomepageSeasonLeader extends PlayerStatsWithAvatar {
  division_name: string | null;
}

export interface LeagueStats {
  totalTeams: number;
  totalPlayers: number;
  totalGames: number;
  gamesPlayed: number;
  upcomingGames: number;
}

export interface UpcomingGame extends Game {
  home_team: Team;
  away_team: Team;
}

export interface RecentGame extends Game {
  home_team: Team;
  away_team: Team;
}

/**
 * WeekPickerDay - Day data for schedule week navigation
 */
export interface WeekPickerDay {
  date: string; // ISO date string (YYYY-MM-DD)
  dayName: string; // "Mon", "Tue", etc.
  dayNumber: number; // 1-31
  gameCount: number;
}

/**
 * TickerGame - Game data for the score ticker component
 * Includes team info with division data for display
 */
export interface TickerGame {
  id: string;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_verification' | 'postponed' | 'cancelled';
  game_type?: string | null;
  home_team: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    colors: string | null;
    division_id: string | null;
    divisions: { name: string } | null;
  } | null;
  away_team: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    colors: string | null;
    division_id: string | null;
    divisions: { name: string } | null;
  } | null;
}

/**
 * ScheduleGame - Game data for the schedule table
 * Includes team and division info for display
 */
export interface ScheduleGame {
  id: string;
  league_id: string;
  season_id: string;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_verification' | 'postponed' | 'cancelled';
  game_type?: string | null;
  division_id?: string | null;
  home_team: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    colors: string | null;
  } | null;
  away_team: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    colors: string | null;
  } | null;
  division?: {
    id: string;
    name: string;
  } | null;
}

/**
 * TeamWithStats - Team with division data for game preview
 */
export interface TeamWithStats {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  colors: string | null;
  division?: {
    id: string;
    name: string;
  } | null;
}

/**
 * GamePreview - Full game data for preview page
 */
export interface GamePreview {
  id: string;
  league_id: string;
  season_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_verification' | 'postponed' | 'cancelled';
  period: number | null;
  period_time: string | null;
  game_type?: string | null;
  playoff_series_id?: string | null;
  created_at: string;
  home_team: TeamWithStats;
  away_team: TeamWithStats;
}

/**
 * SeasonSeriesGame - Game result for season series history
 */
export interface SeasonSeriesGame {
  id: string;
  scheduled_at: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
}

/**
 * TeamSeasonStats - Calculated team stats for a season
 */
export interface TeamSeasonStats {
  games_played: number;
  wins: number;
  losses: number;
  ties: number;
  overtime_losses: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goals_per_game: number;
  goals_against_per_game: number;
  power_play_pct: number | null;
  penalty_kill_pct: number | null;
}

/**
 * PlayerStat - Player stat leader for comparison
 */
export interface PlayerStat {
  player_id: string;
  player_name: string;
  jersey_number: string | null;
  position: string | null;
  avatar_url?: string | null;
  team_id?: string;
  value: number;
  stat_type?: 'points' | 'goals' | 'assists';
}

// =============================================================================
// BMHL Template Types - Additional
// =============================================================================

/**
 * TickerTeam - Team data for score ticker
 */
export interface TickerTeam {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  colors: string | null;
  division_id: string | null;
  divisions: { name: string } | null;
}

/**
 * Schedule Filters
 */
export interface ScheduleFilterState {
  season?: string;
  division?: string;
  type?: 'regular' | 'playoffs' | 'exhibition';
}

/**
 * Season Series
 */
export interface SeasonSeries {
  games: SeasonSeriesGame[];
  teamAWins: number;
  teamBWins: number;
  ties: number;
}

/**
 * Goalie Stats
 */
export interface GoalieStats {
  player_id: string;
  player_name: string;
  jersey_number: string | null;
  avatar_url?: string | null;
  team_id: string;
  team_name?: string;
  team_logo?: string | null;
  games_played: number;
  wins: number;
  losses: number;
  ties?: number;
  save_percentage: number;
  goals_against_average: number;
  shutouts: number;
  saves?: number;
  goals_against?: number;
}

export interface GoalieStatsWithDivision extends GoalieStats {
  division_name: string | null;
}

export type StatsMode = 'skaters' | 'goalies';
export type StatsSortDirection = 'asc' | 'desc';

export type SkaterStatKey =
  | 'games_played'
  | 'goals'
  | 'assists'
  | 'points'
  | 'championships'
  | 'points_per_game'
  | 'goals_per_game'
  | 'assists_per_game'
  | 'penalty_minutes'
  | 'plus_minus'
  | 'power_play_goals'
  | 'power_play_assists'
  | 'power_play_points'
  | 'short_handed_goals'
  | 'short_handed_assists'
  | 'game_winning_goals'
  | 'empty_net_goals'
  | 'shots'
  | 'shots_per_game';

export type GoalieStatKey =
  | 'games_played'
  | 'wins'
  | 'losses'
  | 'championships'
  | 'save_percentage'
  | 'goals_against_average'
  | 'shutouts'
  | 'saves'
  | 'goals_against';

export type StatsTableColumnKey = SkaterStatKey | GoalieStatKey;

export interface StatsTableColumn<TKey extends string> {
  key: TKey;
  label: string;
  align?: 'left' | 'center' | 'right';
  defaultSortDirection?: StatsSortDirection;
}

export interface UnifiedStatsRowBase {
  player_id: string;
  /** Public profile identity when the canonical row is backed by a navigable profile. */
  profile_id?: string | null;
  /** True only when the profile identity is proven to belong to this league's historical dataset. */
  profile_id_league_verified?: boolean;
  player_name: string;
  avatar_url: string | null;
  jersey_number?: string | null;
  team_id: string;
  team_name: string;
  display_team_logo_url?: string | null;
  display_team_name?: string | null;
  display_team_is_free_agent?: boolean;
  division_name: string | null;
  position: string | null;
  championships: number;
}

export interface UnifiedSkaterStatsRow extends UnifiedStatsRowBase {
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  points_per_game: number;
  goals_per_game: number;
  assists_per_game: number;
  penalty_minutes: number;
  plus_minus: number;
  power_play_goals: number;
  power_play_assists: number;
  power_play_points: number;
  short_handed_goals: number;
  short_handed_assists: number;
  game_winning_goals: number;
  empty_net_goals: number;
  shots: number;
  shots_per_game: number;
}

export interface UnifiedGoalieStatsRow extends UnifiedStatsRowBase {
  games_played: number;
  wins: number;
  losses: number;
  saves: number;
  goals_against: number;
  save_percentage: number | null;
  goals_against_average: number | null;
  save_percentage_provenance?: 'measured' | 'estimated' | 'unmeasured';
  goals_against_average_provenance?: 'measured' | 'estimated' | 'unmeasured';
  shutouts: number;
}

/**
 * Player Game Log Entry
 */
export interface PlayerGameLogEntry {
  game_id: string;
  date: string;
  opponent?: string;
  opponent_name?: string;
  opponent_logo?: string | null;
  is_home?: boolean;
  result: 'W' | 'L' | 'T' | 'OTL' | '-';
  score?: string; // "5-3"
  goals: number;
  assists: number;
  points: number;
  pim?: number;
  penalty_minutes?: number;
  plus_minus: number;
  // Goalie specific
  saves?: number;
  goals_against?: number;
  save_percentage?: number;
}

/**
 * Player with extended team data
 */
export interface PlayerWithTeam extends Player {
  team?: Team & {
    league_id: string;
  };
}

/**
 * Score game for scores page (recent completed games)
 */
export interface ScoreGame extends RecentGame {
  overtime?: boolean;
  shootout?: boolean;
}

// =============================================================================
// Advanced Stats, Suspensions, and Content Types
// =============================================================================

/** Special teams stats from DB view */
export interface SpecialTeamsLeader {
  league_id: string;
  season_id: string;
  player_id: string;
  team_id: string;
  full_name: string;
  avatar_url?: string | null;
  pp_goals: number;
  pp_assists: number;
  pp_points: number;
  sh_goals: number;
  sh_assists: number;
  gwg: number;
  eng: number;
}

/** Suspension record */
export interface Suspension {
  id: string;
  player_id: string;
  league_id: string;
  team_id: string | null;
  season_id: string | null;
  game_id: string | null;
  reason: string;
  games_remaining: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  issued_by: string | null;
  created_at: string;
  player?: { full_name: string; avatar_url: string | null } | null;
  team?: { name: string; logo_url: string | null } | null;
}

/** News article */
export interface NewsArticle {
  id: string;
  title: string;
  content: string;
  excerpt: string | null;
  image_url: string | null;
  slug: string | null;
  author_id: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  type: string;
  league_id: string;
  author?: { full_name: string; avatar_url: string | null } | null;
  game_id?: string | null;
  division_id?: string | null;
  season_id?: string | null;
}

export interface ArticleLinkablePlayer {
  id: string;
  fullName: string;
}

export interface ArticleLinkableTeam {
  id: string;
  name: string;
  slug: string;
}

export interface ArticleLinkableGame {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
}

export interface ArticleLinkContext {
  players: ArticleLinkablePlayer[];
  teams: ArticleLinkableTeam[];
  games: ArticleLinkableGame[];
  primaryGame: ArticleLinkableGame | null;
}

/** League event */
export interface LeagueEvent {
  id: string;
  league_id: string;
  title: string;
  description: string | null;
  event_type: string;
  location: string | null;
  start_time: string;
  end_time: string | null;
  is_published: boolean;
  created_at: string;
}

/** Gallery album */
export interface GalleryAlbum {
  id: string;
  league_id: string;
  season_id: string | null;
  title: string;
  description: string | null;
  cover_photo_url: string | null;
  is_published: boolean;
  created_at: string;
  photo_count?: number;
}

/** Gallery photo */
export interface GalleryPhoto {
  id: string;
  gallery_id: string;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  display_order: number;
  created_at: string;
}

/** Photo with album metadata for homepage reel */
export interface ReelPhoto {
  id: string;
  url: string;
  caption: string | null;
  album_id: string;
  album_title: string;
  album_href: string;
}

/** Staff member */
export interface StaffMember {
  id: string;
  league_id: string;
  name: string;
  role_title: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  bio: string | null;
  display_order: number;
  is_active: boolean;
}

/** Sponsor */
export interface LeagueSponsor {
  id: string;
  league_id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

// =============================================================================
// Game Sheet Types
// =============================================================================

/**
 * Per-game player stats from the player_stats table
 */
export interface GamePlayerStats {
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  team_id: string;
  team_name: string;
  jersey_number: string | null;
  position: string | null;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  penalty_minutes: number;
  plus_minus: number;
  power_play_goals: number;
  power_play_assists: number;
  short_handed_goals: number;
  short_handed_assists: number;
  empty_net_goals: number;
  game_winning_goals: number;
}

export interface GameSheetGoal {
  period: number;
  time: string | null;
  scorer: { id: string; name: string };
  assist1: { id: string; name: string } | null;
  assist2: { id: string; name: string } | null;
  team_id: string;
  team_name: string;
  is_power_play: boolean;
  is_short_handed: boolean;
  is_empty_net: boolean;
}

export interface GameSheetPenalty {
  period: number;
  time: string | null;
  player: { id: string; name: string };
  team_id: string;
  team_name: string;
  infraction: string;
  minutes: number;
}

export interface GameSheetGoalie {
  player_id: string;
  player_name: string;
  team_id: string;
  team_name: string;
  saves: number;
  goals_against: number;
  shots_against: number;
  save_percentage: number;
}

export interface GameSheetData {
  game: GamePreview & {
    scorekeeper_notes: string | null;
    period_count: number | null;
  };
  goals: GameSheetGoal[];
  penalties: GameSheetPenalty[];
  goalies: GameSheetGoalie[];
  scoresheetImageUrl: string | null;
  scoresheetImageUrls: string[];
}

// =============================================================================
// Player Badge Types
// =============================================================================

export type BadgeType =
  | 'championship'
  | 'top_scorer'
  | 'points_leader'
  | 'top_goalie'
  | 'iron_man'
  | 'most_assists'
  | 'best_plus_minus'
  | 'penalty_free'
  | 'division_top_scorer'
  | 'division_points_leader'
  | 'division_top_goalie'
  | 'team_mvp'
  | 'rookie_of_the_year'
  | 'hall_of_fame'
  | 'shutout_king';

export interface PlayerBadge {
  id: string;
  player_id: string;
  league_id: string;
  season_id: string;
  team_id: string;
  badge_type: BadgeType;
  metadata: Record<string, any>;
  created_at: string;
  season?: { name: string } | null;
  team?: { name: string; logo_url: string | null; slug: string } | null;
}

/** Award */
export interface LeagueAward {
  id: string;
  league_id: string;
  season_id: string | null;
  player_id: string | null;
  team_id: string | null;
  award_name: string;
  category: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
  player?: { full_name: string; avatar_url: string | null } | null;
  team?: { name: string; logo_url: string | null; division?: { name: string | null } | null } | null;
  season?: { name: string } | null;
  roster_position?: string | null;
  roster_jersey_number?: number | null;
  division_name?: string | null;
}
