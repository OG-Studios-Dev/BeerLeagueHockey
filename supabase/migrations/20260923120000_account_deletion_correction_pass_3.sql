BEGIN;

-- Forward-only correction pass 3. Earlier account-deletion migrations may
-- already be installed and are intentionally left unchanged.

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS reminder_7day_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_7day_attempts integer NOT NULL DEFAULT 0;

ALTER FUNCTION public.validate_optional_deletion_relations()
  RENAME TO validate_optional_deletion_relations_pass2_impl;

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
  PERFORM public.validate_optional_deletion_relations_pass2_impl();

  FOREACH v_relation IN ARRAY ARRAY[
    'league_referees', 'referee_availability', 'referee_sessions',
    'referee_swap_requests', 'game_officials', 'season_team_returns',
    'season_team_return_campaigns', 'notification_send_log',
    'league_backup_tokens', 'league_migration_requests', 'team_invoices',
    'team_invoice_payments', 'league_finance_custom_items',
    'league_quickbooks_connections', 'league_quickbooks_mappings',
    'league_quickbooks_sync_runs', 'league_quickbooks_sync_entries',
    'player_career_baselines', 'player_rating_contexts', 'draft_auto_pick_log',
    'schedule_rules', 'season_fees',
    'sponsor_placements', 'stat_definitions'
  ] LOOP
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
      ('league_referees', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'display_name', 'pg_catalog.text'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'email', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'phone', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'status', 'pg_catalog.text'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'notes', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'referee_identifier', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'default_jersey_number', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('league_referees', 'solo_game_fee_cents', 'pg_catalog.int4'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'paired_game_fee_cents', 'pg_catalog.int4'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'linesman_fee_cents', 'pg_catalog.int4'::pg_catalog.regtype::oid, TRUE),
      ('league_referees', 'single_game_fee_cents', 'pg_catalog.int4'::pg_catalog.regtype::oid, TRUE),
      ('referee_availability', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_availability', 'referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_availability', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_availability', 'notes', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('referee_sessions', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_sessions', 'token', 'pg_catalog.text'::pg_catalog.regtype::oid, TRUE),
      ('referee_sessions', 'league_referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_sessions', 'referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_sessions', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_sessions', 'deactivated_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_sessions', 'device_info', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, FALSE),
      ('referee_swap_requests', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_swap_requests', 'game_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_swap_requests', 'requesting_referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('referee_swap_requests', 'accepting_referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('referee_swap_requests', 'resolved_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('game_officials', 'game_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('game_officials', 'league_referee_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'assigned_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'notes', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'payment_amount_cents', 'pg_catalog.int4'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'payment_rule_applied', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('game_officials', 'referee_identifier_snapshot', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('season_team_returns', 'captain_profile_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'captain_email', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'captain_phone', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'notes', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'internal_notes', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'declined_reason', 'pg_catalog.text'::pg_catalog.regtype::oid, FALSE),
      ('season_team_returns', 'metadata', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, TRUE),
      ('season_team_return_campaigns', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('season_team_return_campaigns', 'sent_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('notification_send_log', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('notification_send_log', 'user_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('notification_send_log', 'payload', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, TRUE),
      ('league_backup_tokens', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_backup_tokens', 'token_hash', 'pg_catalog.text'::pg_catalog.regtype::oid, TRUE),
      ('league_backup_tokens', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_migration_requests', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_migration_requests', 'requested_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_migration_requests', 'status', 'pg_catalog.text'::pg_catalog.regtype::oid, TRUE),
      ('team_invoices', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('team_invoices', 'paid_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('team_invoice_payments', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('team_invoice_payments', 'recorded_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_finance_custom_items', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_finance_custom_items', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_finance_custom_items', 'updated_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_quickbooks_connections', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_quickbooks_connections', 'connected_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_quickbooks_mappings', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_quickbooks_mappings', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_quickbooks_mappings', 'updated_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_quickbooks_sync_runs', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_quickbooks_sync_runs', 'requested_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('league_quickbooks_sync_entries', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('league_quickbooks_sync_entries', 'payload_snapshot', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, TRUE),
      ('league_quickbooks_sync_entries', 'response_snapshot', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, FALSE),
      ('player_career_baselines', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('player_career_baselines', 'player_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE),
      ('player_career_baselines', 'source_metadata', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, TRUE),
      ('player_rating_contexts', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('player_rating_contexts', 'player_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE),
      ('player_rating_contexts', 'stats_json', 'pg_catalog.jsonb'::pg_catalog.regtype::oid, TRUE)
      ,('draft_auto_pick_log', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE)
      ,('draft_auto_pick_log', 'player_id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE)
      ,('schedule_rules', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE)
      ,('schedule_rules', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE)
      ,('season_fees', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE)
      ,('season_fees', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE)
      ,('sponsor_placements', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE)
      ,('sponsor_placements', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE)
      ,('stat_definitions', 'id', 'pg_catalog.uuid'::pg_catalog.regtype::oid, TRUE)
      ,('stat_definitions', 'created_by', 'pg_catalog.uuid'::pg_catalog.regtype::oid, FALSE)
  )
  SELECT e.relation_name || '.' || e.column_name INTO v_bad_column
  FROM expected AS e
  WHERE pg_catalog.to_regclass('public.' || e.relation_name) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || e.relation_name)
        AND a.attname = e.column_name AND NOT a.attisdropped
        AND a.atttypid = e.type_oid AND a.attnotnull = e.required_not_null
    )
  LIMIT 1;
  IF v_bad_column IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible pass-3 deletion column %.', v_bad_column;
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'league_referees', 'referee_availability', 'referee_sessions',
    'referee_swap_requests', 'game_officials', 'season_team_returns',
    'season_team_return_campaigns', 'notification_send_log',
    'league_backup_tokens', 'league_migration_requests', 'team_invoices',
    'team_invoice_payments', 'league_finance_custom_items',
    'league_quickbooks_connections', 'league_quickbooks_mappings',
    'league_quickbooks_sync_runs', 'league_quickbooks_sync_entries',
    'player_career_baselines', 'player_rating_contexts', 'draft_auto_pick_log',
    'schedule_rules', 'season_fees',
    'sponsor_placements', 'stat_definitions'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || v_relation) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint AS c
         JOIN pg_catalog.pg_attribute AS a
           ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.conrelid = pg_catalog.to_regclass('public.' || v_relation)
           AND c.contype = 'p' AND pg_catalog.array_length(c.conkey, 1) = 1
           AND a.attname = 'id' AND NOT a.attisdropped
       ) THEN
      RAISE EXCEPTION 'Incompatible public.% primary key.', v_relation;
    END IF;
  END LOOP;

  -- Some deployed installations added a response token before it appeared in
  -- the canonical migration. Accept absence; if present, require nullable text.
  FOREACH v_relation IN ARRAY ARRAY['response_token', 'token'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.season_team_returns')
        AND a.attname = v_relation AND NOT a.attisdropped
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.season_team_returns')
        AND a.attname = v_relation AND NOT a.attisdropped
        AND a.atttypid = 'pg_catalog.text'::pg_catalog.regtype::oid
        AND NOT a.attnotnull
    ) THEN
      RAISE EXCEPTION 'Incompatible season_team_returns.% token column.', v_relation;
    END IF;
  END LOOP;
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
    SELECT 1 FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.account_deletion_state AS s WHERE s.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot assign league membership to a deleting, deleted, or authless profile.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS league_memberships_block_deleting_user ON public.league_memberships;
CREATE TRIGGER league_memberships_block_deleting_user
BEFORE INSERT OR UPDATE OF user_id, role, status, league_id ON public.league_memberships
FOR EACH ROW EXECUTE FUNCTION public.block_deleting_league_membership();

ALTER FUNCTION public.prepare_account_deletion(uuid)
  RENAME TO prepare_account_deletion_pass2_impl;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  IF EXISTS (
    SELECT 1 FROM public.league_memberships AS lm
    WHERE lm.user_id = p_user_id AND lm.role = 'owner' AND lm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.prepare_account_deletion_pass2_impl(p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_account_deletion_pass3(
  p_user_id uuid,
  p_email text,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_referee_ids uuid[] := ARRAY[]::uuid[];
  v_token_column text;
BEGIN
  -- Direct operational messaging rows omitted by pass 2.
  DELETE FROM public.notification_send_log WHERE user_id = p_user_id;
  UPDATE public.league_memberships SET invited_by = NULL WHERE invited_by = p_user_id;
  UPDATE public.games
  SET scorekeeper_verified_by = CASE WHEN scorekeeper_verified_by = p_user_id THEN NULL ELSE scorekeeper_verified_by END,
      stats_submitted_by = CASE WHEN stats_submitted_by = p_user_id THEN NULL ELSE stats_submitted_by END,
      unlocked_by = CASE WHEN unlocked_by = p_user_id THEN NULL ELSE unlocked_by END
  WHERE scorekeeper_verified_by = p_user_id OR stats_submitted_by = p_user_id OR unlocked_by = p_user_id;

  -- Referee portal tokens and all current/future assignment surfaces are
  -- removed. Completed games retain only role/payment/timing facts.
  IF pg_catalog.to_regclass('public.league_referees') IS NOT NULL THEN
    SELECT COALESCE(pg_catalog.array_agg(lr.id), ARRAY[]::uuid[]) INTO v_referee_ids
    FROM public.league_referees AS lr
    WHERE lr.referee_id = p_user_id
       OR (p_email IS NOT NULL
         AND pg_catalog.lower(pg_catalog.btrim(lr.email)) = pg_catalog.lower(pg_catalog.btrim(p_email)))
       OR (p_phone IS NOT NULL
         AND pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g') <> ''
         AND pg_catalog.regexp_replace(lr.phone, '[^0-9]', '', 'g')
           = pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g'));

    IF pg_catalog.to_regclass('public.referee_sessions') IS NOT NULL THEN
      DELETE FROM public.referee_sessions
      WHERE referee_id = p_user_id OR created_by = p_user_id OR deactivated_by = p_user_id
         OR league_referee_id = ANY(v_referee_ids);
    END IF;
    IF pg_catalog.to_regclass('public.referee_availability') IS NOT NULL THEN
      DELETE FROM public.referee_availability WHERE referee_id = ANY(v_referee_ids);
      UPDATE public.referee_availability SET created_by = NULL WHERE created_by = p_user_id;
    END IF;
    IF pg_catalog.to_regclass('public.referee_swap_requests') IS NOT NULL THEN
      DELETE FROM public.referee_swap_requests AS rsr
      WHERE (rsr.requesting_referee_id = ANY(v_referee_ids)
          OR rsr.accepting_referee_id = ANY(v_referee_ids))
        AND NOT EXISTS (
          SELECT 1 FROM public.games AS g
          WHERE g.id = rsr.game_id AND g.status = 'completed'
        );
      UPDATE public.referee_swap_requests AS rsr
      SET reason = NULL,
          resolved_by = CASE WHEN resolved_by = p_user_id THEN NULL ELSE resolved_by END,
          updated_at = pg_catalog.statement_timestamp()
      WHERE (rsr.requesting_referee_id = ANY(v_referee_ids)
          OR rsr.accepting_referee_id = ANY(v_referee_ids))
        AND EXISTS (
          SELECT 1 FROM public.games AS g
          WHERE g.id = rsr.game_id AND g.status = 'completed'
        );
      UPDATE public.referee_swap_requests SET resolved_by = NULL WHERE resolved_by = p_user_id;
    END IF;
    IF pg_catalog.to_regclass('public.game_officials') IS NOT NULL THEN
      DELETE FROM public.game_officials AS go
      WHERE go.league_referee_id = ANY(v_referee_ids)
        AND NOT EXISTS (
          SELECT 1 FROM public.games AS g
          WHERE g.id = go.game_id AND g.status = 'completed'
        );
      UPDATE public.game_officials AS go
      SET name = 'Deleted Official', jersey_number = NULL, notes = NULL,
          referee_identifier_snapshot = NULL,
          assigned_by = CASE WHEN assigned_by = p_user_id THEN NULL ELSE assigned_by END,
          updated_at = pg_catalog.statement_timestamp()
      WHERE go.league_referee_id = ANY(v_referee_ids)
        AND EXISTS (
          SELECT 1 FROM public.games AS g
          WHERE g.id = go.game_id AND g.status = 'completed'
        );
      UPDATE public.game_officials SET assigned_by = NULL WHERE assigned_by = p_user_id;
    END IF;
    UPDATE public.league_referees
    SET referee_id = NULL, display_name = 'Deleted Official', email = NULL, phone = NULL,
        status = 'inactive', hired_date = NULL, game_fee = NULL, game_fee_cents = 0,
        referee_identifier = NULL, default_jersey_number = NULL,
        solo_game_fee_cents = 0, paired_game_fee_cents = 0,
        linesman_fee_cents = 0, single_game_fee_cents = 0,
        certification = NULL, can_referee = FALSE, can_linesman = FALSE,
        max_games_per_week = NULL, preferred_days = NULL,
        total_assignments = completed_assignments, notes = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE id = ANY(v_referee_ids);
  END IF;

  -- A terminal return response retains only league/season/team/status and its
  -- terminal timestamp. Open/future outreach is deleted outright.
  IF pg_catalog.to_regclass('public.season_team_returns') IS NOT NULL THEN
    DELETE FROM public.season_team_returns
    WHERE (captain_profile_id = p_user_id
        OR (p_email IS NOT NULL
          AND pg_catalog.lower(pg_catalog.btrim(captain_email)) = pg_catalog.lower(pg_catalog.btrim(p_email)))
        OR (p_phone IS NOT NULL
          AND pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g') <> ''
          AND pg_catalog.regexp_replace(captain_phone, '[^0-9]', '', 'g')
            = pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g')))
      AND status NOT IN ('confirmed', 'declined');
    FOREACH v_token_column IN ARRAY ARRAY['response_token', 'token'] LOOP
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = pg_catalog.to_regclass('public.season_team_returns')
          AND a.attname = v_token_column AND NOT a.attisdropped
      ) THEN
        EXECUTE pg_catalog.format(
          'UPDATE public.season_team_returns SET %I = NULL WHERE captain_profile_id = $1 OR ($2 IS NOT NULL AND pg_catalog.lower(pg_catalog.btrim(captain_email)) = pg_catalog.lower(pg_catalog.btrim($2))) OR ($3 IS NOT NULL AND pg_catalog.regexp_replace($3, ''[^0-9]'', '''', ''g'') <> '''' AND pg_catalog.regexp_replace(captain_phone, ''[^0-9]'', '''', ''g'') = pg_catalog.regexp_replace($3, ''[^0-9]'', '''', ''g''))',
          v_token_column
        ) USING p_user_id, p_email, p_phone;
      END IF;
    END LOOP;
    UPDATE public.season_team_returns
    SET source_season_id = NULL,
        captain_profile_id = NULL, captain_name = NULL, captain_email = NULL,
        captain_phone = NULL, owner_flag = 'normal', notes = NULL,
        internal_notes = NULL, declined_reason = NULL,
        metadata = '{}'::jsonb, last_contacted_at = NULL, last_response_at = NULL,
        confirmed_at = CASE WHEN status = 'confirmed' THEN confirmed_at ELSE NULL END,
        declined_at = CASE WHEN status = 'declined' THEN declined_at ELSE NULL END,
        updated_at = pg_catalog.statement_timestamp()
    WHERE captain_profile_id = p_user_id
       OR (p_email IS NOT NULL
         AND pg_catalog.lower(pg_catalog.btrim(captain_email)) = pg_catalog.lower(pg_catalog.btrim(p_email)))
       OR (p_phone IS NOT NULL
         AND pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g') <> ''
         AND pg_catalog.regexp_replace(captain_phone, '[^0-9]', '', 'g')
           = pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g'));
    UPDATE public.season_team_returns SET confirmed_by = NULL WHERE confirmed_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.season_team_return_campaigns') IS NOT NULL THEN
    UPDATE public.season_team_return_campaigns SET sent_by = NULL WHERE sent_by = p_user_id;
  END IF;

  -- Migration-only direct references found by the pass-3 inventory.
  IF pg_catalog.to_regclass('public.league_backup_tokens') IS NOT NULL THEN
    UPDATE public.league_backup_tokens
    SET token_hash = 'revoked:' || pg_catalog.gen_random_uuid()::text,
        created_by = NULL, revoked_at = COALESCE(revoked_at, pg_catalog.statement_timestamp()),
        updated_at = pg_catalog.statement_timestamp()
    WHERE created_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.league_migration_requests') IS NOT NULL THEN
    UPDATE public.league_migration_requests
    SET status = 'cancelled', requested_by = NULL, source_system = NULL,
        source_url = NULL, asset_links = ARRAY[]::text[], notes = NULL,
        admin_notes = NULL, uploaded_assets = '[]'::jsonb,
        normalization_profile = '{}'::jsonb, scheduled_for = NULL,
        updated_at = pg_catalog.statement_timestamp()
    WHERE requested_by = p_user_id AND status <> 'completed';
    UPDATE public.league_migration_requests
    SET requested_by = NULL, source_url = NULL, asset_links = ARRAY[]::text[],
        notes = NULL, admin_notes = NULL, uploaded_assets = '[]'::jsonb,
        normalization_profile = '{}'::jsonb,
        updated_at = pg_catalog.statement_timestamp()
    WHERE requested_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.team_invoices') IS NOT NULL THEN
    UPDATE public.team_invoices
    SET paid_by = NULL, stripe_invoice_id = NULL, stripe_payment_intent_id = NULL,
        notes = NULL, updated_at = pg_catalog.statement_timestamp()
    WHERE paid_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.team_invoice_payments') IS NOT NULL THEN
    UPDATE public.team_invoice_payments
    SET recorded_by = NULL, stripe_payment_intent_id = NULL,
        reference_number = NULL, notes = NULL
    WHERE recorded_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.league_finance_custom_items') IS NOT NULL THEN
    UPDATE public.league_finance_custom_items
    SET created_by = CASE WHEN created_by = p_user_id THEN NULL ELSE created_by END,
        updated_by = CASE WHEN updated_by = p_user_id THEN NULL ELSE updated_by END
    WHERE created_by = p_user_id OR updated_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.league_quickbooks_connections') IS NOT NULL THEN
    UPDATE public.league_quickbooks_connections SET connected_by = NULL WHERE connected_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.league_quickbooks_mappings') IS NOT NULL THEN
    UPDATE public.league_quickbooks_mappings
    SET created_by = CASE WHEN created_by = p_user_id THEN NULL ELSE created_by END,
        updated_by = CASE WHEN updated_by = p_user_id THEN NULL ELSE updated_by END
    WHERE created_by = p_user_id OR updated_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.league_quickbooks_sync_runs') IS NOT NULL THEN
    UPDATE public.league_quickbooks_sync_runs SET requested_by = NULL WHERE requested_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.player_career_baselines') IS NOT NULL THEN
    UPDATE public.player_career_baselines
    SET player_id = NULL, first_name = 'Deleted', last_name = 'User',
        full_name = 'Deleted User', source_label = NULL,
        source_record_id = 'deleted:' || pg_catalog.gen_random_uuid()::text,
        source_metadata = '{}'::jsonb, updated_at = pg_catalog.statement_timestamp()
    WHERE player_id = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.schedule_rules') IS NOT NULL THEN
    UPDATE public.schedule_rules SET created_by = NULL WHERE created_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.season_fees') IS NOT NULL THEN
    UPDATE public.season_fees SET created_by = NULL WHERE created_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.sponsor_placements') IS NOT NULL THEN
    UPDATE public.sponsor_placements SET created_by = NULL WHERE created_by = p_user_id;
  END IF;
  IF pg_catalog.to_regclass('public.stat_definitions') IS NOT NULL THEN
    UPDATE public.stat_definitions SET created_by = NULL WHERE created_by = p_user_id;
  END IF;
  UPDATE public.legacy_players
  SET first_name = 'Deleted', last_name = 'User', full_name = 'Deleted User',
      matched_to_profile_id = NULL, matched_at = NULL, imported_from = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE matched_to_profile_id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_account_deletion_pass3_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.cleanup_account_deletion_pass3(OLD.id, OLD.email, OLD.phone);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_account_deletion_pass3_cleanup ON public.profiles;
CREATE TRIGGER profiles_account_deletion_pass3_cleanup
BEFORE UPDATE OF deleted_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.run_account_deletion_pass3_cleanup();

ALTER FUNCTION public.execute_account_deletion(uuid)
  RENAME TO execute_account_deletion_pass2_impl;

CREATE OR REPLACE FUNCTION public.execute_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.lock_account_deletion_user(p_user_id);
  IF EXISTS (
    SELECT 1 FROM public.league_memberships AS lm
    WHERE lm.user_id = p_user_id AND lm.role = 'owner' AND lm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot delete account: transfer league ownership first.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.execute_account_deletion_pass2_impl(p_user_id);
END;
$function$;

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
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Reminder claim limit is out of range.';
  END IF;
  RETURN QUERY
  WITH claimable AS (
    SELECT l.id
    FROM public.account_deletion_log AS l
    WHERE l.status = 'pending'
      AND l.reminder_7day_sent IS NOT TRUE
      AND l.scheduled_for >= p_now
      AND l.scheduled_for <= p_cutoff
      AND (l.reminder_7day_claimed_at IS NULL
        OR l.reminder_7day_claimed_at < p_now - INTERVAL '15 minutes')
    ORDER BY l.scheduled_for, l.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.account_deletion_log AS l
  SET reminder_7day_claimed_at = p_now,
      reminder_7day_attempts = l.reminder_7day_attempts + 1,
      updated_at = p_now
  FROM claimable AS c
  WHERE l.id = c.id
  RETURNING l.id, l.user_id, l.profile_email, l.scheduled_for;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_account_deletion_reminder_sent(p_deletion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.account_deletion_log
  SET reminder_7day_sent = TRUE, reminder_7day_claimed_at = NULL,
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = p_deletion_id AND reminder_7day_sent IS NOT TRUE
    AND reminder_7day_claimed_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_account_deletion_reminder_claim(p_deletion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.account_deletion_log
  SET reminder_7day_claimed_at = NULL, updated_at = pg_catalog.statement_timestamp()
  WHERE id = p_deletion_id AND reminder_7day_sent IS NOT TRUE
    AND reminder_7day_claimed_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

-- Lock down every new wrapper/helper and the renamed implementations.
ALTER FUNCTION public.validate_optional_deletion_relations_pass2_impl() OWNER TO postgres;
ALTER FUNCTION public.validate_optional_deletion_relations() OWNER TO postgres;
ALTER FUNCTION public.block_deleting_league_membership() OWNER TO postgres;
ALTER FUNCTION public.prepare_account_deletion_pass2_impl(uuid) OWNER TO postgres;
ALTER FUNCTION public.prepare_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.cleanup_account_deletion_pass3(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.run_account_deletion_pass3_cleanup() OWNER TO postgres;
ALTER FUNCTION public.execute_account_deletion_pass2_impl(uuid) OWNER TO postgres;
ALTER FUNCTION public.execute_account_deletion(uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_account_deletion_reminders(timestamptz, timestamptz, integer) OWNER TO postgres;
ALTER FUNCTION public.mark_account_deletion_reminder_sent(uuid) OWNER TO postgres;
ALTER FUNCTION public.release_account_deletion_reminder_claim(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.validate_optional_deletion_relations_pass2_impl() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_optional_deletion_relations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_deleting_league_membership() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_pass2_impl(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_account_deletion_pass3(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.run_account_deletion_pass3_cleanup() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_account_deletion_pass2_impl(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_account_deletion_reminders(timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_account_deletion_reminder_sent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_account_deletion_reminder_claim(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_reminders(timestamptz, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_deletion_reminder_sent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_account_deletion_reminder_claim(uuid) TO service_role;

DO $pass3_catalog$
DECLARE
  v_bad_function text;
BEGIN
  SELECT p.oid::pg_catalog.regprocedure::text INTO v_bad_function
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'validate_optional_deletion_relations_pass2_impl',
      'validate_optional_deletion_relations',
      'block_deleting_league_membership',
      'prepare_account_deletion_pass2_impl', 'prepare_account_deletion',
      'cleanup_account_deletion_pass3', 'run_account_deletion_pass3_cleanup',
      'execute_account_deletion_pass2_impl', 'execute_account_deletion',
      'claim_account_deletion_reminders',
      'mark_account_deletion_reminder_sent',
      'release_account_deletion_reminder_claim'
    )
    AND (
      NOT p.prosecdef
      OR p.proowner <> 'postgres'::pg_catalog.regrole
      OR NOT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
    )
  LIMIT 1;
  IF v_bad_function IS NOT NULL THEN
    RAISE EXCEPTION 'Pass-3 privileged function is not pinned: %', v_bad_function;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.validate_optional_deletion_relations_pass2_impl()', FALSE),
        ('public.validate_optional_deletion_relations()', FALSE),
        ('public.block_deleting_league_membership()', FALSE),
        ('public.prepare_account_deletion_pass2_impl(uuid)', FALSE),
        ('public.prepare_account_deletion(uuid)', TRUE),
        ('public.cleanup_account_deletion_pass3(uuid,text,text)', FALSE),
        ('public.run_account_deletion_pass3_cleanup()', FALSE),
        ('public.execute_account_deletion_pass2_impl(uuid)', FALSE),
        ('public.execute_account_deletion(uuid)', TRUE),
        ('public.claim_account_deletion_reminders(timestamp with time zone,timestamp with time zone,integer)', TRUE),
        ('public.mark_account_deletion_reminder_sent(uuid)', TRUE),
        ('public.release_account_deletion_reminder_claim(uuid)', TRUE)
    ) AS expected(signature, service_expected)
    WHERE pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
          IS DISTINCT FROM expected.service_expected
  ) THEN
    RAISE EXCEPTION 'Unexpected effective pass-3 function privileges.';
  END IF;
END;
$pass3_catalog$;

COMMENT ON FUNCTION public.cleanup_account_deletion_pass3(uuid, text, text) IS
  'Removes pass-3 operational authority and minimizes completed referee, season-return, migration, billing, and imported-history facts before profile anonymization.';

COMMIT;
