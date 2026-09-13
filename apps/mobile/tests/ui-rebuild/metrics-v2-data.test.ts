/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCommonJs } from './component-harness';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';

const metric = (value: number | null, state: string, sources: string[], candidates?: Record<string, number>) => ({
  value, state, sources, ...(candidates ? { candidates } : {}),
});

function moduleWith() {
  return compileCommonJs<any>(new URL('../../src/lib/supabase/publicStats.ts', import.meta.url), {
    './client': { supabase: {} },
  });
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function seasonPayload(): any {
  return {
    schemaVersion: 2,
    leagueId: LEAGUE,
    leagueSlug: 'harbour',
    presentationSeason: { id: SEASON, name: 'Summer 2026', league_id: LEAGUE, status: 'active' },
    divisionId: null,
    players: [{
      playerId: PLAYER,
      playerName: 'Transfer Leader',
      avatarUrl: null,
      displayTeam: { id: TEAM, name: 'Owls' },
      teams: [{ id: TEAM, name: 'Owls' }, { id: '55555555-5555-4555-8555-555555555555', name: 'Foxes' }],
      roles: ['skater', 'goalie'],
      metrics: {
        gamesPlayed: metric(null, 'conflicted', ['attendance'], { confirmed: 8, recorded: 9, estimated: 11 }),
        goals: metric(10, 'recorded', ['skater_stats']),
        assists: metric(9, 'reported', ['imported']),
        points: metric(19, 'recorded', ['skater_stats']),
        penaltyMinutes: metric(null, 'unknown', []),
      },
      goalie: {
        gamesPlayed: metric(2, 'recorded', ['goalie_assignment']),
        wins: metric(1, 'recorded', ['goalie_stats']),
        losses: metric(1, 'recorded', ['goalie_stats']),
        saves: metric(18, 'estimated', ['goalie_stats']),
        goalsAgainst: metric(2, 'recorded', ['goalie_stats']),
        savePercentage: metric(null, 'unknown', []),
        goalsAgainstAverage: metric(1, 'recorded', ['goalie_stats']),
        shutouts: metric(0, 'reported', ['goalie_stats']),
      },
    }],
    coverage: { participation: ['conflicted'], penalties: ['unknown'], goalies: ['recorded', 'estimated', 'unknown'] },
  };
}

describe('public metrics v2 boundary', () => {
  it('requests the explicit v2, team-scoped season contract and preserves metric provenance', async () => {
    const api = moduleWith();
    const calls: any[] = [];
    const result = await api.getPublicSeasonStats('harbour', LEAGUE, SEASON, null, TEAM, async (url: string, init: any) => {
      calls.push({ url, init });
      const payload = seasonPayload();
      payload.players[0].teams = [{ id: TEAM, name: 'Owls' }];
      return response(payload);
    });

    assert.match(calls[0].url, /contractVersion=2/);
    assert.match(calls[0].url, new RegExp(`seasonId=${SEASON}`));
    assert.match(calls[0].url, new RegExp(`teamId=${TEAM}`));
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
    assert.equal(result.players[0].metrics.gamesPlayed.state, 'conflicted');
    assert.equal(result.players[0].metrics.penaltyMinutes.value, null);
    assert.equal(result.players[0].goalie.saves.state, 'estimated');
    assert.equal(result.players[0].goalie.goalsAgainst.state, 'recorded');
  });

  it('formats every state without turning missing or conflicted facts into zero', () => {
    const api = moduleWith();
    assert.deepEqual(api.formatPublicMetric(metric(null, 'conflicted', ['attendance'])), { value: 'Needs review', hint: 'Conflicting records need review.' });
    assert.deepEqual(api.formatPublicMetric(metric(11, 'estimated', ['roster_window'])), { value: '~11', hint: 'Estimated from roster eligibility.' });
    assert.deepEqual(api.formatPublicMetric(metric(null, 'unknown', [])), { value: '—', hint: 'Not recorded.' });
    assert.deepEqual(api.formatPublicMetric(metric(0, 'verified', ['capture_confirmation'])), { value: '0', hint: 'Verified.' });
    assert.deepEqual(api.formatPublicMetric(metric(6, 'reported', ['imported'])), { value: '6', hint: 'Reported from imported records.' });
    assert.deepEqual(api.formatPublicMetric(metric(4, 'recorded', ['skater_stats'])), { value: '4', hint: 'Recorded from game statistics.' });
  });

  it('ranks aggregate server rows only after filtering unknown PIM', () => {
    const api = moduleWith();
    const payload = seasonPayload();
    payload.players.push(
      { ...payload.players[0], playerId: '66666666-6666-4666-8666-666666666666', playerName: 'Fifteen', roles: ['skater'], teams: [{ id: TEAM, name: 'Owls' }], goalie: null,
        metrics: { ...payload.players[0].metrics, gamesPlayed: metric(8, 'recorded', ['skater_stats']), points: metric(15, 'recorded', ['skater_stats']), goals: metric(8, 'recorded', ['skater_stats']), assists: metric(7, 'recorded', ['skater_stats']), penaltyMinutes: metric(4, 'verified', ['capture_confirmation']) } },
      { ...payload.players[0], playerId: '77777777-7777-4777-8777-777777777777', playerName: 'Twelve', roles: ['skater'], teams: [{ id: TEAM, name: 'Owls' }], goalie: null,
        metrics: { ...payload.players[0].metrics, gamesPlayed: metric(7, 'estimated', ['roster_window']), points: metric(12, 'recorded', ['skater_stats']), goals: metric(7, 'recorded', ['skater_stats']), assists: metric(5, 'recorded', ['skater_stats']), penaltyMinutes: metric(0, 'verified', ['capture_confirmation']) } },
    );
    const points = api.toPlayerStatRows(payload, 'points', 3);
    assert.deepEqual(points.map((row: any) => [row.player_name, row.points]), [['Transfer Leader', 19], ['Fifteen', 15], ['Twelve', 12]]);
    assert.equal(points[0].games_played, null);
    assert.equal(points[0].games_played_state, 'conflicted');
    const pim = api.toPlayerStatRows(payload, 'penalty_minutes', 3);
    assert.deepEqual(pim.map((row: any) => [row.player_name, row.penalty_minutes]), [['Fifteen', 4], ['Twelve', 0]]);
  });

  it('rejects malformed metrics, schema mismatches, arithmetic mismatches, and response scope mismatches', async () => {
    const api = moduleWith();
    const base = seasonPayload();
    for (const bad of [
      { ...base, schemaVersion: 1 },
      { ...base, leagueId: PLAYER },
      { ...base, players: [{ ...base.players[0], extra: true }] },
      { ...base, players: [{ ...base.players[0], metrics: { ...base.players[0].metrics, gamesPlayed: { value: null, state: 'recorded', sources: ['skater_stats'] } } }] },
      { ...base, players: [{ ...base.players[0], metrics: { ...base.players[0].metrics, points: metric(20, 'recorded', ['skater_stats']) } }] },
      { ...base, players: [{ ...base.players[0], metrics: { ...base.players[0].metrics, penaltyMinutes: metric(0, 'unknown', []) } }] },
    ]) {
      await assert.rejects(
        api.getPublicSeasonStats('harbour', LEAGUE, SEASON, null, null, async () => response(bad)),
        /schema|identity|shape|metric|points|unknown|scope/i,
      );
    }
    await assert.rejects(
      api.getPublicSeasonStats('harbour', LEAGUE, SEASON, null, TEAM, async () => response(base)),
      /team scope mismatch/i,
    );
  });

  it('requires goalie v2 and retains mixed row and field provenance', async () => {
    const api = moduleWith();
    let requested = '';
    const payload = {
      schemaVersion: 2, leagueId: LEAGUE, leagueSlug: 'harbour',
      presentationSeason: { id: SEASON, name: 'Summer 2026', league_id: LEAGUE, status: 'active' },
      divisionId: null,
      goalies: [{
        playerId: PLAYER, playerName: 'Mixed Goalie', avatarUrl: null,
        displayTeam: { id: TEAM, name: 'Owls' }, teams: [{ id: TEAM, name: 'Owls' }],
        metrics: seasonPayload().players[0].goalie,
      }],
      coverage: { goalies: ['recorded', 'estimated', 'unknown'] },
    };
    const result = await api.getPublicGoaliesV2('harbour', LEAGUE, SEASON, null, async (url: string) => {
      requested = url; return response(payload);
    });
    assert.match(requested, /contractVersion=2/);
    assert.equal(result.goalies[0].metrics.saves.state, 'estimated');
    assert.equal(result.goalies[0].metrics.goalsAgainst.state, 'recorded');
    assert.equal(api.formatPublicMetric(result.goalies[0].metrics.savePercentage).value, '—');
  });

  it('parses dual-role career v2 without losing imported skater or goalie values', async () => {
    const api = moduleWith();
    let requested = '';
    const skater = seasonPayload().players[0];
    const payload = {
      schemaVersion: 2, leagueId: LEAGUE, leagueSlug: 'harbour',
      player: { id: PLAYER, name: 'Dual Role', avatarUrl: null },
      totals: { roles: ['skater', 'goalie'], metrics: skater.metrics, goalie: skater.goalie },
      seasons: [{
        seasonId: SEASON, sourceId: null, seasonName: 'Imported Summer', sortDate: '2026-09-01',
        teams: [{ id: TEAM, name: 'Owls' }], roles: ['skater', 'goalie'], metrics: skater.metrics, goalie: skater.goalie,
      }],
    };
    const result = await api.getPublicPlayerCareerV2('harbour', LEAGUE, PLAYER, async (url: string) => {
      requested = url; return response(payload);
    });
    assert.match(requested, /contractVersion=2/);
    assert.deepEqual(result.seasons[0].roles, ['skater', 'goalie']);
    assert.equal(result.seasons[0].metrics.points.value, 19);
    assert.equal(result.seasons[0].metrics.assists.sources[0], 'imported');
    assert.equal(result.seasons[0].goalie.saves.value, 18);
  });

  it('preserves an authoritative single-league rate independently and keeps an unrecomputable multi-league rate unknown', async () => {
    const api = moduleWith();
    const careerPayload = (leagueId: string, slug: string, goalieOverrides: Record<string, unknown> = {}) => {
      const skater = seasonPayload().players[0];
      const goalieMetrics = { ...skater.goalie, ...goalieOverrides };
      return {
        schemaVersion: 2, leagueId, leagueSlug: slug,
        player: { id: PLAYER, name: 'Independent Rate', avatarUrl: null },
        totals: { roles: ['goalie'], metrics: skater.metrics, goalie: goalieMetrics },
        seasons: [{ seasonId: null, sourceId: SEASON, seasonName: `${slug} history`, sortDate: null,
          teams: [], roles: ['goalie'], metrics: skater.metrics, goalie: goalieMetrics }],
      };
    };

    const single = await api.loadCanonicalCareerV2(PLAYER, [{ id: LEAGUE, name: 'Harbour', slug: 'harbour' }],
      async () => response(careerPayload(LEAGUE, 'harbour')));
    assert.deepEqual(single.totals.goalie.goalsAgainstAverage, metric(1, 'recorded', ['goalie_stats']));

    const secondLeague = '88888888-8888-4888-8888-888888888888';
    const multi = await api.loadCanonicalCareerV2(PLAYER, [
      { id: LEAGUE, name: 'Harbour', slug: 'harbour' },
      { id: secondLeague, name: 'Valley', slug: 'valley' },
    ], async (url: string) => url.includes('valley.')
      ? response(careerPayload(secondLeague, 'valley', {
        gamesPlayed: metric(null, 'unknown', []), goalsAgainst: metric(null, 'unknown', []),
        goalsAgainstAverage: metric(2, 'recorded', ['goalie_stats']),
      }))
      : response(careerPayload(LEAGUE, 'harbour')));
    assert.equal(multi.totals.goalie.goalsAgainstAverage.value, null);
    assert.equal(multi.totals.goalie.goalsAgainstAverage.state, 'unknown');
  });
});
