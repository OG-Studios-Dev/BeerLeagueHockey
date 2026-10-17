import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const screen = readFileSync(new URL('../../src/screens/StatsScreen.tsx', import.meta.url).pathname, 'utf8');
const sharedLeaders = readFileSync(new URL('../../src/components/LeagueLeadersPresentation.tsx', import.meta.url).pathname, 'utf8');
const homeLeaders = readFileSync(new URL('../../src/components/HomeLeagueLeaders.tsx', import.meta.url).pathname, 'utf8');
const rankedRow = readFileSync(new URL('../../src/components/StatsRankedRow.tsx', import.meta.url).pathname, 'utf8');
const role = readFileSync(new URL('../../src/components/StatsRoleToggle.tsx', import.meta.url).pathname, 'utf8');
const timeline = readFileSync(new URL('../../src/components/StatsTimelineFilter.tsx', import.meta.url).pathname, 'utf8');

function occurrences(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

describe('approved Stats redesign source contract', () => {
  it('uses the shared Home presentation with explicit Stats defaults and an explicit heading API', () => {
    assert.match(screen, /import LeagueLeadersPresentation from ['"]\.\.\/components\/LeagueLeadersPresentation['"]/);
    assert.match(screen, /<LeagueLeadersPresentation/);
    assert.doesNotMatch(screen, /StatsLeadersCard|stats-metric-selector/);
    assert.match(screen, /testIDPrefix="stats"/);
    assert.match(screen, /focusPrefix="stats"/);
    assert.match(screen, /showAllStats=\{false\}/);
    assert.match(screen, /compactMetricTabs/);
    assert.match(screen, /visibleLeaderLimit=\{5\}/);
    assert.match(screen, /rowVariant="home-inline"/);
    assert.match(screen, /headingAccessory=\{roleToggle\}/);
    assert.match(screen, /metricTabsAccessibilityLabel="Stats League Leader metric"/);
    assert.match(sharedLeaders, /headingAccessory\?: React\.ReactNode/);
    assert.match(sharedLeaders, /metricTabsAccessibilityLabel\?: string/);
    assert.doesNotMatch(sharedLeaders, /testIDPrefix === ['"]home['"]/);
  });

  it('preserves the Home wrapper compact top-five defaults explicitly', () => {
    assert.match(homeLeaders, /testIDPrefix="home"/);
    assert.match(homeLeaders, /focusPrefix="home"/);
    assert.match(homeLeaders, /showAllStats=\{false\}/);
    assert.match(homeLeaders, /compactMetricTabs/);
    assert.match(homeLeaders, /visibleLeaderLimit=\{5\}/);
    assert.match(homeLeaders, /rowVariant="home-inline"/);
    assert.match(homeLeaders, /metricTabsAccessibilityLabel="Home League Leader metric"/);
  });

  it('uses approved image artwork for truthful role tabs without visible role labels', () => {
    assert.match(timeline, /name="time-outline"/);
    assert.match(timeline, /accessibilityLabel=\{`Open timeline filter\. \$\{label\}`\}/);
    assert.doesNotMatch(timeline, /<Text[^>]*>Timeline<\/Text>/);
    assert.match(role, /import playerRoleArt from ['"]\.\.\/\.\.\/assets\/stats-role\/player-a\.png['"]/);
    assert.match(role, /import goalieRoleArt from ['"]\.\.\/\.\.\/assets\/stats-role\/goalie-c\.png['"]/);
    assert.equal(occurrences(role, /<Image/g), 2);
    assert.equal(occurrences(role, /accessibilityRole="tab"/g), 2);
    assert.match(role, /accessibilityState=\{\{ selected: role === 'player' \}\}/);
    assert.match(role, /accessibilityState=\{\{ selected: role === 'goalie' \}\}/);
    assert.doesNotMatch(role, />Player<|>Goalie</);
  });

  it('keeps the timeline separate and right-aligned while both headings receive the synchronized role toggle', () => {
    assert.match(screen, /testID="stats-timeline-control-row"/);
    assert.match(screen, /timelineControlRow: \{[^}]*justifyContent: 'flex-end'/);
    assert.match(screen, /headingAccessory=\{roleToggle\}/);
    assert.match(screen, /testID="stats-complete-heading"[^>]*>.*\{roleToggle\}/s);
    assert.doesNotMatch(screen, /stats-role-controls/);
  });

  it('renders one complete metric-ranked list with complete truthful metrics and player-card navigation', () => {
    assert.match(screen, /buildRankedRows/);
    assert.match(screen, /<StatsRankedRow/);
    assert.match(screen, /showChampionships=\{showChampionships\}/);
    assert.match(screen, /'Goalie Stats' : 'Player Stats'/);
    assert.doesNotMatch(screen, /StatsTable|stats-leaderboards-action|Leaderboards|<PillToggle/);
    assert.match(rankedRow, /buildSkaterRows/);
    assert.match(rankedRow, /buildGoalieRows/);
    assert.match(rankedRow, /'Champs'/);
    assert.match(rankedRow, /stats-ranked-row-/);
    assert.match(rankedRow, /Open player card/);
    assert.match(screen, /Unavailable selected values are excluded/);
    assert.match(screen, /Unavailable GAA values are excluded/);
    assert.doesNotMatch(screen, /estimated selected values|estimated GAA values/i);
  });

  it('keeps the stats page within its viewport and preserves player-card navigation', () => {
    assert.match(screen, /horizontalOverflow/);
    assert.match(screen, /navigateToPlayerCard/);
    assert.match(rankedRow, /width: '100%'/);
    assert.match(rankedRow, /minWidth: 0/);
    assert.match(rankedRow, /flexWrap: 'wrap'/);
  });
});
