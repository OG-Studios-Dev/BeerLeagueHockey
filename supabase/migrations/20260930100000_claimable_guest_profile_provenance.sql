BEGIN;

-- Authless player stubs are intentional claim sources, but legacy/email fields
-- are mutable business data and therefore cannot be the lasting exemption.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_provenance text NOT NULL DEFAULT 'auth_account';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_identity_provenance_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_identity_provenance_check
  CHECK (identity_provenance IN ('auth_account', 'claimable_guest'));

CREATE OR REPLACE FUNCTION public.classify_claimable_guest_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_role text := auth.role();
  v_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
  v_expected_manual_email text := 'manual-spare+' || NEW.id::text || '@beerleaguehockey.local';
  v_expected_captain_email text := 'captaininvite_' || NEW.id::text || '@captaininvite.hockeylifehl.com';
BEGIN
  -- SECURITY DEFINER changes current_user to the function owner. The verified
  -- auth.role() reads PostgREST's verified JWT claim and is the invocation
  -- provenance relevant to server writes.
  IF v_request_role = 'service_role'
     AND NEW.deleted_at IS NULL
     AND NEW.is_legacy_import IS TRUE
     AND NEW.role::text = 'player'
     AND NOT COALESCE(NEW.is_platform_admin, false)
     AND v_email IN (v_expected_manual_email, v_expected_captain_email)
     AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = NEW.id) THEN
    NEW.identity_provenance := 'claimable_guest';
  ELSE
    IF NEW.identity_provenance = 'claimable_guest' THEN
      RAISE EXCEPTION 'Claimable guest provenance may only be assigned by an approved server insert.'
        USING ERRCODE = '42501';
    END IF;
    NEW.identity_provenance := 'auth_account';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_identity_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Profile identity is immutable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.identity_provenance IS DISTINCT FROM OLD.identity_provenance THEN
    RAISE EXCEPTION 'Profile identity provenance is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Deleted profiles cannot be reactivated.' USING ERRCODE = '23514';
  END IF;

  IF OLD.identity_provenance = 'claimable_guest'
     AND (NEW.role::text IS DISTINCT FROM 'player' OR COALESCE(NEW.is_platform_admin, false)) THEN
    RAISE EXCEPTION 'Claimable guest profiles cannot receive account authority.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_classify_claimable_guest ON public.profiles;
CREATE TRIGGER profiles_classify_claimable_guest
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.classify_claimable_guest_profile();

DROP TRIGGER IF EXISTS profiles_protect_identity_provenance ON public.profiles;
CREATE TRIGGER profiles_protect_identity_provenance
BEFORE UPDATE OF id, identity_provenance, role, is_platform_admin, deleted_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_identity_provenance();

CREATE OR REPLACE FUNCTION public.require_auth_for_active_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL
     AND NEW.identity_provenance <> 'claimable_guest'
     AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = NEW.id) THEN
    RAISE EXCEPTION 'Active profile % requires a matching auth user.', NEW.id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_auth_for_claimable_guest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = NEW.id AND p.identity_provenance = 'claimable_guest'
  ) THEN
    RAISE EXCEPTION 'Claimable guest profiles must be claimed into a separate authenticated profile.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS auth_users_block_claimable_guest_attachment ON auth.users;
CREATE TRIGGER auth_users_block_claimable_guest_attachment
BEFORE INSERT OR UPDATE OF id ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.block_auth_for_claimable_guest();

CREATE OR REPLACE FUNCTION public.block_claimable_guest_roster_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.leadership_role IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles AS p
       WHERE p.id = NEW.player_id AND p.identity_provenance = 'claimable_guest'
     ) THEN
    RAISE EXCEPTION 'Claimable guest profiles cannot receive roster leadership.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS team_rosters_block_claimable_guest_authority ON public.team_rosters;
CREATE TRIGGER team_rosters_block_claimable_guest_authority
BEFORE INSERT OR UPDATE OF player_id, leadership_role ON public.team_rosters
FOR EACH ROW EXECUTE FUNCTION public.block_claimable_guest_roster_authority();

ALTER FUNCTION public.classify_claimable_guest_profile() OWNER TO postgres;
ALTER FUNCTION public.protect_profile_identity_provenance() OWNER TO postgres;
ALTER FUNCTION public.require_auth_for_active_profile() OWNER TO postgres;
ALTER FUNCTION public.block_auth_for_claimable_guest() OWNER TO postgres;
ALTER FUNCTION public.block_claimable_guest_roster_authority() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.classify_claimable_guest_profile() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_profile_identity_provenance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.require_auth_for_active_profile() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_auth_for_claimable_guest() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_claimable_guest_roster_authority() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.profiles.identity_provenance IS
  'Immutable DB-assigned origin. claimable_guest is limited to trusted UUID-bound player-stub inserts.';

COMMIT;
