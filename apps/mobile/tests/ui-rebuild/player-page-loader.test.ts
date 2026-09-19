/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOCKEY_LIFE_ID } from '../../src/config/hockeyLife.ts';
import { compileCommonJs } from './component-harness.ts';

type Row = Record<string, any>;
type Filter = { kind: 'eq' | 'in' | 'is'; column: string; value: unknown };
type QueryRecord = {
  table: string;
  projection: string;
  filters: Filter[];
  orders: Array<{ column: string; ascending: boolean; referencedTable?: string }>;
  limit: number | null;
};

const OTHER_LEAGUE_ID = '00000000-0000-0000-0000-000000000099';

const baseDataset: Record<string, Row[]> = {
  team_rosters: [
    { id: 'roster-current', player_id: 'player-one', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-09-01', jersey_number: 19, position: 'C', is_goalie: false, leadership_role: null, team: { id: 'team-one', name: 'Current Team', slug: 'current-team', logo_url: null, primary_color: '#112233', league_id: HOCKEY_LIFE_ID } },
    { id: 'fallback-ended-newer', player_id: 'fallback-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'active', end_date: '2026-09-16', joined_at: '2026-09-15', jersey_number: 91, position: 'C', is_goalie: false, leadership_role: null, team: { id: 'team-ended', name: 'Ended Team', league_id: HOCKEY_LIFE_ID } },
    { id: 'fallback-current', player_id: 'fallback-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'injured', end_date: null, joined_at: '2026-09-10', jersey_number: 9, position: 'D', is_goalie: false, leadership_role: null, team: { id: 'team-one', name: 'Current Team', league_id: HOCKEY_LIFE_ID } },
    { id: 'fallback-historical', player_id: 'fallback-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-old', status: 'active', end_date: null, joined_at: '2026-09-17', jersey_number: 90, position: 'C', is_goalie: false, leadership_role: null, team: { id: 'team-old', name: 'Old Team', league_id: HOCKEY_LIFE_ID } },
    { id: 'flag-goalie', player_id: 'flag-goalie-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-09-01', jersey_number: 30, position: null, is_goalie: true, leadership_role: null, team: null },
    { id: 'flag-skater', player_id: 'flag-skater-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-09-01', jersey_number: 2, position: 'Goalie', is_goalie: false, leadership_role: null, team: null },
    { id: 'legacy-goalie', player_id: 'legacy-goalie-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', status: 'active', end_date: null, joined_at: '2026-09-01', jersey_number: 1, position: ' g ', leadership_role: null, team: null },
  ],
  profiles: [
    { id: 'player-one', full_name: 'Player One', avatar_url: null, photo_url: null },
    { id: 'fallback-player', full_name: 'Fallback Player', avatar_url: null, photo_url: null },
    { id: 'flag-goalie-player', full_name: 'Flag Goalie', avatar_url: null, photo_url: null },
    { id: 'flag-skater-player', full_name: 'Flag Skater', avatar_url: null, photo_url: null },
    { id: 'legacy-goalie-player', full_name: 'Legacy Goalie', avatar_url: null, photo_url: null },
  ],
  seasons: [
    { id: 'season-current', league_id: HOCKEY_LIFE_ID, name: 'Current Season', start_date: '2026-09-01', status: 'active' },
    { id: 'season-old', league_id: HOCKEY_LIFE_ID, name: 'Old Season', start_date: '2025-09-01', status: 'completed' },
    { id: 'other-season', league_id: OTHER_LEAGUE_ID, name: 'Other Season', start_date: '2026-09-02', status: 'active' },
  ],
  player_badges: [],
  player_season_stats: [
    { player_id: 'player-one', season_id: 'season-current', team_id: 'team-one', games_played: 3, goals: 2, assists: 1, points: 3 },
    { player_id: 'player-one', season_id: 'season-old', team_id: 'team-old', games_played: 2, goals: 1, assists: 2, points: 3 },
    { player_id: 'player-one', season_id: 'other-season', team_id: 'other-team', games_played: 999, goals: 999, assists: 999, points: 1998 },
  ],
  player_stats: [
    { id: 'stat-current', player_id: 'player-one', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', game_id: 'game-current', team_id: 'team-one', goals: 2, assists: 1, penalty_minutes: 6, plus_minus: 4, created_at: '2026-09-14', game: { id: 'game-current', league_id: HOCKEY_LIFE_ID, scheduled_at: '2026-09-14', home_score: 4, away_score: 2, home_team_id: 'team-one', away_team_id: 'team-two', home_team: { name: 'Current Team' }, away_team: { name: 'Other Team' } } },
    { id: 'stat-old', player_id: 'player-one', league_id: HOCKEY_LIFE_ID, season_id: 'season-old', game_id: 'game-old', team_id: 'team-old', goals: 1, assists: 2, penalty_minutes: 2, plus_minus: -1, created_at: '2025-09-14', game: { id: 'game-old', league_id: HOCKEY_LIFE_ID, scheduled_at: '2025-09-14' } },
    { id: 'stat-sentinel', player_id: 'player-one', league_id: OTHER_LEAGUE_ID, season_id: 'other-season', game_id: 'game-other', team_id: 'other-team', goals: 999, assists: 999, penalty_minutes: 999, plus_minus: 999, created_at: '2026-09-17', game: { id: 'game-other', league_id: OTHER_LEAGUE_ID, scheduled_at: '2026-09-17' } },
  ],
  goalie_stats: [
    { id: 'goalie-current', player_id: 'flag-goalie-player', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', game_id: 'goalie-game', team_id: 'team-one', saves: 20, goals_against: 2, game_result: 'W', shutout: false, created_at: '2026-09-14', game: { id: 'goalie-game', league_id: HOCKEY_LIFE_ID, scheduled_at: '2026-09-14' } },
    { id: 'goalie-sentinel', player_id: 'flag-goalie-player', league_id: OTHER_LEAGUE_ID, season_id: 'other-season', game_id: 'goalie-other', team_id: 'other-team', saves: 999, goals_against: 0, game_result: 'W', shutout: true, created_at: '2026-09-17', game: { id: 'goalie-other', league_id: OTHER_LEAGUE_ID, scheduled_at: '2026-09-17' } },
  ],
  player_goalie_matchups: [
    { player_id: 'player-one', goalie_id: 'opponent-goalie', league_id: HOCKEY_LIFE_ID, season_id: 'season-current', games_played: 2, goals: 1, assists: 1, points: 2, shots: 8, shooting_percentage: 12.5, goalie: { full_name: 'Opponent Goalie' } },
    { player_id: 'player-one', goalie_id: 'sentinel-goalie', league_id: OTHER_LEAGUE_ID, season_id: 'season-current', games_played: 999, goals: 999, assists: 999, points: 1998, shots: 999, shooting_percentage: 100, goalie: { full_name: 'Sentinel Goalie' } },
  ],
  article_player_tags: [
    ...Array.from({ length: 21 }, (_, index) => ({ id: `sentinel-tag-${index}`, player_id: 'player-one', article_id: `sentinel-article-${index}`, created_at: `2026-09-${String(17 - (index % 9)).padStart(2, '0')}` })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `valid-tag-${index}`, player_id: 'player-one', article_id: `valid-article-${index}`, created_at: `2026-08-${String(index + 1).padStart(2, '0')}` })),
  ],
  articles: [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `valid-article-${index}`, slug: `valid-${index}`, title: `Valid story ${index}`, excerpt: 'Hockey Life', league_id: HOCKEY_LIFE_ID, published: true, published_at: `2026-09-${String(15 - index).padStart(2, '0')}`, created_at: `2026-09-${String(15 - index).padStart(2, '0')}`, article_player_tags: [{ player_id: 'player-one' }] })),
    { id: 'unpublished-new', slug: 'unpublished', title: 'Unpublished sentinel', league_id: HOCKEY_LIFE_ID, published: false, published_at: '2026-09-17', article_player_tags: [{ player_id: 'player-one' }] },
    { id: 'other-league-new', slug: 'other', title: 'Other league sentinel', league_id: OTHER_LEAGUE_ID, published: true, published_at: '2026-09-17', article_player_tags: [{ player_id: 'player-one' }] },
  ],
};

function nestedValues(row: Row, path: string[]) {
  let values: any[] = [row];
  for (const part of path) {
    values = values.flatMap((value) => {
      const next = value?.[part];
      return Array.isArray(next) ? next : next === undefined ? [] : [next];
    });
  }
  return values;
}

function createLoader(options: {
  dataset?: Record<string, Row[]>;
  errors?: Record<string, { message: string }>;
  enforceProjection?: boolean;
} = {}) {
  const dataset = options.dataset ?? baseDataset;
  const records: QueryRecord[] = [];

  class Query {
    private predicates: Array<(row: Row) => boolean> = [];
    private maximum: number | null = null;
    private record: QueryRecord;

    constructor(private table: string) {
      this.record = { table, projection: '', filters: [], orders: [], limit: null };
      records.push(this.record);
    }
    select(projection: string) { this.record.projection = projection; return this; }
    eq(column: string, value: unknown) {
      this.record.filters.push({ kind: 'eq', column, value });
      this.predicates.push((row) => nestedValues(row, column.split('.')).some((candidate) => candidate === value));
      return this;
    }
    in(column: string, values: unknown[]) {
      this.record.filters.push({ kind: 'in', column, value: [...values] });
      this.predicates.push((row) => nestedValues(row, column.split('.')).some((candidate) => values.includes(candidate)));
      return this;
    }
    is(column: string, value: unknown) {
      this.record.filters.push({ kind: 'is', column, value });
      this.predicates.push((row) => nestedValues(row, column.split('.')).some((candidate) => candidate === value));
      return this;
    }
    order(column: string, settings: { ascending?: boolean; referencedTable?: string } = {}) {
      this.record.orders.push({ column, ascending: settings.ascending ?? true, referencedTable: settings.referencedTable });
      return this;
    }
    limit(value: number) { this.maximum = value; this.record.limit = value; return this; }
    private result() {
      const invalidProjection = this.table === 'player_season_stats'
        && /(?:penalty_minutes|plus_minus)/.test(this.record.projection);
      const error = options.errors?.[this.table]
        ?? (options.enforceProjection && invalidProjection ? { message: 'player_season_stats projection references a missing column' } : null);
      const rows = (dataset[this.table] ?? [])
        .filter((row) => this.predicates.every((predicate) => predicate(row)))
        .slice()
        .sort((left, right) => {
          for (const order of this.record.orders) {
            const leftValue = nestedValues(left, [...(order.referencedTable ? [order.referencedTable] : []), order.column])[0];
            const rightValue = nestedValues(right, [...(order.referencedTable ? [order.referencedTable] : []), order.column])[0];
            const difference = String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
            if (difference !== 0) return order.ascending ? difference : -difference;
          }
          return 0;
        });
      return { data: error ? null : this.maximum == null ? rows : rows.slice(0, this.maximum), error };
    }
    async maybeSingle() {
      const result = this.result();
      return { data: result.data?.[0] ?? null, error: result.error };
    }
    then(resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }

  const playerPageModule = compileCommonJs<{ loadHockeyLifePlayerPage: (id: string, season?: string | null) => Promise<any> }>(
    new URL('../../src/lib/supabase/playerPage.ts', import.meta.url),
    { './client': { supabase: { from: (table: string) => new Query(table) } } },
  );
  return { load: playerPageModule.loadHockeyLifePlayerPage, records };
}

function hasFilter(record: QueryRecord, kind: Filter['kind'], column: string, value: unknown) {
  return record.filters.some((filter) => filter.kind === kind && filter.column === column && assert.deepEqual(filter.value, value) === undefined);
}

describe('Hockey Life player page Supabase boundary', () => {
  it('rejects invalid projections and real Supabase errors instead of fabricating empty facts', async () => {
    await assert.rejects(createLoader({ enforceProjection: true, errors: { player_season_stats: { message: 'synthetic schema failure' } } }).load('roster-current'), /synthetic schema failure/);
    await assert.rejects(createLoader({ errors: { profiles: { message: 'synthetic transport failure' } } }).load('roster-current'), /synthetic transport failure/);
  });

  it('returns null only after successful exact and operational fallback identity misses', async () => {
    assert.equal(await createLoader().load('missing-player'), null);
  });

  it('uses valid projections and verified player_stats detail for nonempty season and career skater facts', async () => {
    const { load, records } = createLoader({ enforceProjection: true });
    const page = await load('roster-current');
    assert.equal(page.metrics.games_played, 3);
    assert.equal(page.metrics.penalty_minutes, 6);
    assert.equal(page.metrics.plus_minus, 4);
    assert.deepEqual(page.careerRows.map((row: Row) => [row.seasonId, row.metrics.penalty_minutes, row.metrics.plus_minus]), [
      ['season-old', 2, -1],
      ['season-current', 6, 4],
    ]);
    assert.ok(records.filter((record) => record.table === 'player_season_stats').every((record) => !/(?:penalty_minutes|plus_minus)/.test(record.projection)));
  });

  it('keeps unavailable verified plus-minus facts null instead of inventing zero', async () => {
    const dataset = {
      ...baseDataset,
      player_stats: baseDataset.player_stats.map((row) => row.id === 'stat-current' ? { ...row, plus_minus: null } : row),
    };
    const page = await createLoader({ dataset, enforceProjection: true }).load('roster-current');
    assert.equal(page.metrics.plus_minus, null);
    assert.equal(page.games[0].metrics.plus_minus, null);
  });

  it('serializes every stats, log, matchup, and article request with Hockey Life predicates', async () => {
    const { load, records } = createLoader({ enforceProjection: true });
    const page = await load('roster-current');
    assert.equal(page.metrics.goals, 2);
    assert.equal(page.games.some((game: Row) => game.id === 'game-other'), false);
    assert.equal(page.matchups.some((matchup: Row) => matchup.id === 'sentinel-goalie'), false);

    const seasonIds = ['season-current', 'season-old'];
    const seasonViews = records.filter((record) => record.table === 'player_season_stats');
    assert.ok(seasonViews.length >= 2);
    assert.ok(seasonViews.every((record) => hasFilter(record, 'in', 'season_id', seasonIds)));
    for (const table of ['goalie_stats', 'player_stats', 'player_goalie_matchups', 'articles', 'player_badges']) {
      const matching = records.filter((record) => record.table === table);
      assert.ok(matching.length > 0, `${table} should be queried`);
      assert.ok(matching.every((record) => hasFilter(record, 'eq', 'league_id', HOCKEY_LIFE_ID)), `${table} must be league scoped`);
    }
  });

  it('requires the operational season, current status, and no end date for profile fallback', async () => {
    const page = await createLoader({ enforceProjection: true }).load('fallback-player');
    assert.equal(page.rosterId, 'fallback-current');

    const noCurrentDataset = {
      ...baseDataset,
      team_rosters: baseDataset.team_rosters.filter((row) => row.id !== 'fallback-current'),
    };
    assert.equal(await createLoader({ dataset: noCurrentDataset, enforceProjection: true }).load('fallback-player'), null);
  });

  it('honors canonical is_goalie and uses normalized position only for legacy rows', async () => {
    const loader = createLoader({ enforceProjection: true }).load;
    assert.equal((await loader('flag-goalie')).isGoalie, true);
    assert.equal((await loader('flag-skater')).isGoalie, false);
    assert.equal((await loader('legacy-goalie')).isGoalie, true);
  });

  it('filters and orders Hockey Life articles before limiting to the newest five', async () => {
    const { load, records } = createLoader({ enforceProjection: true });
    const page = await load('roster-current');
    assert.deepEqual(page.articles.map((article: Row) => article.id), [
      'valid-article-0', 'valid-article-1', 'valid-article-2', 'valid-article-3', 'valid-article-4',
    ]);
    const articleQuery = records.find((record) => record.table === 'articles');
    assert.ok(articleQuery);
    assert.ok(articleQuery.projection.includes('article_player_tags!inner'));
    assert.ok(hasFilter(articleQuery, 'eq', 'article_player_tags.player_id', 'player-one'));
    assert.ok(hasFilter(articleQuery, 'eq', 'league_id', HOCKEY_LIFE_ID));
    assert.ok(hasFilter(articleQuery, 'eq', 'published', true));
    assert.deepEqual(articleQuery.orders, [
      { column: 'published_at', ascending: false, referencedTable: undefined },
      { column: 'id', ascending: true, referencedTable: undefined },
    ]);
    assert.equal(articleQuery.limit, 5);
  });
});
