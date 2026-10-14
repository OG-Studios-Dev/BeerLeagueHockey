import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import colors from '../../src/theme/colors.ts';
import { getSurfacePalette } from '../../src/theme/ui.ts';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(`../../src/${relative}`, import.meta.url)), 'utf8');

const transparentFoundationScreens = [
  'screens/HomeScreen.tsx',
  'screens/StandingsScreen.tsx',
  'screens/ScheduleScreen.tsx',
  'screens/StatsScreen.tsx',
  'screens/stats/LeaderboardsScreen.tsx',
  'screens/stats/CareerStatsScreen.tsx',
  'screens/TeamScreen.tsx',
  'screens/TeamScreen/TeamDetailScreen.tsx',
  'screens/ProfileScreen.tsx',
  'screens/PlayerCardScreen.tsx',
  'screens/EditProfileScreen.tsx',
  'screens/NotificationsFeedScreen.tsx',
  'screens/NotificationSettingsScreen.tsx',
  'screens/GamePreviewScreen.tsx',
  'screens/games/GameRecapScreen.tsx',
  'screens/captain/CaptainDashboardScreen.tsx',
  'screens/captain/GameAvailabilityScreen.tsx',
  'screens/league-pages/LeaguePageCommon.tsx',
];

describe('mobile-wide league visual foundation', () => {
  it('uses Home-approved translucent surfaces as the shared palette with opaque accessibility fallbacks', () => {
    assert.deepEqual(
      {
        surface: colors.bgSurface,
        elevated: colors.bgElevated,
        stroke: colors.glassStrokeStrong,
      },
      {
        surface: 'rgba(10, 22, 40, 0.30)',
        elevated: 'rgba(12, 27, 49, 0.38)',
        stroke: 'rgba(125, 190, 255, 0.22)',
      },
    );
    assert.equal(colors.bgInteractive, '#1C2A42', 'semantic controls remain opaque');
    assert.deepEqual(getSurfacePalette(false), {
      surface: colors.bgSurface,
      elevated: colors.bgElevated,
      interactive: 'rgba(7, 17, 31, 0.78)',
      stroke: colors.glassStrokeStrong,
    });
    assert.deepEqual(getSurfacePalette(true), {
      surface: '#0C1B31',
      elevated: '#0A1628',
      interactive: '#1C2A42',
      stroke: '#41607F',
    });
  });

  it('installs one shared backdrop behind transparent authenticated navigation scenes', () => {
    const navigation = source('navigation/index.tsx');
    const app = source('../App.tsx');
    const home = source('screens/HomeScreen.tsx');
    assert.equal((navigation.match(/<LeagueBackdrop\b/g) ?? []).length, 1);
    assert.match(navigation, /<LeagueBackdrop\s+accentColor={homeAccent}/);
    assert.match(navigation, /const \{ homeAccent \} = useMobileShellData\(\)/);
    assert.match(navigation, /sceneStyle:\s*styles\.transparentScene/);
    assert.match(navigation, /contentStyle:\s*styles\.transparentScene/);
    assert.match(app, /contentStyle:\s*styles\.navigationCanvas/);
    assert.match(app, /navigationCanvas:\s*\{\s*backgroundColor:\s*'transparent'/);
    assert.doesNotMatch(home, /HomeArenaBackdrop|home-arena-backdrop|home-atmospheric-glow/);
  });

  for (const file of transparentFoundationScreens) {
    it(`${file} does not paint an opaque page foundation over the shared backdrop`, () => {
      const text = source(file);
      assert.doesNotMatch(text, /(?:safeArea|safe):\s*\{[^}]*backgroundColor:\s*colors\.bgBase/);
      assert.doesNotMatch(text, /<SafeAreaView[^>]*backgroundColor:\s*(?:activeTheme\.backgroundColor|colors\.bgBase|visuals\.canvas)/);
    });
  }

  it('removes competing full-page atmospheres from authenticated screens', () => {
    for (const file of transparentFoundationScreens) {
      assert.doesNotMatch(source(file), /<BrandAtmosphere\b/, file);
    }
  });

  it('keeps Team public panels translucent and its reduced-transparency composition opaque', () => {
    const publicPage = source('screens/TeamScreen/TeamPublicPage.tsx');
    const scheduleCard = source('components/ScheduleMatchupCard.tsx');
    const teamDetail = source('screens/TeamScreen/TeamDetailScreen.tsx');
    assert.match(publicPage, /compositionOpaque:\s*\{\s*backgroundColor:\s*'#03070D'/);
    assert.match(publicPage, /readingPanel:[^\n]*backgroundColor:\s*colors\.bgSurface/);
    assert.match(publicPage, /<ScheduleMatchupCard/);
    assert.match(scheduleCard, /getHomeVisualPreferences\(reduceTransparency, false\)/);
    assert.match(scheduleCard, /backgroundColor:\s*preferences\.surface/);
    assert.match(publicPage, /rivalPanel:[^\n]*backgroundColor:\s*colors\.bgSurface/);
    assert.match(publicPage, /emptyPanel:[^\n]*backgroundColor:\s*colors\.bgSurface/);
    assert.match(teamDetail, /const publicSurface = getSurfacePalette\(reduceTransparency\)/);
    assert.match(teamDetail, /styles\.publicStateCard,\s*\{ backgroundColor: publicSurface\.surface, borderColor: publicSurface\.stroke \}/);
    assert.doesNotMatch(teamDetail, /_publicSurface/);
  });

  it('keeps the interactive league directory cards opaque', () => {
    const directory = source('screens/league-pages/PlayersDirectoryScreen.tsx');
    assert.match(directory, /card:[^\n]*backgroundColor:\s*colors\.bgInteractive/);
  });

  it('keeps media canvases and modal sheets on explicit opaque semantic tokens', () => {
    assert.equal(colors.bgMedia, '#0C1B31');
    assert.equal(colors.bgModal, '#0A1628');
    assert.match(source('screens/league-pages/NewsArticleScreen.tsx'), /hero:[^\n]*backgroundColor:\s*colors\.bgMedia/);
    assert.match(source('components/NativeNewspaperEdition.tsx'), /artwork:[^\n]*backgroundColor:\s*colors\.bgMedia/);
    assert.match(source('components/PlayerProfile/SeasonPicker.tsx'), /sheet:[^\n]*backgroundColor:\s*colors\.bgModal/);
    assert.match(source('screens/captain/GameAvailabilityScreen.tsx'), /modal:[^\n]*backgroundColor:\s*colors\.bgModal/);
    assert.match(source('screens/HomeScreen.tsx'), /photo:\s*\{[^}]*backgroundColor:\s*colors\.bgMedia/);
    assert.match(source('screens/PlayerCardScreen.tsx'), /articleImage:\s*\{[^}]*backgroundColor:\s*colors\.bgMedia/);
    const players = source('screens/league-pages/PlayersDirectoryScreen.tsx');
    assert.match(players, /portraitFrame:\s*\{[^}]*backgroundColor:\s*colors\.bgMedia/);
    assert.match(players, /portraitFallback:\s*\{[^}]*backgroundColor:\s*colors\.bgMedia/);
    assert.match(players, /modalOptionSelected:\s*\{\s*backgroundColor:\s*colors\.bgControlOpaque/);
  });

  it('keeps composite card surfaces accessibility-aware and semantic controls opaque', () => {
    for (const file of [
      'components/TeamPositioningChart.tsx',

      'components/PlayerRow.tsx',
      'components/ScheduleConflictList.tsx',

    ]) {
      const contents = source(file);
      assert.match(contents, /useAccessibilityPreferences/, file);
      assert.match(contents, /getSurfacePalette\(reduceTransparency\)/, file);
    }
    const selectable = source('components/SelectableControl.tsx');
    assert.match(selectable, /inactive:\s*\{[^}]*backgroundColor:\s*colors\.bgInteractive/);
    assert.match(selectable, /selected:\s*\{[^}]*backgroundColor:\s*'rgba\(142,127,255,0\.28\)'/);
    for (const file of ['components/QuickCheckinActions.tsx', 'components/PillToggle.tsx', 'components/PlayerProfile/CareerTrendChart.tsx']) {
      assert.match(source(file), /SelectableControl/);
    }
    assert.match(source('components/PlayerProfile/SeasonPicker.tsx'), /trigger:\s*\{[^}]*backgroundColor:\s*colors\.bgInteractive/);
  });
});
