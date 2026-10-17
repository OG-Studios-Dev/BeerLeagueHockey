\set ON_ERROR_STOP on

DO $captain_cas$
DECLARE
  v_result jsonb;
  v_assignment_id uuid;
  v_candidate_id uuid;
  v_version bigint;
  v_rejected boolean;
BEGIN
  -- teams.captain_id is deliberately the outsider fixture and grants no authority.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000018', false);
  v_rejected := false;
  BEGIN
    PERFORM public.beer_guy_captain_manage(
      '50000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000011',
      NULL,
      NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'teams.captain_id incorrectly granted Beer Guy authority';
  END IF;

  -- Alternate captains receive the exact current-season roster authority.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', false);
  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    NULL,
    NULL
  );
  IF v_result ->> 'outcome' <> 'assigned'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000011'
     OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'alternate captain assignment was not atomic: %', v_result;
  END IF;
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  -- An unobserved/stale screen receives current committed state and changes nothing.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    NULL,
    NULL
  );
  IF v_result ->> 'outcome' <> 'conflict'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000011'
     OR EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND player_id = '40000000-0000-4000-8000-000000000012'
     ) THEN
    RAISE EXCEPTION 'stale captain assignment was not a truthful no-op: %', v_result;
  END IF;

  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    v_assignment_id,
    v_version
  );
  IF v_result ->> 'outcome' <> 'reassigned'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000012'
     OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'captain reassignment changed prior attendance or failed: %', v_result;
  END IF;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  -- The pre-reassignment version can no longer clear the new winner.
  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    NULL,
    v_assignment_id,
    v_version - 1
  );
  IF v_result ->> 'outcome' <> 'conflict'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000012' THEN
    RAISE EXCEPTION 'stale captain clear overwrote a newer action: %', v_result;
  END IF;

  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    NULL,
    v_assignment_id,
    v_version
  );
  IF v_result ->> 'outcome' <> 'cleared'
     OR v_result #> '{assignment,player_id}' <> 'null'::jsonb
     OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND player_id = '40000000-0000-4000-8000-000000000012'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'captain clear demoted attendance or failed: %', v_result;
  END IF;

  -- Captain assignment uses the same explicit regular allowlist.
  FOREACH v_candidate_id IN ARRAY ARRAY[
    '40000000-0000-4000-8000-000000000014'::uuid,
    '40000000-0000-4000-8000-000000000015'::uuid
  ]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.beer_guy_captain_manage(
        '50000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000001',
        v_candidate_id,
        (v_result #>> '{assignment,id}')::uuid,
        (v_result #>> '{assignment,version}')::bigint
      );
    EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'captain assigned ineligible sub/part_time %', v_candidate_id;
    END IF;
  END LOOP;

  -- Existing captain attendance API remains wire-compatible and now shares the
  -- same atomic clearing trigger for set and reset operations.
  v_result := public.beer_guy_captain_manage(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    (v_result #>> '{assignment,id}')::uuid,
    (v_result #>> '{assignment,version}')::bigint
  );
  v_result := public.captain_manage_game_checkin(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'set',
    'out'
  );
  IF v_result <> pg_catalog.jsonb_build_object(
       'outcome', 'set', 'operation', 'set', 'status', 'out',
       'affected_rows', 1, 'checkin_id', v_result -> 'checkin_id'
     ) OR EXISTS (
       SELECT 1 FROM public.game_duties AS gd
       WHERE gd.id = v_assignment_id AND gd.assigned_player_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'captain set response/Beer clear compatibility failed: %', v_result;
  END IF;

  -- The deployed trailing default keeps legacy four-argument reset calls valid;
  -- five-argument set calls above and below remain the explicit client contract.
  v_result := public.captain_manage_game_checkin(
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'reset'
  );
  IF v_result <> pg_catalog.jsonb_build_object(
       'outcome', 'reset', 'operation', 'reset', 'status', NULL,
       'affected_rows', 1, 'checkin_id', v_result -> 'checkin_id'
     ) OR EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'four-argument captain reset compatibility failed: %', v_result;
  END IF;

  -- The same authenticated database authority covers active game-day edits.
  v_result := public.captain_manage_game_checkin(
    '50000000-0000-4000-8000-000000000015',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'set',
    'confirmed'
  );
  IF v_result ->> 'outcome' <> 'set' OR NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000015'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND player_id = '40000000-0000-4000-8000-000000000011'
      AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'active-game captain attendance did not use database authority: %', v_result;
  END IF;

  -- An exact accepted game substitute remains attendance-eligible even without a
  -- team_rosters row, but is still Beer-ineligible through shared eligibility.
  INSERT INTO public.sub_invitations(
    game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
  ) VALUES (
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000022',
    'accepted', 'league', pg_catalog.now()
  );
  v_result := public.captain_manage_game_checkin(
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000022',
    'set',
    'confirmed'
  );
  IF v_result ->> 'outcome' <> 'set' OR NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000009'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND player_id = '40000000-0000-4000-8000-000000000022'
      AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'accepted substitute attendance was rejected: %', v_result;
  END IF;
END;
$captain_cas$;

SELECT 'beer guy captain CAS and attendance compatibility passed' AS result;
