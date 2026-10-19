-- V14.6 narrow forward fix: close emitted season facts over exact authorized
-- games and admit an exact accepted sub as selected-season scope evidence.
-- The already-applied 20261019011500 and 20261019040025 migrations remain immutable.

begin;

-- Snapshot exact effective schema CREATE before replacing the service_role-owned
-- function. A transaction-local grant is used only when ALTER OWNER requires it.
do $function_owner_privilege_snapshot$
declare
  v_service_role_had_schema_create boolean;
begin
  select pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    into v_service_role_had_schema_create;
  if v_service_role_had_schema_create is null then
    raise exception using
      errcode = '55000',
      message = 'mobile profile V14.6 service_role schema CREATE privilege snapshot unavailable';
  end if;
  perform pg_catalog.set_config(
    'hockey_life.mobile_profile_v14_6_service_role_public_create_before',
    v_service_role_had_schema_create::text,
    true
  );
end;
$function_owner_privilege_snapshot$;

-- DROP + CREATE removes any hostile owner or direct grants on this signature.
drop function if exists public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid);

create function public.mobile_profile_phase_facts_v1(
  p_phase text,
  p_league_id uuid,
  p_player_id uuid,
  p_season_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $function$
declare
  v_source_cap constant integer := 5000;
  v_total_cap constant integer := 5000;
  v_response_cap constant integer := 8388608;
  v_preflight_byte_cap constant integer := 7864320;
  v_row_byte_cap constant integer := 262144;
  v_total integer := 0;
  v_largest_source integer := 0;
  v_estimated_bytes bigint := 0;
  v_largest_row_bytes integer := 0;
  v_seasons jsonb := '[]'::jsonb;
  v_games jsonb := '[]'::jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_profiles jsonb := '[]'::jsonb;
  v_rosters jsonb := '[]'::jsonb;
  v_checkins jsonb := '[]'::jsonb;
  v_availabilities jsonb := '[]'::jsonb;
  v_accepted_subs jsonb := '[]'::jsonb;
  v_player_stats jsonb := '[]'::jsonb;
  v_goalie_stats jsonb := '[]'::jsonb;
  v_goalie_appearances jsonb := '[]'::jsonb;
  v_baselines jsonb := '[]'::jsonb;
  v_team_player_signals jsonb := '[]'::jsonb;
  v_team_goalie_signals jsonb := '[]'::jsonb;
  v_facts jsonb;
  v_counts jsonb;
  v_result jsonb;
begin
  if p_phase is null or p_phase not in ('selected_stats', 'timeline', 'game_log') then
    raise exception using errcode = '22023', message = 'invalid mobile profile fact phase';
  end if;
  if p_league_id is null or p_player_id is null then
    raise exception using errcode = '22023', message = 'mobile profile fact scope is required';
  end if;
  if (p_phase in ('selected_stats', 'game_log') and p_season_id is null)
     or (p_phase = 'timeline' and p_season_id is not null) then
    raise exception using errcode = '22023', message = 'mobile profile fact season scope is invalid';
  end if;

  -- This server route is intentionally Hockey Life-only. Requiring both the
  -- fixed identity and public/active metadata prevents UUID enumeration through
  -- a privileged caller and mirrors the route's league authorization.
  if p_league_id <> 'd6e55507-6eae-4d94-978c-47c6c30a36f1'::uuid
     or not exists (
       select 1
       from public.leagues l
       where l.id = p_league_id
         and l.slug = 'hockey-life'
         and l.status = 'active'
         and l.is_public is true
     ) then
    raise exception using errcode = '22023', message = 'mobile profile fact league is unavailable';
  end if;

  -- Match resolveScopedPlayer: a real profile plus an exact league/season/team
  -- roster relationship whose team and season both belong to the league.
  if not exists (
    select 1
    from public.profiles p
    join public.team_rosters tr on tr.player_id = p.id
    join public.teams t on t.id = tr.team_id and t.league_id = tr.league_id
    join public.seasons s on s.id = tr.season_id and s.league_id = tr.league_id
    where p.id = p_player_id
      and tr.league_id = p_league_id
  ) then
    raise exception using errcode = '22023', message = 'mobile profile fact player is outside league scope';
  end if;

  if p_season_id is not null then
    if not exists (
      select 1
      from public.seasons s
      where s.id = p_season_id and s.league_id = p_league_id
    ) then
      raise exception using errcode = '22023', message = 'mobile profile fact season is outside league scope';
    end if;

    -- A valid UUID in the league is not enough: the target must have a valid
    -- parent-backed fact in the selected season.
    if not exists (
      select 1
      from public.team_rosters tr
      join public.teams t on t.id = tr.team_id and t.league_id = p_league_id
      where tr.player_id = p_player_id
        and tr.league_id = p_league_id
        and tr.season_id = p_season_id
      union all
      select 1
      from public.player_stats ps
      join public.games g on g.id = ps.game_id
        and g.league_id = ps.league_id and g.season_id = ps.season_id
        and ps.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where ps.player_id = p_player_id
        and ps.league_id = p_league_id and ps.season_id = p_season_id
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = ps.player_id and auth_tr.team_id = ps.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = ps.player_id and auth_si.game_id = g.id
              and auth_si.team_id = ps.team_id and auth_si.status = 'accepted'
          )
        )
      union all
      select 1
      from public.goalie_stats gs
      join public.games g on g.id = gs.game_id
        and g.league_id = gs.league_id and g.season_id = gs.season_id
        and gs.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where gs.player_id = p_player_id
        and gs.league_id = p_league_id and gs.season_id = p_season_id
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = gs.player_id and auth_tr.team_id = gs.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = gs.player_id and auth_si.game_id = g.id
              and auth_si.team_id = gs.team_id and auth_si.status = 'accepted'
          )
        )
      union all
      select 1
      from public.sub_invitations selected_si
      join public.games selected_game on selected_game.id = selected_si.game_id
      join public.seasons selected_game_season
        on selected_game_season.id = selected_game.season_id
        and selected_game_season.league_id = selected_game.league_id
      join public.teams selected_game_home
        on selected_game_home.id = selected_game.home_team_id
        and selected_game_home.league_id = selected_game.league_id
      join public.teams selected_game_away
        on selected_game_away.id = selected_game.away_team_id
        and selected_game_away.league_id = selected_game.league_id
      where selected_si.invited_player_id = p_player_id
        and selected_si.status = 'accepted'
        and selected_game.league_id = p_league_id
        and selected_game.season_id = p_season_id
        and selected_si.team_id in (selected_game.home_team_id, selected_game.away_team_id)
      limit 1
    ) then
      raise exception using errcode = '22023', message = 'mobile profile fact player is outside selected season scope';
    end if;
  end if;

  -- PRE-AGGREGATION WORK/ROW/BYTE PREFLIGHT
  -- Every branch is independently capped at cap+1. No fact-array aggregation runs until the
  -- largest source, cumulative rows, largest row, and cumulative bytes pass.
  with all_facts(source_name, fact) as materialized (
    select 'seasons', pg_catalog.to_jsonb(q)
    from (
      select s.id, s.league_id, s.name, s.start_date
      from public.seasons s
      where p_phase <> 'selected_stats'
        and s.league_id = p_league_id
        and (p_phase = 'timeline' or s.id = p_season_id)
        and (
          exists (
            select 1 from public.team_rosters tr
            join public.teams t on t.id = tr.team_id and t.league_id = p_league_id
            where tr.player_id = p_player_id and tr.league_id = p_league_id
              and tr.season_id = s.id
          )
          or exists (
            select 1
            from public.games authorized_game
            where authorized_game.league_id = p_league_id
              and authorized_game.season_id = s.id
              and exists (
                select 1 from public.teams authorized_game_home
                where authorized_game_home.id = authorized_game.home_team_id
                  and authorized_game_home.league_id = authorized_game.league_id
              )
              and exists (
                select 1 from public.teams authorized_game_away
                where authorized_game_away.id = authorized_game.away_team_id
                  and authorized_game_away.league_id = authorized_game.league_id
              )
              and (p_phase = 'timeline' or authorized_game.season_id = p_season_id)
              and (p_phase <> 'selected_stats' or authorized_game.status = 'completed')
              and (
                exists (
                  select 1
                  from public.team_rosters auth_tr
                  where auth_tr.player_id = p_player_id
                    and auth_tr.league_id = authorized_game.league_id
                    and auth_tr.season_id = authorized_game.season_id
                    and auth_tr.team_id in (authorized_game.home_team_id, authorized_game.away_team_id)
                    and auth_tr.status::text = 'active'
                    and auth_tr.player_type = 'regular'
                    and auth_tr.start_date is not null
                    and auth_tr.start_date <= (authorized_game.scheduled_at at time zone 'America/Toronto')::date
                    and (auth_tr.end_date is null or auth_tr.end_date >= (authorized_game.scheduled_at at time zone 'America/Toronto')::date)
                )
                or exists (
                  select 1
                  from public.sub_invitations auth_si
                  where auth_si.invited_player_id = p_player_id
                    and auth_si.game_id = authorized_game.id
                    and auth_si.team_id in (authorized_game.home_team_id, authorized_game.away_team_id)
                    and auth_si.status = 'accepted'
                )
              )
          )
        )
      limit 5001
    ) q
    union all
    select 'games', pg_catalog.to_jsonb(q)
    from (
      select g.id, g.league_id, g.season_id, g.status, g.home_team_id, g.away_team_id,
        g.home_score, g.away_score, g.scheduled_at, g.location,
        g.penalty_capture_status, g.goalie_capture_status, g.skater_capture_status
      from public.games g
      where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
        and (p_phase = 'timeline' or g.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and (
          exists (
            select 1
            from public.team_rosters auth_tr
            where auth_tr.player_id = p_player_id and auth_tr.league_id = g.league_id
              and auth_tr.season_id = g.season_id
              and auth_tr.team_id in (g.home_team_id, g.away_team_id)
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
              and auth_si.team_id in (g.home_team_id, g.away_team_id)
              and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
    union all
    select 'teams', pg_catalog.to_jsonb(q)
    from (
      select t.id, t.league_id, t.division_id, t.name, t.slug
      from public.teams t
      where t.league_id = p_league_id
        and (
          exists (
          select 1
          from public.games g
          where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
            and (p_phase = 'timeline' or g.season_id = p_season_id)
            and (p_phase <> 'selected_stats' or g.status = 'completed')
            and t.id in (g.home_team_id, g.away_team_id)
            and (
              exists (
                select 1 from public.team_rosters auth_tr
                where auth_tr.player_id = p_player_id and auth_tr.league_id = g.league_id
                  and auth_tr.season_id = g.season_id
                  and auth_tr.team_id in (g.home_team_id, g.away_team_id)
                  and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
                  and auth_tr.start_date is not null
                  and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
                  and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
              )
              or exists (
                select 1 from public.sub_invitations auth_si
                where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
                  and auth_si.team_id in (g.home_team_id, g.away_team_id)
                  and auth_si.status = 'accepted'
              )
            )
        )
        or exists (
          select 1
          from public.team_rosters target_tr
          join public.seasons roster_season
            on roster_season.id = target_tr.season_id
            and roster_season.league_id = target_tr.league_id
          where target_tr.player_id = p_player_id
            and target_tr.league_id = p_league_id
            and target_tr.team_id = t.id
            and (p_phase = 'timeline' or target_tr.season_id = p_season_id)
        )
      )
      limit 5001
    ) q
    union all
    select 'profiles', pg_catalog.to_jsonb(q)
    from (
      select p.id, p.full_name, p.avatar_url, p.photo_url
      from public.profiles p where p.id = p_player_id
      limit 5001
    ) q
    union all
    select 'rosters', pg_catalog.to_jsonb(q)
    from (
      select tr.id, tr.player_id, tr.team_id, tr.league_id, tr.season_id,
        tr.start_date, tr.end_date, tr.is_goalie, tr.position::text as position,
        tr.status::text as status, tr.player_type, tr.historical_retained,
        tr.games_played_override
      from public.team_rosters tr
      join public.teams t on t.id = tr.team_id and t.league_id = tr.league_id
      join public.seasons s on s.id = tr.season_id and s.league_id = tr.league_id
      where tr.league_id = p_league_id
        and (p_phase = 'timeline' or tr.season_id = p_season_id)
        and (
          tr.player_id = p_player_id
          or (
            p_phase = 'selected_stats'
            and (tr.is_goalie is true or pg_catalog.lower(pg_catalog.btrim(coalesce(tr.position::text, ''))) in ('g','goalie','goaltender'))
            and exists (
              select 1 from public.games g
              where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and g.season_id = p_season_id
                and g.status = 'completed'
                and tr.team_id in (g.home_team_id, g.away_team_id)
                and tr.status::text = 'active' and tr.player_type = 'regular'
                and tr.start_date is not null
                and tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
                and (tr.end_date is null or tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
                and (
                  exists (
                    select 1 from public.team_rosters target_auth_tr
                    where target_auth_tr.player_id = p_player_id
                      and target_auth_tr.team_id = tr.team_id
                      and target_auth_tr.league_id = g.league_id
                      and target_auth_tr.season_id = g.season_id
                      and target_auth_tr.status::text = 'active'
                      and target_auth_tr.player_type = 'regular'
                      and target_auth_tr.start_date is not null
                      and target_auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
                      and (target_auth_tr.end_date is null or target_auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
                  )
                  or exists (
                    select 1 from public.sub_invitations target_auth_si
                    where target_auth_si.invited_player_id = p_player_id
                      and target_auth_si.game_id = g.id and target_auth_si.team_id = tr.team_id
                      and target_auth_si.status = 'accepted'
                  )
                )
                and (
                  exists (
                    select 1 from public.goalie_stats target_gs
                    where target_gs.player_id = p_player_id
                      and target_gs.game_id = g.id and target_gs.team_id = tr.team_id
                      and target_gs.league_id = g.league_id and target_gs.season_id = g.season_id
                  )
                  or exists (
                    select 1 from public.game_goalie_appearances target_ga
                    where target_ga.player_id = p_player_id and target_ga.game_id = g.id
                      and target_ga.team_id = tr.team_id
                      and target_ga.team_type = case when tr.team_id = g.home_team_id then 'home' else 'away' end
                  )
                  or exists (
                    select 1 from public.team_rosters target_tr
                    where target_tr.player_id = p_player_id
                      and target_tr.league_id = g.league_id and target_tr.season_id = g.season_id
                      and target_tr.team_id = tr.team_id
                      and (target_tr.is_goalie is true or pg_catalog.lower(pg_catalog.btrim(coalesce(target_tr.position::text, ''))) in ('g','goalie','goaltender'))
                  )
                )
            )
          )
        )
      limit 5001
    ) q
    union all
    select 'checkins', pg_catalog.to_jsonb(q)
    from (
      select gc.id, gc.game_id, gc.player_id, gc.team_id, gc.status
      from public.game_checkins gc
      join public.games g on g.id = gc.game_id
      where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
        and (p_phase = 'timeline' or g.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and gc.team_id in (g.home_team_id, g.away_team_id)
        and gc.player_id = p_player_id
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = gc.player_id and auth_tr.team_id = gc.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = gc.player_id and auth_si.game_id = g.id
              and auth_si.team_id = gc.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
    union all
    select 'availabilities', pg_catalog.to_jsonb(q)
    from (
      select pa.id, pa.game_id, pa.player_id, pa.team_id, pa.season_id, pa.status
      from public.player_availability pa
      join public.games g on g.id = pa.game_id and g.season_id = pa.season_id
      where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and pa.status = 'out'
        and (p_phase = 'timeline' or g.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and pa.team_id in (g.home_team_id, g.away_team_id)
        and pa.player_id = p_player_id
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = pa.player_id and auth_tr.team_id = pa.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = pa.player_id and auth_si.game_id = g.id
              and auth_si.team_id = pa.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
    union all
    select 'acceptedSubs', pg_catalog.to_jsonb(q)
    from (
      select si.id, si.game_id, si.invited_player_id, si.team_id, si.status
      from public.sub_invitations si
      join public.games g on g.id = si.game_id
      where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and si.status = 'accepted'
        and (p_phase = 'timeline' or g.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and si.team_id in (g.home_team_id, g.away_team_id)
        and si.invited_player_id = p_player_id
      limit 5001
    ) q
    union all
    select 'playerStats', pg_catalog.to_jsonb(q)
    from (
      select ps.id, ps.game_id, ps.player_id, ps.team_id, ps.league_id,
        ps.season_id, ps.goals, ps.assists, ps.penalty_minutes,
        ps.scorekeeping_provenance, ps.created_at
      from public.player_stats ps
      join public.games g on g.id = ps.game_id
        and g.league_id = ps.league_id and g.season_id = ps.season_id
        and ps.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where ps.player_id = p_player_id and ps.league_id = p_league_id
        and (p_phase = 'timeline' or ps.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = ps.player_id and auth_tr.team_id = ps.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = ps.player_id and auth_si.game_id = g.id
              and auth_si.team_id = ps.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
    union all
    select 'goalieStats', pg_catalog.to_jsonb(q)
    from (
      select gs.id, gs.game_id, gs.player_id, gs.team_id, gs.league_id,
        gs.season_id, gs.game_result, gs.saves, gs.shots_against,
        gs.goals_against, gs.shutout, gs.scorekeeping_provenance
      from public.goalie_stats gs
      join public.games g on g.id = gs.game_id
        and g.league_id = gs.league_id and g.season_id = gs.season_id
        and gs.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where gs.league_id = p_league_id
        and (p_phase = 'timeline' or gs.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = gs.player_id and auth_tr.team_id = gs.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = gs.player_id and auth_si.game_id = g.id
              and auth_si.team_id = gs.team_id and auth_si.status = 'accepted'
          )
        )
        and (
          gs.player_id = p_player_id
          or (
            p_phase = 'selected_stats'
            and exists (
              select 1 from public.goalie_stats target_gs
              where target_gs.player_id = p_player_id
                and target_gs.game_id = g.id and target_gs.team_id = gs.team_id
                and target_gs.league_id = g.league_id and target_gs.season_id = g.season_id
            )
          )
        )
      limit 5001
    ) q
    union all
    select 'goalieAppearances', pg_catalog.to_jsonb(q)
    from (
      select ga.game_id, ga.player_id, ga.team_id, ga.team_type
      from public.game_goalie_appearances ga
      join public.games g on g.id = ga.game_id
      where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
        and (p_phase = 'timeline' or g.season_id = p_season_id)
        and (p_phase <> 'selected_stats' or g.status = 'completed')
        and ga.team_id in (g.home_team_id, g.away_team_id)
        and ga.team_type = case when ga.team_id = g.home_team_id then 'home' else 'away' end
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = ga.player_id and auth_tr.team_id = ga.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = ga.player_id and auth_si.game_id = g.id
              and auth_si.team_id = ga.team_id and auth_si.status = 'accepted'
          )
        )
        and (
          ga.player_id = p_player_id
          or (
            p_phase = 'selected_stats'
            and exists (
              select 1 from public.goalie_stats target_gs
              where target_gs.player_id = p_player_id
                and target_gs.game_id = g.id and target_gs.team_id = ga.team_id
                and target_gs.league_id = g.league_id and target_gs.season_id = g.season_id
            )
          )
        )
      limit 5001
    ) q
    union all
    select 'baselines', pg_catalog.to_jsonb(q)
    from (
      select pcb.league_id, pcb.player_id, pcb.source_system, pcb.source_batch_id,
        pcb.games_played, pcb.goals, pcb.assists, pcb.points, pcb.wins, pcb.ties,
        pcb.saves, pcb.goals_against, pcb.shutouts, pcb.save_percentage,
        pcb.goals_against_average
      from public.player_career_baselines pcb
      where p_phase = 'timeline' and pcb.league_id = p_league_id
        and pcb.player_id = p_player_id
      order by pcb.source_system, pcb.source_batch_id
      limit 5001
    ) q
    union all
    select 'teamPlayerSignals', pg_catalog.to_jsonb(q)
    from (
      select ps.id, ps.game_id, ps.team_id, ps.season_id
      from public.player_stats ps
      join public.games g on g.id = ps.game_id
        and g.league_id = ps.league_id and g.season_id = ps.season_id
        and ps.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where p_phase <> 'selected_stats' and ps.league_id = p_league_id
        and (p_phase = 'timeline' or ps.season_id = p_season_id)
        and g.home_score is null and g.away_score is null
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = p_player_id and auth_tr.team_id = ps.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
              and auth_si.team_id = ps.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
    union all
    select 'teamGoalieSignals', pg_catalog.to_jsonb(q)
    from (
      select gs.id, gs.game_id, gs.team_id, gs.season_id
      from public.goalie_stats gs
      join public.games g on g.id = gs.game_id
        and g.league_id = gs.league_id and g.season_id = gs.season_id
        and gs.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where p_phase <> 'selected_stats' and gs.league_id = p_league_id
        and (p_phase = 'timeline' or gs.season_id = p_season_id)
        and g.home_score is null and g.away_score is null
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = p_player_id and auth_tr.team_id = gs.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
              and auth_si.team_id = gs.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q
  ), source_totals as (
    select source_name, pg_catalog.count(*)::integer as row_count,
      coalesce(pg_catalog.sum(pg_catalog.octet_length(fact::text)), 0)::bigint as source_bytes,
      coalesce(pg_catalog.max(pg_catalog.octet_length(fact::text)), 0)::integer as max_row_bytes
    from all_facts
    group by source_name
  )
  select coalesce(pg_catalog.sum(row_count), 0)::integer,
    coalesce(pg_catalog.max(row_count), 0)::integer,
    coalesce(pg_catalog.sum(source_bytes), 0)::bigint,
    coalesce(pg_catalog.max(max_row_bytes), 0)::integer
  into v_total, v_largest_source, v_estimated_bytes, v_largest_row_bytes
  from source_totals;

  if v_largest_source > v_source_cap then
    raise exception using errcode = '54000', message = 'mobile profile fact source cap exceeded';
  end if;
  if v_total > v_total_cap then
    raise exception using errcode = '54000', message = 'mobile profile fact total cap exceeded';
  end if;
  if v_largest_row_bytes > v_row_byte_cap then
    raise exception using errcode = '54000', message = 'mobile profile fact row byte cap exceeded';
  end if;
  if v_estimated_bytes > v_preflight_byte_cap then
    raise exception using errcode = '54000', message = 'mobile profile fact preflight byte cap exceeded';
  end if;

  -- JSON AGGREGATION STARTS ONLY AFTER ALL GLOBAL PREFLIGHTS PASS.
  if p_phase <> 'selected_stats' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.start_date nulls first, q.id), '[]'::jsonb)
      into v_seasons
    from (
      select s.id, s.league_id, s.name, s.start_date
      from public.seasons s
      where s.league_id = p_league_id
        and (p_phase = 'timeline' or s.id = p_season_id)
        and (
          exists (
            select 1 from public.team_rosters tr
            join public.teams t on t.id = tr.team_id and t.league_id = p_league_id
            where tr.player_id = p_player_id and tr.league_id = p_league_id and tr.season_id = s.id
          )
          or exists (
            select 1
            from public.games authorized_game
            where authorized_game.league_id = p_league_id
              and authorized_game.season_id = s.id
              and exists (
                select 1 from public.teams authorized_game_home
                where authorized_game_home.id = authorized_game.home_team_id
                  and authorized_game_home.league_id = authorized_game.league_id
              )
              and exists (
                select 1 from public.teams authorized_game_away
                where authorized_game_away.id = authorized_game.away_team_id
                  and authorized_game_away.league_id = authorized_game.league_id
              )
              and (p_phase = 'timeline' or authorized_game.season_id = p_season_id)
              and (p_phase <> 'selected_stats' or authorized_game.status = 'completed')
              and (
                exists (
                  select 1
                  from public.team_rosters auth_tr
                  where auth_tr.player_id = p_player_id
                    and auth_tr.league_id = authorized_game.league_id
                    and auth_tr.season_id = authorized_game.season_id
                    and auth_tr.team_id in (authorized_game.home_team_id, authorized_game.away_team_id)
                    and auth_tr.status::text = 'active'
                    and auth_tr.player_type = 'regular'
                    and auth_tr.start_date is not null
                    and auth_tr.start_date <= (authorized_game.scheduled_at at time zone 'America/Toronto')::date
                    and (auth_tr.end_date is null or auth_tr.end_date >= (authorized_game.scheduled_at at time zone 'America/Toronto')::date)
                )
                or exists (
                  select 1
                  from public.sub_invitations auth_si
                  where auth_si.invited_player_id = p_player_id
                    and auth_si.game_id = authorized_game.id
                    and auth_si.team_id in (authorized_game.home_team_id, authorized_game.away_team_id)
                    and auth_si.status = 'accepted'
                )
              )
          )
        )
      limit 5001
    ) q;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.scheduled_at, q.id), '[]'::jsonb)
    into v_games
  from (
    select g.id, g.league_id, g.season_id, g.status, g.home_team_id, g.away_team_id,
      g.home_score, g.away_score, g.scheduled_at, g.location,
      g.penalty_capture_status, g.goalie_capture_status, g.skater_capture_status
    from public.games g
    where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      and (p_phase = 'timeline' or g.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = p_player_id and auth_tr.league_id = g.league_id
            and auth_tr.season_id = g.season_id
            and auth_tr.team_id in (g.home_team_id, g.away_team_id)
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
            and auth_si.team_id in (g.home_team_id, g.away_team_id)
            and auth_si.status = 'accepted'
        )
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_teams
  from (
    select t.id, t.league_id, t.division_id, t.name, t.slug
    from public.teams t
    where t.league_id = p_league_id
      and (
        exists (
        select 1 from public.games g
        where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
          and (p_phase = 'timeline' or g.season_id = p_season_id)
          and (p_phase <> 'selected_stats' or g.status = 'completed')
          and t.id in (g.home_team_id, g.away_team_id)
          and (
            exists (
              select 1 from public.team_rosters auth_tr
              where auth_tr.player_id = p_player_id and auth_tr.league_id = g.league_id
                and auth_tr.season_id = g.season_id
                and auth_tr.team_id in (g.home_team_id, g.away_team_id)
                and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
                and auth_tr.start_date is not null
                and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
                and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
            )
            or exists (
              select 1 from public.sub_invitations auth_si
              where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
                and auth_si.team_id in (g.home_team_id, g.away_team_id)
                and auth_si.status = 'accepted'
            )
          )
      )
      or exists (
        select 1
        from public.team_rosters target_tr
        join public.seasons roster_season
          on roster_season.id = target_tr.season_id
          and roster_season.league_id = target_tr.league_id
        where target_tr.player_id = p_player_id
          and target_tr.league_id = p_league_id
          and target_tr.team_id = t.id
          and (p_phase = 'timeline' or target_tr.season_id = p_season_id)
      )
    )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_profiles
  from (
    select p.id, p.full_name, p.avatar_url, p.photo_url
    from public.profiles p where p.id = p_player_id limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_rosters
  from (
    select tr.id, tr.player_id, tr.team_id, tr.league_id, tr.season_id,
      tr.start_date, tr.end_date, tr.is_goalie, tr.position::text as position,
      tr.status::text as status, tr.player_type, tr.historical_retained,
      tr.games_played_override
    from public.team_rosters tr
    join public.teams t on t.id = tr.team_id and t.league_id = tr.league_id
    join public.seasons s on s.id = tr.season_id and s.league_id = tr.league_id
    where tr.league_id = p_league_id
      and (p_phase = 'timeline' or tr.season_id = p_season_id)
      and (
        tr.player_id = p_player_id
        or (
          p_phase = 'selected_stats'
          and (tr.is_goalie is true or pg_catalog.lower(pg_catalog.btrim(coalesce(tr.position::text, ''))) in ('g','goalie','goaltender'))
          and exists (
            select 1 from public.games g
            where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and g.season_id = p_season_id and g.status = 'completed'
              and tr.team_id in (g.home_team_id, g.away_team_id)
              and tr.status::text = 'active' and tr.player_type = 'regular'
              and tr.start_date is not null
              and tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (tr.end_date is null or tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
              and (
                exists (
                  select 1 from public.team_rosters target_auth_tr
                  where target_auth_tr.player_id = p_player_id and target_auth_tr.team_id = tr.team_id
                    and target_auth_tr.league_id = g.league_id and target_auth_tr.season_id = g.season_id
                    and target_auth_tr.status::text = 'active' and target_auth_tr.player_type = 'regular'
                    and target_auth_tr.start_date is not null
                    and target_auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
                    and (target_auth_tr.end_date is null or target_auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
                )
                or exists (
                  select 1 from public.sub_invitations target_auth_si
                  where target_auth_si.invited_player_id = p_player_id and target_auth_si.game_id = g.id
                    and target_auth_si.team_id = tr.team_id and target_auth_si.status = 'accepted'
                )
              )
              and (
                exists (select 1 from public.goalie_stats target_gs where target_gs.player_id = p_player_id and target_gs.game_id = g.id and target_gs.team_id = tr.team_id and target_gs.league_id = g.league_id and target_gs.season_id = g.season_id)
                or exists (select 1 from public.game_goalie_appearances target_ga where target_ga.player_id = p_player_id and target_ga.game_id = g.id and target_ga.team_id = tr.team_id and target_ga.team_type = case when tr.team_id = g.home_team_id then 'home' else 'away' end)
                or exists (select 1 from public.team_rosters target_tr where target_tr.player_id = p_player_id and target_tr.league_id = g.league_id and target_tr.season_id = g.season_id and target_tr.team_id = tr.team_id and (target_tr.is_goalie is true or pg_catalog.lower(pg_catalog.btrim(coalesce(target_tr.position::text, ''))) in ('g','goalie','goaltender')))
              )
          )
        )
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_checkins
  from (
    select gc.id, gc.game_id, gc.player_id, gc.team_id, gc.status
    from public.game_checkins gc join public.games g on g.id = gc.game_id
    where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and (p_phase = 'timeline' or g.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and gc.team_id in (g.home_team_id, g.away_team_id) and gc.player_id = p_player_id
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = gc.player_id and auth_tr.team_id = gc.team_id
            and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = gc.player_id and auth_si.game_id = g.id
            and auth_si.team_id = gc.team_id and auth_si.status = 'accepted'
        )
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_availabilities
  from (
    select pa.id, pa.game_id, pa.player_id, pa.team_id, pa.season_id, pa.status
    from public.player_availability pa join public.games g on g.id = pa.game_id and g.season_id = pa.season_id
    where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and pa.status = 'out'
      and (p_phase = 'timeline' or g.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and pa.team_id in (g.home_team_id, g.away_team_id) and pa.player_id = p_player_id
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = pa.player_id and auth_tr.team_id = pa.team_id
            and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = pa.player_id and auth_si.game_id = g.id
            and auth_si.team_id = pa.team_id and auth_si.status = 'accepted'
        )
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_accepted_subs
  from (
    select si.id, si.game_id, si.invited_player_id, si.team_id, si.status
    from public.sub_invitations si join public.games g on g.id = si.game_id
    where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and si.status = 'accepted'
      and (p_phase = 'timeline' or g.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and si.team_id in (g.home_team_id, g.away_team_id) and si.invited_player_id = p_player_id
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_player_stats
  from (
    select ps.id, ps.game_id, ps.player_id, ps.team_id, ps.league_id, ps.season_id,
      ps.goals, ps.assists, ps.penalty_minutes, ps.scorekeeping_provenance, ps.created_at
    from public.player_stats ps join public.games g on g.id = ps.game_id
      and g.league_id = ps.league_id and g.season_id = ps.season_id
      and ps.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
    where ps.player_id = p_player_id and ps.league_id = p_league_id
      and (p_phase = 'timeline' or ps.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = ps.player_id and auth_tr.team_id = ps.team_id
            and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = ps.player_id and auth_si.game_id = g.id
            and auth_si.team_id = ps.team_id and auth_si.status = 'accepted'
        )
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
    into v_goalie_stats
  from (
    select gs.id, gs.game_id, gs.player_id, gs.team_id, gs.league_id, gs.season_id,
      gs.game_result, gs.saves, gs.shots_against, gs.goals_against, gs.shutout,
      gs.scorekeeping_provenance
    from public.goalie_stats gs join public.games g on g.id = gs.game_id
      and g.league_id = gs.league_id and g.season_id = gs.season_id
      and gs.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
    where gs.league_id = p_league_id and (p_phase = 'timeline' or gs.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = gs.player_id and auth_tr.team_id = gs.team_id
            and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = gs.player_id and auth_si.game_id = g.id
            and auth_si.team_id = gs.team_id and auth_si.status = 'accepted'
        )
      )
      and (
        gs.player_id = p_player_id
        or (p_phase = 'selected_stats' and exists (
          select 1 from public.goalie_stats target_gs
          where target_gs.player_id = p_player_id and target_gs.game_id = g.id
            and target_gs.team_id = gs.team_id and target_gs.league_id = g.league_id
            and target_gs.season_id = g.season_id
        ))
      )
    limit 5001
  ) q;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.game_id, q.player_id), '[]'::jsonb)
    into v_goalie_appearances
  from (
    select ga.game_id, ga.player_id, ga.team_id, ga.team_type
    from public.game_goalie_appearances ga join public.games g on g.id = ga.game_id
    where g.league_id = p_league_id
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        ) and (p_phase = 'timeline' or g.season_id = p_season_id)
      and (p_phase <> 'selected_stats' or g.status = 'completed')
      and ga.team_id in (g.home_team_id, g.away_team_id)
      and ga.team_type = case when ga.team_id = g.home_team_id then 'home' else 'away' end
      and (
        exists (
          select 1 from public.team_rosters auth_tr
          where auth_tr.player_id = ga.player_id and auth_tr.team_id = ga.team_id
            and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
            and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
            and auth_tr.start_date is not null
            and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
            and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
        )
        or exists (
          select 1 from public.sub_invitations auth_si
          where auth_si.invited_player_id = ga.player_id and auth_si.game_id = g.id
            and auth_si.team_id = ga.team_id and auth_si.status = 'accepted'
        )
      )
      and (
        ga.player_id = p_player_id
        or (p_phase = 'selected_stats' and exists (
          select 1 from public.goalie_stats target_gs
          where target_gs.player_id = p_player_id and target_gs.game_id = g.id
            and target_gs.team_id = ga.team_id and target_gs.league_id = g.league_id
            and target_gs.season_id = g.season_id
        ))
      )
    limit 5001
  ) q;

  if p_phase = 'timeline' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.source_system, q.source_batch_id), '[]'::jsonb)
      into v_baselines
    from (
      select pcb.league_id, pcb.player_id, pcb.source_system, pcb.source_batch_id,
        pcb.games_played, pcb.goals, pcb.assists, pcb.points, pcb.wins, pcb.ties,
        pcb.saves, pcb.goals_against, pcb.shutouts, pcb.save_percentage,
        pcb.goals_against_average
      from public.player_career_baselines pcb
      where pcb.league_id = p_league_id and pcb.player_id = p_player_id
      order by pcb.source_system, pcb.source_batch_id
      limit 5001
    ) q;
  end if;

  if p_phase <> 'selected_stats' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
      into v_team_player_signals
    from (
      select ps.id, ps.game_id, ps.team_id, ps.season_id
      from public.player_stats ps join public.games g on g.id = ps.game_id
        and g.league_id = ps.league_id and g.season_id = ps.season_id
        and ps.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where ps.league_id = p_league_id and (p_phase = 'timeline' or ps.season_id = p_season_id)
        and g.home_score is null and g.away_score is null
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = p_player_id and auth_tr.team_id = ps.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
              and auth_si.team_id = ps.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q;

    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) order by q.id), '[]'::jsonb)
      into v_team_goalie_signals
    from (
      select gs.id, gs.game_id, gs.team_id, gs.season_id
      from public.goalie_stats gs join public.games g on g.id = gs.game_id
        and g.league_id = gs.league_id and g.season_id = gs.season_id
        and gs.team_id in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from public.seasons game_season
          where game_season.id = g.season_id and game_season.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_home
          where game_home.id = g.home_team_id and game_home.league_id = g.league_id
        )
        and exists (
          select 1 from public.teams game_away
          where game_away.id = g.away_team_id and game_away.league_id = g.league_id
        )
      where gs.league_id = p_league_id and (p_phase = 'timeline' or gs.season_id = p_season_id)
        and g.home_score is null and g.away_score is null
        and (
          exists (
            select 1 from public.team_rosters auth_tr
            where auth_tr.player_id = p_player_id and auth_tr.team_id = gs.team_id
              and auth_tr.league_id = g.league_id and auth_tr.season_id = g.season_id
              and auth_tr.status::text = 'active' and auth_tr.player_type = 'regular'
              and auth_tr.start_date is not null
              and auth_tr.start_date <= (g.scheduled_at at time zone 'America/Toronto')::date
              and (auth_tr.end_date is null or auth_tr.end_date >= (g.scheduled_at at time zone 'America/Toronto')::date)
          )
          or exists (
            select 1 from public.sub_invitations auth_si
            where auth_si.invited_player_id = p_player_id and auth_si.game_id = g.id
              and auth_si.team_id = gs.team_id and auth_si.status = 'accepted'
          )
        )
      limit 5001
    ) q;
  end if;

  if p_phase = 'selected_stats' then
    v_facts := pg_catalog.jsonb_build_object(
      'games', v_games, 'teams', v_teams, 'profiles', v_profiles,
      'rosters', v_rosters, 'checkins', v_checkins,
      'availabilities', v_availabilities, 'acceptedSubs', v_accepted_subs,
      'playerStats', v_player_stats, 'goalieStats', v_goalie_stats,
      'goalieAppearances', v_goalie_appearances
    );
  else
    v_facts := pg_catalog.jsonb_build_object(
      'seasons', v_seasons, 'games', v_games, 'teams', v_teams,
      'profiles', v_profiles, 'rosters', v_rosters, 'checkins', v_checkins,
      'availabilities', v_availabilities, 'acceptedSubs', v_accepted_subs,
      'playerStats', v_player_stats, 'goalieStats', v_goalie_stats,
      'goalieAppearances', v_goalie_appearances, 'baselines', v_baselines,
      'teamPlayerSignals', v_team_player_signals,
      'teamGoalieSignals', v_team_goalie_signals
    );
  end if;

  select pg_catalog.jsonb_object_agg(key, pg_catalog.jsonb_array_length(value))
    || pg_catalog.jsonb_build_object('total', v_total)
  into v_counts
  from pg_catalog.jsonb_each(v_facts);

  v_result := pg_catalog.jsonb_build_object(
    'schema_version', 'mobile_profile_phase_facts_v1',
    'phase', p_phase,
    'scope', pg_catalog.jsonb_build_object(
      'league_id', p_league_id, 'player_id', p_player_id, 'season_id', p_season_id
    ),
    'limits', pg_catalog.jsonb_build_object(
      'source_cap', v_source_cap, 'total_cap', v_total_cap
    ),
    'counts', v_counts,
    'facts', v_facts
  );

  if pg_catalog.octet_length(v_result::text) > v_response_cap then
    raise exception using errcode = '54000', message = 'mobile profile fact response byte cap exceeded';
  end if;
  return v_result;
end;
$function$;

-- Ownership transfer is atomic with the replacement. Preserve CREATE=true and
-- CREATE=false exactly; no broader schema privilege may survive the transaction.
do $function_owner_lifecycle$
declare
  v_service_role_had_schema_create boolean;
  v_service_role_has_schema_create boolean;
begin
  v_service_role_had_schema_create := pg_catalog.current_setting(
    'hockey_life.mobile_profile_v14_6_service_role_public_create_before'
  )::boolean;

  if not v_service_role_had_schema_create then
    execute 'GRANT CREATE ON SCHEMA public TO service_role';
  end if;

  execute 'ALTER FUNCTION public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid) OWNER TO service_role';

  if not v_service_role_had_schema_create then
    execute 'REVOKE CREATE ON SCHEMA public FROM service_role';
  end if;

  select pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    into v_service_role_has_schema_create;
  if v_service_role_has_schema_create is distinct from v_service_role_had_schema_create then
    raise exception using
      errcode = '55000',
      message = 'mobile profile V14.6 service_role schema CREATE privilege was not restored';
  end if;
end;
$function_owner_lifecycle$;

comment on function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid) is
  'V1 server-only, invoker-rights mobile Player Profile phase facts with roster-team and authorized-game season closure, accepted-sub selected-season scope, and pre-aggregation work/row/byte caps.';

revoke all on function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid)
  to service_role;

do $function_postconditions$
declare
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_acl_count integer;
  v_service_role_had_schema_create boolean;
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig,
    (select pg_catalog.count(*)::integer from pg_catalog.aclexplode(p.proacl))
    into v_owner, v_security_definer, v_config, v_acl_count
  from pg_catalog.pg_proc p
  where p.oid = 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)'::pg_catalog.regprocedure;

  if v_owner is distinct from 'service_role'
     or v_security_definer is distinct from false
     or v_config is distinct from array['search_path=pg_catalog']::text[] then
    raise exception using
      errcode = '55000',
      message = 'mobile profile V14.6 function metadata assertion failed';
  end if;

  if v_acl_count is distinct from 1
     or exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(p.proacl) acl
       where p.oid = 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)'::pg_catalog.regprocedure
         and (
           acl.grantee <> 'service_role'::pg_catalog.regrole
           or acl.privilege_type <> 'EXECUTE'
           or acl.is_grantable
         )
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'mobile profile V14.6 function ACL assertion failed';
  end if;

  v_service_role_had_schema_create := pg_catalog.current_setting(
    'hockey_life.mobile_profile_v14_6_service_role_public_create_before'
  )::boolean;
  if pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
     is distinct from v_service_role_had_schema_create then
    raise exception using
      errcode = '55000',
      message = 'mobile profile V14.6 final schema CREATE privilege assertion failed';
  end if;
end;
$function_postconditions$;

commit;
