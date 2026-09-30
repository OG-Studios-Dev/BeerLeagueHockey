import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260930100000_claimable_guest_profile_provenance.sql');
const acceptance = read('supabase/tests/claimable_guest_profiles_acceptance.sql');
const manualWriter = read('apps/league-sites/src/lib/actions/sub-invitations.ts');
const captainWriter = read('apps/league-sites/src/lib/actions/captain-player-invites.ts');
const claimMigration = read('supabase/migrations/20260703010000_merge_completeness_fix.sql');

describe('claimable guest profile provenance', () => {
  it('binds the exemption to trusted insert provenance and both exact UUID placeholder shapes', () => {
    assert.match(migration, /BEFORE INSERT ON public\.profiles/i);
    assert.match(migration, /v_request_role text := auth\.role\(\)[\s\S]*?v_request_role = 'service_role'/i);
    assert.doesNotMatch(migration, /current_user\s*=\s*['"]service_role/i);
    assert.match(migration, /manual-spare\+[\s\S]*?NEW\.id[\s\S]*?beerleaguehockey\.local/i);
    assert.match(migration, /captaininvite_[\s\S]*?NEW\.id[\s\S]*?captaininvite\.hockeylifehl\.com/i);
    assert.match(migration, /NEW\.is_legacy_import IS TRUE[\s\S]*?NEW\.role::text = 'player'/i);
    assert.match(migration, /NOT COALESCE\(NEW\.is_platform_admin, false\)/i);
    assert.match(manualWriter, /manual-spare\+\$\{playerId\}@beerleaguehockey\.local/);
    assert.match(captainWriter, /captaininvite_\$\{id\}@\$\{LEGACY_EMAIL_DOMAIN\}/);
  });

  it('stores immutable provenance and keeps auth required for ordinary active profiles', () => {
    assert.match(migration, /identity_provenance text NOT NULL DEFAULT 'auth_account'/i);
    assert.match(migration, /identity_provenance IN \('auth_account', 'claimable_guest'\)/i);
    assert.match(migration, /NEW\.identity_provenance <> 'claimable_guest'[\s\S]*?auth\.users/i);
    assert.match(migration, /Profile identity provenance is immutable/i);
    assert.match(migration, /Claimable guest profiles cannot receive account authority/i);
    assert.match(migration, /Claimable guest profiles cannot receive roster leadership/i);
    assert.match(migration, /Claimable guest profiles must be claimed into a separate authenticated profile/i);
    assert.match(migration, /OLD\.deleted_at IS NOT NULL AND NEW\.deleted_at IS NULL[\s\S]*?Deleted profiles cannot be reactivated/i);
    assert.doesNotMatch(migration, /ALTER DEFAULT PRIVILEGES/i);
  });

  it('serializes guest classification and auth attachment on the same profile key', () => {
    const lock = /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\('public\.profile_auth_identity:' \|\| NEW\.id::text, 0\)\s*\)/gi;
    assert.equal(migration.match(lock)?.length, 2);
    const classifier = migration.match(/CREATE OR REPLACE FUNCTION public\.classify_claimable_guest_profile\(\)[\s\S]*?\$function\$;/i)?.[0] || '';
    const authGuard = migration.match(/CREATE OR REPLACE FUNCTION public\.block_auth_for_claimable_guest\(\)[\s\S]*?\$function\$;/i)?.[0] || '';
    assert.ok(classifier.indexOf('pg_advisory_xact_lock') < classifier.indexOf('NOT EXISTS'));
    assert.ok(authGuard.indexOf('pg_advisory_xact_lock') < authGuard.indexOf('IF EXISTS'));
  });

  it('does not replace or weaken the reverse auth-delete guard', () => {
    assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.preserve_auth_for_active_profile/i);
    assert.doesNotMatch(migration, /DROP TRIGGER[^;]*auth_users_preserve_active_profiles/i);
  });

  it('ships rollback-only PostgreSQL acceptance for spoofing, authority, reactivation and claim preservation', () => {
    assert.match(acceptance, /^\\set ON_ERROR_STOP on\s+BEGIN;/i);
    assert.match(acceptance, /Save-to-team-spares off[\s\S]*?Save-to-team-spares on/i);
    assert.match(acceptance, /authenticated spoof[\s\S]*?anon spoof/i);
    assert.match(acceptance, /active auth deletion[\s\S]*?deleted orphan reactivation/i);
    assert.match(acceptance, /claim_rostered_player_profile\(v_claim_target, v_claim_guest\)/i);
    assert.match(acceptance, /claim transition did not preserve records/i);
    assert.match(acceptance, /ROLLBACK;\s*$/i);
  });

  it('remains compatible with the canonical claim contract: authless source, FK reassignment, source deletion', () => {
    assert.match(claimMigration, /Claim profile % is already attached to a user account/i);
    assert.match(claimMigration, /UPDATE team_rosters SET player_id = p_target_profile_id/i);
    assert.match(claimMigration, /_claim_update_uuid_column_if_exists\('game_checkins', 'player_id', p_target_profile_id, p_claim_profile_id\)/i);
    assert.match(claimMigration, /DELETE FROM profiles WHERE id = p_claim_profile_id/i);
  });
});
