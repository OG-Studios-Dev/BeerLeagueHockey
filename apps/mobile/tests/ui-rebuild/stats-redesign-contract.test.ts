import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const screen = readFileSync(new URL('../../src/screens/StatsScreen.tsx', import.meta.url).pathname, 'utf8');
const leaders = readFileSync(new URL('../../src/components/StatsLeadersCard.tsx', import.meta.url).pathname, 'utf8');
const table = readFileSync(new URL('../../src/components/StatsTable.tsx', import.meta.url).pathname, 'utf8');
const timeline = readFileSync(new URL('../../src/components/StatsTimelineFilter.tsx', import.meta.url).pathname, 'utf8');

describe('approved stats redesign source contract', () => {
  it('offers all approved leader metrics with no pre-title copy or artwork caption', () => {
    for (const metric of ['points', 'goals', 'assists', 'gaa']) assert.match(leaders, new RegExp(`key: ['"]${metric}['"]`));
    assert.doesNotMatch(leaders, /SETTING THE PACE|Tap a player for the full picture|topFiveText/);
    assert.match(leaders, /League leaders/i);
  });

  it('renders one accessible timeline filter and transparent skater/goalie tables', () => {
    assert.match(timeline, /accessibilityLabel=[{]?[`'"]Open timeline filter/);
    assert.match(screen, /StatsTimelineFilter/);
    assert.match(screen, /StatsTable/);
    assert.match(table, /transparent/);
    assert.doesNotMatch(screen, /<PlayerRow/);
  });

  it('keeps the stats page within its viewport and confines horizontal scrolling to skater metrics', () => {
    assert.match(screen, /horizontalOverflow/);
    assert.match(table, /metricScroll/);
    assert.match(table, /showsHorizontalScrollIndicator=[{]false[}]/);
    assert.match(table, /goalieMetrics.*flex: 1/s);
  });

  it('retains Stats navigation and the Leaderboards entry', () => {
    assert.match(screen, /navigation\.navigate\(['"]Leaderboards['"]\)/);
    assert.match(screen, /navigateToPlayerCard/);
  });
});
