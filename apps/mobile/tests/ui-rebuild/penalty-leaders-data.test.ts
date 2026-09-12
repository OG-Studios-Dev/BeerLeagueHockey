/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs } from './component-harness';

const season = { id: 'season-a', name: 'Current', start_date: '2026-01-01', end_date: null, status: 'active' };

function stat(id: string, playerId: string, pim: number | null, options: Record<string, any> = {}) {
  const teamId = options.teamId ?? 'team-a';
  return {
    id, player_id: playerId, team_id: teamId, game_id: options.gameId ?? `game-${id}`,
    league_id: options.leagueId ?? 'league-a', season_id: options.seasonId ?? 'season-a',
    goals: options.goals ?? 0, assists: options.assists ?? 0, penalty_minutes: pim,
    player: { id: playerId, full_name: options.name ?? `Player ${playerId}`, avatar_url: null },
    team: { id: teamId, name: options.teamName ?? 'Real Team', short_name: options.shortName ?? 'Real' },
    game: { id: options.gameId ?? `game-${id}`, league_id: options.gameLeagueId ?? 'league-a', season_id: options.gameSeasonId ?? 'season-a', status: options.status ?? 'completed' },
  };
}

function boundary(rows: any[], options: { pageCap?: number; error?: string; currentSeason?: any; seasonError?: string } = {}) {
  const requests: any[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, 'player_stats');
      const filters: any[] = []; let from = 0; let to = Number.MAX_SAFE_INTEGER; let selectArgs: any[] = [];
      const query: any = {
        select: (...args: any[]) => { selectArgs = args; return query; },
        eq: (key: string, value: any) => { filters.push([key, value]); return query; },
        order: (key: string, config: any) => { requests.push({ order: [key, config] }); return query; },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        then(resolve: any) {
          requests.push({ selectArgs, filters: [...filters], range: [from, to] });
          if (options.error) return Promise.resolve({ data: null, count: null, error: { message: options.error } }).then(resolve);
          const filtered = rows.filter(row => filters.every(([key, value]) => {
            if (key.startsWith('game.')) return row.game[key.slice(5)] === value;
            return row[key] === value;
          })).sort((left, right) => left.id.localeCompare(right.id));
          const cap = Math.min(to - from + 1, options.pageCap ?? Number.MAX_SAFE_INTEGER);
          return Promise.resolve({ data: filtered.slice(from, from + cap), count: filtered.length, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const compiled = compileCommonJs<any>(new URL('../../src/lib/supabase/penaltyLeaders.ts', import.meta.url), {
    './client': { supabase }, './data': {}, './team': { getTeamActiveSeason: async () => ({ season: options.currentSeason === undefined ? season : options.currentSeason, error: options.seasonError ?? null }) },
  });
  return { ...compiled, requests };
}

describe('authoritative PIM leaders', () => {
  it('paginates the complete population before top-50 ranking and computes points from G+A', async () => {
    const lowPointsHighPim = stat('z', 'hidden', 99, { goals: 0, assists: 0, name: 'Hidden Enforcer' });
    const rows = Array.from({ length: 55 }, (_, index) => stat(String(index).padStart(3, '0'), `p${index}`, index, { goals: 10, assists: 20 })).concat(lowPointsHighPim);
    const data = boundary(rows, { pageCap: 17 });
    const result = await data.getPenaltyLeaders('league-a', 50);
    assert.equal(result.status, 'ready');
    assert.equal(result.leaders.length, 50);
    assert.equal(result.leaders[0].player_id, 'hidden');
    assert.equal(result.leaders[0].points, 0);
    assert.ok(data.requests.filter((request: any) => request.range).length > 1);
  });

  it('uses declared columns, redundant tenant/season/completed filters, stable paging, and deduplicates records', async () => {
    const duplicate = stat('one', 'player-a', 4, { gameId: 'game-a', goals: 1, assists: 2, name: 'Ada', teamName: 'Falcons' });
    const data = boundary([duplicate, { ...duplicate, id: 'duplicate' }, stat('two', 'player-a', 2, { gameId: 'game-b', name: 'Ada', teamName: 'Falcons' })], { pageCap: 1 });
    const result = await data.getPenaltyLeaders('league-a');
    assert.equal(result.leaders[0].penalty_minutes, 6);
    assert.equal(result.leaders[0].games_played, 2);
    assert.equal(result.leaders[0].points, 3);
    const first = data.requests.find((request: any) => request.range);
    assert.match(first.selectArgs[0], /penalty_minutes/);
    assert.doesNotMatch(first.selectArgs[0], /(^|[,\s])points([,\s]|$)/);
    for (const filter of [['league_id','league-a'],['season_id','season-a'],['game.league_id','league-a'],['game.season_id','season-a'],['game.status','completed']]) {
      assert.ok(first.filters.some((entry: any[]) => entry[0] === filter[0] && entry[1] === filter[1]));
    }
    assert.ok(data.requests.some((request: any) => request.order?.[0] === 'id'));
    assert.equal(first.selectArgs[1].count, 'exact');
  });

  it('orders equal PIM by real name then profile ID and keeps unavailable PIM distinct from zero', async () => {
    const data = boundary([stat('1','z',2,{name:'Zulu'}), stat('2','a',2,{name:'Alpha'}), stat('3','unknown',null)]);
    const result = await data.getPenaltyLeaders('league-a');
    assert.deepEqual(result.leaders.map((row: any) => row.player_id), ['a','z']);
    assert.equal(result.unavailablePlayerCount, 1);
    assert.equal((await boundary([stat('x','unknown',null)]).getPenaltyLeaders('league-a')).status, 'unavailable');
    assert.equal((await boundary([]).getPenaltyLeaders('league-a')).status, 'empty');
  });

  it('propagates source errors and performs no unscoped read when there is no current season', async () => {
    await assert.rejects(boundary([], { error: 'PIM read failed' }).getPenaltyLeaders('league-a'), /PIM read failed/);
    await assert.rejects(boundary([], { seasonError: 'season lookup failed' }).getPenaltyLeaders('league-a'), /season lookup failed/);
    const data = boundary([], { currentSeason: null });
    assert.deepEqual(await data.getPenaltyLeaders('league-a'), { status: 'no-season', leaders: [], unavailablePlayerCount: 0 });
    assert.equal(data.requests.length, 0);
  });

  for (const status of ['draft', 'completed', 'archived']) {
    it(`does not query stats when the active/playoffs selector rejects a ${status}-only league`, async () => {
      const data = boundary([], { currentSeason: null });
      assert.equal((await data.getPenaltyLeaders('league-a')).status, 'no-season');
      assert.equal(data.requests.length, 0);
    });
  }
});
