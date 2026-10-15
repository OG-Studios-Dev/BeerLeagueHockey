BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.newspaper_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  issue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'published')),
  edition_json JSONB,
  article_id UUID UNIQUE REFERENCES public.articles(id) ON DELETE RESTRICT,
  generation_token UUID,
  lease_expires_at TIMESTAMPTZ,
  generation_error TEXT,
  generation_method TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  CONSTRAINT newspaper_editions_canonical_week CHECK (
    EXTRACT(ISODOW FROM period_start) = 1 AND period_end = period_start + 6
  ),
  CONSTRAINT newspaper_editions_identity UNIQUE (league_id, season_id, period_start),
  CONSTRAINT newspaper_editions_issue_number UNIQUE (league_id, issue_number)
);

ALTER TABLE public.newspaper_editions
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS newspaper_editions_public_article_idx
  ON public.newspaper_editions(article_id)
  WHERE status = 'published';

ALTER TABLE public.newspaper_editions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published newspaper editions are public" ON public.newspaper_editions;
DROP POLICY IF EXISTS "League admins can review newspaper editions" ON public.newspaper_editions;
DROP POLICY IF EXISTS "Service role manages newspaper editions" ON public.newspaper_editions;

CREATE POLICY "Published newspaper editions are public"
  ON public.newspaper_editions FOR SELECT
  USING (
    status = 'published'
    AND article_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.articles a
      WHERE a.id = newspaper_editions.article_id
        AND a.published = true
        AND a.published_at IS NOT NULL
    )
  );

CREATE POLICY "League admins can review newspaper editions"
  ON public.newspaper_editions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = newspaper_editions.league_id
        AND (l.created_by = auth.uid() OR l.owner_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.league_memberships lm
      WHERE lm.league_id = newspaper_editions.league_id
        AND lm.user_id = auth.uid()
        AND lm.status = 'active'
        AND lm.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    )
  );

CREATE POLICY "Service role manages newspaper editions"
  ON public.newspaper_editions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.newspaper_editions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.newspaper_editions TO service_role;

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
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
    OR NEW.image_url IS DISTINCT FROM OLD.image_url
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.game_id IS DISTINCT FROM OLD.game_id
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_ARTICLE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_newspaper_article_update ON public.articles;
CREATE TRIGGER guard_newspaper_article_update
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.guard_newspaper_article_update();

CREATE OR REPLACE FUNCTION public.guard_newspaper_article_tag_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_article_id UUID;
  v_new_article_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_article_id := OLD.article_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_article_id := NEW.article_id; END IF;

  IF EXISTS (
    SELECT 1 FROM public.newspaper_editions ne
    WHERE ne.article_id = v_old_article_id OR ne.article_id = v_new_article_id
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_ARTICLE_TAGS_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS guard_newspaper_game_tags ON public.article_game_tags;
CREATE TRIGGER guard_newspaper_game_tags
  BEFORE INSERT OR UPDATE OR DELETE ON public.article_game_tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_newspaper_article_tag_mutation();

DROP TRIGGER IF EXISTS guard_newspaper_team_tags ON public.article_team_tags;
CREATE TRIGGER guard_newspaper_team_tags
  BEFORE INSERT OR UPDATE OR DELETE ON public.article_team_tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_newspaper_article_tag_mutation();

DROP TRIGGER IF EXISTS guard_newspaper_player_tags ON public.article_player_tags;
CREATE TRIGGER guard_newspaper_player_tags
  BEFORE INSERT OR UPDATE OR DELETE ON public.article_player_tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_newspaper_article_tag_mutation();

DROP FUNCTION IF EXISTS public.begin_newspaper_generation(UUID, UUID, DATE, DATE, UUID);

CREATE OR REPLACE FUNCTION public.begin_newspaper_generation(
  p_league_id UUID,
  p_season_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_created_by UUID,
  p_lease_seconds INTEGER DEFAULT 120
) RETURNS public.newspaper_editions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.newspaper_editions;
  v_token UUID := gen_random_uuid();
  v_issue INTEGER;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 120 THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_LEASE';
  END IF;
  IF EXTRACT(ISODOW FROM p_period_start) <> 1 OR p_period_end <> p_period_start + 6 THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_PERIOD';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seasons s
    WHERE s.id = p_season_id AND s.league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'SEASON_TENANT_MISMATCH';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_league_id::text || ':' || p_season_id::text || ':' || p_period_start::text || ':' || p_period_end::text,
    0
  ));

  SELECT * INTO v_row FROM public.newspaper_editions
  WHERE league_id = p_league_id
    AND season_id = p_season_id
    AND period_start = p_period_start
    AND period_end = p_period_end
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.status = 'published' THEN
      RAISE EXCEPTION 'NEWSPAPER_ALREADY_PUBLISHED';
    END IF;
    IF v_row.status = 'generating' AND v_row.lease_expires_at > now() THEN
      RAISE EXCEPTION 'NEWSPAPER_GENERATION_IN_PROGRESS';
    END IF;

    UPDATE public.newspaper_editions
    SET status = 'generating', generation_token = v_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        generation_error = CASE WHEN v_row.status = 'generating'
          THEN 'Previous generation lease expired and was reclaimed.' ELSE NULL END,
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_league_id::text || ':newspaper-issue-number', 0));
  SELECT COALESCE(max(issue_number), 0) + 1 INTO v_issue
  FROM public.newspaper_editions WHERE league_id = p_league_id;

  INSERT INTO public.newspaper_editions (
    league_id, season_id, period_start, period_end, issue_number,
    status, generation_token, lease_expires_at, created_by
  ) VALUES (
    p_league_id, p_season_id, p_period_start, p_period_end, v_issue,
    'generating', v_token, now() + make_interval(secs => p_lease_seconds), p_created_by
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_newspaper_narrative_draft(
  p_edition_id UUID,
  p_expected_version INTEGER,
  p_edition_json JSONB
) RETURNS public.newspaper_editions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.newspaper_editions;
BEGIN
  UPDATE public.newspaper_editions
  SET edition_json = p_edition_json,
      version = version + 1,
      updated_at = now()
  WHERE id = p_edition_id
    AND status = 'draft'
    AND article_id IS NULL
    AND version IS NOT DISTINCT FROM p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSPAPER_PREVIEW_STALE'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_newspaper_generation(
  p_edition_id UUID,
  p_generation_token UUID,
  p_edition_json JSONB,
  p_generation_method TEXT
) RETURNS public.newspaper_editions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.newspaper_editions;
BEGIN
  UPDATE public.newspaper_editions
  SET edition_json = p_edition_json,
      status = 'draft',
      generation_token = NULL,
      lease_expires_at = NULL,
      generation_error = NULL,
      generation_method = p_generation_method,
      version = version + 1,
      updated_at = now()
  WHERE id = p_edition_id
    AND status = 'generating'
    AND generation_token = p_generation_token
    AND lease_expires_at > now()
    AND article_id IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_NEWSPAPER_GENERATION'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_newspaper_generation(
  p_edition_id UUID,
  p_generation_token UUID,
  p_error TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_changed INTEGER;
BEGIN
  UPDATE public.newspaper_editions
  SET status = 'draft', generation_token = NULL,
      lease_expires_at = NULL, generation_error = left(p_error, 500), updated_at = now()
  WHERE id = p_edition_id
    AND status = 'generating'
    AND generation_token = p_generation_token
    AND lease_expires_at > now()
    AND article_id IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN RAISE EXCEPTION 'STALE_NEWSPAPER_GENERATION'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_newspaper_edition(
  p_edition_id UUID,
  p_expected_version INTEGER,
  p_published_by UUID,
  p_title TEXT,
  p_slug TEXT,
  p_content TEXT,
  p_excerpt TEXT,
  p_image_url TEXT DEFAULT NULL
) RETURNS public.newspaper_editions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edition public.newspaper_editions;
  v_article_id UUID;
  v_game_id_text TEXT;
  v_source_game_count INTEGER;
  v_distinct_game_count INTEGER;
  v_scoped_game_count INTEGER;
  v_embedded_game_count INTEGER;
BEGIN
  SELECT * INTO v_edition FROM public.newspaper_editions
  WHERE id = p_edition_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSPAPER_NOT_FOUND'; END IF;
  IF v_edition.status = 'published' THEN RAISE EXCEPTION 'NEWSPAPER_ALREADY_PUBLISHED'; END IF;
  IF v_edition.status <> 'draft' OR v_edition.edition_json IS NULL THEN
    RAISE EXCEPTION 'NEWSPAPER_NOT_READY';
  END IF;
  IF v_edition.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'NEWSPAPER_PREVIEW_STALE'; END IF;

  -- Freeze the source scoreboard while its reviewed business fields and covered
  -- week are checked and the immutable article graph is committed.
  LOCK TABLE public.games IN SHARE MODE;

  IF jsonb_typeof(v_edition.edition_json #> '{source,gameIds}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_SOURCE_GAMES';
  END IF;

  SELECT count(*), count(DISTINCT source_id)
  INTO v_source_game_count, v_distinct_game_count
  FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') AS source(source_id);

  IF v_source_game_count = 0 OR v_distinct_game_count <> v_source_game_count THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_SOURCE_GAMES';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') AS source(source_id)
    WHERE source_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_SOURCE_GAMES';
  END IF;

  SELECT count(*) INTO v_scoped_game_count
  FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') AS source(source_id)
  JOIN public.games g ON g.id::text = source.source_id
  WHERE g.league_id = v_edition.league_id
    AND g.season_id = v_edition.season_id;

  IF v_scoped_game_count <> v_source_game_count THEN
    RAISE EXCEPTION 'SOURCE_GAME_TENANT_MISMATCH';
  END IF;

  -- The immutable publication graph is derived from the reviewed edition, not
  -- caller-supplied tag arrays. Require one embedded report for every source
  -- game and bind its teams to the authoritative game row.
  IF jsonb_typeof(v_edition.edition_json -> 'games') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_GAMES';
  END IF;

  SELECT count(*), count(DISTINCT game_data ->> 'gameId')
  INTO v_embedded_game_count, v_distinct_game_count
  FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data);

  IF v_embedded_game_count <> v_source_game_count
     OR v_distinct_game_count <> v_embedded_game_count THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_GAMES';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
    WHERE jsonb_typeof(game_data -> 'homeTeam') IS DISTINCT FROM 'object'
       OR jsonb_typeof(game_data -> 'awayTeam') IS DISTINCT FROM 'object'
       OR jsonb_typeof(game_data -> 'contributors') IS DISTINCT FROM 'array'
       OR game_data ->> 'gameId' IS NULL
       OR game_data ->> 'gameId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR game_data #>> '{homeTeam,id}' IS NULL
       OR game_data #>> '{homeTeam,id}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR game_data #>> '{awayTeam,id}' IS NULL
       OR game_data #>> '{awayTeam,id}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(game_data -> 'homeScore') IS DISTINCT FROM 'number'
       OR game_data ->> 'homeScore' !~ '^[0-9]+$'
       OR jsonb_typeof(game_data -> 'awayScore') IS DISTINCT FROM 'number'
       OR game_data ->> 'awayScore' !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_GAMES';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
    LEFT JOIN public.games g
      ON g.id::text = game_data ->> 'gameId'
     AND g.league_id = v_edition.league_id
     AND g.season_id = v_edition.season_id
    WHERE g.id IS NULL
       OR g.home_team_id::text <> game_data #>> '{homeTeam,id}'
       OR g.away_team_id::text <> game_data #>> '{awayTeam,id}'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') source(source_id)
         WHERE source.source_id = g.id::text
       )
       OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = g.home_team_id AND t.league_id = v_edition.league_id)
       OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = g.away_team_id AND t.league_id = v_edition.league_id)
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_TEAM_SCOPE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
    JOIN public.games g ON g.id::text = game_data ->> 'gameId'
    WHERE g.status::text IS DISTINCT FROM 'completed'
       OR g.home_score IS DISTINCT FROM (game_data ->> 'homeScore')::integer
       OR g.away_score IS DISTINCT FROM (game_data ->> 'awayScore')::integer
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_SOURCE_GAME_CHANGED';
  END IF;

  -- Contributors are historical participants. Their exact game-scoped stat
  -- rows are authoritative; current roster membership is intentionally not.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
    CROSS JOIN LATERAL jsonb_array_elements(game_data -> 'contributors') contributor
    WHERE contributor ->> 'playerId' IS NULL
       OR contributor ->> 'playerId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_CONTRIBUTORS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT game_data ->> 'gameId' AS game_id,
             contributor ->> 'playerId' AS player_id,
             count(*) AS occurrences
      FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
      CROSS JOIN LATERAL jsonb_array_elements(game_data -> 'contributors') contributor
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_CONTRIBUTORS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
    CROSS JOIN LATERAL jsonb_array_elements(game_data -> 'contributors') contributor
    JOIN public.games g ON g.id::text = game_data ->> 'gameId'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.player_stats ps
      WHERE ps.game_id = g.id
        AND ps.player_id::text = contributor ->> 'playerId'
        AND ps.league_id = v_edition.league_id
        AND ps.season_id = v_edition.season_id
        AND ps.team_id IN (g.home_team_id, g.away_team_id)
    )
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_CONTRIBUTOR_SCOPE_MISMATCH';
  END IF;

  -- The reviewed source set must still be exactly every completed game in the
  -- league-local covered week. This runs under the games table lock above.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT g.id::text AS game_id
      FROM public.games g
      JOIN public.leagues l ON l.id = g.league_id
      WHERE g.league_id = v_edition.league_id
        AND g.season_id = v_edition.season_id
        AND g.status::text = 'completed'
        AND (g.scheduled_at AT TIME ZONE COALESCE(l.timezone, 'UTC'))::date
          BETWEEN v_edition.period_start AND v_edition.period_end
    ) covered
    FULL JOIN (
      SELECT source_id AS game_id
      FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') source(source_id)
    ) reviewed USING (game_id)
    WHERE covered.game_id IS NULL OR reviewed.game_id IS NULL
  ) THEN
    RAISE EXCEPTION 'NEWSPAPER_SOURCE_GAME_SET_CHANGED';
  END IF;

  INSERT INTO public.articles (
    league_id, season_id, title, slug, content, excerpt, image_url,
    type, published, published_at, author_id
  ) VALUES (
    v_edition.league_id, v_edition.season_id, p_title, p_slug,
    p_content, p_excerpt, p_image_url, 'weekly_wrap', true, now(), p_published_by
  ) RETURNING id INTO v_article_id;

  FOR v_game_id_text IN
    SELECT value FROM jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}')
  LOOP
    INSERT INTO public.article_game_tags(article_id, game_id, is_primary)
    SELECT v_article_id, g.id, false
    FROM public.games g
    WHERE g.id = v_game_id_text::uuid
      AND g.league_id = v_edition.league_id
      AND g.season_id = v_edition.season_id
    ON CONFLICT (article_id, game_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.article_team_tags(article_id, team_id)
  SELECT v_article_id, source_team.team_id
  FROM (
    SELECT g.home_team_id AS team_id
    FROM public.games g
    JOIN jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') source(source_id)
      ON g.id::text = source.source_id
    UNION
    SELECT g.away_team_id AS team_id
    FROM public.games g
    JOIN jsonb_array_elements_text(v_edition.edition_json #> '{source,gameIds}') source(source_id)
      ON g.id::text = source.source_id
  ) source_team
  WHERE true
  ON CONFLICT (article_id, team_id) DO NOTHING;

  INSERT INTO public.article_player_tags(article_id, player_id, mention_type)
  SELECT DISTINCT v_article_id, (contributor ->> 'playerId')::uuid, 'mentioned'
  FROM jsonb_array_elements(v_edition.edition_json -> 'games') AS embedded(game_data)
  CROSS JOIN LATERAL jsonb_array_elements(game_data -> 'contributors') contributor
  WHERE true
  ON CONFLICT (article_id, player_id) DO NOTHING;

  UPDATE public.newspaper_editions
  SET status = 'published', article_id = v_article_id,
      published_by = p_published_by, published_at = now(), updated_at = now(),
      edition_json = jsonb_set(edition_json, '{status}', '"published"'::jsonb, false)
  WHERE id = v_edition.id
  RETURNING * INTO v_edition;

  RETURN v_edition;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_newspaper_generation(UUID, UUID, DATE, DATE, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_newspaper_generation(UUID, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_newspaper_generation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_newspaper_narrative_draft(UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_newspaper_edition(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_newspaper_generation(UUID, UUID, DATE, DATE, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_newspaper_generation(UUID, UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_newspaper_generation(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_newspaper_narrative_draft(UUID, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_newspaper_edition(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
