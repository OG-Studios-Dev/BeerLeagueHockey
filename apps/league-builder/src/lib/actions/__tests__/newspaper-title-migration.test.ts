import fs from 'node:fs';
import path from 'node:path';

describe('newspaper title metadata migration', () => {
  it('keeps title changes scoped, audited, atomic, and unavailable to public roles', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../../../../../supabase/migrations/20261003170000_newspaper_article_title_metadata.sql'),
      'utf8',
    );

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.newspaper_article_title_audit/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.newspaper_article_title_write_gate/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.rename_newspaper_article/i);
    expect(sql).toMatch(/p_article_id UUID[\s\S]*p_league_id UUID[\s\S]*p_changed_by UUID[\s\S]*p_expected_title TEXT[\s\S]*p_title TEXT/i);
    expect(sql).toMatch(/JOIN public\.newspaper_editions ne ON ne\.article_id = a\.id[\s\S]*a\.id\s*=\s*p_article_id[\s\S]*ne\.league_id\s*=\s*p_league_id/i);
    expect(sql).toMatch(/league_memberships/i);
    expect(sql).toMatch(/organizations/i);
    expect(sql).toMatch(/profiles/i);
    expect(sql).toMatch(/INSERT INTO public\.newspaper_article_title_audit/i);
    expect(sql).toMatch(/txid_current\(\)[\s\S]*pg_backend_pid\(\)/i);
    expect(sql).not.toMatch(/set_config|current_setting/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.rename_newspaper_article[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rename_newspaper_article[\s\S]*TO service_role/i);
    expect(sql).toMatch(/p_title IS NULL[\s\S]*v_title = ''[\s\S]*length\(v_title\) > 200/i);
    expect(sql).not.toMatch(/SELECT\s+a\s*,\s*ne\.id\s+INTO\s+v_article\s*,\s*v_edition_id/i);
    expect(sql).toMatch(/SELECT ne\.id INTO v_edition_id[\s\S]*FOR UPDATE OF a, ne[\s\S]*SELECT \* INTO STRICT v_article/i);
  });

  it('leaves slug, publication, content, media, snapshot and entity tags outside the rename function', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../../../../../supabase/migrations/20261003170000_newspaper_article_title_metadata.sql'),
      'utf8',
    );
    const renameFunction = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.rename_newspaper_article'));

    expect(renameFunction).not.toMatch(/UPDATE public\.newspaper_editions/i);
    expect(renameFunction).not.toMatch(/article_(?:game|player|team)_tags/i);
    expect(renameFunction).not.toMatch(/SET\s+(?:slug|content|excerpt|image_url|published|published_at|season_id|game_id)\s*=/i);
  });
});
