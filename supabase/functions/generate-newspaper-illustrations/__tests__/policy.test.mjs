import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_PROJECT_REF,
  assertExpectedSupabaseUrl,
  fetchPlayerPhoto,
  hmacSha256Hex,
  isGatewayVerifiedServiceRole,
  parseIllustrationRequest,
  validatePlayerPhotoUrl,
  verifyHmacSha256Hex,
} from '../policy.ts';

const editionId = '11111111-1111-4111-8111-111111111111';
const generationToken = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';

function jwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.synthetic-signature`;
}

test('accepts only gateway-verified service-role claims for the expected project', () => {
  const service = jwt({ iss: 'supabase', ref: EXPECTED_PROJECT_REF, role: 'service_role' });
  assert.equal(isGatewayVerifiedServiceRole(`Bearer ${service}`), true);
  assert.equal(isGatewayVerifiedServiceRole(null), false);
  assert.equal(isGatewayVerifiedServiceRole('Bearer malformed'), false);
  assert.equal(isGatewayVerifiedServiceRole(`Bearer ${jwt({ iss: 'supabase', ref: EXPECTED_PROJECT_REF, role: 'anon' })}`), false);
  assert.equal(isGatewayVerifiedServiceRole(`Bearer ${jwt({ iss: 'supabase', ref: EXPECTED_PROJECT_REF, role: 'authenticated' })}`), false);
  assert.equal(isGatewayVerifiedServiceRole(`Bearer ${jwt({ iss: 'supabase', ref: 'wrong-project', role: 'service_role' })}`), false);
});

test('server URL must resolve to the approved Supabase project', () => {
  assert.equal(assertExpectedSupabaseUrl(`https://${EXPECTED_PROJECT_REF}.supabase.co`).hostname, `${EXPECTED_PROJECT_REF}.supabase.co`);
  assert.throws(() => assertExpectedSupabaseUrl('https://other-project.supabase.co'), /SUPABASE_PROJECT_MISMATCH/);
  assert.throws(() => assertExpectedSupabaseUrl(`http://${EXPECTED_PROJECT_REF}.supabase.co`), /SUPABASE_PROJECT_MISMATCH/);
});

test('request parser preserves valid literal IDs and rejects malformed, duplicate, or excess IDs', () => {
  const parsed = parseIllustrationRequest({ editionId, generationToken, playerIds: [playerId] });
  assert.deepEqual(parsed, { editionId, generationToken, playerIds: [playerId] });
  assert.throws(() => parseIllustrationRequest({ editionId: 'not-a-uuid', generationToken, playerIds: [playerId] }), /INVALID_REQUEST/);
  assert.throws(() => parseIllustrationRequest({ editionId, generationToken, playerIds: [playerId, playerId] }), /INVALID_REQUEST/);
  assert.throws(() => parseIllustrationRequest({ editionId, generationToken, playerIds: [playerId, editionId, generationToken, '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'] }), /INVALID_REQUEST/);
  assert.throws(() => parseIllustrationRequest({ editionId, generationToken, playerIds: [playerId], prompt: 'caller supplied' }), /INVALID_REQUEST/);
});

test('photo URLs are restricted to public player-avatars objects on approved HTTPS hosts', () => {
  const approved = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/legacy-id/photo.jpg`;
  assert.equal(validatePlayerPhotoUrl(approved).toString(), approved);
  assert.doesNotThrow(() => validatePlayerPhotoUrl('https://auth.beerleaguehockey.ca/storage/v1/object/public/player-avatars/a/player.webp'));
  for (const unsafe of [
    `http://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/a.jpg`,
    'https://127.0.0.1/storage/v1/object/public/player-avatars/a.jpg',
    `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/news-images/a.jpg`,
    `https://user:pass@${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/a.jpg`,
    `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/a.jpg?token=secret`,
  ]) assert.throws(() => validatePlayerPhotoUrl(unsafe), /UNSAFE_PLAYER_PHOTO_URL/);
});

test('photo loader refuses redirects rather than following them', async () => {
  const approved = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/a.jpg`;
  const fakeFetch = async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  };
  await assert.rejects(() => fetchPlayerPhoto(approved, fakeFetch), /PLAYER_PHOTO_REDIRECT/);
});

test('photo loader rejects a MIME header that does not match the bytes', async () => {
  const approved = `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/player-avatars/a.jpg`;
  const fakeFetch = async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  await assert.rejects(() => fetchPlayerPhoto(approved, fakeFetch), /INVALID_PLAYER_PHOTO_MIME/);
});

test('cache provenance HMAC rejects changed metadata and wrong ownership keys', async () => {
  const secret = 'synthetic-service-role-secret';
  const message = '{"playerId":"synthetic-player","sourceHash":"abc"}';
  const signature = await hmacSha256Hex(secret, message);
  assert.equal(await verifyHmacSha256Hex(secret, message, signature), true);
  assert.equal(await verifyHmacSha256Hex(secret, `${message}x`, signature), false);
  assert.equal(await verifyHmacSha256Hex('wrong-synthetic-secret', message, signature), false);
});
