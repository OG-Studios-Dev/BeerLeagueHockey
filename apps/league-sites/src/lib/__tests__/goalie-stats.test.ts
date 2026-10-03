import { aggregateNativeGoalieStatsRows } from '../data';

describe('aggregateNativeGoalieStatsRows', () => {
  it('returns a populated goalie row and pulls jersey numbers from rosters', () => {
    const rows = aggregateNativeGoalieStatsRows(
      [
        {
          player_id: 'goalie-1',
          team_id: 'team-1',
          season_id: 'season-1',
          game_id: 'game-1',
          saves: 20,
          shots_against: 22,
          goals_against: 2,
          shutout: false,
          game_result: null,
          player: {
            full_name: 'Jordan Goalie',
            avatar_url: 'https://example.com/goalie.png',
          },
          team: {
            name: 'Blades',
            divisions: { name: 'Division A' },
          },
          game: {
            home_team_id: 'team-1',
            away_team_id: 'team-2',
            home_score: 4,
            away_score: 2,
          },
        },
        {
          player_id: 'goalie-1',
          team_id: 'team-1',
          season_id: 'season-1',
          game_id: 'game-2',
          saves: 30,
          shots_against: 33,
          goals_against: 3,
          shutout: false,
          game_result: null,
          player: {
            full_name: 'Jordan Goalie',
            avatar_url: 'https://example.com/goalie.png',
          },
          team: {
            name: 'Blades',
            divisions: { name: 'Division A' },
          },
          game: {
            home_team_id: 'team-1',
            away_team_id: 'team-3',
            home_score: 1,
            away_score: 3,
          },
        },
      ],
      [
        {
          player_id: 'goalie-1',
          team_id: 'team-1',
          season_id: 'season-1',
          jersey_number: 31,
        },
      ],
      'season-1',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      player_id: 'goalie-1',
      player_name: 'Jordan Goalie',
      jersey_number: '31',
      team_id: 'team-1',
      team_name: 'Blades',
      division_name: 'Division A',
      games_played: 2,
      wins: 1,
      losses: 1,
      saves: 50,
      goals_against: 5,
      save_percentage: 90.9,
      goals_against_average: 2.5,
      shutouts: 0,
    });
  });
});
