\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_scoped_rpc_reply(
  p_result jsonb,
  p_game_id uuid,
  p_team_id uuid,
  p_expected_outcome text,
  p_expected_keys text[],
  p_context text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_actual_keys text[];
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '% did not return a JSON object: %', p_context, p_result;
  END IF;

  SELECT pg_catalog.array_agg(key ORDER BY key)
  INTO v_actual_keys
  FROM pg_catalog.jsonb_object_keys(p_result) AS reply_key(key);

  IF p_result ->> 'game_id' IS DISTINCT FROM p_game_id::text
     OR p_result ->> 'team_id' IS DISTINCT FROM p_team_id::text
     OR p_result ->> 'outcome' IS DISTINCT FROM p_expected_outcome
     OR v_actual_keys IS DISTINCT FROM p_expected_keys THEN
    RAISE EXCEPTION '% returned an unscoped, stale, or inexact reply: % (keys %)',
      p_context, p_result, v_actual_keys;
  END IF;
END;
$function$;

DO $reply_scope$
DECLARE
  v_result jsonb;
  v_assignment_id uuid;
  v_version bigint;
  v_game_one constant uuid := '50000000-0000-4000-8000-000000000001';
  v_game_two constant uuid := '50000000-0000-4000-8000-000000000002';
  v_game_three constant uuid := '50000000-0000-4000-8000-000000000003';
  v_game_nine constant uuid := '50000000-0000-4000-8000-000000000009';
  v_team constant uuid := '30000000-0000-4000-8000-000000000001';
  v_other_team constant uuid := '30000000-0000-4000-8000-000000000002';
  v_checkin_keys constant text[] := ARRAY[
    'affected_rows', 'checkin_id', 'game_id', 'operation', 'outcome', 'status', 'team_id'
  ];
  v_assignment_keys constant text[] := ARRAY['assignment', 'game_id', 'outcome', 'team_id'];
BEGIN
  -- Give the same captain and players authority on the opposing team so the
  -- sequence proves both scope dimensions are derived from each request.
  INSERT INTO public.team_rosters(
    player_id, team_id, league_id, season_id, player_type, status,
    start_date, end_date, leadership_role, position, is_goalie, jersey_number
  ) VALUES
    (
      '40000000-0000-4000-8000-000000000001', v_other_team,
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'regular', 'active', CURRENT_DATE - 30, NULL, 'captain', 'Forward', false, 1
    ),
    (
      '40000000-0000-4000-8000-000000000011', v_other_team,
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 11
    ),
    (
      '40000000-0000-4000-8000-000000000012', v_other_team,
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Defense', false, 12
    );

  -- Self check-in covers its set, reset, and already-waiting returns. Switching
  -- games between branches proves a reply cannot retain the prior request scope.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  v_result := public.update_my_game_checkin(v_game_two, v_team, 'tentative', 'scope test');
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_two, v_team, 'set', v_checkin_keys, 'self check-in set'
  );
  v_result := public.update_my_game_checkin(v_game_two, v_team, NULL, NULL);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_two, v_team, 'reset', v_checkin_keys, 'self check-in reset'
  );
  v_result := public.update_my_game_checkin(v_game_three, v_other_team, NULL, NULL);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_three, v_other_team, 'already_waiting', v_checkin_keys,
    'self check-in already waiting after a different game and team'
  );

  -- Self-claim covers every protocol outcome and then changes games to ensure a
  -- later result is scoped from its own request rather than earlier state.
  v_result := public.beer_guy_claim(v_game_one, v_team);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_one, v_team, 'claimed', v_assignment_keys, 'self claim won'
  );
  v_result := public.beer_guy_claim(v_game_one, v_team);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_one, v_team, 'assigned_to_self', v_assignment_keys,
    'self claim idempotent'
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000012',
    false
  );
  v_result := public.beer_guy_claim(v_game_one, v_team);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_one, v_team, 'taken', v_assignment_keys, 'self claim taken'
  );
  v_result := public.beer_guy_claim(v_game_two, v_other_team);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_two, v_other_team, 'claimed', v_assignment_keys,
    'self claim after a different game and team'
  );

  -- Captain CAS covers every return branch, including both already-clear
  -- branches (absent row and present unassigned row) plus a null conflict.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  v_result := public.beer_guy_captain_manage(v_game_three, v_team, NULL, NULL, NULL);
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_three, v_team, 'already_clear', v_assignment_keys,
    'captain already clear without assignment'
  );
  v_result := public.beer_guy_captain_manage(
    v_game_three,
    v_team,
    NULL,
    '70000000-0000-4000-8000-000000000099',
    1
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_three, v_team, 'conflict', v_assignment_keys,
    'captain conflict without assignment'
  );

  v_result := public.beer_guy_captain_manage(
    v_game_nine,
    v_other_team,
    '40000000-0000-4000-8000-000000000011',
    NULL,
    NULL
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_nine, v_other_team, 'assigned', v_assignment_keys,
    'captain assigned after a different game and team'
  );
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;
  v_version := (v_result #>> '{assignment,version}')::bigint;

  v_result := public.beer_guy_captain_manage(
    v_game_nine,
    v_other_team,
    '40000000-0000-4000-8000-000000000011',
    v_assignment_id,
    v_version
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_nine, v_other_team, 'unchanged', v_assignment_keys, 'captain unchanged'
  );
  v_version := (v_result #>> '{assignment,version}')::bigint;

  v_result := public.beer_guy_captain_manage(
    v_game_nine,
    v_other_team,
    '40000000-0000-4000-8000-000000000012',
    v_assignment_id,
    v_version
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_nine, v_other_team, 'reassigned', v_assignment_keys, 'captain reassigned'
  );
  v_version := (v_result #>> '{assignment,version}')::bigint;

  v_result := public.beer_guy_captain_manage(
    v_game_nine, v_other_team, NULL, v_assignment_id, v_version
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_nine, v_other_team, 'cleared', v_assignment_keys, 'captain cleared'
  );
  v_version := (v_result #>> '{assignment,version}')::bigint;

  v_result := public.beer_guy_captain_manage(
    v_game_nine, v_other_team, NULL, v_assignment_id, v_version
  );
  PERFORM pg_temp.assert_scoped_rpc_reply(
    v_result, v_game_nine, v_other_team, 'already_clear', v_assignment_keys,
    'captain already clear with assignment'
  );
END;
$reply_scope$;

SELECT 'beer guy mutation reply scope acceptance passed' AS result;
