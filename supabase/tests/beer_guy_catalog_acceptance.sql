\set ON_ERROR_STOP on

DO $catalog$
DECLARE
  v_beer_type_count integer;
  v_function record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'duty_types'
      AND column_name = 'system_key' AND data_type = 'text' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'duty_types.system_key nullable text contract is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_duties'
      AND column_name = 'assignment_version' AND data_type = 'bigint' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'game_duties.assignment_version bigint contract is missing';
  END IF;

  SELECT pg_catalog.count(*) INTO v_beer_type_count
  FROM public.duty_types
  WHERE system_key = 'beer_guy';
  IF v_beer_type_count <> 3 THEN
    RAISE EXCEPTION 'expected one canonical Beer Guy duty for each of 3 teams, got %', v_beer_type_count;
  END IF;

  IF EXISTS (
    SELECT team_id FROM public.duty_types WHERE system_key = 'beer_guy'
    GROUP BY team_id HAVING pg_catalog.count(*) <> 1
  ) OR EXISTS (
    SELECT 1 FROM public.duty_types
    WHERE system_key = 'beer_guy'
      AND (name <> 'Beer Guy'
           OR description <> 'Brings beer for the team game'
           OR icon <> 'beer'
           OR is_active IS NOT TRUE
           OR sort_order <> 0)
  ) THEN
    RAISE EXCEPTION 'canonical Beer Guy duty is not unique or has noncanonical display data';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.duty_types
    WHERE id = '60000000-0000-4000-8000-000000000001' AND name = 'Snacks' AND system_key IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.duty_types
    WHERE id = '60000000-0000-4000-8000-000000000002'
      AND team_id = '30000000-0000-4000-8000-000000000002'
      AND name = 'Beer Guy' AND system_key = 'beer_guy'
      AND description = 'Brings beer for the team game' AND icon = 'beer'
      AND is_active IS TRUE AND sort_order = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE id = '70000000-0000-4000-8000-000000000001' AND notes = 'preserve me'
  ) THEN
    RAISE EXCEPTION 'migration did not preserve/adopt legacy duty data';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = 'public.captain_manage_game_checkin(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure
      AND p.pronargdefaults = 1
      AND pg_catalog.pg_get_expr(p.proargdefaults, 0) = 'NULL::text'
  ) THEN
    RAISE EXCEPTION 'captain check-in RPC did not preserve its exact trailing NULL default';
  END IF;

  FOR v_function IN
    SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE '\_beer\_guy\_%' ESCAPE '\'
        OR p.proname IN (
          'beer_guy_claim', 'update_my_game_checkin', 'beer_guy_captain_manage',
          'captain_manage_game_checkin', 'beer_guy_get_game_state', 'beer_guy_get_tracker',
          'beer_guy_get_public_next_assignment'
        )
      )
  LOOP
    IF NOT v_function.prosecdef
       OR v_function.proconfig IS NULL
       OR NOT (v_function.proconfig @> ARRAY['search_path=""']::text[]) THEN
      RAISE EXCEPTION 'function % is not SECURITY DEFINER with empty search_path (prosecdef %, proconfig %)',
        v_function.proname, v_function.prosecdef, v_function.proconfig;
    END IF;
  END LOOP;
END;
$catalog$;

SELECT 'beer guy catalog acceptance passed' AS result;
