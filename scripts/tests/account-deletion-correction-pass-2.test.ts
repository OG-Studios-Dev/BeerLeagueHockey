import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());
const migrationPath = resolve(
  root,
  'supabase/migrations/20260922170000_account_deletion_correction_pass_2.sql',
);
const raceHarnessPath = resolve(root, 'scripts/tests/account-deletion-ownership-race.ts');
const operationalFixturePath = resolve(
  root,
  'supabase/tests/account_deletion_operational_authority_acceptance.sql',
);
const databaseTypesPath = resolve(root, 'packages/database/src/types.ts');
const scheduledProcessorPath = resolve(
  root,
  'supabase/functions/process-account-deletions/index.ts',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function definition(name: string): string {
  const match = sql.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$function\\$;`,
    'i',
  ));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

describe('account deletion correction pass 2', () => {
  it('uses server-derived Apple identity and a durable provider-secret retry handoff', () => {
    const prepare = definition('prepare_account_deletion');
    const stage = definition('stage_account_apple_revocation');
    const claim = definition('get_account_apple_revocation_retry');
    const complete = definition('mark_account_apple_revoked');

    assert.match(prepare, /auth\.identities[\s\S]*?provider\s*=\s*'apple'/i);
    assert.match(prepare, /apple_subject/i);
    assert.match(stage, /p_apple_subject[\s\S]*?p_revocation_token[\s\S]*?p_token_type_hint/i);
    assert.match(stage, /v_server_subject\s+IS\s+DISTINCT\s+FROM\s+p_apple_subject/i);
    assert.match(claim, /apple_revocation_token[\s\S]*?apple_token_type_hint/i);
    assert.match(complete, /apple_revoked_subject[\s\S]*?apple_revoked_at[\s\S]*?DELETE\s+FROM\s+public\.account_deletion_provider_secrets/i);
    assert.match(prepare, /apple_revoked_subject\s*=\s*v_apple_subject/i);
    assert.match(prepare, /v_apple_identity_count\s*=\s*0[\s\S]*?account_deletion_provider_secrets/i);
    assert.match(sql, /apple_revoked_subject\s*=\s*\([\s\S]*?auth\.identities/i);
    assert.match(definition('execute_account_deletion'), /NOT\s+EXISTS\s*\([\s\S]*?account_deletion_provider_secrets/i);
  });

  it('serializes preflight and ownership writers and rejects ineligible owners', () => {
    const lock = definition('lock_account_deletion_user');
    const prepare = definition('prepare_account_deletion');
    const organization = definition('block_deleting_organization_owner');
    const league = definition('block_deleting_league_owner');
    const organizationMember = definition('block_deleting_organization_member');
    const leagueOwnership = definition('block_deleting_league_ownership');

    assert.match(lock, /pg_advisory_xact_lock/i);
    assert.match(prepare, /lock_account_deletion_user\(p_user_id\)[\s\S]*?organizations[\s\S]*?leagues/i);
    for (const trigger of [organization, league, organizationMember, leagueOwnership]) {
      assert.match(trigger, /lock_account_deletion_user/i);
      assert.match(trigger, /auth\.users/i);
      assert.match(trigger, /profiles[\s\S]*?deleted_at\s+IS\s+NULL/i);
      assert.match(trigger, /account_deletion_state/i);
    }
    assert.match(sql, /UPDATE\s+OF\s+owner_id\s*,\s*created_by\s+ON\s+public\.leagues/i);
    assert.match(sql, /UPDATE\s+OF\s+user_id\s*,\s*role\s*,\s*status\s+ON\s+public\.organization_members/i);
    assert.match(sql, /UPDATE\s+OF\s+user_id\s*,\s*role\s*,\s*league_id\s*,\s*organization_id\s+ON\s+public\.league_ownerships/i);
  });

  it('removes every open or future operational selection surface', () => {
    const deletion = definition('execute_account_deletion');
    for (const table of [
      'game_checkins',
      'player_availability',
      'sub_invitations',
      'captain_player_invites',
      'league_spare_pool',
      'draft_pool',
      'season_opt_ins',
      'game_duties',
      'game_scorekeeper_assignments',
      'team_invites',
      'duty_rotation_settings',
      'scorekeeper_swap_requests',
      'registration_submissions',
      'suspensions',
      'league_ownerships',
      'organization_members',
    ]) {
      assert.match(deletion, new RegExp(`(?:DELETE\\s+FROM|UPDATE)\\s+public\\.${table}\\b`, 'i'), table);
    }
    assert.match(deletion, /game_checkins[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /sub_invitations[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /game_duties[\s\S]*?gd\.status\s*=\s*'completed'[\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /league_spare_pool[\s\S]*?active\s*=\s*FALSE/i);
    assert.match(deletion, /draft_pool[\s\S]*?DELETE/i);
    assert.match(deletion, /array_remove\(player_order\s*,\s*p_user_id::text\)/i);
    assert.match(deletion, /registration_submissions[\s\S]*?status\s*=\s*'cancelled'/i);
    assert.match(deletion, /DELETE\s+FROM\s+public\.suspensions[\s\S]*?NOT\s+IN\s*\(\s*'served'\s*,\s*'denied'\s*\)/i);
    assert.match(deletion, /team_rosters[\s\S]*?end_date\s*=\s*COALESCE[\s\S]*?max\([\s\S]*?g\.status\s*=\s*'completed'/i);
    assert.match(deletion, /games\s+SET\s+unlocked_by\s*=\s*NULL/i);
  });

  it('validates exact dynamic SQL column types, nullability, and keys before side effects', () => {
    const validation = definition('validate_optional_deletion_relations');
    assert.match(validation, /uuid[\s\S]*?atttypid/i);
    assert.match(validation, /attnotnull/i);
    assert.match(validation, /pg_constraint[\s\S]*?contype\s*=\s*'p'/i);
    assert.match(validation, /jsonb/i);
    assert.match(validation, /text/i);
  });

  it('pins transitive helper security properties and effective grants', () => {
    for (const helper of [
      'require_auth_for_active_profile',
      'preserve_auth_for_active_profile',
      'anonymize_audit_logs',
      'delete_user_sessions',
      'delete_push_device_tokens',
    ]) {
      const args = helper.includes('active_profile') ? '' : 'uuid';
      assert.match(sql, new RegExp(`ALTER\\s+FUNCTION\\s+public\\.${helper}\\(${args}\\)\\s+OWNER\\s+TO\\s+postgres`, 'i'));
      assert.match(sql, new RegExp(`ALTER\\s+FUNCTION\\s+public\\.${helper}\\(${args}\\)\\s+SET\\s+search_path\\s*=\\s*''`, 'i'));
      assert.match(sql, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${helper}\\(${args}\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
      if (args) {
        assert.match(sql, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${helper}\\(${args}\\)\\s+TO\\s+service_role`, 'i'));
      }
    }
    assert.match(sql, /prosecdef[\s\S]*?proowner[\s\S]*?proacl/i);
    assert.match(sql, /has_function_privilege\('authenticated'\s*,\s*expected\.signature\s*,\s*'EXECUTE'\)/i);
  });

  it('ships a source-bound two-session PostgreSQL ownership race harness', () => {
    assert.ok(existsSync(raceHarnessPath), 'missing ownership race harness');
    const harness = readFileSync(raceHarnessPath, 'utf8');
    assert.match(harness, /new Client/g);
    assert.match(harness, /prepare_account_deletion/i);
    assert.match(harness, /UPDATE public\.leagues SET owner_id/i);
    assert.match(harness, /account deletion/i);
  });

  it('ships a rollback-only database fixture proving no future operation selects the UUID', () => {
    assert.ok(existsSync(operationalFixturePath), 'missing operational-authority SQL fixture');
    const fixture = readFileSync(operationalFixturePath, 'utf8');
    assert.match(fixture, /^--[\s\S]*?BEGIN;[\s\S]*?ROLLBACK;\s*$/i);
    assert.match(fixture, /execute_account_deletion/i);
    assert.match(fixture, /v_operational_rows\s*<>\s*0/i);
    for (const table of [
      'game_checkins', 'player_availability', 'sub_invitations',
      'captain_player_invites', 'draft_pool', 'season_opt_ins',
      'game_duties', 'game_scorekeeper_assignments', 'team_invites',
      'team_rosters', 'league_spare_pool', 'game_team_lineups',
      'duty_rotation_settings', 'scorekeeper_swap_requests',
      'registration_submissions', 'suspensions',
      'organization_members', 'league_ownerships',
    ]) {
      assert.match(fixture, new RegExp(`public\\.${table}\\b`, 'i'), table);
    }
  });

  it('keeps generated database contracts aligned with new secret and workflow relations', () => {
    const types = readFileSync(databaseTypesPath, 'utf8');
    assert.match(types, /account_deletion_provider_secrets:\s*\{[\s\S]*?apple_revocation_token: string/i);
    assert.match(types, /account_deletion_state:\s*\{[\s\S]*?apple_revoked_subject: string \| null/i);
    assert.match(types, /captain_player_invites:\s*\{[\s\S]*?target_player_id: string/i);
    assert.match(types, /league_spare_pool:\s*\{[\s\S]*?active: boolean[\s\S]*?player_id: string/i);
    assert.match(types, /game_team_lineups:\s*\{[\s\S]*?layout_json: Json/i);
    assert.match(types, /stage_account_apple_revocation:\s*\{/i);
    assert.match(types, /get_account_apple_revocation_retry:\s*\{/i);
  });

  it('does not persist raw provider or database exception messages', () => {
    const processor = readFileSync(scheduledProcessorPath, 'utf8');
    assert.doesNotMatch(processor, /last_error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/i);
    assert.doesNotMatch(processor, /error_message:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/i);
    assert.match(processor, /last_error:\s*'External deletion attempt failed; retry is required\.'/i);
  });
});
