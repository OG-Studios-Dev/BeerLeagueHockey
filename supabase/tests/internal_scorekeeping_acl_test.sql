\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'blh_reliability_test%' OR inet_server_port() <> 56479 THEN RAISE EXCEPTION 'Local fixture only'; END IF;
 IF has_function_privilege('service_role','public.check_and_lock_stats()','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: check_and_lock_stats()'; END IF;
 IF has_function_privilege('service_role','public.rebuild_corrected_players_private(uuid,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: rebuild_corrected_players_private(uuid,uuid[])'; END IF;
 IF has_function_privilege('service_role','public.rebuild_game_goalie_stats_private(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: rebuild_game_goalie_stats_private(uuid)'; END IF;
 IF has_function_privilege('service_role','public.rebuild_game_player_stats_private(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: rebuild_game_player_stats_private(uuid)'; END IF;
 IF has_function_privilege('service_role','public.rebuild_legacy_game_stats_private(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: rebuild_legacy_game_stats_private(uuid)'; END IF;
 IF has_function_privilege('service_role','public.reconcile_legacy_player_stats_private(uuid,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: reconcile_legacy_player_stats_private(uuid,uuid[])'; END IF;
 IF has_function_privilege('service_role','public.scorekeeping_admin_authorized_private(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: scorekeeping_admin_authorized_private(uuid,uuid)'; END IF;
 IF has_function_privilege('service_role','public.scorekeeping_player_on_team_private(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: scorekeeping_player_on_team_private(uuid,uuid,uuid)'; END IF;
 IF has_function_privilege('service_role','public.validate_game_event_attribution_private()','EXECUTE') THEN RAISE EXCEPTION 'Internal helper exposed to service role: validate_game_event_attribution_private()'; END IF;
 IF NOT has_function_privilege('service_role','public.finalize_game_stats_atomic(uuid,boolean)','EXECUTE') OR NOT has_function_privilege('service_role','public.start_scorekeeper_game_atomic(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Trusted entry points lost'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.rebuild_game_player_stats_private(NULL::uuid);
  RAISE EXCEPTION 'Direct private helper unexpectedly executed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.rollup_game_stats(NULL::uuid);
  RAISE EXCEPTION 'Missing-game public entry unexpectedly succeeded';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'Game not found' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SELECT 'internal helper ACL regression passed' AS result;
ROLLBACK;
