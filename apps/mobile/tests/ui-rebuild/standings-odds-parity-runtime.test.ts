import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculatePlayoffPredictor,
  type PlayoffConfig,
  type StandingsFact,
  type StandingsGameFact,
} from '../../src/lib/standingsModel.ts';
import { compileCommonJs } from './component-harness.ts';

type WebsiteStanding = {
  team_id: string; team_name: string; team_logo: string | null; division_id: string | null; division_name: string | null;
  wins: number; losses: number; ties: number; overtime_losses: number; points: number; goals_for: number;
  goals_against: number; goal_differential: number; games_played: number;
};
type WebsiteGame = { id: string; status: string | null; game_type: string | null; home_team: { id: string }; away_team: { id: string } };
type WebsiteOdds = { teamId: string; oddsOfFinishingFirst: number; oddsOfMakingPlayoffs: number };
const { calculatePlayoffOdds } = compileCommonJs<{
  calculatePlayoffOdds(rows: WebsiteStanding[], games: WebsiteGame[], config: PlayoffConfig): WebsiteOdds[];
}>(new URL('../../../league-sites/src/lib/playoffs/odds.ts', import.meta.url), {});

function row(overrides: Partial<StandingsFact> & Pick<StandingsFact, 'teamId' | 'teamName'>): StandingsFact {
  return {
    logoUrl: null,
    primaryColor: null,
    divisionId: null,
    divisionName: null,
    wins: 2,
    losses: 2,
    ties: 0,
    points: 4,
    goalsFor: 8,
    goalsAgainst: 8,
    gamesPlayed: 4,
    ...overrides,
  };
}

function websiteRows(rows: StandingsFact[]): WebsiteStanding[] {
  return rows.map((team) => ({
    team_id: team.teamId,
    team_name: team.teamName,
    team_logo: team.logoUrl,
    division_id: team.divisionId,
    division_name: team.divisionName,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    overtime_losses: 0,
    points: team.points,
    goals_for: team.goalsFor,
    goals_against: team.goalsAgainst,
    goal_differential: team.goalsFor - team.goalsAgainst,
    games_played: team.gamesPlayed,
  }));
}

function websiteGames(games: StandingsGameFact[]): WebsiteGame[] {
  return games.map((game) => ({
    id: game.id,
    status: game.status,
    game_type: game.gameType,
    home_team: { id: game.homeTeamId },
    away_team: { id: game.awayTeamId },
  }));
}

function normalizedWebsite(rows: WebsiteOdds[]) {
  return rows.map((team) => ({
    teamId: team.teamId,
    firstPlace: team.oddsOfFinishingFirst,
    makePlayoffs: team.oddsOfMakingPlayoffs,
  }));
}

function parityForBothInputPermutations(rows: StandingsFact[], games: StandingsGameFact[], config: PlayoffConfig) {
  const results = [];
  for (const permutation of [rows, [...rows].reverse()]) {
    const nativeBefore = structuredClone(permutation);
    const gamesBefore = structuredClone(games);
    const webRows = websiteRows(permutation);
    const webGames = websiteGames(games);
    const webRowsBefore = structuredClone(webRows);
    const webGamesBefore = structuredClone(webGames);

    const native = calculatePlayoffPredictor(permutation, games, config);
    assert.equal(native.status, 'ready');
    if (native.status !== 'ready') throw new Error('Expected ready playoff predictor');
    const website = normalizedWebsite(calculatePlayoffOdds(webRows, webGames, config));
    assert.deepEqual(native.teams, website);
    assert.deepEqual(permutation, nativeBefore, 'mobile standings input must not be mutated');
    assert.deepEqual(games, gamesBefore, 'mobile schedule input must not be mutated');
    assert.deepEqual(webRows, webRowsBefore, 'website standings input must not be mutated');
    assert.deepEqual(webGames, webGamesBefore, 'website schedule input must not be mutated');
    results.push(native.teams);
  }
  return results;
}

const completedSchedule: StandingsGameFact[] = [
  { id: 'completed', homeTeamId: 'z-id', awayTeamId: 'a-id', status: 'completed', gameType: 'regular' },
];

describe('standings predictor canonical website odds parity', () => {
  it('uses every numeric comparison key then team ID, never team name, in the completed-schedule branch', () => {
    const cases: Array<{ label: string; first: StandingsFact; second: StandingsFact; expected: string }> = [
      { label: 'points', first: row({ teamId: 'z-id', teamName: 'Alpha', points: 4 }), second: row({ teamId: 'a-id', teamName: 'Zulu', points: 6 }), expected: 'a-id' },
      { label: 'wins', first: row({ teamId: 'z-id', teamName: 'Alpha', points: 6, wins: 2 }), second: row({ teamId: 'a-id', teamName: 'Zulu', points: 6, wins: 3 }), expected: 'a-id' },
      { label: 'goal differential', first: row({ teamId: 'z-id', teamName: 'Alpha', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }), second: row({ teamId: 'a-id', teamName: 'Zulu', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 6 }), expected: 'a-id' },
      { label: 'goals for', first: row({ teamId: 'z-id', teamName: 'Alpha', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }), second: row({ teamId: 'a-id', teamName: 'Zulu', points: 6, wins: 3, goalsFor: 10, goalsAgainst: 8 }), expected: 'a-id' },
      { label: 'team ID after a full numeric tie', first: row({ teamId: 'z-id', teamName: 'Alpha', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }), second: row({ teamId: 'a-id', teamName: 'Zulu', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }), expected: 'a-id' },
    ];

    for (const scenario of cases) {
      const fixture = [scenario.first, scenario.second, row({ teamId: 'last-id', teamName: 'Last', points: 0, wins: 0, goalsFor: 1, goalsAgainst: 9 })];
      const results = parityForBothInputPermutations(fixture, completedSchedule, { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false });
      for (const result of results) assert.equal(result[0]?.teamId, scenario.expected, scenario.label);
    }
  });

  it('matches the canonical simulation at a global qualifier boundary and preserves outcome-bound certainties', () => {
    const fixture = [
      row({ teamId: 'leader', teamName: 'Leader', points: 12, wins: 6, goalsFor: 20, goalsAgainst: 8 }),
      row({ teamId: 'z-id', teamName: 'Alpha', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }),
      row({ teamId: 'a-id', teamName: 'Zulu', points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }),
      row({ teamId: 'eliminated', teamName: 'Eliminated', points: 0, wins: 0, goalsFor: 2, goalsAgainst: 20 }),
    ];
    const games = [
      ...completedSchedule,
      { id: 'remaining', homeTeamId: 'leader', awayTeamId: 'eliminated', status: 'scheduled', gameType: 'regular' },
    ];
    const results = parityForBothInputPermutations(fixture, games, { playoffTeamsTotal: 2, playoffTeamsPerDivision: null, useDivisionPlayoffs: false });
    for (const result of results) {
      assert.deepEqual(result.map((team) => team.teamId), ['leader', 'a-id', 'z-id', 'eliminated']);
      assert.deepEqual(result.map((team) => team.makePlayoffs), [1, 1, 0, 0]);
      assert.equal(result[0]?.firstPlace, 1);
      assert.equal(result[3]?.firstPlace, 0);
    }
  });

  it('matches canonical per-division qualification at opposing name/ID tie boundaries with remaining games', () => {
    const fixture = ['east', 'west'].flatMap((division) => [
      row({ teamId: `${division}-leader`, teamName: `${division} Leader`, divisionId: division, divisionName: division, points: 12, wins: 6, goalsFor: 20, goalsAgainst: 8 }),
      row({ teamId: `${division}-z-id`, teamName: 'Alpha', divisionId: division, divisionName: division, points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }),
      row({ teamId: `${division}-a-id`, teamName: 'Zulu', divisionId: division, divisionName: division, points: 6, wins: 3, goalsFor: 9, goalsAgainst: 7 }),
      row({ teamId: `${division}-last`, teamName: `${division} Last`, divisionId: division, divisionName: division, points: 0, wins: 0, goalsFor: 2, goalsAgainst: 20 }),
    ]);
    const games = ['east', 'west'].flatMap((division) => [
      { id: `${division}-completed`, homeTeamId: `${division}-z-id`, awayTeamId: `${division}-a-id`, status: 'completed', gameType: 'regular' },
      { id: `${division}-remaining`, homeTeamId: `${division}-leader`, awayTeamId: `${division}-last`, status: 'scheduled', gameType: 'regular' },
    ]);
    const results = parityForBothInputPermutations(fixture, games, { playoffTeamsTotal: null, playoffTeamsPerDivision: 2, useDivisionPlayoffs: true });
    for (const result of results) {
      const odds = new Map(result.map((team) => [team.teamId, team.makePlayoffs]));
      for (const division of ['east', 'west']) {
        assert.equal(odds.get(`${division}-leader`), 1);
        assert.equal(odds.get(`${division}-a-id`), 1);
        assert.equal(odds.get(`${division}-z-id`), 0);
        assert.equal(odds.get(`${division}-last`), 0);
      }
    }
  });

  it('preserves the ordinary four-team 5,000-run fixture exactly', () => {
    const fixture = [
      row({ teamId: 'fixture-north', teamName: 'North', points: 4, wins: 2, losses: 1, goalsFor: 9, goalsAgainst: 6, gamesPlayed: 3 }),
      row({ teamId: 'fixture-flyers', teamName: 'Flyers', points: 4, wins: 2, losses: 1, goalsFor: 8, goalsAgainst: 7, gamesPlayed: 3 }),
      row({ teamId: 'fixture-liuna', teamName: 'Labour', points: 3, wins: 1, losses: 1, ties: 1, goalsFor: 7, goalsAgainst: 7, gamesPlayed: 3 }),
      row({ teamId: 'fixture-bunny', teamName: 'Bunny', points: 2, wins: 1, losses: 2, goalsFor: 6, goalsAgainst: 10, gamesPlayed: 3 }),
    ];
    const games = [
      ['g1', 0, 1], ['g2', 0, 2], ['g3', 0, 3], ['g4', 1, 2], ['g5', 1, 3], ['g6', 2, 3],
    ].map(([id, home, away]) => ({ id: String(id), homeTeamId: fixture[Number(home)]!.teamId, awayTeamId: fixture[Number(away)]!.teamId, status: 'scheduled', gameType: 'regular' }));
    parityForBothInputPermutations(fixture, games, { playoffTeamsTotal: 4, playoffTeamsPerDivision: null, useDivisionPlayoffs: false });
  });
});
