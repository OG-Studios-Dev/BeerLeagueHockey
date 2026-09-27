import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260927100000_hockey_life_times_editions.sql'),
  'utf8',
);

test('edition identity and concurrent generation are database guarded', () => {
  assert.match(sql, /UNIQUE \(league_id, season_id, period_start\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /NEWSPAPER_GENERATION_IN_PROGRESS/);
  assert.match(sql, /NEWSPAPER_ALREADY_PUBLISHED/);
});

test('generation leases expire, can be reclaimed, and reject stale completion or failure tokens', () => {
  assert.match(sql, /p_lease_seconds INTEGER DEFAULT 120/);
  assert.match(sql, /v_row\.lease_expires_at > now\(\)/);
  assert.match(sql, /Previous generation lease expired and was reclaimed/);
  const completion = sql.match(/CREATE OR REPLACE FUNCTION public\.complete_newspaper_generation[\s\S]*?\$\$;/)?.[0] || '';
  const failure = sql.match(/CREATE OR REPLACE FUNCTION public\.fail_newspaper_generation[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(completion, /generation_token = p_generation_token[\s\S]*lease_expires_at > now\(\)/);
  assert.match(failure, /generation_token = p_generation_token[\s\S]*lease_expires_at > now\(\)/);
  assert.match(failure, /STALE_NEWSPAPER_GENERATION/);
  assert.doesNotMatch(failure, /edition_json\s*=/);
});

test('coverage identity is a canonical Monday through Sunday week', () => {
  assert.match(sql, /CONSTRAINT newspaper_editions_canonical_week CHECK/);
  assert.match(sql, /EXTRACT\(ISODOW FROM p_period_start\) <> 1/);
  assert.match(sql, /p_period_end <> p_period_start \+ 6/);
});

test('generate completes as draft and failure does not erase the previous snapshot', () => {
  assert.match(sql, /SET edition_json = p_edition_json,\s*status = 'draft'/);
  const failureFunction = sql.match(/CREATE OR REPLACE FUNCTION public\.fail_newspaper_generation[\s\S]*?\$\$;/)?.[0] || '';
  assert.ok(failureFunction);
  assert.doesNotMatch(failureFunction, /edition_json\s*=/);
});

test('publish is explicit, versioned, atomic, and links every source game without a primary', () => {
  assert.match(sql, /p_expected_version INTEGER/);
  assert.match(sql, /v_edition\.version IS DISTINCT FROM p_expected_version/);
  assert.match(sql, /INSERT INTO public\.articles/);
  assert.match(sql, /published, published_at/);
  assert.match(sql, /article_game_tags\(article_id, game_id, is_primary\)/);
  assert.match(sql, /v_article_id, g\.id, false/);
  assert.match(sql, /INVALID_NEWSPAPER_SOURCE_GAMES/);
  assert.match(sql, /SOURCE_GAME_TENANT_MISMATCH/);
  assert.match(sql, /NEWSPAPER_TEAM_SCOPE_MISMATCH/);
  assert.match(sql, /NEWSPAPER_CONTRIBUTOR_SCOPE_MISMATCH/);
  assert.match(sql, /public\.player_stats/);
  assert.match(sql, /ps\.game_id = g\.id/);
  assert.match(sql, /ps\.league_id = v_edition\.league_id/);
  assert.match(sql, /ps\.season_id = v_edition\.season_id/);
  assert.match(sql, /article_team_tags\(article_id, team_id\)/);
  assert.match(sql, /article_player_tags\(article_id, player_id, mention_type\)/);
  assert.match(sql, /'mentioned'/);
  assert.match(sql, /ON CONFLICT \(article_id, player_id\) DO NOTHING/);
});

test('publication rejects noncanonical case-variant IDs before exact source/report set lookup', () => {
  const publish = sql.match(/CREATE OR REPLACE FUNCTION public\.publish_newspaper_edition[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(publish, /source_id !~ '\^\[0-9a-f\]/);
  assert.match(publish, /game_data ->> 'gameId' !~ '\^\[0-9a-f\]/);
  assert.match(publish, /contributor ->> 'playerId' !~ '\^\[0-9a-f\]/);
  assert.doesNotMatch(publish, /!~\*/);
  assert.doesNotMatch(publish, /lower\(game_data ->> 'gameId'\)|lower\(source\.source_id\)/);
  assert.match(publish, /count\(DISTINCT game_data ->> 'gameId'\)/);
});

test('publication atomically rechecks final scores and exact covered-week completeness', () => {
  const publish = sql.match(/CREATE OR REPLACE FUNCTION public\.publish_newspaper_edition[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(publish, /LOCK TABLE public\.games IN SHARE MODE/);
  assert.match(publish, /g\.status::text IS DISTINCT FROM 'completed'/);
  assert.match(publish, /g\.home_score IS DISTINCT FROM \(game_data ->> 'homeScore'\)::integer/);
  assert.match(publish, /g\.away_score IS DISTINCT FROM \(game_data ->> 'awayScore'\)::integer/);
  assert.match(publish, /NEWSPAPER_SOURCE_GAME_CHANGED/);
  assert.match(publish, /g\.scheduled_at AT TIME ZONE COALESCE\(l\.timezone, 'UTC'\)/);
  assert.match(publish, /FULL JOIN[\s\S]*reviewed USING \(game_id\)/);
  assert.match(publish, /NEWSPAPER_SOURCE_GAME_SET_CHANGED/);
});

test('publish keeps its eight-argument caller contract and null versions fail closed', () => {
  const publish = sql.match(/CREATE OR REPLACE FUNCTION public\.publish_newspaper_edition[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(publish, /p_image_url TEXT DEFAULT NULL\s*\)/);
  assert.doesNotMatch(publish, /p_team_ids|p_player_ids/);
  assert.match(publish, /v_edition\.version IS DISTINCT FROM p_expected_version/);
  assert.match(sql, /publish_newspaper_edition\(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT\)/);
});

test('linked canonical article fields and entity tags are database immutable', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_newspaper_article_update/);
  assert.match(sql, /NEWSPAPER_ARTICLE_IMMUTABLE/);
  assert.match(sql, /CREATE TRIGGER guard_newspaper_article_update/);
  assert.match(sql, /CREATE TRIGGER guard_newspaper_game_tags/);
  assert.match(sql, /CREATE TRIGGER guard_newspaper_team_tags/);
  assert.match(sql, /CREATE TRIGGER guard_newspaper_player_tags/);
});

test('unpublished drafts are not publicly readable and RPCs are service-only', () => {
  assert.match(sql, /a\.published = true/);
  assert.match(sql, /a\.published_at IS NOT NULL/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.begin_newspaper_generation[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.publish_newspaper_edition[\s\S]*TO service_role/);
});

test('narrative save is draft-only and optimistic-version guarded', () => {
  const saveFunction = sql.match(/CREATE OR REPLACE FUNCTION public\.save_newspaper_narrative_draft[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(saveFunction, /status = 'draft'/);
  assert.match(saveFunction, /article_id IS NULL/);
  assert.match(saveFunction, /version IS NOT DISTINCT FROM p_expected_version/);
  assert.match(saveFunction, /NEWSPAPER_PREVIEW_STALE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.save_newspaper_narrative_draft[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('public structured JSON is revoked when its linked article is unpublished', () => {
  assert.match(sql, /EXISTS \(\s*SELECT 1 FROM public\.articles a/);
  assert.match(sql, /a\.id = newspaper_editions\.article_id/);
  assert.match(sql, /a\.published = true/);
  assert.match(sql, /a\.published_at IS NOT NULL/);
});
