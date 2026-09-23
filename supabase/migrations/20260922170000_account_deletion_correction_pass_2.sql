BEGIN;

ALTER TABLE public.account_deletion_state
  ADD COLUMN apple_revoked_subject text;

-- Provider credentials are server-derived and kept only until Apple confirms
-- revocation and the confirmation is durably recorded in the same transaction.
CREATE TABLE public.account_deletion_provider_secrets (
  user_id uuid PRIMARY KEY
    REFERENCES public.account_deletion_state(user_id) ON DELETE CASCADE,
  apple_subject text NOT NULL CHECK (apple_subject <> ''),
  apple_revocation_token text NOT NULL CHECK (apple_revocation_token <> ''),
  apple_token_type_hint text NOT NULL
    CHECK (apple_token_type_hint IN ('refresh_token', 'access_token')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

ALTER TABLE public.account_deletion_provider_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_provider_secrets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_account_deletion_user(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-deletion:' || p_user_id::text, 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.validate_optional_deletion_relations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_relation text;
  v_kind "char";
  v_bad_column text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'push_device_tokens',
    'audit_logs',
    'stripe_payment_history'
  ]
  LOOP
    SELECT c.relkind INTO v_kind
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_relation;

    IF FOUND AND v_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Incompatible public.% relation kind.', v_relation;
    END IF;
  END LOOP;

  WITH expected(relation_name, column_name, type_oid, required_not_null) AS (
    VALUES
      ('push_device_tokens', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('push_device_tokens', 'user_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('audit_logs', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('audit_logs', 'user_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('audit_logs', 'details', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, FALSE),
      ('audit_logs', 'ip_address', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('audit_logs', 'user_agent', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('stripe_payment_history', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('stripe_payment_history', 'stripe_customer_id', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('stripe_payment_history', 'metadata', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, FALSE)
  )
  SELECT e.relation_name || '.' || e.column_name INTO v_bad_column
  FROM expected AS e
  WHERE pg_catalog.to_regclass('public.' || e.relation_name) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || e.relation_name)
        AND a.attname = e.column_name
        AND NOT a.attisdropped
        AND a.atttypid = e.type_oid
        AND a.attnotnull = e.required_not_null
    )
  LIMIT 1;

  IF v_bad_column IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible optional deletion column %.', v_bad_column;
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'push_device_tokens',
    'audit_logs',
    'stripe_payment_history'
  ]
  LOOP
    IF pg_catalog.to_regclass('public.' || v_relation) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint AS c
         JOIN pg_catalog.pg_attribute AS a
           ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.conrelid = pg_catalog.to_regclass('public.' || v_relation)
           AND c.contype = 'p'
           AND pg_catalog.array_length(c.conkey, 1) = 1
           AND a.attname = 'id'
       ) THEN
      RAISE EXCEPTION 'Incompatible public.% primary key.', v_relation;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_apple_revoked boolean;
  v_apple_subject text;
  v_apple_identity_count integer;
  v_apple_subject_count integer;
  v_apple_retry_ready boolean;
  v_staged_apple_subject text;
BEGIN
  PERFORM public.validate_optional_deletion_relations();
  PERFORM public.lock_account_deletion_user(p_user_id);

  SELECT p.* INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete account: active profile does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: auth user does not exist.' USING ERRCODE = 'P0002';
  END IF;

  -- These checks occur after the same per-user lock acquired by ownership
  -- writers, so ownership cannot be assigned between preflight and state insert.
  IF EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_members AS om
    WHERE om.user_id = p_user_id AND om.role = 'owner' AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leagues AS l WHERE l.owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_ownerships AS lo
    WHERE lo.user_id = p_user_id AND lo.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(DISTINCT COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''),
           NULLIF(i.identity_id, '')
         ))::integer,
         pg_catalog.min(COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''),
           NULLIF(i.identity_id, '')
         ))
  INTO v_apple_identity_count, v_apple_subject_count, v_apple_subject
  FROM auth.identities AS i
  WHERE i.user_id = p_user_id AND i.provider = 'apple';

  -- If provider unlinking races after a server-verified token was staged, the
  -- durable server token still has to be revoked and cleared before deletion.
  IF v_apple_identity_count = 0 THEN
    SELECT ps.apple_subject INTO v_staged_apple_subject
    FROM public.account_deletion_provider_secrets AS ps
    WHERE ps.user_id = p_user_id;
    IF FOUND THEN
      v_apple_identity_count := 1;
      v_apple_subject_count := 1;
      v_apple_subject := v_staged_apple_subject;
    END IF;
  END IF;

  IF v_apple_identity_count > 0
     AND (v_apple_subject_count <> 1 OR v_apple_subject IS NULL) THEN
    RAISE EXCEPTION 'Cannot establish a unique Apple account binding.';
  END IF;

  INSERT INTO public.account_deletion_state (
    user_id, stripe_customer_id, completion_email, updated_at
  ) VALUES (
    p_user_id, v_profile.stripe_customer_id, v_profile.email,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id = COALESCE(public.account_deletion_state.stripe_customer_id, EXCLUDED.stripe_customer_id),
    completion_email = COALESCE(public.account_deletion_state.completion_email, EXCLUDED.completion_email),
    updated_at = pg_catalog.statement_timestamp();

  -- Revocation proof is valid only for the exact server-derived identity.
  IF v_apple_identity_count > 0 THEN
    UPDATE public.account_deletion_state
    SET apple_revoked_at = NULL,
        apple_revoked_subject = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE user_id = p_user_id
      AND apple_revoked_at IS NOT NULL
      AND apple_revoked_subject IS DISTINCT FROM v_apple_subject;
  END IF;

  SELECT s.apple_revoked_at IS NOT NULL
         AND s.apple_revoked_subject = v_apple_subject
  INTO v_apple_revoked
  FROM public.account_deletion_state AS s
  WHERE s.user_id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_provider_secrets AS ps
    WHERE ps.user_id = p_user_id AND ps.apple_subject = v_apple_subject
  ) INTO v_apple_retry_ready;

  RETURN pg_catalog.jsonb_build_object(
    'apple_required', v_apple_identity_count > 0,
    'apple_revoked', COALESCE(v_apple_revoked, FALSE),
    'apple_subject', v_apple_subject,
    'apple_retry_ready', COALESCE(v_apple_retry_ready, FALSE)
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
DECLARE
  v_server_subject text;
  v_server_subject_count integer;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);

  SELECT pg_catalog.min(COALESCE(NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, ''))),
         pg_catalog.count(DISTINCT COALESCE(
           NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
         ))::integer
  INTO v_server_subject, v_server_subject_count
  FROM auth.identities AS i
  WHERE i.user_id = p_user_id AND i.provider = 'apple';

  IF v_server_subject_count <> 1
     OR v_server_subject IS NULL
     OR v_server_subject IS DISTINCT FROM p_apple_subject THEN
    RAISE EXCEPTION 'Apple identity does not match the authenticated account.';
  END IF;
  IF p_revocation_token IS NULL OR p_revocation_token = ''
     OR p_token_type_hint NOT IN ('refresh_token', 'access_token') THEN
    RAISE EXCEPTION 'Invalid Apple revocation retry payload.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = p_user_id AND s.apple_revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Account deletion state is unavailable for Apple revocation.';
  END IF;

  INSERT INTO public.account_deletion_provider_secrets (
    user_id, apple_subject, apple_revocation_token, apple_token_type_hint, updated_at
  ) VALUES (
    p_user_id, p_apple_subject, p_revocation_token, p_token_type_hint,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    apple_subject = EXCLUDED.apple_subject,
    apple_revocation_token = EXCLUDED.apple_revocation_token,
    apple_token_type_hint = EXCLUDED.apple_token_type_hint,
    updated_at = pg_catalog.statement_timestamp();
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_account_apple_revocation_retry(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret public.account_deletion_provider_secrets%ROWTYPE;
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  SELECT ps.* INTO v_secret
  FROM public.account_deletion_provider_secrets AS ps
  WHERE ps.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple revocation retry is unavailable.' USING ERRCODE = 'P0002';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'apple_subject', v_secret.apple_subject,
    'revocation_token', v_secret.apple_revocation_token,
    'token_type_hint', v_secret.apple_token_type_hint
  );
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
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  SELECT ps.apple_subject INTO v_apple_subject
  FROM public.account_deletion_provider_secrets AS ps
  WHERE ps.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple revocation cannot be marked without durable retry state.';
  END IF;

  UPDATE public.account_deletion_state
  SET apple_revoked_subject = v_apple_subject,
      apple_revoked_at = COALESCE(apple_revoked_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion state does not exist.' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.account_deletion_provider_secrets
  WHERE user_id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_deleting_organization_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.lock_account_deletion_user(NEW.owner_user_id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.owner_user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = NEW.owner_user_id
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
    SELECT candidate
    FROM pg_catalog.unnest(v_candidates) AS candidates(candidate)
    WHERE candidate IS NOT NULL
    GROUP BY candidate
    ORDER BY candidate
  LOOP
    PERFORM public.lock_account_deletion_user(v_candidate);
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN auth.users AS u ON u.id = p.id
      WHERE p.id = v_candidate AND p.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.account_deletion_state AS s
      WHERE s.user_id = v_candidate
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
    SELECT 1
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s WHERE s.user_id = NEW.user_id
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
    SELECT 1
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s WHERE s.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot assign league ownership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organizations_block_deleting_owner ON public.organizations;
CREATE TRIGGER organizations_block_deleting_owner
BEFORE INSERT OR UPDATE OF owner_user_id ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_organization_owner();

DROP TRIGGER IF EXISTS leagues_block_deleting_owner ON public.leagues;
CREATE TRIGGER leagues_block_deleting_owner
BEFORE INSERT OR UPDATE OF owner_id, created_by ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_league_owner();

DROP TRIGGER IF EXISTS organization_members_block_deleting_user ON public.organization_members;
CREATE TRIGGER organization_members_block_deleting_user
BEFORE INSERT OR UPDATE OF user_id, role, status ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_organization_member();

DROP TRIGGER IF EXISTS league_ownerships_block_deleting_user ON public.league_ownerships;
CREATE TRIGGER league_ownerships_block_deleting_user
BEFORE INSERT OR UPDATE OF user_id, role, league_id, organization_id ON public.league_ownerships
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_league_ownership();

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
  PERFORM public.lock_account_deletion_user(p_user_id);

  SELECT p.* INTO v_profile FROM public.profiles AS p
  WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete account: active profile does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations AS o WHERE o.owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_members AS om
    WHERE om.user_id = p_user_id AND om.role = 'owner' AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer organization ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leagues AS l WHERE l.owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_ownerships AS lo
    WHERE lo.user_id = p_user_id AND lo.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s
    WHERE s.user_id = p_user_id
      AND s.storage_deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.account_deletion_provider_secrets AS ps
        WHERE ps.user_id = p_user_id
      )
      AND (
        (
          s.apple_revoked_at IS NOT NULL
          AND s.apple_revoked_subject = (
            SELECT pg_catalog.min(COALESCE(
              NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
            ))
            FROM auth.identities AS i
            WHERE i.user_id = p_user_id AND i.provider = 'apple'
          )
          AND 1 = (
            SELECT pg_catalog.count(DISTINCT COALESCE(
              NULLIF(i.identity_data ->> 'sub', ''), NULLIF(i.identity_id, '')
            ))
            FROM auth.identities AS i
            WHERE i.user_id = p_user_id AND i.provider = 'apple'
          )
        )
        OR NOT EXISTS (
          SELECT 1 FROM auth.identities AS i
          WHERE i.user_id = p_user_id AND i.provider = 'apple'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: provider or storage cleanup is incomplete.';
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
  PERFORM public.delete_user_sessions(p_user_id);

  DELETE FROM public.password_reset_log
  WHERE user_id = p_user_id OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.login_attempts_log
  WHERE user_id = p_user_id OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.account_recovery_requests
  WHERE user_id = p_user_id OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  DELETE FROM public.password_reset_rate_limits
  WHERE pg_catalog.lower(identifier) = pg_catalog.lower(v_profile.email)
     OR identifier = p_user_id::text;

  -- Only completed-game participation facts survive. Open/future check-ins,
  -- availability, invitations, duties, and assignments are operational authority.
  UPDATE public.game_checkins AS gc
  SET note = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE gc.player_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gc.game_id AND g.status = 'completed'
    );
  DELETE FROM public.game_checkins AS gc
  WHERE gc.player_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gc.game_id AND g.status = 'completed'
    );

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

  UPDATE public.sub_invitations AS si
  SET message = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE si.status = 'accepted'
    AND (si.invited_by = p_user_id OR si.invited_player_id = p_user_id OR si.replaced_player_id = p_user_id)
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = si.game_id AND g.status = 'completed'
    );
  DELETE FROM public.sub_invitations AS si
  WHERE (si.invited_by = p_user_id OR si.invited_player_id = p_user_id OR si.replaced_player_id = p_user_id)
    AND NOT (
      si.status = 'accepted'
      AND EXISTS (
        SELECT 1 FROM public.games AS g
        WHERE g.id = si.game_id AND g.status = 'completed'
      )
    );
  DELETE FROM public.captain_player_invites
  WHERE target_player_id = p_user_id OR invited_by = p_user_id OR consumed_by = p_user_id;
  UPDATE public.league_spare_pool
  SET active = FALSE,
      notes = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id;
  UPDATE public.league_spare_pool
  SET added_by = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE added_by = p_user_id;
  DELETE FROM public.draft_pool WHERE player_id = p_user_id;
  DELETE FROM public.draft_picks AS dp
  WHERE dp.player_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.drafts AS d
      WHERE d.id = dp.draft_id AND d.status = 'completed'
    );
  UPDATE public.draft_picks
  SET picked_by = CASE WHEN picked_by = p_user_id THEN NULL ELSE picked_by END,
      undone_by = CASE WHEN undone_by = p_user_id THEN NULL ELSE undone_by END,
      idempotency_key = NULL
  WHERE player_id = p_user_id OR picked_by = p_user_id OR undone_by = p_user_id;
  DELETE FROM public.draft_roster_confirmations AS drc
  WHERE drc.confirmed_by = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.drafts AS d
      WHERE d.id = drc.draft_id AND d.status = 'completed'
    );
  UPDATE public.draft_roster_confirmations
  SET notes = NULL
  WHERE confirmed_by = p_user_id;
  UPDATE public.drafts SET created_by = NULL WHERE created_by = p_user_id;
  DELETE FROM public.season_opt_ins WHERE player_id = p_user_id;
  UPDATE public.duty_rotation_settings
  SET player_order = pg_catalog.array_remove(player_order, p_user_id::text),
      current_player_index = 0,
      rotation_enabled = CASE
        WHEN pg_catalog.cardinality(pg_catalog.array_remove(player_order, p_user_id::text)) = 0
          THEN FALSE
        ELSE rotation_enabled
      END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_order @> ARRAY[p_user_id::text];

  DELETE FROM public.game_duties AS gd
  WHERE gd.assigned_player_id = p_user_id
    AND NOT (
      gd.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM public.games AS g
        WHERE g.id = gd.game_id AND g.status = 'completed'
      )
    );
  UPDATE public.game_duties AS gd
  SET notes = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE gd.assigned_player_id = p_user_id
    AND gd.status = 'completed'
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gd.game_id AND g.status = 'completed'
    );
  DELETE FROM public.game_scorekeeper_assignments AS gsa
  WHERE gsa.scorekeeper_id = p_user_id
    AND NOT (
      gsa.completed_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.games AS g
        WHERE g.id = gsa.game_id AND g.status = 'completed'
      )
    );
  UPDATE public.game_scorekeeper_assignments AS gsa
  SET notes = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE gsa.scorekeeper_id = p_user_id
    AND gsa.completed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gsa.game_id AND g.status = 'completed'
    );
  DELETE FROM public.team_invites
  WHERE invited_by = p_user_id
     OR accepted_by = p_user_id
     OR pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);

  -- JSON lineups are another future-selection surface. Completed lineups retain
  -- the position fact with minimized display data; open/future lineups remove
  -- the player entirely.
  UPDATE public.game_team_lineups AS gtl
  SET layout_json = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          gtl.layout_json,
          '{roster}',
          COALESCE((
            SELECT pg_catalog.jsonb_agg(entry)
            FROM pg_catalog.jsonb_array_elements(
              CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'roster') = 'array'
                THEN gtl.layout_json -> 'roster' ELSE '[]'::jsonb END
            ) AS entry
            WHERE entry ->> 'playerId' <> p_user_id::text
          ), '[]'::jsonb),
          TRUE
        ),
        '{placedPlayers}',
        COALESCE((
            SELECT pg_catalog.jsonb_agg(entry)
            FROM pg_catalog.jsonb_array_elements(
              CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'placedPlayers') = 'array'
                THEN gtl.layout_json -> 'placedPlayers' ELSE '[]'::jsonb END
            ) AS entry
          WHERE entry ->> 'playerId' <> p_user_id::text
        ), '[]'::jsonb),
        TRUE
      ),
      published_by = CASE WHEN gtl.published_by = p_user_id THEN NULL ELSE gtl.published_by END,
      updated_by = CASE WHEN gtl.updated_by = p_user_id THEN NULL ELSE gtl.updated_by END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gtl.game_id AND g.status = 'completed'
    )
    AND (
      gtl.layout_json @> pg_catalog.jsonb_build_object(
        'roster', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('playerId', p_user_id::text))
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'roster') = 'array'
            THEN gtl.layout_json -> 'roster' ELSE '[]'::jsonb END
        ) AS entry
        WHERE entry ->> 'playerId' = p_user_id::text
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'placedPlayers') = 'array'
            THEN gtl.layout_json -> 'placedPlayers' ELSE '[]'::jsonb END
        ) AS entry
        WHERE entry ->> 'playerId' = p_user_id::text
      )
      OR gtl.published_by = p_user_id
      OR gtl.updated_by = p_user_id
    );
  UPDATE public.game_team_lineups AS gtl
  SET layout_json = pg_catalog.jsonb_set(
        gtl.layout_json,
        '{roster}',
        COALESCE((
          SELECT pg_catalog.jsonb_agg(
            CASE WHEN entry ->> 'playerId' = p_user_id::text
              THEN (entry - 'fullName' - 'avatarUrl')
                || pg_catalog.jsonb_build_object('fullName', 'Deleted User', 'avatarUrl', NULL)
              ELSE entry
            END
          )
          FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'roster') = 'array'
              THEN gtl.layout_json -> 'roster' ELSE '[]'::jsonb END
          ) AS entry
        ), '[]'::jsonb),
        TRUE
      ),
      published_by = CASE WHEN gtl.published_by = p_user_id THEN NULL ELSE gtl.published_by END,
      updated_by = CASE WHEN gtl.updated_by = p_user_id THEN NULL ELSE gtl.updated_by END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gtl.game_id AND g.status = 'completed'
    )
    AND (
      EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(gtl.layout_json -> 'roster') = 'array'
            THEN gtl.layout_json -> 'roster' ELSE '[]'::jsonb END
        ) AS entry
        WHERE entry ->> 'playerId' = p_user_id::text
      )
      OR gtl.published_by = p_user_id
      OR gtl.updated_by = p_user_id
    );

  -- Retained paid/waiver facts are minimized; incomplete registration work is deleted.
  UPDATE public.registration_submissions
  SET status = 'cancelled',
      assigned_team_id = NULL, team_id = NULL, assigned_jersey_number = NULL,
      draft_data = NULL, photo_url = NULL, previous_leagues = NULL,
      rejection_reason = NULL, review_notes = NULL,
      reviewed_by = CASE WHEN reviewed_by = p_user_id THEN NULL ELSE reviewed_by END,
      stripe_checkout_session_id = NULL, stripe_payment_intent_id = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id
    AND (waiver_id IS NOT NULL OR COALESCE(amount_paid_cents, 0) > 0);
  DELETE FROM public.registration_submissions
  WHERE player_id = p_user_id
    AND waiver_id IS NULL AND COALESCE(amount_paid_cents, 0) = 0;
  UPDATE public.player_waivers SET user_agent = NULL WHERE player_id = p_user_id;

  UPDATE public.payment_transactions AS pt
  SET stripe_charge_id = NULL, stripe_payment_intent_id = NULL,
      stripe_refund_id = NULL, idempotency_key = NULL,
      metadata = NULL, description = NULL
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
  UPDATE public.player_payment_audit_log
  SET payload = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      stripe_event_id = NULL,
      created_by = NULL
  WHERE created_by = p_user_id;
  UPDATE public.player_payments
  SET stripe_checkout_session_id = NULL, stripe_customer_id = NULL,
      stripe_subscription_id = NULL, metadata = NULL, notes = NULL,
      archived_reason = NULL, archived_by = NULL,
      last_reminder_sent_at = NULL, reminder_sent_count = 0,
      next_payment_date = NULL, updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id;
  UPDATE public.payments
  SET notes = NULL, stripe_payment_intent_id = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE player_id = p_user_id OR entered_by = p_user_id;
  UPDATE public.player_payment_deletion_log
  SET payment_snapshot = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      delete_reason = 'Account deleted', deleted_by = NULL
  WHERE player_id = p_user_id OR deleted_by = p_user_id;
  UPDATE public.payment_disputes AS pd
  SET admin_notes = NULL,
      metadata = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      created_by = CASE WHEN pd.created_by = p_user_id THEN NULL ELSE pd.created_by END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE pd.created_by = p_user_id
     OR pd.player_payment_id IN (
       SELECT pp.id FROM public.player_payments AS pp WHERE pp.player_id = p_user_id
     );
  UPDATE public.stripe_connect_payments
  SET customer_email = NULL,
      metadata = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      description = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE pg_catalog.lower(customer_email) = pg_catalog.lower(v_profile.email);
  UPDATE public.stripe_connect_audit_log
  SET payload = pg_catalog.jsonb_build_object('_retained_financial_audit', TRUE),
      created_by = NULL
  WHERE created_by = p_user_id;
  DELETE FROM public.contact_submissions
  WHERE pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  UPDATE public.league_staff
  SET name = 'Deleted User', email = NULL, phone = NULL, photo_url = NULL,
      bio = NULL, is_active = FALSE, updated_at = pg_catalog.statement_timestamp()
  WHERE pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);
  UPDATE public.team_registration_requests
  SET team_contact_email = NULL,
      team_contact_phone = CASE
        WHEN team_contact_phone = v_profile.phone THEN NULL ELSE team_contact_phone
      END
  WHERE pg_catalog.lower(team_contact_email) = pg_catalog.lower(v_profile.email);
  UPDATE public.team_registrations
  SET backup_rep_email = NULL,
      backup_rep_name = NULL
  WHERE pg_catalog.lower(backup_rep_email) = pg_catalog.lower(v_profile.email);
  UPDATE public.teams
  SET contact_email = NULL,
      contact_phone = CASE WHEN contact_phone = v_profile.phone THEN NULL ELSE contact_phone END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE pg_catalog.lower(contact_email) = pg_catalog.lower(v_profile.email);
  UPDATE public.leagues
  SET contact_email = NULL,
      contact_phone = CASE WHEN contact_phone = v_profile.phone THEN NULL ELSE contact_phone END,
      updated_at = pg_catalog.statement_timestamp()
  WHERE pg_catalog.lower(contact_email) = pg_catalog.lower(v_profile.email);

  UPDATE public.teams
  SET captain_id = NULL, updated_at = pg_catalog.statement_timestamp()
  WHERE captain_id = p_user_id;
  UPDATE public.games SET unlocked_by = NULL WHERE unlocked_by = p_user_id;
  UPDATE public.season_fees SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.league_scorekeepers
  SET can_edit_games = FALSE, can_verify_games = FALSE, is_active = FALSE,
      status = 'inactive', display_name = 'Deleted User', email = NULL,
      phone = NULL, notes = NULL, preferred_days = NULL,
      max_games_per_week = NULL, updated_at = pg_catalog.statement_timestamp()
  WHERE scorekeeper_id = p_user_id;
  DELETE FROM public.scorekeeper_swap_requests
  WHERE requesting_scorekeeper_id IN (
      SELECT ls.id FROM public.league_scorekeepers AS ls WHERE ls.scorekeeper_id = p_user_id
    )
     OR accepting_scorekeeper_id IN (
      SELECT ls.id FROM public.league_scorekeepers AS ls WHERE ls.scorekeeper_id = p_user_id
    );
  UPDATE public.team_staff
  SET is_active = FALSE, end_date = COALESCE(end_date, CURRENT_DATE),
      notes = NULL, updated_at = pg_catalog.statement_timestamp()
  WHERE user_id = p_user_id;
  DELETE FROM public.scorekeeper_availability WHERE scorekeeper_id = p_user_id;
  UPDATE public.scorekeeper_availability SET created_by = NULL WHERE created_by = p_user_id;
  DELETE FROM public.scorekeeper_sessions
  WHERE scorekeeper_id = p_user_id OR created_by = p_user_id
     OR deactivated_by = p_user_id OR initiating_captain_id = p_user_id;
  UPDATE public.leagues SET created_by = NULL WHERE created_by = p_user_id;
  DELETE FROM public.league_ownerships WHERE user_id = p_user_id;
  UPDATE public.organization_members SET invited_by = NULL WHERE invited_by = p_user_id;
  DELETE FROM public.organization_members WHERE user_id = p_user_id;

  DELETE FROM public.league_join_requests WHERE user_id = p_user_id;
  UPDATE public.league_join_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  DELETE FROM public.team_join_requests WHERE player_id = p_user_id;
  UPDATE public.team_join_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  DELETE FROM public.player_approvals WHERE player_id = p_user_id;
  UPDATE public.player_approvals SET approved_by = NULL, notes = NULL WHERE approved_by = p_user_id;
  DELETE FROM public.suspensions
  WHERE player_id = p_user_id
    AND COALESCE(status, '') NOT IN ('served', 'denied');
  UPDATE public.suspensions
  SET appeal_reason = NULL, internal_notes = NULL, review_notes = NULL,
      appeal_requested_by = CASE WHEN appeal_requested_by = p_user_id THEN NULL ELSE appeal_requested_by END,
      reviewed_by = CASE WHEN reviewed_by = p_user_id THEN NULL ELSE reviewed_by END
  WHERE player_id = p_user_id
     OR appeal_requested_by = p_user_id
     OR reviewed_by = p_user_id;
  DELETE FROM public.bug_reports WHERE reporter_id = p_user_id;
  UPDATE public.bug_reports SET resolved_by = NULL WHERE resolved_by = p_user_id;
  DELETE FROM public.draft_messages WHERE user_id = p_user_id;
  DELETE FROM public.email_drafts WHERE created_by = p_user_id;
  DELETE FROM public.team_registration_requests WHERE requester_id = p_user_id;
  UPDATE public.team_registration_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  DELETE FROM public.team_registrations WHERE submitted_by = p_user_id;
  UPDATE public.team_registrations SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  UPDATE public.admin_audit_log
  SET details = NULL, ip_address = NULL, user_agent = NULL,
      target_user_id = NULL, target_entity_id = NULL
  WHERE admin_user_id = p_user_id OR target_user_id = p_user_id;
  UPDATE public.game_audit_log
  SET previous_data = NULL, new_data = NULL, reason = NULL
  WHERE changed_by = p_user_id;

  DELETE FROM public.game_submissions AS gs
  WHERE (
      gs.home_captain_id = p_user_id OR gs.away_captain_id = p_user_id
      OR gs.submitted_by = p_user_id OR gs.verified_by = p_user_id
      OR gs.disputed_by = p_user_id OR gs.dispute_resolved_by = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gs.game_id AND g.status = 'completed'
    );
  UPDATE public.game_submissions AS gs
  SET home_captain_device = NULL,
      home_captain_ip = NULL,
      away_captain_device = NULL,
      away_captain_ip = NULL,
      dispute_reason = NULL,
      dispute_resolution = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE (
      gs.home_captain_id = p_user_id OR gs.away_captain_id = p_user_id
      OR gs.submitted_by = p_user_id OR gs.verified_by = p_user_id
      OR gs.disputed_by = p_user_id OR gs.dispute_resolved_by = p_user_id
    )
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gs.game_id AND g.status = 'completed'
    );

  DELETE FROM public.goalie_request_notifications
  WHERE request_id IN (
    SELECT gr.id FROM public.goalie_requests AS gr WHERE gr.requested_by = p_user_id
  );
  UPDATE public.goalie_requests SET notes = NULL, compensation = NULL
  WHERE requested_by = p_user_id
    AND status = 'filled'
    AND EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = goalie_requests.game_id AND g.status = 'completed'
    );
  DELETE FROM public.goalie_requests AS gr
  WHERE gr.requested_by = p_user_id
    AND NOT (
      gr.status = 'filled'
      AND EXISTS (
        SELECT 1 FROM public.games AS g
        WHERE g.id = gr.game_id AND g.status = 'completed'
      )
    );
  UPDATE public.goalie_ratings SET private_note = NULL WHERE rated_by = p_user_id;

  -- Goalie-pool rows do not carry a profile FK, but repository workflows key
  -- them by the same normalized email. Deactivate and minimize exact matches.
  DELETE FROM public.goalie_request_notifications AS grn
  WHERE grn.goalie_id IN (
    SELECT gp.id FROM public.goalie_pool AS gp
    WHERE pg_catalog.lower(gp.email) = pg_catalog.lower(v_profile.email)
  );
  UPDATE public.goalie_requests AS gr
  SET filled_by = NULL,
      filled_at = NULL,
      status = 'cancelled',
      notes = NULL,
      compensation = NULL
  WHERE gr.filled_by IN (
      SELECT gp.id FROM public.goalie_pool AS gp
      WHERE pg_catalog.lower(gp.email) = pg_catalog.lower(v_profile.email)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = gr.game_id AND g.status = 'completed'
    );
  UPDATE public.goalie_pool
  SET name = 'Deleted User',
      email = 'deleted_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || '@deleted.local',
      phone = NULL,
      availability = '{}'::jsonb,
      preferred_arenas = ARRAY[]::text[],
      status = 'inactive',
      verification_token = pg_catalog.gen_random_uuid(),
      updated_at = pg_catalog.statement_timestamp()
  WHERE pg_catalog.lower(email) = pg_catalog.lower(v_profile.email);

  DELETE FROM public.team_rosters AS tr
  WHERE tr.player_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.season_id = tr.season_id
        AND (g.home_team_id = tr.team_id OR g.away_team_id = tr.team_id)
        AND g.status = 'completed'
        AND tr.start_date <= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date
        AND (tr.end_date IS NULL OR tr.end_date >= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date)
    );
  UPDATE public.team_rosters AS tr
  SET status = 'inactive',
      end_date = COALESCE((
        SELECT pg_catalog.max((g.scheduled_at AT TIME ZONE 'America/Toronto')::date)
        FROM public.games AS g
        WHERE g.season_id = tr.season_id
          AND (g.home_team_id = tr.team_id OR g.away_team_id = tr.team_id)
          AND g.status = 'completed'
          AND tr.start_date <= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date
          AND (tr.end_date IS NULL OR tr.end_date >= (g.scheduled_at AT TIME ZONE 'America/Toronto')::date)
      ), tr.end_date),
      leadership_role = NULL, notes = NULL,
      historical_retained = TRUE, updated_at = pg_catalog.statement_timestamp()
  WHERE tr.player_id = p_user_id;
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
    'success', TRUE, 'user_id', p_user_id,
    'team_rosters_retained', v_rosters_retained,
    'auth_users_deleted', v_auth_users_deleted,
    'external_cleanup_pending', TRUE
  );
END;
$function$;

-- Pin the complete privileged call graph, not just the entrypoint functions.
ALTER TABLE public.account_deletion_provider_secrets OWNER TO postgres;

ALTER FUNCTION public.require_auth_for_active_profile() SECURITY DEFINER;
ALTER FUNCTION public.require_auth_for_active_profile() SET search_path = '';
ALTER FUNCTION public.require_auth_for_active_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.require_auth_for_active_profile() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.preserve_auth_for_active_profile() SECURITY DEFINER;
ALTER FUNCTION public.preserve_auth_for_active_profile() SET search_path = '';
ALTER FUNCTION public.preserve_auth_for_active_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preserve_auth_for_active_profile() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.anonymize_audit_logs(uuid) SECURITY DEFINER;
ALTER FUNCTION public.anonymize_audit_logs(uuid) SET search_path = '';
ALTER FUNCTION public.anonymize_audit_logs(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.anonymize_audit_logs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_audit_logs(uuid) TO service_role;

ALTER FUNCTION public.delete_user_sessions(uuid) SECURITY DEFINER;
ALTER FUNCTION public.delete_user_sessions(uuid) SET search_path = '';
ALTER FUNCTION public.delete_user_sessions(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_sessions(uuid) TO service_role;

ALTER FUNCTION public.delete_push_device_tokens(uuid) SECURITY DEFINER;
ALTER FUNCTION public.delete_push_device_tokens(uuid) SET search_path = '';
ALTER FUNCTION public.delete_push_device_tokens(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_push_device_tokens(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_device_tokens(uuid) TO service_role;

ALTER FUNCTION public.anonymize_payment_history(uuid, text) SECURITY DEFINER;
ALTER FUNCTION public.anonymize_payment_history(uuid, text) SET search_path = '';
ALTER FUNCTION public.anonymize_payment_history(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.anonymize_payment_history(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_payment_history(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.lock_account_deletion_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_optional_deletion_relations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_account_apple_revocation(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_account_apple_revocation_retry(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_account_apple_revoked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_account_storage_deleted(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_account_deletion_external_step(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_deleting_organization_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_deleting_league_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_deleting_organization_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_deleting_league_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_account_deletion(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_account_apple_revocation(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_apple_revocation_retry(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_apple_revoked(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_storage_deleted(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_external_step(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion(uuid) TO service_role;

ALTER FUNCTION public.lock_account_deletion_user(uuid) OWNER TO postgres;
ALTER FUNCTION public.validate_optional_deletion_relations() OWNER TO postgres;
ALTER FUNCTION public.prepare_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.stage_account_apple_revocation(uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.get_account_apple_revocation_retry(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_account_apple_revoked(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_account_storage_deleted(uuid) SECURITY DEFINER;
ALTER FUNCTION public.mark_account_storage_deleted(uuid) SET search_path = '';
ALTER FUNCTION public.mark_account_storage_deleted(uuid) OWNER TO postgres;
ALTER FUNCTION public.record_account_deletion_external_step(uuid, text) SECURITY DEFINER;
ALTER FUNCTION public.record_account_deletion_external_step(uuid, text) SET search_path = '';
ALTER FUNCTION public.record_account_deletion_external_step(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.block_deleting_organization_owner() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_owner() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_organization_member() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_ownership() OWNER TO postgres;
ALTER FUNCTION public.execute_account_deletion(uuid) OWNER TO postgres;

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
        'require_auth_for_active_profile', 'preserve_auth_for_active_profile',
        'anonymize_audit_logs', 'anonymize_payment_history',
        'delete_user_sessions', 'delete_push_device_tokens',
        'lock_account_deletion_user', 'validate_optional_deletion_relations',
        'prepare_account_deletion', 'stage_account_apple_revocation',
        'get_account_apple_revocation_retry', 'mark_account_apple_revoked',
        'mark_account_storage_deleted', 'record_account_deletion_external_step',
        'block_deleting_organization_owner', 'block_deleting_league_owner',
        'block_deleting_organization_member', 'block_deleting_league_ownership',
        'execute_account_deletion'
      )
      AND rp.grantee NOT IN ('postgres', 'supabase_admin', 'service_role')
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

DO $catalog$
DECLARE
  v_bad_function text;
BEGIN
  SELECT p.oid::pg_catalog.regprocedure::text INTO v_bad_function
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'require_auth_for_active_profile', 'preserve_auth_for_active_profile',
      'anonymize_audit_logs', 'anonymize_payment_history',
      'delete_user_sessions', 'delete_push_device_tokens',
      'lock_account_deletion_user', 'validate_optional_deletion_relations',
      'prepare_account_deletion', 'stage_account_apple_revocation',
      'get_account_apple_revocation_retry', 'mark_account_apple_revoked',
      'mark_account_storage_deleted', 'record_account_deletion_external_step',
      'block_deleting_organization_owner', 'block_deleting_league_owner',
      'block_deleting_organization_member', 'block_deleting_league_ownership',
      'execute_account_deletion'
    )
    AND (
      NOT p.prosecdef
      OR p.proowner <> 'postgres'::pg_catalog.regrole
      OR NOT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
      OR p.proacl IS NULL
    )
  LIMIT 1;
  IF v_bad_function IS NOT NULL THEN
    RAISE EXCEPTION 'Privileged deletion function is not pinned: %', v_bad_function;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.require_auth_for_active_profile()', FALSE),
        ('public.preserve_auth_for_active_profile()', FALSE),
        ('public.anonymize_audit_logs(uuid)', TRUE),
        ('public.anonymize_payment_history(uuid,text)', TRUE),
        ('public.delete_user_sessions(uuid)', TRUE),
        ('public.delete_push_device_tokens(uuid)', TRUE),
        ('public.lock_account_deletion_user(uuid)', FALSE),
        ('public.validate_optional_deletion_relations()', FALSE),
        ('public.prepare_account_deletion(uuid)', TRUE),
        ('public.stage_account_apple_revocation(uuid,text,text,text)', TRUE),
        ('public.get_account_apple_revocation_retry(uuid)', TRUE),
        ('public.mark_account_apple_revoked(uuid)', TRUE),
        ('public.mark_account_storage_deleted(uuid)', TRUE),
        ('public.record_account_deletion_external_step(uuid,text)', TRUE),
        ('public.block_deleting_organization_owner()', FALSE),
        ('public.block_deleting_league_owner()', FALSE),
        ('public.block_deleting_organization_member()', FALSE),
        ('public.block_deleting_league_ownership()', FALSE),
        ('public.execute_account_deletion(uuid)', TRUE)
    ) AS expected(signature, service_expected)
    WHERE pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
          IS DISTINCT FROM expected.service_expected
  ) THEN
    RAISE EXCEPTION 'Unexpected effective deletion call-graph privileges.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges AS rp
    WHERE rp.specific_schema = 'public'
      AND rp.privilege_type = 'EXECUTE'
      AND rp.routine_name IN (
        'require_auth_for_active_profile', 'preserve_auth_for_active_profile',
        'anonymize_audit_logs', 'anonymize_payment_history',
        'delete_user_sessions', 'delete_push_device_tokens',
        'lock_account_deletion_user', 'validate_optional_deletion_relations',
        'prepare_account_deletion', 'stage_account_apple_revocation',
        'get_account_apple_revocation_retry', 'mark_account_apple_revoked',
        'mark_account_storage_deleted', 'record_account_deletion_external_step',
        'block_deleting_organization_owner', 'block_deleting_league_owner',
        'block_deleting_organization_member', 'block_deleting_league_ownership',
        'execute_account_deletion'
      )
      AND rp.grantee NOT IN ('postgres', 'supabase_admin', 'service_role')
  ) THEN
    RAISE EXCEPTION 'Unexpected deletion-function EXECUTE grantee remains.';
  END IF;
END;
$catalog$;

COMMIT;
