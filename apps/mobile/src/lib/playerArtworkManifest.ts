export const PLAYER_ARTWORK_MANIFEST_URL = 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/manifest-v1.json';
export const PLAYER_ARTWORK_LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
export const PLAYER_ARTWORK_STYLE_VERSION = 'hl-leader-podium-v1';

const IMAGE_PREFIX = 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/';
export const PLAYER_ARTWORK_MAX_ENTRIES = 500;
export const PLAYER_ARTWORK_MAX_BYTES = 512 * 1024;
export const PLAYER_ARTWORK_TIMEOUT_MS = 4_000;
export const PLAYER_ARTWORK_TTL_MS = 15 * 60 * 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type PlayerArtworkManifestEntry = {
  playerId: string;
  sourcePortraitUrl: string;
  sourcePortraitSha256: string;
  imageUrl: string;
  imageSha256: string;
  width: number;
  height: number;
  approvedAt: string;
};

export type PlayerArtworkManifest = {
  schemaVersion: 1;
  leagueId: typeof PLAYER_ARTWORK_LEAGUE_ID;
  styleVersion: typeof PLAYER_ARTWORK_STYLE_VERSION;
  generatedAt: string;
  entries: PlayerArtworkManifestEntry[];
};

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'body' | 'arrayBuffer'>>;
type LoadOptions = {
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

let cached: { value: PlayerArtworkManifest; expiresAt: number } | null = null;
let inflight: Promise<PlayerArtworkManifest | null> | null = null;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isoUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function publicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parsePlayerArtworkManifest(raw: unknown): PlayerArtworkManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Artwork manifest must be an object');
  const object = raw as Record<string, unknown>;
  if (!exactKeys(object, ['schemaVersion', 'leagueId', 'styleVersion', 'generatedAt', 'entries'])) throw new Error('Artwork manifest fields are invalid');
  if (object.schemaVersion !== 1) throw new Error('Unsupported artwork manifest version');
  if (object.leagueId !== PLAYER_ARTWORK_LEAGUE_ID) throw new Error('Artwork manifest league mismatch');
  if (object.styleVersion !== PLAYER_ARTWORK_STYLE_VERSION) throw new Error('Artwork manifest style mismatch');
  if (!isoUtc(object.generatedAt)) throw new Error('Artwork manifest generatedAt is invalid');
  if (!Array.isArray(object.entries) || object.entries.length > PLAYER_ARTWORK_MAX_ENTRIES) throw new Error('Artwork manifest entry count is invalid');

  const players = new Set<string>();
  const entries = object.entries.map((rawEntry): PlayerArtworkManifestEntry => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) throw new Error('Artwork manifest entry must be an object');
    const entry = rawEntry as Record<string, unknown>;
    if (!exactKeys(entry, ['playerId', 'sourcePortraitUrl', 'sourcePortraitSha256', 'imageUrl', 'imageSha256', 'width', 'height', 'approvedAt'])) throw new Error('Artwork manifest entry fields are invalid');
    if (typeof entry.playerId !== 'string' || !UUID.test(entry.playerId)) throw new Error('Artwork manifest playerId is invalid');
    if (players.has(entry.playerId)) throw new Error('Artwork manifest contains a duplicate player');
    players.add(entry.playerId);
    if (!publicHttpsUrl(entry.sourcePortraitUrl)) throw new Error('Artwork manifest portrait URL is invalid');
    if (typeof entry.sourcePortraitSha256 !== 'string' || !SHA256.test(entry.sourcePortraitSha256)) throw new Error('Artwork manifest portrait hash is invalid');
    if (typeof entry.imageSha256 !== 'string' || !SHA256.test(entry.imageSha256)) throw new Error('Artwork manifest image hash is invalid');
    const expectedImageUrl = `${IMAGE_PREFIX}${entry.playerId}/${entry.imageSha256}.png`;
    if (entry.imageUrl !== expectedImageUrl) throw new Error('Artwork manifest image URL is not canonical');
    const parsedImage = new URL(entry.imageUrl);
    if (parsedImage.search || parsedImage.hash) throw new Error('Artwork manifest image URL must be immutable');
    if (!Number.isInteger(entry.width) || (entry.width as number) < 64 || (entry.width as number) > 4096
      || !Number.isInteger(entry.height) || (entry.height as number) < 64 || (entry.height as number) > 4096) throw new Error('Artwork manifest dimensions are invalid');
    if (!isoUtc(entry.approvedAt)) throw new Error('Artwork manifest approval time is invalid');
    return entry as PlayerArtworkManifestEntry;
  });

  return { ...object, entries } as PlayerArtworkManifest;
}

async function boundedBody(response: Pick<Response, 'headers' | 'body' | 'arrayBuffer'>): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > PLAYER_ARTWORK_MAX_BYTES) throw new Error('Artwork manifest is too large');
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PLAYER_ARTWORK_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Artwork manifest is too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > PLAYER_ARTWORK_MAX_BYTES) throw new Error('Artwork manifest is too large');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function loadPlayerArtworkManifest(options: LoadOptions = {}): Promise<PlayerArtworkManifest | null> {
  const now = options.now ?? Date.now;
  if (!options.fetchImpl && cached && cached.expiresAt > now()) return cached.value;
  if (!options.fetchImpl && inflight) return inflight;
  const request = (async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, options.timeoutMs ?? PLAYER_ARTWORK_TIMEOUT_MS);
    try {
      const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
      const response = await fetchImpl(PLAYER_ARTWORK_MANIFEST_URL, {
        method: 'GET', cache: 'no-cache', headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) return null;
      const manifest = parsePlayerArtworkManifest(JSON.parse(await boundedBody(response)));
      if (!options.fetchImpl) cached = { value: manifest, expiresAt: now() + PLAYER_ARTWORK_TTL_MS };
      return manifest;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  })();
  if (options.fetchImpl) return request;
  inflight = request.finally(() => { inflight = null; });
  return inflight;
}

export function findApprovedPlayerArtwork(manifest: PlayerArtworkManifest | null | undefined, leagueId: string, playerId: string, portraitUrl: string | null) {
  if (!manifest || leagueId !== manifest.leagueId || !portraitUrl) return null;
  return manifest.entries.find((entry) => entry.playerId === playerId && entry.sourcePortraitUrl === portraitUrl) ?? null;
}

export function __resetPlayerArtworkManifestCacheForTests() {
  cached = null;
  inflight = null;
}
