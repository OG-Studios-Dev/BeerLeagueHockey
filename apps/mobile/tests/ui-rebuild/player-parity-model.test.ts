import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLAYER_SECTION_ORDER,
  createPlayerRequestGate,
  getCareerMetricDefinitions,
  getPlayerMetricDefinitions,
  lineChartGeometry,
  resolvePlayerSeasonSelection,
  visiblePlayerSections,
} from '../../src/lib/playerPageModel.ts';

describe('Hockey Life player page parity model', () => {
  it('keeps exact website section order while allowing factual empty sections to disappear', () => {
    assert.deepEqual(PLAYER_SECTION_ORDER, [
      'identity', 'achievements', 'season-stats', 'career-stats',
      'game-log', 'matchup-stats', 'in-the-news', 'season-history',
    ]);
    assert.deepEqual(visiblePlayerSections({
      achievements: 0, careerSeasons: 0, games: 0, matchups: 0, articles: 0, seasons: 1,
    }), ['identity', 'season-stats']);
  });

  it('preserves skater and goalie metric differences', () => {
    assert.deepEqual(getPlayerMetricDefinitions(false).map((metric) => metric.key), ['games_played', 'goals', 'assists', 'points', 'penalty_minutes', 'plus_minus']);
    assert.deepEqual(getPlayerMetricDefinitions(true).map((metric) => metric.key), ['games_played', 'wins', 'losses', 'save_percentage', 'goals_against_average', 'shutouts', 'saves']);
    assert.deepEqual(getCareerMetricDefinitions(false).map((metric) => metric.key), ['goals', 'assists', 'points', 'attendance', 'goals_per_game', 'points_per_game']);
    assert.deepEqual(getCareerMetricDefinitions(true).map((metric) => metric.key), ['wins', 'save_percentage', 'goals_against_average', 'saves', 'shutouts', 'attendance']);
  });

  it('creates bounded line and area geometry without turning unknown values into zero', () => {
    const chart = lineChartGeometry([null, 4, 10, 7], 300, 140);
    assert.equal(chart.points.length, 3);
    assert.ok(chart.points.every((point) => point.x >= 0 && point.x <= 300 && point.y >= 0 && point.y <= 140));
    assert.equal(chart.minimum, 4);
    assert.equal(chart.maximum, 10);
    assert.match(chart.areaPath, /^M/);
  });

  it('uses season identity rather than array position and supports the career view', () => {
    const seasons = [{ id: 'older', name: 'Older' }, { id: 'current', name: 'Current' }];
    assert.equal(resolvePlayerSeasonSelection(seasons, 'current', 'older').selectedId, 'older');
    assert.equal(resolvePlayerSeasonSelection(seasons, 'current', 'missing').selectedId, 'current');
    assert.equal(resolvePlayerSeasonSelection(seasons, 'current', 'all').selectedId, null);
  });

  it('drops stale and out-of-order player responses', () => {
    const gate = createPlayerRequestGate();
    const oldRequest = gate.begin('player-a:season-a');
    const currentRequest = gate.begin('player-a:season-b');
    assert.equal(gate.isCurrent(oldRequest, 'player-a:season-a'), false);
    assert.equal(gate.isCurrent(currentRequest, 'player-a:season-b'), true);
    assert.equal(gate.isCurrent(currentRequest, 'player-b:season-b'), false);
    gate.invalidate();
    assert.equal(gate.isCurrent(currentRequest, 'player-a:season-b'), false, 'unmounted requests stay invalidated');
  });
});
