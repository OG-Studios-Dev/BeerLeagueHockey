BEGIN;

-- Resolve Apple identity rows once so mutation-free preparation and destructive
-- initiation cannot disagree about malformed or ambiguous provider identity data.
CREATE OR REPLACE FUNCTION public.resolve_account_apple_identity_binding(p_user_id uuid)
RETURNS TABLE (
  apple_identity_row_count integer,
  valid_apple_subject_count integer,
  distinct_apple_subject_count integer,
  apple_subject text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_apple_identity_row_count integer;
  v_valid_apple_subject_count integer;
  v_distinct_apple_subject_count integer;
  v_apple_subject text;
BEGIN
  WITH canonical_apple_identities AS (
    SELECT COALESCE(
      NULLIF(pg_catalog.btrim(i.identity_data ->> 'sub'), ''),
      NULLIF(pg_catalog.btrim(i.identity_id), '')
    ) AS canonical_subject
    FROM auth.identities AS i
    WHERE i.user_id = p_user_id
      AND i.provider = 'apple'
  )
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(canonical_subject)::integer,
         pg_catalog.count(DISTINCT canonical_subject)::integer,
         pg_catalog.min(canonical_subject)
  INTO v_apple_identity_row_count,
       v_valid_apple_subject_count,
       v_distinct_apple_subject_count,
       v_apple_subject
  FROM canonical_apple_identities;

  IF v_apple_identity_row_count > 0
     AND (
       v_valid_apple_subject_count <> v_apple_identity_row_count
       OR v_distinct_apple_subject_count <> 1
       OR v_apple_subject IS NULL
     ) THEN
    RAISE EXCEPTION 'Cannot verify Sign in with Apple account. Contact Hockey Life support before deleting your account.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT
    v_apple_identity_row_count,
    v_valid_apple_subject_count,
    v_distinct_apple_subject_count,
    v_apple_subject;
END;
$function$;

-- Challenge discovery remains read-only and now uses the exact same identity
-- resolver as the atomic begin operation.
CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_apple_identity_count integer;
  v_valid_apple_subject_count integer;
  v_distinct_apple_subject_count integer;
  v_apple_subject text;
  v_retry_ready boolean;
  v_apple_revoked boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = p_user_id AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: active authenticated profile does not exist.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT b.apple_identity_row_count,
         b.valid_apple_subject_count,
         b.distinct_apple_subject_count,
         b.apple_subject
  INTO v_apple_identity_count,
       v_valid_apple_subject_count,
       v_distinct_apple_subject_count,
       v_apple_subject
  FROM public.resolve_account_apple_identity_binding(p_user_id) AS b;

  IF v_apple_identity_count = 0 THEN
    SELECT ps.apple_subject INTO v_apple_subject
    FROM public.account_deletion_provider_secrets AS ps
    JOIN public.account_deletion_state AS s ON s.user_id = ps.user_id
    WHERE ps.user_id = p_user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state = 'irreversible';
    IF FOUND THEN
      v_apple_identity_count := 1;
      v_valid_apple_subject_count := 1;
      v_distinct_apple_subject_count := 1;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_provider_secrets AS ps
    JOIN public.account_deletion_state AS s ON s.user_id = ps.user_id
    WHERE ps.user_id = p_user_id
      AND ps.apple_subject = v_apple_subject
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state = 'irreversible'
  ) INTO v_retry_ready;

  SELECT EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = p_user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state = 'irreversible'
      AND s.apple_revoked_at IS NOT NULL
      AND s.apple_revoked_subject = v_apple_subject
  ) INTO v_apple_revoked;

  RETURN pg_catalog.jsonb_build_object(
    'apple_required', v_apple_identity_count > 0,
    'apple_revoked', COALESCE(v_apple_revoked, FALSE),
    'apple_subject', v_apple_subject,
    'apple_retry_ready', COALESCE(v_retry_ready, FALSE)
  );
END;
$function$;

-- This remains the sole transition from an active account to irreversible
-- deletion. Identity validation completes before any deletion state or secret
-- can be written.
CREATE OR REPLACE FUNCTION public.begin_immediate_account_deletion(
  p_user_id uuid,
  p_apple_subject text DEFAULT NULL,
  p_revocation_token text DEFAULT NULL,
  p_token_type_hint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_server_subject text;
  v_apple_identity_count integer;
  v_valid_apple_subject_count integer;
  v_distinct_apple_subject_count integer;
  v_apple_required boolean;
BEGIN
  PERFORM public.validate_optional_deletion_relations();
  PERFORM public.lock_account_deletion_user(p_user_id);

  SELECT p.* INTO v_profile
  FROM public.profiles AS p
  JOIN auth.users AS u ON u.id = p.id
  WHERE p.id = p_user_id AND p.deleted_at IS NULL
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot delete account: active authenticated profile does not exist.'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.owner_user_id = p_user_id)
     OR EXISTS (
       SELECT 1 FROM public.organization_members AS om
       WHERE om.user_id = p_user_id AND om.role = 'owner' AND om.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.leagues AS l
       WHERE l.owner_id = p_user_id OR l.created_by = p_user_id
     )
     OR EXISTS (
       SELECT 1 FROM public.league_ownerships AS lo
       WHERE lo.user_id = p_user_id AND lo.role = 'owner'
     )
     OR EXISTS (
       SELECT 1 FROM public.league_memberships AS lm
       WHERE lm.user_id = p_user_id AND lm.role = 'owner' AND lm.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT b.apple_identity_row_count,
         b.valid_apple_subject_count,
         b.distinct_apple_subject_count,
         b.apple_subject
  INTO v_apple_identity_count,
       v_valid_apple_subject_count,
       v_distinct_apple_subject_count,
       v_server_subject
  FROM public.resolve_account_apple_identity_binding(p_user_id) AS b;
  v_apple_required := v_apple_identity_count > 0;

  IF v_apple_required THEN
    IF v_valid_apple_subject_count <> v_apple_identity_count
       OR v_distinct_apple_subject_count <> 1
       OR v_server_subject IS NULL
       OR v_server_subject IS DISTINCT FROM p_apple_subject THEN
      RAISE EXCEPTION 'Apple identity does not match the authenticated account.';
    END IF;
    IF p_revocation_token IS NULL OR p_revocation_token = ''
       OR p_token_type_hint NOT IN ('refresh_token', 'access_token') THEN
      RAISE EXCEPTION 'A server-verified Apple revocation grant is required.'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_apple_subject IS NOT NULL OR p_revocation_token IS NOT NULL
        OR p_token_type_hint IS NOT NULL THEN
    RAISE EXCEPTION 'Apple revocation data is not valid for this account.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.account_deletion_state (
    user_id, stripe_customer_id, completion_email, workflow_state,
    initiation_kind, started_at, updated_at
  ) VALUES (
    p_user_id, v_profile.stripe_customer_id, v_profile.email, 'irreversible',
    'immediate', pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id = COALESCE(public.account_deletion_state.stripe_customer_id, EXCLUDED.stripe_customer_id),
    completion_email = COALESCE(public.account_deletion_state.completion_email, EXCLUDED.completion_email),
    workflow_state = 'irreversible',
    initiation_kind = 'immediate',
    started_at = CASE
      WHEN public.account_deletion_state.workflow_state IN ('cancelled', 'failed', 'expired')
        THEN pg_catalog.statement_timestamp()
      ELSE public.account_deletion_state.started_at
    END,
    last_error = NULL,
    updated_at = pg_catalog.statement_timestamp();

  IF v_apple_required THEN
    INSERT INTO public.account_deletion_provider_secrets (
      user_id, apple_subject, apple_revocation_token, apple_token_type_hint,
      created_at, updated_at
    ) VALUES (
      p_user_id, p_apple_subject, p_revocation_token, p_token_type_hint,
      pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      apple_subject = EXCLUDED.apple_subject,
      apple_revocation_token = EXCLUDED.apple_revocation_token,
      apple_token_type_hint = EXCLUDED.apple_token_type_hint,
      updated_at = pg_catalog.statement_timestamp();
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', TRUE,
    'apple_required', v_apple_required,
    'apple_subject', v_server_subject,
    'workflow_state', 'irreversible'
  );
END;
$function$;

ALTER FUNCTION public.resolve_account_apple_identity_binding(uuid) OWNER TO postgres;
ALTER FUNCTION public.prepare_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.begin_immediate_account_deletion(uuid, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_account_apple_identity_binding(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
