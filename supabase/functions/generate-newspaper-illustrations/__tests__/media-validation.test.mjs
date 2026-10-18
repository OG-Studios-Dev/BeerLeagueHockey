import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  assertMediaBucketConfiguration,
  assertPng1024,
  cachePaths,
  composeIllustrationPrompt,
  immutableMediaPaths,
  promptVersionForComposition,
  sha256Hex,
} from '../policy.ts';
import { syntheticPng1024 } from './png-fixture.mjs';

test('fully decodes a real synthetic 1024x1024 PNG', async () => {
  await assert.doesNotReject(() => assertPng1024(syntheticPng1024(7)));
});

test('rejects truncated, CRC-corrupt, fake-header, and trailing-byte PNGs', async () => {
  const valid = syntheticPng1024(8);
  const corrupt = valid.slice();
  corrupt[50] ^= 0xff;
  const fakeHeader = new Uint8Array(25);
  fakeHeader.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(fakeHeader.buffer).setUint32(16, 1024);
  new DataView(fakeHeader.buffer).setUint32(20, 1024);
  for (const invalid of [valid.slice(0, -1), corrupt, fakeHeader, new Uint8Array([...valid, 0])]) {
    await assert.rejects(() => assertPng1024(invalid), /INVALID_GENERATED_IMAGE/);
  }
});

test('derives private and reserved public paths only from the output hash', async () => {
  const hash = await sha256Hex(syntheticPng1024(9));
  assert.deepEqual(immutableMediaPaths(hash), {
    privatePath: `outputs/v1/${hash}.png`,
    publicPath: `approved/v1/${hash}.png`,
    publicUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${hash}.png`,
  });
  assert.throws(() => immutableMediaPaths('../caller-path'), /INVALID_OUTPUT_HASH/);
});

test('complete composed prompts and explicit v2 versions separate cache bindings while unknown variants fail closed', async () => {
  const base = {
    playerId: '33333333-3333-4333-8333-333333333333',
    sourcePhotoUrlSha256: 'a'.repeat(64),
    sourcePhotoSha256: 'b'.repeat(64),
    model: 'gpt-image-2',
    cacheKeyContextSha256: 'c'.repeat(64),
  };
  const compositionIds = [
    'portrait-three-quarter',
    'stick-over-shoulder',
    'upright-stick',
    'rink-ready-pose',
    'net-and-pucks',
  ];
  const identities = await Promise.all(compositionIds.map(async (compositionId) => {
    const prompt = composeIllustrationPrompt(compositionId);
    return {
      ...base,
      promptVersion: promptVersionForComposition(compositionId),
      promptSha256: await sha256Hex(prompt),
    };
  }));
  const paths = identities.map(cachePaths);
  assert.deepEqual(cachePaths(identities[0]), paths[0]);
  assert.equal(new Set(paths.map((entry) => entry.metadataPath)).size, compositionIds.length);
  assert.equal(new Set(identities.map((identity) => identity.promptSha256)).size, compositionIds.length);
  assert.throws(
    () => cachePaths({ ...identities[0], promptVersion: 'hockey-life-editorial-caricature-v2:caller-choice' }),
    /INVALID_CACHE_IDENTITY/,
  );
});

test('fails the pre-provider storage preflight unless both bucket contracts match exactly', () => {
  const privateBucket = {
    id: 'newspaper-media-private', public: false, file_size_limit: 16 * 1024 * 1024,
    allowed_mime_types: ['image/png', 'application/json'],
  };
  const publicBucket = {
    id: 'newspaper-media-public', public: true, file_size_limit: 16 * 1024 * 1024,
    allowed_mime_types: ['image/png'],
  };
  assert.doesNotThrow(() => assertMediaBucketConfiguration(privateBucket, publicBucket));
  assert.throws(() => assertMediaBucketConfiguration({ ...privateBucket, public: true }, publicBucket), /STORAGE_CONFIGURATION_INVALID/);
  assert.throws(() => assertMediaBucketConfiguration(privateBucket, { ...publicBucket, allowed_mime_types: ['image/png', 'application/json'] }), /STORAGE_CONFIGURATION_INVALID/);
});

test('storage adapter source is private/create-only and contains no legacy bucket writes', () => {
  const source = fs.readFileSync(new URL('../workflow.ts', import.meta.url), 'utf8');
  assert.match(source, /from\(PRIVATE_MEDIA_BUCKET\)\.upload/);
  assert.match(source, /upsert: false/);
  assert.doesNotMatch(source, /news-images/);
  assert.doesNotMatch(source, /upsert: true/);
});
