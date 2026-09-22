import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const repositoryRoot = resolve(process.cwd());
const migrationRelativePath =
  'supabase/migrations/20260921160000_harden_account_deletion.sql';
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const liveMatrixPath = resolve(
  repositoryRoot,
  'docs/testing/account-deletion-live-test-matrix.md',
);

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const sql = readIfPresent(migrationPath);
const normalizedSql = sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

function functionDefinition(name: string): string {
  const match = sql.match(
    new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$function\\$;`,
      'i',
    ),
  );
  assert.ok(match, `missing public.${name} definition`);
  return match[0];
}

describe('corrective account deletion migration', () => {
  it('is a new, transactional, narrowly scoped migration', () => {
    assert.ok(sql.length > 0, `missing ${migrationRelativePath}`);
    assert.match(sql, /^\s*BEGIN;/i);
    assert.match(sql, /COMMIT;\s*$/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+(?:auth\.)?users\b/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+public\.profiles\b/i);
    assert.doesNotMatch(sql, /ON\s+DELETE\s+CASCADE/i);
    assert.doesNotMatch(sql, /information_schema|pg_catalog\.pg_constraint/i);
    assert.doesNotMatch(
      sql,
      /DELETE\s+FROM\s+public\.(?:games|game_events|player_stats|goalie_stats|stat_changes|player_season_stats)\b/i,
    );
  });

  it('makes both retention helpers safe when their optional tables are absent', () => {
    const audit = functionDefinition('anonymize_audit_logs');
    const payments = functionDefinition('anonymize_payment_history');

    assert.match(
      audit,
      /pg_catalog\.to_regclass\('public\.audit_logs'\)\s+IS\s+NULL[\s\S]*?RETURN\s+0/i,
    );
    assert.match(audit, /UPDATE\s+public\.audit_logs/i);
    assert.match(
      payments,
      /pg_catalog\.to_regclass\('public\.stripe_payment_history'\)\s+IS\s+NULL[\s\S]*?RETURN\s+0/i,
    );
    assert.match(payments, /UPDATE\s+public\.stripe_payment_history/i);
    assert.match(payments, /pg_catalog\.gen_random_uuid\(\)/i);
    assert.doesNotMatch(payments, /md5\s*\(\s*\$1/i);
  });

  it('schema-qualifies and hardens every security-definer deletion function', () => {
    for (const name of [
      'anonymize_audit_logs',
      'anonymize_payment_history',
      'delete_user_sessions',
      'execute_account_deletion',
    ]) {
      const definition = functionDefinition(name);
      assert.match(definition, /SECURITY\s+DEFINER/i, name);
      assert.match(definition, /SET\s+search_path\s*=\s*''/i, name);
    }

    for (const table of [
      'audit_logs',
      'stripe_payment_history',
      'user_sessions',
      'profiles',
      'organizations',
      'team_messages',
      'push_subscriptions',
      'notifications',
      'user_notification_preferences',
      'user_consents',
      'team_rosters',
      'league_memberships',
      'account_deletion_log',
    ]) {
      assert.doesNotMatch(
        normalizedSql,
        new RegExp(`(?:FROM|UPDATE|DELETE FROM) (?!public\\.)${table}\\b`, 'i'),
        table,
      );
    }
  });

  it('deletes only the enumerated account-facing rows', () => {
    const master = functionDefinition('execute_account_deletion');
    const deletions: Array<[string, string]> = [
      ['public.team_messages', 'sent_by'],
      ['public.push_subscriptions', 'user_id'],
      ['public.notifications', 'user_id'],
      ['public.user_notification_preferences', 'user_id'],
      ['public.user_consents', 'user_id'],
      ['public.user_sessions', 'user_id'],
      ['public.team_rosters', 'player_id'],
      ['public.league_memberships', 'user_id'],
    ];

    for (const [table, column] of deletions) {
      assert.match(
        master,
        new RegExp(
          `DELETE\\s+FROM\\s+${table.replace('.', '\\.')}`
            + `\\s+WHERE\\s+${column}\\s*=\\s*p_user_id\\s*;`,
          'i',
        ),
        table,
      );
    }

    const publicDeleteTargets = [
      ...master.matchAll(/DELETE\s+FROM\s+(public\.[a-z_]+)/gi),
    ].map((match) => match[1].toLowerCase());
    assert.deepEqual(
      [...new Set(publicDeleteTargets)].sort(),
      deletions.map(([table]) => table).sort(),
    );
  });

  it('fully anonymizes profile PII and clears account security state', () => {
    const master = functionDefinition('execute_account_deletion');
    const requiredAssignments = [
      'email',
      'full_name',
      'avatar_url',
      'phone',
      'city',
      'province',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_relationship',
      'medical_notes',
      'photo_url',
      'stripe_customer_id',
      'security_question',
      'security_answer_hash',
      'pending_legacy_match_ids',
      'legacy_player_id',
      'deletion_reason',
      'deletion_ip_address',
      'deletion_user_agent',
      'is_platform_admin',
      'role',
      'failed_login_attempts',
      'last_failed_login_at',
      'locked_until',
      'password_changed_at',
      'push_token',
    ];

    assert.match(master, /UPDATE\s+public\.profiles\s+SET/i);
    for (const column of requiredAssignments) {
      assert.match(master, new RegExp(`\\b${column}\\s*=`, 'i'), column);
    }
    for (const column of [
      'avatar_url',
      'phone',
      'city',
      'province',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_relationship',
      'medical_notes',
      'photo_url',
      'stripe_customer_id',
      'security_question',
      'security_answer_hash',
      'legacy_player_id',
      'deletion_reason',
      'deletion_ip_address',
      'deletion_user_agent',
      'role',
      'last_failed_login_at',
      'locked_until',
      'password_changed_at',
      'push_token',
      'availability',
    ]) {
      assert.match(master, new RegExp(`\\b${column}\\s*=\\s*NULL`, 'i'), column);
    }
    assert.match(master, /full_name\s*=\s*'Deleted User'/i);
    assert.match(master, /is_legacy_import\s*=\s*FALSE/i);
    assert.match(master, /is_platform_admin\s*=\s*FALSE/i);
    assert.match(master, /failed_login_attempts\s*=\s*0/i);
    assert.match(master, /pending_legacy_match_ids\s*=\s*ARRAY\[\]::uuid\[\]/i);
    assert.doesNotMatch(master, /'email'\s*,\s*v_email/i);
  });

  it('rejects organization owners before mutation and preserves the retained profile', () => {
    const master = functionDefinition('execute_account_deletion');
    const ownerCheck = master.search(/FROM\s+public\.organizations/i);
    const firstMutation = master.search(/(?:UPDATE|DELETE\s+FROM)\s+public\./i);
    assert.ok(ownerCheck >= 0);
    assert.ok(firstMutation > ownerCheck, 'owner rejection must precede mutation');
    assert.match(
      master,
      /Cannot delete account: user owns % organizations\. Transfer ownership first\./,
    );
    assert.match(
      master,
      /FROM\s+public\.profiles\s+AS\s+p[\s\S]*?WHERE\s+p\.id\s*=\s*p_user_id\s+FOR\s+UPDATE/i,
    );

    const profileUpdate = master.indexOf('UPDATE public.profiles');
    const authDelete = master.indexOf('DELETE FROM auth.users');
    const retentionCheck = master.indexOf('IF NOT EXISTS', authDelete);
    const logUpdate = master.indexOf('UPDATE public.account_deletion_log');
    assert.ok(profileUpdate >= 0 && authDelete > profileUpdate);
    assert.ok(retentionCheck > authDelete);
    assert.ok(logUpdate > retentionCheck);
    assert.match(
      master,
      /IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.profiles[\s\S]*?RAISE\s+EXCEPTION/i,
    );
  });

  it('removes the auth user and treats partial deletion as an atomic failure', () => {
    const master = functionDefinition('execute_account_deletion');
    assert.match(master, /DELETE\s+FROM\s+auth\.users\s+WHERE\s+id\s*=\s*p_user_id\s*;/i);
    assert.match(master, /GET\s+DIAGNOSTICS\s+v_auth_users_deleted\s*=\s*ROW_COUNT/i);
    assert.match(master, /IF\s+v_auth_users_deleted\s*<>\s*1[\s\S]*?RAISE\s+EXCEPTION/i);
    assert.doesNotMatch(master, /EXCEPTION\s+WHEN\s+OTHERS/i);
  });

  it('uses unlinkable profile pseudonyms and reports optional deletion-log completion', () => {
    const master = functionDefinition('execute_account_deletion');
    assert.match(
      master,
      /email\s*=\s*'deleted_'\s*\|\|\s*pg_catalog\.replace\(\s*pg_catalog\.gen_random_uuid\(\)::text/i,
    );
    assert.doesNotMatch(master, /email\s*=.*md5\s*\(\s*p_user_id/i);
    assert.match(
      master,
      /GET\s+DIAGNOSTICS\s+v_deletion_logs_completed\s*=\s*ROW_COUNT/i,
    );
    assert.match(
      master,
      /'deletion_logs_completed'\s*,\s*v_deletion_logs_completed/i,
    );
  });

  it('makes service_role the only API role with execute privileges', () => {
    const signatures = [
      'public.anonymize_audit_logs(uuid)',
      'public.anonymize_payment_history(uuid, text)',
      'public.delete_user_sessions(uuid)',
      'public.execute_account_deletion(uuid)',
    ];

    for (const signature of signatures) {
      const escaped = signature.replace(/[().]/g, '\\$&').replace(/, /g, ',\\s*');
      assert.match(
        sql,
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}`
            + `\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
          'i',
        ),
        signature,
      );
      assert.match(
        sql,
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}`
            + `\\s+TO\\s+service_role\\s*;`,
          'i',
        ),
        signature,
      );
    }

    assert.doesNotMatch(
      sql,
      /GRANT\s+EXECUTE[\s\S]*?\sTO\s+(?:PUBLIC|anon|authenticated)\s*;/i,
    );
  });

  it('ships an exact post-apply live verification matrix', () => {
    const matrix = readIfPresent(liveMatrixPath);
    for (const scenario of [
      'LIVE-01',
      'LIVE-02',
      'LIVE-03',
      'LIVE-04',
      'LIVE-05',
      'LIVE-06',
    ]) {
      assert.match(matrix, new RegExp(`\\b${scenario}\\b`), scenario);
    }
    assert.match(matrix, /anon.*denied/i);
    assert.match(matrix, /authenticated.*denied/i);
    assert.match(matrix, /service_role.*allowed/i);
    assert.match(matrix, /audit_logs.*absent/i);
    assert.match(matrix, /stripe_payment_history.*absent/i);
    assert.match(matrix, /historical.*unchanged/i);
    assert.match(matrix, /atomic.*rollback/i);
    assert.match(matrix, /metadata JSON.*intentionally discarded/i);
    assert.match(matrix, /zero processing deletion-log rows/i);
  });
});
