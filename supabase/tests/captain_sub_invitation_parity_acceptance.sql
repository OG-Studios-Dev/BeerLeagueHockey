\set ON_ERROR_STOP on
-- Documented email is allowed ONLY on scoped candidate/recent/result.player rows.
-- All fixtures and the exact-path oracle are transaction-local, without grant/RLS changes.
SET request.jwt.claim.role='authenticated';
BEGIN;
UPDATE public.profiles SET email='invite-privacy-'||id::text||'@example.invalid',phone='+1555'||right(id::text,8);
INSERT INTO public.player_stats(player_id,game_id,league_id,season_id,team_id) VALUES('40000000-0000-4000-8000-000000000019','50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.invite_sub_dto_exact(r jsonb) RETURNS boolean LANGUAGE sql AS $oracle$
 WITH RECURSIVE nodes(path,v) AS (
  SELECT ARRAY[]::text[],r UNION ALL
  SELECT n.path||child.k,child.v FROM nodes n CROSS JOIN LATERAL (
   SELECT key k,value v FROM jsonb_each(CASE WHEN jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END)
   UNION ALL SELECT '*',value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v)='array' THEN n.v ELSE '[]'::jsonb END)
  ) child
 ), checked AS (
  SELECT path,v,CASE
   WHEN path=ARRAY[]::text[] AND r ? 'candidates' THEN 'schema_version game_id team_id league_id season_id replacements candidates recent_players recent_loaded invitations'
   WHEN path=ARRAY[]::text[] THEN 'schema_version game_id team_id league_id season_id request_id outcome invitation player checkin_status'
   WHEN path=ARRAY['candidates','*'] THEN 'player_id full_name email position source'
   WHEN path=ARRAY['recent_players','*'] THEN 'player_id full_name email position source last_played_at'
   WHEN path=ARRAY['replacements','*'] THEN 'player_id full_name jersey_number position'
   WHEN path=ARRAY['invitations','*'] OR path=ARRAY['invitation'] THEN 'id player_id status replaced_player_id source'
   WHEN path=ARRAY['player'] THEN 'player_id full_name email position'
  END expected FROM nodes WHERE jsonb_typeof(v)='object'
 ) SELECT jsonb_typeof(r)='object' AND NOT EXISTS(
  SELECT 1 FROM checked WHERE expected IS NULL OR
   (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM
   (SELECT array_agg(k ORDER BY k) FROM unnest(string_to_array(expected,' ')) k)
 ) AND NOT EXISTS(
  SELECT 1 FROM nodes WHERE path[array_length(path,1)]='email' AND jsonb_typeof(v) NOT IN('string','null')
 ) AND NOT EXISTS(
  SELECT 1 FROM nodes WHERE jsonb_typeof(v)='string' AND v#>>'{}' LIKE '+1555%'
 );
$oracle$;
SET request.jwt.claim.role='authenticated';
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; d jsonb; BEGIN
 r:=public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
 ASSERT r->>'schema_version'='1','context schema';
 ASSERT jsonb_array_length(r->'candidates')=3,'team pool dedup regular exclusion';
 ASSERT r#>>'{candidates,0,source}'='team','team precedence ordering';
 ASSERT jsonb_array_length(r->'replacements')=1,'only current regular Out';
 -- Captured grants allow self contact; nonself raw contacts remain RLS-hidden.
 ASSERT (SELECT count(*)=1 FROM public.profiles WHERE id='40000000-0000-4000-8000-000000000001' AND email='invite-privacy-40000000-0000-4000-8000-000000000001@example.invalid' AND phone IS NOT NULL),'own-row raw contact positive';
 ASSERT (SELECT count(*)=0 FROM public.profiles WHERE id IN('40000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000019') AND (email IS NOT NULL OR phone IS NOT NULL)),'explicit nonself raw contact denied';
 FOREACH d IN ARRAY ARRAY[r,
  public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,true),
  public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000099','spare','40000000-0000-4000-8000-000000000014'),
  public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000098','spare','40000000-0000-4000-8000-000000000014',p_confirmed=>true)] LOOP
  ASSERT pg_temp.invite_sub_dto_exact(d),'exact DTO keys and documented email paths only';
  ASSERT NOT pg_temp.invite_sub_dto_exact(d||jsonb_build_object('phone','+155500000000')),'hostile extra phone rejected';
  ASSERT NOT pg_temp.invite_sub_dto_exact(d||jsonb_build_object('email','wrong-path@example.invalid')),'hostile wrong-path email rejected';
  IF d ? 'candidates' THEN
   ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'candidates') c WHERE c->>'email' IS DISTINCT FROM 'invite-privacy-'||(c->>'player_id')||'@example.invalid'),'candidate emails match authorized identities';
   ASSERT jsonb_array_length(d->'candidates')>0,'nonempty documented candidate email positive';
   ASSERT NOT pg_temp.invite_sub_dto_exact(jsonb_set(d,'{candidates,0,phone}','"+155500000000"')),'nested phone rejected';
   ASSERT pg_temp.invite_sub_dto_exact(jsonb_set(d,'{candidates,0,email}','null')),'documented nullable email accepted';
   ASSERT NOT pg_temp.invite_sub_dto_exact(jsonb_set(d,'{replacements,0,email}','"wrong-path@example.invalid"')),'replacement email forbidden';
   IF (d->>'recent_loaded')::boolean THEN
    ASSERT jsonb_array_length(d->'recent_players')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'recent_players') c WHERE c->>'email' IS DISTINCT FROM 'invite-privacy-'||(c->>'player_id')||'@example.invalid'),'nonempty recent emails match authorized identities';
   END IF;
  ELSE
   ASSERT d#>>'{player,email}'='invite-privacy-'||(d#>>'{player,player_id}')||'@example.invalid','result.player documented email positive';
   ASSERT NOT pg_temp.invite_sub_dto_exact(jsonb_set(d,'{invitation,email}','"wrong-path@example.invalid"')),'invitation email forbidden';
  END IF;
 END LOOP;
END $test$;
RESET ROLE;
-- Oversized contact traps: actual authorized projection raises 54000, whereas
-- denied actor/game/team/league/lifecycle scopes must raise 42501 first.
UPDATE public.profiles SET email=repeat('x',513) WHERE id='40000000-0000-4000-8000-000000000014';
SET ROLE authenticated;
DO $test$ DECLARE sc text[]; actor text; BEGIN
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'contact trap not reached'; EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
 FOREACH actor IN ARRAY ARRAY['40000000-0000-4000-8000-000000000016','40000000-0000-4000-8000-000000000018'] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,true); RAISE EXCEPTION 'actor contact scope escaped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000014'); RAISE EXCEPTION 'actor write scope escaped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
 FOREACH sc SLICE 1 IN ARRAY ARRAY[
  ['50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001'],
  ['50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'],
  ['50000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'],
  ['50000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001']] LOOP
  BEGIN PERFORM public.captain_get_sub_invitation_context(sc[1]::uuid,sc[2]::uuid,sc[3]::uuid,NULL,true); RAISE EXCEPTION 'scope before contact read escaped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.captain_manage_sub_invitation(sc[1]::uuid,sc[2]::uuid,sc[3]::uuid,gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000014'); RAISE EXCEPTION 'scope before contact write escaped'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $test$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS read_scope_candidates_privacy' AS test;

SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; retry jsonb; BEGIN
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000001','spare','40000000-0000-4000-8000-000000000014');
 ASSERT r->>'outcome'='pending','new spare pending';
 retry:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000001','spare','40000000-0000-4000-8000-000000000014');
 ASSERT r=retry,'stable canonical receipt';
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000001','spare','40000000-0000-4000-8000-000000000015'); RAISE EXCEPTION 'request mismatch allowed'; EXCEPTION WHEN unique_violation THEN NULL; END;
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000002','spare','40000000-0000-4000-8000-000000000014',NULL,NULL,true);
 ASSERT r->>'outcome'='confirmed' AND r->>'checkin_status'='confirmed','Mark In atomic';
 ASSERT r#>>'{invitation,status}'='accepted','accepted persisted';
 BEGIN PERFORM * FROM public.captain_sub_request_receipts; RAISE EXCEPTION 'ledger exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.game_checkins WHERE game_id='50000000-0000-4000-8000-000000000001' AND player_id='40000000-0000-4000-8000-000000000014' AND status='confirmed'),'confirmed row';
END $test$;
SELECT 'PASS spare_command_atomic_retry' AS test;
INSERT INTO public.seasons(id,league_id,name,start_date,status) VALUES('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Historical Career Baseline import','2000-01-01','completed');
INSERT INTO public.games(id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status) VALUES('50000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','2000-02-01','completed');
INSERT INTO public.player_stats(player_id,game_id,league_id,season_id,team_id) VALUES('40000000-0000-4000-8000-000000000019','50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000014','50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
INSERT INTO public.goalie_stats(player_id,game_id,league_id,season_id,team_id) VALUES('40000000-0000-4000-8000-000000000022','50000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000019','50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000013','out');
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,true);
 ASSERT jsonb_array_length(r->'recent_players')=1 AND r#>>'{recent_players,0,position}'='Skater','recent dual-role skater precedence and current roster exclusion';
 r:=public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000013',true);
 ASSERT jsonb_array_length(r->'recent_players')=1 AND r#>>'{recent_players,0,player_id}'='40000000-0000-4000-8000-000000000022','goalie baseline expansion';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000003','recent','40000000-0000-4000-8000-000000000019');
 ASSERT r#>>'{invitation,source}'='league','recent single-game league source';
END $test$;
RESET ROLE;
SELECT 'PASS recent_read_write_baseline_role_exclusion' AS test;
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; again jsonb; BEGIN
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000004','manual',NULL,NULL,NULL,false,'  Brandnew   Uniqueplayer  ','Forward',99,false);
 ASSERT r->>'outcome'='confirmed' AND r#>>'{player,full_name}'='Brandnew Uniqueplayer','manual normalize accepted confirmed';
 again:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000004','manual',NULL,NULL,NULL,false,'  Brandnew   Uniqueplayer  ','Forward',99,false);
 ASSERT r=again,'manual unknown-result retry';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000005','manual',NULL,NULL,NULL,false,'Regular Two','Defense',12,true);
 ASSERT r#>>'{player,player_id}'='40000000-0000-4000-8000-000000000012','existing identity resolution';
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*)=1 FROM public.profiles WHERE full_name='Brandnew Uniqueplayer'),'no duplicate manual profile';
 ASSERT NOT EXISTS(SELECT 1 FROM public.team_rosters r JOIN public.profiles p ON p.id=r.player_id WHERE p.full_name='Brandnew Uniqueplayer'),'default no roster save';
 ASSERT (SELECT player_type='regular' FROM public.team_rosters WHERE player_id='40000000-0000-4000-8000-000000000012' AND season_id='20000000-0000-4000-8000-000000000001'),'never downgrade regular';
END $test$;
SELECT 'PASS manual_atomic_resolve_create_no_regular_downgrade' AS test;
BEGIN;
DO $test$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.team_rosters WHERE league_id='10000000-0000-4000-8000-000000000001';
 INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,status,start_date,position)
 SELECT '40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sub','active',current_date-1,'Forward' FROM generate_series(1,10000-n);
END $test$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SELECT public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001') IS NOT NULL AS exact_source_cap;
RESET ROLE;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,status,position) VALUES('40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sub','active','Forward');
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'source cap silently ignored'; EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'PASS source_cap_exact_and_plus_one' AS test;
BEGIN;
UPDATE public.profiles SET full_name=repeat('x',641) WHERE id='40000000-0000-4000-8000-000000000014';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'oversized profile text escaped bounds'; EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'PASS per_field_text_bounds' AS test;

-- Regression matrix runs the public boundary under actual untrusted caller roles.
UPDATE public.team_rosters SET leadership_role='captain' WHERE player_id='40000000-0000-4000-8000-000000000019';
SET ROLE authenticated;
DO $test$ DECLARE actor text; gid text; BEGIN
 FOREACH actor IN ARRAY ARRAY['40000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000016','40000000-0000-4000-8000-000000000017','40000000-0000-4000-8000-000000000018','40000000-0000-4000-8000-000000000019'] LOOP
 PERFORM set_config('request.jwt.claim.sub',actor,false);
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,true); RAISE EXCEPTION 'unauthorized read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Unauthorized Contact'); RAISE EXCEPTION 'unauthorized write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',false);
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'missing auth accepted'; EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',false);
 FOREACH gid IN ARRAY ARRAY['50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000008','50000000-0000-4000-8000-000000000016'] LOOP
 BEGIN PERFORM public.captain_get_sub_invitation_context(gid::uuid,'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,true); RAISE EXCEPTION 'invalid lifecycle accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'forged tenant accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000014'); RAISE EXCEPTION 'spare replacement accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000013'); RAISE EXCEPTION 'wrong spare role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',NULL,'40000000-0000-4000-8000-000000000013',NULL,false,'Wrong Role','Forward'); RAISE EXCEPTION 'wrong manual role accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',false);
 PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
END $test$;
RESET ROLE;
SET ROLE anon;
DO $test$ BEGIN
 BEGIN PERFORM public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'anon RPC execution'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ DECLARE f record; BEGIN
 ASSERT to_regprocedure('public._captain_sub_actor_id()') IS NOT NULL,'required exact identity bridge';
 FOR f IN SELECT p.*,pg_get_userbyid(p.proowner) owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '_captain_sub_%' OR p.proname IN('captain_get_sub_invitation_context','captain_manage_sub_invitation')) LOOP
 IF f.oid='public._captain_sub_actor_id()'::regprocedure THEN
  ASSERT f.owner='postgres','trusted exact bridge owner';
  ASSERT f.pronargs=0 AND f.pronargdefaults=0 AND f.provariadic=0 AND f.proargtypes=''::oidvector AND f.prorettype='uuid'::regtype AND NOT f.proretset AND f.prokind='f','exact zero-argument uuid bridge signature';
  ASSERT (SELECT lanname='sql' FROM pg_language WHERE oid=f.prolang) AND f.provolatile='s' AND f.prosecdef AND btrim(f.prosrc)='SELECT auth.uid()','unchanged SQL STABLE SECURITY DEFINER auth.uid semantics';
  ASSERT has_function_privilege('postgres',f.oid,'execute') AND has_function_privilege('captain_sub_authority',f.oid,'execute'),'bridge owner implicit and intended authority effective execute';
  ASSERT NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee NOT IN('postgres'::regrole,'captain_sub_authority'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable),'bridge exact private explicit ACL';
  ASSERT NOT EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname NOT IN('postgres','captain_sub_authority') AND has_function_privilege(r.oid,f.oid,'execute')),'bridge no other effective application principal';
  ASSERT NOT has_schema_privilege('captain_sub_authority','auth','USAGE'),'bridge does not widen protected auth schema';
 ELSE
  ASSERT f.owner='captain_sub_authority','trusted explicit owner';
 END IF;
 ASSERT f.proconfig=ARRAY['search_path=pg_catalog'],'trusted path';
 ASSERT NOT has_function_privilege('anon',f.oid,'execute') AND NOT has_function_privilege('service_role',f.oid,'execute'),'restrictive RPC ACL';
 IF f.proname LIKE '_captain_sub_%' THEN ASSERT NOT has_function_privilege('authenticated',f.oid,'execute'),'private helper ACL';END IF;
 END LOOP;
 ASSERT NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname='captain_sub_authority'),'no-login owner';
 ASSERT NOT has_schema_privilege('captain_sub_authority','public','CREATE'),'owner schema CREATE revoked';
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.captain_sub_request_receipts'::regclass),'private ledger RLS';
END $test$;
SELECT 'PASS caller_role_tenant_lifecycle_replacement_acl_matrix' AS test;

CREATE FUNCTION public.invite_sub_test_fail() RETURNS trigger LANGUAGE plpgsql AS $test$
BEGIN IF current_setting('invite_sub_test.fail_at',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'injected atomic stage failure';END IF; RETURN NEW; END $test$;
CREATE TRIGGER invite_sub_test_fail AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_fail();
CREATE TRIGGER invite_sub_test_fail AFTER INSERT OR UPDATE ON public.team_rosters FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_fail();
CREATE TRIGGER invite_sub_test_fail AFTER INSERT OR UPDATE ON public.sub_invitations FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_fail();
CREATE TRIGGER invite_sub_test_fail AFTER INSERT OR UPDATE ON public.game_checkins FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_fail();
CREATE TRIGGER invite_sub_test_fail AFTER INSERT OR UPDATE ON public.captain_sub_request_receipts FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_fail();
DO $test$ DECLARE stage text; before_counts bigint[]; after_counts bigint[]; BEGIN
 FOREACH stage IN ARRAY ARRAY['profiles','team_rosters','sub_invitations','game_checkins','captain_sub_request_receipts'] LOOP
 SELECT ARRAY[(SELECT count(*) FROM public.profiles),(SELECT count(*) FROM public.team_rosters),(SELECT count(*) FROM public.sub_invitations),(SELECT count(*) FROM public.game_checkins),(SELECT count(*) FROM public.captain_sub_request_receipts)] INTO before_counts;
 PERFORM set_config('invite_sub_test.fail_at',stage,false);
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',false);
 BEGIN
 PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Rollback Orphanprobe',p_manual_position=>'Defense',p_save_to_team_spares=>true);
 RAISE EXCEPTION 'injection stage not reached: %',stage;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected atomic stage failure' THEN RAISE;END IF; END;
 RESET ROLE;
 SELECT ARRAY[(SELECT count(*) FROM public.profiles),(SELECT count(*) FROM public.team_rosters),(SELECT count(*) FROM public.sub_invitations),(SELECT count(*) FROM public.game_checkins),(SELECT count(*) FROM public.captain_sub_request_receipts)] INTO after_counts;
 ASSERT before_counts=after_counts,'atomic rollback after every mutation stage';
 END LOOP;
 PERFORM set_config('invite_sub_test.fail_at','',false);
END $test$;
DROP TRIGGER invite_sub_test_fail ON public.profiles;
DROP TRIGGER invite_sub_test_fail ON public.team_rosters;
DROP TRIGGER invite_sub_test_fail ON public.sub_invitations;
DROP TRIGGER invite_sub_test_fail ON public.game_checkins;
DROP TRIGGER invite_sub_test_fail ON public.captain_sub_request_receipts;
DROP FUNCTION public.invite_sub_test_fail();
SELECT 'PASS rollback_injection_all_five_stages' AS test;
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Regular One',p_manual_position=>'Forward'); RAISE EXCEPTION 'Out replacement invited itself'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'PASS manual_out_replacement_ineligible' AS test;
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',NULL,'40000000-0000-4000-8000-000000000011',NULL,false,'Merge Target','Forward'); RAISE EXCEPTION 'historical goalie used as manual skater'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'PASS manual_historical_role_revalidated' AS test;
BEGIN;
CREATE FUNCTION public.invite_sub_test_redirect_checkin() RETURNS trigger LANGUAGE plpgsql AS $test$ BEGIN NEW.team_id:='30000000-0000-4000-8000-000000000002'; RETURN NEW;END $test$;
CREATE TRIGGER invite_sub_test_redirect BEFORE INSERT ON public.game_checkins FOR EACH ROW EXECUTE FUNCTION public.invite_sub_test_redirect_checkin();
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000015',NULL,NULL,true); RAISE EXCEPTION 'confirmation falsely succeeded without exact checkin'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'PASS confirmation_exact_checkin_postcondition' AS test;

SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000006','spare','40000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000011',NULL,false,NULL,NULL,NULL,false); ASSERT r->>'outcome'='pending','branch request 6';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000007','spare','40000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000011',NULL,false,NULL,NULL,NULL,false); ASSERT r->>'outcome'='already_pending','branch request 7';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000008','spare','40000000-0000-4000-8000-000000000015',NULL,NULL,true,NULL,NULL,NULL,false); ASSERT r->>'outcome'='confirmed','branch request 8';
 ASSERT r#>>'{invitation,replaced_player_id}'='40000000-0000-4000-8000-000000000011','Mark In null preserves replacement';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000009','spare','40000000-0000-4000-8000-000000000015',NULL,NULL,true,NULL,NULL,NULL,false); ASSERT r->>'outcome'='already_confirmed','branch request 9';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000010','spare','40000000-0000-4000-8000-000000000022',NULL,NULL,true,NULL,NULL,NULL,false); ASSERT r->>'outcome'='confirmed','branch request 10';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000011','recent','40000000-0000-4000-8000-000000000022','40000000-0000-4000-8000-000000000013',NULL,true,NULL,NULL,NULL,false); ASSERT r->>'outcome'='confirmed','branch request 11';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000012','recent','40000000-0000-4000-8000-000000000019',NULL,NULL,true,NULL,NULL,NULL,false); ASSERT r->>'outcome'='confirmed','branch request 12';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000013','manual',NULL,NULL,NULL,false,'Saved Newcomer','Defense',NULL,true); ASSERT r->>'outcome'='confirmed','branch request 13';
END $test$;
RESET ROLE;
WITH accounts AS (INSERT INTO auth.users(id) VALUES(gen_random_uuid()),(gen_random_uuid()) RETURNING id)
INSERT INTO public.profiles(id,email,full_name) SELECT id,'duplicate-'||id::text||'@example.invalid','Duplicate Identity' FROM accounts;
INSERT INTO public.sub_invitations(game_id,team_id,invited_by,invited_player_id,status,source_type) VALUES('50000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000015','pending','league');
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Duplicate Identity'); RAISE EXCEPTION 'ambiguous identity reused'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000015',NULL,NULL,true); RAISE EXCEPTION 'cross-team invitation overwritten'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Invalid Jersey',p_manual_jersey=>1000); RAISE EXCEPTION 'invalid jersey accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'spare','40000000-0000-4000-8000-000000000015',p_message=>repeat('x',4001)); RAISE EXCEPTION 'oversize message accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.team_rosters r JOIN public.profiles p ON p.id=r.player_id WHERE p.full_name='Saved Newcomer' AND r.player_type='sub'),'manual opt-in save';
 ASSERT public._captain_sub_matches('José McKenzie','Jose McKenzi'),'canonical accent fuzzy search';
 ASSERT NOT public._captain_sub_matches('John Example','Other Person'),'search rejects unrelated';
 ASSERT NOT EXISTS(SELECT 1 FROM public.game_duties WHERE assigned_player_id='40000000-0000-4000-8000-000000000012' AND game_id='50000000-0000-4000-8000-000000000002'),'accepted manual preserves Beer Guy ineligibility';
END $test$;
SELECT 'PASS all_outcomes_null_preservation_manual_save_ambiguity_cross_team' AS test;
BEGIN;
INSERT INTO public.profiles(id,email,full_name) SELECT gen_random_uuid(),'bound-'||i||'@example.invalid','Unrelated Budgetrow '||i FROM generate_series(1,100001-(SELECT count(*)::integer FROM public.profiles)) i;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Workbudget Uniquename'); RAISE EXCEPTION 'manual resolver source work is unbounded'; EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'PASS manual_resolver_source_budget' AS test;

INSERT INTO public.sub_invitations(game_id,team_id,invited_by,invited_player_id,status,source_type) VALUES
('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000014','declined','team'),
('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000015','expired','team'),
('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000016','declined','league'),
('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000017','expired','league');
SET ROLE authenticated;
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000014','spare','40000000-0000-4000-8000-000000000014',p_confirmed=>true);
 ASSERT r->>'outcome'='confirmed','declined Mark In';
 r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-1000-0000-000000000015','spare','40000000-0000-4000-8000-000000000015',p_confirmed=>true);
 ASSERT r->>'outcome'='confirmed','expired Mark In';
END $test$;
RESET ROLE;
BEGIN;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,status,position) VALUES('40000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','part_time','active','Goalie');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000013',true);
 ASSERT jsonb_array_length(r->'recent_players')=0,'all current rosters any team any type excluded from recent';
 ASSERT jsonb_array_length(r->'candidates')=1,'curated candidate remains valid across modes';
END $test$;
ROLLBACK;
SELECT 'PASS declined_expired_confirmation_and_all_roster_recent_exclusion' AS test;
BEGIN;
INSERT INTO public.profiles(id,email,full_name) VALUES('40000000-0000-4000-8000-000000000023','oldspare@example.invalid','Legacy Active Spare');
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,player_type,status,position) VALUES('40000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','sub','active','Defense');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.captain_get_sub_invitation_context('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'candidates') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000023'),'canonical active unended team spares are not season-limited';
END $test$;
ROLLBACK;
SELECT 'PASS canonical_unended_team_spares_across_seasons' AS test;
