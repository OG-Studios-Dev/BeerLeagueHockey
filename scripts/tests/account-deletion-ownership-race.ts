import assert from 'node:assert/strict';
import { Client } from 'pg';

const connectionString = process.argv[2] ?? process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('Usage: tsx scripts/tests/account-deletion-ownership-race.ts <local-postgres-url>');
}

const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error('The ownership race fixture refuses non-loopback PostgreSQL targets.');
}

const deletingUserId = 'a11ce000-0000-4000-8000-000000000071';
const leagueId = 'a11ce000-0000-4000-8000-000000000072';
const ownerUserId = 'a11ce000-0000-4000-8000-000000000073';
const organizationId = 'a11ce000-0000-4000-8000-000000000074';
const instanceId = '00000000-0000-0000-0000-000000000000';
const sessionA = new Client({
  connectionString,
  application_name: 'account-deletion-race-preflight',
});
const sessionB = new Client({
  connectionString,
  application_name: 'account-deletion-race-owner-writer',
});

async function cleanup() {
  // Clear any failed assertion/query transaction before starting the cleanup
  // transaction. PostgreSQL otherwise rejects every cleanup statement after a
  // failed race writer, which can also keep the client process open.
  await sessionA.query('ROLLBACK');
  await sessionA.query('BEGIN');
  try {
    await sessionA.query('DELETE FROM public.account_deletion_provider_secrets WHERE user_id = $1', [deletingUserId]);
    await sessionA.query('DELETE FROM public.account_deletion_state WHERE user_id = $1', [deletingUserId]);
    await sessionA.query('DELETE FROM public.league_memberships WHERE league_id = $1', [leagueId]);
    await sessionA.query('DELETE FROM public.league_ownerships WHERE league_id = $1', [leagueId]);
    await sessionA.query('DELETE FROM public.leagues WHERE id = $1', [leagueId]);
    await sessionA.query('DELETE FROM public.organization_members WHERE organization_id = $1', [organizationId]);
    await sessionA.query('DELETE FROM public.organizations WHERE id = $1', [organizationId]);
    await sessionA.query('DELETE FROM public.profiles WHERE id = $1', [deletingUserId]);
    await sessionA.query('DELETE FROM public.profiles WHERE id = $1', [ownerUserId]);
    await sessionA.query('DELETE FROM auth.users WHERE id = $1', [deletingUserId]);
    await sessionA.query('DELETE FROM auth.users WHERE id = $1', [ownerUserId]);
    await sessionA.query('COMMIT');
  } catch (error) {
    await sessionA.query('ROLLBACK');
    throw error;
  }
}

async function runRace(label: string, query: string, values: string[]) {
  await sessionA.query('BEGIN');
  await sessionA.query('SELECT public.begin_immediate_account_deletion($1, NULL, NULL, NULL)', [deletingUserId]);

  await sessionB.query('BEGIN');
  await sessionB.query("SET LOCAL statement_timeout = '5s'");
  let writerSettled = false;
  const writer = sessionB.query(query, values).then(
    () => {
      writerSettled = true;
      throw new Error(`${label} unexpectedly committed during account deletion`);
    },
    (error: unknown) => {
      writerSettled = true;
      return error;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(writerSettled, false, `${label} did not wait on the deletion advisory lock`);

  await sessionA.query('COMMIT');
  try {
    const writerError = await writer;
    assert.match(String(writerError), /account deletion|deleting|deleted/i, label);
  } finally {
    await sessionB.query('ROLLBACK');
  }
  await sessionA.query('DELETE FROM public.account_deletion_state WHERE user_id = $1', [deletingUserId]);
  console.log(`PASS: ${label} serialized against immediate deletion.`);
}

async function main() {
  await sessionA.connect();
  await sessionB.connect();
  try {
    const sourceCheck = await sessionA.query<{ migration_present: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version = '20260923130000'
    ) AS migration_present
  `);
    assert.equal(sourceCheck.rows[0]?.migration_present, true, 'immediate-deletion-v1 migration is not applied');

    await cleanup();
    await sessionA.query('BEGIN');
    await sessionA.query(
      `
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at
    ) VALUES ($1, $2, 'authenticated', 'authenticated', $3, '', now(), now(), now())
  `,
      [instanceId, deletingUserId, 'ownership-race@example.invalid'],
    );
    await sessionA.query(
      `
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at
    ) VALUES ($1, $2, 'authenticated', 'authenticated', $3, '', now(), now(), now())
  `,
      [instanceId, ownerUserId, 'ownership-owner@example.invalid'],
    );
    await sessionA.query(
      `
    INSERT INTO public.profiles (id, email, full_name)
    VALUES ($1, $2, 'Ownership Race User')
  `,
      [deletingUserId, 'ownership-race@example.invalid'],
    );
    await sessionA.query(
      `
    INSERT INTO public.profiles (id, email, full_name)
    VALUES ($1, $2, 'Ownership Fixture Owner')
  `,
      [ownerUserId, 'ownership-owner@example.invalid'],
    );
    await sessionA.query(
      `
    INSERT INTO public.organizations (id, name, slug, owner_user_id)
    VALUES ($1, 'Ownership Race Organization', 'ownership-race-organization', $2)
  `,
      [organizationId, ownerUserId],
    );
    await sessionA.query(
      `
    INSERT INTO public.leagues (id, name, slug, owner_id, created_by)
    VALUES ($1, 'Ownership Race League', 'ownership-race-fixture', NULL, NULL)
  `,
      [leagueId],
    );
    await sessionA.query('COMMIT');

    await runRace('league owner assignment', 'UPDATE public.leagues SET owner_id = $1 WHERE id = $2', [deletingUserId, leagueId]);
    await runRace('league creator assignment', 'UPDATE public.leagues SET created_by = $1 WHERE id = $2', [deletingUserId, leagueId]);
    await runRace('organization owner assignment', 'UPDATE public.organizations SET owner_user_id = $1 WHERE id = $2', [deletingUserId, organizationId]);
    await runRace(
      'organization membership assignment',
      `INSERT INTO public.organization_members (organization_id, user_id, role, status)
     VALUES ($2, $1, 'admin', 'active')`,
      [deletingUserId, organizationId],
    );
    await runRace(
      'explicit league ownership assignment',
      `INSERT INTO public.league_ownerships (league_id, organization_id, user_id)
     VALUES ($2, $3, $1)`,
      [deletingUserId, leagueId, organizationId],
    );
    await runRace(
      'league membership owner insert',
      `INSERT INTO public.league_memberships (league_id, user_id, role, status)
     VALUES ($2, $1, 'owner', 'active')`,
      [deletingUserId, leagueId],
    );
    await runRace(
      'league membership admin insert',
      `INSERT INTO public.league_memberships (league_id, user_id, role, status)
     VALUES ($2, $1, 'admin', 'active')`,
      [deletingUserId, leagueId],
    );

    await sessionA.query(
      `
    INSERT INTO public.league_memberships (league_id, user_id, role, status)
    VALUES ($1, $2, 'member', 'active')
  `,
      [leagueId, ownerUserId],
    );
    await runRace('league membership reassignment', 'UPDATE public.league_memberships SET user_id = $1 WHERE league_id = $2 AND user_id = $3', [
      deletingUserId,
      leagueId,
      ownerUserId,
    ]);
    await sessionA.query('DELETE FROM public.league_memberships WHERE league_id = $1', [leagueId]);

    await sessionA.query(
      `
    INSERT INTO public.league_memberships (league_id, user_id, role, status)
    VALUES ($1, $2, 'member', 'active')
  `,
      [leagueId, deletingUserId],
    );
    await runRace('league membership owner promotion', "UPDATE public.league_memberships SET role = 'owner' WHERE league_id = $2 AND user_id = $1", [
      deletingUserId,
      leagueId,
    ]);
    await sessionA.query('DELETE FROM public.league_memberships WHERE league_id = $1', [leagueId]);

    const owner = await sessionA.query<{
      owner_id: string | null;
      created_by: string | null;
    }>('SELECT owner_id, created_by FROM public.leagues WHERE id = $1', [leagueId]);
    assert.equal(owner.rows[0]?.owner_id, null, 'deleting user retained operational ownership');
    assert.equal(owner.rows[0]?.created_by, null, 'deleting user retained league creator authority');
    const organization = await sessionA.query<{ owner_user_id: string }>('SELECT owner_user_id FROM public.organizations WHERE id = $1', [organizationId]);
    assert.equal(organization.rows[0]?.owner_user_id, ownerUserId);
    const accessRows = await sessionA.query<{ count: string }>(
      `
    SELECT (
      (SELECT count(*) FROM public.organization_members WHERE user_id = $1)
      + (SELECT count(*) FROM public.league_ownerships WHERE user_id = $1)
      + (SELECT count(*) FROM public.league_memberships WHERE user_id = $1)
    )::text AS count
  `,
      [deletingUserId],
    );
    assert.equal(accessRows.rows[0]?.count, '0', 'deleting user retained an access assignment');
    console.log('PASS: every ownership writer serialized against immediate deletion across two PostgreSQL sessions.');
  } finally {
    try {
      await sessionB.query('ROLLBACK');
    } catch {
      // Session B may already be outside a transaction.
    }
    try {
      await cleanup();
    } finally {
      await Promise.allSettled([sessionA.end(), sessionB.end()]);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Ownership race harness failed.');
  process.exitCode = 1;
});
