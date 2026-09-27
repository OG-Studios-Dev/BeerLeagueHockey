import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARICATURE_PROMPT,
  EXPECTED_PROJECT_REF,
  HOCKEY_LIFE_LEAGUE_ID,
  IMAGE_MODEL,
  OUTPUT_MIME,
  PROMPT_VERSION,
  sha256Hex,
} from '../policy.ts';
import { generateIllustrations } from '../workflow.ts';
import { syntheticPng1024 } from './png-fixture.mjs';

const editionId = '11111111-1111-4111-8111-111111111111';
const generationToken = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';
const gameId = '44444444-4444-4444-8444-444444444444';
const homeTeamId = '55555555-5555-4555-8555-555555555555';
const awayTeamId = '66666666-6666-4666-8666-666666666666';
const photoUrl = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/legacy-profile-uuid/photo.jpg`;

function fixture(overrides = {}) {
  const calls = { provider: 0, stores: 0, cache: 0 };
  const edition = {
    id: editionId,
    league_id: HOCKEY_LIFE_LEAGUE_ID,
    season_id: '77777777-7777-4777-8777-777777777777',
    period_start: '2026-09-21',
    period_end: '2026-09-27',
    status: 'generating',
    generation_token: generationToken,
    lease_expires_at: '2099-09-27T12:02:00.000Z',
    article_id: null,
    ...overrides.edition,
  };
  const repository = {
    cacheKeyContextSha256: 'c'.repeat(64),
    loadEdition: async () => edition,
    loadCompletedGames: async () => [{
      id: gameId,
      league_id: edition.league_id,
      season_id: edition.season_id,
      status: 'completed',
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
    }],
    loadGoalEvents: async () => [{
      game_id: gameId,
      team_id: homeTeamId,
      player_id: playerId,
      assist1_player_id: null,
      assist2_player_id: null,
    }],
    loadProfiles: async () => [{ id: playerId, full_name: 'Synthetic Player', avatar_url: photoUrl }],
    loadVerifiedCache: async () => null,
    storeCache: async () => { calls.stores += 1; },
    ...overrides.repository,
  };
  const photos = {
    load: async (url) => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mime: 'image/jpeg', url }),
    ...overrides.photos,
  };
  const provider = {
    generate: async ({ prompt }) => {
      calls.provider += 1;
      assert.equal(prompt, CARICATURE_PROMPT);
      return { image: syntheticPng1024(1), requestId: 'synthetic-request' };
    },
    ...overrides.provider,
  };
  return { calls, request: { editionId, generationToken, playerIds: [playerId] }, dependencies: { repository, photos, provider, now: () => '2026-09-27T12:00:00.000Z' } };
}

test('rejects a stale lease before loading player data or calling the provider', async () => {
  const setup = fixture({ edition: { generation_token: '88888888-8888-4888-8888-888888888888' } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /STALE_GENERATION_LEASE/);
  assert.equal(setup.calls.provider, 0);
});

test('rejects an expired lease before loading player data or calling the provider', async () => {
  const setup = fixture({ edition: { lease_expires_at: '2000-01-01T00:00:00.000Z' } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /STALE_GENERATION_LEASE/);
  assert.equal(setup.calls.provider, 0);
});

test('rejects a foreign league even when edition and token IDs are otherwise valid', async () => {
  const setup = fixture({ edition: { league_id: '99999999-9999-4999-8999-999999999999' } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /EDITION_TENANT_MISMATCH/);
  assert.equal(setup.calls.provider, 0);
});

test('rejects a player not recorded as a scorer or assister in an in-scope completed game', async () => {
  const setup = fixture({ repository: { loadGoalEvents: async () => [] } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /PLAYER_NOT_RECORDED_CONTRIBUTOR/);
  assert.equal(setup.calls.provider, 0);
});

test('rejects unresolved profile identity and photo fields', async () => {
  const setup = fixture({ repository: { loadProfiles: async () => [{ id: playerId, full_name: ' ', avatar_url: null }] } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /PLAYER_NAME_UNRESOLVED/);
  assert.equal(setup.calls.provider, 0);
});

test('reuses only a verified content-bound cache entry without provider work', async () => {
  const output = syntheticPng1024(2);
  const setup = fixture();
  const promptSha256 = await sha256Hex(CARICATURE_PROMPT);
  setup.dependencies.repository.loadVerifiedCache = async (_paths, expected) => {
    setup.calls.cache += 1;
    return {
      image: output,
      metadata: {
        schemaVersion: 2,
        generator: 'generate-newspaper-illustrations',
        playerId,
        sourcePhotoUrl: photoUrl,
        sourcePhotoUrlSha256: expected.sourcePhotoUrlSha256,
        sourcePhotoSha256: expected.sourcePhotoSha256,
        model: IMAGE_MODEL,
        promptVersion: PROMPT_VERSION,
        promptSha256,
        cacheKeyContextSha256: expected.cacheKeyContextSha256,
        providerRequestId: 'synthetic-cached-request',
        outputSha256: await sha256Hex(output),
        outputMime: OUTPUT_MIME,
        outputBytes: output.byteLength,
        privatePath: `outputs/v1/${await sha256Hex(output)}.png`,
        publicPath: `approved/v1/${await sha256Hex(output)}.png`,
        publicUrl: `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${await sha256Hex(output)}.png`,
        createdAt: '2026-09-27T11:00:00.000Z',
      },
    };
  };
  const result = await generateIllustrations(setup.request, setup.dependencies);
  assert.equal(result.illustrations[0].cacheHit, true);
  assert.equal(result.illustrations[0].playerId, playerId);
  assert.equal(setup.calls.provider, 0);
  assert.equal(setup.calls.stores, 0);
});

test('fails closed when a cache entry is bound to a different source photo hash', async () => {
  const output = syntheticPng1024(3);
  const setup = fixture();
  setup.dependencies.repository.loadVerifiedCache = async (_paths, expected) => ({
    image: output,
    metadata: {
      schemaVersion: 2,
      generator: 'generate-newspaper-illustrations',
      playerId,
      sourcePhotoUrl: photoUrl,
      sourcePhotoUrlSha256: expected.sourcePhotoUrlSha256,
      sourcePhotoSha256: 'a'.repeat(64),
      model: IMAGE_MODEL,
      promptVersion: PROMPT_VERSION,
      promptSha256: expected.promptSha256,
      cacheKeyContextSha256: expected.cacheKeyContextSha256,
      providerRequestId: 'synthetic-wrong-binding',
      outputSha256: await sha256Hex(output),
      outputMime: OUTPUT_MIME,
      outputBytes: output.byteLength,
      privatePath: `outputs/v1/${await sha256Hex(output)}.png`,
      publicPath: `approved/v1/${await sha256Hex(output)}.png`,
      publicUrl: `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${await sha256Hex(output)}.png`,
      createdAt: '2026-09-27T11:00:00.000Z',
    },
  });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /CACHE_BINDING_INVALID/);
  assert.equal(setup.calls.provider, 0);
});

test('provider failure rejects the batch and never returns the original photo as fake success', async () => {
  const setup = fixture({ provider: { generate: async () => { setup.calls.provider += 1; throw new Error('PROVIDER_REQUEST_FAILED'); } } });
  await assert.rejects(() => generateIllustrations(setup.request, setup.dependencies), /PROVIDER_REQUEST_FAILED/);
  assert.equal(setup.calls.stores, 0);
  assert.equal(setup.calls.provider, 1);
});

test('stores generated output then requires a verified storage readback before success', async () => {
  const setup = fixture();
  let stored = null;
  setup.dependencies.repository.storeCache = async (_paths, image, metadata) => {
    setup.calls.stores += 1;
    stored = { image, metadata };
  };
  setup.dependencies.repository.loadVerifiedCache = async () => stored ? {
    ...stored,
  } : null;
  const result = await generateIllustrations(setup.request, setup.dependencies);
  assert.equal(result.illustrations[0].cacheHit, false);
  assert.equal(result.illustrations[0].model, IMAGE_MODEL);
  assert.equal(setup.calls.provider, 1);
  assert.equal(setup.calls.stores, 1);
  assert.notEqual(result.illustrations[0].publicUrl, photoUrl);
  assert.match(result.illustrations[0].privatePath, new RegExp(result.illustrations[0].outputSha256));
});
