import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';

import {
  adaptStatsScopePlayersToHomeLeaders,
  buildGoalieRows,
  buildLeaderRows,
  buildRankedRows,
  buildSkaterRows,
  normalizeStatsScope,
  shouldShowChampionships,
  splitPlayerName,
  type StatsScopePlayer,
} from '../../src/lib/statsPresentationModel';
import { rankHomeLeaders } from '../../src/lib/homeLeagueLeaders';

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

  it('derives Champs visibility only from the returned applied scope', () => {
    assert.equal(shouldShowChampionships({ kind: 'current', seasonIds: ['current'] }), false);
    assert.equal(shouldShowChampionships({ kind: 'single', seasonIds: ['one'] }), false);
    assert.equal(shouldShowChampionships({ kind: 'multiple', seasonIds: ['one'] }), false);
    assert.equal(shouldShowChampionships({ kind: 'multiple', seasonIds: ['one', 'two'] }), true);
    assert.equal(shouldShowChampionships({ kind: 'current', seasonIds: ['one', 'two'] }), true);
    assert.equal(shouldShowChampionships({ kind: 'all', seasonIds: ['one'] }), true);
    assert.equal(shouldShowChampionships(null), false);
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
    assert.equal(skaters[1].columns.find((column) => column.key === 'gpg')?.display, '—');
    assert.match(skaters[1].columns.find((column) => column.key === 'gpg')?.accessibilityLabel ?? '', /GPG.*unavailable.*Conflicting/i);
    assert.match(skaters[1].columns.find((column) => column.key === 'ch')?.accessibilityLabel ?? '', /CH.*unavailable.*Not recorded/i);
    assert.deepEqual(buildGoalieRows(rows)[0].columns.map((column) => column.key), ['gp', 'ga', 'gaa', 'ch']);
  });

  it('preserves provenance sources without revealing conflict candidates in accessible metric descriptions', () => {
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
    assert.match(columns.g, /G, unavailable.*display value —.*not recorded.*roster eligibility.*accepted substitute records/i);
    assert.doesNotMatch(columns.g, /estimated|\b2\b/i);
    assert.match(columns.a, /display value 1.*verified.*administrative override.*game statistics/i);
    assert.match(columns.pts, /display value —.*conflicted.*game statistics.*administrative override/i);
    assert.doesNotMatch(columns.pts, /confirmed 4|recorded 3|estimated 5|source values/i);
    assert.match(columns.ch, /display value —.*unknown.*not recorded.*no provenance source/i);
    assert.match(columns.gpg, /GPG, unavailable.*display value —.*not recorded.*calculated from G.*G, unavailable.*display value —.*roster eligibility.*accepted substitute records.*divided by GP.*display value 4.*imported records.*attendance records/i);
    assert.doesNotMatch(columns.gpg, /estimated|~2/i);
    assert.match(columns.ppg, /unavailable.*points source.*conflicted.*games played source.*display value 4/i);
    assert.doesNotMatch(columns.ppg, /confirmed 4|recorded 3|estimated 5|source values/i);
  });

  it('does not insert a legacy goalie fallback when scope GAA is unknown', () => {
    const goalie = player({
      playerId: 'goalie-missing', playerName: 'Missing Goalie',
      displayTeam: { id: 'team-a', name: 'Owls' },
      skater: null,
      goalie: { gamesPlayed: metric(2, 'recorded', ['goalie_stats']), goalsAgainst: metric(null), goalsAgainstAverage: metric(null), championships: metric(0) },
    });
    const leaders = buildLeaderRows([goalie], 'gaa');

    assert.deepEqual(leaders, []);
  });

  it('formats authoritative scope GAA without double rounding', () => {
    const goalie = player({
      playerId: 'rounding-boundary', playerName: 'Boundary Goalie',
      displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(11), goalsAgainst: metric(6), goalsAgainstAverage: metric(6 / 11), championships: metric(0) },
    });
    const leaders = buildLeaderRows([goalie], 'gaa');

    assert.equal(leaders[0].value.value, 6 / 11);
    assert.equal(leaders[0].display, '0.5');
    assert.doesNotMatch(leaders[0].display, /~/);
  });

  it('does not rank conflicted or unknown scope GAA', () => {
    const conflicted = player({
      playerId: 'conflicted', playerName: 'Conflicted Goalie', displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(null, 'conflicted'), goalsAgainst: metric(null, 'conflicted'), goalsAgainstAverage: metric(null, 'conflicted'), championships: metric(0) },
    });
    const unknown = player({
      playerId: 'unknown', playerName: 'Unknown Goalie', displayTeam: { id: 'team-a', name: 'Owls' }, skater: null,
      goalie: { gamesPlayed: metric(2, 'estimated'), goalsAgainst: metric(null), goalsAgainstAverage: metric(null), championships: metric(0) },
    });
    const transferred = player({ ...unknown, playerId: 'transferred', playerName: 'Transferred Goalie' });
    const leaders = buildLeaderRows([conflicted, unknown, transferred], 'gaa');

    assert.deepEqual(leaders, []);
  });

  it('keeps the legacy estimate state internal while table and rate accessibility expose only unavailable values', () => {
    const legacyEstimate = player({
      playerId: 'legacy-estimate', playerName: 'Legacy Value',
      skater: {
        gamesPlayed: metric(4), goals: metric(137, 'estimated'), assists: metric(1), points: metric(2), championships: metric(0),
      },
    });
    const columns = Object.fromEntries(buildSkaterRows([legacyEstimate])[0].columns.map((column) => [column.key, column]));

    for (const column of [columns.g, columns.gpg]) {
      assert.equal(column.display, '—');
      assert.equal(column.state, 'estimated');
      assert.match(column.accessibilityLabel, /unavailable.*display value —.*not recorded/i);
      assert.doesNotMatch(column.accessibilityLabel, /estimated|137|34\.25/i);
    }
  });

  it('excludes estimated selected metrics from every ranked leader population', () => {
    const recorded = player({
      playerId: 'recorded', playerName: 'Recorded Player',
      skater: { gamesPlayed: metric(4), goals: metric(2), assists: metric(1), points: metric(3), championships: metric(0) },
      goalie: { gamesPlayed: metric(2), goalsAgainst: metric(4), goalsAgainstAverage: metric(2), championships: metric(0) },
    });
    const estimated = player({
      playerId: 'estimated', playerName: 'Estimated Player',
      skater: { gamesPlayed: metric(6, 'estimated'), goals: metric(20, 'estimated'), assists: metric(10, 'estimated'), points: metric(30, 'estimated'), championships: metric(0) },
      goalie: { gamesPlayed: metric(6, 'estimated'), goalsAgainst: metric(1, 'estimated'), goalsAgainstAverage: metric(1 / 6, 'estimated'), championships: metric(0) },
    });

    for (const metricName of ['points', 'goals', 'assists', 'gaa'] as const) {
      assert.deepEqual(buildRankedRows([estimated, recorded], metricName).map((row) => row.playerId), ['recorded']);
    }
    const estimatedRates = buildSkaterRows([estimated])[0].columns.filter((column) => column.key === 'gpg' || column.key === 'ppg');
    assert.deepEqual(estimatedRates.map((column) => [column.display, column.state]), [['—', 'estimated'], ['—', 'estimated']]);
  });

  it('adapts authoritative dual-role scope rows for the shared leader presentation without publishing unavailable candidates', () => {
    const dualRole = player({
      playerId: 'dual-role', playerName: 'Dual Role', avatarUrl: 'https://example.test/dual.png',
      displayTeam: { id: 'team-a', name: 'Owls', logoUrl: 'https://example.test/owls.png' },
      skater: {
        gamesPlayed: metric(4), goals: metric(8, 'estimated', ['roster_window']),
        assists: { value: null, state: 'conflicted', sources: ['skater_stats'], candidates: { recorded: 7 } },
        points: metric(5, 'verified', ['override']), championships: metric(1, 'verified', ['player_badges']),
      },
      goalie: {
        gamesPlayed: metric(2, 'reported', ['goalie_stats']), goalsAgainst: metric(3, 'recorded', ['goalie_stats']),
        goalsAgainstAverage: metric(1.5, 'reported', ['goalie_stats']), championships: metric(1, 'verified', ['player_badges']),
      },
    });
    const tied = player({
      playerId: 'tied', playerName: 'Tied Player',
      skater: { gamesPlayed: metric(4), goals: metric(1), assists: metric(1), points: metric(5), championships: metric(0) },
    });
    const unavailable = player({
      playerId: 'unavailable', playerName: 'Unavailable Player',
      skater: {
        gamesPlayed: metric(9, 'estimated'), goals: metric(6, 'estimated'),
        assists: metric(null, 'unknown'), points: metric(null, 'conflicted'), championships: metric(0),
      },
      goalie: {
        gamesPlayed: metric(4, 'verified'), goalsAgainst: metric(5, 'verified'),
        goalsAgainstAverage: metric(1.25, 'estimated'), championships: metric(0),
      },
    });

    const adapted = adaptStatsScopePlayersToHomeLeaders([dualRole, tied, unavailable]);
    assert.equal(adapted.length, 3);
    assert.deepEqual(adapted[0], {
      player_id: 'dual-role', player_name: 'Dual Role', avatar_url: 'https://example.test/dual.png',
      team_id: 'team-a', team_name: 'Owls', display_team_name: 'Owls', display_team_logo_url: 'https://example.test/owls.png',
      position: 'Goalie', goals: null, assists: null, points: 5, gaa: 1.5, is_goalie: true, estimated: false,
    });
    assert.doesNotMatch(JSON.stringify(adapted[0]), /\b8\b|\b7\b|candidates|estimated.*true/);
    assert.deepEqual(adapted[2], {
      player_id: 'unavailable', player_name: 'Unavailable Player', avatar_url: null,
      team_id: null, team_name: 'Free agent', display_team_name: null, display_team_logo_url: null,
      position: 'Goalie', goals: null, assists: null, points: null, gaa: null, is_goalie: true, estimated: false,
    });
    assert.deepEqual(rankHomeLeaders(adapted, 'points', { visibleLimit: 5 }).map((row) => [row.player_id, row.rankLabel]), [
      ['dual-role', 'T1'], ['tied', 'T1'],
    ]);
    assert.deepEqual(rankHomeLeaders(adapted, 'gaa', { visibleLimit: 5 }).map((row) => row.player_id), ['dual-role']);
  });

  it('sorts exported table rows only by publishable metrics before blank estimated or conflicted candidates', () => {
    const recorded = player({
      playerId: 'recorded', playerName: 'Recorded',
      skater: { gamesPlayed: metric(4), goals: metric(0), assists: metric(0), points: metric(0), championships: metric(0) },
      goalie: { gamesPlayed: metric(2), goalsAgainst: metric(4), goalsAgainstAverage: metric(2), championships: metric(0) },
    });
    const estimated = player({
      playerId: 'estimated', playerName: 'Estimated',
      skater: { gamesPlayed: metric(4), goals: metric(100, 'estimated'), assists: metric(0), points: metric(100, 'estimated'), championships: metric(0) },
      goalie: { gamesPlayed: metric(2), goalsAgainst: metric(1, 'estimated'), goalsAgainstAverage: metric(0.1, 'estimated'), championships: metric(0) },
    });
    const conflicted = player({
      playerId: 'conflicted', playerName: 'Conflicted',
      skater: { gamesPlayed: metric(4), goals: metric(99, 'conflicted'), assists: metric(0), points: metric(99, 'conflicted'), championships: metric(0) },
      goalie: { gamesPlayed: metric(2), goalsAgainst: metric(1, 'conflicted'), goalsAgainstAverage: metric(0.2, 'conflicted'), championships: metric(0) },
    });

    assert.deepEqual(buildSkaterRows([estimated, recorded, conflicted]).map((row) => row.playerId), [
      'recorded', 'conflicted', 'estimated',
    ]);
    assert.deepEqual(buildGoalieRows([estimated, recorded, conflicted]).map((row) => row.playerId), [
      'recorded', 'conflicted', 'estimated',
    ]);
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

    const goals = buildRankedRows(rows, 'goals');
    const assists = buildRankedRows(rows, 'assists');
    const points = buildRankedRows(rows, 'points');
    const goalies = buildRankedRows(rows, 'gaa');

    assert.deepEqual(goals.map((row: StatsScopePlayer) => row.playerId), ['player-4', 'player-0', 'player-1', 'player-3', 'player-2']);
    assert.deepEqual(assists.map((row: StatsScopePlayer) => row.playerId), rows.map((row) => row.playerId));
    assert.deepEqual(points.map((row: StatsScopePlayer) => row.playerId), [...rows].reverse().map((row) => row.playerId));
    assert.deepEqual(goalies.map((row: StatsScopePlayer) => row.playerId), rows.map((row) => row.playerId));
    assert.equal(goals.length, 5, 'unknown and conflicted selected values are excluded without placeholders');
    assert.equal(assists.length, 7, 'every eligible player is retained beyond the League Leaders top five');
    assert.equal(goalies.length, 7, 'every eligible goalie is retained and sorted by GAA ascending');
  });
});
