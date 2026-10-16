\set ON_ERROR_STOP on

-- Owner-seed exact accepted-invite and denial sentinels. The fixture's broad
-- authenticated policy is deliberately absent for this acceptance.
INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id,
  status, source_type, responded_at
) VALUES (
  '80000000-0000-4000-8000-000000000063',
  '50000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'accepted', 'team', pg_catalog.statement_timestamp()
);

INSERT INTO public.game_checkins(
  id, game_id, team_id, player_id, status, note
) VALUES
  (
    '90000000-0000-4000-8000-000000000063',
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    'confirmed', 'current team read sentinel'
  ),
  (
    '90000000-0000-4000-8000-000000000064',
    '50000000-0000-4000-8000-000000000008',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000019',
    'confirmed', 'historical denial sentinel'
  );

SET ROLE authenticated;

-- This is the deployed league-sites write shape: a current exact roster member
-- can directly insert, then reach ON CONFLICT UPDATE through SELECT visibility.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false
);
INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
VALUES (
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000011',
  'confirmed', 'direct insert'
);

INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
VALUES (
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000011',
  'tentative', 'direct upsert update'
)
ON CONFLICT (game_id, player_id) DO UPDATE
SET team_id = EXCLUDED.team_id,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    updated_at = pg_catalog.statement_timestamp();

DO $regular_direct_flow$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000002'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND player_id = '40000000-0000-4000-8000-000000000011'
      AND status = 'tentative'
      AND note = 'direct upsert update'
  ) THEN
    RAISE EXCEPTION 'authorized direct insert/upsert row is not SELECT-visible';
  END IF;
END;
$regular_direct_flow$;

-- Preserve the existing direct reset/delete path for the exact actor and scope.
DELETE FROM public.game_checkins
WHERE game_id = '50000000-0000-4000-8000-000000000002'
  AND team_id = '30000000-0000-4000-8000-000000000001'
  AND player_id = '40000000-0000-4000-8000-000000000011';

DO $regular_delete$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000002'
      AND player_id = '40000000-0000-4000-8000-000000000011'
  ) THEN
    RAISE EXCEPTION 'authorized direct DELETE/reset did not remove the self check-in';
  END IF;
END;
$regular_delete$;

-- An exact accepted invite authorizes only that substitute's own check-in for
-- that invitation game and team; it does not make the substitute Beer-eligible.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000022', false
);
INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
VALUES (
  '50000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'confirmed', 'accepted substitute direct insert'
);
INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
VALUES (
  '50000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'tentative', 'accepted substitute direct upsert'
)
ON CONFLICT (game_id, player_id) DO UPDATE
SET team_id = EXCLUDED.team_id,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    updated_at = pg_catalog.statement_timestamp();

DO $accepted_substitute_scope$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000022'
         AND status = 'tentative'
     )
     OR EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id <> '40000000-0000-4000-8000-000000000022'
     ) THEN
    RAISE EXCEPTION 'accepted substitute direct read scope is not exact';
  END IF;
END;
$accepted_substitute_scope$;

-- Current exact team members retain team attendance reads.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000012', false
);
DO $current_team_read$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE id = '90000000-0000-4000-8000-000000000063'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000003'
         AND player_id = '40000000-0000-4000-8000-000000000022'
     ) THEN
    RAISE EXCEPTION 'current exact roster member lost team check-in reads';
  END IF;
END;
$current_team_read$;

-- Accepted-invite authority is exact; it cannot be reused for another game.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000022', false
);
DO $accepted_invite_wrong_game_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
    VALUES (
      '50000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000022',
      'confirmed'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'accepted substitute wrote a different game check-in';
  END IF;
END;
$accepted_invite_wrong_game_denial$;

-- A future-dated active-looking roster is not current authority.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000018', false
);
DO $future_roster_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
    VALUES (
      '50000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000018',
      'confirmed'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'future-dated roster wrote a current game check-in';
  END IF;
END;
$future_roster_denial$;

-- A historical active-looking roster cannot read or mutate either the current
-- operational season or its own historical game row.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000019', false
);
DO $historical_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000064'
  ) THEN
    RAISE EXCEPTION 'historical roster read a historical check-in';
  END IF;

  BEGIN
    INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
    VALUES (
      '50000000-0000-4000-8000-000000000008',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000019',
      'out'
    )
    ON CONFLICT (game_id, player_id) DO UPDATE
      SET status = EXCLUDED.status,
          updated_at = pg_catalog.statement_timestamp();
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'historical roster mutated a historical check-in';
  END IF;
END;
$historical_denial$;

-- A valid actor cannot use ON CONFLICT UPDATE to move an existing self row onto
-- a non-participating cross-league team.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false
);
DO $cross_league_upsert_denial$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
    VALUES (
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000011',
      'out', 'cross-league spoof'
    )
    ON CONFLICT (game_id, player_id) DO UPDATE
      SET team_id = EXCLUDED.team_id,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          updated_at = pg_catalog.statement_timestamp();
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'cross-league ON CONFLICT UPDATE unexpectedly succeeded';
  END IF;
END;
$cross_league_upsert_denial$;

RESET ROLE;

DO $policy_contract$
DECLARE
  v_missing text;
BEGIN
  SELECT pg_catalog.string_agg(required.policyname, ', ' ORDER BY required.policyname)
  INTO v_missing
  FROM (
    VALUES
      ('beer_guy_checkin_insert_authenticated', 'INSERT'),
      ('beer_guy_checkin_update_authenticated', 'UPDATE'),
      ('beer_guy_checkin_delete_authenticated', 'DELETE'),
      ('beer_guy_checkin_select_authorized', 'SELECT')
  ) AS required(policyname, command)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.policyname = required.policyname
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = required.command
      AND policy.roles = ARRAY['authenticated']::name[]
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'self-contained game-checkin RLS policies missing: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = 'ALL'
      AND 'authenticated'::name = ANY(policy.roles)
  ) THEN
    RAISE EXCEPTION 'game-checkin RLS added a forbidden permissive FOR ALL policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.policyname LIKE 'beer_guy_checkin%authenticated'
      AND 'anon'::name = ANY(policy.roles)
  ) THEN
    RAISE EXCEPTION 'anonymous role was added to game-checkin mutation rails';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.cmd = 'SELECT'
      AND (
        policy.qual IS NULL
        OR pg_catalog.lower(
          pg_catalog.regexp_replace(policy.qual, '[()[:space:]]', '', 'g')
        ) = 'true'
      )
  ) THEN
    RAISE EXCEPTION 'game-checkin RLS added a broad permissive SELECT policy';
  END IF;

  SELECT pg_catalog.string_agg(required.policyname, ', ' ORDER BY required.policyname)
  INTO v_missing
  FROM (
    VALUES
      ('beer_guy_checkin_insert_guard', 'INSERT'),
      ('beer_guy_checkin_update_guard', 'UPDATE'),
      ('beer_guy_checkin_delete_guard', 'DELETE'),
      ('beer_guy_checkin_select_guard', 'SELECT')
  ) AS required(policyname, command)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.policyname = required.policyname
      AND policy.permissive = 'RESTRICTIVE'
      AND policy.cmd = required.command
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exact restrictive game-checkin guards missing: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'game_checkins'
      AND policy.policyname = 'fixture_checkins_all'
  ) THEN
    RAISE EXCEPTION 'legacy permissive game-checkin policy survived baseline setup';
  END IF;
END;
$policy_contract$;

DO $final_state$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000002'
         AND player_id IN (
           '40000000-0000-4000-8000-000000000018',
           '40000000-0000-4000-8000-000000000022'
         )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE game_id = '50000000-0000-4000-8000-000000000001'
         AND team_id = '30000000-0000-4000-8000-000000000001'
         AND player_id = '40000000-0000-4000-8000-000000000011'
         AND status = 'tentative'
         AND note = 'fixture note'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.game_checkins
       WHERE id = '90000000-0000-4000-8000-000000000064'
         AND status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'denied game-checkin probes changed protected state';
  END IF;
END;
$final_state$;

SELECT 'beer guy self-contained game-checkin RLS acceptance passed' AS result;
