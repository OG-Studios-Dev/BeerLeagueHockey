import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPECTED_PROJECT_REF, HOCKEY_LIFE_LEAGUE_ID } from '../policy.ts';
import { generateIllustrations, makeRepository } from '../workflow.ts';
import { syntheticPng1024 } from './png-fixture.mjs';

const editionId = '11111111-1111-4111-8111-111111111111';
const generationToken = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';
const gameId = '44444444-4444-4444-8444-444444444444';
const homeTeamId = '55555555-5555-4555-8555-555555555555';
const awayTeamId = '66666666-6666-4666-8666-666666666666';
const photoUrlA = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/player/photo-a.jpg`;
const photoUrlB = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/player/photo-b.jpg`;

function inMemorySupabase() {
  const objects = new Map();
  const state = { photoUrl: photoUrlA };
  const rows = {
    newspaper_editions: () => [{
      id: editionId, league_id: HOCKEY_LIFE_LEAGUE_ID,
      season_id: '77777777-7777-4777-8777-777777777777',
      period_start: '2026-09-21', period_end: '2026-09-27', status: 'generating',
      generation_token: generationToken, lease_expires_at: '2099-09-27T12:00:00.000Z', article_id: null,
    }],
    games: () => [{
      id: gameId, league_id: HOCKEY_LIFE_LEAGUE_ID,
      season_id: '77777777-7777-4777-8777-777777777777', status: 'completed',
      home_team_id: homeTeamId, away_team_id: awayTeamId,
    }],
    game_events: () => [{
      game_id: gameId, team_id: homeTeamId, player_id: playerId,
      assist1_player_id: null, assist2_player_id: null,
    }],
    profiles: () => [{ id: playerId, full_name: 'Synthetic Player', avatar_url: state.photoUrl }],
  };
  const from = (table) => {
    const query = {
      select: () => query, eq: () => query, gte: () => query, lt: () => query,
      order: () => query, in: () => query, is: () => query,
      maybeSingle: async () => ({ data: rows[table]()[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows[table](), error: null }),
    };
    return query;
  };
  const storage = {
    from: (bucket) => ({
      download: async (path) => {
        const value = objects.get(`${bucket}/${path}`);
        return value
          ? { data: new Blob([value.bytes], { type: value.contentType }), error: null }
          : { data: null, error: { status: 404, message: 'not found' } };
      },
      upload: async (path, blob, options) => {
        const key = `${bucket}/${path}`;
        if (objects.has(key)) return { data: null, error: { status: 409, message: 'already exists' } };
        objects.set(key, { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: options.contentType });
        return { data: { path }, error: null };
      },
    }),
  };
  return { client: { from, storage }, objects, state };
}

function workflow(repository, state, calls, pauseProvider) {
  return generateIllustrations(
    { editionId, generationToken, playerIds: [playerId] },
    {
      repository,
      photos: { load: async (url) => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mime: 'image/jpeg', url }) },
      provider: {
        generate: async () => {
          calls.provider += 1;
          const generation = calls.provider;
          if (pauseProvider) await pauseProvider();
          return { image: syntheticPng1024(generation), requestId: `request-${generation}` };
        },
      },
      now: () => '2026-09-27T12:00:00.000Z',
    },
  );
}

test('same photo bytes at a relocated validated URL get a new binding once, then reuse it', async () => {
  const store = inMemorySupabase();
  const repository = await makeRepository(store.client, 'synthetic-signing-key-a');
  const calls = { provider: 0 };
  assert.equal((await workflow(repository, store.state, calls)).illustrations[0].cacheHit, false);
  assert.equal((await workflow(repository, store.state, calls)).illustrations[0].cacheHit, true);
  store.state.photoUrl = photoUrlB;
  assert.equal((await workflow(repository, store.state, calls)).illustrations[0].cacheHit, false);
  assert.equal((await workflow(repository, store.state, calls)).illustrations[0].cacheHit, true);
  assert.equal(calls.provider, 2);
  assert.equal([...store.objects.keys()].filter((key) => key.endsWith('/binding.json')).length, 2);
});

test('rotating the signing key gets a new irreversible key-context binding once, then reuses it', async () => {
  const store = inMemorySupabase();
  const calls = { provider: 0 };
  const first = await makeRepository(store.client, 'synthetic-signing-key-a');
  await workflow(first, store.state, calls);
  assert.equal((await workflow(first, store.state, calls)).illustrations[0].cacheHit, true);
  const rotated = await makeRepository(store.client, 'synthetic-signing-key-b');
  assert.equal((await workflow(rotated, store.state, calls)).illustrations[0].cacheHit, false);
  assert.equal((await workflow(rotated, store.state, calls)).illustrations[0].cacheHit, true);
  assert.equal(calls.provider, 2);
  const bindingPaths = [...store.objects.keys()].filter((key) => key.endsWith('/binding.json'));
  assert.equal(bindingPaths.length, 2);
  assert.ok(bindingPaths.every((path) => !path.includes('synthetic-signing-key')));
});

test('an occupied corrupt binding fails before provider work', async () => {
  const store = inMemorySupabase();
  const repository = await makeRepository(store.client, 'synthetic-signing-key-a');
  const calls = { provider: 0 };
  await workflow(repository, store.state, calls);
  const bindingKey = [...store.objects.keys()].find((key) => key.endsWith('/binding.json'));
  const envelope = JSON.parse(new TextDecoder().decode(store.objects.get(bindingKey).bytes));
  envelope.bindingHmacSha256 = '0'.repeat(64);
  store.objects.set(bindingKey, { bytes: new TextEncoder().encode(JSON.stringify(envelope)), contentType: 'application/json' });
  await assert.rejects(() => workflow(repository, store.state, calls), /CACHE_BINDING_INVALID/);
  assert.equal(calls.provider, 1);
});

test('concurrent create-only writers both return the valid immutable winner without overwrite', async () => {
  const store = inMemorySupabase();
  const repository = await makeRepository(store.client, 'synthetic-signing-key-a');
  const calls = { provider: 0 };
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const pauseProvider = async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await barrier;
  };
  const [left, right] = await Promise.all([
    workflow(repository, store.state, calls, pauseProvider),
    workflow(repository, store.state, calls, pauseProvider),
  ]);
  assert.equal(calls.provider, 2);
  assert.equal(left.illustrations[0].outputSha256, right.illustrations[0].outputSha256);
  assert.equal([...store.objects.keys()].filter((key) => key.endsWith('/binding.json')).length, 1);
  assert.equal([...store.objects.keys()].filter((key) => key.includes('/outputs/v1/')).length, 2);
});
