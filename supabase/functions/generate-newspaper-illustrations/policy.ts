export const EXPECTED_PROJECT_REF = 'ntplczcmhvfkijjxavdl';
export const HOCKEY_LIFE_LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
export const IMAGE_MODEL = 'gpt-image-2';
export const PROMPT_VERSION = 'hockey-life-editorial-caricature-v1';
export const IMAGE_SIZE = '1024x1024';
export const IMAGE_QUALITY = 'high';
export const OUTPUT_MIME = 'image/png';
export const MAX_PLAYERS = 4;
export const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_IMAGE_BYTES = 16 * 1024 * 1024;
export const PRIVATE_MEDIA_BUCKET = 'newspaper-media-private';
export const PUBLIC_MEDIA_BUCKET = 'newspaper-media-public';
export const CACHE_PREFIX = 'cache/v2';
export const PRIVATE_OUTPUT_PREFIX = 'outputs/v1';
export const PUBLIC_OUTPUT_PREFIX = 'approved/v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface IllustrationRequest {
  editionId: string;
  generationToken: string;
  playerIds: string[];
}

export interface GatewayClaims {
  iss?: unknown;
  ref?: unknown;
  role?: unknown;
}

export interface StorageBucketConfiguration {
  id?: unknown;
  public?: unknown;
  file_size_limit?: unknown;
  allowed_mime_types?: unknown;
}

export function assertMediaBucketConfiguration(
  privateBucket: StorageBucketConfiguration,
  publicBucket: StorageBucketConfiguration,
): void {
  const privateMime = Array.isArray(privateBucket.allowed_mime_types) ? [...privateBucket.allowed_mime_types].sort() : [];
  const publicMime = Array.isArray(publicBucket.allowed_mime_types) ? [...publicBucket.allowed_mime_types].sort() : [];
  if (
    privateBucket.id !== PRIVATE_MEDIA_BUCKET
    || privateBucket.public !== false
    || privateBucket.file_size_limit !== MAX_OUTPUT_IMAGE_BYTES
    || privateMime.join(',') !== ['application/json', 'image/png'].join(',')
    || publicBucket.id !== PUBLIC_MEDIA_BUCKET
    || publicBucket.public !== true
    || publicBucket.file_size_limit !== MAX_OUTPUT_IMAGE_BYTES
    || publicMime.join(',') !== 'image/png'
  ) throw new Error('STORAGE_CONFIGURATION_INVALID');
}

function decodeJwtClaims(token: string): GatewayClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as GatewayClaims;
  } catch {
    return null;
  }
}

/** Claims are inspected only after the Supabase gateway has verified the JWT. */
export function isGatewayVerifiedServiceRole(
  authorization: string | null,
  expectedProjectRef = EXPECTED_PROJECT_REF,
): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice('Bearer '.length);
  if (!token || token.trim() !== token) return false;
  const claims = decodeJwtClaims(token);
  return claims?.iss === 'supabase'
    && claims.ref === expectedProjectRef
    && claims.role === 'service_role';
}

export function assertExpectedSupabaseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_PROJECT_MISMATCH');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`
    || url.username
    || url.password
    || (url.port && url.port !== '443')
  ) throw new Error('SUPABASE_PROJECT_MISMATCH');
  return url;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseIllustrationRequest(value: unknown): IllustrationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['editionId', 'generationToken', 'playerIds']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error('INVALID_REQUEST');
  if (!isUuid(record.editionId) || !isUuid(record.generationToken)) throw new Error('INVALID_REQUEST');
  if (!Array.isArray(record.playerIds) || record.playerIds.length < 1 || record.playerIds.length > MAX_PLAYERS) {
    throw new Error('INVALID_REQUEST');
  }
  if (!record.playerIds.every(isUuid)) throw new Error('INVALID_REQUEST');
  const semanticIds = new Set(record.playerIds.map((id) => id.toLowerCase()));
  if (semanticIds.size !== record.playerIds.length) throw new Error('INVALID_REQUEST');
  return {
    editionId: record.editionId,
    generationToken: record.generationToken,
    playerIds: [...record.playerIds],
  };
}

export function assertCanonicalWeek(periodStart: string, periodEnd: string): void {
  if (!ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd)) throw new Error('INVALID_EDITION_SCOPE');
  const start = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== periodStart
    || end.toISOString().slice(0, 10) !== periodEnd
    || start.getUTCDay() !== 1
  ) throw new Error('INVALID_EDITION_SCOPE');
  start.setUTCDate(start.getUTCDate() + 6);
  if (start.toISOString().slice(0, 10) !== periodEnd) throw new Error('INVALID_EDITION_SCOPE');
}

function zonedDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

export function torontoMidnightUtc(localDate: string): string {
  if (!ISO_DATE.test(localDate)) throw new Error('INVALID_EDITION_SCOPE');
  const [year, month, day] = localDate.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedDateParts(new Date(guess));
    const displayedAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desired - displayedAsUtc;
  }
  return new Date(guess).toISOString();
}

export function editionUtcBounds(periodStart: string, periodEnd: string) {
  assertCanonicalWeek(periodStart, periodEnd);
  const next = new Date(`${periodEnd}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { fromInclusive: torontoMidnightUtc(periodStart), toExclusive: torontoMidnightUtc(next.toISOString().slice(0, 10)) };
}

export function validatePlayerPhotoUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('UNSAFE_PLAYER_PHOTO_URL');
  }
  const allowedHosts = new Set([
    `${EXPECTED_PROJECT_REF}.supabase.co`,
    'auth.beerleaguehockey.ca',
  ]);
  if (
    url.protocol !== 'https:'
    || !allowedHosts.has(url.hostname)
    || url.username
    || url.password
    || (url.port && url.port !== '443')
    || url.search
    || url.hash
    || !url.pathname.startsWith('/storage/v1/object/public/player-avatars/')
  ) throw new Error('UNSAFE_PLAYER_PHOTO_URL');
  let objectName: string;
  try {
    objectName = decodeURIComponent(url.pathname.slice('/storage/v1/object/public/player-avatars/'.length));
  } catch {
    throw new Error('UNSAFE_PLAYER_PHOTO_URL');
  }
  if (!objectName || objectName.includes('\0') || objectName.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('UNSAFE_PLAYER_PHOTO_URL');
  }
  return url;
}

export function sniffSupportedImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Fully parses, CRC-checks, inflates, and reconstructs a supported provider PNG. */
export async function assertPng1024(bytes: Uint8Array): Promise<void> {
  try {
    if (bytes.length < 57 || bytes.length > MAX_OUTPUT_IMAGE_BYTES || sniffSupportedImageMime(bytes) !== OUTPUT_MIME) {
      throw new Error('invalid PNG envelope');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let sawHeader = false;
    let sawData = false;
    let sawEnd = false;
    let channels = 0;
    const compressedChunks: Uint8Array[] = [];
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw new Error('truncated chunk');
      const length = view.getUint32(offset);
      const chunkEnd = offset + 12 + length;
      if (chunkEnd > bytes.length) throw new Error('truncated chunk payload');
      const typeBytes = bytes.subarray(offset + 4, offset + 8);
      const type = String.fromCharCode(...typeBytes);
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const crcInput = bytes.subarray(offset + 4, offset + 8 + length);
      if (crc32(crcInput) !== view.getUint32(offset + 8 + length)) throw new Error('chunk CRC mismatch');
      if (!sawHeader && type !== 'IHDR') throw new Error('IHDR must be first');
      if (type === 'IHDR') {
        if (sawHeader || length !== 13) throw new Error('invalid IHDR');
        if (view.getUint32(offset + 8) !== 1024 || view.getUint32(offset + 12) !== 1024) throw new Error('wrong dimensions');
        const bitDepth = data[8];
        const colorType = data[9];
        if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new Error('unsupported pixel format');
        if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('unsupported PNG method');
        channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
        sawHeader = true;
      } else if (type === 'IDAT') {
        if (!sawHeader || sawEnd) throw new Error('misordered IDAT');
        sawData = true;
        compressedChunks.push(data);
      } else if (type === 'IEND') {
        if (!sawHeader || !sawData || sawEnd || length !== 0 || chunkEnd !== bytes.length) throw new Error('invalid IEND');
        sawEnd = true;
      } else if ((typeBytes[0] & 0x20) === 0) {
        throw new Error('unsupported critical chunk');
      }
      offset = chunkEnd;
    }
    if (!sawHeader || !sawData || !sawEnd) throw new Error('incomplete PNG');

    const compressedLength = compressedChunks.reduce((total, chunk) => total + chunk.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let compressedOffset = 0;
    for (const chunk of compressedChunks) {
      compressed.set(chunk, compressedOffset);
      compressedOffset += chunk.length;
    }
    const inflated = new Uint8Array(await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer());
    const rowBytes = 1024 * channels;
    if (inflated.length !== (rowBytes + 1) * 1024) throw new Error('invalid decoded length');
    const previous = new Uint8Array(rowBytes);
    const current = new Uint8Array(rowBytes);
    let decodedOffset = 0;
    for (let row = 0; row < 1024; row += 1) {
      const filter = inflated[decodedOffset++];
      if (filter > 4) throw new Error('invalid scanline filter');
      for (let column = 0; column < rowBytes; column += 1) {
        const raw = inflated[decodedOffset++];
        const left = column >= channels ? current[column - channels] : 0;
        const above = previous[column];
        const upperLeft = column >= channels ? previous[column - channels] : 0;
        const predictor = filter === 0 ? 0
          : filter === 1 ? left
            : filter === 2 ? above
              : filter === 3 ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
        current[column] = (raw + predictor) & 0xff;
      }
      previous.set(current);
    }
  } catch {
    throw new Error('INVALID_GENERATED_IMAGE');
  }
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || '0');
  if (declared > maxBytes) throw new Error('IMAGE_TOO_LARGE');
  if (!response.body) throw new Error('EMPTY_IMAGE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('IMAGE_TOO_LARGE');
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error('EMPTY_IMAGE');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function fetchPlayerPhoto(
  rawUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs = 8_000,
): Promise<{ bytes: Uint8Array; mime: string; url: string }> {
  const url = validatePlayerPhotoUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error('PLAYER_PHOTO_REDIRECT');
    if (!response.ok) throw new Error('PLAYER_PHOTO_FETCH_FAILED');
    const headerMime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(headerMime)) throw new Error('INVALID_PLAYER_PHOTO_MIME');
    const bytes = await readResponseBytes(response, MAX_SOURCE_IMAGE_BYTES);
    const sniffed = sniffSupportedImageMime(bytes);
    if (sniffed !== headerMime) throw new Error('INVALID_PLAYER_PHOTO_MIME');
    return { bytes, mime: sniffed, url: url.toString() };
  } finally {
    clearTimeout(timer);
  }
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digestInput = new Uint8Array(input.byteLength);
  digestInput.set(input);
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, ownedBuffer(new TextEncoder().encode(message)));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyHmacSha256Hex(secret: string, message: string, signatureHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(signatureHex)) return false;
  const signature = new Uint8Array(signatureHex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, ownedBuffer(signature), ownedBuffer(new TextEncoder().encode(message)));
}

export const CARICATURE_PROMPT = [
  'Use the supplied real player profile photo only as the identity reference.',
  'Create a recognizable chest-up editorial newspaper caricature of this same adult person.',
  'Preserve the same face, facial proportions, hair, facial hair, skin tone, and other identity-defining features.',
  'Style: fine black ink linework and cross-hatching, restrained muted watercolour washes, warm cream newsprint background, classic local sports newspaper illustration.',
  'Composition: one person, chest-up, front or natural three-quarter pose, uncluttered background, printable square crop.',
  'Do not add any text, letters, numbers, jersey numbers, logos, statistics, captions, speech bubbles, quotes, watermarks, or signatures.',
  'Do not invent a game scene, action moment, trophy, injury, fight, opponent, or factual event. All names and statistics will be typeset separately.',
].join(' ');

export interface CacheIdentity {
  playerId: string;
  sourcePhotoUrlSha256: string;
  sourcePhotoSha256: string;
  model: string;
  promptVersion: string;
  promptSha256: string;
  cacheKeyContextSha256: string;
}

export function cachePaths(identity: CacheIdentity) {
  const hashes = [
    identity.sourcePhotoUrlSha256,
    identity.sourcePhotoSha256,
    identity.promptSha256,
    identity.cacheKeyContextSha256,
  ];
  if (
    !isUuid(identity.playerId)
    || hashes.some((value) => !/^[0-9a-f]{64}$/.test(value))
    || identity.model !== IMAGE_MODEL
    || identity.promptVersion !== PROMPT_VERSION
  ) throw new Error('INVALID_CACHE_IDENTITY');
  const root = [
    CACHE_PREFIX,
    identity.playerId,
    identity.sourcePhotoUrlSha256,
    identity.sourcePhotoSha256,
    identity.model,
    identity.promptVersion,
    identity.promptSha256,
    identity.cacheKeyContextSha256,
  ].join('/');
  return { metadataPath: `${root}/binding.json` };
}

export function immutableMediaPaths(outputSha256: string) {
  if (!/^[0-9a-f]{64}$/.test(outputSha256)) throw new Error('INVALID_OUTPUT_HASH');
  return {
    privatePath: `${PRIVATE_OUTPUT_PREFIX}/${outputSha256}.png`,
    publicPath: `${PUBLIC_OUTPUT_PREFIX}/${outputSha256}.png`,
    publicUrl: `https://${EXPECTED_PROJECT_REF}.supabase.co/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/${PUBLIC_OUTPUT_PREFIX}/${outputSha256}.png`,
  };
}
