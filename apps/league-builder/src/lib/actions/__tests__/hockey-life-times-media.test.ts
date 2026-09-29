import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

jest.mock('server-only', () => ({}), { virtual: true });

import {
  assertEditionMediaBinding,
  bindIllustrationsToEdition,
  decodeIllustrationResponse,
  hydrateDraftMedia,
  promoteApprovedMedia,
  type MediaStorageAdapter,
  type NewspaperIllustration,
  type NewspaperReviewedMediaAsset,
} from '../../hockey-life-times/media';

const playerId = '33333333-3333-4333-8333-333333333333';
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(64).fill(7)]);
const outputSha256 = createHash('sha256').update(bytes).digest('hex');
const publicUrl = `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${outputSha256}.png`;
const illustration: NewspaperIllustration = {
  playerId,
  sourcePhotoSha256: 'a'.repeat(64),
  outputSha256,
  outputMime: 'image/png',
  outputBytes: bytes.byteLength,
  privatePath: `outputs/v1/${outputSha256}.png`,
  publicPath: `approved/v1/${outputSha256}.png`,
  publicUrl,
  model: 'gpt-image-2',
  promptVersion: 'hockey-life-editorial-caricature-v1',
  cacheHit: false,
};

function edition() {
  return {
    lead: { headline: 'Lead', dek: 'Dek', body: ['Body'] },
    stars: [{ playerId, name: 'Synthetic Player', teamName: 'Home', goals: 1, assists: 0, points: 1, reason: 'Verified.', photoUrl: 'https://source.invalid/photo.jpg' }],
    games: [{ contributors: [{ playerId, name: 'Synthetic Player', teamName: 'Home', goals: 1, assists: 0, points: 1 }] }],
  } as any;
}

function storage(overrides: Partial<MediaStorageAdapter> = {}): MediaStorageAdapter {
  return {
    download: jest.fn(async () => ({ data: new Blob([bytes], { type: 'image/png' }), error: null })),
    uploadCreateOnly: jest.fn(async () => ({ error: null })),
    createSignedUrl: jest.fn(async (_bucket, path) => ({
      data: { signedUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/sign/newspaper-media-private/${path}?token=synthetic` },
      error: null,
    })),
    ...overrides,
  };
}

describe('Hockey Life Times immutable media contract', () => {
  it('keeps promotion inside Publish after full validation/version binding and before the atomic RPC', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../hockey-life-times.ts'), 'utf8');
    const publishStart = source.indexOf('export async function publishHockeyLifeTimesEdition');
    const fullValidation = source.indexOf('validateNewspaperEdition(edition)', publishStart);
    const versionBinding = source.indexOf('input.expectedVersion !== row.version', publishStart);
    const rowBinding = source.indexOf('edition.periodStart !== row.period_start', publishStart);
    const promotion = source.indexOf('promoteApprovedMedia(manifest', publishStart);
    const atomicPublish = source.indexOf("'publish_newspaper_edition'", publishStart);
    expect(fullValidation).toBeGreaterThan(publishStart);
    expect(versionBinding).toBeGreaterThan(publishStart);
    expect(rowBinding).toBeGreaterThan(versionBinding);
    expect(promotion).toBeGreaterThan(fullValidation);
    expect(atomicPublish).toBeGreaterThan(promotion);
  });

  it('strictly decodes hash-derived private/public mappings and rejects caller paths', () => {
    const decoded = decodeIllustrationResponse({ illustrations: [illustration] }, [playerId]);
    expect(decoded.get(playerId)).toEqual(illustration);
    expect(() => decodeIllustrationResponse({ illustrations: [{ ...illustration, publicPath: 'caller/chosen.png' }] }, [playerId])).toThrow(/mapping/i);
    expect(() => decodeIllustrationResponse({ illustrations: [{ ...illustration, signedUrl: 'secret' }] }, [playerId])).toThrow(/unexpected fields/i);
  });

  it('persists only reserved stable URLs and a typed private manifest', () => {
    const bound = bindIllustrationsToEdition(edition(), new Map([[playerId, illustration]]));
    expect(bound.lead.imageUrl).toBe(publicUrl);
    expect(bound.media.assets[0]).not.toHaveProperty('cacheHit');
    expect(bound.media.assets[0].privatePath).toContain(outputSha256);
    expect(assertEditionMediaBinding(bound)).toEqual(bound.media);
  });

  it('hydrates draft fields with short-lived signed private URLs without changing the persisted manifest', async () => {
    const bound = bindIllustrationsToEdition(edition(), new Map([[playerId, illustration]]));
    const adapter = storage();
    const hydrated = await hydrateDraftMedia(bound, adapter);
    expect(hydrated.lead.imageUrl).toContain('/object/sign/newspaper-media-private/');
    expect(hydrated.stars[0].illustrationUrl).toContain('token=synthetic');
    expect(hydrated.media).toEqual(bound.media);
    expect(adapter.createSignedUrl).toHaveBeenCalledWith('newspaper-media-private', illustration.privatePath, 300);
  });

  it('promotes exact private bytes create-only and verifies public readback', async () => {
    const bound = bindIllustrationsToEdition(edition(), new Map([[playerId, illustration]]));
    const adapter = storage();
    await expect(promoteApprovedMedia(bound.media, adapter)).resolves.toBeUndefined();
    expect(adapter.uploadCreateOnly).toHaveBeenCalledWith(
      'newspaper-media-public',
      illustration.publicPath,
      expect.any(Blob),
    );
    expect(adapter.download).toHaveBeenNthCalledWith(1, 'newspaper-media-private', illustration.privatePath);
    expect(adapter.download).toHaveBeenNthCalledWith(2, 'newspaper-media-public', illustration.publicPath);
  });

  it('reuses an existing same-hash destination only after readback and rejects mismatched bytes', async () => {
    const bound = bindIllustrationsToEdition(edition(), new Map([[playerId, illustration]]));
    const good = storage({ uploadCreateOnly: jest.fn(async () => ({ error: { statusCode: '409', message: 'Already exists' } })) });
    await expect(promoteApprovedMedia(bound.media, good)).resolves.toBeUndefined();

    let downloads = 0;
    const bad = storage({
      uploadCreateOnly: jest.fn(async () => ({ error: { statusCode: '409', message: 'Already exists' } })),
      download: jest.fn(async () => {
        downloads += 1;
        return downloads === 1
          ? { data: new Blob([bytes], { type: 'image/png' }), error: null }
          : { data: new Blob([new Uint8Array(bytes.length)], { type: 'image/png' }), error: null };
      }),
    });
    await expect(promoteApprovedMedia(bound.media, bad)).rejects.toThrow(/hash/i);
  });

  it('accepts a fourth reviewed non-star only when every placement is bound to a game contributor', async () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const gameIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const reviewedAssets: NewspaperReviewedMediaAsset[] = ids.map((id, index) => {
      const digest = String(index + 1).repeat(64);
      return {
        playerId: id,
        outputSha256: digest,
        outputMime: 'image/png',
        outputBytes: 1024,
        privatePath: `outputs/v1/${digest}.png`,
        publicPath: `approved/v1/${digest}.png`,
        publicUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/newspaper-media-public/approved/v1/${digest}.png`,
        provenance: 'trusted-reviewed-import-v1',
        sourceArtifactSha256: 'a'.repeat(64),
        decodedPixelSha256: 'b'.repeat(64),
        approvedEditionSha256: 'c'.repeat(64),
        approvedPdfSha256: 'd'.repeat(64),
      };
    });
    const reviewed = {
      lead: { imageUrl: reviewedAssets[0].publicUrl },
      games: [
        { gameId: gameIds[0], imageUrl: reviewedAssets[0].publicUrl, contributors: ids.slice(0, 2).map((id) => ({ playerId: id })) },
        { gameId: gameIds[1], imageUrl: reviewedAssets[2].publicUrl, contributors: ids.slice(2).map((id) => ({ playerId: id })) },
      ],
      stars: ids.slice(0, 3).map((id, index) => ({ playerId: id, illustrationUrl: reviewedAssets[index].publicUrl })),
      hot: reviewedAssets.map((asset) => ({ imageUrl: asset.publicUrl })).slice(0, 2).concat([{ imageUrl: reviewedAssets[3].publicUrl }]),
      cold: [],
      media: {
        schemaVersion: 2,
        assets: reviewedAssets,
        bindings: [
          { field: 'lead.imageUrl', playerId: ids[0], gameId: gameIds[0] },
          { field: `games.${gameIds[0]}.imageUrl`, playerId: ids[0], gameId: gameIds[0] },
          { field: `games.${gameIds[1]}.imageUrl`, playerId: ids[2], gameId: gameIds[1] },
          ...ids.slice(0, 3).map((id, index) => ({ field: `stars.${id}.illustrationUrl`, playerId: id, gameId: index < 2 ? gameIds[0] : gameIds[1] })),
          { field: 'hot.0.imageUrl', playerId: ids[0], gameId: gameIds[0] },
          { field: 'hot.1.imageUrl', playerId: ids[1], gameId: gameIds[0] },
          { field: 'hot.2.imageUrl', playerId: ids[3], gameId: gameIds[1] },
        ],
      },
    } as any;
    expect(assertEditionMediaBinding(reviewed)).toEqual(reviewed.media);
    const adapter = storage({ createSignedUrl: jest.fn(async (_bucket, assetPath) => ({ data: { signedUrl: `https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/sign/newspaper-media-private/${assetPath}?token=synthetic` }, error: null })) });
    const hydrated = await hydrateDraftMedia(reviewed, adapter);
    expect(hydrated.hot[2].imageUrl).toContain('/object/sign/newspaper-media-private/');

    const wrongGame = structuredClone(reviewed);
    wrongGame.media.bindings.find((binding: any) => binding.playerId === ids[3]).gameId = gameIds[0];
    expect(() => assertEditionMediaBinding(wrongGame)).toThrow(/verified contributor/i);

    const unused = structuredClone(reviewed);
    unused.hot[2].imageUrl = reviewedAssets[0].publicUrl;
    const extraBinding = unused.media.bindings.find((binding: any) => binding.field === 'hot.2.imageUrl');
    extraBinding.playerId = ids[0];
    extraBinding.gameId = gameIds[0];
    expect(() => assertEditionMediaBinding(unused)).toThrow(/unused player/i);

    const arbitrary = structuredClone(reviewed);
    arbitrary.cold.push({ imageUrl: 'https://example.invalid/unbound.png' });
    expect(() => assertEditionMediaBinding(arbitrary)).toThrow(/exactly one approved binding/i);
  });
});
