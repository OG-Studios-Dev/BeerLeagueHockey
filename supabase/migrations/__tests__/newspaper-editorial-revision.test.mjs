import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../20261003190000_newspaper_editorial_revisions.sql', import.meta.url);
const sql = await readFile(migration, 'utf8');

test('revision RPC is service-role-only and checks the real actor authority', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.revise_published_newspaper_edition[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.revise_published_newspaper_edition[\s\S]*TO service_role/);
  assert.match(sql, /lm\.user_id = p_changed_by/);
  assert.match(sql, /p\.id = p_changed_by AND p\.is_platform_admin = true/);
  assert.match(sql, /p_changed_by IS DISTINCT FROM 'add94b26-b344-459f-9727-8cddae9783de'::uuid/);
});

test('revision is compare-and-set and locks the exact linked published rows', () => {
  for (const token of ['FOR UPDATE OF ne, a', 'p_expected_version', 'p_expected_edition_sha256', 'p_expected_content_sha256', 'INVALID_NEWSPAPER_REVISION_HASH', 'NEWSPAPER_REVISION_STALE', 'NEWSPAPER_REVISION_LINK_MISMATCH', 'NEWSPAPER_REVISION_TENANT_MISMATCH']) {
    assert.match(sql, new RegExp(token));
  }
});

test('revision freezes facts, identity, media, tags and revalidates fresh records', () => {
  for (const token of ['newspaper_editorial_frozen_projection', 'NEWSPAPER_REVISION_FROZEN_FIELD', 'INVALID_EDITORIAL_KEYS', 'LOCK TABLE public.games IN SHARE MODE', 'NEWSPAPER_SOURCE_GAME_CHANGED', 'NEWSPAPER_UPCOMING_GAME_CHANGED', 'NEWSPAPER_UPCOMING_GAME_SET_CHANGED', 'NEWSPAPER_SCORING_FACTS_CHANGED', 'NEWSPAPER_STANDINGS_SET_CHANGED', 'NEWSPAPER_POINT_LEADERS_CHANGED', 'team_standings', 'profiles', 'article_game_tags', 'article_team_tags', 'article_player_tags']) {
    assert.match(sql, new RegExp(token));
  }
});

test('uses live-compatible PostgreSQL constructs and remains outer-transaction composable', () => {
  assert.match(sql, /PERFORM 1[\s\S]*FOR UPDATE OF ne, a/);
  assert.match(sql, /SELECT ne\.\* INTO v_edition/);
  assert.match(sql, /SELECT a\.\* INTO v_article/);
  assert.doesNotMatch(sql, /SELECT ne, a INTO/);
  assert.doesNotMatch(sql, /jsonb_object_length/);
  assert.match(sql, /SELECT count\(\*\) FROM jsonb_object_keys\(v_current_scoring_facts\)/);
  assert.doesNotMatch(sql, /ts\.overtime_losses/);
  assert.doesNotMatch(sql, /LOCK TABLE[^;]*team_standings/);
  assert.match(sql, /\(e->>'otl'\)::int IS DISTINCT FROM 0/);
  assert.match(sql, /\(e->>'pts'\)::int IS DISTINCT FROM \(2\*\(e->>'w'\)::int\+\(e->>'t'\)::int\)/);
  assert.doesNotMatch(sql, /(^|\n)BEGIN;\s*$/m);
  assert.doesNotMatch(sql, /(^|\n)COMMIT;\s*$/m);
  assert.doesNotMatch(sql, /(?<!extensions\.)digest\(/);
});

test('scoring roles come from the locked, season-and-team-scoped roster, not empty profile positions', () => {
  assert.match(sql, /LOCK TABLE public\.team_rosters IN SHARE MODE/);
  assert.match(sql, /lower\(tr\.position::text\) AS position/);
  assert.match(sql, /tr\.player_id=ps\.player_id AND tr\.team_id=ps\.team_id AND tr\.season_id=ps\.season_id AND tr\.league_id=ps\.league_id/);
  assert.match(sql, /lower\(tr\.position::text\)='defense'/);
  assert.doesNotMatch(sql, /lower\(p\.position::text\)/);
});

test('revision is bound to the exact approved payload and fails closed on missing JSON keys', () => {
  for (const token of [
    'NEWSPAPER_REVISION_APPROVAL_MISMATCH',
    'b1418e217e4a5dca9f43d8c32ed5765c33bafaef3fdac99deff462b3ae4efd59',
    '055d19611aa265dcc83f0c01589ea03f3c3d131b71fd9dfe62d00b1709032948',
    '59cdd7efc8a0deee4c83f91fac60f0fce4b70c74c730b60460cf906fa9c71d69',
    '2ae3e1c77e030379eff595631986286b341c4bf0973605ab9816513671420867',
    "p_new_edition_json IS DISTINCT FROM p_approved_edition_canonical_json::jsonb",
  ]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(sql, /jsonb_typeof\([^\n]+\)\s*<>/);
  assert.match(sql, /jsonb_typeof\(p_new_edition_json->'editorial'\) IS DISTINCT FROM 'object'/);
});

test('private exact-row gate and rollback audit are inaccessible by default', () => {
  assert.match(sql, /transaction_id = txid_current\(\)/);
  assert.match(sql, /backend_pid = pg_backend_pid\(\)/);
  assert.match(sql, /gate\.new_content = NEW\.content/);
  assert.match(sql, /gate\.new_excerpt = NEW\.excerpt/);
  assert.match(sql, /REVOKE ALL ON public\.newspaper_article_revision_write_gate FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE ALL ON public\.newspaper_edition_revision_write_gate FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT ON public\.newspaper_editorial_revision_audit TO service_role/);
  assert.doesNotMatch(sql, /GRANT SELECT, INSERT ON public\.newspaper_editorial_revision_audit/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.newspaper_editorial_frozen_projection\(JSONB\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /PUBLISHED_NEWSPAPER_EDITION_IMMUTABLE/);
  assert.match(sql, /old_edition_json JSONB NOT NULL/);
  assert.match(sql, /new_edition_json JSONB NOT NULL/);
  assert.match(sql, /manuscript_sha256 TEXT NOT NULL/);
  assert.match(sql, /pdf_sha256 TEXT NOT NULL/);
  assert.doesNotMatch(sql, /INSERT INTO public\.(?:notifications|notification_logs)/);
});
