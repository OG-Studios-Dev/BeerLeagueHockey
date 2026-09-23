import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260922120000_account_deletion_review_corrections.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const retentionMatrix = readFileSync(
  resolve(process.cwd(), 'docs/account-deletion-retention-matrix.md'),
  'utf8',
);
const scheduledProcessor = readFileSync(
  resolve(process.cwd(), 'supabase/functions/process-account-deletions/index.ts'),
  'utf8',
);

function definition(name: string): string {
  const match = sql.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$function\\$;`,
    'i',
  ));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

describe('security-review account deletion corrections', () => {
  it('ships a rerunnable SQL acceptance fixture for both historical-stat paths', () => {
    const fixturePath = resolve(
      process.cwd(),
      'supabase/tests/account_deletion_corrections_acceptance.sql',
    );
    assert.ok(existsSync(fixturePath), 'missing SQL acceptance fixture');
    const fixture = readFileSync(fixturePath, 'utf8');
    assert.match(fixture, /BEGIN;[\s\S]*ROLLBACK;/i);
    assert.match(fixture, /roster-only/i);
    assert.match(fixture, /stat-backed/i);
    assert.match(fixture, /player_season_stats/i);
    assert.match(fixture, /routine_privileges/i);
  });

  it('validates every optional dynamic-cleanup relation before storage mutation', () => {
    const validation = definition('validate_optional_deletion_relations');
    assert.match(validation, /push_device_tokens[\s\S]*?user_id/i);
    assert.match(validation, /audit_logs[\s\S]*?user_id[\s\S]*?details[\s\S]*?ip_address[\s\S]*?user_agent/i);
    assert.match(validation, /stripe_payment_history[\s\S]*?stripe_customer_id[\s\S]*?metadata/i);
    assert.match(validation, /relkind[\s\S]*?'r'[\s\S]*?'p'/i);
    assert.match(scheduledProcessor, /prepare_account_deletion[\s\S]*?removeOwnedStorage/i);
  });

  it('retires active roster authority while preserving roster-only and stat-backed history', () => {
    assert.ok(sql, 'missing forward-only correction migration');
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+historical_retained\s+boolean/i);
    const deletion = definition('execute_account_deletion');
    assert.doesNotMatch(deletion, /DELETE\s+FROM\s+public\.team_rosters/i);
    assert.match(
      deletion,
      /UPDATE\s+public\.team_rosters[\s\S]*?status\s*=\s*'inactive'[\s\S]*?leadership_role\s*=\s*NULL[\s\S]*?historical_retained\s*=\s*TRUE[\s\S]*?WHERE\s+player_id\s*=\s*p_user_id/i,
    );
    assert.match(
      sql,
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.player_season_stats[\s\S]*?tr\.status\s*=\s*'active'[\s\S]*?OR\s+tr\.historical_retained\s*=\s*TRUE/i,
    );
    assert.match(sql, /UNION[\s\S]*?FROM\s+public\.player_stats\s+ps[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /UPDATE\s+public\.teams[\s\S]*?captain_id\s*=\s*NULL[\s\S]*?captain_id\s*=\s*p_user_id/i);
    assert.match(deletion, /UPDATE\s+public\.league_scorekeepers[\s\S]*?can_edit_games\s*=\s*FALSE[\s\S]*?is_active\s*=\s*FALSE/i);
    assert.match(deletion, /UPDATE\s+public\.team_staff[\s\S]*?is_active\s*=\s*FALSE[\s\S]*?user_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.season_opt_ins[\s\S]*?player_id\s*=\s*p_user_id/i);
  });

  it('blocks all ownership authorization paths and closes reassignment races', () => {
    const prepare = definition('prepare_account_deletion');
    assert.match(prepare, /public\.organizations[\s\S]*?owner_user_id\s*=\s*p_user_id/i);
    assert.match(prepare, /public\.leagues[\s\S]*?owner_id\s*=\s*p_user_id/i);
    assert.match(sql, /CREATE\s+TRIGGER\s+leagues_block_deleting_owner[\s\S]*?UPDATE\s+OF\s+owner_id\s+ON\s+public\.leagues/i);
  });

  it('replaces the auth cascade with an active-profile auth invariant', () => {
    assert.match(sql, /DROP\s+CONSTRAINT[\s\S]*?profiles[\s\S]*?auth\.users/i);
    assert.match(sql, /CREATE\s+CONSTRAINT\s+TRIGGER\s+profiles_require_auth_while_active/i);
    assert.match(sql, /NEW\.deleted_at\s+IS\s+NULL[\s\S]*?auth\.users/i);
    assert.match(sql, /CREATE\s+TRIGGER\s+auth_users_preserve_active_profiles[\s\S]*?BEFORE\s+DELETE\s+ON\s+auth\.users/i);
    assert.match(sql, /OLD\.id[\s\S]*?p\.deleted_at\s+IS\s+NULL[\s\S]*?RETURN\s+OLD/i);
  });

  it('classifies and enforces linked PII retention field by field', () => {
    const deletion = definition('execute_account_deletion');
    const paymentHistory = definition('anonymize_payment_history');
    assert.match(deletion, /DELETE\s+FROM\s+public\.password_reset_log[\s\S]*?user_id\s*=\s*p_user_id[\s\S]*?email[\s\S]*?v_profile\.email/i);
    assert.match(deletion, /UPDATE\s+public\.player_availability[\s\S]*?reason\s*=\s*NULL[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.player_availability[\s\S]*?NOT\s+EXISTS[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /UPDATE\s+public\.registration_submissions[\s\S]*?draft_data\s*=\s*NULL[\s\S]*?photo_url\s*=\s*NULL[\s\S]*?stripe_checkout_session_id\s*=\s*NULL[\s\S]*?stripe_payment_intent_id\s*=\s*NULL/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.registration_submissions[\s\S]*?waiver_id\s+IS\s+NULL[\s\S]*?amount_paid_cents/i);
    assert.match(deletion, /UPDATE\s+public\.player_waivers[\s\S]*?user_agent\s*=\s*NULL[\s\S]*?player_id\s*=\s*p_user_id/i);
    assert.doesNotMatch(deletion, /DELETE\s+FROM\s+public\.player_waivers/i);
    assert.match(deletion, /UPDATE\s+public\.player_payments[\s\S]*?stripe_customer_id\s*=\s*NULL[\s\S]*?metadata\s*=\s*NULL[\s\S]*?notes\s*=\s*NULL/i);
    assert.match(deletion, /UPDATE\s+public\.payment_transactions[\s\S]*?stripe_payment_intent_id\s*=\s*NULL[\s\S]*?metadata\s*=\s*NULL[\s\S]*?description\s*=\s*NULL/i);
    assert.match(deletion, /UPDATE\s+public\.payments[\s\S]*?notes\s*=\s*NULL[\s\S]*?stripe_payment_intent_id\s*=\s*NULL/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.contact_submissions[\s\S]*?lower\(email\)[\s\S]*?lower\(v_profile\.email\)/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.login_attempts_log[\s\S]*?user_id\s*=\s*p_user_id[\s\S]*?email[\s\S]*?v_profile\.email/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.account_recovery_requests[\s\S]*?user_id\s*=\s*p_user_id[\s\S]*?email[\s\S]*?v_profile\.email/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.password_reset_rate_limits[\s\S]*?identifier[\s\S]*?v_profile\.email/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.league_join_requests[\s\S]*?user_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.team_join_requests[\s\S]*?player_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.player_approvals[\s\S]*?player_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.bug_reports[\s\S]*?reporter_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.draft_messages[\s\S]*?user_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.email_drafts[\s\S]*?created_by\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.team_registration_requests[\s\S]*?requester_id\s*=\s*p_user_id/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.team_registrations[\s\S]*?submitted_by\s*=\s*p_user_id/i);
    assert.match(deletion, /UPDATE\s+public\.admin_audit_log[\s\S]*?details\s*=\s*NULL[\s\S]*?ip_address\s*=\s*NULL[\s\S]*?target_user_id\s*=\s*NULL/i);
    assert.match(deletion, /UPDATE\s+public\.game_audit_log[\s\S]*?previous_data\s*=\s*NULL[\s\S]*?new_data\s*=\s*NULL[\s\S]*?reason\s*=\s*NULL/i);

    for (const table of [
      'password_reset_log',
      'login_attempts_log',
      'account_recovery_requests',
      'password_reset_rate_limits',
      'player_availability',
      'registration_submissions',
      'player_waivers',
      'player_payments',
      'payment_transactions',
      'payments',
      'contact_submissions',
      'team_rosters',
      'profiles',
      'account_deletion_state',
    ]) {
      assert.match(retentionMatrix, new RegExp('\\\\| `' + table + '` \\\\|', 'i'), table);
    }
    assert.match(retentionMatrix, /signed waiver.*not anonymized/i);
    assert.match(retentionMatrix, /payment.*not anonymized/i);
    assert.match(paymentHistory, /stripe_customer_id\s*=\s*NULL/i);
    assert.match(paymentHistory, /_retained_financial_audit/i);
    assert.doesNotMatch(paymentHistory, /_anonymized/i);
  });

  it('clears exactly one push destination for auth.uid and no client user id', () => {
    const logout = definition('clear_current_push_destination');
    assert.match(logout, /RETURNS\s+boolean/i);
    assert.match(logout, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
    assert.match(logout, /UPDATE\s+public\.profiles[\s\S]*?push_token\s*=\s*NULL[\s\S]*?id\s*=\s*v_user_id/i);
    assert.match(logout, /GET\s+DIAGNOSTICS\s+v_updated\s*=\s*ROW_COUNT/i);
    assert.match(logout, /v_updated\s*<>\s*1[\s\S]*?RAISE\s+EXCEPTION/i);
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.clear_current_push_destination\(\)\s+TO\s+authenticated/i);
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.clear_current_push_destination\(\)\s+FROM\s+PUBLIC\s*,\s*anon/i);
  });

  it('keeps retry payloads until Stripe and email complete, then finalizes exactly once', () => {
    const deletion = definition('execute_account_deletion');
    const external = definition('record_account_deletion_external_step');
    assert.doesNotMatch(deletion, /UPDATE\s+public\.account_deletion_log[\s\S]*?status\s*=\s*'completed'/i);
    assert.doesNotMatch(deletion, /UPDATE\s+public\.account_deletion_state[\s\S]*?stripe_customer_id\s*=\s*NULL/i);
    assert.doesNotMatch(deletion, /UPDATE\s+public\.account_deletion_state[\s\S]*?completion_email\s*=\s*NULL/i);
    assert.match(external, /p_step\s*=\s*'stripe'[\s\S]*?stripe_completed_at[\s\S]*?stripe_customer_id\s*=\s*NULL/i);
    assert.match(external, /p_step\s*=\s*'email'[\s\S]*?email_completed_at[\s\S]*?completion_email\s*=\s*NULL/i);
    assert.match(external, /p_step\s*=\s*'complete'[\s\S]*?database_deleted_at\s+IS\s+NULL[\s\S]*?stripe_completed_at\s+IS\s+NULL[\s\S]*?email_completed_at\s+IS\s+NULL[\s\S]*?RAISE\s+EXCEPTION/i);
    assert.match(external, /UPDATE\s+public\.account_deletion_log[\s\S]*?status\s*=\s*'completed'/i);
  });

  it('does not repeat database deletion after its durable state is complete', () => {
    assert.match(
      scheduledProcessor,
      /account_deletion_state[\s\S]*?database_deleted_at[\s\S]*?if\s*\(.*database_deleted_at[\s\S]*?execute_account_deletion/i,
    );
  });

  it('revokes unknown execute grantees and hardens default function ACLs', () => {
    assert.match(sql, /ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+postgres\s+IN\s+SCHEMA\s+public\s+REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+PUBLIC/i);
    assert.match(sql, /information_schema\.routine_privileges[\s\S]*?privilege_type\s*=\s*'EXECUTE'[\s\S]*?grantee\s+NOT\s+IN[\s\S]*?service_role/i);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION %s FROM %I/i);
  });
});
