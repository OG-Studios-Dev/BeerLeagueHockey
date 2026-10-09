import {
  HLHL_WINTER_2026_SEASON_ID,
  applyImportedAggregateGoalieOverride,
  applyImportedAggregateSkaterOverride,
  getImportedAggregateGoalieSeed,
  getImportedAggregateGoalieSeeds,
  getImportedAggregateSkaterSeed,
  getImportedAggregateSkaterSeeds,
  getImportedAggregateSkaterGamesPlayed,
  isAggregateOnlySeasonView,
} from '../imported-aggregate-season-overrides';

describe('imported aggregate season overrides', () => {
  it('returns the seeded winter GP override for Hockey Life skaters', () => {
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Adam Klimowicz')).toBe(11);
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Steve Almond')).toBe(10);
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Dan MacGillivray')).toBe(9);
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Eric Mortson')).toBe(10);
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Dan Macgillavray')).toBeNull();
    expect(getImportedAggregateSkaterGamesPlayed(HLHL_WINTER_2026_SEASON_ID, 'Eric Morston')).toBeNull();
    expect(getImportedAggregateSkaterGamesPlayed('some-other-season', 'Adam Klimowicz')).toBeNull();
  });

  it('exposes the full imported winter skater totals', () => {
    expect(getImportedAggregateSkaterSeed(HLHL_WINTER_2026_SEASON_ID, 'Matt Grossi')).toMatchObject({
      teamName: 'FitzRays Flyers',
      gamesPlayed: 10,
      goals: 12,
      assists: 7,
    });
    expect(getImportedAggregateSkaterSeeds(HLHL_WINTER_2026_SEASON_ID)).toHaveLength(62);
  });

  it('exposes the full imported winter goalie totals', () => {
    expect(getImportedAggregateGoalieSeed(HLHL_WINTER_2026_SEASON_ID, 'Steven Wild')).toMatchObject({
      teamName: 'First General London',
      gamesPlayed: 10,
      wins: 5,
      losses: 4,
      goalsAgainst: 33,
    });
    expect(getImportedAggregateGoalieSeed(HLHL_WINTER_2026_SEASON_ID, 'Vince Mitalas')).toMatchObject({
      gamesPlayed: 1,
      wins: 1,
      goalsAgainst: 1,
      saves: 24,
    });
    expect(getImportedAggregateGoalieSeeds(HLHL_WINTER_2026_SEASON_ID)).toHaveLength(9);
  });

  it('detects aggregate-only season views', () => {
    expect(isAggregateOnlySeasonView(HLHL_WINTER_2026_SEASON_ID, '2026 Winter Thursdays')).toBe(true);
    expect(isAggregateOnlySeasonView('some-other-season', 'Historical Career Baseline (Pre-BLH)')).toBe(true);
    expect(isAggregateOnlySeasonView('some-other-season', 'Spring 2026')).toBe(false);
  });

  it('applies skater GP overrides and recomputes rate stats', () => {
    const row = applyImportedAggregateSkaterOverride(
      {
        player_id: 'p1',
        player_name: 'Adam Klimowicz',
        avatar_url: null,
        team_id: 't1',
        team_name: 'First General London',
        division_name: null,
        position: null,
        games_played: 1,
        goals: 9,
        assists: 14,
        points: 23,
        points_per_game: 23,
        goals_per_game: 9,
        assists_per_game: 14,
        penalty_minutes: 0,
        plus_minus: 0,
        power_play_goals: 0,
        power_play_assists: 0,
        power_play_points: 0,
        short_handed_goals: 0,
        short_handed_assists: 0,
        game_winning_goals: 0,
        empty_net_goals: 0,
        shots: 0,
        shots_per_game: 0,
      },
      HLHL_WINTER_2026_SEASON_ID,
    );

    expect(row.games_played).toBe(11);
    expect(row.points_per_game).toBeCloseTo(2.09, 2);
    expect(row.goals_per_game).toBeCloseTo(0.82, 2);
    expect(row.assists_per_game).toBeCloseTo(1.27, 2);
  });

  it('applies goalie GP/win-loss overrides', () => {
    const row = applyImportedAggregateGoalieOverride(
      {
        player_id: 'g1',
        player_name: 'Steven Wild',
        avatar_url: null,
        team_id: 't1',
        team_name: 'First General London',
        division_name: null,
        position: 'Goalie',
        games_played: 1,
        wins: 1,
        losses: 0,
        saves: 200,
        goals_against: 33,
        save_percentage: 85.8,
        goals_against_average: 33,
        shutouts: 0,
      },
      HLHL_WINTER_2026_SEASON_ID,
    );

    expect(row.games_played).toBe(10);
    expect(row.wins).toBe(5);
    expect(row.losses).toBe(4);
    expect(row.goals_against_average).toBeCloseTo(3.3, 2);
  });
});
