\set ON_ERROR_STOP on
BEGIN;

DO $acceptance$
DECLARE
  v_state text;
  v_manual_off uuid := '10000000-0000-4000-8000-000000000001';
  v_manual_on uuid := '10000000-0000-4000-8000-000000000002';
  v_captain uuid := '10000000-0000-4000-8000-000000000003';
  v_account uuid := '10000000-0000-4000-8000-000000000004';
  v_deleted uuid := '10000000-0000-4000-8000-000000000005';
  v_claim_target uuid := '10000000-0000-4000-8000-000000000006';
  v_claim_guest uuid := '10000000-0000-4000-8000-000000000007';
  v_deleted_with_auth uuid := '10000000-0000-4000-8000-000000000008';
  v_claim_result jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  -- Manual Save-to-team-spares off, jersey 47.
  INSERT INTO public.profiles (id, email, full_name, jersey_number, role, is_legacy_import)
  VALUES (v_manual_off, 'manual-spare+' || v_manual_off || '@beerleaguehockey.local',
          'Manual Off', 47, 'player', true);

  -- Manual Save-to-team-spares on, jersey 47.
  INSERT INTO public.profiles (id, email, full_name, jersey_number, role, is_legacy_import)
  VALUES (v_manual_on, 'manual-spare+' || v_manual_on || '@beerleaguehockey.local',
          'Manual On', 47, 'player', true);
  INSERT INTO public.team_rosters (id, player_id, team_id, season_id, jersey_number)
  VALUES ('20000000-0000-4000-8000-000000000002', v_manual_on,
          '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 47);

  -- The independently confirmed captain stub writer omits role and uses its
  -- own UUID-bound placeholder shape; the profile default supplies player.
  INSERT INTO public.profiles (id, email, full_name, is_legacy_import)
  VALUES (v_captain, 'captaininvite_' || v_captain || '@captaininvite.hockeylifehl.com',
          'Captain Stub', true);

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id IN (v_manual_off, v_manual_on, v_captain)
      AND identity_provenance <> 'claimable_guest'
  ) THEN
    RAISE EXCEPTION 'Trusted guest insert was not durably classified';
  END IF;

  -- Ordinary service-role orphan remains subject to the deferred 23503 guard.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_legacy_import)
    VALUES ('10000000-0000-4000-8000-000000000010', 'ordinary@example.invalid', 'Ordinary', 'player', true);
    SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
    RAISE EXCEPTION 'ordinary orphan unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> '23503' THEN RAISE; END IF;
  END;
  SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;

  INSERT INTO auth.users(id) VALUES (v_deleted_with_auth);
  INSERT INTO public.profiles(id, email, full_name, deleted_at)
  VALUES (v_deleted_with_auth, 'deleted-auth@example.invalid', 'Deleted With Auth', pg_catalog.now());
  BEGIN
    UPDATE public.profiles
    SET email = 'manual-spare+' || v_deleted_with_auth || '@beerleaguehockey.local',
        is_legacy_import = true,
        identity_provenance = 'claimable_guest',
        deleted_at = NULL
    WHERE id = v_deleted_with_auth;
    RAISE EXCEPTION 'deleted authenticated profile resurrection unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.profiles SET deleted_at = pg_catalog.now() WHERE id = v_manual_on;
  BEGIN
    UPDATE public.profiles SET deleted_at = NULL WHERE id = v_manual_on;
    RAISE EXCEPTION 'deleted guest reactivation unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Authenticated/anon callers cannot forge classification, even with exact data.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_legacy_import, identity_provenance)
    VALUES ('10000000-0000-4000-8000-000000000011',
      'manual-spare+10000000-0000-4000-8000-000000000011@beerleaguehockey.local',
      'Spoof Authenticated', 'player', true, 'claimable_guest');
    RAISE EXCEPTION 'authenticated spoof unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_legacy_import, identity_provenance)
    VALUES ('10000000-0000-4000-8000-000000000012',
      'captaininvite_10000000-0000-4000-8000-000000000012@captaininvite.hockeylifehl.com',
      'Spoof Anon', 'player', true, 'claimable_guest');
    RAISE EXCEPTION 'anon spoof unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_legacy_import, is_platform_admin)
    VALUES ('10000000-0000-4000-8000-000000000014',
      'manual-spare+10000000-0000-4000-8000-000000000014@beerleaguehockey.local',
      'Privileged Guest', 'player', true, true);
    SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
    RAISE EXCEPTION 'privileged guest insert unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;

  INSERT INTO auth.users(id) VALUES (v_account);
  INSERT INTO public.profiles(id, email, full_name) VALUES (v_account, 'account@example.invalid', 'Account');

  BEGIN
    UPDATE public.profiles SET identity_provenance = 'claimable_guest' WHERE id = v_account;
    RAISE EXCEPTION 'account relabel unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET id = '10000000-0000-4000-8000-000000000013' WHERE id = v_manual_off;
    RAISE EXCEPTION 'guest identity change unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET identity_provenance = 'auth_account' WHERE id = v_manual_off;
    RAISE EXCEPTION 'guest provenance change unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Reverse auth-delete protection is unchanged.
  BEGIN
    DELETE FROM auth.users WHERE id = v_account;
    RAISE EXCEPTION 'active auth deletion unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- A retained/deleted ordinary profile cannot reactivate without auth and cannot
  -- be relabelled as a guest.
  INSERT INTO public.profiles(id, email, full_name, deleted_at)
  VALUES (v_deleted, 'deleted@example.invalid', 'Deleted', pg_catalog.now());
  BEGIN
    UPDATE public.profiles SET deleted_at = NULL WHERE id = v_deleted;
    SET CONSTRAINTS profiles_require_auth_while_active IMMEDIATE;
    RAISE EXCEPTION 'deleted orphan reactivation unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS profiles_require_auth_while_active DEFERRED;

  BEGIN
    UPDATE public.profiles SET role = 'captain' WHERE id = v_manual_off;
    RAISE EXCEPTION 'guest profile authority unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.team_rosters(id, player_id, leadership_role)
    VALUES ('20000000-0000-4000-8000-000000000003', v_manual_off, 'captain');
    RAISE EXCEPTION 'guest roster authority unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO auth.users(id) VALUES (v_manual_off);
    RAISE EXCEPTION 'direct guest auth attachment unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Execute the repository's actual claim RPC definition. The isolated schema
  -- includes the direct dependencies plus representative helper-updated data.
  INSERT INTO auth.users(id) VALUES (v_claim_target);
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (v_claim_target, 'claim-target@example.invalid', 'Claim Target');
  INSERT INTO public.profiles(id, email, full_name, role, is_legacy_import)
  VALUES (v_claim_guest, 'manual-spare+' || v_claim_guest || '@beerleaguehockey.local',
          'Claim Guest', 'player', true);
  INSERT INTO public.team_rosters(id, player_id, team_id, season_id, jersey_number)
  VALUES ('20000000-0000-4000-8000-000000000007', v_claim_guest,
          '40000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000007', 47);
  INSERT INTO public.game_checkins(id, player_id, status)
  VALUES ('30000000-0000-4000-8000-000000000007', v_claim_guest, 'confirmed');

  SELECT public.claim_rostered_player_profile(v_claim_target, v_claim_guest) INTO v_claim_result;

  IF COALESCE((v_claim_result ->> 'success')::boolean, false) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM public.team_rosters WHERE player_id = v_claim_target AND jersey_number = 47)
     OR NOT EXISTS (SELECT 1 FROM public.game_checkins WHERE player_id = v_claim_target AND status = 'confirmed')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_claim_guest)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_claim_target AND identity_provenance = 'auth_account') THEN
    RAISE EXCEPTION 'claim transition did not preserve records and canonical account provenance';
  END IF;

  SET CONSTRAINTS ALL IMMEDIATE;
END;
$acceptance$;

ROLLBACK;
