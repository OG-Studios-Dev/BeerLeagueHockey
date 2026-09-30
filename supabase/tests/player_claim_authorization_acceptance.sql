\set ON_ERROR_STOP on

DO $test$
DECLARE v_result jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.merge_legacy_profile(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.merge_legacy_profile(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.merge_legacy_profile(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'raw legacy merge remains executable by an API role';
  END IF;
  IF has_function_privilege('anon', 'public.claim_rostered_player_profile(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_rostered_player_profile(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.claim_rostered_player_profile(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'raw roster claim remains executable by an API role';
  END IF;
  IF has_function_privilege('anon', 'public._claim_update_uuid_column_if_exists(text,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._claim_update_uuid_column_if_exists(text,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public._claim_update_uuid_column_if_exists(text,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'arbitrary update helper remains executable by an API role';
  END IF;
  IF has_function_privilege('anon', 'public.admin_merge_legacy_profile(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_merge_legacy_profile(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_merge_legacy_profile(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin RPC ACL is incorrect';
  END IF;
  IF has_table_privilege('anon', 'public.captain_player_invites', 'SELECT')
     OR has_table_privilege('authenticated', 'public.captain_player_invites', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.captain_player_invites', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'captain invite table ACL is incorrect';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.captain_player_invites'::regclass) THEN
    RAISE EXCEPTION 'captain invite RLS is not enabled';
  END IF;

  v_result := public.admin_merge_legacy_profile(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '99999999-9999-9999-9999-999999999999'
  );
  IF COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'non-admin actor was accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '99999999-9999-9999-9999-999999999999') THEN
    RAISE EXCEPTION 'failed non-admin attempt mutated its source';
  END IF;

  FOREACH v_result IN ARRAY ARRAY[
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333'),
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777'),
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '88888888-8888-8888-8888-888888888888'),
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999999'),
    public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  ] LOOP
    IF COALESCE((v_result->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'invalid target/source invariant was accepted: %', v_result;
    END IF;
  END LOOP;

  v_result := public.admin_merge_legacy_profile(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '11111111-1111-1111-1111-111111111111'
  );
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'valid non-rostered admin merge failed: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111') THEN
    RAISE EXCEPTION 'successful merge retained source';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_checkins WHERE id = '10101010-1010-1010-1010-101010101010' AND player_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') THEN
    RAISE EXCEPTION 'successful merge did not preserve representative record';
  END IF;
  IF (SELECT count(*) FROM public.player_stats WHERE player_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.player_stats
       WHERE player_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
         AND game_id = '94949494-9494-9494-9494-949494949494'
     ) THEN
    RAISE EXCEPTION 'legacy merge discarded a distinct same-season/team game or retained a true duplicate';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.captain_player_invites
    WHERE id = '41414141-4141-4141-4141-414141414141'
      AND target_player_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND consumed_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source invite was not finalized';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.captain_player_invites
    WHERE id = '42424242-4242-4242-4242-424242424242'
      AND (consumed_by IS NOT NULL OR consumed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'unrelated target invite was finalized';
  END IF;

  -- SQL-owner compatibility: a valid rostered claimable guest remains claimable.
  v_result := public.claim_rostered_player_profile(
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '12121212-1212-1212-1212-121212121212'
  );
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'owner guest claim compatibility failed: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '12121212-1212-1212-1212-121212121212') THEN
    RAISE EXCEPTION 'owner guest claim retained source';
  END IF;
END;
$test$;

-- The consumption trigger rejects old-code false receipts while leaving pending rows intact.
DO $test$
BEGIN
  BEGIN
    UPDATE public.captain_player_invites
    SET consumed_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc', consumed_at = now()
    WHERE id = '42424242-4242-4242-4242-424242424242';
    RAISE EXCEPTION 'wrong-user invite consumption unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.captain_player_invites
    WHERE id = '42424242-4242-4242-4242-424242424242'
      AND (consumed_by IS NOT NULL OR consumed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'denied consumption changed invite state';
  END IF;
END;
$test$;
