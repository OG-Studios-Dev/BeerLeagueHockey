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
