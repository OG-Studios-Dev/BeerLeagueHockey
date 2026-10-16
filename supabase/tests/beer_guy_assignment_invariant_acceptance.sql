\set ON_ERROR_STOP on

DO $assignment_invariant$
DECLARE
  v_beer_type_id uuid;
  v_result jsonb;
  v_assignment_id uuid;
  v_version bigint;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001'
    AND system_key = 'beer_guy';

  -- Even a privileged/direct writer cannot create a future assignment before a
  -- confirmed attendance fact exists.
  BEGIN
    INSERT INTO public.game_duties(
      game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version
    ) VALUES (
      '50000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      v_beer_type_id,
      '40000000-0000-4000-8000-000000000011',
      'pending',
      1
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'direct future Beer assignment without confirmed attendance was not rejected';
  END IF;

  -- The invariant is lifecycle-wide for every non-completed game, so an active
  -- scorekeeping write cannot manufacture false Beer history either.
  v_rejected := false;
  BEGIN
    INSERT INTO public.game_duties(
      game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version
    ) VALUES (
      '50000000-0000-4000-8000-000000000015',
      '30000000-0000-4000-8000-000000000001',
      v_beer_type_id,
      '40000000-0000-4000-8000-000000000011',
      'pending',
      1
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'direct active-game Beer assignment without confirmed attendance was not rejected';
  END IF;

  -- Once a completed historical occurrence exists it cannot be directly erased.
  v_rejected := false;
  BEGIN
    UPDATE public.game_duties
    SET assigned_player_id = NULL,
        status = 'pending'
    WHERE id = '70000000-0000-4000-8000-000000000013';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'completed Beer history was directly erased';
  END IF;

  -- Build a valid assignment, then emulate a production-shaped legacy/corrupt
  -- row that predates enforcement by bypassing triggers as the fixture owner.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  SET LOCAL session_replication_role = replica;
  UPDATE public.game_checkins
  SET status = 'tentative'
  WHERE game_id = '50000000-0000-4000-8000-000000000002'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND player_id = '40000000-0000-4000-8000-000000000011';
  SET LOCAL session_replication_role = origin;

  v_result := public.beer_guy_get_game_state(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result -> 'assignment' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'private read exposed future Beer assignment without confirmed attendance: %', v_result;
  END IF;

  UPDATE public.games
  SET status = 'cancelled'
  WHERE id = '50000000-0000-4000-8000-000000000001';
  IF public.beer_guy_get_public_next_assignment('30000000-0000-4000-8000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'public read exposed an invalid next-game Beer assignment';
  END IF;

  -- Explicitly selecting Beer Guy again reaffirms its orthogonal attendance
  -- fact while preserving the same canonical assignment identity.
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'outcome' <> 'assigned_to_self'
     OR v_result #>> '{assignment,id}' <> v_assignment_id::text
     OR (v_result #>> '{assignment,version}')::bigint <= v_version
     OR NOT EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000002'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'same-assignee self claim did not repair confirmed attendance: %', v_result;
  END IF;

  -- Captain same-assignee is the equivalent explicit reaffirmation path.
  SET LOCAL session_replication_role = replica;
  UPDATE public.game_checkins
  SET status = 'out'
  WHERE game_id = '50000000-0000-4000-8000-000000000002'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND player_id = '40000000-0000-4000-8000-000000000011';
  SET LOCAL session_replication_role = origin;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    v_assignment_id,
    v_version
  );
  IF v_result ->> 'outcome' <> 'unchanged'
     OR (v_result #>> '{assignment,version}')::bigint <= v_version
     OR NOT EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000002'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'same-assignee captain action did not repair confirmed attendance: %', v_result;
  END IF;

  -- A cancelled legacy/corrupt audit assignment without a check-in cannot become
  -- visible merely because the parent is rescheduled.
  SET LOCAL session_replication_role = replica;
  UPDATE public.game_duties
  SET assigned_player_id = '40000000-0000-4000-8000-000000000012',
      status = 'pending'
  WHERE game_id = '50000000-0000-4000-8000-000000000005'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND duty_type_id = v_beer_type_id;
  IF NOT FOUND THEN
    INSERT INTO public.game_duties(
      game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version
    ) VALUES (
      '50000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000001',
      v_beer_type_id,
      '40000000-0000-4000-8000-000000000012',
      'pending',
      1
    );
  END IF;
  SET LOCAL session_replication_role = origin;
  UPDATE public.games
  SET status = 'scheduled'
  WHERE id = '50000000-0000-4000-8000-000000000005';
  IF EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE game_id = '50000000-0000-4000-8000-000000000005'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND duty_type_id = v_beer_type_id
      AND assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rescheduling exposed Beer assignment without confirmed attendance';
  END IF;
END;
$assignment_invariant$;

SELECT 'beer guy confirmed-attendance assignment invariant acceptance passed' AS result;
