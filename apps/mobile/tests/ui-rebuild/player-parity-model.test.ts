import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLAYER_SECTION_ORDER,
  createPlayerRequestGate,
  getPlayerMetricDefinitions,
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
  });
});
