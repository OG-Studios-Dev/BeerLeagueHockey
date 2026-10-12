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

const wrappedCardRoutes = [
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

describe('shared card/list layout wiring', () => {
  it('removes the old scroll-position emphasis machinery from the shared component', () => {
    const cardLayout = source('components/CardFocus.tsx');
    assert.doesNotMatch(cardLayout, /Animated|measureInWindow|createCardFocusCoordinator|chooseFocusCandidate|captureMeasurement|emphasis/);
    assert.match(cardLayout, /testID={wrapperTestID}/);
    assert.match(cardLayout, /collapsable={false}/);
  });

  for (const file of verticalScrollRoutes) {
    it(`${file} keeps the shared vertical ScrollView layout adapter`, () => {
      assert.match(source(file), /<FocusScrollView\b/);
    });
  }

  for (const file of virtualizedRoutes) {
    it(`${file} keeps virtualization through the shared list adapter`, () => {
      assert.match(source(file), /<FocusFlatList\b/);
    });
  }

  for (const file of wrappedCardRoutes) {
    it(`${file} keeps stable card wrappers and test IDs`, () => {
      assert.match(source(file), /<FocusCard\b/);
    });
  }

  it('keeps shared game-card layout wrapped without changing GlassSurface semantics', () => {
    const gameCard = source('components/GameCard.tsx');
    assert.match(gameCard, /<FocusCard\b/);
    assert.match(gameCard, /focusId/);
    assert.match(gameCard, /<GlassSurface\b/);
  });

  it('mount reveal does not start readable content at opacity zero', () => {
    const reveal = source('components/RevealView.tsx');
    assert.doesNotMatch(reveal, /new Animated\.Value\(0\)/);
    assert.doesNotMatch(reveal, /opacity:\s*progress/);
  });
});
