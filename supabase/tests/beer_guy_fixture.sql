\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$roles$;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.game_status AS ENUM (
  'scheduled', 'in_progress', 'completed', 'pending_verification', 'cancelled', 'postponed'
);
CREATE TYPE public.season_status AS ENUM ('active', 'playoffs', 'completed', 'draft', 'archived');
CREATE TYPE public.roster_status AS ENUM ('active', 'inactive', 'suspended', 'injured', 'traded');
CREATE TYPE public.leadership_role AS ENUM ('captain', 'alternate_captain');
CREATE TYPE public.player_position AS ENUM ('Forward', 'Defense', 'Goalie');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  avatar_url text,
  email text NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE public.leagues (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Toronto'
);

CREATE TABLE public.teams (
  id uuid PRIMARY KEY,
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  name text NOT NULL,
  captain_id uuid REFERENCES public.profiles(id)
);

CREATE TABLE public.seasons (
  id uuid PRIMARY KEY,
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  status public.season_status,
  created_at timestamptz DEFAULT pg_catalog.now()
);

CREATE TABLE public.games (
  id uuid PRIMARY KEY,
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  season_id uuid NOT NULL REFERENCES public.seasons(id),
  home_team_id uuid NOT NULL REFERENCES public.teams(id),
  away_team_id uuid NOT NULL REFERENCES public.teams(id),
  scheduled_at timestamptz NOT NULL,
  status public.game_status DEFAULT 'scheduled',
  updated_at timestamptz DEFAULT pg_catalog.now()
);

CREATE TABLE public.team_rosters (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.profiles(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  season_id uuid NOT NULL REFERENCES public.seasons(id),
  player_type text NOT NULL DEFAULT 'regular',
  status public.roster_status NOT NULL DEFAULT 'active',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  leadership_role public.leadership_role,
  position public.player_position,
  is_goalie boolean DEFAULT false,
  jersey_number integer,
  historical_retained boolean NOT NULL DEFAULT false
);

CREATE TABLE public.game_checkins (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id),
  player_id uuid NOT NULL REFERENCES public.profiles(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  status text NOT NULL,
  note text,
  created_at timestamptz DEFAULT pg_catalog.now(),
  updated_at timestamptz DEFAULT pg_catalog.now(),
  CONSTRAINT game_checkins_game_player_key UNIQUE (game_id, player_id),
  CONSTRAINT game_checkins_status_check CHECK (status IN ('confirmed', 'tentative', 'out'))
);

CREATE TABLE public.duty_types (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  name text NOT NULL,
  description text,
  icon text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT pg_catalog.now()
);

CREATE TABLE public.game_duties (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  duty_type_id uuid NOT NULL REFERENCES public.duty_types(id),
  assigned_player_id uuid REFERENCES public.profiles(id),
  status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT pg_catalog.now(),
  updated_at timestamptz DEFAULT pg_catalog.now(),
  CONSTRAINT game_duties_game_type_team_key UNIQUE (game_id, duty_type_id, team_id)
);

-- Production-shaped substitution baseline from the checked-in migration chain.
-- Accepted invitations remain exact game/team/player facts even when that player
-- also has a regular roster row for the same team and season.
CREATE TABLE public.sub_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  invited_player_id uuid NOT NULL REFERENCES public.profiles(id),
  replaced_player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'league' CHECK (source_type IN ('team', 'league')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  message text,
  responded_at timestamptz,
  created_at timestamptz DEFAULT pg_catalog.now(),
  updated_at timestamptz DEFAULT pg_catalog.now(),
  CONSTRAINT sub_invitations_game_player_key UNIQUE (game_id, invited_player_id)
);

-- Supabase projects provide this publication. Start with neither subscribed
-- table so the candidate must add them, while focused acceptance also exercises
-- an already-published game_duties baseline.
CREATE PUBLICATION supabase_realtime;

ALTER TABLE public.game_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_duties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_checkins_all ON public.game_checkins FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fixture_duty_types_all ON public.duty_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fixture_game_duties_all ON public.game_duties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fixture_sub_invitations_all ON public.sub_invitations FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_checkins, public.duty_types, public.game_duties, public.sub_invitations TO authenticated;
GRANT SELECT ON public.profiles, public.leagues, public.teams, public.seasons, public.games, public.team_rosters TO authenticated;
GRANT SELECT ON public.profiles, public.leagues, public.teams, public.seasons, public.games, public.team_rosters TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Captures the compatible deployed RPC boundary that is missing from checked-in
-- migration provenance. Leave PostgreSQL's default PUBLIC EXECUTE in place so the
-- migration acceptance proves it closes provider defaults rather than inheriting
-- an unrealistically pre-hardened fixture.
CREATE FUNCTION public.captain_manage_game_checkin(
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
  v_checkin_id uuid;
  v_affected integer := 0;
BEGIN
  IF p_operation = 'reset' THEN
    DELETE FROM public.game_checkins
    WHERE game_id = p_game_id AND team_id = p_team_id AND player_id = p_player_id
    RETURNING id INTO v_checkin_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', CASE WHEN v_affected = 1 THEN 'reset' ELSE 'already_waiting' END,
      'operation', 'reset', 'status', NULL, 'affected_rows', v_affected,
      'checkin_id', v_checkin_id
    );
  END IF;

  INSERT INTO public.game_checkins(game_id, team_id, player_id, status)
  VALUES (p_game_id, p_team_id, p_player_id, p_status)
  ON CONFLICT (game_id, player_id) DO UPDATE
    SET team_id = EXCLUDED.team_id, status = EXCLUDED.status,
        updated_at = pg_catalog.statement_timestamp()
  RETURNING id INTO v_checkin_id;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'set', 'operation', 'set', 'status', p_status,
    'affected_rows', 1, 'checkin_id', v_checkin_id
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.captain_manage_game_checkin(uuid,uuid,uuid,text,text) TO authenticated;

INSERT INTO public.leagues(id, name, timezone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Fixture League', 'America/Toronto'),
  ('10000000-0000-4000-8000-000000000002', 'Other League', 'UTC');

INSERT INTO public.profiles(id, full_name, avatar_url, email) VALUES
  ('40000000-0000-4000-8000-000000000001', 'Captain', NULL, 'captain@example.invalid'),
  ('40000000-0000-4000-8000-000000000002', 'Alternate', NULL, 'alternate@example.invalid'),
  ('40000000-0000-4000-8000-000000000011', 'Regular One', 'regular-one.png', 'regular1@example.invalid'),
  ('40000000-0000-4000-8000-000000000012', 'Regular Two', NULL, 'regular2@example.invalid'),
  ('40000000-0000-4000-8000-000000000013', 'Regular Goalie', NULL, 'goalie@example.invalid'),
  ('40000000-0000-4000-8000-000000000014', 'Sub Player', NULL, 'sub@example.invalid'),
  ('40000000-0000-4000-8000-000000000015', 'Part Time Player', NULL, 'part-time@example.invalid'),
  ('40000000-0000-4000-8000-000000000016', 'Inactive Player', NULL, 'inactive@example.invalid'),
  ('40000000-0000-4000-8000-000000000017', 'Ended Player', NULL, 'ended@example.invalid'),
  ('40000000-0000-4000-8000-000000000018', 'Outsider', NULL, 'outsider@example.invalid'),
  ('40000000-0000-4000-8000-000000000019', 'Old Season Player', NULL, 'old@example.invalid'),
  ('40000000-0000-4000-8000-000000000020', 'Deleting Player', NULL, 'delete@example.invalid'),
  ('40000000-0000-4000-8000-000000000021', 'Merge Source', NULL, 'source@example.invalid'),
  ('40000000-0000-4000-8000-000000000022', 'Merge Target', NULL, 'target@example.invalid');

INSERT INTO public.teams(id, league_id, name, captain_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Home Team', '40000000-0000-4000-8000-000000000018'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Away Team', NULL),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Other Team', NULL);

INSERT INTO public.seasons(id, league_id, name, start_date, end_date, status, created_at) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Current Season', CURRENT_DATE - 30, CURRENT_DATE + 90, 'active', pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Stale Active Season', CURRENT_DATE - 400, CURRENT_DATE - 200, 'active', pg_catalog.now() - interval '1 year'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Other Current', CURRENT_DATE - 30, CURRENT_DATE + 90, 'playoffs', pg_catalog.now());

INSERT INTO public.games(id, league_id, season_id, home_team_id, away_team_id, scheduled_at, status) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '1 day', 'scheduled'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '2 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '3 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '3 days', 'completed'),
  ('50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '4 days', 'cancelled'),
  ('50000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '5 days', 'postponed'),
  ('50000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '1 day', 'scheduled'),
  ('50000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '6 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '7 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '8 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '9 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '9 days', 'completed'),
  ('50000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() + interval '10 days', 'scheduled'),
  ('50000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '15 minutes', 'in_progress'),
  ('50000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', pg_catalog.now() - interval '1 hour', 'pending_verification');

INSERT INTO public.team_rosters(player_id, team_id, league_id, season_id, player_type, status, start_date, end_date, leadership_role, position, is_goalie, jersey_number) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, 'captain', 'Forward', false, 1),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, 'alternate_captain', 'Defense', false, 2),
  ('40000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 11),
  ('40000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Defense', false, 12),
  ('40000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Goalie', true, 13),
  ('40000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'sub', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 14),
  ('40000000-0000-4000-8000-000000000015', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'part_time', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 15),
  ('40000000-0000-4000-8000-000000000016', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'inactive', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 16),
  ('40000000-0000-4000-8000-000000000017', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 60, CURRENT_DATE - 1, NULL, 'Forward', false, 17),
  ('40000000-0000-4000-8000-000000000018', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE + 60, NULL, 'captain', 'Forward', false, 18),
  ('40000000-0000-4000-8000-000000000019', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'regular', 'active', CURRENT_DATE - 400, NULL, NULL, 'Forward', false, 19),
  ('40000000-0000-4000-8000-000000000020', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, NULL, NULL, NULL, 20),
  ('40000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'regular', 'active', CURRENT_DATE - 30, NULL, NULL, 'Forward', false, 21);

INSERT INTO public.game_checkins(game_id, team_id, player_id, status, note)
VALUES
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000011', 'tentative', 'fixture note'),
  ('50000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000012', 'confirmed', 'legacy valid Beer assignment'),
  ('50000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000012', 'confirmed', 'accepted-sub dual-role fixture');

INSERT INTO public.duty_types(id, team_id, name, description, icon, sort_order) VALUES
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Snacks', 'Legacy duty', 'cookie', 1),
  ('60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Beer Guy', 'Keep this legacy description', NULL, 4),
  ('60000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'beer_guy', 'Legacy home Beer duty', NULL, 9);
INSERT INTO public.game_duties(id, game_id, team_id, duty_type_id, assigned_player_id, status, notes)
VALUES
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000012', 'pending', 'preserve me'),
  ('70000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012', 'pending', 'retain confirmed eligible legacy future assignment'),
  ('70000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012', 'pending', 'clear unconfirmed legacy future assignment'),
  ('70000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000020', 'pending', 'backfill completed legacy history'),
  ('70000000-0000-4000-8000-000000000014', '50000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012', 'pending', 'clear accepted substitute legacy future assignment');

INSERT INTO public.sub_invitations(
  id, game_id, team_id, invited_by, invited_player_id, status, source_type, responded_at
)
VALUES (
  '80000000-0000-4000-8000-000000000014',
  '50000000-0000-4000-8000-000000000014',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000012',
  'accepted',
  'league',
  pg_catalog.now()
);

CREATE TABLE public.beer_guy_concurrency_results (
  actor_id uuid PRIMARY KEY,
  result jsonb NOT NULL
);
GRANT ALL ON public.beer_guy_concurrency_results TO authenticated, service_role;
