import assert from 'node:assert/strict';
import { Client } from 'pg';

const connectionString = process.argv[2] ?? process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('Usage: tsx scripts/tests/account-deletion-apple-identity-probe.ts <local-postgres-url>');
}

const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error('The Apple identity probe refuses non-loopback PostgreSQL targets.');
}

const userId = 'a11ce000-0000-4000-8000-000000000091';
const instanceId = '00000000-0000-0000-0000-000000000000';
const client = new Client({
  connectionString,
  application_name: 'account-deletion-apple-identity-probe',
});

type Snapshot = { state: string; secrets: string; log: string };

async function snapshot(): Promise<Snapshot> {
  const result = await client.query<Snapshot>(`
    SELECT
      (SELECT count(*)::text FROM public.account_deletion_state WHERE user_id = $1) AS state,
      (SELECT count(*)::text FROM public.account_deletion_provider_secrets WHERE user_id = $1) AS secrets,
      (SELECT count(*)::text FROM public.account_deletion_log WHERE user_id = $1) AS log
  `, [userId]);
  assert.ok(result.rows[0]);
  return result.rows[0];
}

async function expectFailClosed(label: string, sql: string, values: unknown[]) {
  const before = await snapshot();
  await client.query('SAVEPOINT malformed_apple_call');
  let rejected = false;
  try {
    await client.query(sql, values);
  } catch (error) {
    rejected = true;
    assert.match(String(error), /Sign in with Apple.*support/i, label);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT malformed_apple_call');
    await client.query('RELEASE SAVEPOINT malformed_apple_call');
  }
  assert.equal(rejected, true, `${label} unexpectedly succeeded`);
  assert.deepEqual(await snapshot(), before, `${label} mutated deletion state`);
}

async function insertIdentity(
  id: string,
  identityId: string,
  identityData: Record<string, unknown>,
) {
  await client.query(`
    INSERT INTO auth.identities (
      id, user_id, provider, identity_id, identity_data,
      last_sign_in_at, created_at, updated_at
    ) VALUES ($1, $2, 'apple', $3, $4::jsonb, now(), now(), now())
  `, [id, userId, identityId, JSON.stringify(identityData)]);
}

async function clearCase() {
  await client.query('DELETE FROM public.account_deletion_provider_secrets WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM public.account_deletion_state WHERE user_id = $1', [userId]);
  await client.query("DELETE FROM auth.identities WHERE user_id = $1 AND provider = 'apple'", [userId]);
}

async function assertMalformedCase(label: string) {
  await expectFailClosed(
    `${label} prepare`,
    'SELECT public.prepare_account_deletion($1)',
    [userId],
  );
  await expectFailClosed(
    `${label} begin`,
    "SELECT public.begin_immediate_account_deletion($1, 'attacker-subject', 'server-token', 'refresh_token')",
    [userId],
  );
  console.log(`PASS: ${label} fails closed without state, log, or secret mutation.`);
}

async function main() {
  await client.connect();
  try {
    const sourceCheck = await client.query<{ migration_present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version = '20260923140000'
      ) AS migration_present
    `);
    assert.equal(sourceCheck.rows[0]?.migration_present, true, 'Apple fail-closed migration is not applied');

    await client.query('BEGIN');
    await client.query(`
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at
      ) VALUES ($1, $2, 'authenticated', 'authenticated', $3, '', now(), now(), now())
    `, [instanceId, userId, 'apple-identity-probe@example.invalid']);
    await client.query(`
      INSERT INTO public.profiles (id, email, full_name)
      VALUES ($1, $2, 'Apple Identity Probe')
    `, [userId, 'apple-identity-probe@example.invalid']);

    // blank subject
    await insertIdentity('a11ce000-0000-4000-8000-000000000092', '   ', { sub: '   ' });
    await assertMalformedCase('blank subject');
    await clearCase();

    // null subject
    await insertIdentity('a11ce000-0000-4000-8000-000000000093', '', { sub: null });
    await assertMalformedCase('null subject');
    await clearCase();

    // duplicate conflicting subjects
    await insertIdentity('a11ce000-0000-4000-8000-000000000094', 'apple-subject-one', { sub: 'apple-subject-one' });
    await insertIdentity('a11ce000-0000-4000-8000-000000000095', 'apple-subject-two', { sub: 'apple-subject-two' });
    await assertMalformedCase('duplicate conflicting subjects');
    await clearCase();

    // one valid subject
    await insertIdentity('a11ce000-0000-4000-8000-000000000096', 'apple-subject-valid', { sub: 'apple-subject-valid' });
    const preparation = await client.query<{ result: { apple_required: boolean; apple_subject: string } }>(
      'SELECT public.prepare_account_deletion($1) AS result',
      [userId],
    );
    assert.equal(preparation.rows[0]?.result.apple_required, true);
    assert.equal(preparation.rows[0]?.result.apple_subject, 'apple-subject-valid');
    const begin = await client.query<{ result: { success: boolean; apple_subject: string } }>(
      "SELECT public.begin_immediate_account_deletion($1, $2, 'server-token', 'refresh_token') AS result",
      [userId, 'apple-subject-valid'],
    );
    assert.equal(begin.rows[0]?.result.success, true);
    assert.equal(begin.rows[0]?.result.apple_subject, 'apple-subject-valid');
    assert.deepEqual(await snapshot(), { state: '1', secrets: '1', log: '0' });
    console.log('PASS: one valid subject prepares and begins the Apple deletion workflow.');

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Apple identity probe failed.');
  process.exitCode = 1;
});
