\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE postgres SUPERUSER NOLOGIN;
CREATE SCHEMA auth;

CREATE TYPE public.user_role AS ENUM ('owner', 'captain', 'player');
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  deleted_at timestamptz
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  phone text,
  position text,
  jersey_number integer,
  role public.user_role NOT NULL DEFAULT 'player',
  is_platform_admin boolean NOT NULL DEFAULT false,
  is_legacy_import boolean DEFAULT false,
  identity_provenance text NOT NULL DEFAULT 'auth_account',
  deleted_at timestamptz,
  legacy_player_id uuid,
  legacy_merge_completed_at timestamptz,
  pending_legacy_match_ids uuid[] DEFAULT '{}',
  avatar_url text,
  photo_url text,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.team_rosters (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  season_id uuid NOT NULL,
  game_id uuid,
  end_date date,
  leadership_role text
);
CREATE TABLE public.player_stats (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id uuid,
  team_id uuid,
  game_id uuid,
  UNIQUE (game_id, player_id)
);
CREATE TABLE public.legacy_players (
  id uuid PRIMARY KEY,
  matched_to_profile_id uuid,
  matched_at timestamptz,
  updated_at timestamptz
);
CREATE TABLE public.teams (id uuid PRIMARY KEY, captain_id uuid);

CREATE TABLE public.game_stats (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.goalie_stats (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.game_events (id uuid PRIMARY KEY, player_id uuid, assist1_player_id uuid, assist2_player_id uuid);
CREATE TABLE public.game_checkins (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.game_duties (id uuid PRIMARY KEY, assigned_player_id uuid);
CREATE TABLE public.game_stat_entry_log (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.league_awards (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.suspensions (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_payments (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.payments (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_approvals (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_availability (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_badges (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_goalie_matchups (id uuid PRIMARY KEY, player_id uuid, goalie_id uuid);
CREATE TABLE public.player_ratings (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_waivers (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.registration_submissions (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.season_opt_ins (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.sub_invitations (id uuid PRIMARY KEY, invited_player_id uuid, replaced_player_id uuid);
CREATE TABLE public.team_join_requests (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.trade_players (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.draft_picks (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.draft_pool (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.article_player_tags (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.player_career_baselines (id uuid PRIMARY KEY, player_id uuid);
CREATE TABLE public.goalie_requests (id uuid PRIMARY KEY, requested_by uuid);
CREATE TABLE public.goalie_ratings (id uuid PRIMARY KEY, rated_by uuid);
CREATE TABLE public.draft_roster_confirmations (id uuid PRIMARY KEY, confirmed_by uuid);
CREATE TABLE public.league_spare_pool (
  id uuid PRIMARY KEY,
  league_id uuid NOT NULL,
  player_id uuid NOT NULL,
  UNIQUE (league_id, player_id)
);
CREATE TABLE public.captain_player_invites (
  id uuid PRIMARY KEY,
  league_id uuid NOT NULL,
  season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  roster_id uuid,
  target_player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_name text,
  share_phone text,
  position text,
  player_type text NOT NULL DEFAULT 'regular',
  share_with_league boolean NOT NULL DEFAULT false,
  brand_scope text NOT NULL DEFAULT 'team',
  registration_path text NOT NULL,
  invited_by uuid,
  consumed_by uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.captain_player_invites TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._claim_update_uuid_column_if_exists(
  p_table text, p_column text, p_target_profile_id uuid, p_claim_profile_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column
  ) THEN RETURN 0; END IF;
  EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', p_table, p_column, p_column)
  USING p_target_profile_id, p_claim_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- IDs: a=admin, b=target, c=second target, d=nonadmin, e=ordinary owner.
INSERT INTO auth.users(id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('44444444-4444-4444-4444-444444444444'),
  ('55555555-5555-5555-5555-555555555555'),
  ('66666666-6666-6666-6666-666666666666');
INSERT INTO public.profiles(id, role, is_platform_admin) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'player', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'player', false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'player', false),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner', false),
  ('44444444-4444-4444-4444-444444444444', 'player', false),
  ('55555555-5555-5555-5555-555555555555', 'player', false),
  ('66666666-6666-6666-6666-666666666666', 'player', false);

-- 1 valid historical non-rostered source; 2 wrong type; 3 deleted; 4 auth-backed;
-- 5 already claimed; 6 nonadmin test; 7 guest claim; 8 race source; 9 service positive.
INSERT INTO public.profiles(id, is_legacy_import, identity_provenance, deleted_at, legacy_merge_completed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', true,  'auth_account', null, null),
  ('22222222-2222-2222-2222-222222222222', false, 'auth_account', null, null),
  ('33333333-3333-3333-3333-333333333333', true,  'auth_account', now(), null),
  ('77777777-7777-7777-7777-777777777777', true,  'auth_account', null, null),
  ('88888888-8888-8888-8888-888888888888', true,  'auth_account', null, now()),
  ('99999999-9999-9999-9999-999999999999', true,  'auth_account', null, null),
  ('12121212-1212-1212-1212-121212121212', true,  'claimable_guest', null, null),
  ('13131313-1313-1313-1313-131313131313', true,  'auth_account', null, null),
  ('14141414-1414-1414-1414-141414141414', true,  'auth_account', null, null);
INSERT INTO auth.users(id) VALUES ('77777777-7777-7777-7777-777777777777');

INSERT INTO public.game_checkins(id, player_id) VALUES
  ('10101010-1010-1010-1010-101010101010', '11111111-1111-1111-1111-111111111111'),
  ('20202020-2020-2020-2020-202020202020', '13131313-1313-1313-1313-131313131313'),
  ('21212121-2121-2121-2121-212121212121', '14141414-1414-1414-1414-141414141414');
INSERT INTO public.player_stats(id, player_id, game_id, season_id, team_id) VALUES
  ('81818181-8181-8181-8181-818181818181', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '91919191-9191-9191-9191-919191919191', '92929292-9292-9292-9292-929292929292', '93939393-9393-9393-9393-939393939393'),
  ('82828282-8282-8282-8282-828282828282', '11111111-1111-1111-1111-111111111111', '94949494-9494-9494-9494-949494949494', '92929292-9292-9292-9292-929292929292', '93939393-9393-9393-9393-939393939393'),
  ('83838383-8383-8383-8383-838383838383', '11111111-1111-1111-1111-111111111111', '91919191-9191-9191-9191-919191919191', '92929292-9292-9292-9292-929292929292', '93939393-9393-9393-9393-939393939393');
INSERT INTO public.team_rosters(id, player_id, team_id, season_id) VALUES
  ('30303030-3030-3030-3030-303030303030', '12121212-1212-1212-1212-121212121212', 'abababab-abab-abab-abab-abababababab', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd');
INSERT INTO public.captain_player_invites(
  id, league_id, season_id, team_id, target_player_id, registration_path
) VALUES
  ('41414141-4141-4141-4141-414141414141', '51515151-5151-5151-5151-515151515151', '61616161-6161-6161-6161-616161616161', '71717171-7171-7171-7171-717171717171', '11111111-1111-1111-1111-111111111111', '/source'),
  ('42424242-4242-4242-4242-424242424242', '52525252-5252-5252-5252-525252525252', '62626262-6262-6262-6262-626262626262', '72727272-7272-7272-7272-727272727272', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '/unrelated');
