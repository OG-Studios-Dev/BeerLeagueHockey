\set ON_ERROR_STOP on

DO $policy_contract$
DECLARE
  v_missing text;
BEGIN
  SELECT pg_catalog.string_agg(required.policyname, ', ' ORDER BY required.policyname)
  INTO v_missing
  FROM (
    VALUES
      ('beer_guy_sub_invitation_insert_authenticated', 'INSERT'),
      ('beer_guy_sub_invitation_update_authenticated', 'UPDATE'),
      ('beer_guy_sub_invitation_delete_authenticated', 'DELETE'),
      ('beer_guy_sub_invitation_select_authorized', 'SELECT')
  ) AS required(policyname, command)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.policyname = required.policyname
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = required.command
      AND policy.roles = ARRAY['authenticated']::name[]
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'self-contained invitation RLS policies missing: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = 'ALL'
      AND 'authenticated'::name = ANY(policy.roles)
  ) THEN
    RAISE EXCEPTION 'invitation RLS added a forbidden permissive FOR ALL policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = 'SELECT'
      AND (
        policy.qual IS NULL
        OR pg_catalog.lower(pg_catalog.regexp_replace(policy.qual, '[()[:space:]]', '', 'g')) = 'true'
      )
  ) THEN
    RAISE EXCEPTION 'invitation RLS added a broad permissive SELECT policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.policyname LIKE 'beer_guy_sub_invitation%authenticated'
      AND 'anon'::name = ANY(policy.roles)
  ) THEN
    RAISE EXCEPTION 'anonymous role was added to invitation mutation rails';
  END IF;

  SELECT pg_catalog.string_agg(required.policyname, ', ' ORDER BY required.policyname)
  INTO v_missing
  FROM (
    VALUES
      ('beer_guy_sub_invitation_insert_guard', 'INSERT'),
      ('beer_guy_sub_invitation_update_guard', 'UPDATE'),
      ('beer_guy_sub_invitation_delete_guard', 'DELETE')
  ) AS required(policyname, command)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.policyname = required.policyname
      AND policy.permissive = 'RESTRICTIVE'
      AND policy.cmd = required.command
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exact restrictive invitation guards missing: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sub_invitations'
      AND policy.policyname = 'fixture_sub_invitations_all'
  ) THEN
    RAISE EXCEPTION 'legacy permissive invitation policy unexpectedly survived baseline setup';
  END IF;
END;
$policy_contract$;

-- Owner-seeded row for unauthorized mutation probes.
INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type
) VALUES (
  '80000000-0000-4000-8000-000000000057',
  '50000000-0000-4000-8000-000000000011',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000016',
  'pending', 'team'
);

INSERT INTO public.game_checkins(
  id, game_id, team_id, player_id, status, note
) VALUES (
  '90000000-0000-4000-8000-000000000062',
  '50000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'confirmed', 'accepted-invite self-read sentinel'
);

SET ROLE authenticated;

-- Current exact captain can create a pending invitation without any legacy policy.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type
) VALUES (
  '80000000-0000-4000-8000-000000000054',
  '50000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'pending', 'team'
);

-- Exact invitee can read and accept only their own pending invitation.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000022', false);
DO $invitee_flow$
DECLARE
  v_affected integer;
  v_blocked boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sub_invitations
    WHERE id = '80000000-0000-4000-8000-000000000054'
  ) THEN
    RAISE EXCEPTION 'invitee could not read their exact invitation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sub_invitations
    WHERE id = '80000000-0000-4000-8000-000000000057'
  ) THEN
    RAISE EXCEPTION 'invitee read another player invitation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000062'
  ) THEN
    RAISE EXCEPTION 'pending invite exposed substitute check-in';
  END IF;

  UPDATE public.sub_invitations
  SET status = 'accepted',
      responded_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = '80000000-0000-4000-8000-000000000054';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'invitee could not accept their exact pending invitation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000062'
  ) THEN
    RAISE EXCEPTION 'accepted invitee could not read their exact self check-in';
  END IF;

  BEGIN
    UPDATE public.sub_invitations
    SET message = 'forbidden rewrite'
    WHERE id = '80000000-0000-4000-8000-000000000054';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'invitee rewrote invitation content through permissive rail';
  END IF;
END;
$invitee_flow$;

-- Current alternate can create and delete an exact current-team invitation.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', false);
INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type
) VALUES (
  '80000000-0000-4000-8000-000000000055',
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000015',
  'pending', 'team'
);
DELETE FROM public.sub_invitations
WHERE id = '80000000-0000-4000-8000-000000000055';

-- Current captain can update and delete an invitation they are authorized to manage.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
DO $captain_flow$
DECLARE
  v_affected integer;
BEGIN
  UPDATE public.sub_invitations
  SET status = 'expired', updated_at = pg_catalog.statement_timestamp()
  WHERE id = '80000000-0000-4000-8000-000000000057';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'current captain could not update invitation';
  END IF;

  DELETE FROM public.sub_invitations
  WHERE id = '80000000-0000-4000-8000-000000000054';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'current captain could not delete accepted invitation';
  END IF;
END;
$captain_flow$;

-- Recreate a sentinel after the successful captain path for denial checks.
RESET ROLE;
INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type
) VALUES (
  '80000000-0000-4000-8000-000000000059',
  '50000000-0000-4000-8000-000000000012',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000016',
  'pending', 'league'
);
SET ROLE authenticated;

-- Historical active-looking captain rows cannot use the permissive rails.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000019', false);
DO $historical_denials$
DECLARE
  v_blocked boolean;
  v_affected integer;
BEGIN
  v_blocked := false;
  BEGIN
    INSERT INTO public.sub_invitations(
      id, game_id, team_id, invited_by, invited_player_id, status, source_type
    ) VALUES (
      '80000000-0000-4000-8000-000000000058',
      '50000000-0000-4000-8000-000000000009',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000019',
      '40000000-0000-4000-8000-000000000016',
      'pending', 'team'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'historical captain inserted through permissive rail';
  END IF;

  v_affected := 0;
  UPDATE public.sub_invitations
  SET status = 'accepted', responded_at = pg_catalog.statement_timestamp()
  WHERE id = '80000000-0000-4000-8000-000000000059';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'historical captain updated through permissive rail';
  END IF;

  DELETE FROM public.sub_invitations
  WHERE id = '80000000-0000-4000-8000-000000000059';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'historical captain deleted through permissive rail';
  END IF;
END;
$historical_denials$;

-- A future-dated legacy captain and a valid captain with forged scope both fail.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000018', false);
DO $future_captain_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.sub_invitations(
      id, game_id, team_id, invited_by, invited_player_id, status, source_type
    ) VALUES (
      '80000000-0000-4000-8000-000000000060',
      '50000000-0000-4000-8000-000000000009',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000018',
      '40000000-0000-4000-8000-000000000016',
      'pending', 'team'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'future-dated captain inserted through permissive rail';
  END IF;
END;
$future_captain_denial$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
DO $forged_scope_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.sub_invitations(
      id, game_id, team_id, invited_by, invited_player_id, status, source_type
    ) VALUES (
      '80000000-0000-4000-8000-000000000061',
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000016',
      'pending', 'team'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'captain inserted cross-league/non-participant invitation through permissive rail';
  END IF;
END;
$forged_scope_denial$;

RESET ROLE;

DO $final_state$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.sub_invitations
       WHERE id IN (
         '80000000-0000-4000-8000-000000000058',
         '80000000-0000-4000-8000-000000000060',
         '80000000-0000-4000-8000-000000000061'
       )
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sub_invitations
       WHERE id = '80000000-0000-4000-8000-000000000059'
         AND status = 'pending'
     ) THEN
    RAISE EXCEPTION 'unauthorized invitation probes changed protected state';
  END IF;
END;
$final_state$;

SELECT 'beer guy self-contained invitation RLS acceptance passed' AS result;
