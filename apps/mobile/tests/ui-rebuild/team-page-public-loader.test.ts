import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { compileCommonJs } from './component-harness.ts';

type Row = Record<string, unknown>;
type Dataset = Record<string, Row[]>;
type RecordedQuery = { table: string; select: string; filters: Array<[string, string, unknown]>; ranges: Array<[number, number]>; orders: Array<[string, { ascending?: boolean; nullsFirst?: boolean }]> };
type QueryResult = { data: unknown; error: { message: string } | null };
type TeamPageSnapshot = {
  league: Row & { timezone: string };
  roster: Array<Row & { playerId: string; gamesPlayed: number; points: number; goalieGamesPlayed: number; goalsAgainstAverage: number }>;
  rivals: Array<{ rival: { tendy: { name: string; gamesPlayed: number; goalsAgainstAverage: number } } }>;
  nextGame: (Row & { id: string }) | null;
  publishedLineup: (Row & { id: string }) | null;
  acceptedSubstitutions: Row[];
};
type TeamPageResult =
  | { data: TeamPageSnapshot; error: null }
  | { data: null; error: string };
const generatedTypes = readFileSync(fileURLToPath(new URL('../../../../packages/database/src/types.ts', import.meta.url).href), 'utf8');
// These deployed migrations postdate generated types. Do not invent view columns.
const lineupMigration = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20260307110000_create_game_team_lineups.sql', import.meta.url).href), 'utf8');
const replacementMigration = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20260508182700_active_spares_game_replacements.sql', import.meta.url).href), 'utf8');

function createSupabase(dataset: Dataset, fail?: (query: RecordedQuery) => string | null) {
  const queries: RecordedQuery[] = [];

  class Query implements PromiseLike<QueryResult> {
    private filters: Array<[string, string, unknown]> = [];
    private rangeValue: [number, number] | null = null;
    private single = false;
    private selected = '';
    private orders: RecordedQuery['orders'] = [];
    private limitValue: number | null = null;

    constructor(private readonly table: string) {}

    select(columns: string) { this.selected = columns; return this; }
    eq(field: string, value: unknown) { this.filters.push(['eq', field, value]); return this; }
    is(field: string, value: unknown) { this.filters.push(['is', field, value]); return this; }
    in(field: string, value: unknown[]) { this.filters.push(['in', field, value]); return this; }
    order(field: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.orders.push([field, options]); return this; }
    limit(count: number) { this.limitValue = count; return this; }
    range(from: number, to: number) { this.rangeValue = [from, to]; return this; }
    maybeSingle() { this.single = true; return this; }

    private execute(): QueryResult {
      let rows = [...(dataset[this.table] ?? [])];
      for (const [operation, field, value] of this.filters) {
        if (operation === 'eq') rows = rows.filter((row) => row[field] === value);
        if (operation === 'is') rows = rows.filter((row) => row[field] == null);
        if (operation === 'in') rows = rows.filter((row) => (value as unknown[]).includes(row[field]));
      }
      const query: RecordedQuery = { table: this.table, select: this.selected, filters: [...this.filters], ranges: this.rangeValue ? [this.rangeValue] : [], orders: this.orders };
      queries.push(query);
      const error = fail?.(query);
      if (error) return { data: null, error: { message: error } };
      const body = generatedTypes.split(`      ${this.table}: {
        Row: {`)[1]?.split('\n        }')[0] ?? '';
      const columns = this.selected.split(',');
      for (const column of columns) {
        if (column.includes(':')) {
          assert.ok(['invited_player_profile:profiles!sub_invitations_invited_player_id_fkey(full_name)', 'replaced_player_profile:profiles!sub_invitations_replaced_player_id_fkey(full_name)'].includes(column), `unverified join: ${column}`);
        } else if (this.table === 'game_team_lineups') {
          assert.ok(new RegExp(`\\b${column}\\s`, 'i').test(lineupMigration), `unverified lineup column: ${column}`);
        } else if (this.table === 'sub_invitations' && column === 'replaced_player_id') {
          assert.match(replacementMigration, /replaced_player_id UUID REFERENCES public.profiles/);
        } else {
          assert.ok(body.includes(`          ${column}:`), `unknown ${this.table}.${column}`);
        }
      }
      rows.sort((a, b) => {
        for (const [field, options] of this.orders) {
          if (a[field] === b[field]) continue;
          if (a[field] == null) return options.nullsFirst ? -1 : 1;
          if (b[field] == null) return options.nullsFirst ? 1 : -1;
          const diff = a[field] < b[field] ? -1 : 1;
          return options.ascending === false ? -diff : diff;
        }
        return 0;
      });
      if (this.limitValue != null) rows = rows.slice(0, this.limitValue);
      // Projection is essential: a fixture must not supply unselected timezone/joined_at.
      rows = rows.map((row) => Object.fromEntries(columns.map((column) => { const key = column.split(':')[0]; return [key, row[key] ?? null]; })));
      if (this.single) return { data: rows[0] ?? null, error: null };
      const [from, to] = this.rangeValue ?? [0, 999];
      return { data: rows.slice(from, to + 1), error: null };
    }

    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }
  }

  return { supabase: { from: (table: string) => new Query(table) }, queries };
}

const activeSeason = { id: 'season-current', league_id: 'league-a', name: 'Fall 2026', status: 'active', start_date: '2026-08-01', end_date: null };
const canonicalPublicStats = async () => ({ players: [{ playerId: 'player-a', playerName: 'Matt Current', avatarUrl: 'matt.jpg', roles: ['skater'], metrics: {
  gamesPlayed: { value: 2, state: 'recorded', sources: ['skater_stats'] }, goals: { value: 2, state: 'recorded', sources: ['skater_stats'] },
  assists: { value: 1, state: 'recorded', sources: ['skater_stats'] }, points: { value: 3, state: 'recorded', sources: ['skater_stats'] },
  penaltyMinutes: { value: 4, state: 'reported', sources: ['skater_stats'] },
}, goalie: null }] });

function fixture(): Dataset {
  const dummyStats = Array.from({ length: 1000 }, (_, index) => ({
    id: `dummy-stat-${index}`, league_id: 'league-a', player_id: `dummy-${index}`, game_id: 'game-1', team_id: 'team-b', season_id: 'season-current', goals: 0, assists: 0, penalty_minutes: 0,
  }));
  return {
    teams: [
      { id: 'team-a', league_id: 'league-a', name: 'Team A', slug: 'team-a', team_type: 'regular', primary_color: '#00D9FF' },
      { id: 'team-b', league_id: 'league-a', name: 'Team B', slug: 'team-b', team_type: 'regular', primary_color: '#DD2244' },
    ],
    leagues: [{ id: 'league-a', name: 'Hockey Life', slug: 'hockey-life', primary_color: '#00D9FF', timezone: 'America/Toronto' }],
    team_rosters: [
      { id: 'roster-a', player_id: 'player-a', team_id: 'team-a', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-08-01', player_type: 'regular', position: 'C', jersey_number: 96 },
      { id: 'roster-b', player_id: 'goalie-b', team_id: 'team-b', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-08-01', player_type: 'regular', position: 'G', is_goalie: true, jersey_number: 31 },
      { id: 'roster-ended', player_id: 'ended-player', team_id: 'team-a', league_id: 'league-a', season_id: 'season-current', status: 'active', end_date: '2026-09-01', joined_at: '2026-08-01', player_type: 'regular' },
      { id: 'roster-old', player_id: 'old-player', team_id: 'team-a', league_id: 'league-a', season_id: 'season-old', status: 'active', end_date: null, joined_at: '2025-08-01', player_type: 'regular' },
    ],
    team_standings: [
      { team_id: 'team-a', season_id: 'season-current', games_played: 2, wins: 1, losses: 1, ties: 0, points: 2, goals_for: 8, goals_against: 8 },
      { team_id: 'team-b', season_id: 'season-current', games_played: 2, wins: 1, losses: 1, ties: 0, points: 2, goals_for: 8, goals_against: 8 },
      { team_id: 'team-a', season_id: 'season-old', games_played: 10, wins: 10, losses: 0, ties: 0, points: 20, goals_for: 50, goals_against: 10 },
    ],
    games: [
      { id: 'game-1', league_id: 'league-a', season_id: 'season-current', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-09-01T23:00:00Z', status: 'completed', home_score: 5, away_score: 4 },
      { id: 'game-2', league_id: 'league-a', season_id: 'season-current', home_team_id: 'team-b', away_team_id: 'team-a', scheduled_at: '2026-09-08T23:00:00Z', status: 'completed', home_score: 4, away_score: 3 },
      { id: 'game-3', league_id: 'league-a', season_id: 'season-current', home_team_id: 'team-a', away_team_id: 'team-b', scheduled_at: '2026-09-10T23:00:00Z', status: 'completed', home_score: null, away_score: null },
      { id: 'game-next', league_id: 'league-a', season_id: 'season-current', home_team_id: 'team-b', away_team_id: 'team-a', scheduled_at: '2026-09-17T14:30:00Z', status: 'scheduled', home_score: null, away_score: null },
    ],
    seasons: [activeSeason, { id: 'season-old', league_id: 'league-a', name: 'Fall 2025', status: 'completed', start_date: '2025-08-01', end_date: '2025-12-01', champion_team_id: 'team-a' }],
    league_sponsors: [],
    player_stats: [{ id: 'player-stat-a', league_id: 'league-a', player_id: 'player-a', game_id: 'game-1', team_id: 'team-a', season_id: 'season-current', goals: 2, assists: 1, penalty_minutes: 4 }, ...dummyStats],
    goalie_stats: [],
    profiles: [
      { id: 'player-a', full_name: 'Matt Current', photo_url: 'matt.jpg', position: 'C' },
      { id: 'goalie-b', full_name: 'Connor Current', photo_url: 'connor.jpg', position: 'G' },
      { id: 'accepted-sub', full_name: 'Accepted Baker', photo_url: 'sub.jpg', position: 'C' },
    ],
    game_checkins: [
      { id: 'check-out', game_id: 'game-2', team_id: 'team-a', player_id: 'player-a', status: 'out' },
      { id: 'check-confirmed', game_id: 'game-3', team_id: 'team-a', player_id: 'player-a', status: 'confirmed' },
    ],
    player_availability: [],
    game_team_lineups: [{ id: 'lineup-1', game_id: 'game-next', team_id: 'team-a', status: 'published', published_at: '2026-09-11T12:00:00Z', layout_json: { roster: [], placedPlayers: [] } }],
    sub_invitations: [{ id: 'sub-1', game_id: 'game-next', team_id: 'team-a', status: 'accepted', responded_at: '2026-09-11T10:00:00Z', created_at: '2026-09-10T10:00:00Z', invited_player_id: 'accepted-sub', replaced_player_id: 'player-a', invited_player_profile: { full_name: 'Accepted Baker' }, replaced_player_profile: { full_name: 'Matt Current' } }],
  };
}

async function loadFixture(dataset: Dataset, fail?: (query: RecordedQuery) => string | null): Promise<TeamPageResult & { queries: RecordedQuery[] }> {
  const database = createSupabase(dataset, fail);
  const loader = compileCommonJs<{ loadTeamPageSnapshot: (teamId: string, leagueId: string, now: Date) => Promise<TeamPageResult> }>(
    new URL('../../src/lib/supabase/teamPage.ts', import.meta.url),
    { './client': { supabase: database.supabase }, './team': { getMetricsOperationalSeason: async () => ({ season: activeSeason, error: null }) },
      './publicStats': { getPublicSeasonStats: canonicalPublicStats } },
  );
  return { ...await loader.loadTeamPageSnapshot('team-a', 'league-a', new Date('2026-09-12T12:00:00Z')), queries: database.queries };
}

describe('Team public loader producer boundary', () => {
  it('selects only the target next game before loading published lineup and ordered accepted replacements', async () => {
    const data = fixture();
    const earlier = { ...data.games[3], id: 'other-earlier', home_team_id: 'team-c', away_team_id: 'team-b', scheduled_at: '2026-09-13T01:00:00Z', status: 'in_progress' };
    data.games.unshift(earlier);
    data.game_team_lineups.unshift({ ...data.game_team_lineups[0], id: 'wrong-game-lineup', game_id: 'other-earlier' });
    const accepted = data.sub_invitations[0];
    data.sub_invitations = [
      { ...accepted, id: 'pending-sub', status: 'pending' },
      { ...accepted, id: 'wrong-team-sub', team_id: 'team-b' },
      { ...accepted, id: 'wrong-game-sub', game_id: 'other-earlier' },
      { ...accepted, id: 'sub-last', responded_at: null },
      { ...accepted, id: 'sub-2', responded_at: accepted.responded_at, created_at: accepted.created_at, invited_player_profile: [{ full_name: 'Array Join' }], replaced_player_profile: [{ full_name: 'Matt Current' }] },
      accepted,
    ];
    const result = await loadFixture(data);
    assert.equal(result.error, null);
    assert.equal(result.data.nextGame?.id, 'game-next');
    assert.equal(result.data.publishedLineup?.id, 'lineup-1');
    assert.deepEqual(result.data.acceptedSubstitutions.map((row: Row) => row.id), ['sub-1', 'sub-2', 'sub-last']);
    assert.equal(result.data.acceptedSubstitutions[1].subPlayerName, 'Array Join');
    assert.equal(result.data.acceptedSubstitutions[1].replacedPlayerName, 'Matt Current');
    for (const query of result.queries.filter((q) => ['game_team_lineups', 'sub_invitations'].includes(q.table))) {
      assert.ok(query.filters.some(([, field, value]) => field === 'game_id' && value === 'game-next'));
      assert.ok(query.filters.some(([, field, value]) => field === 'team_id' && value === 'team-a'));
    }
  });

  it('uses public roster/game facts and ignores authorization-dependent attendance sources', async () => {
    const data = fixture();
    data.leagues[0].timezone = 'America/Vancouver';
    data.player_stats = [];
    data.player_season_stats = [{ player_id: 'player-a', team_id: 'team-a', season_id: activeSeason.id, games_played: 999, goals: 999 }];
    data.team_rosters[0].joined_at = '2026-09-05T00:00:00Z';
    data.game_checkins = data.game_checkins.filter((row) => row.status === 'confirmed');
    data.player_availability = [{ id: 'availability-out', team_id: 'team-a', player_id: 'player-a', game_id: 'game-2', season_id: activeSeason.id, status: 'out' }];
    data.team_rosters.push({ ...data.team_rosters[0], id: 'wrong-league', player_id: 'alien', league_id: 'league-b' }, { ...data.team_rosters[0], id: 'inactive', player_id: 'inactive', status: 'inactive' });
    const result = await loadFixture(data);
    assert.equal(result.error, null);
    assert.equal(result.data.league.timezone, 'America/Vancouver');
    assert.deepEqual(result.data.roster.map((row: Row) => row.playerId), ['player-a']);
    assert.equal(result.data.roster[0].gamesPlayed, 2, 'both completed public games after join are estimate inputs');
    assert.equal(result.data.roster[0].gamesPlayedProvenance, 'authoritative');
    assert.equal(result.queries.some((q) => q.table === 'player_season_stats' || q.table === 'goalie_season_stats'), false);
    assert.equal(result.queries.some((q) => q.table === 'game_checkins' || q.table === 'player_availability'), false);
  });

  it('reads the 1001st goalie row and scopes both raw-stat producers to league plus current season', async () => {
    const data = fixture();
    data.goalie_stats = [
      ...Array.from({ length: 999 }, (_, index) => ({ id: `dummy-${index}`, player_id: `goalie-${index}`, league_id: 'league-a', team_id: 'team-b', season_id: activeSeason.id, game_id: 'game-1', goals_against: 9 })),
      { id: 'z-last-goalie', player_id: 'player-a', league_id: 'league-a', team_id: 'team-a', season_id: activeSeason.id, game_id: 'game-1', goals_against: 3 },
      { id: 'other-team', player_id: 'player-a', league_id: 'league-a', team_id: 'team-b', season_id: activeSeason.id, game_id: 'game-2', goals_against: 99 },
      { id: 'alien', player_id: 'player-a', league_id: 'league-b', team_id: 'team-a', season_id: activeSeason.id, game_id: 'game-2', goals_against: 999 },
      { id: 'old', player_id: 'player-a', league_id: 'league-a', team_id: 'team-a', season_id: 'season-old', game_id: 'game-2', goals_against: 999 },
    ];
    const result = await loadFixture(data);
    assert.equal(result.error, null);
    assert.equal(result.data.roster[0].goalieGamesPlayed, null, 'raw goalie rows cannot override the canonical per-field v2 projection');
    assert.equal(result.data.roster[0].goalsAgainstAverage, null);
    for (const table of ['player_stats', 'goalie_stats']) {
      const matchingQueries: RecordedQuery[] = result.queries.filter((query: RecordedQuery) => query.table === table);
      assert.deepEqual(matchingQueries.flatMap((query) => query.ranges), [[0, 999], [1000, 1999]]);
      for (const query of matchingQueries) {
        assert.ok(query.filters.some(([, field, value]) => field === 'league_id' && value === 'league-a'));
        assert.ok(query.filters.some(([, field, value]) => field === 'season_id' && value === activeSeason.id));
        assert.equal(query.filters.some(([, field]) => field === 'team_id'), false);
        assert.deepEqual(query.orders.map(([field]) => field), ['id']);
      }
    }
  });

  for (const [table, label] of [['game_team_lineups', 'published lineup'], ['sub_invitations', 'accepted substitutions']]) {
    it(`returns a specific retryable failure instead of silently dropping ${table}`, async () => {
      const result = await loadFixture(fixture(), (query) => query.table === table ? 'permission denied' : null);
      assert.equal(result.data, null);
      assert.equal(typeof result.error, 'string');
      assert.match(result.error!, new RegExp(`${label}; retry Team page: permission denied`));
    });
  }

  it('does not return partial data when a later raw-stat page fails', async () => {
    const result = await loadFixture(fixture(), (query) => query.table === 'player_stats' && query.ranges[0]?.[0] === 1000 ? 'page unavailable' : null);
    assert.equal(result.data, null);
    assert.equal(result.error, 'player stats: page unavailable');
  });

  it('does not query lineups/substitutions without a target scheduled or live game', async () => {
    const data = fixture();
    data.games = data.games.filter((game) => game.status === 'completed');
    const result = await loadFixture(data);
    assert.equal(result.error, null);
    assert.equal(result.data.nextGame, null);
    assert.equal(result.data.publishedLineup, null);
    assert.deepEqual(result.data.acceptedSubstitutions, []);
    assert.equal(result.queries.some((q) => ['game_team_lineups', 'sub_invitations'].includes(q.table)), false);
  });
  it('loads canonical scoped inputs, paginates raw stats, and supplies GP, rival goalie, lineup, substitutions, and timezone facts', async () => {
    const database = createSupabase(fixture());
    const loader = compileCommonJs<{ loadTeamPageSnapshot: (teamId: string, leagueId: string, now: Date) => Promise<TeamPageResult> }>(
      new URL('../../src/lib/supabase/teamPage.ts', import.meta.url),
      {
        './client': { supabase: database.supabase },
        './team': { getMetricsOperationalSeason: async () => ({ season: activeSeason, error: null }) },
        './publicStats': { getPublicSeasonStats: canonicalPublicStats },
      },
    );

    const result = await loader.loadTeamPageSnapshot('team-a', 'league-a', new Date('2026-09-12T12:00:00Z'));
    assert.equal(result.error, null);
    assert.equal(result.data.league.timezone, 'America/Toronto');
    assert.deepEqual(result.data.roster.map((player: Row) => player.playerId), ['player-a']);
    assert.equal(result.data.roster[0].gamesPlayed, 2);
    assert.equal(result.data.roster[0].gamesPlayedProvenance, 'authoritative');
    assert.equal(result.data.roster[0].points, 3);
    assert.equal(result.data.rivals[0].rival.tendy.name, 'Connor Current');
    assert.equal(result.data.rivals[0].rival.tendy.gamesPlayed, 2);
    assert.equal(result.data.rivals[0].rival.tendy.goalsAgainstAverage, 4);
    assert.equal(result.data.publishedLineup?.id, 'lineup-1');
    assert.deepEqual(result.data.acceptedSubstitutions, [{ id: 'sub-1', subPlayerId: 'accepted-sub', subPlayerName: 'Accepted Baker', replacedPlayerId: 'player-a', replacedPlayerName: 'Matt Current' }]);

    const rosterQuery = database.queries.find((query) => query.table === 'team_rosters');
    assert.ok(rosterQuery?.filters.some(([, field, value]) => field === 'league_id' && value === 'league-a'));
    assert.ok(rosterQuery?.filters.some(([, field, value]) => field === 'season_id' && value === 'season-current'));
    assert.ok(rosterQuery?.filters.some(([, field, value]) => field === 'status' && value === 'active'));
    assert.ok(rosterQuery?.filters.some(([operation, field]) => operation === 'is' && field === 'end_date'));

    const playerStatQueries = database.queries.filter((query) => query.table === 'player_stats');
    assert.deepEqual(playerStatQueries.flatMap((query) => query.ranges), [[0, 999], [1000, 1999]]);
    assert.equal(playerStatQueries.some((query) => query.filters.some(([, field]) => field === 'team_id')), false);
    const substitutionQuery = database.queries.find((query) => query.table === 'sub_invitations');
    assert.ok(substitutionQuery?.filters.some(([, field, value]) => field === 'game_id' && value === 'game-next'));
    assert.ok(substitutionQuery?.filters.some(([, field, value]) => field === 'team_id' && value === 'team-a'));
    assert.ok(substitutionQuery?.filters.some(([, field, value]) => field === 'status' && value === 'accepted'));
    assert.equal(database.queries.some((query) => query.table === 'game_checkins' || query.table === 'player_availability'), false);
  });

  it('fails closed when the selected operational season flips before the public snapshot read', async () => {
    const database = createSupabase(fixture());
    const loader = compileCommonJs<{ loadTeamPageSnapshot: (teamId: string, leagueId: string, now: Date, expectedSeasonId: string) => Promise<TeamPageResult> }>(new URL('../../src/lib/supabase/teamPage.ts', import.meta.url), {
      './client': { supabase: database.supabase },
      './team': { getMetricsOperationalSeason: async () => ({ season: { ...activeSeason, id: 'season-new' }, error: null }) },
    });
    const result = await loader.loadTeamPageSnapshot('team-a', 'league-a', new Date('2026-09-12T12:00:00Z'), activeSeason.id);
    assert.equal(result.data, null);
    assert.match(result.error, /active season changed.*Retry/i);
    assert.equal(database.queries.length, 0);
  });
});
