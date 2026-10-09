import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PublicStatMetric } from '../../src/lib/supabase/publicStats';

import {
  buildGoalieRows,
  buildLeaderRows,
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
});
