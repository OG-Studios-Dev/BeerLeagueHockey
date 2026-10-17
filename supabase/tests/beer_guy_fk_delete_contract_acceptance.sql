\set ON_ERROR_STOP on

-- Exact post-hardening production matrix: sixteen CASCADE edges, the protected
-- duty-type edge at NO ACTION, and assignment attribution at SET NULL.
DO $fk_matrix$
DECLARE
  v_exact_count integer;
  v_cascade_count integer;
  v_no_action_count integer;
  v_set_null_count integer;
BEGIN
  WITH required(constraint_name, source_table, source_column, target_table, delete_action) AS (
    VALUES
      ('teams_league_id_fkey', 'teams', 'league_id', 'leagues', 'c'::"char"),
      ('seasons_league_id_fkey', 'seasons', 'league_id', 'leagues', 'c'::"char"),
      ('games_league_id_fkey', 'games', 'league_id', 'leagues', 'c'::"char"),
      ('games_season_id_fkey', 'games', 'season_id', 'seasons', 'c'::"char"),
      ('games_home_team_id_fkey', 'games', 'home_team_id', 'teams', 'c'::"char"),
      ('games_away_team_id_fkey', 'games', 'away_team_id', 'teams', 'c'::"char"),
      ('team_rosters_player_id_fkey', 'team_rosters', 'player_id', 'profiles', 'c'::"char"),
      ('team_rosters_team_id_fkey', 'team_rosters', 'team_id', 'teams', 'c'::"char"),
      ('team_rosters_league_id_fkey', 'team_rosters', 'league_id', 'leagues', 'c'::"char"),
      ('team_rosters_season_id_fkey', 'team_rosters', 'season_id', 'seasons', 'c'::"char"),
      ('game_checkins_game_id_fkey', 'game_checkins', 'game_id', 'games', 'c'::"char"),
      ('game_checkins_player_id_fkey', 'game_checkins', 'player_id', 'profiles', 'c'::"char"),
      ('game_checkins_team_id_fkey', 'game_checkins', 'team_id', 'teams', 'c'::"char"),
      ('duty_types_team_id_fkey', 'duty_types', 'team_id', 'teams', 'c'::"char"),
      ('game_duties_game_id_fkey', 'game_duties', 'game_id', 'games', 'c'::"char"),
      ('game_duties_team_id_fkey', 'game_duties', 'team_id', 'teams', 'c'::"char"),
      ('game_duties_duty_type_id_fkey', 'game_duties', 'duty_type_id', 'duty_types', 'a'::"char"),
      ('game_duties_assigned_player_id_fkey', 'game_duties', 'assigned_player_id', 'profiles', 'n'::"char")
  ), exact AS (
    SELECT required.delete_action
    FROM required
    JOIN pg_catalog.pg_constraint AS con
      ON con.conname = required.constraint_name
     AND con.contype = 'f'
     AND con.convalidated
     AND NOT con.condeferrable
     AND con.confdeltype = required.delete_action
    JOIN pg_catalog.pg_class AS source_table
      ON source_table.oid = con.conrelid AND source_table.relname = required.source_table
    JOIN pg_catalog.pg_namespace AS source_ns
      ON source_ns.oid = source_table.relnamespace AND source_ns.nspname = 'public'
    JOIN pg_catalog.pg_class AS target_table
      ON target_table.oid = con.confrelid AND target_table.relname = required.target_table
    JOIN pg_catalog.pg_namespace AS target_ns
      ON target_ns.oid = target_table.relnamespace AND target_ns.nspname = 'public'
    JOIN pg_catalog.pg_attribute AS source_att
      ON source_att.attrelid = source_table.oid
     AND source_att.attname = required.source_column
     AND con.conkey = ARRAY[source_att.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_att
      ON target_att.attrelid = target_table.oid
     AND target_att.attname = 'id'
     AND con.confkey = ARRAY[target_att.attnum]::smallint[]
  )
  SELECT pg_catalog.count(*),
         pg_catalog.count(*) FILTER (WHERE delete_action = 'c'),
         pg_catalog.count(*) FILTER (WHERE delete_action = 'a'),
         pg_catalog.count(*) FILTER (WHERE delete_action = 'n')
  INTO v_exact_count, v_cascade_count, v_no_action_count, v_set_null_count
  FROM exact;

  IF (v_exact_count, v_cascade_count, v_no_action_count, v_set_null_count)
     IS DISTINCT FROM (18, 16, 1, 1) THEN
    RAISE EXCEPTION 'unexpected Beer Guy FK matrix: exact %, cascade %, no action %, set null %',
      v_exact_count, v_cascade_count, v_no_action_count, v_set_null_count;
  END IF;
END;
$fk_matrix$;

-- The canonical duty row's BEFORE DELETE preservation trigger must not be able
-- to suppress a CASCADE and leave an orphan. The parent delete is rejected and
-- both parent and child survive atomically.
DO $canonical_duty_delete$
DECLARE
  v_beer_type_id uuid;
  v_duty_count integer;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001'
    AND system_key = 'beer_guy';

  SELECT pg_catalog.count(*) INTO v_duty_count
  FROM public.game_duties
  WHERE duty_type_id = v_beer_type_id;
  IF v_duty_count = 0 THEN
    RAISE EXCEPTION 'canonical duty delete fixture has no child duty';
  END IF;

  BEGIN
    DELETE FROM public.duty_types WHERE id = v_beer_type_id;
  EXCEPTION
    WHEN foreign_key_violation THEN
      v_rejected := true;
  END;

  IF NOT v_rejected
     OR NOT EXISTS (SELECT 1 FROM public.duty_types WHERE id = v_beer_type_id)
     OR (SELECT pg_catalog.count(*) FROM public.game_duties WHERE duty_type_id = v_beer_type_id) <> v_duty_count
     OR EXISTS (
       SELECT 1
       FROM public.game_duties AS gd
       LEFT JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id
       WHERE dt.id IS NULL
     ) THEN
    RAISE EXCEPTION 'direct canonical duty-type deletion was not rejected without orphaning duties';
  END IF;
END;
$canonical_duty_delete$;

-- Schedule regeneration and playoff regeneration both hard-delete parent games.
-- Each representative parent delete must remove its check-in and Beer duty even
-- though the canonical-duty child has a preservation trigger.
DO $parent_game_deletes$
DECLARE
  v_beer_type_id uuid;
  v_game_id uuid;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001'
    AND system_key = 'beer_guy';

  FOREACH v_game_id IN ARRAY ARRAY[
    '59000000-0000-4000-8000-000000000001'::uuid,
    '59000000-0000-4000-8000-000000000002'::uuid
  ] LOOP
    INSERT INTO public.games(
      id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status
    ) VALUES (
      v_game_id,
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.now() + interval '60 days',
      'scheduled'
    );
    INSERT INTO public.game_checkins(game_id, player_id, team_id, status)
    VALUES (
      v_game_id,
      '40000000-0000-4000-8000-000000000011',
      '30000000-0000-4000-8000-000000000001',
      'confirmed'
    );
    INSERT INTO public.game_duties(game_id, team_id, duty_type_id, status)
    VALUES (
      v_game_id,
      '30000000-0000-4000-8000-000000000001',
      v_beer_type_id,
      'pending'
    );

    DELETE FROM public.games WHERE id = v_game_id;

    IF EXISTS (SELECT 1 FROM public.games WHERE id = v_game_id)
       OR EXISTS (SELECT 1 FROM public.game_checkins WHERE game_id = v_game_id)
       OR EXISTS (SELECT 1 FROM public.game_duties WHERE game_id = v_game_id) THEN
      RAISE EXCEPTION 'parent-game delete did not cascade for schedule/playoff fixture %', v_game_id;
    END IF;
  END LOOP;
END;
$parent_game_deletes$;

-- Hard team cleanup, no-game season deletion, season-with-game cleanup, and
-- league rollback retain their existing cascade contracts.
DO $hierarchy_deletes$
DECLARE
  v_beer_type_id uuid;
BEGIN
  -- Team cleanup cascades through its game, attendance, canonical type, and duty.
  INSERT INTO public.teams(id, league_id, name)
  VALUES ('39000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001', 'Delete Team Fixture');
  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status)
  VALUES ('58000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '39000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000002',
          pg_catalog.now() + interval '70 days', 'scheduled');
  INSERT INTO public.game_checkins(game_id, player_id, team_id, status)
  VALUES ('58000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000011',
          '39000000-0000-4000-8000-000000000001', 'confirmed');
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '39000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, status)
  VALUES ('58000000-0000-4000-8000-000000000001',
          '39000000-0000-4000-8000-000000000001', v_beer_type_id, 'pending');
  DELETE FROM public.teams WHERE id = '39000000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.games WHERE id = '58000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.game_checkins WHERE game_id = '58000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.game_duties WHERE game_id = '58000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.duty_types WHERE id = v_beer_type_id) THEN
    RAISE EXCEPTION 'hard team cleanup did not cascade through Beer Guy dependents';
  END IF;

  -- Product season deletion permits a season with roster rows but no games.
  INSERT INTO public.seasons(id, league_id, name, start_date, status)
  VALUES ('29000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001', 'No-game Season', CURRENT_DATE, 'draft');
  INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status)
  VALUES ('40000000-0000-4000-8000-000000000011',
          '30000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '29000000-0000-4000-8000-000000000001', 'regular', 'active');
  DELETE FROM public.seasons WHERE id = '29000000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.team_rosters WHERE season_id = '29000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'no-game season deletion did not cascade roster rows';
  END IF;

  -- Privileged season cleanup with a game cascades through game children.
  INSERT INTO public.seasons(id, league_id, name, start_date, status)
  VALUES ('29000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001', 'Game Season', CURRENT_DATE, 'draft');
  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status)
  VALUES ('58000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001',
          '29000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000002',
          pg_catalog.now() + interval '80 days', 'scheduled');
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, status)
  VALUES ('58000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000001', v_beer_type_id, 'pending');
  DELETE FROM public.seasons WHERE id = '29000000-0000-4000-8000-000000000002';
  IF EXISTS (SELECT 1 FROM public.games WHERE id = '58000000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT 1 FROM public.game_duties WHERE game_id = '58000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'season cleanup did not cascade game duties';
  END IF;

  -- League rollback removes its complete isolated hierarchy without orphans.
  INSERT INTO public.leagues(id, name, timezone)
  VALUES ('19000000-0000-4000-8000-000000000001', 'Rollback League', 'UTC');
  INSERT INTO public.seasons(id, league_id, name, start_date, status)
  VALUES ('29000000-0000-4000-8000-000000000003',
          '19000000-0000-4000-8000-000000000001', 'Rollback Season', CURRENT_DATE, 'draft');
  INSERT INTO public.teams(id, league_id, name) VALUES
    ('39000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', 'Rollback Home'),
    ('39000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', 'Rollback Away');
  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status)
  VALUES ('58000000-0000-4000-8000-000000000003',
          '19000000-0000-4000-8000-000000000001',
          '29000000-0000-4000-8000-000000000003',
          '39000000-0000-4000-8000-000000000002',
          '39000000-0000-4000-8000-000000000003',
          pg_catalog.now() + interval '90 days', 'scheduled');
  INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status)
  VALUES ('40000000-0000-4000-8000-000000000011',
          '39000000-0000-4000-8000-000000000002',
          '19000000-0000-4000-8000-000000000001',
          '29000000-0000-4000-8000-000000000003', 'regular', 'active');
  INSERT INTO public.game_checkins(game_id, player_id, team_id, status)
  VALUES ('58000000-0000-4000-8000-000000000003',
          '40000000-0000-4000-8000-000000000011',
          '39000000-0000-4000-8000-000000000002', 'confirmed');
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '39000000-0000-4000-8000-000000000002' AND system_key = 'beer_guy';
  INSERT INTO public.game_duties(game_id, team_id, duty_type_id, status)
  VALUES ('58000000-0000-4000-8000-000000000003',
          '39000000-0000-4000-8000-000000000002', v_beer_type_id, 'pending');
  DELETE FROM public.leagues WHERE id = '19000000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.seasons WHERE league_id = '19000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.teams WHERE league_id = '19000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.games WHERE league_id = '19000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.team_rosters WHERE league_id = '19000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.game_checkins WHERE game_id = '58000000-0000-4000-8000-000000000003')
     OR EXISTS (SELECT 1 FROM public.game_duties WHERE game_id = '58000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'league rollback did not remove the isolated hierarchy';
  END IF;
END;
$hierarchy_deletes$;

-- SET NULL remains intentional for non-Beer and eligible future Beer duties;
-- completed Beer attribution blocks physical profile deletion atomically.
DO $profile_delete_contract$
DECLARE
  v_beer_type_id uuid;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';

  INSERT INTO public.profiles(id, full_name, email) VALUES
    ('49000000-0000-4000-8000-000000000001', 'Non Beer Delete', 'nonbeer-delete@example.invalid'),
    ('49000000-0000-4000-8000-000000000002', 'Future Beer Delete', 'future-delete@example.invalid'),
    ('49000000-0000-4000-8000-000000000003', 'Completed Beer Delete', 'completed-delete@example.invalid');

  INSERT INTO public.game_duties(id, game_id, team_id, duty_type_id, assigned_player_id, status)
  VALUES ('79000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000005',
          '30000000-0000-4000-8000-000000000001',
          '60000000-0000-4000-8000-000000000001',
          '49000000-0000-4000-8000-000000000001', 'pending');
  DELETE FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000001';
  IF NOT EXISTS (
    SELECT 1 FROM public.game_duties
    WHERE id = '79000000-0000-4000-8000-000000000001' AND assigned_player_id IS NULL
  ) THEN
    RAISE EXCEPTION 'non-Beer profile deletion did not preserve the duty with SET NULL';
  END IF;

  INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status)
  VALUES ('49000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001', 'regular', 'active');
  INSERT INTO public.game_checkins(game_id, player_id, team_id, status)
  VALUES ('50000000-0000-4000-8000-000000000009',
          '49000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000001', 'confirmed');
  INSERT INTO public.game_duties(id, game_id, team_id, duty_type_id, assigned_player_id, status)
  VALUES ('79000000-0000-4000-8000-000000000002',
          '50000000-0000-4000-8000-000000000009',
          '30000000-0000-4000-8000-000000000001', v_beer_type_id,
          '49000000-0000-4000-8000-000000000002', 'pending');
  DELETE FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000002';
  IF EXISTS (SELECT 1 FROM public.team_rosters WHERE player_id = '49000000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT 1 FROM public.game_checkins WHERE player_id = '49000000-0000-4000-8000-000000000002')
     OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = '79000000-0000-4000-8000-000000000002'
         AND assigned_player_id IS NULL AND status = 'pending'
     ) THEN
    RAISE EXCEPTION 'future Beer profile deletion did not cascade authority and reopen the stable duty';
  END IF;

  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status)
  VALUES ('57000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000002',
          pg_catalog.now() - interval '10 days', 'completed');
  INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status)
  VALUES ('49000000-0000-4000-8000-000000000003',
          '30000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001', 'regular', 'active');
  INSERT INTO public.game_checkins(game_id, player_id, team_id, status)
  VALUES ('57000000-0000-4000-8000-000000000001',
          '49000000-0000-4000-8000-000000000003',
          '30000000-0000-4000-8000-000000000001', 'confirmed');
  INSERT INTO public.game_duties(id, game_id, team_id, duty_type_id, assigned_player_id, status)
  VALUES ('79000000-0000-4000-8000-000000000003',
          '57000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001', v_beer_type_id,
          '49000000-0000-4000-8000-000000000003', 'completed');

  BEGIN
    DELETE FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000003';
  EXCEPTION
    WHEN check_violation THEN
      v_rejected := true;
  END;
  IF NOT v_rejected
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000003')
     OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = '79000000-0000-4000-8000-000000000003'
         AND assigned_player_id = '49000000-0000-4000-8000-000000000003'
         AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'completed Beer profile deletion was not rejected with history intact';
  END IF;
END;
$profile_delete_contract$;

-- Retirement keeps completed attribution while reopening future work. A mediated
-- merge repoints roster/check-in/duty identity before deleting the source profile.
DO $identity_history_contract$
DECLARE
  v_beer_type_id uuid;
BEGIN
  SELECT id INTO STRICT v_beer_type_id
  FROM public.duty_types
  WHERE team_id = '30000000-0000-4000-8000-000000000001' AND system_key = 'beer_guy';

  INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status) VALUES
    ('56000000-0000-4000-8000-000000000001',
     '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
     '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
     pg_catalog.now() + interval '100 days', 'scheduled'),
    ('56000000-0000-4000-8000-000000000002',
     '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
     '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
     pg_catalog.now() - interval '20 days', 'completed'),
    ('56000000-0000-4000-8000-000000000003',
     '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
     '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
     pg_catalog.now() - interval '30 days', 'completed');

  INSERT INTO public.profiles(id, full_name, email) VALUES
    ('49000000-0000-4000-8000-000000000004', 'Retiring Player', 'retiring@example.invalid'),
    ('49000000-0000-4000-8000-000000000005', 'Merge Source', 'merge-source@example.invalid'),
    ('49000000-0000-4000-8000-000000000006', 'Merge Target', 'merge-target@example.invalid');
  INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status) VALUES
    ('49000000-0000-4000-8000-000000000004',
     '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001', 'regular', 'active'),
    ('49000000-0000-4000-8000-000000000005',
     '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001', 'regular', 'active');
  INSERT INTO public.game_checkins(game_id, player_id, team_id, status) VALUES
    ('56000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000004',
     '30000000-0000-4000-8000-000000000001', 'confirmed'),
    ('56000000-0000-4000-8000-000000000002', '49000000-0000-4000-8000-000000000004',
     '30000000-0000-4000-8000-000000000001', 'confirmed'),
    ('56000000-0000-4000-8000-000000000003', '49000000-0000-4000-8000-000000000005',
     '30000000-0000-4000-8000-000000000001', 'confirmed');
  INSERT INTO public.game_duties(id, game_id, team_id, duty_type_id, assigned_player_id, status) VALUES
    ('79000000-0000-4000-8000-000000000004', '56000000-0000-4000-8000-000000000001',
     '30000000-0000-4000-8000-000000000001', v_beer_type_id,
     '49000000-0000-4000-8000-000000000004', 'pending'),
    ('79000000-0000-4000-8000-000000000005', '56000000-0000-4000-8000-000000000002',
     '30000000-0000-4000-8000-000000000001', v_beer_type_id,
     '49000000-0000-4000-8000-000000000004', 'completed'),
    ('79000000-0000-4000-8000-000000000006', '56000000-0000-4000-8000-000000000003',
     '30000000-0000-4000-8000-000000000001', v_beer_type_id,
     '49000000-0000-4000-8000-000000000005', 'completed');

  UPDATE public.profiles
  SET deleted_at = pg_catalog.statement_timestamp(), full_name = 'Deleted User'
  WHERE id = '49000000-0000-4000-8000-000000000004';
  IF NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = '79000000-0000-4000-8000-000000000004' AND assigned_player_id IS NULL
     ) OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = '79000000-0000-4000-8000-000000000005'
         AND assigned_player_id = '49000000-0000-4000-8000-000000000004'
         AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'profile retirement did not reopen future work and retain completed history';
  END IF;

  UPDATE public.team_rosters
  SET player_id = '49000000-0000-4000-8000-000000000006'
  WHERE player_id = '49000000-0000-4000-8000-000000000005';
  UPDATE public.game_checkins
  SET player_id = '49000000-0000-4000-8000-000000000006'
  WHERE player_id = '49000000-0000-4000-8000-000000000005';
  UPDATE public.game_duties
  SET assigned_player_id = '49000000-0000-4000-8000-000000000006'
  WHERE assigned_player_id = '49000000-0000-4000-8000-000000000005';
  DELETE FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000005';

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '49000000-0000-4000-8000-000000000005')
     OR NOT EXISTS (
       SELECT 1 FROM public.team_rosters
       WHERE player_id = '49000000-0000-4000-8000-000000000006'
         AND team_id = '30000000-0000-4000-8000-000000000001'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.game_checkins
       WHERE game_id = '56000000-0000-4000-8000-000000000003'
         AND player_id = '49000000-0000-4000-8000-000000000006'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.game_duties
       WHERE id = '79000000-0000-4000-8000-000000000006'
         AND assigned_player_id = '49000000-0000-4000-8000-000000000006'
         AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'profile merge did not repoint and retain completed identity history';
  END IF;
END;
$identity_history_contract$;

SELECT 'beer guy production-shaped FK delete contract acceptance passed' AS result;
