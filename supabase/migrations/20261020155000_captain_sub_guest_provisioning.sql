BEGIN;
-- Requires the already-deployed immutable claimable-guest/Auth invariant.
-- Fail closed on classifier drift instead of replacing an unreviewed definition.
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid='public.classify_claimable_guest_profile()'::regprocedure
     AND pg_catalog.md5(p.prosrc)='1c7de5f15556b1904751d56f0f5a0087'
     AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN
   RAISE EXCEPTION 'Claimable guest classifier prerequisite mismatch';
 END IF;
END $preflight$;
CREATE SCHEMA captain_sub_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA captain_sub_private FROM PUBLIC,anon,authenticated,service_role;
-- Only the later captain authority receives INSERT(profile_id). Defaults bind
-- the proof to the current transaction/backend; classifier consumes it once.
CREATE TABLE captain_sub_private.guest_insert_capabilities (
 profile_id uuid PRIMARY KEY,
 transaction_id xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id(),
 backend_pid integer NOT NULL DEFAULT pg_catalog.pg_backend_pid()
);
REVOKE ALL ON captain_sub_private.guest_insert_capabilities FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.classify_claimable_guest_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_request_role text := auth.role();
  v_captain_capability boolean := false;
  v_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
  v_expected_manual_email text := 'manual-spare+' || NEW.id::text || '@beerleaguehockey.local';
  v_expected_captain_email text := 'captaininvite_' || NEW.id::text || '@captaininvite.hockeylifehl.com';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.profile_auth_identity:' || NEW.id::text, 0)
  );

  -- Consume a DB-only, one-use capability in this transaction/backend. No
  -- caller-supplied JWT, GUC, email flag or mutable profile label can mint it.
  DELETE FROM captain_sub_private.guest_insert_capabilities
  WHERE profile_id = NEW.id
    AND transaction_id = pg_catalog.pg_current_xact_id()
    AND backend_pid = pg_catalog.pg_backend_pid()
  RETURNING true INTO v_captain_capability;

  -- SECURITY DEFINER changes current_user to the function owner. The verified
  -- auth.role() reads PostgREST's verified JWT claim and is the invocation
  -- provenance relevant to server writes.
  IF (v_request_role = 'service_role'
      OR (v_request_role = 'authenticated' AND COALESCE(v_captain_capability, false)
          AND v_email = v_expected_manual_email))
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
$function$
;
REVOKE ALL ON FUNCTION public.classify_claimable_guest_profile() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
