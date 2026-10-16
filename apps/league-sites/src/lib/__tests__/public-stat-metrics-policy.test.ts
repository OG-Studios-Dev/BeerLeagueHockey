import {
  aggregatePublicSeasonStats,
  PublicMetricDataError,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';

const LEAGUE = '10000000-0000-4000-8000-000000000001';
const FOREIGN_LEAGUE = '11000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000002';
const FOREIGN_SEASON = '21000000-0000-4000-8000-000000000002';
const DIVISION = '30000000-0000-4000-8000-000000000003';
const TEAM_HOME = '70000000-0000-4000-8000-000000000007';
const TEAM_AWAY = '71000000-0000-4000-8000-000000000007';
const TEAM_OTHER = '72000000-0000-4000-8000-000000000007';
const TEAM_FOURTH = '73000000-0000-4000-8000-000000000007';
const PLAYER = '40000000-0000-4000-8000-000000000004';
const REGULAR_GOALIE = '41000000-0000-4000-8000-000000000004';
const SECOND_GOALIE = '42000000-0000-4000-8000-000000000004';
const SUB_GOALIE = '43000000-0000-4000-8000-000000000004';
const GAME = '80000000-0000-4000-8000-000000000008';
const GAME_TWO = '81000000-0000-4000-8000-000000000008';
const UNRELATED_GAME = '82000000-0000-4000-8000-000000000008';
const MISSING_GAME = '83000000-0000-4000-8000-000000000008';

function fixture(overrides: Partial<PublicStatMetricRows> = {}): PublicStatMetricRows {
  return {
    games: [{
      id: GAME,
      league_id: LEAGUE,
      season_id: SEASON,
      status: 'completed',
      home_team_id: TEAM_HOME,
      away_team_id: TEAM_AWAY,
      home_score: 4,
      away_score: 2,
      scheduled_at: '2026-09-01T20:00:00Z',
      penalty_capture_status: null,
      goalie_capture_status: null,
      skater_capture_status: null,
    }],
    teams: [
      { id: TEAM_HOME, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Home' },
      { id: TEAM_AWAY, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Away' },
    ],
    profiles: [
      { id: PLAYER, full_name: 'Player', avatar_url: null, photo_url: null },
      { id: REGULAR_GOALIE, full_name: 'Regular Goalie', avatar_url: null, photo_url: null },
      { id: SECOND_GOALIE, full_name: 'Second Goalie', avatar_url: null, photo_url: null },
      { id: SUB_GOALIE, full_name: 'Sub Goalie', avatar_url: null, photo_url: null },
    ],
    rosters: [],
    checkins: [],
    acceptedSubs: [],
    playerStats: [],
    goalieStats: [],
    goalieAppearances: [],
    ...overrides,
  };
}

function regularRoster(
  playerId: string,
  overrides: Partial<PublicStatMetricRows['rosters'][number]> = {},
): PublicStatMetricRows['rosters'][number] {
  return {
    id: playerId === PLAYER
      ? '90000000-0000-4000-8000-000000000001'
      : playerId === REGULAR_GOALIE
        ? '90000000-0000-4000-8000-000000000002'
        : '90000000-0000-4000-8000-000000000003',
    player_id: playerId,
    team_id: TEAM_HOME,
    league_id: LEAGUE,
    season_id: SEASON,
    start_date: '2026-01-01',
    end_date: null,
    is_goalie: false,
    position: 'C',
    status: 'active',
    player_type: 'regular',
    ...overrides,
  };
}

describe('approved public statistics policy', () => {
  it('counts an active regular roster player with no response as policy-determined GP', () => {
    const rows = fixture({ rosters: [regularRoster(PLAYER)] });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];

    expect(player.metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['roster_window'],
    });
  });

  it('keeps an Out regular roster player visible with zero GP', () => {
    const rows = fixture({
      rosters: [regularRoster(PLAYER)],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000001',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'out',
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === PLAYER);

    expect(player?.metrics.gamesPlayed).toEqual({
      value: 0,
      state: 'reported',
      sources: ['attendance', 'roster_window'],
    });
  });

  it('does not let one team Out status taint direct participation for another team in the same game', () => {
    const rows = fixture({
      rosters: [regularRoster(PLAYER)],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000005',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      playerStats: [{
        id: 'c0000000-0000-4000-8000-000000000005',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_AWAY,
        league_id: LEAGUE,
        season_id: SEASON,
        goals: 1,
        assists: 0,
        penalty_minutes: 0,
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === PLAYER);

    expect(player?.metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'recorded',
      sources: ['attendance', 'skater_stats', 'roster_window'],
    });
  });

  it('does not let a games-played override replace an Out/direct-participation conflict', () => {
    const rows = fixture({
      rosters: [regularRoster(PLAYER, { games_played_override: 7 })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000007',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      playerStats: [{
        id: 'c0000000-0000-4000-8000-000000000007',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        goals: 0,
        assists: 0,
        penalty_minutes: 0,
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === PLAYER);

    expect(player?.metrics.gamesPlayed).toEqual({
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'skater_stats', 'roster_window'],
      candidates: { recorded: 1 },
    });
  });

  it('counts an accepted substitute as policy-determined GP', () => {
    const rows = fixture({
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000001',
        game_id: GAME,
        invited_player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0];

    expect(player.metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['accepted_sub'],
    });
  });

  it('rejects a foreign-season roster before it can introduce a player or games-played override', () => {
    const rows = fixture({
      rosters: [regularRoster(PLAYER, {
        season_id: FOREIGN_SEASON,
        games_played_override: 7,
      })],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('cross-scope roster row'));
  });

  it('rejects a foreign-league team row instead of silently filtering it', () => {
    const teams = fixture().teams;
    const rows = fixture({
      teams: [{ ...teams[0], league_id: FOREIGN_LEAGUE }, teams[1]],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('cross-scope team row'));
  });

  it('rejects a same-scope roster whose team is absent from the supplied team rows', () => {
    const rows = fixture({
      rosters: [regularRoster(PLAYER, { team_id: TEAM_OTHER })],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('roster references missing team'));
  });

  it('rejects a checkin whose team is not playing in the referenced game', () => {
    const rows = fixture({
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
      ],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000012',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_OTHER,
        status: 'confirmed',
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('checkin team is not in game'));
  });

  it('rejects an accepted substitute whose team is not playing in the referenced game', () => {
    const rows = fixture({
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
      ],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000012',
        game_id: GAME,
        invited_player_id: PLAYER,
        team_id: TEAM_OTHER,
        status: 'accepted',
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('accepted substitute team is not in game'));
  });

  it('rejects a player stat whose team is not playing in the referenced game', () => {
    const rows = fixture({
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
      ],
      playerStats: [{
        id: 'c0000000-0000-4000-8000-000000000012',
        game_id: GAME,
        player_id: PLAYER,
        team_id: TEAM_OTHER,
        league_id: LEAGUE,
        season_id: SEASON,
        goals: 99,
        assists: 99,
        penalty_minutes: 99,
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('player stat team is not in game'));
  });

  it('rejects a goalie stat whose team is not playing in the referenced game', () => {
    const rows = fixture({
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
      ],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000013',
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_OTHER,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: false,
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError('goalie stat team is not in game'));
  });

  it.each([
    ['checkin', (rows: PublicStatMetricRows) => {
      rows.checkins = [{
        id: 'a0000000-0000-4000-8000-000000000016',
        game_id: MISSING_GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }];
    }],
    ['accepted substitute', (rows: PublicStatMetricRows) => {
      rows.acceptedSubs = [{
        id: 'b0000000-0000-4000-8000-000000000016',
        game_id: MISSING_GAME,
        invited_player_id: PLAYER,
        team_id: TEAM_HOME,
        status: 'accepted',
      }];
    }],
    ['player stat', (rows: PublicStatMetricRows) => {
      rows.playerStats = [{
        id: 'c0000000-0000-4000-8000-000000000016',
        game_id: MISSING_GAME,
        player_id: PLAYER,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        goals: 1,
        assists: 0,
        penalty_minutes: 0,
      }];
    }],
    ['goalie stat', (rows: PublicStatMetricRows) => {
      rows.goalieStats = [{
        id: 'd0000000-0000-4000-8000-000000000016',
        game_id: MISSING_GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: null,
      }];
    }],
    ['goalie appearance', (rows: PublicStatMetricRows) => {
      rows.goalieAppearances = [{
        game_id: MISSING_GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }];
    }],
  ])('rejects a %s whose parent game is absent from the supplied game rows', (label, addEvidence) => {
    const rows = fixture();
    addEvidence(rows);

    expect(() => aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }))
      .toThrow(new PublicMetricDataError(`${label} references missing game`));
  });

  it('rejects a goalie appearance with a non-participant team before team-scope filtering', () => {
    const unrelatedGame = {
      ...fixture().games[0],
      id: UNRELATED_GAME,
      home_team_id: TEAM_OTHER,
      away_team_id: TEAM_FOURTH,
    };
    const rows = fixture({
      games: [...fixture().games, unrelatedGame],
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
        { id: TEAM_FOURTH, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Fourth' },
      ],
      goalieAppearances: [{
        game_id: UNRELATED_GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, {
      leagueId: LEAGUE,
      seasonId: SEASON,
      teamId: TEAM_HOME,
    })).toThrow(new PublicMetricDataError('goalie appearance team is not in game'));
  });

  it('rejects a goalie appearance side conflict before team-scope filtering', () => {
    const unrelatedGame = {
      ...fixture().games[0],
      id: UNRELATED_GAME,
      home_team_id: TEAM_OTHER,
      away_team_id: TEAM_FOURTH,
    };
    const rows = fixture({
      games: [...fixture().games, unrelatedGame],
      teams: [
        ...fixture().teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
        { id: TEAM_FOURTH, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Fourth' },
      ],
      goalieAppearances: [{
        game_id: UNRELATED_GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_OTHER,
        team_type: 'away',
      }],
    });

    expect(() => aggregatePublicSeasonStats(rows, {
      leagueId: LEAGUE,
      seasonId: SEASON,
      teamId: TEAM_HOME,
    })).toThrow(new PublicMetricDataError('goalie assignment team conflict'));
  });

  it('ignores unrelated games and all of their evidence for a team-scoped aggregation', () => {
    const scopedPlayerStat = {
      id: 'c0000000-0000-4000-8000-000000000014',
      game_id: GAME,
      player_id: PLAYER,
      team_id: TEAM_HOME,
      league_id: LEAGUE,
      season_id: SEASON,
      goals: 2,
      assists: 1,
      penalty_minutes: 0,
    };
    const baseline = fixture({ playerStats: [scopedPlayerStat] });
    const unrelatedGame = {
      ...fixture().games[0],
      id: UNRELATED_GAME,
      home_team_id: TEAM_OTHER,
      away_team_id: TEAM_FOURTH,
      home_score: 99,
      away_score: 98,
    };
    const noisy = fixture({
      games: [...baseline.games, unrelatedGame],
      teams: [
        ...baseline.teams,
        { id: TEAM_OTHER, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Other' },
        { id: TEAM_FOURTH, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: 'Fourth' },
      ],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000014',
        game_id: UNRELATED_GAME,
        player_id: PLAYER,
        team_id: TEAM_OTHER,
        status: 'out',
      }],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000014',
        game_id: UNRELATED_GAME,
        invited_player_id: PLAYER,
        team_id: TEAM_OTHER,
        status: 'accepted',
      }],
      playerStats: [scopedPlayerStat, {
        ...scopedPlayerStat,
        id: 'c0000000-0000-4000-8000-000000000015',
        game_id: UNRELATED_GAME,
        team_id: TEAM_OTHER,
        goals: 99,
        assists: 99,
        penalty_minutes: 99,
      }],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000014',
        game_id: UNRELATED_GAME,
        player_id: PLAYER,
        team_id: TEAM_OTHER,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 99,
        losses: 99,
        saves: 99,
        shots_against: 99,
        goals_against: 99,
        shutout: true,
      }],
      goalieAppearances: [{
        game_id: UNRELATED_GAME,
        player_id: PLAYER,
        team_id: TEAM_OTHER,
        team_type: 'home',
      }],
    });
    const scope = { leagueId: LEAGUE, seasonId: SEASON, teamId: TEAM_HOME };

    expect(aggregatePublicSeasonStats(noisy, scope)).toEqual(aggregatePublicSeasonStats(baseline, scope));
  });

  it('assigns a unique eligible roster goalie and derives GA and GAA from the final score', () => {
    const rows = fixture({
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === REGULAR_GOALIE);

    expect(player?.goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['roster_window'],
    });
    expect(player?.goalie?.goalsAgainst).toEqual({
      value: 2,
      state: 'reported',
      sources: ['roster_window'],
    });
    expect(player?.goalie?.goalsAgainstAverage).toEqual({
      value: 2,
      state: 'reported',
      sources: ['roster_window'],
    });
    for (const metric of [player?.goalie?.wins, player?.goalie?.losses, player?.goalie?.shutouts]) {
      expect(metric).toEqual({ value: null, state: 'unknown', sources: [] });
    }
  });

  it('blanks every identity-dependent metric for an available regular goalie suppressed by an explicit sub assignment', () => {
    const firstGame = fixture().games[0];
    const rows = fixture({
      games: [firstGame, { ...firstGame, id: GAME_TWO, scheduled_at: '2026-09-08T20:00:00Z' }],
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000002',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      acceptedSubs: [GAME, GAME_TWO].map((gameId, index) => ({
        id: `b0000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
        game_id: gameId,
        invited_player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        status: 'accepted',
      })),
      goalieAppearances: [GAME, GAME_TWO].map((gameId) => ({
        game_id: gameId,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home' as const,
      })),
    });

    const players = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players;
    const regular = players.find((candidate) => candidate.playerId === REGULAR_GOALIE);
    const sub = players.find((candidate) => candidate.playerId === SUB_GOALIE);

    for (const metric of [
      regular?.goalie?.gamesPlayed,
      regular?.goalie?.wins,
      regular?.goalie?.losses,
      regular?.goalie?.shutouts,
      regular?.goalie?.goalsAgainst,
      regular?.goalie?.goalsAgainstAverage,
    ]) {
      expect(metric).toEqual(expect.objectContaining({ value: null, state: 'unknown' }));
    }
    expect(sub?.goalie?.gamesPlayed).toEqual({
      value: 2,
      state: 'recorded',
      sources: ['goalie_assignment'],
    });
    expect(sub?.goalie?.goalsAgainst).toEqual({
      value: 4,
      state: 'recorded',
      sources: ['goalie_assignment'],
    });
    expect(sub?.goalie?.goalsAgainstAverage).toEqual({
      value: 2,
      state: 'recorded',
      sources: ['goalie_assignment'],
    });
  });

  it('blanks every identity-dependent metric for a direct-stat regular goalie suppressed by an explicit substitute', () => {
    const rows = fixture({
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000005',
        game_id: GAME,
        invited_player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
      goalieAppearances: [{
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000005',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: true,
      }],
    });

    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === REGULAR_GOALIE)?.goalie;

    for (const metric of [
      goalie?.gamesPlayed,
      goalie?.wins,
      goalie?.losses,
      goalie?.shutouts,
      goalie?.goalsAgainst,
      goalie?.goalsAgainstAverage,
    ]) {
      expect(metric).toEqual(expect.objectContaining({
        value: null,
        state: 'unknown',
      }));
    }
  });

  it('leaves direct goalie result rows unknown without an exact identity resolution', () => {
    const rows = fixture({
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000009',
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: true,
      }],
    });

    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0].goalie;

    for (const metric of [goalie?.wins, goalie?.losses, goalie?.shutouts]) {
      expect(metric).toEqual({ value: null, state: 'unknown', sources: ['goalie_stats'] });
    }
  });

  it('conflicts result fields when an exact goalie identity has extra direct rows', () => {
    const directRow = {
      game_id: GAME,
      player_id: SUB_GOALIE,
      team_id: TEAM_HOME,
      league_id: LEAGUE,
      season_id: SEASON,
      wins: 1,
      losses: 0,
      saves: null,
      shots_against: null,
      goals_against: null,
      shutout: false,
    };
    const rows = fixture({
      goalieAppearances: [{
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [
        { ...directRow, id: 'c0000000-0000-4000-8000-000000000010' },
        { ...directRow, id: 'c0000000-0000-4000-8000-000000000011' },
      ],
    });

    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players[0].goalie;

    for (const metric of [goalie?.wins, goalie?.losses, goalie?.shutouts]) {
      expect(metric).toEqual(expect.objectContaining({ value: null, state: 'conflicted' }));
    }
  });

  it('conflicts every identity-dependent goalie metric for an accepted substitute who is Out with direct stats', () => {
    const rows = fixture({
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000008',
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000008',
        game_id: GAME,
        invited_player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
      goalieAppearances: [{
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000008',
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 22,
        goals_against: 2,
        shutout: true,
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === SUB_GOALIE);

    expect(player?.metrics.gamesPlayed).toEqual(expect.objectContaining({ value: null, state: 'conflicted' }));
    for (const metric of [
      player?.goalie?.gamesPlayed,
      player?.goalie?.wins,
      player?.goalie?.losses,
      player?.goalie?.shutouts,
      player?.goalie?.goalsAgainst,
      player?.goalie?.goalsAgainstAverage,
    ]) {
      expect(metric).toEqual(expect.objectContaining({ value: null, state: 'conflicted' }));
    }
    expect(player?.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(player?.goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('keeps an explicit sub override while surfacing an Out/direct-stats conflict on a suppressed regular goalie', () => {
    const rows = fixture({
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000006',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000006',
        game_id: GAME,
        invited_player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
      goalieAppearances: [{
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000006',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: null,
      }],
    });

    const players = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players;
    const regular = players.find((candidate) => candidate.playerId === REGULAR_GOALIE);
    const sub = players.find((candidate) => candidate.playerId === SUB_GOALIE);

    expect(regular?.goalie?.gamesPlayed).toEqual({
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'goalie_stats', 'goalie_assignment', 'roster_window'],
    });
    expect(sub?.goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'recorded',
      sources: ['goalie_assignment'],
    });
  });

  it('leaves every identity-dependent goalie metric unknown when two regular goalies are eligible', () => {
    const rows = fixture({
      rosters: [
        regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' }),
        regularRoster(SECOND_GOALIE, { is_goalie: true, position: 'Goalie' }),
      ],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000007',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: true,
      }],
    });

    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === REGULAR_GOALIE)?.goalie;

    for (const metric of [
      goalie?.gamesPlayed,
      goalie?.wins,
      goalie?.losses,
      goalie?.shutouts,
      goalie?.goalsAgainst,
      goalie?.goalsAgainstAverage,
    ]) {
      expect(metric).toEqual(expect.objectContaining({ value: null, state: 'unknown' }));
    }
  });

  it('leaves goalie GP, GA, and GAA blank when zero or multiple eligible goalies remain', () => {
    const multiple = fixture({
      rosters: [
        regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' }),
        regularRoster(SECOND_GOALIE, { is_goalie: true, position: 'Goalie' }),
      ],
    });
    const multiplePlayers = aggregatePublicSeasonStats(multiple, { leagueId: LEAGUE, seasonId: SEASON }).players;
    for (const playerId of [REGULAR_GOALIE, SECOND_GOALIE]) {
      const goalie = multiplePlayers.find((candidate) => candidate.playerId === playerId)?.goalie;
      expect(goalie?.gamesPlayed).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
      expect(goalie?.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
      expect(goalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
    }

    const none = fixture({
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000003',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        status: 'out',
      }],
    });
    const outGoalie = aggregatePublicSeasonStats(none, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === REGULAR_GOALIE)?.goalie;
    expect(outGoalie?.gamesPlayed).toEqual({
      value: null,
      state: 'unknown',
      sources: ['attendance', 'roster_window'],
    });
    expect(outGoalie?.goalsAgainst).toEqual({
      value: null,
      state: 'unknown',
      sources: ['attendance', 'roster_window'],
    });
    expect(outGoalie?.goalsAgainstAverage).toEqual({
      value: null,
      state: 'unknown',
      sources: ['attendance', 'roster_window'],
    });
  });

  it('conflicts goalie GP when an Out player also has direct goalie stats', () => {
    const rows = fixture({
      rosters: [regularRoster(REGULAR_GOALIE, { is_goalie: true, position: 'Goalie' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000004',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000004',
        game_id: GAME,
        player_id: REGULAR_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: null,
      }],
    });

    const player = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === REGULAR_GOALIE);

    expect(player?.metrics.gamesPlayed.state).toBe('conflicted');
    expect(player?.goalie?.gamesPlayed).toEqual({
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'goalie_stats', 'roster_window'],
    });
  });

  it('indexes large source collections instead of repeatedly rescanning them', () => {
    const gameCount = 30;
    const regularGoalieCount = 30;
    const id = (prefix: string, index: number) =>
      `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const teamPairs = Array.from({ length: gameCount }, (_, index) => ({
      home: id('7', 100 + index * 2),
      away: id('7', 101 + index * 2),
    }));
    let gameFieldReads = 0;
    const games = teamPairs.map((teams, index) => new Proxy({
      ...fixture().games[0],
      id: id('8', 100 + index),
      home_team_id: teams.home,
      away_team_id: teams.away,
      scheduled_at: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T20:00:00Z`,
    }, {
      get(target, property, receiver) {
        if (property === 'home_team_id' || property === 'away_team_id' || property === 'scheduled_at') {
          gameFieldReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    }));
    const goalieIds = Array.from({ length: regularGoalieCount }, (_, index) => id('4', 100 + index));
    const raw = fixture({
      games,
      teams: teamPairs.flatMap((teams, index) => [
        { id: teams.home, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: `Home ${index}` },
        { id: teams.away, league_id: LEAGUE, season_id: SEASON, division_id: DIVISION, name: `Away ${index}` },
      ]),
      profiles: [
        ...goalieIds.map((playerId, index) => ({
          id: playerId,
          full_name: `Regular ${index}`,
          avatar_url: null,
          photo_url: null,
        })),
        { id: SUB_GOALIE, full_name: 'Assigned Sub', avatar_url: null, photo_url: null },
      ],
      rosters: goalieIds.map((playerId, index) => regularRoster(playerId, {
        id: id('9', 100 + index),
        team_id: teamPairs[index].home,
        is_goalie: true,
        position: 'Goalie',
      })),
      goalieStats: games.map((game, index) => ({
        id: id('c', 100 + index),
        game_id: game.id,
        player_id: SUB_GOALIE,
        team_id: teamPairs[index].home,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: false,
      })),
      goalieAppearances: games.map((game, index) => ({
        game_id: game.id,
        player_id: SUB_GOALIE,
        team_id: teamPairs[index].home,
        team_type: 'home' as const,
      })),
    });
    const reads: Partial<Record<keyof PublicStatMetricRows, number>> = {};
    const counted = <T,>(name: keyof PublicStatMetricRows, values: T[]): T[] => {
      const proxy = new Proxy(values, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads[name] = (reads[name] ?? 0) + 1;
          if (property === 'filter') {
            return (predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) => counted(
              name,
              Array.prototype.filter.call(receiver, predicate, thisArg) as T[],
            );
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return proxy;
    };
    const totalRows = Object.values(raw).reduce((sum, values) => sum + values.length, 0);
    const countedRows = Object.fromEntries(Object.entries(raw).map(([name, values]) => [
      name,
      counted(name as keyof PublicStatMetricRows, values),
    ])) as PublicStatMetricRows;

    const payload = aggregatePublicSeasonStats(countedRows, { leagueId: LEAGUE, seasonId: SEASON });
    const sourceElementReads = Object.values(reads).reduce((sum, count) => sum + (count ?? 0), 0);

    expect(payload.players.find((player) => player.playerId === SUB_GOALIE)?.goalie?.gamesPlayed.value).toBe(gameCount);
    expect(sourceElementReads).toBeLessThanOrEqual(totalRows * 20);
    expect(gameFieldReads).toBeLessThanOrEqual((gameCount + regularGoalieCount) * 12);
    for (const name of ['rosters', 'goalieStats', 'goalieAppearances'] as const) {
      expect(reads[name] ?? 0).toBeLessThanOrEqual(raw[name].length * 20);
    }
  });

  it('keeps saves and save percentage unknown while preserving recorded rows without double-counting GA', () => {
    const rows = fixture({
      goalieAppearances: [{
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [{
        id: 'c0000000-0000-4000-8000-000000000001',
        game_id: GAME,
        player_id: SUB_GOALIE,
        team_id: TEAM_HOME,
        league_id: LEAGUE,
        season_id: SEASON,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 22,
        goals_against: 99,
        shutout: false,
        scorekeeping_provenance: null,
      }],
    });

    const goalie = aggregatePublicSeasonStats(rows, { leagueId: LEAGUE, seasonId: SEASON }).players
      .find((candidate) => candidate.playerId === SUB_GOALIE)?.goalie;

    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.goalsAgainst).toEqual({ value: 2, state: 'recorded', sources: ['goalie_assignment'] });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 2, state: 'recorded', sources: ['goalie_assignment'] });
    expect(goalie?.wins).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.losses).toEqual({ value: 0, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.shutouts).toEqual({ value: 0, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'recorded', sources: ['goalie_assignment'] });
  });
});
