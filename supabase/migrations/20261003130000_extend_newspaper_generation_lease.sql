-- Keep the generation lease longer than the bounded 140-second illustration
-- request. The RPC remains service-role-only under its existing grants.
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
  IF p_lease_seconds < 30 OR p_lease_seconds > 180 THEN
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
