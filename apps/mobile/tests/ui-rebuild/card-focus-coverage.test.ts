import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(`../../src/${relative}`, import.meta.url)), 'utf8');

const verticalScrollRoutes = [
  'screens/HomeScreen.tsx',
  'screens/GamePreviewScreen.tsx',
  'screens/games/GameRecapScreen.tsx',
  'screens/TeamScreen/TeamDetailScreen.tsx',
  'screens/ProfileScreen.tsx',
  'screens/PlayerCardScreen.tsx',
  'screens/EditProfileScreen.tsx',
  'screens/NotificationsFeedScreen.tsx',
  'screens/NotificationSettingsScreen.tsx',
  'screens/stats/CareerStatsScreen.tsx',
  'screens/captain/CaptainDashboardScreen.tsx',
  'screens/captain/GameAvailabilityScreen.tsx',
  'screens/captain/InvitePlayersScreen.tsx',
  'screens/captain/LineupNotesScreen.tsx',
  'screens/discover/LeagueDetailScreen.tsx',
  'screens/league-pages/LeaguePageCommon.tsx',
  'components/AuthShell.tsx',
];

const virtualizedRoutes = [
  'screens/ScheduleScreen.tsx',
  'screens/TeamScreen.tsx',
  'screens/StatsScreen.tsx',
  'screens/stats/LeaderboardsScreen.tsx',
  'screens/team/TeamChatScreen.tsx',
  'screens/discover/LeagueDiscoveryScreen.tsx',
  'screens/auth/LeagueSelectScreen.tsx',
  'screens/league-pages/NewsFeedScreen.tsx',
  'screens/league-pages/GalleryAlbumScreen.tsx',
  'components/LeagueMarketplace.tsx',
];

const handBuiltCardRoutes = [
  'screens/GamePreviewScreen.tsx',
  'screens/games/GameRecapScreen.tsx',
  'screens/TeamScreen.tsx',
  'screens/TeamScreen/TeamDetailScreen.tsx',
  'screens/ProfileScreen.tsx',
  'screens/PlayerCardScreen.tsx',
  'screens/EditProfileScreen.tsx',
  'screens/NotificationsFeedScreen.tsx',
  'screens/NotificationSettingsScreen.tsx',
  'screens/stats/CareerStatsScreen.tsx',
  'screens/captain/CaptainDashboardScreen.tsx',
  'screens/captain/GameAvailabilityScreen.tsx',
  'screens/captain/InvitePlayersScreen.tsx',
  'screens/captain/LineupNotesScreen.tsx',
  'screens/discover/LeagueDetailScreen.tsx',
  'screens/league-pages/TeamsDirectoryScreen.tsx',
  'screens/league-pages/PlayersDirectoryScreen.tsx',
  'screens/league-pages/PlayoffsDirectoryScreen.tsx',
  'screens/league-pages/NewsArticleScreen.tsx',
  'screens/league-pages/LeagueHistoryScreen.tsx',
  'screens/league-pages/GalleryAlbumsScreen.tsx',
  'screens/league-pages/EventsScreen.tsx',
  'screens/league-pages/ContactScreen.tsx',
  'components/AuthShell.tsx',
  'components/StatsLeadersCard.tsx',
];

describe('routed scroll surface wiring', () => {
  for (const file of verticalScrollRoutes) {
    it(`${file} uses the focus-aware vertical ScrollView adapter`, () => {
      assert.match(source(file), /<FocusScrollView\b/);
    });
  }

  for (const file of virtualizedRoutes) {
    it(`${file} keeps virtualization through the focus-aware list adapter`, () => {
      assert.match(source(file), /<FocusFlatList\b/);
    });
  }

  for (const file of handBuiltCardRoutes) {
    it(`${file} registers hand-built eligible cards`, () => {
      assert.match(source(file), /<FocusCard\b/);
    });
  }

  it('shared game cards register as focus candidates without changing GlassSurface semantics', () => {
    const gameCard = source('components/GameCard.tsx');
    assert.match(gameCard, /<FocusCard\b/);
    assert.match(gameCard, /focusId/);
  });

  it('mount reveal no longer starts readable content at opacity zero', () => {
    const reveal = source('components/RevealView.tsx');
    assert.doesNotMatch(reveal, /new Animated\.Value\(0\)/);
    assert.doesNotMatch(reveal, /opacity:\s*progress/);
  });

  it('fails Standings closed without Hockey Life access and keeps active standings rows out of card focus', () => {
    const standings = source('screens/StandingsScreen.tsx');
    const schedule = source('screens/ScheduleScreen.tsx');
    assert.match(standings, /Hockey Life access required/);
    assert.doesNotMatch(standings, /standings:league:/);
    assert.match(schedule, /focusId={`standings:table:/);
  });

  it('treats each schedule game and adjacent check-in as one candidate while excluding sticky headers', () => {
    const schedule = source('screens/ScheduleScreen.tsx');
    assert.match(schedule, /focusId={`schedule:game:/);
    assert.doesNotMatch(schedule, /focusId={`schedule:global-game:/);
    assert.doesNotMatch(schedule, /focusId=.*sticky/);
  });

  it('registers Stats player rows as virtualized candidates in addition to the leaders header', () => {
    const stats = source('screens/StatsScreen.tsx');
    assert.doesNotMatch(stats, /testID="stats-page-list"[\s\S]{0,80}focusItems={false}/);
    assert.match(stats, /<StatsLeadersCard\b/);
  });

  it('pauses modal backgrounds and gives marketplace, gallery, and team modal content an independent owner', () => {
    const marketplace = source('components/LeagueMarketplace.tsx');
    const gallery = source('screens/league-pages/GalleryAlbumScreen.tsx');
    const team = source('screens/TeamScreen/TeamDetailScreen.tsx');
    assert.match(marketplace, /focusEnabled={selectedLeague == null}/);
    assert.match(marketplace, /focusScopeKey={`marketplace-modal:/);
    assert.match(marketplace, /marketplace:membership/);
    assert.match(marketplace, /marketplace:joined/);
    assert.match(gallery, /focusEnabled={photo === null}/);
    assert.match(gallery, /focusScopeKey={`gallery-viewer:/);
    assert.match(team, /focusEnabled={!reminderModalVisible && !subModalVisible && !goalieModalVisible}/);
    assert.match(team, /focusScopeKey={`team-modal:/);
  });
});
