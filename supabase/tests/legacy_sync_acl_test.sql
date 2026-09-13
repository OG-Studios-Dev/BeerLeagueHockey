\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'blh_reliability_test%' OR inet_server_port() <> 56479 THEN RAISE EXCEPTION 'Local fixture only'; END IF;
 IF has_function_privilege('anon','public.sync_game_event(text,uuid,uuid,uuid,uuid,text,integer,integer,integer,text,uuid,uuid,boolean,boolean,boolean,text,uuid,text,boolean)','EXECUTE') OR has_function_privilege('authenticated','public.sync_game_event(text,uuid,uuid,uuid,uuid,text,integer,integer,integer,text,uuid,uuid,boolean,boolean,boolean,text,uuid,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Direct legacy sync must deny client roles'; END IF;
 IF NOT has_function_privilege('service_role','public.sync_game_event(text,uuid,uuid,uuid,uuid,text,integer,integer,integer,text,uuid,uuid,boolean,boolean,boolean,text,uuid,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Trusted server access must remain'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.sync_game_event('acl-probe',NULL,NULL,NULL,NULL,'goal',1);
  RAISE EXCEPTION 'Anonymous sync unexpectedly executed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'legacy sync ACL regression passed' AS result;
ROLLBACK;
