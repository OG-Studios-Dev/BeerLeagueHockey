import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url).pathname, 'utf8');

describe('mobile section heading typography contract', () => {
  it('defines one reusable upright system-sans 22/28 title contract without the legacy eyebrow', () => {
    const source = read('components/SectionHeader.tsx');
    assert.match(source, /export const SECTION_HEADING_TEXT_STYLE/);
    assert.match(source, /fontSize:\s*22/);
    assert.match(source, /lineHeight:\s*28/);
    assert.match(source, /fontWeight:\s*['"]800['"]/);
    assert.match(source, /fontStyle:\s*['"]normal['"]/);
    assert.match(source, /accessibilityRole="header"/);
    assert.doesNotMatch(source, /HOCKEY LIFE|eyebrow|fontFamily/);
  });

  it('applies the shared contract to actual section-heading aliases across mobile surfaces', () => {
    const included = [
      'screens/HomeScreen.tsx', 'components/HomeLeagueLeaders.tsx', 'components/StatsLeadersCard.tsx',
      'screens/StandingsScreen.tsx', 'components/StandingsPlayoffsPanel.tsx', 'screens/TeamScreen/TeamPublicPage.tsx',
      'screens/league-pages/LeaguePageCommon.tsx', 'screens/auth/LeagueSelectScreen.tsx', 'screens/StatsScreen.tsx',
      'screens/stats/CareerStatsScreen.tsx', 'screens/captain/GameAvailabilityScreen.tsx',
      'screens/GamePreviewScreen.tsx', 'screens/games/GameRecapScreen.tsx', 'components/LeagueMarketplace.tsx',
    ];
    for (const path of included) {
      assert.match(read(path), /SECTION_HEADING_TEXT_STYLE/, `${path} must consume the shared section heading contract`);
    }
  });

  it('styles the rendered Your leagues heading with the shared contract at its exact call site', () => {
    const marketplace = read('components/LeagueMarketplace.tsx');
    assert.match(
      marketplace,
      /<Text accessibilityRole="header" style=\{styles\.joinedLeaguesTitle\}>Your leagues<\/Text>/,
      'Your leagues must be rendered as a semantic section heading through its dedicated style alias',
    );
    assert.match(
      marketplace,
      /joinedLeaguesTitle:\s*\{\s*\.\.\.SECTION_HEADING_TEXT_STYLE,\s*color:\s*colors\.textSecondary,?\s*\}/,
      'the exact Your leagues style alias must consume the shared 22/28 heading token',
    );
    assert.doesNotMatch(
      marketplace,
      /<Text[^>]*style=\{styles\.sectionEyebrow\}[^>]*>Your leagues<\/Text>/,
      'Your leagues must not fall back to the legacy 11dp uppercase eyebrow',
    );
  });

  it('removes Home heading decoration and season copy while retaining the title and leader season prop semantics', () => {
    const home = read('screens/HomeScreen.tsx');
    const leaders = read('components/HomeLeagueLeaders.tsx');
    for (const removed of ['LATEST', 'AROUND THE LEAGUE', 'TABLE', 'FROM THE RINK', 'CONNECT']) assert.doesNotMatch(home, new RegExp(`>${removed}<|eyebrow="${removed}"`));
    assert.doesNotMatch(leaders, />LEAGUE<|\{seasonName \? <Text/);
    assert.match(leaders, /seasonName/);
    assert.match(leaders, />League Leaders</);
  });

  it('leaves page titles and published newspaper content explicitly outside the shared contract', () => {
    assert.doesNotMatch(read('components/CutIceTitle.tsx'), /SECTION_HEADING_TEXT_STYLE/);
    assert.doesNotMatch(read('components/NativeNewspaperEdition.tsx'), /SECTION_HEADING_TEXT_STYLE/);
  });
});
