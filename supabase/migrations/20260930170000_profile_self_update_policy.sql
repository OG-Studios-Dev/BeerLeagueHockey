-- Remove the profiles self-read from the authenticated self-update policy.
-- The SECURITY DEFINER helper is intentionally no-argument and read-only: it
-- can only read the current auth.uid() row's stored administration flag.

BEGIN;

DO $guard$
DECLARE
  v_qual text;
  v_check text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'profile_self_is_platform_admin'
  ) THEN
    RAISE EXCEPTION 'profile_self_is_platform_admin() already exists; refusing to replace an unreviewed helper';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc AS p
       WHERE p.oid = to_regprocedure('public.guard_profile_legacy_binding_columns()')
         AND NOT p.prosecdef
         AND p.proowner = 'postgres'::regrole
         AND p.proconfig = ARRAY['search_path=""']
         AND position('CURRENT_USER IN (''anon'', ''authenticated'')' in p.prosrc) > 0
         AND position('NEW.legacy_player_id IS DISTINCT FROM OLD.legacy_player_id' in p.prosrc) > 0
         AND position('NEW.legacy_merge_completed_at IS DISTINCT FROM OLD.legacy_merge_completed_at' in p.prosrc) > 0
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS t
       WHERE t.tgrelid = 'public.profiles'::regclass
         AND t.tgname = 'profiles_guard_legacy_binding_columns'
         AND NOT t.tgisinternal
         AND t.tgenabled <> 'D'
         AND t.tgfoid = 'public.guard_profile_legacy_binding_columns()'::regprocedure
     ) THEN
    RAISE EXCEPTION 'reviewed 20260930142000 profile binding guard is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'is_platform_admin'
      AND atttypid = 'boolean'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'unexpected profiles.is_platform_admin metadata';
  END IF;

  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_qual, v_check
  FROM pg_policy
  WHERE polrelid = 'public.profiles'::regclass
    AND polname = 'Users can update own profile'
    AND polcmd = 'w'
    AND polpermissive
    AND polroles = ARRAY[0::oid];

  IF regexp_replace(COALESCE(v_qual, ''), '\s+', '', 'g') <> '(auth.uid()=id)'
     OR regexp_replace(COALESCE(v_check, ''), '\s+', '', 'g') <>
       '((auth.uid()=id)AND(is_platform_admin=(SELECTprofiles_1.is_platform_adminFROMprofilesprofiles_1WHERE(profiles_1.id=auth.uid()))))' THEN
    RAISE EXCEPTION 'unexpected Users can update own profile baseline: USING %, WITH CHECK %', v_qual, v_check;
  END IF;
END
$guard$;

CREATE FUNCTION public.profile_self_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.is_platform_admin
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
$function$;

ALTER FUNCTION public.profile_self_is_platform_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.profile_self_is_platform_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_self_is_platform_admin()
  TO authenticated, service_role;

ALTER POLICY "Users can update own profile"
  ON public.profiles
  WITH CHECK (
    auth.uid() = id
    AND is_platform_admin = public.profile_self_is_platform_admin()
  );

COMMENT ON FUNCTION public.profile_self_is_platform_admin() IS
  'Read-only RLS helper returning the stored is_platform_admin flag for auth.uid(); no caller-selected identity.';

COMMIT;
