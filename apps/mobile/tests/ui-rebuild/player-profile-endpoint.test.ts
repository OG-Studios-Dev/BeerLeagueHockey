import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOCKEY_LIFE_ID, HOCKEY_LIFE_SLUG } from '../../src/config/hockeyLife.ts';
import {
  decodeHockeyLifePlayerProfileEnvelope,
  loadHockeyLifePlayerPage,
} from '../../src/lib/supabase/playerPage.ts';

const PROFILE_ID = 'add94b26-b344-459f-9727-8cddae9783de';
const ROSTER_ID = '751c2f47-f0e8-4506-b10e-b39a7bbcd302';
const SEASON_ID = '145ac7ee-99fb-4a50-a0b5-37f24e9991f3';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    league: { id: HOCKEY_LIFE_ID, slug: HOCKEY_LIFE_SLUG },
    data: {
      playerId: PROFILE_ID,
      rosterId: ROSTER_ID,
      fullName: 'Public Fixture Player',
      photoUrl: 'https://example.com/player.png',
      position: 'Forward',
      leadershipRole: 'captain',
      jerseyNumber: 36,
      isGoalie: false,
      team: { id: '093f611c-0cdc-4509-afde-9c661b5833c9', name: 'Fixture Team', slug: 'fixture-team', logoUrl: null, primaryColor: '#7026D9' },
      seasons: [{ id: SEASON_ID, name: 'Fall 2026', start_date: '2026-09-01', status: 'active' }],
      selectedSeasonId: SEASON_ID,
      selectedSeasonName: 'Fall 2026',
      isCareer: false,
      metrics: { games_played: 0, goals: 0, assists: 0, points: 0, penalty_minutes: null, plus_minus: null },
      careerRows: [{ seasonId: SEASON_ID, seasonName: 'Fall 2026', teamId: null, teamName: null, metrics: { goals: 0, points: 0 } }],
      badges: [],
      games: [],
      matchups: [],
      articles: [],
      heroAwards: [{ key: 'championships', label: 'Championships', count: 2, imageUrl: 'https://example.com/trophy.png' }],
      aggregateOnly: false,
      hotFacts: [],
      ...overrides,
    },
  };
}

describe('public player profile endpoint boundary', () => {
  it('decodes a versioned, fixed-tenant payload while preserving verified zero and unknown null', () => {
    const page = decodeHockeyLifePlayerProfileEnvelope(envelope(), PROFILE_ID, SEASON_ID);
    assert.equal(page.playerId, PROFILE_ID);
    assert.equal(page.metrics?.games_played, 0);
    assert.equal(page.metrics?.penalty_minutes, null);
    assert.equal(page.heroAwards[0]?.imageUrl, 'https://example.com/trophy.png');
    const noOperationalSeason = decodeHockeyLifePlayerProfileEnvelope(envelope({ selectedSeasonId: null, selectedSeasonName: null, isCareer: false, metrics: null }), PROFILE_ID);
    assert.equal(noOperationalSeason.isCareer, false);
    assert.equal(noOperationalSeason.selectedSeasonId, null);
  });

  it('rejects tenant, identity, selected-season, numeric, null, and media violations', () => {
    assert.throws(() => decodeHockeyLifePlayerProfileEnvelope({ ...envelope(), league: { id: PROFILE_ID, slug: 'other' } }, PROFILE_ID, SEASON_ID), /league/i);
    assert.throws(() => decodeHockeyLifePlayerProfileEnvelope(envelope({ playerId: ROSTER_ID }), PROFILE_ID, SEASON_ID), /identity/i);
    assert.throws(() => decodeHockeyLifePlayerProfileEnvelope(envelope({ selectedSeasonId: ROSTER_ID }), PROFILE_ID, SEASON_ID), /season/i);
    assert.throws(() => decodeHockeyLifePlayerProfileEnvelope(envelope({ jerseyNumber: '36' }), PROFILE_ID, SEASON_ID), /number/i);
    assert.throws(() => decodeHockeyLifePlayerProfileEnvelope(envelope({ photoUrl: 'javascript:alert(1)' }), PROFILE_ID, SEASON_ID), /media/i);
  });

  it('uses the canonical credential-free URL and distinguishes a good zero payload from 404 and failure', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const goodFetch = async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(envelope()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const page = await loadHockeyLifePlayerPage(PROFILE_ID, SEASON_ID, { fetchImpl: goodFetch, timeoutMs: 100 });
    assert.equal(page?.metrics?.games_played, 0);
    assert.equal(calls[0]?.url, `https://hockey-life.beerleaguehockey.ca/api/mobile/player-profile?playerId=${PROFILE_ID}&season=${SEASON_ID}`);
    assert.equal(calls[0]?.init?.credentials, 'omit');
    assert.deepEqual(calls[0]?.init?.headers, { Accept: 'application/json' });

    const missing = await loadHockeyLifePlayerPage(ROSTER_ID, null, {
      fetchImpl: async () => new Response('{"error":"not found"}', { status: 404 }), timeoutMs: 100,
    });
    assert.equal(missing, null);
    await assert.rejects(loadHockeyLifePlayerPage(PROFILE_ID, undefined, {
      fetchImpl: async () => new Response('{"error":"upstream"}', { status: 503 }), timeoutMs: 100,
    }), /503/);
  });

  it('rejects malformed input, oversized bodies, and requests that exceed the timeout', async () => {
    let called = false;
    await assert.rejects(loadHockeyLifePlayerPage('not-a-uuid', undefined, {
      fetchImpl: async () => { called = true; return new Response('{}'); }, timeoutMs: 100,
    }), /UUID/i);
    assert.equal(called, false);

    await assert.rejects(loadHockeyLifePlayerPage(PROFILE_ID, undefined, {
      fetchImpl: async () => new Response('x'.repeat(600_000)), timeoutMs: 100,
    }), /body/i);

    const hangingFetch = async (_input: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    await assert.rejects(loadHockeyLifePlayerPage(PROFILE_ID, undefined, { fetchImpl: hangingFetch, timeoutMs: 5 }), /timed out/i);
  });
});
