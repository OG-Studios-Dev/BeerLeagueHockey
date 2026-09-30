import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260930170000_profile_self_update_policy.sql', 'utf8'
);

describe('profile self-update policy migration contract', () => {
  it('fails closed unless the reviewed binding guard and exact old policy exist', () => {
    assert.match(migration, /profile_self_is_platform_admin\(\) already exists/);
    assert.match(migration, /profiles_guard_legacy_binding_columns/);
    assert.match(migration, /unexpected Users can update own profile baseline/);
    assert.match(migration, /polroles\s*=\s*ARRAY\[0::oid\]/);
  });

  it('uses a no-argument read-only definer helper with narrow ACLs', () => {
    const body = migration.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1] ?? '';
    assert.match(migration, /CREATE FUNCTION public\.profile_self_is_platform_admin\(\)/);
    assert.match(migration, /RETURNS boolean[\s\S]*?LANGUAGE sql[\s\S]*?STABLE[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
    assert.match(migration, /WHERE p\.id = auth\.uid\(\)/);
    assert.doesNotMatch(migration, /profile_self_is_platform_admin\([^)]*(uuid|text)/i);
    assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.profile_self_is_platform_admin\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.profile_self_is_platform_admin\(\)[\s\S]*?TO authenticated, service_role/);
  });

  it('alters only the recursive WITH CHECK while retaining ownership equality', () => {
    assert.match(migration, /ALTER POLICY "Users can update own profile"[\s\S]*?WITH CHECK \([\s\S]*?auth\.uid\(\) = id[\s\S]*?is_platform_admin = public\.profile_self_is_platform_admin\(\)/);
    assert.doesNotMatch(migration, /DROP POLICY|CREATE POLICY|DISABLE ROW LEVEL SECURITY/i);
  });
});
