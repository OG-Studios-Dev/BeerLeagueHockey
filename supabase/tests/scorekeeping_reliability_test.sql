\set ON_ERROR_STOP on

update games set skater_capture_status='complete' where id='60000000-0000-4000-8000-000000000001';
update player_stats set scorekeeping_provenance='event_derived'
where game_id='60000000-0000-4000-8000-000000000001' and player_id='10000000-0000-4000-8000-000000000011';
update game_events set is_gwg=true where id='70000000-0000-4000-8000-000000000001';

do $$
declare
  v_result jsonb;
  v_count integer;
begin
  v_result := public.finalize_game_stats_atomic('60000000-0000-4000-8000-000000000001');

  if (select status <> 'completed' or home_score <> 2 or away_score <> 0 or stats_locked_at is null
      from games where id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'final game state mismatch';
  end if;
  if (select penalty_capture_status is not null or goalie_capture_status is not null
      from games where id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'legacy/omitted capture status was fabricated';
  end if;

  if (select goals <> 1 or assists <> 0 or penalty_minutes <> 99 or plus_minus <> 7 or game_winning_goals <> 1
      from player_stats where game_id = '60000000-0000-4000-8000-000000000001'
        and player_id = '10000000-0000-4000-8000-000000000011') then
    raise exception 'active/deleted/PIM-null event aggregation mismatch';
  end if;

  if (select goals <> 0 or assists <> 1 or team_id <> '50000000-0000-4000-8000-000000000001'
      from player_stats where game_id = '60000000-0000-4000-8000-000000000001'
        and player_id = '10000000-0000-4000-8000-000000000012') then
    raise exception 'assist-only player attribution mismatch';
  end if;

  if (select goals <> 5 or assists <> 6 or penalty_minutes <> 7 or plus_minus <> 8 or game_winning_goals <> 9
      from player_stats where game_id = '60000000-0000-4000-8000-000000000001'
        and player_id = '10000000-0000-4000-8000-000000000013') then
    raise exception 'unknown imported player row was changed';
  end if;

  select count(*) into v_count from player_stats
  where game_id = '60000000-0000-4000-8000-000000000001';
  if v_count <> 3 then raise exception 'imported/event-derived player row count mismatch'; end if;

  if (select saves <> 40 or shots_against <> 44 from goalie_stats
      where game_id = '60000000-0000-4000-8000-000000000001'
        and player_id = '10000000-0000-4000-8000-000000000014') then
    raise exception 'measured goalie row was overwritten';
  end if;
  select count(*) into v_count from goalie_stats
  where game_id = '60000000-0000-4000-8000-000000000001';
  if v_count <> 1 then raise exception 'assumed goalie row was invented'; end if;

  if (select status <> 'verified' or final_home_score <> 2 or final_away_score <> 0 or verified_at is null
      from game_submissions where game_id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'submission was not finalized atomically';
  end if;

  -- Idempotent retry retains one row per player and the measured goalie data.
  v_result := public.finalize_game_stats_atomic('60000000-0000-4000-8000-000000000001');
  select count(*) into v_count from player_stats
  where game_id = '60000000-0000-4000-8000-000000000001';
  if v_count <> 3 then raise exception 'retry duplicated player stats'; end if;
  if (select completions<>1 from playoff_effects where game_id='60000000-0000-4000-8000-000000000001') then
    raise exception 'completed retry re-fired playoff completion';
  end if;
end
$$;

-- A current-shaped legacy row may be adopted only when its pre-correction
-- goals/assists agree with the raw event evidence. Independent measurements
-- and row identity survive removal of its final goal.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status)
values('60000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress');
insert into game_events(id,game_id,league_id,team_id,team_type,player_id,event_type,period,entered_by)
values('70000000-0000-4000-8000-000000000041','60000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','home','10000000-0000-4000-8000-000000000011','goal',1,'10000000-0000-4000-8000-000000000001');
insert into player_stats(id,game_id,player_id,team_id,season_id,league_id,goals,assists,penalty_minutes,plus_minus,created_at)
values('90000000-0000-4000-8000-000000000041','60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000011',
  '50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,0,6,4,'2026-01-02T03:04:05Z');
select public.correct_game_event_atomic('delete','70000000-0000-4000-8000-000000000041','60000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',null,'legacy reconciliation');
do $$ begin
  if not exists(select 1 from player_stats where id='90000000-0000-4000-8000-000000000041'
    and goals=0 and assists=0 and penalty_minutes=6 and plus_minus=4
    and created_at='2026-01-02T03:04:05Z' and scorekeeping_provenance='event_derived') then
    raise exception 'safe legacy player reconciliation did not preserve independent fields and identity';
  end if;
end $$;

insert into games(id,league_id,season_id,home_team_id,away_team_id,status)
values('60000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress');
insert into game_events(id,game_id,league_id,team_id,team_type,player_id,event_type,period,entered_by)
values('70000000-0000-4000-8000-000000000051','60000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','home','10000000-0000-4000-8000-000000000011','goal',1,'10000000-0000-4000-8000-000000000001');
insert into player_stats(game_id,player_id,team_id,season_id,league_id,goals,assists)
values('60000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',9,0);
do $$ begin
  begin
    perform public.correct_game_event_atomic('delete','70000000-0000-4000-8000-000000000051','60000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000001',null,'must fail closed');
    raise exception 'unsafe legacy reconciliation unexpectedly succeeded';
  exception when sqlstate '23514' then null; end;
  if (select deleted_at is not null from game_events where id='70000000-0000-4000-8000-000000000051')
     or (select scorekeeping_provenance is not null from player_stats where game_id='60000000-0000-4000-8000-000000000005') then
    raise exception 'failed legacy reconciliation left durable mutations';
  end if;
end $$;

set role anon;
do $$ begin
  begin perform public.rollup_game_stats('60000000-0000-4000-8000-000000000001');
    raise exception 'anon legacy writer unexpectedly executed';
  exception when insufficient_privilege then null; end;
  begin perform public.recalculate_game_stats_from_events('60000000-0000-4000-8000-000000000001');
    raise exception 'anon recalculate writer unexpectedly executed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select public.finalize_game_stats_atomic('60000000-0000-4000-8000-000000000001');
reset role;
set role authenticated;
do $$ begin
  begin perform public.recalculate_all_season_stats('40000000-0000-4000-8000-000000000001');
    raise exception 'authenticated season writer unexpectedly executed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare v_signature text;
begin
  if has_function_privilege('anon', 'public.finalize_game_stats_atomic(uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.finalize_game_stats_atomic(uuid,boolean)', 'execute') then
    raise exception 'atomic writer is executable by a public application role';
  end if;
  if not has_function_privilege('service_role', 'public.finalize_game_stats_atomic(uuid,boolean)', 'execute') then
    raise exception 'service_role cannot execute atomic writer';
  end if;
  if has_function_privilege('anon','public.rollup_game_stats(uuid)','execute')
    or has_function_privilege('authenticated','public.recalculate_game_stats_from_events(uuid)','execute')
    or has_function_privilege('anon','public.recalculate_all_season_stats(uuid)','execute') then
    raise exception 'legacy SECURITY DEFINER writer remains public';
  end if;
  foreach v_signature in array array[
    'public.finalize_game_stats_atomic(uuid,boolean)',
    'public.recalculate_game_stats_atomic(uuid,uuid)',
    'public.submit_game_for_verification_atomic(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb)',
    'public.verify_and_finalize_game_stats_atomic(text)',
    'public.correct_game_event_atomic(text,uuid,uuid,uuid,jsonb,text)',
    'public.start_scorekeeper_game_atomic(uuid,uuid)',
    'public.rollup_player_season_stats(uuid,uuid)',
    'public.rollup_goalie_season_stats(uuid,uuid)',
    'public.rollup_game_stats(uuid)',
    'public.recalculate_game_stats_from_events(uuid)',
    'public.recalculate_all_season_stats(uuid)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
       or has_function_privilege('authenticated',v_signature,'execute')
       or not has_function_privilege('service_role',v_signature,'execute') then
      raise exception 'public writer ACL mismatch: %',v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.check_and_lock_stats()',
    'public.trigger_rollup_season_stats_on_game_complete()',
    'public.validate_game_event_attribution_private()',
    'public.scorekeeping_player_on_team_private(uuid,uuid,uuid)',
    'public.scorekeeping_admin_authorized_private(uuid,uuid)',
    'public.rebuild_game_player_stats_private(uuid)',
    'public.rebuild_game_goalie_stats_private(uuid)',
    'public.rebuild_legacy_game_stats_private(uuid)',
    'public.reconcile_legacy_player_stats_private(uuid,uuid[])',
    'public.rebuild_corrected_players_private(uuid,uuid[])'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
       or has_function_privilege('authenticated',v_signature,'execute')
       or has_function_privilege('service_role',v_signature,'execute') then
      raise exception 'private or trigger function ACL mismatch: %',v_signature;
    end if;
  end loop;
end
$$;

-- Atomic start is the only scorekeeper status transition. It preserves the
-- first start timestamp on retry and refuses terminal/locked games.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status)
values('60000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','scheduled');
insert into scorekeeper_sessions(id,game_id,league_id,session_type,is_active,expires_at,created_by,session_origin)
values('80000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001','single',true,
  now()+interval '1 day','10000000-0000-4000-8000-000000000001','assigned_scorekeeper');
set role service_role;
select public.start_scorekeeper_game_atomic('60000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006');
select public.start_scorekeeper_game_atomic('60000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006');
reset role;
do $$ declare v_started timestamptz; begin
  select game_started_at into v_started from games where id='60000000-0000-4000-8000-000000000006';
  if v_started is null or (select status::text<>'in_progress' or current_period<>1 from games where id='60000000-0000-4000-8000-000000000006') then
    raise exception 'atomic game start did not initialize period/state';
  end if;
  update games set status='completed',stats_locked_at=now() where id='60000000-0000-4000-8000-000000000006';
  begin perform public.start_scorekeeper_game_atomic('60000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006');
    raise exception 'terminal game reopened';
  exception when sqlstate '22023' then null; end;
end $$;

-- Deleted correction: event, audit, score, stats, and standings share one transaction.
select public.correct_game_event_atomic('delete','70000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'test delete');

do $$
declare v_count integer;
begin
  if (select home_score <> 1 from games where id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'deleted goal correction did not update score';
  end if;
  if (select goals_for<>1 from standings_calculated where season_id='40000000-0000-4000-8000-000000000001'
      and team_id='50000000-0000-4000-8000-000000000001')
    or (select goals_for<>1 from team_standings where season_id='40000000-0000-4000-8000-000000000001'
      and team_id='50000000-0000-4000-8000-000000000001') then
    raise exception 'completed correction left standings stale';
  end if;
  select count(*) into v_count from player_stats
  where game_id = '60000000-0000-4000-8000-000000000001'
    and player_id = '10000000-0000-4000-8000-000000000011';
  if v_count <> 1 then raise exception 'penalty participant row unexpectedly removed'; end if;
end
$$;

-- Submission state gate and lost-response retry preserve tokens and verification.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status)
values('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress');
insert into scorekeeper_sessions(id,game_id,league_id,session_type,is_active,expires_at,created_by,session_origin)
values('80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','single',true,now()+interval '1 day','10000000-0000-4000-8000-000000000001','assigned_scorekeeper');
select public.submit_game_for_verification_atomic('60000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','both_captains',null,
  'ORIGINAL-HOME','ORIGINAL-AWAY',now()+interval '1 day',now(),'complete','not_recorded','[]'::jsonb);
update games set home_verified_at=now(),home_captain_verified=true where id='60000000-0000-4000-8000-000000000002';
select public.submit_game_for_verification_atomic('60000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','both_captains',null,
  'ROTATED-HOME','ROTATED-AWAY',now()+interval '2 days',now(),'complete','not_recorded','[]'::jsonb);
do $$ begin
  if (select home_verification_token<>'ORIGINAL-HOME' or away_verification_token<>'ORIGINAL-AWAY' or home_verified_at is null
      from games where id='60000000-0000-4000-8000-000000000002') then
    raise exception 'pending retry rotated tokens or cleared verification';
  end if;
end $$;

update games set status='scheduled' where id='60000000-0000-4000-8000-000000000002';
do $$ begin
  begin perform public.submit_game_for_verification_atomic('60000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','both_captains',null,
    'X','Y',now()+interval '1 day',now(),'complete','not_recorded','[]'); raise exception 'scheduled submit succeeded';
  exception when sqlstate '22023' then null; end;
end $$;
update games set status='cancelled' where id='60000000-0000-4000-8000-000000000002';
do $$ begin
  begin perform public.submit_game_for_verification_atomic('60000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','both_captains',null,
    'X','Y',now()+interval '1 day',now(),'complete','not_recorded','[]'); raise exception 'cancelled submit succeeded';
  exception when sqlstate '22023' then null; end;
end $$;

-- Explicit appearances produce measured zero rows for a 0-0 game.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status)
values('60000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress');
insert into scorekeeper_sessions(id,game_id,league_id,session_type,is_active,expires_at,created_by,session_origin)
values('80000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','single',true,now()+interval '1 day','10000000-0000-4000-8000-000000000001','assigned_scorekeeper');
select public.submit_game_for_verification_atomic('60000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','both_captains',null,'H0','A0',
  now()+interval '1 day',now(),'complete','complete',
  '[{"player_id":"10000000-0000-4000-8000-000000000014","team_id":"50000000-0000-4000-8000-000000000001","team_type":"home"},
    {"player_id":"10000000-0000-4000-8000-000000000015","team_id":"50000000-0000-4000-8000-000000000002","team_type":"away"}]');
select public.finalize_game_stats_atomic('60000000-0000-4000-8000-000000000003',true);
do $$ begin
  if (select count(*)<>2 from goalie_stats where game_id='60000000-0000-4000-8000-000000000003'
      and saves=0 and goals_against=0 and shots_against=0 and shutout=true and scorekeeping_provenance='event_derived') then
    raise exception 'explicit 0-0 goalie appearances not materialized';
  end if;
end $$;

-- Shared crease: team result is known, but goalie of record is not captured.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status,goalie_capture_status)
values('60000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress','complete');
insert into game_goalie_appearances(game_id,player_id,team_id,team_type,recorded_by) values
  ('60000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000001','home','10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000012','50000000-0000-4000-8000-000000000001','home','10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000013','50000000-0000-4000-8000-000000000002','away','10000000-0000-4000-8000-000000000001');
insert into game_events(id,game_id,league_id,team_id,team_type,player_id,goalie_in_net_id,event_type,period,entered_by)
values('70000000-0000-4000-8000-000000000071','60000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002','away','10000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000011','goal',1,
  '10000000-0000-4000-8000-000000000001');
select public.rebuild_game_goalie_stats_private('60000000-0000-4000-8000-000000000007');
do $$ begin
  if exists(select 1 from goalie_stats where game_id='60000000-0000-4000-8000-000000000007'
      and team_id='50000000-0000-4000-8000-000000000001' and game_result is not null)
    or not exists(select 1 from goalie_stats where game_id='60000000-0000-4000-8000-000000000007'
      and player_id='10000000-0000-4000-8000-000000000011' and goals_against=1 and shutout=false)
    or not exists(select 1 from goalie_stats where game_id='60000000-0000-4000-8000-000000000007'
      and player_id='10000000-0000-4000-8000-000000000012' and goals_against=0 and shutout is null) then
    raise exception 'shared-goalie individual result/shutout credit was fabricated';
  end if;
end $$;

-- An empty-net team goal is not individual GA and leaves individual SO unknown.
insert into games(id,league_id,season_id,home_team_id,away_team_id,status,goalie_capture_status)
values('60000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','in_progress','complete');
insert into game_goalie_appearances(game_id,player_id,team_id,team_type,recorded_by) values
  ('60000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000001','home','10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000013','50000000-0000-4000-8000-000000000002','away','10000000-0000-4000-8000-000000000001');
insert into game_events(id,game_id,league_id,team_id,team_type,player_id,event_type,period,is_empty_net,entered_by)
values('70000000-0000-4000-8000-000000000081','60000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002','away','10000000-0000-4000-8000-000000000013','goal',1,true,
  '10000000-0000-4000-8000-000000000001');
select public.rebuild_game_goalie_stats_private('60000000-0000-4000-8000-000000000008');
do $$ begin
  if not exists(select 1 from goalie_stats where game_id='60000000-0000-4000-8000-000000000008'
      and player_id='10000000-0000-4000-8000-000000000011' and goals_against=0 and shots_against=0
      and shutout is null and game_result='L') then
    raise exception 'empty-net opponent goal fabricated zero-GA shutout credit';
  end if;
end $$;

-- Downstream rebuild failure rolls add + audit + all rebuilt state back.
update games set penalty_capture_status='complete' where id='60000000-0000-4000-8000-000000000001';
do $$
declare v_events int; v_audits int; v_score int;
begin
  select count(*) into v_events from game_events where game_id='60000000-0000-4000-8000-000000000001';
  select count(*) into v_audits from game_audit_log where game_id='60000000-0000-4000-8000-000000000001';
  select home_score into v_score from games where id='60000000-0000-4000-8000-000000000001';
  begin
    perform public.correct_game_event_atomic('add',null,'60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      '{"client_event_id":"rollback-add","team_id":"50000000-0000-4000-8000-000000000001","team_type":"home","player_id":"10000000-0000-4000-8000-000000000011","event_type":"goal","period":1}'::jsonb,'rollback test');
    raise exception 'failed correction unexpectedly committed';
  exception when sqlstate '22023' then
    if sqlerrm<>'Complete penalty capture contains invalid penalty' then raise; end if;
  end;
  if (select count(*)<>v_events from game_events where game_id='60000000-0000-4000-8000-000000000001')
    or (select count(*)<>v_audits from game_audit_log where game_id='60000000-0000-4000-8000-000000000001')
    or (select home_score<>v_score from games where id='60000000-0000-4000-8000-000000000001') then
    raise exception 'failed correction left durable partial writes';
  end if;
end $$;
update games set penalty_capture_status=null where id='60000000-0000-4000-8000-000000000001';

-- Mixed/partial goalie capture must fail closed and create no measured/assumed row.
update games set goalie_capture_status = 'complete'
where id = '60000000-0000-4000-8000-000000000001';
update game_events set deleted_at = null
where id = '70000000-0000-4000-8000-000000000001';

do $$
declare v_before integer;
begin
  select count(*) into v_before from goalie_stats
  where game_id = '60000000-0000-4000-8000-000000000001';
  begin
    perform public.recalculate_game_stats_atomic(
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'partial goalie capture unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
  if (select count(*) <> v_before from goalie_stats
      where game_id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'partial goalie capture changed goalie rows';
  end if;
end
$$;

-- Force a required completion-trigger failure and prove every preceding write rolls back.
create or replace function public.reliability_test_fail_completion() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and current_setting('reliability_test.fail_completion', true) = 'on' then
    raise exception 'forced required completion failure';
  end if;
  return new;
end
$$;
create trigger reliability_test_fail_completion
before update on public.games for each row execute function public.reliability_test_fail_completion();

update games set status = 'pending_verification', home_score = 9, away_score = 9,
                 stats_locked_at = null, goalie_capture_status = null,
                 home_verified_at=now(), away_verified_at=null,
                 away_verification_token='RETRYABLE-TOKEN', away_verification_token_expires_at=now()+interval '1 day'
where id = '60000000-0000-4000-8000-000000000001';
update game_submissions set status = 'submitted', verified_at = null,
                            final_home_score = null, final_away_score = null
where game_id = '60000000-0000-4000-8000-000000000001';
update player_stats set goals = 77
where game_id = '60000000-0000-4000-8000-000000000001'
  and player_id = '10000000-0000-4000-8000-000000000011';
set reliability_test.fail_completion = 'on';

do $$
begin
  begin
    perform public.verify_and_finalize_game_stats_atomic('RETRYABLE-TOKEN');
    raise exception 'forced completion failure unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'forced required completion failure' then raise; end if;
  end;

  if (select status <> 'pending_verification' or home_score <> 9 or away_score <> 9 or stats_locked_at is not null
      or away_verified_at is not null or away_verification_token<>'RETRYABLE-TOKEN'
      from games where id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'game writes survived failed finalization';
  end if;
  if (select status <> 'submitted' or verified_at is not null or final_home_score is not null
      from game_submissions where game_id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'submission writes survived failed finalization';
  end if;
  if (select goals <> 77 from player_stats
      where game_id = '60000000-0000-4000-8000-000000000001'
        and player_id = '10000000-0000-4000-8000-000000000011') then
    raise exception 'stat writes survived failed finalization';
  end if;
end
$$;

reset reliability_test.fail_completion;
select 'scorekeeping reliability integration tests passed' as result;
