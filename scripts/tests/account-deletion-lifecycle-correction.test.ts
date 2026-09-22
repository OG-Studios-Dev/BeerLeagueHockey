import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const repositoryRoot = resolve(process.cwd());
const migrationRelativePath =
  'supabase/migrations/20260921170000_complete_account_lifecycle_cleanup.sql';
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const matrixPath = resolve(repositoryRoot, 'docs/testing/account-deletion-live-test-matrix.md');
const databaseTypesPath = resolve(repositoryRoot, 'packages/database/src/types.ts');
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionDefinition(name: string): string {
  const match = sql.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$function\\$;`,
    'i',
  ));
  assert.ok(match, `missing public.${name} definition`);
  return match[0];
}

describe('forward-only account lifecycle cleanup migration', () => {
  it('is a separate transactional correction that keeps hockey facts', () => {
    assert.ok(sql.length > 0, `missing ${migrationRelativePath}`);
    assert.match(sql, /^\s*BEGIN;/i);
    assert.match(sql, /COMMIT;\s*$/i);
    assert.match(sql, /ALTER\s+TABLE\s+public\.profiles\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+push_token\s+text/i);
    assert.doesNotMatch(sql, /ON\s+DELETE\s+CASCADE/i);
    assert.doesNotMatch(
      sql,
      /DELETE\s+FROM\s+public\.(?:games|game_events|player_stats|goalie_stats|stat_changes|player_season_stats|player_badges)\b/i,
    );
  });

  it('removes all repository-proven push destinations', () => {
    const master = functionDefinition('execute_account_deletion');
    const optionalTokens = functionDefinition('delete_push_device_tokens');

    assert.match(master, /DELETE\s+FROM\s+public\.push_subscriptions\s+WHERE\s+user_id\s*=\s*p_user_id/i);
    assert.match(master, /v_push_device_tokens_deleted\s*:=\s*public\.delete_push_device_tokens\(p_user_id\)/i);
    assert.match(master, /push_token\s*=\s*NULL/i);
    assert.match(optionalTokens, /to_regclass\('public\.push_device_tokens'\)\s+IS\s+NULL[\s\S]*?RETURN\s+0/i);
    assert.match(optionalTokens, /DELETE\s+FROM\s+public\.push_device_tokens\s+WHERE\s+user_id\s*=\s*\$1/i);
  });

  it('keeps the checked-in profile type aligned with the new push-token column', () => {
    const types = readFileSync(databaseTypesPath, 'utf8');
    const profiles = types.match(/\n      profiles: \{[\s\S]*?\n      \}\n      registration_submissions:/)?.[0] ?? '';
    assert.match(profiles, /Row:\s*\{[\s\S]*?push_token: string \| null/);
    assert.match(profiles, /Insert:\s*\{[\s\S]*?push_token\?: string \| null/);
    assert.match(profiles, /Update:\s*\{[\s\S]*?push_token\?: string \| null/);
  });

  it('deletes ephemeral authored rows while preserving anonymized hockey facts', () => {
    const master = functionDefinition('execute_account_deletion');

    assert.match(
      master,
      /UPDATE\s+public\.sub_invitations\s+SET\s+message\s*=\s*NULL[\s\S]*?WHERE\s+status\s*=\s*'accepted'[\s\S]*?invited_by\s*=\s*p_user_id[\s\S]*?invited_player_id\s*=\s*p_user_id[\s\S]*?replaced_player_id\s*=\s*p_user_id/i,
    );
    assert.match(
      master,
      /DELETE\s+FROM\s+public\.sub_invitations[\s\S]*?WHERE\s+status\s*<>\s*'accepted'[\s\S]*?invited_by\s*=\s*p_user_id[\s\S]*?invited_player_id\s*=\s*p_user_id[\s\S]*?replaced_player_id\s*=\s*p_user_id/i,
    );
    assert.match(
      master,
      /DELETE\s+FROM\s+public\.goalie_request_notifications[\s\S]*?SELECT\s+gr\.id\s+FROM\s+public\.goalie_requests\s+AS\s+gr[\s\S]*?gr\.requested_by\s*=\s*p_user_id/i,
    );
    assert.match(
      master,
      /UPDATE\s+public\.goalie_requests\s+SET\s+notes\s*=\s*NULL\s*,\s*compensation\s*=\s*NULL\s+WHERE\s+requested_by\s*=\s*p_user_id\s+AND\s+status\s*=\s*'filled'/i,
    );
    assert.match(
      master,
      /DELETE\s+FROM\s+public\.goalie_requests\s+WHERE\s+requested_by\s*=\s*p_user_id\s+AND\s+status\s*<>\s*'filled'/i,
    );
    assert.match(master, /UPDATE\s+public\.goalie_ratings\s+SET\s+private_note\s*=\s*NULL\s+WHERE\s+rated_by\s*=\s*p_user_id/i);
    assert.doesNotMatch(master, /DELETE\s+FROM\s+public\.goalie_ratings/i);
    assert.match(master, /UPDATE\s+public\.game_checkins\s+SET\s+note\s*=\s*NULL\s+WHERE\s+player_id\s*=\s*p_user_id/i);
    assert.doesNotMatch(master, /DELETE\s+FROM\s+public\.game_checkins/i);
    assert.doesNotMatch(master, /(?:DELETE\s+FROM|UPDATE)\s+public\.contact_submissions/i);
  });

  it('removes direct identifiers from retained deletion logs and the profile', () => {
    const master = functionDefinition('execute_account_deletion');
    const logAnonymization = master.match(
      /UPDATE\s+public\.account_deletion_log\s+SET[\s\S]*?profile_email\s*=\s*'deleted_'[\s\S]*?WHERE\s+user_id\s*=\s*p_user_id\s*;/i,
    )?.[0] ?? '';

    assert.ok(logAnonymization, 'missing deletion-log identifier anonymization');
    assert.match(logAnonymization, /deletion_reason\s*=\s*NULL/i);
    assert.match(logAnonymization, /ip_address\s*=\s*NULL/i);
    assert.match(logAnonymization, /user_agent\s*=\s*NULL/i);
    assert.match(logAnonymization, /stripe_customer_id\s*=\s*NULL/i);
    assert.match(logAnonymization, /stripe_deletion_error\s*=\s*NULL/i);
    assert.doesNotMatch(logAnonymization, /status\s*=\s*'processing'/i);
    assert.match(
      master,
      /UPDATE\s+public\.account_deletion_log\s+SET\s+status\s*=\s*'completed'[\s\S]*?WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+status\s*=\s*'processing'/i,
    );
    assert.match(master, /UPDATE\s+public\.profiles[\s\S]*?push_token\s*=\s*NULL/i);
  });

  it('retains hardened caller authority and transaction ordering', () => {
    const master = functionDefinition('execute_account_deletion');
    const ownerCheck = master.search(/FROM\s+public\.organizations/i);
    const firstMutation = master.search(/(?:UPDATE|DELETE\s+FROM)\s+public\./i);
    const profileUpdate = master.search(/UPDATE\s+public\.profiles/i);
    const authDelete = master.search(/DELETE\s+FROM\s+auth\.users/i);

    assert.match(master, /SECURITY\s+DEFINER/i);
    assert.match(master, /SET\s+search_path\s*=\s*''/i);
    assert.ok(ownerCheck >= 0 && firstMutation > ownerCheck);
    assert.ok(profileUpdate >= 0 && authDelete > profileUpdate);
    assert.doesNotMatch(master, /EXCEPTION\s+WHEN\s+OTHERS/i);

    for (const signature of [
      'public.delete_push_device_tokens(uuid)',
      'public.execute_account_deletion(uuid)',
    ]) {
      const escaped = signature.replace(/[().]/g, '\\$&');
      assert.match(sql, new RegExp(
        `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
        'i',
      ));
      assert.match(sql, new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}\\s+TO\\s+service_role\\s*;`,
        'i',
      ));
    }
  });

  it('extends the live matrix for push, authored rows, storage, Apple, and unlinkable contact submissions', () => {
    const matrix = existsSync(matrixPath) ? readFileSync(matrixPath, 'utf8') : '';
    for (const scenario of ['LIVE-07', 'LIVE-08', 'LIVE-09', 'LIVE-10']) {
      assert.match(matrix, new RegExp(`\\b${scenario}\\b`), scenario);
    }
    assert.match(matrix, /contact_submissions.*no authenticated-user key/i);
    assert.match(matrix, /Apple.*revocation.*blocked/i);
    assert.match(matrix, /storage.*allowlist/i);
  });
});
