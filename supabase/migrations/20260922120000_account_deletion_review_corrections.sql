BEGIN;

ALTER TABLE public.team_rosters
  ADD COLUMN IF NOT EXISTS historical_retained boolean NOT NULL DEFAULT FALSE;

-- A retained profile cannot keep an ON DELETE CASCADE foreign key to an auth
-- row that must be removed. Drop every such FK, including installations where
-- the original constraint was renamed, and replace it with an active-row check.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $block$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.profiles'::pg_catalog.regclass
      AND c.confrelid = 'auth.users'::pg_catalog.regclass
      AND c.contype = 'f'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.profiles DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$block$;

CREATE OR REPLACE FUNCTION public.require_auth_for_active_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = NEW.id) THEN
    RAISE EXCEPTION 'Active profile % requires a matching auth user.', NEW.id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_require_auth_while_active ON public.profiles;
CREATE CONSTRAINT TRIGGER profiles_require_auth_while_active
AFTER INSERT OR UPDATE OF id, deleted_at ON public.profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_auth_for_active_profile();

CREATE OR REPLACE FUNCTION public.preserve_auth_for_active_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = OLD.id AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove auth user while profile is active.'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS auth_users_preserve_active_profiles ON auth.users;
CREATE TRIGGER auth_users_preserve_active_profiles
BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.preserve_auth_for_active_profile();

CREATE TABLE IF NOT EXISTS public.account_deletion_state (
  user_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  apple_revoked_at timestamptz,
  storage_deleted_at timestamptz,
  database_deleted_at timestamptz,
  stripe_customer_id text,
  stripe_completed_at timestamptz,
  completion_email text,
  email_completed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

ALTER TABLE public.account_deletion_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_optional_deletion_relations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind "char";
BEGIN
  SELECT c.relkind INTO v_kind
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'push_device_tokens';

  IF FOUND THEN
    IF v_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Incompatible public.push_device_tokens relation kind.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = 'public.push_device_tokens'::pg_catalog.regclass
        AND a.attname = 'user_id'
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'Incompatible public.push_device_tokens schema.';
    END IF;
  END IF;

  SELECT c.relkind INTO v_kind
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'audit_logs';

  IF FOUND THEN
    IF v_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Incompatible public.audit_logs relation kind.';
    END IF;
    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = 'public.audit_logs'::pg_catalog.regclass
        AND a.attname IN ('user_id', 'details', 'ip_address', 'user_agent')
        AND NOT a.attisdropped
    ) <> 4 THEN
      RAISE EXCEPTION 'Incompatible public.audit_logs schema.';
    END IF;
  END IF;

  SELECT c.relkind INTO v_kind
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'stripe_payment_history';

  IF FOUND THEN
    IF v_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Incompatible public.stripe_payment_history relation kind.';
    END IF;
    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = 'public.stripe_payment_history'::pg_catalog.regclass
        AND a.attname IN ('stripe_customer_id', 'metadata')
        AND NOT a.attisdropped
    ) <> 2 THEN
      RAISE EXCEPTION 'Incompatible public.stripe_payment_history schema.';
    END IF;
  END IF;
END;
$function$;

-- Keep the legacy function signature used by the master RPC, but describe and
-- implement this as minimization: the retained payment fact is not anonymous.
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
  v_updated_count integer := 0;
BEGIN
  IF p_stripe_customer_id IS NULL
     OR pg_catalog.to_regclass('public.stripe_payment_history') IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE $sql$
    UPDATE public.stripe_payment_history
    SET stripe_customer_id = NULL,
        metadata = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE)
    WHERE stripe_customer_id = $1
  $sql$
  USING p_stripe_customer_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;

COMMENT ON FUNCTION public.anonymize_payment_history(uuid, text) IS
  'Legacy-named helper that minimizes provider identifiers on legally retained payment history; retained rows are not anonymous.';

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_apple_revoked boolean;
  v_apple_required boolean;
BEGIN
  PERFORM public.validate_optional_deletion_relations();

  SELECT p.* INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot delete account: profile does not exist.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leagues AS l WHERE l.owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.account_deletion_state (
    user_id,
    stripe_customer_id,
    completion_email,
    updated_at
  ) VALUES (
    p_user_id,
    v_profile.stripe_customer_id,
    v_profile.email,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id = COALESCE(public.account_deletion_state.stripe_customer_id, EXCLUDED.stripe_customer_id),
    completion_email = COALESCE(public.account_deletion_state.completion_email, EXCLUDED.completion_email),
    updated_at = pg_catalog.statement_timestamp();

  SELECT s.apple_revoked_at IS NOT NULL INTO v_apple_revoked
  FROM public.account_deletion_state AS s
  WHERE s.user_id = p_user_id;

  SELECT EXISTS (
    SELECT 1 FROM auth.identities AS i
    WHERE i.user_id = p_user_id AND i.provider = 'apple'
  ) INTO v_apple_required;

  RETURN pg_catalog.jsonb_build_object(
    'apple_required', v_apple_required,
    'apple_revoked', COALESCE(v_apple_revoked, FALSE)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_apple_revoked(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.account_deletion_state
  SET apple_revoked_at = COALESCE(apple_revoked_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_storage_deleted(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.account_deletion_state
  SET storage_deleted_at = COALESCE(storage_deleted_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_organization_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.owner_user_id
      AND s.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign organization ownership while account deletion is in progress.';
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
BEGIN
  IF NEW.owner_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.owner_id
      AND s.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign league ownership while account deletion is in progress.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_current_push_destination()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required.' USING ERRCODE = '28000';
  END IF;

  UPDATE public.profiles
  SET push_token = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = v_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Expected one active profile push destination, updated %.', v_updated
      USING ERRCODE = 'P0002';
  END IF;
  RETURN TRUE;
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
BEGIN
  SELECT s.* INTO v_state
  FROM public.account_deletion_state AS s
  WHERE s.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion state does not exist.' USING ERRCODE = 'P0002';
  END IF;

  IF p_step = 'stripe' THEN
    UPDATE public.account_deletion_state
    SET stripe_completed_at = COALESCE(stripe_completed_at, pg_catalog.statement_timestamp()),
        stripe_customer_id = NULL,
        last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id;
    RETURN TRUE;
  ELSIF p_step = 'email' THEN
    UPDATE public.account_deletion_state
    SET email_completed_at = COALESCE(email_completed_at, pg_catalog.statement_timestamp()),
        completion_email = NULL,
        last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id;
    RETURN TRUE;
  ELSIF p_step = 'complete' THEN
    IF v_state.database_deleted_at IS NULL
       OR v_state.stripe_completed_at IS NULL
       OR v_state.email_completed_at IS NULL THEN
      RAISE EXCEPTION 'Required deletion work is incomplete.';
    END IF;

    UPDATE public.account_deletion_state
    SET completed_at = COALESCE(completed_at, pg_catalog.statement_timestamp()),
        last_error = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id;

    UPDATE public.account_deletion_log
    SET status = 'completed',
        completed_at = COALESCE(completed_at, pg_catalog.statement_timestamp()),
        profile_email = 'deleted@deleted.local',
        deletion_reason = NULL,
        ip_address = NULL,
        user_agent = NULL,
        stripe_customer_id = NULL,
        stripe_deleted = TRUE,
        stripe_deletion_error = NULL,
        error_message = NULL,
        completion_notification_sent = TRUE,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id
      AND status <> 'cancelled';
    RETURN TRUE;
  END IF;

  RAISE EXCEPTION 'Unknown account deletion external step.' USING ERRCODE = '22023';
END;
$function$;

DROP TRIGGER IF EXISTS organizations_block_deleting_owner ON public.organizations;
CREATE TRIGGER organizations_block_deleting_owner
BEFORE INSERT OR UPDATE OF owner_user_id ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_organization_owner();

DROP TRIGGER IF EXISTS leagues_block_deleting_owner ON public.leagues;
CREATE TRIGGER leagues_block_deleting_owner
BEFORE INSERT OR UPDATE OF owner_id ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_league_owner();

CREATE OR REPLACE VIEW public.player_season_stats AS
WITH stat_totals AS (
  SELECT ps.player_id, ps.season_id, ps.team_id,
    SUM(COALESCE(ps.goals, 0)) AS goals,
    SUM(COALESCE(ps.assists, 0)) AS assists
  FROM public.player_stats ps
  INNER JOIN public.games g ON g.id = ps.game_id AND g.status = 'completed'
  GROUP BY ps.player_id, ps.season_id, ps.team_id
),
appearances AS (
  SELECT DISTINCT tr.player_id, tr.season_id, tr.team_id, g.id AS game_id
  FROM public.team_rosters tr
  INNER JOIN public.games g
    ON g.season_id = tr.season_id
   AND g.status = 'completed'
   AND (g.home_team_id = tr.team_id OR g.away_team_id = tr.team_id)
  WHERE (tr.status = 'active' OR tr.historical_retained = TRUE)
    AND tr.player_type = 'regular'
    AND tr.start_date <= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date
    AND (tr.end_date IS NULL OR tr.end_date >= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date)
    AND NOT EXISTS (
      SELECT 1 FROM public.game_checkins gc
      WHERE gc.game_id = g.id AND gc.team_id = tr.team_id
        AND gc.player_id = tr.player_id AND gc.status = 'out'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.player_availability pa
      WHERE pa.game_id = g.id AND pa.team_id = tr.team_id
        AND pa.player_id = tr.player_id AND pa.status = 'out'
    )
  UNION
  SELECT DISTINCT si.invited_player_id, g.season_id, si.team_id, si.game_id
  FROM public.sub_invitations si
  INNER JOIN public.games g ON g.id = si.game_id AND g.status = 'completed'
  WHERE si.status = 'accepted' AND si.invited_player_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.game_checkins gc
      WHERE gc.game_id = si.game_id AND gc.team_id = si.team_id
        AND gc.player_id = si.invited_player_id AND gc.status = 'out'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.player_availability pa
      WHERE pa.game_id = si.game_id AND pa.team_id = si.team_id
        AND pa.player_id = si.invited_player_id AND pa.status = 'out'
    )
  UNION
  SELECT DISTINCT ps.player_id, ps.season_id, ps.team_id, ps.game_id
  FROM public.player_stats ps
  INNER JOIN public.games g ON g.id = ps.game_id AND g.status = 'completed'
),
appearance_totals AS (
  SELECT player_id, season_id, team_id, COUNT(DISTINCT game_id) AS games_played
  FROM appearances GROUP BY player_id, season_id, team_id
)
SELECT a.player_id, a.season_id, p.full_name,
  COALESCE(tr.jersey_number, p.jersey_number) AS jersey_number,
  tr.position::text AS position,
  t.name AS team_name, t.short_name AS team_short_name, t.primary_color AS team_color,
  a.games_played, COALESCE(st.goals, 0) AS goals, COALESCE(st.assists, 0) AS assists,
  COALESCE(st.goals, 0) + COALESCE(st.assists, 0) AS points,
  ROUND((COALESCE(st.goals, 0) + COALESCE(st.assists, 0))::numeric / NULLIF(a.games_played, 0), 2) AS points_per_game,
  a.team_id, t.division_id
FROM appearance_totals a
INNER JOIN public.profiles p ON p.id = a.player_id
INNER JOIN public.teams t ON t.id = a.team_id
LEFT JOIN stat_totals st ON st.player_id = a.player_id AND st.season_id = a.season_id AND st.team_id = a.team_id
LEFT JOIN public.team_rosters tr ON tr.player_id = a.player_id AND tr.season_id = a.season_id AND tr.team_id = a.team_id;

CREATE OR REPLACE FUNCTION public.execute_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_auth_users_deleted integer := 0;
  v_rosters_retained integer := 0;
BEGIN
  PERFORM public.validate_optional_deletion_relations();

  SELECT p.* INTO v_profile FROM public.profiles AS p
  WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot delete account: profile does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leagues AS l WHERE l.owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = p_user_id AND s.storage_deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: storage cleanup is not complete.';
  END IF;

  PERFORM public.anonymize_audit_logs(p_user_id);
  PERFORM public.anonymize_payment_history(p_user_id, v_profile.stripe_customer_id);

  DELETE FROM public.team_messages WHERE sent_by = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  PERFORM public.delete_push_device_tokens(p_user_id);
  DELETE FROM public.notification_delivery_log
  WHERE notification_id IN (
    SELECT n.id FROM public.notifications AS n WHERE n.user_id = p_user_id
  );
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  DELETE FROM public.user_notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.user_consents WHERE user_id = p_user_id;
  DELETE FROM public.user_sessions WHERE user_id = p_user_id;

  -- Authentication/security operations have no post-deletion purpose.
  DELETE FROM public.password_reset_log
  WHERE user_id = p_user_id
     OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.login_attempts_log
  WHERE user_id = p_user_id
     OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.account_recovery_requests
  WHERE user_id = p_user_id
     OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.password_reset_rate_limits
  WHERE pg_catalog.lower(identifier) = pg_catalog.lower(v_profile.email)
     OR identifier = p_user_id::text;

  -- Completed-game availability is a score/stat input. Keep the categorical
  -- fact, but remove the player's free-text reason. Future availability is
  -- operational and is erased.
  UPDATE public.player_availability AS pa
  SET reason = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE pa.player_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = pa.game_id AND g.status = 'completed'
    );
  DELETE FROM public.player_availability AS pa
  WHERE pa.player_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = pa.game_id AND g.status = 'completed'
    );

  -- Unsigned/unpaid registration workflow rows are operational. Paid or
  -- waiver-backed rows retain only the league/season/payment/roster facts.
  UPDATE public.registration_submissions
  SET draft_data = NULL,
      photo_url = NULL,
      previous_leagues = NULL,
      rejection_reason = NULL,
      review_notes = NULL,
      stripe_checkout_session_id = NULL,
      stripe_payment_intent_id = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id
    AND (waiver_id IS NOT NULL OR COALESCE(amount_paid_cents, 0) > 0);
  DELETE FROM public.registration_submissions
  WHERE player_id = p_user_id
    AND waiver_id IS NULL
    AND COALESCE(amount_paid_cents, 0) = 0;

  -- A signed waiver is legally retained and is not described as anonymized.
  -- The signed name, signature, IP, timestamps, version and content hash remain;
  -- the nonessential user-agent string is removed.
  UPDATE public.player_waivers
  SET user_agent = NULL
  WHERE player_id = p_user_id;

  -- Financial facts remain linked only to the anonymized historical profile.
  -- Provider handles, idempotency material, metadata and free text are erased.
  UPDATE public.payment_transactions AS pt
  SET stripe_charge_id = NULL,
      stripe_payment_intent_id = NULL,
      stripe_refund_id = NULL,
      idempotency_key = NULL,
      metadata = NULL,
      description = NULL
  WHERE pt.player_payment_id IN (
    SELECT pp.id FROM public.player_payments AS pp WHERE pp.player_id = p_user_id
  );
  UPDATE public.player_payment_audit_log AS pal
  SET payload = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      stripe_event_id = NULL,
      created_by = CASE WHEN pal.created_by = p_user_id THEN NULL ELSE pal.created_by END
  WHERE pal.player_payment_id IN (
    SELECT pp.id FROM public.player_payments AS pp WHERE pp.player_id = p_user_id
  );
  UPDATE public.player_payments
  SET stripe_checkout_session_id = NULL,
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      metadata = NULL,
      notes = NULL,
      archived_reason = NULL,
      archived_by = NULL,
      last_reminder_sent_at = NULL,
      reminder_sent_count = 0,
      next_payment_date = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id;
  UPDATE public.payments
  SET notes = NULL,
      stripe_payment_intent_id = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id OR entered_by = p_user_id;
  UPDATE public.player_payment_deletion_log
  SET payment_snapshot = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      delete_reason = 'Account deleted',
      deleted_by = NULL
  WHERE player_id = p_user_id OR deleted_by = p_user_id;

  -- Contact submissions have no user FK, but an exact normalized email match is
  -- a repository-proven indirect link to the authenticated profile.
  DELETE FROM public.contact_submissions
  WHERE pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);

  -- Remove authorization/current-participation paths that are independent of
  -- memberships or active roster status.
  UPDATE public.teams
  SET captain_id = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE captain_id = p_user_id;
  UPDATE public.league_scorekeepers
  SET can_edit_games = FALSE,
      can_verify_games = FALSE,
      is_active = FALSE,
      status = 'inactive',
      display_name = 'Deleted User',
      email = NULL,
      phone = NULL,
      notes = NULL,
      preferred_days = NULL,
      max_games_per_week = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE scorekeeper_id = p_user_id;
  UPDATE public.team_staff
  SET is_active = FALSE,
      end_date = COALESCE(end_date, CURRENT_DATE),
      notes = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;
  DELETE FROM public.scorekeeper_availability WHERE scorekeeper_id = p_user_id;
  UPDATE public.scorekeeper_availability SET created_by = NULL
  WHERE created_by = p_user_id;
  DELETE FROM public.scorekeeper_sessions
  WHERE scorekeeper_id = p_user_id
     OR created_by = p_user_id
     OR deactivated_by = p_user_id
     OR initiating_captain_id = p_user_id;
  DELETE FROM public.game_scorekeeper_assignments
  WHERE scorekeeper_id = p_user_id AND completed_at IS NULL;
  UPDATE public.game_scorekeeper_assignments SET notes = NULL
  WHERE scorekeeper_id = p_user_id AND completed_at IS NOT NULL;
  DELETE FROM public.game_duties AS gd
  WHERE gd.assigned_player_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gd.game_id AND g.status = 'completed'
    );
  UPDATE public.game_duties AS gd
  SET notes = NULL
  WHERE gd.assigned_player_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gd.game_id AND g.status = 'completed'
    );
  DELETE FROM public.season_opt_ins WHERE player_id = p_user_id;
  DELETE FROM public.team_invites
  WHERE invited_by = p_user_id OR accepted_by = p_user_id;
  UPDATE public.leagues SET created_by = NULL
  WHERE created_by = p_user_id;

  -- Current access/application workflows and user-authored diagnostic bundles
  -- are erased. Reviewer/approver links on other users' records are nullable
  -- and are removed without deleting those other users' requests.
  DELETE FROM public.league_join_requests WHERE user_id = p_user_id;
  UPDATE public.league_join_requests SET reviewed_by = NULL
  WHERE reviewed_by = p_user_id;
  DELETE FROM public.team_join_requests WHERE player_id = p_user_id;
  UPDATE public.team_join_requests SET reviewed_by = NULL
  WHERE reviewed_by = p_user_id;
  DELETE FROM public.player_approvals WHERE player_id = p_user_id;
  UPDATE public.player_approvals SET approved_by = NULL, notes = NULL
  WHERE approved_by = p_user_id;
  DELETE FROM public.bug_reports WHERE reporter_id = p_user_id;
  UPDATE public.bug_reports SET resolved_by = NULL
  WHERE resolved_by = p_user_id;
  DELETE FROM public.draft_messages WHERE user_id = p_user_id;
  DELETE FROM public.email_drafts WHERE created_by = p_user_id;
  DELETE FROM public.team_registration_requests WHERE requester_id = p_user_id;
  UPDATE public.team_registration_requests SET reviewed_by = NULL
  WHERE reviewed_by = p_user_id;
  DELETE FROM public.team_registrations WHERE submitted_by = p_user_id;
  UPDATE public.team_registrations SET reviewed_by = NULL
  WHERE reviewed_by = p_user_id;

  -- Retain only the action and timestamp portions of administrative/game audit
  -- entries attributable to this account. The actor UUID may still point at the
  -- anonymized historical profile, but all free-form and network data is gone.
  UPDATE public.admin_audit_log
  SET details = NULL,
      ip_address = NULL,
      user_agent = NULL,
      target_user_id = NULL,
      target_entity_id = NULL
  WHERE admin_user_id = p_user_id OR target_user_id = p_user_id;
  UPDATE public.game_audit_log
  SET previous_data = NULL,
      new_data = NULL,
      reason = NULL
  WHERE changed_by = p_user_id;

  UPDATE public.sub_invitations SET message = NULL
  WHERE status = 'accepted'
    AND (invited_by = p_user_id OR invited_player_id = p_user_id OR replaced_player_id = p_user_id);
  DELETE FROM public.sub_invitations WHERE status <> 'accepted'
    AND (invited_by = p_user_id OR invited_player_id = p_user_id OR replaced_player_id = p_user_id);
  DELETE FROM public.goalie_request_notifications
  WHERE request_id IN (SELECT gr.id FROM public.goalie_requests gr WHERE gr.requested_by = p_user_id);
  UPDATE public.goalie_requests SET notes = NULL, compensation = NULL
  WHERE requested_by = p_user_id AND status = 'filled';
  DELETE FROM public.goalie_requests WHERE requested_by = p_user_id AND status <> 'filled';
  UPDATE public.goalie_ratings SET private_note = NULL WHERE rated_by = p_user_id;
  UPDATE public.game_checkins SET note = NULL WHERE player_id = p_user_id;

  UPDATE public.team_rosters
  SET status = 'inactive',
      leadership_role = NULL,
      notes = NULL,
      historical_retained = TRUE,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id;
  GET DIAGNOSTICS v_rosters_retained = ROW_COUNT;

  DELETE FROM public.league_memberships WHERE user_id = p_user_id;

  UPDATE public.profiles SET
    deleted_at = pg_catalog.statement_timestamp(),
    deletion_scheduled_for = NULL, deletion_reason = NULL,
    deletion_ip_address = NULL, deletion_user_agent = NULL,
    email = 'deleted_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || '@deleted.local',
    full_name = 'Deleted User', avatar_url = NULL, photo_url = NULL,
    push_token = NULL, phone = NULL, city = NULL, province = NULL,
    emergency_contact_name = NULL, emergency_contact_phone = NULL,
    emergency_contact_relationship = NULL, medical_notes = NULL,
    stripe_customer_id = NULL, security_question = NULL, security_answer_hash = NULL,
    pending_legacy_match_ids = ARRAY[]::uuid[], legacy_player_id = NULL,
    is_legacy_import = FALSE, is_platform_admin = FALSE, role = NULL,
    failed_login_attempts = 0, last_failed_login_at = NULL, locked_until = NULL,
    password_changed_at = NULL, availability = NULL,
    updated_at = pg_catalog.statement_timestamp()
  WHERE id = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_auth_users_deleted = ROW_COUNT;
  IF v_auth_users_deleted <> 1 THEN
    RAISE EXCEPTION 'Cannot delete account: expected exactly one auth user.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.account_deletion_state
  SET database_deleted_at = COALESCE(database_deleted_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'team_rosters_retained', v_rosters_retained,
    'auth_users_deleted', v_auth_users_deleted,
    'external_cleanup_pending', TRUE
  );
END;
$function$;

-- Harden against inherited or default EXECUTE grants, including unknown roles.
REVOKE ALL ON FUNCTION public.require_auth_for_active_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preserve_auth_for_active_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_optional_deletion_relations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_account_apple_revoked(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_account_storage_deleted(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_deleting_organization_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_deleting_league_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_current_push_destination() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_account_deletion_external_step(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anonymize_payment_history(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_account_apple_revoked(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_account_storage_deleted(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_account_deletion(uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_apple_revoked(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_storage_deleted(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_current_push_destination() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_external_step(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.anonymize_payment_history(uuid, text) TO service_role;

ALTER FUNCTION public.require_auth_for_active_profile() OWNER TO postgres;
ALTER FUNCTION public.preserve_auth_for_active_profile() OWNER TO postgres;
ALTER FUNCTION public.validate_optional_deletion_relations() OWNER TO postgres;
ALTER FUNCTION public.prepare_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_account_apple_revoked(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_account_storage_deleted(uuid) OWNER TO postgres;
ALTER FUNCTION public.block_deleting_organization_owner() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_owner() OWNER TO postgres;
ALTER FUNCTION public.clear_current_push_destination() OWNER TO postgres;
ALTER FUNCTION public.record_account_deletion_external_step(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.execute_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.anonymize_payment_history(uuid, text) OWNER TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $acl$
DECLARE
  v_grant record;
  v_signature text;
BEGIN
  FOR v_grant IN
    SELECT rp.routine_name, rp.grantee
    FROM information_schema.routine_privileges AS rp
    WHERE rp.specific_schema = 'public'
      AND rp.privilege_type = 'EXECUTE'
      AND rp.routine_name IN (
        'anonymize_audit_logs',
        'anonymize_payment_history',
        'delete_user_sessions',
        'delete_push_device_tokens',
        'require_auth_for_active_profile',
        'preserve_auth_for_active_profile',
        'validate_optional_deletion_relations',
        'prepare_account_deletion',
        'mark_account_apple_revoked',
        'mark_account_storage_deleted',
        'block_deleting_organization_owner',
        'block_deleting_league_owner',
        'record_account_deletion_external_step',
        'execute_account_deletion',
        'clear_current_push_destination'
      )
      AND rp.grantee NOT IN ('postgres', 'supabase_admin')
      AND NOT (
        rp.grantee = 'service_role'
        OR (
          rp.grantee = 'authenticated'
          AND rp.routine_name = 'clear_current_push_destination'
        )
      )
  LOOP
    SELECT p.oid::pg_catalog.regprocedure::text INTO v_signature
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_grant.routine_name
    ORDER BY p.oid DESC
    LIMIT 1;
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %s FROM %I',
      v_signature,
      v_grant.grantee
    );
  END LOOP;
END;
$acl$;

COMMIT;
