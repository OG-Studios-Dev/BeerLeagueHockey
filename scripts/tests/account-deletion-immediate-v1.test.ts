import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  ACCOUNT_DELETION_V1_UNAVAILABLE,
  cancelAccountDeletion,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from '../../apps/league-builder/src/lib/account/deletion-actions.ts';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migrationPath = 'supabase/migrations/20260923130000_immediate_account_deletion_v1.sql';
const appleFailClosedMigrationPath =
  'supabase/migrations/20260923140000_account_deletion_apple_identity_fail_closed.sql';

describe('immediate-only account deletion v1', () => {
  it('ships a forward-only migration after correction pass 3', () => {
    const migration = read(migrationPath);
    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS workflow_state text/i);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS initiation_kind text/i);
  });

  it('makes Apple challenge discovery mutation-free and begins only a verified immediate workflow', () => {
    const migration = read(migrationPath);
    const prepare = migration.match(/CREATE OR REPLACE FUNCTION public\.prepare_account_deletion[\s\S]*?\$function\$;/i)?.[0] ?? '';
    const begin = migration.match(/CREATE OR REPLACE FUNCTION public\.begin_immediate_account_deletion[\s\S]*?\$function\$;/i)?.[0] ?? '';
    assert.ok(prepare);
    assert.doesNotMatch(prepare, /\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(prepare, /lock_account_deletion_user/i);
    assert.match(begin, /lock_account_deletion_user\(p_user_id\)/i);
    for (const relation of ['organizations', 'organization_members', 'leagues', 'league_ownerships', 'league_memberships']) {
      assert.match(begin, new RegExp(`public\\.${relation}`, 'i'), relation);
    }
    assert.match(begin, /p_apple_subject[\s\S]*?auth\.identities/i);
    assert.match(begin, /INSERT INTO public\.account_deletion_state/i);
    assert.match(begin, /workflow_state[\s\S]*?'irreversible'/i);
    assert.match(begin, /initiation_kind[\s\S]*?'immediate'/i);
  });

  it('uses one fail-closed Apple identity rule in prepare and begin from a new forward-only migration', () => {
    const migration = read(appleFailClosedMigrationPath);
    assert.match(migration, /^BEGIN;/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(migration, /count\(\*\).*apple_identity_row_count/is);
    assert.match(migration, /valid_apple_subject_count/is);
    assert.match(migration, /distinct_apple_subject_count/is);
    assert.match(migration, /btrim/is);
    assert.match(migration, /contact Hockey Life support/i);
    assert.match(migration, /i\.provider_id/i);
    assert.match(migration, /i\.identity_data\s*->>\s*'sub'/i);
    assert.doesNotMatch(migration, /i\.identity_id/i);
    assert.doesNotMatch(migration, /COALESCE\s*\(\s*NULLIF\s*\(\s*pg_catalog\.btrim\s*\(\s*i\.identity_data\s*->>\s*'sub'/i);

    const prepare = migration.match(/CREATE OR REPLACE FUNCTION public\.prepare_account_deletion[\s\S]*?\$function\$;/i)?.[0] ?? '';
    const begin = migration.match(/CREATE OR REPLACE FUNCTION public\.begin_immediate_account_deletion[\s\S]*?\$function\$;/i)?.[0] ?? '';
    assert.ok(prepare);
    assert.ok(begin);
    assert.match(prepare, /resolve_account_apple_identity_binding\(p_user_id\)/i);
    assert.match(begin, /resolve_account_apple_identity_binding\(p_user_id\)/i);
    assert.doesNotMatch(prepare, /\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);

    const correctionPass2 = read('supabase/migrations/20260922170000_account_deletion_correction_pass_2.sql');
    const pass2Execute = correctionPass2.match(
      /CREATE OR REPLACE FUNCTION public\.execute_account_deletion\(p_user_id uuid\)[\s\S]*?\$function\$;/i,
    )?.[0] ?? '';
    assert.ok(pass2Execute);
    assert.match(pass2Execute, /i\.provider_id/i);
    assert.doesNotMatch(pass2Execute, /i\.identity_id/i);
    assert.match(pass2Execute, /array_remove\(player_order, p_user_id\)/i);
    assert.match(pass2Execute, /player_order\s+@>\s+ARRAY\[p_user_id\]::uuid\[\]/i);
    assert.doesNotMatch(pass2Execute, /array_remove\(player_order, p_user_id::text\)/i);
  });

  it('covers normal, mismatched, and missing Apple provider subjects in rollback acceptance', () => {
    const fixture = read('supabase/tests/account_deletion_operational_authority_acceptance.sql');
    assert.match(fixture, /normal Apple provider subject/i);
    assert.match(fixture, /mismatched Apple provider subject/i);
    assert.match(fixture, /missing Apple provider subject/i);
    assert.match(fixture, /provider_id/i);
    assert.match(fixture, /identity_data/i);
    assert.match(fixture, /SQLSTATE\s+'22023'/i);
  });

  it('starts the immediate workflow before operational storage and deletion acceptance', () => {
    const fixture = read('supabase/tests/account_deletion_operational_authority_acceptance.sql');
    const begin = fixture.indexOf("begin_immediate_account_deletion('a11ce000-0000-4000-8000-000000000081')");
    const storage = fixture.indexOf("mark_account_storage_deleted('a11ce000-0000-4000-8000-000000000081')");
    const execute = fixture.indexOf("execute_account_deletion('a11ce000-0000-4000-8000-000000000081')");
    assert.ok(begin >= 0);
    assert.ok(storage > begin);
    assert.ok(execute > storage);
    assert.match(fixture, /SET CONSTRAINTS ALL IMMEDIATE;\s*SET CONSTRAINTS ALL DEFERRED;/i);
  });

  it('ships a loopback adversarial probe for malformed and valid Apple identities', () => {
    const probe = read('scripts/tests/account-deletion-apple-identity-probe.ts');
    assert.match(probe, /blank subject/i);
    assert.match(probe, /null subject/i);
    assert.match(probe, /duplicate conflicting/i);
    assert.match(probe, /one valid subject/i);
    assert.match(probe, /account_deletion_state/i);
    assert.match(probe, /account_deletion_provider_secrets/i);
    assert.match(probe, /account_deletion_log/i);
    assert.match(probe, /localhost.*127\.0\.0\.1.*::1/s);
  });

  it('keeps the live-test migration count aligned with its explicit filenames', () => {
    const matrix = read('docs/testing/account-deletion-live-test-matrix.md');
    const listed = matrix.match(/`202609\d+_[^`]+\.sql`/g) ?? [];
    assert.equal(new Set(listed).size, 7);
    assert.match(matrix, /all seven applied migration versions/i);
    assert.match(matrix, /all seven listed migration versions/i);
    assert.doesNotMatch(matrix, /all four applied migration versions/i);
    assert.doesNotMatch(matrix, /all five corrective versions/i);
  });

  it('blocks assignments only for explicit irreversible states and keeps deleted/authless guards', () => {
    const migration = read(migrationPath);
    for (const name of [
      'block_deleting_organization_owner',
      'block_deleting_league_owner',
      'block_deleting_organization_member',
      'block_deleting_league_ownership',
      'block_deleting_league_membership',
    ]) {
      const definition = migration.match(new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`,
        'i',
      ))?.[0] ?? '';
      assert.ok(definition, name);
      assert.match(definition, /initiation_kind\s*=\s*'immediate'/i, name);
      assert.match(definition, /workflow_state\s+IN\s*\(\s*'irreversible'\s*,\s*'database_deleted'\s*\)/i, name);
      assert.match(definition, /auth\.users/i, name);
      assert.match(definition, /deleted_at\s+IS\s+NULL/i, name);
    }
  });

  it('cancels and scrubs legacy delayed requests while retaining terminal audit facts', () => {
    const migration = read(migrationPath);
    assert.match(migration, /UPDATE public\.account_deletion_log[\s\S]*?status\s*=\s*'cancelled'/i);
    for (const column of ['user_id', 'profile_email', 'deletion_reason', 'ip_address', 'user_agent', 'stripe_customer_id', 'error_message']) {
      assert.match(migration, new RegExp(`${column}\\s*=\\s*NULL`, 'i'), column);
    }
    assert.match(migration, /status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'failed'\s*,\s*'cancelled'\s*\)/i);
    assert.match(migration, /UPDATE public\.account_deletion_log[\s\S]*?profile_email\s*=\s*NULL[\s\S]*?WHERE status\s*=\s*'completed'/i);
    assert.match(migration, /GET DIAGNOSTICS[\s\S]*?ROW_COUNT/i);
  });

  it('disables delayed server actions and removes delayed UI', () => {
    const actions = read('apps/league-builder/src/lib/account/deletion-actions.ts');
    const page = read('apps/league-builder/src/app/[locale]/dashboard/settings/privacy/page.tsx');
    assert.match(actions, /ACCOUNT_DELETION_V1_UNAVAILABLE/);
    assert.doesNotMatch(actions, /createServiceRoleClient|\.from\(|\.rpc\(|fetch\(/);
    assert.doesNotMatch(page, /requestAccountDeletion|cancelAccountDeletion|getAccountDeletionStatus/);
    assert.doesNotMatch(page, /scheduled for deletion|grace period|cancel deletion/i);
    assert.match(page, /Hockey Life mobile app/i);
  });

  it('returns explicit unavailable guidance from every user compatibility action', async () => {
    assert.deepEqual(await requestAccountDeletion('must not be stored'), {
      success: false,
      code: 'scheduled_deletion_unavailable_v1',
      error: ACCOUNT_DELETION_V1_UNAVAILABLE,
    });
    assert.deepEqual(await cancelAccountDeletion(), {
      success: false,
      code: 'scheduled_deletion_unavailable_v1',
      error: ACCOUNT_DELETION_V1_UNAVAILABLE,
    });
    assert.deepEqual(await getAccountDeletionStatus(), {
      available: false,
      hasPendingDeletion: false,
      code: 'scheduled_deletion_unavailable_v1',
      guidance: ACCOUNT_DELETION_V1_UNAVAILABLE,
    });
  });

  it('keeps the worker retry-only and never starts destructive database deletion', () => {
    const processor = read('supabase/functions/process-account-deletions/index.ts');
    assert.doesNotMatch(processor, /from\('account_deletion_log'\)/);
    assert.doesNotMatch(processor, /prepare_account_deletion|execute_account_deletion|claim_account_deletion_reminders/);
    assert.match(processor, /eq\('initiation_kind', 'immediate'\)/);
    assert.match(processor, /eq\('workflow_state', 'database_deleted'\)/);
    assert.match(processor, /results\.failed\s*===\s*0\s*\?\s*200\s*:\s*500/);
  });

  it('uses one precise contact-submission privacy statement', () => {
    const privacy = read('apps/mobile/APP_STORE_PRIVACY.md');
    const claim = /exact normalized account-email matches are deleted; unattributable guest\/shared-email submissions may remain under disclosed support\/retention handling\./gi;
    assert.equal([...privacy.matchAll(claim)].length, 1);
    assert.doesNotMatch(privacy, /not automatically deleted by authenticated account deletion/i);
  });

  it('wraps the loopback-only race harness in async main error handling', () => {
    const harness = read('scripts/tests/account-deletion-ownership-race.ts');
    assert.match(harness, /async function main\(\)/);
    assert.match(harness, /main\(\)\.catch/);
    assert.doesNotMatch(harness, /^await\s/m);
    assert.match(harness, /localhost.*127\.0\.0\.1.*::1/s);
  });
});
