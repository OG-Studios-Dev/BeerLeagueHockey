#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { atomicWriteJson, attachReviewCandidate, approveCandidate, buildApprovedManifest, failJob, preparePackets, readRosterSnapshot, readState, reconcileQueue, retryJob, startJobs } from './library.mjs';

const [command, ...raw] = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < raw.length; i += 2) { if (!raw[i]?.startsWith('--') || raw[i + 1] === undefined) throw new Error(`Invalid argument ${raw[i]}`); args.set(raw[i].slice(2), raw[i + 1]); }
const required = (name) => { const value = args.get(name); if (!value) throw new Error(`--${name} is required`); return value; };
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); atomicWriteJson(path, value); };
const LOCK_HELPER = `
import fcntl, sys
handle = open(sys.argv[1], 'a+b')
fcntl.flock(handle, fcntl.LOCK_EX)
sys.stdout.write('LOCKED\\n')
sys.stdout.flush()
sys.stdin.buffer.read(1)
`;

async function withStateTransaction(statePath, operation) {
  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = resolve(`${statePath}.lock`);
  const helper = spawn('python3', ['-c', LOCK_HELPER, lockPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; let stdout = '';
  helper.stderr.setEncoding('utf8'); helper.stderr.on('data', (chunk) => { stderr += chunk; });
  helper.stdout.setEncoding('utf8');
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => { helper.kill(); rejectReady(new Error(`Timed out waiting for queue lock ${lockPath}`)); }, 30_000);
    const fail = (error) => { clearTimeout(timer); rejectReady(error instanceof Error ? error : new Error(`Queue lock helper failed: ${stderr.slice(0, 200)}`)); };
    helper.once('error', fail);
    helper.once('exit', (code) => { if (!stdout.includes('LOCKED\n')) fail(new Error(`Queue lock helper exited ${code}: ${stderr.slice(0, 200)}`)); });
    helper.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('LOCKED\n')) { clearTimeout(timer); resolveReady(); }
    });
  });
  try {
    return operation();
  } finally {
    helper.stdin.end();
    await new Promise((resolveExit) => { if (helper.exitCode !== null) resolveExit(); else helper.once('exit', resolveExit); });
  }
}

const transact = (statePath, operation) => {
  // Fail fast on a malformed path, but never use this optimistic read for mutation.
  // The authoritative read and write both occur while the shared lock is held.
  readState(statePath);
  return withStateTransaction(statePath, () => operation(readState(statePath)));
};

if (command === 'plan') {
  const roster = readRosterSnapshot(required('roster')); const statePath = required('state'); const state = await transact(statePath, (current) => { const next = reconcileQueue(roster, current); write(statePath, next); return next; });
  console.log(JSON.stringify({ queued: state.jobs.filter((j) => j.status === 'queued').length, approved: state.jobs.filter((j) => j.status === 'approved').length, noPhoto: state.noPhoto.length, state: statePath }));
} else if (command === 'prepare') {
  const statePath = required('state'); const packets = await transact(statePath, (state) => { const prepared = preparePackets(state, Number(args.get('limit') || 10)); write(required('out'), { schemaVersion: 1, createdAt: new Date().toISOString(), providerCallsMade: false, packets: prepared }); return prepared; }); console.log(JSON.stringify({ packets: packets.length, providerCallsMade: false }));
} else if (command === 'start') {
  const statePath = required('state'); await transact(statePath, (state) => write(statePath, startJobs(state, required('jobs').split(','))));
} else if (command === 'review') {
  const statePath = required('state'); await transact(statePath, (state) => write(statePath, attachReviewCandidate(state, required('job'), required('output'))));
} else if (command === 'approve') {
  const statePath = required('state'); const receipt = JSON.parse(readFileSync(required('receipt'), 'utf8')); await transact(statePath, (state) => write(statePath, approveCandidate(state, required('job'), receipt)));
} else if (command === 'fail') {
  const statePath = required('state'); await transact(statePath, (state) => write(statePath, failJob(state, required('job'), required('message'))));
} else if (command === 'retry') {
  const statePath = required('state'); await transact(statePath, (state) => write(statePath, retryJob(state, required('job'))));
} else if (command === 'manifest') {
  const statePath = required('state'); await transact(statePath, (state) => write(required('out'), buildApprovedManifest(state)));
} else {
  throw new Error('Usage: queue.mjs plan|prepare|start|review|approve|fail|retry|manifest (see docs/player-artwork-library.md)');
}
