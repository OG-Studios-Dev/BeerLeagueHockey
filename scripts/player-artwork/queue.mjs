#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWriteJson, attachReviewCandidate, approveCandidate, buildApprovedManifest, failJob, preparePackets, readRosterSnapshot, readState, reconcileQueue, retryJob, startJobs } from './library.mjs';

const [command, ...raw] = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < raw.length; i += 2) { if (!raw[i]?.startsWith('--') || raw[i + 1] === undefined) throw new Error(`Invalid argument ${raw[i]}`); args.set(raw[i].slice(2), raw[i + 1]); }
const required = (name) => { const value = args.get(name); if (!value) throw new Error(`--${name} is required`); return value; };
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); atomicWriteJson(path, value); };

if (command === 'plan') {
  const roster = readRosterSnapshot(required('roster')); const statePath = required('state'); const state = reconcileQueue(roster, readState(statePath)); write(statePath, state);
  console.log(JSON.stringify({ queued: state.jobs.filter((j) => j.status === 'queued').length, approved: state.jobs.filter((j) => j.status === 'approved').length, noPhoto: state.noPhoto.length, state: statePath }));
} else if (command === 'prepare') {
  const packets = preparePackets(readState(required('state')), Number(args.get('limit') || 10)); write(required('out'), { schemaVersion: 1, createdAt: new Date().toISOString(), providerCallsMade: false, packets }); console.log(JSON.stringify({ packets: packets.length, providerCallsMade: false }));
} else if (command === 'start') {
  const statePath = required('state'); const state = startJobs(readState(statePath), required('jobs').split(',')); write(statePath, state);
} else if (command === 'review') {
  const statePath = required('state'); const state = attachReviewCandidate(readState(statePath), required('job'), required('output')); write(statePath, state);
} else if (command === 'approve') {
  const statePath = required('state'); const receipt = JSON.parse(readFileSync(required('receipt'), 'utf8')); const state = approveCandidate(readState(statePath), required('job'), receipt); write(statePath, state);
} else if (command === 'fail') {
  const statePath = required('state'); const state = failJob(readState(statePath), required('job'), required('message')); write(statePath, state);
} else if (command === 'retry') {
  const statePath = required('state'); const state = retryJob(readState(statePath), required('job')); write(statePath, state);
} else if (command === 'manifest') {
  write(required('out'), buildApprovedManifest(readState(required('state'))));
} else {
  throw new Error('Usage: queue.mjs plan|prepare|start|review|approve|fail|retry|manifest (see docs/player-artwork-library.md)');
}
