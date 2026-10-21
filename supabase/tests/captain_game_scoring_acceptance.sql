\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.scoring_read(q jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$ DECLARE r jsonb; BEGIN r:=public.captain_get_game_scoring_context(q); RAISE NOTICE 'PRODUCER:%',jsonb_build_object('rpc','captain_get_game_scoring_context','raw_request',q,'raw_response',r); RETURN r; END $f$;
CREATE FUNCTION pg_temp.scoring_command(q jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$ DECLARE r jsonb; BEGIN r:=public.captain_manage_game_scoring(q); RAISE NOTICE 'PRODUCER:%',jsonb_build_object('rpc','captain_manage_game_scoring','raw_request',q,'raw_response',r); RETURN r; END $f$;
-- Pre-JSON closure cap: oversize profile text must never be evaluated for a
-- rejected 201-player roster. Keep the 200-player complete boundary executable.
BEGIN;
DELETE FROM public.team_rosters WHERE team_id='30000000-0000-4000-8000-000000000001' AND season_id='20000000-0000-4000-8000-000000000001' AND player_id<>'40000000-0000-4000-8000-000000000001';
INSERT INTO auth.users(id) SELECT ('ABCDEF10-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,200)n;
INSERT INTO public.profiles(id,full_name,email) SELECT ('ABCDEF10-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Bound player '||n,'bound@example.invalid' FROM generate_series(1,200)n;
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,start_date) SELECT ('ABCDEF10-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',CURRENT_DATE-1 FROM generate_series(1,199)n;
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF10-0000-0000-0000-000000000901","game_id":"50000000-0000-4000-8000-000000000002","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb; BEGIN r:=pg_temp.scoring_read(q);ASSERT r->>'outcome'='ok' AND jsonb_array_length(r#>'{snapshot,roster}')=200,'complete exact 200-player roster';END $test$;
RESET ROLE;
UPDATE public.profiles SET full_name=repeat('x',161) WHERE id='ABCDEF10-0000-0000-0000-000000000200';
INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,start_date) VALUES('ABCDEF10-0000-0000-0000-000000000200','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',CURRENT_DATE-1);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF10-0000-0000-0000-000000000902","game_id":"50000000-0000-4000-8000-000000000002","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb;BEGIN r:=pg_temp.scoring_read(q);ASSERT r->>'code'='row_bound_exceeded' AND r->'snapshot'='null'::jsonb,'roster cap before JSON text/credit fanout';r:=pg_temp.scoring_command(q||'{"kind":"set_commentary","expected_version":0,"text":"bounded"}');ASSERT r->>'code'='row_bound_exceeded' AND r->'snapshot'='null'::jsonb,'command roster cap before enrollment';END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id='50000000-0000-4000-8000-000000000002');END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','unavailable');
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;p jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "ABCDEF00-0000-0000-0000-000000000100", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011'; ASSERT p->>'state'='unavailable' AND p->>'availability_state'='conflict' AND p->>'checkin_status'='confirmed' AND p->>'has_credited_stats'='false' AND p->>'eligible_for_goal'='false','availability precedence preserves actual credit and confirmed facts'; END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','maybe');
INSERT INTO public.game_stats(game_id,player_id,league_id,team_id,stat_type,value,entered_by,period,team_type) VALUES('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Goal',1,'40000000-0000-4000-8000-000000000001','1','home');
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;p jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "ABCDEF00-0000-0000-0000-000000000101", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011'; ASSERT p->>'state'='credited_not_eligible' AND p->>'availability_state'='unknown' AND p->>'checkin_status'='confirmed' AND p->>'has_credited_stats'='true' AND p->>'eligible_for_goal'='false','availability precedence preserves actual credit and confirmed facts'; END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','unavailable');
INSERT INTO public.game_stats(game_id,player_id,league_id,team_id,stat_type,value,entered_by,period,team_type) VALUES('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Goal',1,'40000000-0000-4000-8000-000000000001','1','home');
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;p jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "ABCDEF00-0000-0000-0000-000000000102", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011'; ASSERT p->>'state'='credited_not_eligible' AND p->>'availability_state'='conflict' AND p->>'checkin_status'='confirmed' AND p->>'has_credited_stats'='true' AND p->>'eligible_for_goal'='false','availability precedence preserves actual credit and confirmed facts'; END $test$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000001","game_id":"50000000-0000-4000-8000-000000000001","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb; BEGIN
r:=pg_temp.scoring_read(q);
ASSERT r->>'outcome'='ok','authorized future read';
ASSERT r->>'request_id'=q->>'request_id','original UUID bytes';
ASSERT r#>>'{snapshot,permissions,blocked_reason}'='future_game','future read only';
ASSERT r#>>'{snapshot,revision}'='0','no enrollment on read';
RAISE NOTICE 'PASS read scope future and raw UUID echo';
END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000002","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"ABCDEF00-0000-0000-0000-000000000010","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}';r jsonb;rr jsonb; BEGIN
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied','explicit first goal commits'; ASSERT r#>>'{snapshot,game,home_score}'='1','canonical total'; ASSERT r#>>'{receipt,transitioned_to_in_progress}'='true','implicit canonical start';
RAISE NOTICE 'PASS first explicit goal atomic start and totals';
rr:=pg_temp.scoring_command(q); ASSERT rr->>'outcome'='replayed' AND rr->'receipt'=r->'receipt','immutable receipt replay';
rr:=pg_temp.scoring_command(q||'{"assist1_id":"40000000-0000-4000-8000-000000000012"}'); ASSERT rr->>'code'='idempotency_conflict','changed payload denied';
RAISE NOTICE 'PASS idempotent same request and changed payload';
END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT count(*)=1 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'one persisted goal'; ASSERT (SELECT period IS NULL AND client_event_id=id::text FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'new period null'; END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000002","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"ABCDEF00-0000-0000-0000-000000000010","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}';r jsonb;rr jsonb; BEGIN
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied','explicit first goal commits'; ASSERT r#>>'{snapshot,game,home_score}'='1','canonical total'; ASSERT r#>>'{receipt,transitioned_to_in_progress}'='true','implicit canonical start';
RAISE NOTICE 'PASS first explicit goal atomic start and totals';
rr:=pg_temp.scoring_command(q); ASSERT rr->>'outcome'='replayed' AND rr->'receipt'=r->'receipt','immutable receipt replay';
rr:=pg_temp.scoring_command(q||'{"assist1_id":"40000000-0000-4000-8000-000000000012"}'); ASSERT rr->>'code'='idempotency_conflict','changed payload denied';
RAISE NOTICE 'PASS idempotent same request and changed payload';
END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT count(*)=1 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'one persisted goal'; ASSERT (SELECT period IS NULL AND client_event_id=id::text FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'new period null'; END $test$;

SET LOCAL ROLE service_role;
UPDATE public.games SET home_score=0,away_score=99 WHERE id='50000000-0000-4000-8000-000000000007';
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT home_score=1 AND away_score=0 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'managed cache rejects stale web totals'; END $test$;
SET LOCAL ROLE service_role;
UPDATE public.game_events SET period=3 WHERE game_id='50000000-0000-4000-8000-000000000007';
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT event_version=2 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'legacy omitted version normalized once'; END $test$;
SET LOCAL ROLE service_role;
UPDATE public.game_events SET deleted_at=clock_timestamp(),event_version=event_version+1 WHERE game_id='50000000-0000-4000-8000-000000000007';
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT event_version=3 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'legacy explicit version not doubled'; ASSERT (SELECT home_score=0 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'soft delete recount'; END $test$;
UPDATE public.game_events SET deleted_at=NULL WHERE game_id='50000000-0000-4000-8000-000000000007';
DO $test$ BEGIN ASSERT (SELECT home_score=1 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'restore recount'; END $test$;
DELETE FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007';
DO $test$ BEGIN ASSERT (SELECT home_score=0 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'hard delete recount'; RAISE NOTICE 'PASS legacy stale cache, edit, version, soft delete, restore, hard delete'; END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000002","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"ABCDEF00-0000-0000-0000-000000000010","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}';r jsonb;rr jsonb; BEGIN
r:=public.captain_manage_game_scoring(q); ASSERT r->>'outcome'='applied','explicit first goal commits'; ASSERT r#>>'{snapshot,game,home_score}'='1','canonical total'; ASSERT r#>>'{receipt,transitioned_to_in_progress}'='true','implicit canonical start';
RAISE NOTICE 'PASS first explicit goal atomic start and totals';
rr:=public.captain_manage_game_scoring(q); ASSERT rr->>'outcome'='replayed' AND rr->'receipt'=r->'receipt','immutable receipt replay';
rr:=public.captain_manage_game_scoring(q||'{"assist1_id":"40000000-0000-4000-8000-000000000012"}'); ASSERT rr->>'code'='idempotency_conflict','changed payload denied';
RAISE NOTICE 'PASS idempotent same request and changed payload';
END $test$;
RESET ROLE;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000012','confirmed');
UPDATE public.game_events SET period=3,game_time_seconds=123,is_power_play=true WHERE game_id='50000000-0000-4000-8000-000000000007';
SET LOCAL ROLE authenticated;
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000003","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"update_goal","event_id":"ABCDEF00-0000-0000-0000-000000000010","expected_version":2,"scorer_id":"40000000-0000-4000-8000-000000000012","assist1_id":"40000000-0000-4000-8000-000000000011","assist2_id":null}';r jsonb; BEGIN
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied' AND r#>>'{receipt,event_version}'='3','own correction CAS';
r:=pg_temp.scoring_command(q||'{"request_id":"ABCDEF00-0000-0000-0000-000000000004"}'); ASSERT r->>'code'='event_version_conflict' AND r#>>'{conflict,current_version}'='3','stale correction conflict';
q:=q-'scorer_id'-'assist1_id'-'assist2_id'||'{"kind":"remove_goal","request_id":"ABCDEF00-0000-0000-0000-000000000005","expected_version":3}';
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied' AND r#>>'{snapshot,game,home_score}'='0','soft remove total';
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='replayed','remove replay';
r:=pg_temp.scoring_command(q||'{"request_id":"ABCDEF00-0000-0000-0000-000000000006"}'); ASSERT r->>'code'='event_removed','new request removed conflict';
RAISE NOTICE 'PASS own correction and removal CAS and replay'; END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT period=3 AND game_time_seconds=123 AND is_power_play AND deleted_at IS NOT NULL AND event_version=4 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007'),'legacy fields and tombstone preserved'; END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000020","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"scratch","player_id":"40000000-0000-4000-8000-000000000011","expected_version":0}';r jsonb; BEGIN
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied' AND r#>>'{receipt,presence_version}'='1','scratch CAS canonical checkin';
RAISE NOTICE 'PASS scratch game-only presence version'; END $test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000011';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed') ON CONFLICT(game_id,player_id) DO UPDATE SET status=excluded.status;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000021","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"reinstate","player_id":"40000000-0000-4000-8000-000000000011","expected_version":1}';r jsonb; BEGIN
r:=pg_temp.scoring_command(q);ASSERT r->>'code'='presence_version_conflict' AND r#>>'{conflict,current_version}'='2','direct Mark In invalidates scratch CAS';
r:=pg_temp.scoring_command(q||'{"request_id":"ABCDEF00-0000-0000-0000-000000000022","expected_version":2}'); ASSERT r->>'outcome'='applied' AND r#>>'{receipt,presence_version}'='2','reinstate same confirmed no-op';
q:=q-'player_id'||'{"kind":"add_goal","request_id":"ABCDEF00-0000-0000-0000-000000000023","event_id":"ABCDEF00-0000-0000-0000-000000000024","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}';
r:=pg_temp.scoring_command(q);ASSERT r->>'outcome'='applied','goal on reinstated checked-in player';
q:=q-'event_id'-'scorer_id'-'assist1_id'-'assist2_id'||'{"kind":"scratch","request_id":"ABCDEF00-0000-0000-0000-000000000025","expected_version":2,"player_id":"40000000-0000-4000-8000-000000000011"}';
r:=pg_temp.scoring_command(q); ASSERT r->>'code'='credited_stats_conflict','credited scratch denied';
RAISE NOTICE 'PASS direct upsert presence CAS, no-op reinstate and credited scratch'; END $test$;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000011';
DO $test$ BEGIN
BEGIN UPDATE public.game_checkins SET status='out' WHERE game_id='50000000-0000-4000-8000-000000000007';RAISE EXCEPTION 'credited direct out accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
DELETE FROM public.game_checkins WHERE game_id='50000000-0000-4000-8000-000000000007';
END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT count(*)=1 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007' AND deleted_at IS NULL),'reset never erases canonical goals'; END $test$;
SET LOCAL ROLE service_role;
DO $test$ BEGIN BEGIN INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','unavailable');RAISE EXCEPTION 'credited availability out accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $test$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000030","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":""}';r jsonb;v text; BEGIN
q:=q||jsonb_build_object('text',repeat('🏒',2000));r:=pg_temp.scoring_command(q);ASSERT r->>'outcome'='applied' AND r#>>'{receipt,commentary_version}'='1','2000 scalar 8000 UTF8 boundary';
r:=pg_temp.scoring_command(q||'{"request_id":"ABCDEF00-0000-0000-0000-000000000031"}');ASSERT r->>'code'='commentary_version_conflict' AND r#>>'{conflict,current_version}'='1','note specific CAS';
r:=pg_temp.scoring_command(q||'{"request_id":"ABCDEF00-0000-0000-0000-000000000032","expected_version":1}');ASSERT r->>'outcome'='applied' AND r#>>'{receipt,commentary_version}'='1','identical commentary no-op';
BEGIN PERFORM pg_temp.scoring_command(q||jsonb_build_object('request_id','ABCDEF00-0000-0000-0000-000000000033','text',repeat('🏒',2001)));RAISE EXCEPTION 'over-bound accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
RAISE NOTICE 'PASS private commentary scalar and bytes, CAS and no-op';END $test$;
ROLLBACK;

BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000040","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb;BEGIN
r:=pg_temp.scoring_read(q);ASSERT r->>'code'='scope_unavailable' AND r->'snapshot'='null'::jsonb,'cross-team checkin evidence fails closed';END $test$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000041","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":""}';r jsonb;BEGIN r:=pg_temp.scoring_command(q);ASSERT r->>'outcome'='applied' AND r#>>'{receipt,applied_revision}'='0','initial empty commentary is applied no-op';END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id='50000000-0000-4000-8000-000000000007'),'no-op must not enroll';END $test$;
ROLLBACK;

BEGIN;
INSERT INTO public.game_events(game_id,league_id,team_id,team_type,player_id,event_type,entered_by,period,client_event_id) VALUES('50000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','home',NULL,'goal','40000000-0000-4000-8000-000000000001',2,gen_random_uuid()::text);
UPDATE public.games SET home_score=1 WHERE id='50000000-0000-4000-8000-000000000009';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000042","game_id":"50000000-0000-4000-8000-000000000009","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb;BEGIN
r:=pg_temp.scoring_read(q);ASSERT r->>'outcome'='ok' AND r#>'{snapshot,own_goals,0,scorer_id}'='null'::jsonb AND r#>>'{snapshot,own_goals,0,blocked_reason}'='legacy_unattributed','nullable legacy no fabricated player';
q:=q||'{"kind":"set_commentary","expected_version":0,"text":"future must not save","request_id":"ABCDEF00-0000-0000-0000-000000000043"}';r:=pg_temp.scoring_command(q);ASSERT r->>'code'='future_game','future command rejected';
END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_events(game_id,league_id,team_id,team_type,event_type,entered_by,deleted_at,client_event_id) SELECT '50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','home','goal','40000000-0000-4000-8000-000000000001',statement_timestamp(),gen_random_uuid()::text FROM generate_series(1,4001);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000044","game_id":"50000000-0000-4000-8000-000000000002","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='row_bound_exceeded' AND r->'snapshot'='null'::jsonb,'cap+1 never partial';END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET home_score=9 WHERE id='50000000-0000-4000-8000-000000000007';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000045","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"set_commentary","expected_version":0,"text":"must not reconcile"}';r jsonb;BEGIN r:=pg_temp.scoring_command(q);ASSERT r->>'code'='legacy_score_mismatch','preexisting non-null mismatch blocks enrollment';r:=pg_temp.scoring_command(q);ASSERT r->>'outcome'='conflict' AND r->>'code'='legacy_score_mismatch','terminal conflict replay remains conflict';END $test$;
RESET ROLE;
DO $test$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id='50000000-0000-4000-8000-000000000007');ASSERT (SELECT home_score=9 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'legacy mismatch untouched';END $test$;
ROLLBACK;

BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute',home_score=1 WHERE id='50000000-0000-4000-8000-000000000009';
INSERT INTO public.game_events(id,game_id,league_id,team_id,team_type,player_id,event_type,entered_by,period,client_event_id) VALUES('ABCDEF00-0000-0000-0000-000000000046','50000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','home',NULL,'goal','40000000-0000-4000-8000-000000000001',2,gen_random_uuid()::text);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_command('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000047","game_id":"50000000-0000-4000-8000-000000000009","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"remove_goal","event_id":"ABCDEF00-0000-0000-0000-000000000046","expected_version":1}');ASSERT r->>'outcome'='rejected' AND r->>'code'='event_unavailable','legacy unattributed must remain native read only';END $test$;
ROLLBACK;

-- Vertical v2 semantic regression: raw confirmed facts remain confirmed.
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','maybe');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE q jsonb:='{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000060","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}';r jsonb;p jsonb;BEGIN
 r:=pg_temp.scoring_read(q); SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011';
 ASSERT p->>'state'='unavailable' AND p->>'checkin_status'='confirmed' AND p->>'availability_state'='unknown' AND p->>'eligible_for_goal'='false' AND p->>'has_credited_stats'='false','confirmed unknown availability must be unavailable without invented credits';
 RAISE NOTICE 'PASS amended unavailable honest confirmed unknown availability';
END $test$;
ROLLBACK;
BEGIN;

SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000011';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted regular_actor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile regular_actor'; END $test$;
ROLLBACK;
BEGIN;

SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000014';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted sub_actor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile sub_actor'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.team_rosters SET end_date=CURRENT_DATE WHERE player_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted ended_captain'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile ended_captain'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.team_rosters SET start_date=CURRENT_DATE+1 WHERE player_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted future_captain'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile future_captain'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.team_rosters SET status='inactive',leadership_role=NULL WHERE player_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted inactive_captain'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile inactive_captain'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.team_rosters SET player_type='sub' WHERE player_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted substitute_captain'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile substitute_captain'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.leagues SET settings='{}';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted disabled_settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile disabled_settings'; END $test$;
ROLLBACK;
BEGIN;
UPDATE public.profiles SET deleted_at=statement_timestamp() WHERE id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted deleted_captain'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile deleted_captain'; END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.seasons(id,league_id,name,start_date,status) VALUES('ABCDEF00-0000-0000-0000-000000000190','10000000-0000-4000-8000-000000000001','Historical fixture',CURRENT_DATE-365,'completed');
UPDATE public.games SET season_id='ABCDEF00-0000-0000-0000-000000000190' WHERE id='50000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'hostile scope accepted historical_season'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RAISE NOTICE 'PASS hostile historical_season'; END $test$;
ROLLBACK;
BEGIN; UPDATE public.games SET status=NULL WHERE id='50000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'unsupported lifecycle closes native authority';END $test$; ROLLBACK;
BEGIN; UPDATE public.games SET status='completed' WHERE id='50000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'unsupported lifecycle closes native authority';END $test$; ROLLBACK;
BEGIN; UPDATE public.games SET status='pending_verification' WHERE id='50000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'unsupported lifecycle closes native authority';END $test$; ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000005", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'unsupported lifecycle closes native authority';END $test$; ROLLBACK;
BEGIN; UPDATE public.games SET status='postponed' WHERE id='50000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'unsupported lifecycle closes native authority';END $test$; ROLLBACK;
BEGIN; SET LOCAL ROLE anon; DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'unauthorized RPC role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $test$; ROLLBACK;
BEGIN; SET LOCAL ROLE service_role; DO $test$ BEGIN BEGIN PERFORM public.captain_get_game_scoring_context('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'); RAISE EXCEPTION 'unauthorized RPC role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $test$; ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000002'; DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version": 1, "request_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "game_id": "50000000-0000-4000-8000-000000000001", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}');ASSERT r->>'outcome'='ok','current alternate supported with arbitrary UUID variant';END $test$;ROLLBACK;
DO $test$ DECLARE f regprocedure; app text;BEGIN FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND left(proname,4)='_cs_' LOOP FOREACH app IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP ASSERT NOT has_function_privilege(app,f,'EXECUTE'),'private helper leaked'; END LOOP; END LOOP; END $test$;
\if :{?account_lifecycle}
BEGIN;
INSERT INTO auth.users(id) VALUES('40000000-0000-4000-8000-000000000011') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.account_deletion_state(user_id,initiation_kind,workflow_state,storage_deleted_at,started_at,updated_at) VALUES('40000000-0000-4000-8000-000000000011','immediate','irreversible',statement_timestamp(),statement_timestamp(),statement_timestamp());
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SELECT pg_temp.scoring_command('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000070","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"ABCDEF00-0000-0000-0000-000000000071","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}');
RESET ROLE;
INSERT INTO public.game_stats(game_id,player_id,league_id,team_id,stat_type,value,entered_by,period,team_type) VALUES('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Goal',1,'40000000-0000-4000-8000-000000000001','1','home');
SET LOCAL ROLE service_role;
SELECT public.execute_account_deletion('40000000-0000-4000-8000-000000000011');
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT deleted_at IS NOT NULL FROM public.profiles WHERE id='40000000-0000-4000-8000-000000000011'),'canonical account tombstone';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='40000000-0000-4000-8000-000000000011'),'canonical auth delete';
 ASSERT NOT EXISTS(SELECT 1 FROM public.game_checkins WHERE game_id='50000000-0000-4000-8000-000000000007' AND player_id='40000000-0000-4000-8000-000000000011'),'operational checkin removed';
 ASSERT (SELECT count(*)=1 FROM public.game_events WHERE game_id='50000000-0000-4000-8000-000000000007' AND player_id='40000000-0000-4000-8000-000000000011' AND deleted_at IS NULL),'credited goal survives';
 ASSERT (SELECT count(*)=1 FROM public.game_stats WHERE game_id='50000000-0000-4000-8000-000000000007' AND player_id='40000000-0000-4000-8000-000000000011'),'credited materialized stats survive';
 ASSERT (SELECT version=1 FROM public.captain_game_scoring_presence WHERE game_id='50000000-0000-4000-8000-000000000007' AND player_id='40000000-0000-4000-8000-000000000011'),'cleanup advances presence once';
 RAISE NOTICE 'PASS actual canonical immediate account deletion retains credited facts';
END $test$;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb;p jsonb;BEGIN
r:=pg_temp.scoring_read('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000072","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011';
ASSERT p->>'state'='credited_not_eligible' AND p->>'has_credited_stats'='true' AND p->>'eligible_for_goal'='false' AND p->'checkin_status'='null'::jsonb,'retained credit honest cleanup context';
END $test$;
ROLLBACK;
\endif
\if :{?finalizer_lifecycle}
BEGIN;
UPDATE public.games SET scheduled_at=statement_timestamp()-interval '1 minute' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SELECT pg_temp.scoring_command('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000080","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"ABCDEF00-0000-0000-0000-000000000081","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}');
RESET ROLE;
-- Auth-backed local administrator fixture; never bypass the platform-admin guard.
INSERT INTO public.league_memberships(league_id,user_id,role,status) VALUES('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','admin','active');
UPDATE public.games SET skater_capture_status='complete',penalty_capture_status='not_recorded',goalie_capture_status='not_recorded' WHERE id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.game_submissions(game_id,league_id,status) VALUES('50000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','submitted');
SET LOCAL ROLE service_role;
SELECT public.finalize_game_stats_atomic('50000000-0000-4000-8000-000000000007',true);
SELECT public.finalize_game_stats_atomic('50000000-0000-4000-8000-000000000007',true);
SELECT public.recalculate_game_stats_atomic('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000001');
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT goals=1 AND scorekeeping_provenance='event_derived' FROM public.player_stats WHERE game_id='50000000-0000-4000-8000-000000000007' AND player_id='40000000-0000-4000-8000-000000000011'),'real finalizer and admin correction materialize canonical credit'; END $test$;
SET LOCAL ROLE service_role;
-- Existing official corrections can set a completed total without live-event normalization.
UPDATE public.games SET home_score=7,away_score=4 WHERE id='50000000-0000-4000-8000-000000000007';
UPDATE public.game_events SET period=3 WHERE game_id='50000000-0000-4000-8000-000000000007';
RESET ROLE;
DO $test$ BEGIN ASSERT (SELECT status='completed' AND stats_locked_at IS NOT NULL AND home_score=7 AND away_score=4 FROM public.games WHERE id='50000000-0000-4000-8000-000000000007'),'official completed correction not clobbered by live scoring guard'; END $test$;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb;BEGIN r:=pg_temp.scoring_read('{"schema_version":1,"request_id":"ABCDEF00-0000-0000-0000-000000000082","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');ASSERT r->>'code'='lifecycle_unavailable' AND r->'snapshot'='null'::jsonb,'native closes after actual source finalization';END $test$;
ROLLBACK;
\endif
-- SRC-02: immutable terminal conflict metadata with optional fresh snapshots.
-- Test-only whole-row replay oracle, owned by the isolated fixture superuser.
CREATE FUNCTION pg_temp.terminal_replay_state() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT jsonb_build_object(
'games',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.games t),
'game_events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.game_events t),
'game_stats',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.game_stats t),
'player_stats',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.player_stats t),
'goalie_stats',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.goalie_stats t),
'game_checkins',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.game_checkins t),
'player_availability',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.player_availability t),
'team_rosters',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.team_rosters t),
'captain_game_scoring_state',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.captain_game_scoring_state t),
'captain_game_scoring_presence',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.captain_game_scoring_presence t),
'captain_game_scoring_commentary',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.captain_game_scoring_commentary t),
'captain_game_scoring_requests',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.captain_game_scoring_requests t)); $f$;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE base jsonb:='{"schema_version": 1, "request_id": "bbbbbbbb-0000-4000-8000-000000000001", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}'; q jsonb; first jsonb; r jsonb; before_state jsonb; BEGIN
q:=base||'{"kind":"add_goal","event_id":"bbbbbbbb-0000-4000-8000-000000000901","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}';
r:=pg_temp.scoring_command(q); ASSERT r->>'outcome'='applied';
q:=q||'{"kind":"update_goal","request_id":"bbbbbbbb-0000-4000-8000-000000000002","expected_version":1}';
r:=pg_temp.scoring_command(q); ASSERT r#>>'{receipt,event_version}'='2';
q:=q||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000003"}';
first:=pg_temp.scoring_command(q); ASSERT first->>'code'='event_version_conflict' AND first#>>'{conflict,current_version}'='2';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);
ASSERT r-'snapshot'=first-'snapshot' AND r#>>'{snapshot,own_goals,0,event_version}'='2','same-version terminal snapshot retained';
ASSERT pg_temp.terminal_replay_state()=before_state,'same-version replay no DML or ledger writes';
r:=pg_temp.scoring_command(q||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000004","expected_version":2}'); ASSERT r#>>'{receipt,event_version}'='3';
before_state:=pg_temp.terminal_replay_state();
r:=pg_temp.scoring_command(base||'{"kind":"add_goal","event_id":"bbbbbbbb-0000-4000-8000-000000000901","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}');
ASSERT r->>'outcome'='replayed' AND r#>>'{receipt,event_version}'='1' AND r#>>'{snapshot,own_goals,0,event_version}'='3','applied replay keeps historical receipt and fresh current snapshot';
ASSERT pg_temp.terminal_replay_state()=before_state,'applied replay no DML';
r:=pg_temp.scoring_command(q);
ASSERT r-'snapshot'=first-'snapshot','immutable event terminal identity';
ASSERT pg_temp.terminal_replay_state()=before_state,'event replay no business DML or ledger writes';
ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(pg_temp.terminal_replay_state()->'captain_game_scoring_requests') l WHERE l->>'request_id'=q->>'request_id' AND l->'payload'=q),'exactly one original UUID/full payload ledger row';
ASSERT r->'snapshot'='null'::jsonb,'SRC-02 event replay incompatible version2 versus latest3 must omit optional snapshot';
r:=pg_temp.scoring_read(base||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000005"}');
ASSERT r#>>'{snapshot,own_goals,0,event_version}'='3','independent event read returns latest3';
ASSERT pg_temp.terminal_replay_state()=before_state,'separate read no business DML or ledger writes';
r:=pg_temp.scoring_command(base||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000006","kind":"remove_goal","event_id":"bbbbbbbb-0000-4000-8000-000000000901","expected_version":3}');ASSERT r->>'outcome'='applied';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);
ASSERT r-'snapshot'=first-'snapshot' AND r#>>'{snapshot,counts,own_goals}'='0','removed event retains compatible fresh snapshot';
ASSERT pg_temp.terminal_replay_state()=before_state,'removed event replay no DML';
RAISE NOTICE 'PASS SRC-02 event terminal replay and compatible controls';
END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000012','confirmed');
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE base jsonb:='{"schema_version": 1, "request_id": "bbbbbbbb-0000-4000-8000-000000000001", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}';q jsonb;first jsonb;r jsonb;before_state jsonb;BEGIN
q:=base||'{"kind":"scratch","player_id":"40000000-0000-4000-8000-000000000012","expected_version":0}';r:=pg_temp.scoring_command(q);ASSERT r#>>'{receipt,presence_version}'='1';
q:=q||'{"kind":"reinstate","request_id":"bbbbbbbb-0000-4000-8000-000000000002"}';first:=pg_temp.scoring_command(q);ASSERT first->>'code'='presence_version_conflict' AND first#>>'{conflict,current_version}'='1';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);ASSERT r-'snapshot'=first-'snapshot' AND r->'snapshot'<>'null'::jsonb,'same-version presence snapshot retained';ASSERT pg_temp.terminal_replay_state()=before_state,'presence same-version replay no DML';
r:=pg_temp.scoring_command(q||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000003","expected_version":1}');ASSERT r#>>'{receipt,presence_version}'='2';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);ASSERT r-'snapshot'=first-'snapshot','immutable presence terminal';ASSERT pg_temp.terminal_replay_state()=before_state,'presence replay no business or ledger writes';
ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(pg_temp.terminal_replay_state()->'captain_game_scoring_requests') l WHERE l->>'request_id'=q->>'request_id' AND l->'payload'=q),'exactly one original UUID/full payload ledger row';
ASSERT r->'snapshot'='null'::jsonb,'SRC-02 presence replay incompatible version1 versus latest2 must omit optional snapshot';
r:=pg_temp.scoring_read(base||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000004"}');ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{snapshot,roster}') p WHERE p->>'player_id'='40000000-0000-4000-8000-000000000012' AND p->>'presence_version'='2'),'independent presence read returns latest2';ASSERT pg_temp.terminal_replay_state()=before_state,'separate presence read no writes';
RAISE NOTICE 'PASS SRC-02 presence terminal replay';END $test$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE base jsonb:='{"schema_version": 1, "request_id": "bbbbbbbb-0000-4000-8000-000000000001", "game_id": "50000000-0000-4000-8000-000000000007", "team_id": "30000000-0000-4000-8000-000000000001", "league_id": "10000000-0000-4000-8000-000000000001"}';q jsonb;first jsonb;r jsonb;before_state jsonb;BEGIN
q:=base||'{"kind":"set_commentary","expected_version":0,"text":"version one"}';r:=pg_temp.scoring_command(q);ASSERT r#>>'{receipt,commentary_version}'='1';
q:=q||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000002","text":"stale original"}';first:=pg_temp.scoring_command(q);ASSERT first->>'code'='commentary_version_conflict' AND first#>>'{conflict,current_version}'='1' AND first#>>'{conflict,entity_id}'=base->>'team_id';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);ASSERT r-'snapshot'=first-'snapshot' AND r#>>'{snapshot,commentary,version}'='1','same-version commentary snapshot retained';ASSERT pg_temp.terminal_replay_state()=before_state,'commentary same-version replay no DML';
r:=pg_temp.scoring_command(q||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000003","expected_version":1,"text":"version two"}');ASSERT r#>>'{receipt,commentary_version}'='2';
before_state:=pg_temp.terminal_replay_state();r:=pg_temp.scoring_command(q);ASSERT r-'snapshot'=first-'snapshot','immutable commentary terminal';ASSERT pg_temp.terminal_replay_state()=before_state,'commentary replay no business or ledger writes';
ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(pg_temp.terminal_replay_state()->'captain_game_scoring_requests') l WHERE l->>'request_id'=q->>'request_id' AND l->'payload'=q),'exactly one original UUID/full payload ledger row';
ASSERT r->'snapshot'='null'::jsonb,'SRC-02 commentary replay incompatible version1 versus latest2 must omit optional snapshot';
r:=pg_temp.scoring_read(base||'{"request_id":"bbbbbbbb-0000-4000-8000-000000000004"}');ASSERT r#>>'{snapshot,commentary,version}'='2' AND r#>>'{snapshot,commentary,text}'='version two','independent commentary read returns latest2';ASSERT pg_temp.terminal_replay_state()=before_state,'separate commentary read no writes';
RAISE NOTICE 'PASS SRC-02 commentary terminal replay';END $test$;
ROLLBACK;
DROP FUNCTION pg_temp.terminal_replay_state();
