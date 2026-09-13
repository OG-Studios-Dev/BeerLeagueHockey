/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

function loadModel() {
  return compileCommonJs<Record<string, (...args: any[]) => any>>(
    new URL('../../src/lib/supabase/teamPage.ts', import.meta.url),
    {
      './client': { supabase: {} },
      './team': { getMetricsOperationalSeason: async () => ({ season: null, error: null }) },
    },
  );
}

const baseInput = {
  teamId: 'team-a',
  leagueId: 'league-a',
  season: { id: 'season-a', name: 'Winter 2026', status: 'active', start_date: '2026-01-01', end_date: '2026-04-01' },
  team: { id: 'team-a', league_id: 'league-a', name: 'London Eco Metal', slug: 'lem', logo_url: 'team.png', primary_color: '#36A852', secondary_color: '#D9B64C' },
  league: { id: 'league-a', name: 'Hockey Life', slug: 'hockey-life', primary_color: '#22D3EE' },
  teams: [
    { id: 'team-a', league_id: 'league-a', name: 'London Eco Metal', slug: 'lem', logo_url: 'team.png', primary_color: '#36A852', secondary_color: '#D9B64C' },
    { id: 'team-b', league_id: 'league-a', name: 'First General London', slug: 'fgl', logo_url: 'rival.png', primary_color: '#2454A3', secondary_color: '#A8B4C8' },
  ],
  standings: [
    { team_id: 'team-a', season_id: 'season-a', wins: 7, losses: 2, ties: 2, points: 16, games_played: 11, goals_for: 34, goals_against: 22 },
    { team_id: 'team-b', season_id: 'season-a', wins: 6, losses: 4, ties: 1, points: 13, games_played: 11, goals_for: 30, goals_against: 28 },
  ],
  rosters: [
    { id: 'r1', player_id: 'p1', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, jersey_number: 96, position: 'forward', is_goalie: false, leadership_role: 'captain', games_played_override: null },
    { id: 'r1-duplicate', player_id: 'p1', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, jersey_number: 9, position: 'forward', is_goalie: false, leadership_role: null, games_played_override: null },
    { id: 'r2', player_id: 'p2', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, jersey_number: 71, position: 'forward', is_goalie: false, leadership_role: null, games_played_override: 11 },
    { id: 'r3', player_id: 'p3', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, jersey_number: 16, position: 'defense', is_goalie: false, leadership_role: null, games_played_override: null },
    { id: 'ended', player_id: 'ended', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: '2026-02-01', jersey_number: 1, position: 'forward', is_goalie: false },
    { id: 'wrong-team', player_id: 'wrong-team', team_id: 'team-b', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, jersey_number: 2, position: 'forward', is_goalie: false },
    { id: 'wrong-season', player_id: 'wrong-season', team_id: 'team-a', league_id: 'league-a', season_id: 'old', status: 'active', end_date: null, jersey_number: 3, position: 'forward', is_goalie: false },
  ],
  profiles: [
    { id: 'p1', full_name: 'Matt Grossi', photo_url: 'current.jpg', avatar_url: 'legacy.jpg' },
    { id: 'p2', full_name: 'Ash Moore', photo_url: null, avatar_url: 'ash.jpg' },
    { id: 'p3', full_name: 'Stefan Kowles', photo_url: null, avatar_url: null },
  ],
  seasonStats: [
    { player_id: 'p1', team_id: 'team-a', season_id: 'season-a', games_played: 11, goals: 12, assists: 13, points: 25 },
    { player_id: 'p1', team_id: 'team-a', season_id: 'season-a', games_played: 4, goals: 2, assists: 2, points: 4 },
    { player_id: 'p2', team_id: 'team-a', season_id: 'season-a', games_played: 9, goals: 10, assists: 12, points: 22 },
    { player_id: 'p3', team_id: 'team-a', season_id: 'season-a', games_played: 11, goals: 7, assists: 9, points: 16 },
    { player_id: 'stats-only', team_id: 'team-a', season_id: 'season-a', games_played: 20, goals: 50, assists: 50, points: 100 },
  ],
  playerStats: [
    { player_id: 'p1', team_id: 'team-a', season_id: 'season-a', game_id: 'g1', goals: 12, assists: 13, penalty_minutes: 4 },
    { player_id: 'p1', team_id: 'team-a', season_id: 'season-a', game_id: 'g1', goals: 12, assists: 13, penalty_minutes: 4 },
    { player_id: 'p2', team_id: 'team-a', season_id: 'season-a', game_id: 'g2', goals: 10, assists: 12, penalty_minutes: null },
    { player_id: 'p3', team_id: 'team-a', season_id: 'season-a', game_id: 'g3', goals: 7, assists: 9, penalty_minutes: 0 },
  ],
  goalieStats: [],
  games: [
    { id: 'past-3', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-03-01T20:00:00Z', status: 'completed', location: 'Old Rink', home_score: 2, away_score: 5 },
    { id: 'past-2', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-b', away_team_id: 'team-a', scheduled_at: '2026-03-08T20:00:00Z', status: 'completed', location: 'Rink 2', home_score: 2, away_score: 4 },
    { id: 'past-1', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-03-15T20:00:00Z', status: 'completed', location: 'Rink 1', home_score: 3, away_score: 1 },
    { id: 'next-1', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-03-22T20:00:00Z', status: 'scheduled', location: 'Next Rink', home_score: null, away_score: null },
    { id: 'next-2', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-b', away_team_id: 'team-a', scheduled_at: '2026-03-29T20:00:00Z', status: 'scheduled', location: 'Later Rink', home_score: null, away_score: null },
    { id: 'next-3', league_id: 'league-a', season_id: 'season-a', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-04-05T20:00:00Z', status: 'scheduled', location: 'Latest Rink', home_score: null, away_score: null },
  ],
  seasons: [
    { id: 'old-title', league_id: 'league-a', name: 'Fall 2025', status: 'completed', start_date: '2025-09-01', end_date: '2025-12-01', champion_team_id: 'team-a' },
    { id: 'old-fallback', league_id: 'league-a', name: 'Winter 2025', status: 'completed', start_date: '2025-01-01', end_date: '2025-04-01', champion_team_id: null },
  ],
  historicalStandings: [
    { team_id: 'team-a', season_id: 'old-fallback', wins: 9, losses: 1, ties: 0, points: 18, games_played: 10, goals_for: 40, goals_against: 20 },
    { team_id: 'team-b', season_id: 'old-fallback', wins: 8, losses: 2, ties: 0, points: 16, games_played: 10, goals_for: 35, goals_against: 22 },
  ],
  publishedLineup: null,
  sponsors: [],
};

describe('Team page public snapshot model', () => {
  it('keeps membership authoritative, deduplicates aggregate rows, and prefers current portraits', () => {
    const model = loadModel();
    const snapshot = model.buildTeamPageSnapshot(baseInput, new Date('2026-03-20T12:00:00Z'));

    assert.deepEqual(snapshot.roster.map((player: any) => player.playerId), ['p1', 'p3', 'p2']);
    assert.equal(snapshot.roster[0].photoUrl, 'current.jpg');
    assert.equal(snapshot.roster[0].points, 25);
    assert.equal(snapshot.roster[0].penaltyMinutes, 4);
    assert.equal(snapshot.roster[1].gamesPlayed, 3);
    assert.equal(snapshot.roster[1].gamesPlayedProvenance, 'estimated');
    assert.equal(snapshot.roster.some((player: any) => player.playerId === 'stats-only'), false);
  });

  it('matches P/G/A/PM ranking and truthful 0/1/2/3 podium order', () => {
    const model = loadModel();
    const snapshot = model.buildTeamPageSnapshot(baseInput, new Date('2026-03-20T12:00:00Z'));

    assert.deepEqual(snapshot.leaders.points.map((row: any) => row.playerId), ['p1', 'p2', 'p3']);
    assert.deepEqual(model.toPodiumOrder(snapshot.leaders.points).map((row: any) => row.playerId), ['p2', 'p1', 'p3']);
    assert.deepEqual(model.toPodiumOrder(snapshot.leaders.points.slice(0, 2)).map((row: any) => row.playerId), ['p2', 'p1']);
    assert.deepEqual(model.toPodiumOrder(snapshot.leaders.points.slice(0, 1)).map((row: any) => row.playerId), ['p1']);
    assert.deepEqual(model.toPodiumOrder([]), []);
  });

  it('collapses schedule to two recent finals and two next games and builds every played rival', () => {
    const model = loadModel();
    const snapshot = model.buildTeamPageSnapshot(baseInput, new Date('2026-03-20T12:00:00Z'));

    assert.deepEqual(snapshot.collapsedSchedule.map((game: any) => game.id), ['past-2', 'past-1', 'next-1', 'next-2']);
    assert.equal(snapshot.nextGame.id, 'next-1');
    assert.equal(snapshot.rivals.length, 1);
    assert.equal(snapshot.rivals[0].h2hRecord, '2-1');
    assert.equal(snapshot.rivals[0].rival.tendy.goalsAgainstAverage, null);
  });

  it('uses explicit champions plus the canonical standings-leader legacy fallback', () => {
    const model = loadModel();
    const snapshot = model.buildTeamPageSnapshot(baseInput, new Date('2026-03-20T12:00:00Z'));

    assert.equal(snapshot.championships.count, 2);
    assert.equal(snapshot.championships.latestTitleSeasonName, 'Fall 2025');
    assert.deepEqual(snapshot.championships.titleSeasonIds, ['old-title', 'old-fallback']);
  });

  it('keeps missing numeric data unknown instead of fabricating goalie rates', () => {
    const model = loadModel();
    const input = {
      ...baseInput,
      standings: [{ team_id: 'team-a', season_id: 'season-a', wins: null, losses: null, ties: null, points: null, games_played: null, goals_for: null, goals_against: null }],
      seasonStats: [],
      playerStats: [],
      games: [],
    };
    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));

    assert.equal(snapshot.record, 'No games yet');
    assert.equal(snapshot.hero.winPercentage, null);
    assert.equal(snapshot.roster[0].gamesPlayed, null);
    assert.equal(snapshot.roster[0].points, null);
  });

  it('estimates GP only from public roster and completed-game facts', () => {
    const model = loadModel();
    const completedGames = Array.from({ length: 11 }, (_, index) => ({
      id: `played-${index + 1}`,
      league_id: 'league-a',
      season_id: 'season-a',
      home_team_id: index % 2 === 0 ? 'team-a' : 'team-b',
      away_team_id: index % 2 === 0 ? 'team-b' : 'team-a',
      scheduled_at: `2026-03-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
      status: 'completed',
      location: 'League Rink',
      home_score: 4,
      away_score: 3,
    }));
    const rawRows = Array.from({ length: 9 }, (_, index) => ({
      id: `raw-${index + 1}`,
      player_id: 'p1',
      team_id: 'team-a',
      season_id: 'season-a',
      game_id: `played-${index + 1}`,
      goals: index < 7 ? 2 : index === 7 ? 1 : 0,
      assists: index < 5 ? 2 : 0,
      penalty_minutes: 0,
    }));
    const input = {
      ...baseInput,
      rosters: baseInput.rosters.map((row) => ({
        ...row,
        player_type: row.player_id === 'ended' ? 'sub' : 'regular',
        games_played_override: null,
        joined_at: '2026-02-01T00:00:00Z',
      })),
      leagueRosters: baseInput.rosters.map((row) => ({ ...row, player_type: 'regular', joined_at: '2026-02-01T00:00:00Z' })),
      seasonStats: baseInput.seasonStats.map((row) => row.player_id === 'p1' ? { ...row, games_played: 9 } : row),
      playerStats: rawRows,
      checkins: [{ player_id: 'p1', team_id: 'team-a', game_id: 'played-10', status: 'confirmed' }],
      availability: [],
      games: completedGames,
    };

    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));
    const matt = snapshot.roster.find((player: any) => player.playerId === 'p1');
    assert.equal(matt.gamesPlayed, 11);
    assert.equal(matt.gamesPlayedProvenance, 'estimated');
    assert.equal(matt.goals, 15);
    assert.equal(matt.assists, 10);
    assert.equal(matt.points, 25);
  });

  it('orders tied rivals by their latest meeting and builds canonical single-goalie fallbacks', () => {
    const model = loadModel();
    const premier = { id: 'a-premier', league_id: 'league-a', name: 'FitzRays Premier', slug: 'premier', logo_url: null, primary_color: '#C8102E', secondary_color: '#fff' };
    const flyers = { id: 'z-flyers', league_id: 'league-a', name: 'FitzRays Flyers', slug: 'flyers', logo_url: null, primary_color: '#F97316', secondary_color: '#000' };
    const played = [
      ['p1', 'a-premier', '2026-01-01T20:00:00Z'],
      ['p2', 'a-premier', '2026-01-08T20:00:00Z'],
      ['p3', 'a-premier', '2026-01-15T20:00:00Z'],
      ['p4', 'a-premier', '2026-01-22T20:00:00Z'],
      ['f1', 'z-flyers', '2026-02-01T20:00:00Z'],
      ['f2', 'z-flyers', '2026-02-08T20:00:00Z'],
      ['f3', 'z-flyers', '2026-02-15T20:00:00Z'],
      ['f4', 'z-flyers', '2026-02-22T20:00:00Z'],
    ].map(([id, opponentId, scheduledAt]) => ({
      id,
      league_id: 'league-a',
      season_id: 'season-a',
      home_team_id: 'team-a',
      away_team_id: opponentId,
      scheduled_at: scheduledAt,
      status: 'completed',
      location: 'League Rink',
      home_score: 5,
      away_score: opponentId === 'z-flyers' ? 4 : 3,
    }));
    const goalieRosters = [
      { id: 'ga', player_id: 'goalie-a', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, joined_at: '2025-12-01T00:00:00Z', jersey_number: 1, position: 'Goalie', is_goalie: true, leadership_role: null, player_type: 'regular' },
      { id: 'gf', player_id: 'goalie-f', team_id: 'z-flyers', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, joined_at: '2025-12-01T00:00:00Z', jersey_number: 30, position: 'Goalie', is_goalie: true, leadership_role: null, player_type: 'regular' },
      { id: 'gp', player_id: 'goalie-p', team_id: 'a-premier', league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, joined_at: '2025-12-01T00:00:00Z', jersey_number: 31, position: 'Goalie', is_goalie: true, leadership_role: null, player_type: 'regular' },
    ];
    const input = {
      ...baseInput,
      teams: [baseInput.teams[0], premier, flyers],
      standings: [
        { team_id: 'team-a', season_id: 'season-a', wins: 8, losses: 0, ties: 0, points: 16, games_played: 8, goals_for: 40, goals_against: 28 },
        { team_id: 'a-premier', season_id: 'season-a', wins: 3, losses: 5, ties: 0, points: 6, games_played: 8, goals_for: 24, goals_against: 32 },
        { team_id: 'z-flyers', season_id: 'season-a', wins: 4, losses: 4, ties: 0, points: 8, games_played: 8, goals_for: 30, goals_against: 36 },
      ],
      rosters: [...baseInput.rosters, goalieRosters[0]],
      leagueRosters: [...baseInput.rosters, ...goalieRosters],
      profiles: [
        ...baseInput.profiles,
        { id: 'goalie-a', full_name: 'Steven Wild' },
        { id: 'goalie-f', full_name: 'Connor Flyers' },
        { id: 'goalie-p', full_name: 'Premier Goalie' },
      ],
      games: played,
      goalieStats: [],
      checkins: [],
      availability: [],
    };

    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));
    assert.equal(snapshot.rivals[0].rival.id, 'z-flyers');
    assert.equal(snapshot.rivals[0].team.tendy.name, 'Steven Wild');
    assert.equal(snapshot.rivals[0].team.tendy.gamesPlayed, 8);
    assert.equal(snapshot.rivals[0].team.tendy.goalsAgainstAverage, 3.5);
    assert.equal(snapshot.rivals[0].rival.tendy.name, 'Connor Flyers');
    assert.equal(snapshot.rivals[0].rival.tendy.goalsAgainstAverage, 5);
  });

  it('rounds canonical single-goalie team GA/GP to two decimals without contaminating the target roster', () => {
    const model = loadModel();
    const goalies = ['team-a', 'team-b'].map((team_id, index) => ({ id: `r-goalie-${index}`, player_id: `goalie-${index}`, team_id, league_id: 'league-a', season_id: 'season-a', status: 'active', end_date: null, is_goalie: true, position: 'Goalie' }));
    const input = {
      ...baseInput, rosters: [goalies[0]], leagueRosters: goalies, playerStats: [], seasonStats: [], goalieStats: [], checkins: [], availability: [],
      profiles: [{ id: 'goalie-0', full_name: 'Home Goalie' }, { id: 'goalie-1', full_name: 'Away Goalie' }],
      games: Array.from({ length: 11 }, (_, index) => ({ ...baseInput.games[0], id: `g-${index}`, home_score: index === 10 ? 4 : 5, away_score: index === 10 ? 5 : 4 })),
    };
    const snapshot = model.buildTeamPageSnapshot(input);
    assert.deepEqual(snapshot.rivals[0].team.tendy, { name: 'Home Goalie', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goalsAgainstAverage: 4.09, goalsAgainstAverageProvenance: 'estimated' });
    assert.deepEqual(snapshot.rivals[0].rival.tendy, { name: 'Away Goalie', gamesPlayed: 11, gamesPlayedProvenance: 'estimated', goalsAgainstAverage: 4.91, goalsAgainstAverageProvenance: 'estimated' });
    assert.deepEqual(snapshot.roster.map((row: any) => row.playerId), ['goalie-0']);
  });

  it('matches the actual web tale-of-the-tape producer for raw leaders, goalie ranking and strength ties', () => {
    const model = loadModel();
    const web = compileCommonJs<Record<string, (...args: any[]) => any>>(
      new URL('../../../league-sites/src/lib/team-page.ts', import.meta.url),
      { './player-photo': { resolvePlayerPhotoUrl: () => null } },
    );
    const skaters = [
      { player_id: 'former', team_id: 'team-a', player_name: 'Former Scorer', goals: 30, assists: 3, points: 33 },
      { player_id: 'z', team_id: 'team-b', player_name: 'Zoe', goals: 6, assists: 12, points: 18 },
      { player_id: 'a', team_id: 'team-b', player_name: 'Amy', goals: 6, assists: 12, points: 18 },
    ];
    const goalies = [
      { player_id: 'g-worse', team_id: 'team-b', player_name: 'Aaron Worse', games_played: 2, goals_against_average: 4 },
      { player_id: 'g-best', team_id: 'team-b', player_name: 'Zed Best', games_played: 2, goals_against_average: 2.5 },
    ];
    const input = {
      ...baseInput,
      checkins: [], availability: [], seasonStats: [],
      rosters: [], leagueRosters: [],
      profiles: [...skaters, ...goalies].map((row) => ({ id: row.player_id, full_name: row.player_name })),
      playerStats: skaters.map((row) => ({ ...row, season_id: 'season-a', game_id: 'past-1' })),
      goalieStats: goalies.flatMap((row) => ['past-1', 'past-2'].map((game_id) => ({ ...row, season_id: 'season-a', game_id, goals_against: row.goals_against_average }))),
    };
    // Scheduled/pending stat rows must not compete with completed-season rival facts.
    input.playerStats.push({ player_id: 'rogue', team_id: 'team-b', player_name: 'Rogue', goals: 999, assists: 999, points: 1998, season_id: 'season-a', game_id: 'next-1' });
    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));
    const webStandings = snapshot.standings.map((s: any) => ({ team_id: s.teamId, team_name: s.teamName, team_logo: s.logoUrl, goals_for: s.goalsFor, goals_against: s.goalsAgainst, goal_differential: s.goalDifferential, games_played: s.gamesPlayed, wins: s.wins, losses: s.losses, ties: s.ties, points: s.points }));
    const expected = web.buildTaleOfTheTapeRivals({ teamId: 'team-a', rivals: [{ team: { id: 'team-b', name: 'First General London', slug: 'fgl', logo: 'rival.png' }, wins: 2, losses: 1, ties: 0, games_played: 3 }], standings: webStandings, skaterRows: skaters, goalieRows: goalies });
    const facts = (side: any) => ({ overallRecord: side.overallRecord, strength: side.strength, weakness: side.weakness, sniper: side.sniper, playmaker: side.playmaker, tendy: { name: side.tendy.name, gamesPlayed: side.tendy.gamesPlayed, goalsAgainstAverage: side.tendy.goalsAgainstAverage } });
    assert.deepEqual(facts(snapshot.rivals[0].team), facts(expected[0].team));
    assert.deepEqual(facts(snapshot.rivals[0].rival), facts(expected[0].rival));
    assert.equal(snapshot.roster.length, 0, 'stats-only leaders cannot become current roster members');

    const tied = [
      { ...webStandings[0], team_id: 'z-best', goals_for: 40, goals_against: 20, points: 10 },
      { ...webStandings[0], team_id: 'team-a', goals_for: 40, goals_against: 30, points: 10 },
      { ...webStandings[1], goals_for: 20, goals_against: 40, points: 5 },
    ];
    const tiedInput = { ...input, teams: [...input.teams, { ...input.team, id: 'z-best', name: 'A Best' }], standings: tied.map((s: any) => ({ ...s, season_id: 'season-a' })) };
    const tiedSnapshot = model.buildTeamPageSnapshot(tiedInput);
    // Equal GF/points must preserve canonical standing order, not UUID order.
    const tiedExpected = web.deriveStrengthWeakness(tied, 'team-a');
    assert.deepEqual({ strength: tiedSnapshot.rivals[0].team.strength, weakness: tiedSnapshot.rivals[0].team.weakness }, tiedExpected);
  });

  it('keeps collapsed completed/pending and scheduled/live groups disjoint regardless of timestamp', () => {
    const model = loadModel();
    const statuses = ['completed', 'pending_verification', 'scheduled', 'in_progress', 'cancelled', 'postponed'];
    const input = { ...baseInput, games: statuses.map((status, index) => ({ ...baseInput.games[0], id: status, status, scheduled_at: `2026-03-${10 + index}T20:00:00Z` })) };
    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));
    assert.deepEqual(snapshot.collapsedSchedule.map((game: any) => game.id), ['completed', 'pending_verification', 'scheduled', 'in_progress']);
    assert.equal(new Set(snapshot.collapsedSchedule.map((game: any) => game.id)).size, 4);
    assert.equal(snapshot.nextGame.id, 'in_progress', 'hero prioritizes live; collapsed schedule stays chronological like web');
    assert.deepEqual(snapshot.games.map((game: any) => game.status), statuses, 'expanded schedule retains honest exceptional statuses');
  });

  it('rejects booleans, arrays, objects, numeric strings, and non-finite numbers as numeric facts', () => {
    const model = loadModel();
    const input = {
      ...baseInput,
      standings: [{
        team_id: 'team-a', season_id: 'season-a', wins: true, losses: [], ties: {}, points: '16',
        games_played: Number.POSITIVE_INFINITY, goals_for: false, goals_against: ['22'],
      }],
    };
    const snapshot = model.buildTeamPageSnapshot(input, new Date('2026-03-20T12:00:00Z'));
    assert.equal(snapshot.standing.wins, null);
    assert.equal(snapshot.standing.losses, null);
    assert.equal(snapshot.standing.ties, null);
    assert.equal(snapshot.standing.points, null);
    assert.equal(snapshot.standing.gamesPlayed, null);
    assert.equal(snapshot.standing.goalsFor, null);
    assert.equal(snapshot.standing.goalsAgainst, null);
  });

  it('is invariant to guest/member visibility of private attendance rows and preserves GP overrides', () => {
    const model = loadModel();
    const guest = model.buildTeamPageSnapshot({ ...baseInput, checkins: [], availability: [] });
    const member = model.buildTeamPageSnapshot({
      ...baseInput,
      checkins: [{ player_id: 'p1', team_id: 'team-a', game_id: 'past-1', status: 'out' }],
      availability: [{ player_id: 'p2', team_id: 'team-a', game_id: 'past-2', status: 'out' }],
    });
    assert.deepEqual(member.roster, guest.roster);
    const overridden = model.buildTeamPageSnapshot({
      ...baseInput,
      rosters: baseInput.rosters.map((row) => row.player_id === 'p1' ? { ...row, games_played_override: 7 } : row),
    });
    const matt = overridden.roster.find((row: any) => row.playerId === 'p1');
    assert.equal(matt.gamesPlayed, 7);
    assert.equal(matt.gamesPlayedProvenance, 'authoritative');
  });

  it('keeps mixed raw null PIM unknown, excludes it from PIM leaders, and preserves recorded zero', () => {
    const model = loadModel();
    const input = {
      ...baseInput,
      playerStats: [
        { id: 'null', player_id: 'p2', team_id: 'team-a', season_id: 'season-a', game_id: 'past-1', goals: 0, assists: 0, penalty_minutes: null },
        { id: 'zero-after-null', player_id: 'p2', team_id: 'team-a', season_id: 'season-a', game_id: 'past-2', goals: 0, assists: 0, penalty_minutes: 0 },
        { id: 'recorded-zero', player_id: 'p3', team_id: 'team-a', season_id: 'season-a', game_id: 'past-1', goals: 0, assists: 0, penalty_minutes: 0 },
      ],
    };
    const snapshot = model.buildTeamPageSnapshot(input);
    assert.equal(snapshot.roster.find((row: any) => row.playerId === 'p2').penaltyMinutes, null);
    assert.equal(snapshot.roster.find((row: any) => row.playerId === 'p3').penaltyMinutes, 0);
    assert.equal(snapshot.leaders.penaltyMinutes.some((row: any) => row.playerId === 'p2'), false);
    assert.equal(snapshot.leaders.penaltyMinutes.some((row: any) => row.playerId === 'p3'), true);
  });

  it('overlays the team-scoped v2 metrics without falling back to raw GP or PIM zero', () => {
    const model = loadModel();
    const m = (value: number | null, state: string, sources: string[]) => ({ value, state, sources });
    const input = { ...baseInput, publicSeasonStats: { players: [{
      playerId: 'p1', playerName: 'Matt Grossi', avatarUrl: 'current.jpg', roles: ['skater'], goalie: null,
      metrics: { gamesPlayed: m(null, 'conflicted', ['attendance']), goals: m(15, 'recorded', ['skater_stats']),
        assists: m(10, 'reported', ['imported']), points: m(25, 'recorded', ['skater_stats']), penaltyMinutes: m(null, 'unknown', []) },
    }, {
      playerId: 'p2', playerName: 'Ash Moore', avatarUrl: 'ash.jpg', roles: ['skater'], goalie: null,
      metrics: { gamesPlayed: m(11, 'estimated', ['roster_window']), goals: m(0, 'recorded', ['skater_stats']),
        assists: m(0, 'recorded', ['skater_stats']), points: m(0, 'recorded', ['skater_stats']), penaltyMinutes: m(0, 'verified', ['capture_confirmation']) },
    }] } };
    const snapshot = model.buildTeamPageSnapshot(input);
    const matt = snapshot.roster.find((row: any) => row.playerId === 'p1');
    const ash = snapshot.roster.find((row: any) => row.playerId === 'p2');
    assert.deepEqual([matt.gamesPlayed, matt.goals, matt.assists, matt.points, matt.penaltyMinutes], [null, 15, 10, 25, null]);
    assert.equal(matt.publicMetrics.gamesPlayed.state, 'conflicted');
    assert.equal(snapshot.leaders.penaltyMinutes.some((row: any) => row.playerId === 'p1'), false);
    assert.equal(ash.gamesPlayed, 11);
    assert.equal(ash.publicMetrics.gamesPlayed.state, 'estimated');
    assert.equal(snapshot.leaders.penaltyMinutes.find((row: any) => row.playerId === 'p2').value, 0);
  });

  it('ranks historic team contributors and dual-role skater production without changing the current roster', () => {
    const model = loadModel();
    const m = (value: number | null, state = 'recorded', sources = ['skater_stats']) => ({ value, state, sources });
    const input = {
      ...baseInput,
      rosters: baseInput.rosters.map((row) => row.player_id === 'p2' ? { ...row, position: 'goalie', is_goalie: true } : row),
      publicSeasonStats: { players: [
        {
          playerId: 'transfer', playerName: 'Transferred Taylor', avatarUrl: 'transfer.jpg',
          displayTeam: { id: 'team-a', name: 'London Eco Metal' }, teams: [{ id: 'team-a', name: 'London Eco Metal' }], roles: ['skater'], goalie: null,
          metrics: { gamesPlayed: m(10), goals: m(12), assists: m(13), points: m(25), penaltyMinutes: m(2, 'verified', ['capture_confirmation']) },
        },
        {
          playerId: 'p2', playerName: 'Ash Moore', avatarUrl: 'ash.jpg',
          displayTeam: { id: 'team-a', name: 'London Eco Metal' }, teams: [{ id: 'team-a', name: 'London Eco Metal' }], roles: ['skater', 'goalie'],
          metrics: { gamesPlayed: m(8), goals: m(9), assists: m(8), points: m(17), penaltyMinutes: m(0, 'verified', ['capture_confirmation']) },
          goalie: { gamesPlayed: m(3, 'recorded', ['goalie_assignment']), wins: m(2, 'recorded', ['goalie_stats']), losses: m(1, 'recorded', ['goalie_stats']), saves: m(30, 'recorded', ['goalie_stats']), goalsAgainst: m(5, 'recorded', ['goalie_stats']), savePercentage: m(.857, 'recorded', ['goalie_stats']), goalsAgainstAverage: m(1.67, 'recorded', ['goalie_stats']), shutouts: m(1, 'recorded', ['goalie_stats']) },
        },
      ] },
    };
    const snapshot = model.buildTeamPageSnapshot(input);

    assert.equal(snapshot.roster.some((player: any) => player.playerId === 'transfer'), false, 'historic contributors must not reappear in the current roster');
    assert.deepEqual(snapshot.leaders.points.map((leader: any) => leader.playerId), ['transfer', 'p2']);
    assert.equal(snapshot.roster.find((player: any) => player.playerId === 'p2').publicGoalieMetrics.wins.value, 2);
  });
});
