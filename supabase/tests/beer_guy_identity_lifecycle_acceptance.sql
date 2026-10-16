\set ON_ERROR_STOP on

DO $identity_lifecycle$
DECLARE
  v_beer_type_id uuid;
  v_tracker jsonb;
  v_future_assignment_id uuid;
  v_future_assignment_version bigint;
BEGIN
  SELECT id INTO v_beer_type_id FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';

  -- Account deletion: future authority reopens, completed Beer history remains on
  -- the retained anonymized profile and renders as a former player.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000020', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version)
  VALUES ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
          v_beer_type_id, '40000000-0000-4000-8000-000000000020', 'completed', 1);
  SELECT gd.id, gd.assignment_version
  INTO v_future_assignment_id, v_future_assignment_version
  FROM public.game_duties AS gd
  WHERE gd.game_id = '50000000-0000-4000-8000-000000000001'
    AND gd.team_id = '30000000-0000-4000-8000-000000000001'
    AND gd.duty_type_id = v_beer_type_id;

  -- The deployed account-deletion core deletes non-completed duty rows. The
  -- Beer contract must convert that legacy delete into a stable-row reopen.
  DELETE FROM public.game_duties AS gd
  WHERE gd.assigned_player_id = '40000000-0000-4000-8000-000000000020'
    AND NOT (
      gd.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM public.games AS g
        WHERE g.id = gd.game_id AND g.status::text = 'completed'
      )
    );

  UPDATE public.profiles
  SET deleted_at = pg_catalog.statement_timestamp(), full_name = 'Deleted User', avatar_url = NULL
  WHERE id = '40000000-0000-4000-8000-000000000020';
  IF EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
    WHERE gd.game_id = '50000000-0000-4000-8000-000000000001'
      AND dt.system_key = 'beer_guy'
      AND gd.assigned_player_id IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    WHERE gd.id = v_future_assignment_id
      AND gd.assigned_player_id IS NULL
      AND gd.assignment_version > v_future_assignment_version
  ) OR NOT EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
    WHERE gd.game_id = '50000000-0000-4000-8000-000000000004'
      AND dt.system_key = 'beer_guy'
      AND gd.assigned_player_id = '40000000-0000-4000-8000-000000000020'
      AND gd.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'account deletion lifecycle did not reopen future/preserve completed Beer assignment: %',
      (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(gd)) FROM public.game_duties AS gd
       WHERE gd.game_id IN ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004'));
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
  v_tracker := public.beer_guy_get_tracker('30000000-0000-4000-8000-000000000001');
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'history') AS row(value)
    WHERE row.value ->> 'player_id' = '40000000-0000-4000-8000-000000000020'
      AND row.value ->> 'player_name' = 'Former player'
      AND row.value ->> 'player_deleted' = 'true'
  ) THEN
    RAISE EXCEPTION 'deleted player history was dropped or not anonymized: %', v_tracker;
  END IF;

  -- A roster row becoming ineligible reopens only its future assignment.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  UPDATE public.team_rosters SET player_type = 'sub'
  WHERE player_id = '40000000-0000-4000-8000-000000000011'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND season_id = '20000000-0000-4000-8000-000000000001';
  IF EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE game_id = '50000000-0000-4000-8000-000000000002'
      AND assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'roster ineligibility did not reopen future Beer assignment';
  END IF;

  -- Simulate the existing profile-merge core's direct reassignment. An ineligible
  -- target reopens future Beer, while completed history follows the survivor.
  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status)
  VALUES ('50000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '10 days', 'completed');
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version)
  VALUES ('50000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001',
          v_beer_type_id, '40000000-0000-4000-8000-000000000021', 'completed', 1);

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000021', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001'
  );
  UPDATE public.game_duties
  SET assigned_player_id = '40000000-0000-4000-8000-000000000022'
  WHERE assigned_player_id = '40000000-0000-4000-8000-000000000021';

  IF EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE game_id = '50000000-0000-4000-8000-000000000003'
      AND assigned_player_id IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE game_id = '50000000-0000-4000-8000-000000000010'
      AND assigned_player_id = '40000000-0000-4000-8000-000000000022'
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'profile merge did not reopen future/preserve completed Beer assignment';
  END IF;
END;
$identity_lifecycle$;

SELECT 'beer guy deletion, roster and profile-merge lifecycle acceptance passed' AS result;
