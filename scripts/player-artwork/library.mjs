import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

export const CONTRACT = Object.freeze({
  leagueId: 'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  styleVersion: 'hl-leader-podium-v1',
  imagePrefix: 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/',
  maxRetries: 3,
  maxPrepareBatch: 10,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const STATUSES = new Set(['queued', 'generating', 'review', 'approved', 'failed', 'superseded']);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function assert(condition, message) { if (!condition) throw new Error(message); }
function utc(value = new Date()) { return value.toISOString(); }

export function readRosterSnapshot(path) {
  const roster = JSON.parse(readFileSync(path, 'utf8'));
  assert(roster?.schemaVersion === 1, 'Roster schemaVersion must be 1');
  assert(roster?.league?.id === CONTRACT.leagueId, 'Roster league mismatch');
  assert(roster?.season?.leagueId === CONTRACT.leagueId && roster?.season?.status === 'active', 'Roster season is not the active target league season');
  assert(Array.isArray(roster.players), 'Roster players must be an array');
  const seen = new Set();
  const root = dirname(path);
  const players = roster.players.map((player, index) => {
    assert(UUID.test(player?.playerId), `Roster player ${index} has invalid playerId`);
    assert(!seen.has(player.playerId), `Roster contains duplicate player ${player.playerId}`);
    seen.add(player.playerId);
    const eligible = player.currentEligibility?.eligible === true
      && player.currentEligibility?.leagueId === CONTRACT.leagueId
      && player.currentEligibility?.seasonId === roster.season.id;
    const photo = player.photoStatus;
    let portrait = null;
    if (eligible && photo?.technicallyUsable === true) {
      assert(typeof player.photoUrl === 'string' && player.photoUrl === photo.sourceUrl && photo.finalUrl === player.photoUrl, `Portrait URL mismatch for ${player.playerId}`);
      assert(SHA.test(photo.sha256), `Portrait hash missing for ${player.playerId}`);
      const localPath = resolve(root, photo.localPath);
      assert(existsSync(localPath), `Portrait bytes missing for ${player.playerId}`);
      assert(sha256(readFileSync(localPath)) === photo.sha256, `Portrait bytes hash mismatch for ${player.playerId}`);
      portrait = { url: player.photoUrl, sha256: photo.sha256, localPath };
    }
    return {
      playerId: player.playerId,
      name: String(player.name || ''),
      eligible,
      priority: Number.isInteger(player.priority?.queueOrder) ? player.priority.queueOrder : 1_000_000,
      priorityTier: Number.isInteger(player.priority?.tier) ? player.priority.tier : 99,
      priorityReason: String(player.priority?.reason || 'remaining_current_eligible'),
      portrait,
    };
  });
  return { schemaVersion: 1, preparedAtUtc: roster.preparedAtUtc, leagueId: roster.league.id, seasonId: roster.season.id, players };
}

export function emptyState(now = new Date()) {
  return { schemaVersion: 1, leagueId: CONTRACT.leagueId, styleVersion: CONTRACT.styleVersion, updatedAt: utc(now), jobs: [], noPhoto: [] };
}

export function readState(path) {
  if (!existsSync(path)) return emptyState();
  const state = JSON.parse(readFileSync(path, 'utf8'));
  assert(state?.schemaVersion === 1 && state.leagueId === CONTRACT.leagueId && state.styleVersion === CONTRACT.styleVersion, 'Queue state contract mismatch');
  assert(Array.isArray(state.jobs) && state.jobs.every((job) => STATUSES.has(job.status)), 'Queue contains invalid jobs');
  return state;
}

export function atomicWriteJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

export function reconcileQueue(roster, previous, now = new Date()) {
  assert(roster.leagueId === previous.leagueId, 'Queue and roster league mismatch');
  const rosterPrepared = Date.parse(roster.preparedAtUtc);
  assert(Number.isFinite(rosterPrepared), 'Roster preparedAtUtc is invalid');
  if (previous.rosterPreparedAt) {
    const previousPrepared = Date.parse(previous.rosterPreparedAt);
    assert(Number.isFinite(previousPrepared) && rosterPrepared >= previousPrepared, 'Roster snapshot is older than queue state');
  }
  const currentIdentities = new Set();
  const jobs = previous.jobs.map((job) => ({ ...job }));
  const byIdentity = new Map(jobs.map((job) => [job.id, job]));
  const noPhoto = [];
  for (const player of roster.players) {
    if (!player.eligible) continue;
    if (!player.portrait) {
      noPhoto.push({ playerId: player.playerId, name: player.name, reason: 'no_technically_usable_current_portrait' });
      continue;
    }
    const id = `${roster.leagueId}:${player.playerId}:${player.portrait.sha256}:${CONTRACT.styleVersion}`;
    currentIdentities.add(id);
    const existing = byIdentity.get(id);
    if (existing) {
      const sourceUrlChanged = existing.sourcePortraitUrl !== player.portrait.url;
      if (existing.status === 'superseded') {
        const prior = existing.supersededStatus;
        existing.status = prior === 'approved' || prior === 'review' || prior === 'failed' ? prior : 'queued';
        delete existing.supersededAt;
        delete existing.supersededStatus;
      }
      if (sourceUrlChanged && existing.approval) {
        existing.approvalHistory ??= [];
        existing.approvalHistory.push({ ...existing.approval, invalidatedAt: utc(now), invalidationReason: 'source_portrait_url_changed' });
        existing.approvalInvalidatedAt = utc(now);
        existing.approvalInvalidationReason = 'source_portrait_url_changed';
        delete existing.approvedAt;
        existing.status = existing.candidate ? 'review' : 'queued';
      }
      Object.assign(existing, { name: player.name, sourcePortraitUrl: player.portrait.url, sourcePortraitPath: player.portrait.localPath, priority: player.priority, priorityTier: player.priorityTier, priorityReason: player.priorityReason, current: true });
      existing.updatedAt = utc(now);
    } else {
      jobs.push({ id, leagueId: roster.leagueId, playerId: player.playerId, name: player.name, sourcePortraitUrl: player.portrait.url, sourcePortraitSha256: player.portrait.sha256, sourcePortraitPath: player.portrait.localPath, styleVersion: CONTRACT.styleVersion, priority: player.priority, priorityTier: player.priorityTier, priorityReason: player.priorityReason, status: 'queued', attempts: 0, failures: [], current: true, createdAt: utc(now), updatedAt: utc(now) });
    }
  }
  for (const job of jobs) {
    if (!currentIdentities.has(job.id) && job.status !== 'superseded') {
      job.supersededStatus = job.status;
      job.status = 'superseded';
      job.current = false;
      job.supersededAt = utc(now);
      job.updatedAt = utc(now);
    }
  }
  jobs.sort((a, b) => Number(a.priority) - Number(b.priority) || a.playerId.localeCompare(b.playerId) || a.id.localeCompare(b.id));
  return { ...previous, updatedAt: utc(now), rosterPreparedAt: roster.preparedAtUtc, seasonId: roster.seasonId, jobs, noPhoto };
}

export function preparePackets(state, limit = CONTRACT.maxPrepareBatch) {
  assert(Number.isInteger(limit) && limit > 0 && limit <= CONTRACT.maxPrepareBatch, `Prepare limit must be 1-${CONTRACT.maxPrepareBatch}`);
  return state.jobs.filter((job) => job.current && job.status === 'queued').slice(0, limit).map((job) => {
    assertFreshSource(job);
    return ({
    jobId: job.id,
    leagueId: job.leagueId,
    playerId: job.playerId,
    sourcePortraitUrl: job.sourcePortraitUrl,
    sourcePortraitSha256: job.sourcePortraitSha256,
    sourcePortraitPath: job.sourcePortraitPath,
    styleVersion: job.styleVersion,
    prompt: 'Using the supplied authentic portrait only as the identity reference, create one reusable full-body Hockey Life athlete in complete hockey equipment with the official HL chest monogram, standing on the approved purple-lit podium. Preserve likeness. Output a true-alpha RGBA PNG with the complete athlete, skates, stick, and podium visible. Do not render a name, number, rank, statistic, team caption, arena rectangle, checkerboard, or other text.',
    requiredReview: ['likeness', 'complete_equipment', 'official_hl_branding', 'complete_podium', 'true_alpha', 'no_names_or_stats'],
    });
  });
}

function assertFreshSource(job) {
  assert(typeof job.sourcePortraitPath === 'string' && existsSync(job.sourcePortraitPath), `Source portrait is missing for ${job.id}`);
  assert(sha256(readFileSync(job.sourcePortraitPath)) === job.sourcePortraitSha256, `Source portrait bytes changed for ${job.id}`);
}

export function startJobs(state, jobIds, now = new Date()) {
  assert(jobIds.length > 0 && jobIds.length <= CONTRACT.maxPrepareBatch, `Start accepts 1-${CONTRACT.maxPrepareBatch} jobs`);
  const wanted = new Set(jobIds);
  assert(wanted.size === jobIds.length, 'Duplicate job IDs requested');
  for (const job of state.jobs) {
    if (!wanted.has(job.id)) continue;
    assert(job.current && (job.status === 'queued' || job.status === 'failed'), `Job ${job.id} is not startable`);
    assert(job.attempts < CONTRACT.maxRetries, `Job ${job.id} exhausted retries`);
    job.status = 'generating'; job.attempts += 1; job.updatedAt = utc(now);
    wanted.delete(job.id);
  }
  assert(wanted.size === 0, `Unknown jobs: ${[...wanted].join(', ')}`);
  state.updatedAt = utc(now);
  return state;
}

function paeth(a, b, c) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectRgbaPng(path) {
  const bytes = readFileSync(path);
  assert(bytes.length <= 5 * 1024 * 1024, 'PNG exceeds the 5 MiB storage limit');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Output is not a PNG');
  let offset = 8; let width; let height; let bitDepth; let colorType; let interlace; const idat = []; let sawIend = false; let chunkIndex = 0; let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
    assert(offset + 12 + length <= bytes.length, 'PNG chunk is truncated');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert(bytes.readUInt32BE(offset + 8 + length) === crc32(bytes.subarray(offset + 4, offset + 8 + length)), `PNG ${type} checksum is invalid`);
    if (type === 'IHDR') {
      assert(chunkIndex === 0 && length === 13 && width === undefined, 'PNG IHDR is invalid');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    }
    if (type === 'IDAT') { assert(width !== undefined, 'PNG IDAT precedes IHDR'); idat.push(data); sawIdat = true; }
    if (type === 'IEND') { assert(length === 0 && sawIdat, 'PNG IEND is invalid'); sawIend = true; }
    offset += 12 + length;
    chunkIndex += 1;
    if (type === 'IEND') break;
  }
  assert(sawIend && offset === bytes.length, 'PNG container must end with IEND');
  assert(Number.isInteger(width) && width >= 256 && width <= 4096 && Number.isInteger(height) && height >= 256 && height <= 4096, 'PNG dimensions are outside 256-4096');
  assert(bitDepth === 8 && colorType === 6 && interlace === 0, 'Output must be non-interlaced 8-bit RGBA PNG');
  const bpp = 4; const stride = width * bpp; const expectedRasterLength = height * (stride + 1);
  let inflated;
  try { inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedRasterLength }); }
  catch { throw new Error('PNG raster size is invalid'); }
  assert(inflated.length === expectedRasterLength, 'PNG raster size is invalid');
  let previous = Buffer.alloc(stride); let position = 0; let minAlpha = 255; let maxAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[position++]; const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[position++]; const left = x >= bpp ? row[x - bpp] : 0; const up = previous[x]; const upperLeft = x >= bpp ? previous[x - bpp] : 0;
      row[x] = (raw + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : (() => { throw new Error('Unsupported PNG filter'); })())) & 255;
    }
    for (let x = 3; x < stride; x += 4) { minAlpha = Math.min(minAlpha, row[x]); maxAlpha = Math.max(maxAlpha, row[x]); }
    previous = row;
  }
  assert(minAlpha < 255 && maxAlpha > 0, 'PNG must contain both transparency and visible artwork');
  return { path: resolve(path), sha256: sha256(bytes), width, height, minAlpha, maxAlpha, bytes: bytes.length };
}

export function attachReviewCandidate(state, jobId, outputPath, now = new Date()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  assert(job?.current && job.status === 'generating', 'Only a current generating job can enter review');
  job.candidate = inspectRgbaPng(outputPath); job.status = 'review'; job.updatedAt = utc(now); state.updatedAt = utc(now); return state;
}

export function approveCandidate(state, jobId, receipt, now = new Date()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  assert(job?.current && job.status === 'review' && job.candidate, 'Only a current reviewed candidate can be approved');
  assertFreshSource(job);
  const currentCandidate = inspectRgbaPng(job.candidate.path);
  assert(currentCandidate.sha256 === job.candidate.sha256 && currentCandidate.width === job.candidate.width && currentCandidate.height === job.candidate.height, 'Reviewed output bytes changed');
  for (const key of ['reviewer', 'reviewedAt', 'leagueId', 'playerId', 'sourcePortraitUrl', 'sourcePortraitSha256', 'styleVersion', 'outputSha256']) assert(typeof receipt?.[key] === 'string' && receipt[key], `Receipt ${key} is required`);
  for (const key of ['approved', 'identityConfirmed', 'brandingConfirmed', 'transparencyConfirmed', 'noTextOrStatsConfirmed']) assert(receipt?.[key] === true, `Receipt ${key} must be true`);
  assert(receipt.leagueId === job.leagueId && receipt.playerId === job.playerId && receipt.sourcePortraitUrl === job.sourcePortraitUrl && receipt.sourcePortraitSha256 === job.sourcePortraitSha256 && receipt.styleVersion === job.styleVersion && receipt.outputSha256 === job.candidate.sha256, 'Receipt is not bound to this source and output');
  assert(Number.isFinite(Date.parse(receipt.reviewedAt)), 'Receipt reviewedAt is invalid');
  job.status = 'approved'; job.approval = { ...receipt }; delete job.approvalInvalidatedAt; delete job.approvalInvalidationReason; job.approvedAt = receipt.reviewedAt; job.updatedAt = utc(now); state.updatedAt = utc(now); return state;
}

export function failJob(state, jobId, message, now = new Date()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  assert(job && job.status !== 'superseded', 'Unknown or superseded job');
  job.failures ??= []; job.failures.push({ at: utc(now), message: String(message).slice(0, 500), attempt: job.attempts });
  if (job.status !== 'approved') job.status = 'failed';
  job.updatedAt = utc(now); state.updatedAt = utc(now); return state;
}

export function retryJob(state, jobId, now = new Date()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  assert(job?.current && job.status === 'failed', 'Only a current failed job can retry');
  assert(job.attempts < CONTRACT.maxRetries, 'Retry limit reached');
  job.status = 'queued'; delete job.candidate; job.updatedAt = utc(now); state.updatedAt = utc(now); return state;
}

export function buildApprovedManifest(state, now = new Date()) {
  const entries = state.jobs.filter((job) => job.current && job.status === 'approved').map((job) => {
    assertFreshSource(job);
    assert(job.approval && !job.approvalInvalidatedAt && job.candidate && job.approval.outputSha256 === job.candidate.sha256, `Approved job ${job.id} is incomplete`);
    assert(job.approval.leagueId === job.leagueId && job.approval.playerId === job.playerId
      && job.approval.sourcePortraitUrl === job.sourcePortraitUrl && job.approval.sourcePortraitSha256 === job.sourcePortraitSha256
      && job.approval.styleVersion === job.styleVersion, `Approved job ${job.id} source binding is stale`);
    const currentCandidate = inspectRgbaPng(job.candidate.path);
    assert(currentCandidate.sha256 === job.candidate.sha256 && currentCandidate.width === job.candidate.width && currentCandidate.height === job.candidate.height, `Approved output bytes changed for ${job.id}`);
    return { playerId: job.playerId, sourcePortraitUrl: job.sourcePortraitUrl, sourcePortraitSha256: job.sourcePortraitSha256, imageUrl: `${CONTRACT.imagePrefix}${job.playerId}/${job.candidate.sha256}.png`, imageSha256: job.candidate.sha256, width: job.candidate.width, height: job.candidate.height, approvedAt: job.approvedAt };
  });
  return { schemaVersion: 1, leagueId: CONTRACT.leagueId, styleVersion: CONTRACT.styleVersion, generatedAt: utc(now), entries };
}
