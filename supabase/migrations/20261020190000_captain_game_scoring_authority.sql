BEGIN;
-- This migration is source-only. Hosted catalog/role/publication acceptance is
-- mandatory; the local fixture is not a deployed catalog certification.
DO $preflight$
DECLARE x record; actual regtype;
BEGIN
 -- Preflight every source-owned supporting name before creating any object.
 FOR x IN SELECT * FROM (VALUES
 ('_cs_game_events_game_idx','CREATE INDEX _cs_game_events_game_idx ON public.game_events USING btree (game_id)'),
 ('_cs_seasons_league_idx','CREATE INDEX _cs_seasons_league_idx ON public.seasons USING btree (league_id, id)'),
 ('_cs_events_client_id_idx','CREATE INDEX _cs_events_client_id_idx ON public.game_events USING btree (client_event_id)'),
 ('_cs_invitations_game_idx','CREATE INDEX _cs_invitations_game_idx ON public.sub_invitations USING btree (game_id, id)'),
 ('_cs_rosters_team_season_idx','CREATE INDEX _cs_rosters_team_season_idx ON public.team_rosters USING btree (team_id, season_id, id)'),
 ('_cs_goalie_stats_game_idx','CREATE INDEX _cs_goalie_stats_game_idx ON public.goalie_stats USING btree (game_id, player_id)'),
 ('_cs_player_stats_game_idx','CREATE INDEX _cs_player_stats_game_idx ON public.player_stats USING btree (game_id, player_id)'),
 ('_cs_game_stats_game_idx','CREATE INDEX _cs_game_stats_game_idx ON public.game_stats USING btree (game_id, player_id)'),
 ('_cs_availability_game_idx','CREATE INDEX _cs_availability_game_idx ON public.player_availability USING btree (game_id, player_id)')) v(n,definition) LOOP
 IF to_regclass('public.'||x.n) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.'||x.n) AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)=x.definition) THEN RAISE EXCEPTION 'Supporting index collision %',x.n; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='captain_scoring_authority') THEN RAISE EXCEPTION 'captain_scoring_authority collision'; END IF;
 -- The managed postgres deployment principal is NOSUPERUSER on hosted
 -- Supabase. A rollback-only CREATE ROLE witness is a release prerequisite;
 -- flags alone do not establish provider capability. The transactional
 -- CREATE ROLE below remains the final fail-closed primitive test.
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND
   (rolsuper OR (rolname='postgres' AND rolcreaterole AND rolbypassrls AND
     EXISTS(SELECT 1 FROM pg_roles managed WHERE managed.rolname='supabase_privileged_role'
       AND pg_has_role(current_user,managed.oid,'USAGE'))))) THEN
  RAISE EXCEPTION 'Migration requires a trusted superuser or managed postgres CREATEROLE BYPASSRLS principal; preflight hosted capabilities';
 END IF;
 FOR x IN SELECT * FROM (VALUES
 ('leagues','id','uuid'),('leagues','settings','jsonb'),('leagues','timezone','text'),
 ('teams','id','uuid'),('teams','league_id','uuid'),('teams','name','text'),('teams','logo_url','text'),
 ('seasons','id','uuid'),('seasons','league_id','uuid'),('seasons','status','public.season_status'),('seasons','start_date','date'),('seasons','created_at','timestamp with time zone'),
 ('profiles','id','uuid'),('profiles','full_name','text'),('profiles','deleted_at','timestamp with time zone'),
 ('games','id','uuid'),('games','league_id','uuid'),('games','season_id','uuid'),('games','home_team_id','uuid'),('games','away_team_id','uuid'),('games','scheduled_at','timestamp with time zone'),('games','status','public.game_status'),('games','updated_at','timestamp with time zone'),('games','home_score','integer'),('games','away_score','integer'),('games','game_started_at','timestamp with time zone'),('games','current_period','integer'),('games','stats_locked_at','timestamp with time zone'),('games','stats_submitted_at','timestamp with time zone'),('games','home_verified_at','timestamp with time zone'),('games','away_verified_at','timestamp with time zone'),('games','skater_capture_status','text'),
 ('game_events','id','uuid'),('game_events','game_id','uuid'),('game_events','league_id','uuid'),('game_events','team_id','uuid'),('game_events','player_id','uuid'),('game_events','assist1_player_id','uuid'),('game_events','assist2_player_id','uuid'),('game_events','goalie_in_net_id','uuid'),('game_events','entered_by','uuid'),('game_events','deleted_by','uuid'),('game_events','team_type','text'),('game_events','event_type','text'),('game_events','client_event_id','text'),('game_events','sync_status','text'),('game_events','penalty_type','text'),('game_events','event_version','integer'),('game_events','period','integer'),('game_events','game_time_seconds','integer'),('game_events','penalty_minutes','integer'),('game_events','is_power_play','boolean'),('game_events','is_short_handed','boolean'),('game_events','is_empty_net','boolean'),('game_events','is_gwg','boolean'),('game_events','created_offline','boolean'),('game_events','entered_at','timestamp with time zone'),('game_events','updated_at','timestamp with time zone'),('game_events','deleted_at','timestamp with time zone'),
 ('game_checkins','id','uuid'),('game_checkins','game_id','uuid'),('game_checkins','team_id','uuid'),('game_checkins','player_id','uuid'),('game_checkins','status','text'),('game_checkins','updated_at','timestamp with time zone'),
 ('player_availability','game_id','uuid'),('player_availability','team_id','uuid'),('player_availability','player_id','uuid'),('player_availability','season_id','uuid'),('player_availability','status','text'),
 ('sub_invitations','id','uuid'),('sub_invitations','game_id','uuid'),('sub_invitations','team_id','uuid'),('sub_invitations','invited_player_id','uuid'),('sub_invitations','status','text'),
 ('team_rosters','id','uuid'),('team_rosters','player_id','uuid'),('team_rosters','team_id','uuid'),('team_rosters','league_id','uuid'),('team_rosters','season_id','uuid'),('team_rosters','player_type','text'),('team_rosters','status','public.roster_status'),('team_rosters','leadership_role','public.leadership_role'),('team_rosters','start_date','date'),('team_rosters','end_date','date'),('team_rosters','position','public.player_position'),('team_rosters','jersey_number','integer'),
 ('game_stats','game_id','uuid'),('game_stats','team_id','uuid'),('game_stats','player_id','uuid'),
 ('player_stats','game_id','uuid'),('player_stats','team_id','uuid'),('player_stats','player_id','uuid'),
 ('goalie_stats','game_id','uuid'),('goalie_stats','team_id','uuid'),('goalie_stats','player_id','uuid'),
 ('game_goalie_appearances','game_id','uuid'),('game_goalie_appearances','team_id','uuid'),('game_goalie_appearances','player_id','uuid')) v(t,c,typ)
 LOOP
  SELECT a.atttypid::regtype INTO actual FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||x.t) AND a.attname=x.c AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM x.typ::regtype THEN RAISE EXCEPTION 'Physical schema mismatch %.% expected % got %',x.t,x.c,x.typ,actual; END IF;
 END LOOP;
 FOR x IN SELECT * FROM (VALUES
 ('leagues','id',true),
 ('teams','id',true),
 ('teams','league_id',true),
 ('seasons','id',true),
 ('seasons','league_id',true),
 ('profiles','id',true),
 ('games','id',true),
 ('games','league_id',true),
 ('games','season_id',true),
 ('games','home_team_id',true),
 ('games','away_team_id',true),
 ('games','scheduled_at',true),
 ('game_events','id',true),
 ('game_events','game_id',true),
 ('game_events','league_id',true),
 ('game_events','team_id',true),
 ('game_events','team_type',true),
 ('game_events','event_type',true),
 ('game_events','event_version',true),
 ('game_events','entered_at',true),
 ('game_events','entered_by',true),
 ('game_events','client_event_id',true),
 ('game_events','sync_status',true),
 ('game_events','created_offline',true),
 ('game_checkins','id',true),
 ('game_checkins','game_id',true),
 ('game_checkins','team_id',true),
 ('game_checkins','player_id',true),
 ('game_checkins','status',true),
 ('player_availability','game_id',true),
 ('player_availability','team_id',true),
 ('player_availability','season_id',true),
 ('player_availability','player_id',true),
 ('sub_invitations','id',true),
 ('sub_invitations','game_id',true),
 ('sub_invitations','team_id',true),
 ('sub_invitations','status',true),
 ('team_rosters','id',true),
 ('team_rosters','player_id',true),
 ('team_rosters','team_id',true),
 ('team_rosters','season_id',true),
 ('team_rosters','league_id',true),
 ('team_rosters','start_date',true),
 ('team_rosters','status',true),
 ('team_rosters','player_type',true),
 ('game_stats','game_id',true),
 ('game_stats','team_id',true),
 ('game_stats','player_id',true),
 ('player_stats','game_id',true),
 ('player_stats','team_id',true),
 ('player_stats','player_id',true),
 ('goalie_stats','game_id',true),
 ('goalie_stats','team_id',true),
 ('goalie_stats','player_id',true),
 ('game_goalie_appearances','game_id',true),
 ('game_goalie_appearances','team_id',true),
 ('game_goalie_appearances','player_id',true),
 ('game_events','player_id',false),
 ('game_events','assist1_player_id',false),
 ('game_events','assist2_player_id',false),
 ('game_events','period',false),
 ('game_events','game_time_seconds',false),
 ('game_events','goalie_in_net_id',false),
 ('game_events','penalty_minutes',false),
 ('game_events','penalty_type',false),
 ('game_events','deleted_by',false),
 ('game_events','deleted_at',false)) v(t,c,nn) LOOP
 IF (SELECT attnotnull FROM pg_attribute WHERE attrelid=to_regclass('public.'||x.t) AND attname=x.c AND NOT attisdropped) IS DISTINCT FROM x.nn THEN RAISE EXCEPTION 'Physical nullability mismatch %.%',x.t,x.c; END IF;
 END LOOP;

 IF NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.game_checkins'::regclass AND a.attname='id' AND pg_get_expr(d.adbin,d.adrelid) IN('gen_random_uuid()','pg_catalog.gen_random_uuid()')) THEN RAISE EXCEPTION 'Consumed default mismatch game_checkins.id'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.game_events'::regclass AND contype IN('p','u') AND convalidated AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.game_events'::regclass AND attname='id')]::smallint[]) THEN RAISE EXCEPTION 'Consumed unique key mismatch game_events.id'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.game_checkins'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (game_id, player_id)') THEN RAISE EXCEPTION 'Exact checkin upsert key missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.game_events'::regclass AND a.attname='event_version' AND pg_get_expr(d.adbin,d.adrelid)='1') THEN RAISE EXCEPTION 'Event version default mismatch'; END IF;
 -- Finite consumed CHECK manifest. Unknown predicates touching event writes
 -- are unsupported catalog shapes, not silently inferred permissions.
 FOR x IN SELECT pg_get_expr(conbin,conrelid) expression,convalidated FROM pg_constraint WHERE contype='c' AND conrelid='public.game_events'::regclass LOOP
 IF NOT x.convalidated OR x.expression NOT IN (
  $check$(event_type = ANY (ARRAY['goal'::text, 'assist'::text, 'penalty'::text, 'save'::text, 'shot'::text, 'period_start'::text, 'period_end'::text]))$check$,
  $check$((penalty_severity IS NULL) OR (penalty_severity = ANY (ARRAY['minor'::text, 'double_minor'::text, 'major'::text, 'misconduct'::text, 'game_misconduct'::text, 'match'::text])))$check$,
  $check$((period >= 1) AND (period <= 5))$check$,
  $check$((shot_type IS NULL) OR (shot_type = ANY (ARRAY['wrist'::text, 'slap'::text, 'snap'::text, 'backhand'::text, 'tip'::text, 'wrap_around'::text, 'deflection'::text, 'other'::text])))$check$,
  $check$(sync_status = ANY (ARRAY['pending'::text, 'syncing'::text, 'synced'::text, 'conflict'::text]))$check$,
  $check$(team_type = ANY (ARRAY['home'::text, 'away'::text]))$check$) THEN RAISE EXCEPTION 'Consumed check mismatch game_events'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.game_events'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=$check$(team_type = ANY (ARRAY['home'::text, 'away'::text]))$check$) THEN RAISE EXCEPTION 'Consumed check mismatch game_events.team_type'; END IF;
 FOR x IN SELECT unnest(ARRAY[$check$(event_type = ANY (ARRAY['goal'::text, 'assist'::text, 'penalty'::text, 'save'::text, 'shot'::text, 'period_start'::text, 'period_end'::text]))$check$,$check$((penalty_severity IS NULL) OR (penalty_severity = ANY (ARRAY['minor'::text, 'double_minor'::text, 'major'::text, 'misconduct'::text, 'game_misconduct'::text, 'match'::text])))$check$,$check$((period >= 1) AND (period <= 5))$check$,$check$((shot_type IS NULL) OR (shot_type = ANY (ARRAY['wrist'::text, 'slap'::text, 'snap'::text, 'backhand'::text, 'tip'::text, 'wrap_around'::text, 'deflection'::text, 'other'::text])))$check$,$check$(sync_status = ANY (ARRAY['pending'::text, 'syncing'::text, 'synced'::text, 'conflict'::text]))$check$]) expression LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.game_events'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=x.expression) THEN RAISE EXCEPTION 'Consumed check missing game_events %',x.expression; END IF;
 END LOOP;
 -- Only predicates intersecting the consumed games surface are certified;
 -- unrelated legacy game columns/constraints are deliberately out of scope.
 FOR x IN SELECT pg_get_expr(c.conbin,c.conrelid) expression,c.convalidated FROM pg_constraint c WHERE c.contype='c' AND c.conrelid='public.games'::regclass AND (coalesce(cardinality(c.conkey),0)=0 OR EXISTS(SELECT 1 FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k WHERE a.attname IN('id','league_id','season_id','home_team_id','away_team_id','scheduled_at','status','updated_at','home_score','away_score','game_started_at','current_period','stats_locked_at','stats_submitted_at','home_verified_at','away_verified_at','skater_capture_status'))) LOOP
 IF NOT x.convalidated OR x.expression NOT IN (
  $check$(home_team_id <> away_team_id)$check$,
  $check$(away_score >= 0)$check$,
  $check$(home_score >= 0)$check$,
  $check$((skater_capture_status IS NULL) OR (skater_capture_status = ANY (ARRAY['complete'::text, 'not_recorded'::text])))$check$) THEN RAISE EXCEPTION 'Consumed check mismatch games'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.games'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=$check$((skater_capture_status IS NULL) OR (skater_capture_status = ANY (ARRAY['complete'::text, 'not_recorded'::text])))$check$) THEN RAISE EXCEPTION 'Consumed check mismatch games.skater_capture_status'; END IF;
 FOR x IN SELECT unnest(ARRAY[$check$(home_team_id <> away_team_id)$check$,$check$(away_score >= 0)$check$,$check$(home_score >= 0)$check$]) expression LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.games'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=x.expression) THEN RAISE EXCEPTION 'Consumed check missing games %',x.expression; END IF;
 END LOOP;
 -- Certify the captured vocabulary exactly; unknown/unvalidated consumed
 -- restrictions are unsupported, never silently ignored or dropped.
 FOR x IN SELECT pg_get_expr(c.conbin,c.conrelid) expression,c.convalidated FROM pg_constraint c WHERE c.contype='c' AND c.conrelid='public.player_availability'::regclass AND (coalesce(cardinality(c.conkey),0)=0 OR EXISTS(SELECT 1 FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k WHERE a.attname IN('game_id','team_id','season_id','player_id','status'))) LOOP
 IF NOT x.convalidated OR x.expression<>$check$(status = ANY (ARRAY['available'::text, 'unavailable'::text, 'maybe'::text, 'injured'::text]))$check$ THEN RAISE EXCEPTION 'Consumed check mismatch player_availability'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.player_availability'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=$check$(status = ANY (ARRAY['available'::text, 'unavailable'::text, 'maybe'::text, 'injured'::text]))$check$) THEN RAISE EXCEPTION 'Consumed check missing player_availability.status'; END IF;
 -- Finite enum label sets consumed by lifecycle/authority/roster projection.
 -- Order is not consumed (all election precedence is explicit), so compare sets.
 FOR x IN SELECT * FROM (VALUES
 ('game_status',ARRAY['scheduled','in_progress','completed','pending_verification','cancelled','postponed']),
 ('season_status',ARRAY['active','playoffs','completed','draft','archived']),
 ('roster_status',ARRAY['active','inactive','suspended','injured','traded']),
 ('leadership_role',ARRAY['captain','alternate_captain']),
 ('player_position',ARRAY['Forward','Defense','Goalie'])) v(n,labels) LOOP
 IF (SELECT array_agg(enumlabel::text ORDER BY enumlabel::text COLLATE "C") FROM pg_enum WHERE enumtypid=to_regtype('public.'||x.n)) IS DISTINCT FROM (SELECT array_agg(v ORDER BY v COLLATE "C") FROM unnest(x.labels) v) THEN RAISE EXCEPTION 'Consumed enum mismatch %',x.n; END IF;
 END LOOP;
 -- Native INSERT supplies every semantic event value explicitly except
 -- deletion markers, whose omitted values must remain NULL. Games/availability
 -- defaults are not consumed: native updates games and never writes availability.
 FOR x IN SELECT * FROM (VALUES ('deleted_at','NULL::timestamp with time zone'),('deleted_by','NULL::uuid')) v(c,allowed) LOOP
 IF EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.game_events'::regclass AND a.attname=x.c AND pg_get_expr(d.adbin,d.adrelid)<>x.allowed) THEN RAISE EXCEPTION 'Consumed default mismatch game_events.%',x.c; END IF;
 END LOOP;
 -- Existing key indexes consumed by identity joins, ON CONFLICT and
 -- ordered cap probes must be immediately enforceable, ready and valid.
 FOR x IN SELECT * FROM (VALUES
 ('leagues',ARRAY['id']),('teams',ARRAY['id']),('seasons',ARRAY['id']),('profiles',ARRAY['id']),('games',ARRAY['id']),('team_rosters',ARRAY['id']),('sub_invitations',ARRAY['id']),('game_events',ARRAY['id']),('game_checkins',ARRAY['game_id','player_id']),('game_goalie_appearances',ARRAY['game_id','player_id'])) v(t,cols) LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam WHERE i.indrelid=to_regclass('public.'||x.t) AND i.indisunique AND i.indimmediate AND i.indisready AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree' AND (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(i.indkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE k.n<=i.indnkeyatts)=x.cols) THEN RAISE EXCEPTION 'Consumed index mismatch %',x.t; END IF;
 END LOOP;
 FOR x IN SELECT pg_get_expr(conbin,conrelid) expression,convalidated FROM pg_constraint WHERE contype='c' AND conrelid='public.game_checkins'::regclass LOOP
 IF NOT x.convalidated OR x.expression<>$check$(status = ANY (ARRAY['confirmed'::text, 'tentative'::text, 'out'::text]))$check$ THEN RAISE EXCEPTION 'Consumed check mismatch game_checkins'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='c' AND conrelid='public.game_checkins'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)=$check$(status = ANY (ARRAY['confirmed'::text, 'tentative'::text, 'out'::text]))$check$) THEN RAISE EXCEPTION 'Consumed check mismatch game_checkins.status'; END IF;
 -- Validate referenced key relationships, including members of composite FKs.
 -- Do not rewrite or normalize existing FK delete actions.
 FOR x IN SELECT * FROM (VALUES
 ('teams','league_id','leagues'),
 ('seasons','league_id','leagues'),
 ('games','league_id','leagues'),
 ('games','season_id','seasons'),
 ('games','home_team_id','teams'),
 ('games','away_team_id','teams'),
 ('game_events','game_id','games'),
 ('game_events','league_id','leagues'),
 ('game_events','team_id','teams'),
 ('game_events','player_id','profiles'),
 ('game_events','assist1_player_id','profiles'),
 ('game_events','assist2_player_id','profiles'),
 ('game_events','goalie_in_net_id','profiles'),
 ('game_events','entered_by','profiles'),
 ('game_events','deleted_by','profiles'),
 ('game_checkins','game_id','games'),
 ('game_checkins','team_id','teams'),
 ('game_checkins','player_id','profiles'),
 ('player_availability','game_id','games'),
 ('player_availability','team_id','teams'),
 ('player_availability','player_id','profiles'),
 ('player_availability','season_id','seasons'),
 ('sub_invitations','game_id','games'),
 ('sub_invitations','team_id','teams'),
 ('sub_invitations','invited_player_id','profiles'),
 ('team_rosters','player_id','profiles'),
 ('team_rosters','team_id','teams'),
 ('team_rosters','league_id','leagues'),
 ('team_rosters','season_id','seasons'),
 ('game_stats','game_id','games'),
 ('game_stats','team_id','teams'),
 ('game_stats','player_id','profiles'),
 ('player_stats','game_id','games'),
 ('player_stats','team_id','teams'),
 ('player_stats','player_id','profiles'),
 ('goalie_stats','game_id','games'),
 ('goalie_stats','team_id','teams'),
 ('goalie_stats','player_id','profiles'),
 ('game_goalie_appearances','game_id','games'),
 ('game_goalie_appearances','team_id','teams'),
 ('game_goalie_appearances','player_id','profiles')) v(t,c,parent) LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN LATERAL unnest(f.conkey,f.confkey) AS k(child_num,parent_num) ON true JOIN pg_attribute ca ON ca.attrelid=f.conrelid AND ca.attnum=k.child_num JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.parent_num WHERE f.contype='f' AND f.convalidated AND f.conrelid=to_regclass('public.'||x.t) AND f.confrelid=to_regclass('public.'||x.parent) AND ca.attname=x.c AND pa.attname='id') THEN RAISE EXCEPTION 'Consumed foreign key mismatch %.%',x.t,x.c; END IF;
 END LOOP;
 IF to_regprocedure('public.captain_get_game_scoring_context(jsonb)') IS NOT NULL OR to_regprocedure('public.captain_manage_game_scoring(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'RPC collision'; END IF;
END $preflight$;
CREATE INDEX IF NOT EXISTS _cs_game_events_game_idx ON public.game_events(game_id);
CREATE INDEX IF NOT EXISTS _cs_seasons_league_idx ON public.seasons(league_id,id);
CREATE INDEX IF NOT EXISTS _cs_availability_game_idx ON public.player_availability(game_id,player_id);
CREATE INDEX IF NOT EXISTS _cs_game_stats_game_idx ON public.game_stats(game_id,player_id);
CREATE INDEX IF NOT EXISTS _cs_player_stats_game_idx ON public.player_stats(game_id,player_id);
CREATE INDEX IF NOT EXISTS _cs_goalie_stats_game_idx ON public.goalie_stats(game_id,player_id);
CREATE INDEX IF NOT EXISTS _cs_rosters_team_season_idx ON public.team_rosters(team_id,season_id,id);
CREATE INDEX IF NOT EXISTS _cs_invitations_game_idx ON public.sub_invitations(game_id,id);
CREATE INDEX IF NOT EXISTS _cs_events_client_id_idx ON public.game_events(client_event_id);
CREATE ROLE captain_scoring_authority NOLOGIN BYPASSRLS;
-- CREATEROLE grants ADMIN, not SET, on PostgreSQL 17. Permit only this trusted
-- deployer to transfer ownership inside this transaction; never app roles.
GRANT captain_scoring_authority TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
GRANT USAGE,CREATE ON SCHEMA public TO captain_scoring_authority;
-- The deployer cannot regrant auth-schema USAGE. Delegate only identity,
-- with unchanged auth.uid() semantics and no table or mutation authority.
CREATE FUNCTION public._cs_actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT auth.uid() $f$;
GRANT SELECT ON public.leagues,public.teams,public.seasons,public.profiles,public.team_rosters,public.sub_invitations,public.games,public.game_events,public.game_checkins,public.player_availability,public.game_stats,public.player_stats,public.goalie_stats,public.game_goalie_appearances TO captain_scoring_authority;
GRANT UPDATE ON public.games TO captain_scoring_authority;
-- UPDATE permission is required for SELECT FOR SHARE; no app-role grant changes.
GRANT UPDATE(id) ON public.leagues,public.teams,public.seasons,public.profiles,public.team_rosters,public.sub_invitations TO captain_scoring_authority;
CREATE TABLE public.captain_game_scoring_state(game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),created_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE TABLE public.captain_game_scoring_presence(game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,team_id uuid NOT NULL,player_id uuid NOT NULL,version integer NOT NULL DEFAULT 0 CHECK(version>=0),PRIMARY KEY(game_id,team_id,player_id));
CREATE TABLE public.captain_game_scoring_commentary(game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,team_id uuid NOT NULL,text text NOT NULL DEFAULT '' CHECK(length(text)<=2000 AND octet_length(text)<=8000),version integer NOT NULL DEFAULT 0 CHECK(version>=0),updated_by uuid,updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),PRIMARY KEY(game_id,team_id));
CREATE TABLE public.captain_game_scoring_requests(actor_id uuid NOT NULL,request_id uuid NOT NULL,payload jsonb NOT NULL,terminal jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),PRIMARY KEY(actor_id,request_id));
ALTER TABLE public.captain_game_scoring_state OWNER TO captain_scoring_authority;
ALTER TABLE public.captain_game_scoring_presence OWNER TO captain_scoring_authority;
ALTER TABLE public.captain_game_scoring_commentary OWNER TO captain_scoring_authority;
ALTER TABLE public.captain_game_scoring_requests OWNER TO captain_scoring_authority;
ALTER TABLE public.captain_game_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captain_game_scoring_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captain_game_scoring_commentary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captain_game_scoring_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captain_game_scoring_state,public.captain_game_scoring_presence,public.captain_game_scoring_commentary,public.captain_game_scoring_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._cs_text(t text,chars integer,bytes integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
BEGIN IF length(t)>chars OR octet_length(t)>bytes THEN RAISE EXCEPTION 'text_bound_exceeded'; END IF; RETURN t; END $f$;
CREATE FUNCTION public._cs_bounds(g public.games,t uuid) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $f$
BEGIN
 IF (SELECT count(*) FROM (SELECT 1 FROM public.game_events WHERE game_id=g.id LIMIT 4001)x)>4000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.game_checkins WHERE game_id=g.id ORDER BY player_id LIMIT 401)x)>400 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.player_availability WHERE game_id=g.id ORDER BY player_id LIMIT 401)x)>400 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.sub_invitations WHERE game_id=g.id ORDER BY id LIMIT 1001)x)>1000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.team_rosters WHERE team_id=t AND season_id=g.season_id ORDER BY id LIMIT 1001)x)>1000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.seasons WHERE league_id=g.league_id ORDER BY id LIMIT 257)x)>256 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.game_stats WHERE game_id=g.id ORDER BY player_id LIMIT 2001)x)>2000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.player_stats WHERE game_id=g.id ORDER BY player_id LIMIT 2001)x)>2000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.goalie_stats WHERE game_id=g.id ORDER BY player_id LIMIT 2001)x)>2000 OR
 (SELECT count(*) FROM (SELECT 1 FROM public.game_goalie_appearances WHERE game_id=g.id ORDER BY player_id LIMIT 2001)x)>2000 THEN RAISE EXCEPTION 'row_bound_exceeded'; END IF;
END $f$;
CREATE FUNCTION public._cs_scope(q jsonb,p_lock boolean DEFAULT false) RETURNS public.games LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g public.games%ROWTYPE;s uuid;z text; k text;
BEGIN
 IF public._cs_actor_id() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR q->'schema_version' IS DISTINCT FROM '1'::jsonb OR octet_length(q::text)>16384 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['request_id','game_id','team_id','league_id'] LOOP
 IF jsonb_typeof(q->k) IS DISTINCT FROM 'string' OR q->>k !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid UUID' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT * INTO g FROM public.games WHERE id=(q->>'game_id')::uuid;
 IF NOT FOUND OR g.league_id IS DISTINCT FROM (q->>'league_id')::uuid OR (q->>'team_id')::uuid NOT IN(g.home_team_id,g.away_team_id) THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='42501'; END IF;
 -- Initial operational-season election must also be bounded, not only locked fanout.
 PERFORM public._cs_bounds(g,(q->>'team_id')::uuid);
 IF p_lock THEN
 -- Bound source cardinality before locking authority dependencies or aggregating facts.
 PERFORM public._cs_bounds(g,(q->>'team_id')::uuid);
 PERFORM id FROM public.leagues WHERE id=g.league_id FOR SHARE;
 PERFORM id FROM public.teams WHERE id IN(g.home_team_id,g.away_team_id) ORDER BY id FOR SHARE;
 PERFORM id FROM public.seasons WHERE league_id=g.league_id ORDER BY id FOR SHARE;
 PERFORM id FROM public.profiles WHERE id=public._cs_actor_id() FOR SHARE;
 PERFORM id FROM public.team_rosters WHERE team_id=(q->>'team_id')::uuid AND league_id=g.league_id AND season_id=g.season_id ORDER BY id FOR SHARE;
 PERFORM id FROM public.sub_invitations WHERE game_id=g.id ORDER BY id FOR SHARE;
 END IF;
 SELECT timezone INTO z FROM public.leagues WHERE id=g.league_id AND (settings->'self_scorekeeper_enabled'='true'::jsonb OR settings->>'scorekeepingMode'='self_scorekeeping' OR settings->>'statEntryMode'='captain');
 IF z IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=z) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=g.home_team_id AND league_id=g.league_id) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=g.away_team_id AND league_id=g.league_id) THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT id INTO s FROM public.seasons WHERE league_id=g.league_id AND status::text IN('active','playoffs') ORDER BY CASE status::text WHEN 'active' THEN 0 ELSE 1 END,start_date DESC NULLS LAST,created_at DESC NULLS LAST,id LIMIT 1;
 IF s IS DISTINCT FROM g.season_id OR NOT EXISTS(SELECT 1 FROM public.team_rosters r JOIN public.profiles p ON p.id=r.player_id AND p.deleted_at IS NULL WHERE r.player_id=public._cs_actor_id() AND r.team_id=(q->>'team_id')::uuid AND r.league_id=g.league_id AND r.season_id=s AND r.player_type='regular' AND r.status::text='active' AND r.end_date IS NULL AND r.start_date<=(statement_timestamp() AT TIME ZONE z)::date AND r.leadership_role::text IN('captain','alternate_captain')) THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN g;
END $f$;
CREATE FUNCTION public._cs_credited(g uuid,p uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN RETURN EXISTS(SELECT 1 FROM public.game_events WHERE game_id=g AND deleted_at IS NULL AND p IN(player_id,assist1_player_id,assist2_player_id,goalie_in_net_id)) OR EXISTS(SELECT 1 FROM public.game_stats WHERE game_id=g AND player_id=p) OR EXISTS(SELECT 1 FROM public.player_stats WHERE game_id=g AND player_id=p) OR EXISTS(SELECT 1 FROM public.goalie_stats WHERE game_id=g AND player_id=p) OR EXISTS(SELECT 1 FROM public.game_goalie_appearances WHERE game_id=g AND player_id=p); END
$f$;
CREATE FUNCTION public._cs_snapshot(g public.games,t uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $f$
DECLARE roster jsonb;goals jsonb;note jsonb;reason text;hs integer;aws integer;z text;r jsonb;ids uuid[];sources text[];positions text[];jerseys integer[];
BEGIN
 IF g.status IS NULL OR g.status::text NOT IN('scheduled','in_progress') THEN RAISE EXCEPTION 'lifecycle_unavailable'; END IF;
 PERFORM public._cs_bounds(g,t);
 IF EXISTS(SELECT 1 FROM public.game_checkins c JOIN public.team_rosters r ON r.player_id=c.player_id AND r.team_id=t AND r.league_id=g.league_id AND r.season_id=g.season_id AND r.status::text='active' AND r.end_date IS NULL WHERE c.game_id=g.id AND c.team_id<>t) THEN RAISE EXCEPTION 'scope_unavailable'; END IF;
 SELECT public._cs_text(timezone,128,128) INTO z FROM public.leagues WHERE id=g.league_id;
 IF EXISTS(SELECT 1 FROM public.game_events e WHERE e.game_id=g.id AND (e.league_id<>g.league_id OR e.team_id NOT IN(g.home_team_id,g.away_team_id) OR e.team_type IS DISTINCT FROM CASE WHEN e.team_id=g.home_team_id THEN 'home' ELSE 'away' END OR e.event_version<1)) OR EXISTS(SELECT 1 FROM public.game_checkins c WHERE c.game_id=g.id AND (c.team_id NOT IN(g.home_team_id,g.away_team_id) OR c.status NOT IN('confirmed','tentative','out'))) OR EXISTS(SELECT 1 FROM public.player_availability a WHERE a.game_id=g.id AND (a.season_id<>g.season_id OR a.team_id NOT IN(g.home_team_id,g.away_team_id))) OR EXISTS(SELECT 1 FROM public.player_availability WHERE game_id=g.id GROUP BY player_id HAVING count(*)>1) THEN RAISE EXCEPTION 'scope_unavailable'; END IF;
 SELECT count(*) FILTER(WHERE team_id=g.home_team_id),count(*) FILTER(WHERE team_id=g.away_team_id) INTO hs,aws FROM public.game_events WHERE game_id=g.id AND event_type='goal' AND deleted_at IS NULL;
 reason:=CASE WHEN g.status::text='scheduled' AND g.scheduled_at>statement_timestamp() THEN 'future_game' WHEN g.stats_locked_at IS NOT NULL THEN 'stats_locked' WHEN g.skater_capture_status='complete' OR g.stats_submitted_at IS NOT NULL OR g.home_verified_at IS NOT NULL OR g.away_verified_at IS NOT NULL THEN 'capture_complete' WHEN (g.home_score IS NOT NULL AND g.home_score<>hs) OR (g.away_score IS NOT NULL AND g.away_score<>aws) THEN 'legacy_score_mismatch' END;
 WITH sources AS (
 SELECT r.player_id,CASE WHEN r.player_type='regular' THEN 'regular' ELSE 'team_spare' END source,r.position::text position,r.jersey_number,0 priority FROM public.team_rosters r WHERE r.team_id=t AND r.league_id=g.league_id AND r.season_id=g.season_id AND r.status::text='active' AND r.end_date IS NULL AND r.start_date<=(statement_timestamp() AT TIME ZONE z)::date AND r.player_type IN('regular','sub','part_time')
 UNION ALL SELECT invited_player_id,'accepted_sub',NULL,NULL,1 FROM public.sub_invitations WHERE game_id=g.id AND team_id=t AND status='accepted'
 UNION ALL SELECT unnest(ARRAY[player_id,assist1_player_id,assist2_player_id]),'credited_only',NULL,NULL,2 FROM public.game_events WHERE game_id=g.id AND team_id=t AND deleted_at IS NULL
 UNION ALL SELECT player_id,'credited_only',NULL,NULL,2 FROM public.game_stats WHERE game_id=g.id AND team_id=t
 UNION ALL SELECT player_id,'credited_only',NULL,NULL,2 FROM public.player_stats WHERE game_id=g.id AND team_id=t
 UNION ALL SELECT player_id,'credited_only',NULL,NULL,2 FROM public.goalie_stats WHERE game_id=g.id AND team_id=t
 UNION ALL SELECT player_id,'credited_only',NULL,NULL,2 FROM public.game_goalie_appearances WHERE game_id=g.id AND team_id=t),
 picked AS(SELECT DISTINCT ON(player_id) * FROM sources WHERE player_id IS NOT NULL ORDER BY player_id,priority,source,position NULLS LAST,jersey_number NULLS LAST)
 SELECT array_agg(player_id ORDER BY player_id),array_agg(source ORDER BY player_id),array_agg(position ORDER BY player_id),array_agg(jersey_number ORDER BY player_id) INTO ids,sources,positions,jerseys FROM (SELECT * FROM picked ORDER BY player_id LIMIT 201) bounded;
 IF coalesce(cardinality(ids),0)>200 OR hs>1000 OR aws>1000 THEN RAISE EXCEPTION 'row_bound_exceeded'; END IF;
 WITH rows AS(SELECT s.*,p.full_name,c.status,coalesce(v.version,0) pv,public._cs_credited(g.id,s.player_id) credit,
 CASE WHEN a.status='available' THEN 'none' WHEN a.status IN('unavailable','injured') AND c.status='confirmed' THEN 'conflict' WHEN a.status IN('unavailable','injured') THEN 'out' WHEN a.status IS NOT NULL THEN 'unknown' ELSE 'none' END av,
 (s.source<>'credited_only' AND p.deleted_at IS NULL AND c.team_id=t AND c.status='confirmed' AND (a.status IS NULL OR a.status='available')) IS TRUE eligible
 FROM unnest(ids,sources,positions,jerseys) s(player_id,source,position,jersey_number) LEFT JOIN public.profiles p ON p.id=s.player_id LEFT JOIN public.game_checkins c ON c.game_id=g.id AND c.player_id=s.player_id LEFT JOIN public.captain_game_scoring_presence v ON v.game_id=g.id AND v.team_id=t AND v.player_id=s.player_id LEFT JOIN public.player_availability a ON a.game_id=g.id AND a.player_id=s.player_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'full_name',public._cs_text(full_name,160,640),'jersey_number',jersey_number,'position',public._cs_text(position,128,512),'source',source,'checkin_status',status,'presence_version',pv,'state',CASE WHEN eligible THEN 'checked_in' WHEN credit THEN 'credited_not_eligible' WHEN status='out' THEN 'scratched' WHEN status='tentative' THEN 'tentative' WHEN status IS NULL THEN 'waiting' WHEN status='confirmed' AND av IN('out','unknown','conflict') THEN 'unavailable' ELSE 'waiting' END,'eligible_for_goal',eligible,'has_credited_stats',credit,'availability_state',av,'blocking_goal_ids',(SELECT coalesce(jsonb_agg(e.id ORDER BY e.entered_at,e.id),'[]') FROM public.game_events e WHERE e.game_id=g.id AND e.team_id=t AND e.event_type='goal' AND e.deleted_at IS NULL AND rows.player_id IN(e.player_id,e.assist1_player_id,e.assist2_player_id))) ORDER BY full_name NULLS LAST,player_id),'[]') INTO roster FROM rows;
 IF jsonb_array_length(roster)>200 OR hs>1000 OR aws>1000 THEN RAISE EXCEPTION 'row_bound_exceeded'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('event_id',e.id,'event_version',e.event_version,'team_id',e.team_id,'scorer_id',e.player_id,'assist1_id',e.assist1_player_id,'assist2_id',e.assist2_player_id,'entered_at',e.entered_at,'can_edit',reason IS NULL AND e.player_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[e.player_id,e.assist1_player_id,e.assist2_player_id]) pid WHERE pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) rp WHERE (rp->>'player_id')::uuid=pid AND (rp->>'eligible_for_goal')::boolean)),'blocked_reason',CASE WHEN e.player_id IS NULL THEN 'legacy_unattributed' WHEN reason='capture_complete' THEN 'capture_complete' WHEN EXISTS(SELECT 1 FROM unnest(ARRAY[e.player_id,e.assist1_player_id,e.assist2_player_id]) pid WHERE pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) rp WHERE (rp->>'player_id')::uuid=pid AND (rp->>'eligible_for_goal')::boolean)) THEN 'not_checked_in' ELSE NULL END) ORDER BY e.entered_at,e.id),'[]') INTO goals FROM public.game_events e WHERE e.game_id=g.id AND e.team_id=t AND e.event_type='goal' AND e.deleted_at IS NULL;
 SELECT jsonb_build_object('text',text,'version',version) INTO note FROM public.captain_game_scoring_commentary WHERE game_id=g.id AND team_id=t;
 r:=jsonb_build_object('season_id',g.season_id,'revision',coalesce((SELECT revision::text FROM public.captain_game_scoring_state WHERE game_id=g.id),'0'),'server_time',statement_timestamp(),'complete',true,'game',jsonb_build_object('status',g.status,'scheduled_at',g.scheduled_at,'game_started_at',g.game_started_at,'own_team_type',CASE WHEN t=g.home_team_id THEN 'home' ELSE 'away' END,'home_team_id',g.home_team_id,'away_team_id',g.away_team_id,'home_team_name',(SELECT public._cs_text(name,160,640) FROM public.teams WHERE id=g.home_team_id),'away_team_name',(SELECT public._cs_text(name,160,640) FROM public.teams WHERE id=g.away_team_id),'home_score',hs,'away_score',aws,'timezone',z,'home_team_logo_url',(SELECT public._cs_text(logo_url,2048,2048) FROM public.teams WHERE id=g.home_team_id),'away_team_logo_url',(SELECT public._cs_text(logo_url,2048,2048) FROM public.teams WHERE id=g.away_team_id)),'permissions',jsonb_build_object('can_add_goal',reason IS NULL,'can_correct_goal',reason IS NULL,'can_manage_roster',reason IS NULL,'can_comment',reason IS NULL,'blocked_reason',reason),'own_goals',goals,'roster',roster,'commentary',coalesce(note,'{"text":"","version":0}'::jsonb),'counts',jsonb_build_object('own_goals',jsonb_array_length(goals),'roster',jsonb_array_length(roster)));
 IF octet_length(r::text)>1040000 THEN RAISE EXCEPTION 'response_bound_exceeded'; END IF;
 RETURN r;
END $f$;
CREATE FUNCTION public._cs_response(q jsonb,k text,o text,c text,s jsonb,receipt jsonb DEFAULT NULL,conflict jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('schema_version',1,'request_id',q->>'request_id','game_id',q->>'game_id','team_id',q->>'team_id','league_id',q->>'league_id','kind',k,'outcome',o,'code',c,'receipt',receipt,'conflict',conflict,'snapshot',s)
$f$;
CREATE FUNCTION public.captain_get_game_scoring_context(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g public.games%ROWTYPE;s jsonb;
BEGIN
 BEGIN g:=public._cs_scope(p_request); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'row_bound_exceeded' THEN RAISE; END IF; RETURN public._cs_response(p_request,'get_context','rejected',SQLERRM,NULL); END;
 IF (SELECT count(*) FROM jsonb_object_keys(p_request))<>5 THEN RAISE EXCEPTION 'Invalid request keys' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.games WHERE id=g.id FOR SHARE;
 BEGIN g:=public._cs_scope(p_request,true); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'row_bound_exceeded' THEN RAISE; END IF; RETURN public._cs_response(p_request,'get_context','rejected',SQLERRM,NULL); END;
 BEGIN s:=public._cs_snapshot(g,(p_request->>'team_id')::uuid);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN('row_bound_exceeded','text_bound_exceeded','response_bound_exceeded','scope_unavailable','lifecycle_unavailable') THEN RAISE; END IF; RETURN public._cs_response(p_request,'get_context','rejected',SQLERRM,NULL); END;
 RETURN public._cs_response(p_request,'get_context','ok',NULL,s);
END $f$;

CREATE FUNCTION public._cs_game_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE hs integer;aws integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=OLD.id) THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Managed writes require READ COMMITTED' USING ERRCODE='40001'; END IF;
 IF (NEW.league_id,NEW.season_id,NEW.home_team_id,NEW.away_team_id) IS DISTINCT FROM (OLD.league_id,OLD.season_id,OLD.home_team_id,OLD.away_team_id) THEN RAISE EXCEPTION 'Managed game scope is immutable' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER(WHERE team_id=OLD.home_team_id),count(*) FILTER(WHERE team_id=OLD.away_team_id) INTO hs,aws FROM public.game_events WHERE game_id=OLD.id AND event_type='goal' AND deleted_at IS NULL;
 -- This is a live scoring cache invariant, not completed official-score authority.
 IF OLD.status::text IN('scheduled','in_progress') AND NEW.status::text IN('scheduled','in_progress') THEN NEW.home_score:=hs;NEW.away_score:=aws; END IF;
 IF (to_jsonb(NEW)-'updated_at'-'home_score'-'away_score') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'home_score'-'away_score') THEN UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id=OLD.id; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER captain_scoring_game_guard BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public._cs_game_guard();
CREATE FUNCTION public._cs_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
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
 IF NEW.deleted_at IS NULL AND g.status::text IN('scheduled','in_progress') AND (TG_OP='INSERT' OR OLD.deleted_at IS NOT NULL OR (NEW.player_id,NEW.assist1_player_id,NEW.assist2_player_id) IS DISTINCT FROM (OLD.player_id,OLD.assist1_player_id,OLD.assist2_player_id)) THEN
  s:=public._cs_snapshot(g,NEW.team_id);
  FOREACH p IN ARRAY ARRAY[NEW.player_id,NEW.assist1_player_id,NEW.assist2_player_id] LOOP
   IF p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'roster') r WHERE (r->>'player_id')::uuid=p AND (r->>'eligible_for_goal')::boolean) THEN RAISE EXCEPTION 'Managed event participant not eligible' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER captain_scoring_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.game_events FOR EACH ROW EXECUTE FUNCTION public._cs_event_guard();
CREATE FUNCTION public._cs_events_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ids uuid[];gid uuid;
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT game_id ORDER BY game_id) INTO ids FROM cs_new;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT game_id ORDER BY game_id) INTO ids FROM cs_old;
 ELSE SELECT array_agg(DISTINCT n.game_id ORDER BY n.game_id) INTO ids FROM cs_new n JOIN cs_old o USING(id) WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at'); END IF;
 FOREACH gid IN ARRAY coalesce(ids,'{}'::uuid[]) LOOP
 IF EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=gid) THEN
  PERFORM id FROM public.games WHERE id=gid FOR UPDATE;
  UPDATE public.games g SET home_score=(SELECT count(*) FROM public.game_events WHERE game_id=gid AND team_id=g.home_team_id AND event_type='goal' AND deleted_at IS NULL),away_score=(SELECT count(*) FROM public.game_events WHERE game_id=gid AND team_id=g.away_team_id AND event_type='goal' AND deleted_at IS NULL) WHERE id=gid AND g.status::text IN('scheduled','in_progress');
  UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id=gid;
 END IF;
 END LOOP;
 RETURN NULL;
END $f$;
CREATE TRIGGER captain_scoring_events_insert AFTER INSERT ON public.game_events REFERENCING NEW TABLE AS cs_new FOR EACH STATEMENT EXECUTE FUNCTION public._cs_events_after();
CREATE TRIGGER captain_scoring_events_update AFTER UPDATE ON public.game_events REFERENCING OLD TABLE AS cs_old NEW TABLE AS cs_new FOR EACH STATEMENT EXECUTE FUNCTION public._cs_events_after();
CREATE TRIGGER captain_scoring_events_delete AFTER DELETE ON public.game_events REFERENCING OLD TABLE AS cs_old FOR EACH STATEMENT EXECUTE FUNCTION public._cs_events_after();

CREATE FUNCTION public._cs_attendance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE gid uuid;p uuid;t uuid;g public.games%ROWTYPE;changed boolean;
BEGIN
 gid:=CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;p:=CASE WHEN TG_OP='DELETE' THEN OLD.player_id ELSE NEW.player_id END;t:=CASE WHEN TG_OP='DELETE' THEN OLD.team_id ELSE NEW.team_id END;
 IF TG_OP='UPDATE' AND (NEW.game_id,NEW.player_id,NEW.team_id) IS DISTINCT FROM (OLD.game_id,OLD.player_id,OLD.team_id) AND (EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=OLD.game_id) OR EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=NEW.game_id)) THEN RAISE EXCEPTION 'Managed attendance identity immutable' USING ERRCODE='23514'; END IF;
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
CREATE TRIGGER captain_scoring_attendance_guard BEFORE INSERT OR UPDATE OR DELETE ON public.game_checkins FOR EACH ROW EXECUTE FUNCTION public._cs_attendance_guard();
CREATE TRIGGER captain_scoring_availability_guard BEFORE INSERT OR UPDATE OR DELETE ON public.player_availability FOR EACH ROW EXECUTE FUNCTION public._cs_attendance_guard();

CREATE FUNCTION public._cs_attendance_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE gid uuid;p uuid;t uuid;
BEGIN
 gid:=CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;p:=CASE WHEN TG_OP='DELETE' THEN OLD.player_id ELSE NEW.player_id END;t:=CASE WHEN TG_OP='DELETE' THEN OLD.team_id ELSE NEW.team_id END;
 IF NOT EXISTS(SELECT 1 FROM public.captain_game_scoring_state WHERE game_id=gid) THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND (NEW.status,NEW.team_id) IS NOT DISTINCT FROM (OLD.status,OLD.team_id) THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='game_checkins' THEN INSERT INTO public.captain_game_scoring_presence(game_id,team_id,player_id,version) VALUES(gid,t,p,1) ON CONFLICT(game_id,team_id,player_id) DO UPDATE SET version=captain_game_scoring_presence.version+1; END IF;
 UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id=gid;
 RETURN NULL;
END $f$;
CREATE TRIGGER captain_scoring_attendance_after AFTER INSERT OR UPDATE OR DELETE ON public.game_checkins FOR EACH ROW EXECUTE FUNCTION public._cs_attendance_after();
CREATE TRIGGER captain_scoring_availability_after AFTER INSERT OR UPDATE OR DELETE ON public.player_availability FOR EACH ROW EXECUTE FUNCTION public._cs_attendance_after();
GRANT INSERT,UPDATE ON public.game_events,public.game_checkins TO captain_scoring_authority;
CREATE FUNCTION public._cs_validate_command(q jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE k text; BEGIN
CASE q->>'kind'
WHEN 'add_goal' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['assist1_id','assist2_id','event_id','expected_version','game_id','kind','league_id','request_id','schema_version','scorer_id','team_id']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'event_id') IS DISTINCT FROM 'string' OR q->>'event_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid event_id' USING ERRCODE='22023'; END IF;
 IF q->'expected_version' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'scorer_id') IS DISTINCT FROM 'string' OR q->>'scorer_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid scorer_id' USING ERRCODE='22023'; END IF;
 IF (q->'assist1_id' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(q->'assist1_id') IS DISTINCT FROM 'string' OR q->>'assist1_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')) THEN RAISE EXCEPTION 'Invalid assist1_id' USING ERRCODE='22023'; END IF;
 IF (q->'assist2_id' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(q->'assist2_id') IS DISTINCT FROM 'string' OR q->>'assist2_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')) THEN RAISE EXCEPTION 'Invalid assist2_id' USING ERRCODE='22023'; END IF;
WHEN 'update_goal' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['assist1_id','assist2_id','event_id','expected_version','game_id','kind','league_id','request_id','schema_version','scorer_id','team_id']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'event_id') IS DISTINCT FROM 'string' OR q->>'event_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid event_id' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'expected_version') IS DISTINCT FROM 'number' OR q->>'expected_version' !~ '^[0-9]+$' OR (q->>'expected_version')::numeric NOT BETWEEN 1 AND 2147483646 THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'scorer_id') IS DISTINCT FROM 'string' OR q->>'scorer_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid scorer_id' USING ERRCODE='22023'; END IF;
 IF (q->'assist1_id' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(q->'assist1_id') IS DISTINCT FROM 'string' OR q->>'assist1_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')) THEN RAISE EXCEPTION 'Invalid assist1_id' USING ERRCODE='22023'; END IF;
 IF (q->'assist2_id' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(q->'assist2_id') IS DISTINCT FROM 'string' OR q->>'assist2_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')) THEN RAISE EXCEPTION 'Invalid assist2_id' USING ERRCODE='22023'; END IF;
WHEN 'remove_goal' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['event_id','expected_version','game_id','kind','league_id','request_id','schema_version','team_id']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'event_id') IS DISTINCT FROM 'string' OR q->>'event_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid event_id' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'expected_version') IS DISTINCT FROM 'number' OR q->>'expected_version' !~ '^[0-9]+$' OR (q->>'expected_version')::numeric NOT BETWEEN 1 AND 2147483646 THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
WHEN 'scratch' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['expected_version','game_id','kind','league_id','player_id','request_id','schema_version','team_id']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'player_id') IS DISTINCT FROM 'string' OR q->>'player_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid player_id' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'expected_version') IS DISTINCT FROM 'number' OR q->>'expected_version' !~ '^[0-9]+$' OR (q->>'expected_version')::numeric NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
WHEN 'reinstate' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['expected_version','game_id','kind','league_id','player_id','request_id','schema_version','team_id']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'player_id') IS DISTINCT FROM 'string' OR q->>'player_id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN RAISE EXCEPTION 'Invalid player_id' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'expected_version') IS DISTINCT FROM 'number' OR q->>'expected_version' !~ '^[0-9]+$' OR (q->>'expected_version')::numeric NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
WHEN 'set_commentary' THEN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(q) key) IS DISTINCT FROM ARRAY['expected_version','game_id','kind','league_id','request_id','schema_version','team_id','text']::text[] THEN RAISE EXCEPTION 'Invalid command keys' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'expected_version') IS DISTINCT FROM 'number' OR q->>'expected_version' !~ '^[0-9]+$' OR (q->>'expected_version')::numeric NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'Invalid expected_version' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(q->'text') IS DISTINCT FROM 'string' OR length(q->>'text')>2000 OR octet_length(q->>'text')>8000 THEN RAISE EXCEPTION 'Invalid text' USING ERRCODE='22023'; END IF;
ELSE RAISE EXCEPTION 'Unsupported command' USING ERRCODE='22023'; END CASE; END $f$;

CREATE FUNCTION public.captain_manage_game_scoring(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g public.games%ROWTYPE;s jsonb;q jsonb:=p_request;t uuid;a uuid;prev public.captain_game_scoring_requests%ROWTYPE;k text;code text;outcome text;receipt jsonb;result jsonb;conflict jsonb;started boolean:=false;ev integer;pv integer;nv integer;target jsonb;e public.game_events%ROWTYPE;
BEGIN
 PERFORM public._cs_validate_command(q);k:=q->>'kind';
 BEGIN g:=public._cs_scope(q); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'row_bound_exceeded' THEN RAISE; END IF; RETURN public._cs_response(q,k,'rejected',SQLERRM,NULL); END;t:=(q->>'team_id')::uuid;a:=public._cs_actor_id();
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text||(q->>'request_id')::uuid::text,0));
 PERFORM id FROM public.games WHERE id=g.id FOR UPDATE;
 BEGIN g:=public._cs_scope(q,true); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'row_bound_exceeded' THEN RAISE; END IF; RETURN public._cs_response(q,k,'rejected',SQLERRM,NULL); END;
 BEGIN s:=public._cs_snapshot(g,t); EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN('row_bound_exceeded','text_bound_exceeded','response_bound_exceeded','scope_unavailable','lifecycle_unavailable') THEN RAISE; END IF; RETURN public._cs_response(q,k,'rejected',SQLERRM,NULL); END;
 SELECT * INTO prev FROM public.captain_game_scoring_requests WHERE actor_id=a AND request_id=(q->>'request_id')::uuid;
 IF FOUND THEN
 IF prev.payload IS DISTINCT FROM q THEN RETURN public._cs_response(q,k,'conflict','idempotency_conflict',s); END IF;
 -- Terminal metadata is immutable. Only omit the optional fresh snapshot when
 -- its still-present target contradicts the stored historical conflict version.
 IF prev.terminal->>'outcome'='conflict' AND prev.terminal->>'code'='event_version_conflict' AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(s->'own_goals') r
  WHERE (r->>'event_id')::uuid=(prev.terminal#>>'{conflict,entity_id}')::uuid
   AND (r->>'event_version')::integer<>(prev.terminal#>>'{conflict,current_version}')::integer
 ) THEN s:=NULL;
 ELSIF prev.terminal->>'outcome'='conflict' AND prev.terminal->>'code'='presence_version_conflict' AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(s->'roster') r
  WHERE (r->>'player_id')::uuid=(prev.terminal#>>'{conflict,entity_id}')::uuid
   AND (r->>'presence_version')::integer<>(prev.terminal#>>'{conflict,current_version}')::integer
 ) THEN s:=NULL;
 ELSIF prev.terminal->>'outcome'='conflict' AND prev.terminal->>'code'='commentary_version_conflict'
  AND (s#>>'{commentary,version}')::integer<>(prev.terminal#>>'{conflict,current_version}')::integer
 THEN s:=NULL; END IF;
 RETURN public._cs_response(q,k,CASE WHEN prev.terminal->>'outcome'='applied' THEN 'replayed' ELSE prev.terminal->>'outcome' END,prev.terminal->>'code',s,prev.terminal->'receipt',prev.terminal->'conflict');
 END IF;
 code:=s#>>'{permissions,blocked_reason}';outcome:=CASE WHEN code='legacy_score_mismatch' THEN 'conflict' ELSE 'rejected' END;
 IF code IS NULL THEN
 IF k='set_commentary' THEN
 nv:=(s#>>'{commentary,version}')::integer;
 IF nv<>(q->>'expected_version')::integer THEN code:='commentary_version_conflict';outcome:='conflict';conflict:=jsonb_build_object('entity','commentary','entity_id',t,'current_version',nv); END IF;
 END IF;
 IF k IN('scratch','reinstate') THEN
 SELECT r INTO target FROM jsonb_array_elements(s->'roster') r WHERE (r->>'player_id')::uuid=(q->>'player_id')::uuid;
 pv:=coalesce((target->>'presence_version')::integer,0);
 IF target IS NULL OR target->>'source'='credited_only' OR target->>'availability_state'<>'none' THEN code:='player_not_eligible';outcome:='conflict';
 ELSIF pv<>(q->>'expected_version')::integer THEN code:='presence_version_conflict';outcome:='conflict';conflict:=jsonb_build_object('entity','presence','entity_id',q->>'player_id','current_version',pv);
 ELSIF k='scratch' AND (target->>'has_credited_stats')::boolean THEN code:='credited_stats_conflict';outcome:='conflict'; END IF;
 END IF;
 IF k IN('update_goal','remove_goal') THEN
 SELECT * INTO e FROM public.game_events WHERE id=(q->>'event_id')::uuid FOR UPDATE;
 IF NOT FOUND OR e.game_id<>g.id OR e.team_id<>t OR e.event_type<>'goal' OR e.player_id IS NULL THEN code:='event_unavailable';outcome:='rejected';
 ELSIF e.deleted_at IS NOT NULL THEN code:='event_removed';outcome:='conflict';
 ELSIF e.event_version<>(q->>'expected_version')::integer THEN code:='event_version_conflict';outcome:='conflict';conflict:=jsonb_build_object('entity','event','entity_id',e.id,'current_version',e.event_version);
 END IF;
 END IF;
 IF k='add_goal' THEN
  IF EXISTS(SELECT 1 FROM public.game_events WHERE id=(q->>'event_id')::uuid OR client_event_id=(q->>'event_id')::uuid::text) THEN code:='event_id_conflict';outcome:='conflict';
  END IF; END IF;
 IF code IS NULL AND k IN('add_goal','update_goal') THEN
 IF ((q->>'assist2_id') IS NOT NULL AND (q->>'assist1_id') IS NULL) OR (q->>'scorer_id')::uuid IN((q->>'assist1_id')::uuid,(q->>'assist2_id')::uuid) OR ((q->>'assist1_id')::uuid=(q->>'assist2_id')::uuid) OR EXISTS(SELECT 1 FROM unnest(ARRAY[(q->>'scorer_id')::uuid,(q->>'assist1_id')::uuid,(q->>'assist2_id')::uuid]) p WHERE p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'roster') r WHERE (r->>'player_id')::uuid=p AND (r->>'eligible_for_goal')::boolean)) THEN code:='player_not_eligible';outcome:='conflict';
  END IF;
 END IF;
 END IF;
 IF code IS NULL AND ((k='set_commentary' AND s#>>'{commentary,text}' IS NOT DISTINCT FROM q->>'text') OR (k IN('scratch','reinstate') AND target->>'checkin_status'=CASE WHEN k='scratch' THEN 'out' ELSE 'confirmed' END)) THEN
  receipt:=jsonb_build_object('applied_revision',s->>'revision','event_id',NULL,'event_version',NULL,'player_id',q->>'player_id','presence_version',pv,'commentary_version',nv,'transitioned_to_in_progress',false);
  outcome:='applied';
 ELSIF code IS NULL THEN
 -- Subtransaction guarantees even a snapshot-bound rejection leaves no business DML.
 BEGIN
 INSERT INTO public.captain_game_scoring_state(game_id) VALUES(g.id) ON CONFLICT DO NOTHING;
 IF k='add_goal' AND g.status::text='scheduled' THEN UPDATE public.games SET status='in_progress',game_started_at=coalesce(game_started_at,clock_timestamp()),current_period=CASE WHEN current_period>0 THEN current_period ELSE 1 END WHERE id=g.id;started:=true; END IF;
 IF k='add_goal' THEN
 INSERT INTO public.game_events(id,client_event_id,game_id,league_id,team_id,team_type,player_id,assist1_player_id,assist2_player_id,event_type,entered_by,entered_at,event_version,period,game_time_seconds,goalie_in_net_id,penalty_minutes,penalty_type,is_power_play,is_short_handed,is_empty_net,is_gwg,sync_status,created_offline)
 VALUES((q->>'event_id')::uuid,(q->>'event_id')::uuid::text,g.id,g.league_id,t,CASE WHEN t=g.home_team_id THEN 'home' ELSE 'away' END,(q->>'scorer_id')::uuid,(q->>'assist1_id')::uuid,(q->>'assist2_id')::uuid,'goal',a,clock_timestamp(),1,NULL,NULL,NULL,NULL,NULL,false,false,false,false,'synced',false);
 ev:=1;
 ELSIF k='update_goal' THEN UPDATE public.game_events SET player_id=(q->>'scorer_id')::uuid,assist1_player_id=(q->>'assist1_id')::uuid,assist2_player_id=(q->>'assist2_id')::uuid,event_version=event_version+1,updated_at=clock_timestamp() WHERE id=e.id RETURNING event_version INTO ev;
 ELSIF k='set_commentary' THEN
 IF s#>>'{commentary,text}' IS DISTINCT FROM q->>'text' THEN
 INSERT INTO public.captain_game_scoring_commentary(game_id,team_id,text,version,updated_by) VALUES(g.id,t,q->>'text',1,a) ON CONFLICT(game_id,team_id) DO UPDATE SET text=EXCLUDED.text,version=captain_game_scoring_commentary.version+1,updated_by=a,updated_at=clock_timestamp() RETURNING version INTO nv;
 UPDATE public.captain_game_scoring_state SET revision=revision+1 WHERE game_id=g.id;
 END IF;
 ELSIF k IN('scratch','reinstate') THEN
 INSERT INTO public.game_checkins(game_id,team_id,player_id,status) VALUES(g.id,t,(q->>'player_id')::uuid,CASE WHEN k='scratch' THEN 'out' ELSE 'confirmed' END) ON CONFLICT(game_id,player_id) DO UPDATE SET status=EXCLUDED.status,updated_at=clock_timestamp();
 SELECT version INTO pv FROM public.captain_game_scoring_presence WHERE game_id=g.id AND team_id=t AND player_id=(q->>'player_id')::uuid;pv:=coalesce(pv,0);
 ELSIF k='remove_goal' THEN UPDATE public.game_events SET deleted_at=clock_timestamp(),deleted_by=a,event_version=event_version+1,updated_at=clock_timestamp() WHERE id=e.id RETURNING event_version INTO ev;
 END IF;
 UPDATE public.games SET home_score=(SELECT count(*) FROM public.game_events WHERE game_id=g.id AND team_id=g.home_team_id AND event_type='goal' AND deleted_at IS NULL),away_score=(SELECT count(*) FROM public.game_events WHERE game_id=g.id AND team_id=g.away_team_id AND event_type='goal' AND deleted_at IS NULL) WHERE id=g.id;
 SELECT * INTO g FROM public.games WHERE id=g.id;s:=public._cs_snapshot(g,t);
 receipt:=jsonb_build_object('applied_revision',s->>'revision','event_id',q->>'event_id','event_version',ev,'player_id',q->>'player_id','presence_version',pv,'commentary_version',nv,'transitioned_to_in_progress',started);outcome:='applied';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN('row_bound_exceeded','text_bound_exceeded','response_bound_exceeded','scope_unavailable') THEN RAISE; END IF;code:=SQLERRM;outcome:='rejected';s:=NULL;receipt:=NULL;
 END;
 END IF;
 result:=public._cs_response(q,k,outcome,code,s,receipt,conflict);
 INSERT INTO public.captain_game_scoring_requests(actor_id,request_id,payload,terminal) VALUES(a,(q->>'request_id')::uuid,q,result-'snapshot'-'schema_version'-'request_id'-'game_id'-'team_id'-'league_id'-'kind');
 RETURN result;
END $f$;
DO $acl$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure fn,proname n FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE '\_cs\_%' ESCAPE '\' OR proname IN('captain_get_game_scoring_context','captain_manage_game_scoring')) LOOP IF f.n<>'_cs_actor_id' THEN EXECUTE format('ALTER FUNCTION %s OWNER TO captain_scoring_authority',f.fn); END IF; EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.fn); END LOOP; END $acl$;
GRANT EXECUTE ON FUNCTION public._cs_actor_id() TO captain_scoring_authority;
GRANT EXECUTE ON FUNCTION public.captain_get_game_scoring_context(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.captain_manage_game_scoring(jsonb) TO authenticated;
REVOKE CREATE ON SCHEMA public FROM captain_scoring_authority;
GRANT captain_scoring_authority TO CURRENT_USER WITH INHERIT FALSE, SET FALSE;
COMMIT;
