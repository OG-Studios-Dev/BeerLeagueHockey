\set ON_ERROR_STOP on

DO $read_history$
DECLARE
  v_result jsonb;
  v_tracker jsonb;
  v_beer_type_id uuid;
  v_expected_date text;
  v_rejected boolean;
BEGIN
  SELECT id INTO v_beer_type_id FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';

  -- Current assignment used by member and public reads.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  v_result := public.beer_guy_get_game_state(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'game_id' <> '50000000-0000-4000-8000-000000000001'
     OR v_result ->> 'caller_eligible' <> 'true'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'member game-state projection is incorrect: %', v_result;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000018', false);
  v_rejected := false;
  BEGIN
    PERFORM public.beer_guy_get_game_state(
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'non-member read Beer game state'; END IF;

  v_result := public.beer_guy_get_public_next_assignment('30000000-0000-4000-8000-000000000001');
  IF v_result ->> 'game_id' <> '50000000-0000-4000-8000-000000000001'
     OR v_result ->> 'player_id' <> '40000000-0000-4000-8000-000000000011'
     OR (v_result - 'game_id' - 'team_id' - 'player_id') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'public projection is not the narrow next-game badge contract: %', v_result;
  END IF;

  -- Completed assignment is history; cancelled/postponed rows remain audit-only.
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version)
  VALUES
    ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', v_beer_type_id, '40000000-0000-4000-8000-000000000020', 'completed', 1),
    ('50000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', v_beer_type_id, '40000000-0000-4000-8000-000000000012', 'pending', 1),
    ('50000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', v_beer_type_id, '40000000-0000-4000-8000-000000000014', 'pending', 1);

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
  v_tracker := public.beer_guy_get_tracker('30000000-0000-4000-8000-000000000001');
  SELECT pg_catalog.to_char(g.scheduled_at AT TIME ZONE l.timezone, 'YYYY-MM-DD')
  INTO v_expected_date
  FROM public.games AS g JOIN public.leagues AS l ON l.id = g.league_id
  WHERE g.id = '50000000-0000-4000-8000-000000000004';

  IF v_tracker ->> 'season_id' <> '20000000-0000-4000-8000-000000000001'
     OR v_tracker ->> 'timezone' <> 'America/Toronto'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'roster') AS row(value)
       WHERE row.value ->> 'player_id' = '40000000-0000-4000-8000-000000000013'
         AND row.value ->> 'position' = 'Goalie'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'roster') AS row(value)
       WHERE row.value ->> 'player_id' IN (
         '40000000-0000-4000-8000-000000000014',
         '40000000-0000-4000-8000-000000000015'
       )
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'roster') AS row(value)
       WHERE pg_catalog.jsonb_typeof(row.value -> 'is_goalie') <> 'boolean'
     )
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_tracker -> 'history')) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'history') AS row(value)
       WHERE row.value ->> 'player_id' = '40000000-0000-4000-8000-000000000020'
         AND row.value ->> 'game_date' = v_expected_date
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_tracker -> 'history') AS row(value)
       WHERE row.value ->> 'game_id' IN (
         '50000000-0000-4000-8000-000000000005',
         '50000000-0000-4000-8000-000000000006'
       )
     ) THEN
    RAISE EXCEPTION 'captain tracker roster/history/timezone contract failed: %', v_tracker;
  END IF;

  -- Returning from postponed/cancelled to future scheduled reopens both an
  -- unconfirmed assignment and an assignment whose player is ineligible.
  UPDATE public.games SET status = 'scheduled'
  WHERE id IN (
    '50000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000006'
  );
  IF EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE game_id IN (
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000006'
    )
      AND assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rescheduled-game assignment lifecycle was not normalized';
  END IF;

  -- Completing a parent game marks only its Beer duty completed for history.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000012', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001'
  );
  UPDATE public.games SET status = 'completed'
  WHERE id = '50000000-0000-4000-8000-000000000009';
  IF NOT EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
    WHERE gd.game_id = '50000000-0000-4000-8000-000000000009'
      AND dt.system_key = 'beer_guy' AND gd.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'game completion did not complete Beer duty';
  END IF;
END;
$read_history$;

SELECT 'beer guy reads, history and game lifecycle acceptance passed' AS result;
