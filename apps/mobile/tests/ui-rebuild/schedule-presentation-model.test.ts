import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildScheduleRows,
  buildScheduleTeamOptions,
  filterScheduleGamesByTeam,
  resolveScheduleTeamSelection,
} from '../../src/lib/schedulePresentation.ts';
import type { GameRow } from '../../src/lib/supabase/data.ts';

const game = (id: string, overrides: Partial<GameRow> = {}): GameRow => ({
  id,
  home_team_id: `home-${id}`,
  away_team_id: `away-${id}`,
  home_score: null,
  away_score: null,
  scheduled_at: '2026-10-08T02:15:00.000Z',
  status: 'scheduled',
  location: 'Main Rink',
  season_id: 'season-a',
  home_team: { id: `home-${id}`, name: `Home ${id}`, primary_color: '#112233', logo_url: `https://example.test/home-${id}.png` },
  away_team: { id: `away-${id}`, name: `Away ${id}`, primary_color: '#445566', logo_url: `https://example.test/away-${id}.png` },
  ...overrides,
});

describe('schedule presentation model', () => {
  it('derives unique canonical team options with logos and stable name/id ordering', () => {
    const games = [
      game('one', {
        home_team_id: 'team-z',
        home_team: { id: 'team-z', name: 'Very Long Team Name That Must Stay Complete', primary_color: '#ABCDEF', logo_url: 'https://example.test/z.png' },
        away_team_id: 'team-a',
        away_team: { id: 'team-a', name: 'Alpha', primary_color: null, logo_url: 'https://example.test/a.png' },
      }),
      game('two', {
        home_team_id: 'team-a',
        home_team: { id: 'team-a', name: 'Alpha', primary_color: null, logo_url: 'https://example.test/a.png' },
        away_team_id: 'missing-team-id',
        away_team: null,
      }),
      game('three', {
        home_team_id: 'team-a-2',
        home_team: { id: 'team-a-2', name: 'Alpha', primary_color: '#010203', logo_url: null },
        away_team_id: 'mismatched-id',
        away_team: { id: 'wrong-id', name: 'Wrong join', primary_color: null, logo_url: null },
      }),
    ];

    assert.deepEqual(buildScheduleTeamOptions(games), [
      { id: 'team-a', name: 'Alpha', logoUrl: 'https://example.test/a.png', primaryColor: null },
      { id: 'team-a-2', name: 'Alpha', logoUrl: null, primaryColor: '#010203' },
      { id: 'team-z', name: 'Very Long Team Name That Must Stay Complete', logoUrl: 'https://example.test/z.png', primaryColor: '#ABCDEF' },
    ]);
  });

  it('keeps every status once in ascending grouped order and filters either side by canonical ID', () => {
    const games = [
      game('cancelled', { scheduled_at: '2026-10-09T02:15:00.000Z', status: 'cancelled', home_team_id: 'team-filter' }),
      game('live-b', { scheduled_at: '2026-10-08T02:15:00.000Z', status: 'in_progress', away_team_id: 'team-filter' }),
      game('live-a', { scheduled_at: '2026-10-08T02:15:00.000Z', status: 'completed' }),
      game('pending', { scheduled_at: '2026-10-08T03:15:00.000Z', status: 'pending_verification' }),
      game('postponed', { scheduled_at: '2026-10-08T03:30:00.000Z', status: 'postponed' }),
      game('unknown', { scheduled_at: '2026-10-08T03:40:00.000Z', status: null }),
      game('scheduled', { scheduled_at: '2026-10-08T03:50:00.000Z', status: 'scheduled' }),
    ];

    assert.deepEqual(filterScheduleGamesByTeam(games, null).map(({ id }) => id), games.map(({ id }) => id));
    assert.deepEqual(filterScheduleGamesByTeam(games, 'team-filter').map(({ id }) => id), ['cancelled', 'live-b']);

    const rows = buildScheduleRows(games, 'America/Toronto');
    assert.deepEqual(rows.map((row) => row.type === 'date' ? row.title : row.game.id), [
      'Wednesday, Oct 7', 'live-a', 'live-b', 'pending', 'postponed', 'unknown', 'scheduled',
      'Thursday, Oct 8', 'cancelled',
    ]);
    assert.equal(new Set(rows.filter((row) => row.type === 'game').map((row) => row.game.id)).size, games.length);
  });

  it('owns team selection by league, season, and division scope', () => {
    const options = [{ id: 'team-a', name: 'Alpha', logoUrl: null, primaryColor: null }];
    assert.equal(resolveScheduleTeamSelection({ scopeKey: 'league-a:season-a:division-a', teamId: 'team-a' }, 'league-a:season-a:division-a', options), 'team-a');
    assert.equal(resolveScheduleTeamSelection({ scopeKey: 'league-a:season-a:division-a', teamId: 'team-a' }, 'league-a:season-a:all', options), null);
    assert.equal(resolveScheduleTeamSelection({ scopeKey: 'league-a:season-a:division-a', teamId: 'team-missing' }, 'league-a:season-a:division-a', options), 'team-missing');
    assert.equal(resolveScheduleTeamSelection({ scopeKey: 'league-a:season-a:division-a', teamId: null }, 'league-a:season-a:division-a', options), null);
  });
});
