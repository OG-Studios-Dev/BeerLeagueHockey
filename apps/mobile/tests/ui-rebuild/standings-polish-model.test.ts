import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlayoffPicture,
  buildSeasonCompletion,
  calculatePlayoffPredictor,
  rankStandings,
  type StandingsFact,
} from '../../src/lib/standingsModel.ts';

const rows: StandingsFact[] = [
  { teamId: 'b', teamName: 'Bears', logoUrl: null, primaryColor: '#222222', divisionId: null, divisionName: null, wins: 4, losses: 2, ties: 0, points: 8, goalsFor: 19, goalsAgainst: 12, gamesPlayed: 6 },
  { teamId: 'a', teamName: 'Aces', logoUrl: null, primaryColor: '#111111', divisionId: null, divisionName: null, wins: 4, losses: 2, ties: 0, points: 8, goalsFor: 20, goalsAgainst: 12, gamesPlayed: 6 },
  { teamId: 'c', teamName: 'Comets', logoUrl: null, primaryColor: '#333333', divisionId: null, divisionName: null, wins: 3, losses: 3, ties: 0, points: 6, goalsFor: 18, goalsAgainst: 18, gamesPlayed: 6 },
  { teamId: 'd', teamName: 'Dragons', logoUrl: null, primaryColor: '#444444', divisionId: null, divisionName: null, wins: 2, losses: 4, ties: 0, points: 4, goalsFor: 12, goalsAgainst: 20, gamesPlayed: 6 },
];

describe('standings web-parity model', () => {
  it('uses the website tiebreak order and configured high-v-low playoff seeding', () => {
    assert.deepEqual(rankStandings(rows).map((row) => row.teamId), ['a', 'b', 'c', 'd']);
    const picture = buildPlayoffPicture(rows, { playoffTeamsTotal: 4, playoffTeamsPerDivision: null, useDivisionPlayoffs: false });
    assert.equal(picture.status, 'ready');
    assert.deepEqual(picture.groups[0]?.matchups.map((matchup) => [matchup.highSeed.teamId, matchup.lowSeed?.teamId]), [['b', 'd'], ['a', 'c']]);
  });

  it('counts only regular completed or pending-verification games and detects playoffs', () => {
    const completion = buildSeasonCompletion([
      { id: '1', homeTeamId: 'a', awayTeamId: 'b', status: 'completed', gameType: 'regular' },
      { id: '2', homeTeamId: 'c', awayTeamId: 'd', status: 'pending_verification', gameType: null },
      { id: '3', homeTeamId: 'a', awayTeamId: 'c', status: 'scheduled', gameType: 'regular_season' },
      { id: '4', homeTeamId: 'a', awayTeamId: 'd', status: 'scheduled', gameType: 'playoff' },
    ]);
    assert.deepEqual(completion, { totalRegular: 2, completedRegular: 2, percentage: 100, playoffMode: true });
  });

  it('keeps the predictor honestly unavailable without schedule facts', () => {
    assert.deepEqual(
      calculatePlayoffPredictor(rows, [], { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false }),
      { status: 'unavailable', reason: 'Schedule data is unavailable, so playoff chances cannot be calculated.' },
    );
  });

  it('returns deterministic chances and respects the configured number of qualifiers', () => {
    const games = [
      { id: 'played-1', homeTeamId: 'a', awayTeamId: 'b', status: 'completed', gameType: 'regular' },
      { id: 'remaining-1', homeTeamId: 'c', awayTeamId: 'd', status: 'scheduled', gameType: 'regular' },
      { id: 'remaining-2', homeTeamId: 'a', awayTeamId: 'c', status: 'scheduled', gameType: 'regular' },
    ];
    const config = { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false };
    const first = calculatePlayoffPredictor(rows, games, config);
    const second = calculatePlayoffPredictor(rows, games, config);
    assert.deepEqual(first, second);
    assert.equal(first.status, 'ready');
    assert.equal(Math.round(first.teams.reduce((sum, team) => sum + team.makePlayoffs, 0)), 2);
  });
});
