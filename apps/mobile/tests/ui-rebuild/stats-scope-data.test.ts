/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs } from './component-harness';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const metric = (value: number | null, state = value === null ? 'unknown' : 'recorded', sources: string[] = value === null ? [] : ['skater_stats']) => ({ value, state, sources });

function moduleWith() {
  return compileCommonJs<any>(new URL('../../src/lib/supabase/publicStats.ts', import.meta.url), { './client': { supabase: {} } });
}

function payload() {
  return {
    schemaVersion: 1,
    leagueId: LEAGUE,
    leagueSlug: 'harbour',
    divisionId: null,
    scope: { kind: 'current', label: 'Current season', seasonIds: [SEASON], currentSeasonId: SEASON },
    seasons: [{ id: SEASON, name: 'Fall 2026', status: 'active', startDate: '2026-09-01' }],
    players: [{
      playerId: PLAYER, playerName: 'Jack Foote', avatarUrl: 'https://example.test/photo.png',
      displayTeam: { id: TEAM, name: 'Wolves', logoUrl: 'https://example.test/crest.png' },
      skater: { gamesPlayed: metric(2), goals: metric(3), assists: metric(1), points: metric(4), championships: metric(0, 'verified', ['player_badges']) },
      goalie: { gamesPlayed: metric(2, 'recorded', ['goalie_stats']), goalsAgainst: metric(5, 'recorded', ['goalie_stats']), goalsAgainstAverage: metric(2.5, 'recorded', ['goalie_stats']), championships: metric(null) },
    }],
  };
}

describe('public stats scope boundary', () => {
  it('performs one server-owned scope request and preserves logos, fallback photos, known zero, and unknown', async () => {
    const api = moduleWith();
    const calls: any[] = [];
    const result = await api.getPublicStatsScope('harbour', LEAGUE, { kind: 'current' }, null, async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(payload()) };
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\/public\/stats-scope\?/);
    assert.match(calls[0].url, /scope=current/);
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
    assert.equal(result.players[0].avatarUrl, 'https://example.test/photo.png');
    assert.equal(result.players[0].displayTeam.logoUrl, 'https://example.test/crest.png');
    assert.equal(result.players[0].skater.championships.value, 0);
    assert.equal(result.players[0].goalie.championships.value, null);
  });

  it('encodes one or multiple selected seasons without client fan-out', async () => {
    const api = moduleWith();
    const urls: string[] = [];
    const body = payload();
    body.scope = { ...body.scope, kind: 'multiple', label: '2 seasons', seasonIds: [SEASON, TEAM] };
    body.seasons.push({ id: TEAM, name: 'Summer 2026', status: 'completed', startDate: '2026-06-01' });
    await api.getPublicStatsScope('harbour', LEAGUE, { kind: 'multiple', seasonIds: [SEASON, TEAM] }, null, async (url: string) => {
      urls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    assert.equal(urls.length, 1);
    assert.match(urls[0], new RegExp(`seasonId=${SEASON}`));
    assert.match(urls[0], new RegExp(`seasonId=${TEAM}`));
  });

  it('rejects partial or arithmetically false aggregate results', async () => {
    const api = moduleWith();
    const bad = payload();
    bad.players[0].goalie.goalsAgainstAverage = metric(9, 'recorded', ['goalie_stats']);
    await assert.rejects(api.getPublicStatsScope('harbour', LEAGUE, { kind: 'current' }, null, async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(bad),
    })), /GAA|goalie/i);
    await assert.rejects(api.getPublicStatsScope('harbour', LEAGUE, { kind: 'multiple', seasonIds: [] }, null, async () => {
      throw new Error('network must not run');
    }), /season/i);
  });

  it('rejects a partial all-time response instead of presenting it as complete', async () => {
    const api = moduleWith();
    const partial = payload();
    partial.scope = { ...partial.scope, kind: 'all', label: 'All time' };
    partial.seasons.push({ id: TEAM, name: 'Summer 2025', status: 'completed', startDate: '2025-06-01' });
    await assert.rejects(api.getPublicStatsScope('harbour', LEAGUE, { kind: 'all' }, null, async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(partial),
    })), /all.time|complete|season/i);
  });

  it('never sends a retained division for league-wide all-time stats', async () => {
    const api = moduleWith();
    const allTime = payload();
    allTime.scope = { ...allTime.scope, kind: 'all', label: 'All time' };
    const urls: string[] = [];
    const result = await api.getPublicStatsScope('harbour', LEAGUE, { kind: 'all' }, TEAM, async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify(allTime) };
    });
    assert.equal(urls.length, 1);
    assert.doesNotMatch(urls[0], /divisionId=/);
    assert.equal(result.divisionId, null);
  });
});
