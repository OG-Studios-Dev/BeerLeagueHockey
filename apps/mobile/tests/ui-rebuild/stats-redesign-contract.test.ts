import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const screen = readFileSync(new URL('../../src/screens/StatsScreen.tsx', import.meta.url).pathname, 'utf8');
const leaders = readFileSync(new URL('../../src/components/StatsLeadersCard.tsx', import.meta.url).pathname, 'utf8');
const rankedRow = readFileSync(new URL('../../src/components/StatsRankedRow.tsx', import.meta.url).pathname, 'utf8');
const role = readFileSync(new URL('../../src/components/StatsRoleToggle.tsx', import.meta.url).pathname, 'utf8');
const timeline = readFileSync(new URL('../../src/components/StatsTimelineFilter.tsx', import.meta.url).pathname, 'utf8');

function occurrences(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

describe('approved unified stats redesign source contract', () => {
  it('owns one adaptive page-level metric selector and keeps the League Leaders card presentational', () => {
    for (const metric of ['goals', 'assists', 'points', 'gaa']) assert.match(screen, new RegExp(`key: ['"]${metric}['"]`));
    assert.equal(occurrences(screen, /testID="stats-metric-selector"/g), 1);
    assert.doesNotMatch(leaders, /SelectableControl|stats-leaders-tab/);
    assert.match(leaders, /League Leaders/);
  });

  it('renders accessible clock and hockey-role icon controls without visible role or timeline labels', () => {
    assert.match(timeline, /name="time-outline"/);
    assert.match(timeline, /accessibilityLabel=\{`Open timeline filter\. \$\{label\}`\}/);
    assert.doesNotMatch(timeline, /<Text[^>]*>Timeline<\/Text>/);
    assert.match(role, /accessibilityRole=\{'tablist' as AccessibilityRole\}/);
    assert.equal(occurrences(role, /accessibilityRole="tab"/g), 2);
    assert.match(role, /accessibilityState=\{\{ selected: role === 'player' \}\}/);
    assert.match(role, /accessibilityState=\{\{ selected: role === 'goalie' \}\}/);
    assert.match(role, /aria-selected=\{role === 'player'\}/);
    assert.match(role, /aria-selected=\{role === 'goalie'\}/);
    assert.match(role, /onSelectRole\('player'\)/);
    assert.match(role, /onSelectRole\('goalie'\)/);
    assert.match(role, /stats-role-icon-player/);
    assert.match(role, /stats-role-icon-goalie/);
    assert.doesNotMatch(role, />Player<|>Goalie</);
  });

  it('renders one complete metric-ranked list with exact role headings and no horizontal stats table or Leaderboards action', () => {
    assert.match(screen, /buildRankedRows/);
    assert.match(screen, /<StatsRankedRow/);
    assert.match(screen, /'Goalie Stats' : 'Player Stats'/);
    assert.doesNotMatch(screen, /StatsTable|stats-leaderboards-action|Leaderboards|<PillToggle/);
    assert.match(rankedRow, /stats-ranked-row-/);
    assert.match(rankedRow, /Open player card/);
  });

  it('keeps the stats page within its viewport and preserves player-card navigation', () => {
    assert.match(screen, /horizontalOverflow/);
    assert.match(screen, /navigateToPlayerCard/);
    assert.match(rankedRow, /width: '100%'/);
    assert.match(rankedRow, /minWidth: 0/);
    assert.match(rankedRow, /flexWrap: 'wrap'/);
  });
});
