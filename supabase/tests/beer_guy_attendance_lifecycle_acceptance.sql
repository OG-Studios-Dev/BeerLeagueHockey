\set ON_ERROR_STOP on

DO $attendance_lifecycle$
DECLARE
  v_beer_type_id uuid;
  v_game_id uuid;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001'
    AND system_key = 'beer_guy';

  FOREACH v_game_id IN ARRAY ARRAY[
    '50000000-0000-4000-8000-000000000003'::uuid,
    '50000000-0000-4000-8000-000000000015'::uuid,
    '50000000-0000-4000-8000-000000000016'::uuid,
    '50000000-0000-4000-8000-000000000005'::uuid,
    '50000000-0000-4000-8000-000000000006'::uuid,
    '50000000-0000-4000-8000-000000000004'::uuid
  ]
  LOOP
    INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
    VALUES (
      v_game_id,
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000011',
      'confirmed'
    )
    ON CONFLICT (game_id, player_id) DO UPDATE
      SET team_id = EXCLUDED.team_id, status = EXCLUDED.status;

    INSERT INTO public.game_duties(
      game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version
    ) VALUES (
      v_game_id,
      '30000000-0000-4000-8000-000000000001',
      v_beer_type_id,
      '40000000-0000-4000-8000-000000000011',
      CASE WHEN v_game_id = '50000000-0000-4000-8000-000000000004'::uuid
        THEN 'completed' ELSE 'pending' END,
      1
    )
    ON CONFLICT (game_id, duty_type_id, team_id) DO UPDATE
      SET assigned_player_id = EXCLUDED.assigned_player_id,
          status = EXCLUDED.status;
  END LOOP;

  UPDATE public.game_checkins
  SET status = 'out'
  WHERE player_id = '40000000-0000-4000-8000-000000000011'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND game_id IN (
      '50000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000015',
      '50000000-0000-4000-8000-000000000016',
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000006',
      '50000000-0000-4000-8000-000000000004'
    );

  IF EXISTS (
    SELECT 1
    FROM public.game_duties AS gd
    JOIN public.games AS g ON g.id = gd.game_id
    WHERE gd.duty_type_id = v_beer_type_id
      AND gd.assigned_player_id IS NOT NULL
      AND gd.game_id IN (
        '50000000-0000-4000-8000-000000000003',
        '50000000-0000-4000-8000-000000000015',
        '50000000-0000-4000-8000-000000000016',
        '50000000-0000-4000-8000-000000000005',
        '50000000-0000-4000-8000-000000000006'
      )
  ) THEN
    RAISE EXCEPTION 'attendance response left false Beer history in a non-completed lifecycle: %',
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'game_id', gd.game_id,
         'game_status', g.status,
         'assigned_player_id', gd.assigned_player_id
       ))
       FROM public.game_duties AS gd
       JOIN public.games AS g ON g.id = gd.game_id
       WHERE gd.duty_type_id = v_beer_type_id
         AND gd.assigned_player_id IS NOT NULL
         AND gd.game_id IN (
           '50000000-0000-4000-8000-000000000003',
           '50000000-0000-4000-8000-000000000015',
           '50000000-0000-4000-8000-000000000016',
           '50000000-0000-4000-8000-000000000005',
           '50000000-0000-4000-8000-000000000006'
         ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE game_id = '50000000-0000-4000-8000-000000000004'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND duty_type_id = v_beer_type_id
      AND assigned_player_id = '40000000-0000-4000-8000-000000000011'
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'completed Beer history changed with a later attendance response';
  END IF;
END;
$attendance_lifecycle$;

SELECT 'beer guy attendance lifecycle matrix acceptance passed' AS result;
