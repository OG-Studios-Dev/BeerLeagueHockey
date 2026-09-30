\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;

CREATE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $function$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$function$;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.user_role AS ENUM ('owner', 'captain', 'player');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  jersey_number integer,
  phone text,
  position text,
  role public.user_role DEFAULT 'player',
  is_legacy_import boolean DEFAULT false,
  is_platform_admin boolean DEFAULT false,
  deleted_at timestamptz,
  legacy_player_id uuid,
  legacy_merge_completed_at timestamptz,
  pending_legacy_match_ids uuid[] DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.team_rosters (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  season_id uuid NOT NULL,
  end_date date,
  leadership_role text,
  jersey_number integer
);
CREATE TABLE public.game_checkins (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL
);
CREATE TABLE public.teams (id uuid PRIMARY KEY, captain_id uuid);
CREATE TABLE public.player_stats (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id uuid NOT NULL
);
CREATE TABLE public.legacy_players (
  id uuid PRIMARY KEY,
  matched_to_profile_id uuid,
  matched_at timestamptz,
  updated_at timestamptz
);

CREATE FUNCTION public._claim_update_uuid_column_if_exists(
  p_table text, p_column text, p_target_profile_id uuid, p_claim_profile_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF pg_catalog.to_regclass(pg_catalog.format('public.%I', p_table)) IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column
  ) THEN RETURN 0; END IF;
  EXECUTE pg_catalog.format('UPDATE public.%I SET %I = $1 WHERE %I = $2', p_table, p_column, p_column)
  USING p_target_profile_id, p_claim_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE FUNCTION public.require_auth_for_active_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = NEW.id) THEN
    RAISE EXCEPTION 'Active profile % requires a matching auth user.', NEW.id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE CONSTRAINT TRIGGER profiles_require_auth_while_active
AFTER INSERT OR UPDATE OF id, deleted_at ON public.profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_auth_for_active_profile();

CREATE FUNCTION public.preserve_auth_for_active_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = OLD.id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot remove auth user while profile is active.' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$function$;
CREATE TRIGGER auth_users_preserve_active_profiles
BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.preserve_auth_for_active_profile();
