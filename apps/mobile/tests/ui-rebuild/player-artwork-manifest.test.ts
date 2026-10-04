import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLAYER_ARTWORK_LEAGUE_ID,
  PLAYER_ARTWORK_MANIFEST_URL,
  PLAYER_ARTWORK_STYLE_VERSION,
  __resetPlayerArtworkManifestCacheForTests,
  findApprovedPlayerArtwork,
  loadPlayerArtworkManifest,
  parsePlayerArtworkManifest,
} from '../../src/lib/playerArtworkManifest';

const playerId = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const portraitHash = 'b'.repeat(64);
const portraitUrl = 'https://example.test/current.png';
const entry = {
  playerId, sourcePortraitUrl: portraitUrl, sourcePortraitSha256: portraitHash,
  imageUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/${playerId}/${hash}.png`,
  imageSha256: hash, width: 631, height: 1050, approvedAt: '2026-10-04T12:00:00.000Z',
};
const manifest = { schemaVersion: 1, leagueId: PLAYER_ARTWORK_LEAGUE_ID, styleVersion: PLAYER_ARTWORK_STYLE_VERSION, generatedAt: '2026-10-04T12:01:00.000Z', entries: [entry] } as const;

function response(body: string) {
  const bytes = new TextEncoder().encode(body);
  return { ok: true, status: 200, headers: new Headers({ 'content-length': String(bytes.length) }), body: null, arrayBuffer: async () => bytes.buffer };
}

describe('approved player artwork manifest', () => {
  it('accepts only the fixed tenant/version/canonical content-addressed shape and exact portrait identity', () => {
    const parsed = parsePlayerArtworkManifest(manifest);
    assert.equal(findApprovedPlayerArtwork(parsed, PLAYER_ARTWORK_LEAGUE_ID, playerId, portraitUrl)?.imageSha256, hash);
    assert.equal(findApprovedPlayerArtwork(parsed, PLAYER_ARTWORK_LEAGUE_ID, playerId, `${portraitUrl}?changed=1`), null);
    assert.throws(() => parsePlayerArtworkManifest({ ...manifest, schemaVersion: 2 }), /version/);
    assert.throws(() => parsePlayerArtworkManifest({ ...manifest, leagueId: '22222222-2222-4222-8222-222222222222' }), /league/);
    assert.throws(() => parsePlayerArtworkManifest({ ...manifest, entries: [entry, entry] }), /duplicate/);
    assert.throws(() => parsePlayerArtworkManifest({ ...manifest, entries: [{ ...entry, imageUrl: `${entry.imageUrl}?token=surprise` }] }), /canonical/);
  });

  it('uses the strict production URL and fails closed on invalid UTF-8, oversized bodies and timeout/abort', async () => {
    let requested = '';
    const loaded = await loadPlayerArtworkManifest({ fetchImpl: async (url) => { requested = url; return response(JSON.stringify(manifest)); } });
    assert.equal(requested, PLAYER_ARTWORK_MANIFEST_URL);
    assert.equal(loaded?.entries.length, 1);
    const invalid = new Uint8Array([0xff]);
    assert.equal(await loadPlayerArtworkManifest({ fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), body: null, arrayBuffer: async () => invalid.buffer }) }), null);
    assert.equal(await loadPlayerArtworkManifest({ fetchImpl: async () => ({ ...response('{}'), headers: new Headers({ 'content-length': String(600_000) }) }) }), null);
    assert.equal(await loadPlayerArtworkManifest({ timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))) }), null);
  });

  it('enforces the deadline independently of uncooperative transport/body work and rejects late success', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const stuckTransport = loadPlayerArtworkManifest({ timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) });
    assert.equal(await Promise.race([stuckTransport, delay(60).then(() => 'pending')]), null);
    const stuckBody = loadPlayerArtworkManifest({ timeoutMs: 5, fetchImpl: async () => ({
      ...response('{}'), body: { getReader: () => ({ read: async () => new Promise(() => {}), cancel: async () => {} }) } as unknown as Response['body'],
    }) });
    assert.equal(await Promise.race([stuckBody, delay(60).then(() => 'pending')]), null);
    assert.equal(await loadPlayerArtworkManifest({ timeoutMs: 5, fetchImpl: async () => { await delay(25); return response(JSON.stringify(manifest)); } }), null);
  });

  it('keeps a shared refresh viable across the old subscriber abort and releases timed-out global inflight', async () => {
    const originalFetch = globalThis.fetch;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; await delay(20); return response(JSON.stringify(manifest)) as Response; }) as unknown as typeof fetch;
    try {
      __resetPlayerArtworkManifestCacheForTests();
      const old = new AbortController();
      const first = loadPlayerArtworkManifest({ signal: old.signal });
      old.abort();
      const second = loadPlayerArtworkManifest({ signal: new AbortController().signal });
      assert.equal(await first, null);
      assert.equal((await second)?.entries.length, 1);
      assert.equal(calls, 1);

      __resetPlayerArtworkManifestCacheForTests();
      calls = 0;
      globalThis.fetch = (async () => { calls += 1; return calls === 1 ? new Promise(() => {}) : response(JSON.stringify(manifest)) as Response; }) as unknown as typeof fetch;
      assert.equal(await loadPlayerArtworkManifest({ timeoutMs: 5 }), null);
      assert.equal((await loadPlayerArtworkManifest({ timeoutMs: 20 }))?.entries.length, 1);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      __resetPlayerArtworkManifestCacheForTests();
    }
  });
});
