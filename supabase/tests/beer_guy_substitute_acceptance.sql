\set ON_ERROR_STOP on

DO $accepted_substitute$
DECLARE
  v_result jsonb;
  v_tracker jsonb;
  v_beer_type_id uuid;
  v_assignment_id uuid;
  v_rejected boolean;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001'
    AND system_key = 'beer_guy';

  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
  ) VALUES (
    '80000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    'accepted',
    'league',
    pg_catalog.statement_timestamp()
  );

  -- Accepted substitutes are game-scoped ineligible even when they also own an
  -- otherwise valid active/open regular roster row.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000012',
    false
  );
  v_rejected := false;
  BEGIN
    PERFORM public.beer_guy_claim(
      '50000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'accepted substitute with regular roster row self-claimed Beer Guy';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  v_rejected := false;
  BEGIN
    PERFORM public.beer_guy_captain_manage(
      '50000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000012',
      NULL,
      NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'captain assigned accepted substitute with regular roster row';
  END IF;

  -- Invitation acceptance after assignment must atomically reopen every
  -- non-completed Beer assignment for that exact game/team/player.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;

  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
  ) VALUES (
    '80000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'accepted',
    'league',
    pg_catalog.statement_timestamp()
  );
  IF EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE id = v_assignment_id AND assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'accepting a substitute invitation did not reopen assigned Beer Guy';
  END IF;

  -- A legacy/corrupt accepted-sub assignment is hidden by every supported read,
  -- including direct member RLS, private state, tracker, and public next-game.
  SET LOCAL session_replication_role = replica;
  UPDATE public.game_duties
  SET assigned_player_id = '40000000-0000-4000-8000-000000000011',
      status = 'pending'
  WHERE id = v_assignment_id;
  SET LOCAL session_replication_role = origin;

  v_result := public.beer_guy_get_game_state(
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_result -> 'assignment' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'private game state exposed accepted-sub Beer assignment: %', v_result;
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  v_tracker := public.beer_guy_get_tracker('30000000-0000-4000-8000-000000000001');
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_tracker -> 'upcoming_games') AS row(value)
    WHERE row.value ->> 'game_id' = '50000000-0000-4000-8000-000000000002'
      AND row.value -> 'assignment' <> 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'captain tracker exposed accepted-sub Beer assignment: %', v_tracker;
  END IF;

  UPDATE public.games
  SET status = 'cancelled'
  WHERE id = '50000000-0000-4000-8000-000000000001';
  IF public.beer_guy_get_public_next_assignment(
       '30000000-0000-4000-8000-000000000001'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'public next-game read exposed accepted-sub Beer assignment';
  END IF;

  SET ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  IF EXISTS (
    SELECT 1 FROM public.game_duties WHERE id = v_assignment_id
  ) THEN
    RAISE EXCEPTION 'direct member RLS exposed accepted-sub Beer assignment';
  END IF;
  RESET ROLE;
END;
$accepted_substitute$;

DO $invitation_rls_authority$
DECLARE
  v_result jsonb;
  v_assignment_id uuid;
  v_affected integer;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001'
  );
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;

  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id, status, source_type
  ) VALUES (
    '80000000-0000-4000-8000-000000000009',
    '50000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'pending',
    'league'
  );

  -- A non-invitee non-captain cannot manufacture accepted-substitute state to
  -- clear another player's Beer assignment through a permissive baseline policy.
  SET ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000021',
    false
  );
  UPDATE public.sub_invitations
  SET status = 'accepted', responded_at = pg_catalog.statement_timestamp()
  WHERE id = '80000000-0000-4000-8000-000000000009';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RESET ROLE;

  IF v_affected <> 0
     OR EXISTS (
       SELECT 1 FROM public.sub_invitations
       WHERE id = '80000000-0000-4000-8000-000000000009'
         AND status = 'accepted'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = v_assignment_id
         AND assigned_player_id = '40000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'unauthorized invitation acceptance altered Beer authority';
  END IF;
END;
$invitation_rls_authority$;

DO $invitation_write_matrix$
DECLARE
  v_result jsonb;
  v_assignment_id uuid;
  v_blocked boolean;
  v_affected integer;
BEGIN
  -- A historical active-looking captain row must not authorize current-season
  -- invitation writes for this team.
  UPDATE public.team_rosters
  SET leadership_role = 'captain'
  WHERE player_id = '40000000-0000-4000-8000-000000000019'
    AND team_id = '30000000-0000-4000-8000-000000000001'
    AND season_id = '20000000-0000-4000-8000-000000000002';

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000011',
    false
  );
  v_result := public.beer_guy_claim(
    '50000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000001'
  );
  v_assignment_id := (v_result #>> '{assignment,id}')::uuid;

  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
  ) VALUES (
    '80000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    'accepted',
    'league',
    pg_catalog.statement_timestamp()
  );

  -- Reproduce both destructive paths first: an old-season captain must not be
  -- able to manufacture accepted-sub state or delete it to restore eligibility.
  SET ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000019',
    false
  );
  v_blocked := false;
  BEGIN
    INSERT INTO public.sub_invitations(
      id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
    ) VALUES (
      '80000000-0000-4000-8000-000000000012',
      '50000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000019',
      '40000000-0000-4000-8000-000000000011',
      'accepted',
      'league',
      pg_catalog.statement_timestamp()
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'historical captain inserted an accepted current-game invitation';
  END IF;

  v_blocked := false;
  BEGIN
    DELETE FROM public.sub_invitations
    WHERE id = '80000000-0000-4000-8000-000000000011';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION 'historical captain deleted a current-game accepted invitation';
    END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  RESET ROLE;

  -- Current exact captains retain legitimate pending invitation creation.
  SET ROLE authenticated;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  INSERT INTO public.sub_invitations(
    id, game_id, team_id, invited_by, invited_player_id, status, source_type
  ) VALUES (
    '80000000-0000-4000-8000-000000000010',
    '50000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000014',
    'pending',
    'team'
  );

  -- Invitees may perform only the intended pending -> accepted/declined response
  -- while every identity/scope/content field remains immutable.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000014',
    false
  );
  v_blocked := false;
  BEGIN
    UPDATE public.sub_invitations
    SET message = 'invitee rewrote captain content'
    WHERE id = '80000000-0000-4000-8000-000000000010';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'invitee changed invitation content without responding';
  END IF;

  UPDATE public.sub_invitations
  SET status = 'accepted',
      responded_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = '80000000-0000-4000-8000-000000000010';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'exact invitee could not accept a pending invitation';
  END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.sub_invitations
    SET status = 'declined', updated_at = pg_catalog.statement_timestamp()
    WHERE id = '80000000-0000-4000-8000-000000000010';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'invitee changed an already answered invitation';
  END IF;

  -- Current exact captains retain response and delete authority.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    false
  );
  DELETE FROM public.sub_invitations
  WHERE id = '80000000-0000-4000-8000-000000000010';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'current exact captain could not delete invitation';
  END IF;
  RESET ROLE;

  IF EXISTS (
       SELECT 1 FROM public.sub_invitations
       WHERE id = '80000000-0000-4000-8000-000000000012'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sub_invitations
       WHERE id = '80000000-0000-4000-8000-000000000011'
         AND status = 'accepted'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = v_assignment_id
         AND assigned_player_id = '40000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'historical captain invitation attack changed Beer eligibility or assignment';
  END IF;
END;
$invitation_write_matrix$;

SELECT 'beer guy accepted-substitute authority and lifecycle acceptance passed' AS result;
