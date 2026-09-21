BEGIN;

-- Correct the already-applied account-deletion RPC without changing historical
-- foreign keys or deleting hockey facts. All work performed by the master RPC
-- remains in the caller's transaction and therefore succeeds or rolls back as
-- one unit.

CREATE OR REPLACE FUNCTION public.anonymize_audit_logs(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated_count integer;
BEGIN
  IF pg_catalog.to_regclass('public.audit_logs') IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE $sql$
    UPDATE public.audit_logs
    SET
      details = pg_catalog.jsonb_build_object('_anonymized', true),
      ip_address = NULL,
      user_agent = NULL
    WHERE user_id = $1
  $sql$
  USING p_user_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anonymize_payment_history(
  p_user_id uuid,
  p_stripe_customer_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated_count integer;
BEGIN
  IF p_stripe_customer_id IS NULL
     OR pg_catalog.to_regclass('public.stripe_payment_history') IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE $sql$
    UPDATE public.stripe_payment_history
    SET
      stripe_customer_id = 'deleted_customer_' || pg_catalog.replace(
        pg_catalog.gen_random_uuid()::text,
        '-',
        ''
      ),
      metadata = pg_catalog.jsonb_build_object(
        '_anonymized', true,
        '_anonymized_at', pg_catalog.statement_timestamp()
      )
    WHERE stripe_customer_id = $2
  $sql$
  USING p_user_id, p_stripe_customer_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.user_sessions
  WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_audit_logs_anonymized integer := 0;
  v_payment_history_anonymized integer := 0;
  v_team_messages_deleted integer := 0;
  v_push_subscriptions_deleted integer := 0;
  v_notifications_deleted integer := 0;
  v_notification_preferences_deleted integer := 0;
  v_consents_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_team_rosters_deleted integer := 0;
  v_league_memberships_deleted integer := 0;
  v_auth_users_deleted integer := 0;
  v_deletion_logs_completed integer := 0;
  v_org_count integer := 0;
  v_stripe_customer_id text;
BEGIN
  SELECT p.stripe_customer_id
  INTO v_stripe_customer_id
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot delete account: profile % does not exist.', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_org_count
  FROM public.organizations AS o
  WHERE o.owner_user_id = p_user_id;

  IF v_org_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete account: user owns % organizations. Transfer ownership first.', v_org_count
      USING
        ERRCODE = 'P0001',
        HINT = 'Transfer organization ownership before deleting account';
  END IF;

  v_audit_logs_anonymized := public.anonymize_audit_logs(p_user_id);
  v_payment_history_anonymized := public.anonymize_payment_history(
    p_user_id,
    v_stripe_customer_id
  );

  DELETE FROM public.team_messages
  WHERE sent_by = p_user_id;
  GET DIAGNOSTICS v_team_messages_deleted = ROW_COUNT;

  DELETE FROM public.push_subscriptions
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_push_subscriptions_deleted = ROW_COUNT;

  DELETE FROM public.notifications
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.user_notification_preferences
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_notification_preferences_deleted = ROW_COUNT;

  DELETE FROM public.user_consents
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_consents_deleted = ROW_COUNT;

  DELETE FROM public.user_sessions
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

  DELETE FROM public.team_rosters
  WHERE player_id = p_user_id;
  GET DIAGNOSTICS v_team_rosters_deleted = ROW_COUNT;

  DELETE FROM public.league_memberships
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_league_memberships_deleted = ROW_COUNT;

  UPDATE public.profiles
  SET
    deleted_at = pg_catalog.statement_timestamp(),
    deletion_scheduled_for = NULL,
    deletion_reason = NULL,
    deletion_ip_address = NULL,
    deletion_user_agent = NULL,
    email = 'deleted_' || pg_catalog.replace(
      pg_catalog.gen_random_uuid()::text,
      '-',
      ''
    ) || '@deleted.local',
    full_name = 'Deleted User',
    avatar_url = NULL,
    phone = NULL,
    city = NULL,
    province = NULL,
    emergency_contact_name = NULL,
    emergency_contact_phone = NULL,
    emergency_contact_relationship = NULL,
    medical_notes = NULL,
    photo_url = NULL,
    stripe_customer_id = NULL,
    security_question = NULL,
    security_answer_hash = NULL,
    pending_legacy_match_ids = ARRAY[]::uuid[],
    legacy_player_id = NULL,
    is_legacy_import = FALSE,
    is_platform_admin = FALSE,
    role = NULL,
    failed_login_attempts = 0,
    last_failed_login_at = NULL,
    locked_until = NULL,
    password_changed_at = NULL,
    availability = NULL,
    updated_at = pg_catalog.statement_timestamp()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot delete account: profile % disappeared before anonymization.', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM auth.users
  WHERE id = p_user_id;
  GET DIAGNOSTICS v_auth_users_deleted = ROW_COUNT;

  IF v_auth_users_deleted <> 1 THEN
    RAISE EXCEPTION 'Cannot delete account: expected one auth user for %, deleted %.',
      p_user_id,
      v_auth_users_deleted
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: retained profile % was removed with auth user.', p_user_id
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.account_deletion_log
  SET
    status = 'completed',
    completed_at = pg_catalog.statement_timestamp(),
    error_message = NULL,
    updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id
    AND status = 'processing';
  GET DIAGNOSTICS v_deletion_logs_completed = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'audit_logs_anonymized', v_audit_logs_anonymized,
    'payment_history_anonymized', v_payment_history_anonymized,
    'team_messages_deleted', v_team_messages_deleted,
    'push_subscriptions_deleted', v_push_subscriptions_deleted,
    'notifications_deleted', v_notifications_deleted,
    'notification_preferences_deleted', v_notification_preferences_deleted,
    'consents_deleted', v_consents_deleted,
    'sessions_deleted', v_sessions_deleted,
    'team_rosters_deleted', v_team_rosters_deleted,
    'league_memberships_deleted', v_league_memberships_deleted,
    'auth_users_deleted', v_auth_users_deleted,
    'deletion_logs_completed', v_deletion_logs_completed,
    'deleted_at', pg_catalog.statement_timestamp()
  );
END;
$function$;

COMMENT ON FUNCTION public.anonymize_audit_logs(uuid) IS
  'Anonymizes retained audit metadata when public.audit_logs exists; returns zero otherwise.';
COMMENT ON FUNCTION public.anonymize_payment_history(uuid, text) IS
  'Anonymizes retained payment metadata when public.stripe_payment_history exists; returns zero otherwise.';
COMMENT ON FUNCTION public.delete_user_sessions(uuid) IS
  'Deletes application session rows for one user.';
COMMENT ON FUNCTION public.execute_account_deletion(uuid) IS
  'Atomically deletes account-facing data and auth access while retaining an anonymized profile for hockey history.';

REVOKE EXECUTE ON FUNCTION public.anonymize_audit_logs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.anonymize_payment_history(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_account_deletion(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.anonymize_audit_logs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.anonymize_payment_history(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_sessions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion(uuid) TO service_role;

COMMIT;
