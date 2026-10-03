SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.newspaper_editorial_revision_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newspaper_edition_id UUID NOT NULL REFERENCES public.newspaper_editions(id) ON DELETE RESTRICT,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE RESTRICT,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  old_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  old_edition_json JSONB NOT NULL,
  new_edition_json JSONB NOT NULL,
  old_article_content TEXT NOT NULL,
  new_article_content TEXT NOT NULL,
  old_article_excerpt TEXT NOT NULL,
  new_article_excerpt TEXT NOT NULL,
  old_edition_sha256 TEXT NOT NULL CHECK (old_edition_sha256 ~ '^[0-9a-f]{64}$'),
  new_edition_sha256 TEXT NOT NULL CHECK (new_edition_sha256 ~ '^[0-9a-f]{64}$'),
  old_content_sha256 TEXT NOT NULL CHECK (old_content_sha256 ~ '^[0-9a-f]{64}$'),
  new_content_sha256 TEXT NOT NULL CHECK (new_content_sha256 ~ '^[0-9a-f]{64}$'),
  manuscript_sha256 TEXT NOT NULL CHECK (manuscript_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_sha256 TEXT NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX newspaper_editorial_revision_audit_article_idx ON public.newspaper_editorial_revision_audit(article_id, changed_at DESC);
ALTER TABLE public.newspaper_editorial_revision_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newspaper_editorial_revision_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.newspaper_editorial_revision_audit TO service_role;

CREATE TABLE public.newspaper_article_revision_write_gate (
  transaction_id BIGINT NOT NULL,
  backend_pid INTEGER NOT NULL,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  new_content TEXT NOT NULL,
  new_excerpt TEXT NOT NULL,
  PRIMARY KEY (transaction_id, backend_pid, article_id)
);
ALTER TABLE public.newspaper_article_revision_write_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newspaper_article_revision_write_gate FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.newspaper_edition_revision_write_gate (
  transaction_id BIGINT NOT NULL,
  backend_pid INTEGER NOT NULL,
  edition_id UUID NOT NULL REFERENCES public.newspaper_editions(id) ON DELETE CASCADE,
  new_edition_json JSONB NOT NULL,
  new_version INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, backend_pid, edition_id)
);
ALTER TABLE public.newspaper_edition_revision_write_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newspaper_edition_revision_write_gate FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.newspaper_editorial_frozen_projection(p_edition JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT
    (p_edition - 'editorial' - 'numbers' - 'lead' - 'games' - 'stars' - 'hot' - 'cold' - 'upcoming' - 'upcomingNote')
    || jsonb_build_object('lead', (p_edition->'lead') - 'headline' - 'dek' - 'body')
    || jsonb_build_object('games', COALESCE((SELECT jsonb_agg(value - 'headline' - 'body' ORDER BY ordinality) FROM jsonb_array_elements(p_edition->'games') WITH ORDINALITY), '[]'::jsonb))
    || jsonb_build_object('stars', COALESCE((SELECT jsonb_agg(value - 'reason' ORDER BY ordinality) FROM jsonb_array_elements(p_edition->'stars') WITH ORDINALITY), '[]'::jsonb))
    || jsonb_build_object('hot', COALESCE((SELECT jsonb_agg(value - 'headline' - 'body' ORDER BY ordinality) FROM jsonb_array_elements(p_edition->'hot') WITH ORDINALITY), '[]'::jsonb))
    || jsonb_build_object('cold', COALESCE((SELECT jsonb_agg(value - 'headline' - 'body' ORDER BY ordinality) FROM jsonb_array_elements(p_edition->'cold') WITH ORDINALITY), '[]'::jsonb))
    || jsonb_build_object('upcoming', COALESCE((SELECT jsonb_agg(value - 'headline' - 'line' - 'pick' - 'bodyParagraphs' ORDER BY ordinality) FROM jsonb_array_elements(p_edition->'upcoming') WITH ORDINALITY), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.newspaper_editorial_frozen_projection(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_newspaper_article_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.newspaper_editions ne WHERE ne.article_id = OLD.id) AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.division_id IS DISTINCT FROM OLD.division_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.image_url IS DISTINCT FROM OLD.image_url
    OR NEW.type IS DISTINCT FROM OLD.type OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.published IS DISTINCT FROM OLD.published
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR ((NEW.content IS DISTINCT FROM OLD.content OR NEW.excerpt IS DISTINCT FROM OLD.excerpt) AND NOT EXISTS (
      SELECT 1 FROM public.newspaper_article_revision_write_gate gate
      WHERE gate.transaction_id = txid_current() AND gate.backend_pid = pg_backend_pid()
        AND gate.article_id = OLD.id AND gate.new_content = NEW.content AND gate.new_excerpt = NEW.excerpt
    ))
    OR (NEW.title IS DISTINCT FROM OLD.title AND NOT EXISTS (
      SELECT 1 FROM public.newspaper_article_title_write_gate gate
      WHERE gate.transaction_id = txid_current() AND gate.backend_pid = pg_backend_pid()
        AND gate.article_id = OLD.id AND gate.new_title = NEW.title
    ))
  ) THEN RAISE EXCEPTION 'NEWSPAPER_ARTICLE_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_published_newspaper_edition_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end OR NEW.issue_number IS DISTINCT FROM OLD.issue_number
    OR NEW.status IS DISTINCT FROM OLD.status OR NEW.article_id IS DISTINCT FROM OLD.article_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.generation_method IS DISTINCT FROM OLD.generation_method
    OR NEW.generation_token IS DISTINCT FROM OLD.generation_token OR NEW.generation_error IS DISTINCT FROM OLD.generation_error OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
    OR ((NEW.edition_json IS DISTINCT FROM OLD.edition_json OR NEW.version IS DISTINCT FROM OLD.version) AND NOT EXISTS (
      SELECT 1 FROM public.newspaper_edition_revision_write_gate gate
      WHERE gate.transaction_id=txid_current() AND gate.backend_pid=pg_backend_pid() AND gate.edition_id=OLD.id
        AND gate.new_edition_json=NEW.edition_json AND gate.new_version=NEW.version
    ))
  ) THEN RAISE EXCEPTION 'PUBLISHED_NEWSPAPER_EDITION_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_published_newspaper_edition_update BEFORE UPDATE ON public.newspaper_editions
FOR EACH ROW EXECUTE FUNCTION public.guard_published_newspaper_edition_update();
REVOKE ALL ON FUNCTION public.guard_published_newspaper_edition_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_newspaper_article_update() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.revise_published_newspaper_edition(
  p_edition_id UUID, p_article_id UUID, p_league_id UUID, p_season_id UUID,
  p_expected_version INTEGER, p_expected_edition_sha256 TEXT, p_expected_content_sha256 TEXT,
  p_new_edition_json JSONB, p_approved_edition_canonical_json TEXT, p_approved_scoring_facts_canonical_json TEXT,
  p_new_content TEXT, p_new_excerpt TEXT,
  p_manuscript_sha256 TEXT, p_pdf_sha256 TEXT, p_changed_by UUID
) RETURNS public.newspaper_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_edition public.newspaper_editions;
  v_article public.articles;
  v_old_edition_sha TEXT;
  v_old_content_sha TEXT;
  v_new_edition_sha TEXT;
  v_new_content_sha TEXT;
  v_expected_values JSONB;
  v_old_edition JSONB;
  v_def_goals INTEGER;
  v_def_assists INTEGER;
  v_tag_hash TEXT;
  v_tag_hash_after TEXT;
  v_current_scoring_facts JSONB;
BEGIN
  IF p_edition_id IS DISTINCT FROM '61196f33-0958-4752-8436-47601b2875f1'::uuid
     OR p_article_id IS DISTINCT FROM '05ed2736-a431-41fa-b919-2ddddee157c8'::uuid
     OR p_league_id IS DISTINCT FROM 'd6e55507-6eae-4d94-978c-47c6c30a36f1'::uuid
     OR p_season_id IS DISTINCT FROM '145ac7ee-99fb-4a50-a0b5-37f24e9991f3'::uuid
     OR p_expected_version IS DISTINCT FROM 1
     OR p_changed_by IS DISTINCT FROM 'add94b26-b344-459f-9727-8cddae9783de'::uuid THEN
    RAISE EXCEPTION 'NEWSPAPER_REVISION_TARGET_MISMATCH';
  END IF;
  IF COALESCE(p_expected_edition_sha256 !~ '^[0-9a-f]{64}$', true) OR COALESCE(p_expected_content_sha256 !~ '^[0-9a-f]{64}$', true)
     OR COALESCE(p_manuscript_sha256 !~ '^[0-9a-f]{64}$', true) OR COALESCE(p_pdf_sha256 !~ '^[0-9a-f]{64}$', true) THEN
    RAISE EXCEPTION 'INVALID_NEWSPAPER_REVISION_HASH';
  END IF;
  IF p_manuscript_sha256 IS DISTINCT FROM 'b3be4940569ea077e2a2d9a2484b3b4f937b401de12e0f8e5b0f6b24838715ca'
     OR p_pdf_sha256 IS DISTINCT FROM 'b27af337ddbb2e37121cdffb646bb8d66cd7f1ba17e45387a7383f7bcaff3e1b'
     OR encode(extensions.digest(convert_to(p_approved_edition_canonical_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b1418e217e4a5dca9f43d8c32ed5765c33bafaef3fdac99deff462b3ae4efd59'
     OR p_new_edition_json IS DISTINCT FROM p_approved_edition_canonical_json::jsonb
     OR encode(extensions.digest(convert_to(p_approved_scoring_facts_canonical_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '055d19611aa265dcc83f0c01589ea03f3c3d131b71fd9dfe62d00b1709032948'
     OR encode(extensions.digest(convert_to(p_new_content,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '59cdd7efc8a0deee4c83f91fac60f0fce4b70c74c730b60460cf906fa9c71d69'
     OR encode(extensions.digest(convert_to(p_new_excerpt,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '2ae3e1c77e030379eff595631986286b341c4bf0973605ab9816513671420867' THEN
    RAISE EXCEPTION 'NEWSPAPER_REVISION_APPROVAL_MISMATCH';
  END IF;

  PERFORM 1
  FROM public.newspaper_editions ne JOIN public.articles a ON a.id = ne.article_id
  WHERE ne.id = p_edition_id AND a.id = p_article_id
  FOR UPDATE OF ne, a;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_LINK_MISMATCH'; END IF;
  SELECT ne.* INTO v_edition FROM public.newspaper_editions ne WHERE ne.id=p_edition_id;
  SELECT a.* INTO v_article FROM public.articles a WHERE a.id=p_article_id;
  IF v_edition.league_id <> p_league_id OR v_article.league_id <> p_league_id
     OR v_edition.season_id <> p_season_id OR v_article.season_id <> p_season_id THEN
    RAISE EXCEPTION 'NEWSPAPER_REVISION_TENANT_MISMATCH';
  END IF;
  IF v_edition.status <> 'published' OR v_article.published IS DISTINCT FROM true
     OR v_edition.published_at IS NULL OR v_article.published_at IS NULL THEN
    RAISE EXCEPTION 'NEWSPAPER_REVISION_NOT_PUBLISHED';
  END IF;
  IF v_edition.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_STALE'; END IF;
  v_old_edition := v_edition.edition_json;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l LEFT JOIN public.organizations o ON o.id = l.organization_id
    WHERE l.id = p_league_id AND (l.owner_id = p_changed_by OR l.created_by = p_changed_by OR o.owner_user_id = p_changed_by
      OR EXISTS (SELECT 1 FROM public.league_memberships lm WHERE lm.league_id = p_league_id AND lm.user_id = p_changed_by AND lm.status = 'active' AND lm.role IN ('owner','admin'))
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_changed_by AND p.is_platform_admin = true))
  ) THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_NOT_AUTHORIZED'; END IF;

  v_old_edition_sha := encode(extensions.digest(convert_to(v_edition.edition_json::text, 'UTF8'), 'sha256'), 'hex');
  v_old_content_sha := encode(extensions.digest(convert_to(v_article.content, 'UTF8'), 'sha256'), 'hex');
  IF v_old_edition_sha IS DISTINCT FROM p_expected_edition_sha256 OR v_old_content_sha IS DISTINCT FROM p_expected_content_sha256 THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_STALE'; END IF;
  IF public.newspaper_editorial_frozen_projection(p_new_edition_json) IS DISTINCT FROM public.newspaper_editorial_frozen_projection(v_edition.edition_json) THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_FROZEN_FIELD'; END IF;
  IF p_new_edition_json #>> '{status}' IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_FROZEN_FIELD'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_new_edition_json->'editorial','{}'::jsonb)) k WHERE k NOT IN ('standings','upcoming','sourceNote')) THEN RAISE EXCEPTION 'INVALID_EDITORIAL_KEYS'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_new_edition_json#>'{editorial,standings}','{}'::jsonb)) k WHERE k NOT IN ('headline','body'))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_new_edition_json#>'{editorial,upcoming}','{}'::jsonb)) k WHERE k NOT IN ('heading')) THEN
    RAISE EXCEPTION 'INVALID_EDITORIAL_KEYS';
  END IF;
  IF jsonb_typeof(p_new_edition_json->'editorial') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_edition_json#>'{editorial,standings}') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_edition_json#>'{editorial,standings,body}') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_new_edition_json#>'{editorial,standings,body}') IS NOT DISTINCT FROM 0
     OR jsonb_typeof(p_new_edition_json#>'{editorial,upcoming}') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_edition_json#>'{editorial,standings,headline}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_new_edition_json#>'{editorial,upcoming,heading}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_new_edition_json#>'{editorial,sourceNote}') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_new_edition_json#>'{editorial,sourceNote}') IS NOT DISTINCT FROM 0
     OR jsonb_typeof(p_new_edition_json->'upcomingNote') IS DISTINCT FROM 'string'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json#>'{editorial,standings,body}') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR btrim(x#>>'{}')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json#>'{editorial,sourceNote}') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR btrim(x#>>'{}')='')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'upcoming') x WHERE
       jsonb_typeof(x->'line') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'pick') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'bodyParagraphs') IS DISTINCT FROM 'array'
       OR jsonb_array_length(x->'bodyParagraphs') IS NOT DISTINCT FROM 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(x->'bodyParagraphs') p WHERE jsonb_typeof(p) IS DISTINCT FROM 'string' OR btrim(p#>>'{}')=''))
  THEN RAISE EXCEPTION 'INVALID_EDITORIAL_SHAPE'; END IF;
  IF jsonb_typeof(p_new_edition_json->'numbers') IS DISTINCT FROM 'array' OR jsonb_array_length(p_new_edition_json->'numbers') IS DISTINCT FROM 5
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'numbers') n CROSS JOIN LATERAL jsonb_object_keys(n) k WHERE k NOT IN ('label','value','detail'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'numbers') n WHERE jsonb_typeof(n->'label') IS DISTINCT FROM 'string' OR btrim(n->>'label')='' OR jsonb_typeof(n->'value') IS DISTINCT FROM 'string' OR (n ? 'detail' AND jsonb_typeof(n->'detail') IS DISTINCT FROM 'string')) THEN
    RAISE EXCEPTION 'INVALID_EDITORIAL_NUMBERS';
  END IF;
  IF jsonb_typeof(p_new_edition_json#>'{lead,headline}') IS DISTINCT FROM 'string' OR jsonb_typeof(p_new_edition_json#>'{lead,dek}') IS DISTINCT FROM 'string' OR jsonb_typeof(p_new_edition_json#>'{lead,body}') IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json#>'{lead,body}') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'games') x WHERE jsonb_typeof(x->'headline') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'body') IS DISTINCT FROM 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(x->'body') p WHERE jsonb_typeof(p) IS DISTINCT FROM 'string'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'stars') x WHERE jsonb_typeof(x->'reason') IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'hot') x WHERE jsonb_typeof(x->'headline') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'body') IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'cold') x WHERE jsonb_typeof(x->'headline') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'body') IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'INVALID_EDITORIAL_SHAPE'; END IF;

  -- Fresh publication-time facts: lock and independently compare authoritative
  -- game scores/set, standings and defence-position stat rows.
  LOCK TABLE public.games IN SHARE MODE;
  LOCK TABLE public.team_rosters IN SHARE MODE;
  -- team_standings is the canonical derived relation; locking games and teams
  -- stabilizes its inputs without assuming the derived relation is a table.
  LOCK TABLE public.player_stats, public.profiles, public.teams IN SHARE MODE;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'games') e
    LEFT JOIN public.games g ON g.id::text = e->>'gameId' AND g.league_id = p_league_id AND g.season_id = p_season_id
    WHERE g.id IS NULL OR g.status::text <> 'completed' OR g.home_team_id::text <> e#>>'{homeTeam,id}' OR g.away_team_id::text <> e#>>'{awayTeam,id}'
      OR g.home_score IS DISTINCT FROM (e->>'homeScore')::integer OR g.away_score IS DISTINCT FROM (e->>'awayScore')::integer
  ) THEN RAISE EXCEPTION 'NEWSPAPER_SOURCE_GAME_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'upcoming') e
    LEFT JOIN public.games g ON g.id::text=e->>'gameId' AND g.league_id=p_league_id AND g.season_id=p_season_id
    LEFT JOIN public.teams home_team ON home_team.id=g.home_team_id
    LEFT JOIN public.teams away_team ON away_team.id=g.away_team_id
    WHERE g.id IS NULL OR g.status::text <> 'scheduled'
      OR g.scheduled_at IS DISTINCT FROM (e->>'scheduledAt')::timestamptz
      OR g.location IS DISTINCT FROM e->>'venue'
      OR home_team.name IS DISTINCT FROM e->>'homeName'
      OR away_team.name IS DISTINCT FROM e->>'awayName'
  ) THEN RAISE EXCEPTION 'NEWSPAPER_UPCOMING_GAME_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT g.id::text AS game_id
      FROM public.games g JOIN public.leagues l ON l.id=g.league_id
      WHERE g.league_id=p_league_id AND g.season_id=p_season_id AND g.status::text='scheduled'
        AND g.scheduled_at >= ((v_edition.period_end + 1)::timestamp AT TIME ZONE COALESCE(l.timezone,'UTC'))
        AND g.scheduled_at < ((v_edition.period_end + 8)::timestamp AT TIME ZONE COALESCE(l.timezone,'UTC'))
    ) current_upcoming FULL JOIN (
      SELECT e->>'gameId' AS game_id FROM jsonb_array_elements(p_new_edition_json->'upcoming') e
    ) reviewed USING (game_id)
    WHERE current_upcoming.game_id IS NULL OR reviewed.game_id IS NULL
  ) THEN RAISE EXCEPTION 'NEWSPAPER_UPCOMING_GAME_SET_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT g.id::text game_id FROM public.games g JOIN public.leagues l ON l.id=g.league_id
      WHERE g.league_id=p_league_id AND g.season_id=p_season_id AND g.status::text='completed'
        AND (g.scheduled_at AT TIME ZONE COALESCE(l.timezone,'UTC'))::date BETWEEN v_edition.period_start AND v_edition.period_end
    ) current_games FULL JOIN (
      SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}') game_id
    ) reviewed USING (game_id) WHERE current_games.game_id IS NULL OR reviewed.game_id IS NULL
  ) THEN RAISE EXCEPTION 'NEWSPAPER_SOURCE_GAME_SET_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'games') game
    CROSS JOIN LATERAL jsonb_array_elements(game->'contributors') contributor
    JOIN public.games contributor_game ON contributor_game.id::text=game->>'gameId'
    LEFT JOIN public.player_stats ps ON ps.game_id::text=game->>'gameId' AND ps.player_id::text=contributor->>'playerId'
      AND ps.league_id=p_league_id AND ps.season_id=p_season_id
      AND ps.team_id IN (contributor_game.home_team_id, contributor_game.away_team_id)
    WHERE ps.id IS NULL OR COALESCE(ps.goals,0)<>(contributor->>'goals')::int OR COALESCE(ps.assists,0)<>(contributor->>'assists')::int
  ) THEN RAISE EXCEPTION 'NEWSPAPER_CONTRIBUTOR_STATS_CHANGED'; END IF;
  SELECT COALESCE(jsonb_object_agg(
    scoring.game_id||':'||scoring.player_name,
    jsonb_build_object(
      'gameId',scoring.game_id,'playerName',scoring.player_name,'teamName',scoring.team_name,
      'position',scoring.position,'goals',scoring.goals,'assists',scoring.assists,'points',scoring.goals+scoring.assists
    )
  ), '{}'::jsonb) INTO v_current_scoring_facts
  FROM (
    SELECT g.id::text AS game_id, p.full_name AS player_name, t.name AS team_name,
      lower(tr.position::text) AS position, sum(COALESCE(ps.goals,0))::int AS goals, sum(COALESCE(ps.assists,0))::int AS assists
    FROM public.player_stats ps
    JOIN public.games g ON g.id=ps.game_id
    JOIN public.profiles p ON p.id=ps.player_id
    JOIN public.team_rosters tr ON tr.player_id=ps.player_id AND tr.team_id=ps.team_id AND tr.season_id=ps.season_id AND tr.league_id=ps.league_id
    JOIN public.teams t ON t.id=ps.team_id
    WHERE ps.league_id=p_league_id AND ps.season_id=p_season_id
      AND ps.game_id::text IN (SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}'))
    GROUP BY g.id,p.id,p.full_name,t.name,tr.position
    HAVING sum(COALESCE(ps.goals,0))+sum(COALESCE(ps.assists,0)) > 0
  ) scoring;
  IF v_current_scoring_facts IS DISTINCT FROM p_approved_scoring_facts_canonical_json::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(v_current_scoring_facts)) IS DISTINCT FROM 24 THEN
    RAISE EXCEPTION 'NEWSPAPER_SCORING_FACTS_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'stars') star
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(ps.goals),0)::int goals, COALESCE(sum(ps.assists),0)::int assists
      FROM public.player_stats ps WHERE ps.player_id::text=star->>'playerId' AND ps.league_id=p_league_id AND ps.season_id=p_season_id
        AND ps.game_id::text IN (SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}'))
    ) actual ON true
    WHERE actual.goals<>(star->>'goals')::int OR actual.assists<>(star->>'assists')::int OR actual.goals+actual.assists<>(star->>'points')::int
  ) THEN RAISE EXCEPTION 'NEWSPAPER_STAR_STATS_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_new_edition_json->'standings') e
    LEFT JOIN public.team_standings ts ON ts.team_id::text=e->>'teamId' AND ts.season_id=p_season_id
    -- The deployed canonical get_team_standings contract has W/L/T and 2W+T
    -- points, but no OTL field. Represent that supported contract as OTL=0;
    -- W/L/T, GP and points remain independently checked against live results.
    WHERE ts.team_id IS NULL OR COALESCE(ts.games_played,0)<>(e->>'gp')::int OR COALESCE(ts.wins,0)<>(e->>'w')::int
      OR COALESCE(ts.losses,0)<>(e->>'l')::int
      OR COALESCE(ts.ties,0)<>(e->>'t')::int OR COALESCE(ts.points,0)<>(e->>'pts')::int
      OR COALESCE(ts.goals_for,0)<>(e->>'gf')::int OR COALESCE(ts.goals_against,0)<>(e->>'ga')::int
      OR (e->>'otl')::int IS DISTINCT FROM 0
      OR (e->>'gp')::int IS DISTINCT FROM ((e->>'w')::int+(e->>'l')::int+(e->>'t')::int)
      OR (e->>'pts')::int IS DISTINCT FROM (2*(e->>'w')::int+(e->>'t')::int)
  ) THEN RAISE EXCEPTION 'NEWSPAPER_STANDINGS_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT ts.team_id::text AS team_id
      FROM public.team_standings ts JOIN public.teams t ON t.id=ts.team_id
      WHERE ts.season_id=p_season_id AND t.league_id=p_league_id
    ) current_teams FULL JOIN (
      SELECT e->>'teamId' AS team_id FROM jsonb_array_elements(p_new_edition_json->'standings') e
    ) reviewed USING (team_id)
    WHERE current_teams.team_id IS NULL OR reviewed.team_id IS NULL
  ) THEN RAISE EXCEPTION 'NEWSPAPER_STANDINGS_SET_CHANGED'; END IF;

  IF (SELECT count(*) FROM (
    SELECT ps.player_id
    FROM public.player_stats ps
    WHERE ps.league_id=p_league_id AND ps.season_id=p_season_id
      AND ps.game_id::text IN (SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}'))
    GROUP BY ps.player_id
    HAVING sum(COALESCE(ps.goals,0)+COALESCE(ps.assists,0))=3
  ) point_leaders) IS DISTINCT FROM 2
  OR EXISTS (
    SELECT 1 FROM (
      SELECT sum(COALESCE(ps.goals,0)+COALESCE(ps.assists,0)) AS points
      FROM public.player_stats ps
      WHERE ps.league_id=p_league_id AND ps.season_id=p_season_id
        AND ps.game_id::text IN (SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}'))
      GROUP BY ps.player_id
    ) totals WHERE totals.points > 3
  ) THEN RAISE EXCEPTION 'NEWSPAPER_POINT_LEADERS_CHANGED'; END IF;

  SELECT COALESCE(sum(ps.goals),0), COALESCE(sum(ps.assists),0) INTO v_def_goals, v_def_assists
  FROM public.player_stats ps JOIN public.teams t ON t.id=ps.team_id
  JOIN public.team_rosters tr ON tr.player_id=ps.player_id AND tr.team_id=ps.team_id AND tr.season_id=ps.season_id AND tr.league_id=ps.league_id
  WHERE ps.league_id=p_league_id AND ps.season_id=p_season_id AND lower(tr.position::text)='defense' AND t.name='Bad Bunny'
    AND ps.game_id::text IN (SELECT jsonb_array_elements_text(p_new_edition_json#>'{source,gameIds}'));
  SELECT jsonb_agg(n->>'value' ORDER BY ordinality) INTO v_expected_values FROM jsonb_array_elements(p_new_edition_json->'numbers') WITH ORDINALITY AS x(n, ordinality);
  IF v_expected_values IS DISTINCT FROM jsonb_build_array(
    (SELECT sum((e->>'homeScore')::int+(e->>'awayScore')::int)||' goals' FROM jsonb_array_elements(p_new_edition_json->'games') e),
    (SELECT max(abs((e->>'homeScore')::int-(e->>'awayScore')::int))||'-goal margin' FROM jsonb_array_elements(p_new_edition_json->'games') e),
    (SELECT max((e->>'points')::int)||' points each' FROM jsonb_array_elements(p_new_edition_json->'stars') e),
    v_def_goals||' goal, '||v_def_assists||' assists',
    jsonb_array_length(p_new_edition_json->'games')||' games'
  ) THEN RAISE EXCEPTION 'INVALID_EDITORIAL_NUMBERS'; END IF;

  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'games',(SELECT jsonb_agg(to_jsonb(x) ORDER BY game_id) FROM public.article_game_tags x WHERE article_id=p_article_id),
    'teams',(SELECT jsonb_agg(to_jsonb(x) ORDER BY team_id) FROM public.article_team_tags x WHERE article_id=p_article_id),
    'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id) FROM public.article_player_tags x WHERE article_id=p_article_id)
  )::text,'UTF8'),'sha256'),'hex') INTO v_tag_hash;

  INSERT INTO public.newspaper_article_revision_write_gate VALUES (txid_current(), pg_backend_pid(), p_article_id, p_new_content, p_new_excerpt);
  UPDATE public.articles SET content=p_new_content, excerpt=p_new_excerpt, updated_at=clock_timestamp() WHERE id=p_article_id AND league_id=p_league_id;
  DELETE FROM public.newspaper_article_revision_write_gate WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND article_id=p_article_id;
  INSERT INTO public.newspaper_edition_revision_write_gate VALUES (txid_current(), pg_backend_pid(), p_edition_id, p_new_edition_json, p_expected_version+1);
  UPDATE public.newspaper_editions SET edition_json=p_new_edition_json, version=version+1, updated_at=clock_timestamp()
  WHERE id=p_edition_id AND article_id=p_article_id AND version=p_expected_version RETURNING * INTO v_edition;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_STALE'; END IF;
  DELETE FROM public.newspaper_edition_revision_write_gate WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND edition_id=p_edition_id;

  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'games',(SELECT jsonb_agg(to_jsonb(x) ORDER BY game_id) FROM public.article_game_tags x WHERE article_id=p_article_id),
    'teams',(SELECT jsonb_agg(to_jsonb(x) ORDER BY team_id) FROM public.article_team_tags x WHERE article_id=p_article_id),
    'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id) FROM public.article_player_tags x WHERE article_id=p_article_id)
  )::text,'UTF8'),'sha256'),'hex') INTO v_tag_hash_after;
  IF v_tag_hash_after IS DISTINCT FROM v_tag_hash THEN RAISE EXCEPTION 'NEWSPAPER_REVISION_TAGS_CHANGED'; END IF;

  v_new_edition_sha := encode(extensions.digest(convert_to(p_new_edition_json::text,'UTF8'),'sha256'),'hex');
  v_new_content_sha := encode(extensions.digest(convert_to(p_new_content,'UTF8'),'sha256'),'hex');
  INSERT INTO public.newspaper_editorial_revision_audit (
    newspaper_edition_id,article_id,league_id,changed_by,old_version,new_version,old_edition_json,new_edition_json,
    old_article_content,new_article_content,old_article_excerpt,new_article_excerpt,old_edition_sha256,new_edition_sha256,
    old_content_sha256,new_content_sha256,manuscript_sha256,pdf_sha256
  ) VALUES (p_edition_id,p_article_id,p_league_id,p_changed_by,p_expected_version,p_expected_version+1,
    v_old_edition,p_new_edition_json,v_article.content,p_new_content,v_article.excerpt,p_new_excerpt,
    v_old_edition_sha,v_new_edition_sha,v_old_content_sha,v_new_content_sha,p_manuscript_sha256,p_pdf_sha256);
  RETURN v_edition;
END;
$$;

REVOKE ALL ON FUNCTION public.revise_published_newspaper_edition(UUID,UUID,UUID,UUID,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revise_published_newspaper_edition(UUID,UUID,UUID,UUID,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID) TO service_role;
