-- Rerunnable disposable-Postgres acceptance fixture.
-- Run only after all repository migrations have been applied locally.
-- Every inserted row and assertion is enclosed by a rollback.

BEGIN;

DO $acceptance$
DECLARE
  v_bad_acl_count integer;
  v_cascade_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_bad_acl_count
  FROM information_schema.routine_privileges AS rp
  WHERE rp.specific_schema = 'public'
    AND rp.privilege_type = 'EXECUTE'
    AND rp.routine_name IN (
      'prepare_account_deletion',
      'mark_account_apple_revoked',
      'mark_account_storage_deleted',
      'record_account_deletion_external_step',
      'execute_account_deletion',
      'clear_current_push_destination'
    )
    AND rp.grantee NOT IN ('postgres', 'supabase_admin', 'service_role', 'authenticated');
  IF v_bad_acl_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected deletion-function EXECUTE grantee';
  END IF;

  IF pg_catalog.has_function_privilege('authenticated', 'public.execute_account_deletion(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute privileged deletion RPC';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.clear_current_push_destination()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute exact-one logout RPC';
  END IF;

  SELECT pg_catalog.count(*) INTO v_cascade_count
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS child ON child.oid = c.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = child.relnamespace
  JOIN pg_catalog.pg_class AS parent ON parent.oid = c.confrelid
  JOIN pg_catalog.pg_namespace AS pn ON pn.oid = parent.relnamespace
  WHERE c.contype = 'f'
    AND n.nspname = 'public' AND child.relname = 'profiles'
    AND pn.nspname = 'auth' AND parent.relname = 'users'
    AND c.confdeltype = 'c';
  IF v_cascade_count <> 0 THEN
    RAISE EXCEPTION 'profiles still cascades from auth.users';
  END IF;
END;
$acceptance$;

INSERT INTO public.profiles (id, email, full_name, deleted_at, jersey_number, position)
VALUES
  ('a11ce000-0000-4000-8000-000000000001', 'deleted_roster@deleted.local', 'Deleted User', now(), 1, 'Forward'),
  ('a11ce000-0000-4000-8000-000000000002', 'deleted_stats@deleted.local', 'Deleted User', now(), 2, 'Defense');

INSERT INTO public.leagues (id, name, slug)
VALUES ('a11ce000-0000-4000-8000-000000000010', 'Deletion Acceptance League', 'deletion-acceptance-league');

INSERT INTO public.seasons (id, league_id, name, start_date, status)
VALUES (
  'a11ce000-0000-4000-8000-000000000020',
  'a11ce000-0000-4000-8000-000000000010',
  'Completed Acceptance Season',
  '2025-01-01',
  'completed'
);

INSERT INTO public.teams (id, league_id, name, short_name)
VALUES
  ('a11ce000-0000-4000-8000-000000000030', 'a11ce000-0000-4000-8000-000000000010', 'Acceptance Home', 'HOME'),
  ('a11ce000-0000-4000-8000-000000000031', 'a11ce000-0000-4000-8000-000000000010', 'Acceptance Away', 'AWAY');

INSERT INTO public.games (
  id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status
)
VALUES (
  'a11ce000-0000-4000-8000-000000000040',
  'a11ce000-0000-4000-8000-000000000010',
  'a11ce000-0000-4000-8000-000000000020',
  'a11ce000-0000-4000-8000-000000000030',
  'a11ce000-0000-4000-8000-000000000031',
  '2025-02-01T20:00:00Z',
  'completed'
);

-- Roster-only completed-game appearance: no player_stats row exists.
INSERT INTO public.team_rosters (
  id, player_id, team_id, league_id, season_id, jersey_number, position,
  player_type, status, start_date, historical_retained
)
VALUES (
  'a11ce000-0000-4000-8000-000000000050',
  'a11ce000-0000-4000-8000-000000000001',
  'a11ce000-0000-4000-8000-000000000030',
  'a11ce000-0000-4000-8000-000000000010',
  'a11ce000-0000-4000-8000-000000000020',
  17,
  'Forward',
  'regular',
  'inactive',
  '2025-01-01',
  TRUE
);

-- Stat-backed completed-game appearance: both roster and player_stats facts exist.
INSERT INTO public.team_rosters (
  id, player_id, team_id, league_id, season_id, jersey_number, position,
  player_type, status, start_date, historical_retained
)
VALUES (
  'a11ce000-0000-4000-8000-000000000051',
  'a11ce000-0000-4000-8000-000000000002',
  'a11ce000-0000-4000-8000-000000000030',
  'a11ce000-0000-4000-8000-000000000010',
  'a11ce000-0000-4000-8000-000000000020',
  24,
  'Defense',
  'regular',
  'inactive',
  '2025-01-01',
  TRUE
);

INSERT INTO public.player_stats (
  id, player_id, game_id, team_id, league_id, season_id, goals, assists
)
VALUES (
  'a11ce000-0000-4000-8000-000000000060',
  'a11ce000-0000-4000-8000-000000000002',
  'a11ce000-0000-4000-8000-000000000040',
  'a11ce000-0000-4000-8000-000000000030',
  'a11ce000-0000-4000-8000-000000000010',
  'a11ce000-0000-4000-8000-000000000020',
  2,
  1
);

DO $acceptance$
DECLARE
  v_roster_only public.player_season_stats%ROWTYPE;
  v_stat_backed public.player_season_stats%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_roster_only
  FROM public.player_season_stats
  WHERE player_id = 'a11ce000-0000-4000-8000-000000000001';
  IF v_roster_only.games_played <> 1
     OR v_roster_only.goals <> 0
     OR v_roster_only.jersey_number <> 17
     OR v_roster_only.position <> 'Forward' THEN
    RAISE EXCEPTION 'Roster-only historical appearance was not preserved';
  END IF;

  SELECT * INTO STRICT v_stat_backed
  FROM public.player_season_stats
  WHERE player_id = 'a11ce000-0000-4000-8000-000000000002';
  IF v_stat_backed.games_played <> 1
     OR v_stat_backed.goals <> 2
     OR v_stat_backed.assists <> 1
     OR v_stat_backed.jersey_number <> 24
     OR v_stat_backed.position <> 'Defense' THEN
    RAISE EXCEPTION 'Stat-backed historical appearance was not preserved';
  END IF;
END;
$acceptance$;

ROLLBACK;
