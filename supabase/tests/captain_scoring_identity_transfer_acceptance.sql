\set ON_ERROR_STOP on
-- Run on the production-shaped scoring fixture with current canonical claim and
-- deletion bodies loaded. Maintenance acceptance is not signed-user acceptance.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE n integer; r jsonb; replay jsonb; name text; req uuid; BEGIN
 FOR n IN 1..3 LOOP
 name:=CASE n WHEN 1 THEN 'Indigo Transferclaim' WHEN 2 THEN 'Ochre Transferassist' ELSE 'Magenta Transferother' END;
 req:=('c9000000-0000-4000-8000-00000000000'||n)::uuid;
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',req,'manual',p_manual_name=>name,p_manual_jersey=>90+n,p_save_to_team_spares=>true);
 replay:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',req,'manual',p_manual_name=>name,p_manual_jersey=>90+n,p_save_to_team_spares=>true);
 ASSERT r=replay AND r->>'outcome'='confirmed','real guest receipt replay';
 END LOOP;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
BEGIN;
INSERT INTO auth.users(id) VALUES('c9000000-0000-4000-8000-000000000030'),('c9000000-0000-4000-8000-000000000031');
INSERT INTO public.profiles(id,email,full_name,is_platform_admin) VALUES('c9000000-0000-4000-8000-000000000030','transfer-target@example.invalid','Identity Target',false),('c9000000-0000-4000-8000-000000000031','transfer-admin@example.invalid','Identity Admin',true);
COMMIT;
BEGIN;

CREATE FUNCTION pg_temp.transfer_fingerprint() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('events',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.game_events x),'requests',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_id),'[]') FROM public.captain_game_scoring_requests x),'sub_receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_id),'[]') FROM public.captain_sub_request_receipts x),'presence',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY game_id,team_id,player_id),'[]') FROM public.captain_game_scoring_presence x),'states',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY game_id),'[]') FROM public.captain_game_scoring_state x),'checkins',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.game_checkins x),'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.profiles x),'rosters',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.team_rosters x),'caps',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public._captain_scoring_identity_transfer x));
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.transfer_fingerprint() TO authenticated,postgres,service_role;

COMMIT;
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $$ DECLARE r jsonb; BEGIN r:=public.captain_manage_game_scoring('{"schema_version":1,"request_id":"c7000000-0000-4000-8000-000000000004","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"Claim boundary test"}'); ASSERT r->>'outcome'='applied',r::text; END $$;
RESET ROLE;
SET LOCAL ROLE postgres;
DO $$ DECLARE r jsonb; guest uuid; BEGIN
 SELECT id INTO guest FROM public.profiles WHERE full_name='Indigo Transferclaim';
 ASSERT guest IS NOT NULL;
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',guest);
 RAISE NOTICE 'C7_MANAGED_CLAIM_OBSERVATION: %',r;
 ASSERT (r->>'success')::boolean,r::text; ASSERT (r->>'total_reassigned')::integer=3,'complete reassignment count includes pretransferred checkin';
END $$;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,start_date) VALUES('c9000000-0000-4000-8000-000000000030','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sub',CURRENT_DATE-1);
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','confirmed');
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id IN('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002');
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000020','spare',p_player_id=>a,p_confirmed=>true);
 ASSERT r->>'outcome'='confirmed',r::text;
 r:=public.captain_manage_game_scoring('{"schema_version":1,"request_id":"c8000000-0000-4000-8000-000000000021","game_id":"50000000-0000-4000-8000-000000000002","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"Scratch identity transfer"}'); ASSERT r->>'outcome'='applied',r::text;
 r:=public.captain_manage_game_scoring(jsonb_build_object('schema_version',1,'request_id','c8000000-0000-4000-8000-000000000022','game_id','50000000-0000-4000-8000-000000000002','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','scratch','player_id',a,'expected_version',0)); ASSERT r->>'outcome'='applied',r::text;
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
CREATE TEMP TABLE it_replays AS SELECT payload,terminal->'receipt' receipt FROM public.captain_game_scoring_requests WHERE request_id::text LIKE 'c8000000-%';
GRANT SELECT ON it_replays TO authenticated;
CREATE TEMP TABLE before_transfer AS SELECT pg_temp.transfer_fingerprint() f;
GRANT SELECT ON before_transfer TO postgres;
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
 ASSERT (SELECT count(*)=3 AND min(event_version)=2 AND max(event_version)=2 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000001'),'event IDs and per-event versions retained';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE player_id='c9000000-0000-4000-8000-000000000030'),'scorer credit transferred';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE assist1_player_id='c9000000-0000-4000-8000-000000000030'),'first assist transferred';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE assist2_player_id='c9000000-0000-4000-8000-000000000030'),'second assist transferred';
 ASSERT (SELECT home_score=3 AND away_score=0 FROM public.games WHERE id='50000000-0000-4000-8000-000000000001'),'game totals retained';
 ASSERT pg_temp.transfer_fingerprint()->'requests'=(SELECT f->'requests' FROM before_transfer),'immutable scoring UUID ledger unchanged';
 ASSERT pg_temp.transfer_fingerprint()->'sub_receipts'=(SELECT f->'sub_receipts' FROM before_transfer),'immutable invitation UUID ledger unchanged';
 ASSERT NOT EXISTS(SELECT 1 FROM public._captain_scoring_identity_transfer),'no successful transfer capability residue';
 ASSERT NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_presence WHERE player_id=a),'retired guest private presence removed';
 ASSERT EXISTS(SELECT 1 FROM public.captain_game_scoring_presence WHERE player_id='c9000000-0000-4000-8000-000000000030' AND game_id='50000000-0000-4000-8000-000000000002' AND version>1),'scratch presence transferred and invalidated';
 ASSERT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id='c9000000-0000-4000-8000-000000000030' AND game_id='50000000-0000-4000-8000-000000000002' AND status='out'),'game-only scratch retained';
END $test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000040","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}'; r jsonb; BEGIN
 r:=public.captain_get_game_scoring_context(q); ASSERT r->>'outcome'='ok',r::text;
 ASSERT r#>>'{snapshot,game,home_score}'='3';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'eligible_for_goal'='true'),'canonical target is eligible';
 r:=public.captain_get_game_scoring_context(q||'{"game_id":"50000000-0000-4000-8000-000000000002"}');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'state'='scratched' AND (x->>'presence_version')::integer>1),'canonical target scratch retained';
END $test$;

DO $test$ DECLARE x record; r jsonb; before jsonb:=pg_temp.transfer_fingerprint(); BEGIN
 FOR x IN SELECT * FROM pg_temp.it_replays LOOP
  r:=public.captain_manage_game_scoring(x.payload); ASSERT r->>'outcome'='replayed' AND r->'receipt'=x.receipt,'postclaim exact UUID receipt replay';
 END LOOP;
 ASSERT pg_temp.transfer_fingerprint()=before,'postclaim replay performs no business/version/ledger mutation';
END $test$;
RESET ROLE;
INSERT INTO public.account_deletion_state(user_id,initiation_kind,workflow_state,started_at,updated_at,storage_deleted_at) VALUES('c9000000-0000-4000-8000-000000000030','immediate','irreversible',now(),now(),now());
SET LOCAL SESSION AUTHORIZATION service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT public.execute_account_deletion('c9000000-0000-4000-8000-000000000030');
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id='c9000000-0000-4000-8000-000000000030' AND deleted_at IS NOT NULL AND identity_provenance='auth_account'),'tombstone retains identity';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='c9000000-0000-4000-8000-000000000030'),'Auth removed';
 ASSERT NOT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id='c9000000-0000-4000-8000-000000000030'),'noncompleted operational checkins removed';
 ASSERT (SELECT count(*)=3 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000001'),'credited events retained after deletion';
 ASSERT EXISTS(SELECT 1 FROM public.account_deletion_state WHERE user_id='c9000000-0000-4000-8000-000000000030' AND workflow_state='database_deleted');
END $test$;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000041","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'state'='credited_not_eligible' AND x->>'has_credited_stats'='true' AND x->>'eligible_for_goal'='false'),'honest postdeletion context';
END $test$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
SET LOCAL SESSION AUTHORIZATION service_role;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.admin_merge_legacy_profile('c9000000-0000-4000-8000-000000000031','c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
END $test$;
RESET SESSION AUTHORIZATION;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,start_date) VALUES('c9000000-0000-4000-8000-000000000030','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sub',CURRENT_DATE-1);
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status)
SELECT '50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',id,'available' FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim'
UNION ALL SELECT '50000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000001'::uuid,'c9000000-0000-4000-8000-000000000030'::uuid,'available';
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
UPDATE public.games SET skater_capture_status='complete',penalty_capture_status='not_recorded',goalie_capture_status='not_recorded' WHERE id='50000000-0000-4000-8000-000000000001';
INSERT INTO public.game_submissions(game_id,league_id,status) VALUES('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','submitted');
SET LOCAL SESSION AUTHORIZATION service_role;
SELECT public.finalize_game_stats_atomic('50000000-0000-4000-8000-000000000001',true);
SELECT public.recalculate_game_stats_atomic('50000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000031');
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
 ASSERT EXISTS(SELECT 1 FROM public.player_stats WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='c9000000-0000-4000-8000-000000000030' AND goals=1 AND assists=2 AND scorekeeping_provenance='event_derived'),'actual materialized totals transferred';
 ASSERT (SELECT sum(value)=1 FROM public.game_stats WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='c9000000-0000-4000-8000-000000000030' AND stat_type='Goal'),'legacy goal totals retained';
 ASSERT (SELECT sum(value)=2 FROM public.game_stats WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='c9000000-0000-4000-8000-000000000030' AND stat_type='Assist'),'legacy assist totals retained';
END $test$;
RESET ROLE;
INSERT INTO public.account_deletion_state(user_id,initiation_kind,workflow_state,started_at,updated_at,storage_deleted_at) VALUES('c9000000-0000-4000-8000-000000000030','immediate','irreversible',now(),now(),now());
SET LOCAL SESSION AUTHORIZATION service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT public.execute_account_deletion('c9000000-0000-4000-8000-000000000030');
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id='c9000000-0000-4000-8000-000000000030' AND deleted_at IS NOT NULL AND identity_provenance='auth_account'),'tombstone retains identity';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='c9000000-0000-4000-8000-000000000030'),'Auth removed';
 ASSERT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id='c9000000-0000-4000-8000-000000000030' AND status='confirmed'),'completed participation retained';
 ASSERT EXISTS(SELECT 1 FROM public.player_stats WHERE player_id='c9000000-0000-4000-8000-000000000030' AND goals=1 AND assists=2),'materialized credit retained after canonical deletion';
 ASSERT (SELECT count(*)=3 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000001'),'credited events retained after deletion';
 ASSERT EXISTS(SELECT 1 FROM public.account_deletion_state WHERE user_id='c9000000-0000-4000-8000-000000000030' AND workflow_state='database_deleted');
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Same fixture: an app can edit its own benign checkin, not managed identity.
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','confirmed');
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; n integer; BEGIN
 r:=public.captain_manage_game_scoring('{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000050","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"negative-control"}'); ASSERT r->>'outcome'='applied';
 UPDATE public.game_checkins SET note='positive own-row control' WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='40000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=1;
 PERFORM set_config('request.jwt.claim.role','service_role',true); PERFORM set_config('captain_scoring.trusted_identity_transfer','true',true);
 BEGIN UPDATE public.game_checkins SET player_id='c9000000-0000-4000-8000-000000000030' WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='40000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'app identity mutation accepted'; EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='Managed attendance identity immutable'; END;
 BEGIN INSERT INTO public._captain_scoring_identity_transfer VALUES(pg_current_xact_id(),pg_backend_pid(),'40000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'app minted capability'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'app called claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL SESSION AUTHORIZATION service_role;
DO $test$ DECLARE r jsonb; before jsonb:=pg_temp.transfer_fingerprint(); BEGIN
 r:=public.admin_merge_legacy_profile('40000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000011'); ASSERT r->>'success'='false','nonadmin explicit actor denied';
 ASSERT pg_temp.transfer_fingerprint()=before,'nonadmin rejection atomic';
 BEGIN INSERT INTO public._captain_scoring_identity_transfer VALUES(pg_current_xact_id(),pg_backend_pid(),'40000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'service minted capability'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
-- Every capability dimension must match, including xact and physical backend.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SELECT public.captain_manage_game_scoring('{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000051","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"scope-control"}');
RESET ROLE;
DO $test$ DECLARE a uuid; i integer; BEGIN
 SELECT id INTO a FROM public.profiles WHERE full_name='Indigo Transferclaim';
 FOR i IN 1..6 LOOP
  INSERT INTO public._captain_scoring_identity_transfer VALUES(CASE WHEN i=1 THEN '1'::xid8 ELSE pg_current_xact_id() END,CASE WHEN i=2 THEN pg_backend_pid()+1 ELSE pg_backend_pid() END,CASE WHEN i=3 THEN '40000000-0000-4000-8000-000000000011'::uuid ELSE a END,CASE WHEN i=4 THEN '40000000-0000-4000-8000-000000000012'::uuid ELSE 'c9000000-0000-4000-8000-000000000030'::uuid END,CASE WHEN i=5 THEN '50000000-0000-4000-8000-000000000002'::uuid ELSE '50000000-0000-4000-8000-000000000001'::uuid END,CASE WHEN i=6 THEN '30000000-0000-4000-8000-000000000002'::uuid ELSE '30000000-0000-4000-8000-000000000001'::uuid END);
  BEGIN UPDATE public.game_checkins SET player_id='c9000000-0000-4000-8000-000000000030' WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id=a; RAISE EXCEPTION 'mismatched capability accepted'; EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='Managed attendance identity immutable'; END;
  DELETE FROM public._captain_scoring_identity_transfer;
 END LOOP;
END $test$;
ROLLBACK;

BEGIN;
CREATE FUNCTION pg_temp.it_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'injected after trusted transfer'; END $f$;
CREATE TRIGGER it_fail_delete BEFORE DELETE ON public.profiles FOR EACH ROW WHEN(OLD.full_name='Indigo Transferclaim') EXECUTE FUNCTION pg_temp.it_fail_delete();
SET LOCAL ROLE postgres;
DO $test$ DECLARE a uuid; before jsonb:=pg_temp.transfer_fingerprint(); r jsonb; BEGIN
 SELECT id INTO a FROM public.profiles WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT r->>'success'='false' AND r->>'error' LIKE '%injected after trusted transfer%';
 ASSERT pg_temp.transfer_fingerprint()=before,'downstream failure rolls back all transferred authority and capability';
END $test$;
RESET ROLE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id IN('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002');
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000020','spare',p_player_id=>a,p_confirmed=>true);
 ASSERT r->>'outcome'='confirmed',r::text;
 r:=public.captain_manage_game_scoring('{"schema_version":1,"request_id":"c8000000-0000-4000-8000-000000000021","game_id":"50000000-0000-4000-8000-000000000002","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"Scratch identity transfer"}'); ASSERT r->>'outcome'='applied',r::text;
 r:=public.captain_manage_game_scoring(jsonb_build_object('schema_version',1,'request_id','c8000000-0000-4000-8000-000000000022','game_id','50000000-0000-4000-8000-000000000002','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','scratch','player_id',a,'expected_version',0)); ASSERT r->>'outcome'='applied',r::text;
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
CREATE TEMP TABLE it_replays AS SELECT payload,terminal->'receipt' receipt FROM public.captain_game_scoring_requests WHERE request_id::text LIKE 'c8000000-%';
GRANT SELECT ON it_replays TO authenticated;
CREATE TEMP TABLE before_transfer AS SELECT pg_temp.transfer_fingerprint() f;
GRANT SELECT ON before_transfer TO postgres;
CREATE TEMP TABLE it_admin_result(r jsonb); GRANT SELECT,INSERT ON it_admin_result TO service_role,postgres;
SET LOCAL SESSION AUTHORIZATION service_role;
INSERT INTO it_admin_result SELECT public.admin_merge_legacy_profile('c9000000-0000-4000-8000-000000000031','c9000000-0000-4000-8000-000000000030',(SELECT id FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim'));
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT x.r INTO r FROM pg_temp.it_admin_result x;
 ASSERT (r->>'success')::boolean,r::text;
 ASSERT (SELECT count(*)=3 AND min(event_version)=2 AND max(event_version)=2 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000001'),'event IDs and per-event versions retained';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE player_id='c9000000-0000-4000-8000-000000000030'),'scorer credit transferred';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE assist1_player_id='c9000000-0000-4000-8000-000000000030'),'first assist transferred';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE assist2_player_id='c9000000-0000-4000-8000-000000000030'),'second assist transferred';
 ASSERT (SELECT home_score=3 AND away_score=0 FROM public.games WHERE id='50000000-0000-4000-8000-000000000001'),'game totals retained';
 ASSERT pg_temp.transfer_fingerprint()->'requests'=(SELECT f->'requests' FROM before_transfer),'immutable scoring UUID ledger unchanged';
 ASSERT pg_temp.transfer_fingerprint()->'sub_receipts'=(SELECT f->'sub_receipts' FROM before_transfer),'immutable invitation UUID ledger unchanged';
 ASSERT NOT EXISTS(SELECT 1 FROM public._captain_scoring_identity_transfer),'no successful transfer capability residue';
 ASSERT NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_presence WHERE player_id=a),'retired guest private presence removed';
 ASSERT EXISTS(SELECT 1 FROM public.captain_game_scoring_presence WHERE player_id='c9000000-0000-4000-8000-000000000030' AND game_id='50000000-0000-4000-8000-000000000002' AND version>1),'scratch presence transferred and invalidated';
 ASSERT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id='c9000000-0000-4000-8000-000000000030' AND game_id='50000000-0000-4000-8000-000000000002' AND status='out'),'game-only scratch retained';
END $test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000040","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}'; r jsonb; BEGIN
 r:=public.captain_get_game_scoring_context(q); ASSERT r->>'outcome'='ok',r::text;
 ASSERT r#>>'{snapshot,game,home_score}'='3';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'eligible_for_goal'='true'),'canonical target is eligible';
 r:=public.captain_get_game_scoring_context(q||'{"game_id":"50000000-0000-4000-8000-000000000002"}');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'state'='scratched' AND (x->>'presence_version')::integer>1),'canonical target scratch retained';
END $test$;

DO $test$ DECLARE x record; r jsonb; before jsonb:=pg_temp.transfer_fingerprint(); BEGIN
 FOR x IN SELECT * FROM pg_temp.it_replays LOOP
  r:=public.captain_manage_game_scoring(x.payload); ASSERT r->>'outcome'='replayed' AND r->'receipt'=x.receipt,'postclaim exact UUID receipt replay';
 END LOOP;
 ASSERT pg_temp.transfer_fingerprint()=before,'postclaim replay performs no business/version/ledger mutation';
END $test$;
RESET ROLE;
INSERT INTO public.account_deletion_state(user_id,initiation_kind,workflow_state,started_at,updated_at,storage_deleted_at) VALUES('c9000000-0000-4000-8000-000000000030','immediate','irreversible',now(),now(),now());
SET LOCAL SESSION AUTHORIZATION service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT public.execute_account_deletion('c9000000-0000-4000-8000-000000000030');
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id='c9000000-0000-4000-8000-000000000030' AND deleted_at IS NOT NULL AND identity_provenance='auth_account'),'tombstone retains identity';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='c9000000-0000-4000-8000-000000000030'),'Auth removed';
 ASSERT NOT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id='c9000000-0000-4000-8000-000000000030'),'noncompleted operational checkins removed';
 ASSERT (SELECT count(*)=3 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000001'),'credited events retained after deletion';
 ASSERT EXISTS(SELECT 1 FROM public.account_deletion_state WHERE user_id='c9000000-0000-4000-8000-000000000030' AND workflow_state='database_deleted');
END $test$;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"c9000000-0000-4000-8000-000000000041","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='c9000000-0000-4000-8000-000000000030' AND x->>'state'='credited_not_eligible' AND x->>'has_credited_stats'='true' AND x->>'eligible_for_goal'='false'),'honest postdeletion context';
END $test$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;


-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=(SELECT joined_at-interval '1 minute' FROM public.team_rosters WHERE player_id=(SELECT id FROM public.profiles WHERE full_name='Indigo Transferclaim') LIMIT 1) WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
DELETE FROM public.game_checkins WHERE player_id=(SELECT id FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim');
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
 ASSERT NOT public.scorekeeping_player_on_team_private('50000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','30000000-0000-4000-8000-000000000001'),'temporary transfer is not ongoing attendance authority';
 ASSERT NOT EXISTS(SELECT 1 FROM public._captain_scoring_identity_transfer),'retained-credit transfer capability consumed';
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Credited scorer and each assist slot traverse the actual canonical core.
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE it_ids AS SELECT id,full_name FROM public.profiles WHERE full_name IN('Indigo Transferclaim','Ochre Transferassist','Magenta Transferother');
GRANT SELECT ON it_ids TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; a uuid; b uuid; c uuid; i integer; q jsonb; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 SELECT id INTO b FROM pg_temp.it_ids WHERE full_name='Ochre Transferassist';
 SELECT id INTO c FROM pg_temp.it_ids WHERE full_name='Magenta Transferother';
 FOR i IN 1..3 LOOP
  q:=jsonb_build_object('schema_version',1,'request_id',('c8000000-0000-4000-8000-00000000000'||i)::uuid,'game_id','50000000-0000-4000-8000-000000000001','team_id','30000000-0000-4000-8000-000000000001','league_id','10000000-0000-4000-8000-000000000001','kind','add_goal','event_id',('c8000000-0000-4000-8000-00000000001'||i)::uuid,'expected_version',NULL,'scorer_id',CASE WHEN i=1 THEN a ELSE b END,'assist1_id',CASE WHEN i=2 THEN a ELSE c END,'assist2_id',CASE WHEN i=3 THEN a ELSE NULL END);
  r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied',r::text;
 END LOOP;
END $test$;
RESET ROLE;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,start_date) VALUES('c9000000-0000-4000-8000-000000000030','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sub',CURRENT_DATE-1);
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','confirmed');
INSERT INTO public.sub_invitations(game_id,team_id,invited_by,invited_player_id,source_type,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000030','team','accepted');
SET LOCAL ROLE postgres;
DO $test$ DECLARE r jsonb; a uuid; BEGIN
 SELECT id INTO a FROM pg_temp.it_ids WHERE full_name='Indigo Transferclaim';
 r:=public.claim_rostered_player_profile('c9000000-0000-4000-8000-000000000030',a);
 ASSERT (r->>'success')::boolean,r::text;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

DO $test$ DECLARE r record; BEGIN
 ASSERT (SELECT relrowsecurity AND pg_get_userbyid(relowner)='postgres' FROM pg_class WHERE oid='public._captain_scoring_identity_transfer'::regclass),'private capability owner and RLS';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_attrdef WHERE adrelid='public._captain_scoring_identity_transfer'::regclass),'capability bindings have no caller-overridable defaults';
 FOR r IN SELECT * FROM (VALUES('anon'),('authenticated'),('service_role'),('captain_sub_authority')) x(name) LOOP
  ASSERT NOT has_table_privilege(r.name,'public._captain_scoring_identity_transfer','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'no app/adjacent-role capability mint';
  ASSERT NOT has_function_privilege(r.name,'public.claim_rostered_player_profile(uuid,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege(r.name,'public.merge_legacy_profile(uuid,uuid)','EXECUTE');
 END LOOP;
 ASSERT has_table_privilege('captain_scoring_authority','public._captain_scoring_identity_transfer','SELECT');
 ASSERT NOT has_table_privilege('captain_scoring_authority','public._captain_scoring_identity_transfer','INSERT,UPDATE,DELETE');
 ASSERT NOT has_schema_privilege('captain_scoring_authority','public','CREATE');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='captain_scoring_authority'::regrole AND (inherit_option OR set_option));
 ASSERT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='captain_scoring_authority' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND rolbypassrls);
 FOR r IN SELECT * FROM (VALUES('public.claim_rostered_player_profile(uuid,uuid)','postgres','{postgres=X/postgres}'),('public.merge_legacy_profile(uuid,uuid)','postgres','{postgres=X/postgres}'),('public.admin_merge_legacy_profile(uuid,uuid,uuid)','postgres','{postgres=X/postgres,service_role=X/postgres}'),('public._cs_attendance_guard()','captain_scoring_authority','{captain_scoring_authority=X/captain_scoring_authority}'),('public._cs_event_guard()','captain_scoring_authority','{captain_scoring_authority=X/captain_scoring_authority}')) x(sig,owner_name,acl) LOOP
  ASSERT (SELECT pg_get_userbyid(proowner)=r.owner_name AND prosecdef AND pronargdefaults=0 AND proacl::text=r.acl FROM pg_proc WHERE oid=to_regprocedure(r.sig)),'replacement owner/default/ACL deterministic';
 END LOOP;
 ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND pronargdefaults=0 AND prosecdef FROM pg_proc WHERE oid='public._cs_actor_id()'::regprocedure),'C7 postgres actor bridge preserved';
 FOR r IN SELECT * FROM (VALUES ('_beer_guy_assert_captain','cdf602bad2a44581ada0dfa1ebf7e7a9'),('_beer_guy_assignment_json','2a41b5a7b814086431cbef0d5cb3d7df'),('_beer_guy_clear_for_checkin','867948742931b46f7d930912c3cae140'),('_beer_guy_create_team_duty','3757a305290f8102c56a3907bbcef8df'),('_beer_guy_current_season_id','697b8a0c209e6db42220b0f75157edff'),('_beer_guy_guard_sub_invitation_update','f53413a3edf5b7c2705122b268da3fc1'),('_beer_guy_has_confirmed_checkin','792276f78eaa539ba39670845e9d1884'),('_beer_guy_is_canonical_duty','f4e35c6223f414aaa3fc571c8526edcf'),('_beer_guy_is_eligible','877ad00736cd1d7db0a5e52246070438'),('_beer_guy_lock_attendance_game','bda3637fdb24bb9b9485e0b8b0fa36a7'),('_beer_guy_lock_future_game','e356efb267fdd7eafc414ee5f9760b7a'),('_beer_guy_normalize_assignment','9621da8b10bfb384ac293c3133b429c1'),('_beer_guy_preserve_assignment_delete','e55522ff0000a29d5c6f4b5f79510181'),('_beer_guy_reopen_for_accepted_sub','dd6ebd18520a4615ae365f64649eef4f'),('_beer_guy_reopen_for_profile','b046daf38fb1b21ef8234e6119447d93'),('_beer_guy_reopen_for_roster','6a766bdee81a5a901997e4527a56b92e'),('_beer_guy_sync_game_lifecycle','1d8ffe91ececccf816e89fd72a39feef'),('beer_guy_captain_manage','3678a7f8e7f0b02fde55be2a76fdccae'),('beer_guy_claim','766bd8a7d6fb30071c58cd28f1f06485'),('beer_guy_get_game_state','5984c80d788401dd16237624ebbf9b2c'),('beer_guy_get_public_next_assignment','01fdffea32bf7790f8067558f3fe8b82'),('beer_guy_get_tracker','cbb807e0eb47c7f9a4627315e9715d4a'),('captain_manage_game_checkin','424b86e6b157a5cd947a8529509cff5e')) x(name,expected) LOOP
  ASSERT (SELECT md5(prosrc)=r.expected FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=r.name),'original Beer/attendance function body preserved';
 END LOOP;
 ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND pronargdefaults=0 AND proacl::text='{postgres=X/postgres}' AND proconfig::text='{"search_path=public, pg_temp"}' FROM pg_proc WHERE oid='public.scorekeeping_player_on_team_private(uuid,uuid,uuid)'::regprocedure),'legacy attribution helper owner/default/ACL/config preserved';
 ASSERT NOT EXISTS(SELECT 1 FROM public._captain_scoring_identity_transfer),'no completed proof residue';
END $test$;
SELECT 'PASS managed identity transfer lifecycle and security' AS test;
