\set ON_ERROR_STOP on

do $$ begin
  if current_database() !~ '^blh_reliability_test'
     or inet_server_addr() <> '127.0.0.1'::inet
     or inet_server_port() <> 56479 then
    raise exception 'LOCAL TEST DATABASE ONLY';
  end if;
end $$;

-- Synthetic fixtures only. The clone contains captured metadata, never live rows.
insert into auth.users(id) values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000011'),
  ('11000000-0000-4000-8000-000000000012'),
  ('11000000-0000-4000-8000-000000000013');
insert into profiles(id,email,is_platform_admin) values
  ('11000000-0000-4000-8000-000000000001','admin.fixture@example.invalid',false),
  ('11000000-0000-4000-8000-000000000011','scorer.fixture@example.invalid',false),
  ('11000000-0000-4000-8000-000000000012','assist.fixture@example.invalid',false),
  ('11000000-0000-4000-8000-000000000013','goalie.fixture@example.invalid',false);
insert into organizations(id,name,slug,owner_user_id)
values('21000000-0000-4000-8000-000000000001','Reliability Fixture Org','reliability-fixture-org','11000000-0000-4000-8000-000000000001');
insert into leagues(id,name,slug,created_by,organization_id)
values('31000000-0000-4000-8000-000000000001','Reliability Fixture League','reliability-fixture-league',
  '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001');
insert into seasons(id,name,start_date,league_id)
values('41000000-0000-4000-8000-000000000001','Fixture Season','2026-01-01','31000000-0000-4000-8000-000000000001');
insert into teams(id,name,short_name,league_id) values
  ('51000000-0000-4000-8000-000000000001','Fixture Home','HOME','31000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002','Fixture Away','AWAY','31000000-0000-4000-8000-000000000001');
insert into team_rosters(team_id,player_id,season_id,league_id) values
  ('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000011','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000012','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000013','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');

-- Atomic start and idempotent retry on the real games/session schema.
insert into games(id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status)
values('61000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'scheduled');
insert into scorekeeper_sessions(id,token,game_id,league_id,created_by,expires_at,session_type,session_origin)
values('81000000-0000-4000-8000-000000000001','CATALOG-START','61000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',now()+interval '1 day','single','assigned_scorekeeper');
set role service_role;
select public.start_scorekeeper_game_atomic('61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select public.start_scorekeeper_game_atomic('61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  if (select status::text<>'in_progress' or current_period<>1 or game_started_at is null
      from games where id='61000000-0000-4000-8000-000000000001') then
    raise exception 'catalog-shaped atomic start failed';
  end if;
end $$;

-- Finalization runs with every captured completion/locking/standings/playoff
-- trigger enabled. No trigger is replaced by the test.
insert into games(id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status,
  home_verified_at,away_verified_at,home_captain_verified,away_captain_verified,
  skater_capture_status,penalty_capture_status,goalie_capture_status)
values('61000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'pending_verification',
  now(),now(),true,true,'complete','not_recorded','not_recorded');
insert into game_submissions(game_id,league_id,status,submitted_at)
values('61000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','submitted',now());
insert into game_events(id,client_event_id,game_id,team_id,league_id,event_type,period,team_type,player_id,assist1_player_id,entered_by)
values('71000000-0000-4000-8000-000000000021','catalog-goal-1','61000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','goal',1,'home',
  '11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000001');
set role service_role;
select public.finalize_game_stats_atomic('61000000-0000-4000-8000-000000000002',false);
select public.finalize_game_stats_atomic('61000000-0000-4000-8000-000000000002',false);
reset role;
do $$ begin
  if (select status::text<>'completed' or home_score<>1 or away_score<>0 or stats_locked_at is null
      from games where id='61000000-0000-4000-8000-000000000002') then
    raise exception 'catalog-shaped finalization state mismatch';
  end if;
  if not exists(select 1 from player_stats where game_id='61000000-0000-4000-8000-000000000002'
    and player_id='11000000-0000-4000-8000-000000000011' and goals=1 and scorekeeping_provenance='event_derived') then
    raise exception 'catalog-shaped player rebuild mismatch';
  end if;
  if (select status<>'verified' or final_home_score<>1 or total_goals<>1 or total_assists<>1
      from game_submissions where game_id='61000000-0000-4000-8000-000000000002') then
    raise exception 'catalog-shaped submission aggregates mismatch';
  end if;
end $$;

-- Evidence-based adoption of a current-shaped NULL-provenance row.
insert into games(id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status)
values('61000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'in_progress');
insert into game_events(id,client_event_id,game_id,team_id,league_id,event_type,period,team_type,player_id,entered_by)
values('71000000-0000-4000-8000-000000000031','catalog-legacy-goal','61000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','goal',1,'home',
  '11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000001');
insert into player_stats(id,game_id,player_id,team_id,season_id,league_id,goals,assists,penalty_minutes,plus_minus,created_at)
values('91000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000011',
  '51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',1,0,8,5,'2026-01-02T03:04:05Z');
set role service_role;
select public.correct_game_event_atomic('delete','71000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',null,'catalog reconciliation');
reset role;
do $$ begin
  if not exists(select 1 from player_stats where id='91000000-0000-4000-8000-000000000031'
    and goals=0 and penalty_minutes=8 and plus_minus=5 and created_at='2026-01-02T03:04:05Z'
    and scorekeeping_provenance='event_derived') then
    raise exception 'catalog-shaped legacy reconciliation mismatch';
  end if;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like '%draft_obsolete') then
    raise exception 'obsolete function survived migration';
  end if;
end $$;

-- Real-schema goalie-credit regressions plus the sole-goalie 0-0 control.
insert into games(id,league_id,season_id,home_team_id,away_team_id,scheduled_at,status,goalie_capture_status) values
  ('61000000-0000-4000-8000-000000000007','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'in_progress','complete'),
  ('61000000-0000-4000-8000-000000000008','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'in_progress','complete'),
  ('61000000-0000-4000-8000-000000000009','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',now(),'in_progress','complete');
insert into game_goalie_appearances(game_id,player_id,team_id,team_type,recorded_by) values
  ('61000000-0000-4000-8000-000000000007','11000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000001','home','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000007','11000000-0000-4000-8000-000000000012','51000000-0000-4000-8000-000000000001','home','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000007','11000000-0000-4000-8000-000000000013','51000000-0000-4000-8000-000000000002','away','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000001','home','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000013','51000000-0000-4000-8000-000000000002','away','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000001','home','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000013','51000000-0000-4000-8000-000000000002','away','11000000-0000-4000-8000-000000000001');
insert into game_events(id,client_event_id,game_id,team_id,league_id,event_type,period,team_type,player_id,goalie_in_net_id,is_empty_net,entered_by) values
  ('71000000-0000-4000-8000-000000000071','catalog-shared-goalie','61000000-0000-4000-8000-000000000007','51000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','goal',1,'away','11000000-0000-4000-8000-000000000013','11000000-0000-4000-8000-000000000011',false,'11000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000081','catalog-empty-net','61000000-0000-4000-8000-000000000008','51000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','goal',1,'away','11000000-0000-4000-8000-000000000013',null,true,'11000000-0000-4000-8000-000000000001');
select public.rebuild_game_goalie_stats_private('61000000-0000-4000-8000-000000000007');
select public.rebuild_game_goalie_stats_private('61000000-0000-4000-8000-000000000008');
select public.rebuild_game_goalie_stats_private('61000000-0000-4000-8000-000000000009');
do $$ begin
  if exists(select 1 from goalie_stats where game_id='61000000-0000-4000-8000-000000000007' and team_id='51000000-0000-4000-8000-000000000001' and game_result is not null)
    or not exists(select 1 from goalie_stats where game_id='61000000-0000-4000-8000-000000000007' and player_id='11000000-0000-4000-8000-000000000011' and goals_against=1 and shutout=false)
    or not exists(select 1 from goalie_stats where game_id='61000000-0000-4000-8000-000000000007' and player_id='11000000-0000-4000-8000-000000000012' and goals_against=0 and shutout is null) then
    raise exception 'catalog shared-goalie credit regression';
  end if;
  if not exists(select 1 from goalie_stats where game_id='61000000-0000-4000-8000-000000000008' and player_id='11000000-0000-4000-8000-000000000011'
      and goals_against=0 and saves=0 and shots_against=0 and shutout is null and game_result='L') then
    raise exception 'catalog empty-net shutout regression';
  end if;
  if (select count(*)<>2 from goalie_stats where game_id='61000000-0000-4000-8000-000000000009'
      and goals_against=0 and saves=0 and shots_against=0 and shutout=true and scorekeeping_provenance='event_derived') then
    raise exception 'catalog sole-goalie 0-0 control regression';
  end if;
end $$;

select 'production-shaped catalog integration tests passed' as result;
