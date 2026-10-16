\set ON_ERROR_STOP on

DO $seed$
DECLARE
  v_beer_type_id uuid;
BEGIN
  SELECT id INTO v_beer_type_id FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';
  PERFORM pg_catalog.set_config('test.beer_guy_type_id', v_beer_type_id::text, false);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);
  PERFORM public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version)
  VALUES ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
          v_beer_type_id, '40000000-0000-4000-8000-000000000020', 'completed', 1);
  INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
  VALUES ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000012', 'tentative');
END;
$seed$;

-- Existing/live duty metadata policies may hide the canonical row. Beer guards
-- must classify it through a hardened policy helper rather than caller-visible rows.
CREATE POLICY fixture_hide_canonical_duty_type
  ON public.duty_types AS RESTRICTIVE FOR SELECT TO authenticated
  USING (system_key IS NULL);

SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false);

DO $authenticated_security$
DECLARE
  v_affected integer := 0;
  v_blocked boolean := false;
  v_beer_type_id uuid;
BEGIN
  v_beer_type_id := pg_catalog.current_setting('test.beer_guy_type_id')::uuid;

  BEGIN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = '40000000-0000-4000-8000-000000000012'
    WHERE gd.game_id = '50000000-0000-4000-8000-000000000001'
      AND gd.duty_type_id = v_beer_type_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked AND v_affected <> 0 THEN
    RAISE EXCEPTION 'authenticated direct Beer assignment update bypassed RPC authority';
  END IF;

  v_blocked := false;
  BEGIN
    INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id)
    VALUES ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
            v_beer_type_id, '40000000-0000-4000-8000-000000000011');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'authenticated direct Beer assignment insert bypassed RPC authority';
  END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.duty_types SET name = 'Tampered'
    WHERE id = v_beer_type_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked AND v_affected <> 0 THEN
    RAISE EXCEPTION 'authenticated direct canonical duty update bypassed system ownership';
  END IF;

  -- Legacy duties keep their pre-existing direct-write behavior.
  UPDATE public.game_duties SET notes = 'legacy still writable'
  WHERE id = '70000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN RAISE EXCEPTION 'Beer guard broke legacy duty writes'; END IF;

  -- Members can directly see only current upcoming Beer state, never history.
  IF (SELECT pg_catalog.count(*)
      FROM public.game_duties AS gd
      WHERE gd.duty_type_id = v_beer_type_id) <> 4
     OR EXISTS (
       SELECT 1 FROM public.game_duties AS gd
       WHERE gd.duty_type_id = v_beer_type_id
         AND gd.game_id = '50000000-0000-4000-8000-000000000004'
     ) THEN
    RAISE EXCEPTION 'authenticated direct Beer reads exceeded current team/game scope';
  END IF;

  -- Direct legacy attendance writes cannot bypass the atomic release invariant.
  UPDATE public.game_checkins SET status = 'confirmed'
  WHERE game_id = '50000000-0000-4000-8000-000000000001'
    AND player_id = '40000000-0000-4000-8000-000000000011';
  IF EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    WHERE gd.game_id = '50000000-0000-4000-8000-000000000001'
      AND gd.duty_type_id = v_beer_type_id
      AND gd.assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'direct check-in write bypassed Beer release invariant';
  END IF;

  v_blocked := false;
  v_affected := 0;
  BEGIN
    UPDATE public.game_checkins SET status = 'out'
    WHERE game_id = '50000000-0000-4000-8000-000000000002'
      AND player_id = '40000000-0000-4000-8000-000000000012';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked AND v_affected <> 0 THEN
    RAISE EXCEPTION 'authenticated player directly changed another player check-in';
  END IF;

  v_blocked := false;
  BEGIN
    PERFORM public._beer_guy_current_season_id('10000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'authenticated role can execute internal Beer helper'; END IF;
END;
$authenticated_security$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000018', false);
DO $outsider_read$
DECLARE
  v_beer_type_id uuid := pg_catalog.current_setting('test.beer_guy_type_id')::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_duties AS gd
    WHERE gd.duty_type_id = v_beer_type_id
  ) THEN
    RAISE EXCEPTION 'outsider directly read team Beer state';
  END IF;
END;
$outsider_read$;

RESET ROLE;
SET ROLE anon;
DO $anon_acl$
DECLARE
  v_blocked boolean := false;
BEGIN
  PERFORM public.beer_guy_get_public_next_assignment('30000000-0000-4000-8000-000000000001');
  BEGIN
    PERFORM public.beer_guy_get_tracker('30000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'anon can execute captain tracker read'; END IF;
END;
$anon_acl$;
RESET ROLE;

SELECT 'beer guy direct-write and least-privilege acceptance passed' AS result;
