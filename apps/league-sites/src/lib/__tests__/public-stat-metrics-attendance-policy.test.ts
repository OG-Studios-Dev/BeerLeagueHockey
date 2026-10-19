import {
  aggregatePublicSeasonStats,
  PublicMetricDataError,
  PublicMetricLimitError,
  type PublicStatMetricRows,
} from '@/lib/public-stat-metrics';

const LEAGUE_ID = '10000000-0000-4000-8000-000000000001';
const SEASON_ID = '20000000-0000-4000-8000-000000000002';
const DIVISION_ID = '30000000-0000-4000-8000-000000000003';
const PLAYER_ID = '40000000-0000-4000-8000-000000000004';
const PART_TIME_ID = '41000000-0000-4000-8000-000000000004';
const SECOND_GOALIE_ID = '42000000-0000-4000-8000-000000000004';
const THIRD_GOALIE_ID = '43000000-0000-4000-8000-000000000004';
const TEAM_HOME = '70000000-0000-4000-8000-000000000007';
const TEAM_AWAY = '71000000-0000-4000-8000-000000000007';
const TEAM_OTHER = '72000000-0000-4000-8000-000000000007';

function game(index: number, scheduledAt: string, homeScore = 4, awayScore = 2): PublicStatMetricRows['games'][number] {
  return {
    id: `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    league_id: LEAGUE_ID,
    season_id: SEASON_ID,
    status: 'completed',
    home_team_id: TEAM_HOME,
    away_team_id: TEAM_AWAY,
    home_score: homeScore,
    away_score: awayScore,
    scheduled_at: scheduledAt,
    penalty_capture_status: null,
    goalie_capture_status: null,
    skater_capture_status: null,
  };
}

function roster(
  id: string,
  playerId: string,
  overrides: Partial<PublicStatMetricRows['rosters'][number]> = {},
): PublicStatMetricRows['rosters'][number] {
  return {
    id,
    player_id: playerId,
    team_id: TEAM_HOME,
    league_id: LEAGUE_ID,
    season_id: SEASON_ID,
    start_date: '2026-09-01',
    end_date: null,
    is_goalie: false,
    position: 'C',
    status: 'active',
    player_type: 'regular',
    ...overrides,
  };
}

function rows(overrides: Partial<PublicStatMetricRows> = {}): PublicStatMetricRows {
  return {
    games: [],
    teams: [
      { id: TEAM_HOME, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Home' },
      { id: TEAM_AWAY, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Away' },
    ],
    profiles: [{ id: PLAYER_ID, full_name: 'Policy Player', avatar_url: null, photo_url: null }],
    rosters: [],
    checkins: [],
    availabilities: [],
    acceptedSubs: [],
    playerStats: [],
    goalieStats: [],
    goalieAppearances: [],
    ...overrides,
  };
}

function goalieStat(
  id: string,
  gameId: string,
  playerId = PLAYER_ID,
  teamId = TEAM_HOME,
  goalsAgainst: number | null = 2,
): PublicStatMetricRows['goalieStats'][number] {
  return {
    id,
    game_id: gameId,
    player_id: playerId,
    team_id: teamId,
    league_id: LEAGUE_ID,
    season_id: SEASON_ID,
    wins: null,
    losses: null,
    saves: null,
    shots_against: null,
    goals_against: goalsAgainst,
    shutout: null,
    scorekeeping_provenance: null,
  };
}

describe('public completed-game appearance policy', () => {
  it('reports regular roster defaults only inside the roster window and excludes explicit Out', () => {
    const beforeWindow = game(1, '2026-08-31T20:00:00Z');
    const defaultAttended = game(2, '2026-09-05T20:00:00Z');
    const explicitOut = game(3, '2026-09-10T20:00:00Z');
    const afterWindow = game(4, '2026-09-16T20:00:00Z');
    const source = rows({
      games: [beforeWindow, defaultAttended, explicitOut, afterWindow],
      rosters: [roster('90000000-0000-4000-8000-000000000001', PLAYER_ID, { end_date: '2026-09-15' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000001',
        game_id: explicitOut.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
    });

    const player = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0];

    expect(player.metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['attendance', 'roster_window'],
    });
  });

  it('default-denies roster defaults without a canonical start date', () => {
    const completed = game(28, '2026-10-08T20:00:00Z');
    const source = rows({
      games: [completed],
      rosters: [roster('90000000-0000-4000-8000-000000000022', PLAYER_ID, {
        start_date: null,
      })],
    });

    expect(aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players).toEqual([]);
  });

  it('uses the league-local date for roster-window boundaries', () => {
    const beforeTorontoStart = game(23, '2026-09-01T02:00:00Z');
    const onTorontoStart = game(24, '2026-09-01T04:00:00Z');
    const source = rows({
      games: [beforeTorontoStart, onTorontoStart],
      rosters: [roster('90000000-0000-4000-8000-000000000017', PLAYER_ID, {
        start_date: '2026-09-01',
      })],
    });

    const gamesPlayed = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].metrics.gamesPlayed;

    expect(gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['roster_window'],
    });
  });

  it('excludes a regular-roster default when player availability explicitly says Out', () => {
    const completed = game(14, '2026-09-26T20:00:00Z');
    const source = rows({
      games: [completed],
      rosters: [roster('90000000-0000-4000-8000-000000000011', PLAYER_ID)],
      availabilities: [{
        id: 'a1000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        season_id: SEASON_ID,
        status: 'out',
      }],
    });

    const player = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0];

    expect(player.metrics.gamesPlayed).toEqual({
      value: 0,
      state: 'reported',
      sources: ['attendance', 'roster_window'],
    });
  });

  it('default-denies missing or malformed roster status and player type', () => {
    const completed = game(15, '2026-09-27T20:00:00Z');
    const missingStatus = '43000000-0000-4000-8000-000000000004';
    const missingType = '44000000-0000-4000-8000-000000000004';
    const malformedStatus = '45000000-0000-4000-8000-000000000004';
    const malformedType = '46000000-0000-4000-8000-000000000004';
    const source = rows({
      games: [completed],
      rosters: [
        roster('90000000-0000-4000-8000-000000000012', missingStatus, { status: undefined }),
        roster('90000000-0000-4000-8000-000000000013', missingType, { player_type: undefined }),
        roster('90000000-0000-4000-8000-000000000014', malformedStatus, { status: 'ACTIVE' }),
        roster('90000000-0000-4000-8000-000000000015', malformedType, { player_type: 'Regular' }),
      ],
    });

    expect(aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players).toEqual([]);
  });

  const relationshipGame = game(32, '2026-10-12T20:00:00Z');
  it.each([
    ['check-in', {
      checkins: [{
        id: 'a2000000-0000-4000-8000-000000000001',
        game_id: relationshipGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        status: 'confirmed',
      }],
    }],
    ['availability', {
      availabilities: [{
        id: 'a3000000-0000-4000-8000-000000000001',
        game_id: relationshipGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        season_id: SEASON_ID,
        status: 'out',
      }],
    }],
    ['accepted substitute', {
      acceptedSubs: [{
        id: 'b2000000-0000-4000-8000-000000000001',
        game_id: relationshipGame.id,
        invited_player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        status: 'accepted',
      }],
    }],
    ['skater stat', {
      playerStats: [{
        id: 'c2000000-0000-4000-8000-000000000001',
        game_id: relationshipGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        goals: 1,
        assists: 0,
        penalty_minutes: 0,
      }],
    }],
    ['goalie stat', {
      goalieStats: [{
        id: 'd2000000-0000-4000-8000-000000000001',
        game_id: relationshipGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: 1,
        shutout: false,
      }],
    }],
    ['goalie assignment', {
      goalieAppearances: [{
        game_id: relationshipGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_OTHER,
        team_type: 'home' as const,
      }],
    }],
  ] as Array<[string, Partial<PublicStatMetricRows>]>) (
    'fails closed before publishing mismatched same-league team evidence from a %s row',
    (_label, evidence) => {
      const source = rows({
        games: [relationshipGame],
        teams: [
          ...rows().teams,
          { id: TEAM_OTHER, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Other' },
        ],
        ...evidence,
      });

      expect(() => aggregatePublicSeasonStats(source, {
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
      })).toThrow(PublicMetricDataError);
    },
  );

  it('reports mixed recorded and regular-roster-default appearances as one publishable GP total', () => {
    const first = game(10, '2026-10-02T20:00:00Z');
    const second = game(11, '2026-10-09T20:00:00Z');
    const third = game(12, '2026-10-16T20:00:00Z');
    const source = rows({
      games: [first, second, third],
      rosters: [roster('90000000-0000-4000-8000-000000000009', PLAYER_ID, { start_date: '2026-10-01' })],
      playerStats: [first, second].map((completed, index) => ({
        id: `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        goals: index,
        assists: 1,
        penalty_minutes: null,
        scorekeeping_provenance: 'event_derived' as const,
      })),
    });

    const gamesPlayed = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].metrics.gamesPlayed;

    expect(gamesPlayed).toEqual({
      value: 3,
      state: 'reported',
      sources: ['skater_stats', 'roster_window'],
    });
  });

  it('reports accepted substitute evidence without admitting an unsupported part-time roster row', () => {
    const completed = game(5, '2026-09-20T20:00:00Z');
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Accepted Substitute', avatar_url: null, photo_url: null },
        { id: PART_TIME_ID, full_name: 'Unsupported Part Time', avatar_url: null, photo_url: null },
      ],
      rosters: [roster('90000000-0000-4000-8000-000000000002', PART_TIME_ID, { player_type: 'part-time' })],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        invited_player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
    });

    const aggregate = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID });

    expect(aggregate.players.map((player) => player.playerId)).toEqual([PLAYER_ID]);
    expect(aggregate.players[0].metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['accepted_sub'],
    });
  });

  it('reports zero sparse scoring rows for an accepted-sub-only skater', () => {
    const completed = game(39, '2026-10-18T20:00:00Z');
    const source = rows({
      games: [completed],
      acceptedSubs: [{
        id: 'b7000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        invited_player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
    });

    const player = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0];

    expect(player.roles).toEqual(['skater']);
    expect(player.metrics.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['accepted_sub'] });
    expect(player.metrics.goals).toEqual({ value: 0, state: 'reported', sources: ['accepted_sub'] });
    expect(player.metrics.assists).toEqual({ value: 0, state: 'reported', sources: ['accepted_sub'] });
    expect(player.metrics.points).toEqual({ value: 0, state: 'reported', sources: ['accepted_sub'] });
  });

  it('reports zero sparse scoring rows for a confirmed-only fallback skater', () => {
    const completed = game(40, '2026-10-19T20:00:00Z');
    const source = rows({
      games: [completed],
      checkins: [{
        id: 'a7000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }],
    });

    const player = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0];

    expect(player.roles).toEqual(['skater']);
    expect(player.metrics.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['attendance'] });
    expect(player.metrics.goals).toEqual({ value: 0, state: 'reported', sources: ['attendance'] });
    expect(player.metrics.assists).toEqual({ value: 0, state: 'reported', sources: ['attendance'] });
    expect(player.metrics.points).toEqual({ value: 0, state: 'reported', sources: ['attendance'] });
  });

  it('does not synthesize skater scoring zero for a goalie-only role', () => {
    const completed = game(41, '2026-10-20T20:00:00Z');
    const source = rows({
      games: [completed],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
    });

    const player = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0];

    expect(player.roles).toEqual(['goalie']);
    expect(player.metrics.goals).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(player.metrics.assists).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(player.metrics.points).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('does not create public players from unsupported non-regular or out-only evidence', () => {
    const completed = game(25, '2026-10-05T20:00:00Z');
    const source = rows({
      games: [completed],
      profiles: [
        { id: PART_TIME_ID, full_name: 'Out Part Time', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Availability Only', avatar_url: null, photo_url: null },
      ],
      rosters: [roster('90000000-0000-4000-8000-000000000018', PART_TIME_ID, {
        player_type: 'part_time',
      })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000025',
        game_id: completed.id,
        player_id: PART_TIME_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      availabilities: [{
        id: 'a1000000-0000-4000-8000-000000000025',
        game_id: completed.id,
        player_id: SECOND_GOALIE_ID,
        team_id: TEAM_HOME,
        season_id: SEASON_ID,
        status: 'out',
      }],
    });

    expect(aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players).toEqual([]);
  });

  it('allows only the canonical retained-history roster exception', () => {
    const completed = game(26, '2026-10-06T20:00:00Z');
    const retainedRegular = {
      ...roster('90000000-0000-4000-8000-000000000019', PLAYER_ID, { status: 'inactive' }),
      historical_retained: true,
    } as PublicStatMetricRows['rosters'][number];
    const inactiveRegular = roster('90000000-0000-4000-8000-000000000020', PART_TIME_ID, {
      status: 'inactive',
    });
    const retainedPartTime = {
      ...roster('90000000-0000-4000-8000-000000000021', SECOND_GOALIE_ID, {
        status: 'inactive',
        player_type: 'part_time',
      }),
      historical_retained: true,
    } as PublicStatMetricRows['rosters'][number];
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Retained Regular', avatar_url: null, photo_url: null },
        { id: PART_TIME_ID, full_name: 'Inactive Regular', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Retained Part Time', avatar_url: null, photo_url: null },
      ],
      rosters: [retainedRegular, inactiveRegular, retainedPartTime],
    });

    const aggregated = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    });

    expect(aggregated.players.map((player) => player.playerId)).toEqual([PLAYER_ID]);
    expect(aggregated.players[0].metrics.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['roster_window'],
    });
  });

  it('uses standalone direct goalie stats for recorded GP and direct GA', () => {
    const completed = { ...game(16, '2026-09-28T20:00:00Z', 4, 2), goalie_capture_status: 'complete' as const };
    const source = rows({
      games: [completed],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000002',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 21,
        goals_against: 1,
        shutout: false,
        scorekeeping_provenance: 'event_derived',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;

    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.wins).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.goalsAgainst).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.shutouts).toEqual({ value: 0, state: 'recorded', sources: ['goalie_stats'] });
    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('records an Out goalie nonparticipant when another goalie has the direct row without poisoning a non-Out backup', () => {
    const completed = game(45, '2026-10-24T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Direct Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Out Backup', avatar_url: null, photo_url: null },
        { id: THIRD_GOALIE_ID, full_name: 'Eligible Backup', avatar_url: null, photo_url: null },
      ],
      rosters: [
        roster('90000000-0000-4000-8000-000000000029', SECOND_GOALIE_ID, {
          is_goalie: true,
          position: 'Goalie',
        }),
        roster('90000000-0000-4000-8000-000000000030', THIRD_GOALIE_ID, {
          is_goalie: true,
          position: 'Goalie',
        }),
      ],
      checkins: [{
        id: 'aa000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: SECOND_GOALIE_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      goalieStats: [{
        id: 'da000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: 2,
        shutout: false,
      }],
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;
    const outBackup = players.find((player) => player.playerId === SECOND_GOALIE_ID)!.goalie!;
    const eligibleBackup = players.find((player) => player.playerId === THIRD_GOALIE_ID)!.goalie!;

    expect(outBackup.gamesPlayed).toEqual({ value: 0, state: 'reported', sources: ['attendance', 'roster_window'] });
    expect(outBackup.goalsAgainst).toEqual({ value: 0, state: 'reported', sources: ['attendance', 'roster_window'] });
    expect(outBackup.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['attendance', 'roster_window'] });
    expect(eligibleBackup.gamesPlayed).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(eligibleBackup.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('keeps goalie evidence isolated by player, game, and team', () => {
    const completed = game(18, '2026-09-30T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000018',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_AWAY,
        status: 'out',
      }],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000004',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 21,
        goals_against: 1,
        shutout: false,
        scorekeeping_provenance: null,
      }],
    });

    const player = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0];

    expect(player.goalie?.gamesPlayed).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
    expect(player.goalie?.goalsAgainst).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
  });

  it('keeps score-derived GA unknown for multiple direct goalie candidates', () => {
    const completed = game(19, '2026-10-01T20:00:00Z', 4, 2);
    const goalieRow = (id: string, playerId: string): PublicStatMetricRows['goalieStats'][number] => ({
      id,
      game_id: completed.id,
      player_id: playerId,
      team_id: TEAM_HOME,
      league_id: LEAGUE_ID,
      season_id: SEASON_ID,
      wins: null,
      losses: null,
      saves: null,
      shots_against: null,
      goals_against: null,
      shutout: null,
      scorekeeping_provenance: null,
    });
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'First Direct Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Second Direct Goalie', avatar_url: null, photo_url: null },
      ],
      goalieStats: [
        goalieRow('d0000000-0000-4000-8000-000000000005', PLAYER_ID),
        goalieRow('d0000000-0000-4000-8000-000000000006', SECOND_GOALIE_ID),
      ],
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.goalie?.gamesPlayed).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats'] });
      expect(player.goalie?.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: ['goalie_stats'] });
      expect(player.goalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['goalie_stats'] });
    }
  });

  it('conflicts mismatched direct goalie and assignment identities', () => {
    const completed = game(20, '2026-10-02T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Direct Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Assigned Goalie', avatar_url: null, photo_url: null },
      ],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000007',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 21,
        goals_against: 1,
        shutout: false,
        scorekeeping_provenance: null,
      }],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: SECOND_GOALIE_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.goalie?.gamesPlayed).toEqual({
        value: null,
        state: 'conflicted',
        sources: ['goalie_stats', 'goalie_assignment'],
      });
      expect(player.goalie?.goalsAgainst.state).toBe('conflicted');
    }
  });

  it('conflicts every direct and assigned identity when the assignment identity set disagrees', () => {
    const completed = game(30, '2026-10-10T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Direct Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Competing Assignment', avatar_url: null, photo_url: null },
      ],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000008',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 21,
        goals_against: 1,
        shutout: false,
        scorekeeping_provenance: 'event_derived',
      }],
      goalieAppearances: [PLAYER_ID, SECOND_GOALIE_ID].map((playerId) => ({
        game_id: completed.id,
        player_id: playerId,
        team_id: TEAM_HOME,
        team_type: 'home' as const,
      })),
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.goalie?.gamesPlayed).toEqual({
        value: null,
        state: 'conflicted',
        sources: ['goalie_stats', 'goalie_assignment'],
      });
      for (const metric of ['wins', 'losses', 'goalsAgainst', 'goalsAgainstAverage', 'shutouts'] as const) {
        expect(player.goalie?.[metric]).toEqual(expect.objectContaining({
          value: null,
          state: 'conflicted',
          sources: expect.arrayContaining(['goalie_stats', 'goalie_assignment']),
        }));
        expect(player.goalie?.[metric].sources).not.toContain('capture_confirmation');
      }
      expect(player.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
      expect(player.goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
    }
  });

  it('rejects duplicate direct goalie rows for one game and player before aggregation', () => {
    const completed = game(52, '2026-10-31T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      goalieStats: [
        goalieStat('d5000000-0000-4000-8000-000000000052', completed.id, PLAYER_ID, TEAM_HOME, 2),
        goalieStat('d6000000-0000-4000-8000-000000000052', completed.id, PLAYER_ID, TEAM_HOME, 3),
      ],
    });

    expect(() => aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })).toThrow(PublicMetricDataError);
  });

  it('rejects one player with direct goalie rows for both teams in one game', () => {
    const completed = game(53, '2026-11-01T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      goalieStats: [
        goalieStat('d5000000-0000-4000-8000-000000000053', completed.id, PLAYER_ID, TEAM_HOME, 2),
        goalieStat('d6000000-0000-4000-8000-000000000053', completed.id, PLAYER_ID, TEAM_AWAY, 4),
      ],
    });

    expect(() => aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })).toThrow(PublicMetricDataError);
  });

  it('allows distinct players to resolve opposite teams in the same game', () => {
    const completed = game(54, '2026-11-02T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Home Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Away Goalie', avatar_url: null, photo_url: null },
      ],
      goalieStats: [
        goalieStat('d5000000-0000-4000-8000-000000000054', completed.id, PLAYER_ID, TEAM_HOME, 2),
        goalieStat('d6000000-0000-4000-8000-000000000054', completed.id, SECOND_GOALIE_ID, TEAM_AWAY, 4),
      ],
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;

    expect(players).toHaveLength(2);
    expect(players.find((player) => player.playerId === PLAYER_ID)?.goalie).toMatchObject({
      gamesPlayed: { value: 1, state: 'recorded', sources: ['goalie_stats'] },
      goalsAgainst: { value: 2, state: 'recorded', sources: ['goalie_stats'] },
    });
    expect(players.find((player) => player.playerId === SECOND_GOALIE_ID)?.goalie).toMatchObject({
      gamesPlayed: { value: 1, state: 'recorded', sources: ['goalie_stats'] },
      goalsAgainst: { value: 4, state: 'recorded', sources: ['goalie_stats'] },
    });
  });

  it('rejects duplicate assignment rows instead of using them as capture confirmation', () => {
    const completed = { ...game(31, '2026-10-11T20:00:00Z', 4, 2), goalie_capture_status: 'complete' as const };
    const assignment = {
      game_id: completed.id,
      player_id: PLAYER_ID,
      team_id: TEAM_HOME,
      team_type: 'home' as const,
    };
    const source = rows({
      games: [completed],
      goalieAppearances: [assignment, { ...assignment }],
    });

    expect(() => aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })).toThrow('invalid goalie appearance row');
  });

  it('verifies event-derived direct goalie data only with its matching assignment', () => {
    const completed = { ...game(17, '2026-09-29T20:00:00Z', 4, 2), goalie_capture_status: 'complete' as const };
    const source = rows({
      games: [completed],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000003',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 21,
        goals_against: 1,
        shutout: false,
        scorekeeping_provenance: 'event_derived',
      }],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000017',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;
    const provenance = ['attendance', 'goalie_stats', 'goalie_assignment', 'capture_confirmation'];

    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'verified', sources: provenance });
    expect(goalie?.goalsAgainst).toEqual({ value: 1, state: 'verified', sources: provenance });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 1, state: 'verified', sources: provenance });
  });

  it('keeps direct capture GP verified while score-derived null GA remains reported', () => {
    const completed = { ...game(33, '2026-10-13T20:00:00Z', 4, 2), goalie_capture_status: 'complete' as const };
    const source = rows({
      games: [completed],
      goalieStats: [{
        id: 'd3000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: null,
        shutout: false,
        scorekeeping_provenance: 'event_derived',
      }],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;
    const provenance = ['goalie_stats', 'goalie_assignment', 'capture_confirmation'];

    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'verified', sources: provenance });
    expect(goalie?.goalsAgainst).toEqual({ value: 2, state: 'reported', sources: provenance });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 2, state: 'reported', sources: provenance });
  });

  it('derives reported GP, GA, and GAA for one eligible regular roster goalie', () => {
    const completed = game(6, '2026-09-21T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      rosters: [roster('90000000-0000-4000-8000-000000000003', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })],
    });

    const goalie = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0].goalie;

    expect(goalie?.goalsAgainst).toEqual({ value: 2, state: 'reported', sources: ['roster_window'] });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 2, state: 'reported', sources: ['roster_window'] });
    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['roster_window'] });
    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('retains confirmed attendance in regular-goalie provenance', () => {
    const completed = game(21, '2026-10-03T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      rosters: [roster('90000000-0000-4000-8000-000000000016', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000021',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;

    expect(goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'reported',
      sources: ['attendance', 'roster_window'],
    });
    expect(goalie?.goalsAgainst).toEqual({
      value: 2,
      state: 'reported',
      sources: ['attendance', 'roster_window'],
    });
  });

  it('keeps confirmed plus Out evidence conflicted for participation and goalie GP, GA, and GAA', () => {
    const completed = game(47, '2026-10-26T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      rosters: [roster('95000000-0000-4000-8000-000000000001', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })],
      checkins: [
        {
          id: 'a5000000-0000-4000-8000-000000000047',
          game_id: completed.id,
          player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'confirmed',
        },
        {
          id: 'a6000000-0000-4000-8000-000000000047',
          game_id: completed.id,
          player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'out',
        },
      ],
    });

    const player = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0];
    const conflict = {
      value: null,
      state: 'conflicted',
      sources: ['attendance', 'roster_window'],
    };

    expect(player.metrics.gamesPlayed).toEqual({ ...conflict, candidates: { confirmed: 1 } });
    expect(player.goalie?.gamesPlayed).toEqual(conflict);
    expect(player.goalie?.goalsAgainst).toEqual(conflict);
    expect(player.goalie?.goalsAgainstAverage).toEqual(conflict);
    expect(player.goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(player.goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('retains Out-game provenance when a later direct goalie row resolves GP, GA, and GAA', () => {
    const outGame = game(48, '2026-10-27T20:00:00Z', 3, 1);
    const resolvedGame = game(49, '2026-10-28T20:00:00Z', 4, 2);
    const source = rows({
      games: [outGame, resolvedGame],
      rosters: [roster('95000000-0000-4000-8000-000000000002', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })],
      checkins: [{
        id: 'a5000000-0000-4000-8000-000000000048',
        game_id: outGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      goalieStats: [goalieStat(
        'd5000000-0000-4000-8000-000000000049',
        resolvedGame.id,
      )],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;
    const resolved = {
      value: 1,
      state: 'recorded',
      sources: ['attendance', 'goalie_stats', 'roster_window'],
    };

    expect(goalie?.gamesPlayed).toEqual(resolved);
    expect(goalie?.goalsAgainst).toEqual({ ...resolved, value: 2 });
    expect(goalie?.goalsAgainstAverage).toEqual({ ...resolved, value: 2 });
    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('retains Out-game provenance when a separate two-goalie game is incomplete', () => {
    const outGame = game(50, '2026-10-29T20:00:00Z', 3, 1);
    const ambiguousGame = game(51, '2026-10-30T20:00:00Z', 4, 2);
    const source = rows({
      games: [outGame, ambiguousGame],
      profiles: [
        { id: PLAYER_ID, full_name: 'Out Then Ambiguous', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Competing Goalie', avatar_url: null, photo_url: null },
      ],
      rosters: [
        roster('95000000-0000-4000-8000-000000000003', PLAYER_ID, {
          is_goalie: true,
          position: 'Goalie',
        }),
        roster('95000000-0000-4000-8000-000000000004', SECOND_GOALIE_ID, {
          is_goalie: true,
          position: 'Goalie',
        }),
      ],
      checkins: [{
        id: 'a5000000-0000-4000-8000-000000000050',
        game_id: outGame.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players.find((player) => player.playerId === PLAYER_ID)!.goalie;
    const incomplete = {
      value: null,
      state: 'unknown',
      sources: ['attendance', 'roster_window'],
    };

    expect(goalie?.gamesPlayed).toEqual(incomplete);
    expect(goalie?.goalsAgainst).toEqual(incomplete);
    expect(goalie?.goalsAgainstAverage).toEqual(incomplete);
    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('does not let an explicitly Out prior game suppress two later supported goalie appearances', () => {
    const connorId = 'c4aade43-67a7-4e73-9909-c49c9d9ff766';
    const replacementId = '30d934e9-e05f-4987-adf0-c6883001f929';
    const badBunny = '093f611c-0cdc-4509-afde-9c661b5833c9';
    const firstGeneral = '453d62d9-80b4-4f26-a2ee-861f0c063402';
    const liuna = '346833e0-2780-492d-86db-94df0b0cb3e1';
    const fitzRays = 'e4be829d-952c-4531-8376-215907fab3b7';
    const october2 = {
      ...game(35, '2026-10-02T02:30:00Z', 2, 6),
      id: '508ee689-b548-518e-b083-5e896533bf25',
      home_team_id: firstGeneral,
      away_team_id: badBunny,
    };
    const october9 = {
      ...game(36, '2026-10-09T02:15:00Z', 5, 9),
      id: '743fa5ad-5aae-522d-b820-f80fbd7a5f5b',
      home_team_id: badBunny,
      away_team_id: liuna,
    };
    const october16 = {
      ...game(37, '2026-10-16T02:30:00Z', 6, 6),
      id: 'b51c2bcf-82db-5170-8dc5-6f535c12c9ec',
      home_team_id: badBunny,
      away_team_id: fitzRays,
    };
    const source = rows({
      games: [october2, october9, october16],
      teams: [
        { id: badBunny, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Bad Bunny' },
        { id: firstGeneral, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'First General London' },
        { id: liuna, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'Liuna Premier' },
        { id: fitzRays, league_id: LEAGUE_ID, division_id: DIVISION_ID, name: 'FitzRays Flyers' },
      ],
      profiles: [
        { id: connorId, full_name: 'Connor Geraghty', avatar_url: null, photo_url: null },
        { id: replacementId, full_name: 'Christian Jarchow', avatar_url: null, photo_url: null },
      ],
      rosters: [
        roster('cbebfba4-2b06-4454-a45c-d68d41d091b7', connorId, {
          team_id: badBunny,
          start_date: '2026-10-01',
          is_goalie: true,
          position: 'Goalie',
        }),
        roster('90000000-0000-4000-8000-000000000025', replacementId, {
          team_id: badBunny,
          start_date: '2026-10-01',
          is_goalie: true,
          position: 'Goalie',
          player_type: 'sub',
        }),
      ],
      checkins: [
        {
          id: '72d1d0b2-37d1-4aed-8139-e899d0dbafa0',
          game_id: october2.id,
          player_id: connorId,
          team_id: badBunny,
          status: 'out',
        },
        {
          id: 'a5000000-0000-4000-8000-000000000001',
          game_id: october2.id,
          player_id: replacementId,
          team_id: badBunny,
          status: 'confirmed',
        },
        {
          id: 'ed66ba4d-74b6-4e18-91b7-569129df20db',
          game_id: october9.id,
          player_id: connorId,
          team_id: badBunny,
          status: 'confirmed',
        },
        {
          id: 'd1b8ea3f-f22f-4b44-bdf4-b1973c8021b0',
          game_id: october16.id,
          player_id: connorId,
          team_id: badBunny,
          status: 'confirmed',
        },
      ],
      acceptedSubs: [{
        id: '3f77c381-3468-4c1a-9af7-d900e0f947b1',
        game_id: october2.id,
        invited_player_id: replacementId,
        team_id: badBunny,
        status: 'accepted',
      }],
    });

    const connor = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players.find((player) => player.playerId === connorId)!;

    expect(connor.goalie).toMatchObject({
      gamesPlayed: { value: 2, state: 'reported', sources: ['attendance', 'roster_window'] },
      goalsAgainst: { value: 15, state: 'reported', sources: ['attendance', 'roster_window'] },
      goalsAgainstAverage: { value: 7.5, state: 'reported', sources: ['attendance', 'roster_window'] },
      saves: { value: null, state: 'unknown', sources: [] },
      savePercentage: { value: null, state: 'unknown', sources: [] },
    });
  });

  it.each(['direct goalie row', 'goalie assignment'] as const)(
    'keeps an explicitly Out goalie conflicted when contradictory %s evidence exists',
    (evidence) => {
      const completed = game(38, '2026-10-17T20:00:00Z', 4, 2);
      const source = rows({
        games: [completed],
        rosters: [roster('90000000-0000-4000-8000-000000000026', PLAYER_ID, {
          is_goalie: true,
          position: 'Goalie',
        })],
        checkins: [{
          id: 'a6000000-0000-4000-8000-000000000001',
          game_id: completed.id,
          player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'out',
        }],
        ...(evidence === 'direct goalie row' ? {
          goalieStats: [{
            id: 'd6000000-0000-4000-8000-000000000001',
            game_id: completed.id,
            player_id: PLAYER_ID,
            team_id: TEAM_HOME,
            league_id: LEAGUE_ID,
            season_id: SEASON_ID,
            wins: null,
            losses: null,
            saves: null,
            shots_against: null,
            goals_against: 2,
            shutout: false,
          }],
        } : {
          goalieAppearances: [{
            game_id: completed.id,
            player_id: PLAYER_ID,
            team_id: TEAM_HOME,
            team_type: 'home' as const,
          }],
        }),
      });

      const goalie = aggregatePublicSeasonStats(source, {
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
      }).players[0].goalie;

      expect(goalie?.gamesPlayed.state).toBe('conflicted');
      expect(goalie?.goalsAgainst.state).toBe('conflicted');
      expect(goalie?.goalsAgainstAverage.state).toBe('conflicted');
    },
  );

  it('keeps an explicitly Out assigned goalie conflicted amid multiple assignments', () => {
    const completed = game(43, '2026-10-22T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Out Assigned Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Other Assigned Goalie', avatar_url: null, photo_url: null },
      ],
      rosters: [roster('90000000-0000-4000-8000-000000000028', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })],
      checkins: [{
        id: 'a9000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
      goalieAppearances: [PLAYER_ID, SECOND_GOALIE_ID].map((playerId) => ({
        game_id: completed.id,
        player_id: playerId,
        team_id: TEAM_HOME,
        team_type: 'home' as const,
      })),
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;
    const outGoalie = players.find((player) => player.playerId === PLAYER_ID)!.goalie!;

    for (const metric of ['gamesPlayed', 'wins', 'losses', 'goalsAgainst', 'goalsAgainstAverage', 'shutouts'] as const) {
      expect(outGoalie[metric]).toEqual(expect.objectContaining({
        value: null,
        state: 'conflicted',
        sources: expect.arrayContaining(['attendance', 'goalie_assignment', 'roster_window']),
      }));
    }
    expect(outGoalie.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(outGoalie.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it('keeps multiple non-Out assignments unknown rather than conflicted', () => {
    const completed = game(44, '2026-10-23T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'First Assigned Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Second Assigned Goalie', avatar_url: null, photo_url: null },
      ],
      goalieAppearances: [PLAYER_ID, SECOND_GOALIE_ID].map((playerId) => ({
        game_id: completed.id,
        player_id: playerId,
        team_id: TEAM_HOME,
        team_type: 'home' as const,
      })),
    });

    const players = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players;

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.goalie?.gamesPlayed).toEqual({ value: null, state: 'unknown', sources: ['goalie_assignment'] });
      expect(player.goalie?.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: ['goalie_assignment'] });
      expect(player.goalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['goalie_assignment'] });
    }
  });

  it('retains confirmed attendance in assignment-only goalie provenance', () => {
    const completed = game(22, '2026-10-04T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000022',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;

    expect(goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'recorded',
      sources: ['attendance', 'goalie_assignment'],
    });
    expect(goalie?.goalsAgainst).toEqual({
      value: 2,
      state: 'reported',
      sources: ['attendance', 'goalie_assignment'],
    });
  });

  it('retains confirmed attendance when capture confirms an assignment-only goalie GP', () => {
    const completed = {
      ...game(27, '2026-10-07T20:00:00Z', 4, 2),
      goalie_capture_status: 'complete' as const,
    };
    const source = rows({
      games: [completed],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000027',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'confirmed',
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players[0].goalie;

    expect(goalie?.gamesPlayed).toEqual({
      value: 1,
      state: 'verified',
      sources: ['attendance', 'goalie_assignment', 'capture_confirmation'],
    });
  });

  it('keeps multiple eligible goalies unknown and reports an explicitly Out lone goalie as zero', () => {
    const completed = game(7, '2026-09-22T20:00:00Z', 5, 3);
    const profiles = [
      { id: PLAYER_ID, full_name: 'First Goalie', avatar_url: null, photo_url: null },
      { id: SECOND_GOALIE_ID, full_name: 'Second Goalie', avatar_url: null, photo_url: null },
    ];
    const multiple = rows({
      games: [completed],
      profiles,
      rosters: [
        roster('90000000-0000-4000-8000-000000000004', PLAYER_ID, { is_goalie: true, position: 'Goalie' }),
        roster('90000000-0000-4000-8000-000000000005', SECOND_GOALIE_ID, { is_goalie: true, position: 'Goalie' }),
      ],
    });

    const multiplePlayers = aggregatePublicSeasonStats(multiple, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players;
    for (const player of multiplePlayers) {
      expect(player.goalie?.gamesPlayed).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
      expect(player.goalie?.goalsAgainst).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
      expect(player.goalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['roster_window'] });
    }

    const out = rows({
      games: [completed],
      rosters: [roster('90000000-0000-4000-8000-000000000006', PLAYER_ID, { is_goalie: true, position: 'Goalie' })],
      checkins: [{
        id: 'a0000000-0000-4000-8000-000000000002',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'out',
      }],
    });
    const outGoalie = aggregatePublicSeasonStats(out, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0].goalie;
    expect(outGoalie?.gamesPlayed).toEqual({ value: 0, state: 'reported', sources: ['attendance', 'roster_window'] });
    expect(outGoalie?.goalsAgainst).toEqual({ value: 0, state: 'reported', sources: ['attendance', 'roster_window'] });
    expect(outGoalie?.goalsAgainstAverage).toEqual({ value: null, state: 'unknown', sources: ['attendance', 'roster_window'] });
  });

  it('uses accepted-sub goalie assignment evidence for GP and score-derived GA while keeping saves unknown', () => {
    const completed = game(8, '2026-09-23T20:00:00Z', 4, 2);
    const source = rows({
      games: [completed],
      acceptedSubs: [{
        id: 'b0000000-0000-4000-8000-000000000002',
        game_id: completed.id,
        invited_player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        status: 'accepted',
      }],
      goalieAppearances: [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home',
      }],
      goalieStats: [{
        id: 'd0000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: 20,
        shots_against: 22,
        goals_against: null,
        shutout: false,
      }],
    });

    const goalie = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0].goalie;

    expect(goalie?.goalsAgainst).toEqual({ value: 2, state: 'reported', sources: ['goalie_stats', 'goalie_assignment'] });
    expect(goalie?.goalsAgainstAverage).toEqual({ value: 2, state: 'reported', sources: ['goalie_stats', 'goalie_assignment'] });
    expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'recorded', sources: ['goalie_stats', 'goalie_assignment'] });
    expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
    expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
  });

  it.each(['sub', 'part_time'])(
    'resolves one positively evidenced canonical %s roster goalie without an assignment row',
    (playerType) => {
      const completed = game(13, '2026-09-25T20:00:00Z', 4, 2);
      const source = rows({
        games: [completed],
        rosters: [roster('90000000-0000-4000-8000-000000000010', PLAYER_ID, {
          is_goalie: true,
          position: 'Goalie',
          player_type: playerType,
        })],
        acceptedSubs: [{
          id: 'b0000000-0000-4000-8000-000000000003',
          game_id: completed.id,
          invited_player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'accepted',
        }],
      });

      const goalie = aggregatePublicSeasonStats(source, { leagueId: LEAGUE_ID, seasonId: SEASON_ID }).players[0].goalie;

      expect(goalie?.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['accepted_sub'] });
      expect(goalie?.goalsAgainst).toEqual({ value: 2, state: 'reported', sources: ['accepted_sub'] });
      expect(goalie?.goalsAgainstAverage).toEqual({ value: 2, state: 'reported', sources: ['accepted_sub'] });
      expect(goalie?.saves).toEqual({ value: null, state: 'unknown', sources: [] });
      expect(goalie?.savePercentage).toEqual({ value: null, state: 'unknown', sources: [] });
    },
  );

  it.each(['sub', 'part_time'])(
    'retains a canonical accepted-sub %s goalie role while explicit Out reports zero GP and GA',
    (playerType) => {
      const completed = game(42, '2026-10-21T20:00:00Z', 4, 2);
      const source = rows({
        games: [completed],
        rosters: [roster('90000000-0000-4000-8000-000000000027', PLAYER_ID, {
          is_goalie: true,
          position: 'Goalie',
          player_type: playerType,
        })],
        acceptedSubs: [{
          id: 'b8000000-0000-4000-8000-000000000001',
          game_id: completed.id,
          invited_player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'accepted',
        }],
        checkins: [{
          id: 'a8000000-0000-4000-8000-000000000001',
          game_id: completed.id,
          player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'out',
        }],
      });

      const player = aggregatePublicSeasonStats(source, {
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
      }).players[0];

      expect(player.roles).toEqual(['goalie']);
      expect(player.goalie).toMatchObject({
        gamesPlayed: { value: 0, state: 'reported', sources: ['attendance', 'accepted_sub'] },
        goalsAgainst: { value: 0, state: 'reported', sources: ['attendance', 'accepted_sub'] },
        goalsAgainstAverage: { value: null, state: 'unknown', sources: ['attendance', 'accepted_sub'] },
        saves: { value: null, state: 'unknown', sources: [] },
        savePercentage: { value: null, state: 'unknown', sources: [] },
      });
    },
  );

  it.each(['substitute', 'unknown', undefined])(
    'default-denies malformed non-regular goalie type %s while preserving accepted-sub participation',
    (playerType) => {
      const completed = game(29, '2026-10-09T20:00:00Z', 4, 2);
      const source = rows({
        games: [completed],
        rosters: [roster('90000000-0000-4000-8000-000000000023', PLAYER_ID, {
          is_goalie: true,
          position: 'Goalie',
          player_type: playerType,
        })],
        acceptedSubs: [{
          id: 'b0000000-0000-4000-8000-000000000004',
          game_id: completed.id,
          invited_player_id: PLAYER_ID,
          team_id: TEAM_HOME,
          status: 'accepted',
        }],
      });

      const player = aggregatePublicSeasonStats(source, {
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
      }).players[0];

      expect(player.metrics.gamesPlayed).toEqual({ value: 1, state: 'reported', sources: ['accepted_sub'] });
      expect(player.roles).toEqual(['skater']);
      expect(player.goalie).toBeNull();
    },
  );

  it('indexes source rows once instead of rescanning whole arrays in game and player loops', () => {
    const scans: Record<string, number> = {
      rosters: 0,
      playerStats: 0,
      goalieStats: 0,
      goalieAppearances: 0,
    };
    const instrument = <T,>(label: string, values: T[]): T[] => {
      const wrap = (current: T[]): T[] => new Proxy(current, {
        get(target, property, receiver) {
          if (property === 'filter') {
            return (predicate: (value: T, index: number, array: T[]) => unknown) => {
              scans[label] += 1;
              return wrap(target.filter(predicate));
            };
          }
          if (property === 'find') {
            return (predicate: (value: T, index: number, array: T[]) => unknown) => {
              scans[label] += 1;
              return target.find(predicate);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return wrap(values);
    };
    const completed = { ...game(34, '2026-10-14T20:00:00Z'), goalie_capture_status: 'complete' as const };
    const source = rows({
      games: [completed],
      rosters: instrument('rosters', [roster('90000000-0000-4000-8000-000000000024', PLAYER_ID, {
        is_goalie: true,
        position: 'Goalie',
      })]),
      playerStats: instrument('playerStats', [{
        id: 'c4000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        goals: 0,
        assists: 0,
        penalty_minutes: 0,
      }]),
      goalieStats: instrument('goalieStats', [{
        id: 'd4000000-0000-4000-8000-000000000001',
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        league_id: LEAGUE_ID,
        season_id: SEASON_ID,
        wins: 1,
        losses: 0,
        saves: null,
        shots_against: null,
        goals_against: 2,
        shutout: false,
        scorekeeping_provenance: 'event_derived',
      }]),
      goalieAppearances: instrument('goalieAppearances', [{
        game_id: completed.id,
        player_id: PLAYER_ID,
        team_id: TEAM_HOME,
        team_type: 'home' as const,
      }]),
    });

    expect(aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players).toHaveLength(1);
    expect(scans).toEqual({ rosters: 0, playerStats: 0, goalieStats: 0, goalieAppearances: 0 });
  });

  it('keeps assignment player-id access linear near the source-cardinality limit', () => {
    const completed = game(46, '2026-10-25T20:00:00Z');
    const rowCount = 200;
    let assignmentPlayerIdReads = 0;
    const candidateIds = Array.from({ length: rowCount }, (_, index) =>
      `44000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`);
    const assignmentIds = Array.from({ length: rowCount }, (_, index) =>
      `45000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`);
    const goalieAppearances = assignmentIds.map((playerId) => new Proxy({
      game_id: completed.id,
      player_id: playerId,
      team_id: TEAM_HOME,
      team_type: 'home' as const,
    }, {
      get(target, property, receiver) {
        if (property === 'player_id') assignmentPlayerIdReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }));
    const source = rows({
      games: [completed],
      rosters: candidateIds.map((playerId, index) => roster(
        `94000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
        playerId,
        { is_goalie: true, position: 'Goalie' },
      )),
      checkins: candidateIds.map((playerId, index) => ({
        id: `a4000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
        game_id: completed.id,
        player_id: playerId,
        team_id: TEAM_HOME,
        status: 'out',
      })),
      goalieAppearances,
    });

    expect(aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    }).players).toHaveLength(rowCount * 2);
    expect(assignmentPlayerIdReads).toBeLessThanOrEqual(rowCount * 12);
  });

  it('fails before pathological roster-by-game derived appearance work', () => {
    const completedGames = Array.from({ length: 200 }, (_, index) => ({
      ...game(index + 1_000, '2026-10-15T20:00:00Z'),
    }));
    const rosterRows = Array.from({ length: 251 }, (_, index) => roster(
      `90000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
      `40000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
    ));
    const source = rows({
      games: completedGames,
      rosters: rosterRows,
    });

    expect(() => aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })).toThrow(PublicMetricLimitError);
  });

  it('filters player-scoped output only after using competing goalie context', () => {
    const completed = game(9, '2026-09-24T20:00:00Z', 3, 1);
    const source = rows({
      games: [completed],
      profiles: [
        { id: PLAYER_ID, full_name: 'Selected Goalie', avatar_url: null, photo_url: null },
        { id: SECOND_GOALIE_ID, full_name: 'Competing Goalie', avatar_url: null, photo_url: null },
      ],
      rosters: [
        roster('90000000-0000-4000-8000-000000000007', PLAYER_ID, { is_goalie: true, position: 'Goalie' }),
        roster('90000000-0000-4000-8000-000000000008', SECOND_GOALIE_ID, { is_goalie: true, position: 'Goalie' }),
      ],
    });

    const aggregate = aggregatePublicSeasonStats(source, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      playerId: PLAYER_ID,
    });

    expect(aggregate.players.map((player) => player.playerId)).toEqual([PLAYER_ID]);
    expect(aggregate.players[0].goalie?.gamesPlayed).toEqual({
      value: null,
      state: 'unknown',
      sources: ['roster_window'],
    });
  });
});
