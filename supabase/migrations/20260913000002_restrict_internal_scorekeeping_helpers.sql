-- Supabase default/existing ACLs grant service_role EXECUTE even after client grants are removed.
-- These helpers are called by SECURITY DEFINER entry points, not directly by API callers.
BEGIN;
REVOKE ALL ON FUNCTION
  public.check_and_lock_stats(),
  public.rebuild_corrected_players_private(uuid,uuid[]),
  public.rebuild_game_goalie_stats_private(uuid),
  public.rebuild_game_player_stats_private(uuid),
  public.rebuild_legacy_game_stats_private(uuid),
  public.reconcile_legacy_player_stats_private(uuid,uuid[]),
  public.scorekeeping_admin_authorized_private(uuid,uuid),
  public.scorekeeping_player_on_team_private(uuid,uuid,uuid),
  public.validate_game_event_attribution_private()
FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
