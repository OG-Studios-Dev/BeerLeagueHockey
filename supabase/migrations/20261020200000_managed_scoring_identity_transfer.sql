BEGIN;
-- Forward-only integration: historical claim/merge bodies and authorization stay
-- pinned; refuse drift rather than wrapping an unknown privileged implementation.
DO $pin$ DECLARE r record; p record; BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole AND rolbypassrls) THEN RAISE EXCEPTION 'Expected trusted postgres migration principal'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='captain_scoring_authority' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND rolbypassrls) OR has_schema_privilege('captain_scoring_authority','public','CREATE') THEN RAISE EXCEPTION 'Scoring authority role/schema drift'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('public.claim_rostered_player_profile(uuid,uuid)','376679f4c2f6460535e43b4746cd38ab','postgres','{postgres=X/postgres}','{"search_path=\"\""}'),
 ('public.merge_legacy_profile(uuid,uuid)','902b731ee4e11c33da31f1b457d12987','postgres','{postgres=X/postgres}','{"search_path=\"\""}'),
 ('public.admin_merge_legacy_profile(uuid,uuid,uuid)','9c732d615a3429f7063dfdda620b5ac9','postgres','{postgres=X/postgres,service_role=X/postgres}','{"search_path=\"\""}'),
 ('public._claim_rostered_player_profile_core(uuid,uuid)','c2fb38d7e31e8412ae55bb5e3ea4a23c','postgres','{postgres=X/postgres}','{search_path=public}'),
 ('public._merge_legacy_profile_core(uuid,uuid)','73f9800ca09f1ea5b18336bd63cf795c','postgres','{postgres=X/postgres}','{search_path=public}'),
 ('public._claim_update_uuid_column_if_exists(text,text,uuid,uuid)','b7d2a82f5454f93ea8f13b7d0ad60330','postgres','{postgres=X/postgres}','{search_path=public}'),
 ('public._assert_player_merge_invariants(uuid,uuid,boolean,boolean)','ab2c5a9a7d59c4f16698503c07b8ba78','postgres','{postgres=X/postgres}','{"search_path=\"\""}'),
 ('public._lock_player_merge_identities(uuid,uuid,uuid)','cc163edce80b9a75c25cca86b383b2b2','postgres','{postgres=X/postgres}','{"search_path=\"\""}'),
 ('public.scorekeeping_player_on_team_private(uuid,uuid,uuid)','14b85cf542f844a2deb1c659f52cf0b0','postgres','{postgres=X/postgres}','{"search_path=public, pg_temp"}'),
 ('public._cs_event_guard()','79c37d0668eee29bab9897da8b5dc7a5','captain_scoring_authority','{captain_scoring_authority=X/captain_scoring_authority}','{search_path=pg_catalog}'),
 ('public._cs_attendance_guard()','a9eb750a7ebcb1d9f3cfa61572324cfc','captain_scoring_authority','{captain_scoring_authority=X/captain_scoring_authority}','{search_path=pg_catalog}')
 ) x(sig,body,owner_name,acl,config) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.sig);
  IF NOT FOUND OR md5(p.prosrc)<>r.body OR pg_get_userbyid(p.proowner)<>r.owner_name OR NOT p.prosecdef OR p.pronargdefaults<>0 OR p.proacl::text IS DISTINCT FROM r.acl OR p.proconfig::text IS DISTINCT FROM r.config THEN RAISE EXCEPTION 'Identity transfer prerequisite drift: %',r.sig; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='captain_scoring_authority'::regrole AND member=current_user::regrole AND (inherit_option OR set_option)) OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='captain_scoring_authority'::regrole AND member=current_user::regrole AND admin_option) THEN RAISE EXCEPTION 'Scoring creator membership drift'; END IF;
END $pin$;
CREATE TABLE public._captain_scoring_identity_transfer(
 transaction_id xid8 NOT NULL, backend_pid integer NOT NULL,
 source_id uuid NOT NULL,target_id uuid NOT NULL,game_id uuid NOT NULL,team_id uuid NOT NULL,
 CHECK(source_id<>target_id),PRIMARY KEY(transaction_id,backend_pid,source_id,target_id,game_id,team_id));
ALTER TABLE public._captain_scoring_identity_transfer OWNER TO postgres;
ALTER TABLE public._captain_scoring_identity_transfer ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._captain_scoring_identity_transfer FROM PUBLIC,anon,authenticated,service_role,captain_scoring_authority;
GRANT SELECT ON public._captain_scoring_identity_transfer TO captain_scoring_authority;
-- PG17 creator membership is retained with SET/INHERIT false by scoring migration.
GRANT captain_scoring_authority TO CURRENT_USER WITH INHERIT TRUE,SET TRUE;

SET LOCAL ROLE captain_scoring_authority;
GRANT INSERT,UPDATE,DELETE ON public.captain_game_scoring_presence TO postgres;
GRANT UPDATE ON public.captain_game_scoring_state TO postgres;
RESET ROLE;
create or replace function public.scorekeeping_player_on_team_private(
  p_game_id uuid, p_player_id uuid, p_team_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public._captain_scoring_identity_transfer c
    where c.transaction_id=pg_catalog.pg_current_xact_id() and c.backend_pid=pg_catalog.pg_backend_pid()
      and c.target_id=p_player_id and c.game_id=p_game_id and c.team_id=p_team_id
      and exists(select 1 from public.game_events e where e.game_id=p_game_id and e.team_id=p_team_id and c.source_id in(e.player_id,e.assist1_player_id,e.assist2_player_id))
  ) or exists (
    select 1 from public.game_checkins gc
    where gc.game_id = p_game_id and gc.player_id = p_player_id
      and gc.team_id = p_team_id and gc.status = 'confirmed'
  ) or exists (
    select 1
    from public.games g
    join public.team_rosters tr on tr.season_id = g.season_id
      and tr.league_id = g.league_id and tr.team_id = p_team_id
      and tr.player_id = p_player_id and tr.status::text = 'active'
    where g.id = p_game_id
      and (tr.joined_at is null or tr.joined_at <= g.scheduled_at)
      and (tr.end_date is null or tr.end_date >= g.scheduled_at::date)
  );
$function$;
CREATE OR REPLACE FUNCTION public._cs_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE gid uuid;g public.games%ROWTYPE;p uuid;s jsonb;
BEGIN
 gid:=CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;
 IF TG_OP='UPDATE' AND NEW.game_id IS DISTINCT FROM OLD.game_id AND (EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=OLD.game_id) OR EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=NEW.game_id)) THEN RAISE EXCEPTION 'Managed event game immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=gid) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Managed writes require READ COMMITTED' USING ERRCODE='40001'; END IF;
 SELECT * INTO g FROM public.games WHERE id=gid FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.league_id IS DISTINCT FROM g.league_id OR NEW.team_id NOT IN(g.home_team_id,g.away_team_id) OR NEW.team_type IS DISTINCT FROM (CASE WHEN NEW.team_id=g.home_team_id THEN 'home' ELSE 'away' END) THEN RAISE EXCEPTION 'Invalid managed event attribution' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.league_id,NEW.team_id,NEW.team_type) IS DISTINCT FROM (OLD.id,OLD.league_id,OLD.team_id,OLD.team_type) THEN RAISE EXCEPTION 'Managed event scope immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-'event_version'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'event_version'-'updated_at') THEN
   IF OLD.event_version=2147483647 OR NEW.event_version NOT IN(OLD.event_version,OLD.event_version+1) THEN RAISE EXCEPTION 'Version overflow or invalid jump' USING ERRCODE='22003'; END IF;
   NEW.event_version:=OLD.event_version+1;
  ELSIF NEW.event_version IS DISTINCT FROM OLD.event_version AND (OLD.event_version=2147483647 OR NEW.event_version<>OLD.event_version+1) THEN RAISE EXCEPTION 'Invalid version jump' USING ERRCODE='22003'; END IF;
 END IF;
 -- Existing credited history remains readable; only newly credited or restored
 -- participants in a live game require current eligibility. Completed trusted
 -- correction continues to use its pre-existing authorization boundary.
 IF NEW.deleted_at IS NULL AND g.status::text IN('scheduled','in_progress') AND (TG_OP='INSERT' OR OLD.deleted_at IS NOT NULL OR (NEW.player_id,NEW.assist1_player_id,NEW.assist2_player_id) IS DISTINCT FROM (OLD.player_id,OLD.assist1_player_id,OLD.assist2_player_id)) AND NOT (TG_OP='UPDATE' AND
  (to_jsonb(NEW)-'player_id'-'assist1_player_id'-'assist2_player_id'-'goalie_in_net_id'-'event_version'-'updated_at')=(to_jsonb(OLD)-'player_id'-'assist1_player_id'-'assist2_player_id'-'goalie_in_net_id'-'event_version'-'updated_at')
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[OLD.player_id,OLD.assist1_player_id,OLD.assist2_player_id,OLD.goalie_in_net_id],ARRAY[NEW.player_id,NEW.assist1_player_id,NEW.assist2_player_id,NEW.goalie_in_net_id]) x(old_id,new_id)
    WHERE old_id IS DISTINCT FROM new_id AND NOT EXISTS(SELECT 1 FROM public._captain_scoring_identity_transfer c WHERE c.transaction_id=pg_current_xact_id() AND c.backend_pid=pg_backend_pid() AND c.source_id=x.old_id AND c.target_id=x.new_id AND c.game_id=OLD.game_id AND c.team_id=OLD.team_id))) THEN
  s:=public._cs_snapshot(g,NEW.team_id);
  FOREACH p IN ARRAY ARRAY[NEW.player_id,NEW.assist1_player_id,NEW.assist2_player_id] LOOP
   IF p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'roster') r WHERE (r->>'player_id')::uuid=p AND (r->>'eligible_for_goal')::boolean) THEN RAISE EXCEPTION 'Managed event participant not eligible' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION public._cs_attendance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE gid uuid;p uuid;t uuid;g public.games%ROWTYPE;changed boolean;
BEGIN
 gid:=CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;p:=CASE WHEN TG_OP='DELETE' THEN OLD.player_id ELSE NEW.player_id END;t:=CASE WHEN TG_OP='DELETE' THEN OLD.team_id ELSE NEW.team_id END;
 IF TG_OP='UPDATE' AND (NEW.game_id,NEW.player_id,NEW.team_id) IS DISTINCT FROM (OLD.game_id,OLD.player_id,OLD.team_id) AND NOT (
    (to_jsonb(NEW)-'player_id'-'updated_at')=(to_jsonb(OLD)-'player_id'-'updated_at') AND EXISTS(
      SELECT 1 FROM public._captain_scoring_identity_transfer c WHERE c.transaction_id=pg_current_xact_id() AND c.backend_pid=pg_backend_pid() AND c.source_id=OLD.player_id AND c.target_id=NEW.player_id AND c.game_id=OLD.game_id AND c.team_id=OLD.team_id)
  ) AND (EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=OLD.game_id) OR EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=NEW.game_id)) THEN RAISE EXCEPTION 'Managed attendance identity immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=gid) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Managed writes require READ COMMITTED' USING ERRCODE='40001'; END IF;
 SELECT * INTO g FROM public.games WHERE id=gid FOR UPDATE;
 IF t NOT IN(g.home_team_id,g.away_team_id) THEN RAISE EXCEPTION 'Managed attendance team invalid' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='game_checkins' THEN
  -- Reset/delete removes operational selection, never retained goal/stat facts.
  -- AFTER DELETE advances presence so stale Scratch/Reinstate cannot forge authority.
  -- Explicit negative out/tentative still contradicts retained credits and is denied.
  IF TG_OP<>'DELETE' AND NEW.status<>'confirmed' AND public._cs_credited(gid,p) THEN RAISE EXCEPTION 'Credited participant attendance cannot be removed' USING ERRCODE='23514'; END IF;

 ELSE
  IF TG_OP<>'DELETE' AND (NEW.season_id<>g.season_id OR (NEW.status IS NOT NULL AND NEW.status<>'available' AND public._cs_credited(gid,p))) THEN RAISE EXCEPTION 'Credited participant availability cannot conflict' USING ERRCODE='23514'; END IF;

 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $f$;
CREATE OR REPLACE FUNCTION public.claim_rostered_player_profile(
  p_target_profile_id uuid,
  p_claim_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_scoring_checkins_reassigned integer := 0;
BEGIN
  PERFORM public._assert_player_merge_invariants(
    p_target_profile_id, p_claim_profile_id, false, true
  );

  -- Identity/profile/Auth invariants above are unchanged. Scoring always locks
  -- the game before writing; lock all associated games in deterministic order.
  PERFORM g.id FROM public.games g WHERE g.id IN (
    SELECT game_id FROM public.game_checkins WHERE player_id IN(p_claim_profile_id,p_target_profile_id)
    UNION SELECT game_id FROM public.player_availability WHERE player_id IN(p_claim_profile_id,p_target_profile_id)
    UNION SELECT game_id FROM public.game_events WHERE p_claim_profile_id IN(player_id,assist1_player_id,assist2_player_id,goalie_in_net_id)
    UNION SELECT game_id FROM public.captain_game_scoring_presence WHERE player_id IN(p_claim_profile_id,p_target_profile_id)
    UNION SELECT g2.id FROM public.games g2 JOIN public.team_rosters r ON r.team_id IN(g2.home_team_id,g2.away_team_id) AND r.season_id=g2.season_id WHERE r.player_id IN(p_claim_profile_id,p_target_profile_id)
  ) ORDER BY g.id FOR UPDATE;
  INSERT INTO public._captain_scoring_identity_transfer(transaction_id,backend_pid,source_id,target_id,game_id,team_id)
  SELECT pg_current_xact_id(),pg_backend_pid(),p_claim_profile_id,p_target_profile_id,game_id,team_id FROM public.game_checkins WHERE player_id=p_claim_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_claim_profile_id,p_target_profile_id,game_id,team_id FROM public.player_availability WHERE player_id=p_claim_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_claim_profile_id,p_target_profile_id,game_id,team_id FROM public.captain_game_scoring_presence WHERE player_id=p_claim_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_claim_profile_id,p_target_profile_id,game_id,team_id FROM public.game_events WHERE p_claim_profile_id IN(player_id,assist1_player_id,assist2_player_id,goalie_in_net_id);

  IF EXISTS(SELECT 1 FROM public.game_checkins s JOIN public.game_checkins t USING(game_id) WHERE s.player_id=p_claim_profile_id AND t.player_id=p_target_profile_id AND (s.team_id,s.status) IS DISTINCT FROM (t.team_id,t.status)) THEN RAISE EXCEPTION 'Identity transfer attendance collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.game_checkins s USING public.game_checkins t WHERE s.player_id=p_claim_profile_id AND t.player_id=p_target_profile_id AND s.game_id=t.game_id;
  -- Existing attribution validators require the canonical target's confirmed
  -- checkin before the core rewrites event credits (new saved rosters may have
  -- joined after game time). Preserve row/team/status; capability binds identity.
  UPDATE public.game_checkins SET player_id=p_target_profile_id WHERE player_id=p_claim_profile_id;
  GET DIAGNOSTICS v_scoring_checkins_reassigned = ROW_COUNT;

  IF EXISTS(SELECT 1 FROM public.player_availability s JOIN public.player_availability t USING(game_id) WHERE s.player_id=p_claim_profile_id AND t.player_id=p_target_profile_id AND (s.team_id,s.season_id,s.status) IS DISTINCT FROM (t.team_id,t.season_id,t.status)) THEN RAISE EXCEPTION 'Identity transfer availability collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.player_availability s USING public.player_availability t WHERE s.player_id=p_claim_profile_id AND t.player_id=p_target_profile_id AND s.game_id=t.game_id;

  IF EXISTS(SELECT 1 FROM public.sub_invitations s JOIN public.sub_invitations t USING(game_id) WHERE s.invited_player_id=p_claim_profile_id AND t.invited_player_id=p_target_profile_id AND (s.team_id,s.status,s.replaced_player_id) IS DISTINCT FROM (t.team_id,t.status,t.replaced_player_id)) THEN RAISE EXCEPTION 'Identity transfer invitation collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.sub_invitations s USING public.sub_invitations t WHERE s.invited_player_id=p_claim_profile_id AND t.invited_player_id=p_target_profile_id AND s.game_id=t.game_id;
  v_result := public._claim_rostered_player_profile_core(
    p_target_profile_id, p_claim_profile_id
  );
  IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'Roster claim core failed: %', COALESCE(v_result ->> 'error', 'unknown error');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_claim_profile_id) THEN
    RAISE EXCEPTION 'Roster claim did not delete source profile %', p_claim_profile_id;
  END IF;

  -- Operational versions are not immutable request ledgers. Invalidate both
  -- identity views while preserving the actual checkin (including game-only out).
  INSERT INTO public.captain_game_scoring_presence(game_id,team_id,player_id,version)
  SELECT c.game_id,c.team_id,c.target_id,greatest(coalesce(o.version,0),coalesce(t.version,0))+1
  FROM public._captain_scoring_identity_transfer c
  LEFT JOIN public.captain_game_scoring_presence o ON (o.game_id,o.team_id,o.player_id)=(c.game_id,c.team_id,c.source_id)
  LEFT JOIN public.captain_game_scoring_presence t ON (t.game_id,t.team_id,t.player_id)=(c.game_id,c.team_id,c.target_id)
  WHERE c.transaction_id=pg_current_xact_id() AND c.backend_pid=pg_backend_pid() AND c.source_id=p_claim_profile_id AND c.target_id=p_target_profile_id AND EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=c.game_id)
  ON CONFLICT(game_id,team_id,player_id) DO UPDATE SET version=EXCLUDED.version;
  DELETE FROM public.captain_game_scoring_presence WHERE player_id=p_claim_profile_id;
  UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id IN(SELECT game_id FROM public._captain_scoring_identity_transfer WHERE transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND source_id=p_claim_profile_id AND target_id=p_target_profile_id);
  DELETE FROM public._captain_scoring_identity_transfer WHERE transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND source_id=p_claim_profile_id AND target_id=p_target_profile_id;
  RETURN jsonb_set(v_result,'{total_reassigned}',to_jsonb(coalesce((v_result->>'total_reassigned')::integer,0)+v_scoring_checkins_reassigned));
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
CREATE OR REPLACE FUNCTION public.merge_legacy_profile(
  p_new_profile_id uuid,
  p_legacy_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_player_stats_reassigned integer := 0;
  v_core_total integer := 0;
  v_scoring_checkins_reassigned integer := 0;
BEGIN
  PERFORM public._assert_player_merge_invariants(
    p_new_profile_id, p_legacy_profile_id, true, false
  );


  -- Identity/profile/Auth invariants above are unchanged. Scoring always locks
  -- the game before writing; lock all associated games in deterministic order.
  PERFORM g.id FROM public.games g WHERE g.id IN (
    SELECT game_id FROM public.game_checkins WHERE player_id IN(p_legacy_profile_id,p_new_profile_id)
    UNION SELECT game_id FROM public.player_availability WHERE player_id IN(p_legacy_profile_id,p_new_profile_id)
    UNION SELECT game_id FROM public.game_events WHERE p_legacy_profile_id IN(player_id,assist1_player_id,assist2_player_id,goalie_in_net_id)
    UNION SELECT game_id FROM public.captain_game_scoring_presence WHERE player_id IN(p_legacy_profile_id,p_new_profile_id)
    UNION SELECT g2.id FROM public.games g2 JOIN public.team_rosters r ON r.team_id IN(g2.home_team_id,g2.away_team_id) AND r.season_id=g2.season_id WHERE r.player_id IN(p_legacy_profile_id,p_new_profile_id)
  ) ORDER BY g.id FOR UPDATE;
  INSERT INTO public._captain_scoring_identity_transfer(transaction_id,backend_pid,source_id,target_id,game_id,team_id)
  SELECT pg_current_xact_id(),pg_backend_pid(),p_legacy_profile_id,p_new_profile_id,game_id,team_id FROM public.game_checkins WHERE player_id=p_legacy_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_legacy_profile_id,p_new_profile_id,game_id,team_id FROM public.player_availability WHERE player_id=p_legacy_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_legacy_profile_id,p_new_profile_id,game_id,team_id FROM public.captain_game_scoring_presence WHERE player_id=p_legacy_profile_id
  UNION SELECT pg_current_xact_id(),pg_backend_pid(),p_legacy_profile_id,p_new_profile_id,game_id,team_id FROM public.game_events WHERE p_legacy_profile_id IN(player_id,assist1_player_id,assist2_player_id,goalie_in_net_id);

  IF EXISTS(SELECT 1 FROM public.game_checkins s JOIN public.game_checkins t USING(game_id) WHERE s.player_id=p_legacy_profile_id AND t.player_id=p_new_profile_id AND (s.team_id,s.status) IS DISTINCT FROM (t.team_id,t.status)) THEN RAISE EXCEPTION 'Identity transfer attendance collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.game_checkins s USING public.game_checkins t WHERE s.player_id=p_legacy_profile_id AND t.player_id=p_new_profile_id AND s.game_id=t.game_id;
  -- Existing attribution validators require the canonical target's confirmed
  -- checkin before the core rewrites event credits (new saved rosters may have
  -- joined after game time). Preserve row/team/status; capability binds identity.
  UPDATE public.game_checkins SET player_id=p_new_profile_id WHERE player_id=p_legacy_profile_id;
  GET DIAGNOSTICS v_scoring_checkins_reassigned = ROW_COUNT;

  IF EXISTS(SELECT 1 FROM public.player_availability s JOIN public.player_availability t USING(game_id) WHERE s.player_id=p_legacy_profile_id AND t.player_id=p_new_profile_id AND (s.team_id,s.season_id,s.status) IS DISTINCT FROM (t.team_id,t.season_id,t.status)) THEN RAISE EXCEPTION 'Identity transfer availability collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.player_availability s USING public.player_availability t WHERE s.player_id=p_legacy_profile_id AND t.player_id=p_new_profile_id AND s.game_id=t.game_id;

  IF EXISTS(SELECT 1 FROM public.sub_invitations s JOIN public.sub_invitations t USING(game_id) WHERE s.invited_player_id=p_legacy_profile_id AND t.invited_player_id=p_new_profile_id AND (s.team_id,s.status,s.replaced_player_id) IS DISTINCT FROM (t.team_id,t.status,t.replaced_player_id)) THEN RAISE EXCEPTION 'Identity transfer invitation collision' USING ERRCODE='23514'; END IF;
  DELETE FROM public.sub_invitations s USING public.sub_invitations t WHERE s.invited_player_id=p_legacy_profile_id AND t.invited_player_id=p_new_profile_id AND s.game_id=t.game_id;

  -- The deployed legacy core deduplicates player_stats by season/team even
  -- though the real uniqueness key is (game_id, player_id). Move distinct games
  -- first and remove only true same-game duplicates so the untouched complete
  -- core cannot discard different games from the same season/team.
  UPDATE public.player_stats AS source_stat
  SET player_id = p_new_profile_id
  WHERE source_stat.player_id = p_legacy_profile_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_stats AS target_stat
      WHERE target_stat.player_id = p_new_profile_id
        AND target_stat.game_id = source_stat.game_id
    );
  GET DIAGNOSTICS v_player_stats_reassigned = ROW_COUNT;
  DELETE FROM public.player_stats AS source_stat
  WHERE source_stat.player_id = p_legacy_profile_id
    AND EXISTS (
      SELECT 1
      FROM public.player_stats AS target_stat
      WHERE target_stat.player_id = p_new_profile_id
        AND target_stat.game_id = source_stat.game_id
    );

  v_result := public._merge_legacy_profile_core(
    p_new_profile_id, p_legacy_profile_id
  );
  IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'Legacy merge core failed: %', COALESCE(v_result ->> 'error', 'unknown error');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_legacy_profile_id) THEN
    RAISE EXCEPTION 'Legacy merge did not delete source profile %', p_legacy_profile_id;
  END IF;

  -- Operational versions are not immutable request ledgers. Invalidate both
  -- identity views while preserving the actual checkin (including game-only out).
  INSERT INTO public.captain_game_scoring_presence(game_id,team_id,player_id,version)
  SELECT c.game_id,c.team_id,c.target_id,greatest(coalesce(o.version,0),coalesce(t.version,0))+1
  FROM public._captain_scoring_identity_transfer c
  LEFT JOIN public.captain_game_scoring_presence o ON (o.game_id,o.team_id,o.player_id)=(c.game_id,c.team_id,c.source_id)
  LEFT JOIN public.captain_game_scoring_presence t ON (t.game_id,t.team_id,t.player_id)=(c.game_id,c.team_id,c.target_id)
  WHERE c.transaction_id=pg_current_xact_id() AND c.backend_pid=pg_backend_pid() AND c.source_id=p_legacy_profile_id AND c.target_id=p_new_profile_id AND EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=c.game_id)
  ON CONFLICT(game_id,team_id,player_id) DO UPDATE SET version=EXCLUDED.version;
  DELETE FROM public.captain_game_scoring_presence WHERE player_id=p_legacy_profile_id;
  UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id IN(SELECT game_id FROM public._captain_scoring_identity_transfer WHERE transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND source_id=p_legacy_profile_id AND target_id=p_new_profile_id);
  DELETE FROM public._captain_scoring_identity_transfer WHERE transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND source_id=p_legacy_profile_id AND target_id=p_new_profile_id;
  v_core_total := COALESCE((v_result ->> 'total_reassigned')::integer, 0);
  RETURN jsonb_set(
    v_result,
    '{total_reassigned}',
    to_jsonb(v_core_total + v_player_stats_reassigned + v_scoring_checkins_reassigned),
    true
  );
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
REVOKE ALL ON FUNCTION public.merge_legacy_profile(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_rostered_player_profile(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT captain_scoring_authority TO CURRENT_USER WITH INHERIT FALSE,SET FALSE;
COMMIT;
