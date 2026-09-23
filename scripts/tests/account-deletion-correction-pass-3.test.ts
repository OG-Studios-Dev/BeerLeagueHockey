import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());
const migration = readFileSync(resolve(
  root,
  'supabase/migrations/20260923120000_account_deletion_correction_pass_3.sql',
), 'utf8');
const retention = readFileSync(resolve(root, 'docs/account-deletion-retention-matrix.md'), 'utf8');
const types = readFileSync(resolve(root, 'packages/database/src/types.ts'), 'utf8');
const processor = readFileSync(resolve(
  root,
  'supabase/functions/process-account-deletions/index.ts',
), 'utf8');
const race = readFileSync(resolve(
  root,
  'scripts/tests/account-deletion-ownership-race.ts',
), 'utf8');
const acceptance = readFileSync(resolve(
  root,
  'supabase/tests/account_deletion_correction_pass_3_acceptance.sql',
), 'utf8');

function definition(name: string): string {
  const match = migration.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$function\\$;`,
    'i',
  ));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

function generatedProfileReferenceTables(): string[] {
  const tables = types.slice(types.indexOf('Tables: {'), types.indexOf('Views: {'));
  const names: string[] = [];
  let current = '';
  let relationship = '';
  for (const line of tables.split('\n')) {
    const table = line.match(/^      ([a-z0-9_]+): \{$/i);
    if (table) current = table[1];
    if (line.includes('foreignKeyName:')) relationship = line;
    if (
      current
      && relationship
      && /referencedRelation: "(?:profiles|public_profiles|users)"/.test(line)
    ) {
      names.push(current);
      relationship = '';
    }
  }
  return [...new Set(names)].sort();
}

function sqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sqlFiles(path);
    return entry.isFile() && entry.name.endsWith('.sql') ? [path] : [];
  });
}

function migrationProfileReferenceTables(): string[] {
  const names = new Set<string>();
  for (const path of [
    ...sqlFiles(resolve(root, 'supabase/migrations')),
    ...sqlFiles(resolve(root, 'supabase/migrations_archive')),
  ]) {
    const source = readFileSync(path, 'utf8');
    const patterns = [
      /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\);/gi,
      /ALTER\s+TABLE\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (/REFERENCES\s+(?:public\.)?(?:profiles|auth\.users)\s*\(\s*id\s*\)/i.test(match[2])) {
          names.add(match[1]);
        }
      }
    }
  }
  return [...names].sort();
}

describe('account deletion correction pass 3', () => {
  it('locks and rechecks every league_memberships authority writer path', () => {
    const trigger = definition('block_deleting_league_membership');
    assert.match(trigger, /lock_account_deletion_user\(NEW\.user_id\)/i);
    assert.match(trigger, /auth\.users/i);
    assert.match(trigger, /deleted_at\s+IS\s+NULL/i);
    assert.match(trigger, /account_deletion_state/i);
    assert.match(migration, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+user_id\s*,\s*role\s*,\s*status\s*,\s*league_id\s+ON\s+public\.league_memberships/i);
    for (const wrapper of ['prepare_account_deletion', 'execute_account_deletion']) {
      assert.match(definition(wrapper), /league_memberships[\s\S]*?role\s*=\s*'owner'[\s\S]*?status\s*=\s*'active'/i);
    }
    for (const scenario of ['owner insert', 'admin insert', 'reassignment', 'owner promotion']) {
      assert.match(race, new RegExp(`league membership ${scenario}`, 'i'));
    }
  });

  it('classifies and removes referee and season-return authority before profile anonymization', () => {
    const cleanup = definition('cleanup_account_deletion_pass3');
    for (const table of [
      'league_referees', 'referee_availability', 'referee_sessions',
      'referee_swap_requests', 'game_officials', 'season_team_returns',
      'season_team_return_campaigns',
    ]) {
      assert.match(cleanup, new RegExp(`public\\.${table}\\b`, 'i'), table);
      assert.ok(retention.includes('`' + table + '`'), table);
    }
    assert.match(cleanup, /referee_sessions[\s\S]*?DELETE/i);
    assert.match(cleanup, /game_officials[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(cleanup, /referee_identifier_snapshot\s*=\s*NULL/i);
    assert.match(cleanup, /referee_identifier\s*=\s*NULL[\s\S]*?default_jersey_number\s*=\s*NULL/i);
    assert.match(cleanup, /season_team_returns[\s\S]*?status\s+NOT\s+IN\s*\(\s*'confirmed'\s*,\s*'declined'\s*\)/i);
    assert.match(cleanup, /captain_profile_id\s*=\s*NULL[\s\S]*?captain_email\s*=\s*NULL[\s\S]*?metadata\s*=\s*'\{\}'::jsonb/i);
    assert.match(cleanup, /ARRAY\['response_token', 'token'\]/i);
    assert.match(cleanup, /regexp_replace\(captain_phone[\s\S]*?p_phone/i);
    assert.match(cleanup, /regexp_replace\(lr\.phone[\s\S]*?p_phone/i);
    assert.match(migration, /profiles_account_deletion_pass3_cleanup[\s\S]*?BEFORE\s+UPDATE\s+OF\s+deleted_at/i);
  });

  it('guards and asserts every newly classified migration-only relation', () => {
    const newlyClassified = [
      'notification_send_log', 'league_backup_tokens', 'league_migration_requests',
      'team_invoices', 'team_invoice_payments', 'league_finance_custom_items',
      'league_quickbooks_connections', 'league_quickbooks_mappings',
      'league_quickbooks_sync_runs', 'league_quickbooks_sync_entries',
      'player_career_baselines', 'player_rating_contexts', 'draft_auto_pick_log',
      'schedule_rules', 'season_fees',
      'sponsor_placements', 'stat_definitions',
    ];
    const validation = definition('validate_optional_deletion_relations');
    const cleanup = definition('cleanup_account_deletion_pass3');
    for (const table of newlyClassified) {
      assert.match(validation, new RegExp(`'${table}'`, 'i'), `schema guard: ${table}`);
      if (!['player_rating_contexts', 'draft_auto_pick_log', 'league_quickbooks_sync_entries'].includes(table)) {
        assert.match(cleanup, new RegExp(`public\\.${table}\\b`, 'i'), `cleanup: ${table}`);
      }
      assert.ok(retention.includes('`' + table + '`'), `retention: ${table}`);
    }
    assert.match(cleanup, /league_backup_tokens[\s\S]*?revoked_at/i);
    assert.match(cleanup, /notification_send_log[\s\S]*?user_id\s*=\s*p_user_id/i);
    assert.match(cleanup, /legacy_players[\s\S]*?matched_to_profile_id\s*=\s*NULL/i);
  });

  it('keeps every generated profile relationship in the retention inventory', () => {
    const missing = generatedProfileReferenceTables().filter(
      (table) => !retention.includes(`\`${table}\``),
    );
    assert.deepEqual(missing, [], `unclassified generated profile relations: ${missing.join(', ')}`);
  });

  it('keeps every migration-chain profile/auth foreign key in the retention inventory', () => {
    const missing = migrationProfileReferenceTables().filter(
      (table) => !retention.includes(`\`${table}\``),
    );
    assert.deepEqual(missing, [], `unclassified migration profile/auth relations: ${missing.join(', ')}`);
  });

  it('classifies non-FK UUID, JSON, token, and contact linkage surfaces', () => {
    for (const table of [
      'account_deletion_log', 'account_deletion_state',
      'account_deletion_provider_secrets', 'game_team_lineups',
      'duty_rotation_settings', 'goalie_pool', 'contact_submissions',
      'goalie_request_notifications', 'draft_auto_pick_log',
      'league_backup_tokens', 'league_quickbooks_connections',
      'league_quickbooks_sync_entries', 'stripe_subscriptions',
      'season_team_returns', 'referee_sessions', 'notification_send_log',
    ]) {
      assert.ok(retention.includes(`\`${table}\``), table);
    }
  });

  it('atomically claims reminders and uses stable provider idempotency', () => {
    const claim = definition('claim_account_deletion_reminders');
    assert.match(claim, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    assert.match(claim, /reminder_7day_claimed_at/i);
    assert.match(processor, /claim_account_deletion_reminders/i);
    assert.match(processor, /Idempotency-Key/i);
    assert.match(processor, /mark_account_deletion_reminder_sent/i);
    assert.match(processor, /release_account_deletion_reminder_claim/i);
    assert.match(processor, /reminderFailures\s*===\s*0\s*\?\s*200\s*:\s*500/i);
    assert.match(race, /overlapping worker claimed the same reminder/i);
  });

  it('preserves the pinned service-role-only privilege boundary', () => {
    for (const helper of [
      'block_deleting_league_membership', 'cleanup_account_deletion_pass3',
      'run_account_deletion_pass3_cleanup', 'claim_account_deletion_reminders',
      'mark_account_deletion_reminder_sent', 'release_account_deletion_reminder_claim',
    ]) {
      assert.match(migration, new RegExp(`ALTER\\s+FUNCTION\\s+public\\.${helper}\\([\\s\\S]*?OWNER\\s+TO\\s+postgres`, 'i'), helper);
      assert.match(migration, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${helper}`, 'i'), helper);
    }
    assert.match(migration, /prosecdef[\s\S]*?proowner[\s\S]*?search_path=""/i);
    assert.match(migration, /has_function_privilege\('authenticated'[\s\S]*?has_function_privilege\('service_role'/i);
  });

  it('ships deterministic rollback-only SQL acceptance for the new lifecycle rows', () => {
    assert.match(acceptance, /^--[\s\S]*?BEGIN;[\s\S]*?ROLLBACK;\s*$/i);
    for (const table of [
      'league_referees', 'referee_sessions', 'referee_availability',
      'referee_swap_requests', 'game_officials', 'season_team_returns',
      'notification_send_log', 'league_backup_tokens',
      'league_migration_requests', 'team_invoices',
    ]) {
      assert.match(acceptance, new RegExp(`public\\.${table}\\b`, 'i'), table);
    }
  });
});
