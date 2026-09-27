import 'server-only';

import { createHash } from 'node:crypto';
import type { EditionShape } from './domain';

export const NEWSPAPER_PRIVATE_MEDIA_BUCKET = 'newspaper-media-private';
export const NEWSPAPER_PUBLIC_MEDIA_BUCKET = 'newspaper-media-public';
export const NEWSPAPER_MEDIA_SIGNED_TTL_SECONDS = 300;
export const NEWSPAPER_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export const NEWSPAPER_MEDIA_HOST = 'ntplczcmhvfkijjxavdl.supabase.co';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PROMPT_VERSION = 'hockey-life-editorial-caricature-v1';
const MODEL = 'gpt-image-2';

interface NewspaperMediaAssetBase {
  playerId: string;
  outputSha256: string;
  outputMime: 'image/png';
  outputBytes: number;
  privatePath: string;
  publicPath: string;
  publicUrl: string;
}

export interface NewspaperGeneratedMediaAsset extends NewspaperMediaAssetBase {
  sourcePhotoSha256: string;
  model: 'gpt-image-2';
  promptVersion: 'hockey-life-editorial-caricature-v1';
}

export interface NewspaperReviewedMediaAsset extends NewspaperMediaAssetBase {
  provenance: 'trusted-reviewed-import-v1';
  sourceArtifactSha256: string;
  decodedPixelSha256: string;
  approvedEditionSha256: string;
  approvedPdfSha256: string;
}

export type NewspaperMediaAsset = NewspaperGeneratedMediaAsset | NewspaperReviewedMediaAsset;

export interface NewspaperIllustration extends NewspaperGeneratedMediaAsset {
  cacheHit: boolean;
}

export interface NewspaperMediaBinding {
  field: string;
  playerId: string;
  gameId: string;
}

export interface NewspaperMediaManifest {
  schemaVersion: 1 | 2;
  assets: NewspaperMediaAsset[];
  bindings?: NewspaperMediaBinding[];
}

export type EditionWithMedia = EditionShape & { media: NewspaperMediaManifest };

export interface MediaStorageAdapter {
  download(bucket: string, path: string): Promise<{ data: Blob | null; error: unknown }>;
  uploadCreateOnly(bucket: string, path: string, data: Blob): Promise<{ error: unknown }>;
  createSignedUrl(bucket: string, path: string, expiresIn: number): Promise<{ data: { signedUrl?: string } | null; error: unknown }>;
}

function expectedPaths(outputSha256: string) {
  return {
    privatePath: `outputs/v1/${outputSha256}.png`,
    publicPath: `approved/v1/${outputSha256}.png`,
    publicUrl: `https://${NEWSPAPER_MEDIA_HOST}/storage/v1/object/public/${NEWSPAPER_PUBLIC_MEDIA_BUCKET}/approved/v1/${outputSha256}.png`,
  };
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function parseAsset(
  value: unknown,
  kind: 'generated' | 'reviewed',
  includeCacheHit: boolean,
): NewspaperIllustration | NewspaperMediaAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Illustration service returned an invalid item.');
  const raw = value as Record<string, unknown>;
  const keys = kind === 'generated'
    ? ['model', 'outputBytes', 'outputMime', 'outputSha256', 'playerId', 'privatePath', 'promptVersion', 'publicPath', 'publicUrl', 'sourcePhotoSha256']
    : ['approvedEditionSha256', 'approvedPdfSha256', 'decodedPixelSha256', 'outputBytes', 'outputMime', 'outputSha256', 'playerId', 'privatePath', 'provenance', 'publicPath', 'publicUrl', 'sourceArtifactSha256'];
  if (includeCacheHit) keys.push('cacheHit');
  assertExactKeys(raw, keys, 'Illustration asset');
  if (typeof raw.playerId !== 'string' || !UUID.test(raw.playerId)) throw new Error('Illustration service returned an invalid player.');
  if (typeof raw.outputSha256 !== 'string' || !SHA256.test(raw.outputSha256)) throw new Error('Illustration service returned an invalid output hash.');
  if (raw.outputMime !== 'image/png' || !Number.isInteger(raw.outputBytes) || Number(raw.outputBytes) < 57 || Number(raw.outputBytes) > NEWSPAPER_MEDIA_MAX_BYTES) {
    throw new Error('Illustration service returned invalid output metadata.');
  }
  if (kind === 'generated') {
    if (typeof raw.sourcePhotoSha256 !== 'string' || !SHA256.test(raw.sourcePhotoSha256)) throw new Error('Illustration service returned an invalid source hash.');
    if (raw.model !== MODEL || raw.promptVersion !== PROMPT_VERSION) throw new Error('Illustration service returned an unsupported generator contract.');
  } else {
    if (raw.provenance !== 'trusted-reviewed-import-v1') throw new Error('Reviewed media has an invalid provenance marker.');
    for (const key of ['sourceArtifactSha256', 'decodedPixelSha256', 'approvedEditionSha256', 'approvedPdfSha256']) {
      if (typeof raw[key] !== 'string' || !SHA256.test(raw[key] as string)) throw new Error(`Reviewed media has an invalid ${key}.`);
    }
  }
  const paths = expectedPaths(raw.outputSha256);
  if (raw.privatePath !== paths.privatePath || raw.publicPath !== paths.publicPath || raw.publicUrl !== paths.publicUrl) {
    throw new Error('Illustration service returned an invalid immutable media mapping.');
  }
  if (includeCacheHit && typeof raw.cacheHit !== 'boolean') throw new Error('Illustration service returned invalid cache metadata.');
  return raw as unknown as NewspaperIllustration | NewspaperMediaAsset;
}

export function decodeIllustrationResponse(value: unknown, requestedPlayerIds: string[]): Map<string, NewspaperIllustration> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Illustration service returned an invalid response.');
  const response = value as Record<string, unknown>;
  assertExactKeys(response, ['illustrations'], 'Illustration response');
  if (!Array.isArray(response.illustrations)) throw new Error('Illustration service returned an invalid response.');
  const requested = new Set(requestedPlayerIds);
  if (requested.size !== requestedPlayerIds.length || requested.size < 1 || requested.size > 4 || [...requested].some((id) => !UUID.test(id))) {
    throw new Error('Newspaper illustration selection must contain one to four distinct players.');
  }
  const decoded = new Map<string, NewspaperIllustration>();
  for (const raw of response.illustrations) {
    const asset = parseAsset(raw, 'generated', true) as NewspaperIllustration;
    if (!requested.has(asset.playerId)) throw new Error('Illustration service returned a foreign player.');
    if (decoded.has(asset.playerId)) throw new Error('Illustration service returned a duplicate player.');
    decoded.set(asset.playerId, asset);
  }
  if (decoded.size !== requested.size || requestedPlayerIds.some((id) => !decoded.has(id))) {
    throw new Error('Illustration service omitted a requested player.');
  }
  return decoded;
}

export function validateMediaManifest(value: unknown): NewspaperMediaManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Edition media manifest is missing.');
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) throw new Error('Edition media manifest is invalid.');
  assertExactKeys(manifest, manifest.schemaVersion === 1 ? ['assets', 'schemaVersion'] : ['assets', 'bindings', 'schemaVersion'], 'Edition media manifest');
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > 4) {
    throw new Error('Edition media manifest is invalid.');
  }
  const assets = manifest.assets.map((asset) => parseAsset(asset, manifest.schemaVersion === 1 ? 'generated' : 'reviewed', false) as NewspaperMediaAsset);
  if (new Set(assets.map((asset) => asset.playerId)).size !== assets.length) throw new Error('Edition media manifest contains duplicate players.');
  if (new Set(assets.map((asset) => asset.outputSha256)).size !== assets.length) throw new Error('Edition media manifest contains duplicate outputs.');
  if (manifest.schemaVersion === 1) return { schemaVersion: 1, assets };
  const reviewed = assets as NewspaperReviewedMediaAsset[];
  if (new Set(reviewed.map((asset) => asset.approvedEditionSha256)).size !== 1 || new Set(reviewed.map((asset) => asset.approvedPdfSha256)).size !== 1) {
    throw new Error('Reviewed media assets are not bound to one approved issue.');
  }
  if (!Array.isArray(manifest.bindings) || manifest.bindings.length < assets.length) throw new Error('Reviewed media bindings are missing.');
  const bindings = manifest.bindings.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reviewed media binding is invalid.');
    const binding = value as Record<string, unknown>;
    assertExactKeys(binding, ['field', 'gameId', 'playerId'], 'Reviewed media binding');
    if (typeof binding.field !== 'string' || !/^(lead\.imageUrl|games\.[0-9a-f-]+\.imageUrl|stars\.[0-9a-f-]+\.illustrationUrl|(hot|cold|aroundRink)\.\d+\.imageUrl)$/.test(binding.field)) throw new Error('Reviewed media binding field is invalid.');
    if (typeof binding.playerId !== 'string' || !UUID.test(binding.playerId) || typeof binding.gameId !== 'string' || !UUID.test(binding.gameId)) throw new Error('Reviewed media binding identity is invalid.');
    return binding as unknown as NewspaperMediaBinding;
  });
  if (new Set(bindings.map((binding) => binding.field)).size !== bindings.length) throw new Error('Reviewed media manifest contains duplicate field bindings.');
  return { schemaVersion: 2, assets, bindings };
}

export function bindIllustrationsToEdition(
  edition: EditionShape,
  illustrationByPlayer: Map<string, NewspaperIllustration>,
): EditionWithMedia {
  const leadPlayer = edition.stars[0];
  if (!leadPlayer || !illustrationByPlayer.has(leadPlayer.playerId)) throw new Error('Lead illustration is not bound to the featured player.');
  const media: NewspaperMediaManifest = {
    schemaVersion: 1,
    assets: [...illustrationByPlayer.values()].map(({ cacheHit: _cacheHit, ...asset }) => asset),
  };
  return {
    ...edition,
    media,
    lead: {
      ...edition.lead,
      imageUrl: illustrationByPlayer.get(leadPlayer.playerId)!.publicUrl,
      caption: `Editorial caricature of ${leadPlayer.name}; statistics are typeset from verified records.`,
    },
    stars: edition.stars.map((star) => {
      const illustration = illustrationByPlayer.get(star.playerId);
      if (!illustration) throw new Error(`Star illustration is missing for ${star.playerId}.`);
      return { ...star, photoUrl: undefined, illustrationUrl: illustration.publicUrl };
    }),
    games: edition.games.map((game) => {
      const featured = game.contributors.find((player) => illustrationByPlayer.has(player.playerId));
      return { ...game, imageUrl: featured ? illustrationByPlayer.get(featured.playerId)!.publicUrl : undefined };
    }),
  };
}

export function assertEditionMediaBinding(edition: EditionShape & { media?: unknown }): NewspaperMediaManifest {
  const manifest = validateMediaManifest(edition.media);
  const byPlayer = new Map(manifest.assets.map((asset) => [asset.playerId, asset]));
  const starIds = [...new Set(edition.stars.map((star) => star.playerId))];
  if (starIds.some((id) => !byPlayer.has(id))) throw new Error('Edition media does not contain every featured star.');
  if (manifest.schemaVersion === 1) {
    if (starIds.length !== manifest.assets.length) throw new Error('Edition media players do not match the featured stars.');
    if (edition.lead.imageUrl !== byPlayer.get(edition.stars[0].playerId)?.publicUrl) throw new Error('Lead media reference is not bound to its approved asset.');
    for (const star of edition.stars) {
      if (star.photoUrl !== undefined || star.illustrationUrl !== byPlayer.get(star.playerId)?.publicUrl) throw new Error('Star media reference is not bound to its approved asset.');
    }
    for (const game of edition.games) {
      const featured = game.contributors.find((player) => byPlayer.has(player.playerId));
      const expected = featured ? byPlayer.get(featured.playerId)!.publicUrl : undefined;
      if (game.imageUrl !== expected) throw new Error('Game media reference is not bound to its approved asset.');
    }
    return manifest;
  }

  const bindings = manifest.bindings || [];
  const bindingByField = new Map(bindings.map((binding) => [binding.field, binding]));
  const actualFields = new Map<string, string>();
  if (edition.lead.imageUrl) actualFields.set('lead.imageUrl', edition.lead.imageUrl);
  for (const game of edition.games) if (game.imageUrl) actualFields.set(`games.${game.gameId}.imageUrl`, game.imageUrl);
  for (const star of edition.stars) {
    if (star.photoUrl !== undefined) throw new Error('Reviewed star source photos must not be persisted.');
    if (star.illustrationUrl) actualFields.set(`stars.${star.playerId}.illustrationUrl`, star.illustrationUrl);
  }
  for (const [section, briefs] of [['hot', edition.hot], ['cold', edition.cold], ['aroundRink', edition.aroundRink || []]] as const) {
    briefs.forEach((brief, index) => {
      if (brief.imageUrl) actualFields.set(`${section}.${index}.imageUrl`, brief.imageUrl);
    });
  }
  if (actualFields.size !== bindings.length || [...actualFields.keys()].some((field) => !bindingByField.has(field))) {
    throw new Error('Every reviewed portrait reference must have exactly one approved binding.');
  }
  const usedPlayers = new Set<string>();
  for (const binding of bindings) {
    const asset = byPlayer.get(binding.playerId);
    const game = edition.games.find((candidate) => candidate.gameId === binding.gameId);
    if (!asset || !game || !game.contributors.some((player) => player.playerId === binding.playerId)) {
      throw new Error('Reviewed media player is not a verified contributor in the bound game.');
    }
    if (actualFields.get(binding.field) !== asset.publicUrl) throw new Error('Reviewed media URL does not match its immutable player asset.');
    if (binding.field.startsWith('games.') && binding.field !== `games.${binding.gameId}.imageUrl`) throw new Error('Game media is bound to the wrong game.');
    if (binding.field.startsWith('stars.') && binding.field !== `stars.${binding.playerId}.illustrationUrl`) throw new Error('Star media is bound to the wrong player.');
    usedPlayers.add(binding.playerId);
  }
  if (bindingByField.get('lead.imageUrl')?.playerId !== edition.stars[0]?.playerId) throw new Error('Lead media is not bound to the first star.');
  for (const star of edition.stars) {
    if (bindingByField.get(`stars.${star.playerId}.illustrationUrl`)?.playerId !== star.playerId) throw new Error('Star media reference is missing its approved binding.');
  }
  if (manifest.assets.some((asset) => !usedPlayers.has(asset.playerId))) throw new Error('Reviewed media manifest contains an unused player asset.');
  return manifest;
}

function replaceBoundUrls(edition: EditionWithMedia, urlsByPlayer: Map<string, string>): EditionWithMedia {
  if (edition.media.schemaVersion === 2) {
    const urlByField = new Map((edition.media.bindings || []).map((binding) => [binding.field, urlsByPlayer.get(binding.playerId)]));
    return {
      ...edition,
      lead: { ...edition.lead, imageUrl: urlByField.get('lead.imageUrl') },
      games: edition.games.map((game) => ({ ...game, imageUrl: urlByField.get(`games.${game.gameId}.imageUrl`) })),
      stars: edition.stars.map((star) => ({ ...star, photoUrl: undefined, illustrationUrl: urlByField.get(`stars.${star.playerId}.illustrationUrl`) })),
      hot: edition.hot.map((brief, index) => ({ ...brief, imageUrl: urlByField.get(`hot.${index}.imageUrl`) })),
      cold: edition.cold.map((brief, index) => ({ ...brief, imageUrl: urlByField.get(`cold.${index}.imageUrl`) })),
      aroundRink: edition.aroundRink?.map((brief, index) => ({ ...brief, imageUrl: urlByField.get(`aroundRink.${index}.imageUrl`) })),
    };
  }
  const byPlayer = new Map(edition.media.assets.map((asset) => [asset.playerId, asset]));
  return {
    ...edition,
    lead: { ...edition.lead, imageUrl: urlsByPlayer.get(edition.stars[0].playerId) },
    stars: edition.stars.map((star) => ({ ...star, illustrationUrl: urlsByPlayer.get(star.playerId) })),
    games: edition.games.map((game) => {
      const featured = game.contributors.find((player) => byPlayer.has(player.playerId));
      return { ...game, imageUrl: featured ? urlsByPlayer.get(featured.playerId) : undefined };
    }),
  };
}

function validateSignedUrl(raw: string, privatePath: string): string {
  const url = new URL(raw);
  const expectedPath = `/storage/v1/object/sign/${NEWSPAPER_PRIVATE_MEDIA_BUCKET}/${privatePath}`;
  if (url.protocol !== 'https:' || url.hostname !== NEWSPAPER_MEDIA_HOST || url.username || url.password || url.hash || url.pathname !== expectedPath || !url.searchParams.has('token')) {
    throw new Error('Private media signer returned an invalid capability URL.');
  }
  return url.toString();
}

export async function hydrateDraftMedia(edition: EditionShape & { media?: unknown }, storage: MediaStorageAdapter): Promise<EditionWithMedia> {
  const manifest = assertEditionMediaBinding(edition);
  const urls = new Map<string, string>();
  for (const asset of manifest.assets) {
    const signed = await storage.createSignedUrl(NEWSPAPER_PRIVATE_MEDIA_BUCKET, asset.privatePath, NEWSPAPER_MEDIA_SIGNED_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error('Private draft artwork could not be signed.');
    urls.set(asset.playerId, validateSignedUrl(signed.data.signedUrl, asset.privatePath));
  }
  return replaceBoundUrls({ ...edition, media: manifest } as EditionWithMedia, urls);
}

function storageErrorIsConflict(error: unknown): boolean {
  const candidate = error as { status?: number; statusCode?: number | string; message?: string } | null;
  return candidate?.status === 409 || String(candidate?.statusCode || '') === '409' || /already exists|duplicate/i.test(candidate?.message || '');
}

async function verifiedBlob(blob: Blob | null, asset: NewspaperMediaAsset, label: string): Promise<Uint8Array> {
  if (!blob || blob.type !== 'image/png' || blob.size !== asset.outputBytes || blob.size > NEWSPAPER_MEDIA_MAX_BYTES) {
    throw new Error(`${label} media object metadata did not match the approved manifest.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.outputSha256) throw new Error(`${label} media object hash did not match the approved manifest.`);
  return bytes;
}

/** Explicit-publish-only, create-only promotion with source and destination readback. */
export async function promoteApprovedMedia(manifest: NewspaperMediaManifest, storage: MediaStorageAdapter): Promise<void> {
  const validated = validateMediaManifest(manifest);
  for (const asset of validated.assets) {
    const source = await storage.download(NEWSPAPER_PRIVATE_MEDIA_BUCKET, asset.privatePath);
    if (source.error) throw new Error('Approved private artwork could not be read.');
    const bytes = await verifiedBlob(source.data, asset, 'Private');
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const upload = await storage.uploadCreateOnly(
      NEWSPAPER_PUBLIC_MEDIA_BUCKET,
      asset.publicPath,
      new Blob([ownedBytes.buffer], { type: 'image/png' }),
    );
    if (upload.error && !storageErrorIsConflict(upload.error)) throw new Error('Approved artwork could not be promoted.');
    const destination = await storage.download(NEWSPAPER_PUBLIC_MEDIA_BUCKET, asset.publicPath);
    if (destination.error) throw new Error('Promoted artwork could not be verified.');
    await verifiedBlob(destination.data, asset, 'Public');
  }
}

export function mediaStorageAdapter(service: any): MediaStorageAdapter {
  return {
    async download(bucket, path) {
      return service.storage.from(bucket).download(path);
    },
    async uploadCreateOnly(bucket, path, data) {
      return service.storage.from(bucket).upload(path, data, {
        contentType: 'image/png', cacheControl: '31536000, immutable', upsert: false,
      });
    },
    async createSignedUrl(bucket, path, expiresIn) {
      return service.storage.from(bucket).createSignedUrl(path, expiresIn);
    },
  };
}
