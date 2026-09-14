import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getLeaguePage } from '../../src/lib/leaguePages.ts';

const ids = {
  league: '11111111-1111-4111-8111-111111111111',
  season: '22222222-2222-4222-8222-222222222222',
  division: '33333333-3333-4333-8333-333333333333',
  team: '44444444-4444-4444-8444-444444444444',
};

function teamsPayload() {
  // SIMULATED semantic fixture: shaped like the binding public endpoint, never production data.
  return {
    schemaVersion: 1,
    page: 'teams',
    league: { id: ids.league, slug: 'hockey-life', name: 'Hockey Life' },
    seasons: [{ id: ids.season, name: 'Summer 2026', status: 'active' }],
    selectedSeason: { id: ids.season, name: 'Summer 2026', status: 'active' },
    divisions: [{ id: ids.division, name: 'North' }],
    teams: [{
      id: ids.team, name: 'Ice Owls', slug: 'ice-owls', logoUrl: null,
      divisionId: ids.division, divisionName: 'North', primaryColor: '#22D3EE',
    }],
    positioning: null,
  } as const;
}

function playersPayload() {
  const { positioning: _positioning, ...base } = teamsPayload();
  return {
    ...base,
    page: 'players',
    players: [{
      id: '77777777-7777-4777-8777-777777777777', fullName: 'Casey Zero', photoUrl: null,
      jerseyNumber: 0, position: null, leadershipRole: 'captain', teamId: ids.team,
      teamName: 'Ice Owls', teamSlug: 'ice-owls', teamLogoUrl: null, divisionId: ids.division,
    }],
  } as const;
}

function playoffsPayload() {
  const { positioning: _positioning, ...base } = teamsPayload();
  return {
    ...base,
    page: 'playoffs',
    series: [{
      id: '88888888-8888-4888-8888-888888888888', divisionId: ids.division, divisionName: 'North',
      roundNumber: 1, seriesNumber: 1, highSeed: { id: ids.team, name: 'Ice Owls', logoUrl: null }, lowSeed: null,
      highSeedWins: 0, lowSeedWins: 0, winnerId: null, status: 'scheduled', nextGame: null,
    }],
    standings: [{ teamId: ids.team, teamName: 'Ice Owls', logoUrl: null, points: 4, divisionId: ids.division, divisionName: 'North' }],
    previewConfig: { playoffTeamsTotal: 4, playoffTeamsPerDivision: null, useDivisionPlayoffs: false },
  } as const;
}

describe('public league-pages client', () => {
  it('accepts exactly the server byte budget and rejects a body one byte over it', async () => {
    const limit = 512 * 1024;
    const json = JSON.stringify(teamsPayload());
    const atLimit = json + ' '.repeat(limit - Buffer.byteLength(json, 'utf8'));
    const response = (body: string) => async () => ({ ok: true, status: 200, text: async () => body });
    assert.equal((await getLeaguePage('hockey-life', 'teams', null, response(atLimit))).teams.length, 1);
    await assert.rejects(getLeaguePage('hockey-life', 'teams', null, response(atLimit + ' ')), /payload exceeds byte limit/);
  });

  it('enforces UTF-8 bytes when the native runtime has no TextEncoder', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: undefined });
    try {
      // Synthetic oversized transport body: reject on bytes before attempting JSON decoding.
      await assert.rejects(getLeaguePage('hockey-life', 'teams', null, async () => ({
        ok: true, status: 200, text: async () => '🏒'.repeat(140_000),
      })), /payload exceeds byte limit/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'TextEncoder', descriptor);
      else Reflect.deleteProperty(globalThis, 'TextEncoder');
    }
  });

  it('uses the stable public API contract and decodes a tenant-season response', async () => {
    let requestUrl = '';
    const result = await getLeaguePage('hockey-life', 'teams', ids.season, async (url) => {
      requestUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify(teamsPayload()) };
    });

    assert.equal(
      requestUrl,
      `https://api.beerleaguehockey.ca/api/public/league-pages?leagueSlug=hockey-life&page=teams&seasonId=${ids.season}`,
    );
    assert.equal(result.page, 'teams');
    assert.equal(result.selectedSeason?.id, ids.season);
    assert.equal(result.teams[0]?.name, 'Ice Owls');
  });

  it('fails closed on season identity, cross-division references and endpoint errors', async () => {
    const otherSeason = '55555555-5555-4555-8555-555555555555';
    await assert.rejects(
      getLeaguePage('hockey-life', 'teams', otherSeason, async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(teamsPayload()),
      })),
      /season identity mismatch/i,
    );

    const badDivision = structuredClone(teamsPayload()) as unknown as { teams: Array<{ divisionId: string }> };
    badDivision.teams[0].divisionId = '66666666-6666-4666-8666-666666666666';
    await assert.rejects(
      getLeaguePage('hockey-life', 'teams', ids.season, async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(badDivision),
      })),
      /unknown division/i,
    );

    await assert.rejects(
      getLeaguePage('hockey-life', 'teams', null, async () => ({
        ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 'unavailable', message: 'Public directory unavailable' } }),
      })),
      /Public directory unavailable/,
    );
  });

  it('decodes simulated seasonal membership rows and rejects mismatched canonical team metadata', async () => {
    const decoded = await getLeaguePage('hockey-life', 'players', ids.season, async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(playersPayload()),
    }));
    assert.equal(decoded.players[0]?.jerseyNumber, 0);
    assert.equal(decoded.players[0]?.position, null);

    const mismatched = structuredClone(playersPayload()) as unknown as { players: Array<{ teamName: string }> };
    mismatched.players[0].teamName = 'Wrong Tenant Team';
    await assert.rejects(
      getLeaguePage('hockey-life', 'players', ids.season, async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(mismatched),
      })),
      /team metadata mismatch/i,
    );
  });

  it('decodes simulated official/preview facts and rejects cross-tenant series participants', async () => {
    const decoded = await getLeaguePage('hockey-life', 'playoffs', ids.season, async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(playoffsPayload()),
    }));
    assert.equal(decoded.series[0]?.highSeed?.name, 'Ice Owls');
    assert.equal(decoded.series[0]?.lowSeed, null);
    assert.equal(decoded.standings[0]?.points, 4);

    const crossTenant = structuredClone(playoffsPayload()) as unknown as { series: Array<{ highSeed: { id: string } }> };
    crossTenant.series[0].highSeed.id = '99999999-9999-4999-8999-999999999999';
    await assert.rejects(
      getLeaguePage('hockey-life', 'playoffs', ids.season, async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(crossTenant),
      })),
      /unknown team/i,
    );
  });
});
