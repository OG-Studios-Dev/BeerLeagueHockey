import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const migrationPath = 'supabase/migrations/20260930142000_player_claim_authorization.sql';
const sql = readFileSync(migrationPath, 'utf8');

describe('player claim authorization migration contract', () => {
  it('exposes only the admin-approved destructive claim RPC to service_role', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_merge_legacy_profile\(\s*p_actor_profile_id uuid,\s*p_target_profile_id uuid,\s*p_source_profile_id uuid/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_merge_legacy_profile\(uuid, uuid, uuid\)\s+TO service_role/i);
    for (const signature of [
      String.raw`merge_legacy_profile\(uuid, uuid\)`,
      String.raw`claim_rostered_player_profile\(uuid, uuid\)`,
      String.raw`_claim_update_uuid_column_if_exists\(text, text, uuid, uuid\)`,
      String.raw`_merge_legacy_profile_core\(uuid, uuid\)`,
      String.raw`_claim_rostered_player_profile_core\(uuid, uuid\)`,
      String.raw`_lock_player_merge_identities\(uuid, uuid, uuid\)`,
    ]) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]{0,120}FROM PUBLIC, anon, authenticated, service_role`, 'i'));
    }
    assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES/i);
  });

  it('serializes identities and enforces active auth target and authless source', () => {
    assert.equal((sql.match(/public\.profile_auth_identity:/g) || []).length, 1);
    assert.match(sql, /_lock_player_merge_identities[\s\S]*?array_agg\(ids\.id ORDER BY ids\.id\)[\s\S]*?ORDER BY p\.id\s+FOR UPDATE[\s\S]*?ORDER BY u\.id\s+FOR SHARE/i);
    assert.match(sql, /admin path[\s\S]*?_lock_player_merge_identities\(\s*p_actor_profile_id, p_target_profile_id, p_source_profile_id\s*\)[\s\S]*?FOR SHARE OF p, u[\s\S]*?FOR UPDATE/i);
    assert.match(sql, /JOIN auth\.users AS u ON u\.id = p\.id[\s\S]*?u\.deleted_at IS NULL/i);
    assert.match(sql, /p\.identity_provenance = 'auth_account'/i);
    assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM auth\.users AS u WHERE u\.id = p_source_profile_id/i);
    assert.match(sql, /p\.deleted_at IS NULL[\s\S]*?p\.legacy_merge_completed_at IS NULL/i);
    assert.match(sql, /p_require_roster[\s\S]*?public\.team_rosters/i);
  });

  it('retains the complete deployed cores and fails closed on unsuccessful results', () => {
    assert.match(sql, /ALTER FUNCTION public\.merge_legacy_profile\(uuid, uuid\)\s+RENAME TO _merge_legacy_profile_core/i);
    assert.match(sql, /ALTER FUNCTION public\.claim_rostered_player_profile\(uuid, uuid\)\s+RENAME TO _claim_rostered_player_profile_core/i);
    assert.match(sql, /_merge_legacy_profile_core[\s\S]*?NOT COALESCE\(\(v_result ->> 'success'\)::boolean, false\)/i);
    assert.match(sql, /_claim_rostered_player_profile_core[\s\S]*?NOT COALESCE\(\(v_result ->> 'success'\)::boolean, false\)/i);
    assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.profiles WHERE id = p_legacy_profile_id\)/i);
    assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.profiles WHERE id = p_claim_profile_id\)/i);
    assert.match(sql, /public\.player_stats AS source_stat[\s\S]*?target_stat\.game_id = source_stat\.game_id/i);
    assert.doesNotMatch(sql, /target_stat\.season_id = source_stat\.season_id/);
  });

  it('closes captain invite table access and guards consumption integrity', () => {
    assert.match(sql, /ALTER TABLE public\.captain_player_invites ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /REVOKE ALL ON TABLE public\.captain_player_invites FROM PUBLIC, anon, authenticated/i);
    assert.match(sql, /GRANT ALL ON TABLE public\.captain_player_invites TO service_role/i);
    assert.match(sql, /BEFORE INSERT OR UPDATE OF consumed_at, consumed_by/i);
    assert.match(sql, /NEW\.consumed_by IS DISTINCT FROM NEW\.target_player_id/i);
    assert.match(sql, /Captain invite consumption receipts are immutable/i);
  });

  it('captures only pending source invites and finalizes after successful merge', () => {
    const capture = sql.indexOf('INTO v_invite_ids');
    const merge = sql.indexOf('v_result := public.merge_legacy_profile');
    const finalize = sql.indexOf('SET consumed_by = p_target_profile_id');
    assert.ok(capture > 0 && capture < merge && merge < finalize);
    assert.match(sql, /i\.id = ANY\(v_invite_ids\)[\s\S]*?i\.target_player_id = p_target_profile_id[\s\S]*?i\.consumed_at IS NULL/i);
    assert.match(sql, /v_updated_invites <> v_expected_invites[\s\S]*?finalization race detected/i);
  });
});
