BEGIN;
-- New authority only: existing policies, triggers and application-role grants are
-- untouched. Refuse collisions rather than inherit an untrusted owner or ACL.
CREATE ROLE captain_sub_authority NOLOGIN BYPASSRLS;
-- Temporary migration-principal privileges for owner transfer and owner ACLs.
-- PostgreSQL 17 creator ADMIN membership alone does not permit SET ROLE.
GRANT captain_sub_authority TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
GRANT USAGE, CREATE ON SCHEMA public TO captain_sub_authority;
GRANT USAGE ON SCHEMA captain_sub_private TO captain_sub_authority;
GRANT INSERT (profile_id) ON captain_sub_private.guest_insert_capabilities TO captain_sub_authority;
-- The deployer can use auth.uid() but cannot regrant protected auth privileges.
-- Delegate only unchanged identity semantics: no tables, arguments or DML.
CREATE FUNCTION public._captain_sub_actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$ SELECT auth.uid() $fn$;
ALTER FUNCTION public._captain_sub_actor_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._captain_sub_actor_id() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._captain_sub_actor_id() TO captain_sub_authority;
GRANT SELECT ON public.leagues, public.teams, public.seasons, public.games, public.profiles, public.team_rosters, public.game_checkins, public.sub_invitations, public.league_spare_pool, public.player_stats, public.goalie_stats TO captain_sub_authority;

CREATE FUNCTION public._captain_sub_text(p_text text,p_bytes integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
BEGIN IF octet_length(p_text)>p_bytes THEN RAISE EXCEPTION 'Invitation profile text bound exceeded' USING ERRCODE='54000'; END IF; RETURN p_text; END $fn$;
ALTER FUNCTION public._captain_sub_text(text,integer) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_text(text,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._captain_sub_normalize(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT btrim(regexp_replace(regexp_replace(lower(normalize(coalesce(p_text,''),NFKD)),U&'[\0300-\036f]','','g'),'[^a-z0-9]+',' ','g'))
$fn$;
ALTER FUNCTION public._captain_sub_normalize(text) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_normalize(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._captain_sub_token_matches(a text,b text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE i integer:=1; j integer:=1; edits integer:=0; na integer:=length(a); nb integer:=length(b);
BEGIN
 IF strpos(a,b)>0 THEN RETURN true; END IF;
 IF na<5 OR nb<5 OR abs(na-nb)>1 THEN RETURN false; END IF;
 WHILE i<=na AND j<=nb LOOP
 IF substr(a,i,1)=substr(b,j,1) THEN i:=i+1;j:=j+1;
 ELSE edits:=edits+1; IF edits>1 THEN RETURN false; END IF;
 IF na>=nb THEN i:=i+1; END IF; IF nb>=na THEN j:=j+1; END IF;
 END IF;
 END LOOP;
 RETURN edits+(na-i+1)+(nb-j+1)<=1;
END $fn$;
ALTER FUNCTION public._captain_sub_token_matches(text,text) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_token_matches(text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._captain_sub_matches(p_text text,p_query text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE h text; q text; qt text; ct text; matched boolean;
BEGIN
 IF octet_length(coalesce(p_text,''))>2048 THEN RAISE EXCEPTION 'Profile searchable text exceeds 2048 bytes' USING ERRCODE='54000'; END IF;
 h:=public._captain_sub_normalize(p_text);q:=public._captain_sub_normalize(p_query);
 IF q='' OR strpos(h,q)>0 THEN RETURN true; END IF;
 FOREACH qt IN ARRAY string_to_array(q,' ') LOOP
 matched:=false;
 FOREACH ct IN ARRAY string_to_array(h,' ') LOOP IF public._captain_sub_token_matches(ct,qt) THEN matched:=true;EXIT;END IF; END LOOP;
 IF NOT matched THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $fn$;
ALTER FUNCTION public._captain_sub_matches(text,text) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_matches(text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._captain_sub_role(p_position text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE WHEN n='g' OR n LIKE '%goalie%' OR n LIKE '%goaltender%' THEN 'goalie'
 WHEN n IN ('skater','f','forward','forwards','c','center','centre','lw','rw','d','defense','defence') OR n LIKE '%wing%' OR n LIKE '%defense%' OR n LIKE '%defence%' THEN 'skater' END
 FROM (SELECT public._captain_sub_normalize(p_position) n) t
$fn$;
ALTER FUNCTION public._captain_sub_role(text) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_role(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._captain_sub_scope(p_game_id uuid,p_team_id uuid,p_league_id uuid) RETURNS public.games
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE g public.games%ROWTYPE; s uuid; d date;
BEGIN
 IF public._captain_sub_actor_id() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 SELECT x.* INTO g FROM public.games x JOIN public.teams t ON t.id=p_team_id AND t.league_id=x.league_id
 JOIN public.seasons se ON se.id=x.season_id AND se.league_id=x.league_id
 WHERE x.id=p_game_id AND x.league_id=p_league_id AND p_team_id IN(x.home_team_id,x.away_team_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Game scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT id INTO s FROM public.seasons WHERE league_id=p_league_id AND status::text IN('active','playoffs')
 ORDER BY CASE status::text WHEN 'active' THEN 0 ELSE 1 END,start_date DESC,created_at DESC NULLS LAST,id LIMIT 1;
 IF g.season_id IS DISTINCT FROM s OR g.status::text NOT IN('scheduled','in_progress') THEN RAISE EXCEPTION 'Game lifecycle unavailable' USING ERRCODE='42501'; END IF;
 SELECT (statement_timestamp() AT TIME ZONE timezone)::date INTO d FROM public.leagues WHERE id=p_league_id;
 IF NOT EXISTS(SELECT 1 FROM public.team_rosters r JOIN public.profiles p ON p.id=r.player_id AND p.deleted_at IS NULL
 WHERE r.player_id=public._captain_sub_actor_id() AND r.team_id=p_team_id AND r.league_id=p_league_id AND r.season_id=s AND r.player_type='regular'
 AND r.status::text='active' AND r.end_date IS NULL AND r.start_date<=d AND r.leadership_role::text IN('captain','alternate_captain')) THEN
 RAISE EXCEPTION 'Current regular captain authority required' USING ERRCODE='42501'; END IF;
 RETURN g;
END $fn$;
ALTER FUNCTION public._captain_sub_scope(uuid,uuid,uuid) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public._captain_sub_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.captain_get_sub_invitation_context(p_game_id uuid,p_team_id uuid,p_league_id uuid,p_replaced_player_id uuid DEFAULT NULL,p_include_recent boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE g public.games%ROWTYPE; replacements jsonb; candidates jsonb; invitations jsonb; recent jsonb:='[]'; v_role text; result jsonb;
BEGIN
 g:=public._captain_sub_scope(p_game_id,p_team_id,p_league_id);
 -- Explicit reject-at-cap+1 guards precede joins, sorting and JSON aggregation.
 -- These bound materialized source cardinality, not unrelated-tenant disk work.
 IF (SELECT count(*) FROM (SELECT 1 FROM public.team_rosters WHERE league_id=p_league_id LIMIT 10001) x)>10000
 OR (SELECT count(*) FROM (SELECT 1 FROM public.league_spare_pool WHERE league_id=p_league_id LIMIT 10001) x)>10000
 OR (SELECT count(*) FROM (SELECT 1 FROM public.sub_invitations WHERE game_id=p_game_id AND team_id=p_team_id LIMIT 1001) x)>1000
 OR (SELECT count(*) FROM (SELECT 1 FROM public.seasons WHERE league_id=p_league_id LIMIT 257) x)>256 THEN
 RAISE EXCEPTION 'Invitation source row bounds exceeded' USING ERRCODE='54000'; END IF;
 IF p_include_recent AND ((SELECT count(*) FROM (SELECT 1 FROM public.player_stats WHERE league_id=p_league_id LIMIT 10001) x)>10000 OR (SELECT count(*) FROM (SELECT 1 FROM public.goalie_stats WHERE league_id=p_league_id LIMIT 10001) x)>10000) THEN RAISE EXCEPTION 'Recent source exceeds 10000 rows per stat type' USING ERRCODE='54000'; END IF;
 IF p_include_recent IS NULL THEN RAISE EXCEPTION 'Invalid recent flag' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',r.player_id,'full_name',public._captain_sub_text(p.full_name,640),'jersey_number',r.jersey_number,'position',r.position) ORDER BY p.full_name,r.player_id),'[]') INTO replacements
 FROM public.team_rosters r JOIN public.profiles p ON p.id=r.player_id AND p.deleted_at IS NULL
 JOIN public.game_checkins c ON c.game_id=p_game_id AND c.team_id=p_team_id AND c.player_id=r.player_id AND c.status='out'
 JOIN public.leagues l ON l.id=p_league_id
 WHERE r.team_id=p_team_id AND r.league_id=p_league_id AND r.season_id=g.season_id AND r.player_type='regular' AND r.status::text='active' AND r.end_date IS NULL AND r.start_date<=(statement_timestamp() AT TIME ZONE l.timezone)::date;
 IF p_replaced_player_id IS NOT NULL THEN
 SELECT public._captain_sub_role(x->>'position') INTO v_role FROM jsonb_array_elements(replacements) x WHERE x->>'player_id'=p_replaced_player_id::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'Replacement must be current regular Out' USING ERRCODE='22023'; END IF;
 END IF;
 WITH eligible AS (
 SELECT r.player_id,r.position::text position,'team'::text source,0 precedence FROM public.team_rosters r
 WHERE r.league_id=p_league_id AND r.team_id=p_team_id AND r.status::text='active' AND r.end_date IS NULL AND r.player_type IN('sub','part_time')
 UNION ALL SELECT l.player_id,l.position,'league',1 FROM public.league_spare_pool l WHERE l.league_id=p_league_id AND l.active),
 picked AS (SELECT DISTINCT ON(player_id) * FROM eligible ORDER BY player_id,precedence,position NULLS LAST)
 SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',q.player_id,'full_name',public._captain_sub_text(p.full_name,640),'email',public._captain_sub_text(p.email,512),'position',public._captain_sub_text(q.position,128),'source',q.source) ORDER BY q.precedence,p.full_name,q.player_id),'[]') INTO candidates
 FROM picked q JOIN public.profiles p ON p.id=q.player_id AND p.deleted_at IS NULL
 WHERE (v_role IS NULL OR public._captain_sub_role(q.position)=v_role) AND NOT EXISTS(SELECT 1 FROM public.team_rosters r WHERE r.player_id=q.player_id AND r.team_id=p_team_id AND r.league_id=p_league_id AND r.season_id=g.season_id AND r.status::text='active' AND r.end_date IS NULL AND r.player_type='regular');
 IF p_include_recent THEN
 WITH ranked AS (SELECT s.id,row_number() OVER(ORDER BY s.start_date DESC,s.created_at DESC NULLS LAST,s.id) n FROM public.seasons s WHERE s.league_id=p_league_id AND lower(btrim(s.name)) NOT LIKE 'historical career baseline%'),
 chosen AS (SELECT a.id FROM ranked a JOIN ranked b ON b.id=g.season_id WHERE a.n BETWEEN b.n AND b.n+1),
 appearances AS (
 SELECT st.player_id,gm.scheduled_at,0 precedence FROM public.player_stats st JOIN public.games gm ON gm.id=st.game_id AND gm.league_id=st.league_id AND gm.season_id=st.season_id
 JOIN public.teams t ON t.id=st.team_id AND t.league_id=gm.league_id AND t.id IN(gm.home_team_id,gm.away_team_id)
 WHERE gm.league_id=p_league_id AND gm.status::text='completed' AND gm.season_id IN(SELECT id FROM chosen)
 UNION ALL
 SELECT st.player_id,gm.scheduled_at,1 FROM public.goalie_stats st JOIN public.games gm ON gm.id=st.game_id AND gm.league_id=st.league_id AND gm.season_id=st.season_id
 JOIN public.teams t ON t.id=st.team_id AND t.league_id=gm.league_id AND t.id IN(gm.home_team_id,gm.away_team_id)
 JOIN public.seasons s ON s.id=gm.season_id AND s.league_id=gm.league_id
 WHERE gm.league_id=p_league_id AND gm.status::text='completed' AND (gm.season_id IN(SELECT id FROM chosen) OR (v_role='goalie' AND EXISTS(SELECT 1 FROM chosen) AND lower(btrim(s.name)) LIKE 'historical career baseline%'))),
 grouped AS (SELECT a.player_id,max(a.scheduled_at) played,CASE WHEN min(a.precedence)=0 THEN 'Skater' ELSE 'Goalie' END position FROM appearances a WHERE NOT EXISTS(SELECT 1 FROM public.team_rosters r WHERE r.player_id=a.player_id AND r.league_id=p_league_id AND r.season_id=g.season_id AND r.status::text='active' AND r.end_date IS NULL) GROUP BY a.player_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',q.player_id,'full_name',public._captain_sub_text(p.full_name,640),'email',public._captain_sub_text(p.email,512),'position',public._captain_sub_text(q.position,128),'source','recent','last_played_at',q.played) ORDER BY p.full_name,q.player_id),'[]') INTO recent
 FROM grouped q JOIN public.profiles p ON p.id=q.player_id AND p.deleted_at IS NULL WHERE v_role IS NULL OR public._captain_sub_role(q.position)=v_role;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'player_id',i.invited_player_id,'status',i.status,'replaced_player_id',i.replaced_player_id,'source',i.source_type) ORDER BY i.created_at DESC,i.id),'[]') INTO invitations FROM public.sub_invitations i WHERE i.game_id=p_game_id AND i.team_id=p_team_id;
 result:=jsonb_build_object('schema_version',1,'game_id',p_game_id,'team_id',p_team_id,'league_id',p_league_id,'season_id',g.season_id,'replacements',replacements,'candidates',candidates,'recent_players',recent,'recent_loaded',p_include_recent,'invitations',invitations);
 IF jsonb_array_length(recent)>1000 OR jsonb_array_length(candidates)>1000 OR jsonb_array_length(replacements)>1000 OR jsonb_array_length(invitations)>1000 OR octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'Invitation context exceeds safe response bounds' USING ERRCODE='54000'; END IF;
 RETURN result;
END $fn$;
ALTER FUNCTION public.captain_get_sub_invitation_context(uuid,uuid,uuid,uuid,boolean) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public.captain_get_sub_invitation_context(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.captain_get_sub_invitation_context(uuid,uuid,uuid,uuid,boolean) TO authenticated;
GRANT INSERT ON public.profiles, public.team_rosters TO captain_sub_authority;
GRANT INSERT, UPDATE ON public.sub_invitations, public.game_checkins TO captain_sub_authority;
-- Required for row locking, not exposed to application roles.
GRANT UPDATE ON public.games, public.seasons, public.team_rosters, public.profiles, public.league_spare_pool TO captain_sub_authority;
CREATE TABLE public.captain_sub_request_receipts(actor_id uuid NOT NULL, request_id uuid NOT NULL, payload jsonb NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT statement_timestamp(), PRIMARY KEY(actor_id,request_id));
ALTER TABLE public.captain_sub_request_receipts OWNER TO captain_sub_authority;
ALTER TABLE public.captain_sub_request_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captain_sub_request_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.captain_manage_sub_invitation(
 p_game_id uuid,p_team_id uuid,p_league_id uuid,p_request_id uuid,p_kind text,
 p_player_id uuid DEFAULT NULL,p_replaced_player_id uuid DEFAULT NULL,p_message text DEFAULT NULL,p_confirmed boolean DEFAULT false,
 p_manual_name text DEFAULT NULL,p_manual_position text DEFAULT NULL,p_manual_jersey integer DEFAULT NULL,p_save_to_team_spares boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE g public.games%ROWTYPE; ctx jsonb; candidate jsonb; payload jsonb; previous public.captain_sub_request_receipts%ROWTYPE; inv public.sub_invitations%ROWTYPE;
 v_player uuid:=p_player_id; v_source text; v_outcome text; v_result jsonb; v_confirm boolean:=p_confirmed; v_position text; v_name text; v_ids uuid[]; v_narrow uuid[]; v_target_role text; v_known_role text;
BEGIN
 g:=public._captain_sub_scope(p_game_id,p_team_id,p_league_id);
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN('spare','recent','manual') OR p_confirmed IS NULL OR p_save_to_team_spares IS NULL OR octet_length(coalesce(p_message,''))>4000 THEN RAISE EXCEPTION 'Invalid command or message exceeds 4000 bytes' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_array(p_game_id,p_team_id,p_league_id,p_kind,p_player_id,p_replaced_player_id,p_message,p_confirmed,p_manual_name,p_manual_position,p_manual_jersey,p_save_to_team_spares);
 PERFORM pg_advisory_xact_lock(hashtextextended(public._captain_sub_actor_id()::text||p_request_id::text,0));
 SELECT * INTO previous FROM public.captain_sub_request_receipts WHERE actor_id=public._captain_sub_actor_id() AND request_id=p_request_id;
 IF FOUND THEN
 IF previous.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Idempotency payload conflict' USING ERRCODE='23505'; END IF;
 RETURN previous.receipt; END IF;
 -- Game lock shares the Beer Guy lifecycle serialization point. Lock authority
 -- dependencies before the second check, so revocations cannot race the write.
 PERFORM id FROM public.games WHERE id=p_game_id FOR UPDATE;
 PERFORM id FROM public.seasons WHERE league_id=p_league_id FOR SHARE;
 PERFORM id FROM public.team_rosters WHERE league_id=p_league_id AND (player_id=public._captain_sub_actor_id() OR player_id=p_replaced_player_id OR player_id=p_player_id) FOR SHARE;
 PERFORM id FROM public.league_spare_pool WHERE league_id=p_league_id AND player_id=p_player_id FOR SHARE;
 ctx:=public.captain_get_sub_invitation_context(p_game_id,p_team_id,p_league_id,p_replaced_player_id,p_kind='recent');
 IF p_kind='manual' THEN
 IF p_player_id IS NOT NULL OR p_manual_name IS NULL OR length(p_manual_name)>160 OR octet_length(p_manual_name)>640 OR (p_manual_position IS NOT NULL AND p_manual_position NOT IN('Forward','Defense','Goalie')) OR (p_manual_jersey IS NOT NULL AND p_manual_jersey NOT BETWEEN 1 AND 99) THEN RAISE EXCEPTION 'Invalid manual player fields' USING ERRCODE='22023'; END IF;
 v_name:=btrim(regexp_replace(p_manual_name,'[[:space:]]+',' ','g'));
 IF length(v_name)<2 OR public._captain_sub_normalize(v_name)='' THEN RAISE EXCEPTION 'Enter a player name' USING ERRCODE='22023'; END IF;
 SELECT public._captain_sub_role(x->>'position') INTO v_target_role FROM jsonb_array_elements(ctx->'replacements') x WHERE x->>'player_id'=p_replaced_player_id::text;
 IF v_target_role IS NOT NULL AND p_manual_position IS NOT NULL AND public._captain_sub_role(p_manual_position) IS DISTINCT FROM v_target_role THEN RAISE EXCEPTION 'Replacement role mismatch' USING ERRCODE='22023'; END IF;
 v_target_role:=coalesce(v_target_role,public._captain_sub_role(p_manual_position));
 -- A single resolver lock serializes even fuzzy-equivalent names, across games
 -- and teams. No unprotected lookup/create window or synthetic-profile retry.
 PERFORM pg_advisory_xact_lock(724103211,1);
 IF (SELECT count(*) FROM (SELECT 1 FROM public.profiles LIMIT 100001) x)>100000 THEN RAISE EXCEPTION 'Manual resolver exceeds 100000 profile budget; ask an administrator' USING ERRCODE='54000'; END IF;
 IF (SELECT count(*) FROM (SELECT 1 FROM public.player_stats WHERE league_id=p_league_id LIMIT 10001) x)>10000 OR (SELECT count(*) FROM (SELECT 1 FROM public.goalie_stats WHERE league_id=p_league_id LIMIT 10001) x)>10000 THEN RAISE EXCEPTION 'Manual role evidence exceeds 10000 rows per stat type' USING ERRCODE='54000'; END IF;
 SELECT array_agg(id) INTO v_ids FROM (SELECT p.id FROM public.profiles p WHERE public._captain_sub_matches(concat_ws(' ',p.full_name,p.email,p.position),v_name) LIMIT 51) q;
 IF coalesce(cardinality(v_ids),0)>50 THEN RAISE EXCEPTION 'Manual identity matches exceed 50; ask an administrator' USING ERRCODE='54000'; END IF;
 IF cardinality(v_ids)>1 AND v_target_role IS NOT NULL THEN
 SELECT array_agg(p.id) INTO v_narrow FROM public.profiles p WHERE p.id=ANY(v_ids) AND (public._captain_sub_role(p.position)=v_target_role OR EXISTS(SELECT 1 FROM public.team_rosters r WHERE r.player_id=p.id AND r.league_id=p_league_id AND public._captain_sub_role(r.position::text)=v_target_role) OR (v_target_role='goalie' AND EXISTS(SELECT 1 FROM public.goalie_stats st WHERE st.player_id=p.id AND st.league_id=p_league_id)) OR (v_target_role='skater' AND EXISTS(SELECT 1 FROM public.player_stats st WHERE st.player_id=p.id AND st.league_id=p_league_id)));
 IF cardinality(v_narrow)>0 THEN v_ids:=v_narrow; END IF;
 END IF;
 IF cardinality(v_ids)>1 THEN
 SELECT array_agg(DISTINCT r.player_id) INTO v_narrow FROM public.team_rosters r WHERE r.player_id=ANY(v_ids) AND r.league_id=p_league_id;
 IF cardinality(v_narrow)=1 THEN v_ids:=v_narrow; ELSE RAISE EXCEPTION 'Ambiguous player name; use existing spare search' USING ERRCODE='23505'; END IF;
 END IF;
 IF cardinality(v_ids)=1 THEN
 v_player:=v_ids[1];
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'replacements') x WHERE x->>'player_id'=v_player::text) THEN RAISE EXCEPTION 'Out replacement is not invite eligible' USING ERRCODE='42501'; END IF;
 SELECT public._captain_sub_role(p.position) INTO v_known_role FROM public.profiles p WHERE id=v_player AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Matching player unavailable' USING ERRCODE='42501'; END IF;
 IF v_known_role IS NULL THEN SELECT public._captain_sub_role(r.position::text) INTO v_known_role FROM public.team_rosters r WHERE r.player_id=v_player AND r.league_id=p_league_id AND r.position IS NOT NULL ORDER BY r.season_id=g.season_id DESC,r.start_date DESC,r.id LIMIT 1; END IF;
 IF v_known_role IS NULL THEN
 IF EXISTS(SELECT 1 FROM public.player_stats st JOIN public.games gm ON gm.id=st.game_id AND gm.league_id=st.league_id AND gm.season_id=st.season_id WHERE st.player_id=v_player AND gm.league_id=p_league_id AND gm.status::text='completed') THEN v_known_role:='skater';
 ELSIF EXISTS(SELECT 1 FROM public.goalie_stats st JOIN public.games gm ON gm.id=st.game_id AND gm.league_id=st.league_id AND gm.season_id=st.season_id WHERE st.player_id=v_player AND gm.league_id=p_league_id AND gm.status::text='completed') THEN v_known_role:='goalie'; END IF;
 END IF;
 IF v_target_role IS NOT NULL AND v_known_role IS NOT NULL AND v_known_role<>v_target_role THEN RAISE EXCEPTION 'Existing player role mismatch' USING ERRCODE='22023'; END IF;
 ELSE
 v_player:=gen_random_uuid();
 INSERT INTO captain_sub_private.guest_insert_capabilities(profile_id) VALUES(v_player);
 INSERT INTO public.profiles(id,email,full_name,jersey_number,role,is_legacy_import,created_at,updated_at) VALUES(v_player,'manual-spare+'||v_player::text||'@beerleaguehockey.local',v_name,p_manual_jersey,'player',true,statement_timestamp(),statement_timestamp());
 END IF;
 v_position:=coalesce(p_manual_position,CASE v_target_role WHEN 'goalie' THEN 'Goalie' WHEN 'skater' THEN 'Forward' END);
 IF p_save_to_team_spares AND NOT EXISTS(SELECT 1 FROM public.team_rosters r WHERE r.player_id=v_player AND r.team_id=p_team_id AND r.league_id=p_league_id AND r.season_id=g.season_id AND r.status::text='active' AND r.end_date IS NULL) THEN
 INSERT INTO public.team_rosters(player_id,team_id,league_id,season_id,position,jersey_number,status,player_type,leadership_role,notes) VALUES(v_player,p_team_id,p_league_id,g.season_id,v_position::public.player_position,p_manual_jersey,'active','sub',NULL,'Captain-added manual spare');
 END IF;
 SELECT jsonb_build_object('full_name',public._captain_sub_text(p.full_name,640),'email',public._captain_sub_text(p.email,512)) INTO candidate FROM public.profiles p WHERE p.id=v_player;
 v_source:='team';v_confirm:=true;
 ELSE
 IF p_manual_name IS NOT NULL OR p_manual_position IS NOT NULL OR p_manual_jersey IS NOT NULL OR p_save_to_team_spares THEN RAISE EXCEPTION 'Unexpected manual fields' USING ERRCODE='22023'; END IF;
 SELECT x INTO candidate FROM jsonb_array_elements(ctx->CASE WHEN p_kind='recent' THEN 'recent_players' ELSE 'candidates' END) x WHERE x->>'player_id'=v_player::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player is not an eligible role-matched spare' USING ERRCODE='42501'; END IF;
 v_source:=CASE WHEN p_kind='recent' THEN 'league' ELSE candidate->>'source' END; v_position:=candidate->>'position';
 END IF;
 PERFORM id FROM public.profiles WHERE id=v_player AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO inv FROM public.sub_invitations WHERE game_id=p_game_id AND invited_player_id=v_player FOR UPDATE;
 IF FOUND THEN
 IF inv.team_id<>p_team_id THEN RAISE EXCEPTION 'Player invited by another team' USING ERRCODE='23505'; END IF;
 IF inv.status='accepted' THEN v_outcome:='already_confirmed'; v_confirm:=true;
 ELSIF v_confirm THEN
 UPDATE public.sub_invitations SET status='accepted',responded_at=statement_timestamp(),updated_at=statement_timestamp(),replaced_player_id=coalesce(p_replaced_player_id,replaced_player_id) WHERE id=inv.id RETURNING * INTO inv; v_outcome:='confirmed';
 ELSE v_outcome:='already_pending';
 IF inv.status<>'pending' THEN RAISE EXCEPTION 'Existing invitation requires Mark In' USING ERRCODE='23505'; END IF;
 END IF;
 ELSE
 INSERT INTO public.sub_invitations(game_id,team_id,invited_by,invited_player_id,replaced_player_id,source_type,status,message,responded_at)
 VALUES(p_game_id,p_team_id,public._captain_sub_actor_id(),v_player,p_replaced_player_id,v_source,CASE WHEN v_confirm THEN 'accepted' ELSE 'pending' END,nullif(p_message,''),CASE WHEN v_confirm THEN statement_timestamp() END) RETURNING * INTO inv;
 v_outcome:=CASE WHEN v_confirm THEN 'confirmed' ELSE 'pending' END;
 END IF;
 IF v_confirm THEN
 IF EXISTS(SELECT 1 FROM public.game_checkins WHERE game_id=p_game_id AND player_id=v_player AND team_id<>p_team_id) THEN RAISE EXCEPTION 'Cross-team attendance conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO public.game_checkins(game_id,team_id,player_id,status,note,updated_at) VALUES(p_game_id,p_team_id,v_player,'confirmed','Captain confirmed replacement sub',statement_timestamp())
 ON CONFLICT(game_id,player_id) DO UPDATE SET status='confirmed',note=EXCLUDED.note,updated_at=EXCLUDED.updated_at WHERE public.game_checkins.team_id=EXCLUDED.team_id;
 IF NOT EXISTS(SELECT 1 FROM public.game_checkins WHERE game_id=p_game_id AND team_id=p_team_id AND player_id=v_player AND status='confirmed') THEN RAISE EXCEPTION 'Exact confirmed attendance conflict' USING ERRCODE='23505'; END IF;
 END IF;
 v_result:=jsonb_build_object('schema_version',1,'game_id',p_game_id,'team_id',p_team_id,'league_id',p_league_id,'season_id',g.season_id,'request_id',p_request_id,'outcome',v_outcome,
 'invitation',jsonb_build_object('id',inv.id,'player_id',inv.invited_player_id,'status',inv.status,'replaced_player_id',inv.replaced_player_id,'source',inv.source_type),
 'player',jsonb_build_object('player_id',v_player,'full_name',candidate->'full_name','email',candidate->'email','position',v_position),'checkin_status',CASE WHEN v_confirm THEN 'confirmed' END);
 IF octet_length(v_result::text)>16384 THEN RAISE EXCEPTION 'Receipt exceeds 16384 bytes' USING ERRCODE='54000'; END IF;
 INSERT INTO public.captain_sub_request_receipts(actor_id,request_id,payload,receipt) VALUES(public._captain_sub_actor_id(),p_request_id,payload,v_result);
 RETURN v_result;
END $fn$;
ALTER FUNCTION public.captain_manage_sub_invitation(uuid,uuid,uuid,uuid,text,uuid,uuid,text,boolean,text,text,integer,boolean) OWNER TO captain_sub_authority;
REVOKE ALL ON FUNCTION public.captain_manage_sub_invitation(uuid,uuid,uuid,uuid,text,uuid,uuid,text,boolean,text,text,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.captain_manage_sub_invitation(uuid,uuid,uuid,uuid,text,uuid,uuid,text,boolean,text,text,integer,boolean) TO authenticated;
REVOKE CREATE ON SCHEMA public FROM captain_sub_authority;
-- Restore creator membership without removing its original ADMIN option.
GRANT captain_sub_authority TO CURRENT_USER WITH INHERIT FALSE, SET FALSE;
COMMIT;
