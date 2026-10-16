\set ON_ERROR_STOP on

DO $self_claim$
DECLARE
  v_result jsonb;
  v_version bigint;
  v_rejected boolean;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', false);
  BEGIN
    PERFORM public.beer_guy_claim(
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'anonymous Beer Guy claim unexpectedly succeeded';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'outcome' <> 'claimed'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000011'
     OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000001'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'eligible regular self-claim was not atomic: %', v_result;
  END IF;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'outcome' <> 'assigned_to_self'
     OR (v_result #>> '{assignment,version}')::bigint <> v_version THEN
    RAISE EXCEPTION 'self-claim idempotence contract failed: %', v_result;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000012', false);
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'outcome' <> 'taken'
     OR v_result #>> '{assignment,player_id}' <> '40000000-0000-4000-8000-000000000011'
     OR EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000012'
     ) THEN
    RAISE EXCEPTION 'losing self-claim was not truthful/read-only: %', v_result;
  END IF;

  -- Every ordinary response, including regular In and reset/no-response, releases
  -- only the caller's assignment while preserving attendance as its own state.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);
  FOREACH v_result IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object('status', 'confirmed'),
    pg_catalog.jsonb_build_object('status', 'tentative'),
    pg_catalog.jsonb_build_object('status', 'out'),
    pg_catalog.jsonb_build_object('status', NULL)
  ]
  LOOP
    PERFORM public.beer_guy_claim(
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
    PERFORM public.update_my_game_checkin(
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      v_result ->> 'status',
      'ordinary response'
    );
    IF EXISTS (
      SELECT 1 FROM public.game_duties AS gd
      JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
      WHERE gd.game_id = '50000000-0000-4000-8000-000000000001'
        AND gd.team_id = '30000000-0000-4000-8000-000000000001'
        AND dt.system_key = 'beer_guy' AND gd.assigned_player_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'ordinary response % did not release Beer Guy', v_result ->> 'status';
    END IF;
  END LOOP;

  -- Goalies are regular roster members and remain eligible.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000013', false);
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result ->> 'outcome' <> 'claimed' THEN
    RAISE EXCEPTION 'regular goalie was rejected: %', v_result;
  END IF;

  -- Explicit allowlist: sub, part_time, inactive, ended, old-season and outsider
  -- identities all fail even if another historical or team row looks plausible.
  FOREACH v_result IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000014'),
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000015'),
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000016'),
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000017'),
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000019'),
    pg_catalog.jsonb_build_object('player', '40000000-0000-4000-8000-000000000018')
  ]
  LOOP
    v_rejected := false;
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_result ->> 'player', false);
    BEGIN
      PERFORM public.beer_guy_claim(
        '50000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000001'
      );
    EXCEPTION WHEN insufficient_privilege THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'ineligible player % was allowed to claim', v_result ->> 'player';
    END IF;
  END LOOP;

  -- Old-season, past, cancelled/postponed and wrong-team games fail closed.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000012', false);
  FOREACH v_result IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object('game', '50000000-0000-4000-8000-000000000008', 'team', '30000000-0000-4000-8000-000000000001'),
    pg_catalog.jsonb_build_object('game', '50000000-0000-4000-8000-000000000007', 'team', '30000000-0000-4000-8000-000000000001'),
    pg_catalog.jsonb_build_object('game', '50000000-0000-4000-8000-000000000005', 'team', '30000000-0000-4000-8000-000000000001'),
    pg_catalog.jsonb_build_object('game', '50000000-0000-4000-8000-000000000006', 'team', '30000000-0000-4000-8000-000000000001'),
    pg_catalog.jsonb_build_object('game', '50000000-0000-4000-8000-000000000003', 'team', '30000000-0000-4000-8000-000000000003')
  ]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.beer_guy_claim((v_result ->> 'game')::uuid, (v_result ->> 'team')::uuid);
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE IN ('22023', '42501') THEN v_rejected := true; ELSE RAISE; END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'invalid game scope unexpectedly accepted: %', v_result;
    END IF;
  END LOOP;
END;
$self_claim$;

DO $concurrency$
DECLARE
  v_claimed integer;
  v_taken integer;
  v_winner uuid;
BEGIN
  SELECT pg_catalog.count(*) FILTER (WHERE result ->> 'outcome' = 'claimed'),
         pg_catalog.count(*) FILTER (WHERE result ->> 'outcome' = 'taken')
  INTO v_claimed, v_taken
  FROM public.beer_guy_concurrency_results;
  IF v_claimed <> 1 OR v_taken <> 1 THEN
    RAISE EXCEPTION 'two-session race did not produce exactly one winner and one truthful loser: %',
      (SELECT pg_catalog.jsonb_agg(result) FROM public.beer_guy_concurrency_results);
  END IF;

  SELECT assigned_player_id INTO v_winner
  FROM public.game_duties AS gd
  JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
  WHERE gd.game_id = '50000000-0000-4000-8000-000000000002'
    AND gd.team_id = '30000000-0000-4000-8000-000000000001'
    AND dt.system_key = 'beer_guy';
  IF v_winner IS NULL OR EXISTS (
    SELECT 1 FROM public.beer_guy_concurrency_results
    WHERE result #>> '{assignment,player_id}' <> v_winner::text
  ) THEN
    RAISE EXCEPTION 'race replies disagree with committed winner %', v_winner;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.game_checkins
      WHERE game_id = '50000000-0000-4000-8000-000000000002' AND status = 'confirmed') <> 1 THEN
    RAISE EXCEPTION 'losing racer attendance was changed';
  END IF;
END;
$concurrency$;

SELECT 'beer guy self claim and real concurrency acceptance passed' AS result;
