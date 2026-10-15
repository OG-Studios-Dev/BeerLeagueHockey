import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PublicGoalie, PublicStatMetric } from '../../src/lib/supabase/publicStats';

import {
  buildGoalieRows,
  buildLeaderRows,
  buildRankedRows,
  buildSkaterRows,
  normalizeStatsScope,
  splitPlayerName,
  type StatsScopePlayer,
} from '../../src/lib/statsPresentationModel';

const metric = (value: number | null, state: PublicStatMetric['state'] = value === null ? 'unknown' : 'recorded', sources: PublicStatMetric['sources'] = value === null ? [] : ['skater_stats']): PublicStatMetric => ({
  value,
  state,
  sources,
});

function player(overrides: Partial<StatsScopePlayer> & Pick<StatsScopePlayer, 'playerId' | 'playerName'>): StatsScopePlayer {
  return {
    avatarUrl: null,
    displayTeam: null,
    skater: {
      gamesPlayed: metric(2), goals: metric(2), assists: metric(1), points: metric(3), championships: metric(null),
    },
    goalie: null,
    ...overrides,
  };
}

function publicGoalie(overrides: Partial<PublicGoalie> & Pick<PublicGoalie, 'player_id'>): PublicGoalie {
  return {
    player_name: 'Goalie', team_id: 'team-a', team_name: 'Owls', avatar_url: null,
    games_played: 2, wins: 1, losses: 1, save_percentage: null,
    goals_against_average: 2.5, shutouts: 0, saves: null, goals_against: 5, estimated: true,
    ...overrides,
  };
}

describe('stats presentation model', () => {
  it('normalizes current, single, multiple, and all-time scopes deterministically', () => {
    const seasons = [
      { id: 'season-old', name: 'Summer 2025', status: 'completed', startDate: '2025-06-01' },
      { id: 'season-current', name: 'Fall 2026', status: 'active', startDate: '2026-09-01' },
      { id: 'season-playoffs', name: 'Spring 2026', status: 'playoffs', startDate: '2026-03-01' },
    ];
    assert.deepEqual(normalizeStatsScope({ kind: 'current' }, seasons), {
      kind: 'current', seasonIds: ['season-current'], label: 'Current season', currentSeasonId: 'season-current',
    });
    assert.deepEqual(normalizeStatsScope({ kind: 'single', seasonIds: ['season-old'] }, seasons).seasonIds, ['season-old']);
    assert.deepEqual(normalizeStatsScope({ kind: 'multiple', seasonIds: ['season-old', 'season-current', 'season-old'] }, seasons).seasonIds, ['season-current', 'season-old']);
    assert.deepEqual(normalizeStatsScope({ kind: 'all' }, seasons).seasonIds, ['season-current', 'season-playoffs', 'season-old']);
    assert.throws(() => normalizeStatsScope({ kind: 'multiple', seasonIds: [] }, seasons), /season/i);
    assert.throws(() => normalizeStatsScope({ kind: 'single', seasonIds: ['missing'] }, seasons), /season/i);
  });

  it('stacks given names above surnames without losing particles or mononyms', () => {
    assert.deepEqual(splitPlayerName('Jack Foote'), { givenName: 'Jack', surname: 'Foote' });
    assert.deepEqual(splitPlayerName('Maria de la Cruz'), { givenName: 'Maria', surname: 'de la Cruz' });
    assert.deepEqual(splitPlayerName('Cher'), { givenName: 'Cher', surname: '' });
    assert.deepEqual(splitPlayerName('  Jean-Luc   Picard  '), { givenName: 'Jean-Luc', surname: 'Picard' });
    assert.deepEqual(splitPlayerName('  Alex   Smith Jr.  '), { givenName: 'Alex', surname: 'Smith Jr.' });
  });

  it('builds the exact skater and goalie columns and derives rates only from known GP', () => {
    const rows = [
      player({ playerId: 'known', playerName: 'Known Player', skater: {
        gamesPlayed: metric(2), goals: metric(3), assists: metric(1), points: metric(4), championships: metric(0),
      }, goalie: {
        gamesPlayed: metric(2), goalsAgainst: metric(5), goalsAgainstAverage: metric(2.5), championships: metric(0),
      } }),
      player({ playerId: 'unknown', playerName: 'Unknown Player', skater: {
        gamesPlayed: metric(null, 'conflicted'), goals: metric(3), assists: metric(1), points: metric(4), championships: metric(null),
      }, goalie: {
        gamesPlayed: metric(null), goalsAgainst: metric(5), goalsAgainstAverage: metric(null), championships: metric(null),
      } }),
    ];
    const skaters = buildSkaterRows(rows);
    assert.deepEqual(skaters[0].columns.map((column) => column.key), ['gp', 'g', 'a', 'pts', 'ch', 'gpg', 'ppg']);
    assert.equal(skaters[0].columns.find((column) => column.key === 'gpg')?.display, '1.50');
    assert.equal(skaters[0].columns.find((column) => column.key === 'ppg')?.display, '2.00');
    assert.equal(skaters[1].columns.find((column) => column.key === 'gpg')?.display, 'Needs review');
    assert.match(skaters[1].columns.find((column) => column.key === 'gpg')?.accessibilityLabel ?? '', /GPG.*unavailable.*Conflicting/i);
    assert.match(skaters[1].columns.find((column) => column.key === 'ch')?.accessibilityLabel ?? '', /CH.*unavailable.*Not recorded/i);
    assert.deepEqual(buildGoalieRows(rows)[0].columns.map((column) => column.key), ['gp', 'ga', 'gaa', 'ch']);
  });

  it('preserves every provenance source and conflict candidate in accessible metric descriptions', () => {
    const sourcePlayer = player({
      playerId: 'sources', playerName: 'Source Player', skater: {
        gamesPlayed: metric(4, 'reported', ['imported', 'attendance']),
        goals: metric(2, 'estimated', ['roster_window', 'accepted_sub']),
        assists: metric(1, 'verified', ['override', 'skater_stats']),
        points: { value: null, state: 'conflicted', sources: ['skater_stats', 'override'], candidates: { confirmed: 4, recorded: 3, estimated: 5 } },
        championships: metric(null, 'unknown', []),
      },
    });
    const columns = Object.fromEntries(buildSkaterRows([sourcePlayer])[0].columns.map((column) => [column.key, column.accessibilityLabel]));
    assert.match(columns.gp, /display value 4.*reported.*imported records.*attendance records/i);
    assert.match(columns.g, /display value ~2.*estimated.*roster eligibility.*accepted substitute records/i);
    assert.match(columns.a, /display value 1.*verified.*administrative override.*game statistics/i);
    assert.match(columns.pts, /display value Needs review.*conflicted.*game statistics.*administrative override.*confirmed 4.*recorded 3.*estimated 5/i);
    assert.match(columns.ch, /display value —.*unknown.*not recorded.*no provenance source/i);
    assert.match(columns.gpg, /calculated from G.*display value ~2.*roster eligibility.*accepted substitute records.*divided by GP.*display value 4.*imported records.*attendance records/i);
    assert.match(columns.ppg, /unavailable.*points source.*confirmed 4.*recorded 3.*estimated 5.*games played source.*display value 4/i);
  });

  it('uses a returned current-season goalie estimate when the complete scope marks GAA unknown', () => {
    const goalie = player({
      playerId: 'goalie-estimated', playerName: 'Estimated Goalie',
      displayTeam: { id: 'team-a', name: 'Owls' },
      skater: null,
      goalie: { gamesPlayed: metric(2, 'estimated', ['roster_window']), goalsAgainst: metric(null), goalsAgainstAverage: metric(null), championships: metric(0) },
    });
    const leaders = buildLeaderRows([goalie], 'gaa', [publicGoalie({ player_id: goalie.playerId, player_name: goalie.playerName })]);

    assert.equal(leaders.length, 1);
    assert.equal(leaders[0].display, '2.5');
    assert.deepEqual(leaders[0].value, { value: 2.5, state: 'estimated', sources: [] });
  });

  it('formats leader GAA from raw goals-against and games-played without double rounding', () => {
    const goalie = player({
      playerId: 'rounding-boundary', playerName: 'Boundary Goalie',
      displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(11, 'estimated'), goalsAgainst: metric(null), goalsAgainstAverage: metric(null), championships: metric(0) },
    });
    const leaders = buildLeaderRows([goalie], 'gaa', [publicGoalie({
      player_id: goalie.playerId,
      games_played: 11,
      goals_against: 6,
      goals_against_average: 0.55,
    })]);

    assert.equal(leaders[0].value.value, 6 / 11);
    assert.equal(leaders[0].display, '0.5');
    assert.doesNotMatch(leaders[0].display, /~/);
  });

  it('does not replace conflicted GAA or rank nullable and ambiguous goalie fallback rows', () => {
    const conflicted = player({
      playerId: 'conflicted', playerName: 'Conflicted Goalie', displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(null, 'conflicted'), goalsAgainst: metric(null, 'conflicted'), goalsAgainstAverage: metric(null, 'conflicted'), championships: metric(0) },
    });
    const unknown = player({
      playerId: 'unknown', playerName: 'Unknown Goalie', displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(2, 'estimated'), goalsAgainst: metric(null), goalsAgainstAverage: metric(null), championships: metric(0) },
    });
    const transferred = player({ ...unknown, playerId: 'transferred', playerName: 'Transferred Goalie' });
    const leaders = buildLeaderRows([conflicted, unknown, transferred], 'gaa', [
      publicGoalie({ player_id: conflicted.playerId, player_name: conflicted.playerName }),
      publicGoalie({ player_id: unknown.playerId, player_name: unknown.playerName, goals_against_average: null }),
      publicGoalie({ player_id: transferred.playerId, player_name: transferred.playerName, team_id: 'team-a' }),
      publicGoalie({ player_id: transferred.playerId, player_name: transferred.playerName, team_id: 'team-b' }),
    ]);

    assert.deepEqual(leaders, []);
  });

  it('ranks a top five only from known values with deterministic ties and ascending GAA', () => {
    const rows = [
      player({ playerId: 'b', playerName: 'Beta Two', goalie: { gamesPlayed: metric(2), goalsAgainst: metric(4), goalsAgainstAverage: metric(2), championships: metric(0) } }),
      player({ playerId: 'a', playerName: 'Alpha One', goalie: { gamesPlayed: metric(1), goalsAgainst: metric(2), goalsAgainstAverage: metric(2), championships: metric(0) } }),
      player({ playerId: 'unknown', playerName: 'Unknown GAA', goalie: { gamesPlayed: metric(null), goalsAgainst: metric(0), goalsAgainstAverage: metric(null), championships: metric(null) } }),
      ...Array.from({ length: 5 }, (_, index) => player({ playerId: `high-${index}`, playerName: `High ${index}`, goalie: { gamesPlayed: metric(1), goalsAgainst: metric(index + 3), goalsAgainstAverage: metric(index + 3), championships: metric(0) } })),
    ];
    const leaders = buildLeaderRows(rows, 'gaa');
    assert.equal(leaders.length, 5);
    assert.deepEqual(leaders.slice(0, 2).map((row) => row.playerId), ['a', 'b']);
    assert.ok(leaders.every((row) => row.playerId !== 'unknown'));
  });

  it('assigns full-population competition ranks for descending skater and ascending GAA ties across the card cutoff', () => {
    const points = [10, 9, 8, 7, 6, 6, 5];
    const gaa = [1, 2, 3, 4, 5, 5, 6];
    const rows = points.map((value, index) => player({
      playerId: index === 4 ? 'tie-z' : index === 5 ? 'tie-a' : `rank-${index}`,
      playerName: index === 4 ? 'Zulu Tie' : index === 5 ? 'Alpha Tie' : `Rank ${index}`,
      skater: {
        gamesPlayed: metric(10), goals: metric(value), assists: metric(0), points: metric(value), championships: metric(0),
      },
      goalie: {
        gamesPlayed: metric(2), goalsAgainst: metric(gaa[index] * 2), goalsAgainstAverage: metric(gaa[index]), championships: metric(0),
      },
    }));

    for (const metricName of ['points', 'gaa'] as const) {
      const ranked = buildRankedRows([rows[5], rows[2], rows[6], rows[0], rows[4], rows[1], rows[3]], metricName);
      assert.deepEqual(ranked.map((row) => [row.playerId, row.rank]), [
        ['rank-0', 1], ['rank-1', 2], ['rank-2', 3], ['rank-3', 4], ['tie-a', 5], ['tie-z', 5], ['rank-6', 7],
      ]);
      assert.deepEqual(
        buildRankedRows([...rows].reverse(), metricName).map((row) => [row.playerId, row.rank]),
        ranked.map((row) => [row.playerId, row.rank]),
        `${metricName} ordering and ranks do not depend on input order`,
      );
      assert.deepEqual(
        buildLeaderRows(rows, metricName).map((row) => [row.playerId, row.rank]),
        ranked.slice(0, 5).map((row) => [row.playerId, row.rank]),
        `${metricName} card slice preserves the same full-population ranks as the complete table`,
      );
    }
  });

  it('returns the complete eligible ranked population for each authoritative metric', () => {
    const rows = Array.from({ length: 7 }, (_, index) => player({
      playerId: `player-${index}`,
      playerName: index === 0 ? 'Same Name' : index === 1 ? 'Same Name' : `Player ${index}`,
      skater: {
        gamesPlayed: metric(10),
        goals: metric(index === 6 ? null : index === 0 || index === 1 ? 4 : index),
        assists: metric(10 - index),
        points: metric(index + 20),
        championships: metric(0),
      },
      goalie: {
        gamesPlayed: metric(2), goalsAgainst: metric(index + 2), goalsAgainstAverage: metric(index + 1), championships: metric(0),
      },
    }));
    rows[5].skater!.goals = metric(null, 'conflicted', ['skater_stats']);

    const all = Number.POSITIVE_INFINITY;
    const goals = (buildLeaderRows as any)(rows, 'goals', [], all);
    const assists = (buildLeaderRows as any)(rows, 'assists', [], all);
    const points = (buildLeaderRows as any)(rows, 'points', [], all);
    const goalies = (buildLeaderRows as any)(rows, 'gaa', [], all);

    assert.deepEqual(goals.map((row: StatsScopePlayer) => row.playerId), ['player-4', 'player-0', 'player-1', 'player-3', 'player-2']);
    assert.deepEqual(assists.map((row: StatsScopePlayer) => row.playerId), rows.map((row) => row.playerId));
    assert.deepEqual(points.map((row: StatsScopePlayer) => row.playerId), [...rows].reverse().map((row) => row.playerId));
    assert.deepEqual(goalies.map((row: StatsScopePlayer) => row.playerId), rows.map((row) => row.playerId));
    assert.equal(goals.length, 5, 'unknown and conflicted selected values are excluded without placeholders');
    assert.equal(assists.length, 7, 'every eligible player is retained beyond the League Leaders top five');
    assert.equal(goalies.length, 7, 'every eligible goalie is retained and sorted by GAA ascending');
  });
});
