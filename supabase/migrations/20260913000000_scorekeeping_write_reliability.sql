-- Atomic, provenance-aware scorekeeping finalization and admin recalculation.
-- Existing games remain unknown until a scorekeeper explicitly records capture status.

begin;

alter table public.games
  add column if not exists penalty_capture_status text,
  add column if not exists goalie_capture_status text,
  add column if not exists skater_capture_status text;

alter table public.games drop constraint if exists games_penalty_capture_status_check;
alter table public.games add constraint games_penalty_capture_status_check
  check (penalty_capture_status is null or penalty_capture_status in ('complete', 'not_recorded'));
alter table public.games drop constraint if exists games_goalie_capture_status_check;
alter table public.games add constraint games_goalie_capture_status_check
  check (goalie_capture_status is null or goalie_capture_status in ('complete', 'not_recorded'));
alter table public.games drop constraint if exists games_skater_capture_status_check;
alter table public.games add constraint games_skater_capture_status_check
  check (skater_capture_status is null or skater_capture_status in ('complete', 'not_recorded'));

alter table public.player_stats add column if not exists scorekeeping_provenance text;
alter table public.player_stats drop constraint if exists player_stats_scorekeeping_provenance_check;
alter table public.player_stats add constraint player_stats_scorekeeping_provenance_check
  check (scorekeeping_provenance is null or scorekeeping_provenance = 'event_derived');
alter table public.goalie_stats add column if not exists scorekeeping_provenance text;
alter table public.goalie_stats drop constraint if exists goalie_stats_scorekeeping_provenance_check;
alter table public.goalie_stats add constraint goalie_stats_scorekeeping_provenance_check
  check (scorekeeping_provenance is null or scorekeeping_provenance = 'event_derived');
alter table public.game_stats add column if not exists scorekeeping_provenance text;
alter table public.game_stats drop constraint if exists game_stats_scorekeeping_provenance_check;
alter table public.game_stats add constraint game_stats_scorekeeping_provenance_check
  check (scorekeeping_provenance is null or scorekeeping_provenance = 'event_derived');

create table if not exists public.game_goalie_appearances (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  team_type text not null check (team_type in ('home', 'away')),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (game_id, player_id),
  unique (game_id, team_type, player_id)
);
alter table public.game_goalie_appearances enable row level security;
revoke all on table public.game_goalie_appearances from public, anon, authenticated;
grant select, insert, update, delete on table public.game_goalie_appearances to service_role;

comment on column public.games.penalty_capture_status is
  'NULL=unknown/legacy, complete=penalties explicitly captured including none, not_recorded=not measured';
comment on column public.games.goalie_capture_status is
  'NULL=unknown/legacy, complete=goalie saves and assignments explicitly captured, not_recorded=not measured';
comment on column public.games.skater_capture_status is
  'NULL=unknown/legacy; complete is set only by explicit final score submission review';
comment on column public.player_stats.scorekeeping_provenance is
  'NULL=legacy/imported/unknown and never mutated by event rebuild; event_derived=owned by scorekeeping rebuild';

-- Captain verification alone is not a successful finalization. Lock only in the
-- same UPDATE that marks a game completed; any completion-trigger failure then
-- rolls this lock and every preceding stat/submission write back.
create or replace function public.check_and_lock_stats()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.home_verified_at is not null
     and new.away_verified_at is not null
     and new.stats_locked_at is null then
    new.stats_locked_at := clock_timestamp();
  end if;

  if new.status = 'completed'
     and old.status is distinct from 'completed' then
    update public.game_stats set locked = true where game_id = new.id;
  end if;

  return new;
end;
$function$;

create or replace function public.rebuild_legacy_game_stats_private(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002', message='Game not found'; end if;
  if v_game.skater_capture_status is distinct from 'complete' then return; end if;
  delete from public.game_stats where game_id=p_game_id and scorekeeping_provenance='event_derived';
  insert into public.game_stats(game_id,player_id,team_id,league_id,stat_type,value,period,team_type,entered_by,locked,scorekeeping_provenance)
  select p_game_id,x.player_id,x.team_id,v_game.league_id,x.stat_type,sum(x.stat_value)::int,
    coalesce(x.period::text,'1'),x.team_type,x.entered_by,v_game.status='completed','event_derived'
  from (
    select ge.player_id,ge.team_id,ge.team_type,ge.period,ge.entered_by,'Goal'::text stat_type,1::int stat_value
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id is not null
    union all select ge.assist1_player_id,ge.team_id,ge.team_type,ge.period,ge.entered_by,'Assist',1
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist1_player_id is not null
    union all select ge.assist2_player_id,ge.team_id,ge.team_type,ge.period,ge.entered_by,'Assist',1
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist2_player_id is not null
    union all select ge.player_id,ge.team_id,ge.team_type,ge.period,ge.entered_by,'PIM',ge.penalty_minutes
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='penalty'
        and ge.player_id is not null and v_game.penalty_capture_status='complete'
    union all select ge.player_id,ge.team_id,ge.team_type,ge.period,ge.entered_by,'Save',1
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='save' and ge.player_id is not null
  ) x
  group by x.player_id,x.team_id,x.team_type,x.period,x.entered_by,x.stat_type;
end;
$function$;

create or replace function public.trigger_rollup_season_stats_on_game_complete()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
begin
  perform public.rebuild_game_player_stats_private(new.id);
  perform public.rebuild_game_goalie_stats_private(new.id);
  perform public.rebuild_legacy_game_stats_private(new.id);
  return new;
end;
$function$;

create or replace function public.finalize_game_stats_atomic(p_game_id uuid,p_allow_unverified boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype; v_home int; v_away int; v_rows int;
  v_goals int; v_assists int; v_penalties int; v_saves int;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002', message='Game not found'; end if;
  if v_game.status::text='completed' then
    return jsonb_build_object('game_id',p_game_id,'status','completed','home_score',v_game.home_score,'away_score',v_game.away_score,'already_completed',true);
  end if;
  if v_game.status is null or (v_game.status::text<>'pending_verification' and not (p_allow_unverified and v_game.status::text='in_progress')) then
    raise exception using errcode='22023', message='Game is not eligible for finalization';
  end if;
  if not p_allow_unverified and (v_game.home_verified_at is null or v_game.away_verified_at is null) then
    raise exception using errcode='42501', message='Both captain verifications are required';
  end if;
  select count(*) filter(where event_type='goal' and team_type='home'),count(*) filter(where event_type='goal' and team_type='away'),
    count(*) filter(where event_type='goal'),
    coalesce(sum((assist1_player_id is not null)::int+(assist2_player_id is not null)::int) filter(where event_type='goal'),0),
    count(*) filter(where event_type='penalty'),count(*) filter(where event_type='save')
  into v_home,v_away,v_goals,v_assists,v_penalties,v_saves
  from public.game_events where game_id=p_game_id and deleted_at is null;

  update public.game_submissions set status='verified',verified_at=coalesce(verified_at,clock_timestamp()),
    final_home_score=v_home,final_away_score=v_away,total_goals=v_goals,total_assists=v_assists,
    total_penalties=v_penalties,total_saves=v_saves,updated_at=clock_timestamp()
  where game_id=p_game_id and league_id=v_game.league_id and status in ('submitted','pending_signatures');
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514', message='Exactly one mutable game submission is required'; end if;

  update public.games set home_score=v_home,away_score=v_away,status='completed',
    home_verified_at=case when p_allow_unverified then coalesce(home_verified_at,clock_timestamp()) else home_verified_at end,
    away_verified_at=case when p_allow_unverified then coalesce(away_verified_at,clock_timestamp()) else away_verified_at end,
    home_captain_verified=case when p_allow_unverified then true else home_captain_verified end,
    away_captain_verified=case when p_allow_unverified then true else away_captain_verified end,
    home_verification_token=null,away_verification_token=null,
    home_verification_token_expires_at=null,away_verification_token_expires_at=null,
    stats_locked_at=coalesce(stats_locked_at,clock_timestamp()),updated_at=clock_timestamp()
  where id=p_game_id;
  return jsonb_build_object('game_id',p_game_id,'status','completed','home_score',v_home,'away_score',v_away,'already_completed',false);
end;
$function$;

create or replace function public.recalculate_game_stats_atomic(p_game_id uuid,p_changed_by uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype; v_home int; v_away int;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002', message='Game not found'; end if;
  if not public.scorekeeping_admin_authorized_private(v_game.league_id,p_changed_by) then
    raise exception using errcode='42501', message='League admin authorization required';
  end if;
  select count(*) filter(where team_type='home'),count(*) filter(where team_type='away') into v_home,v_away
    from public.game_events where game_id=p_game_id and event_type='goal' and deleted_at is null;
  if v_game.status::text='completed' and v_game.playoff_series_id is not null
     and sign(coalesce(v_game.home_score,0)-coalesce(v_game.away_score,0))
         is distinct from sign(v_home-v_away) then
    raise exception using errcode='23514',
      message='Winner-changing correction of a completed playoff game requires bracket repair';
  end if;
  perform public.rebuild_game_player_stats_private(p_game_id);
  perform public.rebuild_game_goalie_stats_private(p_game_id);
  perform public.rebuild_legacy_game_stats_private(p_game_id);
  update public.games set home_score=v_home,away_score=v_away,updated_at=clock_timestamp() where id=p_game_id;
  if v_game.status::text='completed' then perform public.refresh_standings(); end if;
  insert into public.game_audit_log(game_id,league_id,action,changed_by,previous_data,new_data,reason)
  values(p_game_id,v_game.league_id,'stat_correction_recalculate',p_changed_by,
    jsonb_build_object('home_score',v_game.home_score,'away_score',v_game.away_score),
    jsonb_build_object('home_score',v_home,'away_score',v_away,'method','recalculate_game_stats_atomic'),
    'Stats recalculated after correction');
  return jsonb_build_object('game_id',p_game_id,'home_score',v_home,'away_score',v_away);
end;
$function$;

drop function if exists public.submit_game_for_verification_atomic(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,text);
create or replace function public.submit_game_for_verification_atomic(
  p_game_id uuid,p_session_id uuid,p_mode text,p_initiating_team_type text,
  p_home_token text,p_away_token text,p_expires_at timestamptz,p_submitted_at timestamptz,
  p_penalty_capture_status text,p_goalie_capture_status text,p_goalie_appearances jsonb default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype; v_session public.scorekeeper_sessions%rowtype; v_submission_status text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002',message='Game not found'; end if;
  select * into v_session from public.scorekeeper_sessions ss where ss.id=p_session_id and ss.league_id=v_game.league_id
    and coalesce(ss.is_active,false) and ss.expires_at>clock_timestamp()
    and ((ss.session_type='single' and ss.game_id=p_game_id) or (ss.session_type='multi' and exists(
      select 1 from public.scorekeeper_session_games ssg join public.games sg on sg.id=ssg.game_id
      where ssg.session_id=ss.id and ssg.game_id=p_game_id and sg.league_id=v_game.league_id))) for update;
  if not found then raise exception using errcode='42501',message='Active scorekeeper session required'; end if;
  if p_mode not in ('both_captains','opponent_only') then raise exception using errcode='22023',message='Invalid verification mode'; end if;
  if p_mode='both_captains' and v_session.session_origin<>'assigned_scorekeeper' then
    raise exception using errcode='42501',message='Assigned scorekeeper session required';
  end if;
  if p_mode='opponent_only' and (v_session.session_origin<>'captain_self_score'
    or v_session.initiating_team_type is distinct from p_initiating_team_type
    or v_session.initiating_captain_id is distinct from v_session.created_by
    or v_session.initiating_team_id is distinct from case p_initiating_team_type when 'home' then v_game.home_team_id when 'away' then v_game.away_team_id else null end) then
    raise exception using errcode='42501',message='Captain session initiation does not match game';
  end if;
  if p_penalty_capture_status is null or p_goalie_capture_status is null
    or p_penalty_capture_status not in ('complete','not_recorded') or p_goalie_capture_status not in ('complete','not_recorded') then
    raise exception using errcode='22023',message='Explicit capture review is required';
  end if;
  if v_game.status::text='pending_verification' then
    return jsonb_build_object('game_id',p_game_id,'status','pending_verification','verification_mode',p_mode,
      'home_token',v_game.home_verification_token,'away_token',v_game.away_verification_token);
  end if;
  if v_game.status is null or v_game.status::text<>'in_progress' then
    raise exception using errcode='22023',message='Only an in-progress game can be submitted';
  end if;
  select status into v_submission_status from public.game_submissions where game_id=p_game_id for update;
  if found and v_submission_status in ('verified','disputed') then
    raise exception using errcode='23514',message='Terminal or disputed submission is immutable';
  end if;
  insert into public.game_submissions(game_id,league_id,status,submitted_at)
  values(p_game_id,v_game.league_id,'submitted',p_submitted_at)
  on conflict(game_id) do update set league_id=excluded.league_id,status='submitted',submitted_at=excluded.submitted_at,updated_at=clock_timestamp()
    where game_submissions.status in ('draft','pending_signatures','submitted');
  if p_goalie_capture_status='complete' then
    if p_goalie_appearances is null or jsonb_typeof(p_goalie_appearances)<>'array' then
      raise exception using errcode='22023',message='Complete goalie capture requires explicit appearances';
    end if;
    delete from public.game_goalie_appearances where game_id=p_game_id;
    insert into public.game_goalie_appearances(game_id,player_id,team_id,team_type,recorded_by)
    select p_game_id,a.player_id,a.team_id,a.team_type,v_session.created_by
    from jsonb_to_recordset(p_goalie_appearances) as a(player_id uuid,team_id uuid,team_type text);
    if not exists(select 1 from public.game_goalie_appearances where game_id=p_game_id and team_type='home')
      or not exists(select 1 from public.game_goalie_appearances where game_id=p_game_id and team_type='away')
      or exists(select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and
        (ga.team_id is distinct from case ga.team_type when 'home' then v_game.home_team_id else v_game.away_team_id end
          or not public.scorekeeping_player_on_team_private(p_game_id,ga.player_id,ga.team_id))) then
      raise exception using errcode='23514',message='Goalie appearances must cover both game teams with valid players';
    end if;
    if exists(select 1 from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and
      ((ge.event_type='goal' and not coalesce(ge.is_empty_net,false) and (ge.goalie_in_net_id is null or not exists(
        select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and ga.player_id=ge.goalie_in_net_id and ga.team_type<>ge.team_type)))
      or (ge.event_type='save' and not exists(select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and ga.player_id=ge.player_id and ga.team_type=ge.team_type)))) then
      raise exception using errcode='22023',message='Complete goalie capture has missing or inconsistent event attribution';
    end if;
  else
    delete from public.game_goalie_appearances where game_id=p_game_id;
  end if;
  if p_penalty_capture_status='complete' and exists(select 1 from public.game_events ge
    where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='penalty'
      and (ge.player_id is null or ge.penalty_minutes is null or ge.penalty_minutes<=0)) then
    raise exception using errcode='22023',message='Complete penalty capture contains invalid penalty';
  end if;
  update public.games set status='pending_verification',stats_submitted_at=p_submitted_at,
    skater_capture_status='complete',penalty_capture_status=p_penalty_capture_status,goalie_capture_status=p_goalie_capture_status,
    home_verification_token=case when p_mode='opponent_only' and p_initiating_team_type='home' then null else p_home_token end,
    away_verification_token=case when p_mode='opponent_only' and p_initiating_team_type='away' then null else p_away_token end,
    home_verification_token_expires_at=case when p_mode='opponent_only' and p_initiating_team_type='home' then null else p_expires_at end,
    away_verification_token_expires_at=case when p_mode='opponent_only' and p_initiating_team_type='away' then null else p_expires_at end,
    home_verified_at=case when p_mode='opponent_only' and p_initiating_team_type='home' then p_submitted_at else null end,
    away_verified_at=case when p_mode='opponent_only' and p_initiating_team_type='away' then p_submitted_at else null end,
    home_captain_verified=p_mode='opponent_only' and p_initiating_team_type='home',
    away_captain_verified=p_mode='opponent_only' and p_initiating_team_type='away',updated_at=clock_timestamp()
  where id=p_game_id;
  select * into v_game from public.games where id=p_game_id;
  return jsonb_build_object('game_id',p_game_id,'status','pending_verification','verification_mode',p_mode,
    'home_token',v_game.home_verification_token,'away_token',v_game.away_verification_token);
end;
$function$;

create or replace function public.reconcile_legacy_player_stats_private(
  p_game_id uuid,
  p_player_ids uuid[]
)
returns void language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_row public.player_stats%rowtype;
  v_goals integer;
  v_assists integer;
  v_team_count integer;
  v_team_id uuid;
begin
  for v_row in
    select * from public.player_stats
    where game_id = p_game_id
      and scorekeeping_provenance is null
      and player_id = any(coalesce(p_player_ids, array[]::uuid[]))
    for update
  loop
    select
      count(*) filter (where ge.event_type='goal' and ge.player_id=v_row.player_id)::int,
      count(*) filter (where ge.event_type='goal' and v_row.player_id in (ge.assist1_player_id,ge.assist2_player_id))::int
    into v_goals,v_assists
    from public.game_events ge
    where ge.game_id=p_game_id and ge.deleted_at is null;

    with sources(team_id) as (
      select ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type in ('goal','penalty') and ge.player_id=v_row.player_id
      union all
      select ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type='goal' and v_row.player_id in (ge.assist1_player_id,ge.assist2_player_id)
      union all
      select case ge.team_type when 'home' then g.away_team_id else g.home_team_id end
      from public.game_events ge join public.games g on g.id=ge.game_id
      where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='save'
        and ge.assist1_player_id=v_row.player_id
    )
    select count(distinct team_id),min(team_id::text)::uuid into v_team_count,v_team_id from sources;

    if v_team_count <> 1 or v_team_id is distinct from v_row.team_id
       or coalesce(v_row.goals,0) <> v_goals
       or coalesce(v_row.assists,0) <> v_assists then
      raise exception using errcode='23514',
        message='Legacy player stats cannot be safely reconciled with pre-correction events';
    end if;

    update public.player_stats
    set scorekeeping_provenance='event_derived'
    where id=v_row.id;
  end loop;
end;
$function$;

create or replace function public.rebuild_corrected_players_private(
  p_game_id uuid,
  p_player_ids uuid[]
)
returns void language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_game public.games%rowtype;
  v_player_id uuid;
  v_team_id uuid;
  v_team_count integer;
  v_existing public.player_stats%rowtype;
  v_has_existing boolean;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002',message='Game not found'; end if;

  for v_player_id in select distinct unnest(coalesce(p_player_ids,array[]::uuid[])) loop
    with sources(team_id) as (
      select ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type in ('goal','penalty') and ge.player_id=v_player_id
      union all
      select ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id)
      union all
      select case ge.team_type when 'home' then v_game.away_team_id else v_game.home_team_id end
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type='save' and ge.assist1_player_id=v_player_id
    )
    select count(distinct team_id),min(team_id::text)::uuid into v_team_count,v_team_id from sources;
    if v_team_count > 1 then raise exception using errcode='23514',message='Player is attributed to multiple teams in one game'; end if;

    select * into v_existing from public.player_stats
    where game_id=p_game_id and player_id=v_player_id for update;
    v_has_existing:=found;

    if v_team_count = 0 then
      if v_has_existing and v_existing.scorekeeping_provenance='event_derived' then
        if coalesce(v_existing.plus_minus,0)<>0
           or (v_game.penalty_capture_status is distinct from 'complete' and coalesce(v_existing.penalty_minutes,0)<>0) then
          update public.player_stats set goals=0,assists=0,power_play_goals=0,power_play_assists=0,
            short_handed_goals=0,short_handed_assists=0,game_winning_goals=0,empty_net_goals=0,shots=0,
            period_1_goals=0,period_1_assists=0,period_2_goals=0,period_2_assists=0,
            period_3_goals=0,period_3_assists=0,ot_goals=0,ot_assists=0,
            penalty_minutes=case when v_game.penalty_capture_status='complete' then 0 else penalty_minutes end
          where id=v_existing.id;
        else
          delete from public.player_stats where id=v_existing.id;
        end if;
      end if;
      continue;
    end if;

    insert into public.player_stats(game_id,player_id,team_id,season_id,league_id,goals,assists,penalty_minutes,
      power_play_goals,power_play_assists,short_handed_goals,short_handed_assists,game_winning_goals,empty_net_goals,shots,
      period_1_goals,period_1_assists,period_2_goals,period_2_assists,period_3_goals,period_3_assists,ot_goals,ot_assists,scorekeeping_provenance)
    select p_game_id,v_player_id,v_team_id,v_game.season_id,v_game.league_id,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id))::int,
      case when v_game.penalty_capture_status='complete' then coalesce(sum(ge.penalty_minutes) filter(where ge.event_type='penalty' and ge.player_id=v_player_id),0)::int else null end,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.is_power_play is true)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.is_power_play is true)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.is_short_handed is true)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.is_short_handed is true)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.is_gwg is true)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.is_empty_net is true)::int,
      (count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id)+count(*) filter(where ge.event_type='save' and ge.assist1_player_id=v_player_id))::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.period=1)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=1)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.period=2)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=2)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.period=3)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=3)::int,
      count(*) filter(where ge.event_type='goal' and ge.player_id=v_player_id and ge.period>3)::int,
      count(*) filter(where ge.event_type='goal' and v_player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period>3)::int,
      'event_derived'
    from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
    on conflict(game_id,player_id) do update set team_id=excluded.team_id,season_id=excluded.season_id,league_id=excluded.league_id,
      goals=excluded.goals,assists=excluded.assists,
      penalty_minutes=case when v_game.penalty_capture_status='complete' then excluded.penalty_minutes else player_stats.penalty_minutes end,
      power_play_goals=excluded.power_play_goals,power_play_assists=excluded.power_play_assists,
      short_handed_goals=excluded.short_handed_goals,short_handed_assists=excluded.short_handed_assists,
      game_winning_goals=excluded.game_winning_goals,empty_net_goals=excluded.empty_net_goals,shots=excluded.shots,
      period_1_goals=excluded.period_1_goals,period_1_assists=excluded.period_1_assists,
      period_2_goals=excluded.period_2_goals,period_2_assists=excluded.period_2_assists,
      period_3_goals=excluded.period_3_goals,period_3_assists=excluded.period_3_assists,
      ot_goals=excluded.ot_goals,ot_assists=excluded.ot_assists
    where player_stats.scorekeeping_provenance='event_derived';
  end loop;
end;
$function$;

create or replace function public.correct_game_event_atomic(p_operation text,p_event_id uuid,p_game_id uuid,p_changed_by uuid,p_event jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype; v_old public.game_events%rowtype; v_new public.game_events%rowtype; v_id uuid;
  v_event_type text; v_impacted uuid[]; v_home int; v_away int;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002',message='Game not found'; end if;
  if not public.scorekeeping_admin_authorized_private(v_game.league_id,p_changed_by) then raise exception using errcode='42501',message='League admin authorization required'; end if;
  if p_operation in ('edit','delete') then
    select * into v_old from public.game_events where id=p_event_id and game_id=p_game_id and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Active event not found'; end if;
  end if;
  v_event_type:=coalesce(p_event->>'event_type',v_old.event_type);
  v_impacted:=array_remove(array[
    case when v_old.event_type in ('goal','penalty') then v_old.player_id when v_old.event_type='save' then v_old.assist1_player_id end,
    case when v_old.event_type='goal' then v_old.assist1_player_id end,
    case when v_old.event_type='goal' then v_old.assist2_player_id end,
    case when v_event_type in ('goal','penalty') then nullif(p_event->>'player_id','')::uuid when v_event_type='save' then nullif(p_event->>'assist1_player_id','')::uuid end,
    case when v_event_type='goal' then nullif(p_event->>'assist1_player_id','')::uuid end,
    case when v_event_type='goal' then nullif(p_event->>'assist2_player_id','')::uuid end
  ],null);
  perform public.reconcile_legacy_player_stats_private(p_game_id,v_impacted);
  if p_operation='add' then
    insert into public.game_events(client_event_id,event_version,sync_status,created_offline,game_id,league_id,team_id,team_type,player_id,event_type,period,game_time_seconds,
      assist1_player_id,assist2_player_id,goalie_in_net_id,penalty_type,penalty_minutes,is_power_play,is_short_handed,is_empty_net,entered_by,entered_at)
    values(p_event->>'client_event_id',1,'synced',false,p_game_id,v_game.league_id,(p_event->>'team_id')::uuid,p_event->>'team_type',nullif(p_event->>'player_id','')::uuid,
      p_event->>'event_type',nullif(p_event->>'period','')::int,nullif(p_event->>'game_time_seconds','')::int,nullif(p_event->>'assist1_player_id','')::uuid,
      nullif(p_event->>'assist2_player_id','')::uuid,nullif(p_event->>'goalie_in_net_id','')::uuid,p_event->>'penalty_type',nullif(p_event->>'penalty_minutes','')::int,
      coalesce((p_event->>'is_power_play')::boolean,false),coalesce((p_event->>'is_short_handed')::boolean,false),coalesce((p_event->>'is_empty_net')::boolean,false),p_changed_by,clock_timestamp())
    returning * into v_new; v_id:=v_new.id;
  elsif p_operation='edit' then
    update public.game_events set team_id=case when p_event?'team_id' then (p_event->>'team_id')::uuid else team_id end,
      team_type=case when p_event?'team_type' then p_event->>'team_type' else team_type end,
      player_id=case when p_event?'player_id' then nullif(p_event->>'player_id','')::uuid else player_id end,
      assist1_player_id=case when p_event?'assist1_player_id' then nullif(p_event->>'assist1_player_id','')::uuid else assist1_player_id end,
      assist2_player_id=case when p_event?'assist2_player_id' then nullif(p_event->>'assist2_player_id','')::uuid else assist2_player_id end,
      goalie_in_net_id=case when p_event?'goalie_in_net_id' then nullif(p_event->>'goalie_in_net_id','')::uuid else goalie_in_net_id end,
      penalty_minutes=case when p_event?'penalty_minutes' then nullif(p_event->>'penalty_minutes','')::int else penalty_minutes end,
      period=case when p_event?'period' then nullif(p_event->>'period','')::int else period end,event_version=event_version+1,updated_at=clock_timestamp()
    where id=p_event_id returning * into v_new; v_id:=v_new.id;
  elsif p_operation='delete' then
    update public.game_events set deleted_at=clock_timestamp(),deleted_by=p_changed_by where id=p_event_id returning * into v_new; v_id:=v_new.id;
  else raise exception using errcode='22023',message='Invalid correction operation'; end if;
  if v_game.penalty_capture_status='complete' and exists(
    select 1 from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
      and ge.event_type='penalty' and (ge.player_id is null or ge.penalty_minutes is null or ge.penalty_minutes<=0)
  ) then
    raise exception using errcode='22023',message='Complete penalty capture contains invalid penalty';
  end if;
  perform public.rebuild_corrected_players_private(p_game_id,v_impacted);
  perform public.rebuild_game_goalie_stats_private(p_game_id);
  perform public.rebuild_legacy_game_stats_private(p_game_id);
  select count(*) filter(where team_type='home'),count(*) filter(where team_type='away') into v_home,v_away
    from public.game_events where game_id=p_game_id and event_type='goal' and deleted_at is null;
  if v_game.status::text='completed' and v_game.playoff_series_id is not null
     and sign(coalesce(v_game.home_score,0)-coalesce(v_game.away_score,0))
         is distinct from sign(v_home-v_away) then
    raise exception using errcode='23514',
      message='Winner-changing correction of a completed playoff game requires bracket repair';
  end if;
  update public.games set home_score=v_home,away_score=v_away,updated_at=clock_timestamp() where id=p_game_id;
  if v_game.status::text='completed' then perform public.refresh_standings(); end if;
  insert into public.game_audit_log(game_id,league_id,action,changed_by,previous_data,new_data,reason)
  values(p_game_id,v_game.league_id,'stat_correction_'||p_operation,p_changed_by,to_jsonb(v_old),to_jsonb(v_new),coalesce(nullif(p_reason,''),'Admin stat correction'));
  return jsonb_build_object('event_id',v_id,'game_id',p_game_id);
end;
$function$;

create or replace function public.rollup_player_season_stats(p_season_id uuid, p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_game_id uuid;
begin
  if not exists (select 1 from public.seasons where id = p_season_id and league_id = p_league_id) then
    raise exception using errcode = '22023', message = 'Season does not belong to league';
  end if;
  for v_game_id in
    select g.id from public.games g
    where g.season_id = p_season_id and g.league_id = p_league_id and g.status = 'completed'
      and (exists (select 1 from public.game_events ge where ge.game_id = g.id)
        or exists (select 1 from public.game_checkins gc where gc.game_id = g.id and gc.status = 'confirmed'))
  loop
    perform public.rebuild_game_player_stats_private(v_game_id);
  end loop;
end;
$function$;

create or replace function public.rollup_goalie_season_stats(p_season_id uuid, p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_game_id uuid;
begin
  if not exists (select 1 from public.seasons where id = p_season_id and league_id = p_league_id) then
    raise exception using errcode = '22023', message = 'Season does not belong to league';
  end if;
  for v_game_id in
    select g.id from public.games g
    where g.season_id = p_season_id and g.league_id = p_league_id
      and g.status = 'completed' and g.goalie_capture_status = 'complete'
  loop
    perform public.rebuild_game_goalie_stats_private(v_game_id);
end loop;
end;
$function$;

create or replace function public.start_scorekeeper_game_atomic(
  p_game_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_game public.games%rowtype;
  v_session public.scorekeeper_sessions%rowtype;
  v_already_started boolean;
begin
  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Game not found';
  end if;

  select * into v_session
  from public.scorekeeper_sessions ss
  where ss.id = p_session_id
    and ss.league_id = v_game.league_id
    and coalesce(ss.is_active, false)
    and ss.expires_at > clock_timestamp()
    and (
      (ss.session_type = 'single' and ss.game_id = p_game_id)
      or (
        ss.session_type = 'multi'
        and exists (
          select 1
          from public.scorekeeper_session_games ssg
          join public.games sg on sg.id = ssg.game_id
          where ssg.session_id = ss.id
            and ssg.game_id = p_game_id
            and sg.league_id = v_game.league_id
        )
      )
    )
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Active scorekeeper session required';
  end if;

  if v_game.status is null or v_game.status::text not in ('scheduled', 'in_progress')
     or v_game.stats_locked_at is not null then
    raise exception using errcode = '22023', message = 'Game cannot be started from its current state';
  end if;

  v_already_started := v_game.status::text = 'in_progress';
  if v_game.status::text = 'scheduled' then
    update public.games
    set status = 'in_progress',
        current_period = case when coalesce(current_period, 0) > 0 then current_period else 1 end,
        game_started_at = coalesce(game_started_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = p_game_id and status::text = 'scheduled' and stats_locked_at is null;

    if not found then
      raise exception using errcode = '40001', message = 'Game start state changed concurrently';
    end if;
  end if;

  select * into v_game from public.games where id = p_game_id;
  return jsonb_build_object(
    'game_id', p_game_id,
    'status', v_game.status,
    'current_period', v_game.current_period,
    'already_started', v_already_started
  );
end;
$function$;

create or replace function public.verify_and_finalize_game_stats_atomic(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_game public.games%rowtype;
  v_team_type text;
  v_final jsonb;
begin
  select g.* into v_game
  from public.games g
  where g.status = 'pending_verification'
    and ((g.home_verification_token = p_token and g.home_verification_token_expires_at > clock_timestamp())
      or (g.away_verification_token = p_token and g.away_verification_token_expires_at > clock_timestamp()))
  for update;
  if not found then raise exception using errcode = '22023', message = 'Invalid verification token'; end if;
  v_team_type := case when v_game.home_verification_token = p_token then 'home' else 'away' end;

  if v_team_type = 'home' then
    update public.games set home_verified_at = clock_timestamp(), home_captain_verified = true,
      home_verification_token = null, home_verification_token_expires_at = null,
      updated_at = clock_timestamp()
    where id = v_game.id;
  else
    update public.games set away_verified_at = clock_timestamp(), away_captain_verified = true,
      away_verification_token = null, away_verification_token_expires_at = null,
      updated_at = clock_timestamp()
    where id = v_game.id;
  end if;

  select * into v_game from public.games where id = v_game.id;
  if v_game.home_verified_at is not null and v_game.away_verified_at is not null then
    v_final := public.finalize_game_stats_atomic(v_game.id, false);
    return v_final || jsonb_build_object('team_type', v_team_type);
  end if;
  return jsonb_build_object('game_id', v_game.id, 'status', 'pending_verification', 'team_type', v_team_type);
end;
$function$;

-- Review corrections below intentionally replace the initial draft bodies above.
create or replace function public.scorekeeping_player_on_team_private(
  p_game_id uuid, p_player_id uuid, p_team_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.game_checkins gc
    where gc.game_id = p_game_id and gc.player_id = p_player_id
      and gc.team_id = p_team_id and gc.status = 'confirmed'
  ) or exists (
    select 1
    from public.games g
    join public.team_rosters tr on tr.season_id = g.season_id
      and tr.league_id = g.league_id and tr.team_id = p_team_id
      and tr.player_id = p_player_id and tr.status::text = 'active'
    where g.id = p_game_id
      and (tr.joined_at is null or tr.joined_at <= g.scheduled_at)
      and (tr.end_date is null or tr.end_date >= g.scheduled_at::date)
  );
$function$;

create or replace function public.scorekeeping_admin_authorized_private(
  p_league_id uuid, p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.leagues l
    left join public.organizations o on o.id = l.organization_id
    where l.id = p_league_id
      and (l.created_by = p_user_id or o.owner_user_id = p_user_id)
  ) or exists (
    select 1 from public.league_memberships lm
    where lm.league_id = p_league_id and lm.user_id = p_user_id
      and lm.status::text = 'active' and lm.role::text in ('owner', 'admin')
  ) or exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.is_platform_admin = true
  );
$function$;

create or replace function public.validate_game_event_attribution_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_game public.games%rowtype;
  v_expected_team uuid;
begin
  if new.deleted_at is not null then return new; end if;
  select * into v_game from public.games where id = new.game_id;
  if not found or new.league_id <> v_game.league_id then
    raise exception using errcode = '23514', message = 'Event league does not match game';
  end if;
  v_expected_team := case new.team_type
    when 'home' then v_game.home_team_id when 'away' then v_game.away_team_id else null end;
  if new.team_id is distinct from v_expected_team then
    raise exception using errcode = '23514', message = 'Event team does not match game side';
  end if;
  if new.event_type = 'goal' then
    if new.player_id is not null and not public.scorekeeping_player_on_team_private(new.game_id, new.player_id, new.team_id) then
      raise exception using errcode = '23514', message = 'Scorer is not attributed to scoring team';
    end if;
    if new.assist1_player_id is not null and not public.scorekeeping_player_on_team_private(new.game_id, new.assist1_player_id, new.team_id) then
      raise exception using errcode = '23514', message = 'First assist is not attributed to scoring team';
    end if;
    if new.assist2_player_id is not null and not public.scorekeeping_player_on_team_private(new.game_id, new.assist2_player_id, new.team_id) then
      raise exception using errcode = '23514', message = 'Second assist is not attributed to scoring team';
    end if;
    if coalesce(new.is_empty_net, false) and new.goalie_in_net_id is not null then
      raise exception using errcode = '23514', message = 'Empty-net goal cannot charge a goalie';
    end if;
    if new.goalie_in_net_id is not null then
      v_expected_team := case new.team_type when 'home' then v_game.away_team_id else v_game.home_team_id end;
      if not public.scorekeeping_player_on_team_private(new.game_id, new.goalie_in_net_id, v_expected_team) then
        raise exception using errcode = '23514', message = 'Goalie is not attributed to defending team';
      end if;
    end if;
  elsif new.event_type = 'penalty' then
    if new.player_id is null or not public.scorekeeping_player_on_team_private(new.game_id, new.player_id, new.team_id) then
      raise exception using errcode = '23514', message = 'Penalty player is not attributed to event team';
    end if;
    if new.penalty_minutes is null or new.penalty_minutes <= 0 then
      raise exception using errcode = '22023', message = 'Penalty minutes must be positive';
    end if;
  elsif new.event_type = 'save' then
    if new.player_id is null or not public.scorekeeping_player_on_team_private(new.game_id, new.player_id, new.team_id) then
      raise exception using errcode = '23514', message = 'Save goalie is not attributed to event team';
    end if;
    if new.assist1_player_id is not null then
      v_expected_team := case new.team_type when 'home' then v_game.away_team_id else v_game.home_team_id end;
      if not public.scorekeeping_player_on_team_private(new.game_id, new.assist1_player_id, v_expected_team) then
        raise exception using errcode = '23514', message = 'Save shooter is not attributed to attacking team';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_game_event_attribution on public.game_events;
create trigger validate_game_event_attribution
before insert or update of game_id, league_id, team_id, team_type, player_id,
  assist1_player_id, assist2_player_id, goalie_in_net_id, event_type,
  penalty_minutes, is_empty_net, deleted_at
on public.game_events for each row
execute function public.validate_game_event_attribution_private();

create or replace function public.rebuild_game_player_stats_private(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Game not found'; end if;
  if v_game.skater_capture_status is distinct from 'complete' then return; end if;
  if v_game.penalty_capture_status = 'complete' and exists (
    select 1 from public.game_events ge where ge.game_id = p_game_id
      and ge.deleted_at is null and ge.event_type = 'penalty'
      and (ge.player_id is null or ge.penalty_minutes is null or ge.penalty_minutes <= 0)
  ) then raise exception using errcode = '22023', message = 'Complete penalty capture contains invalid penalty'; end if;
  if exists (
    with sources as (
      select ge.player_id,ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type in ('goal','penalty') and ge.player_id is not null
      union all select ge.assist1_player_id,ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist1_player_id is not null
      union all select ge.assist2_player_id,ge.team_id from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist2_player_id is not null
      union all select ge.assist1_player_id,case ge.team_type when 'home' then v_game.away_team_id else v_game.home_team_id end
        from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='save' and ge.assist1_player_id is not null
    ) select 1 from sources group by player_id having count(distinct team_id)>1
  ) then raise exception using errcode='23514',message='Player is attributed to multiple teams in one game'; end if;

  delete from public.player_stats ps
  where ps.game_id = p_game_id and ps.scorekeeping_provenance = 'event_derived'
    and not exists (
      select 1 from public.game_events ge where ge.game_id = p_game_id and ge.deleted_at is null
        and ((ge.event_type in ('goal','penalty') and ge.player_id = ps.player_id)
          or (ge.event_type = 'goal' and ps.player_id in (ge.assist1_player_id, ge.assist2_player_id))
          or (ge.event_type = 'save' and ge.assist1_player_id = ps.player_id))
    );

  insert into public.player_stats (
    game_id, player_id, team_id, season_id, league_id, goals, assists,
    penalty_minutes, power_play_goals, power_play_assists, short_handed_goals,
    short_handed_assists, game_winning_goals, empty_net_goals, shots,
    period_1_goals, period_1_assists, period_2_goals, period_2_assists,
    period_3_goals, period_3_assists, ot_goals, ot_assists, scorekeeping_provenance
  )
  with sources as (
    select ge.player_id, ge.team_id from public.game_events ge
      where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type in ('goal','penalty') and ge.player_id is not null
    union all select ge.assist1_player_id, ge.team_id from public.game_events ge
      where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist1_player_id is not null
    union all select ge.assist2_player_id, ge.team_id from public.game_events ge
      where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.assist2_player_id is not null
    union all select ge.assist1_player_id,
      case ge.team_type when 'home' then v_game.away_team_id else v_game.home_team_id end
      from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null
        and ge.event_type='save' and ge.assist1_player_id is not null
  ), participants as (select player_id, min(team_id::text)::uuid team_id from sources group by player_id)
  select p_game_id, p.player_id, p.team_id, v_game.season_id, v_game.league_id,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id))::int,
    case when v_game.penalty_capture_status='complete' then coalesce((select sum(ge.penalty_minutes) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='penalty' and ge.player_id=p.player_id),0)::int else null end,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.is_power_play is true)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.is_power_play is true)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.is_short_handed is true)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.is_short_handed is true)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.is_gwg is true)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.is_empty_net is true)::int,
    ((select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id)
      +(select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='save' and ge.assist1_player_id=p.player_id))::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.period=1)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=1)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.period=2)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=2)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.period=3)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period=3)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and ge.player_id=p.player_id and ge.period>3)::int,
    (select count(*) from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and ge.event_type='goal' and p.player_id in (ge.assist1_player_id,ge.assist2_player_id) and ge.period>3)::int,
    'event_derived'
  from participants p
  on conflict (game_id, player_id) do update set
    team_id=excluded.team_id, season_id=excluded.season_id, league_id=excluded.league_id,
    goals=excluded.goals, assists=excluded.assists,
    penalty_minutes=case when v_game.penalty_capture_status='complete' then excluded.penalty_minutes else player_stats.penalty_minutes end,
    power_play_goals=excluded.power_play_goals, power_play_assists=excluded.power_play_assists,
    short_handed_goals=excluded.short_handed_goals, short_handed_assists=excluded.short_handed_assists,
    game_winning_goals=excluded.game_winning_goals, empty_net_goals=excluded.empty_net_goals,
    shots=excluded.shots, period_1_goals=excluded.period_1_goals, period_1_assists=excluded.period_1_assists,
    period_2_goals=excluded.period_2_goals, period_2_assists=excluded.period_2_assists,
    period_3_goals=excluded.period_3_goals, period_3_assists=excluded.period_3_assists,
    ot_goals=excluded.ot_goals, ot_assists=excluded.ot_assists
  where player_stats.scorekeeping_provenance='event_derived';
end;
$function$;

create or replace function public.rebuild_game_goalie_stats_private(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_game public.games%rowtype; v_home_score int; v_away_score int;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then raise exception using errcode='P0002', message='Game not found'; end if;
  if v_game.goalie_capture_status is distinct from 'complete' then return; end if;
  if not exists(select 1 from public.game_goalie_appearances where game_id=p_game_id and team_type='home')
    or not exists(select 1 from public.game_goalie_appearances where game_id=p_game_id and team_type='away') then
    raise exception using errcode='22023', message='Complete goalie capture requires appearances for both teams';
  end if;
  if exists(select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and
    (ga.team_id is distinct from case ga.team_type when 'home' then v_game.home_team_id else v_game.away_team_id end
      or not public.scorekeeping_player_on_team_private(p_game_id,ga.player_id,ga.team_id))) then
    raise exception using errcode='23514', message='Goalie appearance attribution does not match game';
  end if;
  if exists(select 1 from public.game_events ge where ge.game_id=p_game_id and ge.deleted_at is null and
    ((ge.event_type='goal' and not coalesce(ge.is_empty_net,false) and (ge.goalie_in_net_id is null or not exists(
      select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and ga.player_id=ge.goalie_in_net_id and ga.team_type<>ge.team_type)))
    or (ge.event_type='save' and not exists(select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and ga.player_id=ge.player_id and ga.team_type=ge.team_type)))) then
    raise exception using errcode='22023', message='Complete goalie capture has missing or inconsistent attribution';
  end if;
  select count(*) filter(where team_type='home'), count(*) filter(where team_type='away')
    into v_home_score,v_away_score from public.game_events where game_id=p_game_id and event_type='goal' and deleted_at is null;
  delete from public.goalie_stats gs where gs.game_id=p_game_id and gs.scorekeeping_provenance='event_derived'
    and not exists(select 1 from public.game_goalie_appearances ga where ga.game_id=p_game_id and ga.player_id=gs.player_id);
  insert into public.goalie_stats(game_id,player_id,team_id,season_id,league_id,goals_against,saves,shots_against,shutout,
    period_1_saves,period_1_shots,period_2_saves,period_2_shots,period_3_saves,period_3_shots,ot_saves,ot_shots,game_result,scorekeeping_provenance)
  select p_game_id,ga.player_id,ga.team_id,v_game.season_id,v_game.league_id,
    count(*) filter(where ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))::int,
    count(*) filter(where ge.event_type='save' and ge.player_id=ga.player_id)::int,
    count(*) filter(where (ge.event_type='save' and ge.player_id=ga.player_id) or (ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false)))::int,
    case
      when count(*) filter(where ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))>0 then false
      when (select count(*) from public.game_goalie_appearances teammate
            where teammate.game_id=p_game_id and teammate.team_type=ga.team_type)=1
        and case ga.team_type when 'home' then v_away_score else v_home_score end=0 then true
      else null
    end,
    count(*) filter(where ge.event_type='save' and ge.player_id=ga.player_id and ge.period=1)::int,
    count(*) filter(where ge.period=1 and ((ge.event_type='save' and ge.player_id=ga.player_id) or (ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))))::int,
    count(*) filter(where ge.event_type='save' and ge.player_id=ga.player_id and ge.period=2)::int,
    count(*) filter(where ge.period=2 and ((ge.event_type='save' and ge.player_id=ga.player_id) or (ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))))::int,
    count(*) filter(where ge.event_type='save' and ge.player_id=ga.player_id and ge.period=3)::int,
    count(*) filter(where ge.period=3 and ((ge.event_type='save' and ge.player_id=ga.player_id) or (ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))))::int,
    count(*) filter(where ge.event_type='save' and ge.player_id=ga.player_id and ge.period>3)::int,
    count(*) filter(where ge.period>3 and ((ge.event_type='save' and ge.player_id=ga.player_id) or (ge.event_type='goal' and ge.goalie_in_net_id=ga.player_id and not coalesce(ge.is_empty_net,false))))::int,
    case when (select count(*) from public.game_goalie_appearances teammate
                    where teammate.game_id=p_game_id and teammate.team_type=ga.team_type)>1 then null
      when ga.team_type='home' and v_home_score>v_away_score then 'W' when ga.team_type='home' and v_home_score<v_away_score then 'L'
      when ga.team_type='away' and v_away_score>v_home_score then 'W' when ga.team_type='away' and v_away_score<v_home_score then 'L' else 'T' end,
    'event_derived'
  from public.game_goalie_appearances ga left join public.game_events ge on ge.game_id=p_game_id and ge.deleted_at is null
  where ga.game_id=p_game_id group by ga.player_id,ga.team_id,ga.team_type
  on conflict(game_id,player_id) do update set team_id=excluded.team_id,season_id=excluded.season_id,league_id=excluded.league_id,
    goals_against=excluded.goals_against,saves=excluded.saves,shots_against=excluded.shots_against,shutout=excluded.shutout,
    period_1_saves=excluded.period_1_saves,period_1_shots=excluded.period_1_shots,period_2_saves=excluded.period_2_saves,
    period_2_shots=excluded.period_2_shots,period_3_saves=excluded.period_3_saves,period_3_shots=excluded.period_3_shots,
    ot_saves=excluded.ot_saves,ot_shots=excluded.ot_shots,game_result=excluded.game_result
  where goalie_stats.scorekeeping_provenance='event_derived';
end;
$function$;

revoke all on function public.check_and_lock_stats() from public, anon, authenticated;
revoke all on function public.rebuild_game_player_stats_private(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_game_goalie_stats_private(uuid) from public, anon, authenticated;
revoke all on function public.rollup_player_season_stats(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rollup_goalie_season_stats(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_game_stats_atomic(uuid, boolean) from public, anon, authenticated;
revoke all on function public.recalculate_game_stats_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trigger_rollup_season_stats_on_game_complete() from public, anon, authenticated;
revoke all on function public.verify_and_finalize_game_stats_atomic(text) from public, anon, authenticated;
revoke all on function public.scorekeeping_player_on_team_private(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.scorekeeping_admin_authorized_private(uuid,uuid) from public, anon, authenticated;
revoke all on function public.validate_game_event_attribution_private() from public, anon, authenticated;
revoke all on function public.rebuild_legacy_game_stats_private(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_legacy_player_stats_private(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.rebuild_corrected_players_private(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.correct_game_event_atomic(text,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.submit_game_for_verification_atomic(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.rollup_game_stats(uuid) from public, anon, authenticated;
revoke all on function public.recalculate_game_stats_from_events(uuid) from public, anon, authenticated;
revoke all on function public.recalculate_all_season_stats(uuid) from public, anon, authenticated;
revoke all on function public.start_scorekeeper_game_atomic(uuid,uuid) from public, anon, authenticated;

grant execute on function public.rollup_player_season_stats(uuid, uuid) to service_role;
grant execute on function public.rollup_goalie_season_stats(uuid, uuid) to service_role;
grant execute on function public.finalize_game_stats_atomic(uuid, boolean) to service_role;
grant execute on function public.recalculate_game_stats_atomic(uuid, uuid) to service_role;
grant execute on function public.submit_game_for_verification_atomic(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.verify_and_finalize_game_stats_atomic(text) to service_role;
grant execute on function public.correct_game_event_atomic(text,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.rollup_game_stats(uuid) to service_role;
grant execute on function public.recalculate_game_stats_from_events(uuid) to service_role;
grant execute on function public.recalculate_all_season_stats(uuid) to service_role;
grant execute on function public.start_scorekeeper_game_atomic(uuid,uuid) to service_role;


commit;
