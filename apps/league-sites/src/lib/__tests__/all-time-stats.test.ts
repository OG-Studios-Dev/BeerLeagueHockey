import {
  buildHistoricalBaselineGoalieRows,
  buildHistoricalBaselineSkaterRows,
  collectHistoricalCareerBaselineSeasonIds,
  filterVisibleSiteSeasons,
  IMPORTED_ALL_TIME_TEAM_LABEL,
  isHistoricalCareerBaselineSeasonName,
  mergeAllTimeGoalieRows,
  mergeAllTimeSkaterRows,
  normalizeImportedCareerBaselineRows,
  type ImportedCareerBaselineRow,
} from '../all-time-stats';
import type { UnifiedGoalieStatsRow, UnifiedSkaterStatsRow } from '../types';

describe('all-time stats helpers', () => {
  it('normalizes legacy rows onto the shared imported baseline shape', () => {
    const [row] = normalizeImportedCareerBaselineRows(
      [
        {
          id: 'legacy-row-1',
          matched_to_profile_id: '11111111-1111-4111-8111-111111111111',
          first_name: 'Casey',
          last_name: 'Jones',
          is_goalie: false,
          games_played: 120,
          goals: 45,
          assists: 55,
          points: 100,
        },
      ],
      {
        sourceTable: 'legacy_players',
        defaultTeamName: IMPORTED_ALL_TIME_TEAM_LABEL,
      },
    );

    expect(row).toMatchObject({
      player_id: '11111111-1111-4111-8111-111111111111',
      profile_id: '11111111-1111-4111-8111-111111111111',
      player_name: 'Casey Jones',
      team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
      games_played: 120,
      goals: 45,
      assists: 55,
      points: 100,
      is_goalie: false,
    });
  });

  it('filters baseline rows by league scope when the source carries league metadata', () => {
    const rows = normalizeImportedCareerBaselineRows(
      [
        {
          id: 'keep-me',
          league_id: 'league-a',
          player_id: 'player-a',
          full_name: 'League A Skater',
          games_played: 10,
        },
        {
          id: 'drop-me',
          league_id: 'league-b',
          player_id: 'player-b',
          full_name: 'League B Skater',
          games_played: 20,
        },
      ],
      {
        sourceTable: 'league_player_career_baselines',
        leagueId: 'league-a',
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.player_id).toBe('player-a');
  });

  it('detects historical baseline seasons by name prefix rather than UUID', () => {
    expect(isHistoricalCareerBaselineSeasonName('Historical Career Baseline (Pre-BLH)')).toBe(true);
    expect(isHistoricalCareerBaselineSeasonName(' historical career baseline 2024 import ')).toBe(true);
    expect(isHistoricalCareerBaselineSeasonName('Winter 2025')).toBe(false);
    expect(isHistoricalCareerBaselineSeasonName(null)).toBe(false);
  });

  it('collects and filters hidden baseline seasons for public site selectors', () => {
    const seasons = [
      { id: 'season-current', name: 'Spring 2026' },
      { id: 'season-hidden', name: 'Historical Career Baseline (Pre-BLH)' },
      { id: 'season-completed', name: 'Winter 2026' },
    ];

    expect([...collectHistoricalCareerBaselineSeasonIds(seasons)]).toEqual(['season-hidden']);
    expect(filterVisibleSiteSeasons(seasons)).toEqual([
      { id: 'season-current', name: 'Spring 2026' },
      { id: 'season-completed', name: 'Winter 2026' },
    ]);
  });

  it('builds historical baseline skater rows directly from imported totals', () => {
    const [row] = buildHistoricalBaselineSkaterRows([
      {
        source_table: 'legacy_players',
        source_row_id: 'baseline-skater-1',
        player_id: 'player-1',
        profile_id: 'player-1',
        player_name: 'Taylor Skater',
        avatar_url: null,
        team_id: '',
        team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
        division_name: null,
        position: 'C',
        is_goalie: false,
        games_played: 120,
        goals: 48,
        assists: 72,
        points: 120,
        penalty_minutes: 18,
        plus_minus: 11,
        power_play_goals: 6,
        power_play_assists: 10,
        short_handed_goals: 1,
        short_handed_assists: 2,
        game_winning_goals: 7,
        empty_net_goals: 3,
        shots: 300,
        wins: 0,
        losses: 0,
        ties: 0,
        saves: 0,
        goals_against: 0,
        shots_against: 0,
        shutouts: 0,
        save_percentage_ratio: null,
        goals_against_average: null,
      },
    ]);

    expect(row).toMatchObject({
      player_id: 'player-1',
      games_played: 120,
      goals: 48,
      assists: 72,
      points: 120,
      points_per_game: 1,
      goals_per_game: 0.4,
      assists_per_game: 0.6,
      shots_per_game: 2.5,
      team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
    });
  });

  it('builds historical baseline goalie rows directly from imported totals', () => {
    const [row] = buildHistoricalBaselineGoalieRows([
      {
        source_table: 'legacy_players',
        source_row_id: 'baseline-goalie-1',
        player_id: 'goalie-1',
        profile_id: 'goalie-1',
        player_name: 'Jordan Goalie',
        avatar_url: null,
        team_id: '',
        team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
        division_name: null,
        position: 'G',
        is_goalie: true,
        games_played: 50,
        goals: 0,
        assists: 0,
        points: 0,
        penalty_minutes: 0,
        plus_minus: 0,
        power_play_goals: 0,
        power_play_assists: 0,
        short_handed_goals: 0,
        short_handed_assists: 0,
        game_winning_goals: 0,
        empty_net_goals: 0,
        shots: 0,
        wins: 30,
        losses: 15,
        ties: 5,
        saves: 900,
        goals_against: 100,
        shots_against: 1000,
        shutouts: 5,
        save_percentage_ratio: 0.9,
        goals_against_average: 2,
      },
    ]);

    expect(row).toMatchObject({
      player_id: 'goalie-1',
      games_played: 50,
      wins: 30,
      losses: 15,
      saves: 900,
      goals_against: 100,
      save_percentage: 90,
      goals_against_average: 2,
      shutouts: 5,
      team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
    });
  });

  it('tracks imported save percentage and GAA knowledge independently through mixed all-time rows', () => {
    const [unknownSaves] = normalizeImportedCareerBaselineRows([{
      id: 'legacy-unknown-saves', full_name: 'Unknown Saves', is_goalie: true,
      games_played: 5, saves: 0, goals_against: 20, save_percentage: 0, goals_against_average: 4,
    }], { sourceTable: 'legacy_players' });
    const [knownSaves] = normalizeImportedCareerBaselineRows([{
      id: 'legacy-known-saves', full_name: 'Known Saves', is_goalie: true,
      saves: 90, goals_against: 10, save_percentage: 90,
    }], { sourceTable: 'legacy_players' });

    expect(buildHistoricalBaselineGoalieRows([unknownSaves])[0]).toMatchObject({
      save_percentage: null,
      goals_against_average: 4,
      save_percentage_provenance: 'unmeasured',
      goals_against_average_provenance: 'measured',
    });
    expect(buildHistoricalBaselineGoalieRows([knownSaves])[0]).toMatchObject({
      save_percentage: 90,
      goals_against_average: null,
      save_percentage_provenance: 'measured',
      goals_against_average_provenance: 'unmeasured',
    });

    const [mixed] = mergeAllTimeGoalieRows([unknownSaves], [{
      player_id: unknownSaves.player_id, player_name: 'Unknown Saves', avatar_url: null,
      team_id: 'team-1', team_name: 'Native Team', division_name: null, position: 'Goalie',
      championships: 0, games_played: 5, wins: 2, losses: 3, saves: 90, goals_against: 10,
      save_percentage: 90, goals_against_average: 2, shutouts: 0,
      save_percentage_provenance: 'measured', goals_against_average_provenance: 'measured',
    }]);
    expect(mixed).toMatchObject({
      save_percentage: null,
      goals_against_average: 3,
      save_percentage_provenance: 'unmeasured',
      goals_against_average_provenance: 'measured',
    });
  });

  it('treats schema-default legacy all-zero goalie rates as unknown while preserving evidenced zeroes', () => {
    const [legacyDefault] = normalizeImportedCareerBaselineRows([{
      id: 'legacy-default-zero', full_name: 'Legacy Default', is_goalie: true,
      games_played: 0, saves: 0, goals_against: 0, save_percentage: 0, goals_against_average: 0,
    }], { sourceTable: 'legacy_players' });
    const [nativeZeroSaves] = normalizeImportedCareerBaselineRows([{
      id: 'native-zero-saves', full_name: 'Native Zero Saves', is_goalie: true,
      games_played: 1, saves: 0, goals_against: 10, shots_against: 10,
      save_percentage: 0, goals_against_average: 10,
    }], { sourceTable: 'measurement-aware-source' });
    const [nativeShutout] = normalizeImportedCareerBaselineRows([{
      id: 'native-shutout', full_name: 'Native Shutout', is_goalie: true,
      games_played: 1, saves: 20, goals_against: 0, shots_against: 20,
      save_percentage: 100, goals_against_average: 0,
    }], { sourceTable: 'measurement-aware-source' });

    expect(buildHistoricalBaselineGoalieRows([legacyDefault])[0]).toMatchObject({
      save_percentage: null,
      save_percentage_provenance: 'unmeasured',
      goals_against_average: null,
      goals_against_average_provenance: 'unmeasured',
    });
    expect(buildHistoricalBaselineGoalieRows([nativeZeroSaves])[0]).toMatchObject({
      save_percentage: 0,
      save_percentage_provenance: 'measured',
      goals_against_average: 10,
      goals_against_average_provenance: 'measured',
    });
    expect(buildHistoricalBaselineGoalieRows([nativeShutout])[0]).toMatchObject({
      save_percentage: 100,
      goals_against_average: 0,
      goals_against_average_provenance: 'measured',
    });
  });

  it('merges imported and native skater totals while preferring native team metadata', () => {
    const baselineRows: ImportedCareerBaselineRow[] = [
      {
        source_table: 'league_player_career_baselines',
        source_row_id: 'baseline-1',
        player_id: 'player-1',
        profile_id: 'player-1',
        player_name: 'Taylor Skater',
        avatar_url: null,
        team_id: '',
        team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
        division_name: null,
        position: 'C',
        is_goalie: false,
        games_played: 100,
        goals: 40,
        assists: 60,
        points: 100,
        penalty_minutes: 12,
        plus_minus: 0,
        power_play_goals: 5,
        power_play_assists: 8,
        short_handed_goals: 1,
        short_handed_assists: 2,
        game_winning_goals: 6,
        empty_net_goals: 3,
        shots: 250,
        wins: 0,
        losses: 0,
        ties: 0,
        saves: 0,
        goals_against: 0,
        shots_against: 0,
        shutouts: 0,
        save_percentage_ratio: null,
        goals_against_average: null,
      },
    ];

    const nativeRows: UnifiedSkaterStatsRow[] = [
      {
        player_id: 'player-1',
        player_name: 'Taylor Skater',
        avatar_url: 'https://example.com/avatar.png',
        team_id: 'team-1',
        team_name: 'BLH Wolves',
        division_name: 'A',
        position: 'C',
        games_played: 10,
        goals: 5,
        assists: 6,
        points: 11,
        points_per_game: 1.1,
        goals_per_game: 0.5,
        assists_per_game: 0.6,
        penalty_minutes: 4,
        plus_minus: 7,
        power_play_goals: 1,
        power_play_assists: 2,
        power_play_points: 3,
        short_handed_goals: 0,
        short_handed_assists: 1,
        game_winning_goals: 1,
        empty_net_goals: 0,
        shots: 30,
        shots_per_game: 3,
      },
    ];

    const [merged] = mergeAllTimeSkaterRows(baselineRows, nativeRows);

    expect(merged).toMatchObject({
      player_id: 'player-1',
      team_id: 'team-1',
      team_name: 'BLH Wolves',
      division_name: 'A',
      games_played: 110,
      goals: 45,
      assists: 66,
      points: 111,
      penalty_minutes: 16,
      plus_minus: 7,
      power_play_goals: 6,
      power_play_assists: 10,
      shots: 280,
    });
    expect(merged?.points_per_game).toBe(1.01);
  });

  it('merges imported and native goalie totals and recalculates rate stats from combined totals', () => {
    const baselineRows: ImportedCareerBaselineRow[] = [
      {
        source_table: 'league_player_career_baselines',
        source_row_id: 'baseline-g-1',
        player_id: 'goalie-1',
        profile_id: 'goalie-1',
        player_name: 'Jordan Goalie',
        avatar_url: null,
        team_id: '',
        team_name: IMPORTED_ALL_TIME_TEAM_LABEL,
        division_name: null,
        position: 'G',
        is_goalie: true,
        games_played: 50,
        goals: 0,
        assists: 0,
        points: 0,
        penalty_minutes: 0,
        plus_minus: 0,
        power_play_goals: 0,
        power_play_assists: 0,
        short_handed_goals: 0,
        short_handed_assists: 0,
        game_winning_goals: 0,
        empty_net_goals: 0,
        shots: 0,
        wins: 30,
        losses: 15,
        ties: 5,
        saves: 900,
        goals_against: 100,
        shots_against: 1000,
        shutouts: 5,
        save_percentage_ratio: 0.9,
        goals_against_average: 2,
      },
    ];

    const nativeRows: UnifiedGoalieStatsRow[] = [
      {
        player_id: 'goalie-1',
        player_name: 'Jordan Goalie',
        avatar_url: 'https://example.com/goalie.png',
        team_id: 'team-1',
        team_name: 'BLH Wolves',
        division_name: 'A',
        position: 'Goalie',
        games_played: 10,
        wins: 6,
        losses: 3,
        saves: 210,
        goals_against: 20,
        save_percentage: 91.3,
        goals_against_average: 2,
        shutouts: 1,
      },
    ];

    const [merged] = mergeAllTimeGoalieRows(baselineRows, nativeRows);

    expect(merged).toMatchObject({
      player_id: 'goalie-1',
      team_id: 'team-1',
      team_name: 'BLH Wolves',
      games_played: 60,
      wins: 36,
      losses: 18,
      saves: 1110,
      goals_against: 120,
      shots_against: 1230,
      shutouts: 6,
      save_percentage: 90.2,
      goals_against_average: 2,
    });
  });
});
