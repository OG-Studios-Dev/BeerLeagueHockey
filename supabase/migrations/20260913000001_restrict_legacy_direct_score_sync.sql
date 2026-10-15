-- Offline direct-client synchronization is not wired into the supported scoring UI.
-- Keep the legacy implementation server-only; callers must authenticate the game session.
BEGIN;
REVOKE ALL ON FUNCTION public.sync_game_event(text,uuid,uuid,uuid,uuid,text,integer,integer,integer,text,uuid,uuid,boolean,boolean,boolean,text,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_game_event(text,uuid,uuid,uuid,uuid,text,integer,integer,integer,text,uuid,uuid,boolean,boolean,boolean,text,uuid,text,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
