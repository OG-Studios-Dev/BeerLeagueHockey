import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';

import { CONTRACT, approveCandidate, attachReviewCandidate, buildApprovedManifest, emptyState, failJob, readRosterSnapshot, reconcileQueue, retryJob, sha256, startJobs } from './library.mjs';

const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

function fixture(players) {
  const root = mkdtempSync(join(tmpdir(), 'art-queue-')); mkdirSync(join(root, 'photos'));
  const mapped = players.map((p, i) => {
    const bytes = Buffer.from(`portrait-${p.playerId}-${p.version ?? 1}`); const localPath = `photos/${p.playerId}.png`; writeFileSync(join(root, localPath), bytes);
    return { playerId: p.playerId, name: p.name || p.playerId, photoUrl: `https://example.test/${p.playerId}-${p.version ?? 1}.png`, currentEligibility: { eligible: p.eligible !== false, leagueId: CONTRACT.leagueId, seasonId: 'season' }, priority: { queueOrder: p.priority ?? i + 1, tier: p.priority === 1 ? 0 : 1, reason: p.priority === 1 ? 'current_metric_leader' : 'remaining_current_eligible' }, photoStatus: p.noPhoto ? null : { technicallyUsable: true, sourceUrl: `https://example.test/${p.playerId}-${p.version ?? 1}.png`, finalUrl: `https://example.test/${p.playerId}-${p.version ?? 1}.png`, localPath, sha256: sha256(bytes) } };
  });
  const path = join(root, 'roster.json'); writeFileSync(path, JSON.stringify({ schemaVersion: 1, preparedAtUtc: '2026-10-04T00:00:00Z', league: { id: CONTRACT.leagueId }, season: { id: 'season', leagueId: CONTRACT.leagueId, status: 'active' }, players: mapped })); return { root, path };
}

let crcTable;
function crc32(buffer) { crcTable ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return out; }
function png(path) { const width = 256; const height = 256; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; const rows = Buffer.alloc(height * (1 + width * 4)); for (let y = 0; y < height; y += 1) { const start = y * (1 + width * 4); for (let x = 0; x < width; x += 1) { rows[start + 1 + x * 4] = 100; rows[start + 2 + x * 4] = 50; rows[start + 3 + x * 4] = 200; rows[start + 4 + x * 4] = x === 0 ? 0 : 255; } } writeFileSync(path, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])); }

describe('player artwork queue', () => {
  it('extracts the explicit roster schema, rejects duplicates/wrong league, and orders leaders first', () => {
    const f = fixture([{ playerId: other, priority: 2 }, { playerId: player, priority: 1 }]); const roster = readRosterSnapshot(f.path); const state = reconcileQueue(roster, emptyState());
    assert.deepEqual(state.jobs.map((j) => j.playerId), [player, other]);
    const duplicate = JSON.parse(readFileSync(f.path)); duplicate.players.push(duplicate.players[0]); writeFileSync(f.path, JSON.stringify(duplicate)); assert.throws(() => readRosterSnapshot(f.path), /duplicate/);
    duplicate.players.pop(); duplicate.league.id = other; writeFileSync(f.path, JSON.stringify(duplicate)); assert.throws(() => readRosterSnapshot(f.path), /league mismatch/);
  });

  it('deduplicates unchanged portraits and supersedes changed or inactive identities', () => {
    const first = fixture([{ playerId: player }]); let state = reconcileQueue(readRosterSnapshot(first.path), emptyState()); state = reconcileQueue(readRosterSnapshot(first.path), state); assert.equal(state.jobs.length, 1);
    const changed = fixture([{ playerId: player, version: 2 }]); state = reconcileQueue(readRosterSnapshot(changed.path), state); assert.equal(state.jobs.length, 2); assert.equal(state.jobs.filter((j) => j.status === 'superseded').length, 1); assert.equal(state.jobs.filter((j) => j.status === 'queued').length, 1);
    const inactive = fixture([{ playerId: player, version: 2, eligible: false }]); state = reconcileQueue(readRosterSnapshot(inactive.path), state); assert.equal(state.jobs.filter((j) => j.status === 'queued').length, 0);
  });

  it('bounds retries while preserving an approved version when a later attempt fails', () => {
    const f = fixture([{ playerId: player }]); let state = reconcileQueue(readRosterSnapshot(f.path), emptyState()); const id = state.jobs[0].id;
    for (let attempt = 0; attempt < 2; attempt += 1) { state = startJobs(state, [id]); state = failJob(state, id, 'provider failed'); state = retryJob(state, id); }
    state = startJobs(state, [id]); state = failJob(state, id, 'provider failed'); assert.throws(() => retryJob(state, id), /limit/);
    state.jobs[0].status = 'approved'; state = failJob(state, id, 'replacement failed'); assert.equal(state.jobs[0].status, 'approved'); assert.equal(state.jobs[0].failures.length, 4);
  });

  it('requires real-alpha PNG review and a source/output-bound explicit receipt before manifest inclusion', () => {
    const f = fixture([{ playerId: player }]); let state = reconcileQueue(readRosterSnapshot(f.path), emptyState()); const id = state.jobs[0].id; state = startJobs(state, [id]); const output = join(f.root, 'output.png'); png(output); state = attachReviewCandidate(state, id, output);
    const job = state.jobs[0]; const receipt = { reviewer: 'human-reviewer', reviewedAt: '2026-10-04T12:00:00.000Z', leagueId: job.leagueId, playerId: job.playerId, sourcePortraitUrl: job.sourcePortraitUrl, sourcePortraitSha256: job.sourcePortraitSha256, styleVersion: job.styleVersion, outputSha256: job.candidate.sha256, approved: true, identityConfirmed: true, brandingConfirmed: true, transparencyConfirmed: true, noTextOrStatsConfirmed: true };
    assert.throws(() => approveCandidate(structuredClone(state), id, { ...receipt, outputSha256: createHash('sha256').update('wrong').digest('hex') }), /not bound/);
    state = approveCandidate(state, id, receipt); const manifest = buildApprovedManifest(state); assert.equal(manifest.entries.length, 1); assert.match(manifest.entries[0].imageUrl, new RegExp(`${player}/${job.candidate.sha256}\\.png$`));
  });
});
