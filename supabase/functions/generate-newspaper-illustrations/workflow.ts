import {
  CARICATURE_PROMPT,
  HOCKEY_LIFE_LEAGUE_ID,
  IMAGE_MODEL,
  MAX_OUTPUT_IMAGE_BYTES,
  OUTPUT_MIME,
  PRIVATE_MEDIA_BUCKET,
  PROMPT_VERSION,
  assertCanonicalWeek,
  assertPng1024,
  cachePaths,
  editionUtcBounds,
  hmacSha256Hex,
  immutableMediaPaths,
  sha256Hex,
  validatePlayerPhotoUrl,
  verifyHmacSha256Hex,
  type IllustrationRequest,
} from './policy.ts';

const MAX_METADATA_BYTES = 64 * 1024;
const CACHE_KEY_CONTEXT_DOMAIN = 'newspaper-illustration-cache-key-context:v1';

interface StoredCacheEnvelope {
  metadata: CacheMetadata;
  bindingHmacSha256: string;
}

function isStorageNotFound(error: unknown): boolean {
  const candidate = error as { status?: number; statusCode?: number | string; message?: string } | null;
  return candidate?.status === 404
    || String(candidate?.statusCode || '') === '404'
    || /not found/i.test(candidate?.message || '');
}

function cacheBindingPayload(paths: { metadataPath: string }, metadata: CacheMetadata): string {
  return JSON.stringify({
    metadataPath: paths.metadataPath,
    schemaVersion: metadata.schemaVersion,
    generator: metadata.generator,
    playerId: metadata.playerId,
    sourcePhotoUrl: metadata.sourcePhotoUrl,
    sourcePhotoUrlSha256: metadata.sourcePhotoUrlSha256,
    sourcePhotoSha256: metadata.sourcePhotoSha256,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    promptSha256: metadata.promptSha256,
    cacheKeyContextSha256: metadata.cacheKeyContextSha256,
    providerRequestId: metadata.providerRequestId,
    outputSha256: metadata.outputSha256,
    outputMime: metadata.outputMime,
    outputBytes: metadata.outputBytes,
    privatePath: metadata.privatePath,
    publicPath: metadata.publicPath,
    publicUrl: metadata.publicUrl,
    createdAt: metadata.createdAt,
  });
}

export interface EditionRow {
  id: string;
  league_id: string;
  season_id: string;
  period_start: string;
  period_end: string;
  status: string;
  generation_token: string | null;
  lease_expires_at: string | null;
  article_id: string | null;
}

export interface GameRow {
  id: string;
  league_id: string;
  season_id: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
}

export interface GoalEventRow {
  game_id: string;
  team_id: string;
  player_id: string | null;
  assist1_player_id: string | null;
  assist2_player_id: string | null;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface CacheMetadata {
  schemaVersion: 2;
  generator: 'generate-newspaper-illustrations';
  playerId: string;
  sourcePhotoUrl: string;
  sourcePhotoUrlSha256: string;
  sourcePhotoSha256: string;
  model: string;
  promptVersion: string;
  promptSha256: string;
  cacheKeyContextSha256: string;
  providerRequestId: string | null;
  outputSha256: string;
  outputMime: 'image/png';
  outputBytes: number;
  privatePath: string;
  publicPath: string;
  publicUrl: string;
  createdAt: string;
}

export interface VerifiedCacheEntry {
  image: Uint8Array;
  metadata: CacheMetadata;
}

export interface Repository {
  cacheKeyContextSha256: string;
  loadEdition(id: string): Promise<EditionRow | null>;
  loadCompletedGames(edition: EditionRow): Promise<GameRow[]>;
  loadGoalEvents(gameIds: string[]): Promise<GoalEventRow[]>;
  loadProfiles(playerIds: string[]): Promise<ProfileRow[]>;
  loadVerifiedCache(paths: { metadataPath: string }, expected: Partial<CacheMetadata>): Promise<VerifiedCacheEntry | null>;
  storeCache(paths: { metadataPath: string }, image: Uint8Array, metadata: CacheMetadata): Promise<void>;
}

export async function makeRepository(supabase: any, cacheSigningKey: string): Promise<Repository> {
  if (!cacheSigningKey) throw new Error('SERVER_CONFIGURATION_MISSING');
  const cacheKeyContextSha256 = await hmacSha256Hex(cacheSigningKey, CACHE_KEY_CONTEXT_DOMAIN);
  return {
    cacheKeyContextSha256,

    async loadEdition(id) {
      const { data, error } = await supabase
        .from('newspaper_editions')
        .select('id, league_id, season_id, period_start, period_end, status, generation_token, lease_expires_at, article_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('EDITION_LOOKUP_FAILED');
      return data as EditionRow | null;
    },

    async loadCompletedGames(edition) {
      const bounds = editionUtcBounds(edition.period_start, edition.period_end);
      const { data, error } = await supabase
        .from('games')
        .select('id, league_id, season_id, status, home_team_id, away_team_id')
        .eq('league_id', edition.league_id)
        .eq('season_id', edition.season_id)
        .eq('status', 'completed')
        .gte('scheduled_at', bounds.fromInclusive)
        .lt('scheduled_at', bounds.toExclusive)
        .order('scheduled_at', { ascending: true });
      if (error) throw new Error('GAME_LOOKUP_FAILED');
      return data || [];
    },

    async loadGoalEvents(gameIds) {
      if (gameIds.length === 0) return [];
      const { data, error } = await supabase
        .from('game_events')
        .select('game_id, team_id, player_id, assist1_player_id, assist2_player_id')
        .in('game_id', gameIds)
        .eq('event_type', 'goal')
        .is('deleted_at', null);
      if (error) throw new Error('GOAL_EVENT_LOOKUP_FAILED');
      return data || [];
    },

    async loadProfiles(playerIds) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', playerIds);
      if (error) throw new Error('PROFILE_LOOKUP_FAILED');
      return data || [];
    },

    async loadVerifiedCache(paths, expected): Promise<VerifiedCacheEntry | null> {
      const metadataDownload = await supabase.storage.from(PRIVATE_MEDIA_BUCKET).download(paths.metadataPath);
      if (metadataDownload.error) {
        if (isStorageNotFound(metadataDownload.error)) return null;
        throw new Error('CACHE_LOOKUP_FAILED');
      }
      if (!metadataDownload.data || metadataDownload.data.size > MAX_METADATA_BYTES) throw new Error('CACHE_METADATA_INVALID');
      let envelope: StoredCacheEnvelope;
      try {
        envelope = JSON.parse(await metadataDownload.data.text()) as StoredCacheEnvelope;
      } catch {
        throw new Error('CACHE_METADATA_INVALID');
      }
      const metadata = envelope?.metadata;
      if (
        !metadata
        || !await verifyHmacSha256Hex(cacheSigningKey, cacheBindingPayload(paths, metadata), envelope.bindingHmacSha256)
        || !cacheMetadataMatches(metadata, expected)
      ) throw new Error('CACHE_BINDING_INVALID');
      validatePlayerPhotoUrl(metadata.sourcePhotoUrl);

      const imageDownload = await supabase.storage.from(PRIVATE_MEDIA_BUCKET).download(metadata.privatePath);
      if (imageDownload.error || !imageDownload.data) throw new Error('CACHE_IMAGE_MISSING');
      if (imageDownload.data.size > MAX_OUTPUT_IMAGE_BYTES) throw new Error('CACHE_IMAGE_INVALID');
      const image = new Uint8Array(await imageDownload.data.arrayBuffer());
      await assertPng1024(image);
      if (await sha256Hex(image) !== metadata.outputSha256 || image.byteLength !== metadata.outputBytes) {
        throw new Error('CACHE_IMAGE_INVALID');
      }
      return { image, metadata };
    },

    async storeCache(paths, image, metadata) {
      const imageUpload = await supabase.storage.from(PRIVATE_MEDIA_BUCKET).upload(
        metadata.privatePath,
        new Blob([new Uint8Array(image).buffer], { type: OUTPUT_MIME }),
        { contentType: OUTPUT_MIME, cacheControl: '31536000', upsert: false },
      );
      if (imageUpload.error && !/already exists|duplicate/i.test(imageUpload.error.message || '')) throw new Error('STORAGE_UPLOAD_FAILED');
      const envelope: StoredCacheEnvelope = {
        metadata,
        bindingHmacSha256: await hmacSha256Hex(cacheSigningKey, cacheBindingPayload(paths, metadata)),
      };
      const metadataUpload = await supabase.storage.from(PRIVATE_MEDIA_BUCKET).upload(
        paths.metadataPath,
        new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
        { contentType: 'application/json', cacheControl: '31536000', upsert: false },
      );
      if (metadataUpload.error && !/already exists|duplicate/i.test(metadataUpload.error.message || '')) throw new Error('STORAGE_UPLOAD_FAILED');
    },
  };
}

export interface Provider {
  generate(input: { image: Uint8Array; mime: string; prompt: string }): Promise<{ image: Uint8Array; requestId: string | null }>;
}

export interface PhotoLoader {
  load(url: string): Promise<{ bytes: Uint8Array; mime: string; url: string }>;
}

export interface IllustrationResult {
  playerId: string;
  sourcePhotoSha256: string;
  outputSha256: string;
  outputMime: 'image/png';
  outputBytes: number;
  privatePath: string;
  publicPath: string;
  publicUrl: string;
  model: 'gpt-image-2';
  promptVersion: string;
  cacheHit: boolean;
}

export interface WorkflowDependencies {
  repository: Repository;
  provider: Provider;
  photos: PhotoLoader;
  now?: () => string;
  concurrency?: number;
  deadlineAt?: number;
}

async function withinDeadline<T>(operation: () => Promise<T>, deadlineAt?: number): Promise<T> {
  if (!deadlineAt) return operation();
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error('GENERATION_DEADLINE_EXCEEDED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('GENERATION_DEADLINE_EXCEEDED')), remaining); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function cacheMetadataMatches(actual: CacheMetadata, expected: Partial<CacheMetadata>): boolean {
  if (
    !actual
    || actual.schemaVersion !== 2
    || actual.generator !== 'generate-newspaper-illustrations'
    || actual.outputMime !== OUTPUT_MIME
    || !/^[0-9a-f]{64}$/.test(actual.sourcePhotoSha256)
    || !/^[0-9a-f]{64}$/.test(actual.sourcePhotoUrlSha256)
    || !/^[0-9a-f]{64}$/.test(actual.promptSha256)
    || !/^[0-9a-f]{64}$/.test(actual.cacheKeyContextSha256)
    || !/^[0-9a-f]{64}$/.test(actual.outputSha256)
    || !Number.isInteger(actual.outputBytes)
    || actual.outputBytes < 1
  ) return false;
  const immutable = immutableMediaPaths(actual.outputSha256);
  if (actual.privatePath !== immutable.privatePath || actual.publicPath !== immutable.publicPath || actual.publicUrl !== immutable.publicUrl) return false;
  return Object.entries(expected).every(([key, value]) => actual[key as keyof CacheMetadata] === value);
}

function assertEditionLease(edition: EditionRow | null, request: IllustrationRequest): asserts edition is EditionRow {
  if (!edition) throw new Error('EDITION_NOT_FOUND');
  if (edition.id !== request.editionId) throw new Error('EDITION_NOT_FOUND');
  if (edition.league_id !== HOCKEY_LIFE_LEAGUE_ID) throw new Error('EDITION_TENANT_MISMATCH');
  if (edition.status !== 'generating' || edition.article_id !== null) throw new Error('STALE_GENERATION_LEASE');
  if (!edition.generation_token || edition.generation_token !== request.generationToken) throw new Error('STALE_GENERATION_LEASE');
  const leaseExpiry = Date.parse(edition.lease_expires_at || '');
  if (!Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now()) throw new Error('STALE_GENERATION_LEASE');
  assertCanonicalWeek(edition.period_start, edition.period_end);
}

function eligibleContributorIds(games: GameRow[], events: GoalEventRow[], edition: EditionRow): Set<string> {
  if (games.length === 0) throw new Error('NO_COMPLETED_GAMES');
  const gameById = new Map<string, GameRow>();
  for (const game of games) {
    if (
      game.league_id !== edition.league_id
      || game.season_id !== edition.season_id
      || game.status !== 'completed'
    ) throw new Error('GAME_SCOPE_MISMATCH');
    gameById.set(game.id, game);
  }
  const eligible = new Set<string>();
  for (const event of events) {
    const game = gameById.get(event.game_id);
    if (!game || (event.team_id !== game.home_team_id && event.team_id !== game.away_team_id)) continue;
    for (const id of [event.player_id, event.assist1_player_id, event.assist2_player_id]) {
      if (id) eligible.add(id.toLowerCase());
    }
  }
  return eligible;
}

async function mapBounded<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const failures: unknown[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failures.length) throw failures[0];
  return results;
}

export async function generateIllustrations(
  request: IllustrationRequest,
  dependencies: WorkflowDependencies,
): Promise<{ illustrations: IllustrationResult[] }> {
  const run = <T>(operation: () => Promise<T>) => withinDeadline(operation, dependencies.deadlineAt);
  const edition = await run(() => dependencies.repository.loadEdition(request.editionId));
  assertEditionLease(edition, request);
  const games = await run(() => dependencies.repository.loadCompletedGames(edition));
  const events = await run(() => dependencies.repository.loadGoalEvents(games.map((game) => game.id)));
  const eligible = eligibleContributorIds(games, events, edition);
  for (const playerId of request.playerIds) {
    if (!eligible.has(playerId.toLowerCase())) throw new Error('PLAYER_NOT_RECORDED_CONTRIBUTOR');
  }

  const profiles = await run(() => dependencies.repository.loadProfiles(request.playerIds));
  const profilesById = new Map(profiles.map((profile) => [profile.id.toLowerCase(), profile]));
  const resolved = request.playerIds.map((playerId) => {
    const profile = profilesById.get(playerId.toLowerCase());
    if (!profile || profile.id.toLowerCase() !== playerId.toLowerCase()) throw new Error('PLAYER_PROFILE_NOT_FOUND');
    if (!profile.full_name?.trim()) throw new Error('PLAYER_NAME_UNRESOLVED');
    if (!profile.avatar_url) throw new Error('PLAYER_PHOTO_UNRESOLVED');
    validatePlayerPhotoUrl(profile.avatar_url);
    return { playerId, profile };
  });

  const promptSha256 = await sha256Hex(CARICATURE_PROMPT);
  const illustrations = await mapBounded(resolved, Math.max(1, Math.min(2, dependencies.concurrency ?? 2)), async ({ playerId, profile }): Promise<IllustrationResult> => {
    const source = await run(() => dependencies.photos.load(profile.avatar_url!));
    const sourcePhotoSha256 = await sha256Hex(source.bytes);
    validatePlayerPhotoUrl(source.url);
    const sourcePhotoUrlSha256 = await sha256Hex(source.url);
    const identity = {
      playerId: profile.id,
      sourcePhotoUrlSha256,
      sourcePhotoSha256,
      model: IMAGE_MODEL,
      promptVersion: PROMPT_VERSION,
      promptSha256,
      cacheKeyContextSha256: dependencies.repository.cacheKeyContextSha256,
    };
    const paths = cachePaths(identity);
    const expected: Partial<CacheMetadata> = {
      schemaVersion: 2,
      generator: 'generate-newspaper-illustrations',
      playerId: profile.id,
      sourcePhotoUrl: source.url,
      sourcePhotoUrlSha256,
      sourcePhotoSha256,
      model: IMAGE_MODEL,
      promptVersion: PROMPT_VERSION,
      promptSha256,
      cacheKeyContextSha256: dependencies.repository.cacheKeyContextSha256,
      outputMime: OUTPUT_MIME,
    };
    const cached = await run(() => dependencies.repository.loadVerifiedCache(paths, expected));
    if (cached) {
      if (!cacheMetadataMatches(cached.metadata, expected)) throw new Error('CACHE_BINDING_INVALID');
      await assertPng1024(cached.image);
      if (await sha256Hex(cached.image) !== cached.metadata.outputSha256) throw new Error('CACHE_BINDING_INVALID');
      return {
        playerId, sourcePhotoSha256, outputSha256: cached.metadata.outputSha256,
        outputMime: OUTPUT_MIME, outputBytes: cached.metadata.outputBytes,
        privatePath: cached.metadata.privatePath, publicPath: cached.metadata.publicPath,
        publicUrl: cached.metadata.publicUrl, model: IMAGE_MODEL,
        promptVersion: PROMPT_VERSION, cacheHit: true,
      };
    }

    const generated = await run(() => dependencies.provider.generate({ image: source.bytes, mime: source.mime, prompt: CARICATURE_PROMPT }));
    if (generated.image.byteLength > 16 * 1024 * 1024) throw new Error('GENERATED_IMAGE_TOO_LARGE');
    await assertPng1024(generated.image);
    const outputSha256 = await sha256Hex(generated.image);
    const immutable = immutableMediaPaths(outputSha256);
    const metadata: CacheMetadata = {
      ...expected as CacheMetadata,
      providerRequestId: generated.requestId,
      outputSha256,
      outputBytes: generated.image.byteLength,
      ...immutable,
      createdAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    };
    await run(() => dependencies.repository.storeCache(paths, generated.image, metadata));
    // A concurrent create-only cache writer may win with different valid bytes.
    // Re-read the immutable winner using the source/prompt binding, never overwrite it.
    const verified = await run(() => dependencies.repository.loadVerifiedCache(paths, expected));
    if (!verified) throw new Error('STORAGE_VALIDATION_FAILED');
    return {
      playerId, sourcePhotoSha256, outputSha256: verified.metadata.outputSha256,
      outputMime: OUTPUT_MIME, outputBytes: verified.metadata.outputBytes,
      privatePath: verified.metadata.privatePath, publicPath: verified.metadata.publicPath,
      publicUrl: verified.metadata.publicUrl, model: IMAGE_MODEL,
      promptVersion: PROMPT_VERSION, cacheHit: false,
    };
  });

  const currentEdition = await run(() => dependencies.repository.loadEdition(request.editionId));
  assertEditionLease(currentEdition, request);
  return { illustrations };
}
