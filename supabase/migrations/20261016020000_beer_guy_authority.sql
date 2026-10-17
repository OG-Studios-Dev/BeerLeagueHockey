BEGIN;

-- The active migration history does not contain the legacy duty-table DDL or the
-- deployed captain check-in RPC. Refuse an unknown baseline before any feature DDL.
DO $beer_guy_preflight$
DECLARE
  v_missing text;
  v_existing text;
  v_captain_proc oid;
  v_captain_arg_names text[];
  v_captain_return regtype;
  v_captain_owner name;
  v_captain_security_definer boolean;
  v_realtime_publication pg_catalog.pg_publication%ROWTYPE;
  v_current_role_oid oid;
  v_current_role_superuser boolean;
BEGIN
  -- Postgres Changes subscriptions require an existing compatible publication
  -- that this migration can alter. Reject before any Beer Guy schema/data write.
  SELECT * INTO v_realtime_publication
  FROM pg_catalog.pg_publication
  WHERE pubname = 'supabase_realtime';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; supabase_realtime publication is missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT role.oid, role.rolsuper
  INTO v_current_role_oid, v_current_role_superuser
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = current_user;
  IF v_realtime_publication.pubowner IS DISTINCT FROM v_current_role_oid
     AND v_current_role_superuser IS NOT TRUE
     AND NOT pg_catalog.pg_has_role(
       current_user,
       v_realtime_publication.pubowner,
       'USAGE'
     ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; current migration role cannot alter supabase_realtime publication'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    v_realtime_publication.pubinsert
    AND v_realtime_publication.pubupdate
    AND v_realtime_publication.pubdelete
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; supabase_realtime must publish insert, update, and delete changes'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_table
    JOIN pg_catalog.pg_class AS published_table
      ON published_table.oid = publication_table.prrelid
    JOIN pg_catalog.pg_namespace AS published_schema
      ON published_schema.oid = published_table.relnamespace
    WHERE publication_table.prpubid = v_realtime_publication.oid
      AND published_schema.nspname = 'public'
      AND published_table.relname IN ('game_checkins', 'game_duties')
      AND (
        publication_table.prqual IS NOT NULL
        OR publication_table.prattrs IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; subscribed Realtime tables cannot use publication row or column filters'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.relation_name || '.' || required.column_name, ', ' ORDER BY required.relation_name, required.column_name)
  INTO v_missing
  FROM (
    VALUES
      ('leagues', 'id', 'uuid'), ('leagues', 'timezone', 'text'),
      ('teams', 'id', 'uuid'), ('teams', 'league_id', 'uuid'),
      ('seasons', 'id', 'uuid'), ('seasons', 'league_id', 'uuid'),
      ('seasons', 'status', 'season_status'), ('seasons', 'start_date', 'date'), ('seasons', 'created_at', 'timestamptz'),
      ('games', 'id', 'uuid'), ('games', 'league_id', 'uuid'), ('games', 'season_id', 'uuid'),
      ('games', 'home_team_id', 'uuid'), ('games', 'away_team_id', 'uuid'),
      ('games', 'scheduled_at', 'timestamptz'), ('games', 'status', 'game_status'),
      ('profiles', 'id', 'uuid'), ('profiles', 'full_name', 'text'), ('profiles', 'avatar_url', 'text'), ('profiles', 'deleted_at', 'timestamptz'),
      ('team_rosters', 'id', 'uuid'), ('team_rosters', 'player_id', 'uuid'), ('team_rosters', 'team_id', 'uuid'),
      ('team_rosters', 'league_id', 'uuid'), ('team_rosters', 'season_id', 'uuid'),
      ('team_rosters', 'player_type', 'text'), ('team_rosters', 'status', 'roster_status'),
      ('team_rosters', 'start_date', 'date'), ('team_rosters', 'end_date', 'date'),
      ('team_rosters', 'leadership_role', 'leadership_role'), ('team_rosters', 'position', 'player_position'),
      ('team_rosters', 'is_goalie', 'bool'), ('team_rosters', 'jersey_number', 'int4'),
      ('game_checkins', 'id', 'uuid'), ('game_checkins', 'game_id', 'uuid'),
      ('game_checkins', 'player_id', 'uuid'), ('game_checkins', 'team_id', 'uuid'),
      ('game_checkins', 'status', 'text'), ('game_checkins', 'note', 'text'),
      ('game_checkins', 'created_at', 'timestamptz'), ('game_checkins', 'updated_at', 'timestamptz'),
      ('duty_types', 'id', 'uuid'), ('duty_types', 'team_id', 'uuid'), ('duty_types', 'name', 'text'),
      ('duty_types', 'description', 'text'), ('duty_types', 'icon', 'text'),
      ('duty_types', 'is_active', 'bool'), ('duty_types', 'sort_order', 'int4'),
      ('game_duties', 'id', 'uuid'), ('game_duties', 'game_id', 'uuid'),
      ('game_duties', 'team_id', 'uuid'), ('game_duties', 'duty_type_id', 'uuid'),
      ('game_duties', 'assigned_player_id', 'uuid'), ('game_duties', 'status', 'text'),
      ('game_duties', 'notes', 'text'), ('game_duties', 'created_at', 'timestamptz'),
      ('game_duties', 'updated_at', 'timestamptz'),
      ('sub_invitations', 'id', 'uuid'), ('sub_invitations', 'game_id', 'uuid'),
      ('sub_invitations', 'team_id', 'uuid'), ('sub_invitations', 'invited_by', 'uuid'),
      ('sub_invitations', 'invited_player_id', 'uuid'), ('sub_invitations', 'replaced_player_id', 'uuid'),
      ('sub_invitations', 'source_type', 'text'), ('sub_invitations', 'status', 'text'),
      ('sub_invitations', 'message', 'text'), ('sub_invitations', 'responded_at', 'timestamptz'),
      ('sub_invitations', 'created_at', 'timestamptz'), ('sub_invitations', 'updated_at', 'timestamptz')
  ) AS required(relation_name, column_name, udt_name)
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public'
   AND c.table_name = required.relation_name
   AND c.column_name = required.column_name
   AND c.udt_name = required.udt_name
  WHERE c.column_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; missing or mismatched columns: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.relation_name || '.' || required.column_name, ', ' ORDER BY required.relation_name, required.column_name)
  INTO v_missing
  FROM (
    VALUES
      ('leagues', 'id'), ('leagues', 'timezone'),
      ('teams', 'id'), ('teams', 'league_id'),
      ('seasons', 'id'), ('seasons', 'league_id'), ('seasons', 'start_date'),
      ('games', 'id'), ('games', 'league_id'), ('games', 'season_id'),
      ('games', 'home_team_id'), ('games', 'away_team_id'), ('games', 'scheduled_at'),
      ('profiles', 'id'),
      ('team_rosters', 'id'), ('team_rosters', 'player_id'), ('team_rosters', 'team_id'),
      ('team_rosters', 'league_id'), ('team_rosters', 'season_id'),
      ('team_rosters', 'player_type'), ('team_rosters', 'status'), ('team_rosters', 'start_date'),
      ('game_checkins', 'id'), ('game_checkins', 'game_id'), ('game_checkins', 'player_id'),
      ('game_checkins', 'team_id'), ('game_checkins', 'status'),
      ('duty_types', 'id'), ('duty_types', 'team_id'), ('duty_types', 'name'),
      ('game_duties', 'id'), ('game_duties', 'game_id'), ('game_duties', 'team_id'),
      ('game_duties', 'duty_type_id'),
      ('sub_invitations', 'id'), ('sub_invitations', 'game_id'), ('sub_invitations', 'team_id'),
      ('sub_invitations', 'invited_by'), ('sub_invitations', 'invited_player_id'),
      ('sub_invitations', 'source_type'), ('sub_invitations', 'status')
  ) AS required(relation_name, column_name)
  JOIN information_schema.columns AS c
    ON c.table_schema = 'public'
   AND c.table_name = required.relation_name
   AND c.column_name = required.column_name
  WHERE c.is_nullable <> 'NO';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; required columns are nullable: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.relation_name || '.' || required.column_name, ', ' ORDER BY required.relation_name, required.column_name)
  INTO v_missing
  FROM (
    VALUES
      ('duty_types', 'id'),
      ('game_duties', 'id'),
      ('game_checkins', 'id'),
      ('sub_invitations', 'id')
  ) AS required(relation_name, column_name)
  JOIN information_schema.columns AS c
    ON c.table_schema = 'public'
   AND c.table_name = required.relation_name
   AND c.column_name = required.column_name
  WHERE COALESCE(c.column_default, '') !~ '(gen_random_uuid|uuid_generate_v[47])\(\)';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; generated identifier defaults are missing: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.relation_name || '.id', ', ' ORDER BY required.relation_name)
  INTO v_missing
  FROM (
    VALUES ('leagues'), ('teams'), ('seasons'), ('games'), ('profiles'),
           ('team_rosters'), ('game_checkins'), ('duty_types'), ('game_duties'),
           ('sub_invitations')
  ) AS required(relation_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS tbl ON tbl.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    JOIN pg_catalog.pg_attribute AS att
      ON att.attrelid = tbl.oid AND att.attname = 'id'
    WHERE ns.nspname = 'public'
      AND tbl.relname = required.relation_name
      AND con.contype = 'p'
      AND con.convalidated
      AND con.conkey = ARRAY[att.attnum]::smallint[]
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; required primary keys are missing: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    required.source_table || '.' || required.source_column || '->' || required.target_table || '.id',
    ', ' ORDER BY required.source_table, required.source_column
  )
  INTO v_missing
  FROM (
    VALUES
      ('teams', 'league_id', 'leagues', 'c'::"char"),
      ('seasons', 'league_id', 'leagues', 'c'::"char"),
      ('games', 'league_id', 'leagues', 'c'::"char"), ('games', 'season_id', 'seasons', 'c'::"char"),
      ('games', 'home_team_id', 'teams', 'c'::"char"), ('games', 'away_team_id', 'teams', 'c'::"char"),
      ('team_rosters', 'player_id', 'profiles', 'c'::"char"), ('team_rosters', 'team_id', 'teams', 'c'::"char"),
      ('team_rosters', 'league_id', 'leagues', 'c'::"char"), ('team_rosters', 'season_id', 'seasons', 'c'::"char"),
      ('game_checkins', 'game_id', 'games', 'c'::"char"), ('game_checkins', 'team_id', 'teams', 'c'::"char"),
      ('game_checkins', 'player_id', 'profiles', 'c'::"char"),
      ('duty_types', 'team_id', 'teams', 'c'::"char"),
      ('game_duties', 'game_id', 'games', 'c'::"char"), ('game_duties', 'team_id', 'teams', 'c'::"char"),
      ('game_duties', 'duty_type_id', 'duty_types', 'a'::"char"), ('game_duties', 'assigned_player_id', 'profiles', 'n'::"char")
  ) AS required(source_table, source_column, target_table, delete_action)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS source_table ON source_table.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS source_ns ON source_ns.oid = source_table.relnamespace
    JOIN pg_catalog.pg_class AS target_table ON target_table.oid = con.confrelid
    JOIN pg_catalog.pg_namespace AS target_ns ON target_ns.oid = target_table.relnamespace
    JOIN pg_catalog.pg_attribute AS source_att
      ON source_att.attrelid = source_table.oid AND source_att.attname = required.source_column
    JOIN pg_catalog.pg_attribute AS target_att
      ON target_att.attrelid = target_table.oid AND target_att.attname = 'id'
    WHERE con.contype = 'f'
      AND con.convalidated
      AND NOT con.condeferrable
      AND source_ns.nspname = 'public'
      AND source_table.relname = required.source_table
      AND target_ns.nspname = 'public'
      AND target_table.relname = required.target_table
      AND con.confdeltype = required.delete_action
      AND con.conkey = ARRAY[source_att.attnum]::smallint[]
      AND con.confkey = ARRAY[target_att.attnum]::smallint[]
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; missing or mismatched foreign keys: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS tbl ON tbl.oid = idx.indrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'game_duties'
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indimmediate
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnkeyatts = 3
      AND (
        SELECT pg_catalog.array_agg(att.attname ORDER BY att.attname)
        FROM pg_catalog.unnest(idx.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal_position)
        JOIN pg_catalog.pg_attribute AS att
          ON att.attrelid = idx.indrelid AND att.attnum = key.attnum
        WHERE key.ordinal_position <= idx.indnkeyatts
      ) = ARRAY['duty_type_id', 'game_id', 'team_id']::name[]
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; game_duties must uniquely constrain game_id, team_id, duty_type_id'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS tbl ON tbl.oid = idx.indrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'game_checkins'
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indimmediate
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnkeyatts = 2
      AND (
        SELECT pg_catalog.array_agg(att.attname ORDER BY att.attname)
        FROM pg_catalog.unnest(idx.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal_position)
        JOIN pg_catalog.pg_attribute AS att
          ON att.attrelid = idx.indrelid AND att.attnum = key.attnum
        WHERE key.ordinal_position <= idx.indnkeyatts
      ) = ARRAY['game_id', 'player_id']::name[]
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; game_checkins must uniquely constrain game_id, player_id'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS tbl ON tbl.oid = idx.indrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'sub_invitations'
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indimmediate
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnkeyatts = 2
      AND (
        SELECT pg_catalog.array_agg(att.attname ORDER BY att.attname)
        FROM pg_catalog.unnest(idx.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal_position)
        JOIN pg_catalog.pg_attribute AS att
          ON att.attrelid = idx.indrelid AND att.attnum = key.attnum
        WHERE key.ordinal_position <= idx.indnkeyatts
      ) = ARRAY['game_id', 'invited_player_id']::name[]
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; sub_invitations must uniquely constrain game_id, invited_player_id'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.source_column || '->' || required.target_table || '.' || required.target_column, ', ' ORDER BY required.source_column)
  INTO v_missing
  FROM (
    VALUES
      ('game_id', 'games', 'id', 'a'::"char"),
      ('team_id', 'teams', 'id', 'a'::"char"),
      ('invited_by', 'profiles', 'id', 'a'::"char"),
      ('invited_player_id', 'profiles', 'id', 'a'::"char"),
      ('replaced_player_id', 'profiles', 'id', 'n'::"char")
  ) AS required(source_column, target_table, target_column, delete_action)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS source_table ON source_table.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS source_ns ON source_ns.oid = source_table.relnamespace
    JOIN pg_catalog.pg_class AS target_table ON target_table.oid = con.confrelid
    JOIN pg_catalog.pg_namespace AS target_ns ON target_ns.oid = target_table.relnamespace
    WHERE con.contype = 'f'
      AND source_ns.nspname = 'public'
      AND source_table.relname = 'sub_invitations'
      AND target_ns.nspname = 'public'
      AND target_table.relname = required.target_table
      AND con.confdeltype = required.delete_action
      AND con.conkey = ARRAY[(
        SELECT att.attnum
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = source_table.oid AND att.attname = required.source_column
      )]::smallint[]
      AND con.confkey = ARRAY[(
        SELECT att.attnum
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = target_table.oid AND att.attname = required.target_column
      )]::smallint[]
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; missing or mismatched sub-invitation foreign keys/actions: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.sub_invitations'::pg_catalog.regclass
      AND con.contype = 'c'
      AND con.convalidated
      AND con.conkey = ARRAY[(
        SELECT att.attnum
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = con.conrelid AND att.attname = 'status'
      )]::smallint[]
      AND (
        SELECT pg_catalog.array_agg(capture.value[1] ORDER BY capture.value[1])
        FROM pg_catalog.regexp_matches(
          pg_catalog.pg_get_constraintdef(con.oid),
          '''([^'']+)''',
          'g'
        ) AS capture(value)
      ) = ARRAY['accepted', 'declined', 'expired', 'pending']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.sub_invitations'::pg_catalog.regclass
      AND con.contype = 'c'
      AND con.convalidated
      AND con.conkey = ARRAY[(
        SELECT att.attnum
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = con.conrelid AND att.attname = 'source_type'
      )]::smallint[]
      AND (
        SELECT pg_catalog.array_agg(capture.value[1] ORDER BY capture.value[1])
        FROM pg_catalog.regexp_matches(
          pg_catalog.pg_get_constraintdef(con.oid),
          '''([^'']+)''',
          'g'
        ) AS capture(value)
      ) = ARRAY['league', 'team']::text[]
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; sub-invitation status/source constraints differ'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = 'public.game_checkins'::pg_catalog.regclass
      AND con.contype = 'c'
      AND con.convalidated
      AND con.conkey = ARRAY[(
        SELECT att.attnum
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = con.conrelid AND att.attname = 'status'
      )]::smallint[]
      AND (
        SELECT pg_catalog.array_agg(capture.value[1] ORDER BY capture.value[1])
        FROM pg_catalog.regexp_matches(
          pg_catalog.pg_get_constraintdef(con.oid),
          '''([^'']+)''',
          'g'
        ) AS capture(value)
      ) = ARRAY['confirmed', 'out', 'tentative']::text[]
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; game-checkin status constraint differs'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.type_name || '.' || required.enum_value, ', ' ORDER BY required.type_name, required.enum_value)
  INTO v_missing
  FROM (
    VALUES
      ('game_status', 'scheduled'), ('game_status', 'in_progress'),
      ('game_status', 'pending_verification'), ('game_status', 'completed'),
      ('game_status', 'cancelled'), ('game_status', 'postponed'),
      ('season_status', 'active'), ('season_status', 'playoffs'),
      ('roster_status', 'active'),
      ('leadership_role', 'captain'), ('leadership_role', 'alternate_captain'),
      ('player_position', 'Goalie')
  ) AS required(type_name, enum_value)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS typ
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = typ.typnamespace
    JOIN pg_catalog.pg_enum AS enm ON enm.enumtypid = typ.oid
    WHERE ns.nspname = 'public'
      AND typ.typname = required.type_name
      AND enm.enumlabel = required.enum_value
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; missing relied-on enum values: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(tbl.relname, ', ' ORDER BY tbl.relname)
  INTO v_missing
  FROM pg_catalog.pg_class AS tbl
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = 'public'
    AND tbl.relname IN (
      'duty_types', 'game_duties', 'game_checkins', 'games', 'leagues',
      'profiles', 'seasons', 'sub_invitations', 'team_rosters', 'teams'
    )
    AND (tbl.relowner <> (SELECT usesysid FROM pg_catalog.pg_user WHERE usename = current_user)
         OR (tbl.relname IN ('duty_types', 'game_duties', 'game_checkins', 'sub_invitations')
             AND NOT tbl.relrowsecurity));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; table owner/RLS assumptions differ: %', v_missing
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.duty_types', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.game_duties', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.game_checkins', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.sub_invitations', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; authenticated table ACL assumptions differ'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.duty_types', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.game_duties', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.game_checkins', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.sub_invitations', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; service-role table ACL assumptions differ'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(required.signature, ', ' ORDER BY required.signature)
  INTO v_existing
  FROM (
    VALUES
      ('public._beer_guy_current_season_id(uuid)'),
      ('public._beer_guy_lock_future_game(uuid,uuid)'),
      ('public._beer_guy_lock_attendance_game(uuid,uuid)'),
      ('public._beer_guy_is_eligible(uuid,uuid,public.games)'),
      ('public._beer_guy_has_confirmed_checkin(uuid,uuid,uuid)'),
      ('public._beer_guy_is_canonical_duty(uuid)'),
      ('public._beer_guy_clear_for_checkin()'),
      ('public._beer_guy_assert_captain(uuid,uuid,public.games)'),
      ('public._beer_guy_assignment_json(uuid,uuid)'),
      ('public.update_my_game_checkin(uuid,uuid,text,text)'),
      ('public.beer_guy_claim(uuid,uuid)'),
      ('public.beer_guy_captain_manage(uuid,uuid,uuid,uuid,bigint)'),
      ('public._beer_guy_create_team_duty()'),
      ('public._beer_guy_sync_game_lifecycle()'),
      ('public._beer_guy_normalize_assignment()'),
      ('public._beer_guy_reopen_for_accepted_sub()'),
      ('public._beer_guy_guard_sub_invitation_update()'),
      ('public._beer_guy_preserve_assignment_delete()'),
      ('public._beer_guy_reopen_for_profile()'),
      ('public._beer_guy_reopen_for_roster()'),
      ('public.beer_guy_get_game_state(uuid,uuid)'),
      ('public.beer_guy_get_tracker(uuid)'),
      ('public.beer_guy_get_public_next_assignment(uuid)')
  ) AS required(signature)
  WHERE pg_catalog.to_regprocedure(required.signature) IS NOT NULL;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; reserved feature functions already exist: %', v_existing
      USING ERRCODE = '55000';
  END IF;

  v_captain_proc := pg_catalog.to_regprocedure('public.captain_manage_game_checkin(uuid,uuid,uuid,text,text)');
  IF v_captain_proc IS NULL THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; captain_manage_game_checkin(uuid,uuid,uuid,text,text) is missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT p.proargnames, p.prorettype::pg_catalog.regtype, owner.rolname, p.prosecdef
  INTO v_captain_arg_names, v_captain_return, v_captain_owner, v_captain_security_definer
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = p.proowner
  WHERE p.oid = v_captain_proc;
  IF v_captain_arg_names IS DISTINCT FROM ARRAY['p_game_id','p_team_id','p_player_id','p_operation','p_status']::text[]
     OR v_captain_return::text <> 'jsonb'
     OR v_captain_owner IS DISTINCT FROM current_user
     OR v_captain_security_definer IS NOT TRUE
     OR NOT pg_catalog.has_function_privilege('authenticated', v_captain_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Beer Guy baseline is incompatible; captain check-in RPC names/return/owner/security/ACL differ'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT dt.team_id
    FROM public.duty_types AS dt
    WHERE pg_catalog.lower(pg_catalog.btrim(dt.name)) IN ('beer guy', 'beer_guy')
    GROUP BY dt.team_id
    HAVING pg_catalog.count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM public.duty_types AS dt
    WHERE pg_catalog.lower(dt.name) LIKE '%beer%'
      AND pg_catalog.lower(pg_catalog.btrim(dt.name)) NOT IN ('beer guy', 'beer_guy')
  ) THEN
    RAISE EXCEPTION 'Beer Guy baseline is ambiguous; review pre-existing Beer-like duty types before retrying'
      USING ERRCODE = '55000';
  END IF;
END;
$beer_guy_preflight$;

-- Add only absent direct memberships. pg_get_publication_tables also recognizes
-- FOR ALL TABLES and schema-level membership, so compatible existing coverage is
-- retained without duplicate-object failures.
DO $beer_guy_realtime_membership$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_get_publication_tables('supabase_realtime')
      AS publication_table
    WHERE publication_table.relid = 'public.game_duties'::pg_catalog.regclass
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_duties';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_get_publication_tables('supabase_realtime')
      AS publication_table
    WHERE publication_table.relid = 'public.game_checkins'::pg_catalog.regclass
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_checkins';
  END IF;
END;
$beer_guy_realtime_membership$;

-- Close the migration-time provisioning window before the backfill. This lock
-- conflicts with team INSERT/UPDATE/DELETE and is held through trigger creation;
-- a writer already in flight commits before the backfill snapshot, while later
-- writers wait and then execute with the trigger installed.
LOCK TABLE public.teams IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.duty_types
  ADD COLUMN system_key text;

ALTER TABLE public.game_duties
  ADD COLUMN assignment_version bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT game_duties_assignment_version_positive CHECK (assignment_version > 0);

UPDATE public.duty_types AS dt
SET system_key = 'beer_guy',
    name = 'Beer Guy',
    description = 'Brings beer for the team game',
    icon = 'beer',
    is_active = TRUE,
    sort_order = 0
WHERE pg_catalog.lower(pg_catalog.btrim(dt.name)) IN ('beer guy', 'beer_guy');

CREATE UNIQUE INDEX duty_types_team_system_key_key
  ON public.duty_types(team_id, system_key)
  WHERE system_key IS NOT NULL;

INSERT INTO public.duty_types(team_id, name, description, icon, is_active, sort_order, system_key)
SELECT t.id, 'Beer Guy', 'Brings beer for the team game', 'beer', TRUE, 0, 'beer_guy'
FROM public.teams AS t
WHERE NOT EXISTS (
  SELECT 1 FROM public.duty_types AS existing
  WHERE existing.team_id = t.id AND existing.system_key = 'beer_guy'
);

CREATE OR REPLACE FUNCTION public._beer_guy_current_season_id(p_league_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.id
  FROM public.seasons AS s
  WHERE s.league_id = p_league_id
    AND s.status::text IN ('active', 'playoffs')
  ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
           s.start_date DESC,
           s.created_at DESC NULLS LAST,
           s.id
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_lock_future_game(p_game_id uuid, p_team_id uuid)
RETURNS public.games
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_game public.games%ROWTYPE;
  v_current_season_id uuid;
BEGIN
  SELECT g.* INTO v_game
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_team_id IS NULL
     OR p_team_id NOT IN (v_game.home_team_id, v_game.away_team_id)
     OR NOT EXISTS (
       SELECT 1
       FROM public.teams AS t
       WHERE t.id = p_team_id
         AND t.league_id = v_game.league_id
     ) THEN
    RAISE EXCEPTION 'Team does not participate in this game league' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_current_season_id
  FROM public.seasons AS s
  WHERE s.id = public._beer_guy_current_season_id(v_game.league_id)
  FOR SHARE;
  IF v_current_season_id IS NULL OR v_game.season_id IS DISTINCT FROM v_current_season_id THEN
    RAISE EXCEPTION 'Game is outside the current operational season' USING ERRCODE = '22023';
  END IF;
  IF v_game.status::text <> 'scheduled' OR v_game.scheduled_at <= pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'Beer Guy is available only for future scheduled games' USING ERRCODE = '22023';
  END IF;
  RETURN v_game;
END;
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_lock_attendance_game(p_game_id uuid, p_team_id uuid)
RETURNS public.games
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_game public.games%ROWTYPE;
  v_current_season_id uuid;
BEGIN
  SELECT g.* INTO v_game
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_team_id IS NULL
     OR p_team_id NOT IN (v_game.home_team_id, v_game.away_team_id)
     OR NOT EXISTS (
       SELECT 1
       FROM public.teams AS t
       WHERE t.id = p_team_id
         AND t.league_id = v_game.league_id
     ) THEN
    RAISE EXCEPTION 'Team does not participate in this game league' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_current_season_id
  FROM public.seasons AS s
  WHERE s.id = public._beer_guy_current_season_id(v_game.league_id)
  FOR SHARE;
  IF v_current_season_id IS NULL OR v_game.season_id IS DISTINCT FROM v_current_season_id THEN
    RAISE EXCEPTION 'Game is outside the current operational season' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (v_game.status::text = 'scheduled'
      AND v_game.scheduled_at > pg_catalog.statement_timestamp())
    OR v_game.status::text IN ('in_progress', 'pending_verification')
  ) THEN
    RAISE EXCEPTION 'Attendance can be managed only for a future scheduled or active game'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_game;
END;
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_is_eligible(
  p_player_id uuid,
  p_team_id uuid,
  p_game public.games
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.count(*) = 1
  FROM public.team_rosters AS tr
  JOIN public.teams AS t
    ON t.id = tr.team_id
   AND t.league_id = p_game.league_id
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE p_player_id IS NOT NULL
    AND p_team_id IN (p_game.home_team_id, p_game.away_team_id)
    AND p_game.season_id = public._beer_guy_current_season_id(p_game.league_id)
    AND tr.player_id = p_player_id
    AND tr.team_id = p_team_id
    AND tr.league_id = p_game.league_id
    AND tr.season_id = p_game.season_id
    AND tr.player_type = 'regular'
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (p_game.scheduled_at AT TIME ZONE l.timezone)::date
    AND NOT EXISTS (
      SELECT 1
      FROM public.sub_invitations AS si
      WHERE si.game_id = p_game.id
        AND si.team_id = p_team_id
        AND si.invited_player_id = p_player_id
        AND si.status = 'accepted'
    )
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_has_confirmed_checkin(
  p_player_id uuid,
  p_team_id uuid,
  p_game_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.game_checkins AS gc
    WHERE gc.game_id = p_game_id
      AND gc.team_id = p_team_id
      AND gc.player_id = p_player_id
      AND gc.status = 'confirmed'
  )
$function$;

-- Reconcile production-shaped legacy rows only after canonical duty adoption and
-- eligibility helpers exist. Future assignments fail closed; completed assignment
-- history is preserved and marked historical.
UPDATE public.game_duties AS gd
SET status = 'completed',
    updated_at = pg_catalog.statement_timestamp()
FROM public.duty_types AS dt, public.games AS g
WHERE gd.duty_type_id = dt.id
  AND dt.system_key = 'beer_guy'
  AND g.id = gd.game_id
  AND g.status::text = 'completed'
  AND gd.assigned_player_id IS NOT NULL
  AND gd.status IS DISTINCT FROM 'completed';

UPDATE public.game_duties AS gd
SET assigned_player_id = NULL,
    status = 'pending',
    assignment_version = gd.assignment_version + 1,
    updated_at = pg_catalog.statement_timestamp()
FROM public.duty_types AS dt, public.games AS g
WHERE gd.duty_type_id = dt.id
  AND dt.system_key = 'beer_guy'
  AND g.id = gd.game_id
  AND g.status::text <> 'completed'
  AND gd.assigned_player_id IS NOT NULL
  AND (
    NOT public._beer_guy_is_eligible(gd.assigned_player_id, gd.team_id, g)
    OR NOT public._beer_guy_has_confirmed_checkin(gd.assigned_player_id, gd.team_id, gd.game_id)
  );

CREATE OR REPLACE FUNCTION public._beer_guy_assignment_json(p_game_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN gd.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
    'id', gd.id,
    'version', gd.assignment_version,
    'player_id', gd.assigned_player_id,
    'status', gd.status,
    'player_name', p.full_name,
    'player_avatar_url', p.avatar_url
  ) END
  FROM public.duty_types AS dt
  JOIN public.teams AS t ON t.id = dt.team_id
  LEFT JOIN public.game_duties AS gd
    ON gd.duty_type_id = dt.id AND gd.game_id = p_game_id AND gd.team_id = p_team_id
  LEFT JOIN public.games AS g ON g.id = p_game_id
  LEFT JOIN public.profiles AS p ON p.id = gd.assigned_player_id
  WHERE dt.team_id = p_team_id
    AND dt.system_key = 'beer_guy'
    AND t.league_id = g.league_id
    AND p_team_id IN (g.home_team_id, g.away_team_id)
    AND (
      gd.id IS NULL
      OR gd.assigned_player_id IS NULL
      OR (
        public._beer_guy_is_eligible(gd.assigned_player_id, p_team_id, g)
        AND public._beer_guy_has_confirmed_checkin(gd.assigned_player_id, p_team_id, p_game_id)
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_clear_for_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.games AS g, public.teams AS t
    WHERE gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND gd.game_id = OLD.game_id
      AND gd.team_id = OLD.team_id
      AND gd.assigned_player_id = OLD.player_id
      AND g.id = gd.game_id
      AND t.id = gd.team_id
      AND t.league_id = g.league_id
      AND gd.team_id IN (g.home_team_id, g.away_team_id)
      AND g.status::text <> 'completed';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.games AS g, public.teams AS t
    WHERE gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND gd.game_id = NEW.game_id
      AND gd.team_id = NEW.team_id
      AND gd.assigned_player_id = NEW.player_id
      AND g.id = gd.game_id
      AND t.id = gd.team_id
      AND t.league_id = g.league_id
      AND gd.team_id IN (g.home_team_id, g.away_team_id)
      AND g.status::text <> 'completed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS game_checkins_clear_beer_guy ON public.game_checkins;
CREATE TRIGGER game_checkins_clear_beer_guy
AFTER INSERT OR DELETE OR UPDATE OF game_id, team_id, player_id, status ON public.game_checkins
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_clear_for_checkin();

CREATE OR REPLACE FUNCTION public.update_my_game_checkin(
  p_game_id uuid,
  p_team_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_game public.games%ROWTYPE;
  v_checkin_id uuid;
  v_affected integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('confirmed', 'tentative', 'out') THEN
    RAISE EXCEPTION 'Invalid check-in status' USING ERRCODE = '22023';
  END IF;
  v_game := public._beer_guy_lock_future_game(p_game_id, p_team_id);

  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE tr.player_id = v_actor_id
    AND tr.team_id = p_team_id
    AND tr.league_id = v_game.league_id
    AND tr.season_id = v_game.season_id
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (v_game.scheduled_at AT TIME ZONE l.timezone)::date
  FOR SHARE OF tr, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active current-season team membership required' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL THEN
    DELETE FROM public.game_checkins AS gc
    WHERE gc.game_id = p_game_id AND gc.team_id = p_team_id AND gc.player_id = v_actor_id
    RETURNING gc.id INTO v_checkin_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', CASE WHEN v_affected = 1 THEN 'reset' ELSE 'already_waiting' END,
      'operation', 'reset', 'status', NULL, 'affected_rows', v_affected,
      'checkin_id', v_checkin_id
    );
  END IF;

  INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
  VALUES (p_game_id, p_team_id, v_actor_id, p_status, p_note, pg_catalog.statement_timestamp())
  ON CONFLICT (game_id, player_id) DO UPDATE
    SET team_id = EXCLUDED.team_id,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_checkin_id;
  RETURN pg_catalog.jsonb_build_object(
    'game_id', p_game_id, 'team_id', p_team_id,
    'outcome', 'set', 'operation', 'set', 'status', p_status,
    'affected_rows', 1, 'checkin_id', v_checkin_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.beer_guy_claim(p_game_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_game public.games%ROWTYPE;
  v_duty_type_id uuid;
  v_assignment public.game_duties%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  v_game := public._beer_guy_lock_future_game(p_game_id, p_team_id);

  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE tr.player_id = v_actor_id
    AND tr.team_id = p_team_id
    AND tr.league_id = v_game.league_id
    AND tr.season_id = v_game.season_id
    AND tr.player_type = 'regular'
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (v_game.scheduled_at AT TIME ZONE l.timezone)::date
  FOR SHARE OF tr, p;
  IF NOT FOUND OR NOT public._beer_guy_is_eligible(v_actor_id, p_team_id, v_game) THEN
    RAISE EXCEPTION 'Only active current-season regular roster players may claim Beer Guy'
      USING ERRCODE = '42501';
  END IF;

  SELECT dt.id INTO v_duty_type_id
  FROM public.duty_types AS dt
  WHERE dt.team_id = p_team_id AND dt.system_key = 'beer_guy' AND dt.is_active IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical Beer Guy duty is unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT gd.* INTO v_assignment
  FROM public.game_duties AS gd
  WHERE gd.game_id = p_game_id AND gd.team_id = p_team_id AND gd.duty_type_id = v_duty_type_id
  FOR UPDATE;

  IF v_assignment.assigned_player_id = v_actor_id THEN
    IF NOT public._beer_guy_has_confirmed_checkin(v_actor_id, p_team_id, p_game_id) THEN
      INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
      VALUES (p_game_id, p_team_id, v_actor_id, 'confirmed', NULL, pg_catalog.statement_timestamp())
      ON CONFLICT (game_id, player_id) DO UPDATE
        SET team_id = EXCLUDED.team_id,
            status = 'confirmed',
            updated_at = EXCLUDED.updated_at;

      -- The check-in trigger reopens the row first. Restore the explicit Beer Guy
      -- choice only after confirmed attendance is durable in this transaction.
      UPDATE public.game_duties AS gd
      SET assigned_player_id = v_actor_id,
          status = 'pending',
          assignment_version = gd.assignment_version + 1,
          updated_at = pg_catalog.statement_timestamp()
      WHERE gd.id = v_assignment.id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', 'assigned_to_self',
      'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
    );
  END IF;

  IF v_assignment.assigned_player_id IS NOT NULL
     AND (
       NOT public._beer_guy_is_eligible(v_assignment.assigned_player_id, p_team_id, v_game)
       OR NOT public._beer_guy_has_confirmed_checkin(
         v_assignment.assigned_player_id,
         p_team_id,
         p_game_id
       )
     ) THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    WHERE gd.id = v_assignment.id
    RETURNING gd.* INTO v_assignment;
  END IF;

  IF v_assignment.assigned_player_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', 'taken',
      'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
    );
  END IF;

  INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
  VALUES (p_game_id, p_team_id, v_actor_id, 'confirmed', NULL, pg_catalog.statement_timestamp())
  ON CONFLICT (game_id, player_id) DO UPDATE
    SET team_id = EXCLUDED.team_id,
        status = 'confirmed',
        updated_at = EXCLUDED.updated_at;

  IF v_assignment.id IS NULL THEN
    INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version, updated_at)
    VALUES (p_game_id, p_team_id, v_duty_type_id, v_actor_id, 'pending', 1, pg_catalog.statement_timestamp());
  ELSE
    UPDATE public.game_duties AS gd
    SET assigned_player_id = v_actor_id,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    WHERE gd.id = v_assignment.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'game_id', p_game_id, 'team_id', p_team_id,
    'outcome', 'claimed',
    'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_assert_captain(
  p_actor_id uuid,
  p_team_id uuid,
  p_game public.games
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.teams AS t
    ON t.id = tr.team_id
   AND t.league_id = p_game.league_id
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE tr.player_id = p_actor_id
    AND tr.team_id = p_team_id
    AND tr.league_id = p_game.league_id
    AND tr.season_id = p_game.season_id
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (p_game.scheduled_at AT TIME ZONE l.timezone)::date
    AND tr.leadership_role::text IN ('captain', 'alternate_captain')
  FOR SHARE OF tr, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current-season captain or alternate captain authority required'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.beer_guy_captain_manage(
  p_game_id uuid,
  p_team_id uuid,
  p_player_id uuid,
  p_expected_assignment_id uuid,
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_game public.games%ROWTYPE;
  v_duty_type_id uuid;
  v_assignment public.game_duties%ROWTYPE;
  v_previous_player_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  v_game := public._beer_guy_lock_future_game(p_game_id, p_team_id);
  PERFORM public._beer_guy_assert_captain(v_actor_id, p_team_id, v_game);

  SELECT dt.id INTO v_duty_type_id
  FROM public.duty_types AS dt
  WHERE dt.team_id = p_team_id AND dt.system_key = 'beer_guy' AND dt.is_active IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical Beer Guy duty is unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT gd.* INTO v_assignment
  FROM public.game_duties AS gd
  WHERE gd.game_id = p_game_id AND gd.team_id = p_team_id AND gd.duty_type_id = v_duty_type_id
  FOR UPDATE;

  IF v_assignment.id IS DISTINCT FROM p_expected_assignment_id
     OR (v_assignment.id IS NOT NULL AND v_assignment.assignment_version IS DISTINCT FROM p_expected_version) THEN
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', 'conflict',
      'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
    );
  END IF;

  IF p_player_id IS NULL THEN
    IF v_assignment.id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'game_id', p_game_id, 'team_id', p_team_id,
        'outcome', 'already_clear', 'assignment', NULL
      );
    END IF;
    IF v_assignment.assigned_player_id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'game_id', p_game_id, 'team_id', p_team_id,
        'outcome', 'already_clear',
        'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
      );
    END IF;
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    WHERE gd.id = v_assignment.id;
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', 'cleared',
      'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
    );
  END IF;

  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE tr.player_id = p_player_id
    AND tr.team_id = p_team_id
    AND tr.league_id = v_game.league_id
    AND tr.season_id = v_game.season_id
    AND tr.player_type = 'regular'
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (v_game.scheduled_at AT TIME ZONE l.timezone)::date
  FOR SHARE OF tr, p;
  IF NOT FOUND OR NOT public._beer_guy_is_eligible(p_player_id, p_team_id, v_game) THEN
    RAISE EXCEPTION 'Only active current-season regular roster players may be assigned Beer Guy'
      USING ERRCODE = '42501';
  END IF;

  IF v_assignment.assigned_player_id = p_player_id THEN
    IF NOT public._beer_guy_has_confirmed_checkin(p_player_id, p_team_id, p_game_id) THEN
      INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
      VALUES (p_game_id, p_team_id, p_player_id, 'confirmed', NULL, pg_catalog.statement_timestamp())
      ON CONFLICT (game_id, player_id) DO UPDATE
        SET team_id = EXCLUDED.team_id,
            status = 'confirmed',
            updated_at = EXCLUDED.updated_at;

      UPDATE public.game_duties AS gd
      SET assigned_player_id = p_player_id,
          status = 'pending',
          assignment_version = gd.assignment_version + 1,
          updated_at = pg_catalog.statement_timestamp()
      WHERE gd.id = v_assignment.id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'game_id', p_game_id, 'team_id', p_team_id,
      'outcome', 'unchanged',
      'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
    );
  END IF;
  v_previous_player_id := v_assignment.assigned_player_id;

  INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
  VALUES (p_game_id, p_team_id, p_player_id, 'confirmed', NULL, pg_catalog.statement_timestamp())
  ON CONFLICT (game_id, player_id) DO UPDATE
    SET team_id = EXCLUDED.team_id,
        status = 'confirmed',
        updated_at = EXCLUDED.updated_at;

  IF v_assignment.id IS NULL THEN
    INSERT INTO public.game_duties(game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version, updated_at)
    VALUES (p_game_id, p_team_id, v_duty_type_id, p_player_id, 'pending', 1, pg_catalog.statement_timestamp());
  ELSE
    UPDATE public.game_duties AS gd
    SET assigned_player_id = p_player_id,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    WHERE gd.id = v_assignment.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'game_id', p_game_id, 'team_id', p_team_id,
    'outcome', CASE WHEN v_previous_player_id IS NULL THEN 'assigned' ELSE 'reassigned' END,
    'assignment', public._beer_guy_assignment_json(p_game_id, p_team_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.captain_manage_game_checkin(
  p_game_id uuid,
  p_team_id uuid,
  p_player_id uuid,
  p_operation text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_game public.games%ROWTYPE;
  v_checkin_id uuid;
  v_affected integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_operation NOT IN ('set', 'reset')
     OR (p_operation = 'set' AND p_status NOT IN ('confirmed', 'tentative', 'out'))
     OR (p_operation = 'reset' AND p_status IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid captain check-in operation' USING ERRCODE = '22023';
  END IF;

  v_game := public._beer_guy_lock_attendance_game(p_game_id, p_team_id);
  PERFORM public._beer_guy_assert_captain(v_actor_id, p_team_id, v_game);

  -- Lock the target identity before accepting either a roster member or an exact
  -- accepted game substitute. This serializes account deletion with attendance.
  PERFORM p.id
  FROM public.profiles AS p
  WHERE p.id = p_player_id AND p.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.leagues AS l ON l.id = tr.league_id
  WHERE tr.player_id = p_player_id
    AND tr.team_id = p_team_id
    AND tr.league_id = v_game.league_id
    AND tr.season_id = v_game.season_id
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (v_game.scheduled_at AT TIME ZONE l.timezone)::date
  FOR SHARE OF tr;
  IF NOT FOUND THEN
    PERFORM si.id
    FROM public.sub_invitations AS si
    WHERE si.game_id = p_game_id
      AND si.team_id = p_team_id
      AND si.invited_player_id = p_player_id
      AND si.status = 'accepted'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target must be an active current-season team member or accepted game substitute'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_operation = 'reset' THEN
    DELETE FROM public.game_checkins AS gc
    WHERE gc.game_id = p_game_id AND gc.team_id = p_team_id AND gc.player_id = p_player_id
    RETURNING gc.id INTO v_checkin_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', CASE WHEN v_affected = 1 THEN 'reset' ELSE 'already_waiting' END,
      'operation', 'reset', 'status', NULL, 'affected_rows', v_affected,
      'checkin_id', v_checkin_id
    );
  END IF;

  INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note, updated_at)
  VALUES (p_game_id, p_team_id, p_player_id, p_status, NULL, pg_catalog.statement_timestamp())
  ON CONFLICT (game_id, player_id) DO UPDATE
    SET team_id = EXCLUDED.team_id,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_checkin_id;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'set', 'operation', 'set', 'status', p_status,
    'affected_rows', 1, 'checkin_id', v_checkin_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_create_team_duty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.duty_types(team_id, name, description, icon, is_active, sort_order, system_key)
  VALUES (NEW.id, 'Beer Guy', 'Brings beer for the team game', 'beer', TRUE, 0, 'beer_guy')
  ON CONFLICT (team_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS teams_create_beer_guy_duty ON public.teams;
CREATE TRIGGER teams_create_beer_guy_duty
AFTER INSERT ON public.teams
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_create_team_duty();

CREATE OR REPLACE FUNCTION public._beer_guy_sync_game_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status::text = 'completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.game_duties AS gd
    SET status = 'completed',
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.teams AS t
    WHERE gd.game_id = NEW.id
      AND gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND t.id = gd.team_id
      AND t.league_id = NEW.league_id
      AND gd.team_id IN (NEW.home_team_id, NEW.away_team_id)
      AND gd.assigned_player_id IS NOT NULL;
  ELSIF NEW.status::text = 'scheduled'
        AND NEW.scheduled_at > pg_catalog.statement_timestamp()
        AND (NEW.status IS DISTINCT FROM OLD.status
             OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
             OR NEW.season_id IS DISTINCT FROM OLD.season_id
             OR NEW.home_team_id IS DISTINCT FROM OLD.home_team_id
             OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id) THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = CASE
          WHEN gd.assigned_player_id IS NOT NULL
           AND public._beer_guy_is_eligible(gd.assigned_player_id, gd.team_id, NEW)
           AND public._beer_guy_has_confirmed_checkin(
             gd.assigned_player_id,
             gd.team_id,
             NEW.id
           )
            THEN gd.assigned_player_id
          ELSE NULL
        END,
        status = 'pending',
        assignment_version = CASE
          WHEN gd.assigned_player_id IS NOT NULL
           AND (
             NOT public._beer_guy_is_eligible(gd.assigned_player_id, gd.team_id, NEW)
             OR NOT public._beer_guy_has_confirmed_checkin(
               gd.assigned_player_id,
               gd.team_id,
               NEW.id
             )
           )
            THEN gd.assignment_version + 1
          ELSE gd.assignment_version
        END,
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.teams AS t
    WHERE gd.game_id = NEW.id
      AND gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND t.id = gd.team_id
      AND t.league_id = NEW.league_id
      AND gd.team_id IN (NEW.home_team_id, NEW.away_team_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS games_sync_beer_guy_lifecycle ON public.games;
CREATE TRIGGER games_sync_beer_guy_lifecycle
AFTER UPDATE OF status, scheduled_at, season_id, home_team_id, away_team_id ON public.games
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_sync_game_lifecycle();

CREATE OR REPLACE FUNCTION public._beer_guy_normalize_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_duty_team_id uuid;
  v_duty_team_league_id uuid;
  v_system_key text;
  v_game public.games%ROWTYPE;
BEGIN
  SELECT dt.team_id, t.league_id, dt.system_key
  INTO v_duty_team_id, v_duty_team_league_id, v_system_key
  FROM public.duty_types AS dt
  JOIN public.teams AS t ON t.id = dt.team_id
  WHERE dt.id = NEW.duty_type_id;
  IF NOT FOUND OR v_system_key IS DISTINCT FROM 'beer_guy' THEN RETURN NEW; END IF;

  SELECT g.* INTO v_game FROM public.games AS g WHERE g.id = NEW.game_id;
  IF NOT FOUND
     OR NEW.team_id IS DISTINCT FROM v_duty_team_id
     OR v_duty_team_league_id IS DISTINCT FROM v_game.league_id
     OR NEW.team_id NOT IN (v_game.home_team_id, v_game.away_team_id) THEN
    RAISE EXCEPTION 'Beer Guy duty scope does not match its team and game'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.assigned_player_id IS DISTINCT FROM OLD.assigned_player_id THEN
    NEW.assignment_version := GREATEST(NEW.assignment_version, OLD.assignment_version + 1);
  ELSE
    NEW.assignment_version := GREATEST(COALESCE(NEW.assignment_version, 1), 1);
  END IF;

  IF v_game.status::text = 'completed' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.assigned_player_id IS NOT NULL
       AND (
         NEW.assigned_player_id IS NULL
         OR NEW.game_id IS DISTINCT FROM OLD.game_id
         OR NEW.team_id IS DISTINCT FROM OLD.team_id
         OR NEW.duty_type_id IS DISTINCT FROM OLD.duty_type_id
         OR NEW.status IS DISTINCT FROM 'completed'
       ) THEN
      RAISE EXCEPTION 'Completed Beer Guy history cannot be erased or moved directly'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_player_id IS NOT NULL THEN NEW.status := 'completed'; END IF;
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  IF NEW.assigned_player_id IS NOT NULL
     AND (
       NOT public._beer_guy_is_eligible(NEW.assigned_player_id, NEW.team_id, v_game)
       OR NOT public._beer_guy_has_confirmed_checkin(
         NEW.assigned_player_id,
         NEW.team_id,
         NEW.game_id
       )
     ) THEN
    IF (TG_OP = 'UPDATE' AND OLD.assigned_player_id IS NOT NULL)
       OR v_game.status::text IN ('cancelled', 'postponed') THEN
      -- Legacy identity/profile rewrites and direct cancelled/postponed audit
      -- adoption reopen instead of manufacturing a live invalid assignment.
      NEW.assigned_player_id := NULL;
    ELSE
      RAISE EXCEPTION 'Non-completed Beer Guy assignment requires an eligible player with confirmed attendance'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS game_duties_normalize_beer_guy ON public.game_duties;
CREATE TRIGGER game_duties_normalize_beer_guy
BEFORE INSERT OR UPDATE OF game_id, team_id, duty_type_id, assigned_player_id, status, assignment_version
ON public.game_duties
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_normalize_assignment();

CREATE OR REPLACE FUNCTION public._beer_guy_reopen_for_accepted_sub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'accepted' THEN
    -- The game row is the serialization point shared with Beer claims and
    -- captain assignment. The loser rechecks or reopens after the winner commits.
    PERFORM g.id
    FROM public.games AS g
    WHERE g.id = NEW.game_id
    FOR UPDATE;

    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.games AS g, public.teams AS t
    WHERE gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND gd.game_id = NEW.game_id
      AND gd.team_id = NEW.team_id
      AND gd.assigned_player_id = NEW.invited_player_id
      AND g.id = gd.game_id
      AND t.id = gd.team_id
      AND t.league_id = g.league_id
      AND gd.team_id IN (g.home_team_id, g.away_team_id)
      AND g.status::text <> 'completed';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sub_invitations_reopen_beer_guy ON public.sub_invitations;
CREATE TRIGGER sub_invitations_reopen_beer_guy
AFTER INSERT OR UPDATE OF status, game_id, team_id, invited_player_id
ON public.sub_invitations
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_reopen_for_accepted_sub();

CREATE OR REPLACE FUNCTION public._beer_guy_guard_sub_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_is_current_captain boolean := FALSE;
BEGIN
  -- Owner/service maintenance keeps its existing lifecycle and merge behavior.
  -- Authenticated callers are also constrained by column ACLs below, so this
  -- trigger only has to validate the status transition itself.
  IF v_actor_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.games AS g
    JOIN public.teams AS t
      ON t.id = OLD.team_id
     AND t.league_id = g.league_id
    JOIN public.leagues AS l ON l.id = g.league_id
    JOIN public.team_rosters AS tr
      ON tr.player_id = v_actor_id
     AND tr.team_id = OLD.team_id
     AND tr.league_id = g.league_id
     AND tr.season_id = g.season_id
     AND tr.status::text = 'active'
     AND tr.end_date IS NULL
     AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
     AND tr.leadership_role::text IN ('captain', 'alternate_captain')
    WHERE g.id = OLD.game_id
      AND OLD.team_id IN (g.home_team_id, g.away_team_id)
      AND g.season_id = public._beer_guy_current_season_id(g.league_id)
  ) INTO v_actor_is_current_captain;

  IF v_actor_is_current_captain THEN
    RETURN NEW;
  END IF;

  IF OLD.invited_player_id IS DISTINCT FROM v_actor_id
     OR OLD.status IS DISTINCT FROM 'pending'
     OR NEW.status NOT IN ('accepted', 'declined')
     OR NEW.responded_at IS NULL THEN
    RAISE EXCEPTION 'Invitees may only accept or decline their own pending invitation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sub_invitations_guard_beer_guy_update ON public.sub_invitations;
CREATE TRIGGER sub_invitations_guard_beer_guy_update
BEFORE UPDATE OF status ON public.sub_invitations
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_guard_sub_invitation_update();

CREATE OR REPLACE FUNCTION public._beer_guy_preserve_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_game_status text;
BEGIN
  IF NOT public._beer_guy_is_canonical_duty(OLD.duty_type_id) THEN
    RETURN OLD;
  END IF;

  SELECT g.status::text INTO v_game_status
  FROM public.games AS g
  WHERE g.id = OLD.game_id;
  IF NOT FOUND THEN
    -- Permit a parent-game cascade to remove its dependent duty row.
    RETURN OLD;
  END IF;

  IF v_game_status <> 'completed' AND OLD.assigned_player_id IS NOT NULL THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    WHERE gd.id = OLD.id;
  END IF;
  -- Canonical assignment identity survives legacy direct/account-deletion cleanup.
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS game_duties_preserve_beer_guy_delete ON public.game_duties;
CREATE TRIGGER game_duties_preserve_beer_guy_delete
BEFORE DELETE ON public.game_duties
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_preserve_assignment_delete();

CREATE OR REPLACE FUNCTION public._beer_guy_reopen_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    UPDATE public.game_duties AS gd
    SET assigned_player_id = NULL,
        status = 'pending',
        assignment_version = gd.assignment_version + 1,
        updated_at = pg_catalog.statement_timestamp()
    FROM public.duty_types AS dt, public.games AS g, public.teams AS t
    WHERE gd.duty_type_id = dt.id
      AND dt.system_key = 'beer_guy'
      AND gd.assigned_player_id = NEW.id
      AND g.id = gd.game_id
      AND t.id = gd.team_id
      AND t.league_id = g.league_id
      AND gd.team_id IN (g.home_team_id, g.away_team_id)
      AND g.status::text <> 'completed';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_reopen_beer_guy ON public.profiles;
CREATE TRIGGER profiles_reopen_beer_guy
AFTER UPDATE OF deleted_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_reopen_for_profile();

CREATE OR REPLACE FUNCTION public._beer_guy_reopen_for_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_player_id uuid := OLD.player_id;
BEGIN
  UPDATE public.game_duties AS gd
  SET assigned_player_id = NULL,
      status = 'pending',
      assignment_version = gd.assignment_version + 1,
      updated_at = pg_catalog.statement_timestamp()
  FROM public.duty_types AS dt, public.games AS g, public.teams AS t
  WHERE gd.duty_type_id = dt.id
    AND dt.system_key = 'beer_guy'
    AND gd.assigned_player_id = v_player_id
    AND g.id = gd.game_id
    AND t.id = gd.team_id
    AND t.league_id = g.league_id
    AND gd.team_id IN (g.home_team_id, g.away_team_id)
    AND g.status::text <> 'completed'
    AND NOT public._beer_guy_is_eligible(v_player_id, gd.team_id, g);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS team_rosters_reopen_beer_guy ON public.team_rosters;
CREATE TRIGGER team_rosters_reopen_beer_guy
AFTER UPDATE OF player_id, team_id, league_id, season_id, player_type, status, start_date, end_date
OR DELETE ON public.team_rosters
FOR EACH ROW EXECUTE FUNCTION public._beer_guy_reopen_for_roster();

CREATE OR REPLACE FUNCTION public.beer_guy_get_game_state(p_game_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_game public.games%ROWTYPE;
  v_assignment jsonb;
  v_player_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  v_game := public._beer_guy_lock_future_game(p_game_id, p_team_id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.team_rosters AS tr
    JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
    JOIN public.leagues AS l ON l.id = tr.league_id
    WHERE tr.player_id = v_actor_id
      AND tr.team_id = p_team_id
      AND tr.league_id = v_game.league_id
      AND tr.season_id = v_game.season_id
      AND tr.status::text = 'active'
      AND tr.end_date IS NULL
      AND tr.start_date <= (v_game.scheduled_at AT TIME ZONE l.timezone)::date
  ) THEN
    RAISE EXCEPTION 'Current team membership required' USING ERRCODE = '42501';
  END IF;

  v_assignment := public._beer_guy_assignment_json(p_game_id, p_team_id);
  v_player_id := NULLIF(v_assignment ->> 'player_id', '')::uuid;
  IF v_player_id IS NOT NULL AND NOT public._beer_guy_is_eligible(v_player_id, p_team_id, v_game) THEN
    v_assignment := NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'game_id', p_game_id,
    'team_id', p_team_id,
    'caller_eligible', public._beer_guy_is_eligible(v_actor_id, p_team_id, v_game),
    'assignment', v_assignment
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.beer_guy_get_tracker(p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_league_id uuid;
  v_season_id uuid;
  v_timezone text;
  v_roster jsonb;
  v_upcoming jsonb;
  v_history jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT t.league_id, l.timezone INTO v_league_id, v_timezone
  FROM public.teams AS t
  JOIN public.leagues AS l ON l.id = t.league_id
  WHERE t.id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found' USING ERRCODE = 'P0002'; END IF;
  v_season_id := public._beer_guy_current_season_id(v_league_id);
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Current operational season not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM tr.id
  FROM public.team_rosters AS tr
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  WHERE tr.player_id = v_actor_id
    AND tr.team_id = p_team_id
    AND tr.league_id = v_league_id
    AND tr.season_id = v_season_id
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (pg_catalog.statement_timestamp() AT TIME ZONE v_timezone)::date
    AND tr.leadership_role::text IN ('captain', 'alternate_captain')
  FOR SHARE OF tr, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current-season captain or alternate captain authority required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'player_id', tr.player_id,
      'full_name', p.full_name,
      'avatar_url', p.avatar_url,
      'jersey_number', tr.jersey_number,
      'position', tr.position,
      'is_goalie', COALESCE(tr.is_goalie, tr.position::text = 'Goalie', FALSE)
    ) ORDER BY tr.jersey_number NULLS LAST, p.full_name, tr.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.team_rosters AS tr
  JOIN public.profiles AS p ON p.id = tr.player_id AND p.deleted_at IS NULL
  WHERE tr.team_id = p_team_id
    AND tr.league_id = v_league_id
    AND tr.season_id = v_season_id
    AND tr.player_type = 'regular'
    AND tr.status::text = 'active'
    AND tr.end_date IS NULL
    AND tr.start_date <= (pg_catalog.statement_timestamp() AT TIME ZONE v_timezone)::date;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'game_id', g.id,
      'scheduled_at', g.scheduled_at,
      'assignment', public._beer_guy_assignment_json(g.id, p_team_id)
    ) ORDER BY g.scheduled_at, g.id), '[]'::jsonb)
  INTO v_upcoming
  FROM public.games AS g
  WHERE g.league_id = v_league_id
    AND g.season_id = v_season_id
    AND g.status::text = 'scheduled'
    AND g.scheduled_at > pg_catalog.statement_timestamp()
    AND p_team_id IN (g.home_team_id, g.away_team_id);

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'assignment_id', gd.id,
      'game_id', g.id,
      'player_id', gd.assigned_player_id,
      'player_name', CASE WHEN p.deleted_at IS NOT NULL THEN 'Former player' ELSE COALESCE(p.full_name, 'Former player') END,
      'player_deleted', p.deleted_at IS NOT NULL,
      'game_date', pg_catalog.to_char(g.scheduled_at AT TIME ZONE v_timezone, 'YYYY-MM-DD')
    ) ORDER BY g.scheduled_at, gd.id), '[]'::jsonb)
  INTO v_history
  FROM public.game_duties AS gd
  JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id AND dt.system_key = 'beer_guy'
  JOIN public.games AS g ON g.id = gd.game_id AND g.status::text = 'completed'
  LEFT JOIN public.profiles AS p ON p.id = gd.assigned_player_id
  WHERE gd.team_id = p_team_id
    AND g.league_id = v_league_id
    AND g.season_id = v_season_id
    AND gd.status = 'completed'
    AND gd.assigned_player_id IS NOT NULL;

  RETURN pg_catalog.jsonb_build_object(
    'team_id', p_team_id,
    'season_id', v_season_id,
    'timezone', v_timezone,
    'roster', v_roster,
    'upcoming_games', v_upcoming,
    'history', v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.beer_guy_get_public_next_assignment(p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_league_id uuid;
  v_season_id uuid;
  v_game public.games%ROWTYPE;
  v_player_id uuid;
BEGIN
  SELECT t.league_id INTO v_league_id FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_season_id := public._beer_guy_current_season_id(v_league_id);
  IF v_season_id IS NULL THEN RETURN NULL; END IF;

  SELECT g.* INTO v_game
  FROM public.games AS g
  WHERE g.league_id = v_league_id
    AND g.season_id = v_season_id
    AND g.status::text = 'scheduled'
    AND g.scheduled_at > pg_catalog.statement_timestamp()
    AND p_team_id IN (g.home_team_id, g.away_team_id)
  ORDER BY g.scheduled_at, g.id
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT gd.assigned_player_id INTO v_player_id
  FROM public.game_duties AS gd
  JOIN public.duty_types AS dt ON dt.id = gd.duty_type_id AND dt.system_key = 'beer_guy'
  WHERE gd.game_id = v_game.id AND gd.team_id = p_team_id;
  IF v_player_id IS NULL
     OR NOT public._beer_guy_is_eligible(v_player_id, p_team_id, v_game)
     OR NOT public._beer_guy_has_confirmed_checkin(v_player_id, p_team_id, v_game.id) THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'game_id', v_game.id,
    'team_id', p_team_id,
    'player_id', v_player_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._beer_guy_is_canonical_duty(p_duty_type_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT dt.system_key = 'beer_guy'
    FROM public.duty_types AS dt
    WHERE dt.id = p_duty_type_id
  ), FALSE)
$function$;

ALTER TABLE public.duty_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_duties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beer_guy_sub_invitation_insert_guard ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_insert_guard
  ON public.sub_invitations AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND invited_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = sub_invitations.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      JOIN public.team_rosters AS tr
        ON tr.player_id = auth.uid()
       AND tr.team_id = sub_invitations.team_id
       AND tr.league_id = g.league_id
       AND tr.season_id = g.season_id
       AND tr.status::text = 'active'
       AND tr.end_date IS NULL
       AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
       AND tr.leadership_role::text IN ('captain', 'alternate_captain')
      WHERE g.id = sub_invitations.game_id
        AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
    )
  );

DROP POLICY IF EXISTS beer_guy_sub_invitation_update_guard ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_update_guard
  ON public.sub_invitations AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = sub_invitations.team_id
       AND t.league_id = g.league_id
      WHERE g.id = sub_invitations.game_id
        AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
    )
    AND (
      invited_player_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.games AS g
        JOIN public.teams AS t
          ON t.id = sub_invitations.team_id
         AND t.league_id = g.league_id
        JOIN public.leagues AS l ON l.id = g.league_id
        JOIN public.team_rosters AS tr
          ON tr.player_id = auth.uid()
         AND tr.team_id = sub_invitations.team_id
         AND tr.league_id = g.league_id
         AND tr.season_id = g.season_id
         AND tr.status::text = 'active'
         AND tr.end_date IS NULL
         AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
         AND tr.leadership_role::text IN ('captain', 'alternate_captain')
        WHERE g.id = sub_invitations.game_id
          AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
          AND g.season_id = (
            SELECT s.id
            FROM public.seasons AS s
            WHERE s.league_id = g.league_id
              AND s.status::text IN ('active', 'playoffs')
            ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                     s.start_date DESC,
                     s.created_at DESC NULLS LAST,
                     s.id
            LIMIT 1
          )
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = sub_invitations.team_id
       AND t.league_id = g.league_id
      WHERE g.id = sub_invitations.game_id
        AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
    )
    AND (
      invited_player_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.games AS g
        JOIN public.teams AS t
          ON t.id = sub_invitations.team_id
         AND t.league_id = g.league_id
        JOIN public.leagues AS l ON l.id = g.league_id
        JOIN public.team_rosters AS tr
          ON tr.player_id = auth.uid()
         AND tr.team_id = sub_invitations.team_id
         AND tr.league_id = g.league_id
         AND tr.season_id = g.season_id
         AND tr.status::text = 'active'
         AND tr.end_date IS NULL
         AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
         AND tr.leadership_role::text IN ('captain', 'alternate_captain')
        WHERE g.id = sub_invitations.game_id
          AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
          AND g.season_id = (
            SELECT s.id
            FROM public.seasons AS s
            WHERE s.league_id = g.league_id
              AND s.status::text IN ('active', 'playoffs')
            ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                     s.start_date DESC,
                     s.created_at DESC NULLS LAST,
                     s.id
            LIMIT 1
          )
      )
    )
  );

DROP POLICY IF EXISTS beer_guy_sub_invitation_delete_guard ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_delete_guard
  ON public.sub_invitations AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = sub_invitations.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      JOIN public.team_rosters AS tr
        ON tr.player_id = auth.uid()
       AND tr.team_id = sub_invitations.team_id
       AND tr.league_id = g.league_id
       AND tr.season_id = g.season_id
       AND tr.status::text = 'active'
       AND tr.end_date IS NULL
       AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
       AND tr.leadership_role::text IN ('captain', 'alternate_captain')
      WHERE g.id = sub_invitations.game_id
        AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
    )
  );

-- The feature must not depend on an undeclared permissive baseline policy.
-- These command-specific authenticated rails make the exact restrictive guards
-- effective without granting anonymous mutations or collapsing the contract into
-- a broad FOR ALL policy.
DROP POLICY IF EXISTS beer_guy_sub_invitation_insert_authenticated ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_insert_authenticated
  ON public.sub_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS beer_guy_sub_invitation_update_authenticated ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_update_authenticated
  ON public.sub_invitations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS beer_guy_sub_invitation_delete_authenticated ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_delete_authenticated
  ON public.sub_invitations AS PERMISSIVE FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- PostgreSQL also applies SELECT visibility when locating rows for UPDATE/DELETE.
-- Keep that rail scoped to an exact invitee or an exact current game/team captain.
DROP POLICY IF EXISTS beer_guy_sub_invitation_select_authorized ON public.sub_invitations;
CREATE POLICY beer_guy_sub_invitation_select_authorized
  ON public.sub_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      invited_player_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.games AS g
        JOIN public.teams AS t
          ON t.id = sub_invitations.team_id
         AND t.league_id = g.league_id
        JOIN public.leagues AS l ON l.id = g.league_id
        JOIN public.team_rosters AS tr
          ON tr.player_id = auth.uid()
         AND tr.team_id = sub_invitations.team_id
         AND tr.league_id = g.league_id
         AND tr.season_id = g.season_id
         AND tr.status::text = 'active'
         AND tr.end_date IS NULL
         AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
         AND tr.leadership_role::text IN ('captain', 'alternate_captain')
        WHERE g.id = sub_invitations.game_id
          AND sub_invitations.team_id IN (g.home_team_id, g.away_team_id)
          AND g.season_id = (
            SELECT s.id
            FROM public.seasons AS s
            WHERE s.league_id = g.league_id
              AND s.status::text IN ('active', 'playoffs')
            ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                     s.start_date DESC,
                     s.created_at DESC NULLS LAST,
                     s.id
            LIMIT 1
          )
      )
    )
  );

-- Direct clients only need the response columns. Identity/scope/content rewrites
-- remain available to owner/service maintenance functions without giving an
-- invitee a way to move or rewrite a pending invitation.
REVOKE UPDATE ON public.sub_invitations FROM authenticated;
GRANT UPDATE(status, responded_at, updated_at) ON public.sub_invitations TO authenticated;

DROP POLICY IF EXISTS beer_guy_checkin_select_guard ON public.game_checkins;
CREATE POLICY beer_guy_checkin_select_guard
  ON public.game_checkins AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR (
            game_checkins.player_id = auth.uid()
            AND EXISTS (
              SELECT 1
              FROM public.sub_invitations AS si
              WHERE si.game_id = game_checkins.game_id
                AND si.team_id = game_checkins.team_id
                AND si.invited_player_id = auth.uid()
                AND si.status = 'accepted'
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS beer_guy_checkin_insert_guard ON public.game_checkins;
CREATE POLICY beer_guy_checkin_insert_guard
  ON public.game_checkins AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND player_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR EXISTS (
            SELECT 1
            FROM public.sub_invitations AS si
            WHERE si.game_id = game_checkins.game_id
              AND si.team_id = game_checkins.team_id
              AND si.invited_player_id = auth.uid()
              AND si.status = 'accepted'
          )
        )
    )
  );
DROP POLICY IF EXISTS beer_guy_checkin_update_guard ON public.game_checkins;
CREATE POLICY beer_guy_checkin_update_guard
  ON public.game_checkins AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (
    auth.uid() IS NOT NULL
    AND player_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR EXISTS (
            SELECT 1
            FROM public.sub_invitations AS si
            WHERE si.game_id = game_checkins.game_id
              AND si.team_id = game_checkins.team_id
              AND si.invited_player_id = auth.uid()
              AND si.status = 'accepted'
          )
        )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND player_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR EXISTS (
            SELECT 1
            FROM public.sub_invitations AS si
            WHERE si.game_id = game_checkins.game_id
              AND si.team_id = game_checkins.team_id
              AND si.invited_player_id = auth.uid()
              AND si.status = 'accepted'
          )
        )
    )
  );
DROP POLICY IF EXISTS beer_guy_checkin_delete_guard ON public.game_checkins;
CREATE POLICY beer_guy_checkin_delete_guard
  ON public.game_checkins AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (
    auth.uid() IS NOT NULL
    AND player_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR EXISTS (
            SELECT 1
            FROM public.sub_invitations AS si
            WHERE si.game_id = game_checkins.game_id
              AND si.team_id = game_checkins.team_id
              AND si.invited_player_id = auth.uid()
              AND si.status = 'accepted'
          )
        )
    )
  );

-- As with sub-invitations, command-specific permissive rails make the exact
-- restrictive guards self-contained without restoring a broad FOR ALL bypass.
DROP POLICY IF EXISTS beer_guy_checkin_insert_authenticated ON public.game_checkins;
CREATE POLICY beer_guy_checkin_insert_authenticated
  ON public.game_checkins AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS beer_guy_checkin_update_authenticated ON public.game_checkins;
CREATE POLICY beer_guy_checkin_update_authenticated
  ON public.game_checkins AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS beer_guy_checkin_delete_authenticated ON public.game_checkins;
CREATE POLICY beer_guy_checkin_delete_authenticated
  ON public.game_checkins AS PERMISSIVE FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- UPDATE/DELETE and ON CONFLICT UPDATE require SELECT visibility. Keep that
-- permissive rail identical to the current exact team/self read contract.
DROP POLICY IF EXISTS beer_guy_checkin_select_authorized ON public.game_checkins;
CREATE POLICY beer_guy_checkin_select_authorized
  ON public.game_checkins AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_checkins.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      WHERE g.id = game_checkins.game_id
        AND game_checkins.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_rosters AS tr
            WHERE tr.player_id = auth.uid()
              AND tr.team_id = game_checkins.team_id
              AND tr.league_id = g.league_id
              AND tr.season_id = g.season_id
              AND tr.status::text = 'active'
              AND tr.end_date IS NULL
              AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
          )
          OR (
            game_checkins.player_id = auth.uid()
            AND EXISTS (
              SELECT 1
              FROM public.sub_invitations AS si
              WHERE si.game_id = game_checkins.game_id
                AND si.team_id = game_checkins.team_id
                AND si.invited_player_id = auth.uid()
                AND si.status = 'accepted'
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS beer_guy_duty_type_insert_guard ON public.duty_types;
CREATE POLICY beer_guy_duty_type_insert_guard
  ON public.duty_types AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    system_key IS NULL
    AND pg_catalog.lower(pg_catalog.btrim(name)) NOT IN ('beer guy', 'beer_guy')
  );
DROP POLICY IF EXISTS beer_guy_duty_type_update_guard ON public.duty_types;
CREATE POLICY beer_guy_duty_type_update_guard
  ON public.duty_types AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (system_key IS DISTINCT FROM 'beer_guy')
  WITH CHECK (
    system_key IS NULL
    AND pg_catalog.lower(pg_catalog.btrim(name)) NOT IN ('beer guy', 'beer_guy')
  );
DROP POLICY IF EXISTS beer_guy_duty_type_delete_guard ON public.duty_types;
CREATE POLICY beer_guy_duty_type_delete_guard
  ON public.duty_types AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (system_key IS DISTINCT FROM 'beer_guy');

DROP POLICY IF EXISTS beer_guy_game_duty_insert_guard ON public.game_duties;
CREATE POLICY beer_guy_game_duty_insert_guard
  ON public.game_duties AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (NOT public._beer_guy_is_canonical_duty(duty_type_id));
DROP POLICY IF EXISTS beer_guy_game_duty_update_guard ON public.game_duties;
CREATE POLICY beer_guy_game_duty_update_guard
  ON public.game_duties AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (NOT public._beer_guy_is_canonical_duty(duty_type_id))
  WITH CHECK (NOT public._beer_guy_is_canonical_duty(duty_type_id));
DROP POLICY IF EXISTS beer_guy_game_duty_delete_guard ON public.game_duties;
CREATE POLICY beer_guy_game_duty_delete_guard
  ON public.game_duties AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (NOT public._beer_guy_is_canonical_duty(duty_type_id));
DROP POLICY IF EXISTS beer_guy_game_duty_select_guard ON public.game_duties;
CREATE POLICY beer_guy_game_duty_select_guard
  ON public.game_duties AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    NOT public._beer_guy_is_canonical_duty(duty_type_id)
    OR EXISTS (
      SELECT 1
      FROM public.games AS g
      JOIN public.teams AS t
        ON t.id = game_duties.team_id
       AND t.league_id = g.league_id
      JOIN public.leagues AS l ON l.id = g.league_id
      JOIN public.team_rosters AS tr
        ON tr.team_id = game_duties.team_id
       AND tr.league_id = g.league_id
       AND tr.season_id = g.season_id
       AND tr.player_id = auth.uid()
       AND tr.status::text = 'active'
       AND tr.end_date IS NULL
       AND tr.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
      WHERE g.id = game_duties.game_id
        AND g.status::text = 'scheduled'
        AND g.scheduled_at > pg_catalog.statement_timestamp()
        AND game_duties.team_id IN (g.home_team_id, g.away_team_id)
        AND g.season_id = (
          SELECT s.id
          FROM public.seasons AS s
          WHERE s.league_id = g.league_id
            AND s.status::text IN ('active', 'playoffs')
          ORDER BY CASE s.status::text WHEN 'active' THEN 0 ELSE 1 END,
                   s.start_date DESC,
                   s.created_at DESC NULLS LAST,
                   s.id
          LIMIT 1
        )
        AND (
          game_duties.assigned_player_id IS NULL
          OR (
            EXISTS (
              SELECT 1
              FROM public.game_checkins AS gc
              WHERE gc.game_id = game_duties.game_id
                AND gc.team_id = game_duties.team_id
                AND gc.player_id = game_duties.assigned_player_id
                AND gc.status = 'confirmed'
            )
            AND (
              SELECT pg_catalog.count(*)
              FROM public.team_rosters AS assignee_roster
              JOIN public.profiles AS assignee_profile
                ON assignee_profile.id = assignee_roster.player_id
               AND assignee_profile.deleted_at IS NULL
              WHERE assignee_roster.player_id = game_duties.assigned_player_id
                AND assignee_roster.team_id = game_duties.team_id
                AND assignee_roster.league_id = g.league_id
                AND assignee_roster.season_id = g.season_id
                AND assignee_roster.player_type = 'regular'
                AND assignee_roster.status::text = 'active'
                AND assignee_roster.end_date IS NULL
                AND assignee_roster.start_date <= (g.scheduled_at AT TIME ZONE l.timezone)::date
            ) = 1
            AND NOT EXISTS (
              SELECT 1
              FROM public.sub_invitations AS si
              WHERE si.game_id = game_duties.game_id
                AND si.team_id = game_duties.team_id
                AND si.invited_player_id = game_duties.assigned_player_id
                AND si.status = 'accepted'
            )
          )
        )
    )
  );

REVOKE ALL ON FUNCTION public._beer_guy_current_season_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_lock_future_game(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_lock_attendance_game(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_is_eligible(uuid,uuid,public.games) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_has_confirmed_checkin(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_assignment_json(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_clear_for_checkin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_assert_captain(uuid,uuid,public.games) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_create_team_duty() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_sync_game_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_normalize_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_reopen_for_accepted_sub() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_guard_sub_invitation_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_preserve_assignment_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_reopen_for_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_reopen_for_roster() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._beer_guy_is_canonical_duty(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_game_checkin(uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beer_guy_claim(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beer_guy_captain_manage(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.captain_manage_game_checkin(uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beer_guy_get_game_state(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beer_guy_get_tracker(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beer_guy_get_public_next_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._beer_guy_is_canonical_duty(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_game_checkin(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beer_guy_claim(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beer_guy_captain_manage(uuid,uuid,uuid,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.captain_manage_game_checkin(uuid,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beer_guy_get_game_state(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beer_guy_get_tracker(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.beer_guy_get_public_next_assignment(uuid) TO PUBLIC, anon, authenticated;

COMMIT;
