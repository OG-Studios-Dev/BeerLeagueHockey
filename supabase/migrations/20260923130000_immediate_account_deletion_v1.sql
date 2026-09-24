BEGIN;

-- Forward-only v1 simplification. Delayed user-requested deletion is retired;
-- durable state now identifies only a server-verified immediate workflow or a
-- terminal/non-blocking legacy row.
ALTER TABLE public.account_deletion_state
  ADD COLUMN IF NOT EXISTS workflow_state text,
  ADD COLUMN IF NOT EXISTS initiation_kind text;

UPDATE public.account_deletion_state AS s
SET initiation_kind = CASE
      WHEN s.database_deleted_at IS NOT NULL
        OR s.apple_revoked_at IS NOT NULL
        OR s.storage_deleted_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.account_deletion_provider_secrets AS ps
          WHERE ps.user_id = s.user_id
        ) THEN 'immediate'
      ELSE 'legacy'
    END,
    workflow_state = CASE
      WHEN s.completed_at IS NOT NULL THEN 'completed'
      WHEN s.database_deleted_at IS NOT NULL THEN 'database_deleted'
      WHEN s.apple_revoked_at IS NOT NULL
        OR s.storage_deleted_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.account_deletion_provider_secrets AS ps
          WHERE ps.user_id = s.user_id
        ) THEN 'irreversible'
      ELSE 'cancelled'
    END,
    stripe_customer_id = CASE
      WHEN s.completed_at IS NOT NULL OR s.stripe_completed_at IS NOT NULL THEN NULL
      WHEN s.database_deleted_at IS NULL
       AND s.apple_revoked_at IS NULL
       AND s.storage_deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.account_deletion_provider_secrets AS ps
         WHERE ps.user_id = s.user_id
       ) THEN NULL
      ELSE s.stripe_customer_id
    END,
    completion_email = CASE
      WHEN s.completed_at IS NOT NULL OR s.email_completed_at IS NOT NULL THEN NULL
      WHEN s.database_deleted_at IS NULL
       AND s.apple_revoked_at IS NULL
       AND s.storage_deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.account_deletion_provider_secrets AS ps
         WHERE ps.user_id = s.user_id
       ) THEN NULL
      ELSE s.completion_email
    END,
    last_error = NULL,
    updated_at = pg_catalog.statement_timestamp();

ALTER TABLE public.account_deletion_state
  ALTER COLUMN workflow_state SET NOT NULL,
  ALTER COLUMN initiation_kind SET NOT NULL,
  ADD CONSTRAINT account_deletion_state_workflow_state_check
    CHECK (workflow_state IN (
      'irreversible', 'database_deleted', 'completed', 'cancelled', 'failed', 'expired'
    )),
  ADD CONSTRAINT account_deletion_state_initiation_kind_check
    CHECK (initiation_kind IN ('immediate', 'legacy'));

-- Cancel all legacy delayed work and scrub request payloads. Terminal rows keep
-- their timestamps and outcome for the minimum compliance audit trail.
ALTER TABLE public.account_deletion_log
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN profile_email DROP NOT NULL;

UPDATE public.account_deletion_log
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, pg_catalog.statement_timestamp()),
    user_id = NULL,
    profile_email = NULL,
    deletion_reason = NULL,
    ip_address = NULL,
    user_agent = NULL,
    stripe_customer_id = NULL,
    stripe_deletion_error = NULL,
    error_message = NULL,
    reminder_7day_claimed_at = NULL,
    updated_at = pg_catalog.statement_timestamp()
WHERE status IN ('pending', 'processing', 'failed', 'cancelled');

UPDATE public.account_deletion_log
SET user_id = NULL,
    profile_email = NULL,
    deletion_reason = NULL,
    ip_address = NULL,
    user_agent = NULL,
    stripe_customer_id = NULL,
    stripe_deletion_error = NULL,
    error_message = NULL,
    reminder_7day_claimed_at = NULL,
    updated_at = pg_catalog.statement_timestamp()
WHERE status = 'completed';

UPDATE public.profiles
SET deletion_requested_at = NULL,
    deletion_scheduled_for = NULL,
    deletion_reason = NULL,
    deletion_ip_address = NULL,
    deletion_user_agent = NULL,
    updated_at = pg_catalog.statement_timestamp()
WHERE deleted_at IS NULL
  AND (deletion_requested_at IS NOT NULL
    OR deletion_scheduled_for IS NOT NULL
    OR deletion_reason IS NOT NULL
    OR deletion_ip_address IS NOT NULL
    OR deletion_user_agent IS NOT NULL);

-- Challenge discovery is deliberately read-only. In particular it acquires no
-- deletion lock and writes no state, log, profile, or provider-secret row.
CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_apple_identity_count integer;
  v_apple_subject_count integer;
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

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(DISTINCT COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
         ))::integer,
         pg_catalog.min(COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
         ))
  INTO v_apple_identity_count, v_apple_subject_count, v_apple_subject
  FROM auth.identities AS i
  WHERE i.user_id = p_user_id AND i.provider = 'apple';

  IF v_apple_identity_count = 0 THEN
    SELECT ps.apple_subject INTO v_apple_subject
    FROM public.account_deletion_provider_secrets AS ps
    JOIN public.account_deletion_state AS s ON s.user_id = ps.user_id
    WHERE ps.user_id = p_user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state = 'irreversible';
    IF FOUND THEN
      v_apple_identity_count := 1;
      v_apple_subject_count := 1;
    END IF;
  END IF;

  IF v_apple_identity_count > 0
     AND (v_apple_subject_count <> 1 OR v_apple_subject IS NULL) THEN
    RAISE EXCEPTION 'Cannot establish a unique Apple account binding.';
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

-- This is the sole transition from a fully active account to deletion. The
-- advisory lock is shared with every ownership writer trigger, so all five
-- authority representations are rechecked atomically with durable initiation.
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
  v_server_subject_count integer;
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

  SELECT pg_catalog.min(COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
         )),
         pg_catalog.count(DISTINCT COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
         ))::integer
  INTO v_server_subject, v_server_subject_count
  FROM auth.identities AS i
  WHERE i.user_id = p_user_id AND i.provider = 'apple';
  v_apple_required := v_server_subject_count > 0;

  IF v_apple_required THEN
    IF v_server_subject_count <> 1 OR v_server_subject IS NULL
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

CREATE OR REPLACE FUNCTION public.stage_account_apple_revocation(
  p_user_id uuid,
  p_apple_subject text,
  p_revocation_token text,
  p_token_type_hint text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Standalone Apple staging is unavailable; use the atomic immediate-deletion initiation RPC.'
    USING ERRCODE = '0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_apple_revoked(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_apple_subject text;
  v_rows integer;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  SELECT ps.apple_subject INTO v_apple_subject
  FROM public.account_deletion_provider_secrets AS ps
  JOIN public.account_deletion_state AS s ON s.user_id = ps.user_id
  WHERE ps.user_id = p_user_id
    AND s.initiation_kind = 'immediate'
    AND s.workflow_state = 'irreversible'
  FOR UPDATE OF ps;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple revocation cannot be marked without active immediate retry state.';
  END IF;

  UPDATE public.account_deletion_state
  SET apple_revoked_subject = v_apple_subject,
      apple_revoked_at = COALESCE(apple_revoked_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id
    AND initiation_kind = 'immediate'
    AND workflow_state = 'irreversible';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one immediate deletion state, updated %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.account_deletion_provider_secrets WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Apple retry secret, deleted %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_storage_deleted(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  UPDATE public.account_deletion_state
  SET storage_deleted_at = COALESCE(storage_deleted_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id
    AND initiation_kind = 'immediate'
    AND workflow_state = 'irreversible';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one immediate deletion state, updated %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_rows integer;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = p_user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state = 'irreversible'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: an active immediate workflow does not exist.'
      USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_memberships AS lm
    WHERE lm.user_id = p_user_id AND lm.role = 'owner' AND lm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.'
      USING ERRCODE = 'P0001';
  END IF;

  v_result := public.execute_account_deletion_pass2_impl(p_user_id);

  UPDATE public.account_deletion_state
  SET workflow_state = 'database_deleted',
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id
    AND initiation_kind = 'immediate'
    AND workflow_state = 'irreversible'
    AND database_deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one database-deleted state, updated %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_account_deletion_external_step(
  p_user_id uuid,
  p_step text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.account_deletion_state%ROWTYPE;
  v_rows integer;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  SELECT s.* INTO v_state
  FROM public.account_deletion_state AS s
  WHERE s.user_id = p_user_id
    AND s.initiation_kind = 'immediate'
    AND s.workflow_state = 'database_deleted'
    AND s.database_deleted_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Immediate external retry state does not exist.' USING ERRCODE = 'P0002';
  END IF;

  IF p_step = 'stripe' THEN
    UPDATE public.account_deletion_state
    SET stripe_completed_at = COALESCE(stripe_completed_at, pg_catalog.statement_timestamp()),
        stripe_customer_id = NULL, last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id AND workflow_state = 'database_deleted';
  ELSIF p_step = 'email' THEN
    UPDATE public.account_deletion_state
    SET email_completed_at = COALESCE(email_completed_at, pg_catalog.statement_timestamp()),
        completion_email = NULL, last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id AND workflow_state = 'database_deleted';
  ELSIF p_step = 'complete' THEN
    IF v_state.stripe_completed_at IS NULL OR v_state.email_completed_at IS NULL THEN
      RAISE EXCEPTION 'Required external deletion work is incomplete.';
    END IF;
    UPDATE public.account_deletion_state
    SET completed_at = COALESCE(completed_at, pg_catalog.statement_timestamp()),
        workflow_state = 'completed', last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id AND workflow_state = 'database_deleted';
  ELSE
    RAISE EXCEPTION 'Unknown account deletion external step.' USING ERRCODE = '22023';
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one external retry state, updated %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_account_deletion_retry_error(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.account_deletion_state
  SET last_error = 'External deletion attempt failed; retry is required.',
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id
    AND initiation_kind = 'immediate'
    AND workflow_state = 'database_deleted'
    AND database_deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one external retry state, updated %.', v_rows
      USING ERRCODE = 'P0002';
  END IF;
  RETURN TRUE;
END;
$function$;

-- Assignment guards ignore cancelled/failed/expired state rows. Completed
-- deletion remains blocked independently because its profile is deleted and
-- its auth user is absent.
CREATE OR REPLACE FUNCTION public.block_deleting_organization_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN RETURN NEW; END IF;
  IF NEW.owner_user_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.lock_account_deletion_user(NEW.owner_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.owner_user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.owner_user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state IN ('irreversible', 'database_deleted')
  ) THEN
    RAISE EXCEPTION 'Cannot assign organization ownership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_league_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_candidate uuid;
  v_candidates uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_candidates := ARRAY[NEW.owner_id, NEW.created_by];
  ELSE
    v_candidates := ARRAY[
      CASE WHEN NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN NEW.owner_id END,
      CASE WHEN NEW.created_by IS DISTINCT FROM OLD.created_by THEN NEW.created_by END
    ];
  END IF;
  FOR v_candidate IN
    SELECT candidate FROM pg_catalog.unnest(v_candidates) AS candidates(candidate)
    WHERE candidate IS NOT NULL GROUP BY candidate ORDER BY candidate
  LOOP
    PERFORM public.lock_account_deletion_user(v_candidate);
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles AS p JOIN auth.users AS u ON u.id = p.id
      WHERE p.id = v_candidate AND p.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.account_deletion_state AS s
      WHERE s.user_id = v_candidate
        AND s.initiation_kind = 'immediate'
        AND s.workflow_state IN ('irreversible', 'database_deleted')
    ) THEN
      RAISE EXCEPTION 'Cannot assign league ownership to a deleting, deleted, or authless profile.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_organization_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.lock_account_deletion_user(NEW.user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state IN ('irreversible', 'database_deleted')
  ) THEN
    RAISE EXCEPTION 'Cannot assign organization membership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_league_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.lock_account_deletion_user(NEW.user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state IN ('irreversible', 'database_deleted')
  ) THEN
    RAISE EXCEPTION 'Cannot assign league ownership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_league_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.lock_account_deletion_user(NEW.user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.user_id
      AND s.initiation_kind = 'immediate'
      AND s.workflow_state IN ('irreversible', 'database_deleted')
  ) THEN
    RAISE EXCEPTION 'Cannot assign league membership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

-- Server-only compatibility RPCs for the removed reminder workflow fail with
-- explicit v1 guidance and never mutate state.
CREATE OR REPLACE FUNCTION public.claim_account_deletion_reminders(
  p_now timestamptz,
  p_cutoff timestamptz,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid, user_id uuid, profile_email text, scheduled_for timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Scheduled account deletion reminders are unavailable in v1.'
    USING ERRCODE = '0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_deletion_reminder_sent(p_deletion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Scheduled account deletion reminders are unavailable in v1.'
    USING ERRCODE = '0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_account_deletion_reminder_claim(p_deletion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Scheduled account deletion reminders are unavailable in v1.'
    USING ERRCODE = '0A000';
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_immediate_account_deletion(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_account_deletion_retry_error(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_immediate_account_deletion(uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_retry_error(uuid)
  TO service_role;

ALTER FUNCTION public.prepare_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.begin_immediate_account_deletion(uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.mark_account_apple_revoked(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_account_storage_deleted(uuid) OWNER TO postgres;
ALTER FUNCTION public.execute_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.record_account_deletion_external_step(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.record_account_deletion_retry_error(uuid) OWNER TO postgres;
ALTER FUNCTION public.block_deleting_organization_owner() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_owner() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_organization_member() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_ownership() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_membership() OWNER TO postgres;

COMMIT;
