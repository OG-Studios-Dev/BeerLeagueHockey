/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

type Row = Record<string, any>;

function loadTeamData(dataset: Record<string, Row[]>, errors: Record<string, { message: string }> = {}) {
  type QueryRecord = {
    table: string;
    filters: Array<{ kind: 'eq' | 'in' | 'is'; column: string; value: unknown }>;
    orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean }>;
  };
  const queryRecords: QueryRecord[] = [];

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private maximum: number | null = null;
    private record: QueryRecord;

    constructor(private table: string) {
      this.record = { table, filters: [], orders: [] };
      queryRecords.push(this.record);
    }
    select() { return this; }
    eq(column: string, value: unknown) {
      this.record.filters.push({ kind: 'eq', column, value });
      this.filters.push((row) => row[column] === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.record.filters.push({ kind: 'in', column, value: [...values] });
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }
    is(column: string, value: unknown) {
      this.record.filters.push({ kind: 'is', column, value });
      this.filters.push((row) => row[column] === value);
      return this;
    }
    order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
      this.record.orders.push({
        column,
        ascending: options.ascending ?? true,
        nullsFirst: options.nullsFirst ?? false,
      });
      return this;
    }
    limit(value: number) { this.maximum = value; return this; }
    private rows() {
      const rows = (dataset[this.table] ?? [])
        .filter((row) => this.filters.every((filter) => filter(row)))
        .slice()
        .sort((left, right) => {
          for (const order of this.record.orders) {
            const leftValue = left[order.column];
            const rightValue = right[order.column];
            const leftNull = leftValue == null;
            const rightNull = rightValue == null;
            if (leftNull !== rightNull) return leftNull === order.nullsFirst ? -1 : 1;
            if (leftNull) continue;
            const difference = String(leftValue).localeCompare(String(rightValue));
            if (difference !== 0) return order.ascending ? difference : -difference;
          }
          return 0;
        });
      return this.maximum == null ? rows : rows.slice(0, this.maximum);
    }
    async maybeSingle() { return { data: this.rows()[0] ?? null, error: errors[this.table] ?? null }; }
    then(resolve: (value: { data: Row[]; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: this.rows(), error: errors[this.table] ?? null }).then(resolve, reject);
    }
  }

  const teamData = compileCommonJs<Record<string, (...args: any[]) => any>>(
    new URL('../../src/lib/supabase/team.ts', import.meta.url),
    { './client': { supabase: { from: (table: string) => new Query(table) } } },
  );
  return Object.assign(teamData, { queryRecords });
}

const dataset: Record<string, Row[]> = {
  seasons: [
    { id: 'season-a', league_id: 'league-a', name: 'Fall A', status: 'active', start_date: '2026-09-01', created_at: '2026-08-01' },
    { id: 'season-b', league_id: 'league-b', name: 'Fall B', status: 'active', start_date: '2026-09-02', created_at: '2026-08-02' },
    { id: 'season-c-playoffs', league_id: 'league-c', name: 'Fall C Playoffs', status: 'playoffs', start_date: '2026-09-03', created_at: '2026-08-03' },
    { id: 'season-old', league_id: 'league-a', name: 'Old A', status: 'completed', start_date: '2025-01-01', created_at: '2024-12-01' },
  ],
  team_rosters: [
    { id: 'a-ended-selected', player_id: 'viewer', team_id: 'team-ended', league_id: 'league-a', season_id: 'season-a', status: 'active', start_date: '2026-09-10', joined_at: '2026-09-10', end_date: '2026-09-11', jersey_number: 66, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-ended', name: 'Ended Assignment', logo_url: null, primary_color: '#EF4444' } },
    { id: 'a-1', player_id: 'viewer', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', joined_at: '2026-09-01', end_date: null, jersey_number: 8, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-a', name: 'Active A', logo_url: null, primary_color: '#22D3EE' } },
    { id: 'a-duplicate', player_id: 'viewer', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', joined_at: '2026-08-01', end_date: null, jersey_number: 88, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-a', name: 'Active A', logo_url: null, primary_color: '#22D3EE' } },
    { id: 'old', player_id: 'viewer', team_id: 'team-old', league_id: 'league-a', season_id: 'season-old', status: 'active', joined_at: '2025-01-01', end_date: null, jersey_number: 44, position: 'defense', is_goalie: false, leadership_role: null, team: { id: 'team-old', name: 'Historical A', logo_url: null, primary_color: '#999999' } },
    { id: 'wrong-pair', player_id: 'viewer', team_id: 'team-cross', league_id: 'league-a', season_id: 'season-b', status: 'active', joined_at: '2026-09-01', end_date: null, jersey_number: 2, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-cross', name: 'Cross League', logo_url: null, primary_color: '#EF4444' } },
    { id: 'b-ended-card', player_id: 'viewer', team_id: 'team-b-ended', league_id: 'league-b', season_id: 'season-b', status: 'active', joined_at: '2026-09-10', end_date: '2026-09-11', jersey_number: 71, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-b-ended', name: 'Ended B Card', logo_url: null, primary_color: '#EF4444' } },
    { id: 'b-1', player_id: 'viewer', team_id: 'team-b', league_id: 'league-b', season_id: 'season-b', status: 'active', joined_at: '2026-09-02', end_date: null, jersey_number: 12, position: 'goalie', is_goalie: true, leadership_role: null, team: { id: 'team-b', name: 'Active B', logo_url: null, primary_color: '#8E7FFF' } },
    { id: 'c-1', player_id: 'viewer', team_id: 'team-c', league_id: 'league-c', season_id: 'season-c-playoffs', status: 'active', joined_at: '2026-09-03', end_date: null, jersey_number: 31, position: 'goalie', is_goalie: true, leadership_role: null, team: { id: 'team-c', name: 'Playoff C', logo_url: null, primary_color: '#F59E0B' } },
    { id: 'ended-roster-player', player_id: 'ended-player', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', joined_at: '2026-09-01', end_date: '2026-09-11', jersey_number: 1, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-a', name: 'Active A', logo_url: null, primary_color: '#22D3EE' } },
    { id: 'other-player', player_id: 'other', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', joined_at: '2026-09-01', end_date: null, jersey_number: 3, position: 'defense', is_goalie: false, leadership_role: 'alternate_captain', team: { id: 'team-a', name: 'Active A', logo_url: null, primary_color: '#22D3EE' } },
    { id: 'returning-player', player_id: 'returning', team_id: 'team-a', league_id: 'league-a', season_id: 'season-a', status: 'active', joined_at: '2026-09-03', end_date: null, jersey_number: 27, position: 'forward', is_goalie: false, leadership_role: null, team: { id: 'team-a', name: 'Active A', logo_url: null, primary_color: '#22D3EE' } },
  ],
  profiles: [
    { id: 'viewer', full_name: 'Viewer Victor', avatar_url: null },
    { id: 'other', full_name: 'Other Olivia', avatar_url: null },
    { id: 'ended-player', full_name: 'Ended Evan', avatar_url: null },
    { id: 'returning', full_name: 'Returning Riley', avatar_url: null },
  ],
};

describe('Team-only Supabase boundary', () => {
  it('selects the operational-current season and reports lookup failures distinctly', async () => {
    const teamData = loadTeamData(dataset);
    assert.equal((await teamData.getTeamActiveSeason('league-a')).season.id, 'season-a');

    const failing = loadTeamData(dataset, { seasons: { message: 'synthetic offline failure' } });
    const result = await failing.getTeamActiveSeason('league-a');
    assert.equal(result.season, null);
    assert.match(result.error, /determine the active season/);
  });

  it('keeps playoff-only leagues current while preferring active over newer playoffs', async () => {
    const teamData = loadTeamData(dataset);
    assert.equal((await teamData.getTeamActiveSeason('league-c')).season.id, 'season-c-playoffs');

    const mixed = loadTeamData({
      ...dataset,
      seasons: [
        { id: 'playoffs-newer', league_id: 'league-a', name: 'Newer Playoffs', status: 'playoffs', start_date: '2026-12-01', created_at: '2026-11-01' },
        { id: 'active-older', league_id: 'league-a', name: 'Active First', status: 'active', start_date: '2026-09-01', created_at: '2026-08-01' },
      ],
    });
    assert.equal((await mixed.getTeamActiveSeason('league-a')).season.id, 'active-older');
  });

  it('orders same-status seasons by newest non-null dates and then stable id', async () => {
    const teamData = loadTeamData({
      ...dataset,
      seasons: [
        { id: 'z-null-start', league_id: 'league-a', name: 'Null Start', status: 'active', start_date: null, created_at: '2026-12-31' },
        { id: 'z-null-created', league_id: 'league-a', name: 'Null Created', status: 'active', start_date: '2026-10-01', created_at: null },
        { id: 'z-tied', league_id: 'league-a', name: 'Tied Z', status: 'active', start_date: '2026-10-01', created_at: '2026-09-01' },
        { id: 'a-tied', league_id: 'league-a', name: 'Tied A', status: 'active', start_date: '2026-10-01', created_at: '2026-09-01' },
      ],
    });
    assert.equal((await teamData.getTeamActiveSeason('league-a')).season.id, 'a-tied');
  });

  it('returns empty for inactive-only leagues without unscoped or fallback reads', async () => {
    const teamData = loadTeamData({
      ...dataset,
      seasons: ['completed', 'draft', 'archived', 'upcoming'].map((status, index) => ({
        id: `inactive-${status}`,
        league_id: 'league-inactive',
        name: `Inactive ${status}`,
        status,
        start_date: `2026-0${index + 1}-01`,
        created_at: `2025-0${index + 1}-01`,
      })),
      team_rosters: [],
    });

    assert.equal((await teamData.getTeamActiveSeason('league-inactive')).season, null);
    const cards = await teamData.getActiveSeasonMembershipsForUser('viewer', [
      { id: 'league-inactive', name: 'Inactive League' },
    ]);
    assert.deepEqual(cards.data, []);

    const seasonQueries = teamData.queryRecords.filter((query: Row) => query.table === 'seasons');
    assert.ok(seasonQueries.every((query: Row) => query.filters.some((filter: Row) => filter.kind === 'eq' && filter.column === 'league_id' || filter.kind === 'in' && filter.column === 'league_id')));
    assert.ok(seasonQueries.every((query: Row) => query.filters.some((filter: Row) => filter.kind === 'in' && filter.column === 'status' && JSON.stringify(filter.value) === JSON.stringify(['active', 'playoffs']))));
  });

  it('scopes member assignment and roster to the exact league-season-team tuple', async () => {
    const teamData = loadTeamData(dataset);
    const assignment = await teamData.getActiveSeasonTeamForUser('viewer', 'league-a', 'season-a');
    assert.equal(assignment.team_id, 'team-a');

    const roster = await teamData.getActiveSeasonRoster('team-a', 'league-a', 'season-a');
    assert.deepEqual(roster.map((row: Row) => [row.player_id, row.jersey_number]), [['other', 3], ['viewer', 8], ['returning', 27]]);
    assert.equal(roster.some((row: Row) => row.player_name === 'Ended Evan'), false);

    const rosterQueries = teamData.queryRecords.filter((query: Row) => query.table === 'team_rosters');
    assert.equal(rosterQueries.length, 2);
    assert.ok(rosterQueries.every((query: Row) => query.filters.some((filter: Row) => filter.kind === 'is' && filter.column === 'end_date' && filter.value === null)));
  });

  it('returns leadership only from the same newest current assignment used by the dock crest', async () => {
    const captainDataset = {
      ...dataset,
      team_rosters: dataset.team_rosters.map((row) =>
        row.id === 'a-1' ? { ...row, leadership_role: 'captain' } : row
      ),
    };
    const teamData = loadTeamData(captainDataset);

    const assignment = await teamData.getActiveSeasonTeamForUser('viewer', 'league-a', 'season-a');

    assert.equal(assignment.leadership_role, 'captain');
    const assignmentQuery = teamData.queryRecords.find((query: Row) =>
      query.table === 'team_rosters' && query.filters.some((filter: Row) => filter.column === 'player_id' && filter.value === 'viewer')
    );
    assert.ok(assignmentQuery?.filters.some((filter: Row) => filter.kind === 'eq' && filter.column === 'league_id' && filter.value === 'league-a'));
    assert.ok(assignmentQuery?.filters.some((filter: Row) => filter.kind === 'eq' && filter.column === 'season_id' && filter.value === 'season-a'));
    assert.ok(assignmentQuery?.filters.some((filter: Row) => filter.kind === 'eq' && filter.column === 'status' && filter.value === 'active'));
    assert.ok(assignmentQuery?.filters.some((filter: Row) => filter.kind === 'is' && filter.column === 'end_date' && filter.value === null));
  });

  it('pairs each My Teams membership with its own league active season and deduplicates it', async () => {
    const teamData = loadTeamData(dataset);
    const result = await teamData.getActiveSeasonMembershipsForUser('viewer', [
      { id: 'league-a', name: 'League A', city: 'Hamilton' },
      { id: 'league-b', name: 'League B', city: 'Burlington' },
      { id: 'league-c', name: 'League C', city: 'Oakville' },
    ]);

    assert.equal(result.error, null);
    assert.deepEqual(result.data.map((card: Row) => [card.leagueId, card.seasonId, card.teamName]), [
      ['league-a', 'season-a', 'Active A'],
      ['league-b', 'season-b', 'Active B'],
      ['league-c', 'season-c-playoffs', 'Playoff C'],
    ]);
    assert.doesNotMatch(JSON.stringify(result.data), /Ended Assignment|Ended B Card/);
    const membershipQuery = teamData.queryRecords.find((query: Row) =>
      query.table === 'team_rosters' && query.filters.some((filter: Row) => filter.kind === 'in' && filter.column === 'season_id')
    );
    assert.ok(membershipQuery?.filters.some((filter: Row) => filter.kind === 'is' && filter.column === 'end_date' && filter.value === null));
  });
});
