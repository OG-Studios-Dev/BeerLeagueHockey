\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,status,start_date,leadership_role) VALUES('40000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','regular','active',CURRENT_DATE-1,'captain');
SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000022';
DO $t$ DECLARE q jsonb:='{"schema_version":1,"request_id":"abcdef71-0000-4000-8000-000000000001","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000002","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb;BEGIN
r:=public.captain_get_game_scoring_context(q);ASSERT r->>'outcome'='ok';ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') p WHERE p->>'player_id'='40000000-0000-4000-8000-000000000011'),'opponent roster private';
r:=public.captain_manage_game_scoring(q||'{"kind":"set_commentary","expected_version":0,"text":"away private"}');ASSERT r->>'outcome'='applied';
BEGIN PERFORM public.captain_get_game_scoring_context(q||'{"team_id":"30000000-0000-4000-8000-000000000001"}');RAISE EXCEPTION 'cross-team captain accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM public._cs_actor_id();RAISE EXCEPTION 'private actor helper accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $t$;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $t$ DECLARE r jsonb;BEGIN
r:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"abcdef71-0000-4000-8000-000000000002","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');ASSERT r->>'outcome'='ok' AND r#>>'{snapshot,commentary,text}'='','canonical auth.uid claims fallback and own commentary';
BEGIN PERFORM * FROM public.captain_game_scoring_requests;RAISE EXCEPTION 'private ledger accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $t$;
RESET ROLE;
DO $t$ DECLARE app text;f record;BEGIN
ASSERT NOT has_schema_privilege('captain_scoring_authority','public','CREATE');ASSERT NOT has_schema_privilege('captain_scoring_authority','auth','USAGE');
ASSERT NOT pg_has_role('postgres','captain_scoring_authority','SET') AND NOT pg_has_role('postgres','captain_scoring_authority','USAGE'),'temporary deployment membership closed';
ASSERT (SELECT NOT rolcanlogin AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole FROM pg_roles WHERE rolname='captain_scoring_authority');
FOREACH app IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP ASSERT NOT pg_has_role(app,'captain_scoring_authority','MEMBER');ASSERT NOT has_function_privilege(app,'public._cs_actor_id()','EXECUTE'); END LOOP;
FOR f IN SELECT proname,proowner,prosecdef,proconfig,pronargdefaults FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('captain_get_game_scoring_context','captain_manage_game_scoring') LOOP
ASSERT pg_get_userbyid(f.proowner)='captain_scoring_authority' AND f.prosecdef AND f.proconfig=ARRAY['search_path=pg_catalog'] AND f.pronargdefaults=0;
END LOOP;
ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'] AND pronargdefaults=0 FROM pg_proc WHERE oid='public._cs_actor_id()'::regprocedure),'only private identity delegation is deployment-owned';
END $t$;
ROLLBACK;
