import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');

function migrationSource() {
  const names = fs.readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('_schedule_process_account_deletions.sql'));
  assert.equal(names.length, 1, 'expected one process-account-deletions scheduler migration');
  return fs.readFileSync(path.join(migrationsDirectory, names[0]), 'utf8');
}

test('scheduler replaces only the exact named job and leaves fixture peers unchanged', () => {
  const sql = migrationSource();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /WHERE\s+jobname\s*=\s*'process-account-deletions'/i);
  assert.doesNotMatch(sql, /jobname\s+(?:LIKE|ILIKE)/i);

  const before = [
    { jobid: 1, jobname: 'weekly-ai-wrap' },
    { jobid: 2, jobname: 'process-account-deletions' },
    { jobid: 3, jobname: 'process-account-deletions-legacy' },
    { jobid: 4, jobname: 'process-account-deletions' },
  ];
  const targetName = sql.match(/jobname\s*=\s*'([^']+)'/i)?.[1];
  const after = before.filter((job) => job.jobname !== targetName);
  after.push({ jobid: 5, jobname: targetName });

  assert.deepEqual(
    after.filter((job) => job.jobname !== 'process-account-deletions'),
    before.filter((job) => job.jobname !== 'process-account-deletions'),
  );
  assert.equal(after.filter((job) => job.jobname === 'process-account-deletions').length, 1);
});

test('scheduler uses the production endpoint, five-minute cadence, explicit batch payload, and runtime Vault lookup', () => {
  const sql = migrationSource();
  assert.match(sql, /cron\.schedule\(\s*'process-account-deletions'\s*,\s*'\*\/5 \* \* \* \*'/s);
  assert.match(sql, /https:\/\/ntplczcmhvfkijjxavdl\.supabase\.co\/functions\/v1\/process-account-deletions/);
  assert.match(sql, /jsonb_build_object\(\s*'mode'\s*,\s*'batch'\s*\)/s);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /name\s*=\s*'service_role_key'/);
  assert.match(sql, /NULLIF\s*\(\s*btrim\s*\(/i);
  assert.match(sql, /RAISE EXCEPTION 'Vault secret service_role_key is missing or blank\.'/);
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{20,}/);
});

test('runtime helper is locked down and has an empty search path', () => {
  const sql = migrationSource();
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.invoke_process_account_deletions\(\) FROM PUBLIC;/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.invoke_process_account_deletions\(\) FROM anon;/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.invoke_process_account_deletions\(\) FROM authenticated;/i);
  assert.match(sql, /SELECT public\.invoke_process_account_deletions\(\);/i);
});
