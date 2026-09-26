-- Deterministic rollback-only acceptance for correction pass 3.
-- Apply the complete repository migration chain to a disposable database first.

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

SELECT public.validate_optional_deletion_relations();

-- Never reuse an identity from outside this rollback-only fixture.
DO $fixture_identity$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('a11ce300-0000-4000-8000-000000000001', 'a11ce300-0000-4000-8000-000000000002'))
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN ('a11ce300-0000-4000-8000-000000000001', 'a11ce300-0000-4000-8000-000000000002')) THEN
    RAISE EXCEPTION 'Acceptance fixture identity already exists';
  END IF;
END;
$fixture_identity$;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a11ce300-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pass3-delete@example.invalid', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a11ce300-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pass3-owner@example.invalid', '', now(), now(), now());

INSERT INTO public.profiles (id, email, full_name, phone)
VALUES
  ('a11ce300-0000-4000-8000-000000000001', 'pass3-delete@example.invalid', 'Pass Three Delete', '+14165550101'),
  ('a11ce300-0000-4000-8000-000000000002', 'pass3-owner@example.invalid', 'Pass Three Owner', '+14165550102')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone;

INSERT INTO public.leagues (id, name, slug)
VALUES ('a11ce300-0000-4000-8000-000000000010', 'Pass Three League', 'pass-three-league');
INSERT INTO public.seasons (id, league_id, name, start_date, status)
VALUES ('a11ce300-0000-4000-8000-000000000011', 'a11ce300-0000-4000-8000-000000000010', 'Pass Three Season', '2026-01-01', 'active');
INSERT INTO public.teams (id, league_id, name, short_name)
VALUES
  ('a11ce300-0000-4000-8000-000000000012', 'a11ce300-0000-4000-8000-000000000010', 'Pass Three Home', 'P3H'),
  ('a11ce300-0000-4000-8000-000000000013', 'a11ce300-0000-4000-8000-000000000010', 'Pass Three Away', 'P3A');
INSERT INTO public.games (
  id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status
) VALUES
  ('a11ce300-0000-4000-8000-000000000014', 'a11ce300-0000-4000-8000-000000000010',
   'a11ce300-0000-4000-8000-000000000011', 'a11ce300-0000-4000-8000-000000000012',
   'a11ce300-0000-4000-8000-000000000013', '2026-02-01T20:00:00Z', 'completed'),
  ('a11ce300-0000-4000-8000-000000000015', 'a11ce300-0000-4000-8000-000000000010',
   'a11ce300-0000-4000-8000-000000000011', 'a11ce300-0000-4000-8000-000000000012',
   'a11ce300-0000-4000-8000-000000000013', '2027-02-01T20:00:00Z', 'scheduled');

INSERT INTO public.league_referees (
  id, league_id, referee_id, display_name, email, phone, status,
  certification, can_referee, can_linesman, preferred_days, notes,
  referee_identifier, default_jersey_number, solo_game_fee_cents
) VALUES (
  'a11ce300-0000-4000-8000-000000000020', 'a11ce300-0000-4000-8000-000000000010',
  'a11ce300-0000-4000-8000-000000000001', 'Pass Three Referee',
  'pass3-delete@example.invalid', '+14165550101', 'active', 'Level 3', TRUE, TRUE,
  ARRAY[1, 3], 'private referee note', 'private-ref-id', '91', 7500
);
INSERT INTO public.referee_sessions (
  id, token, league_id, league_referee_id, referee_id, created_by, expires_at, device_info
) VALUES (
  'a11ce300-0000-4000-8000-000000000021', 'pass3-referee-bearer-token',
  'a11ce300-0000-4000-8000-000000000010', 'a11ce300-0000-4000-8000-000000000020',
  'a11ce300-0000-4000-8000-000000000001', 'a11ce300-0000-4000-8000-000000000001',
  now() + interval '1 day', '{"device":"fixture"}'::jsonb
);
INSERT INTO public.referee_availability (
  referee_id, league_id, day_of_week, start_time, end_time, notes, created_by
) VALUES (
  'a11ce300-0000-4000-8000-000000000020', 'a11ce300-0000-4000-8000-000000000010',
  2, '18:00', '23:00', 'future availability', 'a11ce300-0000-4000-8000-000000000001'
);
INSERT INTO public.referee_swap_requests (
  game_id, requesting_referee_id, status, reason, resolved_by
) VALUES
  ('a11ce300-0000-4000-8000-000000000014', 'a11ce300-0000-4000-8000-000000000020',
   'accepted', 'completed swap note', 'a11ce300-0000-4000-8000-000000000001'),
  ('a11ce300-0000-4000-8000-000000000015', 'a11ce300-0000-4000-8000-000000000020',
   'pending', 'future swap note', NULL);
INSERT INTO public.game_officials (
  game_id, name, role, league_referee_id, assignment_status,
  payment_status, payment_amount, assigned_by, notes, referee_identifier_snapshot
) VALUES
  ('a11ce300-0000-4000-8000-000000000014', 'Pass Three Referee', 'referee',
   'a11ce300-0000-4000-8000-000000000020', 'confirmed', 'paid', 75,
   'a11ce300-0000-4000-8000-000000000001', 'completed assignment note', 'private-ref-id'),
  ('a11ce300-0000-4000-8000-000000000015', 'Pass Three Referee', 'referee',
   'a11ce300-0000-4000-8000-000000000020', 'confirmed', 'pending', 75,
   'a11ce300-0000-4000-8000-000000000001', 'future assignment note', 'private-ref-id');

INSERT INTO public.season_team_returns (
  league_id, season_id, team_id, status, captain_profile_id, captain_name,
  captain_email, captain_phone, notes, internal_notes, declined_reason, metadata,
  confirmed_at, confirmed_by
) VALUES
  ('a11ce300-0000-4000-8000-000000000010', 'a11ce300-0000-4000-8000-000000000011',
   'a11ce300-0000-4000-8000-000000000012', 'contacted',
   'a11ce300-0000-4000-8000-000000000001', 'Pass Three Delete',
   'pass3-delete@example.invalid', '+14165550101', 'open note', 'private note', NULL,
   '{"personal":"value"}'::jsonb, NULL, NULL),
  ('a11ce300-0000-4000-8000-000000000010', 'a11ce300-0000-4000-8000-000000000011',
   'a11ce300-0000-4000-8000-000000000013', 'confirmed',
   'a11ce300-0000-4000-8000-000000000001', 'Pass Three Delete',
   'pass3-delete@example.invalid', '+14165550101', 'terminal note', 'private note', NULL,
   '{"personal":"value"}'::jsonb, now(), 'a11ce300-0000-4000-8000-000000000001');

DO $fixture_tokens$
DECLARE
  v_token_column text;
BEGIN
  FOREACH v_token_column IN ARRAY ARRAY['response_token', 'token'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = 'public.season_team_returns'::pg_catalog.regclass
        AND a.attname = v_token_column AND NOT a.attisdropped
    ) THEN
      EXECUTE pg_catalog.format(
        'UPDATE public.season_team_returns SET %I = %L WHERE season_id = %L::uuid AND captain_profile_id = %L::uuid',
        v_token_column, 'pass3-return-token',
        'a11ce300-0000-4000-8000-000000000011',
        'a11ce300-0000-4000-8000-000000000001'
      );
    END IF;
  END LOOP;
END;
$fixture_tokens$;

INSERT INTO public.notification_send_log (notification_type, game_id, user_id, payload)
VALUES ('game_reminder_t4h', 'a11ce300-0000-4000-8000-000000000015',
  'a11ce300-0000-4000-8000-000000000001', '{"private":"payload"}'::jsonb);
INSERT INTO public.league_backup_tokens (league_id, label, token_hash, created_by)
VALUES ('a11ce300-0000-4000-8000-000000000010', 'Pass Three Token', 'pass3-token-hash',
  'a11ce300-0000-4000-8000-000000000001');
INSERT INTO public.league_migration_requests (league_id, requested_by, status, source_url, notes)
VALUES ('a11ce300-0000-4000-8000-000000000010', 'a11ce300-0000-4000-8000-000000000001',
  'submitted', 'https://example.invalid/private-source', 'private migration note');
INSERT INTO public.team_invoices (
  team_id, season_id, league_id, total_amount_cents, amount_paid_cents, status,
  paid_by, stripe_invoice_id, notes
) VALUES (
  'a11ce300-0000-4000-8000-000000000012', 'a11ce300-0000-4000-8000-000000000011',
  'a11ce300-0000-4000-8000-000000000010', 10000, 10000, 'paid',
  'a11ce300-0000-4000-8000-000000000001', 'in_fixture', 'private invoice note'
);

INSERT INTO public.legacy_players (
  id, first_name, last_name, matched_to_profile_id, matched_at, imported_from
) VALUES (
  'a11ce300-0000-4000-8000-000000000030', 'Private', 'Legacy',
  'a11ce300-0000-4000-8000-000000000001', now(), 'private-import-source'
);

SELECT public.cleanup_account_deletion_pass3(
  'a11ce300-0000-4000-8000-000000000001',
  'pass3-delete@example.invalid',
  '+14165550101'
);

DO $acceptance$
DECLARE
  v_user_id uuid := 'a11ce300-0000-4000-8000-000000000001';
  v_referee_id uuid := 'a11ce300-0000-4000-8000-000000000020';
  v_token_column text;
  v_token_survived boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.legacy_players
    WHERE id = 'a11ce300-0000-4000-8000-000000000030'
      AND first_name = 'Deleted' AND last_name = 'User'
      AND full_name = 'Deleted User'
      AND matched_to_profile_id IS NULL AND matched_at IS NULL
      AND imported_from IS NULL
  ) THEN
    RAISE EXCEPTION 'Historical legacy player was not retained and anonymized exactly';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referee_sessions WHERE referee_id = v_user_id)
     OR EXISTS (SELECT 1 FROM public.referee_availability WHERE referee_id = v_referee_id)
     OR EXISTS (SELECT 1 FROM public.referee_swap_requests WHERE game_id = 'a11ce300-0000-4000-8000-000000000015')
     OR EXISTS (SELECT 1 FROM public.game_officials WHERE game_id = 'a11ce300-0000-4000-8000-000000000015') THEN
    RAISE EXCEPTION 'Referee token or future operational state survived';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_officials
    WHERE game_id = 'a11ce300-0000-4000-8000-000000000014'
      AND name = 'Deleted Official' AND notes IS NULL AND assigned_by IS NULL
      AND referee_identifier_snapshot IS NULL
      AND payment_status = 'paid' AND payment_amount = 75
  ) THEN
    RAISE EXCEPTION 'Completed officiating fact was not retained/minimized exactly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.league_referees
    WHERE id = v_referee_id AND referee_id IS NULL
      AND display_name = 'Deleted Official' AND email IS NULL AND phone IS NULL
      AND referee_identifier IS NULL AND default_jersey_number IS NULL
      AND solo_game_fee_cents = 0 AND status = 'inactive'
  ) THEN
    RAISE EXCEPTION 'Referee identity and authority row was not minimized exactly';
  END IF;
  IF EXISTS (SELECT 1 FROM public.season_team_returns WHERE team_id = 'a11ce300-0000-4000-8000-000000000012') THEN
    RAISE EXCEPTION 'Open season-return row survived';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.season_team_returns
    WHERE team_id = 'a11ce300-0000-4000-8000-000000000013'
      AND status = 'confirmed' AND confirmed_at IS NOT NULL
      AND captain_profile_id IS NULL AND captain_name IS NULL
      AND captain_email IS NULL AND captain_phone IS NULL
      AND notes IS NULL AND internal_notes IS NULL
      AND metadata = '{}'::jsonb AND confirmed_by IS NULL
  ) THEN
    RAISE EXCEPTION 'Terminal season-return fact was not retained/minimized exactly';
  END IF;
  FOREACH v_token_column IN ARRAY ARRAY['response_token', 'token'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = 'public.season_team_returns'::pg_catalog.regclass
        AND a.attname = v_token_column AND NOT a.attisdropped
    ) THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (SELECT 1 FROM public.season_team_returns WHERE season_id = %L::uuid AND team_id = %L::uuid AND %I IS NOT NULL)',
        'a11ce300-0000-4000-8000-000000000011',
        'a11ce300-0000-4000-8000-000000000013',
        v_token_column
      ) INTO v_token_survived;
      IF v_token_survived THEN
        RAISE EXCEPTION 'Terminal season-return token survived cleanup';
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.notification_send_log WHERE user_id = v_user_id)
     OR EXISTS (
       SELECT 1 FROM public.league_backup_tokens
       WHERE league_id = 'a11ce300-0000-4000-8000-000000000010'
         AND (created_by = v_user_id OR revoked_at IS NULL OR token_hash = 'pass3-token-hash')
     )
     OR EXISTS (
       SELECT 1 FROM public.league_migration_requests
       WHERE league_id = 'a11ce300-0000-4000-8000-000000000010'
         AND (requested_by = v_user_id OR status <> 'cancelled'
           OR source_url IS NOT NULL OR notes IS NOT NULL)
     )
     OR EXISTS (
       SELECT 1 FROM public.team_invoices
       WHERE league_id = 'a11ce300-0000-4000-8000-000000000010'
         AND (paid_by = v_user_id OR stripe_invoice_id IS NOT NULL OR notes IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'A newly classified migration-only reference survived cleanup';
  END IF;
END;
$acceptance$;

ROLLBACK;
