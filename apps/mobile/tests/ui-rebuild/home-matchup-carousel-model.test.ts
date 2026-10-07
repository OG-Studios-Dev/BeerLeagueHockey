import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HomeWeeklyGame } from '../../src/lib/supabase/home';
import { compileCommonJs } from './component-harness';

const home = compileCommonJs<Record<string, any>>(
  new URL('../../src/lib/supabase/home.ts', import.meta.url),
  { './client': { supabase: {} } },
);

const game = (overrides: Record<string, unknown> = {}) => ({
  id: 'game-a',
  scheduled_at: '2026-10-08T02:15:00.000Z',
  location: 'Chick-Fil-A Community Ice Centre — Championship Rink',
  home_score: null,
  away_score: null,
  status: 'scheduled',
  home_team_id: 'home',
  away_team_id: 'away',
  home_team: { id: 'home', name: 'Bad Bunny', logo_url: 'https://example.test/home.png', primary_color: '#b000ff' },
  away_team: { id: 'away', name: 'Liuna Premier', logo_url: 'https://example.test/away.png', primary_color: '#ff6500' },
  ...overrides,
}) as HomeWeeklyGame;

describe('Home matchup carousel model', () => {
  it('formats real facts in league-local time and preserves truthful status and nullable scores', () => {
    assert.equal(typeof (home as any).buildHomeMatchupFacts, 'function');
    const scheduled = (home as any).buildHomeMatchupFacts(game(), 'America/Toronto');
    assert.deepEqual(scheduled, {
      dateLabel: 'Oct 7', timeLabel: '10:15 PM', locationLabel: 'Chick-Fil-A Community Ice Centre — Championship Rink',
      statusLabel: 'Scheduled', showScore: false, awayScoreLabel: null, homeScoreLabel: null,
    });

    const live = (home as any).buildHomeMatchupFacts(game({ status: 'in_progress', away_score: 0, home_score: null }), 'America/Toronto');
    assert.equal(live.statusLabel, 'Live');
    assert.equal(live.showScore, true);
    assert.equal(live.awayScoreLabel, '0');
    assert.equal(live.homeScoreLabel, null);

    const invalid = (home as any).buildHomeMatchupFacts(game({ scheduled_at: 'not-a-date', location: null }), 'America/Toronto');
    assert.equal(invalid.dateLabel, null);
    assert.equal(invalid.timeLabel, null);
    assert.equal(invalid.locationLabel, null);
  });

  it('validates team colors and falls back without matchup-specific hardcoding', () => {
    assert.equal(typeof (home as any).resolveHomeMatchupColors, 'function');
    assert.deepEqual((home as any).resolveHomeMatchupColors('#f60', '#B000FF', '#22D3EE'), { away: '#FF6600', home: '#B000FF' });
    assert.deepEqual((home as any).resolveHomeMatchupColors('orange', null, '#22d3ee'), { away: '#22D3EE', home: '#22D3EE' });
    assert.deepEqual((home as any).resolveHomeMatchupColors(null, 'rgb(1,2,3)', 'bad'), { away: '#7C8798', home: '#7C8798' });
  });

  it('retains canonical game identity across reorder and clamps only when it disappears or scope changes', () => {
    assert.equal(typeof (home as any).reconcileHomeMatchupSelection, 'function');
    const games = [game({ id: 'game-a' }), game({ id: 'game-b' }), game({ id: 'game-c' })];
    assert.deepEqual((home as any).reconcileHomeMatchupSelection(games, 'game-b', 1, false), { gameId: 'game-b', index: 1 });
    assert.deepEqual((home as any).reconcileHomeMatchupSelection([games[2], games[1], games[0]], 'game-b', 1, false), { gameId: 'game-b', index: 1 });
    assert.deepEqual((home as any).reconcileHomeMatchupSelection([games[0]], 'game-b', 1, false), { gameId: 'game-a', index: 0 });
    assert.deepEqual((home as any).reconcileHomeMatchupSelection([games[2], games[1]], 'game-b', 1, true), { gameId: 'game-c', index: 0 });
    assert.deepEqual((home as any).reconcileHomeMatchupSelection([], 'game-b', 1, false), { gameId: null, index: 0 });
  });

  it('rejects a stale scroll callback from an older game scope', () => {
    assert.equal(typeof (home as any).selectHomeMatchupForScope, 'function');
    const games = [game({ id: 'game-a' }), game({ id: 'game-b' })];
    assert.deepEqual((home as any).selectHomeMatchupForScope(games, 1, 'league:week-2', 'league:week-1', 2, 1), null);
    assert.deepEqual((home as any).selectHomeMatchupForScope(games, 1, 'league:week-2', 'league:week-2', 2, 2), { gameId: 'game-b', index: 1 });
    assert.deepEqual((home as any).selectHomeMatchupForScope(games, 1, 'league:week-a', 'league:week-a', 4, 2), null, 'A→B→A must reject the first A generation');
  });
});
