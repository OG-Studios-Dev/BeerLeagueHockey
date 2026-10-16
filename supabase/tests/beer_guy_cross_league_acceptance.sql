\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_cross_league_rejected(
  p_label text,
  p_statement text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IN ('22023', '42501', '23514') THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'cross-league % unexpectedly succeeded', p_label;
END;
$function$;

INSERT INTO public.team_rosters(
  player_id, team_id, league_id, season_id, player_type, status,
  start_date, end_date, leadership_role, position, is_goalie, jersey_number
) VALUES
  -- Forged same-game-league rows for a team whose real league is different.
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'regular', 'active', CURRENT_DATE - 30, NULL, 'captain', 'Forward', false, 31),
  ('40000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 32),
  ('40000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Defense', false, 33),
  -- Legitimate authority for the team's real league, used to inspect tracker reads.
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003',
   'regular', 'active', CURRENT_DATE - 30, NULL, 'captain', 'Forward', false, 34);

INSERT INTO public.games(
  id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status
) VALUES (
  '50000000-0000-4000-8000-000000000017',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  pg_catalog.now() + interval '11 days',
  'scheduled'
);

-- Plant production-shaped corrupt legacy state without invoking the candidate's
-- normalizers. Every supported path must fail closed without changing it.
SET session_replication_role = replica;
INSERT INTO public.game_checkins(
  id, game_id, team_id, player_id, status, note
) VALUES (
  '90000000-0000-4000-8000-000000000017',
  '50000000-0000-4000-8000-000000000017',
  '30000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000011',
  'confirmed',
  'forged cross-league fixture'
);
INSERT INTO public.game_duties(
  id, game_id, team_id, duty_type_id, assigned_player_id,
  status, assignment_version, notes
)
SELECT
  '70000000-0000-4000-8000-000000000017',
  '50000000-0000-4000-8000-000000000017',
  '30000000-0000-4000-8000-000000000003',
  dt.id,
  '40000000-0000-4000-8000-000000000011',
  'pending',
  7,
  'forged cross-league fixture'
FROM public.duty_types AS dt
WHERE dt.team_id = '30000000-0000-4000-8000-000000000003'
  AND dt.system_key = 'beer_guy';
SET session_replication_role = origin;

DO $cross_league$
DECLARE
  v_duty_before jsonb;
  v_checkin_before jsonb;
  v_duty_after jsonb;
  v_checkin_after jsonb;
  v_tracker jsonb;
  v_direct_count integer;
  v_affected integer;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'assigned_player_id', gd.assigned_player_id,
    'status', gd.status,
    'assignment_version', gd.assignment_version,
    'updated_at', gd.updated_at
  ) INTO STRICT v_duty_before
  FROM public.game_duties AS gd
  WHERE gd.id = '70000000-0000-4000-8000-000000000017';

  SELECT pg_catalog.jsonb_build_object(
    'team_id', gc.team_id,
    'player_id', gc.player_id,
    'status', gc.status,
    'note', gc.note,
    'updated_at', gc.updated_at
  ) INTO STRICT v_checkin_before
  FROM public.game_checkins AS gc
  WHERE gc.id = '90000000-0000-4000-8000-000000000017';

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false
  );
  PERFORM pg_temp.assert_cross_league_rejected(
    'self claim',
    $sql$SELECT public.beer_guy_claim(
      '50000000-0000-4000-8000-000000000017',
      '30000000-0000-4000-8000-000000000003'
    )$sql$
  );
  PERFORM pg_temp.assert_cross_league_rejected(
    'self check-in',
    $sql$SELECT public.update_my_game_checkin(
      '50000000-0000-4000-8000-000000000017',
      '30000000-0000-4000-8000-000000000003',
      'out',
      NULL
    )$sql$
  );
  PERFORM pg_temp.assert_cross_league_rejected(
    'private game-state read',
    $sql$SELECT public.beer_guy_get_game_state(
      '50000000-0000-4000-8000-000000000017',
      '30000000-0000-4000-8000-000000000003'
    )$sql$
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false
  );
  PERFORM pg_temp.assert_cross_league_rejected(
    'captain assignment',
    $sql$SELECT public.beer_guy_captain_manage(
      '50000000-0000-4000-8000-000000000017',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000012',
      '70000000-0000-4000-8000-000000000017',
      7
    )$sql$
  );
  PERFORM pg_temp.assert_cross_league_rejected(
    'captain check-in',
    $sql$SELECT public.captain_manage_game_checkin(
      '50000000-0000-4000-8000-000000000017',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000012',
      'set',
      'confirmed'
    )$sql$
  );

  v_tracker := public.beer_guy_get_tracker('30000000-0000-4000-8000-000000000003');
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_tracker -> 'upcoming_games') AS item(value)
    WHERE item.value ->> 'game_id' = '50000000-0000-4000-8000-000000000017'
  ) THEN
    RAISE EXCEPTION 'captain tracker exposed cross-league participant spoof';
  END IF;
  IF public.beer_guy_get_public_next_assignment(
       '30000000-0000-4000-8000-000000000003'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'public read exposed cross-league participant spoof';
  END IF;

  -- The same forged roster must not make direct Beer/check-in rows visible or
  -- writable through the permissive legacy table policies.
  SET ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', '40000000-0000-4000-8000-000000000011', false
  );
  SELECT pg_catalog.count(*) INTO v_direct_count
  FROM public.game_duties
  WHERE id = '70000000-0000-4000-8000-000000000017';
  UPDATE public.game_checkins
  SET status = 'out'
  WHERE id = '90000000-0000-4000-8000-000000000017';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RESET ROLE;
  IF v_direct_count <> 0 OR v_affected <> 0 THEN
    RAISE EXCEPTION 'direct RLS path accepted cross-league spoof (read %, write %)',
      v_direct_count, v_affected;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'assigned_player_id', gd.assigned_player_id,
    'status', gd.status,
    'assignment_version', gd.assignment_version,
    'updated_at', gd.updated_at
  ) INTO STRICT v_duty_after
  FROM public.game_duties AS gd
  WHERE gd.id = '70000000-0000-4000-8000-000000000017';
  SELECT pg_catalog.jsonb_build_object(
    'team_id', gc.team_id,
    'player_id', gc.player_id,
    'status', gc.status,
    'note', gc.note,
    'updated_at', gc.updated_at
  ) INTO STRICT v_checkin_after
  FROM public.game_checkins AS gc
  WHERE gc.id = '90000000-0000-4000-8000-000000000017';
  IF v_duty_after IS DISTINCT FROM v_duty_before
     OR v_checkin_after IS DISTINCT FROM v_checkin_before THEN
    RAISE EXCEPTION 'cross-league RPC/RLS probes mutated duty or check-in state';
  END IF;

  -- Accepted-sub lifecycle invalidation also fails closed on the mismatched team.
  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id,
    status, source_type, responded_at
  ) VALUES (
    '80000000-0000-4000-8000-000000000017',
    '50000000-0000-4000-8000-000000000017',
    '30000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'accepted',
    'league',
    pg_catalog.statement_timestamp()
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE id = '70000000-0000-4000-8000-000000000017'
      AND assigned_player_id = '40000000-0000-4000-8000-000000000011'
      AND assignment_version = 7
  ) THEN
    RAISE EXCEPTION 'cross-league accepted-sub lifecycle mutated Beer assignment';
  END IF;
END;
$cross_league$;

SELECT 'beer guy cross-league fail-closed acceptance passed' AS result;
