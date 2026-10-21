\set ON_ERROR_STOP on
-- Production-shaped fixture must include the immutable provenance migration,
-- deferred profiles_require_auth_while_active, Auth attachment and authority guards.
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='40000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
BEGIN;
DO $test$
DECLARE n integer; j integer; r jsonb; replay jsonb; req uuid; nm text;
BEGIN
 FOR n IN 1..3 LOOP
  j:=CASE n WHEN 1 THEN 1 WHEN 2 THEN 99 ELSE NULL END;
  nm:=CASE n WHEN 1 THEN 'Auburn Boundaryfirst' WHEN 2 THEN 'Cobalt Boundarylast' ELSE 'Violet Boundaryblank' END;
  req:=('90000000-0000-4000-8000-00000000009'||n)::uuid;
  r:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',req,'manual',p_manual_name=>nm,p_manual_jersey=>j,p_save_to_team_spares=>n<>1);
  replay:=public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',req,'manual',p_manual_name=>nm,p_manual_jersey=>j,p_save_to_team_spares=>n<>1);
  ASSERT r=replay AND r->>'outcome'='confirmed' AND r->>'checkin_status'='confirmed','exact request replay';
  BEGIN
   PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',req,'manual',p_manual_name=>nm,p_manual_jersey=>j,p_save_to_team_spares=>n=1);
   RAISE EXCEPTION 'changed replay payload accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 FOREACH j IN ARRAY ARRAY[-1,0,100,999,2147483647] LOOP
  BEGIN
   PERFORM public.captain_manage_sub_invitation('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'manual',p_manual_name=>'Rejected Boundjersey',p_manual_jersey=>j,p_save_to_team_spares=>true);
   RAISE EXCEPTION 'invalid jersey accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
END $test$;
-- A returned receipt alone is insufficient: force the real deferred invariant,
-- then commit the actual authenticated transaction.
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
RESET ROLE;
DO $test$
DECLARE p record; role_name text; id uuid:=gen_random_uuid();
BEGIN
 ASSERT (SELECT count(*)=3 FROM public.profiles WHERE full_name IN('Auburn Boundaryfirst','Cobalt Boundarylast','Violet Boundaryblank')),'one profile per command';
 FOR p IN SELECT * FROM public.profiles WHERE full_name IN('Auburn Boundaryfirst','Cobalt Boundarylast','Violet Boundaryblank') LOOP
  ASSERT p.identity_provenance='claimable_guest' AND p.role::text='player' AND NOT p.is_platform_admin,'guest no account authority';
  ASSERT p.email='manual-spare+'||p.id::text||'@beerleaguehockey.local','approved UUID-bound email';
  ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE auth.users.id=p.id),'guest has no Auth account';
  ASSERT EXISTS(SELECT 1 FROM public.game_checkins WHERE player_id=p.id AND status='confirmed'),'real confirmed row';
  ASSERT NOT EXISTS(SELECT 1 FROM public.team_rosters WHERE player_id=p.id AND (leadership_role IS NOT NULL OR player_type<>'sub')),'no roster authority';
  IF p.full_name='Auburn Boundaryfirst' THEN
   ASSERT NOT EXISTS(SELECT 1 FROM public.team_rosters WHERE player_id=p.id),'one-game does not save roster';
  ELSE
   ASSERT EXISTS(SELECT 1 FROM public.team_rosters WHERE player_id=p.id AND jersey_number IS NOT DISTINCT FROM p.jersey_number),'optional save preserves blank or bounded jersey';
  END IF;
  BEGIN UPDATE public.profiles SET role='captain' WHERE profiles.id=p.id; RAISE EXCEPTION 'guest account elevation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.profiles SET is_platform_admin=true WHERE profiles.id=p.id; RAISE EXCEPTION 'guest platform elevation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.profiles SET identity_provenance='auth_account' WHERE profiles.id=p.id; RAISE EXCEPTION 'guest relabel'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO auth.users(id) VALUES(p.id); RAISE EXCEPTION 'guest attached to Auth'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.team_rosters SET leadership_role='captain' WHERE player_id=p.id;
   IF FOUND THEN RAISE EXCEPTION 'guest roster leadership'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM captain_sub_private.guest_insert_capabilities),'one-use capabilities consumed';
 ASSERT NOT EXISTS(SELECT 1 FROM public.profiles WHERE full_name='Rejected Boundjersey'),'range rejection is atomic';
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  ASSERT NOT has_schema_privilege(role_name,'captain_sub_private','USAGE'),'private schema unavailable';
  ASSERT NOT has_column_privilege(role_name,'captain_sub_private.guest_insert_capabilities','profile_id','INSERT'),'app cannot mint proof';
  ASSERT NOT pg_has_role(role_name,'captain_sub_authority','SET'),'authority unavailable for SET ROLE';
 END LOOP;
 ASSERT has_column_privilege('captain_sub_authority','captain_sub_private.guest_insert_capabilities','profile_id','INSERT'),'only trusted authority can mint';
 ASSERT NOT has_column_privilege('captain_sub_authority','captain_sub_private.guest_insert_capabilities','transaction_id','INSERT'),'transaction binding not overrideable';
 ASSERT NOT has_table_privilege('captain_sub_authority','captain_sub_private.guest_insert_capabilities','SELECT'),'authority cannot harvest proof';
 -- Even exact mutable guest fields and a caller GUC are not provenance.
 PERFORM set_config('captain_sub.trusted_guest','true',true);
 BEGIN
  INSERT INTO public.profiles(id,email,role,is_legacy_import,identity_provenance) VALUES(id,'manual-spare+'||id::text||'@beerleaguehockey.local','player',true,'claimable_guest');
  RAISE EXCEPTION 'explicit authenticated provenance spoof accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.profiles(id,email,role,is_legacy_import) VALUES(id,'manual-spare+'||id::text||'@beerleaguehockey.local','player',true);
  SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
  RAISE EXCEPTION 'ordinary authless account accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;
 -- Capability alone cannot create a privileged account or an ordinary email.
 BEGIN
  INSERT INTO captain_sub_private.guest_insert_capabilities(profile_id) VALUES(id);
  INSERT INTO public.profiles(id,email,role,is_legacy_import,is_platform_admin) VALUES(id,'manual-spare+'||id::text||'@beerleaguehockey.local','player',true,true);
  SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
  RAISE EXCEPTION 'capability allowed platform authority';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;
 BEGIN
  INSERT INTO captain_sub_private.guest_insert_capabilities(profile_id) VALUES(id);
  INSERT INTO public.profiles(id,email,role,is_legacy_import) VALUES(id,'ordinary@example.invalid','player',true);
  SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
  RAISE EXCEPTION 'capability allowed ordinary authless profile';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;
 ASSERT NOT EXISTS(SELECT 1 FROM captain_sub_private.guest_insert_capabilities),'failed attempts leave no capability';
END $test$;
SELECT 'PASS trusted_guest_commit_bounds_replay_acl_spoof_and_authority_guards' AS test;
