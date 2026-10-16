\set ON_ERROR_STOP on

-- Seed adversarial rows as the owner so the test exercises SELECT isolation only.
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('40000000-0000-4000-8000-000000000023', 'Wrong Team Member', 'wrong-team@example.invalid'),
  ('40000000-0000-4000-8000-000000000024', 'Forged League Member', 'forged-league@example.invalid'),
  ('40000000-0000-4000-8000-000000000025', 'Other League Member', 'other-league@example.invalid');

INSERT INTO public.team_rosters(
  player_id, team_id, league_id, season_id, player_type, status,
  start_date, end_date, leadership_role
) VALUES
  -- A real current member of the opponent must not read the other team's attendance.
  ('40000000-0000-4000-8000-000000000023',
   '30000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   'regular', 'active', CURRENT_DATE - 30, NULL, NULL),
  -- This row forges the league dimension while matching the target team/season.
  ('40000000-0000-4000-8000-000000000024',
   '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000001',
   'regular', 'active', CURRENT_DATE - 30, NULL, 'captain'),
  -- A valid other-league roster must not authorize a malformed non-participant row.
  ('40000000-0000-4000-8000-000000000025',
   '30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003',
   'regular', 'active', CURRENT_DATE - 30, NULL, NULL);

SET session_replication_role = replica;
INSERT INTO public.game_checkins(id, game_id, team_id, player_id, status, note) VALUES
  ('90000000-0000-4000-8000-000000000051',
   '50000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000003',
   '40000000-0000-4000-8000-000000000018',
   'confirmed', 'malformed non-participant sentinel'),
  ('90000000-0000-4000-8000-000000000052',
   '50000000-0000-4000-8000-000000000008',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000019',
   'confirmed', 'historical-season sentinel'),
  ('90000000-0000-4000-8000-000000000053',
   '50000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000022',
   'confirmed', 'accepted substitute self sentinel');
SET session_replication_role = origin;

INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
) VALUES (
  '80000000-0000-4000-8000-000000000053',
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000022',
  'accepted', 'team', pg_catalog.statement_timestamp()
);

SET ROLE authenticated;

-- Ordinary current active/open-ended exact-season members can retain team reads.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000012', false);
DO $ordinary_member$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000053'
  ) THEN
    RAISE EXCEPTION 'ordinary current roster member lost legitimate team check-in reads';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000052'
  ) THEN
    RAISE EXCEPTION 'current roster member read a historical-season check-in';
  END IF;
END;
$ordinary_member$;

-- Current exact captains and alternates retain the same team attendance reads.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
DO $captain_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000053'
  ) THEN
    RAISE EXCEPTION 'current captain lost legitimate team check-in reads';
  END IF;
END;
$captain_read$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', false);
DO $alternate_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000053'
  ) THEN
    RAISE EXCEPTION 'current alternate lost legitimate team check-in reads';
  END IF;
END;
$alternate_read$;

-- Exact accepted invitees may see their own game/team check-in, but not teammates.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000022', false);
DO $accepted_sub_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000053'
  ) THEN
    RAISE EXCEPTION 'exact accepted substitute lost self check-in read';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000002'
      AND team_id = '30000000-0000-4000-8000-000000000001'
      AND player_id <> '40000000-0000-4000-8000-000000000022'
  ) THEN
    RAISE EXCEPTION 'accepted substitute read another player check-in';
  END IF;
END;
$accepted_sub_read$;

-- An opponent roster is not authority for the target team's attendance.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000023', false);
DO $wrong_team_read$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000001'
      AND team_id = '30000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'opponent roster member read target-team check-ins';
  END IF;
END;
$wrong_team_read$;

-- Matching team/season values cannot compensate for a forged league dimension.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000024', false);
DO $forged_league_read$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000001'
      AND team_id = '30000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'forged cross-league roster read target-team check-ins';
  END IF;
END;
$forged_league_read$;

-- Even a valid roster cannot expose a check-in whose team did not play the game.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000025', false);
DO $nonparticipant_read$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000051'
  ) THEN
    RAISE EXCEPTION 'non-participating team roster exposed malformed check-in';
  END IF;
END;
$nonparticipant_read$;

-- A historical roster row does not grant current-season or historical attendance access.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000019', false);
DO $historical_roster_read$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE game_id = '50000000-0000-4000-8000-000000000001'
      AND team_id = '30000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'historical-season roster read current-season check-ins';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000052'
  ) THEN
    RAISE EXCEPTION 'historical roster member read own historical exact-season game/team/league check-in';
  END IF;
END;
$historical_roster_read$;

RESET ROLE;

-- Attendance is never public, while service-role operational reads still bypass RLS.
SET ROLE anon;
DO $public_read$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.game_checkins LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked AND EXISTS (SELECT 1 FROM public.game_checkins) THEN
    RAISE EXCEPTION 'anonymous role read attendance';
  END IF;
END;
$public_read$;
RESET ROLE;

SET ROLE service_role;
DO $service_read$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_checkins
    WHERE id = '90000000-0000-4000-8000-000000000051'
  ) THEN
    RAISE EXCEPTION 'service role lost operational RLS bypass';
  END IF;
END;
$service_read$;
RESET ROLE;

SELECT 'beer guy direct game-checkin SELECT isolation acceptance passed' AS result;
