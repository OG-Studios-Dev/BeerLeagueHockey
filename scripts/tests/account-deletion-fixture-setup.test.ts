import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const fixture = (name: string) => readFileSync(resolve(
  process.cwd(), `supabase/tests/account_deletion_${name}_acceptance.sql`,
), 'utf8');

describe('account deletion acceptance fixture setup', () => {
  for (const name of ['corrections', 'operational_authority']) {
    it(`${name} uses live profile position codes, not roster labels`, () => {
      const profiles = fixture(name).match(/INSERT INTO public\.profiles[\s\S]*?;/)?.[0];
      assert.ok(profiles, 'missing profile setup');
      assert.doesNotMatch(profiles, /'Forward'|'Defense'/);
      assert.match(profiles, /'C'/);
      assert.match(profiles, /'D'/);
    });
  }

  it('uses deployed availability and check-in status codes', () => {
    const sql = fixture('operational_authority');
    const checkins = sql.match(/INSERT INTO public\.game_checkins[\s\S]*?;/)?.[0];
    const availability = sql.match(/INSERT INTO public\.player_availability[\s\S]*?;/)?.[0];
    assert.ok(checkins && availability);
    assert.match(checkins, /'confirmed'/);
    assert.match(availability, /'available'/);
    assert.doesNotMatch(checkins + availability, /'in'/);
  });

  it('uses the deployed uuid array contract for duty rotation setup and assertions', () => {
    const sql = fixture('operational_authority');
    const rotation = sql.match(/INSERT INTO public\.duty_rotation_settings[\s\S]*?;/)?.[0];
    assert.ok(rotation, 'missing duty rotation setup');
    assert.match(rotation, /ARRAY\[[^\]]+\]::uuid\[\]/i);
    assert.match(sql, /player_order\s*@>\s*ARRAY\[v_user_id\]::uuid\[\]/i);
    assert.doesNotMatch(sql, /ARRAY\[v_user_id::text\]/i);
  });

  for (const name of ['operational_authority', 'correction_pass_3']) {
    it(`${name} reuses only profiles created by this transaction's auth trigger`, () => {
      const sql = fixture(name);
      const guard = sql.indexOf("RAISE EXCEPTION 'Acceptance fixture identity already exists'");
      assert.ok(guard >= 0 && guard < sql.indexOf('INSERT INTO auth.users'),
        'must reject pre-existing auth/profile identities before fixture insertion');
      const profiles = sql.match(/INSERT INTO public\.profiles[\s\S]*?;/)?.[0];
      assert.ok(profiles, 'missing profile setup');
      assert.match(profiles, /ON CONFLICT \(id\) DO UPDATE SET/);
      assert.doesNotMatch(sql, /DELETE FROM public\.profiles/);
    });
  }
});
