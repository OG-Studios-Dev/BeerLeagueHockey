BEGIN;

-- Keep the complete, deployed reassignment implementations intact, but move
-- them behind owner-only names. The public signatures below become guarded
-- owner-only wrappers; the only API role entry point is the admin RPC.
ALTER FUNCTION public.merge_legacy_profile(uuid, uuid)
  RENAME TO _merge_legacy_profile_core;
ALTER FUNCTION public.claim_rostered_player_profile(uuid, uuid)
  RENAME TO _claim_rostered_player_profile_core;

ALTER FUNCTION public._merge_legacy_profile_core(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public._claim_rostered_player_profile_core(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public._claim_update_uuid_column_if_exists(text, text, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._merge_legacy_profile_core(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._claim_rostered_player_profile_core(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._claim_update_uuid_column_if_exists(text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._assert_player_merge_invariants(
  p_target_profile_id uuid,
  p_source_profile_id uuid,
  p_require_legacy boolean,
  p_require_roster boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_first_id uuid;
  v_second_id uuid;
BEGIN
  IF p_target_profile_id IS NULL OR p_source_profile_id IS NULL THEN
    RAISE EXCEPTION 'Target and source profile IDs are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_target_profile_id = p_source_profile_id THEN
    RAISE EXCEPTION 'Target and source profile IDs must differ'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize against PR112 guest/auth attachment using its exact lock namespace.
  IF p_target_profile_id::text < p_source_profile_id::text THEN
    v_first_id := p_target_profile_id;
    v_second_id := p_source_profile_id;
  ELSE
    v_first_id := p_source_profile_id;
    v_second_id := p_target_profile_id;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.profile_auth_identity:' || v_first_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.profile_auth_identity:' || v_second_id::text, 0)
  );

  -- Row locks use the same deterministic order, preventing cross-claim deadlocks.
  PERFORM p.id
  FROM public.profiles AS p
  WHERE p.id IN (p_target_profile_id, p_source_profile_id)
  ORDER BY p.id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = p_target_profile_id
      AND p.deleted_at IS NULL
      AND COALESCE(p.is_legacy_import, false) = false
      AND p.identity_provenance = 'auth_account'
      AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Target profile % is not an active auth-backed account', p_target_profile_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_source_profile_id
      AND p.deleted_at IS NULL
      AND p.legacy_merge_completed_at IS NULL
      AND (NOT p_require_legacy OR p.is_legacy_import IS TRUE)
      AND (
        p_require_legacy
        OR p.identity_provenance = 'claimable_guest'
        OR p.is_legacy_import IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM auth.users AS u WHERE u.id = p_source_profile_id
      )
  ) THEN
    RAISE EXCEPTION 'Source profile % is not an active, authless, unclaimed source', p_source_profile_id
      USING ERRCODE = '42501';
  END IF;

  IF p_require_roster AND NOT EXISTS (
    SELECT 1 FROM public.team_rosters AS tr WHERE tr.player_id = p_source_profile_id
  ) THEN
    RAISE EXCEPTION 'Source profile % is not rostered', p_source_profile_id
      USING ERRCODE = '42501';
  END IF;
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
BEGIN
  PERFORM public._assert_player_merge_invariants(
    p_new_profile_id, p_legacy_profile_id, true, false
  );

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
  v_core_total := COALESCE((v_result ->> 'total_reassigned')::integer, 0);
  RETURN jsonb_set(
    v_result,
    '{total_reassigned}',
    to_jsonb(v_core_total + v_player_stats_reassigned),
    true
  );
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

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
BEGIN
  PERFORM public._assert_player_merge_invariants(
    p_target_profile_id, p_claim_profile_id, false, true
  );
  v_result := public._claim_rostered_player_profile_core(
    p_target_profile_id, p_claim_profile_id
  );
  IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'Roster claim core failed: %', COALESCE(v_result ->> 'error', 'unknown error');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_claim_profile_id) THEN
    RAISE EXCEPTION 'Roster claim did not delete source profile %', p_claim_profile_id;
  END IF;
  RETURN v_result;
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_captain_player_invite_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.consumed_at IS NOT NULL OR OLD.consumed_by IS NOT NULL)
     AND (NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
          OR NEW.consumed_by IS DISTINCT FROM OLD.consumed_by) THEN
    RAISE EXCEPTION 'Captain invite consumption receipts are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.consumed_at IS NOT NULL OR NEW.consumed_by IS NOT NULL THEN
    IF NEW.consumed_at IS NULL OR NEW.consumed_by IS NULL THEN
      RAISE EXCEPTION 'Captain invite consumption requires both consumed_at and consumed_by'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.consumed_by IS DISTINCT FROM NEW.target_player_id THEN
      RAISE EXCEPTION 'Captain invite may only be consumed by its current target'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN auth.users AS u ON u.id = p.id
      WHERE p.id = NEW.consumed_by
        AND p.deleted_at IS NULL
        AND p.identity_provenance = 'auth_account'
        AND COALESCE(p.is_legacy_import, false) = false
        AND u.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Captain invite consumer must be an active auth-backed account'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS captain_player_invites_guard_consumption
  ON public.captain_player_invites;
CREATE TRIGGER captain_player_invites_guard_consumption
BEFORE INSERT OR UPDATE OF consumed_at, consumed_by
ON public.captain_player_invites
FOR EACH ROW EXECUTE FUNCTION public.guard_captain_player_invite_consumption();

ALTER TABLE public.captain_player_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.captain_player_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.captain_player_invites TO service_role;

CREATE OR REPLACE FUNCTION public.admin_merge_legacy_profile(
  p_actor_profile_id uuid,
  p_target_profile_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_invite_ids uuid[];
  v_expected_invites integer := 0;
  v_updated_invites integer := 0;
BEGIN
  IF p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile ID is required' USING ERRCODE = '22004';
  END IF;

  PERFORM p.id
  FROM public.profiles AS p
  JOIN auth.users AS u ON u.id = p.id
  WHERE p.id = p_actor_profile_id
    AND p.deleted_at IS NULL
    AND p.identity_provenance = 'auth_account'
    AND COALESCE(p.is_legacy_import, false) = false
    AND COALESCE(p.is_platform_admin, false) = true
    AND u.deleted_at IS NULL
  FOR SHARE OF p, u;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actor profile % is not an active platform administrator', p_actor_profile_id
      USING ERRCODE = '42501';
  END IF;

  -- Reject corrupt pre-existing source receipts instead of rewriting them.
  IF EXISTS (
    SELECT 1
    FROM public.captain_player_invites AS i
    WHERE i.target_player_id = p_source_profile_id
      AND (
        (i.consumed_at IS NULL) <> (i.consumed_by IS NULL)
        OR (i.consumed_by IS NOT NULL AND i.consumed_by <> i.target_player_id)
      )
  ) THEN
    RAISE EXCEPTION 'Source profile has inconsistent captain invite consumption history'
      USING ERRCODE = '23514';
  END IF;

  PERFORM i.id
  FROM public.captain_player_invites AS i
  WHERE i.target_player_id = p_source_profile_id
    AND i.consumed_at IS NULL
    AND i.consumed_by IS NULL
  ORDER BY i.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(i.id ORDER BY i.id), ARRAY[]::uuid[])
  INTO v_invite_ids
  FROM public.captain_player_invites AS i
  WHERE i.target_player_id = p_source_profile_id
    AND i.consumed_at IS NULL
    AND i.consumed_by IS NULL;
  v_expected_invites := cardinality(v_invite_ids);

  v_result := public.merge_legacy_profile(p_target_profile_id, p_source_profile_id);
  IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'Admin merge failed: %', COALESCE(v_result ->> 'error', 'unknown error');
  END IF;

  IF v_expected_invites > 0 THEN
    UPDATE public.captain_player_invites AS i
    SET consumed_by = p_target_profile_id,
        consumed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE i.id = ANY(v_invite_ids)
      AND i.target_player_id = p_target_profile_id
      AND i.consumed_at IS NULL
      AND i.consumed_by IS NULL;
    GET DIAGNOSTICS v_updated_invites = ROW_COUNT;
    IF v_updated_invites <> v_expected_invites THEN
      RAISE EXCEPTION 'Captain invite finalization race detected';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('captain_invites_finalized', v_updated_invites);
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

ALTER FUNCTION public._assert_player_merge_invariants(uuid, uuid, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.merge_legacy_profile(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_rostered_player_profile(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.guard_captain_player_invite_consumption() OWNER TO postgres;
ALTER FUNCTION public.admin_merge_legacy_profile(uuid, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._assert_player_merge_invariants(uuid, uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_legacy_profile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_rostered_player_profile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_captain_player_invite_consumption()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_merge_legacy_profile(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_merge_legacy_profile(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.admin_merge_legacy_profile(uuid, uuid, uuid) IS
  'Only destructive player-history claim RPC. Service role caller supplies a server-authenticated actor; DB independently requires an active platform admin and hardened target/source invariants.';

COMMIT;
