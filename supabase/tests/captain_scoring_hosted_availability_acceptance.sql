\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','available');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
DO $test$ DECLARE r jsonb;p jsonb;BEGIN
r:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"abcdef70-0000-4000-8000-000000000001","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
ASSERT r->>'outcome'='ok','context authorized through actual captured graph';
SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011';
ASSERT p->>'availability_state'='none' AND (p->>'eligible_for_goal')::boolean AND p->>'state'='checked_in','available plus positive confirmed checkin is eligible';
END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','unavailable');
SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;p jsonb;BEGIN
r:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"abcdef70-0000-4000-8000-000000000002","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
SELECT x INTO p FROM jsonb_array_elements(r#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011';
ASSERT p->>'availability_state'='conflict' AND p->>'checkin_status'='confirmed' AND p->>'eligible_for_goal'='false','unavailable contradicts positive checkin without relabeling it';END $test$;
ROLLBACK;
BEGIN;
INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','confirmed');
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','available');
SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
DO $test$ DECLARE r jsonb;BEGIN
r:=public.captain_manage_game_scoring('{"schema_version":1,"request_id":"abcdef70-0000-4000-8000-000000000003","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001","kind":"add_goal","event_id":"abcdef70-0000-4000-8000-000000000004","expected_version":null,"scorer_id":"40000000-0000-4000-8000-000000000011","assist1_id":null,"assist2_id":null}');ASSERT r->>'outcome'='applied','available checked-in player can score';END $test$;
RESET ROLE;
UPDATE public.player_availability SET status='available' WHERE game_id='50000000-0000-4000-8000-000000000007';
DO $test$ BEGIN BEGIN UPDATE public.player_availability SET status='unavailable' WHERE game_id='50000000-0000-4000-8000-000000000007';RAISE EXCEPTION 'negative credited availability accepted';EXCEPTION WHEN check_violation THEN NULL;END;END $test$;
ROLLBACK;
BEGIN;
DO $t$ DECLARE av text;ci text;answer jsonb;p jsonb;expected_av text;BEGIN
FOREACH av IN ARRAY ARRAY['available','unavailable','maybe','injured'] LOOP
FOREACH ci IN ARRAY ARRAY['confirmed','tentative','out','absent'] LOOP
DELETE FROM public.player_availability WHERE game_id='50000000-0000-4000-8000-000000000007';DELETE FROM public.game_checkins WHERE game_id='50000000-0000-4000-8000-000000000007';
INSERT INTO public.player_availability(game_id,team_id,season_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011',av);
IF ci<>'absent' THEN INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011',ci); END IF;
SET LOCAL ROLE authenticated;PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
answer:=public.captain_get_game_scoring_context('{"schema_version":1,"request_id":"abcdef72-0000-4000-8000-000000000001","game_id":"50000000-0000-4000-8000-000000000007","team_id":"30000000-0000-4000-8000-000000000001","league_id":"10000000-0000-4000-8000-000000000001"}');
RESET ROLE;SELECT x INTO p FROM jsonb_array_elements(answer#>'{snapshot,roster}') x WHERE x->>'player_id'='40000000-0000-4000-8000-000000000011';
expected_av:=CASE WHEN av='available' THEN 'none' WHEN av IN('unavailable','injured') AND ci='confirmed' THEN 'conflict' WHEN av IN('unavailable','injured') THEN 'out' ELSE 'unknown' END;
ASSERT p->>'availability_state'=expected_av,'finite availability mapping';ASSERT (p->>'eligible_for_goal')::boolean=(av='available' AND ci='confirmed'),'positive checkin is required, negative or maybe never eligible';ASSERT p->>'checkin_status'=CASE WHEN ci='absent' THEN NULL ELSE ci END OR (ci='absent' AND p->'checkin_status'='null'::jsonb),'raw checkin retained';
END LOOP;END LOOP;END $t$;
ROLLBACK;
