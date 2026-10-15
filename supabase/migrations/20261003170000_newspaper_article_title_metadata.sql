BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.newspaper_article_title_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newspaper_edition_id UUID NOT NULL REFERENCES public.newspaper_editions(id) ON DELETE RESTRICT,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE RESTRICT,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_title TEXT NOT NULL,
  new_title TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS newspaper_article_title_audit_article_idx
  ON public.newspaper_article_title_audit(article_id, changed_at DESC);

ALTER TABLE public.newspaper_article_title_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newspaper_article_title_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.newspaper_article_title_audit TO service_role;

CREATE TABLE IF NOT EXISTS public.newspaper_article_title_write_gate (
  transaction_id BIGINT NOT NULL,
  backend_pid INTEGER NOT NULL,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  new_title TEXT NOT NULL,
  PRIMARY KEY (transaction_id, backend_pid, article_id)
);

ALTER TABLE public.newspaper_article_title_write_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newspaper_article_title_write_gate FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_newspaper_article_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.newspaper_editions ne WHERE ne.article_id = OLD.id
  ) AND (
    NEW.league_id IS DISTINCT FROM OLD.league_id
    OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
    OR NEW.image_url IS DISTINCT FROM OLD.image_url
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.game_id IS DISTINCT FROM OLD.game_id
    OR (
      NEW.title IS DISTINCT FROM OLD.title
      AND NOT EXISTS (
        SELECT 1
        FROM public.newspaper_article_title_write_gate gate
        WHERE gate.transaction_id = txid_current()
          AND gate.backend_pid = pg_backend_pid()
          AND gate.article_id = OLD.id
          AND gate.new_title = NEW.title
      )
    )
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_ARTICLE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_newspaper_article(
  p_article_id UUID,
  p_league_id UUID,
  p_changed_by UUID,
  p_expected_title TEXT,
  p_title TEXT
) RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_article public.articles;
  v_edition_id UUID;
  v_title TEXT := btrim(p_title);
BEGIN
  IF p_title IS NULL OR v_title = '' OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_ARTICLE_TITLE';
  END IF;

  SELECT ne.id INTO v_edition_id
  FROM public.articles a
  JOIN public.newspaper_editions ne ON ne.article_id = a.id
  WHERE a.id = p_article_id
    AND a.league_id = p_league_id
    AND ne.league_id = p_league_id
  FOR UPDATE OF a, ne;

  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSPAPER_ARTICLE_NOT_FOUND'; END IF;

  SELECT * INTO STRICT v_article
  FROM public.articles
  WHERE id = p_article_id AND league_id = p_league_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.leagues l
    LEFT JOIN public.organizations o ON o.id = l.organization_id
    WHERE l.id = p_league_id
      AND (
        l.owner_id = p_changed_by
        OR l.created_by = p_changed_by
        OR o.owner_user_id = p_changed_by
        OR EXISTS (
          SELECT 1 FROM public.league_memberships lm
          WHERE lm.league_id = p_league_id
            AND lm.user_id = p_changed_by
            AND lm.status = 'active'
            AND lm.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = p_changed_by AND p.is_platform_admin = true
        )
      )
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_ARTICLE_TITLE_NOT_AUTHORIZED';
  END IF;

  IF v_article.title IS DISTINCT FROM p_expected_title THEN
    RAISE EXCEPTION 'STALE_NEWSPAPER_ARTICLE_TITLE';
  END IF;
  IF v_article.title = v_title THEN RETURN v_article; END IF;

  INSERT INTO public.newspaper_article_title_write_gate (
    transaction_id, backend_pid, article_id, new_title
  ) VALUES (
    txid_current(), pg_backend_pid(), p_article_id, v_title
  );
  UPDATE public.articles
  SET title = v_title, updated_at = clock_timestamp()
  WHERE id = p_article_id AND league_id = p_league_id
  RETURNING * INTO v_article;
  DELETE FROM public.newspaper_article_title_write_gate
  WHERE transaction_id = txid_current()
    AND backend_pid = pg_backend_pid()
    AND article_id = p_article_id;

  INSERT INTO public.newspaper_article_title_audit (
    newspaper_edition_id, article_id, league_id, changed_by, previous_title, new_title
  ) VALUES (
    v_edition_id, p_article_id, p_league_id, p_changed_by, p_expected_title, v_title
  );

  RETURN v_article;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_newspaper_article(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_newspaper_article(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

COMMIT;
