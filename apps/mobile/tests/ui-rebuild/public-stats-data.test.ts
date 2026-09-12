/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs } from './component-harness';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';

function moduleWith(supabase: any = {}) {
  return compileCommonJs<any>(new URL('../../src/lib/supabase/publicStats.ts', import.meta.url), {
    './client': { supabase },
  });
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe('canonical public stats boundary', () => {
  it('accepts factual empty career rows with unknown PIM from the canonical API', async () => {
    const api = moduleWith();
    const result = await api.getPublicPlayerCareer('harbour', LEAGUE, PLAYER, async () => response({
      schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour', player: { id: PLAYER, name: 'Pat', avatar_url: null },
      totals: { games_played: 0, goals: 0, assists: 0, points: 0, penalty_minutes: null }, seasons: [],
    }));
    assert.deepEqual(result.seasons, []);
    assert.equal(result.totals.gamesPlayed, 0);
    assert.equal(result.totals.penaltyMinutes, null);
  });
  it('keeps imported-only history with a real source ID instead of inventing a season', async () => {
    const api = moduleWith();
    const sourceId = '77777777-7777-4777-8777-777777777777';
    const payload = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour',
      player: { id: PLAYER, name: 'Pat', avatar_url: null },
      totals: { games_played: 10, goals: 8, assists: 9, points: 17, penalty_minutes: null },
      seasons: [{ season_id: null, source_id: sourceId, season_name: 'Imported career history',
        team_id: null, team_name: null, sort_date: null, games_played: 10, goals: 8, assists: 9,
        points: 17, penalty_minutes: null, source: 'imported' }] };
    const result = await api.loadCanonicalCareer(PLAYER, [{ id: LEAGUE, name: 'Harbour', slug: 'harbour' }], async () => response(payload));
    assert.equal(result.totals.points, 17);
    assert.equal(result.leagues[0].seasonCount, 0);
    assert.equal(result.leagues[0].seasons[0].seasonId, null);
    assert.equal(result.leagues[0].seasons[0].sourceId, sourceId);
    for (const row of [
      { ...payload.seasons[0], source_id: undefined },
      { ...payload.seasons[0], source_id: 'not-a-source-id' },
      { ...payload.seasons[0], source: 'recorded' },
    ]) await assert.rejects(api.getPublicPlayerCareer('harbour', LEAGUE, PLAYER, async () => response({ ...payload, seasons: [row] })), /import|source|season/i);
  });
  it('validates literals before network and sends no credentials', async () => {
    const calls: any[] = [];
    const api = moduleWith();
    await assert.rejects(api.getPublicGoalies('Bad Slug!', LEAGUE, null, null, async (...args: any[]) => calls.push(args)), /slug/i);
    await assert.rejects(api.getPublicPlayerCareer('harbour', 'not-a-uuid', PLAYER, async (...args: any[]) => calls.push(args)), /league id/i);
    assert.equal(calls.length, 0);
  });

  it('scopes goalie requests, converts percent to fraction, and preserves unknown metrics and estimates', async () => {
    const calls: any[] = [];
    const api = moduleWith();
    const payload = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour',
      presentationSeason: { id: SEASON, name: 'Summer 2026', league_id: LEAGUE, status: 'active' },
      divisionId: null, source: 'estimated', goalies: [{ player_id: PLAYER, player_name: 'G. One', team_id: TEAM,
        team_name: 'Owls', avatar_url: null, games_played: 3, wins: 2, losses: 1, save_percentage: null,
      goals_against_average: null, shutouts: 0, saves: null, goals_against: 7, estimated: true }] };
    const result = await api.getPublicGoalies('harbour', LEAGUE, SEASON, null, async (url: string, init: any) => {
      calls.push({ url, init }); return response(payload);
    });
    assert.match(calls[0].url, /^https:\/\/harbour\.beerleaguehockey\.ca\/api\/public\/goalies\?/);
    assert.match(calls[0].url, new RegExp(`seasonId=${SEASON}`));
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
    assert.equal(calls[0].init.credentials, undefined);
    assert.equal(result.goalies[0].save_percentage, null);
    assert.equal(result.goalies[0].estimated, true);
    const measured = { ...payload, source: 'recorded', goalies: [{ ...payload.goalies[0], save_percentage: 72.0,
      goals_against_average: 2.33, saves: 18, estimated: false }] };
    const converted = await api.getPublicGoalies('harbour', LEAGUE, SEASON, null, async () => response(measured));
    assert.equal(converted.goalies[0].save_percentage, 0.72);
  });

  it('accepts an unknown goalie team without inventing an id', async () => {
    const api = moduleWith();
    const payload = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour',
      presentationSeason: { id: SEASON, name: 'Summer', league_id: LEAGUE, status: 'active' }, divisionId: null,
      source: 'estimated', goalies: [{ player_id: PLAYER, player_name: 'Unknown Team Goalie', team_id: null,
        team_name: 'Unknown team', avatar_url: null, games_played: 1, wins: 0, losses: 0, save_percentage: null,
        goals_against_average: null, shutouts: 0, saves: null, goals_against: 0, estimated: true }] };
    const result = await api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response(payload));
    assert.equal(result.goalies[0].team_id, null);
  });

  it('rejects HTTP errors, identity mismatches, duplicates, nonfinite/bounds, and oversized payloads', async () => {
    const api = moduleWith();
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response({}, 503)), /503/);
    const base = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour', presentationSeason: null,
      divisionId: null, source: 'empty', goalies: [] };
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response({ ...base, leagueId: PLAYER })), /identity/i);
    const row = { player_id: PLAYER, player_name: 'Goalie', team_id: TEAM, team_name: 'Owls', avatar_url: null,
      games_played: 1, wins: 1, losses: 0, save_percentage: 90, goals_against_average: 2,
      shutouts: 0, saves: 18, goals_against: 2, estimated: false };
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response({ ...base,
      presentationSeason: { id: SEASON, name: 'S', league_id: LEAGUE, status: 'active' }, source: 'recorded', goalies: [row, row] })), /duplicate/i);
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response({ ...base,
      presentationSeason: { id: SEASON, name: 'S', league_id: LEAGUE, status: 'active' }, source: 'recorded', goalies: [{ ...row, wins: 1e20 }] })), /wins/i);
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => ({ ok: true, status: 200, text: async () => ' '.repeat(262145) })), /byte limit/i);
  });

  it('aborts a public read at its timeout', async () => {
    const api = moduleWith();
    await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, (_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    }), 1), /timeout/i);
  });

  it('counts UTF-8 bytes without TextEncoder', async () => {
    const previous = globalThis.TextEncoder;
    try {
      Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: undefined });
      const api = moduleWith();
      await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => ({
        ok: true, status: 200, text: async () => 'é'.repeat(140_000),
      })), /byte limit/i);
    } finally {
      Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: previous });
    }
  });

  it('rejects contradictory career totals, points, PIM, and goalie arithmetic', async () => {
    const api = moduleWith();
    const career = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour',
      player: { id: PLAYER, name: 'Pat', avatar_url: null },
      totals: { games_played: 1, goals: 1, assists: 1, points: 2, penalty_minutes: 2 },
      seasons: [{ season_id: SEASON, season_name: 'Summer', team_id: null, team_name: null, sort_date: null,
        games_played: 1, goals: 1, assists: 1, points: 2, penalty_minutes: 2, source: 'recorded' }] };
    await assert.rejects(api.getPublicPlayerCareer('harbour', LEAGUE, PLAYER, async () => response({ ...career,
      totals: { ...career.totals, games_played: 999 } })), /total|reconcil/i);
    await assert.rejects(api.getPublicPlayerCareer('harbour', LEAGUE, PLAYER, async () => response({ ...career,
      seasons: [{ ...career.seasons[0], points: 9 }] })), /points/i);
    await assert.rejects(api.getPublicPlayerCareer('harbour', LEAGUE, PLAYER, async () => response({ ...career,
      totals: { ...career.totals, penalty_minutes: null } })), /PIM|penalty/i);

    const base = { schemaVersion: 1, leagueId: LEAGUE, leagueSlug: 'harbour',
      presentationSeason: { id: SEASON, name: 'Summer', league_id: LEAGUE, status: 'active' }, divisionId: null,
      source: 'recorded', goalies: [{ player_id: PLAYER, player_name: 'Goalie', team_id: TEAM, team_name: 'Owls',
        avatar_url: null, games_played: 1, wins: 1, losses: 0, save_percentage: 90, goals_against_average: 2,
        shutouts: 0, saves: 18, goals_against: 2, estimated: false }] };
    for (const row of [
      { ...base.goalies[0], wins: 2 },
      { ...base.goalies[0], wins: 1, losses: 1 },
      { ...base.goalies[0], shutouts: 2 },
      { ...base.goalies[0], save_percentage: 91.7 },
      { ...base.goalies[0], goals_against_average: 3 },
    ]) await assert.rejects(api.getPublicGoalies('harbour', LEAGUE, null, null, async () => response({ ...base, goalies: [row] })), /goalie/i);
  });

  it('aggregates each canonical league exactly once and preserves imported rows and nullable PIM', async () => {
    const api = moduleWith();
    const league2 = '55555555-5555-4555-8555-555555555555';
    const season2 = '66666666-6666-4666-8666-666666666666';
    const seeds = [{ id: LEAGUE, name: 'Harbour', slug: 'harbour' }, { id: LEAGUE, name: 'Duplicate', slug: 'harbour' },
      { id: league2, name: 'Valley', slug: 'valley' }];
    const calls: string[] = [];
    const career = (leagueId: string, slug: string, seasonId: string, source: string, gp: number, pim: number | null) => ({
      schemaVersion: 1, leagueId, leagueSlug: slug, player: { id: PLAYER, name: 'Pat Player', avatar_url: null },
      totals: { games_played: gp, goals: 2, assists: 3, points: 5, penalty_minutes: pim },
      seasons: [{ season_id: seasonId, season_name: source === 'imported' ? 'Historical baseline' : 'Summer', team_id: null,
        team_name: null, sort_date: null, games_played: gp, goals: 2, assists: 3, points: 5,
        penalty_minutes: pim, source }],
    });
    const result = await api.loadCanonicalCareer(PLAYER, seeds, async (url: string) => {
      calls.push(url); return response(url.includes('valley.') ? career(league2, 'valley', season2, 'recorded', 4, 6) : career(LEAGUE, 'harbour', SEASON, 'imported', 10, null));
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(result.totals, { gamesPlayed: 14, goals: 4, assists: 6, points: 10, penaltyMinutes: null });
    assert.equal(result.leagues[0].seasons[0].source, 'imported');
    assert.equal(result.leagues.reduce((n: number, l: any) => n + l.seasonCount, 0), 2);
  });

  it('fails the whole career read when any league fails instead of returning partial zero totals', async () => {
    const api = moduleWith();
    const league2 = '55555555-5555-4555-8555-555555555555';
    await assert.rejects(api.loadCanonicalCareer(PLAYER, [
      { id: LEAGUE, name: 'Harbour', slug: 'harbour' }, { id: league2, name: 'Valley', slug: 'valley' },
    ], async (url: string) => response({}, url.includes('valley.') ? 500 : 200)), /500|invalid/i);
  });

  it('uses authoritative public career metadata and never restores seed or demo leagues', async () => {
    const league2 = '55555555-5555-4555-8555-555555555555';
    const demo = '77777777-7777-4777-8777-777777777777'; const calls:any[]=[];
    const api=moduleWith({from:()=>{throw new Error('must not query Supabase')}});
    const result=await api.discoverCareerLeagues(PLAYER,[
      {id:LEAGUE,name:'Membership only',slug:'membership'}, {id:demo,name:'DEMO LEAGUE',slug:'demo'},
    ],async(url:string,init:any)=>{calls.push({url,init});return response({schemaVersion:1,playerId:PLAYER,
      leagues:[{id:league2,name:'Imported History',slug:'imported-history'}]});},5);
    assert.equal(calls[0].url,`https://api.beerleaguehockey.ca/api/public/career-leagues?playerId=${PLAYER}`);
    assert.deepEqual(result,[{id:league2,name:'Imported History',slug:'imported-history'}]);
    assert.deepEqual(calls[0].init.headers,{Accept:'application/json'});
  });

  it('strictly validates career metadata identity, shape, unique ids/slugs, bounds, and timeout', async () => {
    const api=moduleWith(); const ok={schemaVersion:1,playerId:PLAYER,leagues:[{id:LEAGUE,name:'Harbour',slug:'harbour'}]};
    for (const bad of [
      {...ok,playerId:LEAGUE}, {...ok,extra:true}, {...ok,leagues:[{...ok.leagues[0],extra:true}]},
      {...ok,leagues:[ok.leagues[0],{...ok.leagues[0]}]},
      {...ok,leagues:[ok.leagues[0],{id:'55555555-5555-4555-8555-555555555555',name:'Other',slug:'harbour'}]},
      {...ok,leagues:[{...ok.leagues[0],slug:'Bad Slug'}]}, {...ok,leagues:[{...ok.leagues[0],name:''}]},
      {...ok,leagues:Array.from({length:101},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:`L${i}`,slug:`l-${i}`}))},
    ]) await assert.rejects(api.discoverCareerLeagues(PLAYER,[],async()=>response(bad)), /career|league|duplicate|slug|name|bound|scope/i);
    await assert.rejects(api.discoverCareerLeagues(PLAYER,[],(_url:string,init:any)=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(new Error('AbortError')));
    }),1),/timed out/i);
  });
});
